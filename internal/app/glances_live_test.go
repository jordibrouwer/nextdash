package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

func fixtureBytes(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile("testdata/glances/" + name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// ---- settings ----

func TestGlancesConfigNormalizes(t *testing.T) {
	cfg := normalizeGlancesConfig(GlancesConfig{
		Server: " http://nas.local:61208/ ", User: " me ", Refresh: 3,
		HiddenBlocks: []string{"temps", "nonsense", "temps", "alerts"},
		Thresholds:   GlancesThresholds{CPUWarn: 95, CPUBad: 90, MemWarn: 70, MemBad: 85},
		DiskStrip:    " /rootfs ", DiskHide: []string{" /mnt/cache ", ""},
	})
	if cfg.Server != "http://nas.local:61208" || cfg.User != "me" || cfg.Refresh != 2 {
		t.Errorf("server/user/refresh: %+v", cfg)
	}
	if strings.Join(cfg.HiddenBlocks, ",") != "alerts,temps" {
		t.Errorf("hidden blocks: %v", cfg.HiddenBlocks)
	}
	// An inverted pair goes back to the default; a good pair stays.
	if cfg.Thresholds.CPUWarn != 80 || cfg.Thresholds.CPUBad != 90 || cfg.Thresholds.MemWarn != 70 || cfg.Thresholds.MemBad != 85 {
		t.Errorf("thresholds: %+v", cfg.Thresholds)
	}
	if cfg.DiskStrip != "/rootfs" || len(cfg.DiskHide) != 1 || cfg.DiskHide[0] != "/mnt/cache" {
		t.Errorf("disk: %q %v", cfg.DiskStrip, cfg.DiskHide)
	}
	if bad := normalizeGlancesConfig(GlancesConfig{Server: "ftp://nas"}); bad.Server != "" {
		t.Errorf("a non-http address was kept: %q", bad.Server)
	}
}

func TestGlancesConfigPasswordIsKeptApart(t *testing.T) {
	newTestHandlers(t)
	if cfg := loadGlancesConfig(); cfg.Enabled || cfg.Refresh != 2 || cfg.DiskStrip != "/rootfs" {
		t.Fatalf("defaults: %+v", cfg)
	}
	pw := "s3cret"
	cfg, err := saveGlancesConfig(GlancesConfig{Enabled: true, Server: "http://nas:61208", User: "me", Refresh: 5}, &pw)
	if err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(glancesConfigPath()); strings.Contains(string(raw), "s3cret") {
		t.Fatal("the password is in the settings file")
	}
	if info, err := os.Stat(glancesSecretsPath()); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("secrets file: %v %v", info, err)
	}
	if cred := glancesCredential(cfg); cred.BasicUser != "me" || cred.BasicPassword != "s3cret" {
		t.Errorf("credential: %+v", cred)
	}
	// Saved again without a password: it is kept.
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	if !glancesHasPassword() {
		t.Error("a save without a password dropped it")
	}
	// No user: nothing to send it as, so it goes.
	cfg.User = ""
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	if glancesHasPassword() || glancesCredential(cfg).BasicUser != "" {
		t.Error("the password outlived the user")
	}
}

func TestGlancesConfigHandler(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	do := func(method, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/glances/config", strings.NewReader(body))
		if token != "" {
			req.Header.Set("X-NextDash-Token", token)
		}
		rec := httptest.NewRecorder()
		h.glancesConfigHandler(rec, req)
		return rec
	}
	if rec := do(http.MethodGet, "", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("read without the token: %d", rec.Code)
	}
	if rec := do(http.MethodPut, `{"enabled":true}`, "tok"); rec.Code != http.StatusBadRequest {
		t.Errorf("on without an address: %d", rec.Code)
	}
	rec := do(http.MethodPut, `{"enabled":true,"server":"http://nas:61208","user":"me","password":"pw","refresh":5,"hiddenBlocks":["alerts"]}`, "tok")
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "pw") && strings.Contains(rec.Body.String(), `"password"`) {
		t.Errorf("the answer carries the password: %s", rec.Body.String())
	}
	var got glancesConfigAnswer
	if err := json.Unmarshal(do(http.MethodGet, "", "tok").Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Enabled || got.Server != "http://nas:61208" || got.User != "me" || !got.HasPassword || got.Refresh != 5 ||
		len(got.HiddenBlocks) != 1 || len(got.Blocks) != len(glancesBlocks) {
		t.Errorf("read back: %+v", got)
	}
	// A field the request leaves out stays as it was.
	do(http.MethodPut, `{"refresh":10}`, "tok")
	if cfg := loadGlancesConfig(); cfg.Refresh != 10 || cfg.Server != "http://nas:61208" || !glancesHasPassword() {
		t.Errorf("partial save: %+v", cfg)
	}
	// Remove the login: user and password go together.
	do(http.MethodPut, `{"clearLogin":true}`, "tok")
	if cfg := loadGlancesConfig(); cfg.User != "" || glancesHasPassword() {
		t.Errorf("clearLogin: %+v", cfg)
	}
}

// ---- the real host ----

// The host in the fixtures is Glances in a container on Unraid: its own root,
// docker's storage and the squashfs mounts sit beside the machine's disks,
// which are all under /rootfs.
func TestGlancesCleanFSOnTheRealHost(t *testing.T) {
	cfg := defaultGlancesConfig()
	out, err := glancesCleanFS(fixtureBytes(t, "fs"), cfg)
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	_ = json.Unmarshal(out, &rows)
	var names []string
	for _, row := range rows {
		names = append(names, row["mnt_point"].(string))
	}
	want := "/boot,/mnt/disk1,/mnt/disk2,/mnt/disk3,/mnt/cache,/etc/libvirt"
	if got := strings.Join(names, ","); got != want {
		t.Errorf("mounts: %s, want %s", got, want)
	}

	// The reader hides one more, and keeps the prefix when they clear it.
	cfg.DiskHide = []string{"libvirt"}
	out, _ = glancesCleanFS(fixtureBytes(t, "fs"), cfg)
	if strings.Contains(string(out), "libvirt") {
		t.Error("a hidden part was kept")
	}
	cfg.DiskStrip = ""
	out, _ = glancesCleanFS(fixtureBytes(t, "fs"), cfg)
	if !strings.Contains(string(out), "/rootfs/mnt/disk1") || strings.Contains(string(out), "docker/btrfs") {
		t.Errorf("without a prefix: %s", out)
	}
}

func TestGlancesCleanDiskIODropsLoopDevices(t *testing.T) {
	out, err := glancesCleanDiskIO(fixtureBytes(t, "diskio"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(out), `"loop`) || !strings.Contains(string(out), "disk_name") {
		t.Errorf("disks: %.200s", out)
	}
}

func TestGlancesNetworkWithoutIsUpCountsAsUp(t *testing.T) {
	var net []glancesNet
	if err := json.Unmarshal(fixtureBytes(t, "network"), &net); err != nil {
		t.Fatal(err)
	}
	var real []glancesNet
	for _, n := range net {
		if n.up() && !glancesVirtualNIC(n.Name) {
			real = append(real, n)
		}
	}
	if len(real) != 1 || real[0].Name != "eth0" || real[0].RecvRate == nil || *real[0].RecvRate <= 0 {
		t.Errorf("real interfaces: %+v", real)
	}
}

func TestGlancesSensorLimits(t *testing.T) {
	var none, ok = 65261.0, 84.0
	if glancesPlausibleLimit(&none) != nil || glancesPlausibleLimit(&ok) == nil || glancesPlausibleLimit(nil) != nil {
		t.Error("limit plausibility")
	}
	t70, t90 := 70.0, 90.0
	th := defaultGlancesThresholds()
	// A marker limit is no limit: the reader's lines decide.
	if got := glancesSensorTone(glancesSensor{Value: &t70, Warning: &none, Critical: &none}, th); got != "warn" {
		t.Errorf("marker limits at 70: %s", got)
	}
	crit := 94.0
	if got := glancesSensorTone(glancesSensor{Value: &t90, Warning: &ok, Critical: &crit}, th); got != "warn" {
		t.Errorf("own limits at 90: %s", got)
	}
}

// ---- history ----

func TestGlancesRingsKeepADayAndAverageIntoSteps(t *testing.T) {
	newTestHandlers(t)
	loadGlancesHistory()
	every := glancesSampleEvery.Milliseconds()
	// A day and a bit of samples, ending now.
	n := glancesKeep*glancesCoarseEvery + 50
	end := time.Now().UnixMilli()
	for i := 0; i < n; i++ {
		glancesRecord(end-int64(n-1-i)*every, map[string]float64{"cpu": float64(i % 100)})
	}
	ring := glancesRings.series["cpu"]
	if len(ring.Fine) != glancesFineKeep || len(ring.Coarse) != glancesKeep {
		t.Fatalf("kept %d fine and %d coarse points", len(ring.Fine), len(ring.Coarse))
	}

	// The last minute is answered from the fine ring: a line, not a dot.
	now := time.Now()
	minute := glancesQuery([]string{"cpu", "nope"}, now.Add(-time.Minute).UnixMilli(), time.Second, now)
	if _, ok := minute["nope"]; ok {
		t.Error("a series that does not exist answered")
	}
	if got := len(minute["cpu"]); got < 8 {
		t.Errorf("the last minute has %d points", got)
	}
	// A day is answered from the coarse ring, averaged into the step asked.
	day := glancesQuery([]string{"cpu"}, now.Add(-24*time.Hour).UnixMilli(), 5*time.Minute, now)
	if got := len(day["cpu"]); got == 0 || got > 24*12+2 {
		t.Errorf("the day has %d points", got)
	}

	// A gap is a gap: nothing between two readings is invented.
	glancesRecord(end-20*3600_000, map[string]float64{"mem": 50})
	glancesRecord(end-3*3600_000, map[string]float64{"mem": 52})
	for i := 0; i < glancesCoarseEvery; i++ {
		glancesRecord(end+int64(i), map[string]float64{"mem": 51})
	}
	got := glancesQuery([]string{"mem"}, now.Add(-24*time.Hour).UnixMilli(), time.Minute, now)
	if len(got["mem"]) > 3 {
		t.Errorf("mem: %v", got["mem"])
	}

	// The limit on series holds, and one that exists is still kept up.
	for i := 0; i < glancesMaxSeries+10; i++ {
		glancesRecord(end, map[string]float64{"s" + string(rune('A'+i%26)) + string(rune('a'+i/26)): 1})
	}
	if n := len(glancesSeriesNames()); n > glancesMaxSeries {
		t.Errorf("%d series", n)
	}
	before := finePoints("cpu")
	glancesRecord(end+1, map[string]float64{"cpu": 7})
	if finePoints("cpu") < before {
		t.Error("a series that exists was not kept up at the limit")
	}
}

func TestGlancesHistorySurvivesARestart(t *testing.T) {
	newTestHandlers(t)
	loadGlancesHistory()
	glancesRecord(time.Now().UnixMilli(), map[string]float64{"cpu": 12.5, "net:eth0:rx": 100})
	saveGlancesHistory()
	loadGlancesHistory()
	if names := glancesSeriesNames(); strings.Join(names, ",") != "cpu,net:eth0:rx" {
		t.Errorf("after a restart: %v", names)
	}
}

// ---- the sampler ----

func TestGlancesSampleOnceFiles(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	loadGlancesHistory()
	h.glancesSampleOnce(context.Background())

	names := strings.Join(glancesSeriesNames(), ",")
	for _, want := range []string{"cpu", "mem", "swap", "load1", "load15", "net:eth0:rx", "net:eth0:tx", "temp:"} {
		if !strings.Contains(names, want) {
			t.Errorf("no %q series in %s", want, names)
		}
	}
	for _, not := range []string{"net:lo", "net:tunl0", "disk:loop", "net:docker"} {
		if strings.Contains(names, not) {
			t.Errorf("a %q series in %s", not, names)
		}
	}
	if n := strings.Count(names, "temp:"); n > glancesHottest {
		t.Errorf("%d temperature series", n)
	}
	glancesState.Lock()
	ok, level := glancesState.ok, glancesState.level
	glancesState.Unlock()
	if !ok || (level != "ok" && level != "warn" && level != "bad") {
		t.Errorf("state: ok=%v level=%s", ok, level)
	}

	// The machine stops answering: no point, a state of unknown.
	before := finePoints("cpu")
	fake.Close()
	glancesViewForgetAll()
	h.glancesSampleOnce(context.Background())
	glancesState.Lock()
	ok, level = glancesState.ok, glancesState.level
	glancesState.Unlock()
	if ok || level != "unknown" || finePoints("cpu") != before {
		t.Errorf("unreachable: ok=%v level=%s points %d -> %d", ok, level, before, finePoints("cpu"))
	}
}

func TestGlancesSamplerDoesNothingWhenOff(t *testing.T) {
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	fake := newGlancesViewFake(t)
	// An address, but switched off.
	if _, err := saveGlancesConfig(GlancesConfig{Enabled: false, Server: fake.URL}, nil); err != nil {
		t.Fatal(err)
	}
	h.glancesSampleOnce(context.Background())
	fake.mu.Lock()
	asked := len(fake.hits)
	fake.mu.Unlock()
	if asked != 0 {
		t.Errorf("a switched-off sampler asked %d paths", asked)
	}
}

func TestGlancesLevelIsTheWorstReading(t *testing.T) {
	cfg := defaultGlancesConfig()
	pct := func(v float64) *float64 { return &v }
	quick := glancesQuicklook{CPU: pct(10), Mem: pct(20), Swap: pct(0)}
	fs := []glancesFS{{Percent: pct(50)}}
	if got := glancesLevel(cfg, quick, fs, nil); got != "ok" {
		t.Errorf("calm: %s", got)
	}
	fs = append(fs, glancesFS{Percent: pct(85)})
	if got := glancesLevel(cfg, quick, fs, nil); got != "warn" {
		t.Errorf("a disk at 85: %s", got)
	}
	quick.CPU = pct(95)
	if got := glancesLevel(cfg, quick, fs, nil); got != "bad" {
		t.Errorf("cpu at 95: %s", got)
	}
}

// ---- the routes ----

func TestGlancesStatusAndHistoryRoutes(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	loadGlancesHistory()
	glancesRecord(time.Now().UnixMilli(), map[string]float64{"cpu": 33})

	rec := httptest.NewRecorder()
	h.glancesStatusHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/status", nil))
	var status map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &status)
	if status["enabled"] != true || status["configured"] != true || status["refresh"].(float64) != 2 {
		t.Errorf("status: %s", rec.Body.String())
	}
	for _, secret := range []string{"server", "user", "password", "192.", "127.0.0.1"} {
		if strings.Contains(rec.Body.String(), secret) {
			t.Errorf("status carries %q: %s", secret, rec.Body.String())
		}
	}

	rec = httptest.NewRecorder()
	h.glancesHistoryHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/history?series=cpu,nope&since="+strconv.FormatInt(time.Now().Add(-time.Minute).UnixMilli(), 10), nil))
	var hist struct {
		Names  []string                `json:"names"`
		Series map[string][][2]float64 `json:"series"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &hist); err != nil {
		t.Fatal(err)
	}
	if len(hist.Series["cpu"]) != 1 || hist.Series["cpu"][0][1] != 33 || len(hist.Series["nope"]) != 0 || len(hist.Names) == 0 {
		t.Errorf("history: %s", rec.Body.String())
	}

	// Switched off the page does not exist, whatever the sampler last saw.
	if _, err := saveGlancesConfig(GlancesConfig{Enabled: false, Server: "http://x:1"}, nil); err != nil {
		t.Fatal(err)
	}
	rec = httptest.NewRecorder()
	h.glancesStatusHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/status", nil))
	if !strings.Contains(rec.Body.String(), `"configured":false`) || !strings.Contains(rec.Body.String(), `"level":"unknown"`) {
		t.Errorf("off: %s", rec.Body.String())
	}
}

func TestGlancesConnect(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	post := func(body string) map[string]any {
		rec := httptest.NewRecorder()
		h.glancesConnectHandler(rec, httptest.NewRequest(http.MethodPost, "/api/glances/connect", bytes.NewReader([]byte(body))))
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	out := post(`{"server":"` + fake.URL + `"}`)
	if out["connected"] != "Glances 4.5.8" || out["version"] != "4.5.8" || len(out["plugins"].([]any)) == 0 {
		t.Errorf("connect: %v", out)
	}
	// Version 3 answers 404 on every /api/4 path.
	fake.mu.Lock()
	fake.override["status"] = nil
	fake.mu.Unlock()
	if out := post(`{"server":"` + fake.URL + `"}`); out["error"] != "needs Glances 4" {
		t.Errorf("version 3: %v", out)
	}
	if out := post(`{"server":""}`); out["error"] != "not set up" {
		t.Errorf("no address: %v", out)
	}
}

// An open page reads a dozen paths every beat; the shared outbound limit (a
// minute's worth for everything) must not be what stops it.
func TestGlancesReadsAreNotHeldToTheSharedOutboundLimit(t *testing.T) {
	h, fake, cfg := glancesViewSetup(t)
	globalOutboundLimiter.reset()
	for i := 0; i < 150; i++ {
		glancesViewForgetAll()
		if _, err := h.glancesRead(context.Background(), cfg, "load"); err != nil {
			t.Fatalf("read %d: %v", i, err)
		}
	}
	if got := fake.hitsFor("load"); got != 150 {
		t.Errorf("load asked %d times", got)
	}
}

// The sampler is started by main: a beat records a point without anything
// else asking for it, and stops when the process does.
func TestGlancesSamplerRunsOnItsOwn(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	previous := glancesSampleEvery
	glancesSampleEvery = 20 * time.Millisecond
	t.Cleanup(func() { glancesSampleEvery = previous })

	stop := make(chan struct{})
	done := h.StartGlancesSampler(stop)
	// Its last save must be over before the test's folder goes.
	defer func() { close(stop); <-done }()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if finePoints("cpu") >= 2 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the sampler recorded nothing on its own")
}

// finePoints is how many fine points a series has; 0 before its first sample.
func finePoints(name string) int {
	glancesRings.Lock()
	defer glancesRings.Unlock()
	if ring := glancesRings.series[name]; ring != nil {
		return len(ring.Fine)
	}
	return 0
}

// A week and a month are answered from the long ring: a point every quarter of
// an hour, each the average of what it covers.
func TestGlancesLongRingAnswersAWeekAndAMonth(t *testing.T) {
	newTestHandlers(t)
	loadGlancesHistory()
	every := glancesSampleEvery.Milliseconds()
	// Three long points' worth of samples, the first half at 10, the rest at 30.
	n := 3 * glancesLongEvery * glancesCoarseEvery
	end := time.Now().UnixMilli()
	for i := 0; i < n; i++ {
		value := 10.0
		if i >= n/2 {
			value = 30
		}
		glancesRecord(end-int64(n-1-i)*every, map[string]float64{"cpu": value})
	}
	ring := glancesRings.series["cpu"]
	if len(ring.Long) != 3 {
		t.Fatalf("%d long points", len(ring.Long))
	}
	now := time.Now()
	week := glancesQuery([]string{"cpu"}, now.Add(-7*24*time.Hour).UnixMilli(), time.Minute, now)
	if len(week["cpu"]) != 3 {
		t.Errorf("a week: %v", week["cpu"])
	}
	month := glancesQuery([]string{"cpu"}, now.Add(-30*24*time.Hour).UnixMilli(), time.Hour, now)
	if len(month["cpu"]) == 0 || month["cpu"][0][1] < 10 || month["cpu"][len(month["cpu"])-1][1] > 30 {
		t.Errorf("a month: %v", month["cpu"])
	}
	// It is written down and read back with the others.
	saveGlancesHistory()
	loadGlancesHistory()
	if got := len(glancesRings.series["cpu"].Long); got != 3 {
		t.Errorf("after a restart: %d long points", got)
	}
}

// A file full of process and container series must not push the machine's own
// out when it is read back: the two kinds have a limit each.
func TestGlancesHistoryLoadKeepsBaseSeriesBesideManyConsumers(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	now := time.Now()
	glancesRings.Lock()
	glancesRings.series = map[string]*glancesRing{}
	for i := 0; i < 70; i++ {
		glancesRings.series["proc:p"+strconv.Itoa(i)+":cpu"] = &glancesRing{Fine: []glancesPoint{{float64(now.UnixMilli()), 1}}}
	}
	for _, name := range []string{"cpu", "mem", "up", "net:eth0:rx", "fs:/mnt/disk1"} {
		glancesRings.series[name] = &glancesRing{Fine: []glancesPoint{{float64(now.UnixMilli()), 1}}}
	}
	glancesRings.Unlock()
	saveGlancesHistory()
	loadGlancesHistory()
	glancesRings.Lock()
	defer glancesRings.Unlock()
	for _, name := range []string{"cpu", "mem", "up", "net:eth0:rx", "fs:/mnt/disk1"} {
		if glancesRings.series[name] == nil {
			t.Errorf("series %q lost on load", name)
		}
	}
	consumers := 0
	for name := range glancesRings.series {
		if glancesIsConsumer(name) {
			consumers++
		}
	}
	if consumers != glancesMaxConsumers {
		t.Errorf("consumers kept = %d, want %d", consumers, glancesMaxConsumers)
	}
}
