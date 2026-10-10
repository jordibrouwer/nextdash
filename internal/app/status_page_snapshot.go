package app

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"
)

// statusSnapshot is everything a visitor's page gets. It carries public names,
// states, times and numbers only: no bookmark ids, container or image names,
// and no URL unless the owner ticked ShowLink.
type statusSnapshot struct {
	GeneratedAt int64             `json:"generatedAt"`
	Title       string            `json:"title"`
	Notice      string            `json:"notice,omitempty"`
	Problems    int               `json:"problems"` // services down or degraded
	AnyDown     bool              `json:"anyDown"`
	Maintenance []statusUpcoming  `json:"maintenance,omitempty"`
	Groups      []statusGroupView `json:"groups"`
}

type statusUpcoming struct {
	Start  int64    `json:"start"`
	End    int64    `json:"end"`
	Active bool     `json:"active"`
	Label  string   `json:"label,omitempty"`
	Groups []string `json:"groups"` // public group names
}

type statusGroupView struct {
	Name     string              `json:"name"`
	Working  int                 `json:"working"`
	Total    int                 `json:"total"`
	Services []statusServiceView `json:"services"`
}

type statusServiceView struct {
	Name      string          `json:"name"`
	URL       string          `json:"url,omitempty"` // only with ShowLink
	State     statusState     `json:"state"`
	Since     int64           `json:"since,omitempty"`
	LastCheck int64           `json:"lastCheck,omitempty"`
	Reason    string          `json:"reason,omitempty"`
	Ms        int             `json:"ms,omitempty"`    // only with ShowSpeed
	Spark     []int           `json:"spark,omitempty"` // only with ShowSpeed: last 14 successful pings
	Uptime    *float64        `json:"uptime,omitempty"`
	Days      []statusDayView `json:"days"`
}

const (
	statusContainerTTL     = 30 * time.Second
	statusContainerTimeout = 5 * time.Second
	statusSparkLen         = 14
)

// The container list, shared by every visitor for 30 s.
var statusListContainers = func(ctx context.Context) ([]dockerContainerSummary, error) {
	api, reason := newDockerAPI()
	if api == nil {
		return nil, errors.New(reason)
	}
	return api.listContainers(ctx)
}

var statusContainerCache struct {
	sync.Mutex
	at    time.Time
	byKey map[string]dockerContainerSummary
	ok    bool
}

// statusContainers caches failures too, so a public page cannot make the
// server knock on an unreachable Docker more than once per 30 s.
func statusContainers(ctx context.Context, now time.Time) (map[string]dockerContainerSummary, bool) {
	c := &statusContainerCache
	c.Lock()
	defer c.Unlock()
	if !c.at.IsZero() && now.Sub(c.at) < statusContainerTTL {
		return c.byKey, c.ok
	}
	// The answer is shared by every visitor for 30 s: one closed tab must not
	// cancel it and leave everyone with Unknown containers.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), statusContainerTimeout)
	defer cancel()
	list, err := statusListContainers(ctx)
	c.at, c.ok, c.byKey = now, err == nil, map[string]dockerContainerSummary{}
	if err == nil {
		for _, s := range list {
			c.byKey[s.name()] = s
		}
	}
	return c.byKey, c.ok
}

func resetStatusContainerCache() {
	c := &statusContainerCache
	c.Lock()
	defer c.Unlock()
	c.at, c.byKey, c.ok = time.Time{}, nil, false
}

