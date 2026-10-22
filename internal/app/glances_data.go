package app

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// What nextDash has recorded about the host: read as insights and as CSV,
// reported to Config, and wiped on request.

const (
	glancesInsightsTTL = 30 * time.Second
	// glancesInsightsKeep is how many answers (range, heatmap metric, time zone) are kept.
	glancesInsightsKeep = 24
)

type glancesInsightsEntry struct {
	at   time.Time
	body []byte
}

var glancesInsightsCache = struct {
	sync.Mutex
	entries map[string]glancesInsightsEntry
}{entries: map[string]glancesInsightsEntry{}}

func glancesInsightsHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	// What is asked is reduced to what exists first, so a made-up value neither
	// makes a new cache entry nor a new computation.
	rangeID := q.Get("range")
	if _, ok := glancesRanges[rangeID]; !ok {
		rangeID = "24h"
	}
	heat := q.Get("heat")
	if heat != "net" && heat != "temp" {
		heat = "cpu"
	}
	loc, err := time.LoadLocation(q.Get("tz"))
	if err != nil || q.Get("tz") == "" {
		loc = time.UTC
	}
	cfg, _ := glancesResolve(r)
	key := cfg.ID + "|" + rangeID + "|" + heat + "|" + loc.String()
	w.Header().Set("Content-Type", "application/json")
	glancesInsightsCache.Lock()
	if e, ok := glancesInsightsCache.entries[key]; ok && time.Since(e.at) < glancesInsightsTTL {
		glancesInsightsCache.Unlock()
		_, _ = w.Write(e.body)
		return
	}
	glancesInsightsCache.Unlock()
	body, err := json.Marshal(glancesComputeInsights(cfg, rangeID, heat, loc, time.Now()))
	if err != nil {
		http.Error(w, "Could not compute", http.StatusInternalServerError)
		return
	}
	glancesInsightsCache.Lock()
	if len(glancesInsightsCache.entries) >= glancesInsightsKeep {
		glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	}
	glancesInsightsCache.entries[key] = glancesInsightsEntry{at: time.Now(), body: body}
	glancesInsightsCache.Unlock()
	_, _ = w.Write(body)
}

// glancesHistoryCSV is the recorded series of a range, one row per moment.
func glancesHistoryCSV(w http.ResponseWriter, r *http.Request) {
	_, hs := glancesResolve(r)
	q := r.URL.Query()
	now := time.Now()
	since := now.Add(-24 * time.Hour).UnixMilli()
	if v, err := strconv.ParseInt(q.Get("since"), 10, 64); err == nil {
		since = max(v, now.Add(-hs.retentionSpan()).UnixMilli())
	}
	var names []string
	for _, name := range strings.Split(q.Get("series"), ",") {
		if name = strings.TrimSpace(name); name != "" && len(names) < glancesMaxSeries+glancesMaxConsumers {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		names = hs.seriesNames()
	}
	span := time.Duration(now.UnixMilli()-since) * time.Millisecond
	step := max(glancesSampleEvery, span/glancesMaxPoints)
	series := hs.query(names, since, step, now)
	sort.Strings(names)
	byTime := map[int64]map[string]float64{}
	for name, points := range series {
		for _, p := range points {
			ts := int64(p[0])
			if byTime[ts] == nil {
				byTime[ts] = map[string]float64{}
			}
			byTime[ts][name] = p[1]
		}
	}
	times := make([]int64, 0, len(byTime))
	for ts := range byTime {
		times = append(times, ts)
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="glances-history.csv"`)
	out := csv.NewWriter(w)
	header := append([]string{"time"}, names...)
	_ = out.Write(header)
	for _, ts := range times {
		row := []string{time.UnixMilli(ts).UTC().Format(time.RFC3339)}
		for _, name := range names {
			if v, ok := byTime[ts][name]; ok {
				row = append(row, strconv.FormatFloat(v, 'f', -1, 64))
			} else {
				row = append(row, "")
			}
		}
		_ = out.Write(row)
	}
	out.Flush()
}

type glancesCollectedAnswer struct {
	Series    int   `json:"series"`
	Points    int   `json:"points"`
	Since     int64 `json:"since,omitempty"`
	Incidents int   `json:"incidents"`
	KeepDays  int   `json:"keepDays"`
}

func (hs *glancesHost) collectedView() glancesCollectedAnswer {
	series, points, since := hs.collected()
	hs.incidents.Lock()
	incidents := len(hs.incidents.log)
	hs.incidents.Unlock()
	return glancesCollectedAnswer{Series: series, Points: points, Since: since, Incidents: incidents, KeepDays: hs.retentionDays()}
}

// glancesWipeHandler forgets everything recorded. Behind the write token.
func (h *Handlers) glancesWipeHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	cfg, hs, ok := glancesResolveStrict(w, r)
	if !ok {
		return
	}
	hs.wipe()
	glancesInsightsCache.Lock()
	glancesInsightsCache.entries = map[string]glancesInsightsEntry{}
	glancesInsightsCache.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(glancesHostByID(cfg.ID).collectedView())
}
