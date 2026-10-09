package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

var ErrInboxItemNotFound = errors.New("inbox item not found")

// inboxDataVersion 2: titles stored decoded (see readInboxDataLocked).
const inboxDataVersion = 2

// InboxLink is a lightweight saved URL (not a full bookmark).
type InboxLink struct {
	ID           string `json:"id"`
	URL          string `json:"url"`
	Title        string `json:"title,omitempty"`
	AddedAt      int64  `json:"addedAt"`
	Source       string `json:"source,omitempty"`
	PreviewTitle string `json:"previewTitle,omitempty"`
	PreviewDesc  string `json:"previewDesc,omitempty"`
	PreviewImage string `json:"previewImage,omitempty"`
	// Icon is a stored favicon filename under data/icons/ (same convention as
	// Bookmark.Icon), fetched during preview enrichment so the inbox can show the
	// real site icon like the health view does, not just an og:image.
	Icon   string   `json:"icon,omitempty"`
	Note   string   `json:"note,omitempty"`
	Tags   []string `json:"tags,omitempty"`
	Domain string   `json:"domain,omitempty"`
	ReadAt int64    `json:"readAt,omitempty"`
	// IconFetchedAt records when a favicon fetch was last attempted for this
	// item, successful or not (Unix ms). Without it the startup backfill has no
	// way to tell "never tried" from "tried and the site has no favicon", so
	// every item whose fetch legitimately fails — a 404, a dead domain — is
	// retried on every single restart, forever.
	IconFetchedAt int64 `json:"iconFetchedAt,omitempty"`
	// SnoozedUntil hides the item from the main list until this time (Unix ms).
	// 0 means not snoozed. No server-side timer is needed — the client re-surfaces
	// the item once now passes this value.
	SnoozedUntil int64 `json:"snoozedUntil,omitempty"`
}

// InboxData is persisted at data/inbox.json.
type InboxData struct {
	Version int         `json:"version"`
	Items   []InboxLink `json:"items"`
}

func inboxFilePath(dataDir string) string {
	return filepath.Join(dataDir, "inbox.json")
}

func (fs *FileStore) inboxFile() string {
	return inboxFilePath(fs.dataDir)
}

func normalizePasteDestination(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bookmark", "inbox":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "ask"
	}
}

func generateInboxID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("inl_%d", time.Now().UnixNano())
	}
	return "inl_" + hex.EncodeToString(buf)
}

func inboxDomainFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Hostname()
}

func sortInboxItemsNewestFirst(items []InboxLink) {
	// Stable, with insertion order as the tiebreak. AddedAt has millisecond
	// resolution, so items saved in the same millisecond -- a seeded inbox, an
	// import, an extension replaying a queued batch -- carry the same value, and
	// sort.Slice is not stable: their order came out differently from one call
	// to the next. That made the list reshuffle between reads, and at capacity
	// it made trimInboxItems drop an arbitrary one of the tied items rather than
	// the one that was added first.
	pos := make(map[string]int, len(items))
	for i := range items {
		pos[items[i].ID] = i
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].AddedAt != items[j].AddedAt {
			return items[i].AddedAt > items[j].AddedAt
		}
		return pos[items[i].ID] > pos[items[j].ID]
	})
}

func (fs *FileStore) readInboxDataLocked() InboxData {
	inbox, _ := fs.readInboxDataForWriteLocked()
	return inbox
}

// readInboxDataForWriteLocked is the read every mutator uses. A missing file
// is an empty inbox; any other read or decode error is returned, because the
// mutator would otherwise save that empty state over inbox.json and lose
// every item in it.
func (fs *FileStore) readInboxDataForWriteLocked() (InboxData, error) {
	empty := InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
	data, err := os.ReadFile(fs.inboxFile())
	if err != nil {
		if os.IsNotExist(err) {
			return empty, nil
		}
		return empty, fmt.Errorf("read inbox: %w", err)
	}
	var inbox InboxData
	if err := json.Unmarshal(data, &inbox); err != nil {
		return empty, fmt.Errorf("decode inbox: %w", err)
	}
	if inbox.Items == nil {
		inbox.Items = []InboxLink{}
	}
	// Version 1 kept entities as an older fetch stored them; they are decoded
	// once, and the next save writes version 2. Decoding on every read was not
	// idempotent: "What is &amp;nbsp;?" lost its text, and a URL used as a
	// title turned "&param=" into "¶m=".
	if inbox.Version < 2 {
		for i := range inbox.Items {
			inbox.Items[i].Title = decodePreviewText(inbox.Items[i].Title)
			inbox.Items[i].PreviewTitle = decodePreviewText(inbox.Items[i].PreviewTitle)
			inbox.Items[i].PreviewDesc = decodePreviewText(inbox.Items[i].PreviewDesc)
		}
	}
	inbox.Version = inboxDataVersion
	return inbox, nil
}

