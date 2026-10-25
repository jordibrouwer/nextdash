package app

import (
	"math"
	"sort"
	"strings"
	"time"
)

/*
Insights: what nextDash can work out from its own record of the host, none of
which Glances itself says.

Everything here is computed from the rings (see glances_history.go) and the
incident log, never from a fresh read: a health score, when a disk will be full,
whether memory is climbing, how this hour compares with the same hour on other
days, which hours of which days are the busy ones, how much went over the
network each day, how often the host answered, and which processes and
containers used the most over the range. A quantity with too little behind it
is left out rather than guessed.
*/

type glancesSnap struct{ Fine, Coarse, Long []glancesPoint }

func (hs *glancesHost) snapshot() map[string]glancesSnap {
	hs.rings.Lock()
	defer hs.rings.Unlock()
	out := make(map[string]glancesSnap, len(hs.rings.series))
	for name, ring := range hs.rings.series {
		out[name] = glancesSnap{Fine: ring.Fine, Coarse: ring.Coarse, Long: ring.Long}
	}
	return out
}

// glancesSpacing is the time one point of a series stands for: the usual gap
// between its points, as recorded. The rings are laid out on a clock, but when
// the host is recorded every half hour a point stands for half an hour, and
// whatever adds up readings over time has to know that.
func glancesSpacing(points []glancesPoint, fallback time.Duration) time.Duration {
	if len(points) < 3 {
		return fallback
	}
	gaps := make([]float64, 0, len(points)-1)
	for i := 1; i < len(points); i++ {
		gaps = append(gaps, points[i][0]-points[i-1][0])
	}
	sort.Float64s(gaps)
	median := time.Duration(gaps[len(gaps)/2]) * time.Millisecond
	if median <= 0 {
		return fallback
	}
	return median
}

// window is the points of the finest ring that reaches back to since, and the
// time one of its points stands for.
func (s glancesSnap) window(since, until int64, now time.Time) ([]glancesPoint, time.Duration) {
	source, spacing := s.Long, glancesSampleEvery*glancesCoarseEvery*glancesLongEvery
	switch glancesTier(now.UnixMilli() - since) {
	case "fine":
		source, spacing = s.Fine, glancesSampleEvery
	case "coarse":
		source, spacing = s.Coarse, glancesSampleEvery*glancesCoarseEvery
	}
	out := make([]glancesPoint, 0, len(source))
	for _, p := range source {
		if int64(p[0]) >= since && (until == 0 || int64(p[0]) <= until) {
			out = append(out, p)
		}
	}
	return out, glancesSpacing(out, spacing)
}

func glancesValues(points []glancesPoint) []float64 {
	out := make([]float64, len(points))
	for i, p := range points {
		out[i] = p[1]
	}
	return out
}

func glancesMean(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	sum := 0.0
	for _, v := range values {
		sum += v
	}
	return sum / float64(len(values)), true
}

func glancesPercentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	index := p / 100 * float64(len(sorted)-1)
	low := int(math.Floor(index))
	high := int(math.Ceil(index))
	return sorted[low] + (sorted[high]-sorted[low])*(index-float64(low))
}

// glancesFit is the straight line through points (least squares): its slope
// per day and how much of the movement it explains (r squared).
func glancesFit(points []glancesPoint) (slopePerDay, r2 float64, ok bool) {
	if len(points) < 12 {
		return 0, 0, false
	}
	const day = 24 * 3600 * 1000.0
	x0 := points[0][0]
	var sx, sy, sxx, sxy, syy float64
	n := float64(len(points))
	for _, p := range points {
		x := (p[0] - x0) / day
		sx += x
		sy += p[1]
		sxx += x * x
		sxy += x * p[1]
		syy += p[1] * p[1]
	}
	dx := n*sxx - sx*sx
	dy := n*syy - sy*sy
	if dx <= 0 || points[len(points)-1][0]-x0 < 6*3600*1000 {
		return 0, 0, false
	}
	slope := (n*sxy - sx*sy) / dx
	if dy > 0 {
		r := (n*sxy - sx*sy) / math.Sqrt(dx*dy)
		r2 = r * r
	}
	return slope, r2, true
}

