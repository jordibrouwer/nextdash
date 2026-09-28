package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// healthHistoryView is one bookmark's history for the large health view in
// the Bookmarks view: the checks still kept individually (30 days at most),
// and one summary per day over the 90 days the summaries cover, the kept
// checks folded in, so a chart over 90 days is one series rather than two
// that meet somewhere in the middle.
type healthHistoryView struct {
	URL        string         `json:"url"`
	Samples    []HealthSample `json:"samples"`
	Days       []HealthDay    `json:"days"`
	SampleDays int            `json:"sampleDays"`
	DayDays    int            `json:"dayDays"`
}

// HealthHistoryView answers GET /api/health/history?url=… with that view.
// A URL without history answers empty rather than 404: nothing checked yet is
// a state the view shows, not an error.
func (h *Handlers) HealthHistoryView(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	key := canonicalBookmarkURLKey(raw)
	if key == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	h.healthHistoryMu.Lock()
	file := readHealthHistoryFile()
	h.healthHistoryMu.Unlock()

	samples := append([]HealthSample(nil), file.Samples[key]...)
	days := append([]HealthDay(nil), file.Days[key]...)
	// The same folding the history uses when it drops checks, run on copies:
	// nothing is written.
	days = foldSamplesIntoDays(days, samples)

	view := healthHistoryView{
		URL:        key,
		Samples:    samples,
		Days:       days,
		SampleDays: int(healthHistoryRetention.Hours() / 24),
		DayDays:    int(healthDayRetention.Hours() / 24),
	}
	if view.Samples == nil {
		view.Samples = []HealthSample{}
	}
	if view.Days == nil {
		view.Days = []HealthDay{}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(view)
}
