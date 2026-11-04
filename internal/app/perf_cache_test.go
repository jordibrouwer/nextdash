package app

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
	"strconv"
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
	for _, q := range []string{"", "?v=000000000000", "?t=1"} {
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
The same themes are the same bytes. Custom themes came out in map order, so
with two or more of them every re-render -- after any data write -- gave the
stylesheet a new hash and the browser a new 600 KB download.
*/
func TestThemeCSSSameThemesSameBytes(t *testing.T) {
	h := themeCSSTestHandlers(t)
	colors := h.store.GetColors()
	if colors.Custom == nil {
		colors.Custom = map[string]ThemeColors{}
	}
	for _, id := range []string{"probe-a", "probe-b", "probe-c", "probe-d", "probe-e", "probe-f"} {
		colors.Custom[id] = colors.Dark
	}
	if err := h.store.SaveColors(colors); err != nil {
		t.Fatal(err)
	}
	first := h.renderThemeCSS(1, neutralAccentTheme)
	for i := 0; i < 20; i++ {
		if h.renderThemeCSS(1, neutralAccentTheme) != first {
			t.Fatal("the same themes rendered to different bytes, so the hashed address keeps moving")
		}
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

/*
The stylesheet the page links is every theme's colours and none of their
backdrops. They were 8 of its 9 MB, for 386 themes of which one is on screen;
they come per theme from scope=backdrop instead.
*/
func TestThemeCSSCarriesNoBackdrops(t *testing.T) {
	h := themeCSSTestHandlers(t)
	tokens := h.customThemeCSS()
	if strings.Contains(tokens, "--theme-backdrop") || strings.Contains(tokens, "data-backdrop-recipe") {
		t.Fatal("the linked theme stylesheet still carries backdrops")
	}
	if !strings.Contains(tokens, `html[data-theme="dark"]`) || !strings.Contains(tokens, "--accent-primary") {
		t.Fatal("the linked theme stylesheet lost the colours")
	}
	if full := h.renderThemeCSS(0, neutralAccentTheme); len(tokens)*4 > len(full) {
		t.Errorf("tokens %d B against %d B in full: the split saved too little to be worth it", len(tokens), len(full))
	}
}

// What scope=backdrop writes for a theme is what the full stylesheet writes
// for it, byte for byte: a page that has both gets the cascade it always had.
func TestThemeBackdropScopeMatchesTheFullStylesheet(t *testing.T) {
	h := themeCSSTestHandlers(t)
	full := h.renderThemeCSS(0, neutralAccentTheme)
	for _, id := range []string{"light", "dark", defaultThemeID} {
		got := h.themeBackdropCSSFor([]string{id}, nil, 0, neutralAccentTheme)
		if got == "" || !strings.Contains(got, `html[data-theme="`+id+`"]`) {
			t.Fatalf("%s: no backdrop block", id)
		}
		for _, line := range strings.Split(strings.TrimSpace(got), "\n") {
			if strings.Contains(line, "--theme-backdrop") && !strings.Contains(full, line) {
				t.Fatalf("%s: a backdrop line of the scoped answer is not in the full stylesheet: %.120s", id, line)
			}
		}
	}
	rule := themeBackdropRecipeRule("aurora", 0)
	if got := h.themeBackdropCSSFor(nil, []string{"aurora"}, 0, neutralAccentTheme); got != rule || !strings.Contains(full, rule) {
		t.Error("the recipe rule differs between the scoped answer and the full stylesheet")
	}
}

// A theme or recipe the install does not have draws nothing, and one request
// cannot ask for the whole catalogue.
func TestThemeBackdropScopeIgnoresWhatItDoesNotKnow(t *testing.T) {
	h := themeCSSTestHandlers(t)
	if got := h.themeBackdropCSSFor([]string{"no-such-theme", ""}, []string{"no-such-recipe"}, 0, neutralAccentTheme); got != "" {
		t.Errorf("unknown theme and recipe answered %.80q", got)
	}
	var many []string
	for i := 0; i < 40; i++ {
		many = append(many, "custom-"+strconv.Itoa(i))
	}
	colors := h.store.GetColors()
	if colors.Custom == nil {
		colors.Custom = map[string]ThemeColors{}
	}
	for _, id := range many {
		colors.Custom[id] = colors.Dark
	}
	if err := h.store.SaveColors(colors); err != nil {
		t.Fatal(err)
	}
	got := h.themeBackdropCSSFor(many, nil, 0, neutralAccentTheme)
	if n := strings.Count(got, `html[data-theme="`); n != themeBackdropMaxAsk {
		t.Errorf("40 themes asked for, %d answered, want the cap of %d", n, themeBackdropMaxAsk)
	}
}

// The answer depends on things that are not in its address, so it is
// revalidated; an unchanged answer is an empty 304.
func TestThemeBackdropScopeRevalidates(t *testing.T) {
	h := themeCSSTestHandlers(t)
	rec := httptest.NewRecorder()
	h.CustomThemeCSS(rec, httptest.NewRequest("GET", "/api/theme.css?scope=backdrop&theme=dark", nil))
	etag := rec.Header().Get("ETag")
	if etag == "" || rec.Body.Len() == 0 {
		t.Fatalf("no ETag or no body: %q", etag)
	}
	req := httptest.NewRequest("GET", "/api/theme.css?scope=backdrop&theme=dark", nil)
	req.Header.Set("If-None-Match", etag)
	again := httptest.NewRecorder()
	h.CustomThemeCSS(again, req)
	if again.Code != 304 || again.Body.Len() != 0 {
		t.Errorf("unchanged answer = %d with %d bytes, want an empty 304", again.Code, again.Body.Len())
	}
}

// The page opens on its theme's backdrop inline, so the first paint does not
// wait for a second request; the ids it names are the ones it drew.
func TestThemeBackdropInlineNamesWhatItDrew(t *testing.T) {
	h := themeCSSTestHandlers(t)
	if ids := h.themeBackdropInlineIDs("dark"); ids != "dark" {
		t.Errorf("ids = %q", ids)
	}
	if css := string(h.themeBackdropInline("dark", "")); !strings.Contains(css, `html[data-theme="dark"]`) {
		t.Error("the inline backdrop is not the theme's own")
	}
	if ids := h.themeBackdropInlineIDs("no-such-theme"); ids != "" {
		t.Errorf("an unknown theme named %q as drawn", ids)
	}
}