func glancesLast(s glancesSnap) (float64, bool) {
	for _, source := range [][]glancesPoint{s.Fine, s.Coarse, s.Long} {
		if len(source) > 0 {
			return source[len(source)-1][1], true
		}
	}
	return 0, false
}

// ---- the answer ----

type glancesFactor struct {
	Key     string  `json:"key"`
	Value   float64 `json:"value"`
	Penalty float64 `json:"penalty"`
}

type glancesHealth struct {
	Score   int             `json:"score"`
	Level   string          `json:"level"`
	Factors []glancesFactor `json:"factors"`
	// TrendCPU is the change in the average processor use, this hour against
	// the one before, in points of percent; nil when there is not an hour of each.
	TrendCPU *float64 `json:"trendCpu,omitempty"`
}

type glancesForecast struct {
	Mount      string  `json:"mount"`
	Percent    float64 `json:"percent"`
	SlopeDay   float64 `json:"slopePerDay"`
	DaysToFull *int    `json:"daysToFull,omitempty"`
	Hours      int     `json:"hours"`
}

type glancesMemoryTrend struct {
	SlopeDay float64 `json:"slopePerDay"`
	R2       float64 `json:"r2"`
	Leak     bool    `json:"leak"`
}

type glancesStats struct {
	Avg float64 `json:"avg"`
	P50 float64 `json:"p50"`
	P95 float64 `json:"p95"`
	P99 float64 `json:"p99"`
	Max float64 `json:"max"`
	N   int     `json:"n"`
}

type glancesBaseline struct {
	Key     string  `json:"key"`
	Now     float64 `json:"now"`
	Typical float64 `json:"typical"`
	Ratio   float64 `json:"ratio"`
}

type glancesHeatDay struct {
	Date  string    `json:"date"`
	Hours []float64 `json:"hours"` // -1: nothing recorded
}

type glancesHeatmap struct {
	Metric string           `json:"metric"`
	Unit   string           `json:"unit"`
	Max    float64          `json:"max"`
	Days   []glancesHeatDay `json:"days"`
}

type glancesNetDay struct {
	Date  string             `json:"date"`
	RX    float64            `json:"rx"`
	TX    float64            `json:"tx"`
	Parts map[string]float64 `json:"parts,omitempty"`
}

type glancesNetworkVolume struct {
	Days    []glancesNetDay `json:"days"`
	PeakRX  float64         `json:"peakRx"`
	PeakTX  float64         `json:"peakTx"`
	P95     float64         `json:"p95"`
	TotalRX float64         `json:"totalRx"`
	TotalTX float64         `json:"totalTx"`
}

type glancesAvailability struct {
	Since    int64     `json:"since"`
	Day      *float64  `json:"day,omitempty"`
	Week     *float64  `json:"week,omitempty"`
	Month    *float64  `json:"month,omitempty"`
	Timeline []float64 `json:"timeline"` // 96 quarter hours: share of beats answered, -1 unknown
}

type glancesConsumer struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	AvgCPU float64 `json:"avgCpu"`
	MaxCPU float64 `json:"maxCpu"`
	AvgMem float64 `json:"avgMem"`
	Share  float64 `json:"share"`
}

type glancesTempStats struct {
	Max         float64  `json:"max"`
	Avg         float64  `json:"avg"`
	HoursWarn   float64  `json:"hoursWarn"`
	HoursBad    float64  `json:"hoursBad"`
	Correlation *float64 `json:"correlationCpu,omitempty"`
}

