package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const sabTestKey = "sab0123456789abcdef0123456789abcd"

// fakeSABnzbd answers from testdata/sabnzbd: shapes recorded from a real
// SABnzbd 5.1. The queue was empty when recorded; its two slots follow the
// documented slot shape.
type fakeSABnzbd struct {
	*httptest.Server
	mu      sync.Mutex
	queries []string
	// oldRefusal answers a wrong key the way SABnzbd 3 and 4 do: 200 with
	// an error in the body, rather than 403.
	oldRefusal bool
	history    []byte
	queue      []byte
}

func readSABFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "sabnzbd", name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func newFakeSABnzbd(t *testing.T) *fakeSABnzbd {
	t.Helper()
	version := readSABFixture(t, "version.json")
	fake := &fakeSABnzbd{queue: readSABFixture(t, "queue.json"), history: readSABFixture(t, "history.json")}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.mu.Lock()
		defer fake.mu.Unlock()
		fake.queries = append(fake.queries, r.URL.RawQuery)
		q := r.URL.Query()
		if r.URL.Path != "/api" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if q.Get("mode") == "version" {
			_, _ = w.Write(version)
			return
		}
		if q.Get("apikey") != sabTestKey {
			if fake.oldRefusal {
				_, _ = w.Write([]byte(`{"status": false, "error": "API Key Incorrect"}`))
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}
		switch q.Get("mode") {
		case "queue":
			_, _ = w.Write(fake.queue)
		case "history":
			_, _ = w.Write(fake.history)
		default:
			_, _ = w.Write([]byte(`{"status": false, "error": "not implemented"}`))
		}
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *fakeSABnzbd) asked(mode string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, q := range f.queries {
		if strings.Contains(q, "mode="+mode) {
			return true
		}
	}
	return false
}

func sabTestSpec(t *testing.T, h *Handlers, fake *fakeSABnzbd, key string, config map[string]any) downloadSpec {
	t.Helper()
	allowLocalForTest(t, h, true)
	if err := saveHealthCredential("widget:w_sabnzbd00001", HealthCredential{
		Label: "SABnzbd", Query: map[string]string{"apikey": key},
	}); err != nil {
		t.Fatal(err)
	}
	full := map[string]any{"server": fake.URL, "credentialId": "widget:w_sabnzbd00001", "filter": "all"}
	for k, v := range config {
		full[k] = v
	}
	return downloadSpecFrom(sanitizeWidgetConfig(WidgetTypeSABnzbd, full))
}

func TestSABnzbdReadsQueueAndHistory(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	spec := sabTestSpec(t, h, fake, sabTestKey, nil)

	result, err := h.fetchSABnzbd(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 5 {
		t.Fatalf("%d items, want 2 queued and 3 finished", len(result.Items))
	}
	busy := itemByTitle(t, result.Items, "Example.Show.S02E03.1080p")
	if busy.LibraryID != "active" || busy.ID != "SABnzbd_nzo_example1" || busy.Progress == nil || *busy.Progress != 0.5 ||
		busy.Size != 2048<<20 || busy.Left != "0:03:25" || busy.Subtitle != "tv" || busy.Speed != 5120*1024 {
		t.Errorf("downloading: %+v", busy)
	}
	waiting := itemByTitle(t, result.Items, "Example.Movie.2023.1080p")
	if waiting.LibraryID != "paused" || waiting.Left != "" || waiting.Subtitle != "" || waiting.Speed != 0 {
		t.Errorf("paused: %+v", waiting)
	}
	done := itemByTitle(t, result.Items, "Example.Download.1")
	if done.LibraryID != "done" || done.Size != 1036053295 || done.AddedAt != 1791822228000 {
		t.Errorf("finished: %+v", done)
	}
	if result.Totals == nil || *result.Totals != (MediaTotals{Down: 5120 * 1024, Active: 1, Paused: 1, Done: 3}) {
		t.Errorf("totals: %+v", result.Totals)
	}
	for _, item := range result.Items {
		if strings.Contains(item.OpenURL, sabTestKey) {
			t.Errorf("the key is in an address: %s", item.OpenURL)
		}
	}
}

// A failed download is finished, but not done: it says so and is not counted.
func TestSABnzbdFailedDownload(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	fake.history = []byte(strings.Replace(string(fake.history), `"status": "Completed"`, `"status": "Failed"`, 1))
	spec := sabTestSpec(t, h, fake, sabTestKey, map[string]any{"filter": "completed"})

	result, err := h.fetchSABnzbd(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	failed := itemByTitle(t, result.Items, "Example.Download.1")
	if failed.Subtitle != "failed" || failed.Progress != nil {
		t.Errorf("failed: %+v", failed)
	}
	if result.Totals == nil || result.Totals.Done != 2 {
		t.Errorf("totals: %+v", result.Totals)
	}
}

func TestSABnzbdPausedQueueAndFilters(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	fake.queue = []byte(strings.Replace(string(fake.queue), `"paused": false`, `"paused": true`, 1))
	spec := sabTestSpec(t, h, fake, sabTestKey, map[string]any{"filter": "paused"})

	result, err := h.fetchSABnzbd(context.Background(), spec)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 {
		t.Errorf("a paused queue pauses every slot: %+v", result.Items)
	}
	if fake.asked("history") {
		t.Errorf("history asked for although nothing finished is shown")
	}
}

func TestSABnzbdRefusedKey(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeSABnzbd(t)
	spec := sabTestSpec(t, h, fake, "wrong", nil)
	if _, err := h.fetchSABnzbd(context.Background(), spec); mediaErrorCode(err) != "key refused" {
		t.Errorf("403: %v", err)
	}
	fake.oldRefusal = true
	if _, err := h.fetchSABnzbd(context.Background(), spec); mediaErrorCode(err) != "key refused" {
		t.Errorf("200 with an error: %v", err)
	}
}

func TestSABnzbdSetup(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newFakeSABnzbd(t)
	body := `{"server":"` + fake.URL + `","draftCredential":{"query":{"apikey":"` + sabTestKey + `"}}}`

	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	rec := httptest.NewRecorder()
	h.sabnzbdSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/sabnzbd/setup", strings.NewReader(body)))
	if rec.Code != http.StatusUnauthorized || fake.asked("queue") {
		t.Fatalf("without the write token: %d", rec.Code)
	}

	t.Setenv("NEXTDASH_WRITE_TOKEN", "")
	rec = httptest.NewRecorder()
	h.sabnzbdSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/sabnzbd/setup", strings.NewReader(body)))
	var answer struct {
		ServerName string `json:"serverName"`
		Version    string `json:"version"`
		Error      string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err)
	}
	if answer.Error != "" || answer.ServerName != "SABnzbd" || answer.Version != "5.1.3" {
		t.Errorf("setup: %+v", answer)
	}

	// The version answers anyone; a wrong key must still read as refused.
	wrong := strings.Replace(body, sabTestKey, "wrong", 1)
	rec = httptest.NewRecorder()
	h.sabnzbdSetupHandler(rec, httptest.NewRequest(http.MethodPost, "/api/widgets/sabnzbd/setup", strings.NewReader(wrong)))
	if !strings.Contains(rec.Body.String(), `"error":"key refused"`) {
		t.Errorf("wrong key: %s", rec.Body.String())
	}
}
