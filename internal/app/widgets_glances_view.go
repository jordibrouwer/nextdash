package app

import (
	"context"
	"encoding/json"
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
The Glances view: one machine in full, read through one widget.

Every path goes through /api/glances/<widgetId>/<path>, so a view always
belongs to a stored widget, and the server and credential are that widget's:
the browser can never name an address. The paths are an allowlist, never a
passthrough. Glances is read only, but not quite: POST /events/clear/all is
one of its paths, and /all carries every command line on the machine. Only the
plugins the view draws are reachable, only by GET, and nothing of the request
but the path is forwarded.

Answers are shared and short-lived (half the tile's beat, at least 2 s), so
the tile, an open view and a second tab do not each ask Glances; readers that
arrive while a path is being asked wait for that one answer. The plugin list
decides which sections exist and hardly changes, so it lives five minutes.

Process lists can carry secrets in their arguments. The server sorts, searches
and cuts the list, strips every command line, and hands one out only when the
reader asks for that one process.
*/

const (
	// glancesViewMinTTL is the shortest an answer lives.
	glancesViewMinTTL = 2 * time.Second
	// glancesPluginsTTL is how long the plugin list lives.
	glancesPluginsTTL = 5 * time.Minute
	// glancesProcessLimit is how many processes the browser gets.
	glancesProcessLimit = 200
	// glancesHistoryMax is the most history points one read may ask.
	glancesHistoryMax = 1200
	// glancesViewSweepAt is the size above which expired answers are dropped.
	glancesViewSweepAt = 256
)

// glancesViewPaths are the plugin paths the view may read, exactly.
var glancesViewPaths = map[string]bool{
	"quicklook": true, "cpu": true, "mem": true, "memswap": true, "load": true,
	"fs": true, "diskio": true, "network": true, "connections": true, "wifi": true,
	"sensors": true, "system": true, "uptime": true, "processlist": true,
	"processcount": true, "containers": true, "alert": true, "smart": true,
	"raid": true, "pluginslist": true, "all/limits": true,
}

// glancesHistoryPlugins are the plugins whose /history/<n> the view may read.
var glancesHistoryPlugins = map[string]bool{
	"cpu": true, "mem": true, "memswap": true, "load": true,
	"network": true, "diskio": true, "quicklook": true, "fs": true,
}

var (
	glancesHistoryRe = regexp.MustCompile(`^([a-z]+)/history/([1-9][0-9]{0,3})$`)
	glancesProcessRe = regexp.MustCompile(`^processes/([1-9][0-9]{0,9})$`)
)

// glancesViewAllowed says whether a path may be read. Exact matches only: no
// prefix, no cleaning, so "..", empty segments and case games all fall out.
func glancesViewAllowed(path string) bool {
	if glancesViewPaths[path] || glancesProcessRe.MatchString(path) {
		return true
	}
	m := glancesHistoryRe.FindStringSubmatch(path)
	if m == nil || !glancesHistoryPlugins[m[1]] {
		return false
	}
	n, err := strconv.Atoi(m[2])
	return err == nil && n >= 1 && n <= glancesHistoryMax
}

// glancesViewTTL is how long one path's answer lives for this widget.
func glancesViewTTL(path string, spec glancesSpec) time.Duration {
	if path == "pluginslist" {
		return glancesPluginsTTL
	}
	return max(glancesViewMinTTL, spec.TTL/2)
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

	data, err := fetch()
	glancesViewCache.Lock()
	entry.data, entry.err = data, err
	if err == nil || err == errGlancesNotFound {
		entry.expires = time.Now().Add(ttl)
	}
	glancesViewCache.Unlock()
	close(entry.done)
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

// ---- the route ----

// registerGlancesViewRoutes adds the view's one route. GET only: the router
// answers 405 to every other method before the handler is reached.
func registerGlancesViewRoutes(r *mux.Router, h *Handlers) {
	r.HandleFunc("/api/glances/{id}/{path:.*}", h.glancesViewHandler).Methods("GET", "OPTIONS")
}

/*
glancesViewHandler answers one allowed path for one Glances widget.

The path is read from the escaped URL, not the decoded one, so an encoded
slash or dot never becomes a separator. Unknown paths and unknown widgets are
404. A plugin that is off is {"available":false}, and every other failure is
{"error":"<code>"}, both 200, as the tile is told.
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
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}

	rest, ok := strings.CutPrefix(r.URL.EscapedPath(), "/api/glances/")
	if !ok || strings.Contains(rest, "%") {
		http.NotFound(w, r)
		return
	}
	widgetID, path, _ := strings.Cut(rest, "/")
	if widgetID == "" || !glancesViewAllowed(path) {
		http.NotFound(w, r)
		return
	}
	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgets, _ := h.store.GetPageBlocks(pageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == widgetID && widgets[i].Type == WidgetTypeGlances {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	fail := func(err error) {
		if err == errGlancesNotFound {
			_ = json.NewEncoder(w).Encode(map[string]bool{"available": false})
			return
		}
		logWarn(logComponentWidgets, "Glances view %s %s: %v", widgetID, path, err)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": mediaErrorCode(err)})
	}

	spec := glancesSpecFrom(found.Config)
	if spec.Server == "" {
		fail(errMediaNotSetUp)
		return
	}
	var credential HealthCredential
	if spec.CredentialID != "" {
		if credential, ok = lookupHealthCredential(spec.CredentialID); !ok {
			fail(errMediaNotSetUp)
			return
		}
	}

	// One process's command line is read from the cached list, so asking for
	// it costs Glances nothing more.
	asked := path
	pid := glancesProcessRe.FindStringSubmatch(path)
	if pid != nil {
		asked = "processlist"
	}
	// The key carries the server and credential, so a changed widget never
	// reads what its old settings were told.
	key := strings.Join([]string{"glances", strconv.Itoa(pageID), widgetID, spec.Server, spec.CredentialID, asked}, "\x00")
	data, err := glancesCached(key, glancesViewTTL(asked, spec), func() ([]byte, error) {
		// Not the asker's context: the answer is shared with whoever waits.
		ctx, stop := context.WithTimeout(context.WithoutCancel(r.Context()), mediaRequestTimeout)
		defer stop()
		var raw json.RawMessage
		if err := h.glancesGet(ctx, spec.Server, credential, "/"+asked, nil, &raw); err != nil {
			return nil, err
		}
		return raw, nil
	})
	if err != nil {
		fail(err)
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
