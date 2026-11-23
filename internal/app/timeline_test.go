package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"
)

var tlBase = time.Date(2026, 11, 20, 3, 0, 0, 0, time.UTC).UnixMilli()

func tlMin(n int) int64 { return tlBase + int64(n)*time.Minute.Milliseconds() }

func tlUpdate(container string, min int) TimelineEvent {
	return finishTimelineEvent(TimelineEvent{At: tlMin(min), Source: timelineSourceUpdate, Kind: "update", By: "auto",
		Subject: TimelineSubject{Type: "container", Name: container}})
}

func tlCrash(container string, min int) TimelineEvent {
	return finishTimelineEvent(TimelineEvent{At: tlMin(min), Source: timelineSourceDocker, Kind: "crash", Outage: true,
		Subject: TimelineSubject{Type: "container", Name: container}})
}

func tlDown(key string, min int) TimelineEvent {
	return finishTimelineEvent(TimelineEvent{At: tlMin(min), End: tlMin(min + 14), Source: timelineSourceHealth, Kind: "down", Outage: true,
		Subject: TimelineSubject{Type: "bookmark", Name: "Sonarr", Key: key}})
}

var tlSonarr = timelineLinks{BookmarkContainer: map[string]string{"sonarr.lan": "sonarr"}}

func causeIDs(e TimelineEvent) []string {
	var out []string
	for _, c := range e.Causes {
		out = append(out, c.EventID)
	}
	return out
}

func TestLinkCausesUpdateOneMinuteBefore(t *testing.T) {
	up, down := tlUpdate("sonarr", 1), tlDown("sonarr.lan", 2)
	got := linkCauses([]TimelineEvent{up, down}, tlSonarr)
	if len(got[1].Causes) != 1 || got[1].Causes[0].EventID != up.ID || got[1].Causes[0].GapMs != time.Minute.Milliseconds() {
		t.Fatalf("causes %+v", got[1].Causes)
	}
	if got[1].Causes[0].Relation != "linked-bookmark" || got[1].Causes[0].Confidence != "sure" {
		t.Fatalf("relation/confidence %+v", got[1].Causes[0])
	}
	if len(got[0].CauseOf) != 1 || got[0].CauseOf[0] != down.ID {
		t.Fatalf("update not marked as explaining the outage: %+v", got[0].CauseOf)
	}
}

func TestLinkCausesUpdateTooEarlyIsNoCause(t *testing.T) {
	got := linkCauses([]TimelineEvent{tlUpdate("sonarr", -20+2), tlDown("sonarr.lan", 2)}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("a 20 minute old update was linked: %+v", got[1].Causes)
	}
}

func TestLinkCausesOtherContainerIsNoCause(t *testing.T) {
	got := linkCauses([]TimelineEvent{tlUpdate("radarr", 1), tlDown("sonarr.lan", 2)}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("another container's update was linked: %+v", got[1].Causes)
	}
}

func TestLinkCausesRemoteUpdateWithTheSameNameIsNoCause(t *testing.T) {
	up := tlUpdate("sonarr", 1)
	up.Subject.Host = "d_remote"
	got := linkCauses([]TimelineEvent{up, tlDown("sonarr.lan", 2)}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("a remote host's update was linked: %+v", got[1].Causes)
	}
}

func TestLinkCausesUnlinkedBookmarkGetsNothing(t *testing.T) {
	got := linkCauses([]TimelineEvent{tlUpdate("sonarr", 1), tlDown("other.lan", 2)}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("a bookmark with no container got a cause: %+v", got[1].Causes)
	}
}

func TestLinkCausesRootOfAChainIsTheUpdate(t *testing.T) {
	up, crash, down := tlUpdate("sonarr", 0), tlCrash("sonarr", 1), tlDown("sonarr.lan", 2)
	got := linkCauses([]TimelineEvent{up, crash, down}, tlSonarr)
	ids := causeIDs(got[2])
	if len(ids) != 2 || ids[0] != up.ID || ids[1] != crash.ID {
		t.Fatalf("want [update crash], got %v", ids)
	}
}

