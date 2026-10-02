package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBookmarksNeedingIconsSkipsInvalidAndExisting(t *testing.T) {
	bookmarks := []Bookmark{
		{Name: "Has icon", URL: "https://github.com", Icon: "icon-a.png"},
		{Name: "Missing", URL: "https://google.com"},
		{Name: "Empty URL", URL: "  "},
		{Name: "Bad scheme", URL: "ftp://github.com"},
	}
	pending := bookmarksNeedingIcons(bookmarks, false)
	if len(pending) != 1 {
		t.Fatalf("expected 1 pending bookmark, got %d", len(pending))
	}
	if pending[0].url != "https://google.com" {
		t.Fatalf("unexpected pending url %q", pending[0].url)
	}
}

func TestPrefetchBookmarkIconsCountOnly(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	// NewStore reads ResolveDataDir(), which TestMain sets once for the whole
	// suite -- so without this the count includes whatever every other test
	// happened to add.
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	existing := len(bookmarksNeedingIcons(store.GetBookmarksByPage(1), false))
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Extra", URL: "https://stackoverflow.com"}); err != nil {
		t.Fatal(err)
	}
	want := existing + 1

	h := &Handlers{store: store}
	result := h.prefetchBookmarkIconsBatch(1, 4, true, false, 0)
	if result.Total != want || result.Remaining != want || result.Done {
		t.Fatalf("countOnly result = %+v, want total=%d remaining=%d done=false", result, want, want)
	}
	if result.Attempted != 0 || result.Applied != 0 {
		t.Fatalf("countOnly should not attempt fetches: %+v", result)
	}
}

func TestPrefetchBookmarkIconsHandlerRequiresPageID(t *testing.T) {
	h := &Handlers{store: NewStore()}
	body := strings.NewReader(`{"pageId":0}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/prefetch-icons", body)
	rec := httptest.NewRecorder()
	h.PrefetchBookmarkIcons(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPrefetchBookmarkIconsHandlerCountOnlyJSON(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	want := len(bookmarksNeedingIcons(store.GetBookmarksByPage(1), false))

	h := &Handlers{store: store}
	body := strings.NewReader(`{"pageId":1,"countOnly":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/prefetch-icons", body)
	rec := httptest.NewRecorder()
	h.PrefetchBookmarkIcons(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var result prefetchIconsBatchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Total != want || result.Remaining != want {
		t.Fatalf("unexpected result %+v, want total=%d", result, want)
	}
}

// A bookmark the icon sets know shows its set icon: the background fill does
// not count it as missing (or the batches would never run out), and Refresh
// all drops the favicon it had so the set icon shows instead.
func TestPrefetchBookmarkIconsLeavesSetIconsToTheSets(t *testing.T) {
	useIconSetsFixture(t) // before the Chdir: it resolves testdata/
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	before := len(bookmarksNeedingIcons(store.GetBookmarksByPage(1), false))
	for _, b := range []Bookmark{
		{Name: "Sonarr", URL: "https://sonarr.home.example.lan"},
		{Name: "Radarr", URL: "https://radarr.home.example.lan", Icon: "icon-0123456789abcdef.png"},
	} {
		if err := store.AddBookmarkToPage(1, b); err != nil {
			t.Fatal(err)
		}
	}
	h := &Handlers{store: store}
	count := h.prefetchBookmarkIconsBatch(1, 4, true, false, 0)
	if count.Total != before {
		t.Fatalf("a set-icon bookmark counted as missing: total %d, want %d", count.Total, before)
	}

	// Refresh all: radarr's old favicon goes; nothing is fetched for either.
	all := h.prefetchBookmarkIconsBatch(1, 500, true, true, 0)
	res := h.prefetchBookmarkIconsBatch(1, all.Total, false, true, 0)
	if res.Applied < 1 {
		t.Fatalf("refresh all applied nothing: %+v", res)
	}
	for _, b := range store.GetBookmarksByPage(1) {
		if strings.Contains(b.URL, ".home.example.lan") && b.Icon != "" {
			t.Fatalf("%s kept icon %q", b.URL, b.Icon)
		}
	}
}
