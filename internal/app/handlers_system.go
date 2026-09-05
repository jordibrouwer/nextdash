package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

/*
SystemMetricsHandler serves host metrics for the system widgets.

Read-only and not token-gated, like the other figures the dashboard has to draw
without being signed in. It exposes nothing the reader did not opt into: a
percentage and a load average, and only when the host was mounted for it.
*/
func (h *Handlers) SystemMetricsHandler(w http.ResponseWriter, r *http.Request) {
	want := []string{}
	for _, raw := range strings.Split(r.URL.Query().Get("want"), ",") {
		if name := strings.TrimSpace(raw); name != "" {
			want = append(want, name)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	// A cached metric is a wrong metric. The server-side floor already stops
	// this becoming one read per request.
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(systemCache.Get(want)); err != nil {
		http.Error(w, "could not encode metrics", http.StatusInternalServerError)
	}
}
