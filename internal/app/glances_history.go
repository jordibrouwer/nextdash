package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The history of the machine, kept by nextDash itself.

Glances forgets quickly and only for itself, so a graph that starts when the
page opens is an empty graph. A sampler reads the machine every five seconds
while the feature is on and appends to one ring per series: cpu, memory, swap,
the three loads, the rate in and out of every real interface, every disk's
read and write rate, the hottest temperatures and how full the fullest disks are.
Thirty days of it are the most that
is kept. The rings are written to the data directory every few minutes and read
back at start, so a restart does not empty the graphs.

A read that failed leaves no point: a gap is a gap, never a line down to zero.
Which series exist is whatever the machine reports, up to a limit.
*/

const (
	// glancesFineKeep is the last quarter of an hour at the sampler's own pace.
	glancesFineKeep = 180
	// glancesCoarseEvery is how many samples one coarse point averages.
	glancesCoarseEvery = 6
	// glancesKeep is a day of coarse points.
	glancesKeep = 2880
	// glancesLongEvery is how many coarse points one long point averages: a
	// point every quarter of an hour; how many are kept is the retention (7, 30 or 90 days).
	glancesLongEvery = 30
	// glancesLongPerDay is long points in a day.
	glancesLongPerDay = 96
	glancesMaxSeries  = 96
	// glancesMaxConsumers is how many processes and containers have their own series.
	glancesMaxConsumers = 60
	// glancesTopProcesses and glancesTopContainers are how many of the busiest get a point per beat.
	glancesTrackedScan   = 300
	glancesTopProcesses  = 10
	glancesTopContainers = 12
	glancesSaveEvery     = 10 * time.Minute
	// glancesHottest is how many temperature sensors get a series.
	glancesHottest = 8
	// glancesFullest is how many mounts get a usage series.
	glancesFullest = 8
	// glancesMaxPoints is the most points one series gives back.
	glancesMaxPoints = 720
)

// glancesPoint is [unix milliseconds, value].
type glancesPoint [2]float64

/*
glancesRing is one series, kept twice. The fine ring holds the last fifteen
minutes at the sampler's pace, so "the last minute" is a line and not a dot;
the coarse ring holds a day, one point for every glancesCoarseEvery samples
averaged; the long ring holds thirty days at a point a quarter of an hour. A
question picks the ring that is fine enough for how far back it goes.
*/
type glancesRing struct {
	Fine   []glancesPoint `json:"fine"`
	Coarse []glancesPoint `json:"coarse"`
	Long   []glancesPoint `json:"long"`
	// The pending coarse and long points: sums of what has come in since the
	// bucket (a slot on the clock, the same for every series) began.
	sum        float64
	count      int
	bucket     int64
	longSum    float64
	longCount  int
	longBucket int64
}

// glancesCoarseMs and glancesLongMs are the width of a coarse and a long point.
// Points sit on this grid for every series, so two series can be added up by time.
var (
	glancesCoarseMs = (glancesSampleEvery * glancesCoarseEvery).Milliseconds()
	glancesLongMs   = glancesCoarseMs * glancesLongEvery
)

// glancesFlushCoarse files the pending coarse bucket as a point at the start of
// its slot, and feeds it to the long bucket, which files itself the same way.
func (r *glancesRing) flushCoarse(longCap int) {
	if r.count == 0 {
		return
	}
	average := r.sum / float64(r.count)
	r.Coarse = capPoints(append(r.Coarse, glancesPoint{float64(r.bucket * glancesCoarseMs), average}), glancesKeep)
	r.sum, r.count = 0, 0
	slot := (r.bucket * glancesCoarseMs) / glancesLongMs
	if r.longCount > 0 && slot != r.longBucket {
		r.Long = capPoints(append(r.Long, glancesPoint{float64(r.longBucket * glancesLongMs), r.longSum / float64(r.longCount)}), longCap)
		r.longSum, r.longCount = 0, 0
	}
	r.longBucket = slot
	r.longSum += average
	r.longCount++
}

// glancesTier is which ring answers a question about the last `age`: the finest
// that reaches back that far, with a little slack so a window of exactly a
// day (asked a moment after it was worked out) is still a day of coarse points.
func glancesTier(age int64) string {
	slack := time.Minute.Milliseconds()
	switch {
	case age <= (glancesFineKeep*glancesSampleEvery).Milliseconds()+slack:
		return "fine"
	case age <= (glancesKeep*glancesCoarseEvery*glancesSampleEvery).Milliseconds()+10*slack:
		return "coarse"
	}
	return "long"
}

// glancesHistoryVersion is the layout of glances-history.json. 1: series of
// fine, coarse and long points on the shared clock grid. A change that older
// files cannot be read as raises it, with a conversion here.
const glancesHistoryVersion = 1

func capPoints(points []glancesPoint, limit int) []glancesPoint {
	if len(points) > limit {
		return append(points[:0:0], points[len(points)-limit:]...)
	}
	return points
}

