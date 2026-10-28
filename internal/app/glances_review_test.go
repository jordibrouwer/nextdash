package app

import (
	"context"
	"encoding/json"
	"github.com/gorilla/mux"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Every series is cut on the same clock, so two of them started at different
// moments can still be added up by time.
func TestGlancesSeriesShareTheClockGrid(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	every := glancesSampleEvery.Milliseconds()
	start := (time.Now().UnixMilli() / glancesCoarseMs) * glancesCoarseMs
	for i := int64(0); i < 200; i++ {
		at := start + i*every
		readings := map[string]float64{"a": 1}
		if i >= 7 { // starts mid-bucket
			readings["b"] = 2
		}
		glancesRecord(at, readings)
	}
	glancesRings.Lock()
	defer glancesRings.Unlock()
	times := func(name string) map[int64]bool {
		out := map[int64]bool{}
		for _, p := range glancesRings.series[name].Coarse {
			if int64(p[0])%glancesCoarseMs != 0 {
				t.Errorf("%s: a coarse point off the grid: %v", name, p[0])
			}
			out[int64(p[0])] = true
		}
		return out
	}
	a, b := times("a"), times("b")
	shared := 0
	for ts := range b {
		if a[ts] {
			shared++
		}
	}
	if shared < len(b)-1 || len(b) < 10 {
		t.Errorf("a and b share %d of %d coarse times", shared, len(b))
	}
}

// A window of exactly a day, asked a moment after it was worked out, is still
// answered from the coarse ring, not from fifteen-minute points.
func TestGlancesDayWindowKeepsItsResolution(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	now := time.Now()
	for at := now.Add(-24 * time.Hour); at.Before(now); at = at.Add(glancesSampleEvery) {
		glancesRecord(at.UnixMilli(), map[string]float64{"cpu": 10})
	}
	since := now.Add(-24*time.Hour - 3*time.Second).UnixMilli()
	step := max(glancesSampleEvery, 24*time.Hour/glancesMaxPoints)
	got := glancesQuery([]string{"cpu"}, since, step, now.Add(3*time.Second))["cpu"]
	if len(got) < 600 {
		t.Errorf("a day came back as %d points, want about 720", len(got))
	}
}

// An incident whose reading stops arriving ends where it was last seen.
func TestGlancesIncidentEndsWhenItsReadingIsLost(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	t0 := time.Now().UnixMilli()
	for i := int64(0); i < 3; i++ {
		glancesObserve(t0+i*5000, []glancesObservation{{Kind: "disk", Subject: "/mnt/x", Value: 95, Bad: true}})
	}
	if ongoing, _ := glancesIncidentList(); len(ongoing) != 1 {
		t.Fatalf("ongoing: %v", ongoing)
	}
	// Nothing observed any more (Glances switched off, the disk hidden): a few minutes on.
	glancesObserve(t0+5*60*1000, nil)
	ongoing, past := glancesIncidentList()
	if len(ongoing) != 0 || len(past) != 1 || past[0].End < past[0].Start {
		t.Fatalf("after the reading was lost: ongoing=%v past=%v", ongoing, past)
	}
	if past[0].End != t0+10000 {
		t.Errorf("ends at %d, want where it was last seen %d", past[0].End, t0+10000)
	}
}

func TestGlancesIncidentLoadedOpenEndsAtLastSeen(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	glancesIncidents.Lock()
	glancesIncidents.log = []GlancesIncident{{Kind: "cpu", Start: 1000, Seen: 90000}}
	saveGlancesIncidentsLocked()
	glancesIncidents.Unlock()
	loadGlancesIncidents()
	if _, past := glancesIncidentList(); len(past) != 1 || past[0].End != 90000 {
		t.Errorf("a long incident was cut short at load: %v", past)
	}
}

// A host whose quicklook plugin is off is up, not down.
func TestGlancesQuicklookOffIsNotDown(t *testing.T) {
	h, fake, _ := glancesViewSetup(t)
	glancesWipe()
	fake.mu.Lock()
	fake.override["quicklook"] = nil // 404
	fake.mu.Unlock()
	h.glancesSampleOnce(context.Background())
	if finePoints("up") != 1 {
		t.Fatal("no up point")
	}
	glancesRings.Lock()
	up := glancesRings.series["up"].Fine[0][1]
	glancesRings.Unlock()
	if up != 1 {
		t.Errorf("up = %v with only the quicklook off", up)
	}
	if ongoing, _ := glancesIncidentList(); len(ongoing) != 0 {
		t.Errorf("a down incident for a plugin that is off: %v", ongoing)
	}
}

func TestGlancesContainerNetworkIsARate(t *testing.T) {
	rx, tx, cpu := 41.0, 7.0, 3.0
	readings := map[string]float64{}
	glancesConsumers(readings, nil, []glancesContainer{{Name: "app", Status: "running", CPUPercent: &cpu, NetworkRX: &rx, NetworkTX: &tx}}, map[string]bool{"ct:app": true})
	if readings["ct:app:rx"] != 41 || readings["ct:app:tx"] != 7 {
		t.Errorf("readings: %v", readings)
	}
	// Not recorded unless asked for.
	none := map[string]float64{}
	glancesConsumers(none, nil, []glancesContainer{{Name: "app", Status: "running", CPUPercent: &cpu}}, nil)
	if len(none) != 0 {
		t.Errorf("an item nobody asked for was recorded: %v", none)
	}
}

func TestGlancesStackedInterfacesAreNotCountedAgain(t *testing.T) {
	for _, name := range []string{"bond0", "br0", "shim-br0", "vhost0", "docker0", "veth123", "br-abc", "lo"} {
		if !glancesVirtualNIC(name) {
			t.Errorf("%s should be skipped", name)
		}
	}
	for _, name := range []string{"eth0", "eth1", "wlan0", "enp3s0"} {
		if glancesVirtualNIC(name) {
			t.Errorf("%s should count", name)
		}
	}
}

// Stopped items give their place to new ones at once, not after a day.
func TestGlancesUntrackedItemsMakeRoom(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	now := time.Now().UnixMilli()
	tracked := map[string]bool{}
	for i := 0; i < glancesMaxConsumers; i++ {
		glancesRecord(now, map[string]float64{"ct:old" + strconv.Itoa(i) + ":cpu": 1})
	}
	glancesSetTracked(tracked) // none of them is recorded any more
	glancesRecord(now+1000, map[string]float64{"ct:new:cpu": 5})
	glancesRings.Lock()
	_, ok := glancesRings.series["ct:new:cpu"]
	glancesRings.Unlock()
	if !ok {
		t.Error("a newly recorded item got no place while stopped ones held them")
	}
	glancesSetTracked(map[string]bool{})
}

func TestGlancesTrackedLimitIsRefused(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	var names []string
	for i := 0; i <= glancesMaxTracked; i++ {
		names = append(names, `"ct:c`+strconv.Itoa(i)+`"`)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/glances/config", strings.NewReader(`{"trackedHistory":[`+strings.Join(names, ",")+`]}`))
	req.Header.Set("X-NextDash-Token", "tok")
	rec := httptest.NewRecorder()
	h.glancesConfigHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("too many tracked: %d", rec.Code)
	}
}

// What is asked is reduced to what exists, so a made-up value costs nothing.
func TestGlancesInsightsCacheIgnoresMadeUpValues(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	glancesInsightsCache.Lock()
	glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	glancesInsightsCache.Unlock()
	for _, q := range []string{"range=zzz&heat=a", "range=yyy&heat=b&tz=Nope/Nowhere", "range=24h&heat=cpu&tz=UTC", ""} {
		rec := httptest.NewRecorder()
		glancesInsightsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/insights?"+q, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%q: %d", q, rec.Code)
		}
	}
	glancesInsightsCache.Lock()
	defer glancesInsightsCache.Unlock()
	if n := len(glancesInsightsCache.entries); n != 1 {
		t.Errorf("%d cache entries for one real question", n)
	}
}

