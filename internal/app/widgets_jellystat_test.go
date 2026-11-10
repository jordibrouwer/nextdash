package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

/*
The answers below follow Jellystat's own source (its route handlers and the SQL
functions behind them): counts arrive as strings, durations as numeric strings,
and the library names are the keys of the views over time. They are written
from that source, not recorded from a running server.
*/

const jellystatTestKey = "js-test-key-0001"

type fakeJellystat struct {
	*httptest.Server
	calls     atomic.Int32
	noKey     atomic.Int32
	failUsers bool
	history   map[string]int // libraryid -> times asked
}

func newFakeJellystat(t *testing.T) *fakeJellystat {
	t.Helper()
	fake := &fakeJellystat{history: map[string]int{}}
	mux := http.NewServeMux()
	guard := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			fake.calls.Add(1)
			if r.Header.Get("x-api-token") != jellystatTestKey && !strings.HasPrefix(r.URL.Path, "/proxy/") {
				fake.noKey.Add(1)
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"message":"Invalid API key"}`))
				return
			}
			next(w, r)
		}
	}
	write := func(w http.ResponseWriter, body string) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}
	mux.HandleFunc("/api/getLibraries", guard(func(w http.ResponseWriter, r *http.Request) {
		write(w, `[{"Id":"lib-m","Name":"Movies","archived":false},{"Id":"lib-s","Name":"Shows","archived":false},{"Id":"lib-old","Name":"Gone","archived":true}]`)
	}))
	mux.HandleFunc("/stats/getViewsOverTime", guard(func(w http.ResponseWriter, r *http.Request) {
		write(w, `{"libraries":[{"Id":"lib-m","Name":"Movies"},{"Id":"lib-s","Name":"Shows"}],"stats":[
			{"Key":"Oct 01, 2026","Movies":{"count":"3","duration":"7200"},"Shows":{"count":"4","duration":"10800"}},
			{"Key":"Oct 02, 2026","Movies":{"count":"1","duration":"3600"}}]}`)
	}))
	mux.HandleFunc("/stats/getMostViewedByType", guard(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Type string `json:"type"`
			Days int    `json:"days"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch body.Type {
		case "Movie":
			write(w, `[{"Plays":"5","total_playback_duration":"18000","Name":"Heat","Id":"m1","PrimaryImageHash":"h1","archived":false}]`)
		case "Series":
			write(w, `[{"Plays":"9","total_playback_duration":"30000","Name":"Severance","Id":"s1","PrimaryImageHash":"","archived":false},
				{"Plays":"2","total_playback_duration":"900","Name":"Andor","Id":"s2","PrimaryImageHash":"h2","archived":false}]`)
		default:
			write(w, `[]`)
		}
	}))
	mux.HandleFunc("/stats/getMostActiveUsers", guard(func(w http.ResponseWriter, r *http.Request) {
		if fake.failUsers {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		write(w, `[{"Plays":"12","UserId":"u1","Name":"jordi"},{"Plays":"3","UserId":"u2","Name":"anna"}]`)
	}))
	mux.HandleFunc("/stats/getPlaybackActivity", guard(func(w http.ResponseWriter, r *http.Request) {
		write(w, `{"current_page":1,"pages":4,"size":5,"results":[
			{"NowPlayingItemId":"s1","NowPlayingItemName":"Hello, Ms. Cobel","SeriesName":"Severance","UserName":"jordi","DeviceName":"Living room","Client":"Jellyfin Web","PlayMethod":"DirectPlay","PlaybackDuration":"2700","ActivityDateInserted":"2026-10-02T20:14:03.000Z"},
			{"NowPlayingItemId":"m1","NowPlayingItemName":"Heat","SeriesName":null,"UserName":"anna","DeviceName":"","Client":"Android TV","PlayMethod":"Transcode","PlaybackDuration":1200,"ActivityDateInserted":"2026-10-01T18:00:00.000Z"}]}`)
	}))
	mux.HandleFunc("/api/getLibraryHistory", guard(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Library string `json:"libraryid"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		fake.history[body.Library]++
		write(w, `{"current_page":1,"pages":1,"size":5,"results":[
			{"NowPlayingItemId":"m1","NowPlayingItemName":"Heat","UserName":"anna","PlayMethod":"DirectPlay","PlaybackDuration":"600","ActivityDateInserted":"2026-10-03T10:00:00.000Z"}]}`)
	}))
	mux.HandleFunc("/proxy/Items/Images/Primary/", func(w http.ResponseWriter, r *http.Request) {
		fake.calls.Add(1)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("\xff\xd8\xff\xe0jellystat-poster"))
	})
	fake.Server = httptest.NewServer(mux)
	t.Cleanup(fake.Close)
	return fake
}

func jellystatSetUp(t *testing.T, h *Handlers, fake *fakeJellystat, config map[string]any) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	const credentialID = "widget:w_jellystat0001"
	if err := saveHealthCredential(credentialID, HealthCredential{Headers: map[string]string{"x-api-token": jellystatTestKey}}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": credentialID}
	for k, v := range config {
		full[k] = v
	}
	mediaForgetAll()
	return Widget{ID: "w_jellystat0001", Type: WidgetTypeJellystat, Config: sanitizeWidgetConfig(WidgetTypeJellystat, full)}
}

func askJellystat(t *testing.T, h *Handlers, widget Widget) MediaResult {
	t.Helper()
	spec := jellystatSpecFrom(widget.Config)
	ms := mediaSpec{Service: "jellystat", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(context.Background(), 1, widget.ID, ms, func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchJellystat(ctx, spec, imageURL)
	}, false)
}

func TestJellystatWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeJellystat, map[string]any{
		"server": "http://js.lan:3000", "credentialId": "widget:w_000000000009",
		"topics": []any{"items", "bogus", "totals"}, "days": float64(9999),
		"libraries": []any{"lib-m"}, "click": "detail", "layout": "carousel", "ttl": float64(5),
	})
	if clean["click"] != "detail" || clean["days"] != 365 || clean["ttl"] != jellystatMinTTL {
		t.Errorf("kept or clamped wrongly: %#v", clean)
	}
	if topics, _ := clean["topics"].([]string); len(topics) != 2 {
		t.Errorf("an unknown topic was kept: %#v", clean["topics"])
	}
	if clean["layout"] != nil {
		t.Errorf("a field the type does not declare was kept: %#v", clean)
	}
	for _, key := range []string{"server", "credentialId", "libraries"} {
		if !withheldWidgetKeys[WidgetTypeJellystat][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
	// No topics chosen asks for all four.
	if spec := jellystatSpecFrom(map[string]any{}); len(spec.Topics) != 4 || spec.Days != 30 {
		t.Errorf("defaults: %+v", spec)
	}
}

func TestJellystatReadsEveryTopic(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellystat(t)
	widget := jellystatSetUp(t, h, fake, nil)

	result := askJellystat(t, h, widget)
	if result.Error != "" || result.Stats == nil || result.Partial {
		t.Fatalf("answer: error %q partial %v stats %v", result.Error, result.Partial, result.Stats)
	}
	stats := result.Stats
	if stats.Totals == nil || stats.Totals.Plays != 8 || stats.Totals.Seconds != 21600 {
		t.Errorf("totals: %+v", stats.Totals)
	}
	if len(stats.Items) != 3 || stats.Items[0].Title != "Severance" || stats.Items[0].Plays != 9 || stats.Items[0].Kind != "series" || stats.Items[1].Title != "Heat" {
		t.Errorf("items: %+v", stats.Items)
	}
	if len(stats.Users) != 2 || stats.Users[0].Name != "jordi" || stats.Users[0].Plays != 12 {
		t.Errorf("users: %+v", stats.Users)
	}
	if len(stats.Activity) != 2 {
		t.Fatalf("activity: %+v", stats.Activity)
	}
	if first := stats.Activity[0]; first.Title != "Severance" || first.Subtitle != "Hello, Ms. Cobel" || first.Who != "jordi" ||
		first.Device != "Living room" || first.Seconds != 2700 || first.At == 0 || first.Poster == "" {
		t.Errorf("first play: %+v", first)
	}
	if second := stats.Activity[1]; second.Title != "Heat" || second.Subtitle != "" || second.Device != "Android TV" || second.Seconds != 1200 {
		t.Errorf("second play: %+v", second)
	}
	if !strings.HasPrefix(stats.Items[0].OpenURL, fake.URL+"/libraries/item/") {
		t.Errorf("open address: %q", stats.Items[0].OpenURL)
	}
	if fake.noKey.Load() != 0 {
		t.Errorf("%d requests went without the key", fake.noKey.Load())
	}
	raw, _ := json.Marshal(result)
	for _, secret := range []string{jellystatTestKey, "widget:w_jellystat0001"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("%q reached the response", secret)
		}
	}
}

// A topic that is off is not asked for.
func TestJellystatSkipsTopicsThatAreOff(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellystat(t)
	widget := jellystatSetUp(t, h, fake, map[string]any{"topics": []any{"users"}})
	result := askJellystat(t, h, widget)
	if result.Stats == nil || len(result.Stats.Users) != 2 || result.Stats.Totals != nil || len(result.Stats.Items) != 0 || len(result.Stats.Activity) != 0 {
		t.Fatalf("answer: %+v", result.Stats)
	}
	if got := fake.calls.Load(); got != 1 {
		t.Errorf("%d requests for one topic", got)
	}
}

// The library choice narrows the totals and the recent plays, and says no more.
func TestJellystatLibraryChoice(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellystat(t)
	widget := jellystatSetUp(t, h, fake, map[string]any{"libraries": []any{"lib-m"}, "topics": []any{"totals", "activity"}})
	result := askJellystat(t, h, widget)
	if result.Stats == nil || result.Stats.Totals == nil {
		t.Fatalf("answer: %+v", result)
	}
	if result.Stats.Totals.Plays != 4 || result.Stats.Totals.Seconds != 10800 {
		t.Errorf("totals for Movies only: %+v", result.Stats.Totals)
	}
	if fake.history["lib-m"] != 1 || fake.history["lib-s"] != 0 {
		t.Errorf("histories asked: %v", fake.history)
	}
	if len(result.Stats.Activity) != 1 || result.Stats.Activity[0].Who != "anna" {
		t.Errorf("activity: %+v", result.Stats.Activity)
	}
}

// One topic failing leaves the others, and the next read comes soon.
func TestJellystatPartialAnswer(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellystat(t)
	fake.failUsers = true
	widget := jellystatSetUp(t, h, fake, nil)
	result := askJellystat(t, h, widget)
	if result.Error != "" || !result.Partial || result.Stats == nil || result.Stats.Totals == nil || len(result.Stats.Users) != 0 {
		t.Fatalf("answer: error %q partial %v %+v", result.Error, result.Partial, result.Stats)
	}
}

func TestJellystatWrongKeyIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellystat(t)
	widget := jellystatSetUp(t, h, fake, nil)
	if err := saveHealthCredential("widget:w_jellystat0001", HealthCredential{Headers: map[string]string{"x-api-token": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	result := askJellystat(t, h, widget)
	if result.Error != "key refused" || result.Stats != nil {
		t.Errorf("answer: error %q stats %v", result.Error, result.Stats)
	}
}

func TestJellystatPictureComesThroughTheProxy(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	fake := newFakeJellystat(t)
	widget := jellystatSetUp(t, h, fake, map[string]any{"topics": []any{"items"}})
	if err := h.store.SavePageBlocks(1, []Widget{widget}, nil); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	result := askJellystat(t, h, widget)
	if result.Stats == nil || len(result.Stats.Items) == 0 || result.Stats.Items[0].Poster == "" {
		t.Fatalf("no poster named: %+v", result.Stats)
	}
	poster := result.Stats.Items[0].Poster
	rec := httptest.NewRecorder()
	h.jellystatImageHandler(rec, httptest.NewRequest(http.MethodGet, poster, nil))
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "image/") {
		t.Fatalf("picture: %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	// An item the answer did not name is not fetched.
	other := strings.Replace(poster, "item=s1", "item=zzz", 1)
	rec = httptest.NewRecorder()
	h.jellystatImageHandler(rec, httptest.NewRequest(http.MethodGet, other, nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("an unnamed item answered %d", rec.Code)
	}
}

func TestJellystatSetupListsLibraries(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeJellystat(t)
	post := func(key string) (int, struct {
		Connected string                      `json:"connected"`
		Libraries []struct{ ID, Name string } `json:"libraries"`
		Error     string                      `json:"error"`
	}) {
		raw, _ := json.Marshal(map[string]any{"server": fake.URL, "draftCredential": map[string]any{
			"headers": map[string]any{"x-api-token": key}}})
		rec := httptest.NewRecorder()
		h.jellystatSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/jellystat/setup", strings.NewReader(string(raw))))
		var answer struct {
			Connected string                      `json:"connected"`
			Libraries []struct{ ID, Name string } `json:"libraries"`
			Error     string                      `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &answer)
		return rec.Code, answer
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if code, _ := post(jellystatTestKey); code != http.StatusUnauthorized || fake.calls.Load() != 0 {
		t.Fatalf("without the write token: %d, %d calls", code, fake.calls.Load())
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	code, answer := post(jellystatTestKey)
	if code != http.StatusOK || answer.Error != "" || answer.Connected != "2 libraries" || len(answer.Libraries) != 2 || answer.Libraries[0].Name != "Movies" {
		t.Fatalf("setup: %d %+v", code, answer)
	}
	if _, answer := post("wrong"); answer.Error != "key refused" {
		t.Errorf("a wrong key: %+v", answer)
	}
}
