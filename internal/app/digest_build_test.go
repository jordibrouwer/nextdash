package app

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

var digestNow = time.Date(2026, 10, 12, 8, 0, 0, 0, time.UTC)

func allOn() Settings {
	return Settings{DigestHealth: true, DigestUpdates: true, DigestUsage: true}
}

func TestDigestEmptyWhenNothingHappened(t *testing.T) {
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn()})
	if !d.empty() {
		t.Fatalf("fresh install should give an empty digest: %+v", d)
	}
}

func TestDigestHealthSplitsNewFromOld(t *testing.T) {
	week := digestNow.Add(-3 * 24 * time.Hour).UnixMilli()
	old := digestNow.Add(-40 * 24 * time.Hour).UnixMilli()
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: []HealthIssue{
		{Name: "Wiki", URL: "https://wiki", BrokenSince: week, Flags: []string{"broken"}},
		{Name: "Old", URL: "https://old", BrokenSince: old, Flags: []string{"broken"}},
		// Broken before BrokenSince was recorded: old news.
		{Name: "Ancient", URL: "https://ancient", Flags: []string{"broken"}},
		// The wrong content is its own condition in the report, not "broken".
		{Name: "Changed", URL: "https://changed", BrokenSince: week, Flags: []string{"content"}},
	}})
	if d.Health == nil || len(d.Health.NewlyBroken) != 1 || d.Health.NewlyBroken[0] != "Wiki" || d.Health.StillBroken != 2 {
		t.Fatalf("health %+v", d.Health)
	}
}

func TestDigestUpdatesSkipHeldAndMissingDocker(t *testing.T) {
	in := digestInput{Now: digestNow, Settings: allOn()}
	if buildDigest(in).Updates != nil {
		t.Fatal("no Docker should omit the section")
	}
	in.Updates = map[string]*dockerImageUpdate{
		"plex:latest": {Status: "available"},
		"sonarr:4":    {Status: "available", Held: true},
		"radarr:5":    {Status: "current"},
	}
	d := buildDigest(in)
	if d.Updates == nil || len(d.Updates.Available) != 1 || d.Updates.Available[0] != "plex:latest" {
		t.Fatalf("updates %+v", d.Updates)
	}
}

func TestDigestUsageTopUnusedAndInbox(t *testing.T) {
	recent := digestNow.Add(-24 * time.Hour).UnixMilli()
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), InboxCount: 4,
		Bookmarks: []Bookmark{
			{Name: "A", URL: "https://a", OpenLog: []int64{recent, recent, recent}, LastOpened: recent},
			{Name: "B", URL: "https://b", OpenLog: []int64{recent}, LastOpened: recent},
			{Name: "Dust", URL: "https://dust", OpenCount: 1, LastOpened: digestNow.Add(-40 * 24 * time.Hour).UnixMilli()},
		},
		// The report's own flags decide, so "unused" means never opened, as
		// the Bookmarks view's filter of that name does.
		Issues: []HealthIssue{
			{Name: "Never", URL: "https://never", Flags: []string{"unused"}},
			{Name: "Also never", URL: "https://also", Flags: []string{"broken", "unused"}},
		},
	})
	u := d.Usage
	if u == nil || len(u.TopOpened) != 2 || u.TopOpened[0] != "A" || u.NeverOpened != 2 || u.Stale != 1 || u.StaleDays != 30 || u.Inbox != 4 {
		t.Fatalf("usage %+v", u)
	}
}

func TestDigestHonoursSectionSwitches(t *testing.T) {
	s := allOn()
	s.DigestHealth = false
	d := buildDigest(digestInput{Now: digestNow, Settings: s, CertsExpiring: []string{"a.example (3 days)"}})
	if d.Health != nil {
		t.Fatal("health switched off but present")
	}
}

func TestDigestNoticeNamesTheCounts(t *testing.T) {
	d := digestSnapshot{
		Health:  &digestHealth{NewlyBroken: []string{"Wiki"}, StillBroken: 3},
		Updates: &digestUpdates{Available: []string{"plex:latest", "radarr:5"}},
	}
	n := digestNotice(d)
	if n.Event != "digest" || n.Source != "digest" {
		t.Fatalf("notice %+v", n)
	}
	if !strings.Contains(n.Title, "Weekly digest") || !strings.Contains(n.Error, "Wiki") || !strings.Contains(n.Error, "plex:latest") {
		t.Fatalf("title %q body %q", n.Title, n.Error)
	}
}

func TestDigestKeepsTheNamesBehindTheCounts(t *testing.T) {
	old := digestNow.Add(-40 * 24 * time.Hour).UnixMilli()
	var issues []HealthIssue
	var bookmarks []Bookmark
	for i := 0; i < 12; i++ {
		issues = append(issues, HealthIssue{Name: fmt.Sprintf("Dead %02d", i), URL: "https://dead", BrokenSince: old, Flags: []string{"broken"}})
		bookmarks = append(bookmarks, Bookmark{Name: fmt.Sprintf("Dust %02d", i), URL: "https://dust", OpenCount: 1, LastOpened: old})
	}
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: issues, Bookmarks: bookmarks})
	if d.Health == nil || d.Health.StillBroken != 12 || len(d.Health.StillBrokenNames) != digestNamesMax || d.Health.StillBrokenNames[0] != "Dead 00" {
		t.Fatalf("health %+v", d.Health)
	}
	if d.Usage == nil || d.Usage.Stale != 12 || len(d.Usage.StaleNames) != digestNamesMax || d.Usage.StaleNames[0] != "Dust 00" {
		t.Fatalf("usage %+v", d.Usage)
	}
}

