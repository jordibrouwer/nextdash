package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

/*
The API in front of a page's blocks.

Two routes and one shape: what widgets a page has, and the order every block on
it is drawn in. The order carries category ids too, which is the point -- a
widget that could only be ordered among widgets could never sit between two
categories, which is the whole feature.
*/

// PageBlocksResponse is what both routes answer with.
type PageBlocksResponse struct {
	PageID  int      `json:"pageId"`
	Widgets []Widget `json:"widgets"`
	// Order is every block on the page, category ids and widget ids together,
	// already resolved -- a caller can draw it without knowing the fallback
	// rules.
	Order []string `json:"order"`
}

func pageIDFromRequest(r *http.Request) (int, bool) {
	raw := strings.TrimSpace(mux.Vars(r)["id"])
	if raw == "" {
		raw = strings.TrimSpace(r.URL.Query().Get("page"))
	}
	pageID, err := strconv.Atoi(raw)
	if err != nil || pageID <= 0 {
		return 0, false
	}
	return pageID, true
}

// GetPageBlocksHandler answers GET /api/pages/{id}/blocks.
func (h *Handlers) GetPageBlocksHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	pageID, ok := pageIDFromRequest(r)
	if !ok {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgets, order := h.store.GetPageBlocks(pageID)
	if widgets == nil {
		widgets = []Widget{}
	}
	writeJSON(w, PageBlocksResponse{PageID: pageID, Widgets: widgets, Order: order})
}

/*
SavePageBlocksHandler answers PUT /api/pages/{id}/blocks.

Takes both halves at once. A drag changes the order and nothing else; adding a
widget changes both -- and sending them separately means a window where the
order names a widget that is not stored yet, which is exactly when a reload
would drop it.
*/
func (h *Handlers) SavePageBlocksHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, ok := pageIDFromRequest(r)
	if !ok {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	var body struct {
		// Pointers so "not sent" and "sent empty" are different things: a drag
		// sends only the order, and treating its absent widget list as an empty
		// one would delete every widget on the page.
		Widgets *[]Widget `json:"widgets"`
		Order   *[]string `json:"order"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	current, currentOrder := h.store.GetPageBlocks(pageID)
	widgets := current
	if body.Widgets != nil {
		widgets = *body.Widgets
	}
	order := currentOrder
	if body.Order != nil {
		order = *body.Order
	}

	if err := h.store.SavePageBlocks(pageID, widgets, order); err != nil {
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	savedWidgets, savedOrder := h.store.GetPageBlocks(pageID)
	if savedWidgets == nil {
		savedWidgets = []Widget{}
	}
	// The resolved order back, so a caller that sent a stale one sees what was
	// actually stored rather than assuming its own version took.
	writeJSON(w, PageBlocksResponse{PageID: pageID, Widgets: savedWidgets, Order: savedOrder})
}
