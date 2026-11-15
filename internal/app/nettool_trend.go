package app

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

// Trend of a network check's response time: the numbers behind the sparkline on
// a row and the chart in the Tests tab. Nothing new is stored. The raw samples
// ("net:<id>", the newest ~3 days) give the short ranges; what the sample cap
// dropped lives on in the daily summaries (HealthDay) and gives the long ones.

// netTrendSupported says whether a check type measures a response time in
// milliseconds. A TLS check measures days until expiry, which is not a trend of
// the same kind.
func netTrendSupported(typ string) bool {
	switch typ {
	case netTypeTCP, netTypePing, netTypeDNS, netTypeHTTP, netTypeJSON:
		return true
	}
	return false
}

// netTrendPoint is one stretch of time on the chart. T is its start and W its
// width (ms); A the mean response time of the successful checks in it and X the
// slowest; N the checks counted and F how many of them failed. A is 0 when no
// check in the stretch succeeded with a ping.
type netTrendPoint struct {
	T int64 `json:"t"`
	W int64 `json:"w"`
	A int   `json:"a,omitempty"`
	X int   `json:"x,omitempty"`
	N int   `json:"n"`
	F int   `json:"f,omitempty"`
}

type netTrendBin struct {
	sum, cnt, max, n, f int
}

func (b *netTrendBin) addSample(s HealthSample) {
	if s.Maint {
		return
	}
	b.n++
	if !s.Up {
		b.f++
		return
	}
	if s.PingMs > 0 {
		b.sum += s.PingMs
		b.cnt++
		if s.PingMs > b.max {
			b.max = s.PingMs
		}
	}
}

func (b *netTrendBin) addDay(d HealthDay) {
	b.n += d.N
	b.f += d.N - d.U
	weight := d.PN
	if weight == 0 {
		weight = d.U
	}
	if d.P > 0 && weight > 0 {
		b.sum += d.P * weight
		b.cnt += weight
		peak := d.X
		if peak < d.P {
			peak = d.P
		}
		if peak > b.max {
			b.max = peak
		}
	}
}

func (b netTrendBin) point(t, w int64) netTrendPoint {
	p := netTrendPoint{T: t, W: w, N: b.n, F: b.f}
	if b.cnt > 0 {
		p.A = b.sum / b.cnt
		p.X = b.max
	}
	return p
}

// netTrendRange is how a range is cut: its length and the width of a bucket of
// raw samples. A range over a week reads in whole days.
func netTrendRange(rng string) (window, bucket time.Duration, name string) {
	switch rng {
	case "7d":
		return 7 * 24 * time.Hour, 2 * time.Hour, "7d"
	case "30d":
		return 30 * 24 * time.Hour, 24 * time.Hour, "30d"
	}
	return 24 * time.Hour, 15 * time.Minute, "24h"
}

// netTrendPoints cuts one check's history into the points of a range, oldest
// first, empty stretches left out so a gap stays a gap. Maintenance samples are
// skipped as the daily summaries skip them. 24h and 7d use the raw samples and,
// for 7d, whole days from the summaries where the raw samples do not reach back.
// 30d is one point per day, raw samples and summaries merged.
func netTrendPoints(samples []HealthSample, days []HealthDay, rng string, now time.Time) []netTrendPoint {
	window, bucket, name := netTrendRange(rng)
	nowMs := now.UnixMilli()
	from := nowMs - window.Milliseconds()
	bucketMs := bucket.Milliseconds()
	dayMs := (24 * time.Hour).Milliseconds()

	if name == "30d" {
		bins := map[int64]*netTrendBin{}
		get := func(day int64) *netTrendBin {
			b := bins[day]
			if b == nil {
				b = &netTrendBin{}
				bins[day] = b
			}
			return b
		}
		for _, d := range days {
			if d.D+dayMs > from && d.D <= nowMs {
				get(d.D).addDay(d)
			}
		}
		for _, s := range samples {
			if s.T >= from && s.T <= nowMs {
				get(dayStartMs(s.T)).addSample(s)
			}
		}
		return netTrendSorted(bins, dayMs)
	}

	bins := map[int64]*netTrendBin{}
	firstRaw := nowMs
	for _, s := range samples {
		if s.T < from || s.T > nowMs {
			continue
		}
		if s.T < firstRaw {
			firstRaw = s.T
		}
		key := (s.T / bucketMs) * bucketMs
		b := bins[key]
		if b == nil {
			b = &netTrendBin{}
			bins[key] = b
		}
		b.addSample(s)
	}
	out := netTrendSorted(bins, bucketMs)
	if name != "7d" {
		return out
	}
	// Whole days older than the raw samples, from the summaries.
	older := []netTrendPoint{}
	rawDay := dayStartMs(firstRaw)
	for _, d := range days {
		if d.D+dayMs <= from || d.D >= rawDay || d.N == 0 {
			continue
		}
		var b netTrendBin
		b.addDay(d)
		older = append(older, b.point(d.D, dayMs))
	}
	return append(older, out...)
}

