package app

import (
	"encoding/json"
	"net/http"
)

/*
The empty places on a dashboard: categories nothing is filed under, and pages
with no categories and no widgets.

The checkup round (static/js/checkup.js) walks through these beside the
bookmarks the Health report already lists. They are not bookmarks, so Health
cannot show them; and they are cheap to find, so they are computed on request
and stored nowhere.
*/

// EmptyStructure is one empty category or page.
type EmptyStructure struct {
	Kind         string `json:"kind"` // "category" or "page"
	PageID       int    `json:"pageId"`
	PageName     string `json:"pageName,omitempty"`
	CategoryID   string `json:"categoryId,omitempty"`
	CategoryName string `json:"categoryName,omitempty"`
}

/*
findEmptyStructure lists the empty categories and pages.

A category is empty when no bookmark on its page is filed under its id; a
bookmark that is ignored, snoozed or unchecked is still in it. A page is empty
when it has no categories and no widgets, so a page of widgets only is not
empty, and a page whose categories are all empty lists those categories rather
than itself. The reserved Unsorted page is never reported: it is hidden and has
no categories of its own.
*/
func findEmptyStructure(pages []PageWithBookmarks, bookmarks map[int][]Bookmark) []EmptyStructure {
	var out []EmptyStructure
	for _, page := range pages {
		if page.Page.Hidden || page.Page.ID == unsortedPageID {
			continue
		}
		if len(page.Categories) == 0 && len(page.Widgets) == 0 {
			out = append(out, EmptyStructure{Kind: "page", PageID: page.Page.ID, PageName: page.Page.Name})
			continue
		}
		filed := map[string]bool{}
		for _, bookmark := range bookmarks[page.Page.ID] {
			filed[bookmark.Category] = true
		}
		for _, category := range page.Categories {
			if !filed[category.ID] {
				out = append(out, EmptyStructure{
					Kind: "category", PageID: page.Page.ID, PageName: page.Page.Name,
					CategoryID: category.ID, CategoryName: category.Name,
				})
			}
		}
	}
	return out
}

// CheckupStructure answers GET /api/checkup/structure.
func (h *Handlers) CheckupStructure(w http.ResponseWriter, r *http.Request) {
	var pages []PageWithBookmarks
	bookmarks := map[int][]Bookmark{}
	for _, page := range h.store.GetPages() {
		widgets, _ := h.store.GetPageBlocks(page.ID)
		pages = append(pages, PageWithBookmarks{Page: page, Categories: h.store.GetCategoriesByPage(page.ID), Widgets: widgets})
		bookmarks[page.ID] = h.store.GetBookmarksByPage(page.ID)
	}
	items := findEmptyStructure(pages, bookmarks)
	if items == nil {
		items = []EmptyStructure{}
	}
	// The widgets that exist, so the checkup can leave out one the dashboard
	// reported on and that has been deleted since.
	widgetIDs := []string{}
	for _, page := range pages {
		for _, widget := range page.Widgets {
			widgetIDs = append(widgetIDs, widget.ID)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items, "widgetIds": widgetIDs})
}