// Days are the reader's: the same moment is on different dates in different zones.
func TestGlancesInsightsHeatmapUsesTheReadersZone(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	auckland, err := time.LoadLocation("Pacific/Auckland")
	if err != nil {
		t.Skip("no tz database")
	}
	now := time.Now()
	for at := now.Add(-36 * time.Hour); at.Before(now); at = at.Add(30 * time.Second) {
		glancesRecord(at.UnixMilli(), map[string]float64{"cpu": 50})
	}
	utc := glancesComputeInsights(defaultGlancesConfig(), "7d", "cpu", time.UTC, now)
	nz := glancesComputeInsights(defaultGlancesConfig(), "7d", "cpu", auckland, now)
	if utc.Heatmap.Days[len(utc.Heatmap.Days)-1].Date == nz.Heatmap.Days[len(nz.Heatmap.Days)-1].Date &&
		now.In(auckland).Format("2006-01-02") != now.UTC().Format("2006-01-02") {
		t.Error("the heatmap ignored the zone")
	}
}

// Memory is split into programs, cache and free, and the three make a whole.
func TestGlancesMemPartsAddUpToAHundred(t *testing.T) {
	var m glancesMem
	if err := json.Unmarshal(fixtureBytes(t, "mem"), &m); err != nil {
		t.Fatal(err)
	}
	used, cache, free, ok := glancesMemParts(m)
	if !ok {
		t.Fatal("no parts from the real answer")
	}
	if sum := used + cache + free; sum < 99.99 || sum > 100.01 {
		t.Errorf("parts add up to %v", sum)
	}
	// This host: about a quarter in use, most of the rest is cache.
	if used < 20 || used > 28 || cache < 60 || free > 5 {
		t.Errorf("used %.1f cache %.1f free %.1f", used, cache, free)
	}
	if _, _, _, ok := glancesMemParts(glancesMem{}); ok {
		t.Error("parts from nothing")
	}
}

