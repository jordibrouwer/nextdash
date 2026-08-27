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
