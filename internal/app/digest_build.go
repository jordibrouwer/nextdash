package app

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	digestNewWindow    = 7 * 24 * time.Hour
	digestTopOpenedMax = 3
	digestListCap      = 6
	// How many names stand behind a count in the stored snapshot, for the
	// dashboard's digest window. The count stays exact; the list is a sample.
	digestNamesMax = 10
	// "Not opened lately" in the digest is a fixed 30 days, not the reader's
	// own stale threshold: a week-old threshold turned most of a dashboard into
	// a candidate. Never-opened bookmarks have their own part and stay out.
	digestStaleDays = 30
	// The checkup is mentioned from this many findings up.
	digestCheckupMin = 10
)

// digestMentionsCheckup stays false until the checkup itself (the round and its
// :checkup command) exists in the dashboard: a digest must not send readers to
// a command that is not there. Switch it on in the change that adds it.
var digestMentionsCheckup = false

/*
digestInput is what one digest is built from.

Broken, never opened and not opened lately come from the health report's own
issues, not from the bookmarks: the report is where a condition the reader
ignored is switched off, where "the wrong content" is told apart from "broken",
where the unsorted page is left out, and where "stale" follows the reader's own
setting. Counting from the bookmarks gave numbers the Bookmarks view did not
show behind the button that opened it. The certificates are the report's too,
for the same reason (the reader's warning days).
*/
type digestInput struct {
	Now             time.Time
	Settings        Settings
	Issues          []HealthIssue
	StaleDays       int        // the report's "not opened for" threshold, in days
	Bookmarks       []Bookmark // for the open log only: what was opened this week
	InboxCount      int
	Updates         map[string]*dockerImageUpdate // nil when Docker is not in use
	CertsExpiring   []string                      // "host (5 days)" lines, already formatted
	DomainsExpiring []string                      // "domain (5 days)" lines, already formatted
	Releases        []whatsNewRelease             // nextDash's own recent releases, newest first
}
type digestSnapshot struct {
	DueKey      string         `json:"dueKey"`
	GeneratedAt int64          `json:"generatedAt"`
	Health      *digestHealth  `json:"health,omitempty"`
	Updates     *digestUpdates `json:"updates,omitempty"`
	Usage       *digestUsage   `json:"usage,omitempty"`
	News        *digestNews    `json:"news,omitempty"`
	Checkup     *digestCheckup `json:"checkup,omitempty"`
}

// digestCheckup is how many bookmarks the checkup would walk through. It is
// never a reason to send a digest on its own, see empty().
type digestCheckup struct {
	Items int `json:"items"`
}
type digestHealth struct {
	NewlyBroken      []string `json:"newlyBroken,omitempty"`
	StillBroken      int      `json:"stillBroken,omitempty"`
	StillBrokenNames []string `json:"stillBrokenNames,omitempty"`
	CertsExpiring    []string `json:"certsExpiring,omitempty"`
	DomainsExpiring  []string `json:"domainsExpiring,omitempty"`
}
type digestUpdates struct {
	Available []string `json:"available"`
}

// digestUsage: NeverOpened is the report's "unused", Stale its "stale".
type digestUsage struct {
	TopOpened        []string `json:"topOpened,omitempty"`
	NeverOpened      int      `json:"neverOpened,omitempty"`
	NeverOpenedNames []string `json:"neverOpenedNames,omitempty"`
	Stale            int      `json:"stale,omitempty"`
	StaleNames       []string `json:"staleNames,omitempty"`
	StaleDays        int      `json:"staleDays,omitempty"`
	Inbox            int      `json:"inbox,omitempty"`
}

func digestName(bm Bookmark) string {
	if n := strings.TrimSpace(bm.Name); n != "" {
		return n
	}
	return bm.URL
}

func digestIssueName(issue HealthIssue) string {
	if n := strings.TrimSpace(issue.Name); n != "" {
		return n
	}
	return issue.URL
}

func issueHasFlag(issue HealthIssue, flag string) bool {
	for _, f := range issue.Flags {
		if f == flag {
			return true
		}
	}
	return false
}

