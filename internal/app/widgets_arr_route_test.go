package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func arrTestWidget(t *testing.T, h *Handlers, fake *fakeArr, wt WidgetType) string {
	t.Helper()
	arrTestSpec(t, h, fake, nil)
	widget := Widget{ID: "w_arr000000001", Type: wt, Title: "Arr", Config: map[string]any{
		"server": fake.URL, "credentialId": "widget:w_arr000000001"}}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return widget.ID
}

func TestArrRoutesServeTheTileAndItsPosters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeArr(t)
	fake.calendar, fake.queue = sonarrCalendar(), sonarrQueue
	id := arrTestWidget(t, h, fake, WidgetTypeSonarr)

	rec := httptest.NewRecorder()
	h.arrWidgetHandler(arrSonarr, WidgetTypeSonarr)(rec, httptest.NewRequest(http.MethodGet, "/api/widgets/sonarr?pageId=1&id="+id, nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), arrTestKey) {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var result MediaResult
	_ = json.Unmarshal(rec.Body.Bytes(), &result)
	if len(result.Items) != 2 || !strings.HasPrefix(result.Items[0].Poster, "/api/widgets/sonarr/image?") {
		t.Fatalf("result = %+v", result)
	}

	image := httptest.NewRecorder()
	h.arrImageHandler(arrSonarr)(image, httptest.NewRequest(http.MethodGet, result.Items[0].Poster, nil))
	if image.Code != http.StatusOK || image.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("poster: %d %q", image.Code, image.Header().Get("Content-Type"))
	}
	refused := httptest.NewRecorder()
	h.arrImageHandler(arrSonarr)(refused, httptest.NewRequest(http.MethodGet,
		"/api/widgets/sonarr/image?pageId=1&id="+id+"&item=7&kind=poster&tag=other", nil))
	if refused.Code != http.StatusNotFound {
		t.Errorf("an unoffered tag answered %d", refused.Code)
	}
	// Radarr's route does not answer for a Sonarr widget.
	other := httptest.NewRecorder()
	h.arrWidgetHandler(arrRadarr, WidgetTypeRadarr)(other, httptest.NewRequest(http.MethodGet, "/api/widgets/radarr?pageId=1&id="+id, nil))
	if other.Code != http.StatusNotFound {
		t.Errorf("radarr route answered for a sonarr widget: %d", other.Code)
	}
}

func TestArrSetupNeedsTheTokenAndNamesTheServer(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeArr(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"X-Api-Key":"` + arrTestKey + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.arrSetupHandler(arrSonarr)(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/sonarr/setup", strings.NewReader(body)))
	if rec.Code != http.StatusUnauthorized || fake.saw("/system/status") {
		t.Fatalf("no token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.arrSetupHandler(arrSonarr)(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/sonarr/setup", strings.NewReader(body)))
	var answer struct {
		ServerName string `json:"serverName"`
		Version    string `json:"version"`
		Error      string `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if answer.ServerName != "Sonarr" || answer.Version != "4.0.9" || answer.Error != "" {
		t.Fatalf("answer = %+v (%s)", answer, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), arrTestKey) {
		t.Error("the key came back")
	}
}
