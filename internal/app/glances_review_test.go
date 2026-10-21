package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
