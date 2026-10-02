package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
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
	rec := serveUnraid(h, "PUT", "/api/unraid/settings", `{"server":{"id":"srv","name":"tower2","baseUrl":"http://tower","enabled":true}}`)
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

func TestUnraidTestSendsTheSavedKeyOnlyToItsOwnAddress(t *testing.T) {
	h := unraidTestHandlers(t)
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "")
	var mu sync.Mutex
	var keys []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		keys = append(keys, r.Header.Get("x-api-key"))
		mu.Unlock()
		http.Error(w, "no", http.StatusUnauthorized)
	}))
	defer ts.Close()
	body, _ := json.Marshal(map[string]any{"server": map[string]any{"baseUrl": ts.URL, "enabled": true}})
	serveUnraid(h, "POST", "/api/unraid/test", string(body))
	mu.Lock()
	defer mu.Unlock()
	if len(keys) == 0 {
		t.Fatal("the test server was never asked")
	}
	for _, k := range keys {
		if k != "" {
			t.Fatalf("the saved key went to another address: %q", k)
		}
	}
}

func TestUnraidSettingsPutDropsTheKeyForANewAddress(t *testing.T) {
	h := unraidTestHandlers(t)
	rec := serveUnraid(h, "PUT", "/api/unraid/settings", `{"server":{"id":"srv","name":"tower","baseUrl":"http://elsewhere","enabled":true}}`)
	var got struct {
		KeySet bool `json:"keySet"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != 200 || got.KeySet || unraidAPIKey("srv") != "" {
		t.Fatalf("code=%d body=%s key=%q", rec.Code, rec.Body, unraidAPIKey("srv"))
	}
}

// A key that may not read me still reads the server: the role is then
// inferred from the areas, as the spec says, and the test does not fail.
func TestUnraidInfoSurvivesAForbiddenMe(t *testing.T) {
	h := unraidTestHandlers(t)
	dir := t.TempDir()
	intro, err := os.ReadFile("testdata/unraid/introspection.json")
	if err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "introspection.json"), intro, 0o644)
	_ = os.WriteFile(filepath.Join(dir, "info.json"), []byte(`{"data":{"info":{"os":{"hostname":"tower"},"versions":{"core":{"unraid":"7.2.1","api":"4.37.5"}}},"me":null},
	  "errors":[{"message":"Forbidden resource","path":["me"],"extensions":{"code":"FORBIDDEN"}}]}`), 0o644)
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", dir)
	forgetUnraidSchema("me-test")
	defer forgetUnraidSchema("me-test")
	v, status, err := h.fetchUnraidArea(context.Background(), UnraidServer{ID: "me-test", BaseURL: "http://tower"}, "k", "info")
	if status != "ok" || err != nil {
		t.Fatalf("status=%s err=%v", status, err)
	}
	if info := v.(UnraidInfoView); info.Name != "tower" || len(info.Roles) != 0 {
		t.Fatalf("info = %+v", info)
	}
}

// The dashboard saves every setting it loaded with the page. The Unraid server
// is owned by /api/unraid/settings, so a page loaded before it was changed
// must not put the old one back.
func TestGenericSettingsSaveLeavesTheUnraidServerAlone(t *testing.T) {
	h := unraidTestHandlers(t)
	body := `{"bookmarkStaleDays":9,"unraidServers":[{"id":"srv","name":"old","baseUrl":"http://old-tower","enabled":false}]}`
	rec := httptest.NewRecorder()
	h.SaveSettings(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("code=%d body=%s", rec.Code, rec.Body)
	}
	got := h.store.GetSettings()
	if got.BookmarkStaleDays != 9 {
		t.Fatalf("the rest of the save was lost: %d", got.BookmarkStaleDays)
	}
	if len(got.UnraidServers) != 1 || got.UnraidServers[0].BaseURL != "http://tower" || !got.UnraidServers[0].Enabled {
		t.Fatalf("unraid server = %+v", got.UnraidServers)
	}
	rec = httptest.NewRecorder()
	h.SaveSettings(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"unraidServers":[]}`)))
	if got := h.store.GetSettings(); len(got.UnraidServers) != 1 {
		t.Fatalf("an empty list removed the server: %+v", got.UnraidServers)
	}
}
