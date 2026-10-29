package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func hostsSetup(t *testing.T) *Handlers {
	t.Helper()
	h := newTestHandlers(t)
	allowLocalForTest(t, h, true)
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	glancesViewForgetAll()
	for _, id := range []string{"nas", "pi", "b", "box", "box-2", "box-3", "box-4"} {
		glancesForgetHost(id)
	}
	// The aliases in glances_legacy_test.go point at the main host's state; a
	// forgotten one is made again on first use, so tests start from its own.
	mainHost().wipe()
	return h
}

func hostsDo(h *Handlers, method, target, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("X-NextDash-Token", "tok")
	rec := httptest.NewRecorder()
	h.glancesConfigHandler(rec, req)
	return rec
}

// A file from before there could be more than one host is one host, "main",
// with the same files, and is written in the new shape at the next save.
func TestGlancesOldConfigIsTheMainHost(t *testing.T) {
	h := hostsSetup(t)
	_ = h
	legacy := `{"enabled":true,"server":"http://nas.lan:61208","user":"me","refresh":5,"recordEvery":60,"retentionDays":90,"trackedHistory":["ct:plex"],"notify":["cpu"],"thresholds":{"cpuWarn":70,"cpuBad":85}}`
	if err := os.WriteFile(glancesConfigPath(), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	cfgs := glancesHostConfigs()
	if len(cfgs) != 1 || cfgs[0].ID != glancesMainID {
		t.Fatalf("hosts: %+v", cfgs)
	}
	c := cfgs[0]
	if c.Server != "http://nas.lan:61208" || c.User != "me" || c.RecordEvery != 60 || c.RetentionDays != 90 || c.Refresh != 5 ||
		len(c.TrackedHistory) != 1 || len(c.Notify) != 1 || c.Thresholds.CPUWarn != 70 || !c.Enabled {
		t.Errorf("migrated settings: %+v", c)
	}
	if mainHost().historyPath() != filepath.Join(ResolveDataDir(), "glances-history.json") {
		t.Errorf("the main host's history is at %s", mainHost().historyPath())
	}
	if _, err := saveGlancesConfig(c, nil); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(glancesConfigPath())
	var written struct {
		Server string              `json:"server"`
		Hosts  []glancesHostRecord `json:"hosts"`
	}
	_ = json.Unmarshal(data, &written)
	if written.Server != "" || len(written.Hosts) != 1 || written.Hosts[0].Server != "http://nas.lan:61208" {
		t.Errorf("written: %s", data)
	}
}

// Hosts have settings of their own; the page's settings are shared.
func TestGlancesHostsKeepTheirOwnSettings(t *testing.T) {
	h := hostsSetup(t)
	if rec := hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208","recordEvery":10}`); rec.Code != 200 {
		t.Fatalf("main: %d %s", rec.Code, rec.Body)
	}
	rec := hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"Pi","server":"http://pi.lan:61208","recordEvery":300,"refresh":10}`)
	if rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	var added glancesConfigAnswer
	_ = json.Unmarshal(rec.Body.Bytes(), &added)
	if added.ID != "pi" || added.Name != "Pi" || len(added.Hosts) != 2 {
		t.Fatalf("added: %+v", added)
	}
	main, _ := loadGlancesConfigFor(glancesMainID)
	pi, ok := loadGlancesConfigFor("pi")
	if !ok || main.Server != "http://a.lan:61208" || pi.Server != "http://pi.lan:61208" || main.RecordEvery != 10 || pi.RecordEvery != 300 {
		t.Errorf("main %+v, pi %+v", main, pi)
	}
	// Refresh is the page's: set through one host it is the same for both.
	if main.Refresh != 10 || pi.Refresh != 10 || !pi.Enabled {
		t.Errorf("shared settings: main refresh %d, pi refresh %d enabled %v", main.Refresh, pi.Refresh, pi.Enabled)
	}
	// A host's pause is its own.
	hostsDo(h, http.MethodPut, "/api/glances/config?host=pi", `{"paused":true}`)
	main, _ = loadGlancesConfigFor(glancesMainID)
	pi, _ = loadGlancesConfigFor("pi")
	if main.Paused || !pi.Paused {
		t.Errorf("paused: main %v, pi %v", main.Paused, pi.Paused)
	}
	// The password is one per host.
	pw := "secret"
	other := "other"
	hostsDo(h, http.MethodPut, "/api/glances/config?host=pi", `{"user":"u","password":"`+pw+`"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"user":"v","password":"`+other+`"}`)
	pi, _ = loadGlancesConfigFor("pi")
	main, _ = loadGlancesConfigFor(glancesMainID)
	if glancesCredential(pi).BasicPassword != pw || glancesCredential(main).BasicPassword != other {
		t.Errorf("passwords: pi %q, main %q", glancesCredential(pi).BasicPassword, glancesCredential(main).BasicPassword)
	}
	body := hostsDo(h, http.MethodGet, "/api/glances/config?host=pi", "").Body.String()
	if strings.Contains(body, pw) || strings.Contains(body, other) {
		t.Errorf("a password in the answer: %s", body)
	}
}

func TestGlancesAtMostFiveHosts(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208"}`)
	for i := 0; i < 4; i++ {
		if rec := hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"Box","server":"http://b.lan:61208"}`); rec.Code != 200 {
			t.Fatalf("host %d: %d %s", i+2, rec.Code, rec.Body)
		}
	}
	if rec := hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"Sixth","server":"http://c.lan:61208"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a sixth host: %d", rec.Code)
	}
	ids := map[string]bool{}
	for _, c := range glancesHostConfigs() {
		ids[c.ID] = true
	}
	if len(ids) != 5 {
		t.Errorf("ids are not unique: %v", ids)
	}
}

// Each host's record, incidents and files are its own, and removing a host takes them along.
func TestGlancesHostsRecordApartAndRemoval(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"http://nas.lan:61208"}`)
	nas := glancesHostByID("nas")
	now := time.Now().UnixMilli()
	mainHost().record(now, map[string]float64{"cpu": 10})
	nas.record(now, map[string]float64{"cpu": 90, "temp:x": 40})
	if names := mainHost().seriesNames(); len(names) != 1 {
		t.Errorf("main sees %v", names)
	}
	if names := nas.seriesNames(); len(names) != 2 {
		t.Errorf("nas sees %v", names)
	}
	nas.saveHistory()
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "glances-history-nas.json")); err != nil {
		t.Errorf("no file for nas: %v", err)
	}
	// The history route answers for the host asked.
	req := httptest.NewRequest(http.MethodGet, "/api/glances/history?host=nas", nil)
	rec := httptest.NewRecorder()
	h.glancesHistoryHandler(rec, req)
	if !strings.Contains(rec.Body.String(), "temp:x") {
		t.Errorf("history for nas: %s", rec.Body)
	}
	rec = httptest.NewRecorder()
	h.glancesHistoryHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/history", nil))
	if strings.Contains(rec.Body.String(), "temp:x") {
		t.Errorf("history for the first host shows nas's series: %s", rec.Body)
	}

	if rec := hostsDo(h, http.MethodDelete, "/api/glances/config?host=nas&remove=1", ""); rec.Code != 200 {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "glances-history-nas.json")); !os.IsNotExist(err) {
		t.Errorf("nas's file stayed: %v", err)
	}
	if _, ok := loadGlancesConfigFor("nas"); ok {
		t.Error("nas is still a host")
	}
	// The only host stays: removing it is a reset.
	if rec := hostsDo(h, http.MethodDelete, "/api/glances/config?host=main&remove=1", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("removing the only host: %d", rec.Code)
	}
}

