package app

import (
	"bytes"
	"compress/gzip"
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

	bundleMu    sync.Mutex
	bundleState bundleSet
)

/*
One build of all four bundles.

Handed out by value, so a request reads a set that cannot change under it.
generation counts the builds: the page template embeds the bundle addresses,
and is cached per generation, so a rebuilt bundle also means a rebuilt page.
*/
type bundleSet struct {
	js          assetBundle
	css         assetBundle
	viewCSS     assetBundle
	searchJS    assetBundle
	open        bool // false when bundling is switched off
	built       bool
	generation  uint64
	fingerprint string
}

// resetAssetBundles forgets every build. For tests, which lay out their own
// template and files.
func resetAssetBundles() {
	bundleMu.Lock()
	defer bundleMu.Unlock()
	bundleState = bundleSet{}
}

type assetBundle struct {
	files   []string // static-relative paths, in template order
	content []byte
	hash    string
	// lineStarts[i] is the 0-based line in content where files[i]'s own code
	// begins, just past the banner comment. The source map is built from these,
	// which is why they are recorded here rather than recomputed: the banner is
	// written in one place and counted in the same place.
	lineStarts []int
}

// bundlingEnabled reports whether the single-file bundles are served. Off puts
// every individual tag back, which is what you want while editing one file.
func bundlingEnabled() bool {
	return !strings.EqualFold(strings.TrimSpace(os.Getenv("NEXTDASH_BUNDLE")), "off")
}

/*
buildAssetBundles reads the marked blocks out of the dashboard template and
concatenates what they name, and hands back the current set.

Built once, lazily, because the file list can only be known after the template
is readable. With NEXTDASH_STATIC_MUTABLE=1 -- ./static bind-mounted for live
edits -- once was wrong: every single file followed its edits and the bundles
did not, so a stylesheet changed on disk stayed missing from the page until the
process restarted. In that mode the set is rebuilt whenever the template or a
file it names has changed, judged by size and modification time.
*/
func buildAssetBundles(files fs.FS) bundleSet {
	bundleMu.Lock()
	defer bundleMu.Unlock()
	if bundleState.built && !staticAssetsMutable() {
		return bundleState
	}
	source := ""
	if bundlingEnabled() {
		source = readDashboardTemplateSource(files)
	}
	lists := [4][]string{
		bundleBlockAssets(source, bundleJSMarkerStart, bundleJSMarkerEnd),
		bundleBlockAssets(source, bundleCSSMarkerStart, bundleCSSMarkerEnd),
		bundleBlockAssets(source, bundleViewCSSMarkerStart, bundleViewCSSMarkerEnd),
		bundleBlockAssets(source, bundleSearchJSMarkerStart, bundleSearchJSMarkerEnd),
	}
	fingerprint := ""
	if staticAssetsMutable() {
		fingerprint = bundleSourceFingerprint(source, lists)
		if bundleState.built && fingerprint == bundleState.fingerprint {
			return bundleState
		}
	}

	next := bundleSet{
		built:       true,
		generation:  bundleState.generation + 1,
		fingerprint: fingerprint,
		open:        bundlingEnabled() && source != "",
	}
	if next.open {
		next.js = buildBundle(files, lists[0])
		next.css = buildBundle(files, lists[1])
		next.viewCSS = buildBundle(files, lists[2])
		next.searchJS = buildBundle(files, lists[3])
		if len(next.js.files) == 0 && len(next.css.files) == 0 {
			// No markers in the template: nothing to bundle, and the individual
			// tags are still there, so this is a no-op rather than an error.
			next.open = false
		}
	}
	bundleState = next
	return bundleState
}

