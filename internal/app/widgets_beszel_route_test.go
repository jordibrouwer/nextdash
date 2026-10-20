package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func beszelStoredWidget(t *testing.T, h *Handlers, fake *fakeBeszel, widgetType WidgetType, config map[string]any) Widget {
	t.Helper()
	widget := beszelSetUp(t, h, fake, widgetType, config)
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	return widget
}

func TestBeszelRoutesServeEachTile(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)

	for _, tile := range []struct {
		widgetType WidgetType
		config     map[string]any
		items      int
	}{
		{WidgetTypeBeszel, nil, 3},
		{WidgetTypeBeszelSystem, map[string]any{"system": "sys000000000002"}, 1},
		{WidgetTypeBeszelAttention, nil, 1},
		{WidgetTypeBeszelStorage, nil, 2},
	} {
		widget := beszelStoredWidget(t, h, fake, tile.widgetType, tile.config)
		rec := httptest.NewRecorder()
		h.beszelWidgetHandler(tile.widgetType)(rec, httptest.NewRequest(http.MethodGet,
			"/api/widgets/"+string(tile.widgetType)+"?pageId=1&id="+widget.ID, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tile.widgetType, rec.Code)
		}
		var result MediaResult
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Error != "" || len(result.Items) != tile.items || result.Counts["down"] != map[bool]int{true: 0, false: 1}[tile.widgetType == WidgetTypeBeszelSystem] {
			t.Errorf("%s: %d items, counts %v, error %q", tile.widgetType, len(result.Items), result.Counts, result.Error)
		}
		body := rec.Body.String()
		for _, secret := range []string{"jwt-token", beszelTestPassword, beszelTestUser, "usr000000000001"} {
			if strings.Contains(body, secret) {
				t.Errorf("%s: %q reached the response", tile.widgetType, secret)
			}
		}

		// Each route answers for its own type only.
		other := httptest.NewRecorder()
		wrong := WidgetTypeBeszel
		if tile.widgetType == WidgetTypeBeszel {
			wrong = WidgetTypeBeszelStorage
		}
		h.beszelWidgetHandler(wrong)(other, httptest.NewRequest(http.MethodGet,
			"/api/widgets/"+string(wrong)+"?pageId=1&id="+widget.ID, nil))
		if other.Code != http.StatusNotFound {
			t.Errorf("%s route answered for a %s widget: %d", wrong, tile.widgetType, other.Code)
		}
	}
}

// Beszel's tokenless view of a page never learns the hub or its systems.
func TestBeszelSetupNeedsTheTokenAndListsTheSystems(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeBeszel(t)
	body := func(password string) string {
		raw, _ := json.Marshal(map[string]any{"server": fake.URL, "draftCredential": map[string]any{"session": map[string]any{
			"format": "json", "loginPath": "/api/collections/users/auth-with-password",
			"userField": "identity", "passField": "password", "user": beszelTestUser, "password": password,
			"tokenPath": "token", "tokenHeader": "Authorization", "tokenPrefix": ""}}})
		return string(raw)
	}
	post := func(payload string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.beszelSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/beszel/setup", strings.NewReader(payload)))
		return rec
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if rec := post(body(beszelTestPassword)); rec.Code != http.StatusUnauthorized || fake.logins != 0 {
		t.Fatalf("without the write token: %d, %d logins", rec.Code, fake.logins)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec := post(body(beszelTestPassword))
	var answer struct {
		Connected string `json:"connected"`
		Systems   []struct {
			ID, Name, Status string
		} `json:"systems"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.Connected != "3 systems" || len(answer.Systems) != 3 {
		t.Fatalf("setup: %+v", answer)
	}
	if got := answer.Systems[0]; got.ID != "sys000000000002" || got.Name != "htpc" || got.Status != "up" {
		t.Errorf("first system: %+v", got)
	}
	if strings.Contains(rec.Body.String(), beszelTestPassword) || strings.Contains(rec.Body.String(), "jwt-token") {
		t.Errorf("the answer carries the password or the token")
	}

	wrong := post(body("not-the-password"))
	if !strings.Contains(wrong.Body.String(), `"error":"key refused"`) || strings.Contains(wrong.Body.String(), `"connected"`) {
		t.Errorf("wrong password: %s", wrong.Body.String())
	}

	// A hub that cannot be reached is unreachable, not a wrong password: the
	// first report of this feature was "refused that sign-in" over a host the
	// server had no route to, with the password right all along.
	gone := httptest.NewServer(http.NotFoundHandler())
	goneURL := gone.URL
	gone.Close()
	raw, _ := json.Marshal(map[string]any{"server": goneURL, "draftCredential": map[string]any{"session": map[string]any{
		"format": "json", "loginPath": "/api/collections/users/auth-with-password",
		"userField": "identity", "passField": "password", "user": beszelTestUser, "password": beszelTestPassword,
		"tokenPath": "token", "tokenHeader": "Authorization", "tokenPrefix": ""}}})
	if away := post(string(raw)); !strings.Contains(away.Body.String(), `"error":"unreachable"`) {
		t.Errorf("a hub that does not answer: %s", away.Body.String())
	}

	// A hub with one system says so in the singular.
	fake.setSystems(t, func(items []map[string]any) []map[string]any { return items[:1] })
	if one := post(body(beszelTestPassword)); !strings.Contains(one.Body.String(), `"connected":"1 system"`) {
		t.Errorf("one system: %s", one.Body.String())
	}
}

func TestBeszelSetupIsDeniedInTheDemo(t *testing.T) {
	found := false
	for _, route := range demoDeniedWrites {
		found = found || route == "/api/widgets/beszel/setup"
	}
	if !found {
		t.Error("the demo lets a visitor make the server sign in anywhere")
	}
}

// A page template carries the hub as a variable and leaves the ids behind: a
// system id names nothing on another hub.
func TestBeszelTravelsWithoutItsSystems(t *testing.T) {
	for _, wt := range []WidgetType{WidgetTypeBeszel, WidgetTypeBeszelSystem, WidgetTypeBeszelAttention, WidgetTypeBeszelStorage} {
		urls := templateWidgetURLs(Widget{Type: wt, Config: map[string]any{"server": "http://beszel.lan:8090"}})
		if len(urls) != 1 || urls[0] != "http://beszel.lan:8090" {
			t.Errorf("%s: template addresses %v", wt, urls)
		}
	}
}
