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
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), InboxCount: 4, StaleDays: 90,
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

// withCheckup stands in for the checkup being there: until it is, no snapshot or
// push may point at it.
func withCheckup(t *testing.T) {
	t.Helper()
	old := digestMentionsCheckup
	digestMentionsCheckup = true
	t.Cleanup(func() { digestMentionsCheckup = old })
}

func TestDigestSaysNothingOfTheCheckupBeforeItExists(t *testing.T) {
	d := buildDigest(digestInput{Now: digestNow, Settings: allOn(), Issues: flaggedIssues(12, "duplicate")})
	if d.Checkup != nil {
		t.Fatalf("the checkup is not built yet: %+v", d.Checkup)
	}
	n := digestNotice(digestSnapshot{Health: &digestHealth{NewlyBroken: []string{"Wiki"}}, Checkup: &digestCheckup{Items: 14}})
	if strings.Contains(n.Error, ":checkup") {
		t.Fatalf("the push points at a command that does not exist: %q", n.Error)
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
	withCheckup(t)
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
	withCheckup(t)
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
	withCheckup(t)
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
