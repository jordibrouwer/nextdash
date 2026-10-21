package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

/*
The Glances page: one machine in full, read through one route.

Every path goes through /api/glances/<path>, and the server and login are the
ones in Config → Glances: the browser can never name an address. The paths are
an allowlist, never a passthrough. Glances is read only, but not quite: POST
/events/clear/all is one of its paths, and /all carries every command line on
the machine. Only the plugins the page draws are reachable, only by GET, and
nothing of the request but the path is forwarded.

Answers are shared and short-lived (three quarters of the refresh, so every
poll of an open page gets a fresh one), so a second tab and the history sampler
do not each ask Glances; readers that arrive while a path is being asked wait
for that one answer. The plugin list decides which sections exist and hardly
changes, so it lives five minutes.

Two answers are reshaped before the browser sees them. The filesystem list is
cleaned (Glances in a container sees the host under /rootfs, and lists docker's
own storage, squashfs and tmpfs mounts); the disk I/O list loses loop and RAM
devices. Process lists can carry secrets in their arguments: the server sorts,
searches and cuts the list, strips every command line, and hands one out only
when the reader asks for that one process, and only to a reader with the write
token (as the docker logs are).
*/

const (
	// glancesViewMinTTL is the shortest an answer lives.
	glancesViewMinTTL = 500 * time.Millisecond
	// glancesPluginsTTL is how long the plugin list lives.
	glancesPluginsTTL = 5 * time.Minute
	// glancesProcessLimit is how many processes the browser gets.
	glancesProcessLimit = 200
	// glancesViewSweepAt is the size above which expired answers are dropped.
	glancesViewSweepAt = 256
)

// glancesViewPaths are the plugin paths the page may read, exactly.
var glancesViewPaths = map[string]bool{
	"quicklook": true, "cpu": true, "mem": true, "memswap": true, "load": true,
	"fs": true, "diskio": true, "network": true, "connections": true, "wifi": true,
	"sensors": true, "system": true, "uptime": true, "processlist": true,
	"processcount": true, "containers": true, "alert": true, "smart": true,
	"raid": true, "pluginslist": true, "all/limits": true,
}

var glancesProcessRe = regexp.MustCompile(`^processes/([1-9][0-9]{0,9})$`)

// glancesViewAllowed says whether a path may be read. Exact matches only: no
// prefix, no cleaning, so "..", empty segments and case games all fall out.
func glancesViewAllowed(path string) bool {
	return glancesViewPaths[path] || glancesProcessRe.MatchString(path)
}

// glancesViewTTL is how long one path's answer lives.
func glancesViewTTL(path string, cfg GlancesConfig) time.Duration {
	if path == "pluginslist" {
		return glancesPluginsTTL
	}
	return max(glancesViewMinTTL, time.Duration(cfg.Refresh)*time.Second*3/4)
}

// ---- the shared answers ----

type glancesViewEntry struct {
	// done is closed when the answer is in; until then readers wait on it.
	done    chan struct{}
	data    []byte
	err     error
	expires time.Time
}

var glancesViewCache = struct {
	sync.Mutex
	at map[string]*glancesViewEntry
}{at: map[string]*glancesViewEntry{}}

// glancesViewForgetAll empties the view's answers; tests use it between cases.
func glancesViewForgetAll() {
	glancesViewCache.Lock()
	glancesViewCache.at = map[string]*glancesViewEntry{}
	glancesViewCache.Unlock()
}

