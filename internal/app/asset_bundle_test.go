package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The template stays the source of truth: the bundle is what the marked block
// names, in the order it names it. A list that drifted from the template would
// serve files the page never asked for, or miss ones it needs.
func TestBundleBlockAssetsReadsTemplateOrder(t *testing.T) {
	source := `
    <!-- bundle:css -->
    <link rel="stylesheet" href="{{asset "css/a.css"}}">
    <link rel="stylesheet" href="{{asset "css/b.css"}}">
    <!-- /bundle:css -->
    <link rel="stylesheet" href="{{asset "css/outside.css"}}">
    <!-- bundle:js -->
    <script src="{{asset "js/one.js"}}" defer></script>
    <script src="{{asset "js/two.js"}}" defer></script>
    <!-- /bundle:js -->`

	css := bundleBlockAssets(source, bundleCSSMarkerStart, bundleCSSMarkerEnd)
	if len(css) != 2 || css[0] != "css/a.css" || css[1] != "css/b.css" {
		t.Fatalf("css = %v, want the two inside the markers in order", css)
	}
	js := bundleBlockAssets(source, bundleJSMarkerStart, bundleJSMarkerEnd)
	if len(js) != 2 || js[0] != "js/one.js" {
		t.Fatalf("js = %v, want the two inside the markers", js)
	}
	// A file outside the markers is not in the bundle, so its own tag has to
	// stay in the page — that is what keeps a non-bundled script working.
	for _, p := range css {
		if p == "css/outside.css" {
			t.Fatal("a stylesheet outside the markers was bundled")
		}
	}
}

// The block is replaced by one tag; everything around it is untouched.
func TestReplaceBundleBlockLeavesTheRestAlone(t *testing.T) {
	source := "<head>\n<!-- bundle:js -->\n<script src=\"a\"></script>\n<!-- /bundle:js -->\n</head>"
	out := replaceBundleBlock(source, bundleJSMarkerStart, bundleJSMarkerEnd, `<script src="bundle"></script>`, 1)
	if strings.Contains(out, `src="a"`) {
		t.Fatalf("individual tag survived: %s", out)
	}
	if !strings.Contains(out, "<head>") || !strings.Contains(out, "</head>") {
		t.Fatalf("surrounding markup lost: %s", out)
	}
	// An empty bundle changes nothing: with no files to serve, the individual
	// tags are the only thing that works.
	same := replaceBundleBlock(source, bundleJSMarkerStart, bundleJSMarkerEnd, `<script src="bundle"></script>`, 0)
	if same != source {
		t.Fatal("an empty bundle rewrote the page")
	}
}

// Bundling can be switched off, which is what you want while editing one file.
func TestBundlingCanBeDisabled(t *testing.T) {
	t.Setenv("NEXTDASH_BUNDLE", "off")
	if bundlingEnabled() {
		t.Fatal("NEXTDASH_BUNDLE=off did not disable bundling")
	}
	_ = os.Unsetenv("NEXTDASH_BUNDLE")
	if !bundlingEnabled() {
		t.Fatal("bundling should be on by default")
	}
}

// The search stack is 394 KB — 17% of the JS bundle — for a feature that does
// not start until someone presses `>`, `:` or `?`. It rides in a bundle of its
// own, fetched by the first keypress that opens the overlay, the same way the
// view stylesheets already wait for the view that needs them.
func TestSearchBundleIsSeparateFromTheEagerOne(t *testing.T) {
	source := `
    <!-- bundle:js -->
    <script src="{{asset "js/dashboard.js"}}" defer></script>
    <!-- /bundle:js -->
    <!-- bundle:js-search -->
    <script src="{{asset "js/search.js"}}" defer></script>
    <script src="{{asset "js/search-commands.js"}}" defer></script>
    <!-- /bundle:js-search -->`

	eager := bundleBlockAssets(source, bundleJSMarkerStart, bundleJSMarkerEnd)
	for _, p := range eager {
		if strings.Contains(p, "search") {
			t.Fatalf("search file %q is still in the eager bundle", p)
		}
	}

	search := bundleBlockAssets(source, bundleSearchJSMarkerStart, bundleSearchJSMarkerEnd)
	if len(search) != 2 || search[0] != "js/search.js" || search[1] != "js/search-commands.js" {
		t.Fatalf("search bundle = %v, want the two inside its markers in order", search)
	}
}

