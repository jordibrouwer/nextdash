package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func iconAPIJSON(t *testing.T, rec *httptest.ResponseRecorder, into any) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatal(err)
	}
}

func TestIconSetsMatchHandler(t *testing.T) {
	h := newTestHandlers(t)
	useIconSetsFixture(t)
	s := h.store.GetSettings()
	// What the Containers view stores when a container is tied to a bookmark.
	s.DockerBookmarkLinks = map[string]string{"AdGuard-Home-Unbound": "1::http://192.168.0.3"}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}

	body := `{"urls":["https://sonarr.tailae75e.ts.net","https://github.com","http://192.168.0.3/"]}`
	rec := httptest.NewRecorder()
	h.IconSetsMatchHandler(rec, httptest.NewRequest(http.MethodPost, "/api/icon-sets/match", strings.NewReader(body)))
	var got struct {
		Matches map[string]iconSetRef `json:"matches"`
	}
	iconAPIJSON(t, rec, &got)
	sonarr, ok := got.Matches["https://sonarr.tailae75e.ts.net"]
	if !ok || sonarr.Base != "/data/icon-sets/dashboard-icons/sonarr.svg" || sonarr.Dark != "/data/icon-sets/dashboard-icons/sonarr-dark.svg" {
		t.Fatalf("sonarr: %+v", got.Matches)
	}
	if _, ok := got.Matches["https://github.com"]; ok {
		t.Fatal("a public two-label domain keeps its favicon")
	}
	// No Docker in a test: the linked container's name alone carries it.
	if got.Matches["http://192.168.0.3/"].Name != "adguard-home" {
		t.Fatalf("linked IP bookmark: %+v", got.Matches)
	}
}

func TestIconSetsSearchHandler(t *testing.T) {
	h := newTestHandlers(t)
	useIconSetsFixture(t)
	rec := httptest.NewRecorder()
	h.IconSetsSearchHandler(rec, httptest.NewRequest(http.MethodGet, "/api/icon-sets/search?q=jelly", nil))
	var got struct {
		Unavailable bool         `json:"unavailable"`
		Results     []iconSetRef `json:"results"`
	}
	iconAPIJSON(t, rec, &got)
	if got.Unavailable || len(got.Results) == 0 || got.Results[0].Name != "jellyfin" {
		t.Fatalf("%+v", got)
	}

	t.Setenv("DISABLE_ICON_SETS", "1")
	rec = httptest.NewRecorder()
	h.IconSetsSearchHandler(rec, httptest.NewRequest(http.MethodGet, "/api/icon-sets/search?q=jelly", nil))
	got.Results = nil
	iconAPIJSON(t, rec, &got)
	if !got.Unavailable || len(got.Results) != 0 {
		t.Fatalf("disabled: %+v", got)
	}
}

func TestIconSetsSuggestHandler(t *testing.T) {
	h := newTestHandlers(t)
	useIconSetsFixture(t)
	rec := httptest.NewRecorder()
	h.IconSetsSuggestHandler(rec, httptest.NewRequest(http.MethodGet, "/api/icon-sets/suggest?url=https%3A%2F%2Fsonarr.example.ts.net", nil))
	var got struct {
		Results []iconSetRef `json:"results"`
	}
	iconAPIJSON(t, rec, &got)
	if len(got.Results) != 2 || got.Results[0].Set != iconSetDashboard || got.Results[1].Set != iconSetSelfhst {
		t.Fatalf("%+v", got.Results)
	}
}

func TestIconSetsAdoptHandler(t *testing.T) {
	h := newTestHandlers(t)
	useIconSetsFixture(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	post := func(body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/icon-sets/adopt", strings.NewReader(body))
		if token != "" {
			req.Header.Set("X-NextDash-Token", token)
		}
		rec := httptest.NewRecorder()
		h.IconSetsAdoptHandler(rec, req)
		return rec
	}
	if rec := post(`{"set":"dashboard-icons","name":"sonarr","variant":"dark"}`, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", rec.Code)
	}
	rec := post(`{"set":"dashboard-icons","name":"sonarr","variant":"dark"}`, "secret")
	var got struct {
		Icon string `json:"icon"`
	}
	iconAPIJSON(t, rec, &got)
	if got.Icon != "sonarr-dark.svg" {
		t.Fatalf("%q", got.Icon)
	}
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "icons", got.Icon)); err != nil {
		t.Fatal("adopted file missing")
	}
	// selfh.st's sonarr, although dashboard-icons owns every key it has.
	rec = post(`{"set":"selfhst","name":"sonarr"}`, "secret")
	iconAPIJSON(t, rec, &got)
	if got.Icon != "sonarr.svg" {
		t.Fatalf("selfhst: %q", got.Icon)
	}
	if rec := post(`{"set":"dashboard-icons","name":"jellyfin","variant":"dark"}`, "secret"); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing variant: %d", rec.Code)
	}
	if rec := post(`{"set":"dashboard-icons","name":"../settings"}`, "secret"); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown name: %d", rec.Code)
	}
}
