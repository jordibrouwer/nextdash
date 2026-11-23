package app

import (
	"strings"
	"testing"
)

func serviceMCPFixture(t *testing.T) *Handlers {
	t.Helper()
	f := startFakeDocker(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "sonarr", Image: "lscr.io/linuxserver/sonarr:4.0", State: "running", Status: "Up 2 hours (healthy)",
		Env:         []string{"SECRET=hunter2-env-value"},
		Healthcheck: []string{"CMD-SHELL", "curl -f localhost"},
		Health: map[string]any{"Status": "healthy", "Log": []map[string]any{
			{"Start": "2024-01-01T00:00:00Z", "End": "2024-01-01T00:00:01Z", "ExitCode": 0, "Output": "HEALTHCHECK-LOG-OUTPUT"}}},
		Logs:   []string{"LOG-LINE-SECRET"},
		Labels: map[string]string{"com.example.secret": "LABEL-SECRET"},
		Mounts: []map[string]any{{"Type": "bind", "Source": "/srv/MOUNT-SECRET", "Destination": "/config", "RW": true}}})
	h := containerMCPHandlers(t)
	page := h.store.GetPages()[0].ID
	if err := h.store.SaveBookmarksByPage(page, []Bookmark{{Name: "Sonarr", URL: "https://sonarr.example.com/", Monitor: true, MonitorIntervalMinutes: 5}}); err != nil {
		t.Fatal(err)
	}
	turnOnGroups(t, h, true, true)
	return h
}

// service_get is the Service overview's own answer, and so is as secret-free as
// it: the env, labels, mounts, log lines and healthcheck output of the
// container are nowhere in what goes over the wire. Secrets, so falsified.
func TestServiceGetIsTheAggregateWithoutSecrets(t *testing.T) {
	h := serviceMCPFixture(t)
	raw := rawToolText(t, h, "service_get", `{"url":"https://sonarr.example.com/","container":"sonarr"}`)
	for _, secret := range []string{"hunter2-env-value", "SECRET=", "HEALTHCHECK-LOG-OUTPUT", "LOG-LINE-SECRET", "LABEL-SECRET", "MOUNT-SECRET", "curl -f"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("service_get contains %q:\n%s", secret, raw)
		}
	}
	got := toolCall(t, h, "service_get", `{"url":"https://sonarr.example.com/","container":"sonarr"}`)
	bm, _ := got["bookmark"].(map[string]any)
	ct, _ := got["container"].(map[string]any)
	if bm["found"] != true || bm["name"] != "Sonarr" || ct["name"] != "sonarr" || ct["state"] != "running" {
		t.Fatalf("aggregate = %v", got)
	}
	if _, ok := got["timeline"]; !ok {
		t.Fatalf("no timeline: %v", got)
	}
}

func TestServiceGetNeedsSomethingToLookAt(t *testing.T) {
	h := serviceMCPFixture(t)
	if msg, _ := toolCall(t, h, "service_get", `{}`)["error"].(string); !strings.Contains(msg, "bookmark url or a container") {
		t.Fatalf("empty call: %q", msg)
	}
	if msg, _ := toolCall(t, h, "service_get", `{"container":"x","host":"nope"}`)["error"].(string); !strings.Contains(msg, "host") {
		t.Fatalf("bad host: %q", msg)
	}
	// An address nobody saved is an empty service, not an error.
	got := toolCall(t, h, "service_get", `{"url":"https://nobody.example/"}`)
	if got["error"] != nil || got["bookmark"].(map[string]any)["found"] != false {
		t.Fatalf("unknown url: %v", got)
	}
}

// The tool belongs to the health switch; the container half also needs the
// Containers read switch, and without it the daemon is not asked at all.
func TestServiceGetFollowsTheSwitches(t *testing.T) {
	h := serviceMCPFixture(t)
	listed := func() bool {
		for _, n := range listedToolNames(t, h) {
			if n == "service_get" {
				return true
			}
		}
		return false
	}
	if !listed() {
		t.Fatal("service_get missing with the health switch on")
	}
	if mcpToolIsWrite(mcpFindDefinition("service_get")) {
		t.Fatal("service_get is not marked read only")
	}

	turnOnGroups(t, h, true, false)
	got := toolCall(t, h, "service_get", `{"url":"https://sonarr.example.com/","container":"sonarr"}`)
	if got["container"] != nil || !strings.Contains(mustJSON(t, got["notes"]), "switched off") {
		t.Fatalf("container present with its switch off: %v", got)
	}
	if got["bookmark"].(map[string]any)["found"] != true {
		t.Fatalf("bookmark half missing: %v", got)
	}

	turnOnGroups(t, h, false, true)
	if listed() {
		t.Fatal("service_get listed with the health switch off")
	}
	_, resp := callMCP(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"service_get","arguments":{"container":"sonarr"}}}`)
	if resp.Error == nil || resp.Error.Message != "Unknown tool: service_get" {
		t.Fatalf("answered with its switch off: %+v", resp)
	}
}
