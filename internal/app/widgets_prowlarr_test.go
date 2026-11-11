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
The indexer list, the stats, the health messages and the version were recorded
from a running Prowlarr (2.7.0) and scrubbed (testdata/prowlarr). The paused
indexer in indexerstatus.json is not a recording: the server had none, so that
file follows Prowlarr's own resource shape.
*/

const prowlarrTestKey = "pr-test-key-0001"

type fakeProwlarr struct {
	*httptest.Server
	calls      atomic.Int32
	noKey      atomic.Int32
	failStats  bool
	failHealth bool
	paths      []string
}

func newFakeProwlarr(t *testing.T) *fakeProwlarr {
	t.Helper()
	fake := &fakeProwlarr{}
	serve := func(name string, fails func() bool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			fake.calls.Add(1)
			fake.paths = append(fake.paths, r.URL.Path)
			if r.Header.Get("X-Api-Key") != prowlarrTestKey {
				fake.noKey.Add(1)
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
				return
			}
			if fails != nil && fails() {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			raw, err := os.ReadFile(filepath.Join("testdata", "prowlarr", name+".json"))
			if err != nil {
				t.Errorf("fixture %s: %v", name, err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(raw)
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/system/status", serve("system_status", nil))
	mux.HandleFunc("/api/v1/indexer", serve("indexer", nil))
	mux.HandleFunc("/api/v1/indexerstats", serve("indexerstats", func() bool { return fake.failStats }))
	mux.HandleFunc("/api/v1/indexerstatus", serve("indexerstatus", nil))
	mux.HandleFunc("/api/v1/health", serve("health", func() bool { return fake.failHealth }))
	fake.Server = httptest.NewServer(mux)
	t.Cleanup(fake.Close)
	return fake
}

func prowlarrSetUp(t *testing.T, h *Handlers, fake *fakeProwlarr, config map[string]any) Widget {
	t.Helper()
	allowLocalForTest(t, h, true)
	const credentialID = "widget:w_prowlarr0001"
	if err := saveHealthCredential(credentialID, HealthCredential{Headers: map[string]string{"X-Api-Key": prowlarrTestKey}}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": credentialID}
	for k, v := range config {
		full[k] = v
	}
	mediaForgetAll()
	return Widget{ID: "w_prowlarr0001", Type: WidgetTypeProwlarr, Config: sanitizeWidgetConfig(WidgetTypeProwlarr, full)}
}

func askProwlarr(t *testing.T, h *Handlers, widget Widget) MediaResult {
	t.Helper()
	spec := prowlarrSpecFrom(widget.Config)
	ms := mediaSpec{Service: "prowlarr", Server: spec.Server, CredentialID: spec.CredentialID,
		Fingerprint: spec.fingerprint(), TTL: spec.TTL}
	return h.mediaAnswer(context.Background(), 1, widget.ID, ms, func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
		return h.fetchProwlarr(ctx, spec)
	}, false)
}

func TestProwlarrWidgetConfig(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeProwlarr, map[string]any{
		"server": "http://pr.lan:9696", "credentialId": "widget:w_000000000009",
		"topics": []any{"issues", "bogus", "totals"}, "days": float64(9999), "click": "detail", "layout": "carousel", "ttl": float64(5),
	})
	if clean["click"] != "detail" || clean["days"] != 365 || clean["ttl"] != prowlarrMinTTL {
		t.Errorf("kept or clamped wrongly: %#v", clean)
	}
	if topics, _ := clean["topics"].([]string); len(topics) != 2 {
		t.Errorf("an unknown topic was kept: %#v", clean["topics"])
	}
	if clean["layout"] != nil {
		t.Errorf("a field the type does not declare was kept: %#v", clean)
	}
	for _, key := range []string{"server", "credentialId"} {
		if !withheldWidgetKeys[WidgetTypeProwlarr][key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
	if spec := prowlarrSpecFrom(map[string]any{}); len(spec.Topics) != 3 || spec.Days != 7 {
		t.Errorf("defaults: %+v", spec)
	}
}

func TestProwlarrReadsEveryTopic(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeProwlarr(t)
	widget := prowlarrSetUp(t, h, fake, map[string]any{"rows": float64(10)})

	result := askProwlarr(t, h, widget)
	if result.Error != "" || result.Indexers == nil || result.Partial {
		t.Fatalf("answer: error %q partial %v %+v", result.Error, result.Partial, result.Indexers)
	}
	got := result.Indexers
	// Four of the six indexers are on; the counts add up what the recording says.
	var recorded struct {
		Indexers []prowlarrStat `json:"indexers"`
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "prowlarr", "indexerstats.json"))
	if err != nil || json.Unmarshal(raw, &recorded) != nil {
		t.Fatal("fixture unreadable", err)
	}
	var queries, grabs, failed int64
	for _, s := range recorded.Indexers {
		queries += s.Queries + s.RSS
		grabs += s.Grabs
		failed += s.failed()
	}
	if got.Totals == nil || got.Totals.Enabled != 4 || got.Totals.Total != 6 ||
		got.Totals.Queries != queries || got.Totals.Grabs != grabs || got.Totals.Failed != failed || queries == 0 {
		t.Errorf("totals: %+v, want %d queries, %d grabs, %d failed", got.Totals, queries, grabs, failed)
	}
	// A paused indexer comes first, then the busiest.
	if len(got.Indexers) != 4 || !got.Indexers[0].Paused || got.Indexers[0].Name != "Example Indexer 6" {
		t.Fatalf("indexers: %+v", got.Indexers)
	}
	for i := 1; i < len(got.Indexers); i++ {
		a, b := got.Indexers[i-1], got.Indexers[i]
		if !a.Paused && b.Queries > a.Queries {
			t.Errorf("busiest first broke at %d: %+v", i, got.Indexers)
		}
	}
	// The health message and the paused indexer are both issues, errors first.
	if len(got.Issues) != 2 || got.Issues[0].Level != "error" || got.Issues[0].Until == 0 || got.Issues[1].Level != "warning" ||
		!strings.Contains(got.Issues[1].Text, "unavailable") {
		t.Errorf("issues: %+v", got.Issues)
	}
	if !strings.HasPrefix(got.Indexers[0].OpenURL, fake.URL+"/indexers") {
		t.Errorf("open address: %q", got.Indexers[0].OpenURL)
	}
	if fake.noKey.Load() != 0 {
		t.Errorf("%d requests went without the key", fake.noKey.Load())
	}
	body, _ := json.Marshal(result)
	for _, secret := range []string{prowlarrTestKey, "widget:w_prowlarr0001"} {
		if strings.Contains(string(body), secret) {
			t.Errorf("%q reached the response", secret)
		}
	}
	for _, path := range fake.paths {
		if strings.Contains(path, "history") {
			t.Errorf("the history was read (it carries search addresses with keys): %s", path)
		}
	}
}

// A topic that is off is not asked for.
func TestProwlarrSkipsTopicsThatAreOff(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeProwlarr(t)
	widget := prowlarrSetUp(t, h, fake, map[string]any{"topics": []any{"totals"}})
	got := askProwlarr(t, h, widget).Indexers
	if got == nil || got.Totals == nil || len(got.Indexers) != 0 || len(got.Issues) != 0 {
		t.Fatalf("answer: %+v", got)
	}
	for _, path := range fake.paths {
		if strings.HasSuffix(path, "/health") || strings.HasSuffix(path, "/indexerstatus") {
			t.Errorf("an off topic asked %s", path)
		}
	}
}

// One part failing leaves the others, and the next read comes soon.
func TestProwlarrPartialAnswer(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeProwlarr(t)
	fake.failHealth = true
	widget := prowlarrSetUp(t, h, fake, nil)
	result := askProwlarr(t, h, widget)
	if result.Error != "" || !result.Partial || result.Indexers == nil || len(result.Indexers.Indexers) == 0 {
		t.Fatalf("answer: error %q partial %v %+v", result.Error, result.Partial, result.Indexers)
	}
	// The paused indexer is still an issue; only the health message is gone.
	if len(result.Indexers.Issues) != 1 || result.Indexers.Issues[0].Until == 0 {
		t.Errorf("issues: %+v", result.Indexers.Issues)
	}
}

func TestProwlarrWrongKeyIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeProwlarr(t)
	widget := prowlarrSetUp(t, h, fake, nil)
	if err := saveHealthCredential("widget:w_prowlarr0001", HealthCredential{Headers: map[string]string{"X-Api-Key": "wrong"}}); err != nil {
		t.Fatal(err)
	}
	mediaForgetAll()
	result := askProwlarr(t, h, widget)
	if result.Error != "key refused" || result.Indexers != nil {
		t.Errorf("answer: error %q %v", result.Error, result.Indexers)
	}
}

func TestProwlarrSetupNamesTheVersion(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeProwlarr(t)
	post := func(key string) (int, struct {
		Connected string `json:"connected"`
		Error     string `json:"error"`
	}) {
		raw, _ := json.Marshal(map[string]any{"server": fake.URL, "draftCredential": map[string]any{
			"headers": map[string]any{"X-Api-Key": key}}})
		rec := httptest.NewRecorder()
		h.prowlarrSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/prowlarr/setup", strings.NewReader(string(raw))))
		var answer struct {
			Connected string `json:"connected"`
			Error     string `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &answer)
		return rec.Code, answer
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	if code, _ := post(prowlarrTestKey); code != http.StatusUnauthorized || fake.calls.Load() != 0 {
		t.Fatalf("without the write token: %d, %d calls", code, fake.calls.Load())
	}
	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	code, answer := post(prowlarrTestKey)
	if code != http.StatusOK || answer.Error != "" || answer.Connected != "Prowlarr 2.7.0.5723" {
		t.Fatalf("setup: %d %+v", code, answer)
	}
	if _, answer := post("wrong"); answer.Error != "key refused" {
		t.Errorf("a wrong key: %+v", answer)
	}
}