// Only one host is the Docker host: Yes on one releases the others.
func TestGlancesOnlyOneHostIsTheDockerHost(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208","dockerLink":"yes"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"B","server":"http://b.lan:61208","dockerLink":"yes"}`)
	main, _ := loadGlancesConfigFor(glancesMainID)
	b, _ := loadGlancesConfigFor("b")
	if main.DockerLink != glancesLinkNo || b.DockerLink != glancesLinkYes {
		t.Errorf("main %q, b %q", main.DockerLink, b.DockerLink)
	}
}

// The public status lists every host by name, never an address.
func TestGlancesStatusListsHostsWithoutAddresses(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://secret-a.lan:61208","name":"Main"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"http://secret-b.lan:61208"}`)
	rec := httptest.NewRecorder()
	h.glancesStatusHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/status?host=nas", nil))
	body := rec.Body.String()
	if strings.Contains(body, "secret") {
		t.Errorf("an address in the status: %s", body)
	}
	var got struct {
		ID    string               `json:"id"`
		Hosts []glancesHostSummary `json:"hosts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got.ID != "nas" || len(got.Hosts) != 2 || got.Hosts[0].Name != "Main" || got.Hosts[1].Name != "NAS" {
		t.Errorf("status: %s", body)
	}
}

// One sampler per host: both are read, each into its own record.
func TestGlancesEveryHostIsSampled(t *testing.T) {
	h, _, _ := glancesViewSetup(t)
	second := newGlancesViewFake(t)
	for _, id := range []string{"nas"} {
		glancesForgetHost(id)
	}
	if rec := hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"`+second.URL+`"}`); rec.Code != 200 {
		t.Fatalf("add: %d %s", rec.Code, rec.Body)
	}
	previous := glancesSampleEvery
	glancesSampleEvery = 20 * time.Millisecond
	t.Cleanup(func() { glancesSampleEvery = previous })
	stop := make(chan struct{})
	done := h.StartGlancesSampler(stop)
	defer func() { close(stop); <-done }()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if len(glancesHostByID("nas").seriesNames()) > 0 && len(mainHost().seriesNames()) > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if len(glancesHostByID("nas").seriesNames()) == 0 || len(mainHost().seriesNames()) == 0 {
		t.Fatalf("main %v, nas %v", mainHost().seriesNames(), glancesHostByID("nas").seriesNames())
	}
	if second.hitsFor("quicklook") == 0 {
		t.Error("the second host was never read")
	}
}

