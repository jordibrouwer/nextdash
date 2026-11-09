package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInstallIDIsCreatedOnceAndReused(t *testing.T) {
	dir := t.TempDir()
	a, err := loadOrCreateInstallID(dir)
	if err != nil || len(a) != 32 {
		t.Fatalf("first id = %q, %v", a, err)
	}
	b, _ := loadOrCreateInstallID(dir)
	if a != b {
		t.Fatalf("id changed between calls: %q vs %q", a, b)
	}
}

func TestInstallPingSendsOnlyIDAndVersion(t *testing.T) {
	var got map[string]any
	var ua string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ua = r.Header.Get("User-Agent")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
	}))
	defer srv.Close()
	old := installPingURL
	installPingURL = srv.URL
	defer func() { installPingURL = old }()

	if err := sendInstallPing(context.Background(), "abc", "v1.2.3", ""); err != nil {
		t.Fatal(err)
	}
	if ua != installPingUserAgent || !strings.HasPrefix(ua, "Mozilla/5.0 (compatible;") {
		t.Fatalf("User-Agent %q would be read as a bot by Umami", ua)
	}
	p := got["payload"].(map[string]any)
	if p["id"] != "abc" || p["website"] != installPingWebsiteID {
		t.Fatalf("payload = %v", p)
	}
	if p["url"] != "/v1.2.3" {
		t.Fatalf("the version must be the path, got %v", p["url"])
	}
	if _, named := p["name"]; named || p["data"] != nil {
		t.Fatalf("must be a plain pageview with nothing else, got %v", p)
	}
}

func TestInstallPingNamesUnraidOnly(t *testing.T) {
	t.Setenv("HOST_OS", "Unraid")
	if installPlatform() != "unraid" {
		t.Fatal("HOST_OS=Unraid should be named")
	}
	t.Setenv("HOST_OS", "")
	if installPlatform() != "" {
		t.Fatal("any other install sends no platform")
	}

	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
	}))
	defer srv.Close()
	old := installPingURL
	installPingURL = srv.URL
	defer func() { installPingURL = old }()
	if err := sendInstallPing(context.Background(), "abc", "v1.2.3", "unraid"); err != nil {
		t.Fatal(err)
	}
	if got["payload"].(map[string]any)["title"] != "unraid" {
		t.Fatalf("payload = %v", got["payload"])
	}
}

func TestInstallPingSwitches(t *testing.T) {
	on := Settings{InstallPingEnabled: true}
	if !installPingEnabled(on) {
		t.Fatal("on by setting should send")
	}
	if installPingEnabled(Settings{}) {
		t.Fatal("off by setting should not send")
	}
	t.Setenv("DISABLE_TELEMETRY", "true")
	if installPingEnabled(on) {
		t.Fatal("DISABLE_TELEMETRY must stop the ping")
	}
}

// ageInstallID backdates the id file, standing in for an install that has been
// running for that long.
func ageInstallID(t *testing.T, dir string, age time.Duration) time.Time {
	t.Helper()
	if _, err := loadOrCreateInstallID(dir); err != nil {
		t.Fatal(err)
	}
	then := time.Now().Add(-age)
	if err := os.Chtimes(filepath.Join(dir, installIDFile), then, then); err != nil {
		t.Fatal(err)
	}
	return time.Now()
}

func TestInstallPingWaitsForTheFirstDay(t *testing.T) {
	dir := t.TempDir()
	if installPingDue(dir, time.Now()) {
		t.Fatal("no id file yet: nothing to count")
	}
	now := ageInstallID(t, dir, time.Minute)
	if installPingDue(dir, now) {
		t.Fatal("a server a minute old (a test run, a smoke test) must not count as an install")
	}
	now = ageInstallID(t, dir, 24*time.Hour)
	if !installPingDue(dir, now) {
		t.Fatal("an install a day old should ping")
	}
}

func TestInstallPingAtMostOncePerDay(t *testing.T) {
	dir := t.TempDir()
	now := ageInstallID(t, dir, 10*24*time.Hour)
	if !installPingDue(dir, now) {
		t.Fatal("an old install with no state file pings at once, as before")
	}
	markInstallPinged(dir, now)
	for _, later := range []time.Duration{0, time.Minute, 6 * time.Hour} {
		if installPingDue(dir, now.Add(later)) {
			t.Fatalf("a restart %v after a ping must not ping again", later)
		}
	}
	if !installPingDue(dir, now.Add(24*time.Hour)) {
		t.Fatal("the next day's tick should ping")
	}
}

func TestInstallPingUnreadableStateIsNoLastPing(t *testing.T) {
	dir := t.TempDir()
	now := ageInstallID(t, dir, 10*24*time.Hour)
	if err := os.WriteFile(filepath.Join(dir, installPingStateFile), []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !installPingDue(dir, now) {
		t.Fatal("an unreadable state file should not silence the install for good")
	}
}