type glancesInsights struct {
	At           int64                   `json:"at"`
	Range        string                  `json:"range"`
	Since        int64                   `json:"since"`
	Health       glancesHealth           `json:"health"`
	Forecast     []glancesForecast       `json:"forecast"`
	Memory       *glancesMemoryTrend     `json:"memory,omitempty"`
	Stats        map[string]glancesStats `json:"stats"`
	Baseline     []glancesBaseline       `json:"baseline"`
	Heatmap      glancesHeatmap          `json:"heatmap"`
	Network      glancesNetworkVolume    `json:"network"`
	Availability glancesAvailability     `json:"availability"`
	Incidents    struct {
		Ongoing []GlancesIncident `json:"ongoing"`
		Past    []GlancesIncident `json:"past"`
	} `json:"incidents"`
	Consumers   []glancesConsumer `json:"consumers"`
	Temperature *glancesTempStats `json:"temperature,omitempty"`
	glancesMoreInsights
}

var glancesRanges = map[string]time.Duration{"24h": 24 * time.Hour, "7d": 7 * 24 * time.Hour, "30d": 30 * 24 * time.Hour}

// glancesPenalty is how many points of a hundred a reading costs: nothing under
// its yellow line, up to 15 at its red line, up to 35 when it is as bad as it gets.
func glancesPenalty(value, warn, bad, ceiling float64) float64 {
	switch {
	case value < warn:
		return 0
	case value < bad:
		return 15 * (value - warn) / math.Max(bad-warn, 1)
	}
	return 15 + 20*math.Min(1, (value-bad)/math.Max(ceiling-bad, 1))
}

func glancesComputeInsights(cfg GlancesConfig, rangeID string, heat string, loc *time.Location, now time.Time) glancesInsights {
	if loc == nil {
		loc = time.UTC
	}
	// Days and hours are the reader's, not the server's.
	now = now.In(loc)
	span, ok := glancesRanges[rangeID]
	if !ok {
		rangeID, span = "24h", 24*time.Hour
	}
	hs := glancesHostByID(cfg.ID)
	snaps := hs.snapshot()
	t := cfg.Thresholds
	nowMs := now.UnixMilli()
	since := now.Add(-span).UnixMilli()
	out := glancesInsights{At: nowMs, Range: rangeID, Since: since, Stats: map[string]glancesStats{}}
	out.Incidents.Ongoing, out.Incidents.Past = hs.incidentList()
	if out.Incidents.Ongoing == nil {
		out.Incidents.Ongoing = []GlancesIncident{}
	}
	if out.Incidents.Past == nil {
		out.Incidents.Past = []GlancesIncident{}
	}
	if len(out.Incidents.Past) > 100 {
		out.Incidents.Past = out.Incidents.Past[:100]
	}

	// Statistics over the range.
	for _, key := range []string{"cpu", "mem", "swap", "load1"} {
		snap, ok := snaps[key]
		if !ok {
			continue
		}
		points, _ := snap.window(since, 0, now)
		if len(points) == 0 {
			continue
		}
		values := glancesValues(points)
		avg, _ := glancesMean(values)
		sorted := append([]float64(nil), values...)
		sort.Float64s(sorted)
		out.Stats[key] = glancesStats{
			Avg: avg, P50: glancesPercentile(sorted, 50), P95: glancesPercentile(sorted, 95),
			P99: glancesPercentile(sorted, 99), Max: sorted[len(sorted)-1], N: len(sorted),
		}
	}

	out.Health = glancesComputeHealth(cfg, snaps, now, out)
	out.Forecast = glancesComputeForecast(snaps, now)
	out.Memory = glancesComputeMemoryTrend(snaps, now)
	out.Baseline = glancesComputeBaseline(snaps, now)
	out.Heatmap = glancesComputeHeatmap(snaps, heat, rangeID, now)
	out.Network = glancesComputeNetwork(snaps, rangeID, now)
	out.Availability = glancesComputeAvailability(snaps, now)
	out.Consumers = glancesComputeConsumers(snaps, span, now)
	out.Temperature = glancesComputeTemperature(snaps, span, now, t)
	out.glancesMoreInsights = glancesComputeMore(snaps, span, now, t, int(hs.cores.Load()))
	return out
}