func buildDigest(in digestInput) digestSnapshot {
	now := in.Now.UnixMilli()
	snap := digestSnapshot{GeneratedAt: now}

	if in.Settings.DigestHealth {
		h := &digestHealth{CertsExpiring: in.CertsExpiring, DomainsExpiring: in.DomainsExpiring}
		since := in.Now.Add(-digestNewWindow).UnixMilli()
		for _, issue := range in.Issues {
			if !issueHasFlag(issue, "broken") {
				continue
			}
			// A link broken since before BrokenSince was recorded has none,
			// and is old news by definition.
			if issue.BrokenSince >= since {
				h.NewlyBroken = append(h.NewlyBroken, digestIssueName(issue))
			} else {
				h.StillBroken++
				h.StillBrokenNames = append(h.StillBrokenNames, digestIssueName(issue))
			}
		}
		sort.Strings(h.NewlyBroken)
		h.StillBrokenNames = digestSample(h.StillBrokenNames)
		if len(h.NewlyBroken) > 0 || h.StillBroken > 0 || len(h.CertsExpiring) > 0 || len(h.DomainsExpiring) > 0 {
			snap.Health = h
		}
	}

	if in.Settings.DigestUpdates && in.Updates != nil {
		var names []string
		for image, u := range in.Updates {
			if u != nil && u.Status == "available" && !u.Held {
				names = append(names, image)
			}
		}
		sort.Strings(names)
		if len(names) > 0 {
			snap.Updates = &digestUpdates{Available: names}
		}
	}

	if in.Settings.DigestUsage {
		u := &digestUsage{Inbox: in.InboxCount}
		weekAgo := in.Now.Add(-digestNewWindow).UnixMilli()
		for _, issue := range in.Issues {
			switch {
			case issueHasFlag(issue, "unused"):
				u.NeverOpened++
				u.NeverOpenedNames = append(u.NeverOpenedNames, digestIssueName(issue))
			}
		}
		staleBefore := in.Now.Add(-digestStaleDays * 24 * time.Hour).UnixMilli()
		for _, bm := range in.Bookmarks {
			// Opened once, but not for 30 days. Never-opened bookmarks are the
			// other part, and the unsorted page is not part of the dashboard.
			if bm.PageID == unsortedPageID || bm.OpenCount == 0 || bm.LastOpened == 0 {
				continue
			}
			if bm.LastOpened < staleBefore {
				u.Stale++
				u.StaleNames = append(u.StaleNames, digestName(bm))
			}
		}
		if u.Stale > 0 {
			u.StaleDays = digestStaleDays
		}
		type opened struct {
			name string
			n    int
		}
		var top []opened
		for _, bm := range in.Bookmarks {
			n := 0
			for _, ts := range bm.OpenLog {
				if ts >= weekAgo && ts <= now {
					n++
				}
			}
			if n > 0 {
				top = append(top, opened{digestName(bm), n})
			}
		}
		sort.Slice(top, func(i, j int) bool {
			if top[i].n != top[j].n {
				return top[i].n > top[j].n
			}
			return top[i].name < top[j].name
		})
		for i := 0; i < len(top) && i < digestTopOpenedMax; i++ {
			u.TopOpened = append(u.TopOpened, top[i].name)
		}
		u.NeverOpenedNames = digestSample(u.NeverOpenedNames)
		u.StaleNames = digestSample(u.StaleNames)
		if len(u.TopOpened) > 0 || u.NeverOpened > 0 || u.Stale > 0 || u.Inbox > 0 {
			snap.Usage = u
		}
	}

	if in.Settings.DigestNews {
		snap.News = buildDigestNews(in.Releases, in.Now)
	}

	// One bookmark with several findings is one thing to tidy up.
	tidy := map[string]bool{}
	for _, issue := range in.Issues {
		for _, flag := range []string{"broken", "duplicate", "unused", "stale"} {
			if issueHasFlag(issue, flag) {
				tidy[fmt.Sprintf("%d:%d", issue.PageID, issue.Index)] = true
				break
			}
		}
	}
	if digestMentionsCheckup && len(tidy) >= digestCheckupMin {
		snap.Checkup = &digestCheckup{Items: len(tidy)}
	}
	return snap
}

func (d digestSnapshot) empty() bool {
	return d.Health == nil && d.Updates == nil && d.Usage == nil && d.News == nil
}

