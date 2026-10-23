package app

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
More insights, from readings the record already holds and the first set did not
use: how the disks are read and written, the load against the number of cores,
how evenly the cores share the work, where the memory goes, each network
interface and the containers behind the traffic, how this range compares with
the one before it, the spikes and the hours of the day that are busy.

As before, a figure with too little behind it is left out.
*/

type glancesDiskUsage struct {
	Name      string  `json:"name"`
	AvgRead   float64 `json:"avgRead"`
	AvgWrite  float64 `json:"avgWrite"`
	PeakRead  float64 `json:"peakRead"`
	PeakWrite float64 `json:"peakWrite"`
	BusyHour  int     `json:"busyHour"` // -1: not enough to say
}

type glancesLoadInfo struct {
	Cores     int     `json:"cores"`
	Avg1      float64 `json:"avg1"`
	Avg5      float64 `json:"avg5"`
	Avg15     float64 `json:"avg15"`
	Peak1     float64 `json:"peak1"`
	OverShare float64 `json:"overShare"` // percent of the time the one-minute load was above the cores
}

type glancesCoreInfo struct {
	Core int     `json:"core"`
	Avg  float64 `json:"avg"`
	Max  float64 `json:"max"`
}

type glancesMemBreakdown struct {
	Used      float64 `json:"used"`
	Cache     float64 `json:"cache"`
	Free      float64 `json:"free"`
	SwapAvg   float64 `json:"swapAvg"`
	SwapHours float64 `json:"swapHours"` // hours with more than 5% of the swap in use
}

type glancesIface struct {
	Name    string  `json:"name"`
	AvgRX   float64 `json:"avgRx"`
	AvgTX   float64 `json:"avgTx"`
	PeakRX  float64 `json:"peakRx"`
	PeakTX  float64 `json:"peakTx"`
	TotalRX float64 `json:"totalRx"`
	TotalTX float64 `json:"totalTx"`
}

type glancesTraffic struct {
	Name string  `json:"name"`
	RX   float64 `json:"rx"`
	TX   float64 `json:"tx"`
}

type glancesCompare struct {
	Key    string  `json:"key"`
	Now    float64 `json:"now"`
	Before float64 `json:"before"`
	Change float64 `json:"change"` // percent
}

type glancesSpike struct {
	At         int64   `json:"at"`
	Key        string  `json:"key"`
	Value      float64 `json:"value"`
	Typical    float64 `json:"typical"`
	Culprit    string  `json:"culprit,omitempty"`
	CulpritCPU float64 `json:"culpritCpu,omitempty"`
}

type glancesRhythm struct {
	Key       string  `json:"key"`
	BusyHour  int     `json:"busyHour"`
	BusyAvg   float64 `json:"busyAvg"`
	QuietHour int     `json:"quietHour"`
	QuietAvg  float64 `json:"quietAvg"`
}

// glancesMoreInsights holds the second set; it is embedded in the answer, so
// its fields sit next to the first set's in the JSON.
type glancesMoreInsights struct {
	Disks      []glancesDiskUsage   `json:"disks"`
	Load       *glancesLoadInfo     `json:"load,omitempty"`
	Cores      []glancesCoreInfo    `json:"cores"`
	MemBreak   *glancesMemBreakdown `json:"memBreakdown,omitempty"`
	Interfaces []glancesIface       `json:"interfaces"`
	Traffic    []glancesTraffic     `json:"traffic"`
	Compare    []glancesCompare     `json:"compare"`
	Spikes     []glancesSpike       `json:"spikes"`
	Rhythm     []glancesRhythm      `json:"rhythm"`
	Profile    []glancesProfile     `json:"profile"`
	Sensors    []glancesSensorStat  `json:"sensors"`

	Filesystems []glancesFsStat `json:"filesystems"`
}

// glancesProfile is a reading's average for each hour of the day (-1: none).
type glancesProfile struct {
	Key   string    `json:"key"`
	Hours []float64 `json:"hours"`
	Max   float64   `json:"max"`
}

type glancesSensorStat struct {
	Name      string  `json:"name"`
	Avg       float64 `json:"avg"`
	Max       float64 `json:"max"`
	HoursWarn float64 `json:"hoursWarn"`
	HoursBad  float64 `json:"hoursBad"`
}

