package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

const haTestToken = "ha-token-0123456789"

// fakeHomeAssistant answers from testdata/homeassistant: shapes recorded from
// a real Home Assistant 2026.10, names, ids and rooms replaced.
type fakeHomeAssistant struct {
	*httptest.Server
	mu           sync.Mutex
	paths        []string
	templates    []string
	services     []string
	templateFail bool
	states       []byte
}

func readHAFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "homeassistant", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeHomeAssistant(t *testing.T) *fakeHomeAssistant {
	t.Helper()
	areas := readHAFixture(t, "template.json")
	config := readHAFixture(t, "config.json")
	fake := &fakeHomeAssistant{states: readHAFixture(t, "states.json")}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.paths = append(fake.paths, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer "+haTestToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/states":
			_, _ = w.Write(fake.states)
		case r.Method == http.MethodGet && r.URL.Path == "/api/config":
			_, _ = w.Write(config)
		case r.Method == http.MethodPost && r.URL.Path == "/api/template":
			var body struct {
				Template string `json:"template"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			fake.templates = append(fake.templates, body.Template)
			if fake.templateFail {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			// Home Assistant answers a template as text.
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write(areas)
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/services/"):
			raw, _ := io.ReadAll(r.Body)
			fake.services = append(fake.services, r.URL.Path+" "+string(raw))
			var body struct {
				EntityID string `json:"entity_id"`
			}
			_ = json.Unmarshal(raw, &body)
			_, _ = w.Write([]byte(`[{"entity_id":"` + body.EntityID + `","state":"off","attributes":{}}]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeHomeAssistant) count(prefix string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, p := range f.paths {
		if strings.HasPrefix(p, prefix) {
			n++
		}
	}
	return n
}

var haTestEntities = []any{"light.ceiling", "switch.coffee", "sensor.temperature", "scene.movie_night",
	"light.garden", "lock.front_door", "cover.garage", "binary_sensor.back_door", "sensor.gone"}

const haTestWidget = "w_hass00000001"

func haTestConfig(fake *fakeHomeAssistant, extra map[string]any) map[string]any {
	config := map[string]any{"server": fake.URL, "credentialId": "widget:" + haTestWidget,
		"entities": haTestEntities, "rows": float64(20)}
	for k, v := range extra {
		config[k] = v
	}
	return sanitizeWidgetConfig(WidgetTypeHomeAssistant, config)
}

func haTestSpec(t *testing.T, h *Handlers, fake *fakeHomeAssistant, extra map[string]any) haSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:"+haTestWidget, HealthCredential{
		Label: "Home Assistant", Headers: map[string]string{"Authorization": "Bearer " + haTestToken},
	}); err != nil {
		t.Fatal(err)
	}
	return haSpecFrom(haTestConfig(fake, extra))
}

// haTestPage saves one Home Assistant widget on page 1, for the routes.
func haTestPage(t *testing.T, h *Handlers, fake *fakeHomeAssistant) {
	t.Helper()
	haTestSpec(t, h, fake, nil)
	widget := Widget{ID: haTestWidget, Type: WidgetTypeHomeAssistant, Title: "House", Config: haTestConfig(fake, nil)}
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
}

func haItem(t *testing.T, items []MediaItem, id string) MediaItem {
	t.Helper()
	for _, item := range items {
		if item.ID == id {
			return item
		}
	}
	t.Fatalf("no %s among %d items", id, len(items))
	return MediaItem{}
}

