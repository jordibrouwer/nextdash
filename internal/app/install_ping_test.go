package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
	}))
	defer srv.Close()
	old := installPingURL
	installPingURL = srv.URL
	defer func() { installPingURL = old }()

	if err := sendInstallPing(context.Background(), "abc", "v1.2.3"); err != nil {
		t.Fatal(err)
	}
	p := got["payload"].(map[string]any)
	if p["id"] != "abc" || p["website"] != installPingWebsiteID {
		t.Fatalf("payload = %v", p)
	}
	data := p["data"].(map[string]any)
	if len(data) != 1 || data["version"] != "v1.2.3" {
		t.Fatalf("data must carry only the version, got %v", data)
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