func (fs *FileStore) saveInboxDataLocked(inbox InboxData) error {
	if inbox.Version == 0 {
		inbox.Version = inboxDataVersion
	}
	if inbox.Items == nil {
		inbox.Items = []InboxLink{}
	}
	return fs.writeStoreJSONFile(fs.inboxFile(), inbox, 0)
}

func trimInboxItems(items []InboxLink, maxItems int) []InboxLink {
	if maxItems <= 0 || len(items) <= maxItems {
		return items
	}
	sortInboxItemsNewestFirst(items)
	return items[:maxItems]
}

// trimInboxItemsKeeping trims to maxItems while guaranteeing that keepID
// survives, dropping the oldest of the *other* items to make room.
//
// Plain trimInboxItems cannot be used for a restore. It cuts by age, and a
// restored item is old by definition — the undo of a link saved last week
// carries last week's AddedAt. At capacity that means the same call which
// "restores" the item also discards it, while the handler goes on to report
// success. Undo then looks like it worked until the next reload.
//
// Age is still the rule for everything else: the item being restored is the one
// exception, because the user just asked for it explicitly.
func trimInboxItemsKeeping(items []InboxLink, maxItems int, keepID string) []InboxLink {
	keepID = strings.TrimSpace(keepID)
	if maxItems <= 0 || len(items) <= maxItems || keepID == "" {
		return trimInboxItems(items, maxItems)
	}

	sortInboxItemsNewestFirst(items)

	kept := make([]InboxLink, 0, maxItems)
	var protected *InboxLink
	for i := range items {
		if items[i].ID == keepID && protected == nil {
			protected = &items[i]
			continue
		}
		kept = append(kept, items[i])
	}
	if protected == nil {
		// Not present after all; nothing to protect.
		return trimInboxItems(items, maxItems)
	}
	// One slot goes to the protected item, so the rest compete for maxItems-1.
	if len(kept) > maxItems-1 {
		kept = kept[:maxItems-1]
	}
	kept = append(kept, *protected)
	sortInboxItemsNewestFirst(kept)
	return kept
}

// getInboxItemsChecked is GetInboxItems with the read error kept: a cleanup
// that decides what is unused must not take a failed read for an empty inbox.
func (fs *FileStore) getInboxItemsChecked() ([]InboxLink, error) {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()
	inbox, err := fs.readInboxDataForWriteLocked()
	return inbox.Items, err
}

func (fs *FileStore) GetInboxItems() []InboxLink {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	inbox := fs.readInboxDataLocked()
	items := append([]InboxLink(nil), inbox.Items...)
	sortInboxItemsNewestFirst(items)
	return items
}

// Field ceilings for stored inbox text.
//
// inbox.json is read and rewritten in full on every mutation and shipped whole
// on every dashboard load, so an unbounded field is paid for again and again by
// every later request — not just by the one that stored it. The limits are far
// above anything a real title or note reaches; they exist to stop a runaway
// value, not to police length.
const (
	inboxMaxTitleLen   = 500
	inboxMaxNoteLen    = 2000
	inboxMaxPreviewLen = 1000
	inboxMaxSourceLen  = 100
	// A URL is not cut but refused past this: a cut address is a broken
	// link, and dedupe then compared against the stump. Long enough for the
	// directions, JQL and SafeLinks addresses that pass 2,048.
	inboxMaxURLLen = 8192
	inboxMaxTags   = 25
	inboxMaxTagLen = 50
)

// truncateRunes cuts to at most n runes, never splitting one in half.
func truncateRunes(value string, n int) string {
	runes := []rune(value)
	if len(runes) <= n {
		return value
	}
	return string(runes[:n])
}