func TestLinkCausesAContainerOutageIsExplainedByItsUpdate(t *testing.T) {
	up, crash := tlUpdate("sonarr", 0), tlCrash("sonarr", 1)
	got := linkCauses([]TimelineEvent{up, crash}, tlSonarr)
	if len(got[1].Causes) != 1 || got[1].Causes[0].EventID != up.ID || got[1].Causes[0].Relation != "same-container" {
		t.Fatalf("%+v", got[1].Causes)
	}
}

func TestLinkCausesGlancesOnlyWhenItIsTheSameMachine(t *testing.T) {
	glances := finishTimelineEvent(TimelineEvent{At: tlMin(-3), End: tlMin(5), Source: timelineSourceGlances, Kind: "memory", Outage: true,
		Subject: TimelineSubject{Type: "glances", Name: "nas", Key: "main"}})
	down := tlDown("sonarr.lan", 2)

	same := tlSonarr
	same.GlancesHost = "main"
	got := linkCauses([]TimelineEvent{glances, down}, same)
	if len(got[1].Causes) != 1 || got[1].Causes[0].Confidence != "likely" {
		t.Fatalf("same machine: %+v", got[1].Causes)
	}

	got = linkCauses([]TimelineEvent{glances, down}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("machine not known to be the same, yet linked: %+v", got[1].Causes)
	}
}

func TestLinkCausesTheContainerBeatsTheMachine(t *testing.T) {
	glances := finishTimelineEvent(TimelineEvent{At: tlMin(1), Source: timelineSourceGlances, Kind: "cpu", Outage: true,
		Subject: TimelineSubject{Type: "glances", Name: "nas", Key: "main"}})
	crash, down := tlCrash("sonarr", 1), tlDown("sonarr.lan", 2)
	links := tlSonarr
	links.GlancesHost = "main"
	got := linkCauses([]TimelineEvent{glances, crash, down}, links)
	if ids := causeIDs(got[2]); len(ids) != 2 || ids[0] != crash.ID {
		t.Fatalf("want crash first, got %v", ids)
	}
}

func TestLinkCausesUnraidIsALikelyCauseOnTheSameMachineOnly(t *testing.T) {
	unraid := finishTimelineEvent(TimelineEvent{At: tlMin(0), Source: timelineSourceUnraid, Kind: "array-stopped", Outage: true,
		Subject: TimelineSubject{Type: "unraid", Name: "Unraid"}})
	down := tlDown("sonarr.lan", 2)
	got := linkCauses([]TimelineEvent{unraid, down}, tlSonarr)
	if len(got[1].Causes) != 0 {
		t.Fatalf("Unraid linked without being the same machine: %+v", got[1].Causes)
	}
	same := tlSonarr
	same.UnraidSameMachine = true
	got = linkCauses([]TimelineEvent{unraid, down}, same)
	if len(got[1].Causes) != 1 || got[1].Causes[0].Confidence != "likely" {
		t.Fatalf("%+v", got[1].Causes)
	}
}

func TestLinkCausesDoesNotAccumulateAcrossRuns(t *testing.T) {
	events := []TimelineEvent{tlUpdate("sonarr", 1), tlDown("sonarr.lan", 2)}
	linkCauses(events, tlSonarr)
	got := linkCauses(events, tlSonarr)
	if len(got[1].Causes) != 1 || len(got[0].CauseOf) != 1 {
		t.Fatalf("second run: causes %d, causeOf %d", len(got[1].Causes), len(got[0].CauseOf))
	}
}

func TestDockerTimelineEventsLeaveTheUpdatesOwnRecreateOut(t *testing.T) {
	updates := []dockerUpdateHistoryEntry{{At: tlMin(10), Kind: "update", Container: "sonarr", By: "auto"}}
	byName := map[string][]dockerTimelineEntry{"sonarr": {
		{At: tlMin(10) - 2000, Kind: "stop", Detail: "by nextDash"},
		{At: tlMin(10) + 3000, Kind: "start"},
		{At: tlMin(60), Kind: "crash", Detail: "exit 137"},
	}}
	got := dockerTimelineEvents(byName, updates)
	if len(got) != 1 || got[0].Kind != "crash" || !got[0].Outage {
		t.Fatalf("%+v", got)
	}
}

