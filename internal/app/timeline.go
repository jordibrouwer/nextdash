package app

import (
	"fmt"
	"hash/fnv"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
One timeline with a cause.

Containers, updates, monitors, network checks, Glances and Unraid each keep
their own record; Config -> Timeline lays them in one stream, newest first,
and gives every outage the thing that most likely came before it: "Sonarr down
03:02, a minute after the auto-update".

Nothing here is stored. The adapters in this file turn each source's own record
into TimelineEvents, linkCauses ties outages to what preceded them, and
timeline_handler.go gathers the sources for the route. The linking is pure so
that its rules can be tested one by one: a window, a priority between kinds of
cause, and the refusal to link across machines.
*/

const (
	timelineSourceDocker  = "docker"
	timelineSourceUpdate  = "update"
	timelineSourceHealth  = "health"
	timelineSourceCheck   = "check"
	timelineSourceGlances = "glances"
	timelineSourceUnraid  = "unraid"

	// A cause may begin this long before an outage, and this long after it: a
	// monitor only notices on its next check, so its outage starts a little late.
	timelineCauseBefore = 15 * time.Minute
	timelineCauseAfter  = 60 * time.Second
	// An update's own stop and start are part of the update, not an outage.
	timelineRecreateSlack = 2 * time.Minute
	// Outages of one subject closer together than this are one flapping outage.
	timelineFlapGap = 10 * time.Minute
	// Up to this many more candidates are shown under the main cause.
	timelineAlsoMax = 2
)

type TimelineSubject struct {
	Type string `json:"type"` // container bookmark check glances unraid
	Name string `json:"name"`
	// Key is the bookmark's canonical address (bookmark and check), or the Glances host id.
	Key  string `json:"key,omitempty"`
	Host string `json:"host,omitempty"` // Docker host; empty is this machine
}

type TimelineCause struct {
	EventID    string `json:"eventId"`
	GapMs      int64  `json:"gapMs"`      // outage start minus cause start; negative when it came after
	Relation   string `json:"relation"`   // same-container linked-bookmark same-machine
	Confidence string `json:"confidence"` // sure likely
}

type TimelineEvent struct {
	ID         string          `json:"id"`
	At         int64           `json:"at"`
	End        int64           `json:"end,omitempty"`
	Ongoing    bool            `json:"ongoing,omitempty"`
	Source     string          `json:"source"`
	Kind       string          `json:"kind"`
	Outage     bool            `json:"outage,omitempty"`
	Subject    TimelineSubject `json:"subject"`
	Detail     string          `json:"detail,omitempty"`
	Count      int             `json:"count,omitempty"`
	DurationMs int64           `json:"durationMs,omitempty"`
	From       string          `json:"from,omitempty"`
	To         string          `json:"to,omitempty"`
	By         string          `json:"by,omitempty"` // updates: auto manual compose auto-rollback
	Link       string          `json:"link,omitempty"`
	Causes     []TimelineCause `json:"causes,omitempty"`
	// CauseOf names the outages this event is shown under.
	CauseOf []string `json:"causeOf,omitempty"`
}

// timelineLinks is what is known about which things belong together. Anything
// missing is a link that is never made.
type timelineLinks struct {
	// BookmarkContainer maps a bookmark's canonical address to the name of the
	// container of this machine it belongs to.
	BookmarkContainer map[string]string
	// GlancesHost is the Glances host that is this machine, "" when not known.
	GlancesHost string
	// UnraidSameMachine is set when the Unraid server is the Docker machine.
	UnraidSameMachine bool
}

func timelineEventID(e TimelineEvent) string {
	h := fnv.New64a()
	_, _ = fmt.Fprintf(h, "%s|%s|%s|%s|%s|%d", e.Source, e.Subject.Type, e.Subject.Name, e.Subject.Key, e.Kind, e.At)
	return fmt.Sprintf("%016x", h.Sum64())
}

func finishTimelineEvent(e TimelineEvent) TimelineEvent {
	e.ID = timelineEventID(e)
	if e.End > e.At {
		e.DurationMs = e.End - e.At
	}
	return e
}

func containerLink(name, host string) string {
	q := url.Values{}
	q.Set("container", name)
	if host != "" && host != dockerLocalHostID {
		q.Set("host", host)
	}
	return "#service?" + q.Encode()
}

func bookmarkLink(address string, pageID int) string {
	q := url.Values{}
	q.Set("url", address)
	if pageID > 0 {
		q.Set("page", strconv.Itoa(pageID))
	}
	return "#service?" + q.Encode()
}

/* ── Adapters: each source's record to events ──────────────────────────── */

// dockerTimelineEvents turns the container timelines (name -> entries, oldest
// first) into events. A restart loop is one event. An unhealthy period ends
// at the next healthy. The stop and start an update causes are left out, so
// the update does not look like an outage of its own.
func dockerTimelineEvents(byName map[string][]dockerTimelineEntry, updates []dockerUpdateHistoryEntry) []TimelineEvent {
	updateAt := map[string][]int64{}
	for _, u := range updates {
		updateAt[u.Container] = append(updateAt[u.Container], u.At)
	}
	nearUpdate := func(name string, at int64) bool {
		for _, u := range updateAt[name] {
			d := at - u
			if d < 0 {
				d = -d
			}
			if d <= timelineRecreateSlack.Milliseconds() {
				return true
			}
		}
		return false
	}
	var out []TimelineEvent
	names := make([]string, 0, len(byName))
	for n := range byName {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, name := range names {
		entries := foldDockerRestartLoops(byName[name])
		for i, en := range entries {
			if ((en.Kind == "stop" && en.Detail == "by nextDash") || en.Kind == "start") && nearUpdate(name, en.At) {
				continue
			}
			e := TimelineEvent{
				At: en.At, Source: timelineSourceDocker, Kind: en.Kind, Detail: en.Detail, Count: en.Count,
				Subject: TimelineSubject{Type: "container", Name: name},
				Link:    containerLink(name, ""),
			}
			switch en.Kind {
			case "crash":
				e.Outage = true
			case "restart-loop":
				// From the first crash to the last, so that a service that went down
				// at the start of the loop is matched to it, not only one that went
				// down at its end.
				e.Outage = true
				if en.First > 0 && en.First < en.At {
					e.At, e.End = en.First, en.At
				}
			case "unhealthy":
				// Over at the next healthy, or when the container was stopped,
				// crashed or started again: whatever it did next, it is not
				// the same unhealthy period any more.
				e.Outage = true
				e.Ongoing = true
				for _, next := range entries[i+1:] {
					switch next.Kind {
					case "healthy", "stop", "exit", "crash", "start", "restart-loop":
						e.End, e.Ongoing = next.At, false
					}
					if !e.Ongoing {
						break
					}
				}
			}
			out = append(out, finishTimelineEvent(e))
		}
	}
	return out
}

func updateTimelineEvents(updates []dockerUpdateHistoryEntry) []TimelineEvent {
	out := make([]TimelineEvent, 0, len(updates))
	for _, u := range updates {
		from, to := u.FromVersion, u.ToVersion
		if from == "" {
			from = shortImageID(u.FromImageID)
		}
		if to == "" {
			to = shortImageID(u.ToImageID)
		}
		out = append(out, finishTimelineEvent(TimelineEvent{
			At: u.At, Source: timelineSourceUpdate, Kind: u.Kind, From: from, To: to, By: u.By,
			Subject: TimelineSubject{Type: "container", Name: u.Container},
			Link:    containerLink(u.Container, ""),
		}))
	}
	return out
}

// timelineOutageFromIncident is one run of failed checks as one outage.
func timelineOutageFromIncident(source string, subject TimelineSubject, link string, inc HealthIncident, label string) TimelineEvent {
	detail := inc.Reason
	if label != "" {
		detail = strings.TrimSpace(label + ": " + detail)
		detail = strings.TrimSuffix(detail, ": ")
	}
	e := TimelineEvent{
		At: inc.Start, End: inc.End, Ongoing: inc.Ongoing, Source: source, Kind: "down", Outage: true,
		Subject: subject, Detail: detail, Count: 1, Link: link,
	}
	return e
}

// mergeTimelineFlaps joins outages of one subject that follow each other
// closely into one, counting them. A monitor that flaps all night is one
// story, not forty.
func mergeTimelineFlaps(in []TimelineEvent) []TimelineEvent {
	sort.SliceStable(in, func(i, j int) bool {
		a, b := in[i], in[j]
		if a.Source != b.Source || a.Subject != b.Subject {
			return a.Source+a.Subject.Type+a.Subject.Name+a.Subject.Key < b.Source+b.Subject.Type+b.Subject.Name+b.Subject.Key
		}
		return a.At < b.At
	})
	var out []TimelineEvent
	for _, e := range in {
		if n := len(out); n > 0 {
			p := &out[n-1]
			if p.Source == e.Source && p.Subject == e.Subject && !p.Ongoing && p.End > 0 && e.At-p.End < timelineFlapGap.Milliseconds() {
				p.End, p.Ongoing = e.End, e.Ongoing
				p.Count += e.Count
				continue
			}
		}
		out = append(out, e)
	}
	for i := range out {
		out[i] = finishTimelineEvent(out[i])
	}
	return out
}

// glancesTimelineEvents: every stretch over a red line is an outage of the machine.
func glancesTimelineEvents(hostID, hostName string, incidents []GlancesIncident) []TimelineEvent {
	out := make([]TimelineEvent, 0, len(incidents))
	for _, in := range incidents {
		detail := in.Subject
		if in.Peak > 0 {
			peak := fmt.Sprintf("peak %.0f", in.Peak)
			if detail != "" {
				detail += ", " + peak
			} else {
				detail = peak
			}
		}
		out = append(out, finishTimelineEvent(TimelineEvent{
			At: in.Start, End: in.End, Ongoing: in.End == 0, Source: timelineSourceGlances, Kind: in.Kind, Outage: true,
			Subject: TimelineSubject{Type: "glances", Name: hostName, Key: hostID},
			Detail:  detail, Link: "#glances",
		}))
	}
	return out
}

func unraidTimelineEvents(events []unraidEvent) []TimelineEvent {
	out := make([]TimelineEvent, 0, len(events))
	for _, u := range events {
		out = append(out, finishTimelineEvent(TimelineEvent{
			At: u.At, Source: timelineSourceUnraid, Kind: u.Event, Outage: true,
			Subject: TimelineSubject{Type: "unraid", Name: "Unraid"},
			Detail:  strings.TrimSpace(u.Title + notifyDetailSuffix(u.Detail)), Link: "#config/unraid",
		}))
	}
	return out
}

/* ── Causes ────────────────────────────────────────────────────────────── */

// causeKind ranks what can explain an outage; lower wins.
const (
	causeUpdate = iota + 1
	causeContainer
	causeGlances
	causeUnraid
)

type causeCandidate struct {
	ev       TimelineEvent
	rank     int
	relation string
	conf     string
	gap      int64
}

// containerOf is the container this subject belongs to, "" when none is known.
func (l timelineLinks) containerOf(s TimelineSubject) (name, relation string) {
	switch s.Type {
	case "container":
		if s.Host != "" && s.Host != dockerLocalHostID {
			return "", ""
		}
		return s.Name, "same-container"
	case "bookmark", "check":
		if c := l.BookmarkContainer[s.Key]; c != "" {
			return c, "linked-bookmark"
		}
	}
	return "", ""
}

func timelineInWindow(c, o TimelineEvent) bool {
	from := o.At - timelineCauseBefore.Milliseconds()
	to := o.At + timelineCauseAfter.Milliseconds()
	if c.At >= from && c.At <= to {
		return true
	}
	// A stretch that began earlier and was still going when the outage began.
	return c.At < from && (c.Ongoing || c.End >= from)
}

// timelineIsCauseKind: of the container's own events, the ones that can
// bring a service down. A stop by nextDash is part of an update.
func timelineIsCauseKind(e TimelineEvent) bool {
	switch e.Kind {
	case "crash", "restart-loop", "unhealthy":
		return true
	case "stop":
		return e.Detail != "by nextDash"
	}
	return false
}

// linkCauses gives every outage its causes and every cause the outages it
// explains. The events are modified in place and returned.
func linkCauses(events []TimelineEvent, links timelineLinks) []TimelineEvent {
	for i := range events {
		events[i].Causes, events[i].CauseOf = nil, nil
	}
	index := map[string]int{}
	for i, e := range events {
		index[e.ID] = i
	}
	for i := range events {
		o := events[i]
		if !o.Outage {
			continue
		}
		container, relation := links.containerOf(o.Subject)
		var found []causeCandidate
		add := func(c TimelineEvent, rank int, rel, conf string) {
			found = append(found, causeCandidate{ev: c, rank: rank, relation: rel, conf: conf, gap: o.At - c.At})
		}
		for _, c := range events {
			if c.ID == o.ID || !timelineInWindow(c, o) {
				continue
			}
			switch {
			case container != "" && c.Source == timelineSourceUpdate && c.Subject.Name == container &&
				(c.Subject.Host == "" || c.Subject.Host == dockerLocalHostID):
				add(c, causeUpdate, relation, "sure")
			case container != "" && c.Source == timelineSourceDocker && c.Subject.Name == container &&
				timelineIsCauseKind(c) && o.Source != timelineSourceDocker && c.Subject.Type == "container":
				add(c, causeContainer, relation, "sure")
			case c.Source == timelineSourceGlances && links.GlancesHost != "" && c.Subject.Key == links.GlancesHost &&
				o.Source != timelineSourceGlances && (container != "" || o.Source == timelineSourceUnraid && links.UnraidSameMachine):
				add(c, causeGlances, "same-machine", "likely")
			case c.Source == timelineSourceUnraid && links.UnraidSameMachine && o.Source != timelineSourceUnraid &&
				(container != "" || o.Source == timelineSourceGlances && o.Subject.Key == links.GlancesHost):
				add(c, causeUnraid, "same-machine", "likely")
			}
		}
		if len(found) == 0 {
			continue
		}
		sort.SliceStable(found, func(a, b int) bool {
			if found[a].rank != found[b].rank {
				return found[a].rank < found[b].rank
			}
			return abs64(found[a].gap) < abs64(found[b].gap)
		})
		// A chain: bookmark down <- crash <- update. The root is what is shown
		// first; the step between stays as one of the others.
		if main := found[0]; main.rank == causeContainer {
			for _, c := range events {
				if c.Source != timelineSourceUpdate || c.Subject.Name != main.ev.Subject.Name || c.ID == main.ev.ID || c.At > main.ev.At {
					continue
				}
				if timelineInWindow(c, main.ev) {
					root := causeCandidate{ev: c, rank: causeUpdate, relation: main.relation, conf: "sure", gap: o.At - c.At}
					found = append([]causeCandidate{root}, found...)
					break
				}
			}
		}
		seen := map[string]bool{}
		for _, c := range found {
			if seen[c.ev.ID] || len(events[i].Causes) > timelineAlsoMax {
				continue
			}
			seen[c.ev.ID] = true
			events[i].Causes = append(events[i].Causes, TimelineCause{
				EventID: c.ev.ID, GapMs: c.gap, Relation: c.relation, Confidence: c.conf,
			})
			j := index[c.ev.ID]
			events[j].CauseOf = append(events[j].CauseOf, o.ID)
		}
	}
	return events
}

func abs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