// evictedInboxItems lists the items present in `before` but gone from `after` —
// what a capacity trim dropped.
//
// Only the explicit DELETE path ever cleaned up an icon, so every eviction left
// a favicon behind in data/icons/ for good: one orphan per evicted item, forever,
// on any inbox sitting at its cap.
func evictedInboxItems(before, after []InboxLink) []InboxLink {
	if len(before) == len(after) {
		return nil
	}
	kept := make(map[string]struct{}, len(after))
	for i := range after {
		kept[after[i].ID] = struct{}{}
	}
	var gone []InboxLink
	for i := range before {
		if _, ok := kept[before[i].ID]; !ok {
			gone = append(gone, before[i])
		}
	}
	return gone
}

// clampInboxLinkFields bounds every client-supplied text field on an inbox item.
// Applied on add, patch and restore, so no write path can store more than the
// others allow.
func clampInboxLinkFields(link *InboxLink) {
	link.Title = truncateRunes(link.Title, inboxMaxTitleLen)
	link.Note = truncateRunes(link.Note, inboxMaxNoteLen)
	link.Source = truncateRunes(link.Source, inboxMaxSourceLen)
	link.PreviewTitle = truncateRunes(link.PreviewTitle, inboxMaxPreviewLen)
	link.PreviewDesc = truncateRunes(link.PreviewDesc, inboxMaxPreviewLen)
	link.PreviewImage = truncateRunes(link.PreviewImage, inboxMaxURLLen)

	// Tags are client-supplied too, and a runaway list is the same problem as a
	// runaway title: it is rewritten into inbox.json on every later mutation.
	if len(link.Tags) > inboxMaxTags {
		link.Tags = link.Tags[:inboxMaxTags]
	}
	for i := range link.Tags {
		link.Tags[i] = truncateRunes(link.Tags[i], inboxMaxTagLen)
	}
}

func (fs *FileStore) AddInboxLink(link InboxLink, dedupe bool, maxItems int) (InboxLink, []InboxLink, error) {
	maxItems = demoInboxLimit(maxItems)
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	inbox, err := fs.readInboxDataForWriteLocked()
	if err != nil {
		return InboxLink{}, nil, err
	}
	urlKey := canonicalBookmarkURLKey(link.URL)
	if urlKey == "" {
		return InboxLink{}, nil, fmt.Errorf("invalid inbox url")
	}

	if dedupe {
		for _, existing := range inbox.Items {
			if canonicalBookmarkURLKey(existing.URL) == urlKey {
				return existing, nil, ErrInboxDuplicateURL
			}
		}
	}

	if strings.TrimSpace(link.ID) == "" {
		link.ID = generateInboxID()
	}
	if link.AddedAt == 0 {
		link.AddedAt = time.Now().UnixMilli()
	}
	link.URL = strings.TrimSpace(link.URL)
	link.Domain = inboxDomainFromURL(link.URL)
	if strings.TrimSpace(link.Title) == "" {
		if domain := link.Domain; domain != "" {
			link.Title = domain
		} else {
			link.Title = link.URL
		}
	}
	link.Tags = normalizeTags(link.Tags)
	clampInboxLinkFields(&link)

	inbox.Items = append(inbox.Items, link)
	// Trimmed with the new item protected, for the same reason RestoreInboxLink
	// does it: the cut is age-ordered, so a caller supplying an older AddedAt —
	// an extension replaying a queued save, an import, a sync retry — would have
	// its item dropped by the very call that added it, and still be told it
	// worked.
	beforeTrim := append([]InboxLink(nil), inbox.Items...)
	inbox.Items = trimInboxItemsKeeping(inbox.Items, maxItems, link.ID)
	evicted := evictedInboxItems(beforeTrim, inbox.Items)

	survived := false
	for i := range inbox.Items {
		if inbox.Items[i].ID == link.ID {
			survived = true
			break
		}
	}
	if !survived {
		return InboxLink{}, nil, ErrInboxAtCapacity
	}

	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return InboxLink{}, nil, err
	}
	// Returned rather than cleaned up here: removeUnusedIconFile takes the store
	// lock, which this function still holds, and it must see the saved state
	// before deciding an icon is unreferenced.
	return link, evicted, nil
}

var ErrInboxDuplicateURL = errors.New("inbox duplicate url")

