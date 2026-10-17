package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// Start empty takes the starter links off an untouched main page and keeps
// its widgets; on a main page somebody changed it does nothing.
func TestStartEmptyClearsUntouchedMain(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	widgets := len(defaultMainPage().Widgets)
	rec := httptest.NewRecorder()
	h.StartEmptyOnboarding(rec, httptest.NewRequest("POST", "/api/onboarding/start-empty", strings.NewReader("{}")))
	if rec.Code != 200 {
		t.Fatalf("start-empty: %d %s", rec.Code, rec.Body.String())
	}
	if n := len(h.store.GetBookmarksByPage(1)); n != 0 {
		t.Fatalf("main still holds %d links", n)
	}
	if n := len(h.store.GetCategoriesByPage(1)); n != 0 {
		t.Fatalf("main still holds %d categories", n)
	}
	page, _ := h.readTemplatePage(1)
	if len(page.Widgets) != widgets {
		t.Fatalf("widgets = %d, want %d", len(page.Widgets), widgets)
	}

	// Main is no longer the starter page: a second call leaves it alone.
	if err := h.store.AddBookmarkToPage(1, Bookmark{Name: "Mine", URL: "https://mine.example"}); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	h.StartEmptyOnboarding(rec, httptest.NewRequest("POST", "/api/onboarding/start-empty", strings.NewReader("{}")))
	if rec.Code != 409 || len(h.store.GetBookmarksByPage(1)) != 1 {
		t.Fatalf("a changed main page was cleared: %d, %d links", rec.Code, len(h.store.GetBookmarksByPage(1)))
	}
}

// With the demo seed, start empty takes the untouched news page away too: an
// empty start with a second page of links is not empty.
func TestStartEmptyRemovesTheUntouchedNewsPage(t *testing.T) {
	useDemoSeed(t)
	h := newTestHandlers(t)
	if err := h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.StartEmptyOnboarding(rec, httptest.NewRequest("POST", "/api/onboarding/start-empty", strings.NewReader("{}")))
	if rec.Code != 200 {
		t.Fatalf("start-empty: %d %s", rec.Code, rec.Body.String())
	}
	if pages := h.store.GetPages(); len(pages) != 1 || pages[0].ID != 1 {
		t.Fatalf("pages = %+v, want main alone", pages)
	}
	if order := h.store.GetPageOrder(); len(order) != 1 || order[0] != 1 {
		t.Fatalf("page order = %v, want [1]", order)
	}
}

// A news page somebody changed is theirs: start empty leaves it.
func TestStartEmptyKeepsAChangedNewsPage(t *testing.T) {
	useDemoSeed(t)
	h := newTestHandlers(t)
	if err := h.store.ResetAllData(); err != nil {
		t.Fatal(err)
	}
	if err := h.store.AddBookmarkToPage(defaultNewsPageID, Bookmark{Name: "Mine", URL: "https://mine.example", Category: "technews"}); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.StartEmptyOnboarding(rec, httptest.NewRequest("POST", "/api/onboarding/start-empty", strings.NewReader("{}")))
	if rec.Code != 200 {
		t.Fatalf("start-empty: %d %s", rec.Code, rec.Body.String())
	}
	if n := len(h.store.GetBookmarksByPage(defaultNewsPageID)); n != len(defaultNewsPage().Bookmarks)+1 {
		t.Fatalf("news page holds %d links, want it left as it was", n)
	}
}
