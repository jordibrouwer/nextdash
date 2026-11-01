package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A page move made in the same edit as a URL change: the source row still
// holds the shortcut under its old address until the delete that follows,
// and with movedFrom it does not count against itself. Another bookmark's
// shortcut still does.
func TestAMoveWithANewURLKeepsItsShortcut(t *testing.T) {
	h := newTestHandlers(t)
	if err := h.store.SavePage(Page{ID: 2, Name: "Two"}); err != nil {
		t.Fatal(err)
	}
	if err := h.store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "GH", URL: "https://github.com/old", Shortcut: "gh"},
		{Name: "GL", URL: "https://gitlab.com", Shortcut: "gl"},
	}); err != nil {
		t.Fatal(err)
	}
	add := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.AddBookmark(rec, httptest.NewRequest(http.MethodPost, "/api/bookmarks/add", strings.NewReader(body)))
		return rec
	}
	moved := `{"page":2,"allowDuplicate":true,"movedFrom":"https://github.com/old",
		"bookmark":{"name":"GH","url":"https://github.com/new","shortcut":"gh"}}`
	if rec := add(moved); rec.Code != http.StatusOK {
		t.Fatalf("move with a new URL refused: %d %s", rec.Code, rec.Body)
	}
	stolen := `{"page":2,"allowDuplicate":true,"movedFrom":"https://github.com/old",
		"bookmark":{"name":"X","url":"https://x.example","shortcut":"gl"}}`
	if rec := add(stolen); rec.Code != http.StatusConflict {
		t.Fatalf("another bookmark's shortcut was taken: %d %s", rec.Code, rec.Body)
	}
}
