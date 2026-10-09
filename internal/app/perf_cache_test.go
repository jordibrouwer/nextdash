package app

import (
	"bytes"
	"compress/gzip"
	"io"
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

// The stylesheet is kept between requests; a saved colour has to reach it.
func TestThemeCSSFollowsASavedColour(t *testing.T) {
	h := themeCSSTestHandlers(t)
	before := h.customThemeCSS()
	beforeURL := h.themeCSSURL()

	colors := h.store.GetColors()
	if colors.Custom == nil {
		colors.Custom = map[string]ThemeColors{}
	}
	colors.Custom["perf-cache-probe"] = colors.Dark
	if err := h.store.SaveColors(colors); err != nil {
		t.Fatal(err)
	}

	after := h.customThemeCSS()
	if after == before || !strings.Contains(after, "perf-cache-probe") {
		t.Fatal("a saved custom theme is missing from the stylesheet the page gets")
	}
	if h.themeCSSURL() == beforeURL {
		t.Fatal("the stylesheet changed but its address did not, so a browser keeps the old one")
	}
}

/*
The bundles are compressed once rather than on every request. What a gzip
client gets must decode to exactly what any other client gets.
*/
func TestBundleIsServedPrecompressed(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	bundleWorkdir(t, ".probe{color:red}")
	h := NewHandlers(NewStore(), nil)

	plain := httptest.NewRecorder()
	h.ServeAssetBundle(plain, httptest.NewRequest("GET", bundleViewCSSPath, nil))

	zipped := httptest.NewRecorder()
	req := httptest.NewRequest("GET", bundleViewCSSPath, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	h.ServeAssetBundle(zipped, req)

	if got := zipped.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	zr, err := gzip.NewReader(bytes.NewReader(zipped.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, plain.Body.Bytes()) || !bytes.Contains(decoded, []byte(".probe{color:red}")) {
		t.Fatalf("decoded bundle differs from the plain one:\n%q\n%q", decoded, plain.Body.Bytes())
	}
}
