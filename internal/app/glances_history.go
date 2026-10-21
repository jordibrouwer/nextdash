package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
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
	// point every quarter of an hour, and glancesLongKeep of them are thirty days.
	glancesLongEvery = 30
	glancesLongKeep  = 2880
	glancesMaxSeries = 96
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
func (r *glancesRing) flushCoarse() {
	if r.count == 0 {
		return
	}
	average := r.sum / float64(r.count)
	r.Coarse = capPoints(append(r.Coarse, glancesPoint{float64(r.bucket * glancesCoarseMs), average}), glancesKeep)
	r.sum, r.count = 0, 0
	slot := (r.bucket * glancesCoarseMs) / glancesLongMs
	if r.longCount > 0 && slot != r.longBucket {
		r.Long = capPoints(append(r.Long, glancesPoint{float64(r.longBucket * glancesLongMs), r.longSum / float64(r.longCount)}), glancesLongKeep)
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

var glancesRings = struct {
	sync.Mutex
	series map[string]*glancesRing
}{series: map[string]*glancesRing{}}

func glancesHistoryPath() string { return filepath.Join(ResolveDataDir(), "glances-history.json") }

func capPoints(points []glancesPoint, limit int) []glancesPoint {
	if len(points) > limit {
		return append(points[:0:0], points[len(points)-limit:]...)
	}
	return points
}

// glancesRecord appends one reading to each named series. A series past the
// limit is not started; one that exists is always kept up.
func glancesRecord(at int64, readings map[string]float64) {
	glancesRings.Lock()
	defer glancesRings.Unlock()
	for name, value := range readings {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			continue
		}
		// Two decimals are all a graph can show, and a month of them is smaller.
		value = math.Round(value*100) / 100
		ring := glancesRings.series[name]
		if ring == nil {
			if !glancesRoomFor(name, at) {
				continue
			}
			ring = &glancesRing{}
			glancesRings.series[name] = ring
		}
		ring.Fine = capPoints(append(ring.Fine, glancesPoint{float64(at), value}), glancesFineKeep)
		slot := at / glancesCoarseMs
		if ring.count > 0 && slot != ring.bucket {
			ring.flushCoarse()
		}
		ring.bucket = slot
		ring.sum += value
		ring.count++
	}
}

// glancesTrackedNow is the processes and containers being recorded, as the
// sampler last saw Config. Guarded by glancesRings.
var glancesTrackedNow = map[string]bool{}

func glancesSetTracked(tracked map[string]bool) {
	glancesRings.Lock()
	glancesTrackedNow = tracked
	glancesRings.Unlock()
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
func glancesRoomFor(name string, at int64) bool {
	consumers, base := 0, 0
	for existing := range glancesRings.series {
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
	for existing, ring := range glancesRings.series {
		if !glancesIsConsumer(existing) || len(ring.Fine) == 0 {
			continue
		}
		last := int64(ring.Fine[len(ring.Fine)-1][0])
		if last < oldestAt {
			oldest, oldestAt = existing, last
		}
		if !glancesTrackedNow[glancesItemOf(existing)] && last < untrackedAt {
			untracked, untrackedAt = existing, last
		}
	}
	if untracked != "" {
		delete(glancesRings.series, untracked)
		return true
	}
	if oldest != "" && at-oldestAt > 24*3600*1000 {
		delete(glancesRings.series, oldest)
		return true
	}
	return false
}

// glancesWipe forgets everything recorded: the graphs, the incidents, and the
// files that keep them.
func glancesWipe() {
	glancesSaveMu.Lock()
	defer glancesSaveMu.Unlock()
	glancesRings.Lock()
	glancesRings.series = map[string]*glancesRing{}
	glancesRings.Unlock()
	glancesIncidentsReset()
	for _, path := range []string{glancesHistoryPath(), glancesIncidentsPath()} {
		_ = os.Remove(path)
	}
}

// glancesCollected is what has been recorded, for Config to show.
func glancesCollected() (series, points int, since int64) {
	glancesRings.Lock()
	defer glancesRings.Unlock()
	for _, ring := range glancesRings.series {
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

func glancesSeriesNames() []string {
	glancesRings.Lock()
	defer glancesRings.Unlock()
	names := make([]string, 0, len(glancesRings.series))
	for name := range glancesRings.series {
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
func glancesQuery(names []string, since int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	return glancesQueryWindow(names, since, 0, step, now)
}

// glancesQueryWindow is glancesQuery for a window that ends at until (0: now),
// which is how yesterday is drawn behind today.
func glancesQueryWindow(names []string, since, until int64, step time.Duration, now time.Time) map[string][]glancesPoint {
	stepMs := step.Milliseconds()
	if stepMs < 1000 {
		stepMs = 1000
	}
	tier := glancesTier(now.UnixMilli() - since)
	glancesRings.Lock()
	defer glancesRings.Unlock()
	out := map[string][]glancesPoint{}
	for _, name := range names {
		ring := glancesRings.series[name]
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

func loadGlancesHistory() {
	glancesRings.Lock()
	defer glancesRings.Unlock()
	glancesRings.series = map[string]*glancesRing{}
	data, err := os.ReadFile(glancesHistoryPath())
	if err != nil {
		return
	}
	var stored struct {
		Series map[string]*glancesRing `json:"series"`
	}
	if json.Unmarshal(data, &stored) != nil {
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
		ring.Long = capPoints(ring.Long, glancesLongKeep)
		glancesRings.series[name] = ring
	}
}

// glancesSaveMu serialises saving and wiping, so a wipe is not undone by a save
// that began before it.
var glancesSaveMu sync.Mutex

func saveGlancesHistory() {
	glancesSaveMu.Lock()
	defer glancesSaveMu.Unlock()
	// A snapshot of the slice headers, taken under the lock: appends only write
	// past a slice's length and a cap makes a new slice, so encoding them later,
	// without the lock, does not race the sampler and does not block it.
	glancesRings.Lock()
	snapshot := make(map[string]glancesRing, len(glancesRings.series))
	for name, ring := range glancesRings.series {
		snapshot[name] = glancesRing{Fine: ring.Fine, Coarse: ring.Coarse, Long: ring.Long}
	}
	glancesRings.Unlock()
	data, err := json.Marshal(map[string]any{"series": snapshot})
	if err != nil {
		return
	}
	if err := writeFileAtomic(glancesHistoryPath(), data, 0644); err != nil {
		logWarn(logComponentWidgets, "Glances history could not be saved: %v", err)
	}
	glancesIncidents.Lock()
	saveGlancesIncidentsLocked()
	glancesIncidents.Unlock()
}

// ---- how the machine is, as one word ----

// glancesState is the latest reading's verdict: ok, warn or bad over the
// thresholds, or unknown while the machine does not answer.
var glancesState = struct {
	sync.Mutex
	at    int64
	ok    bool
	level string
	err   string
}{level: "unknown"}

func setGlancesState(at int64, ok bool, level, err string) {
	glancesState.Lock()
	glancesState.at, glancesState.ok, glancesState.level, glancesState.err = at, ok, level, err
	glancesState.Unlock()
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

// StartGlancesSampler runs the sampler until stop closes. It reads the settings
// on every beat: switched off, without an address, or in the public demo it does
// nothing, and not one request goes out. A panic in one beat is logged and the
// next one goes on: this runs for the life of the process.
func (h *Handlers) StartGlancesSampler(stop <-chan struct{}) <-chan struct{} {
	finished := make(chan struct{})
	if demoMode() {
		close(finished)
		return finished
	}
	loadGlancesHistory()
	loadGlancesIncidents()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-stop
		cancel()
	}()
	go func() {
		defer close(finished)
		lastSave := time.Now()
		// A first reading at once: at an hour a beat nobody waits an hour to see data.
		h.glancesSampleBeat(ctx)
		for {
			// The pace is read from Config before every wait, and a change of it
			// (glancesRecordWake) ends the wait: from an hour to thirty seconds
			// does not take an hour to notice.
			timer := time.NewTimer(loadGlancesConfig().recordInterval())
			select {
			case <-ctx.Done():
				timer.Stop()
				saveGlancesHistory()
				return
			case <-glancesRecordWake:
				timer.Stop()
			case <-timer.C:
			}
			h.glancesSampleBeat(ctx)
			if time.Since(lastSave) >= glancesSaveEvery {
				saveGlancesHistory()
				lastSave = time.Now()
			}
		}
	}()
	return finished
}

func (h *Handlers) glancesSampleBeat(ctx context.Context) {
	defer func() {
		if p := recover(); p != nil {
			logWarn(logComponentWidgets, "Glances sampler panicked: %v", p)
		}
	}()
	h.glancesSampleOnce(ctx)
}

// glancesAsk reads one path into out; an off plugin is simply not there.
func (h *Handlers) glancesAsk(ctx context.Context, cfg GlancesConfig, path string, out any) error {
	data, err := h.glancesRead(ctx, cfg, path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// glancesSampleOnce takes one reading and files it.
func (h *Handlers) glancesSampleOnce(ctx context.Context) {
	cfg := loadGlancesConfig()
	setGlancesBeat(cfg.recordInterval())
	if !cfg.connected() {
		setGlancesState(0, false, "unknown", "")
		// Nothing is read now, so an incident that was open ends where it was seen.
		glancesObserve(time.Now().UnixMilli(), nil)
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
		glancesRecord(now, map[string]float64{"up": 0})
		glancesObserve(now, []glancesObservation{{Kind: "down", Bad: true}})
		setGlancesState(now, false, "unknown", mediaErrorCode(err))
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
	glancesSetTracked(tracked)
	wantProcs, wantContainers := false, false
	for key := range tracked {
		wantProcs = wantProcs || strings.HasPrefix(key, "proc:")
		wantContainers = wantContainers || strings.HasPrefix(key, "ct:")
	}
	if wantProcs {
		_ = h.glancesAsk(ctx, cfg, "processlist/top/"+strconv.Itoa(glancesTrackedScan), &procs)
	}
	if wantContainers {
		_ = h.glancesAsk(ctx, cfg, "containers", &containers)
	}
	_ = h.glancesAsk(ctx, cfg, "network", &net)
	_ = h.glancesAsk(ctx, cfg, "diskio", &disks)
	_ = h.glancesAsk(ctx, cfg, "sensors", &sensors)
	if data, err := h.glancesRead(ctx, cfg, "fs"); err == nil {
		if cleaned, err := glancesCleanFS(data, cfg); err == nil {
			_ = json.Unmarshal(cleaned, &fs)
		}
	}

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
	glancesConsumers(readings, procs, containers, tracked)
	glancesRecord(now, readings)
	glancesObserve(now, glancesObservations(cfg, quick, fs, sensors))
	setGlancesState(now, true, glancesLevel(cfg, quick, fs, sensors), "")
}

func glancesPtr(v float64) *float64 { return &v }

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
	cfg := loadGlancesConfig()
	glancesState.Lock()
	answer := map[string]any{
		"enabled":      cfg.Enabled,
		"configured":   cfg.configured(),
		"paused":       cfg.Paused,
		"recordEvery":  normalizeGlancesRecord(cfg.RecordEvery),
		"refresh":      cfg.Refresh,
		"hiddenBlocks": cfg.HiddenBlocks,
		"thresholds":   cfg.Thresholds,
		"level":        glancesState.level,
		"ok":           glancesState.ok,
		"at":           glancesState.at,
	}
	glancesState.Unlock()
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
	query := r.URL.Query()
	now := time.Now()
	since := now.Add(-time.Hour).UnixMilli()
	if v, err := strconv.ParseInt(query.Get("since"), 10, 64); err == nil {
		since = max(v, now.Add(-glancesLongKeep*glancesLongEvery*glancesCoarseEvery*glancesSampleEvery).UnixMilli())
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
		"names":  glancesSeriesNames(),
		"series": glancesQueryWindow(names, since, until, step, now),
		"step":   int(step.Seconds()),
		"now":    now.UnixMilli(),
		// What went past a red line in this window, for the bands over a graph.
		"incidents": glancesIncidentsBetween(since, end),
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
		if body.Password == "" && user == loadGlancesConfig().User {
			credential = glancesCredential(loadGlancesConfig())
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

// glancesRecordWake tells the sampler its pace changed.
var glancesRecordWake = make(chan struct{}, 1)

func glancesWakeSampler() {
	select {
	case glancesRecordWake <- struct{}{}:
	default:
	}
}

func sortedKeys(m map[string]*glancesRing) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