// glancesRecord appends one reading to each named series. A series past the
// limit is not started; one that exists is always kept up.
func (hs *glancesHost) record(at int64, readings map[string]float64) {
	hs.rings.Lock()
	defer hs.rings.Unlock()
	for name, value := range readings {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		// Two decimals are all a graph can show, and a month of them is smaller.
		value = math.Round(value*100) / 100
		ring := hs.rings.series[name]
		if ring == nil {
			if !hs.roomFor(name, at) {
				continue
			}
			ring = &glancesRing{}
			hs.rings.series[name] = ring
		}
		ring.Fine = capPoints(append(ring.Fine, glancesPoint{float64(at), value}), glancesFineKeep)
		slot := at / glancesCoarseMs
		if ring.count > 0 && slot != ring.bucket {
			ring.flushCoarse(hs.longCap())
		}
		ring.bucket = slot
		ring.sum += value
		ring.count++
	}
}

func (hs *glancesHost) setTracked(tracked map[string]bool) {
	hs.rings.Lock()
	hs.rings.tracked = tracked
	hs.rings.Unlock()
}

// glancesItemOf is "proc:name" or "ct:name" from one of its series, "proc:name:cpu".
func glancesItemOf(series string) string {
	if i := strings.LastIndex(series, ":"); i > 0 {
		return series[:i]
	}
	return series
}

// glancesIsConsumer is a series about one process or container.
func glancesIsConsumer(name string) bool {
	return strings.HasPrefix(name, "proc:") || strings.HasPrefix(name, "ct:")
}

/*
glancesRoomFor says whether a new series may start. The machine's own series and
the processes and containers have a limit each. A full set of consumers makes
room by dropping the one that has been silent longest, if it has been silent a
day: a container that was removed does not hold its place for a month.
*/
func (hs *glancesHost) roomFor(name string, at int64) bool {
	consumers, base := 0, 0
	for existing := range hs.rings.series {
		if glancesIsConsumer(existing) {
			consumers++
		} else {
			base++
		}
	}
	if !glancesIsConsumer(name) {
		return base < glancesMaxSeries
	}
	if consumers < glancesMaxConsumers {
		return true
	}
	// Room is made first from series of items no longer recorded (the oldest
	// of them), then from one that has been silent a day.
	oldest, oldestAt := "", int64(math.MaxInt64)
	untracked, untrackedAt := "", int64(math.MaxInt64)
	for existing, ring := range hs.rings.series {
		if !glancesIsConsumer(existing) || len(ring.Fine) == 0 {
			continue
		}
		last := int64(ring.Fine[len(ring.Fine)-1][0])
		if last < oldestAt {
			oldest, oldestAt = existing, last
		}
		if !hs.rings.tracked[glancesItemOf(existing)] && last < untrackedAt {
			untracked, untrackedAt = existing, last
		}
	}
	if untracked != "" {
		delete(hs.rings.series, untracked)
		return true
	}
	if oldest != "" && at-oldestAt > 24*3600*1000 {
		delete(hs.rings.series, oldest)
		return true
	}
	return false
}

// glancesWipe forgets everything recorded: the graphs, the incidents, and the
// files that keep them.
// remove forgets a host for good: what it recorded goes, and a beat that was
// on its way when it was removed writes nothing back.
func (hs *glancesHost) remove() {
	hs.removed.Store(true)
	hs.wipe()
}

func (hs *glancesHost) wipe() {
	hs.saveMu.Lock()
	defer hs.saveMu.Unlock()
	hs.rings.Lock()
	hs.rings.series = map[string]*glancesRing{}
	hs.rings.Unlock()
	hs.incidentsReset()
	for _, path := range []string{hs.historyPath(), hs.incidentsPath()} {
		_ = os.Remove(path)
	}
}

// glancesCollected is what has been recorded, for Config to show.
func (hs *glancesHost) collected() (series, points int, since int64) {
	hs.rings.Lock()
	defer hs.rings.Unlock()
	for _, ring := range hs.rings.series {
		series++
		points += len(ring.Fine) + len(ring.Coarse) + len(ring.Long)
		for _, source := range [][]glancesPoint{ring.Long, ring.Coarse, ring.Fine} {
			if len(source) > 0 {
				if first := int64(source[0][0]); since == 0 || first < since {
					since = first
				}
				break
			}
		}
	}
	return series, points, since
}

