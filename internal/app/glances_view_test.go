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

// glancesViewSetup saves the Glances settings pointed at a fake.
func glancesViewSetup(t *testing.T) (*Handlers, *glancesViewFake, GlancesConfig) {
	t.Helper()
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	glancesViewForgetAll()
	fake := newGlancesViewFake(t)
	cfg, err := saveGlancesConfig(GlancesConfig{Enabled: true, Server: fake.URL, Refresh: 2}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return h, fake, cfg
}

func glancesViewDo(h *Handlers, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.glancesViewHandler(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestGlancesViewAllowlist(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	base := "/api/glances/"
	for _, path := range []string{
		"quicklook", "cpu", "mem", "memswap", "load", "fs", "diskio", "network", "connections",
		"sensors", "system", "uptime", "processlist", "containers", "alert", "smart", "raid",
		"pluginslist", "all/limits", "processes/1000",
	} {
		rec := glancesViewDo(h, http.MethodGet, base+path+"")
		if rec.Code != http.StatusOK {
			t.Errorf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	for _, path := range []string{
		"events/clear/all", "../status", "processes/abc", "cpu/history/../all", "all", "status",
		"cpu/history/10", "cpu/history/", "cpu/history", "history", "config", "connect",
		"processlist/history/10", "sensors/history/10", "quicklook/", "/quicklook", "quicklook//",
		"processes/", "processes/1/2", "processes/-1", "cpu%2Fhistory%2F10", "q%75icklook", "QUICKLOOK", "",
	} {
		rec := glancesViewDo(h, http.MethodGet, base+path+"")
		if rec.Code != http.StatusNotFound {
			t.Errorf("%q: %d, want 404", path, rec.Code)
		}
	}
	if rec := glancesViewDo(h, http.MethodPost, base+"quicklook"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", rec.Code)
	}
	// Not switched on: nothing is asked, and the page is told.
	asked := fake.hitsFor("load")
	if _, err := saveGlancesConfig(GlancesConfig{Enabled: false, Server: fake.URL}, nil); err != nil {
		t.Fatal(err)
	}
	if rec := glancesViewDo(h, http.MethodGet, base+"load"); strings.TrimSpace(rec.Body.String()) != `{"error":"not set up"}` || fake.hitsFor("load") != asked {
		t.Errorf("switched off: %s, hits %d, was %d", rec.Body.String(), fake.hitsFor("load"), asked)
	}
	if _, err := saveGlancesConfig(GlancesConfig{Enabled: true, Server: fake.URL}, nil); err != nil {
		t.Fatal(err)
	}

	// The browser cannot name another server, and its query is never forwarded.
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { elsewhere.Add(1) }))
	defer other.Close()
	glancesViewDo(h, http.MethodGet, base+"load?server="+other.URL+"&")
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
		r.ServeHTTP(rec, httptest.NewRequest(method, base+"quicklook", nil))
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("router %s: %d", method, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, base+"events/clear/all", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("router events/clear/all: %d", rec.Code)
	}
}

func TestGlancesViewCoalesces(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	fake.delay = 100 * time.Millisecond
	var wg sync.WaitGroup
	codes := make([]int, 3)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = glancesViewDo(h, http.MethodGet, "/api/glances/fs").Code
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
	glancesViewDo(h, http.MethodGet, "/api/glances/fs")
	if got := fake.hitsFor("fs"); got != 1 {
		t.Errorf("a cached path was asked again: %d", got)
	}
}

func TestGlancesViewIgnoresTheOutboundLimit(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	h.ssrfAPILimiter = newSlidingWindowLimiter(1, time.Minute)
	for i := 0; i < 5; i++ {
		glancesViewForgetAll()
		if rec := glancesViewDo(h, http.MethodGet, "/api/glances/load"); rec.Code != http.StatusOK {
			t.Fatalf("read %d: %d", i, rec.Code)
		}
	}
	if fake.hitsFor("load") != 5 {
		t.Errorf("load asked %d times", fake.hitsFor("load"))
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
	if got := glancesViewTTL("pluginslist", GlancesConfig{Refresh: 1}); got != 5*time.Minute {
		t.Errorf("pluginslist: %v", got)
	}
	// Three quarters of the refresh: an open page polling every beat gets a
	// fresh answer each time, and a second tab still shares one.
	for refresh, want := range map[int]time.Duration{
		1:  750 * time.Millisecond,
		2:  1500 * time.Millisecond,
		5:  3750 * time.Millisecond,
		10: 7500 * time.Millisecond,
	} {
		if got := glancesViewTTL("fs", GlancesConfig{Refresh: refresh}); got != want {
			t.Errorf("fs at %ds: %v, want %v", refresh, got, want)
		}
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
	h, fake, _ := glancesViewSetup(t)
	fake.override["processlist"] = glancesManyProcesses(500)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/processlist")
	var rows []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err, rec.Body.String())
	}
	if len(rows) != 200 || strings.Contains(rec.Body.String(), "cmdline") || strings.Contains(rec.Body.String(), "secret") {
		t.Errorf("route: %d rows, cmdline=%v", len(rows), strings.Contains(rec.Body.String(), "cmdline"))
	}
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/processlist?q=jelly&sort=pid")
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
	h, _, _ := glancesViewSetup(t)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/processes/25314")
	var answer map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &answer); err != nil {
		t.Fatal(err, rec.Body.String())
	}
	cmdline, _ := answer["cmdline"].([]any)
	if len(answer) != 2 || answer["pid"].(float64) != 25314 || len(cmdline) != 1 || cmdline[0] != "scrubbed" {
		t.Errorf("per pid: %s", rec.Body.String())
	}
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/processes/4242")
	if strings.TrimSpace(rec.Body.String()) != `{"available":false}` {
		t.Errorf("a process that is gone: %s", rec.Body.String())
	}
}

func TestGlancesViewPluginMissing(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	rec := glancesViewDo(h, http.MethodGet, "/api/glances/wifi")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"available":false}` {
		t.Errorf("404 plugin: %d %s", rec.Code, rec.Body.String())
	}
	fake.Close()
	rec = glancesViewDo(h, http.MethodGet, "/api/glances/smart")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"error":"unreachable"}` {
		t.Errorf("server gone: %d %s", rec.Code, rec.Body.String())
	}
}

// A command line can carry a secret, so it is behind the write token, as the
// docker logs are; the list without command lines is not.
func TestGlancesProcessCmdlineNeedsWriteAccess(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	target := "/api/glances/processes/25314"
	rec := glancesViewDo(h, http.MethodGet, target)
	if rec.Code != http.StatusUnauthorized || strings.Contains(rec.Body.String(), "cmdline") {
		t.Errorf("without the token: %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("X-NextDash-Token", "wrong")
	rec = httptest.NewRecorder()
	h.glancesViewHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("with a wrong token: %d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("X-NextDash-Token", "tok")
	rec = httptest.NewRecorder()
	h.glancesViewHandler(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"cmdline"`) {
		t.Errorf("with the token: %d %s", rec.Code, rec.Body.String())
	}
	if rec := glancesViewDo(h, http.MethodGet, "/api/glances/processlist"); rec.Code != http.StatusOK {
		t.Errorf("the list without the token: %d", rec.Code)
	}
}