func glancesComputeHealth(cfg GlancesConfig, snaps map[string]glancesSnap, now time.Time, in glancesInsights) glancesHealth {
	t := cfg.Thresholds
	var factors []glancesFactor
	add := func(key string, value, warn, bad, ceiling float64) {
		factors = append(factors, glancesFactor{Key: key, Value: math.Round(value*10) / 10, Penalty: math.Round(glancesPenalty(value, warn, bad, ceiling)*10) / 10})
	}
	for key, lines := range map[string][2]float64{"cpu": {t.CPUWarn, t.CPUBad}, "mem": {t.MemWarn, t.MemBad}, "swap": {t.SwapWarn, t.SwapBad}} {
		if snap, ok := snaps[key]; ok {
			if v, ok := glancesLast(snap); ok {
				add(key, v, lines[0], lines[1], 100)
			}
		}
	}
	disk := math.Inf(-1)
	temp := math.Inf(-1)
	for name, snap := range snaps {
		v, ok := glancesLast(snap)
		if !ok {
			continue
		}
		if strings.HasPrefix(name, "fs:") && v > disk {
			disk = v
		}
		if strings.HasPrefix(name, "temp:") && v > temp {
			temp = v
		}
	}
	if !math.IsInf(disk, -1) {
		add("disk", disk, t.DiskWarn, t.DiskBad, 100)
	}
	if !math.IsInf(temp, -1) {
		add("temp", temp, t.TempWarn, t.TempBad, t.TempBad+20)
	}
	score := 100.0
	for _, f := range factors {
		score -= f.Penalty
	}
	score -= math.Min(30, 8*float64(len(in.Incidents.Ongoing)))
	if up, ok := snaps["up"]; ok {
		points, _ := up.window(now.Add(-24*time.Hour).UnixMilli(), 0, now)
		if mean, ok := glancesMean(glancesValues(points)); ok && mean < 0.99 {
			penalty := math.Min(20, (0.99-mean)*100*2)
			score -= penalty
			factors = append(factors, glancesFactor{Key: "availability", Value: math.Round(mean*1000) / 10, Penalty: math.Round(penalty*10) / 10})
		}
	}
	sort.SliceStable(factors, func(i, j int) bool { return factors[i].Penalty > factors[j].Penalty })
	score = math.Max(0, math.Min(100, math.Round(score)))
	level := "poor"
	switch {
	case score >= 85:
		level = "good"
	case score >= 60:
		level = "fair"
	}
	health := glancesHealth{Score: int(score), Level: level, Factors: factors}
	if snap, ok := snaps["cpu"]; ok {
		hour := now.Add(-time.Hour).UnixMilli()
		two := now.Add(-2 * time.Hour).UnixMilli()
		this, _ := snap.window(hour, 0, now)
		before, _ := snap.window(two, hour, now)
		if len(this) >= 60 && len(before) >= 60 {
			a, _ := glancesMean(glancesValues(this))
			b, _ := glancesMean(glancesValues(before))
			d := math.Round((a-b)*10) / 10
			health.TrendCPU = &d
		}
	}
	return health
}

func glancesComputeForecast(snaps map[string]glancesSnap, now time.Time) []glancesForecast {
	out := []glancesForecast{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "fs:") {
			continue
		}
		last, ok := glancesLast(snap)
		if !ok {
			continue
		}
		points, _ := snap.window(now.Add(-7*24*time.Hour).UnixMilli(), 0, now)
		slope, _, ok := glancesFit(points)
		if !ok {
			continue
		}
		f := glancesForecast{
			Mount: strings.TrimPrefix(name, "fs:"), Percent: math.Round(last*10) / 10,
			SlopeDay: math.Round(slope*100) / 100,
			Hours:    int((points[len(points)-1][0] - points[0][0]) / 3600000),
		}
		if slope > 0.02 && last < 100 {
			days := int(math.Ceil((100 - last) / slope))
			f.DaysToFull = &days
		}
		out = append(out, f)
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].DaysToFull, out[j].DaysToFull
		switch {
		case a != nil && b != nil:
			return *a < *b
		case a != nil:
			return true
		case b != nil:
			return false
		}
		return out[i].Percent > out[j].Percent
	})
	return out
}

