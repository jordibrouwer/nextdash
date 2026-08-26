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
	// Not behind the token, because the dashboard has to draw these. Narrowed
	// instead: see redactWidgetAddresses.
	if !hasWriteAccess(r) {
		widgets = redactWidgetAddresses(widgets)
	}
	writeJSON(w, PageBlocksResponse{PageID: pageID, Widgets: widgets, Order: order})
}

/*
redactWidgetAddresses drops the settings that are addresses rather than layout.

A custom widget's url is usually a LAN address and often carries a key in its
query string, and this route answers with Access-Control-Allow-Origin: * -- so
handing it back meant any page open in the reader's browser could ask for it.

Nothing on screen needs it. The tile fetches through /api/widgets/custom by
widget id precisely so the browser never holds the address, and the config
editor reads this route through writeFetch, which carries the token.

Copied rather than blanked in place: Config is the store's own map, and editing
it here would edit it for every later read as well.
*/
func redactWidgetAddresses(widgets []Widget) []Widget {
	out := make([]Widget, 0, len(widgets))
	for _, widget := range widgets {
		if widget.Type == WidgetTypeCustom && len(widget.Config) > 0 {
			narrowed := make(map[string]any, len(widget.Config))
			for key, value := range widget.Config {
				if key == "url" || key == "credentialId" {
					continue
				}
				narrowed[key] = value
			}
			widget.Config = narrowed
		}
		out = append(out, widget)
	}
	return out
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
	// Checked here rather than left to the store, which answers a missing file
	// with the same error a broken one gets: without this, a request naming a
	// page that was never created reads as a server fault, and every such
	// request would mint a block list nothing can ever draw.
	if !h.pageExists(pageID) {
		http.Error(w, "No such page", http.StatusNotFound)
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

	if !respondStorePersistError(w, h.store.SavePageBlocks(pageID, widgets, order)) {
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
