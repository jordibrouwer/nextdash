package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

var unraidAreas = []string{"overview", "array", "parity", "shares", "vms", "ups", "notifications", "info"}

type UnraidOverviewView struct {
	Info          UnraidInfoView           `json:"info"`
	Array         *UnraidArrayView         `json:"array,omitempty"`
	Parity        *UnraidParityView        `json:"parity,omitempty"`
	Notifications *UnraidNotificationsView `json:"notifications,omitempty"`
	VMs           []UnraidVMView           `json:"vms,omitempty"`
	UPS           *UnraidUPSView           `json:"ups,omitempty"`
	Missing       []string                 `json:"missing,omitempty"`
}

func registerUnraidRoutes(r *mux.Router, h *Handlers) {
	r.HandleFunc("/api/unraid/area/{area}", h.UnraidAreaHandler).Methods("GET")
	r.HandleFunc("/api/unraid/settings", h.UnraidSettingsHandler).Methods("GET", "PUT")
	r.HandleFunc("/api/unraid/test", h.UnraidTestHandler).Methods("POST")
}

// fetchUnraidArea reads one area from one server with one key: no cache. The
// test button uses it with what was typed; the cache uses it with what is saved.
func (h *Handlers) fetchUnraidArea(ctx context.Context, srv UnraidServer, key, area string) (any, string, error) {
	allowLocal := h.allowLocalBookmarks()
	schema, err := loadUnraidSchema(ctx, srv, key, allowLocal)
	if err != nil {
		return nil, unraidStatusOf(err), err
	}
	query, ok := buildUnraidQuery(area, schema)
	if !ok {
		return nil, "unsupported", nil
	}
	data, fieldErrs, err := unraidQuery(ctx, srv, key, query, allowLocal)
	if err != nil {
		var v unraidValidationError
		if errors.As(err, &v) {
			forgetUnraidSchema(srv.ID) // the schema moved on; ask again next time
			return nil, "unsupported", err
		}
		return nil, unraidStatusOf(err), err
	}
	for _, fe := range fieldErrs {
		// me only adds the role; a key that may not read it still reads the
		// server, and the role is then inferred from the areas.
		if area == "info" && len(fe.Path) > 0 && fe.Path[0] == "me" {
			continue
		}
		if fe.Forbidden() {
			return nil, "forbidden", nil
		}
	}
	// A resolver that failed on the server answers 200 with its field null.
	// Read as an empty answer it alerted "The Unraid array stopped" and
	// blanked the tiles; as unreachable the last good answer stays. The UPS
	// field is null without a UPS, so it is left to its own reading.
	if area != "ups" {
		for _, fe := range fieldErrs {
			if len(fe.Path) > 0 && fe.Path[0] != "me" && unraidFieldMissing(data, fe.Path[0]) {
				return nil, "unreachable", fmt.Errorf("unraid: %s: %s", fe.Path[0], fe.Message)
			}
		}
	}
	var view any
	switch area {
	case "array":
		view, err = toUnraidArray(data)
	case "parity":
		view, err = toUnraidParity(data)
	case "shares":
		view, err = toUnraidShares(data)
	case "vms":
		view, err = toUnraidVMs(data)
	case "ups":
		view, err = toUnraidUPS(data)
	case "notifications":
		view, err = toUnraidNotifications(data)
	case "info":
		view, err = toUnraidInfo(data)
	}
	if err != nil {
		return nil, "unsupported", err
	}
	return view, "ok", nil
}

func unraidFieldMissing(data json.RawMessage, field string) bool {
	var root map[string]json.RawMessage
	if json.Unmarshal(data, &root) != nil || root == nil {
		return true
	}
	v, ok := root[field]
	return !ok || string(v) == "null"
}

// unraidConnMu keeps a server's address and its key together: written as one
// in a save, read as one before a fetch.
var unraidConnMu sync.RWMutex

func unraidStatusOf(err error) string {
	switch {
	case errors.Is(err, errUnraidUnauthorized):
		return "unauthorized"
	case errors.Is(err, errUnraidNoAPI):
		return "unsupported"
	}
	return "unreachable"
}