func (h *Handlers) buildStatusSnapshot(ctx context.Context, cfg StatusPageConfig, now time.Time) statusSnapshot {
	snap := statusSnapshot{
		GeneratedAt: now.UnixMilli(),
		Title:       cfg.Title,
		Notice:      cfg.Notice,
		Groups:      []statusGroupView{},
	}

	monitored := map[string]Bookmark{}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			if bm.Monitor {
				monitored[canonicalBookmarkURLKey(bm.URL)] = bm
			}
		}
	}
	allSamples := h.readAllHealthHistory()
	allDays := h.readAllHealthDays()

	var containers map[string]dockerContainerSummary
	dockerOK := false
	for _, g := range cfg.Groups {
		for _, s := range g.Services {
			if s.Container != "" && containers == nil {
				containers, dockerOK = statusContainers(ctx, now)
			}
		}
	}

	inMaint := h.statusMaintenance(&snap, cfg, now)
	windowCovers := h.statusWindowCovers(cfg)

	for _, g := range cfg.Groups {
		gv := statusGroupView{Name: g.Name, Total: len(g.Services), Services: []statusServiceView{}}
		for _, s := range g.Services {
			sv := statusServiceView{Name: s.Name}
			// A name that is only the monitor's address (no bookmark to name it
			// after) would put an internal host on the page: the page shows a
			// generic word instead, unless the owner chose to show the link.
			if s.Name == s.MonitorURL && !s.ShowLink {
				sv.Name = ""
			}
			var parts []statusPart
			var samples []HealthSample
			var healthDays []HealthDay
			var monitorDays, containerDays map[int64]statusState
			hasMonitor := false

			if s.MonitorURL != "" {
				key := canonicalBookmarkURLKey(s.MonitorURL)
				if bm, found := monitored[key]; found {
					hasMonitor = true
					samples, healthDays = allSamples[key], allDays[key]
					parts = append(parts, monitorPart(samples, monitorIntervalMinutesFor(bm), now))
					monitorDays = monitorDayStates(samples, healthDays, windowCovers[g.ID])
				} else {
					parts = append(parts, statusPart{State: statusUnknown})
				}
				if s.ShowLink {
					sv.URL = s.MonitorURL
				}
			}
			if s.Container != "" {
				var c *dockerContainerSummary
				if found, ok := containers[s.Container]; dockerOK && ok {
					c = &found
				}
				timeline := dockerTimelines.forContainer(s.Container)
				parts = append(parts, containerPart(c, dockerOK, timeline, now))
				containerDays = containerDayStates(timeline, windowCovers[g.ID])
				if c != nil {
					fillQuietContainerDays(containerDays, timeline, c.Created, now)
				}
			}

			p := applyMaintenanceState(combineParts(parts...), inMaint[g.ID])
			sv.State, sv.Since, sv.LastCheck, sv.Reason = p.State, p.Since, p.LastCheck, p.Reason
			if s.ShowSpeed && len(samples) > 0 && samples[len(samples)-1].Up {
				sv.Ms = samples[len(samples)-1].PingMs
				sv.Spark = statusSpark(samples)
			}
			sv.Days = statusDayBars(now, p.State, monitorDays, containerDays)
			sv.Uptime = statusUptime(samples, healthDays, sv.Days, hasMonitor, now)
			// The monitor's ratio cannot see a container that was down while the
			// page kept answering: the lower of the two counts, as the bars do.
			if hasMonitor && s.Container != "" {
				if byDays := statusUptime(nil, nil, sv.Days, false, now); byDays != nil && (sv.Uptime == nil || *byDays < *sv.Uptime) {
					sv.Uptime = byDays
				}
			}

			switch p.State {
			case statusDown:
				snap.AnyDown = true
				snap.Problems++
			case statusDegraded:
				snap.Problems++
			case statusOperational:
				gv.Working++
			}
			gv.Services = append(gv.Services, sv)
		}
		snap.Groups = append(snap.Groups, gv)
	}
	return snap
}