func TestDockerTimelineEventsFoldARestartLoopIntoOne(t *testing.T) {
	var entries []dockerTimelineEntry
	for i := 0; i < 4; i++ {
		entries = append(entries,
			dockerTimelineEntry{At: tlMin(i), Kind: "crash", Detail: "exit 1"},
			dockerTimelineEntry{At: tlMin(i) + 5000, Kind: "start"})
	}
	got := dockerTimelineEvents(map[string][]dockerTimelineEntry{"sonarr": entries}, nil)
	if len(got) != 1 || got[0].Kind != "restart-loop" || got[0].Count != 4 {
		t.Fatalf("%+v", got)
	}
}

func TestDockerTimelineUnhealthyEndsAtTheNextHealthy(t *testing.T) {
	got := dockerTimelineEvents(map[string][]dockerTimelineEntry{"sonarr": {
		{At: tlMin(0), Kind: "unhealthy"}, {At: tlMin(7), Kind: "healthy"}}}, nil)
	var bad TimelineEvent
	for _, e := range got {
		if e.Kind == "unhealthy" {
			bad = e
		}
	}
	if bad.End != tlMin(7) || bad.Ongoing || bad.DurationMs != 7*time.Minute.Milliseconds() {
		t.Fatalf("%+v", bad)
	}
}

func TestMergeTimelineFlapsMakesOneOutageWithACount(t *testing.T) {
	subject := TimelineSubject{Type: "bookmark", Name: "Wiki", Key: "wiki.lan"}
	mk := func(start, end int) TimelineEvent {
		return timelineOutageFromIncident(timelineSourceHealth, subject, "", HealthIncident{Start: tlMin(start), End: tlMin(end)}, "")
	}
	got := mergeTimelineFlaps([]TimelineEvent{mk(0, 3), mk(6, 9), mk(12, 14), mk(120, 125)})
	if len(got) != 2 || got[0].Count != 3 || got[0].At != tlMin(0) || got[0].End != tlMin(14) || got[1].Count != 1 {
		t.Fatalf("%+v", got)
	}
}

func TestOldUpdateHistoryLinesReadWithoutABy(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := writeIndentJSONFile(dockerUpdateHistoryFilePath(), map[string]any{"entries": []map[string]any{
		{"at": 1, "kind": "update", "container": "sonarr", "image": "x", "fromImageId": "a", "toImageId": "b"},
	}}); err != nil {
		t.Fatal(err)
	}
	all, err := readDockerUpdateHistory()
	if err != nil || len(all) != 1 || all[0].By != "" {
		t.Fatalf("%v %+v", err, all)
	}
}