func (h *Handlers) unraidArea(ctx context.Context, area string) unraidAreaResult {
	// The cache first: a save between here and the fetch then lands old-server
	// data in the cache the save just threw away, not in the new one.
	cache := currentUnraidAnswers()
	unraidConnMu.RLock()
	srv, ok := activeUnraidServer(h.store.GetSettings())
	key := ""
	if ok {
		key = unraidAPIKey(srv.ID)
	}
	unraidConnMu.RUnlock()
	if !ok {
		return unraidAreaResult{Area: area, Status: "not-configured"}
	}
	if area == "overview" {
		return h.composeUnraidOverview(ctx)
	}
	return cache.get(ctx, area, unraidFloor, func(ctx context.Context) (any, string, error) {
		return h.fetchUnraidArea(ctx, srv, key, area)
	})
}

var unraidOverviewAreas = []string{"info", "array", "parity", "notifications", "vms", "ups"}

// composeUnraidOverview reads every area through its own cache entry, so the
// overview and the area tiles share their requests. The areas are asked side
// by side: each has its own 15-second bound, and so has the overview.
func (h *Handlers) composeUnraidOverview(ctx context.Context) unraidAreaResult {
	results := make([]unraidAreaResult, len(unraidOverviewAreas))
	var wg sync.WaitGroup
	for i, area := range unraidOverviewAreas {
		wg.Add(1)
		go func(i int, area string) {
			defer wg.Done()
			results[i] = h.unraidArea(ctx, area)
		}(i, area)
	}
	wg.Wait()
	return composeUnraidOverviewFrom(results)
}

// composeUnraidOverviewFrom builds the overview from its areas' answers, and
// says what they say together: an "ok" over seven failures hid a refused key
// and a server that was gone. One area answering is enough to draw; none
// answering is the server out of reach (with the last readings and the age of
// the oldest), or the key refused; none the key may read is unsupported.
func composeUnraidOverviewFrom(results []unraidAreaResult) unraidAreaResult {
	var o UnraidOverviewView
	out := unraidAreaResult{Area: "overview"}
	used, answered, refused, relevant, notConfigured, forbidden := 0, 0, 0, 0, 0, 0
	for _, r := range results {
		switch r.Status {
		case "ok":
			answered++
		case "unauthorized":
			refused++
		case "not-configured":
			notConfigured++
		case "forbidden":
			forbidden++
		}
		if r.Status != "forbidden" && r.Status != "unsupported" && r.Status != "not-configured" {
			relevant++
			if r.Status != "ok" && out.Error == "" {
				out.Error = r.Error
			}
		}
		if r.Data == nil {
			o.Missing = append(o.Missing, r.Area)
			continue
		}
		took := true
		switch v := r.Data.(type) {
		case UnraidInfoView:
			o.Info = v
		case UnraidArrayView:
			o.Array = &v
		case UnraidParityView:
			o.Parity = &v
		case UnraidNotificationsView:
			o.Notifications = &v
		case []UnraidVMView:
			o.VMs = v
		case UnraidUPSView:
			if !v.None {
				o.UPS = &v
			}
		default:
			took = false
		}
		if !took {
			continue
		}
		used++
		if r.LastOkAt > 0 && (out.LastOkAt == 0 || r.LastOkAt < out.LastOkAt) {
			out.LastOkAt = r.LastOkAt
		}
		if r.FetchedAt > 0 && (out.FetchedAt == 0 || r.FetchedAt < out.FetchedAt) {
			out.FetchedAt = r.FetchedAt
		}
	}
	switch {
	case notConfigured == len(results):
		out.Status = "not-configured"
	case answered > 0:
		out.Status = "ok"
	case relevant == 0 && forbidden > 0:
		// Nothing readable because the key may read none of it: say that,
		// not that this Unraid version lacks it.
		out.Status = "forbidden"
	case relevant == 0:
		out.Status = "unsupported"
	case refused > 0:
		out.Status = "unauthorized"
	default:
		out.Status = "unreachable"
	}
	if out.Status == "ok" {
		out.Error = ""
	}
	if used > 0 {
		out.Data = o
	}
	return out
}

func (h *Handlers) UnraidAreaHandler(w http.ResponseWriter, r *http.Request) {
	area := mux.Vars(r)["area"]
	known := false
	for _, a := range unraidAreas {
		known = known || a == area
	}
	if !known {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, h.unraidArea(r.Context(), area))
}

