package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDeleteBookmarkFromPageMatchesCanonicalURLWithoutName(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Google", URL: "https://google.com"},
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	if err := store.DeleteBookmarkFromPage(1, Bookmark{
		Name: "Renamed in client only",
		URL:  "https://google.com/",
	}); err != nil {
		t.Fatalf("delete: %v", err)
	}

	remaining := store.GetBookmarksByPage(1)
	if len(remaining) != 0 {
		t.Fatalf("len = %d, want 0", len(remaining))
	}
}

// DeleteBookmarkFromPage used to write with a raw writeFileAtomic call instead
// of the fs.writeStoreJSONFile helper every other mutator uses, so it never
// called noteDataMutation() and never invalidated storeReadCache. A caller
// that had already read the page (priming the cache) would keep seeing the
// deleted bookmark until some unrelated write anywhere in the store happened
// to flush the whole cache.
func TestDeleteBookmarkFromPageInvalidatesReadCache(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	if err := store.SaveBookmarksByPage(1, []Bookmark{
		{Name: "Google", URL: "https://google.com"},
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	// Prime the read cache the way a normal GET /api/bookmarks would.
	if got := store.GetBookmarksByPage(1); len(got) != 1 {
		t.Fatalf("priming read: len = %d, want 1", len(got))
	}

	if err := store.DeleteBookmarkFromPage(1, Bookmark{
		Name: "Google",
		URL:  "https://google.com",
	}); err != nil {
		t.Fatalf("delete: %v", err)
	}

	remaining := store.GetBookmarksByPage(1)
	if len(remaining) != 0 {
		t.Fatalf("len = %d, want 0 — deleted bookmark is still served from a stale cache", len(remaining))
	}
}

func TestDeleteBookmarkHandlerReturns404WhenMissing(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body, _ := json.Marshal(map[string]any{
		"page": 1,
		"bookmark": Bookmark{
			Name: "Missing",
			URL:  "https://example.com",
		},
	})
	req := httptest.NewRequest(http.MethodDelete, "/api/bookmarks", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.DeleteBookmark(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}
