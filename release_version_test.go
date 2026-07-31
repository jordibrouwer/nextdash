package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// The tag has to match what the What's new index actually lists, since that file
// is what the modal and the config overview read. A constant kept in step by
// hand would be the thing this test exists to prevent.
func TestReleaseTagMatchesWhatsNewIndex(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("static", "data", "whats-new", "index.json"))
	if err != nil {
		t.Fatalf("read whats-new index: %v", err)
	}
	var entries []struct {
		Tag string `json:"tag"`
	}
	if err := json.Unmarshal(data, &entries); err != nil {
		t.Fatalf("parse whats-new index: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("whats-new index is empty")
	}

	got := readLatestReleaseTag()
	if got != entries[0].Tag {
		t.Fatalf("release tag = %q, want %q (newest entry in index.json)", got, entries[0].Tag)
	}
	if got == "" {
		t.Fatal("release tag is empty; analytics would report 'unknown' for every session")
	}
}

// whats-new-stub.js keeps its own release token for unread detection; this test
// catches a forgotten bump or a malformed constant during release prep.
func TestWhatsNewStubReleaseConstants(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("static", "js", "whats-new-stub.js"))
	if err != nil {
		t.Fatalf("read whats-new-stub.js: %v", err)
	}
	src := string(data)

	dashboardRelease := extractJSStringConst(src, "DASHBOARD_RELEASE")
	if dashboardRelease == "" {
		t.Fatal("DASHBOARD_RELEASE not found in whats-new-stub.js")
	}
	if !regexp.MustCompile(`^2026\.07-dashboard-release-v\d+$`).MatchString(dashboardRelease) {
		t.Fatalf("DASHBOARD_RELEASE = %q, want format 2026.07-dashboard-release-vNNN", dashboardRelease)
	}

	dataVersion := extractJSStringConst(src, "NEXTDASH_WHATS_NEW_DATA_VERSION")
	if dataVersion == "" {
		dataVersion = extractJSWindowStringAssign(src, "NEXTDASH_WHATS_NEW_DATA_VERSION")
	}
	if dataVersion == "" {
		t.Fatal("NEXTDASH_WHATS_NEW_DATA_VERSION not found in whats-new-stub.js")
	}
	if !regexp.MustCompile(`^whats-new-v\d+$`).MatchString(dataVersion) {
		t.Fatalf("NEXTDASH_WHATS_NEW_DATA_VERSION = %q, want format whats-new-vNNN", dataVersion)
	}
}

func extractJSStringConst(src, name string) string {
	re := regexp.MustCompile(`const ` + regexp.QuoteMeta(name) + ` = '([^']+)'`)
	m := re.FindStringSubmatch(src)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

func extractJSWindowStringAssign(src, name string) string {
	re := regexp.MustCompile(regexp.QuoteMeta(name) + ` = '([^']+)'`)
	m := re.FindStringSubmatch(src)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

// A missing or malformed index must not take the page down with it: this only
// feeds analytics, and reporting nothing is better than failing to render.
func TestReadLatestReleaseTagToleratesBadIndex(t *testing.T) {
	dir := t.TempDir()
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(cwd) })
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	// No file on disk here, so this falls through to the embedded copy, which
	// is a real index — the point is that it neither panics nor errors.
	if tag := readLatestReleaseTag(); tag == "" {
		t.Fatal("expected the embedded index to answer when none is on disk")
	}

	// A malformed file on disk wins over the embedded copy and must yield "".
	indexDir := filepath.Join(dir, "static", "data", "whats-new")
	if err := os.MkdirAll(indexDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(indexDir, "index.json"), []byte("not json"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if tag := readLatestReleaseTag(); tag != "" {
		t.Fatalf("malformed index returned %q, want empty", tag)
	}
}