func TestGlancesSamplerRecordsMemoryParts(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	glancesWipe()
	h.glancesSampleOnce(context.Background())
	if finePoints("memc:used") != 1 || finePoints("memc:cache") != 1 || finePoints("memc:free") != 1 {
		t.Error("the memory parts were not recorded")
	}
}

// The history answer carries the incidents of its window, for the bands on a graph.
func TestGlancesHistoryAnswerCarriesIncidents(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	now := time.Now().UnixMilli()
	glancesIncidents.Lock()
	glancesIncidents.log = []GlancesIncident{
		{Kind: "cpu", Start: now - 600000, End: now - 300000, Peak: 95},
		{Kind: "disk", Subject: "/mnt/x", Start: now - 100000, Peak: 92},
		{Kind: "temp", Start: now - 9*3600*1000, End: now - 8*3600*1000},
	}
	glancesIncidents.Unlock()
	rec := httptest.NewRecorder()
	(&Handlers{}).glancesHistoryHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/history?series=cpu&since="+strconv.FormatInt(now-3600000, 10), nil))
	var body struct {
		Incidents []GlancesIncident `json:"incidents"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Incidents) != 2 {
		t.Errorf("incidents in the last hour: %+v", body.Incidents)
	}
}

// Switched off, the connection asks the host for nothing: not the page's reads,
// not the sampler's; the record and the settings still answer.
func TestGlancesPausedConnectionReadsNothing(t *testing.T) {
	h, fake, cfg := glancesViewSetup(t)
	glancesWipe()
	cfg.Paused = true
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	glancesViewForgetAll()

	rec := glancesViewDo(h, http.MethodGet, "/api/glances/quicklook")
	if !strings.Contains(rec.Body.String(), `"error":"paused"`) {
		t.Errorf("a read with the connection off: %s", rec.Body.String())
	}
	h.glancesSampleOnce(context.Background())
	if n := fake.hitsFor("quicklook"); n != 0 {
		t.Errorf("the host was asked %d times with the connection off", n)
	}
	status := httptest.NewRecorder()
	h.glancesStatusHandler(status, httptest.NewRequest(http.MethodGet, "/api/glances/status", nil))
	var got struct {
		Paused     bool   `json:"paused"`
		Configured bool   `json:"configured"`
		Level      string `json:"level"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.Paused || !got.Configured || got.Level != "unknown" {
		t.Errorf("status: %+v", got)
	}
	// Switched on again, the host is read again.
	cfg.Paused = false
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	glancesViewForgetAll()
	h.glancesSampleOnce(context.Background())
	if fake.hitsFor("quicklook") == 0 {
		t.Error("nothing was read after the connection came back")
	}
}

// Every core's load is recorded on its own, for the tile's one-minute trace.
func TestGlancesSamplerRecordsEveryCore(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	glancesWipe()
	h.glancesSampleOnce(context.Background())
	for i := 0; i < 12; i++ {
		if finePoints("core:"+strconv.Itoa(i)) != 1 {
			t.Fatalf("core %d has no point", i)
		}
	}
	if finePoints("core:12") != 0 {
		t.Error("a core the host does not have")
	}
}

func TestGlancesRecordIntervalChoices(t *testing.T) {
	for _, seconds := range []int{2, 5, 10, 30, 60, 300, 900, 1800, 3600} {
		if got := normalizeGlancesRecord(seconds); got != seconds {
			t.Errorf("%d became %d", seconds, got)
		}
	}
	for _, seconds := range []int{0, -1, 3, 61, 99999} {
		if got := normalizeGlancesRecord(seconds); got != glancesDefaultRecord {
			t.Errorf("%d should read as the default, got %d", seconds, got)
		}
	}
	if d := (GlancesConfig{RecordEvery: 900}).recordInterval(); d != 15*time.Minute {
		t.Errorf("interval %v", d)
	}
	if d := (GlancesConfig{}).recordInterval(); d != 30*time.Second {
		t.Errorf("unset interval %v", d)
	}
}

func TestGlancesRecordEveryIsSavedAndReported(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/api/glances/config", strings.NewReader(body))
		req.Header.Set("X-NextDash-Token", "tok")
		rec := httptest.NewRecorder()
		h.glancesConfigHandler(rec, req)
		return rec
	}
	if rec := put(`{"enabled":true,"server":"http://nas:61208","recordEvery":300}`); rec.Code != http.StatusOK {
		t.Fatalf("save: %d", rec.Code)
	}
	if got := loadGlancesConfig().RecordEvery; got != 300 {
		t.Errorf("stored %d", got)
	}
	// A value that is not offered reads as the default; a save of something else keeps it.
	put(`{"recordEvery":7}`)
	if got := loadGlancesConfig().RecordEvery; got != glancesDefaultRecord {
		t.Errorf("odd value stored as %d", got)
	}
	put(`{"recordEvery":900}`)
	put(`{"refresh":5}`)
	if got := loadGlancesConfig().RecordEvery; got != 900 {
		t.Errorf("a save that did not mention it changed it to %d", got)
	}
	status := httptest.NewRecorder()
	h.glancesStatusHandler(status, httptest.NewRequest(http.MethodGet, "/api/glances/status", nil))
	var got struct {
		RecordEvery int `json:"recordEvery"`
	}
	_ = json.Unmarshal(status.Body.Bytes(), &got)
	if got.RecordEvery != 900 {
		t.Errorf("status says %d", got.RecordEvery)
	}
}

