package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func (h *Handlers) GetInbox(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	items := h.store.GetInboxItems()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"items": items,
		"count": len(items),
	})
}

func (h *Handlers) AddInboxItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		URL    string `json:"url"`
		Title  string `json:"title"`
		Source string `json:"source"`
		Note   string `json:"note"`
		// Tags were silently dropped before this: InboxLink carries them and
		// AddInboxLink normalises them, but the request struct had no field, so
		// anything posting tags — the extension, a script — lost them on the
		// way in with no error to notice.
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	url := strings.TrimSpace(request.URL)
	// validateBookmarkURL deliberately allows an empty string — a bookmark may
	// have no URL. An inbox item is nothing but a URL, so the emptiness has to be
	// caught here; without this it slipped through and failed deeper as a generic
	// 500, reporting a client mistake as a server fault.
	if url == "" {
		http.Error(w, "URL is required", http.StatusBadRequest)
		return
	}
	if err := h.validateBookmarkURL(url); err != nil {
		http.Error(w, fmt.Sprintf("Invalid URL: %v", err), http.StatusBadRequest)
		return
	}

	settings := h.store.GetSettings()
	dedupe := settings.InboxDedupeUrls
	maxItems := settings.InboxMaxItems
	if maxItems <= 0 {
		maxItems = 500
	}

	link := InboxLink{
		URL:    url,
		Title:  strings.TrimSpace(request.Title),
		Source: strings.TrimSpace(request.Source),
		Note:   strings.TrimSpace(request.Note),
		Tags:   request.Tags,
	}

	created, evictedIcons, err := h.store.AddInboxLink(link, dedupe, maxItems)
	if err != nil {
		if errors.Is(err, ErrInboxDuplicateURL) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			// `created` is the item already holding this URL, not a zero value:
			// AddInboxLink's dedupe branch returns the existing entry alongside
			// the error, which is what lets the client jump to it.
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "duplicate_url",
				"message": "URL already in inbox",
				"item":    created,
			})
			return
		}
		// Same reasoning as the restore path below: a full inbox is not a server
		// fault, and the add is the case where reporting success would lose the
		// item silently — the client believes it landed and only finds out on the
		// next reload.
		if errors.Is(err, ErrInboxAtCapacity) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "at_capacity",
				"message": "Inbox is full",
			})
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		http.Error(w, "Failed to save inbox item", http.StatusInternalServerError)
		return
	}

	// Favicons of items the capacity trim dropped. Cleaned up here rather than
	// inside the store: removeUnusedIconFile takes the store lock, which
	// AddInboxLink still holds, and it has to see the saved state before it can
	// tell whether an icon is still referenced.
	for _, icon := range evictedIcons {
		h.store.removeUnusedIconFile(icon)
	}

	h.store.RecordInboxEvent(InboxEvent{
		Type:   inboxEventAdded,
		Source: created.Source,
		AtMs:   created.AddedAt,
	})

	// Respond immediately; enrich preview metadata asynchronously.
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "success",
		"item":   created,
	})
	h.enrichInboxPreviewAsync(created.ID, url)
}

// inboxItemNeedsIconFetch reports whether the startup backfill should try to
// fetch a favicon for this item.
//
// Extracted from the loop rather than written inline so the rule can be tested
// without a network fetch: the loop itself downloads from the item's own host,
// which a test cannot drive. Keeping the decision here means the test binds to
// the code that actually runs instead of a copy of it.
//
// IconFetchedAt is the part worth stating. It records that an attempt happened,
// not that one succeeded — plenty of sites simply have no favicon, and without
// this the same doomed fetches re-ran on every restart for the life of the item.
func inboxItemNeedsIconFetch(item InboxLink) bool {
	if strings.TrimSpace(item.Icon) != "" || strings.TrimSpace(item.URL) == "" {
		return false
	}
	return item.IconFetchedAt == 0
}

// backfillInboxIconsAsync fetches favicons for existing inbox items that predate
// icon storage (added before Icon was a field, or whose enrichment ran without it).
// Runs once at startup, off the request path, and mirrors the bookmark icon
// prefetch: bounded, best-effort, and silent when there is nothing to do.
func (h *Handlers) backfillInboxIconsAsync() {
	if os.Getenv("NEXTDASH_DISABLE_PREFETCH") == "1" {
		return
	}
	go func() {
		items := h.store.GetInboxItems()
		allowLocal := h.allowLocalBookmarks()
		applied := 0
		for _, item := range items {
			if !inboxItemNeedsIconFetch(item) {
				continue
			}
			iconFile := ""
			if fallback := deriveFaviconURL(item.URL); fallback != "" {
				if name, err := downloadIconFromURL(fallback, allowLocal); err == nil {
					iconFile = name
				}
			}
			id := item.ID
			file := iconFile
			attemptedAt := time.Now().UnixMilli()
			// Stamped whether or not the fetch produced a file: the stamp records
			// that the attempt happened, which is exactly what a failure needs to
			// leave behind. A success stamps it too, so the field always means
			// "last attempted" rather than "last failed".
			if _, err := h.store.UpdateInboxLink(id, func(link *InboxLink) error {
				// Re-check under the store lock: another path may have set it since.
				if file != "" && strings.TrimSpace(link.Icon) == "" {
					link.Icon = file
				}
				link.IconFetchedAt = attemptedAt
				return nil
			}); err == nil && file != "" {
				applied++
			}
		}
		if applied > 0 {
			log.Printf("nextDash: backfilled favicons for %d inbox items", applied)
		}
	}()
}