// A host named in a write that is not there (removed in another tab) is a 404:
// its form is not saved onto the first host, and nothing is wiped.
func TestGlancesWriteToAnUnknownHostIsRefused(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208","user":"keep"}`)
	if rec := hostsDo(h, http.MethodPut, "/api/glances/config?host=gone", `{"server":"http://evil.lan:61208","user":"x","password":"y"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("PUT to a host that is not there: %d", rec.Code)
	}
	if rec := hostsDo(h, http.MethodGet, "/api/glances/config?host=gone", ""); rec.Code != http.StatusNotFound {
		t.Errorf("GET: %d", rec.Code)
	}
	main, _ := loadGlancesConfigFor(glancesMainID)
	if main.Server != "http://a.lan:61208" || main.User != "keep" || glancesHasPassword(glancesMainID) {
		t.Errorf("the first host was written: %+v", main)
	}
	mainHost().record(time.Now().UnixMilli(), map[string]float64{"cpu": 5})
	req := httptest.NewRequest(http.MethodDelete, "/api/glances/data?host=gone", nil)
	req.Header.Set("X-NextDash-Token", "tok")
	rec := httptest.NewRecorder()
	h.glancesWipeHandler(rec, req)
	if rec.Code != http.StatusNotFound || len(mainHost().seriesNames()) != 1 {
		t.Errorf("wipe of a host that is not there: %d, first host has %v", rec.Code, mainHost().seriesNames())
	}
	// A refused request adds nothing.
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"X","trackedHistory":["a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p"]}`)
	if len(glancesHostConfigs()) != 1 {
		t.Errorf("a refused add left %d hosts", len(glancesHostConfigs()))
	}
}