func glancesComputeMemoryTrend(snaps map[string]glancesSnap, now time.Time) *glancesMemoryTrend {
	snap, ok := snaps["mem"]
	if !ok {
		return nil
	}
	points, _ := snap.window(now.Add(-24*time.Hour).UnixMilli(), 0, now)
	slope, r2, ok := glancesFit(points)
	if !ok {
		return nil
	}
	return &glancesMemoryTrend{SlopeDay: math.Round(slope*100) / 100, R2: math.Round(r2*100) / 100, Leak: slope > 3 && r2 > 0.5}
}

// sumByTime adds up every series whose name has the prefix and suffix, point
// by point, over a window; the points of the series in a ring share their times.
func glancesSumByTime(snaps map[string]glancesSnap, prefix, suffix string, since int64, now time.Time) (map[int64]float64, time.Duration) {
	sum := map[int64]float64{}
	var spacing time.Duration
	for name, snap := range snaps {
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
			continue
		}
		points, sp := snap.window(since, 0, now)
		spacing = sp
		for _, p := range points {
			sum[int64(p[0])] += p[1]
		}
	}
	return sum, spacing
}

func glancesComputeBaseline(snaps map[string]glancesSnap, now time.Time) []glancesBaseline {
	out := []glancesBaseline{}
	hour := now.Hour()
	week := now.Add(-7 * 24 * time.Hour).UnixMilli()
	yesterday := now.Add(-24 * time.Hour).UnixMilli()
	for _, key := range []string{"cpu", "mem"} {
		snap, ok := snaps[key]
		if !ok {
			continue
		}
		recent, _ := snap.window(now.Add(-10*time.Minute).UnixMilli(), 0, now)
		past, _ := snap.window(week, yesterday, now)
		var same []float64
		for _, p := range past {
			if time.UnixMilli(int64(p[0])).In(now.Location()).Hour() == hour {
				same = append(same, p[1])
			}
		}
		current, ok1 := glancesMean(glancesValues(recent))
		typical, ok2 := glancesMean(same)
		if !ok1 || !ok2 || len(same) < 8 {
			continue
		}
		out = append(out, glancesBaseline{Key: key, Now: round1(current), Typical: round1(typical), Ratio: round1(current / math.Max(typical, 0.1))})
	}
	// Network: every interface, both ways.
	recent, _ := glancesSumByTime(snaps, "net:", ":rx", now.Add(-10*time.Minute).UnixMilli(), now)
	recentTX, _ := glancesSumByTime(snaps, "net:", ":tx", now.Add(-10*time.Minute).UnixMilli(), now)
	past, _ := glancesSumByTime(snaps, "net:", ":rx", week, now)
	pastTX, _ := glancesSumByTime(snaps, "net:", ":tx", week, now)
	var cur, same []float64
	for ts, v := range recent {
		cur = append(cur, v+recentTX[ts])
	}
	for ts, v := range past {
		if ts < yesterday && time.UnixMilli(ts).In(now.Location()).Hour() == hour {
			same = append(same, v+pastTX[ts])
		}
	}
	if c, ok := glancesMean(cur); ok && len(same) >= 8 {
		typical, _ := glancesMean(same)
		out = append(out, glancesBaseline{Key: "net", Now: round1(c), Typical: round1(typical), Ratio: round1(c / math.Max(typical, 1))})
	}
	return out
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func glancesComputeHeatmap(snaps map[string]glancesSnap, metric, rangeID string, now time.Time) glancesHeatmap {
	days := 7
	if rangeID == "30d" {
		days = 30
	}
	if metric != "net" && metric != "temp" {
		metric = "cpu"
	}
	since := now.AddDate(0, 0, -days).UnixMilli()
	byTime := map[int64]float64{}
	unit := "%"
	switch metric {
	case "cpu":
		if snap, ok := snaps["cpu"]; ok {
			points, _ := snap.window(since, 0, now)
			for _, p := range points {
				byTime[int64(p[0])] = p[1]
			}
		}
	case "net":
		unit = "B/s"
		rx, _ := glancesSumByTime(snaps, "net:", ":rx", since, now)
		tx, _ := glancesSumByTime(snaps, "net:", ":tx", since, now)
		for ts, v := range rx {
			byTime[ts] = v + tx[ts]
		}
		for ts, v := range tx {
			if _, ok := rx[ts]; !ok {
				byTime[ts] = v
			}
		}
	case "temp":
		unit = "°C"
		for name, snap := range snaps {
			if !strings.HasPrefix(name, "temp:") {
				continue
			}
			points, _ := snap.window(since, 0, now)
			for _, p := range points {
				if p[1] > byTime[int64(p[0])] {
					byTime[int64(p[0])] = p[1]
				}
			}
		}
	}
	type cell struct {
		sum float64
		n   int
	}
	cells := map[string]*[24]cell{}
	for ts, v := range byTime {
		at := time.UnixMilli(ts).In(now.Location())
		key := at.Format("2006-01-02")
		row := cells[key]
		if row == nil {
			row = &[24]cell{}
			cells[key] = row
		}
		row[at.Hour()].sum += v
		row[at.Hour()].n++
	}
	heat := glancesHeatmap{Metric: metric, Unit: unit}
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		day := glancesHeatDay{Date: date, Hours: make([]float64, 24)}
		for h := 0; h < 24; h++ {
			day.Hours[h] = -1
			if row := cells[date]; row != nil && row[h].n > 0 {
				v := row[h].sum / float64(row[h].n)
				day.Hours[h] = math.Round(v*10) / 10
				if v > heat.Max {
					heat.Max = v
				}
			}
		}
		heat.Days = append(heat.Days, day)
	}
	heat.Max = math.Round(heat.Max*10) / 10
	return heat
}