func (hs *glancesHost) seriesNames() []string {
	hs.rings.Lock()
	defer hs.rings.Unlock()
	names := make([]string, 0, len(hs.rings.series))
	for name := range hs.rings.series {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

/*
glancesQuery gives back the named series from since on, averaged into steps
so that a day of points does not travel whole to draw a graph a few hundred
pixels wide. A step with no points is left out, which is what keeps a gap a gap.
A question is answered from the finest ring that reaches back far enough.
*/
func (hs *glancesHost) query(names []string, since int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	return hs.queryWindow(names, since, 0, step, now)
}

// glancesQueryWindow is glancesQuery for a window that ends at until (0: now),
// which is how yesterday is drawn behind today.
func (hs *glancesHost) queryWindow(names []string, since, until int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	stepMs := step.Milliseconds()
	if stepMs < 1000 {
		stepMs = 1000
	}
	tier := glancesTier(now.UnixMilli() - since)
	hs.rings.Lock()
	defer hs.rings.Unlock()
	out := map[string][]glancesPoint{}
	for _, name := range names {
		ring := hs.rings.series[name]
		if ring == nil {
			continue
		}
		source := ring.Long
		switch tier {
		case "fine":
			source = ring.Fine
		case "coarse":
			source = ring.Coarse
		}
		var points []glancesPoint
		var bucket int64 = -1
		var sum float64
		var count int
		flush := func() {
			if count > 0 {
				points = append(points, glancesPoint{float64(bucket*stepMs + stepMs/2), sum / float64(count)})
			}
		}
		for _, p := range source {
			if int64(p[0]) < since || (until > 0 && int64(p[0]) > until) {
				continue
			}
			b := int64(p[0]) / stepMs
			if b != bucket {
				flush()
				bucket, sum, count = b, 0, 0
			}
			sum += p[1]
			count++
		}
		flush()
		if points != nil {
			out[name] = points
		}
	}
	return out
}

// ---- keeping it across a restart ----

func (hs *glancesHost) loadHistory() {
	cfg, _ := loadGlancesConfigFor(hs.id)
	hs.applyRetention(cfg)
	hs.rings.Lock()
	defer hs.rings.Unlock()
	hs.rings.series = map[string]*glancesRing{}
	data, err := os.ReadFile(hs.historyPath())
	if err != nil {
		return
	}
	var stored struct {
		Version int                     `json:"version"`
		Series  map[string]*glancesRing `json:"series"`
	}
	if json.Unmarshal(data, &stored) != nil {
		return
	}
	// A file from a newer nextDash is not read as this one's: it is set aside,
	// whole, and the record starts empty, rather than being half understood and
	// then overwritten.
	if stored.Version > glancesHistoryVersion {
		backup := hs.historyPath() + ".v" + strconv.Itoa(stored.Version) + ".bak"
		if err := os.Rename(hs.historyPath(), backup); err != nil {
			logWarn(logComponentWidgets, "Glances history of a newer version could not be set aside: %v", err)
		}
		return
	}
	// The machine's own series and the processes and containers have a limit
	// each, as when recording: a file full of the latter must not push the
	// former out, and map order is not a priority.
	base, consumers := 0, 0
	for _, name := range sortedKeys(stored.Series) {
		ring := stored.Series[name]
		if ring == nil {
			continue
		}
		if glancesIsConsumer(name) {
			if consumers >= glancesMaxConsumers {
				continue
			}
			consumers++
		} else {
			if base >= glancesMaxSeries {
				continue
			}
			base++
		}
		ring.Fine = capPoints(ring.Fine, glancesFineKeep)
		ring.Coarse = capPoints(ring.Coarse, glancesKeep)
		ring.Long = capPoints(ring.Long, hs.longCap())
		hs.rings.series[name] = ring
	}
}

func (hs *glancesHost) saveHistory() {
	hs.saveMu.Lock()
	defer hs.saveMu.Unlock()
	if hs.removed.Load() {
		return
	}
	// A snapshot of the slice headers, taken under the lock: appends only write
	// past a slice's length and a cap makes a new slice, so encoding them later,
	// without the lock, does not race the sampler and does not block it.
	hs.rings.Lock()
	snapshot := make(map[string]glancesRing, len(hs.rings.series))
	for name, ring := range hs.rings.series {
		snapshot[name] = glancesRing{Fine: ring.Fine, Coarse: ring.Coarse, Long: ring.Long}
	}
	hs.rings.Unlock()
	data, err := json.Marshal(map[string]any{"version": glancesHistoryVersion, "series": snapshot})
	if err != nil {
		return
	}
	if err := writeFileAtomic(hs.historyPath(), data, 0644); err != nil {
		logWarn(logComponentWidgets, "Glances history could not be saved: %v", err)
	}
	hs.incidents.Lock()
	hs.saveIncidentsLocked()
	hs.incidents.Unlock()
}

// ---- how the machine is, as one word ----

// hs.state is the latest reading's verdict: ok, warn or bad over the
// thresholds, or unknown while the machine does not answer.

func (hs *glancesHost) setState(at int64, ok bool, level, err string) {
	hs.state.Lock()
	hs.state.at, hs.state.ok, hs.state.level, hs.state.err = at, ok, level, err
	if ok {
		hs.state.okAt = at
	}
	hs.state.Unlock()
}

func glancesLevelRank(level string) int {
	switch level {
	case "bad":
		return 2
	case "warn":
		return 1
	}
	return 0
}

// glancesTone is how far over its line a reading is: ok, warn or bad.
func glancesTone(value, warn, bad float64) string {
	switch {
	case value >= bad:
		return "bad"
	case value >= warn:
		return "warn"
	}
	return "ok"
}

// glancesSensorTone uses the lines the machine reports for the sensor when
// they are plausible, and the reader's temperature lines when it reports none.
func glancesSensorTone(s glancesSensor, t GlancesThresholds) string {
	if s.Value == nil {
		return "ok"
	}
	warn, crit := glancesPlausibleLimit(s.Warning), glancesPlausibleLimit(s.Critical)
	switch {
	case crit != nil && *s.Value >= *crit:
		return "bad"
	case warn != nil && *s.Value >= *warn:
		return "warn"
	case warn != nil || crit != nil:
		return "ok"
	}
	return glancesTone(*s.Value, t.TempWarn, t.TempBad)
}

// glancesLevel is the worst of every reading that has a line: cpu, memory,
// swap, every disk that shows and every temperature.
func glancesLevel(cfg GlancesConfig, quick glancesQuicklook, fs []glancesFS, sensors []glancesSensor) string {
	t := cfg.Thresholds
	level := "ok"
	worse := func(next string) {
		if glancesLevelRank(next) > glancesLevelRank(level) {
			level = next
		}
	}
	if quick.CPU != nil {
		worse(glancesTone(*quick.CPU, t.CPUWarn, t.CPUBad))
	}
	if quick.Mem != nil {
		worse(glancesTone(*quick.Mem, t.MemWarn, t.MemBad))
	}
	if quick.Swap != nil {
		worse(glancesTone(*quick.Swap, t.SwapWarn, t.SwapBad))
	}
	for _, f := range fs {
		if f.Percent != nil {
			worse(glancesTone(*f.Percent, t.DiskWarn, t.DiskBad))
		}
	}
	for _, s := range sensors {
		if strings.HasPrefix(s.Type, "temperature") {
			worse(glancesSensorTone(s, t))
		}
	}
	return level
}

// ---- the sampler ----

// StartGlancesSampler runs a sampler for every host until stop closes. Each
// reads its settings on every beat: switched off, without an address, or in
// the public demo it does nothing, and not one request goes out. A panic in one
// beat is logged and the next one goes on: this runs for the life of the
// process. Hosts added or removed in Config start or stop theirs
// (glancesWakeSampler).
func (h *Handlers) StartGlancesSampler(stop <-chan struct{}) <-chan struct{} {
	finished := make(chan struct{})
	if demoMode() {
		close(finished)
		return finished
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-stop
		cancel()
	}()
	go func() {
		defer close(finished)
		running := map[string]context.CancelFunc{}
		exited := make(chan string, glancesMaxHosts*2)
		var all sync.WaitGroup
		reconcile := func() {
			want := map[string]bool{}
			for _, c := range glancesHostConfigs() {
				want[c.ID] = true
				if _, ok := running[c.ID]; ok {
					continue
				}
				hostCtx, stopHost := context.WithCancel(ctx)
				running[c.ID] = stopHost
				hs := glancesHostByID(c.ID)
				hs.loadHistory()
				hs.loadIncidents()
				all.Add(1)
				go func() {
					defer all.Done()
					h.glancesRunHost(hostCtx, hs)
					// A host that was removed (and maybe added again under the
					// same name) is started afresh by the next reconcile.
					select {
					case exited <- hs.id:
					default:
					}
				}()
			}
			for id, stopHost := range running {
				if !want[id] {
					stopHost()
					delete(running, id)
				}
			}
		}
		reconcile()
		// Also once a minute: a restore of glances.json brings hosts without anyone waking us.
		tick := time.NewTicker(time.Minute)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				all.Wait()
				return
			case <-glancesHostsChanged:
				reconcile()
			case <-tick.C:
				reconcile()
			case id := <-exited:
				if stopHost, ok := running[id]; ok {
					stopHost()
					delete(running, id)
				}
				reconcile()
			}
		}
	}()
	return finished
}

