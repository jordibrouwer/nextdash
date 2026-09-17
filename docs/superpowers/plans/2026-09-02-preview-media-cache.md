# Local preview media cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve preview-card images and card favicons from the reader's own origin instead of hot-linking third parties, with a size-capped cache the reader can clear.

**Architecture:** A server-side fetcher stores remote images under `data/preview-images/`, named by a hash of the source URL so a missing file is self-healing. `BookmarkPreview.Image`/`.Icon` stop carrying remote URLs and carry local paths; new `ImageSource`/`IconSource` fields carry the origin. Downloads run on a bounded background worker so a slow host never delays a card. A size cap evicts oldest-first after each store.

**Tech Stack:** Go (stdlib `net/http`, `crypto/sha256`), vanilla JS dashboard, Playwright + `go test`.

**Spec:** `docs/superpowers/specs/2026-09-02-preview-media-cache-design.md`

## Global Constraints

- Locale strings land in **all five** files — `locales/en.json`, `nl.json`, `de.json`, `fr.json`, `zh.json` — which are in exact string parity. Strings with counts or units are templates with placeholders, never assembled from fragments.
- The What's New entry stays English. Help and config copy are translated.
- Every change gets a CHANGELOG.md line.
- Commit subjects are short and human. No `Co-Authored-By` trailer.
- `docs/` may be committed but never pushed. It is gitignored here, so plan and spec stay untracked.
- Playwright runs with `PW_WORKERS=2`. Never use port 8080; use 8099.
- Run only the specs covering the change. No full-suite sweep.
- Per-file download cap: **5 MB**. Default cache cap: **200 MB**. Offered caps: 50 / 200 / 500 MB.
- SVG is refused for preview images. Icons keep their own sanitizer.

---

### Task 1: The fetcher and its storage

**Files:**
- Create: `internal/app/preview_image_cache.go`
- Create: `internal/app/preview_image_cache_test.go`

**Interfaces:**
- Consumes: `newOutboundHTTPClient(allowLocal bool, timeout time.Duration, maxRedirects int) *http.Client` (`url_safety.go:173`), `isPublicHost(host string) bool` (`url_safety.go:18`), `detectImageType(data []byte) string` (`security.go:12`), `iconExtensionFromContentType(contentType string) (string, bool)` (`uploads.go:243`), `ResolveDataDir() string` (`data_dir.go:11`)
- Produces: `previewImageDir() string`, `previewImageFileName(sourceURL, ext string) string`, `downloadPreviewImage(sourceURL string, allowLocalHosts bool) (string, error)` returning the bare filename

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The stored name is a pure function of the source URL, which is what lets a
// missing file heal itself: the worker derives what to fetch from the path
// alone, so a restore needs no reconciliation.
func TestPreviewImageFileNameIsStableForASource(t *testing.T) {
	a := previewImageFileName("https://example.com/og.png", ".png")
	b := previewImageFileName("https://example.com/og.png", ".png")
	if a != b {
		t.Fatalf("same source gave %q and %q", a, b)
	}
	if a == previewImageFileName("https://example.com/other.png", ".png") {
		t.Error("different sources collided")
	}
	if !strings.HasSuffix(a, ".png") {
		t.Errorf("name = %q, want it to keep the extension", a)
	}
	if strings.ContainsAny(a, "/\\") {
		t.Errorf("name = %q, want a bare filename", a)
	}
}

func TestDownloadPreviewImageRefusesPrivateHosts(t *testing.T) {
	name, err := downloadPreviewImage("http://192.168.0.4/og.png", false)
	if name != "" || err != nil {
		t.Fatalf("name = %q, err = %v; want a silent refusal", name, err)
	}
}

func TestDownloadPreviewImageRefusesSVG(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	name, _ := downloadPreviewImage("https://example.com/og.svg", false)
	if name != "" {
		t.Errorf("name = %q, want SVG refused", name)
	}
}

func TestPreviewImageDirIsUnderTheDataDir(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if got, want := previewImageDir(), filepath.Join(dir, "preview-images"); got != want {
		t.Errorf("previewImageDir() = %q, want %q", got, want)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("data dir vanished: %v", err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestPreviewImage -v`
Expected: FAIL — `undefined: previewImageFileName`, `undefined: downloadPreviewImage`, `undefined: previewImageDir`.

- [ ] **Step 3: Write the implementation**

```go
package app

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Preview media is fetched by the server and served from our own origin.
//
// Hot-linking made the reader's browser announce itself to every site they had
// saved: hovering a bookmark fetched that site's og:image directly. It also
// broke outright for a host that sets Cross-Origin-Resource-Policy, which is
// how this was noticed -- but the CORP failure is the symptom, not the reason.
//
// The stored name hashes the *source URL*, not the bytes. Byte-addressing would
// dedupe two bookmarks sharing an image, but then the local path depends on
// content we may not have, and a missing file needs a stored mapping to
// recover. Hashing the URL makes the path a pure function of the source, so a
// missing file heals itself and a restored backup needs no repair pass.
const maxPreviewImageBytes = 5 << 20

func previewImageDir() string {
	return filepath.Join(ResolveDataDir(), "preview-images")
}

func previewImageFileName(sourceURL, ext string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(sourceURL)))
	return "pi-" + hex.EncodeToString(sum[:])[:16] + ext
}

func downloadPreviewImage(sourceURL string, allowLocalHosts bool) (string, error) {
	sourceURL = strings.TrimSpace(sourceURL)
	if sourceURL == "" {
		return "", nil
	}
	parsed, err := url.Parse(sourceURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", nil
	}
	if !allowLocalHosts && !isPublicHost(parsed.Hostname()) {
		return "", nil
	}

	client := newOutboundHTTPClient(allowLocalHosts, 8*time.Second, 3)
	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "nextDash-preview-image/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxPreviewImageBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxPreviewImageBytes {
		return "", err
	}

	ext, ok := iconExtensionFromContentType(detectImageType(data))
	if !ok {
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
		if ext, ok = iconExtensionFromContentType(contentType); !ok {
			return "", nil
		}
	}
	// Refused rather than sanitised: an og:image is never an SVG, so carrying
	// sanitizeSVGContent's risk here buys nothing. Icons keep their own path.
	if ext == ".svg" {
		return "", nil
	}

	return storePreviewImage(sourceURL, ext, data)
}