func TestBuildTimelineFiltersAfterLinking(t *testing.T) {
	now := time.Now()
	at := func(d time.Duration) int64 { return now.Add(d).UnixMilli() }
	up := finishTimelineEvent(TimelineEvent{At: at(-2 * time.Hour), Source: timelineSourceUpdate, Kind: "update", By: "auto",
		Subject: TimelineSubject{Type: "container", Name: "sonarr"}})
	down := finishTimelineEvent(TimelineEvent{At: at(-2*time.Hour + time.Minute), End: at(-time.Hour), Source: timelineSourceHealth, Kind: "down", Outage: true,
		Subject: TimelineSubject{Type: "bookmark", Name: "Sonarr", Key: "sonarr.lan"}})
	lone := finishTimelineEvent(TimelineEvent{At: at(-5 * time.Hour), Source: timelineSourceHealth, Kind: "down", Outage: true,
		Subject: TimelineSubject{Type: "bookmark", Name: "Wiki", Key: "wiki.lan"}})
	old := finishTimelineEvent(TimelineEvent{At: at(-10 * 24 * time.Hour), Source: timelineSourceHealth, Kind: "down", Outage: true,
		Subject: TimelineSubject{Type: "bookmark", Name: "Old", Key: "old.lan"}})
	in := func() timelineInputs {
		return timelineInputs{Events: []TimelineEvent{up, down, lone, old}, Links: tlSonarr}
	}

	got := buildTimeline(in(), timelineParams{Days: 7, Limit: 10}, now)
	if len(got.Events) != 3 {
		t.Fatalf("7 days: %d events, want 3 (the 10 day old one is out)", len(got.Events))
	}
	got = buildTimeline(in(), timelineParams{Days: 7, Limit: 10, Only: "caused"}, now)
	if len(got.Events) != 1 || got.Events[0].ID != down.ID {
		t.Fatalf("caused: %+v", got.Events)
	}
	// The update's source is filtered out; it is still the cause, and comes back as related.
	got = buildTimeline(in(), timelineParams{Days: 7, Limit: 10, Sources: map[string]bool{timelineSourceHealth: true}, Only: "caused"}, now)
	if len(got.Events) != 1 || len(got.Events[0].Causes) != 1 || len(got.Related) != 1 || got.Related[0].ID != up.ID {
		t.Fatalf("events %+v related %+v", got.Events, got.Related)
	}
	got = buildTimeline(in(), timelineParams{Days: 7, Limit: 2}, now)
	if len(got.Events) != 2 || !got.Truncated || got.NextBefore != got.Events[1].At {
		t.Fatalf("limit: %+v truncated=%v next=%d", got.Events, got.Truncated, got.NextBefore)
	}
	if got.Events[0].At < got.Events[1].At {
		t.Fatal("not newest first")
	}
}

func TestTimelineRouteTellsTheStoryOfASonarrOutage(t *testing.T) {
	h, _ := serviceFixture(t)
	now := time.Now()
	// The fixture's monitor went down 4 hours ago; the container was auto-updated a minute before.
	updateAt := now.Add(-4*time.Hour - time.Minute).UnixMilli()
	if err := appendDockerUpdateHistory(dockerUpdateHistoryEntry{At: updateAt, Kind: "update", Container: "sonarr",
		Image: "lscr.io/linuxserver/sonarr:4.0", FromImageID: "sha256:aaaaaaaaaaaaaaaa", ToImageID: "sha256:bbbbbbbbbbbbbbbb",
		FromVersion: "4.0.9", ToVersion: "4.0.10", By: "auto"}); err != nil {
		t.Fatal(err)
	}
	get := func() timelineResponse {
		rec := httptest.NewRecorder()
		h.TimelineHandler(rec, httptest.NewRequest("GET", "/api/timeline?days=7", nil))
		if rec.Code != 200 || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("status %d cache %q", rec.Code, rec.Header().Get("Cache-Control"))
		}
		var out timelineResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	resp := get()
	var down, check *TimelineEvent
	for i, e := range resp.Events {
		if e.Source == timelineSourceHealth && e.Kind == "down" {
			down = &resp.Events[i]
		}
		if e.Source == timelineSourceCheck && e.Kind == "down" {
			check = &resp.Events[i]
		}
	}
	if down == nil || check == nil {
		t.Fatalf("missing outages: %+v", resp.Events)
	}
	if len(down.Causes) != 1 || down.Causes[0].Relation != "linked-bookmark" {
		t.Fatalf("the monitor outage has no cause through the container link: %+v (links ok=%v)", down.Causes, resp.Coverage["links"])
	}
	var cause *TimelineEvent
	for i, e := range resp.Events {
		if e.ID == down.Causes[0].EventID {
			cause = &resp.Events[i]
		}
	}
	if cause == nil || cause.By != "auto" || cause.From != "4.0.9" || cause.To != "4.0.10" {
		t.Fatalf("cause %+v", cause)
	}
	if len(check.Causes) != 0 {
		t.Fatalf("a check outage two hours after the update got a cause: %+v", check.Causes)
	}
	if !resp.Coverage[timelineSourceHealth].OK || resp.Coverage[timelineSourceHealth].Since == 0 {
		t.Fatalf("coverage %+v", resp.Coverage)
	}

	// A second ask while nothing wrote the history does not parse it again.
	before := healthHistoryFileReads.Load()
	get()
	if n := healthHistoryFileReads.Load() - before; n != 0 {
		t.Fatalf("the history file was read %d times for a repeat request, want 0", n)
	}
}