// glancesRunHost is one host's loop.
func (h *Handlers) glancesRunHost(ctx context.Context, hs *glancesHost) {
	lastSave := time.Now()
	// A first reading at once: at an hour a beat nobody waits an hour to see data.
	h.glancesSampleBeat(ctx, hs)
	for {
		// The pace is read from Config before every wait, and a change of it
		// (hs.wake) ends the wait: from an hour to thirty seconds does not take
		// an hour to notice.
		cfg, known := loadGlancesConfigFor(hs.id)
		if !known {
			return
		}
		timer := time.NewTimer(cfg.recordInterval())
		select {
		case <-ctx.Done():
			timer.Stop()
			// A host that was removed does not write its files back.
			if _, still := loadGlancesConfigFor(hs.id); still {
				hs.saveHistory()
			}
			return
		case <-hs.wake:
			timer.Stop()
		case <-timer.C:
		}
		if _, still := loadGlancesConfigFor(hs.id); !still {
			return
		}
		h.glancesSampleBeat(ctx, hs)
		if _, still := loadGlancesConfigFor(hs.id); !still {
			return
		}
		if time.Since(lastSave) >= glancesSaveEvery {
			hs.saveHistory()
			lastSave = time.Now()
		}
	}
}

func (h *Handlers) glancesSampleBeat(ctx context.Context, hs *glancesHost) {
	defer func() {
		if p := recover(); p != nil {
			logWarn(logComponentWidgets, "Glances sampler panicked: %v", p)
		}
	}()
	h.glancesSampleHost(ctx, hs)
}

