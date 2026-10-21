package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGlancesWidgetRoute(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	mediaForgetAll()
	srv := glancesFixtureServer(t, nil)
	widget := Widget{ID: "w_glances0010", Type: WidgetTypeGlances, Config: map[string]any{"server": srv.URL}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	get := func(id string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.glancesWidgetHandler(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/glances?pageId=1&id="+id, nil))
		return rec
	}
	rec := get(widget.ID)
	var result MediaResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || result.Error != "" || len(result.Items) != 1 || result.Items[0].Meters == nil {
		t.Fatalf("route: %d %+v", rec.Code, result)
	}
	if rec := get("w_nothere0000"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown id: %d", rec.Code)
	}
}

func TestGlancesSetupRoute(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fixtures := glancesFixtureServer(t, nil)
	guarded := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, pass, ok := r.BasicAuth(); !ok || user != "reader" || pass != "pw" {
			http.Error(w, "no", http.StatusUnauthorized)
			return
		}
		fixtures.Config.Handler.ServeHTTP(w, r)
	}))
	defer guarded.Close()
	post := func(payload map[string]any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(payload)
		rec := httptest.NewRecorder()
		h.glancesSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/glances/setup", strings.NewReader(string(raw))))
		return rec
	}
	draft := func(password string) map[string]any {
		return map[string]any{"basicUser": "reader", "basicPassword": password}
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if rec := post(map[string]any{"server": fixtures.URL}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the write token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec := post(map[string]any{"server": guarded.URL, "draftCredential": draft("pw")})
	var answer struct {
		Connected   string   `json:"connected"`
		Plugins     []string `json:"plugins"`
		Filesystems []struct {
			Name string `json:"name"`
		} `json:"filesystems"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.Connected != "Glances 4.x" || len(answer.Plugins) == 0 {
		t.Fatalf("setup: %+v", answer)
	}
	names := map[string]bool{}
	for _, fs := range answer.Filesystems {
		names[fs.Name] = true
	}
	if !names["/"] || !names["/mnt/data"] || names["/run"] || names["/dev"] {
		t.Errorf("filesystems: %v", names)
	}
	if strings.Contains(rec.Body.String(), "pw\"") {
		t.Errorf("the answer carries the password")
	}

	wrong := post(map[string]any{"server": guarded.URL, "draftCredential": draft("nope")})
	if !strings.Contains(wrong.Body.String(), `"error":"login refused"`) || strings.Contains(wrong.Body.String(), `"connected"`) {
		t.Errorf("wrong password: %s", wrong.Body.String())
	}

	allowLocalForTest(t, h, false)
	if blocked := post(map[string]any{"server": fixtures.URL}); !strings.Contains(blocked.Body.String(), `"error":"address not allowed"`) {
		t.Errorf("local address off: %s", blocked.Body.String())
	}
}

func TestGlancesWithholdsServerAndCredential(t *testing.T) {
	for _, key := range []string{"server", "credentialId"} {
		if !withheldWidgetKeys[WidgetTypeGlances][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
}

func TestGlancesRegistered(t *testing.T) {
	if !strings.Contains(strings.Join(widgetTypeNames(), ","), "glances") {
		t.Error("glances is not in widgetTypeNames")
	}
	if len(widgetFields[WidgetTypeGlances]) == 0 {
		t.Error("glances has no fields")
	}
}

func TestGlancesLoopbackIsOnlyLo(t *testing.T) {
	if !glancesVirtualNIC("lo") || glancesVirtualNIC("lowpan0") {
		t.Error("only the interface named lo is loopback; lowpan0 is a real link")
	}
}

// In the demo no dial leaves the server (ssrfSafeDialContext), so a tile and
// a view answer with an error, as every other service tile does, and the
// Glances host is never reached, even when the settings allow local hosts.
func TestGlancesDemoMakesNoRequest(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	mediaForgetAll()
	glancesViewForgetAll()
	hit := false
	srv := glancesFixtureServer(t, func(*http.Request) { hit = true })
	widget := Widget{ID: "w_glances0020", Type: WidgetTypeGlances, Config: map[string]any{"server": srv.URL}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.glancesWidgetHandler(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/glances?pageId=1&id="+widget.ID, nil))
	var result MediaResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || result.Error == "" || len(result.Items) != 0 {
		t.Errorf("tile in the demo: %d %s", rec.Code, rec.Body.String())
	}

	rec = httptest.NewRecorder()
	h.glancesViewHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/"+widget.ID+"/processlist?pageId=1", nil))
	var view map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || view["error"] == nil {
		t.Errorf("view in the demo: %d %s", rec.Code, rec.Body.String())
	}

	if hit {
		t.Error("the demo reached a Glances host")
	}
	if !demoDeniedWrite("/api/widgets/glances/setup") {
		t.Error("the demo lets a visitor make the server sign in anywhere")
	}
}

func demoDeniedWrite(route string) bool {
	for _, denied := range demoDeniedWrites {
		if denied == route {
			return true
		}
	}
	return false
}