type glancesFsStat struct {
	Mount  string  `json:"mount"`
	Now    float64 `json:"now"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Change float64 `json:"change"` // points over the range
}

func glancesComputeMore(snaps map[string]glancesSnap, span time.Duration, now time.Time, t GlancesThresholds) glancesMoreInsights {
	since := now.Add(-span).UnixMilli()
	out := glancesMoreInsights{}
	out.Disks = glancesComputeDisks(snaps, since, now)
	out.Load = glancesComputeLoad(snaps, since, now)
	out.Cores = glancesComputeCores(snaps, since, now)
	out.MemBreak = glancesComputeMemBreakdown(snaps, since, now)
	out.Interfaces = glancesComputeInterfaces(snaps, since, now)
	out.Traffic = glancesComputeTraffic(snaps, since, now)
	out.Compare = glancesComputeCompare(snaps, span, now)
	out.Spikes = glancesComputeSpikes(snaps, since, now)
	out.Rhythm = glancesComputeRhythm(snaps, since, now)
	out.Profile = glancesComputeProfile(snaps, since, now)
	out.Sensors = glancesComputeSensors(snaps, since, now, t)
	out.Filesystems = glancesComputeFilesystems(snaps, since, now)
	return out
}

// glancesSumWindow adds up the series with the prefix and suffix point by
// point between since and until (0: now).
func glancesSumWindow(snaps map[string]glancesSnap, prefix, suffix string, since, until int64, now time.Time) (map[int64]float64, time.Duration) {
	sum := map[int64]float64{}
	var spacing time.Duration
	for name, snap := range snaps {
		if !strings.HasPrefix(name, prefix) || !strings.HasSuffix(name, suffix) {
			continue
		}
		points, sp := snap.window(since, until, now)
		spacing = sp
		for _, p := range points {
			sum[int64(p[0])] += p[1]
		}
	}
	return sum, spacing
}

func glancesMapValues(m map[int64]float64) []float64 {
	out := make([]float64, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

func glancesMaxOf(values []float64) float64 {
	peak := 0.0
	for _, v := range values {
		peak = math.Max(peak, v)
	}
	return peak
}

// glancesHourBuckets averages a time series per hour of the day.
func glancesHourBuckets(series map[int64]float64, loc *time.Location) (avg [24]float64, count [24]int) {
	var sum [24]float64
	for ts, v := range series {
		h := time.UnixMilli(ts).In(loc).Hour()
		sum[h] += v
		count[h]++
	}
	for h := range avg {
		if count[h] > 0 {
			avg[h] = sum[h] / float64(count[h])
		}
	}
	return avg, count
}

// glancesBusiestHours is the busiest and the quietest hour of the day, when at
// least six hours have two or more readings behind them.
func glancesBusiestHours(series map[int64]float64, loc *time.Location) (busy, quiet int, busyAvg, quietAvg float64, ok bool) {
	avg, count := glancesHourBuckets(series, loc)
	busy, quiet = -1, -1
	seen := 0
	for h := 0; h < 24; h++ {
		if count[h] < 2 {
			continue
		}
		seen++
		if busy < 0 || avg[h] > avg[busy] {
			busy = h
		}
		if quiet < 0 || avg[h] < avg[quiet] {
			quiet = h
		}
	}
	if seen < 6 {
		return 0, 0, 0, 0, false
	}
	return busy, quiet, avg[busy], avg[quiet], true
}

func glancesDiskNames(snaps map[string]glancesSnap) []string {
	seen := map[string]bool{}
	var names []string
	for name := range snaps {
		if !strings.HasPrefix(name, "disk:") {
			continue
		}
		rest := strings.TrimPrefix(name, "disk:")
		i := strings.LastIndex(rest, ":")
		if i <= 0 {
			continue
		}
		disk := rest[:i]
		if !seen[disk] {
			seen[disk] = true
			names = append(names, disk)
		}
	}
	sort.Strings(names)
	return names
}

func glancesComputeDisks(snaps map[string]glancesSnap, since int64, now time.Time) []glancesDiskUsage {
	out := []glancesDiskUsage{}
	for _, disk := range glancesDiskNames(snaps) {
		d := glancesDiskUsage{Name: disk, BusyHour: -1}
		both := map[int64]float64{}
		for _, dir := range []string{"read", "write"} {
			snap, ok := snaps["disk:"+disk+":"+dir]
			if !ok {
				continue
			}
			points, _ := snap.window(since, 0, now)
			values := glancesValues(points)
			avg, _ := glancesMean(values)
			peak := glancesMaxOf(values)
			if dir == "read" {
				d.AvgRead, d.PeakRead = math.Round(avg), math.Round(peak)
			} else {
				d.AvgWrite, d.PeakWrite = math.Round(avg), math.Round(peak)
			}
			for _, p := range points {
				both[int64(p[0])] += p[1]
			}
		}
		if len(both) < 4 || d.AvgRead+d.AvgWrite+d.PeakRead+d.PeakWrite == 0 {
			continue
		}
		if busy, _, _, _, ok := glancesBusiestHours(both, now.Location()); ok {
			d.BusyHour = busy
		}
		out = append(out, d)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].AvgRead+out[i].AvgWrite > out[j].AvgRead+out[j].AvgWrite })
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func glancesCoreNumbers(snaps map[string]glancesSnap) []int {
	var numbers []int
	for name := range snaps {
		if !strings.HasPrefix(name, "core:") {
			continue
		}
		if n, err := strconv.Atoi(strings.TrimPrefix(name, "core:")); err == nil {
			numbers = append(numbers, n)
		}
	}
	sort.Ints(numbers)
	return numbers
}

func glancesComputeLoad(snaps map[string]glancesSnap, since int64, now time.Time) *glancesLoadInfo {
	one, ok := snaps["load1"]
	if !ok {
		return nil
	}
	points, _ := one.window(since, 0, now)
	if len(points) < 4 {
		return nil
	}
	info := &glancesLoadInfo{Cores: len(glancesCoreNumbers(snaps))}
	values := glancesValues(points)
	avg1, _ := glancesMean(values)
	info.Avg1, info.Peak1 = math.Round(avg1*100)/100, math.Round(glancesMaxOf(values)*100)/100
	for key, target := range map[string]*float64{"load5": &info.Avg5, "load15": &info.Avg15} {
		if snap, ok := snaps[key]; ok {
			p, _ := snap.window(since, 0, now)
			if m, ok := glancesMean(glancesValues(p)); ok {
				*target = math.Round(m*100) / 100
			}
		}
	}
	if info.Cores > 0 {
		over := 0
		for _, v := range values {
			if v > float64(info.Cores) {
				over++
			}
		}
		info.OverShare = round1(100 * float64(over) / float64(len(values)))
	}
	return info
}

func glancesComputeCores(snaps map[string]glancesSnap, since int64, now time.Time) []glancesCoreInfo {
	out := []glancesCoreInfo{}
	for _, n := range glancesCoreNumbers(snaps) {
		points, _ := snaps["core:"+strconv.Itoa(n)].window(since, 0, now)
		if len(points) < 4 {
			continue
		}
		values := glancesValues(points)
		avg, _ := glancesMean(values)
		out = append(out, glancesCoreInfo{Core: n, Avg: round1(avg), Max: round1(glancesMaxOf(values))})
	}
	if len(out) < 2 {
		return []glancesCoreInfo{}
	}
	return out
}

func glancesComputeMemBreakdown(snaps map[string]glancesSnap, since int64, now time.Time) *glancesMemBreakdown {
	info := &glancesMemBreakdown{}
	found := false
	for key, target := range map[string]*float64{"memc:used": &info.Used, "memc:cache": &info.Cache, "memc:free": &info.Free} {
		snap, ok := snaps[key]
		if !ok {
			continue
		}
		points, _ := snap.window(since, 0, now)
		if len(points) < 4 {
			continue
		}
		m, _ := glancesMean(glancesValues(points))
		*target = round1(m)
		found = true
	}
	if !found {
		return nil
	}
	if swap, ok := snaps["swap"]; ok {
		points, spacing := swap.window(since, 0, now)
		if m, ok := glancesMean(glancesValues(points)); ok {
			info.SwapAvg = round1(m)
		}
		for _, p := range points {
			if p[1] > 5 {
				info.SwapHours += spacing.Hours()
			}
		}
		info.SwapHours = round1(info.SwapHours)
	}
	return info
}

func glancesComputeInterfaces(snaps map[string]glancesSnap, since int64, now time.Time) []glancesIface {
	byName := map[string]*glancesIface{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "net:") {
			continue
		}
		rest := strings.TrimPrefix(name, "net:")
		i := strings.LastIndex(rest, ":")
		if i <= 0 {
			continue
		}
		iface, dir := rest[:i], rest[i+1:]
		if dir != "rx" && dir != "tx" {
			continue
		}
		points, spacing := snap.window(since, 0, now)
		if len(points) == 0 {
			continue
		}
		values := glancesValues(points)
		avg, _ := glancesMean(values)
		peak := glancesMaxOf(values)
		total := 0.0
		for _, v := range values {
			total += v * spacing.Seconds()
		}
		n := byName[iface]
		if n == nil {
			n = &glancesIface{Name: iface}
			byName[iface] = n
		}
		if dir == "rx" {
			n.AvgRX, n.PeakRX, n.TotalRX = math.Round(avg), math.Round(peak), math.Round(total)
		} else {
			n.AvgTX, n.PeakTX, n.TotalTX = math.Round(avg), math.Round(peak), math.Round(total)
		}
	}
	out := []glancesIface{}
	for _, n := range byName {
		if n.TotalRX+n.TotalTX > 0 {
			out = append(out, *n)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].TotalRX+out[i].TotalTX, out[j].TotalRX+out[j].TotalTX
		if a != b {
			return a > b
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func glancesComputeTraffic(snaps map[string]glancesSnap, since int64, now time.Time) []glancesTraffic {
	byName := map[string]*glancesTraffic{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "ct:") {
			continue
		}
		rest := strings.TrimPrefix(name, "ct:")
		i := strings.LastIndex(rest, ":")
		if i <= 0 {
			continue
		}
		ct, dir := rest[:i], rest[i+1:]
		if dir != "rx" && dir != "tx" {
			continue
		}
		points, spacing := snap.window(since, 0, now)
		total := 0.0
		for _, p := range points {
			total += p[1] * spacing.Seconds()
		}
		t := byName[ct]
		if t == nil {
			t = &glancesTraffic{Name: ct}
			byName[ct] = t
		}
		if dir == "rx" {
			t.RX = math.Round(total)
		} else {
			t.TX = math.Round(total)
		}
	}
	out := []glancesTraffic{}
	for _, t := range byName {
		if t.RX+t.TX > 0 {
			out = append(out, *t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i].RX+out[i].TX, out[j].RX+out[j].TX
		if a != b {
			return a > b
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

// glancesComputeCompare sets the range against the one just before it. A
// reading is left out when the record does not reach back over both.
func glancesComputeCompare(snaps map[string]glancesSnap, span time.Duration, now time.Time) []glancesCompare {
	out := []glancesCompare{}
	cur := now.Add(-span).UnixMilli()
	prev := now.Add(-2 * span).UnixMilli()
	covered := func(series map[int64]float64) bool {
		if len(series) < 12 {
			return false
		}
		first := int64(math.MaxInt64)
		for ts := range series {
			if ts < first {
				first = ts
			}
		}
		return first <= prev+span.Milliseconds()/5
	}
	add := func(key string, now1, then map[int64]float64, floor float64) {
		if len(now1) < 4 || !covered(then) {
			return
		}
		a, _ := glancesMean(glancesMapValues(now1))
		b, _ := glancesMean(glancesMapValues(then))
		out = append(out, glancesCompare{Key: key, Now: round1(a), Before: round1(b), Change: round1(100 * (a - b) / math.Max(b, floor))})
	}
	for _, key := range []string{"cpu", "mem"} {
		if _, ok := snaps[key]; !ok {
			continue
		}
		add(key, glancesExactSeries(snaps[key], cur, 0, now), glancesExactSeries(snaps[key], prev, cur-1, now), 1)
	}
	netNow, _ := glancesSumWindow(snaps, "net:", "", cur, 0, now)
	netThen, _ := glancesSumWindow(snaps, "net:", "", prev, cur-1, now)
	add("net", netNow, netThen, 1024)
	diskNow, _ := glancesSumWindow(snaps, "disk:", "", cur, 0, now)
	diskThen, _ := glancesSumWindow(snaps, "disk:", "", prev, cur-1, now)
	add("disk", diskNow, diskThen, 1024)
	hotNow, hotThen := map[int64]float64{}, map[int64]float64{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "temp:") {
			continue
		}
		for _, p := range glancesExactPoints(snap, cur, 0, now) {
			hotNow[int64(p[0])] = math.Max(hotNow[int64(p[0])], p[1])
		}
		for _, p := range glancesExactPoints(snap, prev, cur-1, now) {
			hotThen[int64(p[0])] = math.Max(hotThen[int64(p[0])], p[1])
		}
	}
	add("temp", hotNow, hotThen, 1)
	return out
}

func glancesExactPoints(snap glancesSnap, since, until int64, now time.Time) []glancesPoint {
	points, _ := snap.window(since, until, now)
	return points
}

func glancesExactSeries(snap glancesSnap, since, until int64, now time.Time) map[int64]float64 {
	out := map[int64]float64{}
	for _, p := range glancesExactPoints(snap, since, until, now) {
		out[int64(p[0])] = p[1]
	}
	return out
}

// glancesComputeSpikes finds readings far above what is usual for the range
// (three standard deviations over the mean and half as much again), joins the
// ones that follow each other within half an hour and names the process or
// container that used the most processor at that moment.
func glancesComputeSpikes(snaps map[string]glancesSnap, since int64, now time.Time) []glancesSpike {
	out := []glancesSpike{}
	series := map[string]map[int64]float64{}
	if snap, ok := snaps["cpu"]; ok {
		series["cpu"] = glancesExactSeries(snap, since, 0, now)
	}
	if snap, ok := snaps["mem"]; ok {
		series["mem"] = glancesExactSeries(snap, since, 0, now)
	}
	if net, _ := glancesSumWindow(snaps, "net:", "", since, 0, now); len(net) > 0 {
		series["net"] = net
	}
	type found struct {
		spike glancesSpike
		z     float64
	}
	var all []found
	for _, key := range []string{"cpu", "mem", "net"} {
		s := series[key]
		if len(s) < 24 {
			continue
		}
		values := glancesMapValues(s)
		mean, _ := glancesMean(values)
		variance := 0.0
		for _, v := range values {
			variance += (v - mean) * (v - mean)
		}
		sd := math.Sqrt(variance / float64(len(values)))
		if sd == 0 {
			continue
		}
		var times []int64
		for ts, v := range s {
			if v > mean+3*sd && v > mean*1.5 {
				times = append(times, ts)
			}
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		var best *found
		flush := func() {
			if best != nil {
				all = append(all, *best)
				best = nil
			}
		}
		var last int64
		for _, ts := range times {
			if best != nil && ts-last > 30*60*1000 {
				flush()
			}
			last = ts
			v := s[ts]
			if best == nil || v > best.spike.Value {
				best = &found{spike: glancesSpike{At: ts, Key: key, Value: v, Typical: mean}, z: (v - mean) / sd}
			}
		}
		flush()
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].z > all[j].z })
	if len(all) > 6 {
		all = all[:6]
	}
	for _, f := range all {
		s := f.spike
		if s.Key == "cpu" {
			s.Culprit, s.CulpritCPU = glancesCulpritAt(snaps, s.At, now)
		}
		if s.Key == "net" {
			s.Value, s.Typical = math.Round(s.Value), math.Round(s.Typical)
		} else {
			s.Value, s.Typical = round1(s.Value), round1(s.Typical)
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}

// glancesCulpritAt is the recorded process or container that used the most
// processor around a moment, with how much it used.
func glancesCulpritAt(snaps map[string]glancesSnap, at int64, now time.Time) (string, float64) {
	best, name := 0.0, ""
	around := (glancesSampleEvery * glancesCoarseEvery).Milliseconds()
	for key, snap := range snaps {
		if !(strings.HasPrefix(key, "proc:") || strings.HasPrefix(key, "ct:")) || !strings.HasSuffix(key, ":cpu") {
			continue
		}
		points, _ := snap.window(at-around, at+around, now)
		for _, p := range points {
			if p[1] > best {
				best = p[1]
				name = strings.TrimSuffix(key[strings.Index(key, ":")+1:], ":cpu")
			}
		}
	}
	return name, round1(best)
}

func glancesComputeRhythm(snaps map[string]glancesSnap, since int64, now time.Time) []glancesRhythm {
	out := []glancesRhythm{}
	loc := now.Location()
	add := func(key string, series map[int64]float64) {
		if busy, quiet, busyAvg, quietAvg, ok := glancesBusiestHours(series, loc); ok && busy != quiet {
			out = append(out, glancesRhythm{Key: key, BusyHour: busy, BusyAvg: round1(busyAvg), QuietHour: quiet, QuietAvg: round1(quietAvg)})
		}
	}
	if snap, ok := snaps["cpu"]; ok {
		add("cpu", glancesExactSeries(snap, since, 0, now))
	}
	net, _ := glancesSumWindow(snaps, "net:", "", since, 0, now)
	add("net", net)
	return out
}

// glancesComputeProfile is what a typical day looks like: each reading's
// average per hour of the day over the range.
func glancesComputeProfile(snaps map[string]glancesSnap, since int64, now time.Time) []glancesProfile {
	out := []glancesProfile{}
	loc := now.Location()
	add := func(key string, series map[int64]float64) {
		avg, count := glancesHourBuckets(series, loc)
		seen := 0
		p := glancesProfile{Key: key, Hours: make([]float64, 24)}
		for h := 0; h < 24; h++ {
			if count[h] < 2 {
				p.Hours[h] = -1
				continue
			}
			seen++
			p.Hours[h] = round1(avg[h])
			p.Max = math.Max(p.Max, p.Hours[h])
		}
		if seen >= 6 {
			out = append(out, p)
		}
	}
	for _, key := range []string{"cpu", "mem"} {
		if snap, ok := snaps[key]; ok {
			add(key, glancesExactSeries(snap, since, 0, now))
		}
	}
	net, _ := glancesSumWindow(snaps, "net:", "", since, 0, now)
	add("net", net)
	disk, _ := glancesSumWindow(snaps, "disk:", "", since, 0, now)
	add("disk", disk)
	hottest := map[int64]float64{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "temp:") {
			continue
		}
		for _, p := range glancesExactPoints(snap, since, 0, now) {
			hottest[int64(p[0])] = math.Max(hottest[int64(p[0])], p[1])
		}
	}
	add("temp", hottest)
	return out
}

func glancesComputeSensors(snaps map[string]glancesSnap, since int64, now time.Time, t GlancesThresholds) []glancesSensorStat {
	out := []glancesSensorStat{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "temp:") {
			continue
		}
		points, spacing := snap.window(since, 0, now)
		if len(points) < 4 {
			continue
		}
		s := glancesSensorStat{Name: strings.TrimPrefix(name, "temp:")}
		values := glancesValues(points)
		avg, _ := glancesMean(values)
		s.Avg, s.Max = round1(avg), round1(glancesMaxOf(values))
		for _, v := range values {
			if v >= t.TempWarn {
				s.HoursWarn += spacing.Hours()
			}
			if v >= t.TempBad {
				s.HoursBad += spacing.Hours()
			}
		}
		s.HoursWarn, s.HoursBad = round1(s.HoursWarn), round1(s.HoursBad)
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Max != out[j].Max {
			return out[i].Max > out[j].Max
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

func glancesComputeFilesystems(snaps map[string]glancesSnap, since int64, now time.Time) []glancesFsStat {
	out := []glancesFsStat{}
	for name, snap := range snaps {
		if !strings.HasPrefix(name, "fs:") {
			continue
		}
		points, _ := snap.window(since, 0, now)
		if len(points) < 4 {
			continue
		}
		values := glancesValues(points)
		lo := values[0]
		for _, v := range values {
			lo = math.Min(lo, v)
		}
		last := values[len(values)-1]
		out = append(out, glancesFsStat{Mount: strings.TrimPrefix(name, "fs:"), Now: round1(last), Min: round1(lo), Max: round1(glancesMaxOf(values)), Change: round1(last - values[0])})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Now != out[j].Now {
			return out[i].Now > out[j].Now
		}
		return out[i].Mount < out[j].Mount
	})
	return out
}