// The sampler reads once at start, and a change of pace ends its wait: from an
// hour to thirty seconds does not take an hour to be noticed.
func TestGlancesSamplerReadsAtOnceAndWakesOnAChange(t *testing.T) {
	h, _, cfg := glancesViewSetup(t)
	// A sampler left over from an earlier test may be finishing its last beat.
	time.Sleep(200 * time.Millisecond)
	select { // and a wake left by an earlier save
	case <-mainHost().wake:
	default:
	}
	glancesWipe()
	cfg.RecordEvery = 3600
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	done := h.StartGlancesSampler(stop)
	defer func() { close(stop); <-done }()

	waitFor := func(points int) bool {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if finePoints("cpu") >= points {
				return true
			}
			time.Sleep(20 * time.Millisecond)
		}
		return false
	}
	if !waitFor(1) {
		t.Fatal("nothing was read at start with an hour between readings")
	}
	time.Sleep(300 * time.Millisecond)
	if finePoints("cpu") != 1 {
		t.Fatalf("a second reading came within an hour: %d points", finePoints("cpu"))
	}
	cfg.RecordEvery = 30
	if _, err := saveGlancesConfig(cfg, nil); err != nil {
		t.Fatal(err)
	}
	glancesWakeSampler()
	if !waitFor(2) {
		t.Error("changing the pace did not end the wait")
	}
}

