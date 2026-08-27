package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestPrefetchDefaultIconsTerminatesOnUnfetchable guards against a busy-loop
// regression: prefetchDefaultBookmarkIcons must stop when a batch makes no
// progress, instead of spinning forever on bookmarks whose favicon can never be
// fetched (dead URL, timeout, blocked outbound). Before the fix this hung and
// pinned CPU; the test asserts the call returns promptly.
func TestPrefetchDefaultIconsTerminatesOnUnfetchable(t *testing.T) {
	// A server that 404s everything — both the page and /favicon.ico — so the
	// icon fetch always fails fast (no external DNS/timeout involved).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()

	tmp := t.TempDir()
	t.Chdir(tmp)

	store := NewStore()

	// Allow localhost bookmarks so the httptest URL passes SSRF validation.
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	// Replace page 1's bookmarks so ALL of them are unfetchable. Any bookmark
	// that already had a fetchable icon would mask the regression.
	for _, b := range store.GetBookmarksByPage(1) {
		_ = store.DeleteBookmarkFromPage(1, b)
	}
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Dead", URL: srv.URL}); err != nil {
		t.Fatal(err)
	}

	h := &Handlers{store: store}

	done := make(chan struct{})
	go func() {
		h.prefetchDefaultBookmarkIcons()
		close(done)
	}()

	select {
	case <-done:
		// Returned — loop terminated correctly.
	case <-time.After(20 * time.Second):
		t.Fatal("prefetchDefaultBookmarkIcons did not terminate — busy-loop regression")
	}
}