func TestLinkCausesAStretchThatBeganEarlierButIsStillGoingCounts(t *testing.T) {
	glances := finishTimelineEvent(TimelineEvent{At: tlMin(-40), End: tlMin(10), Source: timelineSourceGlances, Kind: "memory", Outage: true,
		Subject: TimelineSubject{Type: "glances", Name: "nas", Key: "main"}})
	links := tlSonarr
	links.GlancesHost = "main"
	got := linkCauses([]TimelineEvent{glances, tlDown("sonarr.lan", 2)}, links)
	if len(got[1].Causes) != 1 {
		t.Fatalf("a stretch that was going on when the outage began was not linked: %+v", got[1].Causes)
	}
	over := glances
	over.End = tlMin(-30)
	over = finishTimelineEvent(over)
	got = linkCauses([]TimelineEvent{over, tlDown("sonarr.lan", 2)}, links)
	if len(got[1].Causes) != 0 {
		t.Fatalf("a stretch that ended long before was linked: %+v", got[1].Causes)
	}
}

func TestARestartLoopThatBeganWithTheOutageIsItsCause(t *testing.T) {
	var entries []dockerTimelineEntry
	for i := 0; i < 5; i++ {
		entries = append(entries,
			dockerTimelineEntry{At: tlMin(i * 3), Kind: "crash", Detail: "exit 1"},
			dockerTimelineEntry{At: tlMin(i*3) + 5000, Kind: "start"})
	}
	events := dockerTimelineEvents(map[string][]dockerTimelineEntry{"sonarr": entries}, nil)
	if len(events) != 1 || events[0].Kind != "restart-loop" || events[0].At != tlMin(0) || events[0].End != tlMin(12) {
		t.Fatalf("the loop should span its first to its last crash: %+v", events)
	}
	// The monitor noticed 2 minutes in; the loop's last crash is 12 minutes in.
	got := linkCauses(append(events, tlDown("sonarr.lan", 2)), tlSonarr)
	if len(got[1].Causes) != 1 || got[1].Causes[0].EventID != events[0].ID {
		t.Fatalf("the loop was not found as the cause: %+v", got[1].Causes)
	}
}

func TestAnUnhealthyPeriodEndsWhenTheContainerDoesSomethingElse(t *testing.T) {
	for _, next := range []string{"stop", "exit", "crash", "start"} {
		got := dockerTimelineEvents(map[string][]dockerTimelineEntry{"sonarr": {
			{At: tlMin(0), Kind: "unhealthy"}, {At: tlMin(9), Kind: next}}}, nil)
		var bad TimelineEvent
		for _, e := range got {
			if e.Kind == "unhealthy" {
				bad = e
			}
		}
		if bad.Ongoing || bad.End != tlMin(9) {
			t.Errorf("after %s: ongoing=%v end=%d, want over at minute 9", next, bad.Ongoing, bad.End)
		}
	}
	got := dockerTimelineEvents(map[string][]dockerTimelineEntry{"sonarr": {{At: tlMin(0), Kind: "unhealthy"}, {At: tlMin(5), Kind: "pause"}}}, nil)
	if !got[0].Ongoing {
		t.Fatal("a pause does not end an unhealthy period")
	}
}

func TestBuildTimelinePagesWithATieBreakOnTheSameMillisecond(t *testing.T) {
	now := time.Now()
	mk := func(name string) TimelineEvent {
		return finishTimelineEvent(TimelineEvent{At: now.Add(-time.Hour).UnixMilli(), Source: timelineSourceHealth, Kind: "down", Outage: true,
			Subject: TimelineSubject{Type: "bookmark", Name: name, Key: name}})
	}
	a, b, c := mk("a.lan"), mk("b.lan"), mk("c.lan")
	in := func() timelineInputs { return timelineInputs{Events: []TimelineEvent{a, b, c}} }
	seen := map[string]bool{}
	p := timelineParams{Days: 7, Limit: 1}
	for page := 0; page < 5; page++ {
		got := buildTimeline(in(), p, now)
		for _, e := range got.Events {
			if seen[e.ID] {
				t.Fatalf("event %s came on two pages", e.Subject.Name)
			}
			seen[e.ID] = true
		}
		if !got.Truncated {
			break
		}
		p.Before, p.BeforeID = got.NextBefore, got.NextBeforeID
	}
	if len(seen) != 3 {
		t.Fatalf("paging lost events: saw %d of 3", len(seen))
	}
}

