package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func themeCSSTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	return NewHandlers(NewStore(), nil)
}

func getThemeCSS(h *Handlers, query string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.CustomThemeCSS(rec, httptest.NewRequest("GET", "/api/theme.css"+query, nil))
	return rec
}

/*
The page links the theme stylesheet by the hash of its content. Only that exact
address may be cached for good: a refresh after a theme change, a stale hash and
a previewed backdrop roll all have to reach the server again.
*/
func TestThemeCSSIsImmutableOnlyUnderItsOwnHash(t *testing.T) {
	h := themeCSSTestHandlers(t)
	url := h.themeCSSURL()
	if !strings.HasPrefix(url, "/api/theme.css?v=") {
		t.Fatalf("themeCSSURL = %q", url)
	}
	query := strings.TrimPrefix(url, "/api/theme.css")

	if got := getThemeCSS(h, query).Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("own hash: Cache-Control = %q, want immutable", got)
	}
	for _, q := range []string{"", "?v=000000000000", "?t=1", query + "&seed=7"} {
		if got := getThemeCSS(h, q).Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
			t.Errorf("%q: Cache-Control = %q, want no-store", q, got)
		}
	}
}
