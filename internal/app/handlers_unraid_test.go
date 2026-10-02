package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func unraidTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	dir := t.TempDir()
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(`{"allowLocalBookmarks":true}`), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	h := &Handlers{store: &FileStore{settingsFile: settingsPath, dataDir: dir}}
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "testdata/unraid")
	s := h.store.GetSettings()
	s.UnraidServers = []UnraidServer{{ID: "srv", Name: "tower", BaseURL: "http://tower", Enabled: true}}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	_ = saveUnraidAPIKey("srv", "very-secret-key")
	resetUnraidAnswers()
	t.Cleanup(resetUnraidAnswers)
	return h
}

func serveUnraid(h *Handlers, method, path, body string) *httptest.ResponseRecorder {
	r := mux.NewRouter()
	registerUnraidRoutes(r, h)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func TestUnraidAreaRouteAnswersFromTheFixture(t *testing.T) {
	h := unraidTestHandlers(t)
	rec := serveUnraid(h, "GET", "/api/unraid/area/array", "")
	var got unraidAreaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != 200 || got.Status != "ok" {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body)
	}
}

func TestUnraidOverviewComposesTheAreas(t *testing.T) {
	h := unraidTestHandlers(t)
	rec := serveUnraid(h, "GET", "/api/unraid/area/overview", "")
	body := rec.Body.String()
	for _, want := range []string{`"fullestShare"`, `"media"`, `"tower"`, `"alerts":1`} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %s in %s", want, body)
		}
	}
}

func TestUnraidRoutesNeverReturnTheKey(t *testing.T) {
	h := unraidTestHandlers(t)
	for _, path := range []string{"/api/unraid/settings", "/api/unraid/area/overview", "/api/unraid/area/info"} {
		if rec := serveUnraid(h, "GET", path, ""); strings.Contains(rec.Body.String(), "very-secret-key") {
			t.Fatalf("%s leaked the key", path)
		}
	}
}

func TestUnraidSettingsPutNeedsTheWriteToken(t *testing.T) {
	h := unraidTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := serveUnraid(h, "PUT", "/api/unraid/settings", `{"server":{"baseUrl":"http://x","enabled":true}}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d", rec.Code)
	}
}

func TestUnraidSettingsPutKeepsAnOmittedKey(t *testing.T) {
	h := unraidTestHandlers(t)
	rec := serveUnraid(h, "PUT", "/api/unraid/settings", `{"server":{"id":"srv","name":"tower","baseUrl":"http://tower2","enabled":true}}`)
	if rec.Code != 200 || unraidAPIKey("srv") != "very-secret-key" {
		t.Fatalf("code=%d key kept=%v", rec.Code, unraidAPIKey("srv") != "")
	}
}

func TestUnraidTestReportsAreasAndRole(t *testing.T) {
	h := unraidTestHandlers(t)
	rec := serveUnraid(h, "POST", "/api/unraid/test", `{"server":{"baseUrl":"http://tower","enabled":true},"key":"typed-key"}`)
	var got struct {
		OK     bool              `json:"ok"`
		Areas  map[string]string `json:"areas"`
		Viewer bool              `json:"viewerIsEnough"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if !got.OK || got.Areas["array"] != "ok" || got.Viewer {
		t.Fatalf("body = %s", rec.Body)
	}
}
