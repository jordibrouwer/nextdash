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
/*
SystemMountsHandler lists the disks this machine has, for the settings panel.

Typing a mountpoint blind is the weak point of naming disks by hand: a typo
produces a tile that says "unreadable" without saying why. Paths come back as
the machine knows them, never as the container sees them.
*/
func (h *Handlers) SystemMountsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(map[string]any{
		"mounts": listMountCandidates(),
	}); err != nil {
		http.Error(w, "could not encode mounts", http.StatusInternalServerError)
	}
}

func (h *Handlers) SystemMetricsHandler(w http.ResponseWriter, r *http.Request) {
	want := []string{}
	for _, raw := range strings.Split(r.URL.Query().Get("want"), ",") {
		if name := strings.TrimSpace(raw); name != "" {
			want = append(want, name)
		}
	}

	// Which disks this tile watches, and what the reader calls them. Sent as
	// path=name so a renamed disk costs no second request and the server never
	// has to know what a label means.
	mounts := []string{}
	for _, raw := range strings.Split(r.URL.Query().Get("mounts"), ",") {
		if path := strings.TrimSpace(raw); path != "" {
			mounts = append(mounts, path)
		}
	}
	labels := map[string]string{}
	for _, pair := range strings.Split(r.URL.Query().Get("labels"), ",") {
		if at := strings.Index(pair, "="); at > 0 {
			labels[strings.TrimSpace(pair[:at])] = strings.TrimSpace(pair[at+1:])
		}
	}

	w.Header().Set("Content-Type", "application/json")
	// A cached metric is a wrong metric. The server-side floor already stops
	// this becoming one read per request.
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(systemCache.Get(want, mounts, labels)); err != nil {
		http.Error(w, "could not encode metrics", http.StatusInternalServerError)
	}
}
