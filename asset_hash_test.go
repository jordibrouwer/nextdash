package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// withDiskAssets points the hasher at a temporary static/ tree and restores the
// previous state afterwards. Tests run from the repo root, where a real static/
// directory exists, so this keeps them off it.
func withDiskAssets(t *testing.T, files map[string]string) {
	t.Helper()

	dir := t.TempDir()
	for name, body := range files {
		full := filepath.Join(dir, "static", filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(full, []byte(body), 0644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	t.Setenv("NEXTDASH_STATIC_MUTABLE", "1")

	prevSources, prevHashes := assetHashSources, assetHashes
	t.Cleanup(func() {
		_ = os.Chdir(wd)
		assetHashMu.Lock()
		assetHashSources, assetHashes = prevSources, prevHashes
		assetHashMu.Unlock()
	})

	initAssetHashing(nil)
}

func TestAssetURLIsContentAddressed(t *testing.T) {
	withDiskAssets(t, map[string]string{"js/app.js": "console.log(1);"})

	got := assetURL("js/app.js")
	re := regexp.MustCompile(`^/static/js/app\.js\?v=[0-9a-f]{12}$`)
	if !re.MatchString(got) {
		t.Fatalf("assetURL = %q, want /static/js/app.js?v=<12 hex>", got)
	}

	// A path already carrying the /static/ prefix resolves to the same URL, so
	// templates can be written either way without silently losing the token.
	if withPrefix := assetURL("/static/js/app.js"); withPrefix != got {
		t.Errorf("prefixed path = %q, want %q", withPrefix, got)
	}
}

// The whole point of content addressing: editing a file must change its URL, and
// leaving it alone must not. A stale token serves the old file for a year.
func TestAssetURLChangesWithContentOnly(t *testing.T) {
	withDiskAssets(t, map[string]string{"js/app.js": "console.log(1);"})
	before := assetURL("js/app.js")

	if err := os.WriteFile(filepath.Join("static", "js", "app.js"), []byte("console.log(2);"), 0644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	after := assetURL("js/app.js")
	if after == before {
		t.Fatalf("URL unchanged after edit (%q): a deploy would serve the stale file", after)
	}

	if err := os.WriteFile(filepath.Join("static", "js", "app.js"), []byte("console.log(1);"), 0644); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if restored := assetURL("js/app.js"); restored != before {
		t.Errorf("URL = %q after restoring content, want the original %q", restored, before)
	}
}

// A missing file must not break the page: the URL drops the token instead, which
// still resolves (unversioned) rather than 404-ing on a bogus one.
func TestAssetURLMissingFileFallsBackToUnversioned(t *testing.T) {
	withDiskAssets(t, map[string]string{"js/app.js": "x"})

	if got := assetURL("js/nope.js"); got != "/static/js/nope.js" {
		t.Fatalf("assetURL(missing) = %q, want /static/js/nope.js", got)
	}
}

func TestAssetFingerprintTracksAnyAsset(t *testing.T) {
	withDiskAssets(t, map[string]string{
		"js/a.js":   "a",
		"css/b.css": "b",
	})

	before := assetFingerprint()
	if before == "" {
		t.Fatal("fingerprint is empty")
	}

	if err := os.WriteFile(filepath.Join("static", "css", "b.css"), []byte("b-changed"), 0644); err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	if after := assetFingerprint(); after == before {
		t.Fatal("fingerprint unchanged after a CSS edit; a running page would not know to reload")
	}
}

// Every lazily-loaded script must exist, or its loader silently falls back to an
// unversioned URL — the exact staleness this system removes.
func TestLazyLoadedAssetsExist(t *testing.T) {
	for _, rel := range lazyLoadedAssets {
		if _, err := os.Stat(filepath.Join("static", filepath.FromSlash(rel))); err != nil {
			t.Errorf("lazyLoadedAssets lists %s, which does not exist: %v", rel, err)
		}
	}
}

// A <link rel="preload"> only helps if it names the same URL the stylesheet
// later requests. CSS is served static and cannot render the asset helper, so
// preloaded fonts must stay unversioned in the template — a hashed URL there
// fetches the font twice and the browser warns the preload went unused.
func TestPreloadedFontURLsMatchStylesheet(t *testing.T) {
	tpl, err := os.ReadFile(filepath.Join("templates", "dashboard.html"))
	if err != nil {
		t.Fatalf("read template: %v", err)
	}
	css, err := os.ReadFile(filepath.Join("static", "css", "fonts.css"))
	if err != nil {
		t.Fatalf("read fonts.css: %v", err)
	}

	// Match the href greedily enough to capture a {{asset "..."}} action too,
	// which itself contains quotes — the broken form this test exists to catch.
	preloads := regexp.MustCompile(`<link rel="preload" href="(.*?)"[ >]`).FindAllStringSubmatch(string(tpl), -1)
	fonts := 0
	for _, m := range preloads {
		href := m[1]
		if !strings.Contains(href, ".woff2") {
			continue
		}
		fonts++
		if strings.Contains(href, "{{") || strings.Contains(href, "asset ") {
			t.Errorf("preload %q goes through the asset helper; fonts.css requests an unversioned URL, so the two would not match and the font would be fetched twice", href)
			continue
		}
		if !strings.Contains(string(css), href) {
			t.Errorf("preload %q is not requested by fonts.css: the preload would be wasted", href)
		}
	}
	if fonts == 0 {
		t.Fatal("no font preload found in dashboard.html; this test is no longer guarding anything")
	}
}

func TestLazyAssetMapJSONIsHashedJSON(t *testing.T) {
	// Build the fixture from the real list rather than a fixed pair, so adding a
	// lazily-loaded script cannot make this test silently stop covering it.
	files := make(map[string]string, len(lazyLoadedAssets))
	for i, rel := range lazyLoadedAssets {
		files[rel] = fmt.Sprintf("contents-%d", i)
	}
	withDiskAssets(t, files)

	var m map[string]string
	if err := json.Unmarshal([]byte(lazyAssetMapJSON()), &m); err != nil {
		t.Fatalf("lazyAssetMapJSON is not valid JSON: %v", err)
	}
	for _, rel := range lazyLoadedAssets {
		url, ok := m[rel]
		if !ok {
			t.Errorf("asset map is missing %s", rel)
			continue
		}
		if !strings.Contains(url, "?v=") {
			t.Errorf("asset map entry %s = %q has no cache-bust token", rel, url)
		}
	}
}