// What a removed host's beat was doing when it went is not written back.
func TestGlancesRemovedHostWritesNothingBack(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"http://nas.lan:61208"}`)
	nas := glancesHostByID("nas")
	nas.record(time.Now().UnixMilli(), map[string]float64{"cpu": 1})
	if rec := hostsDo(h, http.MethodDelete, "/api/glances/config?host=nas&remove=1", ""); rec.Code != 200 {
		t.Fatalf("remove: %d", rec.Code)
	}
	// The beat that was on its way finishes after the removal.
	nas.saveHistory()
	t0 := time.Now().UnixMilli()
	bad := []glancesObservation{{Kind: "cpu", Value: 95, Bad: true}}
	for i := int64(0); i < 4; i++ {
		nas.observe(t0+i*2000, bad)
	}
	for _, name := range []string{"glances-history-nas.json", "glances-incidents-nas.json"} {
		if _, err := os.Stat(filepath.Join(ResolveDataDir(), name)); !os.IsNotExist(err) {
			t.Errorf("%s came back: %v", name, err)
		}
	}
}

// A reading that hovers at its red line is announced once, not once per swing,
// and a reading that stopped arriving replaces the alert that was sent.
func TestGlancesNoticesDoNotFlapAndLostReadingsReplaceTheAlert(t *testing.T) {
	var m glancesNoticeMemory
	now := time.Now()
	open := GlancesIncidentEvent{Opened: true, Incident: GlancesIncident{Kind: "cpu", Start: 1}}
	closeIt := GlancesIncidentEvent{Incident: GlancesIncident{Kind: "cpu", Start: 1, End: 2}}
	if !m.allow(open, now) || !m.allow(closeIt, now.Add(time.Minute)) {
		t.Fatal("the first pair is announced")
	}
	if m.allow(open, now.Add(2*time.Minute)) || m.allow(closeIt, now.Add(3*time.Minute)) {
		t.Error("a second pair within the cooldown is announced")
	}
	if !m.allow(open, now.Add(glancesNoticeCooldown+time.Minute)) || !m.allow(closeIt, now.Add(glancesNoticeCooldown+2*time.Minute)) {
		t.Error("after the cooldown it is announced again")
	}

	hs := newGlancesHost("lost")
	t0 := time.Now().UnixMilli()
	for i := int64(0); i < 4; i++ {
		hs.observe(t0+i*2000, []glancesObservation{{Kind: "cpu", Value: 95, Bad: true}})
	}
	events := hs.observe(t0+10*60*1000, nil)
	if len(events) != 1 || !events[0].Lost || events[0].Opened {
		t.Fatalf("events after the reading was lost: %+v", events)
	}
	n := glancesNoticeFor(GlancesConfig{ID: "lost", Name: "Pi"}, events[0])
	if n.Event != "up" || !strings.Contains(n.Title, "no longer being read") || n.Host != "lost" {
		t.Errorf("notice: %+v", n)
	}
	if glancesPushURL(n) != "/#glances/insights?host=lost" {
		t.Errorf("push url %s", glancesPushURL(n))
	}
}

// The page exists when any host has an address; the host asked for says whether it has one itself.
func TestGlancesStatusConfiguredIsForAnyHost(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"Empty"}`)
	rec := httptest.NewRecorder()
	h.glancesStatusHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/status?host=empty", nil))
	var got struct {
		Configured     bool `json:"configured"`
		HostConfigured bool `json:"hostConfigured"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if !got.Configured || got.HostConfigured {
		t.Errorf("status of the host without an address: %s", rec.Body)
	}
}

// The hosts overview is made of what was recorded: the last readings of each
// host, the fullest disk and the hottest sensor, with no request to a host.
func TestGlancesHostsOverviewFromTheRecord(t *testing.T) {
	h := hostsSetup(t)
	hostsDo(h, http.MethodPut, "/api/glances/config", `{"enabled":true,"server":"http://a.lan:61208","name":"Home"}`)
	hostsDo(h, http.MethodPut, "/api/glances/config?host=new", `{"name":"NAS","server":"http://nas.lan:61208"}`)
	now := time.Now().UnixMilli()
	mainHost().record(now, map[string]float64{"cpu": 20, "mem": 40, "fs:/a": 50, "fs:/b": 91, "temp:x": 50, "temp:y": 61})
	rec := httptest.NewRecorder()
	h.glancesHostsHandler(rec, httptest.NewRequest(http.MethodGet, "/api/glances/hosts", nil))
	var got struct {
		Hosts []glancesHostRow `json:"hosts"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Hosts) != 2 || got.Hosts[0].Name != "Home" || got.Hosts[1].Name != "NAS" {
		t.Fatalf("rows: %s", rec.Body)
	}
	home := got.Hosts[0]
	if home.CPU == nil || *home.CPU != 20 || home.Disk == nil || *home.Disk != 91 || home.DiskMount != "/b" || home.Temp == nil || *home.Temp != 61 {
		t.Errorf("home: %+v", home)
	}
	if got.Hosts[1].CPU != nil || got.Hosts[1].Disk != nil {
		t.Errorf("a host with no record has readings: %+v", got.Hosts[1])
	}
	if strings.Contains(rec.Body.String(), "a.lan") {
		t.Errorf("an address in the overview: %s", rec.Body)
	}
}

