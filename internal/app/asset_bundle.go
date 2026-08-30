package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

// One request instead of a hundred and forty.
//
// The dashboard loads 99 deferred scripts and 42 stylesheets, each a separate
// request. On localhost that is invisible; over a VPN or on a phone it is 141
// round trips on HTTP/1.1 — six at a time, in waves — and every release changes
// every hash at once, so the whole set is re-fetched together.
//
// The template stays the source of truth for what is loaded and in what order.
// The tags inside the bundle markers are read at startup, replaced by a single
// tag, and served concatenated in the same order. Nothing about the files
// changes: they are still separate on disk, still individually addressable, and
// NEXTDASH_BUNDLE=off puts the individual tags back for debugging.

const (
	bundleJSPath  = "/static/bundle/dashboard.js"
	bundleCSSPath = "/static/bundle/dashboard.css"

	bundleJSMarkerStart  = "<!-- bundle:js -->"
	bundleJSMarkerEnd    = "<!-- /bundle:js -->"
	bundleCSSMarkerStart = "<!-- bundle:css -->"
	bundleCSSMarkerEnd   = "<!-- /bundle:css -->"

	// The three views own 268 KB of the 748 KB of CSS — a third of it — and
	// none of it paints anything until that view is opened. It rides in its own
	// bundle, requested by the loader that pulls in the view's code.
	bundleViewCSSPath        = "/static/bundle/views.css"
	bundleViewCSSMarkerStart = "<!-- bundle:css-views -->"
	bundleViewCSSMarkerEnd   = "<!-- /bundle:css-views -->"

	// Search is 394 KB of the 2 192 KB of JavaScript — 17% of the bundle — and
	// none of it runs until `>`, `:`, `?` or `*` opens the overlay. Same
	// treatment as the view stylesheets: its own bundle, no tag in the page,
	// and an address in a data attribute that search-loader.js reads on the
	// first keypress. The grid renders without it — every consumer of
	// `searchComponent` guards the call — so nothing on the first paint waits.
	bundleSearchJSPath        = "/static/bundle/search.js"
	bundleSearchJSMarkerStart = "<!-- bundle:js-search -->"
	bundleSearchJSMarkerEnd   = "<!-- /bundle:js-search -->"
)

var (
	bundleAssetRe = regexp.MustCompile(`\{\{asset "([^"]+)"\}\}`)

	bundleOnce  sync.Once
	bundleState struct {
		js       assetBundle
		css      assetBundle
		viewCSS  assetBundle
		searchJS assetBundle
		open     bool // false when bundling is switched off
	}
)

type assetBundle struct {
	files   []string // static-relative paths, in template order
	content []byte
	hash    string
}

// bundlingEnabled reports whether the single-file bundles are served. Off puts
// every individual tag back, which is what you want while editing one file.
func bundlingEnabled() bool {
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("NEXTDASH_BUNDLE")), "off")
}

// buildAssetBundles reads the marked blocks out of the dashboard template and
// concatenates what they name. Called once, lazily, because the file list can
// only be known after the template is readable.
func buildAssetBundles(files fs.FS) {
	bundleOnce.Do(func() {
		bundleState.open = bundlingEnabled()
		if !bundleState.open {
			return
		}
		source := readDashboardTemplateSource(files)
		if source == "" {
			bundleState.open = false
			return
		}
		bundleState.js = buildBundle(files, bundleBlockAssets(source, bundleJSMarkerStart, bundleJSMarkerEnd))
		bundleState.css = buildBundle(files, bundleBlockAssets(source, bundleCSSMarkerStart, bundleCSSMarkerEnd))
		bundleState.viewCSS = buildBundle(files, bundleBlockAssets(source, bundleViewCSSMarkerStart, bundleViewCSSMarkerEnd))
		bundleState.searchJS = buildBundle(files, bundleBlockAssets(source, bundleSearchJSMarkerStart, bundleSearchJSMarkerEnd))
		if len(bundleState.js.files) == 0 && len(bundleState.css.files) == 0 {
			// No markers in the template: nothing to bundle, and the individual
			// tags are still there, so this is a no-op rather than an error.
			bundleState.open = false
		}
	})
}

func readDashboardTemplateSource(files fs.FS) string {
	if data, err := os.ReadFile(filepath.FromSlash("templates/dashboard.html")); err == nil {
		return string(data)
	}
	if files != nil {
		if data, err := fs.ReadFile(files, "templates/dashboard.html"); err == nil {
			return string(data)
		}
	}
	return ""
}