// digestSample is the first digestNamesMax names, in order.
func digestSample(names []string) []string {
	sort.Strings(names)
	if len(names) > digestNamesMax {
		names = names[:digestNamesMax]
	}
	return names
}

// digestCount is "1 link" or "3 links".
func digestCount(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

/*
digestNotice is the one message both sinks carry.

The title names the most pressing thing and nothing else: a phone shows the
title first and often only the title, and "3 newly broken, 2 certificates
expiring, 16 unused" read as a row of numbers without a subject. The body has
one line per item, so a notification that expands reads as a short list.
*/
func digestNotice(d digestSnapshot) monitorNotification {
	var lead string
	var lines []string
	first := func(s string) {
		if lead == "" {
			lead = s
		}
	}
	if h := d.Health; h != nil {
		if n := len(h.NewlyBroken); n > 0 {
			first(digestCount(n, "link broke this week", "links broke this week"))
			lines = append(lines, "Broke this week: "+joinCapped(h.NewlyBroken, digestListCap)+".")
		}
		if n := len(h.CertsExpiring); n > 0 {
			first(digestCount(n, "certificate runs out soon", "certificates run out soon"))
		}
		if n := len(h.DomainsExpiring); n > 0 {
			first(digestCount(n, "domain runs out soon", "domains run out soon"))
		}
	}
	if u := d.Updates; u != nil {
		first(digestCount(len(u.Available), "container update", "container updates"))
	}
	if h := d.Health; h != nil {
		if h.StillBroken > 0 {
			first(digestCount(h.StillBroken, "link still broken", "links still broken"))
			lines = append(lines, digestCount(h.StillBroken, "link was", "links were")+" already broken.")
		}
		if len(h.CertsExpiring) > 0 {
			lines = append(lines, "Certificates running out: "+joinCapped(h.CertsExpiring, digestListCap)+".")
		}
		if len(h.DomainsExpiring) > 0 {
			lines = append(lines, "Domains running out: "+joinCapped(h.DomainsExpiring, digestListCap)+".")
		}
	}
	if u := d.Updates; u != nil {
		lines = append(lines, "Updates: "+joinCapped(u.Available, digestListCap)+".")
	}
	if u := d.Usage; u != nil {
		if len(u.TopOpened) > 0 {
			lines = append(lines, "Most opened: "+strings.Join(u.TopOpened, ", ")+".")
		}
		if u.NeverOpened > 0 {
			first(digestCount(u.NeverOpened, "bookmark never opened", "bookmarks never opened"))
			lines = append(lines, digestCount(u.NeverOpened, "bookmark", "bookmarks")+" never opened.")
		}
		if u.Stale > 0 {
			days := fmt.Sprintf(" not opened in %d days", u.StaleDays)
			first(digestCount(u.Stale, "bookmark"+days, "bookmarks"+days))
			lines = append(lines, digestCount(u.Stale, "bookmark", "bookmarks")+days+".")
		}
		if u.Inbox > 0 {
			first(digestCount(u.Inbox, "link in the Inbox", "links in the Inbox"))
			lines = append(lines, digestCount(u.Inbox, "link", "links")+" waiting in the Inbox.")
		}
	}
	// Last in both: news about nextDash itself never outranks what needs the
	// reader, and leads only a week where nothing else happened.
	if n := d.News; n != nil {
		first("nextDash " + strings.Join(n.Releases, ", ") + " is out")
		line := "New in nextDash " + strings.Join(n.Releases, ", ")
		if len(n.Highlights) > 0 {
			line += ": " + joinCapped(n.Highlights, digestListCap)
		}
		lines = append(lines, line+".")
	}
	if c := d.Checkup; c != nil && digestMentionsCheckup {
		lines = append(lines, fmt.Sprintf("%d things worth tidying up. Run :checkup.", c.Items))
	}
	title := "Weekly digest"
	if lead != "" {
		title += ": " + lead
	}
	return monitorNotification{
		Event: "digest", Name: "Weekly digest", Status: "warning",
		Title: title, Error: strings.Join(lines, "\n"),
		At: d.GeneratedAt, Source: "digest",
	}
}
