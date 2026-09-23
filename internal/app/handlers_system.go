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

/*
systemMetricsMaxMounts is how many disks one request may ask about.

Far above what a machine has -- Unraid's /mnt/user, /mnt/cache and a disk per
slot come nowhere near it -- and far below the number at which a single request
becomes a denial of service against the one lock every metrics reader waits on.
Anything past it is dropped rather than refused: a tile with a long list still
gets an answer about the disks at the front of it.
*/
/*
configuredDiskMounts keeps only the paths some disks widget on this install
names, in the order they were asked for.

An unconfigured path is dropped rather than reported as refused: a caller
probing for one gets the same answer whether or not it exists, which is the
whole point.
*/
func (h *Handlers) configuredDiskMounts(asked []string) []string {
	if len(asked) == 0 || h.store == nil {
		// No store is not a shape this reaches in production -- NewHandlers
		// always sets one -- but nothing configured is the safe answer for a
		// route anyone can call, and a nil dereference is not.
		return nil
	}

	configured := map[string]bool{}
	for _, page := range h.store.GetPages() {
		widgets, _ := h.store.GetPageBlocks(page.ID)
		for _, widget := range widgets {
			if widget.Type != WidgetTypeDisks {
				continue
			}
			for _, path := range widgetConfigList(widget.Config["mounts"], nil) {
				configured[path] = true
			}
		}
	}

	kept := make([]string, 0, len(asked))
	seen := map[string]bool{}
	for _, path := range asked {
		if !configured[path] || seen[path] {
			continue
		}
		seen[path] = true
		kept = append(kept, path)
	}
	return kept
}

const systemMetricsMaxMounts = 32

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
	//
	// Both lists stop at systemMetricsMaxMounts. Every mount is a statfs call
	// made while the cache holds its lock, so a long list stalls every other
	// caller -- and this route has no token in front of it.
	mounts := []string{}
	for _, raw := range strings.Split(r.URL.Query().Get("mounts"), ",") {
		if path := strings.TrimSpace(raw); path != "" {
			mounts = append(mounts, path)
		}
		if len(mounts) == systemMetricsMaxMounts {
			break
		}
	}
	labels := map[string]string{}
	for _, pair := range strings.Split(r.URL.Query().Get("labels"), ",") {
		if at := strings.Index(pair, "="); at > 0 {
			labels[strings.TrimSpace(pair[:at])] = strings.TrimSpace(pair[at+1:])
		}
		if len(labels) == systemMetricsMaxMounts {
			break
		}
	}
	/*
	 * The query says which of the configured disks to answer for. It does not
	 * say which paths to go and stat.
	 *
	 * resolveHostPath only confines a path when NEXTDASH_HOST_ROOT is set, so
	 * on a bare-metal install what arrived here reached syscall.Statfs
	 * unchanged -- and this route deliberately carries no token, because the
	 * widgets have to draw without one. Between them that made
	 * ?want=disks&mounts=<path> an existence oracle: "unreadable" for a path
	 * that is not there, real byte counts for one that is, for anyone who could
	 * reach the endpoint.
	 *
	 * Reading the answer out of the install's own widgets is the same move
	 * the calendar and RSS widgets already make with their addresses. It costs
	 * a real widget nothing: a disk it draws is a disk it has configured.
	 */
	mounts = h.configuredDiskMounts(mounts)

	w.Header().Set("Content-Type", "application/json")
	// A cached metric is a wrong metric. The server-side floor already stops
	// this becoming one read per request.
	w.Header().Set("Cache-Control", "no-store")
	if err := json.NewEncoder(w).Encode(systemCache.Get(want, mounts, labels)); err != nil {
		http.Error(w, "could not encode metrics", http.StatusInternalServerError)
	}
}