func TestDigestNoticeLeadsWithTheWorstAndListsLines(t *testing.T) {
	n := digestNotice(digestSnapshot{
		Health: &digestHealth{NewlyBroken: []string{"Wiki", "Plex", "Seerr"}, StillBroken: 4, CertsExpiring: []string{"a.example (6 days)"}},
		Usage:  &digestUsage{Stale: 16, StaleDays: 90, Inbox: 56},
	})
	if n.Title != "Weekly digest: 3 links broke this week" {
		t.Fatalf("title %q", n.Title)
	}
	if lines := strings.Split(n.Error, "\n"); len(lines) != 5 {
		t.Fatalf("want one line per item, got %q", n.Error)
	}
	only := digestNotice(digestSnapshot{Usage: &digestUsage{Inbox: 2}})
	if only.Title != "Weekly digest: 2 links in the Inbox" {
		t.Fatalf("title %q", only.Title)
	}
}

func TestDigestStaleIsThirtyDaysAndSkipsNeverOpened(t *testing.T) {
	day := 24 * time.Hour
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Bookmarks: []Bookmark{
		{Name: "Old", URL: "https://old", OpenCount: 2, LastOpened: digestNow.Add(-31 * day).UnixMilli()},
		{Name: "Fresh", URL: "https://fresh", OpenCount: 2, LastOpened: digestNow.Add(-29 * day).UnixMilli()},
		{Name: "Never", URL: "https://never"},
		{Name: "Parked", URL: "https://parked", PageID: unsortedPageID, OpenCount: 1, LastOpened: digestNow.Add(-90 * day).UnixMilli()},
	}})
	u := d.Usage
	if u == nil || u.Stale != 1 || len(u.StaleNames) != 1 || u.StaleNames[0] != "Old" || u.StaleDays != digestStaleDays {
		t.Fatalf("usage %+v", u)
	}
}

func flaggedIssues(n int, flags ...string) []HealthIssue {
	var out []HealthIssue
	for i := 0; i < n; i++ {
		out = append(out, HealthIssue{Name: fmt.Sprintf("B%02d", i), URL: fmt.Sprintf("https://b%d", i), PageID: 1, Index: i, Flags: flags})
	}
	return out
}

func TestDigestCheckupAppearsFromTenFindings(t *testing.T) {
	at := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: flaggedIssues(10, "duplicate")})
	if at.Checkup == nil || at.Checkup.Items != 10 {
		t.Fatalf("checkup at ten: %+v", at.Checkup)
	}
	below := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: flaggedIssues(9, "duplicate")})
	if below.Checkup != nil {
		t.Fatalf("checkup below the threshold: %+v", below.Checkup)
	}
}

func TestDigestCheckupCountsABookmarkOnce(t *testing.T) {
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: flaggedIssues(10, "duplicate", "unused", "broken")})
	if d.Checkup == nil || d.Checkup.Items != 10 {
		t.Fatalf("one bookmark with three flags must count once: %+v", d.Checkup)
	}
}

func TestDigestCheckupAloneIsNotAWeekToSend(t *testing.T) {
	d := digestSnapshot{Checkup: &digestCheckup{Items: 14}}
	if !d.empty() {
		t.Fatal("a checkup on its own must not make a digest worth sending")
	}
}

func TestDigestNoticeAddsTheCheckupLineButNeverLeadsWithIt(t *testing.T) {
	n := digestNotice(digestSnapshot{
		Health:  &digestHealth{NewlyBroken: []string{"Wiki"}},
		Checkup: &digestCheckup{Items: 14},
	})
	if !strings.Contains(n.Error, "14 things worth tidying up. Run :checkup.") {
		t.Fatalf("body %q", n.Error)
	}
	if !strings.HasPrefix(n.Title, "Weekly digest: 1 link broke") {
		t.Fatalf("title %q", n.Title)
	}
}

