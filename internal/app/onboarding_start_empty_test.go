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