// statusMaintenance lists the linked windows' next occurrences on the snapshot
// and returns the group ids whose window is open now.
// statusWindowCovers answers, per group id, whether one of the maintenance
// windows linked to that group was open at a moment: a container stopped for
// the nightly backup the owner announced is maintenance on its day, not down.
func (h *Handlers) statusWindowCovers(cfg StatusPageConfig) map[string]func(atMs int64) bool {
	settings := h.store.GetSettings()
	loc := maintenanceLocation(settings)
	out := map[string]func(int64) bool{}
	for _, g := range cfg.Groups {
		var linked []MaintenanceWindow
		for _, w := range settings.MaintenanceWindows {
			for _, id := range w.StatusGroups {
				if id == g.ID {
					linked = append(linked, w)
					break
				}
			}
		}
		if len(linked) == 0 {
			continue
		}
		out[g.ID] = func(atMs int64) bool {
			t := time.UnixMilli(atMs)
			if loc != time.Local {
				t = t.In(loc)
			}
			return inMaintenanceWindow(linked, t)
		}
	}
	return out
}

func (h *Handlers) statusMaintenance(snap *statusSnapshot, cfg StatusPageConfig, now time.Time) map[string]bool {
	settings := h.store.GetSettings()
	names := map[string]string{}
	for _, g := range cfg.Groups {
		names[g.ID] = g.Name
	}
	// Same reading of the clock as maintenanceInEffect, so the page and the
	// health checks agree on when a window is open.
	local := now
	if loc := maintenanceLocation(settings); loc != time.Local {
		local = now.In(loc)
	}
	active := map[string]bool{}
	for _, w := range settings.MaintenanceWindows {
		var ids, groups []string
		for _, id := range w.StatusGroups {
			if name, ok := names[id]; ok {
				ids = append(ids, id)
				groups = append(groups, name)
			}
		}
		if len(ids) == 0 {
			continue
		}
		start, end, isActive, ok := w.nextOccurrence(local, 7*24*time.Hour)
		if !ok {
			continue
		}
		if isActive {
			for _, id := range ids {
				active[id] = true
			}
		}
		snap.Maintenance = append(snap.Maintenance, statusUpcoming{
			Start: start.UnixMilli(), End: end.UnixMilli(), Active: isActive, Label: w.Label, Groups: groups,
		})
	}
	sort.SliceStable(snap.Maintenance, func(i, j int) bool { return snap.Maintenance[i].Start < snap.Maintenance[j].Start })
	return active
}

// fillQuietContainerDays fills the days without events for a container Docker
// lists now: the event log only records changes. A quiet day takes the state
// the last event before it left behind, so a container that stopped on Monday
// and stayed stopped reads down all week, not green after Monday. Before the
// first event it is taken to have been running.
func fillQuietContainerDays(days map[int64]statusState, timeline []dockerTimelineEntry, createdSec int64, now time.Time) {
	const dayMs = int64(24 * time.Hour / time.Millisecond)
	today := dayStartMs(now.UnixMilli())
	from := today - int64(statusDays-1)*dayMs
	if createdSec > 0 {
		if c := dayStartMs(createdSec * 1000); c > from {
			from = c
		}
	}
	carried := statusOperational
	i := 0
	// Events before the first bar still set the state it starts from.
	for ; i < len(timeline) && timeline[i].At < from; i++ {
		carried = containerStateAfter(timeline[i].Kind, carried)
	}
	for d := from; d <= today; d += dayMs {
		if _, ok := days[d]; !ok {
			days[d] = carried
		}
		for ; i < len(timeline) && timeline[i].At < d+dayMs; i++ {
			carried = containerStateAfter(timeline[i].Kind, carried)
		}
	}
}

// containerStateAfter is the state an event leaves a container in; events that
// say nothing about running (an update notice, say) keep the state it had.
func containerStateAfter(kind string, before statusState) statusState {
	switch kind {
	case "stop", "exit", "crash":
		return statusDown
	case "unhealthy", "restart-loop":
		return statusDegraded
	case "start", "healthy", "unpause", "restart":
		return statusOperational
	}
	return before
}

// statusSpark is the response times of the last successful checks, oldest first.
func statusSpark(samples []HealthSample) []int {
	var out []int
	for i := len(samples) - 1; i >= 0 && len(out) < statusSparkLen; i-- {
		if samples[i].Up && samples[i].PingMs > 0 {
			out = append(out, samples[i].PingMs)
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