// At five minutes a beat or more, one beat over the line is an incident and one
// under it ends it; at a quick pace it takes two and three.
func TestGlancesIncidentTimingFollowsThePace(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	defer setGlancesBeat(glancesDefaultBeat)
	bad := []glancesObservation{{Kind: "cpu", Value: 95, Bad: true}}
	good := []glancesObservation{{Kind: "cpu", Value: 10}}
	now := time.Now().UnixMilli()

	setGlancesBeat(5 * time.Second)
	glancesObserve(now, bad)
	if ongoing, _ := glancesIncidentList(); len(ongoing) != 0 {
		t.Fatalf("one noisy beat opened an incident at a quick pace: %v", ongoing)
	}
	glancesWipe()

	setGlancesBeat(15 * time.Minute)
	glancesObserve(now, bad)
	if ongoing, _ := glancesIncidentList(); len(ongoing) != 1 {
		t.Fatalf("at fifteen minutes a beat the one beat should open it: %v", ongoing)
	}
	glancesObserve(now+15*60*1000, good)
	if ongoing, past := glancesIncidentList(); len(ongoing) != 0 || len(past) != 1 {
		t.Errorf("one good beat should end it: ongoing=%v past=%v", ongoing, past)
	}
}

// A point stands for as long as the record's own gap: recorded every half hour,
// a day of a steady 1000 B/s is still about 86 MB, not an eighth of it.
func TestGlancesNetworkVolumeFollowsTheRecordingPace(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	now := time.Now()
	for at := now.Add(-4 * 24 * time.Hour); at.Before(now); at = at.Add(30 * time.Minute) {
		glancesRecord(at.UnixMilli(), map[string]float64{"net:eth0:rx": 1000, "net:eth0:tx": 0})
	}
	// Each half-hour point is alone in its quarter-hour slot, so it is filed as a long point of its own.
	// Close the pending buckets the way the next reading would.
	glancesRecord(now.Add(2*time.Hour).UnixMilli(), map[string]float64{"net:eth0:rx": 1000, "net:eth0:tx": 0})
	out := glancesComputeInsights(defaultGlancesConfig(), "7d", "cpu", time.UTC, now)
	var full float64
	for _, d := range out.Network.Days {
		if d.RX > full {
			full = d.RX
		}
	}
	if full < 0.9*86_400_000 || full > 1.1*86_400_000 {
		t.Errorf("a day at 1000 B/s came out as %.0f bytes", full)
	}
}

// Reset puts Glances back to a fresh install: settings, login and record gone.
func TestGlancesResetRemovesSettingsLoginAndRecord(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	glancesWipe()
	pwSecret := "pw"
	if _, err := saveGlancesConfig(GlancesConfig{Enabled: true, Server: "http://nas:61208", User: "me", RecordEvery: 900, TrackedHistory: []string{"ct:app"}}, &pwSecret); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMilli()
	glancesRecord(now, map[string]float64{"cpu": 10, "ct:app:cpu": 3})
	do := func(token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/api/glances/config", nil)
		if token != "" {
			req.Header.Set("X-NextDash-Token", token)
		}
		rec := httptest.NewRecorder()
		h.glancesConfigHandler(rec, req)
		return rec
	}
	if rec := do(""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("reset without the token: %d", rec.Code)
	}
	if !loadGlancesConfig().Enabled || !glancesHasPassword(glancesMainID) {
		t.Fatal("a refused reset changed something")
	}
	rec := do("tok")
	if rec.Code != http.StatusOK {
		t.Fatalf("reset: %d", rec.Code)
	}
	cfg := loadGlancesConfig()
	if cfg.Enabled || cfg.Server != "" || cfg.User != "" || cfg.RecordEvery != glancesDefaultRecord || len(cfg.TrackedHistory) != 0 || cfg.Refresh != glancesDefaultRefresh {
		t.Errorf("settings after the reset: %+v", cfg)
	}
	if glancesHasPassword(glancesMainID) {
		t.Error("the password survived the reset")
	}
	if series, points, _ := glancesCollected(); series != 0 || points != 0 {
		t.Errorf("the record survived: %d series, %d points", series, points)
	}
	var answer glancesConfigAnswer
	_ = json.Unmarshal(rec.Body.Bytes(), &answer)
	if answer.Enabled || answer.HasPassword || answer.Collected.Points != 0 {
		t.Errorf("the answer: %+v", answer)
	}
}

