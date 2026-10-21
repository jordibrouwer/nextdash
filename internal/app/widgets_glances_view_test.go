package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

// glancesViewFake answers from the fixtures and counts what it was asked.
// Every path in override answers that body instead; a nil body is a 404.
type glancesViewFake struct {
	*httptest.Server
	mu       sync.Mutex
	hits     map[string]int
	queries  []string
	methods  []string
	override map[string][]byte
	delay    time.Duration
}

func newGlancesViewFake(t *testing.T) *glancesViewFake {
	t.Helper()
	fake := &glancesViewFake{hits: map[string]int{}, override: map[string][]byte{}}
	fake.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/api/4/")
		fake.mu.Lock()
		fake.hits[name]++
		fake.queries = append(fake.queries, r.URL.RawQuery)
		fake.methods = append(fake.methods, r.Method)
		body, overridden := fake.override[name]
		delay := fake.delay
		fake.mu.Unlock()
		time.Sleep(delay)
		if overridden {
			if body == nil {
				http.NotFound(w, r)
				return
			}
			_, _ = w.Write(body)
			return
		}
		file := name
		switch {
		case name == "all/limits":
			file = "limits"
		case strings.HasPrefix(name, "cpu/history/"):
			file = "history_cpu"
		}
		raw, err := os.ReadFile(filepath.Join("testdata", "glances", file+".json"))
		if err != nil || strings.Contains(file, "/") {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(raw)
	}))
	t.Cleanup(fake.Close)
	return fake
}

func (f *glancesViewFake) hitsFor(name string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[name]
}

// glancesViewSetup saves one Glances widget on page 1 pointed at a fake.
func glancesViewSetup(t *testing.T) (*Handlers, *glancesViewFake, Widget) {
	t.Helper()
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	glancesViewForgetAll()
	fake := newGlancesViewFake(t)
	widget := Widget{ID: "w_glancesview", Type: WidgetTypeGlances, Config: map[string]any{"server": fake.URL}}
	other := Widget{ID: "w_beszelview0", Type: WidgetTypeBeszel, Config: map[string]any{"server": fake.URL}}
	if err := h.store.SavePageBlocks(1, []Widget{widget, other}, nil); err != nil {
		t.Fatal(err)
	}
	return h, fake, widget
}