/*
glancesCached answers one key from the cache, or asks once.

Readers that arrive while the key is being asked wait for that answer rather
than asking again. A plugin that is off (errGlancesNotFound) is an answer and
is kept like one; any other failure is shared with the readers that waited
for it but not kept, so the next read tries again.
*/
func glancesCached(key string, ttl time.Duration, fetch func() ([]byte, error)) ([]byte, error) {
	glancesViewCache.Lock()
	if entry := glancesViewCache.at[key]; entry != nil {
		select {
		case <-entry.done:
			if time.Now().Before(entry.expires) {
				glancesViewCache.Unlock()
				return entry.data, entry.err
			}
		default:
			glancesViewCache.Unlock()
			<-entry.done
			return entry.data, entry.err
		}
	}
	entry := &glancesViewEntry{done: make(chan struct{})}
	glancesViewCache.at[key] = entry
	if len(glancesViewCache.at) > glancesViewSweepAt {
		now := time.Now()
		for k, e := range glancesViewCache.at {
			select {
			case <-e.done:
				if !now.Before(e.expires) {
					delete(glancesViewCache.at, k)
				}
			default:
			}
		}
	}
	glancesViewCache.Unlock()

	// Whatever fetch does, the answer is stored and the waiters released: a
	// panic is a failure that is not kept, never a key that hangs for good.
	var data []byte
	var err error
	func() {
		defer func() {
			if p := recover(); p != nil {
				data, err = nil, fmt.Errorf("glances view: panic: %v", p)
				logWarn(logComponentWidgets, "Glances view %s", err)
			}
			glancesViewCache.Lock()
			entry.data, entry.err = data, err
			if err == nil || errors.Is(err, errGlancesNotFound) {
				entry.expires = time.Now().Add(ttl)
			}
			glancesViewCache.Unlock()
			close(entry.done)
		}()
		data, err = fetch()
	}()
	return data, err
}

// ---- processes ----

/*
glancesProcesses sorts, searches and cuts a process list for the browser.

Sort is cpu, mem (both highest first), name or pid (lowest first); anything
else is cpu. The search is a case-insensitive part of the name. Every row
that is kept loses its command line, and its memory_info keeps rss and vms
only. The rows handed in are not changed.
*/
func glancesProcesses(raw []map[string]any, sortBy, query string, limit int) []map[string]any {
	number := func(row map[string]any, key string) float64 {
		v, _ := row[key].(float64)
		return v
	}
	name := func(row map[string]any) string {
		s, _ := row["name"].(string)
		return strings.ToLower(s)
	}
	query = strings.ToLower(strings.TrimSpace(query))
	rows := make([]map[string]any, 0, len(raw))
	for _, row := range raw {
		if query == "" || strings.Contains(name(row), query) {
			rows = append(rows, row)
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		switch sortBy {
		case "pid":
			return number(a, "pid") < number(b, "pid")
		case "name":
			if name(a) != name(b) {
				return name(a) < name(b)
			}
		case "mem":
			if number(a, "memory_percent") != number(b, "memory_percent") {
				return number(a, "memory_percent") > number(b, "memory_percent")
			}
		default:
			if number(a, "cpu_percent") != number(b, "cpu_percent") {
				return number(a, "cpu_percent") > number(b, "cpu_percent")
			}
		}
		return number(a, "pid") < number(b, "pid")
	})
	if limit >= 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	out := make([]map[string]any, len(rows))
	for i, row := range rows {
		kept := make(map[string]any, len(row))
		for k, v := range row {
			kept[k] = v
		}
		delete(kept, "cmdline")
		if info, ok := row["memory_info"].(map[string]any); ok {
			kept["memory_info"] = map[string]any{"rss": info["rss"], "vms": info["vms"]}
		}
		out[i] = kept
	}
	return out
}

// ---- the cleaned answers ----

// glancesPseudoFS are filesystem types that are not storage anyone chose.
var glancesPseudoFS = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "overlay": true, "squashfs": true,
	"proc": true, "sysfs": true, "ramfs": true, "cgroup": true, "cgroup2": true,
	"nsfs": true, "devpts": true, "securityfs": true, "debugfs": true,
	"tracefs": true, "fusectl": true, "configfs": true, "pstore": true,
	"bpf": true, "autofs": true, "mqueue": true, "hugetlbfs": true,
}

// glancesPseudoMounts are mount points under which nothing is the reader's own.
var glancesPseudoMounts = []string{"/snap", "/run", "/sys", "/proc", "/dev"}