func TestTheHealthCacheNoticesAChangedFile(t *testing.T) {
	h, _ := serviceFixture(t)
	count := func() int {
		rec := httptest.NewRecorder()
		h.TimelineHandler(rec, httptest.NewRequest("GET", "/api/timeline?days=7&sources=health", nil))
		var out timelineResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return len(out.Events)
	}
	before := count()
	hist := readHealthHistoryFile()
	key := canonicalBookmarkURLKey("https://sonarr.example.com/")
	now := time.Now()
	hist.Samples[key] = append(hist.Samples[key],
		HealthSample{T: now.Add(-30 * time.Minute).UnixMilli(), Up: false, Code: 500},
		HealthSample{T: now.Add(-20 * time.Minute).UnixMilli(), Up: true, PingMs: 90, Code: 200})
	if err := writeHealthHistoryFile(hist); err != nil {
		t.Fatal(err)
	}
	if after := count(); after != before+1 {
		t.Fatalf("outages before %d, after the file changed %d: the cache was not refreshed", before, after)
	}
}

func TestTheSameAddressOnTwoPagesKeepsTheNetworkChecksOfBoth(t *testing.T) {
	h, _ := serviceFixture(t)
	if err := h.store.SavePage(Page{ID: 2, Name: "Copy"}); err != nil {
		t.Fatal(err)
	}
	second := "bbbbbbbbbbbb"
	if err := h.store.SaveBookmarksByPage(2, []Bookmark{{
		Name: "Sonarr again", URL: "https://sonarr.example.com/",
		Checks: []NetCheck{{ID: second, Type: netTypeTCP, Enabled: true, Port: 8989}},
	}}); err != nil {
		t.Fatal(err)
	}
	hist := readHealthHistoryFile()
	now := time.Now()
	hist.Samples[netHistoryKey(second)] = []HealthSample{
		{T: now.Add(-3 * time.Hour).UnixMilli(), Up: true},
		{T: now.Add(-2 * time.Hour).UnixMilli(), Up: false, Fail: "refused"},
		{T: now.Add(-time.Hour).UnixMilli(), Up: true},
	}
	if err := writeHealthHistoryFile(hist); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.TimelineHandler(rec, httptest.NewRequest("GET", "/api/timeline?days=7&sources=check", nil))
	var out timelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Events) != 2 {
		t.Fatalf("want the outages of both pages' checks, got %d: %+v", len(out.Events), out.Events)
	}
}

func TestUnraidFindingsAreRecordedAndOnlySentWithTheSwitchOn(t *testing.T) {
	h := quietHandlers(t, "")
	notice := []monitorNotification{{Event: "alert", Name: "Unraid", Title: "Disk 3 is hot", Source: noticeSourceUnraid, At: quietNight.UnixMilli()}}
	ctx := context.Background()

	h.recordAndDispatchUnraid(ctx, notice, false, quietNight)
	if got := unraidEventsSince(quietNight.Add(-time.Hour)); len(got) != 1 {
		t.Fatalf("with the switch off the finding was not recorded: %+v", got)
	}
	if held := readHeldFile().Held; len(held) != 0 {
		t.Fatalf("with the switch off something was sent on: %+v", held)
	}

	h.recordAndDispatchUnraid(ctx, notice, true, quietNight)
	if held := readHeldFile().Held; len(held) != 1 {
		t.Fatalf("with the switch on the notice should have been sent on (held in the quiet hours): %+v", held)
	}
}