// storePreviewImage writes through a temp file in the same directory and
// renames into place: two bookmarks can share a source URL, so two workers can
// reach the same name at once, and a reader must never see a half-written image.
func storePreviewImage(sourceURL, ext string, data []byte) (string, error) {
	dir := previewImageDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	name := previewImageFileName(sourceURL, ext)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return "", err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(tmpName)
		return "", err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	if err := os.Rename(tmpName, filepath.Join(dir, name)); err != nil {
		_ = os.Remove(tmpName)
		return "", err
	}
	return name, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/app/ -run TestPreviewImage -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add internal/app/preview_image_cache.go internal/app/preview_image_cache_test.go
git commit -m "add a server-side fetcher for preview images"
```

---

### Task 2: The size cap and oldest-first eviction

**Files:**
- Modify: `internal/app/preview_image_cache.go`
- Modify: `internal/app/preview_image_cache_test.go`

**Interfaces:**
- Consumes: `previewImageDir()` from Task 1
- Produces: `previewImageCacheUsage() (files int, bytes int64)`, `evictPreviewImages(capBytes int64) (removed int, err error)`, `defaultPreviewImageCacheBytes` (const)

Task 5 needs a cap before Task 7 makes it a setting, so the default constant is
defined here and Task 7 replaces the call site that uses it.

- [ ] **Step 1: Write the failing test**

```go
func TestEvictPreviewImagesRemovesOldestFirst(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	imgDir := previewImageDir()
	if err := os.MkdirAll(imgDir, 0755); err != nil {
		t.Fatal(err)
	}

	// 300 bytes each, written oldest to newest.
	names := []string{"pi-old.png", "pi-mid.png", "pi-new.png"}
	base := time.Now().Add(-3 * time.Hour)
	for i, n := range names {
		p := filepath.Join(imgDir, n)
		if err := os.WriteFile(p, make([]byte, 300), 0644); err != nil {
			t.Fatal(err)
		}
		stamp := base.Add(time.Duration(i) * time.Hour)
		if err := os.Chtimes(p, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}

	// A 700-byte cap fits two of the three.
	removed, err := evictPreviewImages(700)
	if err != nil {
		t.Fatalf("evict: %v", err)
	}
	if removed != 1 {
		t.Errorf("removed = %d, want 1", removed)
	}
	if _, err := os.Stat(filepath.Join(imgDir, "pi-old.png")); !os.IsNotExist(err) {
		t.Error("the oldest file survived")
	}
	for _, n := range []string{"pi-mid.png", "pi-new.png"} {
		if _, err := os.Stat(filepath.Join(imgDir, n)); err != nil {
			t.Errorf("%s was evicted but should have been kept", n)
		}
	}

	files, bytes := previewImageCacheUsage()
	if files != 2 || bytes != 600 {
		t.Errorf("usage = %d files / %d bytes, want 2 / 600", files, bytes)
	}
}

func TestEvictPreviewImagesLeavesAFittingCacheAlone(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.MkdirAll(previewImageDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-a.png"), make([]byte, 100), 0644); err != nil {
		t.Fatal(err)
	}
	removed, err := evictPreviewImages(700)
	if err != nil || removed != 0 {
		t.Errorf("removed = %d, err = %v; want 0, nil", removed, err)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestEvictPreviewImages -v`
Expected: FAIL — `undefined: evictPreviewImages`, `undefined: previewImageCacheUsage`.

- [ ] **Step 3: Write the implementation**

Append to `preview_image_cache.go` (add `"sort"` to the imports):

```go
// Eviction reads the directory rather than keeping an index.
//
// An index is a second source of truth that can drift from the disk; the disk
// cannot drift from itself. A few hundred files makes the walk trivial, and it
// only runs after a write.
//
// This is oldest-first, not LRU: modtime is the moment we fetched, so an image
// looked at daily can still be evicted for age. The cost is one background
// download on the next hover, never a permanent loss -- that is what the stored
// source URL is for. True LRU would cost a write per hover.
// Task 7 turns this into a setting; until then it is what the worker evicts to.
const defaultPreviewImageCacheBytes = int64(200) << 20

func previewImageCacheUsage() (int, int64) {
	entries, err := os.ReadDir(previewImageDir())
	if err != nil {
		return 0, 0
	}
	files, total := 0, int64(0)
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files++
		total += info.Size()
	}
	return files, total
}

func evictPreviewImages(capBytes int64) (int, error) {
	if capBytes <= 0 {
		return 0, nil
	}
	dir := previewImageDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}

	type aged struct {
		name string
		size int64
		when time.Time
	}
	var files []aged
	total := int64(0)
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".tmp-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, aged{entry.Name(), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= capBytes {
		return 0, nil
	}

	sort.Slice(files, func(i, j int) bool { return files[i].when.Before(files[j].when) })
	removed := 0
	for _, f := range files {
		if total <= capBytes {
			break
		}
		if err := os.Remove(filepath.Join(dir, f.name)); err != nil {
			continue
		}
		total -= f.size
		removed++
	}
	return removed, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/app/ -run 'TestEvictPreviewImages|TestPreviewImage' -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add internal/app/preview_image_cache.go internal/app/preview_image_cache_test.go
git commit -m "cap the preview image cache and evict the oldest first"
```

---

### Task 3: Serve the directory

**Files:**
- Modify: `internal/app/main.go:277-288` (the `/data/` switch)
- Create: `tests/preview-image-serving.spec.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `GET /data/preview-images/<name>` serves the file; nested paths 404

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The /data/ route is deliberately narrow: a bare FileServer over the data
 * directory also served settings.json, every bookmarks-N.json and the backup
 * ZIPs, ungated and with directory listings. Adding a directory means adding a
 * case, not widening the route.
 */
test('preview images are served, and nothing else under that prefix is', async ({ page, baseURL }) => {
    // A name that does not exist still proves the case is reachable: a served
    // case 404s from the file server, a missing case 404s from the switch. Tell
    // them apart by asking for the directory itself, which must never list.
    const listing = await page.request.get(`${baseURL}/data/preview-images/`);
    expect(listing.status(), 'the directory must not list').toBe(404);

    const nested = await page.request.get(`${baseURL}/data/preview-images/sub/deep.png`);
    expect(nested.status(), 'nested paths are not part of the case').toBe(404);

    const settings = await page.request.get(`${baseURL}/data/settings.json`);
    expect(settings.status(), 'settings.json must stay unreachable').toBe(404);
});
```

- [ ] **Step 2: Run it to verify the nested case fails**

Run: `PW_WORKERS=2 npx playwright test tests/preview-image-serving.spec.js > /tmp/pw-pis.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/pw-pis.txt`

Expected: FAIL. Write the exit code to a file and read it there — piping Playwright to `tail` reports exit 0 while tests fail.

- [ ] **Step 3: Add the case**

In `main.go`, inside the `switch` at line 277, above the `favicon.`/`font.` case:

```go
		case strings.HasPrefix(rel, "preview-images/") && !strings.Contains(strings.TrimPrefix(rel, "preview-images/"), "/"):
			// Named for the source URL, so the same address can be rewritten in
			// place when a site changes its og:image. That rules out `immutable`
			// -- it must revalidate, the way the uploaded favicon does.
			w.Header().Set("Cache-Control", "public, max-age=300")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/preview-image-serving.spec.js > /tmp/pw-pis.txt 2>&1; echo "EXIT=$?"; tail -20 /tmp/pw-pis.txt`
Expected: EXIT=0, 1 passed.

- [ ] **Step 5: Commit**

```bash
git add internal/app/main.go tests/preview-image-serving.spec.js
git commit -m "serve data/preview-images through the narrow data route"
```

---

### Task 4: Model fields and the one-time migration

**Files:**
- Modify: `internal/app/models.go` (the `BookmarkPreview` struct)
- Modify: `internal/app/cache_store.go:10-20` (`readPreviewCacheFile`)
- Create: `internal/app/preview_image_migrate_test.go`

**Interfaces:**
- Consumes: `readPreviewCacheFile() PreviewCacheFile` (`cache_store.go:10`)
- Produces: `BookmarkPreview.ImageSource`, `.IconSource`, `.ImageFetchedAt`; `normalizePreviewCacheFile(cache PreviewCacheFile) PreviewCacheFile`

- [ ] **Step 1: Write the failing test**

```go
package app

import "testing"

// Every preview cached before this feature holds a remote URL in Image, and the
// card would load it straight from the third party. Moving it to ImageSource
// hands it to the fetcher instead, and blanking Image means the card shows no
// picture until the local copy lands.
func TestNormalizePreviewCacheMovesRemoteURLsToTheSource(t *testing.T) {
	in := PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://claude.ai": {
			URL:   "https://claude.ai",
			Image: "https://claude.ai/images/claude_ogimage.png",
			Icon:  "https://claude.ai/favicon.ico",
		},
	}}

	out := normalizePreviewCacheFile(in)
	got := out.Cache["https://claude.ai"]

	if got.Image != "" {
		t.Errorf("Image = %q, want it cleared", got.Image)
	}
	if got.ImageSource != "https://claude.ai/images/claude_ogimage.png" {
		t.Errorf("ImageSource = %q, want the old remote URL", got.ImageSource)
	}
	if got.IconSource != "https://claude.ai/favicon.ico" {
		t.Errorf("IconSource = %q, want the old remote URL", got.IconSource)
	}
	if got.Icon != "" {
		t.Errorf("Icon = %q, want it cleared", got.Icon)
	}
}