// glancesRuntimeStores are parts of a mount point that name a container
// runtime's own storage, which is a copy of the disk it sits on.
var glancesRuntimeStores = []string{"/var/lib/docker", "/var/lib/containers"}

/*
glancesMountName says how one mount point shows, and whether it shows at all.

Glances in a container sees the host under a prefix (/rootfs), so a mount under
it is the host's own and loses the prefix, and a mount outside it is the
container's: its root, which is docker's storage copy again. The pseudo
filesystems, the runtime stores and anything the reader listed go.
*/
func glancesMountName(cfg GlancesConfig, mount, fsType string, underStrip bool) (string, bool) {
	name := mount
	if strip := strings.TrimRight(cfg.DiskStrip, "/"); strip != "" {
		switch {
		case mount == strip:
			name = "/"
		case strings.HasPrefix(mount, strip+"/"):
			name = mount[len(strip):]
		case underStrip:
			// Not under the prefix, while the rest of the machine is: the
			// container's own view of itself.
			return "", false
		}
	}
	if glancesPseudoFS[fsType] {
		return "", false
	}
	for _, prefix := range glancesPseudoMounts {
		if name == prefix || strings.HasPrefix(name, prefix+"/") {
			return "", false
		}
	}
	for _, store := range glancesRuntimeStores {
		if strings.Contains(name, store) {
			return "", false
		}
	}
	for _, part := range cfg.DiskHide {
		if strings.Contains(name, part) {
			return "", false
		}
	}
	return name, true
}

// glancesCleanFS is the /fs answer without the mounts that are noise, under
// the names the reader would give them.
func glancesCleanFS(raw []byte, cfg GlancesConfig) ([]byte, error) {
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	strip := strings.TrimRight(cfg.DiskStrip, "/")
	underStrip := false
	for _, row := range rows {
		mount, _ := row["mnt_point"].(string)
		if strip != "" && (mount == strip || strings.HasPrefix(mount, strip+"/")) {
			underStrip = true
		}
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		mount, _ := row["mnt_point"].(string)
		fsType, _ := row["fs_type"].(string)
		name, ok := glancesMountName(cfg, mount, fsType, underStrip)
		if !ok {
			continue
		}
		kept := make(map[string]any, len(row))
		for k, v := range row {
			kept[k] = v
		}
		kept["mnt_point"] = name
		out = append(out, kept)
	}
	return json.Marshal(out)
}

// glancesCleanDiskIO drops the devices that are not disks: loop, RAM, zram.
func glancesCleanDiskIO(raw []byte) ([]byte, error) {
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		if name, _ := row["disk_name"].(string); glancesDiskNoise.MatchString(name) {
			continue
		}
		out = append(out, row)
	}
	return json.Marshal(out)
}

// ---- reading ----

// glancesRead asks Glances for one path, through the shared answers. The
// server and login are the stored ones, and part of the key, so a changed
// setting never reads what the old one was told.
func (h *Handlers) glancesRead(ctx context.Context, cfg GlancesConfig, path string) ([]byte, error) {
	key := strings.Join([]string{"glances", cfg.Server, cfg.User, path}, "\x00")
	return glancesCached(key, glancesViewTTL(path, cfg), func() ([]byte, error) {
		// Not the asker's context: the answer is shared with whoever waits.
		ctx, stop := context.WithTimeout(context.WithoutCancel(ctx), mediaRequestTimeout)
		defer stop()
		var raw json.RawMessage
		if err := h.glancesGet(ctx, cfg.Server, glancesCredential(cfg), "/"+path, nil, &raw); err != nil {
			return nil, err
		}
		return raw, nil
	})
}

// ---- the route ----

