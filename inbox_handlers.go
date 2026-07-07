package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
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

	// Best-effort preview enrichment (non-blocking for response if slow — sync for MVP).
	preview := h.fetchBookmarkPreview(r.Context(), url, &PreviewCacheFile{Cache: map[string]BookmarkPreview{}}, true)
	if strings.TrimSpace(preview.Title) != "" || strings.TrimSpace(preview.Image) != "" {
		updated, updateErr := h.store.UpdateInboxLink(created.ID, func(item *InboxLink) error {
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
		if updateErr == nil {
			created = updated
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "success",
		"item":   created,
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

	updated, err := h.store.UpdateInboxLink(id, func(item *InboxLink) error {
		if request.Title != "" {
			item.Title = strings.TrimSpace(request.Title)
		}
		if request.Note != "" || r.URL.Query().Get("clearNote") == "1" {
			item.Note = strings.TrimSpace(request.Note)
		}
		if request.ReadAt != nil {
			item.ReadAt = *request.ReadAt
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

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status": "success",
		"item":   updated,
	})
}