func netTrendSorted(bins map[int64]*netTrendBin, width int64) []netTrendPoint {
	keys := make([]int64, 0, len(bins))
	for k := range bins {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	out := make([]netTrendPoint, 0, len(keys))
	for _, k := range keys {
		if bins[k].n == 0 {
			continue
		}
		out = append(out, bins[k].point(k, width))
	}
	return out
}

// netSparkOf is netSpark for a check that is scheduled and has a response time.
func netSparkOf(c NetCheck, samples []HealthSample, now time.Time) []int {
	if !c.Enabled || !netTrendSupported(c.Type) {
		return nil
	}
	return netSpark(samples, now)
}

// netSparkSlices is how many equal slices of the last day a sparkline has.
const netSparkSlices = 24

// netSpark is the last 24 hours as netSparkSlices mean response times in ms,
// oldest first, for the sparkline beside a check. A slice with no check in it is
// 0 and one where every check failed is -1, so the line breaks there. Nil when
// the day holds no measurement at all, which keeps a quiet check out of the
// answer.
func netSpark(samples []HealthSample, now time.Time) []int {
	slice := (24 * time.Hour).Milliseconds() / netSparkSlices
	nowMs := now.UnixMilli()
	start := nowMs - 24*time.Hour.Milliseconds()
	bins := make([]netTrendBin, netSparkSlices)
	seen := false
	for _, s := range samples {
		if s.T < start || s.T > nowMs {
			continue
		}
		i := int((s.T - start) / slice)
		if i >= netSparkSlices {
			i = netSparkSlices - 1
		}
		bins[i].addSample(s)
		seen = true
	}
	if !seen {
		return nil
	}
	out := make([]int, netSparkSlices)
	measured := false
	for i, b := range bins {
		switch {
		case b.cnt > 0:
			out[i] = max(1, b.sum/b.cnt)
			measured = true
		case b.f > 0:
			out[i] = -1
		}
	}
	if !measured {
		return nil
	}
	return out
}

// GetNetTrend answers GET /api/net/trend?check=<id>&range=24h|7d|30d with the
// points of the range, the check's slow threshold and a few figures over the
// range. A check type without a response time answers supported:false.
func (h *Handlers) GetNetTrend(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("check"))
	_, _, chk, ok := findNetCheck(h.store, id)
	if !ok {
		netWriteError(w, http.StatusNotFound, "check not found")
		return
	}
	window, _, name := netTrendRange(r.URL.Query().Get("range"))
	now := time.Now()
	w.Header().Set("Cache-Control", "no-store")
	if !netTrendSupported(chk.Type) {
		writeJSON(w, map[string]any{"check": id, "range": name, "supported": false, "points": []netTrendPoint{}})
		return
	}
	key := netHistoryKey(id)
	h.healthHistoryMu.Lock()
	file := readHealthHistoryFile()
	h.healthHistoryMu.Unlock()
	samples := file.Samples[key]
	points := netTrendPoints(samples, file.Days[key], name, now)

	var sum, cnt, peak, n, fails int
	for _, p := range points {
		n += p.N
		fails += p.F
		if p.A > 0 {
			// Weighted by the checks that succeeded, an estimate good enough for a
			// headline figure over buckets of unequal size.
			c := max(1, p.N-p.F)
			sum += p.A * c
			cnt += c
			if p.X > peak {
				peak = p.X
			}
		}
	}
	avg := 0
	if cnt > 0 {
		avg = sum / cnt
	}
	covered := int64(0)
	if len(points) > 0 {
		covered = now.UnixMilli() - points[0].T
		if covered > window.Milliseconds() {
			covered = window.Milliseconds()
		}
	}
	writeJSON(w, map[string]any{
		"check": id, "range": name, "supported": true,
		"from": now.UnixMilli() - window.Milliseconds(), "to": now.UnixMilli(),
		"points": points, "maxMs": chk.MaxMs, "avg": avg, "peak": peak, "checks": n, "fails": fails,
		"coveredMs": covered,
	})
}