// bundleBlockAssets returns the asset paths named between two markers, in order.
func bundleBlockAssets(source, start, end string) []string {
	from := strings.Index(source, start)
	to := strings.Index(source, end)
	if from < 0 || to < 0 || to < from {
		return nil
	}
	block := source[from+len(start) : to]
	matches := bundleAssetRe.FindAllStringSubmatch(block, -1)
	out := make([]string, 0, len(matches))
	seen := map[string]bool{}
	for _, m := range matches {
		p := strings.TrimSpace(m[1])
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// buildBundle concatenates the files, in order, with a comment naming each one
// so a stack trace in the bundle can still be traced back to its source.
func buildBundle(files fs.FS, list []string) assetBundle {
	if len(list) == 0 {
		return assetBundle{}
	}
	var b strings.Builder
	kept := make([]string, 0, len(list))
	for _, p := range list {
		data, err := readStaticAsset(files, p)
		if err != nil {
			continue
		}
		fmt.Fprintf(&b, "\n/* ==== %s ==== */\n", p)
		b.Write(data)
		kept = append(kept, p)
	}
	content := []byte(b.String())
	sum := sha256.Sum256(content)
	return assetBundle{files: kept, content: content, hash: hex.EncodeToString(sum[:])[:12]}
}

func readStaticAsset(files fs.FS, rel string) ([]byte, error) {
	diskPath := filepath.Join("static", filepath.FromSlash(rel))
	if data, err := os.ReadFile(diskPath); err == nil {
		return data, nil
	}
	if files == nil {
		return nil, fs.ErrNotExist
	}
	return fs.ReadFile(files, path.Join("static", rel))
}

// bundleURL is what the template writes in place of the block it replaced.
func bundleURL(base string, b assetBundle) string {
	if b.hash == "" {
		return base
	}
	return base + "?v=" + b.hash
}

// ServeAssetBundle serves either bundle, with the same immutable caching a
// hashed static file gets: the URL changes whenever any file in it does.
func (h *Handlers) ServeAssetBundle(w http.ResponseWriter, r *http.Request) {
	buildAssetBundles(h.files)
	var b assetBundle
	contentType := "application/javascript; charset=utf-8"
	if strings.HasSuffix(r.URL.Path, "search.js") {
		b = bundleState.searchJS
	} else if strings.HasSuffix(r.URL.Path, "views.css") {
		b = bundleState.viewCSS
		contentType = "text/css; charset=utf-8"
	} else if strings.HasSuffix(r.URL.Path, ".css") {
		b = bundleState.css
		contentType = "text/css; charset=utf-8"
	} else {
		b = bundleState.js
	}
	if len(b.content) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Bundle-Files", fmt.Sprintf("%d", len(b.files)))
	_, _ = w.Write(b.content)
}

// readTemplateSource reads a template from disk if there is one, or from the
// embedded copy. Empty when neither has it, which sends the caller back to the
// ordinary parse path.
func readTemplateSource(files fs.FS, name string) string {
	if data, err := os.ReadFile(filepath.FromSlash(name)); err == nil {
		return string(data)
	}
	if files != nil {
		if data, err := fs.ReadFile(files, name); err == nil {
			return string(data)
		}
	}
	return ""
}

// applyAssetBundles folds each marked block down to the single tag that serves
// it. With bundling off — or with no markers — the source is returned as it was,
// so the individual tags render exactly as before.
func applyAssetBundles(files fs.FS, source string) string {
	buildAssetBundles(files)
	if !bundleState.open {
		return source
	}
	source = replaceBundleBlock(source, bundleCSSMarkerStart, bundleCSSMarkerEnd,
		fmt.Sprintf(`<link rel="stylesheet" href="%s">`, bundleURL(bundleCSSPath, bundleState.css)),
		len(bundleState.css.files))
	// The view stylesheets are not linked at all: the loader adds the sheet when
	// the view is opened, so the address travels in a data attribute instead.
	source = replaceBundleBlock(source, bundleViewCSSMarkerStart, bundleViewCSSMarkerEnd,
		fmt.Sprintf(`<link data-nextdash-view-css="%s">`,
			bundleURL(bundleViewCSSPath, bundleState.viewCSS)),
		len(bundleState.viewCSS.files))
	source = replaceBundleBlock(source, bundleJSMarkerStart, bundleJSMarkerEnd,
		fmt.Sprintf(`<script src="%s" defer></script>`, bundleURL(bundleJSPath, bundleState.js)),
		len(bundleState.js.files))
	// No script tag at all, for the same reason the view stylesheets have no
	// link: a tag would fetch it, and the point is that nothing does until a
	// key is pressed.
	source = replaceBundleBlock(source, bundleSearchJSMarkerStart, bundleSearchJSMarkerEnd,
		fmt.Sprintf(`<link data-nextdash-search-js="%s">`,
			bundleURL(bundleSearchJSPath, bundleState.searchJS)),
		len(bundleState.searchJS.files))
	return source
}

func replaceBundleBlock(source, start, end, tag string, fileCount int) string {
	from := strings.Index(source, start)
	to := strings.Index(source, end)
	if from < 0 || to < 0 || to < from || fileCount == 0 {
		return source
	}
	return source[:from] + tag + source[to+len(end):]
}
