package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func statusOwner(t *testing.T, h *Handlers, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	switch {
	case path == "/api/status-page" && method == "GET":
		h.GetStatusPage(rec, req)
	case path == "/api/status-page" && method == "PUT":
		h.SaveStatusPage(rec, req)
	case path == "/api/status-page/token":
		h.NewStatusPageLink(rec, req)
	case path == "/api/status-page/sources":
		h.StatusPageSources(rec, req)
	}
	return rec
}

func TestStatusPageOwnerRoutesNeedTheWriteToken(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-write-token")
	fakeStatusContainers(t, nil, nil)
	for _, c := range [][2]string{{"GET", "/api/status-page"}, {"PUT", "/api/status-page"}, {"POST", "/api/status-page/token"}, {"GET", "/api/status-page/sources"}} {
		if rec := statusOwner(t, h, c[0], c[1], `{}`, ""); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without token = %d, want 401", c[0], c[1], rec.Code)
		}
	}
	if rec := statusOwner(t, h, "GET", "/api/status-page", "", "secret-write-token"); rec.Code != 200 {
		t.Errorf("with token = %d", rec.Code)
	}
}

func TestStatusPageSaveEnablesAndNamesServices(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	seedMonitoredBookmark(t, h, "https://jf.home.lan", "Jellyfin")
	rec := statusOwner(t, h, "PUT", "/api/status-page",
		`{"enabled":true,"title":" Home ","groups":[{"name":"Media","services":[{"monitorUrl":"https://jf.home.lan"}]}]}`, "")
	var out struct {
		Config StatusPageConfig `json:"config"`
		Path   string           `json:"path"`
	}
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body.String())
	}
	if out.Config.Title != "Home" || out.Config.Groups[0].Services[0].Name != "Jellyfin" {
		t.Fatalf("not normalised/named: %+v", out.Config)
	}
	if !strings.HasPrefix(out.Path, "/s/") || len(out.Path) < 3+statusTokenMinLen {
		t.Fatalf("enabling must create a link, got %q", out.Path)
	}
}

func TestStatusPageNewLinkStopsTheOldOne(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	statusOwner(t, h, "PUT", "/api/status-page", `{"enabled":true}`, "")
	old := readStatusToken()
	rec := statusOwner(t, h, "POST", "/api/status-page/token", "", "")
	var out struct{ Path string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Path == "/s/"+old || statusTokenMatches(old) || !statusTokenMatches(strings.TrimPrefix(out.Path, "/s/")) {
		t.Fatal("new link must replace the old one at once")
	}
}

func TestStatusPageSaveOfDeletedGroupUnlinksMaintenance(t *testing.T) {
	h := newTestHandlers(t)
	fakeStatusContainers(t, nil, nil)
	statusOwner(t, h, "PUT", "/api/status-page", `{"groups":[{"id":"media","name":"Media","services":[{"container":"jf"}]},{"id":"home","name":"Home","services":[{"container":"ha"}]}]}`, "")
	s := h.store.GetSettings()
	s.MaintenanceWindows = []MaintenanceWindow{{Start: "02:00", End: "04:00", StatusGroups: []string{"media", "home"}}}
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}
	statusOwner(t, h, "PUT", "/api/status-page", `{"groups":[{"id":"home","name":"Home","services":[{"container":"ha"}]}]}`, "")
	got := h.store.GetSettings().MaintenanceWindows[0].StatusGroups
	if len(got) != 1 || got[0] != "home" {
		t.Fatalf("statusGroups = %v, want [home]", got)
	}
}

func TestStatusPageSourcesListOnlyMonitors(t *testing.T) {
	h := newTestHandlers(t)
	seedMonitoredBookmark(t, h, "https://vault.home.lan", "Vault")
	pages := h.store.GetPages()
	_ = h.store.AddBookmarkToPage(pages[0].ID, Bookmark{Name: "Plain", URL: "https://plain.example"})
	rec := statusOwner(t, h, "GET", "/api/status-page/sources", "", "")
	body := rec.Body.String()
	if !strings.Contains(body, "vault.home.lan") || strings.Contains(body, "plain.example") {
		t.Fatalf("sources = %s", body)
	}
}

func TestStatusPageGetReportsInvalidFile(t *testing.T) {
	h := newTestHandlers(t)
	if err := writeFileAtomic(statusPageFilePath(), []byte("{nope"), 0644); err != nil {
		t.Fatal(err)
	}
	rec := statusOwner(t, h, "GET", "/api/status-page", "", "")
	if !strings.Contains(rec.Body.String(), `"loadError":"`) || strings.Contains(rec.Body.String(), `"loadError":""`) {
		t.Fatalf("load error not reported: %s", rec.Body.String())
	}
}

func TestStatusPageAfterRestoreGetsANewLink(t *testing.T) {
	h := newTestHandlers(t)
	// What a restore leaves: the layout, switched on, and no secrets file.
	if err := writeStatusPage(StatusPageConfig{Enabled: true, Title: "Home"}); err != nil {
		t.Fatal(err)
	}
	rec := statusOwner(t, h, "GET", "/api/status-page", "", "")
	var out struct{ Path string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !strings.HasPrefix(out.Path, "/s/") || !statusTokenMatches(strings.TrimPrefix(out.Path, "/s/")) {
		t.Fatalf("an enabled page without a link must get one when Config opens, got %q", out.Path)
	}
}