func TestGlancesPageRefreshChoices(t *testing.T) {
	for _, seconds := range []int{1, 2, 5, 10, 30, 60, 300, 900} {
		if got := normalizeGlancesConfig(GlancesConfig{Refresh: seconds}).Refresh; got != seconds {
			t.Errorf("%d became %d", seconds, got)
		}
	}
	for _, seconds := range []int{0, 3, 120, 3600} {
		if got := normalizeGlancesConfig(GlancesConfig{Refresh: seconds}).Refresh; got != glancesDefaultRefresh {
			t.Errorf("%d should read as the default, got %d", seconds, got)
		}
	}
}

// The public demo watches Tower: reading is open and answered in-process, changing the settings or the record is not.
func TestGlancesDemoWatchesTower(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	r := mux.NewRouter()
	registerGlancesViewRoutes(r, h)
	do := func(method, path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		return rec
	}
	t.Setenv("NEXTDASH_DEMO", "1")
	if err := h.seedDemoGlances(time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, route := range [][2]string{
		{http.MethodGet, "/api/glances/config"}, {http.MethodDelete, "/api/glances/data"},
		{http.MethodPost, "/api/glances/connect"}, {http.MethodDelete, "/api/glances/config"},
	} {
		if rec := do(route[0], route[1]); rec.Code != http.StatusNotFound {
			t.Errorf("%s %s in the demo: %d", route[0], route[1], rec.Code)
		}
	}
	for _, path := range []string{"quicklook", "fs", "sensors", "containers", "processlist", "history?series=cpu,mem&since=1", "insights"} {
		if rec := do(http.MethodGet, "/api/glances/"+path); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), `"error"`) {
			t.Errorf("GET %s in the demo: %d %.120s", path, rec.Code, rec.Body.String())
		}
	}
	var status struct {
		Enabled, Configured bool
		Name                string
	}
	rec := do(http.MethodGet, "/api/glances/status")
	if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || !status.Enabled || !status.Configured || status.Name != demoGlancesName {
		t.Errorf("status in the demo: %d %+v", rec.Code, status)
	}
	// A week of history is behind it.
	hs := glancesHostByID(glancesMainID)
	if series, points, _ := hs.collected(); series < 20 || points < 1000 {
		t.Errorf("Tower has %d series and %d points", series, points)
	}
	if ongoing, past := hs.incidentList(); len(ongoing) != 0 || len(past) != 2 {
		t.Errorf("Tower's incidents: %d ongoing, %d past", len(ongoing), len(past))
	}
}