// registerGlancesViewRoutes adds the page's routes. The specific ones come
// first, so the catch-all that serves the allowlisted paths never answers
// them. GET only on the reads: the router answers 405 to every other method
// before a handler is reached.
func registerGlancesViewRoutes(r *mux.Router, h *Handlers) {
	r.HandleFunc("/api/glances/config", glancesNotInDemo(h.glancesConfigHandler)).Methods("GET", "PUT", "DELETE", "OPTIONS")
	r.HandleFunc("/api/glances/connect", glancesNotInDemo(h.glancesConnectHandler)).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/glances/status", h.glancesStatusHandler).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/glances/history", glancesNotInDemo(h.glancesHistoryHandler)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/glances/docker-link", glancesNotInDemo(h.glancesDockerLinkHandler)).Methods("GET", "OPTIONS")
	r.HandleFunc("/api/glances/history.csv", glancesNotInDemo(glancesHistoryCSV)).Methods("GET")
	r.HandleFunc("/api/glances/insights", glancesNotInDemo(glancesInsightsHandler)).Methods("GET")
	r.HandleFunc("/api/glances/data", glancesNotInDemo(h.glancesWipeHandler)).Methods("DELETE", "OPTIONS")
	r.HandleFunc("/api/glances/{path:.*}", glancesNotInDemo(h.glancesViewHandler)).Methods("GET", "OPTIONS")
}

// glancesNotInDemo makes a route not exist in the public demo: Glances reads an
// address on a visitor's behalf, and the demo reads none. The status route still
// answers, with "not set up", so a page that asks does not see an error.
func glancesNotInDemo(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if demoMode() {
			http.NotFound(w, r)
			return
		}
		next(w, r)
	}
}

/*
glancesViewHandler answers one allowed path for the configured Glances host.

The path is read from the escaped URL, not the decoded one, so an encoded
slash or dot never becomes a separator. Unknown paths are 404. A plugin that
is off is {"available":false}, and every other failure is {"error":"<code>"},
both 200. There is no outbound limit here: the address is the one in Config,
never one the caller chose, and an open page reads many paths a second.
*/
func (h *Handlers) glancesViewHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, OPTIONS")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path, ok := strings.CutPrefix(r.URL.EscapedPath(), "/api/glances/")
	if !ok || strings.Contains(path, "%") || !glancesViewAllowed(path) {
		http.NotFound(w, r)
		return
	}
	// A command line can carry a password or a key: behind the write token.
	if glancesProcessRe.MatchString(path) && !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	fail := func(err error) {
		if errors.Is(err, errGlancesNotFound) {
			_ = json.NewEncoder(w).Encode(map[string]bool{"available": false})
			return
		}
		logWarn(logComponentWidgets, "Glances %s: %v", path, err)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": mediaErrorCode(err)})
	}

	cfg := loadGlancesConfig()
	if !cfg.configured() {
		fail(errMediaNotSetUp)
		return
	}
	if cfg.Paused {
		// The connection is switched off: nothing is asked of the host.
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "paused"})
		return
	}

	// One process's command line is read from the cached list, so asking for
	// it costs Glances nothing more.
	asked := path
	pid := glancesProcessRe.FindStringSubmatch(path)
	if pid != nil {
		asked = "processlist"
	}
	data, err := h.glancesRead(r.Context(), cfg, asked)
	if err != nil {
		fail(err)
		return
	}

	switch {
	case asked == "fs":
		data, err = glancesCleanFS(data, cfg)
	case asked == "diskio":
		data, err = glancesCleanDiskIO(data)
	case asked != "processlist":
		_, _ = w.Write(data)
		return
	}
	if err != nil {
		fail(errMediaUnreachable)
		return
	}
	if asked != "processlist" {
		_, _ = w.Write(data)
		return
	}

	var rows []map[string]any
	if err := json.Unmarshal(data, &rows); err != nil {
		fail(errMediaUnreachable)
		return
	}
	if pid != nil {
		want, _ := strconv.ParseFloat(pid[1], 64)
		for _, row := range rows {
			if n, _ := row["pid"].(float64); n == want {
				_ = json.NewEncoder(w).Encode(map[string]any{"pid": row["pid"], "cmdline": row["cmdline"]})
				return
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"available": false})
		return
	}
	query := r.URL.Query()
	_ = json.NewEncoder(w).Encode(glancesProcesses(rows, query.Get("sort"), query.Get("q"), glancesProcessLimit))
}