func (h *Handlers) enrichInboxPreviewAsync(itemID, url string) {
	itemID = strings.TrimSpace(itemID)
	url = strings.TrimSpace(url)
	if itemID == "" || url == "" {
		return
	}
	go func() {
		preview := h.fetchBookmarkPreview(context.Background(), url, &PreviewCacheFile{Cache: map[string]BookmarkPreview{}}, true)

		// Download and store the site favicon so the inbox shows the real icon like
		// the health view, not just a link glyph. Prefers the preview's icon URL,
		// falling back to the domain's /favicon.ico; the result is a filename served
		// from /data/icons/ (same store as bookmark icons).
		allowLocal := h.allowLocalBookmarks()
		iconFile := ""
		if iconURL := strings.TrimSpace(preview.Icon); iconURL != "" {
			if name, err := downloadIconFromURL(iconURL, allowLocal); err == nil {
				iconFile = name
			}
		}
		if iconFile == "" {
			if fallback := deriveFaviconURL(url); fallback != "" {
				if name, err := downloadIconFromURL(fallback, allowLocal); err == nil {
					iconFile = name
				}
			}
		}

		// Even when nothing was found, the icon attempt is recorded below so the
		// startup backfill does not retry this item forever. Returning early
		// here would leave IconFetchedAt unset and hand the retry loop straight
		// back to the backfill.
		if strings.TrimSpace(preview.Title) == "" && strings.TrimSpace(preview.Image) == "" && iconFile == "" {
			_, _ = h.store.UpdateInboxLink(itemID, func(item *InboxLink) error {
				item.IconFetchedAt = time.Now().UnixMilli()
				return nil
			})
			return
		}
		_, _ = h.store.UpdateInboxLink(itemID, func(item *InboxLink) error {
			if strings.TrimSpace(preview.Title) != "" {
				item.PreviewTitle = preview.Title
				if strings.TrimSpace(item.Title) == "" || item.Title == item.Domain {
					item.Title = preview.Title
				}
			}
			if strings.TrimSpace(preview.Description) != "" {
				item.PreviewDesc = preview.Description
			}
			if strings.TrimSpace(preview.Image) != "" {
				item.PreviewImage = preview.Image
			}
			if strings.TrimSpace(preview.Domain) != "" {
				item.Domain = preview.Domain
			}
			if iconFile != "" {
				item.Icon = iconFile
			}
			item.IconFetchedAt = time.Now().UnixMilli()
			return nil
		})
	}()
}