func glancesComputeNetwork(snaps map[string]glancesSnap, rangeID string, now time.Time) glancesNetworkVolume {
	days := 7
	if rangeID == "30d" {
		days = 30
	}
	since := now.AddDate(0, 0, -days).UnixMilli()
	vol := glancesNetworkVolume{Days: []glancesNetDay{}}
	byDate := map[string]*glancesNetDay{}
	for i := days - 1; i >= 0; i-- {
		date := now.AddDate(0, 0, -i).Format("2006-01-02")
		d := &glancesNetDay{Date: date, Parts: map[string]float64{}}
		byDate[date] = d
		vol.Days = append(vol.Days, glancesNetDay{})
	}
	spacing := (glancesSampleEvery * glancesCoarseEvery * glancesLongEvery).Seconds()
	var totals []float64
	rx, _ := glancesSumByTime(snaps, "net:", ":rx", since, now)
	tx, _ := glancesSumByTime(snaps, "net:", ":tx", since, now)
	for ts, v := range rx {
		totals = append(totals, v+tx[ts])
	}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "net:") {
			continue
		}
		parts := strings.Split(strings.TrimPrefix(name, "net:"), ":")
		if len(parts) < 2 {
			continue
		}
		iface, dir := strings.Join(parts[:len(parts)-1], ":"), parts[len(parts)-1]
		stand := time.Duration(spacing * float64(time.Second))
		longSpacing := glancesSpacing(snap.Long, stand).Seconds()
		for _, p := range snap.Long {
			if int64(p[0]) < since {
				continue
			}
			day := byDate[time.UnixMilli(int64(p[0])).In(now.Location()).Format("2006-01-02")]
			if day == nil {
				continue
			}
			bytes := p[1] * longSpacing
			if dir == "rx" {
				day.RX += bytes
			} else {
				day.TX += bytes
			}
			day.Parts[iface+":"+dir] += bytes
		}
	}
	for i := range vol.Days {
		date := now.AddDate(0, 0, -(days - 1 - i)).Format("2006-01-02")
		d := byDate[date]
		for k, v := range d.Parts {
			d.Parts[k] = math.Round(v)
		}
		d.RX, d.TX = math.Round(d.RX), math.Round(d.TX)
		vol.Days[i] = *d
		vol.TotalRX += d.RX
		vol.TotalTX += d.TX
	}
	// The peak and the 95th percentile come from the finest ring that covers a day.
	rxDay, _ := glancesSumByTime(snaps, "net:", ":rx", now.Add(-24*time.Hour).UnixMilli(), now)
	txDay, _ := glancesSumByTime(snaps, "net:", ":tx", now.Add(-24*time.Hour).UnixMilli(), now)
	for _, v := range rxDay {
		vol.PeakRX = math.Max(vol.PeakRX, v)
	}
	for _, v := range txDay {
		vol.PeakTX = math.Max(vol.PeakTX, v)
	}
	sort.Float64s(totals)
	vol.P95 = math.Round(glancesPercentile(totals, 95))
	vol.PeakRX, vol.PeakTX = math.Round(vol.PeakRX), math.Round(vol.PeakTX)
	return vol
}

