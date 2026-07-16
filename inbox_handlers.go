package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	url := strings.TrimSpace(request.URL)
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
	}

	created, err := h.store.AddInboxLink(link, dedupe, maxItems)
	if err != nil {
		if errors.Is(err, ErrInboxDuplicateURL) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":   "duplicate_url",
				"message": "URL already in inbox",
				"item":    created,
			})
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		http.Error(w, "Failed to save inbox item", http.StatusInternalServerError)
		return
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

func (h *Handlers) enrichInboxPreviewAsync(itemID, url string) {
	itemID = strings.TrimSpace(itemID)
	url = strings.TrimSpace(url)
	if itemID == "" || url == "" {
		return
	}
	go func() {
		preview := h.fetchBookmarkPreview(context.Background(), url, &PreviewCacheFile{Cache: map[string]BookmarkPreview{}}, true)
		if strings.TrimSpace(preview.Title) == "" && strings.TrimSpace(preview.Image) == "" {
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

	settings := h.store.GetSettings()
	maxItems := settings.InboxMaxItems
	if maxItems <= 0 {
		maxItems = 500
	}

	restored, err := h.store.RestoreInboxLink(request.Item, maxItems)
	if err != nil {
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

	markedRead := false
	updated, err := h.store.UpdateInboxLink(id, func(item *InboxLink) error {
		if request.Title != "" {
			item.Title = strings.TrimSpace(request.Title)
		}
		if request.Note != "" || r.URL.Query().Get("clearNote") == "1" {
			item.Note = strings.TrimSpace(request.Note)
		}
		if request.ReadAt != nil {
			// "Kept" = read but retained in the inbox (as opposed to triaged away).
			// Record only the unread → read transition to avoid double-counting.
			if item.ReadAt == 0 && *request.ReadAt != 0 {
				markedRead = true
			}
			item.ReadAt = *request.ReadAt
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
		if request.PreviewTitle != "" {
			item.PreviewTitle = strings.TrimSpace(request.PreviewTitle)
		}
		if request.PreviewDesc != "" {
			item.PreviewDesc = strings.TrimSpace(request.PreviewDesc)
		}
		if request.PreviewImage != "" {
			item.PreviewImage = strings.TrimSpace(request.PreviewImage)
		}
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
