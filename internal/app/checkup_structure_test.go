package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func structurePage(id int, categories []Category, widgets []Widget) PageWithBookmarks {
	return PageWithBookmarks{Page: Page{ID: id, Name: "Page"}, Categories: categories, Widgets: widgets}
}

func TestFindEmptyStructureEmptyCategory(t *testing.T) {
	pages := []PageWithBookmarks{structurePage(1, []Category{{ID: "dev", Name: "Dev"}, {ID: "empty", Name: "Empty"}}, nil)}
	bookmarks := map[int][]Bookmark{1: {{Name: "A", URL: "https://a", Category: "dev"}}}
	got := findEmptyStructure(pages, bookmarks)
	if len(got) != 1 || got[0].Kind != "category" || got[0].CategoryID != "empty" || got[0].PageID != 1 || got[0].CategoryName != "Empty" {
		t.Fatalf("got %+v", got)
	}
}

func TestFindEmptyStructureHiddenBookmarksCountAsPresent(t *testing.T) {
	// A bookmark that is monitored but not shown, or snoozed, is still in the category.
	pages := []PageWithBookmarks{structurePage(1, []Category{{ID: "quiet", Name: "Quiet"}}, nil)}
	bookmarks := map[int][]Bookmark{1: {{Name: "Snoozed", URL: "https://s", Category: "quiet", HealthIgnored: []HealthIgnore{{Flag: "stale"}}}}}
	if got := findEmptyStructure(pages, bookmarks); len(got) != 0 {
		t.Fatalf("a category with an ignored bookmark is not empty: %+v", got)
	}
}

func TestFindEmptyStructureEmptyPage(t *testing.T) {
	pages := []PageWithBookmarks{structurePage(2, nil, nil)}
	got := findEmptyStructure(pages, nil)
	if len(got) != 1 || got[0].Kind != "page" || got[0].PageID != 2 {
		t.Fatalf("got %+v", got)
	}
}

func TestFindEmptyStructurePageWithOnlyWidgetsIsNotEmpty(t *testing.T) {
	pages := []PageWithBookmarks{structurePage(3, nil, []Widget{{ID: "w_x", Type: "notes"}})}
	if got := findEmptyStructure(pages, nil); len(got) != 0 {
		t.Fatalf("a page of widgets is not empty: %+v", got)
	}
}

func TestFindEmptyStructureSkipsTheHiddenUnsortedPage(t *testing.T) {
	pages := []PageWithBookmarks{{Page: Page{ID: unsortedPageID, Name: "Unsorted", Hidden: true}}}
	if got := findEmptyStructure(pages, nil); len(got) != 0 {
		t.Fatalf("the unsorted page is never reported: %+v", got)
	}
}

func TestFindEmptyStructureEmptyPageDoesNotAlsoListItsCategories(t *testing.T) {
	// A page with categories but no bookmarks lists the categories, not the page.
	pages := []PageWithBookmarks{structurePage(4, []Category{{ID: "a", Name: "A"}}, nil)}
	got := findEmptyStructure(pages, map[int][]Bookmark{})
	if len(got) != 1 || got[0].Kind != "category" {
		t.Fatalf("got %+v", got)
	}
}

func TestCheckupStructureHandlerListsTheWidgetIdsThatExist(t *testing.T) {
	h := newTestHandlers(t)
	fs := h.store.(*FileStore)
	if err := fs.SavePageBlocks(h.store.GetPages()[0].ID, []Widget{{ID: "w_exists", Type: "notes"}}, nil); err != nil {
		t.Fatalf("save widgets: %v", err)
	}
	rec := httptest.NewRecorder()
	h.CheckupStructure(rec, httptest.NewRequest("GET", "/api/checkup/structure", nil))
	if !strings.Contains(rec.Body.String(), `"widgetIds"`) || !strings.Contains(rec.Body.String(), "w_exists") {
		t.Fatalf("%s", rec.Body.String())
	}
}

func TestCheckupStructureHandlerAnswersAnItemsList(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	rec := httptest.NewRecorder()
	h.CheckupStructure(rec, httptest.NewRequest("GET", "/api/checkup/structure", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"items"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}
