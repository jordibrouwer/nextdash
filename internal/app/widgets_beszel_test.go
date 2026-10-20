package app

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	beszelTestUser     = "reader@example.com"
	beszelTestPassword = "bz-pass-0123"
	beszelCredential   = "widget:w_beszel000001"
)

// fakeBeszel answers the way a Beszel hub (PocketBase) does, from the
// recording in testdata/beszel. Its one odd habit is the real one: a token it
// does not know is a guest, and a guest gets 200 and an empty list.
type fakeBeszel struct {
	*httptest.Server
	mu       sync.Mutex
	logins   int
	valid    string
	systems  []byte
	stats    []byte
	sysCalls int
	statCall []string
	urls     []string
	// alwaysGuest makes every token read as a guest, signed in or not.
	alwaysGuest bool
}

func readBeszelFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "beszel", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeBeszel(t *testing.T) *fakeBeszel {
	t.Helper()
	fake := &fakeBeszel{
		systems: readBeszelFixture(t, "systems.json"),
		stats:   readBeszelFixture(t, "system_stats_hour.json"),
	}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.urls = append(fake.urls, r.URL.String())
		if r.URL.Path == "/api/collections/users/auth-with-password" {
			var body struct{ Identity, Password string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Identity != beszelTestUser || body.Password != beszelTestPassword {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"status":400,"message":"Failed to authenticate."}`))
				return
			}
			fake.logins++
			fake.valid = fmt.Sprintf("jwt-token-%d", fake.logins)
			_, _ = fmt.Fprintf(w, `{"token":%q,"record":{"id":"usr000000000001"}}`, fake.valid)
			return
		}
		// No "Bearer": PocketBase takes the token as it is.
		known := !fake.alwaysGuest && fake.valid != "" && r.Header.Get("Authorization") == fake.valid
		empty := `{"items":[],"page":1,"perPage":200,"totalItems":0,"totalPages":0}`
		switch r.URL.Path {
		case "/api/collections/systems/records":
			fake.sysCalls++
			if r.URL.Query().Get("perPage") != "200" || r.URL.Query().Get("sort") != "name" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if !known {
				_, _ = w.Write([]byte(empty))
				return
			}
			_, _ = w.Write(fake.systems)
		case "/api/collections/system_stats/records":
			fake.statCall = append(fake.statCall, r.URL.RawQuery)
			// The real collection has 217k records and refuses a sort.
			if r.URL.Query().Has("sort") {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if !known {
				_, _ = w.Write([]byte(empty))
				return
			}
			_, _ = w.Write(fake.stats)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

// expire makes the token the hub gave out read as a guest, the way a lapsed
// one does.
func (f *fakeBeszel) expire() {
	f.mu.Lock()
	f.valid = "expired"
	f.mu.Unlock()
}

func (f *fakeBeszel) systemCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sysCalls
}

// setSystems rewrites the recorded systems; edit gets the list in place.
func (f *fakeBeszel) setSystems(t *testing.T, edit func(items []map[string]any) []map[string]any) {
	t.Helper()
	var doc map[string]any
	if err := json.Unmarshal(readBeszelFixture(t, "systems.json"), &doc); err != nil {
		t.Fatal(err)
	}
	var items []map[string]any
	for _, raw := range doc["items"].([]any) {
		items = append(items, raw.(map[string]any))
	}
	if edit != nil {
		items = edit(items)
	}
	doc["items"] = items
	raw, _ := json.Marshal(doc)
	f.mu.Lock()
	f.systems = raw
	f.mu.Unlock()
}

func beszelFixtureByName(items []map[string]any, name string) map[string]any {
	for _, item := range items {
		if item["name"] == name {
			return item
		}
	}
	return nil
}

func beszelInfoOf(item map[string]any) map[string]any { return item["info"].(map[string]any) }

func beszelLoginCredential(password string) HealthCredential {
	return HealthCredential{Label: "Beszel", Session: &CredentialSession{
		Format: "json", LoginPath: "/api/collections/users/auth-with-password",
		UserField: "identity", PassField: "password", User: beszelTestUser, Password: password,
		TokenPath: "token", TokenHeader: "Authorization", TokenPrefix: "",
	}}
}

// beszelSetUp stores the sign-in, empties the caches and returns a widget of
// the given type pointed at the fake.
func beszelSetUp(t *testing.T, h *Handlers, fake *fakeBeszel, widgetType WidgetType, config map[string]any) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential(beszelCredential, beszelLoginCredential(beszelTestPassword)); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": beszelCredential}
	for k, v := range config {
		full[k] = v
	}
	mediaForgetAll()
	beszelForgetAll()
	pinBeszelNow(t, time.Date(2026, 10, 20, 16, 34, 35, 0, time.UTC))
	return Widget{ID: "w_beszel" + strings.NewReplacer("-", "", "beszel", "x").Replace(string(widgetType)), Type: widgetType,
		Config: sanitizeWidgetConfig(widgetType, full)}
}

func pinBeszelNow(t *testing.T, at time.Time) {
	t.Helper()
	was := beszelNow
	beszelNow = func() time.Time { return at }
	t.Cleanup(func() { beszelNow = was })
}

func askBeszel(h *Handlers, widget Widget) MediaResult {
	return h.beszelAnswer(context.Background(), 1, widget, false)
}

func approx(got *float64, want float64) bool {
	return got != nil && math.Abs(*got-want) < 0.051
}

func beszelItem(t *testing.T, result MediaResult, title string) MediaItem {
	t.Helper()
	for _, item := range result.Items {
		if item.Title == title {
			return item
		}
	}
	t.Fatalf("no %q among %+v", title, result.Items)
	return MediaItem{}
}

func beszelTitles(result MediaResult) string {
	var names []string
	for _, item := range result.Items {
		names = append(names, item.Title)
	}
	return strings.Join(names, ",")
}

func TestBeszelSystemsDrawsEverySystemWithCounts(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)

	result := askBeszel(h, widget)
	if result.Error != "" || len(result.Items) != 3 {
		t.Fatalf("answer: %+v", result)
	}
	if got := result.Counts; got["up"] != 2 || got["down"] != 1 || got["paused"] != 0 || got["pending"] != 0 {
		t.Errorf("counts: %v", got)
	}
	if len(result.Libraries) != 3 || result.Libraries[0].Name != "htpc" {
		t.Errorf("libraries (the choice list): %+v", result.Libraries)
	}

	htpc := beszelItem(t, result, "htpc")
	m := htpc.Meters
	if m == nil || m.Status != "up" || !approx(m.CPU, 0.85) || !approx(m.Mem, 52.65) || !approx(m.Disk, 12.67) {
		t.Fatalf("htpc meters: %+v", m)
	}
	if m.Temp != nil || m.GPU != nil {
		t.Errorf("a reading the agent never sent was drawn: temp %v gpu %v", m.Temp, m.GPU)
	}
	if m.Net == nil || *m.Net != 5219 || m.Uptime != 617005 || m.Agent != "0.21.0" || len(m.Load) != 3 {
		t.Errorf("htpc net/uptime/agent/load: %+v", m)
	}
	if len(m.Fs) != 1 || m.Fs[0].Name != "/" || math.Abs(m.Fs[0].Pct-12.7) > 0.051 {
		t.Errorf("htpc fs: %+v", m.Fs)
	}
	if htpc.ID != "sys000000000002" || htpc.Kind != "system" || htpc.OpenURL != fake.URL+"/system/htpc" || htpc.Subtitle != "" {
		t.Errorf("htpc item: %+v", htpc)
	}
	if htpc.When != time.Date(2026, 10, 20, 16, 26, 35, 151000000, time.UTC).UnixMilli() {
		t.Errorf("when: %d", htpc.When)
	}
	if len(m.Spark) != 0 {
		t.Errorf("the plain systems tile asked for history")
	}
}

// Beszel keeps the last values on a system that went down. They are old, and
// they must reach no tile as a reading.
func TestBeszelDownSystemNeverCarriesMeters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		nas := beszelInfoOf(beszelFixtureByName(items, "nas"))
		nas["cpu"], nas["mp"], nas["dp"], nas["g"] = 99.0, 99.0, 99.0, 99.0
		return items
	})

	for _, wt := range []WidgetType{WidgetTypeBeszel, WidgetTypeBeszelAttention, WidgetTypeBeszelStorage} {
		widget := beszelSetUp(t, h, fake, wt, nil)
		result := askBeszel(h, widget)
		for _, item := range result.Items {
			if item.Title != "nas" {
				continue
			}
			if item.Meters != nil && (item.Meters.CPU != nil || item.Meters.Mem != nil || item.Meters.Disk != nil ||
				item.Meters.Fs != nil || item.Meters.Net != nil || item.Meters.Agent != "" || item.Meters.Load != nil) {
				t.Errorf("%s: down system has meters: %+v", wt, item.Meters)
			}
		}
		raw, _ := json.Marshal(result)
		stale := false
		for _, reading := range []string{`"cpu":99`, `"mem":99`, `"disk":99`, `"gpu":99`, `"pct":99`, "99%"} {
			stale = stale || strings.Contains(string(raw), reading)
		}
		if stale || strings.Contains(string(raw), "nvme1n1p1") {
			t.Errorf("%s: stale readings reached the answer: %s", wt, raw)
		}
	}
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)
	nas := beszelItem(t, askBeszel(h, widget), "nas")
	if nas.Meters == nil || nas.Meters.Status != "down" {
		t.Fatalf("nas: %+v", nas.Meters)
	}
	raw, _ := json.Marshal(nas.Meters)
	if string(raw) != `{"status":"down"}` {
		t.Errorf("down meters: %s", raw)
	}
}

func TestBeszelSystemsSortAndHidePaused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		beszelFixtureByName(items, "pihole")["status"] = "paused"
		return items
	})

	order := func(config map[string]any) string {
		return beszelTitles(askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, config)))
	}
	if got := order(nil); got != "htpc,nas,pihole" {
		t.Errorf("name: %s", got)
	}
	if got := order(map[string]any{"sort": "status"}); got != "nas,htpc,pihole" {
		t.Errorf("status: %s", got)
	}
	if got := order(map[string]any{"sort": "heaviest"}); got != "htpc,nas,pihole" {
		t.Errorf("heaviest: %s", got)
	}
	hidden := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, map[string]any{"hidePaused": true}))
	if got := beszelTitles(hidden); got != "htpc,nas" {
		t.Errorf("hidePaused: %s", got)
	}
	// The counts are taken before the paused ones are hidden.
	if hidden.Counts["paused"] != 1 || hidden.Counts["up"] != 1 {
		t.Errorf("counts: %v", hidden.Counts)
	}
}

func TestBeszelHeaviestPutsTheFullestUpSystemFirst(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		beszelInfoOf(beszelFixtureByName(items, "pihole"))["dp"] = 91.0
		return items
	})
	got := beszelTitles(askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, map[string]any{"sort": "heaviest"})))
	if got != "pihole,htpc,nas" {
		t.Errorf("heaviest: %s", got)
	}
}

func TestBeszelSystemsChoiceAndRows(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)

	chosen := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, map[string]any{"systems": []any{"sys000000000003", "sys0000000gone"}}))
	if beszelTitles(chosen) != "pihole" {
		t.Errorf("systems: %s", beszelTitles(chosen))
	}
	// Counts cover what the tile chose, no more.
	if chosen.Counts["up"] != 1 || chosen.Counts["down"] != 0 {
		t.Errorf("counts: %v", chosen.Counts)
	}
	// The panel's list stays the whole server, or a system could never be added back.
	if len(chosen.Libraries) != 3 {
		t.Errorf("libraries: %+v", chosen.Libraries)
	}
	cut := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, map[string]any{"rows": float64(2)}))
	if len(cut.Items) != 2 || cut.Counts["up"] != 2 || cut.Counts["down"] != 1 {
		t.Errorf("rows: %d items, counts %v", len(cut.Items), cut.Counts)
	}
}

func TestBeszelAttentionNamesTheReason(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)

	// The recording: one machine is down and nothing else is wrong.
	quiet := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelAttention, nil))
	if len(quiet.Items) != 1 || quiet.Items[0].Title != "nas" || quiet.Items[0].Subtitle != "down" {
		t.Fatalf("recording: %+v", quiet.Items)
	}
	if quiet.Items[0].Kind != "system" || quiet.Items[0].Meters == nil || quiet.Items[0].Meters.Status != "down" ||
		quiet.Items[0].When == 0 {
		t.Errorf("down line: %+v", quiet.Items[0])
	}

	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		htpc := beszelInfoOf(beszelFixtureByName(items, "htpc"))
		htpc["cpu"], htpc["dt"] = 91.4, 71.2
		beszelInfoOf(beszelFixtureByName(items, "pihole"))["dp"] = 88.0
		items = append(items,
			map[string]any{"id": "sys000000000004", "name": "attic", "status": "paused", "updated": "2026-10-19 10:00:00.000Z", "info": map[string]any{}},
			map[string]any{"id": "sys000000000005", "name": "boot", "status": "pending", "updated": "2026-10-20 16:00:00.000Z", "info": map[string]any{}},
			map[string]any{"id": "sys000000000006", "name": "gpu", "status": "up", "updated": "2026-10-20 16:00:00.000Z",
				"info": map[string]any{"cpu": 5.0, "mp": 10.0, "dp": 10.0, "g": 80.0, "dt": 85.0}},
		)
		return items
	})
	result := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelAttention, nil))
	var lines []string
	for _, item := range result.Items {
		lines = append(lines, item.Title+"="+item.Subtitle)
	}
	// Down first, then what is over its bad line (by name among equals), then
	// warn, then the ones with nothing to read: pending, paused.
	want := "nas=down|gpu=gpu 80% · 85°|htpc=cpu 91% · 71°|pihole=disk 88%|boot=pending|attic=paused"
	if got := strings.Join(lines, "|"); got != want {
		t.Errorf("attention:\n got %s\nwant %s", got, want)
	}
	if result.Counts["up"] != 3 || result.Counts["down"] != 1 || result.Counts["paused"] != 1 || result.Counts["pending"] != 1 {
		t.Errorf("counts: %v", result.Counts)
	}
	if m := beszelItem(t, result, "htpc").Meters; m == nil || !approx(m.CPU, 91.4) {
		t.Errorf("an up system over its line still draws its meters: %+v", m)
	}
	hidden := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelAttention, map[string]any{"hidePaused": true}))
	if strings.Contains(beszelTitles(hidden), "attic") || hidden.Counts["paused"] != 1 {
		t.Errorf("hidePaused: %s, counts %v", beszelTitles(hidden), hidden.Counts)
	}
}

func TestBeszelStorageListsFilesystemsFullestFirst(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		beszelInfoOf(beszelFixtureByName(items, "htpc"))["efs"] = map[string]any{"data": 70.2}
		return items
	})
	result := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelStorage, nil))

	var lines []string
	for _, item := range result.Items {
		lines = append(lines, item.ID+"|"+item.Title+"|"+item.Subtitle+"|"+item.Kind)
	}
	// nas is down: its "/" and nvme1n1p1 are last month's and are not here.
	want := "sys000000000002:data|htpc|data|fs,sys000000000003:/|pihole|/|fs,sys000000000002:/|htpc|/|fs"
	if got := strings.Join(lines, ","); got != want {
		t.Errorf("storage:\n got %s\nwant %s", got, want)
	}
	if result.Counts["up"] != 2 || result.Counts["down"] != 1 {
		t.Errorf("counts cover the down system too: %v", result.Counts)
	}
	first := result.Items[0]
	if first.OpenURL != fake.URL+"/system/htpc" || first.Library != "htpc" || first.LibraryID != "sys000000000002" {
		t.Errorf("first: %+v", first)
	}
	if first.Meters == nil || first.Meters.Status != "up" || !approx(first.Meters.Disk, 70.2) ||
		len(first.Meters.Fs) != 1 || first.Meters.Fs[0].Name != "data" {
		t.Errorf("fs meters: %+v", first.Meters)
	}
}

// Old agents and small ones leave fields out; a field left out is not drawn.
func TestBeszelOldAgentsAndMissingFields(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func(items []map[string]any) []map[string]any {
		return []map[string]any{{
			"id": "sys000000000009", "name": "old box", "status": "up", "updated": "2026-10-20 16:00:00.000Z",
			// MB/s as "b", no dp, no efs, no dt, no la, no version.
			"info": map[string]any{"cpu": 3.0, "mp": 20.0, "b": 2.0, "u": 100.0},
		}}
	})
	result := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszel, nil))
	m := result.Items[0].Meters
	if m == nil || m.Net == nil || *m.Net != 2*1048576 {
		t.Fatalf("old agent net: %+v", m)
	}
	raw, _ := json.Marshal(m)
	for _, absent := range []string{`"disk"`, `"temp"`, `"gpu"`, `"fs"`, `"load"`, `"agent"`, `"spark"`} {
		if strings.Contains(string(raw), absent) {
			t.Errorf("%s was drawn without a reading: %s", absent, raw)
		}
	}
	if storage := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelStorage, nil)); len(storage.Items) != 0 {
		t.Errorf("a system with no filesystem figures listed one: %+v", storage.Items)
	}
}

// PocketBase does not refuse an expired token; it answers 200 and an empty
// list. A list that was full and is now empty signs in once more.
func TestBeszelExpiredTokenSignsInAgain(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)

	if first := askBeszel(h, widget); len(first.Items) != 3 || fake.logins != 1 {
		t.Fatalf("first: %d items, %d logins", len(first.Items), fake.logins)
	}
	fake.expire()
	mediaExpireAll()
	beszelExpireAll()
	again := askBeszel(h, widget)
	if again.Error != "" || again.Stale || len(again.Items) != 3 || fake.logins != 2 {
		t.Errorf("after expiry: %+v (%d logins)", again, fake.logins)
	}
}

func TestBeszelStillEmptyAfterSigningInAgainIsAKeyRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)
	askBeszel(h, widget)

	fake.mu.Lock()
	fake.alwaysGuest = true
	fake.mu.Unlock()
	mediaExpireAll()
	beszelExpireAll()
	result := askBeszel(h, widget)
	if result.Error != "key refused" || !result.Stale || len(result.Items) != 3 {
		t.Errorf("answer: error %q stale %v items %d", result.Error, result.Stale, len(result.Items))
	}
	if fake.logins != 2 {
		t.Errorf("%d logins: one more, not a loop", fake.logins)
	}
}

// A hub with no systems yet is empty from the first question: that is a
// finding, not a refusal, and no second sign-in is made for it.
func TestBeszelEmptyFromTheStartIsNoSystems(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.setSystems(t, func([]map[string]any) []map[string]any { return nil })
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)

	result := askBeszel(h, widget)
	if result.Error != "" || len(result.Items) != 0 || fake.logins != 1 {
		t.Errorf("answer %+v, %d logins", result, fake.logins)
	}
	if result.Counts == nil || result.Counts["up"] != 0 {
		t.Errorf("counts: %v", result.Counts)
	}
}

func TestBeszelWrongPasswordIsAKeyRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszel, nil)
	if err := saveHealthCredential(beszelCredential, beszelLoginCredential("wrong")); err != nil {
		t.Fatal(err)
	}
	if result := askBeszel(h, widget); result.Error != "key refused" {
		t.Errorf("wrong password: %+v", result)
	}
}

// Four tiles on a page ask the hub for its systems once per beat, not four times.
func TestBeszelTilesShareOneSystemsQuestion(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widgets := []Widget{
		beszelSetUp(t, h, fake, WidgetTypeBeszel, nil),
		beszelSetUp(t, h, fake, WidgetTypeBeszelAttention, nil),
		beszelSetUp(t, h, fake, WidgetTypeBeszelStorage, nil),
	}
	// Each under a credential id of its own, as the panel files them
	// (widget:{id}), with the same login: one hub, one user, three ids.
	for i := range widgets {
		widgets[i].ID = fmt.Sprintf("w_beszelshare%02d", i)
		id := "widget:" + widgets[i].ID
		if err := saveHealthCredential(id, beszelLoginCredential(beszelTestPassword)); err != nil {
			t.Fatal(err)
		}
		widgets[i].Config["credentialId"] = id
	}
	for _, w := range widgets {
		if result := askBeszel(h, w); result.Error != "" {
			t.Fatalf("%s: %+v", w.Type, result)
		}
	}
	if n := fake.systemCalls(); n != 1 {
		t.Errorf("%d questions for three tiles, want 1", n)
	}

	// All at once, from a cold cache: still one.
	mediaForgetAll()
	beszelForgetAll()
	before := fake.systemCalls()
	var wg sync.WaitGroup
	for _, w := range widgets {
		wg.Add(1)
		go func(w Widget) {
			defer wg.Done()
			askBeszel(h, w)
		}(w)
	}
	wg.Wait()
	if n := fake.systemCalls() - before; n != 1 {
		t.Errorf("%d questions for three simultaneous tiles, want 1", n)
	}

	// A refresh the reader asked for goes to the hub.
	h.beszelAnswer(context.Background(), 1, widgets[0], true)
	if n := fake.systemCalls() - before; n != 2 {
		t.Errorf("a forced refresh made %d questions in all, want 2", n)
	}
}

// A different beat is a different cache: two tiles that disagree about how
// fresh is fresh do not hand each other an answer of the wrong age.
func TestBeszelDifferentBeatsAskSeparately(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	a := beszelSetUp(t, h, fake, WidgetTypeBeszel, map[string]any{"ttl": float64(60)})
	b := beszelSetUp(t, h, fake, WidgetTypeBeszelStorage, map[string]any{"ttl": float64(120)})
	b.ID = "w_beszelother01"
	askBeszel(h, a)
	askBeszel(h, b)
	if n := fake.systemCalls(); n != 2 {
		t.Errorf("%d questions for two beats, want 2", n)
	}
}

func beszelSparkTestPoints(t *testing.T) []float64 {
	t.Helper()
	var doc struct {
		Items []struct {
			Stats struct {
				CPU float64 `json:"cpu"`
			} `json:"stats"`
		} `json:"items"`
	}
	if err := json.Unmarshal(readBeszelFixture(t, "system_stats_hour.json"), &doc); err != nil {
		t.Fatal(err)
	}
	var out []float64
	for _, item := range doc.Items {
		out = append(out, item.Stats.CPU)
	}
	return out
}

func TestBeszelSystemCarriesTheLastHour(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	widget := beszelSetUp(t, h, fake, WidgetTypeBeszelSystem, map[string]any{"system": "sys000000000002"})

	result := askBeszel(h, widget)
	if result.Error != "" || len(result.Items) != 1 {
		t.Fatalf("answer: %+v", result)
	}
	item := result.Items[0]
	if item.Title != "htpc" || item.Subtitle != "agent 0.21.0" || item.Kind != "system" || item.Meters == nil {
		t.Fatalf("item: %+v", item)
	}
	want := beszelSparkTestPoints(t)
	if len(want) != 60 || len(item.Meters.Spark) != 60 {
		t.Fatalf("spark: %d points, fixture %d", len(item.Meters.Spark), len(want))
	}
	for i := range want {
		if item.Meters.Spark[i] != want[i] {
			t.Fatalf("point %d: %v, want %v (oldest first)", i, item.Meters.Spark[i], want[i])
		}
	}
	if result.Counts["up"] != 1 {
		t.Errorf("counts: %v", result.Counts)
	}

	if len(fake.statCall) != 1 {
		t.Fatalf("%d stats questions", len(fake.statCall))
	}
	query, _ := url.ParseQuery(fake.statCall[0])
	if query.Get("filter") != "system='sys000000000002' && type='1m' && created>='2026-10-20 15:34:35'" {
		t.Errorf("filter: %q", query.Get("filter"))
	}
	if query.Get("perPage") != "60" || query.Get("fields") != "created,stats.cpu" || query.Has("sort") {
		t.Errorf("query: %v", query)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	for _, asked := range fake.urls {
		if strings.Contains(asked, "jwt-token") || strings.Contains(asked, beszelTestPassword) {
			t.Errorf("a secret is in an address: %s", asked)
		}
	}
}

func TestBeszelSystemGoneDownAndUnchosen(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)

	gone := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelSystem, map[string]any{"system": "sys0000000gone"}))
	if gone.Error != "system gone" || len(gone.Items) != 0 || len(gone.Libraries) != 3 {
		t.Errorf("gone: %+v", gone)
	}

	before := len(fake.statCall)
	down := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelSystem, map[string]any{"system": "sys000000000001"}))
	if down.Error != "" || len(down.Items) != 1 || down.Items[0].Meters == nil {
		t.Fatalf("down: %+v", down)
	}
	raw, _ := json.Marshal(down.Items[0].Meters)
	if string(raw) != `{"status":"down"}` || len(fake.statCall) != before {
		t.Errorf("down system: %s, %d stats questions", raw, len(fake.statCall)-before)
	}

	none := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelSystem, nil))
	if none.Error != "not set up" {
		t.Errorf("no system chosen: %+v", none)
	}
}

// The history is the nice-to-have: if it fails the tile still has the meters.
func TestBeszelSystemWithoutHistoryIsPartial(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBeszel(t)
	fake.mu.Lock()
	fake.stats = []byte(`not json`)
	fake.mu.Unlock()
	result := askBeszel(h, beszelSetUp(t, h, fake, WidgetTypeBeszelSystem, map[string]any{"system": "sys000000000002"}))
	if result.Error != "" || !result.Partial || len(result.Items) != 1 || result.Items[0].Meters.Spark != nil {
		t.Errorf("answer: %+v", result)
	}
}

func TestBeszelWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeBeszel, map[string]any{
		"server": "http://beszel.lan:8090", "credentialId": beszelCredential,
		"systems": []any{"sys1", "sys2"}, "hidePaused": true, "sort": "heaviest",
		"meters": []any{"cpu", "temp", "bogus"}, "click": "detail", "target": "_blank",
		"rows": float64(8), "ttl": float64(5), "system": "sys9", "layout": "hero",
	})
	if clean["sort"] != "heaviest" || clean["hidePaused"] != true || clean["click"] != "detail" || clean["rows"] != 8 {
		t.Errorf("kept: %#v", clean)
	}
	if list, _ := clean["systems"].([]string); len(list) != 2 {
		t.Errorf("systems: %#v", clean["systems"])
	}
	if list, _ := clean["meters"].([]string); len(list) != 2 {
		t.Errorf("meters: %#v", clean["meters"])
	}
	if clean["ttl"] != 30 {
		t.Errorf("ttl floor is 30 seconds: %#v", clean["ttl"])
	}
	if _, ok := clean["system"]; ok {
		t.Errorf("a one-system key on the all-systems tile")
	}
	if _, ok := clean["layout"]; ok {
		t.Errorf("the shape follows the width, not a setting")
	}

	one := sanitizeWidgetConfig(WidgetTypeBeszelSystem, map[string]any{"system": "sys9", "systems": []any{"a"}, "sort": "name", "meters": []any{"net"}})
	if one["system"] != "sys9" || one["meters"] == nil {
		t.Errorf("system tile: %#v", one)
	}
	if _, ok := one["systems"]; ok {
		t.Errorf("system tile keeps a list")
	}
	if _, ok := one["sort"]; ok {
		t.Errorf("only the systems tile sorts")
	}

	for _, wt := range []WidgetType{WidgetTypeBeszel, WidgetTypeBeszelSystem, WidgetTypeBeszelAttention, WidgetTypeBeszelStorage} {
		if _, known := knownWidgetTypes[wt]; !known {
			t.Errorf("%s is not registered", wt)
		}
		for _, key := range []string{"server", "credentialId", "systems", "system"} {
			if !withheldWidgetKeys[wt][key] {
				t.Errorf("%s: %s is handed to a tokenless reader", wt, key)
			}
		}
	}
	spec := beszelSpecFrom(WidgetTypeBeszel, map[string]any{"server": "http://x/"})
	if spec.Server != "http://x" || spec.Sort != "name" || spec.TTL != time.Minute || spec.HidePaused {
		t.Errorf("defaults: %+v", spec)
	}
}

// The fingerprint changes with anything that changes the answer.
func TestBeszelFingerprintFollowsTheChoice(t *testing.T) {
	base := map[string]any{"server": "http://x", "credentialId": "c"}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for key, val := range base {
			m[key] = val
		}
		m[k] = v
		return m
	}
	seen := map[string]string{beszelSpecFrom(WidgetTypeBeszel, base).fingerprint(): "base"}
	for name, config := range map[string]map[string]any{
		"sort": with("sort", "status"), "hide": with("hidePaused", true), "rows": with("rows", 3),
		"systems": with("systems", []string{"a"}),
	} {
		fp := beszelSpecFrom(WidgetTypeBeszel, config).fingerprint()
		if prior, dup := seen[fp]; dup {
			t.Errorf("%s has the fingerprint of %s", name, prior)
		}
		seen[fp] = name
	}
}