func (h *Handlers) UnraidSettingsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		s := h.store.GetSettings()
		var srv *UnraidServer
		if len(s.UnraidServers) > 0 {
			srv = &s.UnraidServers[0]
		}
		keySet := srv != nil && unraidAPIKey(srv.ID) != ""
		writeJSON(w, map[string]any{"server": srv, "keySet": keySet, "suggestedBaseUrl": suggestUnraidBaseURL()})
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		Server UnraidServer `json:"server"`
		Key    *string      `json:"key"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if body.Key != nil && strings.ContainsAny(strings.TrimSpace(*body.Key), " \t\r\n") {
		http.Error(w, "An API key has no spaces", http.StatusBadRequest)
		return
	}
	// An address normalising to nothing (192.168.1.20 without http://) was
	// saved as blank, dropped the key and still said Saved.
	if typed := strings.TrimSpace(body.Server.BaseURL); typed != "" && normalizeUnraidBaseURL(typed) == "" {
		http.Error(w, "Start the address with http:// or https://", http.StatusBadRequest)
		return
	}
	// The address and its key change as one: a poll between the two writes
	// sent the old key to the new address.
	unraidConnMu.Lock()
	defer unraidConnMu.Unlock()
	h.settingsMu.Lock()
	s := h.store.GetSettings()
	oldBaseURL := ""
	if len(s.UnraidServers) > 0 {
		oldBaseURL = s.UnraidServers[0].BaseURL
		if body.Server.ID == "" {
			body.Server.ID = s.UnraidServers[0].ID
		}
	}
	s.UnraidServers = []UnraidServer{body.Server}
	normalizeUnraidSettings(&s)
	saved := s.UnraidServers[0]
	err := h.store.SaveSettings(s)
	h.settingsMu.Unlock()
	if err != nil {
		http.Error(w, "Could not save", http.StatusInternalServerError)
		return
	}
	// A stored key belongs to the address it was typed for: pointed at a new
	// host without a new key, it is dropped rather than sent there.
	newKey := ""
	setKey := body.Key != nil
	if setKey {
		newKey = strings.TrimSpace(*body.Key)
	} else if oldBaseURL != "" && oldBaseURL != saved.BaseURL {
		setKey = true
	}
	if setKey {
		if err := saveUnraidAPIKey(saved.ID, newKey); err != nil {
			http.Error(w, "Could not store the key", http.StatusInternalServerError)
			return
		}
	}
	forgetUnraidSchema(saved.ID)
	resetUnraidAnswers()
	logActivity(activityCategoryMutate, "unraid.settings", map[string]any{"enabled": saved.Enabled}, "Unraid connection saved")
	writeJSON(w, map[string]any{"server": saved, "keySet": unraidAPIKey(saved.ID) != ""})
}

func (h *Handlers) UnraidTestHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		Server UnraidServer `json:"server"`
		Key    *string      `json:"key"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	srv := body.Server
	srv.BaseURL = normalizeUnraidBaseURL(srv.BaseURL)
	if srv.BaseURL == "" {
		writeJSON(w, map[string]any{"ok": false, "error": "Give an address like http://192.168.1.10"})
		return
	}
	saved := h.store.GetSettings()
	key := ""
	if body.Key != nil {
		key = strings.TrimSpace(*body.Key)
	} else if len(saved.UnraidServers) > 0 && saved.UnraidServers[0].BaseURL == srv.BaseURL {
		// The saved key goes only to the address it was saved for.
		key = unraidAPIKey(saved.UnraidServers[0].ID)
	}
	srv.ID = "test-" + newUnraidServerID() // never reuse the saved schema cache for a typed address
	defer forgetUnraidSchema(srv.ID)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	infoAny, status, err := h.fetchUnraidArea(ctx, srv, key, "info")
	if status != "ok" {
		msg := "The server did not answer"
		switch {
		case err != nil:
			msg = err.Error()
		// Reachable both: blamed on the network, the reader went looking for
		// a problem that was not there.
		case status == "forbidden":
			msg = "Connected, but this key may not read the server's info"
		case status == "unsupported":
			msg = "Connected, but this Unraid version's API lacks what nextDash reads"
		}
		writeJSON(w, map[string]any{"ok": false, "status": status, "error": msg})
		return
	}
	info := infoAny.(UnraidInfoView)
	areas := map[string]string{}
	for _, area := range []string{"array", "parity", "shares", "vms", "ups", "notifications"} {
		_, st, _ := h.fetchUnraidArea(ctx, srv, key, area)
		areas[area] = st
	}
	broader := false
	for _, role := range info.Roles {
		broader = broader || (role != "VIEWER" && role != "GUEST")
	}
	writeJSON(w, map[string]any{"ok": true, "info": info, "areas": areas, "viewerIsEnough": broader})
}