func glancesComputeAvailability(snaps map[string]glancesSnap, now time.Time) glancesAvailability {
	out := glancesAvailability{Timeline: make([]float64, 96)}
	for i := range out.Timeline {
		out.Timeline[i] = -1
	}
	snap, ok := snaps["up"]
	if !ok {
		return out
	}
	for _, source := range [][]glancesPoint{snap.Long, snap.Coarse, snap.Fine} {
		if len(source) > 0 {
			out.Since = int64(source[0][0])
			break
		}
	}
	share := func(d time.Duration) *float64 {
		points, _ := snap.window(now.Add(-d).UnixMilli(), 0, now)
		if len(points) < 4 {
			return nil
		}
		mean, _ := glancesMean(glancesValues(points))
		v := math.Round(mean*10000) / 100
		return &v
	}
	out.Day, out.Week, out.Month = share(24*time.Hour), share(7*24*time.Hour), share(30*24*time.Hour)
	start := now.Add(-24 * time.Hour)
	points, _ := snap.window(start.UnixMilli(), 0, now)
	type acc struct {
		sum float64
		n   int
	}
	buckets := make([]acc, 96)
	for _, p := range points {
		i := int((int64(p[0]) - start.UnixMilli()) / (15 * 60 * 1000))
		if i >= 0 && i < 96 {
			buckets[i].sum += p[1]
			buckets[i].n++
		}
	}
	for i, b := range buckets {
		if b.n > 0 {
			out.Timeline[i] = math.Round(b.sum/float64(b.n)*100) / 100
		}
	}
	return out
}