// glancesAsk reads one path into out; an off plugin is simply not there.
func (h *Handlers) glancesAsk(ctx context.Context, cfg GlancesConfig, path string, out any) error {
	data, err := h.glancesRead(ctx, cfg, path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// glancesSampleHost takes one reading of one host and files it.
func (h *Handlers) glancesSampleHost(ctx context.Context, hs *glancesHost) {
	cfg, known := loadGlancesConfigFor(hs.id)
	if !known || hs.removed.Load() {
		// Removed while the beat was on its way: nothing of the first host's is read into it.
		return
	}
	hs.setBeat(cfg.recordInterval())
	hs.applyRetention(cfg)
	if !cfg.connected() {
		hs.setState(0, false, "unknown", "")
		// Nothing is read now, so an incident that was open ends where it was seen.
		hs.observe(time.Now().UnixMilli(), nil)
		return
	}
	now := time.Now().UnixMilli()

	var quick glancesQuicklook
	err := h.glancesAsk(ctx, cfg, "quicklook", &quick)
	if errors.Is(err, errGlancesNotFound) {
		// The quicklook plugin is off, which is not the host being away: the
		// same readings come from the cpu and memory plugins.
		err = h.glancesQuickFallback(ctx, cfg, &quick)
	}
	if err != nil {
		// A host that does not answer is a point at 0 on "up", so how long it was
		// away is drawn, and an incident of its own.
		hs.record(now, map[string]float64{"up": 0})
		h.glancesNotify(ctx, cfg, hs.observe(now, []glancesObservation{{Kind: "down", Bad: true}}))
		hs.setState(now, false, "unknown", mediaErrorCode(err))
		return
	}
	var (
		load    glancesLoad
		net     []glancesNet
		disks   []glancesDiskIO
		sensors []glancesSensor
		fs      []glancesFS
	)
	// Each part is its own question; one that fails or is off only leaves its
	// own series without a point.
	var (
		mem        glancesMem
		procs      []glancesProc
		containers []glancesContainer
	)
	_ = h.glancesAsk(ctx, cfg, "load", &load)
	_ = h.glancesAsk(ctx, cfg, "mem", &mem)
	// Processes and containers are read only when the reader asked for the
	// history of at least one: it is the costly part of a beat.
	tracked := cfg.tracked()
	hs.setTracked(tracked)
	wantProcs, wantContainers := false, false
	for key := range tracked {
		wantProcs = wantProcs || strings.HasPrefix(key, "proc:")
		wantContainers = wantContainers || strings.HasPrefix(key, "ct:")
	}
	// The busiest are recorded as well, when asked for, so both are read.
	if cfg.AutoRecord > 0 {
		wantProcs, wantContainers = true, true
	}
	if wantProcs {
		_ = h.glancesAsk(ctx, cfg, "processlist/top/"+strconv.Itoa(glancesTrackedScan), &procs)
	}
	if wantContainers {
		_ = h.glancesAsk(ctx, cfg, "containers", &containers)
	}
	_ = h.glancesAsk(ctx, cfg, "network", &net)
	// Disks, sensors and file systems change slowly and cost Glances the most to
	// read: they are asked once a minute, and the beats between repeat the last
	// answer.
	disks, sensors, fs = h.glancesSlowReads(ctx, cfg)

	readings := map[string]float64{}
	put := func(name string, v *float64) {
		if v != nil {
			readings[name] = *v
		}
	}
	put("up", glancesPtr(1))
	put("cpu", quick.CPU)
	// Each core's own load, for the tiles' one-minute trace.
	for i, c := range quick.PerCPU {
		if i >= glancesMaxCores {
			break
		}
		number := float64(i)
		if c.Number != nil {
			number = *c.Number
		}
		put("core:"+strconv.Itoa(int(number)), c.Total)
	}
	put("mem", quick.Mem)
	if used, cache, free, ok := glancesMemParts(mem); ok {
		readings["memc:used"], readings["memc:cache"], readings["memc:free"] = used, cache, free
	}
	put("swap", quick.Swap)
	put("load1", load.Min1)
	put("load5", load.Min5)
	put("load15", load.Min15)
	for _, n := range net {
		if n.up() && !glancesVirtualNIC(n.Name) {
			put("net:"+n.Name+":rx", n.RecvRate)
			put("net:"+n.Name+":tx", n.SentRate)
		}
	}
	for _, d := range disks {
		if !glancesDiskNoise.MatchString(d.Name) {
			put("disk:"+d.Name+":read", d.ReadRate)
			put("disk:"+d.Name+":write", d.WriteRate)
		}
	}
	var temps []glancesSensor
	for _, s := range sensors {
		if s.Value != nil && strings.HasPrefix(s.Type, "temperature") {
			temps = append(temps, s)
		}
	}
	sort.SliceStable(temps, func(i, j int) bool { return *temps[i].Value > *temps[j].Value })
	for i, s := range temps {
		if i >= glancesHottest {
			break
		}
		put("temp:"+s.Label, s.Value)
	}
	// How full the fullest disks are, to see them fill: the trend is what a
	// reading of 74% cannot say.
	sort.SliceStable(fs, func(i, j int) bool {
		a, b := fs[i].Percent, fs[j].Percent
		return a != nil && (b == nil || *a > *b)
	})
	for i, f := range fs {
		if i >= glancesFullest {
			break
		}
		put("fs:"+f.MntPoint, f.Percent)
	}
	if cfg.AutoRecord > 0 {
		tracked = hs.withStickyBusiest(tracked, procs, containers, cfg.AutoRecord, now)
		hs.setTracked(tracked)
	}
	glancesConsumers(readings, procs, containers, tracked)
	hs.record(now, readings)
	h.glancesNotify(ctx, cfg, hs.observe(now, glancesObservations(cfg, quick, fs, sensors)))
	h.glancesNotifyForecast(ctx, cfg, hs)
	hs.setState(now, true, glancesLevel(cfg, quick, fs, sensors), "")
}

func glancesPtr(v float64) *float64 { return &v }

// glancesSlowEvery is how often the slow plugins (diskio, sensors, fs) are read.
// A test that shortens the beat gets every beat read, so nothing there waits a minute.
func glancesSlowEvery() time.Duration {
	if glancesSampleEvery != 5*time.Second {
		return 0
	}
	return time.Minute
}

// glancesSlowReads returns the slow plugins' readings, asking Glances only when
// the last ask is older than glancesSlowEvery or the host changed.
func (h *Handlers) glancesSlowReads(ctx context.Context, cfg GlancesConfig) ([]glancesDiskIO, []glancesSensor, []glancesFS) {
	hs := glancesHostByID(cfg.ID)
	key := cfg.Server + "|" + cfg.User
	hs.slow.Lock()
	if hs.slow.key == key && !hs.slow.at.IsZero() && time.Since(hs.slow.at) < glancesSlowEvery() {
		d, s, f := hs.slow.disks, hs.slow.sensors, hs.slow.fs
		hs.slow.Unlock()
		return d, s, f
	}
	hs.slow.Unlock()

	var (
		disks   []glancesDiskIO
		sensors []glancesSensor
		fs      []glancesFS
	)
	_ = h.glancesAsk(ctx, cfg, "diskio", &disks)
	_ = h.glancesAsk(ctx, cfg, "sensors", &sensors)
	if data, err := h.glancesRead(ctx, cfg, "fs"); err == nil {
		if cleaned, err := glancesCleanFS(data, cfg); err == nil {
			_ = json.Unmarshal(cleaned, &fs)
		}
	}
	hs.slow.Lock()
	hs.slow.key, hs.slow.at = key, time.Now()
	hs.slow.disks, hs.slow.sensors, hs.slow.fs = disks, sensors, fs
	hs.slow.Unlock()
	return disks, sensors, fs
}

// glancesMem is the parts of /mem the history keeps.
type glancesMem struct {
	Percent   *float64 `json:"percent"`
	Total     *float64 `json:"total"`
	Available *float64 `json:"available"`
	Free      *float64 `json:"free"`
}

// glancesMemParts is what the memory is made of, as shares of the whole that add
// up to a hundred: in use by programs (total less what is available), cache that
// can be given back (available less free), and free.
func glancesMemParts(m glancesMem) (used, cache, free float64, ok bool) {
	if m.Total == nil || m.Available == nil || m.Free == nil || *m.Total <= 0 {
		return 0, 0, 0, false
	}
	total := *m.Total
	used = math.Max(0, total-*m.Available)
	free = math.Min(math.Max(0, *m.Free), total-used)
	cache = math.Max(0, total-used-free)
	return 100 * used / total, 100 * cache / total, 100 * free / total, true
}

// glancesQuickFallback fills a quicklook from the cpu, mem and memswap plugins.
// It fails only when none of them answers (the host really is not there).
func (h *Handlers) glancesQuickFallback(ctx context.Context, cfg GlancesConfig, quick *glancesQuicklook) error {
	var cpu struct {
		Total *float64 `json:"total"`
	}
	var mem, swap glancesMem
	errCPU := h.glancesAsk(ctx, cfg, "cpu", &cpu)
	errMem := h.glancesAsk(ctx, cfg, "mem", &mem)
	_ = h.glancesAsk(ctx, cfg, "memswap", &swap)
	if errCPU != nil && errMem != nil {
		if errors.Is(errCPU, errGlancesNotFound) && errors.Is(errMem, errGlancesNotFound) {
			// Plugins are off but the server answered: it is up, just silent.
			return nil
		}
		return errCPU
	}
	quick.CPU, quick.Mem, quick.Swap = cpu.Total, mem.Percent, swap.Percent
	return nil
}

type glancesProc struct {
	Name string   `json:"name"`
	CPU  *float64 `json:"cpu_percent"`
	Mem  *float64 `json:"memory_percent"`
}

type glancesContainer struct {
	Name       string   `json:"name"`
	Status     string   `json:"status"`
	CPUPercent *float64 `json:"cpu_percent"`
	MemUsage   *float64 `json:"memory_usage"`
	// NetworkRX and NetworkTX are bytes a second; the nested "network" object
	// holds bytes since the last update, which depends on who asked last.
	NetworkRX *float64 `json:"network_rx"`
	NetworkTX *float64 `json:"network_tx"`
}

/*
glancesConsumers adds the busiest processes and containers of this beat to the
readings. Processes of one name are one series, summed: there are a dozen
workers behind a name. A container or process that was not among the busiest
this beat has a gap, not a zero, so a rank over a day is of what was seen.
*/
func glancesConsumers(readings map[string]float64, procs []glancesProc, containers []glancesContainer, tracked map[string]bool) {
	type sum struct{ cpu, mem float64 }
	byName := map[string]*sum{}
	for _, p := range procs {
		if p.Name == "" || p.CPU == nil || !tracked["proc:"+p.Name] {
			continue
		}
		s := byName[p.Name]
		if s == nil {
			s = &sum{}
			byName[p.Name] = s
		}
		s.cpu += *p.CPU
		if p.Mem != nil {
			s.mem += *p.Mem
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return byName[names[i]].cpu > byName[names[j]].cpu })
	for _, name := range names {
		readings["proc:"+name+":cpu"] = byName[name].cpu
		readings["proc:"+name+":mem"] = byName[name].mem
	}

	running := make([]glancesContainer, 0, len(containers))
	for _, c := range containers {
		if c.Name != "" && strings.EqualFold(c.Status, "running") && c.CPUPercent != nil && tracked["ct:"+c.Name] {
			running = append(running, c)
		}
	}
	sort.Slice(running, func(i, j int) bool { return *running[i].CPUPercent > *running[j].CPUPercent })
	for _, c := range running {
		readings["ct:"+c.Name+":cpu"] = *c.CPUPercent
		if c.MemUsage != nil {
			readings["ct:"+c.Name+":mem"] = *c.MemUsage
		}
		if c.NetworkRX != nil {
			readings["ct:"+c.Name+":rx"] = *c.NetworkRX
		}
		if c.NetworkTX != nil {
			readings["ct:"+c.Name+":tx"] = *c.NetworkTX
		}
	}
}

// glancesAutoKeep is how long an item that was once among the busiest stays
// recorded: its line lives hours, not one beat, and room is made from items
// that are neither chosen nor recent.
const glancesAutoKeep = 6 * 3600 * 1000

// withStickyBusiest is tracked plus this beat's busiest, and those that were
// among the busiest within glancesAutoKeep (at most three times n, the newest).
func (hs *glancesHost) withStickyBusiest(tracked map[string]bool, procs []glancesProc, containers []glancesContainer, n int, now int64) map[string]bool {
	hs.autoMu.Lock()
	defer hs.autoMu.Unlock()
	if hs.autoSeen == nil {
		hs.autoSeen = map[string]int64{}
	}
	for key := range glancesWithBusiest(nil, procs, containers, n) {
		hs.autoSeen[key] = now
	}
	keys := make([]string, 0, len(hs.autoSeen))
	for key, at := range hs.autoSeen {
		if now-at > glancesAutoKeep {
			delete(hs.autoSeen, key)
			continue
		}
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return hs.autoSeen[keys[i]] > hs.autoSeen[keys[j]] })
	if len(keys) > 3*n {
		for _, key := range keys[3*n:] {
			delete(hs.autoSeen, key)
		}
		keys = keys[:3*n]
	}
	out := make(map[string]bool, len(tracked)+len(keys))
	for key := range tracked {
		out[key] = true
	}
	for _, key := range keys {
		out[key] = true
	}
	return out
}

// glancesWithBusiest adds the n busiest running containers and the n busiest
// process names of this beat to the items that are recorded.
func glancesWithBusiest(tracked map[string]bool, procs []glancesProc, containers []glancesContainer, n int) map[string]bool {
	out := make(map[string]bool, len(tracked)+2*n)
	for key := range tracked {
		out[key] = true
	}
	byName := map[string]float64{}
	for _, p := range procs {
		if p.Name != "" && p.CPU != nil {
			byName[p.Name] += *p.CPU
		}
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return byName[names[i]] > byName[names[j]] })
	for i, name := range names {
		if i >= n {
			break
		}
		out["proc:"+name] = true
	}
	running := make([]glancesContainer, 0, len(containers))
	for _, c := range containers {
		if c.Name != "" && strings.EqualFold(c.Status, "running") && c.CPUPercent != nil {
			running = append(running, c)
		}
	}
	sort.Slice(running, func(i, j int) bool { return *running[i].CPUPercent > *running[j].CPUPercent })
	for i, c := range running {
		if i >= n {
			break
		}
		out["ct:"+c.Name] = true
	}
	return out
}