// ErrInboxAtCapacity reports that a restore could not be honoured because the
// inbox is full. Distinct from a persist failure: nothing went wrong, there is
// simply no room, and the caller has to say so rather than claim success.
var ErrInboxAtCapacity = errors.New("inbox at capacity")

func (fs *FileStore) DeleteInboxLink(id string) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return ErrInboxItemNotFound
	}

	inbox, err := fs.readInboxDataForWriteLocked()
	if err != nil {
		return err
	}
	next := make([]InboxLink, 0, len(inbox.Items))
	found := false
	for _, item := range inbox.Items {
		if item.ID == id {
			found = true
			continue
		}
		next = append(next, item)
	}
	if !found {
		return ErrInboxItemNotFound
	}
	inbox.Items = next
	return fs.saveInboxDataLocked(inbox)
}

// iconReferenced reports whether the given stored icon filename is still used by
// any bookmark or inbox item. Only bare filenames served from data/icons/ are
// tracked; absolute/root-relative icon values are never deletable files, so they
// are treated as "referenced" (never removed). Callers hold no lock — this takes
// its own read locks via the public getters.
func (fs *FileStore) iconReferenced(fileName string) bool {
	fileName = strings.TrimSpace(fileName)
	if fileName == "" {
		return true
	}
	// Anything that is a URL or path is not a data/icons/ file we manage.
	if strings.ContainsAny(fileName, "/:") {
		return true
	}
	// A store that could not be read in full keeps the icon: an unreadable
	// page or inbox.json is not proof that nothing uses it.
	bookmarks, complete := fs.getAllBookmarksChecked()
	if !complete {
		return true
	}
	for _, bm := range bookmarks {
		if strings.TrimSpace(bm.Icon) == fileName {
			return true
		}
	}
	items, err := fs.getInboxItemsChecked()
	if err != nil {
		return true
	}
	for _, item := range items {
		if strings.TrimSpace(item.Icon) == fileName {
			return true
		}
	}
	return false
}

// removeUnusedIconFile deletes a stored icon file when no bookmark or inbox item
// still references it. Best-effort: a missing file or a still-referenced name is a
// no-op, and any remove error is swallowed (an orphaned icon is harmless clutter,
// not a failure worth surfacing to the caller). Call this AFTER the referencing
// item has been removed, so the just-deleted item does not count as a reference.
func (fs *FileStore) removeUnusedIconFile(fileName string) {
	fs.removeUnusedIconFiles([]string{fileName})
}

// removeUnusedIconFiles is removeUnusedIconFile for many names, reading the
// bookmarks and the inbox once rather than once per name: a Clear read of a few
// hundred items re-read both a few hundred times.
func (fs *FileStore) removeUnusedIconFiles(fileNames []string) {
	candidates := map[string]struct{}{}
	for _, name := range fileNames {
		name = strings.TrimSpace(name)
		if name != "" && !strings.ContainsAny(name, "/:") {
			candidates[name] = struct{}{}
		}
	}
	if len(candidates) == 0 {
		return
	}
	// Unread is not unused: skip the cleanup when either store failed to read.
	bookmarks, complete := fs.getAllBookmarksChecked()
	if !complete {
		return
	}
	items, err := fs.getInboxItemsChecked()
	if err != nil {
		return
	}
	for _, bm := range bookmarks {
		delete(candidates, strings.TrimSpace(bm.Icon))
	}
	for _, item := range items {
		delete(candidates, strings.TrimSpace(item.Icon))
	}
	// A container's chosen icon (Containers view drawer) can be the same
	// file a bookmark had.
	for _, icon := range fs.GetSettings().DockerContainerIcons {
		delete(candidates, strings.TrimSpace(icon))
	}
	for name := range candidates {
		_ = os.Remove(filepath.Join(fs.dataDir, "icons", name))
	}
}

func (fs *FileStore) RestoreInboxLink(link InboxLink, maxItems int) (InboxLink, error) {
	restored, _, err := fs.RestoreInboxLinkEvicting(link, maxItems)
	return restored, err
}