// A history file from a newer nextDash is set aside, not half read and overwritten.
func TestGlancesHistoryFileVersion(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	glancesRecord(time.Now().UnixMilli(), map[string]float64{"cpu": 10})
	saveGlancesHistory()
	raw, err := os.ReadFile(glancesHistoryPath())
	if err != nil || !strings.Contains(string(raw), `"version":1`) {
		t.Fatalf("the file does not say its version: %v %.80s", err, raw)
	}
	loadGlancesHistory()
	if finePoints("cpu") != 1 {
		t.Fatal("a file of this version did not load")
	}
	// One written by a later nextDash.
	if err := os.WriteFile(glancesHistoryPath(), []byte(`{"version":99,"series":{"cpu":{"fine":[[1,2]]}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	loadGlancesHistory()
	if finePoints("cpu") != 0 {
		t.Error("a newer file was read as this one")
	}
	if _, err := os.Stat(glancesHistoryPath() + ".v99.bak"); err != nil {
		t.Errorf("the newer file was not set aside: %v", err)
	}
	// And one from before versions were written still loads.
	if err := os.WriteFile(glancesHistoryPath(), []byte(`{"series":{"mem":{"fine":[[1000,5]]}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	loadGlancesHistory()
	if finePoints("mem") != 1 {
		t.Error("an unversioned file did not load")
	}
}

// An incident raises one event when it opens and one when it closes, however
// many beats it lasts: the hysteresis of the incident log is the notice's.
func TestGlancesIncidentEventsOpenOnceAndCloseOnce(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	glancesWipe()
	t0 := time.Now().UnixMilli()
	bad := []glancesObservation{{Kind: "cpu", Value: 95, Bad: true}}
	good := []glancesObservation{{Kind: "cpu", Value: 10}}
	var opened, closed int
	count := func(events []GlancesIncidentEvent) {
		for _, ev := range events {
			if ev.Opened {
				opened++
			} else {
				closed++
			}
		}
	}
	// One bad beat is noise; a run of them is an incident, announced once.
	count(glancesObserve(t0, bad))
	if opened != 0 {
		t.Fatalf("one beat opened an incident")
	}
	for i := int64(1); i < 10; i++ {
		count(glancesObserve(t0+i*5000, bad))
	}
	if opened != 1 || closed != 0 {
		t.Fatalf("after a long bad run: opened %d, closed %d", opened, closed)
	}
	for i := int64(10); i < 30; i++ {
		count(glancesObserve(t0+i*5000, good))
	}
	if opened != 1 || closed != 1 {
		t.Errorf("after recovery: opened %d, closed %d", opened, closed)
	}
}

// Every kind starts off; a kind that is on sends, and swap is part of memory.
func TestGlancesNoticesArePerKindAndOffByDefault(t *testing.T) {
	h := quietHandlers(t, "")
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if got := normalizeGlancesNotify([]string{"CPU", "cpu", "bogus", " disk "}); len(got) != 2 || got[0] != "cpu" || got[1] != "disk" {
		t.Errorf("normalized: %v", got)
	}
	cfg := normalizeGlancesConfig(GlancesConfig{Enabled: true, Server: "http://nas.lan:61208"})
	if len(cfg.Notify) != 0 {
		t.Fatalf("a new setup notifies: %v", cfg.Notify)
	}
	open := GlancesIncidentEvent{Opened: true, Incident: GlancesIncident{Kind: "cpu", Start: time.Now().UnixMilli(), Peak: 95}}
	h.glancesNotify(context.Background(), cfg, glancesHostByID(cfg.ID), []GlancesIncidentEvent{open})
	if got := len(readHeldFile().Held); got != 0 {
		t.Fatalf("off, yet %d notices were held", got)
	}
	cfg.Notify = []string{"cpu", "mem"}
	h.glancesNotify(context.Background(), cfg, glancesHostByID(cfg.ID), []GlancesIncidentEvent{open,
		{Opened: true, Incident: GlancesIncident{Kind: "swap", Start: open.Incident.Start}},
		{Opened: true, Incident: GlancesIncident{Kind: "disk", Subject: "/mnt/x", Start: open.Incident.Start}}})
	held := readHeldFile().Held
	if len(held) != 2 {
		t.Fatalf("%d notices held, want cpu and swap (as memory) only", len(held))
	}
	if held[0].Source != noticeSourceGlances || !strings.Contains(held[0].Notice.Title, "Glances") || !strings.Contains(held[0].Notice.Title, "Processor") {
		t.Errorf("notice: %+v", held[0])
	}
	closing := glancesNoticeFor(cfg, GlancesIncidentEvent{Incident: GlancesIncident{Kind: "cpu", Start: 1000, End: 61000}})
	if closing.Event != "up" || !strings.Contains(closing.Title, "back to normal") {
		t.Errorf("closing notice: %+v", closing)
	}
}

// Notices are saved through the same PUT as the rest: a list replaces the list
// (an empty one switches them all off), and a save that does not mention them leaves them.
func TestGlancesNotifySettingSurvivesPartialSaves(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	put := func(body string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/api/glances/config", strings.NewReader(body))
		req.Header.Set("X-NextDash-Token", "tok")
		rec := httptest.NewRecorder()
		h.glancesConfigHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("PUT %s: %d %s", body, rec.Code, rec.Body.String())
		}
	}
	put(`{"notify":["cpu","disk"]}`)
	put(`{"recordEvery":60}`)
	if got := loadGlancesConfig().Notify; len(got) != 2 {
		t.Fatalf("a save that did not mention them: %v", got)
	}
	put(`{"notify":[]}`)
	if got := loadGlancesConfig().Notify; len(got) != 0 {
		t.Errorf("an empty list: %v", got)
	}
}

// The busiest are recorded on top of the ones chosen: three of each kind, by CPU, and no stopped container.
func TestGlancesWithBusiestAddsTheTopOnes(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	procs := []glancesProc{{Name: "a", CPU: f(5)}, {Name: "a", CPU: f(30)}, {Name: "b", CPU: f(20)}, {Name: "c", CPU: f(2)}, {Name: "d", CPU: f(1)}}
	cts := []glancesContainer{
		{Name: "x", Status: "running", CPUPercent: f(1)}, {Name: "y", Status: "running", CPUPercent: f(9)},
		{Name: "z", Status: "exited", CPUPercent: f(99)}, {Name: "w", Status: "running", CPUPercent: f(4)}, {Name: "v", Status: "running", CPUPercent: f(3)},
	}
	got := glancesWithBusiest(map[string]bool{"ct:mine": true}, procs, cts, 3)
	for _, want := range []string{"ct:mine", "proc:a", "proc:b", "proc:c", "ct:y", "ct:w", "ct:v"} {
		if !got[want] {
			t.Errorf("%s is not recorded: %v", want, got)
		}
	}
	for _, not := range []string{"proc:d", "ct:x", "ct:z"} {
		if got[not] {
			t.Errorf("%s was recorded: %v", not, got)
		}
	}
	if normalizeGlancesConfig(GlancesConfig{AutoRecord: 4}).AutoRecord != 0 || normalizeGlancesConfig(GlancesConfig{AutoRecord: 5}).AutoRecord != 5 {
		t.Error("only 3 and 5 are offered")
	}
}

func TestGlancesAutoPicksStayRecordedForHours(t *testing.T) {
	hs := newGlancesHost("auto")
	f := func(v float64) *float64 { return &v }
	now := time.Now().UnixMilli()
	first := hs.withStickyBusiest(map[string]bool{"ct:mine": true}, []glancesProc{{Name: "a", CPU: f(50)}}, nil, 3, now)
	if !first["proc:a"] || !first["ct:mine"] {
		t.Fatalf("first beat: %v", first)
	}
	// Another process is busiest an hour later: the first is still recorded.
	later := hs.withStickyBusiest(map[string]bool{}, []glancesProc{{Name: "b", CPU: f(50)}}, nil, 3, now+3600*1000)
	if !later["proc:a"] || !later["proc:b"] {
		t.Errorf("an hour later: %v", later)
	}
	// Seven hours on, the first has been quiet too long.
	gone := hs.withStickyBusiest(map[string]bool{}, []glancesProc{{Name: "c", CPU: f(50)}}, nil, 3, now+7*3600*1000)
	if gone["proc:a"] || !gone["proc:c"] {
		t.Errorf("seven hours on: %v", gone)
	}
}

func TestGlancesForecastIsNotClearAtAFullDisk(t *testing.T) {
	hs := newGlancesHost("full")
	hs.forecast.sent = map[string]bool{"/mnt/disk1": true}
	now := time.Now()
	start := now.Add(-3 * 24 * time.Hour)
	steps := int(now.Sub(start) / (30 * time.Second))
	for i := 0; i <= steps; i++ {
		hs.record(start.Add(time.Duration(i)*30*time.Second).UnixMilli(), map[string]float64{"fs:/mnt/disk1": 100})
	}
	if got := hs.forecastNotices(GlancesConfig{ID: "full", Name: "NAS"}, now); len(got) != 0 {
		t.Errorf("a disk at 100%% said it was no longer filling up: %+v", got)
	}
}