// glancesObservations are this beat's readings against the red lines.
func glancesObservations(cfg GlancesConfig, quick glancesQuicklook, fs []glancesFS, sensors []glancesSensor) []glancesObservation {
	t := cfg.Thresholds
	out := []glancesObservation{{Kind: "down", Bad: false}}
	check := func(kind string, value *float64, bad float64) {
		if value != nil {
			out = append(out, glancesObservation{Kind: kind, Value: *value, Bad: *value >= bad})
		}
	}
	check("cpu", quick.CPU, t.CPUBad)
	check("mem", quick.Mem, t.MemBad)
	check("swap", quick.Swap, t.SwapBad)
	for _, f := range fs {
		if f.Percent != nil {
			out = append(out, glancesObservation{Kind: "disk", Subject: f.MntPoint, Value: *f.Percent, Bad: *f.Percent >= t.DiskBad})
		}
	}
	for _, s := range sensors {
		if s.Value != nil && strings.HasPrefix(s.Type, "temperature") {
			out = append(out, glancesObservation{Kind: "temp", Subject: s.Label, Value: *s.Value, Bad: glancesSensorTone(s, t) == "bad"})
		}
	}
	return out
}

// ---- the routes ----

// glancesStatusHandler says whether the page exists and how the machine is: all
// the browser needs to show the tab and its dot, and nothing it should not hold.
func (h *Handlers) glancesStatusHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	cfg, hs := glancesResolve(r)
	hosts := glancesHostSummaries()
	if demoMode() {
		// Glances is not part of the demo: nothing is set up, whatever a data folder holds.
		cfg, hosts = defaultGlancesConfig(), []glancesHostSummary{}
	}
	// The page and its icon exist when Glances is on and any host has an address.
	anySetUp := false
	for _, host := range hosts {
		anySetUp = anySetUp || host.Configured
	}
	hs.state.Lock()
	answer := map[string]any{
		"id":             cfg.ID,
		"name":           glancesHostName(cfg),
		"hosts":          hosts,
		"enabled":        cfg.Enabled,
		"configured":     anySetUp,
		"hostConfigured": cfg.configured(),
		"paused":         cfg.Paused,
		"recordEvery":    normalizeGlancesRecord(cfg.RecordEvery),
		"retentionDays":  normalizeGlancesRetention(cfg.RetentionDays),
		"refresh":        cfg.Refresh,
		"hiddenBlocks":   cfg.HiddenBlocks,
		"thresholds":     cfg.Thresholds,
		"level":          hs.state.level,
		"ok":             hs.state.ok,
		"at":             hs.state.at,
	}
	hs.state.Unlock()
	if !cfg.connected() {
		answer["level"], answer["ok"], answer["at"] = "unknown", false, 0
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(answer)
}