// A disk filling up within a week is announced once, and again as clear when it stops.
func TestGlancesForecastNoticesAreOnceAndHourly(t *testing.T) {
	hs := newGlancesHost("fc")
	cfg := GlancesConfig{ID: "fc", Name: "NAS", Notify: []string{"full"}}
	now := time.Now()
	start := now.Add(-3 * 24 * time.Hour)
	// 70% three days ago to 88% now: six points a day, so full in about two days.
	steps := int(now.Sub(start) / (30 * time.Second))
	for i := 0; i <= steps; i++ {
		at := start.Add(time.Duration(i) * 30 * time.Second)
		hs.record(at.UnixMilli(), map[string]float64{"fs:/mnt/disk1": 70 + 18*float64(i)/float64(steps)})
	}
	got := hs.forecastNotices(cfg, now)
	if len(got) != 1 || got[0].Event != "down" || !strings.Contains(got[0].Title, "/mnt/disk1 will be full in about") || got[0].Host != "fc" {
		t.Fatalf("first look: %+v", got)
	}
	if again := hs.forecastNotices(cfg, now.Add(10*time.Minute)); again != nil {
		t.Errorf("a second look within the hour: %+v", again)
	}
	if later := hs.forecastNotices(cfg, now.Add(2*time.Hour)); len(later) != 0 {
		t.Errorf("announced again while it still fills: %+v", later)
	}
	if !cfg.notifies("full") || (GlancesConfig{}).notifies("full") {
		t.Error("the kind is off unless chosen")
	}
	// A disk that no longer fills is announced as clear.
	flat := newGlancesHost("flat")
	flat.forecast.sent = map[string]bool{"/mnt/disk1": true}
	for i := 0; i <= steps; i++ {
		at := start.Add(time.Duration(i) * 30 * time.Second)
		flat.record(at.UnixMilli(), map[string]float64{"fs:/mnt/disk1": 50})
	}
	if clear := flat.forecastNotices(GlancesConfig{ID: "flat", Name: "NAS"}, now); len(clear) != 1 || clear[0].Event != "up" {
		t.Errorf("clear: %+v", clear)
	}
}

// The hosts table's small graph is the last hour of the processor's coarse
// points, and a copy: the sampler appending afterwards does not reach it.
func TestGlancesHostCPUHourIsTheLastHourCopied(t *testing.T) {
	hs := newGlancesHost("spark")
	now := time.Now()
	at := func(ago time.Duration) float64 { return float64(now.Add(-ago).UnixMilli()) }
	hs.rings.series["cpu"] = &glancesRing{Coarse: []glancesPoint{
		{at(2 * time.Hour), 90}, {at(50 * time.Minute), 10}, {at(20 * time.Minute), 30}, {at(time.Minute), 50},
	}}
	got := hs.cpuHour(now)
	if len(got) != 3 || got[0][1] != 10 || got[2][1] != 50 {
		t.Fatalf("cpuHour = %v, want the three points of the last hour", got)
	}
	hs.rings.series["cpu"].Coarse[1][1] = 99
	if got[0][1] != 10 {
		t.Errorf("cpuHour shares the ring's array")
	}
	hs.rings.series["cpu"].Coarse = hs.rings.series["cpu"].Coarse[:2]
	if hs.cpuHour(now) != nil {
		t.Errorf("one point is not a graph")
	}
}
