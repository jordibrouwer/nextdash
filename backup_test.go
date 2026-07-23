package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateBookmarkURL(t *testing.T) {
	t.Parallel()

	if err := validateBookmarkURL("", false); err != nil {
		t.Fatalf("empty URL should be allowed: %v", err)
	}
	if err := validateBookmarkURL("https://example.com/path", false); err != nil {
		t.Fatalf("https URL should be allowed: %v", err)
	}
	if err := validateBookmarkURL("http://127.0.0.1:8080", true); err != nil {
		t.Fatalf("localhost should be allowed when allowLocal is true: %v", err)
	}

	bad := []string{
		"javascript:alert(1)",
		"file:///etc/passwd",
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"not a url",
	}
	for _, u := range bad {
		if err := validateBookmarkURL(u, false); err == nil {
			t.Fatalf("expected error for %q", u)
		}
	}
}

func TestSanitizeImportedBookmarkFile(t *testing.T) {
	t.Parallel()

	raw, _ := json.Marshal(PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{
			{Name: "OK", URL: "https://example.com"},
			{Name: "Local", URL: "http://127.0.0.1:8080"},
			{Name: "Empty", URL: ""},
		},
	})

	out, skipped, err := sanitizeImportedBookmarkFile(raw, false)
	if err != nil || skipped != 1 {
		t.Fatalf("skipped = %d, err = %v", skipped, err)
	}

	var page PageWithBookmarks
	if err := json.Unmarshal(out, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Bookmarks) != 2 {
		t.Fatalf("len = %d, want 2", len(page.Bookmarks))
	}

	outLocal, skippedLocal, err := sanitizeImportedBookmarkFile(raw, true)
	if err != nil || skippedLocal != 0 {
		t.Fatalf("allowLocal skipped = %d, err = %v", skippedLocal, err)
	}
	if err := json.Unmarshal(outLocal, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Bookmarks) != 3 {
		t.Fatalf("allowLocal len = %d, want 3", len(page.Bookmarks))
	}
}

func TestSanitizeImportedBookmarkFileSanitizesIconsWhenNoURLsSkipped(t *testing.T) {
	t.Parallel()

	raw, _ := json.Marshal(PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{
			{Name: "OK", URL: "https://example.com", Icon: "valid.png"},
			{Name: "Bad icon", URL: "https://example.org", Icon: "../settings.json"},
		},
	})

	out, skipped, err := sanitizeImportedBookmarkFile(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	if skipped != 0 {
		t.Fatalf("skipped = %d, want 0", skipped)
	}

	var page PageWithBookmarks
	if err := json.Unmarshal(out, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Bookmarks) != 2 {
		t.Fatalf("len = %d, want 2", len(page.Bookmarks))
	}
	if page.Bookmarks[0].Icon != "valid.png" {
		t.Fatalf("bookmark[0].Icon = %q, want valid.png", page.Bookmarks[0].Icon)
	}
	if page.Bookmarks[1].Icon != "" {
		t.Fatalf("bookmark[1].Icon = %q, want empty", page.Bookmarks[1].Icon)
	}
}

func TestAllowLocalBookmarksFromSettingsJSON(t *testing.T) {
	t.Parallel()

	got, err := allowLocalBookmarksFromSettingsJSON([]byte(`{"allowLocalBookmarks":false}`))
	if err != nil || got {
		t.Fatalf("explicit false: got=%v err=%v", got, err)
	}

	got, err = allowLocalBookmarksFromSettingsJSON([]byte(`{"theme":"dark"}`))
	if err != nil || !got {
		t.Fatalf("missing key should default true: got=%v err=%v", got, err)
	}
}

func TestResolveImportAllowLocalBookmarksUsesStagedSettings(t *testing.T) {
	t.Parallel()

	bookmarks, _ := json.Marshal(PageWithBookmarks{
		Page:      Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{{Name: "Local", URL: "http://127.0.0.1:8080"}},
	})

	staged := []stagedImportFile{
		{filename: "bookmarks-1.json", content: bookmarks},
		{filename: "settings.json", content: []byte(`{"allowLocalBookmarks":true}`)},
	}

	if !resolveImportAllowLocalBookmarks(staged, false) {
		t.Fatal("expected allowLocal true from staged settings.json")
	}

	staged[1].content = []byte(`{"allowLocalBookmarks":false}`)
	if resolveImportAllowLocalBookmarks(staged, true) {
		t.Fatal("expected allowLocal false from staged settings.json")
	}

	if !resolveImportAllowLocalBookmarks(staged[:1], true) {
		t.Fatal("expected fallback true when settings.json absent")
	}
	if resolveImportAllowLocalBookmarks(staged[:1], false) {
		t.Fatal("expected fallback false when settings.json absent")
	}
}

