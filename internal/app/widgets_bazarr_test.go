package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

/*
The answers served below were recorded from a running Bazarr (1.6.2) and
scrubbed: titles, paths, tags and release names are replaced, the shapes and
numbers are as Bazarr sent them (testdata/bazarr).
*/

const bazarrTestKey = "bz-test-key-0001"

type fakeBazarr struct {
	*httptest.Server
	calls       atomic.Int32
	noKey       atomic.Int32
	failHistory bool
	paths       []string
}

func newFakeBazarr(t *testing.T) *fakeBazarr {
	t.Helper()
	fake := &fakeBazarr{}
	serve := func(name string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			fake.calls.Add(1)
			fake.paths = append(fake.paths, r.URL.Path)
			if r.Header.Get("X-API-KEY") != bazarrTestKey {
				fake.noKey.Add(1)
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"message":"Unauthorized"}`))
				return
			}
			if fake.failHistory && strings.HasSuffix(r.URL.Path, "/history") {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			raw, err := os.ReadFile(filepath.Join("testdata", "bazarr", name+".json"))
			if err != nil {
				t.Errorf("fixture %s: %v", name, err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(raw)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/system/status", serve("system_status"))
	mux.HandleFunc("/api/badges", serve("badges"))
	mux.HandleFunc("/api/movies/wanted", serve("movies_wanted"))
	mux.HandleFunc("/api/episodes/wanted", serve("episodes_wanted"))
	mux.HandleFunc("/api/movies/history", serve("movies_history"))
	mux.HandleFunc("/api/episodes/history", serve("episodes_history"))
	fake.Server = httptest.NewServer(mux)
	t.Cleanup(fake.Close)
	return fake
}

func bazarrSetUp(t *testing.T, h *Handlers, fake *fakeBazarr, config map[string]any) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	const credentialID = "widget:w_bazarr00001"
	if err := saveHealthCredential(credentialID, HealthCredential{Headers: map[string]string{"X-Api-Key": bazarrTestKey}}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": credentialID}
	for k, v := range config {
		full[k] = v
	}
	mediaForgetAll()
	return Widget{ID: "w_bazarr00001", Type: WidgetTypeBazarr, Config: sanitizeWidgetConfig(WidgetTypeBazarr, full)}
}

func askBazarr(t *testing.T, h *Handlers, widget Widget) MediaResult {
	t.Helper()
	spec := bazarrSpecFrom(widget.Config)
	ms := mediaSpec{Service: "bazarr", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(context.Background(), 1, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchBazarr(ctx, spec)
	}, false)
}

func TestBazarrWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeBazarr, map[string]any{
		"server": "http://bz.lan:6767", "credentialId": "widget:w_000000000009",
		"topics": []any{"recent", "bogus", "totals"}, "click": "detail", "layout": "carousel", "ttl": float64(5),
	})
	if clean["click"] != "detail" || clean["ttl"] != bazarrMinTTL {
		t.Errorf("kept or clamped wrongly: %#v", clean)
	}
	if topics, _ := clean["topics"].([]string); len(topics) != 2 {
		t.Errorf("an unknown topic was kept: %#v", clean["topics"])
	}
	if clean["layout"] != nil {
		t.Errorf("a field the type does not declare was kept: %#v", clean)
	}
	for _, key := range []string{"server", "credentialId"} {
		if !withheldWidgetKeys[WidgetTypeBazarr][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
	if spec := bazarrSpecFrom(map[string]any{}); len(spec.Topics) != 3 || spec.Rows != bazarrDefaultRows {
		t.Errorf("defaults: %+v", spec)
	}
}

func TestBazarrReadsEveryTopic(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBazarr(t)
	widget := bazarrSetUp(t, h, fake, nil)

	result := askBazarr(t, h, widget)
	if result.Error != "" || result.Subs == nil || result.Partial {
		t.Fatalf("answer: error %q partial %v subs %v", result.Error, result.Partial, result.Subs)
	}
	subs := result.Subs
	// The recording said 18 movies and 1 episode without a subtitle.
	if subs.Totals == nil || subs.Totals.MissingMovies != 18 || subs.Totals.MissingEpisodes != 1 || subs.Totals.ProviderIssues != 0 {
		t.Errorf("totals: %+v", subs.Totals)
	}
	if len(subs.Missing) != 5 || subs.Missing[0].Kind != "movie" {
		t.Fatalf("missing (cut to rows): %+v", subs.Missing)
	}
	if got := strings.Join(subs.Missing[0].Languages, ","); got != "nl" {
		t.Errorf("a movie missing Dutch reads %q", got)
	}
	if !strings.HasPrefix(subs.Missing[0].OpenURL, fake.URL+"/movies/") {
		t.Errorf("open address: %q", subs.Missing[0].OpenURL)
	}
	if len(subs.Recent) != 5 {
		t.Fatalf("recent: %+v", subs.Recent)
	}
	for i := 1; i < len(subs.Recent); i++ {
		if subs.Recent[i].At > subs.Recent[i-1].At {
			t.Errorf("recent is not newest first at %d: %+v", i, subs.Recent)
		}
	}
	if first := subs.Recent[0]; first.Kind != "movie" || first.Language != "nl" || first.Provider == "" || first.At == 0 || first.Score == "" {
		t.Errorf("first fetched: %+v", first)
	}
	if fake.noKey.Load() != 0 {
		t.Errorf("%d requests went without the key", fake.noKey.Load())
	}
	raw, _ := json.Marshal(result)
	for _, secret := range []string{bazarrTestKey, "widget:w_bazarr00001"} {
		if strings.Contains(string(raw), secret) {
			t.Errorf("%q reached the response", secret)
		}
	}
}

// An episode names its series and its number; a hearing-impaired track says so.
func TestBazarrEpisodeAndHearingImpairedRead(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBazarr(t)
	widget := bazarrSetUp(t, h, fake, map[string]any{"topics": []any{"missing", "recent"}, "rows": float64(20)})
	subs := askBazarr(t, h, widget).Subs
	if subs == nil {
		t.Fatal("no answer")
	}
	var episode *MediaSubsMissing
	for i := range subs.Missing {
		if subs.Missing[i].Kind == "episode" {
			episode = &subs.Missing[i]
		}
	}
	if episode == nil || episode.Subtitle != "3x5 Example Episode" || strings.Join(episode.Languages, ",") != "nl,en" ||
		!strings.HasPrefix(episode.OpenURL, fake.URL+"/series/") {
		t.Fatalf("episode: %+v", episode)
	}
	hi := false
	for _, fetched := range subs.Recent {
		if fetched.Language == "nl+hi" {
			hi = true
		}
	}
	if !hi {
		t.Errorf("a hearing-impaired subtitle did not read nl+hi: %+v", subs.Recent)
	}
}

// A topic that is off is not asked for.
func TestBazarrSkipsTopicsThatAreOff(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBazarr(t)
	widget := bazarrSetUp(t, h, fake, map[string]any{"topics": []any{"recent"}})
	subs := askBazarr(t, h, widget).Subs
	if subs == nil || len(subs.Recent) == 0 || subs.Totals != nil || len(subs.Missing) != 0 {
		t.Fatalf("answer: %+v", subs)
	}
	for _, path := range fake.paths {
		if !strings.HasSuffix(path, "/history") {
			t.Errorf("an off topic asked %s", path)
		}
	}
}

// One topic failing leaves the others, and the next read comes soon.
func TestBazarrPartialAnswer(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBazarr(t)
	fake.failHistory = true
	widget := bazarrSetUp(t, h, fake, nil)
	result := askBazarr(t, h, widget)
	if result.Error != "" || !result.Partial || result.Subs == nil || result.Subs.Totals == nil || len(result.Subs.Missing) == 0 || len(result.Subs.Recent) != 0 {
		t.Fatalf("answer: error %q partial %v %+v", result.Error, result.Partial, result.Subs)
	}
}

func TestBazarrWrongKeyIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeBazarr(t)
	widget := bazarrSetUp(t, h, fake, nil)
	if err := saveHealthCredential("widget:w_bazarr00001", HealthCredential{Headers: map[string]string{"X-Api-Key": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	result := askBazarr(t, h, widget)
	if result.Error != "key refused" || result.Subs != nil {
		t.Errorf("answer: error %q subs %v", result.Error, result.Subs)
	}
}

func TestBazarrSetupNamesTheVersion(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeBazarr(t)
	post := func(key string) (int, struct {
		Connected string `json:"connected"`
		Error     string `json:"error"`
	}) {
		raw, _ := json.Marshal(map[string]any{"server": fake.URL, "draftCredential": map[string]any{
			"headers": map[string]any{"X-Api-Key": key}}})
		rec := httptest.NewRecorder()
		h.bazarrSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/bazarr/setup", strings.NewReader(string(raw))))
		var answer struct {
			Connected string `json:"connected"`
			Error     string `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &answer)
		return rec.Code, answer
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if code, _ := post(bazarrTestKey); code != http.StatusUnauthorized || fake.calls.Load() != 0 {
		t.Fatalf("without the write token: %d, %d calls", code, fake.calls.Load())
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	code, answer := post(bazarrTestKey)
	if code != http.StatusOK || answer.Error != "" || answer.Connected != "Bazarr 1.6.2" {
		t.Fatalf("setup: %d %+v", code, answer)
	}
	if _, answer := post("wrong"); answer.Error != "key refused" {
		t.Errorf("a wrong key: %+v", answer)
	}
}