func glancesViewDo(h *Handlers, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.glancesViewHandler(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestGlancesViewAllowlist(t *testing.T) {
	h, fake, widget := glancesViewSetup(t)
	base := "/api/glances/" + widget.ID + "/"
	for _, path := range []string{
		"quicklook", "cpu", "mem", "memswap", "load", "fs", "diskio", "network", "connections",
		"sensors", "system", "uptime", "processlist", "containers", "alert", "smart", "raid",
		"pluginslist", "all/limits", "cpu/history/10", "cpu/history/1200", "processes/1000",
	} {
		rec := glancesViewDo(h, http.MethodGet, base+path+"?pageId=1")
		if rec.Code != http.StatusOK {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	for _, path := range []string{
		"events/clear/all", "../status", "processes/abc", "cpu/history/../all", "all", "status",
		"cpu/history/0", "cpu/history/1201", "cpu/history/5x", "cpu/history/", "cpu/history",
		"processlist/history/10", "sensors/history/10", "quicklook/", "/quicklook", "quicklook//",
		"processes/", "processes/1/2", "processes/-1", "cpu%2Fhistory%2F10", "q%75icklook", "QUICKLOOK", "",
	} {
		rec := glancesViewDo(h, http.MethodGet, base+path+"?pageId=1")
		if rec.Code != http.StatusNotFound {
			t.Errorf("%q: %d, want 404", path, rec.Code)
		}
	}
	if rec := glancesViewDo(h, http.MethodPost, base+"quicklook?pageId=1"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", rec.Code)
	}
	if rec := glancesViewDo(h, http.MethodGet, "/api/glances/w_nothere0000/quicklook?pageId=1"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown widget: %d", rec.Code)
	}
	if rec := glancesViewDo(h, http.MethodGet, "/api/glances/w_beszelview0/quicklook?pageId=1"); rec.Code != http.StatusNotFound {
		t.Errorf("a widget of another type: %d", rec.Code)
	}
	if rec := glancesViewDo(h, http.MethodGet, base+"quicklook?pageId=x"); rec.Code != http.StatusBadRequest {
		t.Errorf("bad page id: %d", rec.Code)
	}

	// The browser cannot name another server, and its query is never forwarded.
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { elsewhere.Add(1) }))
	defer other.Close()
	glancesViewDo(h, http.MethodGet, base+"load?pageId=1&server="+other.URL+"&credentialId=c1")
	if elsewhere.Load() != 0 || fake.hitsFor("load") != 1 {
		t.Errorf("server from the request: elsewhere=%d load=%d", elsewhere.Load(), fake.hitsFor("load"))
	}
	fake.mu.Lock()
	for i, q := range fake.queries {
		if q != "" || fake.methods[i] != http.MethodGet {
			t.Errorf("forwarded %s with query %q", fake.methods[i], q)
		}
	}
	fake.mu.Unlock()

	// Through the real route: every other method is refused before the handler.
	r := mux.NewRouter()
	registerGlancesViewRoutes(r, h)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(method, base+"quicklook?pageId=1", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("router %s: %d", method, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, base+"cpu/history/10?pageId=1", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "total") {
		t.Errorf("router GET history: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, base+"events/clear/all?pageId=1", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("router events/clear/all: %d", rec.Code)
	}
}

func TestGlancesViewCoalesces(t *testing.T) {
	h, fake, widget := glancesViewSetup(t)
	fake.delay = 100 * time.Millisecond
	var wg sync.WaitGroup
	codes := make([]int, 3)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/fs?pageId=1").Code
		}()
	}
	wg.Wait()
	if got := fake.hitsFor("fs"); got != 1 {
		t.Errorf("three readers asked Glances %d times", got)
	}
	for i, code := range codes {
		if code != http.StatusOK {
			t.Errorf("reader %d: %d", i, code)
		}
	}
	// And a fourth, just after, reads the cached answer.
	glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/fs?pageId=1")
	if got := fake.hitsFor("fs"); got != 1 {
		t.Errorf("a cached path was asked again: %d", got)
	}
}

func TestGlancesViewRateLimitOnMissOnly(t *testing.T) {
	h, fake, widget := glancesViewSetup(t)
	h.ssrfAPILimiter = newSlidingWindowLimiter(2, time.Minute)
	base := "/api/glances/" + widget.ID + "/"
	// Refused paths cost nothing: if they did, the budget of two would be gone.
	for _, path := range []string{"events/clear/all", "all", "status", "processes/abc"} {
		if rec := glancesViewDo(h, http.MethodGet, base+path+"?pageId=1"); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
	for _, path := range []string{"fs", "processlist"} {
		if rec := glancesViewDo(h, http.MethodGet, base+path+"?pageId=1"); rec.Code != http.StatusOK {
			t.Fatalf("%s within the budget: %d", path, rec.Code)
		}
	}
	// The budget is used up: cached answers and one process from the cached
	// list still answer, a path that would go out is 429.
	for _, path := range []string{"fs?pageId=1", "processlist?sort=name&q=d&pageId=1", "processes/1037?pageId=1"} {
		if rec := glancesViewDo(h, http.MethodGet, base+path); rec.Code != http.StatusOK {
			t.Errorf("cached %s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	rec := glancesViewDo(h, http.MethodGet, base+"load?pageId=1")
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Errorf("uncached over the budget: %d", rec.Code)
	}
	if fake.hitsFor("load") != 0 {
		t.Errorf("a refused read still reached Glances")
	}
	// A refusal is not kept: with budget again, the path is asked.
	h.ssrfAPILimiter = newSlidingWindowLimiter(1, time.Minute)
	if rec := glancesViewDo(h, http.MethodGet, base+"load?pageId=1"); rec.Code != http.StatusOK || fake.hitsFor("load") != 1 {
		t.Errorf("after the budget is back: %d, hits %d", rec.Code, fake.hitsFor("load"))
	}
}

func TestGlancesCachedSurvivesPanic(t *testing.T) {
	glancesViewForgetAll()
	key := "glances-panic-test"
	_, err := glancesCached(key, time.Minute, func() ([]byte, error) { panic("boom") })
	if err == nil {
		t.Fatal("a panicking fetch answered without an error")
	}
	done := make(chan struct{})
	calls := 0
	var data []byte
	go func() {
		defer close(done)
		data, err = glancesCached(key, time.Minute, func() ([]byte, error) { calls++; return []byte(`{}`), nil })
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("the second read hangs after a panic")
	}
	if err != nil || calls != 1 || string(data) != `{}` {
		t.Errorf("second read: %q %v, fetched %d times", data, err, calls)
	}
}

func TestGlancesViewTTL(t *testing.T) {
	if got := glancesViewTTL("pluginslist", glancesSpec{TTL: 30 * time.Second}); got != 5*time.Minute {
		t.Errorf("pluginslist: %v", got)
	}
	if got := glancesViewTTL("fs", glancesSpec{TTL: 30 * time.Second}); got != 15*time.Second {
		t.Errorf("fs at 30 s: %v", got)
	}
	if got := glancesViewTTL("fs", glancesSpec{TTL: 3 * time.Second}); got != 2*time.Second {
		t.Errorf("the floor: %v", got)
	}
}

func glancesManyProcesses(n int) []byte {
	rows := make([]map[string]any, n)
	for i := range rows {
		name := fmt.Sprintf("proc%03d", i)
		if i%100 == 7 {
			name = "Jellyfin"
		}
		rows[i] = map[string]any{
			"pid": 1000 + i, "name": name, "cpu_percent": float64((i * 37) % 500), "memory_percent": float64(i % 50),
			"cmdline":     []string{"/usr/bin/" + name, "--token=secret" + fmt.Sprint(i)},
			"memory_info": map[string]any{"rss": 100, "vms": 200, "shared": 3, "text": 4, "data": 5},
		}
	}
	raw, _ := json.Marshal(rows)
	return raw
}

func TestGlancesProcessesCutAndStrip(t *testing.T) {
	var raw []map[string]any
	_ = json.Unmarshal(glancesManyProcesses(500), &raw)
	out := glancesProcesses(raw, "", "", 200)
	if len(out) != 200 {
		t.Fatalf("cut to %d", len(out))
	}
	for i := 1; i < len(out); i++ {
		if out[i-1]["cpu_percent"].(float64) < out[i]["cpu_percent"].(float64) {
			t.Fatalf("not cpu desc at %d", i)
		}
	}
	for _, row := range out {
		if _, ok := row["cmdline"]; ok {
			t.Fatal("cmdline kept")
		}
		if info := row["memory_info"].(map[string]any); len(info) != 2 || info["rss"] == nil || info["vms"] == nil {
			t.Fatalf("memory_info: %v", info)
		}
	}
	byName := glancesProcesses(raw, "name", "", 200)
	if byName[0]["name"] != "Jellyfin" || byName[len(byName)-1]["name"].(string) < byName[len(byName)-2]["name"].(string) {
		t.Errorf("name sort: %v .. %v", byName[0]["name"], byName[len(byName)-1]["name"])
	}
	byPid := glancesProcesses(raw, "pid", "", 3)
	if byPid[0]["pid"].(float64) != 1000 || byPid[2]["pid"].(float64) != 1002 {
		t.Errorf("pid sort: %v", byPid)
	}
	byMem := glancesProcesses(raw, "mem", "", 200)
	if byMem[0]["memory_percent"].(float64) != 49 {
		t.Errorf("mem sort: %v", byMem[0])
	}

	// Through the route: 500 rows in, 200 out, no command line anywhere.
	h, fake, widget := glancesViewSetup(t)
	fake.override["processlist"] = glancesManyProcesses(500)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/processlist?pageId=1")
	var rows []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err, rec.Body.String())
	}
	if len(rows) != 200 || strings.Contains(rec.Body.String(), "cmdline") || strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("route: %d rows, cmdline=%v", len(rows), strings.Contains(rec.Body.String(), "cmdline"))
	}
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/processlist?pageId=1&q=jelly&sort=pid")
	rows = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &rows)
	if len(rows) != 5 {
		t.Fatalf("q=jelly: %d rows", len(rows))
	}
	for i, row := range rows {
		if row["name"] != "Jellyfin" || i > 0 && rows[i-1]["pid"].(float64) > row["pid"].(float64) {
			t.Errorf("q=jelly row %d: %v", i, row)
		}
	}
	if got := fake.hitsFor("processlist"); got != 1 {
		t.Errorf("sort and search asked Glances again: %d", got)
	}
}

func TestGlancesProcessCmdlineOnDemand(t *testing.T) {
	h, _, widget := glancesViewSetup(t)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/processes/1037?pageId=1")
	var answer map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err, rec.Body.String())
	}
	cmdline, _ := answer["cmdline"].([]any)
	if len(answer) != 2 || answer["pid"].(float64) != 1037 || len(cmdline) != 1 || cmdline[0] != "scrubbed" {
		t.Errorf("per pid: %s", rec.Body.String())
	}
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/processes/4242?pageId=1")
	if strings.TrimSpace(rec.Body.String()) != `{"available":false}` {
		t.Errorf("a process that is gone: %s", rec.Body.String())
	}
}

func TestGlancesViewPluginMissing(t *testing.T) {
	h, fake, widget := glancesViewSetup(t)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/wifi?pageId=1")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"available":false}` {
		t.Errorf("404 plugin: %d %s", rec.Code, rec.Body.String())
	}
	fake.Close()
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/"+widget.ID+"/smart?pageId=1")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"error":"unreachable"}` {
		t.Errorf("server gone: %d %s", rec.Code, rec.Body.String())
	}
}