// RestoreInboxLinkEvicting is RestoreInboxLink plus what the capacity trim
// dropped to make room, as AddInboxLink reports it: the caller removes their
// icons (that needs the lock held here) and tells the user.
func (fs *FileStore) RestoreInboxLinkEvicting(link InboxLink, maxItems int) (InboxLink, []InboxLink, error) {
	maxItems = demoInboxLimit(maxItems)
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id := strings.TrimSpace(link.ID)
	if id == "" {
		return InboxLink{}, nil, fmt.Errorf("invalid inbox id")
	}

	inbox, err := fs.readInboxDataForWriteLocked()
	if err != nil {
		return InboxLink{}, nil, err
	}
	for _, existing := range inbox.Items {
		if existing.ID == id {
			return existing, nil, nil
		}
	}

	clampInboxLinkFields(&link)
	link.ID = id
	link.URL = strings.TrimSpace(link.URL)
	if link.URL == "" {
		return InboxLink{}, nil, fmt.Errorf("invalid inbox url")
	}
	if link.AddedAt == 0 {
		link.AddedAt = time.Now().UnixMilli()
	}
	link.Domain = inboxDomainFromURL(link.URL)
	if strings.TrimSpace(link.Title) == "" {
		if domain := link.Domain; domain != "" {
			link.Title = domain
		} else {
			link.Title = link.URL
		}
	}
	link.Tags = normalizeTags(link.Tags)

	inbox.Items = append([]InboxLink{link}, inbox.Items...)
	// Trimmed with the restored item protected: it is old by definition, so an
	// age-ordered cut at capacity would drop the very item being restored and
	// still report success.
	beforeTrim := append([]InboxLink(nil), inbox.Items...)
	inbox.Items = trimInboxItemsKeeping(inbox.Items, maxItems, link.ID)
	evicted := evictedInboxItems(beforeTrim, inbox.Items)

	// The protection above is what makes this hold, so the check is belt and
	// braces — but it is the difference between a caller that can trust the
	// return value and one that cannot. Reporting success for an item that is
	// not in the list is the failure mode this whole function had: the client
	// re-adds it locally and the user only finds out on the next reload.
	survived := false
	for i := range inbox.Items {
		if inbox.Items[i].ID == link.ID {
			survived = true
			break
		}
	}
	if !survived {
		return InboxLink{}, nil, ErrInboxAtCapacity
	}

	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return InboxLink{}, nil, err
	}
	return link, evicted, nil
}

func (fs *FileStore) UpdateInboxLink(id string, mutate func(*InboxLink) error) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return InboxLink{}, ErrInboxItemNotFound
	}

	inbox, err := fs.readInboxDataForWriteLocked()
	if err != nil {
		return InboxLink{}, err
	}
	for i := range inbox.Items {
		if inbox.Items[i].ID != id {
			continue
		}
		if mutate != nil {
			if err := mutate(&inbox.Items[i]); err != nil {
				return InboxLink{}, err
			}
		}
		if err := fs.saveInboxDataLocked(inbox); err != nil {
			return InboxLink{}, err
		}
		return inbox.Items[i], nil
	}
	return InboxLink{}, ErrInboxItemNotFound
}

// BatchInboxLinks applies one change to many items under a single lock and a
// single write of inbox.json. mutate returns true to drop the item. It reports
// the items as they were before the change (for events and icon cleanup) and
// the ids it could not find.
func (fs *FileStore) BatchInboxLinks(ids []string, mutate func(*InboxLink) bool) ([]InboxLink, []string, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	wanted := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = false
		}
	}
	inbox, err := fs.readInboxDataForWriteLocked()
	if err != nil {
		return nil, nil, err
	}
	before := make([]InboxLink, 0, len(wanted))
	next := make([]InboxLink, 0, len(inbox.Items))
	for _, item := range inbox.Items {
		seen, ok := wanted[item.ID]
		if !ok || seen {
			next = append(next, item)
			continue
		}
		wanted[item.ID] = true
		before = append(before, item)
		if mutate(&item) {
			continue
		}
		next = append(next, item)
	}
	missing := make([]string, 0)
	for _, id := range ids {
		if found, ok := wanted[strings.TrimSpace(id)]; ok && !found {
			missing = append(missing, id)
			wanted[strings.TrimSpace(id)] = true
		}
	}
	if len(before) == 0 {
		return before, missing, nil
	}
	inbox.Items = next
	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return nil, nil, err
	}
	return before, missing, nil
}

// inboxURLTooLong reports an address past the inbox's limit. Refused at the
// door rather than cut: a cut address opens nothing.
func inboxURLTooLong(url string) bool {
	return utf8.RuneCountInString(url) > inboxMaxURLLen
}