// bundleSourceFingerprint is the template itself plus the size and time of
// every file the bundles name: enough to see an edit without reading them all.
func bundleSourceFingerprint(source string, lists [4][]string) string {
	h := sha256.New()
	h.Write([]byte(source))
	for _, list := range lists {
		for _, rel := range list {
			if info, err := os.Stat(filepath.Join("static", filepath.FromSlash(rel))); err == nil {
				fmt.Fprintf(h, "%s:%d:%d;", rel, info.Size(), info.ModTime().UnixNano())
			} else {
				fmt.Fprintf(h, "%s:-;", rel)
			}
		}
	}
	return hex.EncodeToString(h.Sum(nil))
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
	starts := make([]int, 0, len(list))
	line := 0
	for _, p := range list {
		data, err := readStaticAsset(files, p)
		if err != nil {
			continue
		}
		banner := fmt.Sprintf("\n/* ==== %s ==== */\n", p)
		b.WriteString(banner)
		line += strings.Count(banner, "\n")
		starts = append(starts, line)
		b.Write(data)
		line += strings.Count(string(data), "\n")
		kept = append(kept, p)
	}
	content := []byte(b.String())
	sum := sha256.Sum256(content)
	return assetBundle{
		files:      kept,
		content:    content,
		hash:       hex.EncodeToString(sum[:])[:12],
		lineStarts: starts,
	}
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
	bundleState := buildAssetBundles(h.files)
	var b assetBundle
	contentType := "application/javascript; charset=utf-8"
	base := strings.TrimSuffix(r.URL.Path, ".map")
	if strings.HasSuffix(base, "search.js") {
		b = bundleState.searchJS
	} else if strings.HasSuffix(base, "views.css") {
		b = bundleState.viewCSS
		contentType = "text/css; charset=utf-8"
	} else if strings.HasSuffix(base, ".css") {
		b = bundleState.css
		contentType = "text/css; charset=utf-8"
	} else {
		b = bundleState.js
	}
	if len(b.content) == 0 {
		http.NotFound(w, r)
		return
	}
	// A .map request for a bundle is answered from the same state that built
	// it, so the two can never be out of step.
	if strings.HasSuffix(r.URL.Path, ".map") {
		raw := buildBundleSourceMap(b, strings.TrimSuffix(r.URL.Path, ".map"))
		if raw == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		_, _ = w.Write([]byte(raw))
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Bundle-Files", fmt.Sprintf("%d", len(b.files)))
	body := b.content
	// Only for the script bundles: a stylesheet has no stack traces to name.
	if contentType != "text/css; charset=utf-8" {
		body = append(append([]byte(nil), b.content...),
			fmt.Sprintf("\n//# sourceMappingURL=%s.map?v=%s\n", r.URL.Path, b.hash)...)
	}
	// Compressed once per bundle rather than once per request: the script
	// bundle took ~40 ms of gzip on every uncached load. Content-Encoding set
	// here makes gzipMiddleware pass the bytes through untouched.
	if clientAcceptsGzip(r) {
		w.Header().Set("Content-Encoding", "gzip")
		_, _ = w.Write(gzippedBundle(r.URL.Path, b.hash, body))
		return
	}
	_, _ = w.Write(body)
}

var (
	gzippedBundlesMu sync.Mutex
	// One entry per bundle path: a new hash replaces the old bytes, so live
	// static edits in development do not pile up copies.
	gzippedBundles = map[string]gzippedBundleEntry{}
)

type gzippedBundleEntry struct {
	hash string
	gz   []byte
}

func gzippedBundle(urlPath, hash string, body []byte) []byte {
	gzippedBundlesMu.Lock()
	defer gzippedBundlesMu.Unlock()
	if e, ok := gzippedBundles[urlPath]; ok && e.hash == hash && hash != "" {
		return e.gz
	}
	var buf bytes.Buffer
	// Default, not Best: Best was 0.4% smaller and made the first visitor
	// after a restart wait half a second for the script bundle.
	zw, _ := gzip.NewWriterLevel(&buf, gzip.DefaultCompression)
	_, _ = zw.Write(body)
	_ = zw.Close()
	gzippedBundles[urlPath] = gzippedBundleEntry{hash: hash, gz: buf.Bytes()}
	return buf.Bytes()
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
	bundleState := buildAssetBundles(files)
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