func (h *Handlers) PutInboxItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		Item InboxLink `json:"item"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Restore is a client-supplied write of a whole InboxLink, so it has to clear
	// the same bar as AddInboxItem. Without this it was the one way to store a
	// URL the add path refuses — javascript:, or a private address under
	// allowLocalBookmarks:false — and the only path where a client could set Icon,
	// which otherwise only server-side fetch code writes.
	restoredURL := strings.TrimSpace(request.Item.URL)
	if restoredURL == "" {
		http.Error(w, "URL is required", http.StatusBadRequest)
		return
	}
	if err := h.validateBookmarkURL(restoredURL); err != nil {
		http.Error(w, fmt.Sprintf("Invalid URL: %v", err), http.StatusBadRequest)
		return
	}
	request.Item.URL = restoredURL
	request.Item.Icon = sanitizeBookmarkIcon(request.Item.Icon)

	settings := h.store.GetSettings()
	maxItems := settings.InboxMaxItems
	if maxItems <= 0 {
		maxItems = 500
	}

	restored, err := h.store.RestoreInboxLink(request.Item, maxItems)
	if err != nil {
		// A full inbox is not a server fault: nothing broke, there is simply no
		// room. Answered as 409 so the client can tell the user why undo did
		// nothing instead of showing a generic failure — or worse, the silent
		// success this used to report.
		if errors.Is(err, ErrInboxAtCapacity) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "at_capacity",
				"message": "Inbox is full",
			})
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		http.Error(w, "Failed to restore inbox item", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "success",
		"item":   restored,
	})
}

func (h *Handlers) DeleteInboxItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}

	// Capture the item before deletion so we can attribute the event (promote vs
	// discard) and compute retention. Promote intent lives in the frontend, which
	// passes ?reason=promote when a delete follows a bookmark conversion.
	var deleted *InboxLink
	for _, item := range h.store.GetInboxItems() {
		if item.ID == id {
			copy := item
			deleted = &copy
			break
		}
	}

	if err := h.store.DeleteInboxLink(id); err != nil {
		if errors.Is(err, ErrInboxItemNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		http.Error(w, "Failed to delete inbox item", http.StatusInternalServerError)
		return
	}

	// The item is gone; remove its favicon file if nothing else uses it. Promote
	// does not carry the icon over — the new bookmark fetches its own — so a
	// promoted item's icon is orphaned just like a discarded one. Runs after the
	// delete so the just-removed item no longer counts as a reference.
	if deleted != nil {
		h.store.removeUnusedIconFile(deleted.Icon)
	}

	eventType := inboxEventDeleted
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("reason")), "promote") {
		eventType = inboxEventPromoted
	}
	var retentionMs int64
	if deleted != nil && deleted.AddedAt > 0 {
		if elapsed := time.Now().UnixMilli() - deleted.AddedAt; elapsed > 0 {
			retentionMs = elapsed
		}
	}
	source := ""
	if deleted != nil {
		source = deleted.Source
	}
	h.store.RecordInboxEvent(InboxEvent{
		Type:        eventType,
		Source:      source,
		RetentionMs: retentionMs,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) PatchInboxItem(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		ID           string `json:"id"`
		Title        string `json:"title"`
		Note         string `json:"note"`
		ReadAt       *int64 `json:"readAt"`
		SnoozedUntil *int64 `json:"snoozedUntil"`
		PreviewTitle string `json:"previewTitle"`
		PreviewDesc  string `json:"previewDesc"`
		PreviewImage string `json:"previewImage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	id := strings.TrimSpace(request.ID)
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}

	// An empty string is indistinguishable from "field not sent" on a JSON
	// struct, so each clearable text field gets an explicit opt-in, matching the
	// clearNote=1 convention this endpoint already used for notes. Without them
	// a field can be set but never emptied again.
	clearing := func(param string) bool {
		return r.URL.Query().Get(param) == "1"
	}
	clearTitle := clearing("clearTitle")
	clearNote := clearing("clearNote")
	clearPreview := clearing("clearPreview")

	markedRead := false
	updated, err := h.store.UpdateInboxLink(id, func(item *InboxLink) error {
		if request.Title != "" || clearTitle {
			item.Title = strings.TrimSpace(request.Title)
			// A title is never left blank on a stored item: the list would show
			// an empty row. Falls back the same way AddInboxLink does.
			if item.Title == "" {
				if item.Domain != "" {
					item.Title = item.Domain
				} else {
					item.Title = item.URL
				}
			}
		}
		if request.Note != "" || clearNote {
			item.Note = strings.TrimSpace(request.Note)
		}
		if request.ReadAt != nil {
			// "Kept" = read but retained in the inbox (as opposed to triaged away).
			// Record only the unread → read transition to avoid double-counting.
			if item.ReadAt == 0 && *request.ReadAt != 0 {
				markedRead = true
			}
			// Clamped like SnoozedUntil below, and for the same reason: a
			// negative or absurd future timestamp is not a state the UI can
			// represent. Anything non-zero means read, so a bad value is stored
			// as "read, now" rather than kept verbatim to corrupt the read/unread
			// reconciliation the client does against this field.
			switch {
			case *request.ReadAt <= 0:
				item.ReadAt = 0
			case *request.ReadAt > time.Now().UnixMilli():
				item.ReadAt = time.Now().UnixMilli()
			default:
				item.ReadAt = *request.ReadAt
			}
		}
		if request.SnoozedUntil != nil {
			// A pointer lets a client clear a snooze by sending 0. Negative or past
			// values collapse to 0 (not snoozed) so a stale timestamp can't wedge an
			// item out of view.
			if *request.SnoozedUntil > time.Now().UnixMilli() {
				item.SnoozedUntil = *request.SnoozedUntil
			} else {
				item.SnoozedUntil = 0
			}
		}
		// The three preview fields share one flag: they are enrichment output
		// written together, and clearing one while keeping the others would
		// leave a card describing a page it no longer matches.
		if request.PreviewTitle != "" || clearPreview {
			item.PreviewTitle = strings.TrimSpace(request.PreviewTitle)
		}
		if request.PreviewDesc != "" || clearPreview {
			item.PreviewDesc = strings.TrimSpace(request.PreviewDesc)
		}
		if request.PreviewImage != "" || clearPreview {
			item.PreviewImage = strings.TrimSpace(request.PreviewImage)
		}
		// Bounded here as well as on add: a patch is a client write like any
		// other, and inbox.json is rewritten whole on every mutation.
		clampInboxLinkFields(item)
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrInboxItemNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		http.Error(w, "Failed to update inbox item", http.StatusInternalServerError)
		return
	}

	if markedRead {
		h.store.RecordInboxEvent(InboxEvent{
			Type:   inboxEventKept,
			Source: updated.Source,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "success",
		"item":   updated,
	})
}

// GetInboxStats returns the durable inbox aggregate (lifetime counters + daily
// throughput buckets) for the Config → Stats page.
func (h *Handlers) GetInboxStats(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	stats := h.store.GetInboxStats()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