// glancesHistoryHandler answers the graphs: ?series=cpu,mem&since=<ms>&step=<s>.
// Without series it answers only the names that exist.
func (h *Handlers) glancesHistoryHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	cfg, hs := glancesResolve(r)
	query := r.URL.Query()
	now := time.Now()
	since := now.Add(-time.Hour).UnixMilli()
	if v, err := strconv.ParseInt(query.Get("since"), 10, 64); err == nil {
		since = max(v, now.Add(-hs.retentionSpan()).UnixMilli())
	}
	// until ends the window earlier than now: yesterday drawn behind today.
	var until int64
	if v, err := strconv.ParseInt(query.Get("until"), 10, 64); err == nil && v > since {
		until = v
	}
	end := now.UnixMilli()
	if until > 0 {
		end = until
	}
	span := time.Duration(end-since) * time.Millisecond
	step := max(glancesSampleEvery, span/glancesMaxPoints)
	if v, err := strconv.Atoi(query.Get("step")); err == nil && v > 0 {
		step = max(time.Duration(v)*time.Second, span/glancesMaxPoints)
	}
	var names []string
	for _, name := range strings.Split(query.Get("series"), ",") {
		if name = strings.TrimSpace(name); name != "" && len(names) < glancesMaxSeries+glancesMaxConsumers {
			names = append(names, name)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"names":  hs.seriesNames(),
		"series": hs.queryWindow(names, since, until, step, now),
		"step":   int(step.Seconds()),
		"now":    now.UnixMilli(),
		// What went past a red line in this window, for the bands over a graph.
		"incidents": hs.incidentsBetween(since, end),
		"restarts":  h.glancesRestartsAsked(r, cfg, since),
	})
}