func TestCanonicalDataAssetPath(t *testing.T) {
	t.Parallel()

	if got := canonicalDataAssetPath("settings.json"); got != "settings.json" {
		t.Fatalf("settings path = %q", got)
	}
	if got := canonicalDataAssetPath("icons/foo.png"); got != "icons/foo.png" {
		t.Fatalf("icons path = %q", got)
	}
	if got := canonicalDataAssetPath("legacy.png"); got != "icons/legacy.png" {
		t.Fatalf("root image path = %q", got)
	}
	if got := canonicalDataAssetPath("favicon.png"); got != "favicon.png" {
		t.Fatalf("favicon path = %q", got)
	}
}

func TestShouldSkipBackupRootImageDuplicate(t *testing.T) {
	dataDir := t.TempDir()
	iconsDir := filepath.Join(dataDir, "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconsDir, "dup.png"), []byte("icons"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "dup.png"), []byte("root"), 0644); err != nil {
		t.Fatal(err)
	}

	if !shouldSkipBackupRootImageDuplicate(dataDir, "dup.png") {
		t.Fatal("expected to skip legacy root image when icons/ copy exists")
	}
	if shouldSkipBackupRootImageDuplicate(dataDir, "icons/dup.png") {
		t.Fatal("icons/ path should not be treated as legacy root duplicate")
	}
	if shouldSkipBackupRootImageDuplicate(dataDir, "only-root.png") {
		t.Fatal("expected to keep lone legacy root image for backup")
	}
}

func TestMergePreparedImportsDedupesCanonicalPaths(t *testing.T) {
	t.Parallel()

	merged := mergePreparedImports([]preparedImportFile{
		{relPath: importDataRelPath("dup.png"), content: []byte("root")},
		{relPath: importDataRelPath("icons/dup.png"), content: []byte("icons")},
	})
	if len(merged) != 1 {
		t.Fatalf("len = %d, want 1", len(merged))
	}
	if string(merged[0].content) != "icons" {
		t.Fatalf("content = %q, want later entry to win", merged[0].content)
	}
}

func TestCommitPreparedImportRemovesOrphans(t *testing.T) {
	dataDir := t.TempDir()
	iconsDir := filepath.Join(dataDir, "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		t.Fatal(err)
	}

	bookmarks1, _ := json.Marshal(PageWithBookmarks{
		Page:      Page{ID: 1, Name: "main"},
		Bookmarks: []Bookmark{{Name: "A", URL: "https://example.com"}},
	})
	if err := os.WriteFile(filepath.Join(dataDir, "bookmarks-1.json"), bookmarks1, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "bookmarks-2.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte(`{"theme":"old"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconsDir, "orphan.png"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(iconsDir, "keep.png"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "preview-cache.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}

	prepared := []preparedImportFile{
		{relPath: "bookmarks-1.json", content: bookmarks1},
		{relPath: "settings.json", content: []byte(`{"theme":"new"}`)},
		{relPath: filepath.Join("icons", "keep.png"), content: []byte("y")},
	}

	if err := commitPreparedImport(dataDir, prepared); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(filepath.Join(dataDir, "bookmarks-2.json")); !os.IsNotExist(err) {
		t.Fatalf("orphan bookmarks-2.json should be removed, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(iconsDir, "orphan.png")); !os.IsNotExist(err) {
		t.Fatalf("orphan icon should be removed, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "preview-cache.json")); !os.IsNotExist(err) {
		t.Fatalf("preview cache should be cleared, err=%v", err)
	}

	settings, err := os.ReadFile(filepath.Join(dataDir, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(settings) != `{"theme":"new"}` {
		t.Fatalf("settings = %s", settings)
	}
	keep, err := os.ReadFile(filepath.Join(iconsDir, "keep.png"))
	if err != nil || string(keep) != "y" {
		t.Fatalf("keep.png content = %q err=%v", keep, err)
	}
}

func TestRemoveImportOrphansPreservesFindersWhenMissing(t *testing.T) {
	dataDir := t.TempDir()
	findersPath := filepath.Join(dataDir, "finders.json")
	if err := os.WriteFile(findersPath, []byte(`[{"id":"finder-1","name":"Test"}]`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}

	prepared := []preparedImportFile{
		{relPath: "settings.json", content: []byte(`{"theme":"new"}`)},
	}
	if err := removeImportOrphans(dataDir, prepared); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(findersPath); err != nil {
		t.Fatalf("finders.json should be preserved when import ZIP omits it: %v", err)
	}
}

// Monitoring history is measured data: unlike preview-cache.json and
// health-cache.json it cannot be re-derived by scanning, so it belongs in the
// archive rather than being filtered out of it.
func TestBackupIncludesHealthHistory(t *testing.T) {
	h := newTestHandlers(t)
	dataDir := ResolveDataDir()

	history := HealthHistoryFile{
		GeneratedAt: 1750000000000,
		Samples: map[string][]HealthSample{
			"https://monitored.example.com": {
				{T: 1749999000000, Up: true, PingMs: 120, Code: 200},
				{T: 1749999300000, Up: false, Code: 503},
			},
		},
	}
	raw, err := json.Marshal(history)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "health-history.json"), raw, 0644); err != nil {
		t.Fatal(err)
	}
	// The two caches that must stay out, so this test also pins the distinction.
	for _, name := range []string{"preview-cache.json", "health-cache.json"} {
		if err := os.WriteFile(filepath.Join(dataDir, name), []byte(`{}`), 0644); err != nil {
			t.Fatal(err)
		}
	}

	zipBytes, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}
	reader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}

	var found *zip.File
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
		if f.Name == "health-history.json" {
			found = f
		}
	}
	if found == nil {
		t.Fatalf("health-history.json missing from backup; got %v", names)
	}
	if names["preview-cache.json"] || names["health-cache.json"] {
		t.Errorf("derived caches must stay out of the backup; got %v", names)
	}

	rc, err := found.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	var restored HealthHistoryFile
	if err := json.Unmarshal(got, &restored); err != nil {
		t.Fatalf("archived history is not valid JSON: %v", err)
	}
	samples := restored.Samples["https://monitored.example.com"]
	if len(samples) != 2 {
		t.Fatalf("expected 2 archived samples, got %d", len(samples))
	}
	// The response time is the whole point of keeping the file: an archive that
	// preserved only the up/down flags would still lose every chart.
	if samples[0].PingMs != 120 || !samples[0].Up || samples[1].Up {
		t.Errorf("samples did not survive the round trip: %+v", samples)
	}
}

