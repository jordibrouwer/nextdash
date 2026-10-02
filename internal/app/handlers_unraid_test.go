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
	"time"

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

func TestUnraidOverviewStatusFollowsItsAreas(t *testing.T) {
	arr := UnraidArrayView{State: "STARTED", Started: true}
	t.Run("a refused key", func(t *testing.T) {
		r := composeUnraidOverviewFrom([]unraidAreaResult{
			{Area: "info", Status: "unauthorized", Error: errUnraidUnauthorized.Error()},
			{Area: "array", Status: "unauthorized", Error: errUnraidUnauthorized.Error()},
			{Area: "vms", Status: "forbidden"},
			{Area: "ups", Status: "unsupported"},
		})
		if r.Status != "unauthorized" || r.Error == "" {
			t.Fatalf("r = %+v", r)
		}
	})
	t.Run("out of reach keeps the last reading and its oldest age", func(t *testing.T) {
		r := composeUnraidOverviewFrom([]unraidAreaResult{
			{Area: "info", Status: "unreachable", Data: UnraidInfoView{Name: "tower"}, FetchedAt: 9000, LastOkAt: 5000, Error: "unraid: no answer"},
			{Area: "array", Status: "unreachable", Data: arr, FetchedAt: 9000, LastOkAt: 3000},
			{Area: "parity", Status: "unreachable"}, // never read: not used, not counted in the age
			{Area: "vms", Status: "forbidden"},
		})
		o, ok := r.Data.(UnraidOverviewView)
		if r.Status != "unreachable" || !ok || o.Array == nil || o.Info.Name != "tower" || r.LastOkAt != 3000 || r.Error == "" {
			t.Fatalf("r = %+v", r)
		}
	})
	t.Run("never read carries no data", func(t *testing.T) {
		r := composeUnraidOverviewFrom([]unraidAreaResult{{Area: "info", Status: "unreachable"}, {Area: "array", Status: "unreachable"}})
		if r.Status != "unreachable" || r.Data != nil {
			t.Fatalf("r = %+v", r)
		}
	})
	t.Run("every area missing", func(t *testing.T) {
		r := composeUnraidOverviewFrom([]unraidAreaResult{{Area: "info", Status: "forbidden"}, {Area: "array", Status: "unsupported"}})
		if r.Status != "unsupported" || r.Data != nil {
			t.Fatalf("r = %+v", r)
		}
	})
	t.Run("one area answering is enough", func(t *testing.T) {
		r := composeUnraidOverviewFrom([]unraidAreaResult{
			{Area: "array", Status: "ok", Data: arr, FetchedAt: 8000, LastOkAt: 8000},
			{Area: "info", Status: "unreachable", Data: UnraidInfoView{Name: "tower"}, FetchedAt: 9000, LastOkAt: 4000},
		})
		if r.Status != "ok" || r.LastOkAt != 4000 || r.FetchedAt != 8000 {
			t.Fatalf("r = %+v", r)
		}
	})
}

// Through the route: a server that refuses the key makes the overview say so,
// instead of an "ok" with nothing in it.
func TestUnraidOverviewSaysTheKeyWasRefused(t *testing.T) {
	h := unraidTestHandlers(t)
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no", http.StatusUnauthorized)
	}))
	defer ts.Close()
	s := h.store.GetSettings()
	s.UnraidServers[0].BaseURL = ts.URL
	_ = h.store.SaveSettings(s)
	forgetUnraidSchema("srv")
	defer forgetUnraidSchema("srv")
	rec := serveUnraid(h, "GET", "/api/unraid/area/overview", "")
	var got unraidAreaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Status != "unauthorized" {
		t.Fatalf("body = %s", rec.Body)
	}
}

// The overview asks its areas at once: a slow server costs one round, not
// seven, and the schema is asked once however many areas want it.
func TestUnraidOverviewAsksItsAreasAtOnce(t *testing.T) {
	h := unraidTestHandlers(t)
	t.Setenv("NEXTDASH_UNRAID_FIXTURE", "")
	var mu sync.Mutex
	introspections := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		m := unraidAreaComment.FindStringSubmatch(strings.TrimSpace(body.Query))
		if m == nil {
			http.Error(w, "no area", http.StatusBadRequest)
			return
		}
		if m[1] == "introspection" {
			mu.Lock()
			introspections++
			mu.Unlock()
		}
		time.Sleep(300 * time.Millisecond)
		raw, err := os.ReadFile(filepath.Join("testdata/unraid", m[1]+".json"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
	}))
	defer ts.Close()
	s := h.store.GetSettings()
	s.UnraidServers[0].BaseURL = ts.URL
	_ = h.store.SaveSettings(s)
	forgetUnraidSchema("srv")
	defer forgetUnraidSchema("srv")
	start := time.Now()
	rec := serveUnraid(h, "GET", "/api/unraid/area/overview", "")
	took := time.Since(start)
	var got unraidAreaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.Status != "ok" {
		t.Fatalf("body = %s", rec.Body)
	}
	// Schema once (300 ms), then seven areas side by side (300 ms); in a row
	// it would be 2.4 s.
	if took > 1500*time.Millisecond {
		t.Fatalf("the overview took %v: its areas were asked one after another", took)
	}
	mu.Lock()
	defer mu.Unlock()
	if introspections != 1 {
		t.Fatalf("the schema was asked %d times", introspections)
	}
}
