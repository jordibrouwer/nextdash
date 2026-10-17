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
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

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

// A batch where every fetch fails must not end the round: with a hundred
// starter links, the ones after it would never get an icon.
func TestPrefetchDefaultIconsStepsPastAFailedBatch(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer dead.Close()
	// A 1x1 PNG, served for every path.
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82}
	live := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
	}))
	defer live.Close()

	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	store := NewStore()
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	for _, b := range store.GetBookmarksByPage(1) {
		_ = store.DeleteBookmarkFromPage(1, b)
	}
	// More dead links than one batch holds, then one that works.
	for i := 0; i < 10; i++ {
		if err := store.AddBookmarkToPage(1, Bookmark{Name: "Dead", URL: dead.URL + "/" + string(rune('a'+i))}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Live", URL: live.URL + "/"}); err != nil {
		t.Fatal(err)
	}

	(&Handlers{store: store}).prefetchDefaultBookmarkIcons()

	for _, b := range store.GetBookmarksByPage(1) {
		if b.Name == "Live" && b.Icon == "" {
			t.Error("the link after a batch of dead ones got no icon")
		}
	}
}