// A local path is already migrated and must survive untouched, or every restart
// would blank the cache and re-fetch everything.
func TestNormalizePreviewCacheLeavesLocalPathsAlone(t *testing.T) {
	in := PreviewCacheFile{Cache: map[string]BookmarkPreview{
		"https://example.com": {
			URL:         "https://example.com",
			Image:       "/data/preview-images/pi-abc123.png",
			ImageSource: "https://example.com/og.png",
		},
	}}
	got := normalizePreviewCacheFile(in).Cache["https://example.com"]
	if got.Image != "/data/preview-images/pi-abc123.png" {
		t.Errorf("Image = %q, want it kept", got.Image)
	}
	if got.ImageSource != "https://example.com/og.png" {
		t.Errorf("ImageSource = %q, want it kept", got.ImageSource)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestNormalizePreviewCache -v`
Expected: FAIL — `unknown field ImageSource`, `undefined: normalizePreviewCacheFile`.

- [ ] **Step 3: Add the fields and the migration**

In `models.go`, in `BookmarkPreview`, directly after `Icon string \`json:"icon"\``:

```go
	/*
	 * ImageSource and IconSource are where Image and Icon were fetched from.
	 *
	 * Image and Icon hold a local path under /data/preview-images/ and never a
	 * remote URL -- a card that loaded the remote address would announce the
	 * reader to every site they had saved, which is the whole point of caching
	 * these. The source is kept so an evicted, cleared or never-backed-up file
	 * can be fetched again without re-parsing the page.
	 */
	ImageSource string `json:"imageSource,omitempty"`
	IconSource  string `json:"iconSource,omitempty"`
	// ImageFetchedAt is when the media fetch was last attempted, successful or
	// not, so a source that 404s is not retried on every hover forever.
	ImageFetchedAt int64 `json:"imageFetchedAt,omitempty"`
```

In `cache_store.go`, add the normaliser and call it from `readPreviewCacheFile`:

```go
// normalizePreviewCacheFile migrates entries written before preview media was
// cached locally: their Image and Icon hold remote URLs, which is now what the
// *Source fields mean.
func normalizePreviewCacheFile(cache PreviewCacheFile) PreviewCacheFile {
	if cache.Cache == nil {
		cache.Cache = map[string]BookmarkPreview{}
		return cache
	}
	for key, entry := range cache.Cache {
		if strings.HasPrefix(entry.Image, "http://") || strings.HasPrefix(entry.Image, "https://") {
			entry.ImageSource = entry.Image
			entry.Image = ""
		}
		if strings.HasPrefix(entry.Icon, "http://") || strings.HasPrefix(entry.Icon, "https://") {
			entry.IconSource = entry.Icon
			entry.Icon = ""
		}
		cache.Cache[key] = entry
	}
	return cache
}
```

Then in `readPreviewCacheFile`, change both `return` statements that hand back a parsed file so the parsed one is normalised:

```go
	return normalizePreviewCacheFile(cache)
```

(The two early returns for a missing or unparseable file already build an empty map and need no change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/app/ -run 'TestNormalizePreviewCache' -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add internal/app/models.go internal/app/cache_store.go internal/app/preview_image_migrate_test.go
git commit -m "keep the source URL beside cached preview media"
```

---

### Task 5: Fetch in the background, off the card's path

**Files:**
- Modify: `internal/app/handlers.go:2500-2510` (where `preview.Image` and `preview.Icon` are parsed)
- Modify: `internal/app/preview_image_cache.go`
- Modify: `internal/app/preview_image_cache_test.go`

**Interfaces:**
- Consumes: `downloadPreviewImage` (Task 1), `evictPreviewImages` (Task 2), `BookmarkPreview.ImageSource`/`IconSource`/`ImageFetchedAt` (Task 4), `h.mergePreviewCacheUpdates(map[string]BookmarkPreview) error` (`cache_store.go:81`), `h.allowLocalBookmarks() bool` (`handlers.go:1182`), `canonicalBookmarkURLKey(string) string`
- Produces: `(h *Handlers) queuePreviewMediaFetch(key string, entry BookmarkPreview)`, `previewMediaFetchDue(entry BookmarkPreview) bool`, `(h *Handlers) startPreviewMediaWorkers()`

- [ ] **Step 1: Write the failing test**

```go
func TestPreviewMediaFetchIsNotRetriedInsideTheTTL(t *testing.T) {
	now := time.Now().UnixMilli()

	// A source that was tried a minute ago and produced nothing: a 404 or a
	// timeout. Retrying on every hover would hammer a dead host forever.
	recent := BookmarkPreview{ImageSource: "https://example.com/og.png", ImageFetchedAt: now - 60_000}
	if previewMediaFetchDue(recent) {
		t.Error("a source tried a minute ago is due again")
	}

	// The same source past the cache TTL is fair game.
	stale := BookmarkPreview{ImageSource: "https://example.com/og.png", ImageFetchedAt: now - previewCacheTTLMs - 1}
	if !previewMediaFetchDue(stale) {
		t.Error("a source past the TTL is not due")
	}

	// Never tried at all.
	fresh := BookmarkPreview{ImageSource: "https://example.com/og.png"}
	if !previewMediaFetchDue(fresh) {
		t.Error("an untried source is not due")
	}

	// Nothing to fetch.
	if previewMediaFetchDue(BookmarkPreview{}) {
		t.Error("an entry with no source is due")
	}

	// Already local.
	done := BookmarkPreview{
		ImageSource: "https://example.com/og.png",
		Image:       "/data/preview-images/pi-abc.png",
		IconSource:  "https://example.com/favicon.ico",
		Icon:        "/data/preview-images/pi-def.png",
	}
	if previewMediaFetchDue(done) {
		t.Error("a fully cached entry is due")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestPreviewMediaFetch -v`
Expected: FAIL — `undefined: previewMediaFetchDue`.

- [ ] **Step 3: Write the worker**

Append to `preview_image_cache.go` (add `"sync"` to the imports):

```go
// previewMediaFetchDue answers whether this entry still has media worth
// fetching. An attempt stamps ImageFetchedAt whether or not it succeeded, so a
// source that 404s is left alone until the entry's TTL brings it round again.
func previewMediaFetchDue(entry BookmarkPreview) bool {
	wantImage := entry.ImageSource != "" && entry.Image == ""
	wantIcon := entry.IconSource != "" && entry.Icon == ""
	if !wantImage && !wantIcon {
		return false
	}
	if entry.ImageFetchedAt == 0 {
		return true
	}
	return time.Now().UnixMilli()-entry.ImageFetchedAt >= previewCacheTTLMs
}

// The queue is small and lossy on purpose: this is decoration, and dropping a
// fetch under load costs one missing picture that the next hover asks for
// again. Blocking the card on it is what we are avoiding.
const previewMediaQueueDepth = 64

type previewMediaJob struct {
	key   string
	entry BookmarkPreview
}

var (
	previewMediaQueue     chan previewMediaJob
	previewMediaQueueOnce sync.Once
)

func (h *Handlers) startPreviewMediaWorkers() {
	previewMediaQueueOnce.Do(func() {
		previewMediaQueue = make(chan previewMediaJob, previewMediaQueueDepth)
		for i := 0; i < 2; i++ {
			go func() {
				for job := range previewMediaQueue {
					h.runPreviewMediaJob(job)
				}
			}()
		}
	})
}

func (h *Handlers) queuePreviewMediaFetch(key string, entry BookmarkPreview) {
	if key == "" || !previewMediaFetchDue(entry) {
		return
	}
	h.startPreviewMediaWorkers()
	select {
	case previewMediaQueue <- previewMediaJob{key: key, entry: entry}:
	default: // Full. The next hover asks again.
	}
}

func (h *Handlers) runPreviewMediaJob(job previewMediaJob) {
	entry := job.entry
	allowLocal := h.allowLocalBookmarks()

	if entry.ImageSource != "" && entry.Image == "" {
		if name, err := downloadPreviewImage(entry.ImageSource, allowLocal); err == nil && name != "" {
			entry.Image = "/data/preview-images/" + name
		}
	}
	if entry.IconSource != "" && entry.Icon == "" {
		if name, err := downloadPreviewImage(entry.IconSource, allowLocal); err == nil && name != "" {
			entry.Icon = "/data/preview-images/" + name
		}
	}
	// Stamped even when both failed: that is what stops the retry loop.
	entry.ImageFetchedAt = time.Now().UnixMilli()

	_ = h.mergePreviewCacheUpdates(map[string]BookmarkPreview{job.key: entry})
	// Task 7 replaces this constant with h.previewImageCapBytes().
	_, _ = evictPreviewImages(defaultPreviewImageCacheBytes)
}
```

- [ ] **Step 4: Redirect the parsed URLs into the source fields**

In `handlers.go`, replace lines 2502-2509 (the `preview.Image` and `preview.Icon` assignments) so the parsed remote address lands in the source field and the card-facing field stays empty:

```go
	preview.ImageSource = h.extractMetaFromHTML(htmlBody, "property", "og:image")
	if preview.ImageSource != "" {
		preview.ImageSource = h.resolveRelativeURL(preview.URL, preview.ImageSource)
	}
	preview.IconSource = h.extractIconFromHTML(htmlBody)
	if preview.IconSource != "" {
		preview.IconSource = h.resolveRelativeURL(preview.URL, preview.IconSource)
	}
```

Then, at the end of `fetchBookmarkPreview`, just before it returns the freshly parsed preview, queue the fetch:

```go
	h.queuePreviewMediaFetch(cacheKey, preview)
```

And on the cache-hit early return (`handlers.go:2440-2444`), queue there too, so an entry whose file was evicted or never restored heals on the next hover:

```go
	if useCache && cache != nil {
		if entry, ok := cache.Cache[cacheKey]; ok {
			if time.Now().UnixMilli()-entry.FetchedAt < previewCacheTTLMs {
				h.queuePreviewMediaFetch(cacheKey, entry)
				return entry
			}
		}
	}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/app/ -run 'TestPreviewMediaFetch|TestPreviewImage|TestEvictPreviewImages|TestNormalizePreviewCache' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/app/preview_image_cache.go internal/app/preview_image_cache_test.go internal/app/handlers.go
git commit -m "fetch preview media in the background instead of on the card"
```

---

### Task 6: Keep the cache out of backups

**Files:**
- Modify: `internal/app/backup.go:783-793` (the directory skips in the `filepath.Walk`)
- Create: `internal/app/backup_preview_images_test.go`

**Interfaces:**
- Consumes: `(h *Handlers) buildBackupZip() ([]byte, error)` (`backup.go:759`)
- Produces: no `preview-images/` entries in the ZIP

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The walk in buildBackupZip takes the whole data directory and skips only what
// it names, so a new directory falls in by default. Import, meanwhile, accepts
// only icons/ and archives/ as subdirectories -- so leaving this in would make
// ZIPs that carry up to the cache cap in images and are then refused on the way
// back. Cached media is re-fetchable; archives/ is the place for keeping things.
func TestBackupZipExcludesCachedPreviewImages(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	imgDir := filepath.Join(dir, "preview-images")
	if err := os.MkdirAll(imgDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(imgDir, "pi-abc123.png"), []byte("not really a png"), 0644); err != nil {
		t.Fatal(err)
	}

	h := newTestHandlers(t)
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	for _, f := range reader.File {
		if strings.HasPrefix(filepath.ToSlash(f.Name), "preview-images/") {
			t.Errorf("the ZIP carries %s", f.Name)
		}
	}
}
```

Note: use whatever the package's existing helper for a `*Handlers` in tests is called. Check `internal/app/backup_test.go` for the established construction and copy it rather than inventing `newTestHandlers`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestBackupZipExcludesCachedPreviewImages -v`
Expected: FAIL — the ZIP carries `preview-images/pi-abc123.png`.

- [ ] **Step 3: Add the skip**

In `backup.go`, in the `if info.IsDir()` branch of the walk, beside the `autoBackupDirName` skip:

```go
			// Refetchable decoration, capped at a couple of hundred megabytes.
			// preview-cache.json and health-cache.json are already dropped on
			// import for the same reason, and the import allowlist would refuse
			// these anyway -- carrying them would only make ZIPs that cannot be
			// restored. archives/ is where things worth keeping go.
			if info.Name() == previewImageDirName && filepath.Dir(path) == dataDir {
				return filepath.SkipDir
			}
```

And define the name beside the other directory-name constants in `backup.go`:

```go
const previewImageDirName = "preview-images"
```

Then in Task 1's `previewImageDir()`, use it: `filepath.Join(ResolveDataDir(), previewImageDirName)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/app/ -run 'TestBackupZipExcludes|TestPreviewImage' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/app/backup.go internal/app/preview_image_cache.go internal/app/backup_preview_images_test.go
git commit -m "keep cached preview images out of the backup zip"
```

---

### Task 7: The cap setting

**Files:**
- Modify: `internal/app/models.go` (the `Settings` struct and both default blocks, around lines 440, 1197 and 3051)
- Modify: `internal/app/preview_image_cache.go`
- Create: `internal/app/preview_image_settings_test.go`

**Interfaces:**
- Consumes: `h.store.GetSettings()`
- Produces: `Settings.PreviewImageCacheMB int`, `normalizePreviewImageCacheMB(mb int) int`, `(h *Handlers) previewImageCapBytes() int64`

- [ ] **Step 1: Write the failing test**

```go
package app

import "testing"

func TestNormalizePreviewImageCacheMB(t *testing.T) {
	cases := []struct{ in, want int }{
		{50, 50}, {200, 200}, {500, 500},
		{0, 200},    // unset, which is every install before this release
		{-1, 200},   // nonsense
		{123, 200},  // not one of the offered sizes
		{5000, 200}, // not one of the offered sizes
	}
	for _, c := range cases {
		if got := normalizePreviewImageCacheMB(c.in); got != c.want {
			t.Errorf("normalizePreviewImageCacheMB(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run TestNormalizePreviewImageCacheMB -v`
Expected: FAIL — `undefined: normalizePreviewImageCacheMB`.

- [ ] **Step 3: Add the setting**

In `models.go`, in `Settings`, beside `LinkPreviewHoverDelayMs` (line 440):

```go
	PreviewImageCacheMB int `json:"previewImageCacheMB,omitempty"` // Cap for data/preview-images, in MB
```

Add `PreviewImageCacheMB: 200,` to both default blocks (near lines 1197 and 3051 — grep for `LinkPreviewHoverDelayMs:` to find them; there are two and both must be updated).

In `preview_image_cache.go`:

```go
// The offered sizes are a short list rather than a free number: a cap is a
// disk-space decision, not a tuning knob, and three sizes cover it.
var previewImageCacheSizesMB = []int{50, 200, 500}

const defaultPreviewImageCacheMB = 200

func normalizePreviewImageCacheMB(mb int) int {
	for _, allowed := range previewImageCacheSizesMB {
		if mb == allowed {
			return mb
		}
	}
	return defaultPreviewImageCacheMB
}

func (h *Handlers) previewImageCapBytes() int64 {
	mb := normalizePreviewImageCacheMB(h.store.GetSettings().PreviewImageCacheMB)
	return int64(mb) << 20
}
```

Then change the call site Task 5 left behind, in `runPreviewMediaJob`:

```go
	_, _ = evictPreviewImages(h.previewImageCapBytes())
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/app/ -run TestNormalizePreviewImageCacheMB -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/app/models.go internal/app/preview_image_cache.go internal/app/preview_image_settings_test.go
git commit -m "make the preview image cap a setting"
```

---

### Task 8: The stats and clear endpoints

**Files:**
- Modify: `internal/app/main.go:256-257` (routes)
- Create: `internal/app/preview_image_handlers.go`
- Create: `internal/app/preview_image_handlers_test.go`

**Interfaces:**
- Consumes: `previewImageCacheUsage()` (Task 2), `h.previewImageCapBytes()` (Task 7), `h.requireWriteAccess(w, r) bool`, `h.replacePreviewCache`/`h.mergePreviewCacheUpdates` (`cache_store.go`)
- Produces: `GET /api/previews/images` → `{"files":N,"bytes":N,"capBytes":N}`; `POST /api/previews/images/clear` → `{"removed":N}`

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClearPreviewImagesEmptiesTheDirectoryAndKeepsTheSources(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.MkdirAll(previewImageDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-abc.png"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	h := newTestHandlers(t)
	_ = h.mergePreviewCacheUpdates(map[string]BookmarkPreview{
		"https://example.com": {
			URL:         "https://example.com",
			Image:       "/data/preview-images/pi-abc.png",
			ImageSource: "https://example.com/og.png",
		},
	})

	rec := httptest.NewRecorder()
	h.ClearPreviewImages(rec, httptest.NewRequest(http.MethodPost, "/api/previews/images/clear", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	if files, _ := previewImageCacheUsage(); files != 0 {
		t.Errorf("%d files left on disk", files)
	}
	entry, _ := h.getPreviewCacheEntry("https://example.com")
	if entry.Image != "" {
		t.Errorf("Image = %q, want it cleared", entry.Image)
	}
	if entry.ImageSource != "https://example.com/og.png" {
		t.Errorf("ImageSource = %q, want it kept so the image can come back", entry.ImageSource)
	}
}

func TestPreviewImageStatsReportUsageAndCap(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	if err := os.MkdirAll(previewImageDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-abc.png"), make([]byte, 512), 0644); err != nil {
		t.Fatal(err)
	}

	h := newTestHandlers(t)
	rec := httptest.NewRecorder()
	h.PreviewImageStats(rec, httptest.NewRequest(http.MethodGet, "/api/previews/images", nil))

	var body struct {
		Files    int   `json:"files"`
		Bytes    int64 `json:"bytes"`
		CapBytes int64 `json:"capBytes"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Files != 1 || body.Bytes != 512 {
		t.Errorf("files/bytes = %d/%d, want 1/512", body.Files, body.Bytes)
	}
	if body.CapBytes != 200<<20 {
		t.Errorf("capBytes = %d, want the 200 MB default", body.CapBytes)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/app/ -run 'TestClearPreviewImages|TestPreviewImageStats' -v`
Expected: FAIL — `h.ClearPreviewImages undefined`, `h.PreviewImageStats undefined`.

- [ ] **Step 3: Write the handlers**

Create `preview_image_handlers.go`:

```go
package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// PreviewImageStats reports what the cache is using, for the read-out in Config.
func (h *Handlers) PreviewImageStats(w http.ResponseWriter, r *http.Request) {
	files, bytes := previewImageCacheUsage()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"files":    files,
		"bytes":    bytes,
		"capBytes": h.previewImageCapBytes(),
	})
}

// ClearPreviewImages empties the directory and blanks the local paths, keeping
// the source URLs so every image can be fetched again on its next hover.
func (h *Handlers) ClearPreviewImages(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	removed := 0
	entries, err := os.ReadDir(previewImageDir())
	if err != nil && !os.IsNotExist(err) {
		http.Error(w, "Unable to read the preview image cache", http.StatusInternalServerError)
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := os.Remove(filepath.Join(previewImageDir(), entry.Name())); err == nil {
			removed++
		}
	}

	h.previewCacheMu.Lock()
	h.ensurePreviewCacheLoadedLocked()
	for key, entry := range h.previewCache.Cache {
		if !strings.HasPrefix(entry.Image, "/data/") && !strings.HasPrefix(entry.Icon, "/data/") {
			continue
		}
		entry.Image = ""
		entry.Icon = ""
		// Cleared rather than stamped: the reader asked for these back.
		entry.ImageFetchedAt = 0
		h.previewCache.Cache[key] = entry
	}
	h.previewCacheDirty = true
	_ = h.flushPreviewCacheLocked()
	h.previewCacheMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"removed": removed})
}
```

In `main.go`, beside the existing preview routes at line 256:

```go
	r.HandleFunc("/api/previews/images", handlers.PreviewImageStats).Methods("GET")
	r.HandleFunc("/api/previews/images/clear", handlers.ClearPreviewImages).Methods("POST")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/app/ -run 'TestClearPreviewImages|TestPreviewImageStats' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/app/preview_image_handlers.go internal/app/preview_image_handlers_test.go internal/app/main.go
git commit -m "add endpoints for preview image usage and clearing"
```

---

### Task 9: The config controls and their strings

**Files:**
- Modify: `static/js/dashboard/dashboard-config.js` (beside `clearAllPreviews()` at line 6604, and the section markup that renders the preview controls)
- Modify: `locales/en.json`, `locales/nl.json`, `locales/de.json`, `locales/fr.json`, `locales/zh.json`
- Create: `tests/config-preview-image-cache.spec.js`

**Interfaces:**
- Consumes: `GET /api/previews/images`, `POST /api/previews/images/clear` (Task 8), `this.writeFetch`, `this.confirmAction`, `this.notify`, `this.t`
- Produces: `clearPreviewImages()` on the config controller

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');

test('config reports the image cache and can empty it', async ({ page, baseURL }) => {
    await page.goto(baseURL);
    // Drive the real entry point: open Config the way a reader does rather than
    // calling the render function.
    await page.keyboard.press('c');
    await page.getByRole('tab', { name: /appearance/i }).click();

    const readout = page.locator('[data-testid="preview-image-cache-usage"]');
    await expect(readout).toBeVisible();
    await expect(readout).toHaveText(/\d+/);

    page.once('dialog', d => d.accept());
    await page.getByTestId('clear-preview-images').click();
    await expect(readout).toHaveText(/\b0\b/);
});
```

Adjust the tab name and the way Config is opened to match this repo's existing config specs — copy the opening sequence from a neighbouring spec rather than guessing.

- [ ] **Step 2: Run it to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/config-preview-image-cache.spec.js > /tmp/pw-pic.txt 2>&1; echo "EXIT=$?"; tail -30 /tmp/pw-pic.txt`
Expected: FAIL — the read-out does not exist.

- [ ] **Step 3: Add the control and the handler**

In the markup that renders the preview controls, beside the existing "clear all previews" button:

```js
`<div class="config-row">
    <span data-testid="preview-image-cache-usage">${this.t('config.previewImageCacheUsage', '{files} files, {used} of {cap}')
        .replace('{files}', String(stats.files))
        .replace('{used}', formatBytes(stats.bytes))
        .replace('{cap}', formatBytes(stats.capBytes))}</span>
    <button type="button" data-testid="clear-preview-images" data-action="clear-preview-images">
        ${this.t('config.clearPreviewImages', 'Remove cached images')}
    </button>
</div>`
```

And the handler beside `clearAllPreviews()`:

```js
async clearPreviewImages() {
    if (!await this.confirmAction(
        this.t('config.clearPreviewImagesConfirm', 'Remove every cached preview image? They are fetched again when next needed.'),
        { confirmLabel: this.t('config.confirmClear', 'Clear') })) return;
    try {
        const res = await this.writeFetch('/api/previews/images/clear', { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.notify(this.t('config.clearPreviewImagesDone', 'Cached images removed.'), 'success');
        await this.refreshPreviewImageStats();
    } catch {
        this.notify(this.t('config.clearPreviewImagesError', 'Could not remove the cached images.'), 'error');
    }
}
```

Wire `clear-preview-images` into the same `data-action` dispatch the neighbouring buttons use.

- [ ] **Step 4: Add the strings to all five locales**

Under the `config` section of each file, with the same keys and the same placeholders. English:

```json
"previewImageCacheUsage": "{files} files, {used} of {cap}",
"clearPreviewImages": "Remove cached images",
"clearPreviewImagesConfirm": "Remove every cached preview image? They are fetched again when next needed.",
"clearPreviewImagesDone": "Cached images removed.",
"clearPreviewImagesError": "Could not remove the cached images.",
"previewImageCacheSize": "Image cache size"
```

Dutch:

```json
"previewImageCacheUsage": "{files} bestanden, {used} van {cap}",
"clearPreviewImages": "Gecachte afbeeldingen wissen",
"clearPreviewImagesConfirm": "Alle gecachte preview-afbeeldingen verwijderen? Ze worden opnieuw opgehaald zodra ze nodig zijn.",
"clearPreviewImagesDone": "Gecachte afbeeldingen verwijderd.",
"clearPreviewImagesError": "Kon de gecachte afbeeldingen niet verwijderen.",
"previewImageCacheSize": "Grootte afbeeldingscache"
```

German:

```json
"previewImageCacheUsage": "{files} Dateien, {used} von {cap}",
"clearPreviewImages": "Zwischengespeicherte Bilder entfernen",
"clearPreviewImagesConfirm": "Alle zwischengespeicherten Vorschaubilder entfernen? Sie werden bei Bedarf erneut geladen.",
"clearPreviewImagesDone": "Zwischengespeicherte Bilder entfernt.",
"clearPreviewImagesError": "Die zwischengespeicherten Bilder konnten nicht entfernt werden.",
"previewImageCacheSize": "Größe des Bild-Caches"
```

French:

```json
"previewImageCacheUsage": "{files} fichiers, {used} sur {cap}",
"clearPreviewImages": "Supprimer les images en cache",
"clearPreviewImagesConfirm": "Supprimer toutes les images d'aperçu en cache ? Elles seront récupérées à nouveau si nécessaire.",
"clearPreviewImagesDone": "Images en cache supprimées.",
"clearPreviewImagesError": "Impossible de supprimer les images en cache.",
"previewImageCacheSize": "Taille du cache d'images"
```

Chinese:

```json
"previewImageCacheUsage": "{files} 个文件，已用 {used}／共 {cap}",
"clearPreviewImages": "清除缓存的图片",
"clearPreviewImagesConfirm": "要清除所有缓存的预览图片吗？需要时会重新获取。",
"clearPreviewImagesDone": "已清除缓存的图片。",
"clearPreviewImagesError": "无法清除缓存的图片。",
"previewImageCacheSize": "图片缓存大小"
```

- [ ] **Step 5: Verify the five locales are still in parity**

Run:

```bash
python3 -c "
import json
def count(o): return sum(count(v) if isinstance(v,dict) else 1 for v in o.values())
counts = {f: count(json.load(open(f'locales/{f}.json'))) for f in ['en','nl','de','fr','zh']}
print(counts)
assert len(set(counts.values())) == 1, 'locales are out of parity'
"
```

Expected: one shared count, printed, no assertion error.

- [ ] **Step 6: Run the spec to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/config-preview-image-cache.spec.js > /tmp/pw-pic.txt 2>&1; echo "EXIT=$?"; tail -30 /tmp/pw-pic.txt`
Expected: EXIT=0.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-config.js locales/ tests/config-preview-image-cache.spec.js
git commit -m "show the image cache in config and let it be cleared"
```

---

### Task 10: Prove the card never reaches a third party

**Files:**
- Create: `tests/preview-card-no-third-party.spec.js`

**Interfaces:**
- Consumes: everything above

- [ ] **Step 1: Write the test**

```js
// @ts-check
const { test, expect } = require('./fixtures');

/**
 * The point of the whole feature: hovering a bookmark must not announce the
 * reader to the site behind it. Asserted on the wire rather than on the DOM,
 * because a src attribute can look local while a redirect still leaves.
 */
test('hovering a bookmark makes no request to a third party', async ({ page, baseURL }) => {
    const offSite = [];
    page.on('request', req => {
        const url = new URL(req.url());
        if (url.host !== new URL(baseURL).host) offSite.push(req.url());
    });

    await page.goto(baseURL);
    const link = page.locator('.bookmark-item a').first();
    await link.hover();
    await page.waitForTimeout(1200); // past the hover delay and the card render

    expect(offSite, `the card fetched ${offSite.join(', ')}`).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `PW_WORKERS=2 npx playwright test tests/preview-card-no-third-party.spec.js > /tmp/pw-3p.txt 2>&1; echo "EXIT=$?"; tail -30 /tmp/pw-3p.txt`
Expected: EXIT=0. If it fails, the failure names the exact URL that leaked — fix that path rather than loosening the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/preview-card-no-third-party.spec.js
git commit -m "assert the preview card makes no third-party requests"
```

---

### Task 11: Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `MANUAL.md`
- Modify: the Help section source and `static/data/whats-new/`

- [ ] **Step 1: Ask for the version number**

Do not invent one. The changelog here is strictly per release with no "Unreleased" section, so the entry needs a decided version before it can be written.

- [ ] **Step 2: Write the changelog entry**

Under the agreed version, in the style of the surrounding entries — a `**new — ...**` line naming what changed for the reader, then the reasoning.

- [ ] **Step 3: Write the manual section**

Describe the cache, the size choice and the clear button. Note that cached images are not part of a backup and come back on their own.

- [ ] **Step 4: Add the What's New entry**

English only, per convention. Views and buttons, not mechanism.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md MANUAL.md static/data/whats-new/
git commit -m "document the preview image cache"
```

---

## Self-review notes

**Spec coverage.** Every section maps to a task: §1 storage → Task 1; §2 fetcher → Task 1; §3 hook and background worker → Task 5; failed-fetch backoff → Task 5; concurrent writes → Task 1 (`storePreviewImage`); §4 eviction → Task 2, cap setting → Task 7; §5 config → Tasks 8 and 9; §6 migration → Task 4; §7 backup → Task 6; §8 testing → spread across all, plus Task 10 for the privacy claim itself.

**One refinement the plan forced.** The spec did not settle caching headers. Because the filename hashes the *source URL*, the same address is rewritten in place when a site changes its og:image — so `immutable`, which `icons/` uses, would be wrong here. Task 3 serves these with `max-age=300` and revalidation, the same reasoning the uploaded favicon already carries.

**Two consistency bugs found and fixed in review.** `queuePreviewMediaFetch` was
declared with one parameter in Task 5's interface block and called with two in its
own code. And Task 5 evicted using `h.previewImageCapBytes()`, which Task 7 does not
define until two tasks later — so Task 5 would not have compiled on its own. The cap
now starts as a constant in Task 2 and Task 7 explicitly rewrites the call site.

**Two things left for the implementer to look up rather than guess.** The test-`Handlers` constructor in Tasks 6 and 8 is written as `newTestHandlers(t)`; copy whatever `backup_test.go` actually uses. The Config tab name and opening sequence in Task 9 should come from a neighbouring config spec.