func TestDigestWeekCountsThisWeekAgainstLast(t *testing.T) {
	day := 24 * time.Hour
	at := func(d time.Duration) int64 { return digestNow.Add(-d).UnixMilli() }
	in := digestInput{
		Now: digestNow, Settings: allOn(),
		Bookmarks: []Bookmark{
			{Name: "A", URL: "https://a", OpenCount: 5, CreatedAt: at(2 * day), OpenLog: []int64{at(1 * day), at(2 * day), at(9 * day)}},
			{Name: "B", URL: "https://b", OpenCount: 2, CreatedAt: at(10 * day), OpenLog: []int64{at(8 * day), at(20 * day)}},
			// Older than both weeks, and on the unsorted page: neither counts as added.
			{Name: "C", URL: "https://c", PageID: unsortedPageID, CreatedAt: at(1 * day)},
			{Name: "D", URL: "https://d", CreatedAt: at(30 * day)},
		},
		InboxAddedAt: []int64{at(1 * day), at(3 * day), at(40 * day)},
	}
	w := buildDigest(in).Week
	if w == nil {
		t.Fatal("a week with opens has week figures")
	}
	if w.Opens != 2 || w.OpensPrev != 2 {
		t.Fatalf("opens %d / %d, want 2 / 2", w.Opens, w.OpensPrev)
	}
	if w.Added != 1 || w.AddedPrev != 1 {
		t.Fatalf("added %d / %d, want 1 / 1", w.Added, w.AddedPrev)
	}
	if w.InboxNew != 2 {
		t.Fatalf("inbox new %d, want 2", w.InboxNew)
	}
}

func TestDigestWeekUptimeAndOutagesFromTheHistory(t *testing.T) {
	day := 24 * time.Hour
	at := func(d time.Duration) int64 { return digestNow.Add(-d).UnixMilli() }
	in := digestInput{Now: digestNow, Settings: allOn(), Samples: map[string][]HealthSample{
		"https://a": {
			{T: at(10 * day), Up: true}, {T: at(9 * day), Up: false, Alerted: true},
			{T: at(3 * day), Up: true}, {T: at(2 * day), Up: true}, {T: at(1 * day), Up: true}, {T: at(12 * time.Hour), Up: false, Alerted: true},
			// Maintenance does not count against the uptime.
			{T: at(6 * time.Hour), Up: false, Maint: true},
		},
	}}
	w := buildDigest(in).Week
	if w == nil {
		t.Fatal("checks make week figures")
	}
	if w.Uptime != 75 || w.UptimePrev != 50 {
		t.Fatalf("uptime %.1f / %.1f, want 75 / 50", w.Uptime, w.UptimePrev)
	}
	if w.Outages != 1 || w.OutagesPrev != 1 {
		t.Fatalf("outages %d / %d, want 1 / 1", w.Outages, w.OutagesPrev)
	}
}

func TestDigestWeekHonoursTheSwitches(t *testing.T) {
	day := 24 * time.Hour
	at := func(d time.Duration) int64 { return digestNow.Add(-d).UnixMilli() }
	in := digestInput{
		Now: digestNow, Settings: Settings{DigestHealth: false, DigestUsage: false},
		Bookmarks: []Bookmark{{Name: "A", URL: "https://a", OpenCount: 1, OpenLog: []int64{at(day)}}},
		Samples:   map[string][]HealthSample{"https://a": {{T: at(day), Up: true}}},
	}
	if buildDigest(in).Week != nil {
		t.Fatal("with both parts off there are no week figures")
	}
}

func TestDigestBrokenItemsSayWhereSinceWhenAndWhy(t *testing.T) {
	since := digestNow.Add(-3 * 24 * time.Hour).UnixMilli()
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: []HealthIssue{
		{Name: "Wiki", URL: "https://wiki", PageName: "Homelab", BrokenSince: since, LastError: "connection refused", Flags: []string{"broken"}},
	}})
	if d.Health == nil || len(d.Health.BrokenItems) != 1 {
		t.Fatalf("health %+v", d.Health)
	}
	it := d.Health.BrokenItems[0]
	if it.Name != "Wiki" || it.Where != "Homelab" || it.Since != since || it.Error != "connection refused" {
		t.Fatalf("item %+v", it)
	}
}

func TestDigestUsageItemsCarryCountsAgesAndPages(t *testing.T) {
	day := 24 * time.Hour
	at := func(d time.Duration) int64 { return digestNow.Add(-d).UnixMilli() }
	d := buildDigest(digestInput{
		Now: digestNow, Settings: allOn(),
		Bookmarks: []Bookmark{
			{Name: "Top", URL: "https://top", OpenCount: 9, LastOpened: at(day), OpenLog: []int64{at(day), at(2 * day), at(3 * day)}},
			{Name: "Old", URL: "https://old", OpenCount: 1, LastOpened: at(45 * day)},
		},
		Issues:       []HealthIssue{{Name: "Never", URL: "https://never", PageName: "Reading", Flags: []string{"unused"}}},
		InboxAddedAt: []int64{at(12 * day), at(2 * day)},
	})
	u := d.Usage
	if u == nil || len(u.TopOpenedItems) != 1 || u.TopOpenedItems[0].Name != "Top" || u.TopOpenedItems[0].Count != 3 {
		t.Fatalf("top %+v", u)
	}
	if len(u.NeverOpenedItems) != 1 || u.NeverOpenedItems[0].Where != "Reading" {
		t.Fatalf("never %+v", u.NeverOpenedItems)
	}
	if len(u.StaleItems) != 1 || u.StaleItems[0].Name != "Old" || u.StaleItems[0].Days != 45 {
		t.Fatalf("stale %+v", u.StaleItems)
	}
	if u.InboxOldestDays != 12 {
		t.Fatalf("oldest inbox item %d days, want 12", u.InboxOldestDays)
	}
}