func glancesComputeConsumers(snaps map[string]glancesSnap, span time.Duration, now time.Time) []glancesConsumer {
	since := now.Add(-span).UnixMilli()
	// What the record can vouch for: a range longer than it has been kept is
	// measured over the time it covers.
	observed := span
	if up, ok := snaps["up"]; ok {
		for _, source := range [][]glancesPoint{up.Long, up.Coarse, up.Fine} {
			if len(source) > 0 {
				if covered := now.Sub(time.UnixMilli(int64(source[0][0]))); covered < observed {
					observed = covered
				}
				break
			}
		}
	}
	if observed < 10*time.Minute {
		return []glancesConsumer{}
	}
	var out []glancesConsumer
	total := map[string]float64{}
	for name, snap := range snaps {
		kind, rest := "", ""
		switch {
		case strings.HasPrefix(name, "proc:"):
			kind, rest = "process", strings.TrimPrefix(name, "proc:")
		case strings.HasPrefix(name, "ct:"):
			kind, rest = "container", strings.TrimPrefix(name, "ct:")
		}
		if kind == "" || !strings.HasSuffix(rest, ":cpu") {
			continue
		}
		consumer := strings.TrimSuffix(rest, ":cpu")
		points, spacing := snap.window(since, 0, now)
		if len(points) == 0 {
			continue
		}
		var area, peak float64
		for _, p := range points {
			area += p[1] * spacing.Seconds()
			peak = math.Max(peak, p[1])
		}
		c := glancesConsumer{Name: consumer, Kind: kind, AvgCPU: round1(area / observed.Seconds()), MaxCPU: round1(peak)}
		if memSnap, ok := snaps[strings.TrimSuffix(name, ":cpu")+":mem"]; ok {
			mp, msp := memSnap.window(since, 0, now)
			var marea float64
			for _, p := range mp {
				marea += p[1] * msp.Seconds()
			}
			c.AvgMem = round1(marea / observed.Seconds())
		}
		total[kind] += c.AvgCPU
		out = append(out, c)
	}
	for i := range out {
		if t := total[out[i].Kind]; t > 0 {
			out[i].Share = round1(100 * out[i].AvgCPU / t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].AvgCPU > out[j].AvgCPU })
	trimmed := []glancesConsumer{}
	count := map[string]int{}
	for _, c := range out {
		if count[c.Kind] < 10 {
			trimmed = append(trimmed, c)
			count[c.Kind]++
		}
	}
	return trimmed
}

func glancesComputeTemperature(snaps map[string]glancesSnap, span time.Duration, now time.Time, t GlancesThresholds) *glancesTempStats {
	since := now.Add(-span).UnixMilli()
	hottest := map[int64]float64{}
	var spacing time.Duration
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "temp:") {
			continue
		}
		points, sp := snap.window(since, 0, now)
		spacing = sp
		for _, p := range points {
			if p[1] > hottest[int64(p[0])] {
				hottest[int64(p[0])] = p[1]
			}
		}
	}
	if len(hottest) < 4 {
		return nil
	}
	stats := &glancesTempStats{}
	var values []float64
	for _, v := range hottest {
		values = append(values, v)
		stats.Max = math.Max(stats.Max, v)
		if v >= t.TempWarn {
			stats.HoursWarn += spacing.Hours()
		}
		if v >= t.TempBad {
			stats.HoursBad += spacing.Hours()
		}
	}
	avg, _ := glancesMean(values)
	stats.Avg, stats.Max = round1(avg), round1(stats.Max)
	stats.HoursWarn, stats.HoursBad = round1(stats.HoursWarn), round1(stats.HoursBad)
	// How well the processor explains the heat: Pearson r over the last day.
	if cpu, ok := snaps["cpu"]; ok {
		points, _ := cpu.window(now.Add(-24*time.Hour).UnixMilli(), 0, now)
		var xs, ys []float64
		for _, p := range points {
			if h, ok := hottest[int64(p[0])]; ok {
				xs = append(xs, p[1])
				ys = append(ys, h)
			}
		}
		if r, ok := glancesPearson(xs, ys); ok {
			r = math.Round(r*100) / 100
			stats.Correlation = &r
		}
	}
	return stats
}

func glancesPearson(xs, ys []float64) (float64, bool) {
	n := float64(len(xs))
	if len(xs) < 24 {
		return 0, false
	}
	var sx, sy, sxx, syy, sxy float64
	for i := range xs {
		sx += xs[i]
		sy += ys[i]
		sxx += xs[i] * xs[i]
		syy += ys[i] * ys[i]
		sxy += xs[i] * ys[i]
	}
	den := math.Sqrt((n*sxx - sx*sx) * (n*syy - sy*sy))
	if den == 0 {
		return 0, false
	}
	return (n*sxy - sx*sy) / den, true
}