// The search block leaves no <script> tag behind: the address travels in a data
// attribute so nothing fetches it until the loader asks, which is the whole
// point of moving it out.
func TestSearchBlockRendersAnInertMarkerNotAScript(t *testing.T) {
	source := "<head>\n<!-- bundle:js-search -->\n<script src=\"a\"></script>\n<!-- /bundle:js-search -->\n</head>"
	out := replaceBundleBlock(source, bundleSearchJSMarkerStart, bundleSearchJSMarkerEnd,
		`<link data-nextdash-search-js="/static/bundle/search.js?v=abc">`, 1)
	if strings.Contains(out, "<script") {
		t.Fatalf("a script tag survived, so the bundle loads eagerly after all: %s", out)
	}
	if !strings.Contains(out, `data-nextdash-search-js="/static/bundle/search.js?v=abc"`) {
		t.Fatalf("the loader has no address to fetch: %s", out)
	}
}

// bundleWorkdir lays out a template and one view stylesheet in a temp dir and
// runs the test from there, so the bundle is built from files the test owns.
func bundleWorkdir(t *testing.T, css string) string {
	t.Helper()
	dir := t.TempDir()
	must := func(err error) {
		if err != nil {
			t.Fatal(err)
		}
	}
	must(os.MkdirAll(filepath.Join(dir, "templates"), 0o755))
	must(os.MkdirAll(filepath.Join(dir, "static", "css"), 0o755))
	must(os.WriteFile(filepath.Join(dir, "templates", "dashboard.html"), []byte(
		"<!-- bundle:css -->\n<link href=\"{{asset \"css/base.css\"}}\">\n<!-- /bundle:css -->\n"+
			"<!-- bundle:css-views -->\n<link href=\"{{asset \"css/view.css\"}}\">\n<!-- /bundle:css-views -->\n"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "static", "css", "base.css"), []byte("body{}"), 0o644))
	must(os.WriteFile(filepath.Join(dir, "static", "css", "view.css"), []byte(css), 0o644))
	t.Chdir(dir)
	resetAssetBundles()
	t.Cleanup(resetAssetBundles)
	return dir
}

func touchWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	// A later mtime, whatever the filesystem's clock resolution.
	later := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatal(err)
	}
}

/*
With ./static mounted live, a bundle built once at startup kept serving the
stylesheets as they were then: the Config -> Containers colours were on disk and
missing from the page until the container restarted. In that mode the bundles
follow their files, and the page names the new hash so no browser keeps the old.
*/
func TestBundlesFollowTheirFilesWhenStaticIsMutable(t *testing.T) {
	t.Setenv("NEXTDASH_STATIC_MUTABLE", "1")
	dir := bundleWorkdir(t, ".one{}")
	first := buildAssetBundles(nil)
	if !strings.Contains(string(first.viewCSS.content), ".one{}") {
		t.Fatalf("first build = %q", first.viewCSS.content)
	}
	touchWrite(t, filepath.Join(dir, "static", "css", "view.css"), ".two{}")
	second := buildAssetBundles(nil)
	if !strings.Contains(string(second.viewCSS.content), ".two{}") {
		t.Fatalf("after an edit the bundle still serves %q", second.viewCSS.content)
	}
	if second.viewCSS.hash == first.viewCSS.hash || second.generation == first.generation {
		t.Fatal("an edited bundle must get a new hash and a new generation, or the page keeps the old address")
	}
	if third := buildAssetBundles(nil); third.generation != second.generation {
		t.Fatal("nothing changed, so nothing may be rebuilt")
	}
}

func TestBundlesAreBuiltOnceWhenStaticIsFixed(t *testing.T) {
	t.Setenv("NEXTDASH_STATIC_MUTABLE", "")
	dir := bundleWorkdir(t, ".one{}")
	first := buildAssetBundles(nil)
	touchWrite(t, filepath.Join(dir, "static", "css", "view.css"), ".two{}")
	if again := buildAssetBundles(nil); again.viewCSS.hash != first.viewCSS.hash {
		t.Fatal("outside dev mode the bundle is fixed for the life of the process")
	}
}
