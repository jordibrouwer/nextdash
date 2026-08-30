package app

import (
	"os"
	"strings"
	"testing"
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
