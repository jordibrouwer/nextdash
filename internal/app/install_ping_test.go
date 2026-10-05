package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