func TestHomeAssistantReadsChosenEntities(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	spec := haTestSpec(t, h, fake, nil)

	result, err := h.fetchHomeAssistant(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != len(haTestEntities) {
		t.Fatalf("%d items for %d chosen", len(result.Items), len(haTestEntities))
	}
	for _, item := range result.Items {
		if item.ID == "switch.unchosen" {
			t.Errorf("an entity nobody chose is shown")
		}
	}
	lamp := haItem(t, result.Items, "light.ceiling")
	if lamp.Title != "Ceiling light" || lamp.Control != "toggle" || !lamp.On || lamp.Icon != "light" || lamp.AddedAt == 0 ||
		lamp.OpenURL != fake.URL+"/history?entity_id=light.ceiling" || lamp.LibraryID != "none" {
		t.Errorf("lamp: %+v", lamp)
	}
	coffee := haItem(t, result.Items, "switch.coffee")
	if coffee.Library != "Living room" || coffee.Control != "toggle" || !coffee.On {
		t.Errorf("switch: %+v", coffee)
	}
	temp := haItem(t, result.Items, "sensor.temperature")
	if temp.Value != "19.0 °C" || temp.Control != "" || temp.Icon != "temperature" || temp.Library != "Kitchen" {
		t.Errorf("sensor: %+v", temp)
	}
	scene := haItem(t, result.Items, "scene.movie_night")
	if scene.Control != "run" || scene.Value != "" {
		t.Errorf("scene: %+v", scene)
	}
	door := haItem(t, result.Items, "binary_sensor.back_door")
	if door.Value != "off" || door.Icon != "door" || door.Control != "" {
		t.Errorf("door: %+v", door)
	}
	// Looked at, never switched from here.
	for _, id := range []string{"lock.front_door", "cover.garage"} {
		if item := haItem(t, result.Items, id); item.Control != "" || item.Value == "" {
			t.Errorf("%s: %+v", id, item)
		}
	}
	garden := haItem(t, result.Items, "light.garden")
	if !garden.Unavailable || garden.Control != "" {
		t.Errorf("unavailable: %+v", garden)
	}
	gone := haItem(t, result.Items, "sensor.gone")
	if !gone.Missing || gone.Title != "sensor.gone" || gone.Control != "" {
		t.Errorf("missing: %+v", gone)
	}

	// Rooms by name, no room last.
	var names []string
	for _, g := range result.Libraries {
		names = append(names, g.Name)
	}
	if strings.Join(names, ",") != "Hallway,Kitchen,Living room,No area" {
		t.Errorf("groups: %v", names)
	}
}

func TestHomeAssistantGroupsByDomainOrNone(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)

	result, err := h.fetchHomeAssistant(context.Background(), haTestSpec(t, h, fake, map[string]any{"groupBy": "domain"}))
	if err != nil {
		t.Fatal(err)
	}
	if haItem(t, result.Items, "light.ceiling").LibraryID != "light" || haItem(t, result.Items, "sensor.gone").LibraryID != "sensor" {
		t.Errorf("by domain: %+v", result.Libraries)
	}
	if fake.count("POST /api/template") != 0 {
		t.Errorf("rooms asked for although nothing groups by them")
	}

	result, _ = h.fetchHomeAssistant(context.Background(), haTestSpec(t, h, fake, map[string]any{"groupBy": "none"}))
	if len(result.Libraries) != 1 || len(result.Items) != len(haTestEntities) {
		t.Errorf("one group: %+v", result.Libraries)
	}
	// The reader's own order, when nothing else orders them.
	if result.Items[0].ID != "light.ceiling" || result.Items[1].ID != "switch.coffee" {
		t.Errorf("order: %s, %s", result.Items[0].ID, result.Items[1].ID)
	}
}

func TestHomeAssistantRoomsFailFallsBackToDomain(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	fake.templateFail = true
	result, err := h.fetchHomeAssistant(context.Background(), haTestSpec(t, h, fake, nil))
	if err != nil {
		t.Fatal(err)
	}
	if !result.Partial || haItem(t, result.Items, "switch.coffee").LibraryID != "switch" {
		t.Errorf("fallback: partial=%v %+v", result.Partial, result.Libraries)
	}
}

// Only checked ids reach the template: nothing that could end a string.
func TestHomeAssistantTemplateHoldsOnlyValidIDs(t *testing.T) {
	tpl := haAreaTemplate([]string{"light.ceiling", `light.x"]}}{{ 7*7`, "sensor.temp"})
	if strings.Contains(tpl, "7*7") || !strings.Contains(tpl, `"light.ceiling"`) || !strings.Contains(tpl, `"sensor.temp"`) {
		t.Errorf("template: %s", tpl)
	}
}

func TestHomeAssistantNothingChosen(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	spec := haTestSpec(t, h, fake, nil)
	spec.Entities = nil
	if _, err := h.fetchHomeAssistant(context.Background(), spec); mediaErrorCode(err) != "no entities" {
		t.Errorf("nothing chosen: %v", err)
	}
	spec = haTestSpec(t, h, fake, nil)
	spec.CredentialID = "widget:w_nobody000000"
	if _, err := h.fetchHomeAssistant(context.Background(), spec); mediaErrorCode(err) != "not set up" {
		t.Errorf("no token: %v", err)
	}
}

func askHAWidget(t *testing.T, h *Handlers, token string) MediaResult {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/widgets/homeassistant?pageId=1&id="+haTestWidget, nil)
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	h.homeAssistantWidgetHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("widget answered %d", rec.Code)
	}
	var result MediaResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

// Whether this reader may switch is asked per request, never kept in the
// answer two readers share.
func TestHomeAssistantControlsPerRequest(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	haTestPage(t, h, fake)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")

	if !askHAWidget(t, h, "tok").Controls {
		t.Errorf("the owner cannot switch")
	}
	if askHAWidget(t, h, "").Controls {
		t.Errorf("a reader without the token may switch")
	}
	if fake.count("GET /api/states") != 1 {
		t.Errorf("the second reader was not answered from the cache")
	}
}

