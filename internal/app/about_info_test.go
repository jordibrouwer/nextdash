package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestBuildAboutInfoFacts(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.json"), make([]byte, 10), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "b.json"), make([]byte, 20), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	info := buildAboutInfo(now, now.Add(-90*time.Second), dir)
	if info.DataBytes != 30 {
		t.Errorf("DataBytes = %d, want 30", info.DataBytes)
	}
	if info.OS != runtime.GOOS || info.Arch != runtime.GOARCH {
		t.Errorf("OS/Arch = %s/%s", info.OS, info.Arch)
	}
	if info.UptimeSeconds != 90 {
		t.Errorf("UptimeSeconds = %d, want 90", info.UptimeSeconds)
	}
	if info.Release != releaseTag() {
		t.Errorf("Release = %q, want %q", info.Release, releaseTag())
	}
	if info.GoVersion != runtime.Version() || info.StartedAt == 0 {
		t.Errorf("GoVersion/StartedAt not set: %+v", info)
	}
}

func TestBuildAboutInfoUnreadableDir(t *testing.T) {
	now := time.Now()
	info := buildAboutInfo(now, now.Add(-5*time.Second), filepath.Join(t.TempDir(), "missing"))
	if info.DataBytes != 0 {
		t.Errorf("DataBytes = %d, want 0", info.DataBytes)
	}
	if info.OS == "" || info.GoVersion == "" || info.UptimeSeconds != 5 {
		t.Errorf("other fields not set: %+v", info)
	}
}

func TestGetAboutInfoJSON(t *testing.T) {
	h := &Handlers{}
	rec := httptest.NewRecorder()
	h.GetAboutInfo(rec, httptest.NewRequest(http.MethodGet, "/api/about-info", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q", cc)
	}
	var info AboutInfo
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &raw)
	for k := range raw {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "path") || strings.Contains(lk, "dir") {
			t.Errorf("key %q leaks a path", k)
		}
	}
}