// Every ZIP written before monitoring history was archived omits the file.
// Treating that absence as "the user removed it" would delete measurements the
// archive never had a chance to carry.
func TestRemoveImportOrphansPreservesHealthHistoryWhenMissing(t *testing.T) {
	dataDir := t.TempDir()
	historyPath := filepath.Join(dataDir, "health-history.json")
	if err := os.WriteFile(historyPath, []byte(`{"generatedAt":1,"samples":{"https://a.example":[{"t":1,"u":true}]}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "settings.json"), []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}

	prepared := []preparedImportFile{
		{relPath: "settings.json", content: []byte(`{"theme":"new"}`)},
	}
	if err := removeImportOrphans(dataDir, prepared); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(historyPath); err != nil {
		t.Fatalf("health-history.json should survive an older ZIP that omits it: %v", err)
	}
}

// A ZIP that does carry history replaces what is there, same as any other
// managed file — otherwise restoring an older machine's data would leave the
// current machine's samples mixed in.
func TestImportReplacesHealthHistoryWhenPresent(t *testing.T) {
	dataDir := t.TempDir()
	historyPath := filepath.Join(dataDir, "health-history.json")
	if err := os.WriteFile(historyPath, []byte(`{"generatedAt":1,"samples":{"https://old.example":[{"t":1,"u":true}]}}`), 0644); err != nil {
		t.Fatal(err)
	}

	incoming := []byte(`{"generatedAt":2,"samples":{"https://new.example":[{"t":2,"u":true,"p":55}]}}`)
	prepared := []preparedImportFile{
		{relPath: "health-history.json", content: incoming},
	}
	if err := commitPreparedImport(dataDir, prepared); err != nil {
		t.Fatalf("commitPreparedImport: %v", err)
	}

	got, err := os.ReadFile(historyPath)
	if err != nil {
		t.Fatal(err)
	}
	var restored HealthHistoryFile
	if err := json.Unmarshal(got, &restored); err != nil {
		t.Fatal(err)
	}
	if _, stale := restored.Samples["https://old.example"]; stale {
		t.Errorf("import should replace history, not merge into it: %v", restored.Samples)
	}
	if len(restored.Samples["https://new.example"]) != 1 {
		t.Errorf("imported history missing: %v", restored.Samples)
	}
}

// health-history.json must pass the shared filename gate, which is what both the
// export walk and the import validator consult.
func TestHealthHistoryIsValidImportFilename(t *testing.T) {
	h := &Handlers{store: NewStore()}
	if !h.isValidImportFilename("health-history.json") {
		t.Error("health-history.json should be an accepted import/export filename")
	}
	for _, name := range []string{"health-cache.json", "preview-cache.json"} {
		if h.isValidImportFilename(name) {
			t.Errorf("%s is derived and should stay out of archives", name)
		}
	}
}