func TestHomeAssistantSetup(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeHomeAssistant(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"Authorization":"Bearer ` + haTestToken + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.homeAssistantSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/homeassistant/setup", strings.NewReader(body)))
	if rec.Code != http.StatusUnauthorized || fake.count("GET") != 0 {
		t.Fatalf("without the write token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.homeAssistantSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/homeassistant/setup", strings.NewReader(body)))
	var answer struct {
		ServerName string           `json:"serverName"`
		Version    string           `json:"version"`
		Entities   []map[string]any `json:"entities"`
		Error      string           `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.ServerName != "Home" || answer.Version == "" || len(answer.Entities) != 16 {
		t.Fatalf("setup: %+v", answer)
	}
	first := answer.Entities[0]
	if first["id"] == "" || first["name"] == "" || first["domain"] == "" || first["attributes"] != nil {
		t.Errorf("entity: %v", first)
	}
}

// A house with thousands of entities still answers a list the panel can hold.
func TestHomeAssistantSetupListIsBounded(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeHomeAssistant(t)
	var many []map[string]any
	for i := 0; i < homeAssistantSetupMax+50; i++ {
		many = append(many, map[string]any{"entity_id": "sensor.s" + strconv.Itoa(i), "state": "1", "attributes": map[string]any{}})
	}
	fake.states, _ = json.Marshal(many)
	body := `{"server":"` + fake.URL + `","draftCredential":{"headers":{"Authorization":"Bearer ` + haTestToken + `"}}}`
	rec := httptest.NewRecorder()
	h.homeAssistantSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/homeassistant/setup", strings.NewReader(body)))
	var answer struct {
		Entities []any `json:"entities"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if len(answer.Entities) != homeAssistantSetupMax {
		t.Errorf("%d entities, want %d", len(answer.Entities), homeAssistantSetupMax)
	}
}

func askHAAction(t *testing.T, h *Handlers, widgetID, entity, token string) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"pageId": 1, "id": widgetID, "entity": entity})
	req := httptest.NewRequest(http.MethodPost, "/api/widgets/homeassistant/action", bytes.NewReader(raw))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	h.homeAssistantActionHandler(rec, req)
	return rec
}

func TestHomeAssistantSwitchesOnlyTheSafeFew(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	haTestPage(t, h, fake)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")

	if rec := askHAAction(t, h, haTestWidget, "light.ceiling", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("without the token: %d", rec.Code)
	}
	rec := askHAAction(t, h, haTestWidget, "light.ceiling", "tok")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"id":"light.ceiling"`) {
		t.Fatalf("toggle: %d %s", rec.Code, rec.Body.String())
	}
	if rec := askHAAction(t, h, haTestWidget, "scene.movie_night", "tok"); rec.Code != http.StatusOK {
		t.Errorf("scene: %d", rec.Code)
	}
	fake.mu.Lock()
	services := strings.Join(fake.services, "\n")
	fake.mu.Unlock()
	if !strings.Contains(services, `/api/services/light/toggle {"entity_id":"light.ceiling"}`) ||
		!strings.Contains(services, `/api/services/scene/turn_on {"entity_id":"scene.movie_night"}`) {
		t.Errorf("asked Home Assistant:\n%s", services)
	}

	before := fake.count("POST /api/services/")
	for _, entity := range []string{"lock.front_door", "cover.garage", "sensor.temperature", "switch.unchosen"} {
		if rec := askHAAction(t, h, haTestWidget, entity, "tok"); rec.Code != http.StatusForbidden {
			t.Errorf("%s: %d", entity, rec.Code)
		}
	}
	if rec := askHAAction(t, h, "w_other0000001", "light.ceiling", "tok"); rec.Code != http.StatusNotFound {
		t.Errorf("another widget: %d", rec.Code)
	}
	if fake.count("POST /api/services/") != before {
		t.Errorf("a refused action still reached Home Assistant")
	}
}

// After a switch the tile asks again rather than showing the old state.
func TestHomeAssistantSwitchForgetsTheAnswer(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	fake := newFakeHomeAssistant(t)
	haTestPage(t, h, fake)
	askHAWidget(t, h, "")
	askHAAction(t, h, haTestWidget, "switch.coffee", "")
	askHAWidget(t, h, "")
	if fake.count("GET /api/states") != 2 {
		t.Errorf("states asked %d times, want 2", fake.count("GET /api/states"))
	}
}