// glancesConnectHandler tries a host: what Config asks to see before it saves.
// Behind the write token and the outbound limit, since it asks an address the
// caller typed. A password typed here is used for this one request and written
// nowhere; left empty, the saved one is used when the user is the same.
func (h *Handlers) glancesConnectHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) || !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	var body struct {
		Server   string `json:"server"`
		User     string `json:"user"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	answer := struct {
		Connected string   `json:"connected,omitempty"`
		Version   string   `json:"version,omitempty"`
		Plugins   []string `json:"plugins,omitempty"`
		Error     string   `json:"error,omitempty"`
	}{}
	reply := func(err error) {
		if err != nil {
			logWarn(logComponentWidgets, "Glances connect to %s: %v", hostOf(body.Server), err)
			answer.Error = mediaErrorCode(err)
		}
		_ = json.NewEncoder(w).Encode(answer)
	}

	server := strings.TrimRight(sanitizeWidgetURL(body.Server), "/")
	if server == "" {
		reply(errMediaNotSetUp)
		return
	}
	var credential HealthCredential
	if user := strings.TrimSpace(body.User); user != "" {
		credential = HealthCredential{BasicUser: user, BasicPassword: body.Password}
		if saved, _ := glancesResolve(r); body.Password == "" && user == saved.User {
			credential = glancesCredential(saved)
		}
	}

	var status struct {
		Version string `json:"version"`
	}
	if err := h.glancesGet(r.Context(), server, credential, "/status", nil, &status); err != nil {
		reply(err)
		return
	}
	var plugins []string
	_ = h.glancesGet(r.Context(), server, credential, "/pluginslist", nil, &plugins)
	answer.Version, answer.Plugins = status.Version, plugins
	answer.Connected = "Glances " + status.Version
	reply(nil)
}

// glancesSampleEvery is the pace the rings are laid out for: the fine ring holds
// glancesFineKeep of these. It is not the pace the host is read at (that is
// Config's recordEvery, from two seconds to an hour); it is a variable so a test
// does not wait for a beat.
var glancesSampleEvery = 5 * time.Second

func sortedKeys(m map[string]*glancesRing) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// glancesHostsChanged tells the sampler the list of hosts changed.
var glancesHostsChanged = make(chan struct{}, 1)

// glancesWakeSampler makes every sampler read its settings again at once, and
// starts or stops the ones for hosts that came or went.
func glancesWakeSampler() {
	select {
	case glancesHostsChanged <- struct{}{}:
	default:
	}
	glancesHosts.Lock()
	hosts := make([]*glancesHost, 0, len(glancesHosts.byID))
	for _, hs := range glancesHosts.byID {
		hosts = append(hosts, hs)
	}
	glancesHosts.Unlock()
	for _, hs := range hosts {
		hs.wakeSampler()
	}
}
