package main

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
)

var ErrInboxItemNotFound = errors.New("inbox item not found")

const inboxDataVersion = 1

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
	sort.Slice(items, func(i, j int) bool {
		return items[i].AddedAt > items[j].AddedAt
	})
}

func (fs *FileStore) readInboxDataLocked() InboxData {
	data, err := os.ReadFile(fs.inboxFile())
	if err != nil {
		return InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
	}
	var inbox InboxData
	if err := json.Unmarshal(data, &inbox); err != nil || inbox.Items == nil {
		return InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
	}
	if inbox.Version == 0 {
		inbox.Version = inboxDataVersion
	}
	return inbox
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
	inboxMaxURLLen     = 2048
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
	link.URL = truncateRunes(link.URL, inboxMaxURLLen)
	link.Title = truncateRunes(link.Title, inboxMaxTitleLen)
	link.Note = truncateRunes(link.Note, inboxMaxNoteLen)
	link.Source = truncateRunes(link.Source, inboxMaxSourceLen)
	link.PreviewTitle = truncateRunes(link.PreviewTitle, inboxMaxPreviewLen)
	link.PreviewDesc = truncateRunes(link.PreviewDesc, inboxMaxPreviewLen)
	link.PreviewImage = truncateRunes(link.PreviewImage, inboxMaxURLLen)
}

func (fs *FileStore) AddInboxLink(link InboxLink, dedupe bool, maxItems int) (InboxLink, []InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	inbox := fs.readInboxDataLocked()
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

	inbox := fs.readInboxDataLocked()
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
	for _, bm := range fs.GetAllBookmarks() {
		if strings.TrimSpace(bm.Icon) == fileName {
			return true
		}
	}
	for _, item := range fs.GetInboxItems() {
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
	fileName = strings.TrimSpace(fileName)
	if fileName == "" || strings.ContainsAny(fileName, "/:") {
		return
	}
	if fs.iconReferenced(fileName) {
		return
	}
	_ = os.Remove(filepath.Join(fs.dataDir, "icons", fileName))
}

func (fs *FileStore) RestoreInboxLink(link InboxLink, maxItems int) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id := strings.TrimSpace(link.ID)
	if id == "" {
		return InboxLink{}, fmt.Errorf("invalid inbox id")
	}

	inbox := fs.readInboxDataLocked()
	for _, existing := range inbox.Items {
		if existing.ID == id {
			return existing, nil
		}
	}

	clampInboxLinkFields(&link)
	link.ID = id
	link.URL = strings.TrimSpace(link.URL)
	if link.URL == "" {
		return InboxLink{}, fmt.Errorf("invalid inbox url")
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
	inbox.Items = trimInboxItemsKeeping(inbox.Items, maxItems, link.ID)

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
		return InboxLink{}, ErrInboxAtCapacity
	}

	if err := fs.saveInboxDataLocked(inbox); err != nil {
		return InboxLink{}, err
	}
	return link, nil
}

func (fs *FileStore) UpdateInboxLink(id string, mutate func(*InboxLink) error) (InboxLink, error) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	id = strings.TrimSpace(id)
	if id == "" {
		return InboxLink{}, ErrInboxItemNotFound
	}

	inbox := fs.readInboxDataLocked()
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
