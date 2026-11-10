package app

import (
	"encoding/json"
	"net/http"
)

// Owner API for the status page: layout, share link and the monitor list the
// Config picker offers. The public page itself lives in status_page_view.go.

type statusPageReply struct {
	Config    StatusPageConfig `json:"config"`
	Path      string           `json:"path"`
	LoadError string           `json:"loadError"`
}

func statusLinkPath() string {
	tok := readStatusToken()
	if len(tok) < statusTokenMinLen {
		return ""
	}
	return "/s/" + tok
}

func writeStatusJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func (h *Handlers) GetStatusPage(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	statusPageMu.Lock()
	cfg, err := readStatusPage()
	statusPageMu.Unlock()
	// A restored backup brings the layout back, switched on, but never the
	// link: make a new one rather than show a page that is on and unreachable.
	if err == nil && cfg.Enabled && statusLinkPath() == "" {
		if _, tokErr := ensureStatusToken(); !respondStorePersistError(w, tokErr) {
			return
		}
	}
	reply := statusPageReply{Config: cfg, Path: statusLinkPath()}
	if err != nil {
		// Config shows the empty layout plus why, so the owner can save over it.
		reply.Config = normalizeStatusPage(StatusPageConfig{})
		reply.LoadError = err.Error()
	}
	writeStatusJSON(w, reply)
}

func (h *Handlers) SaveStatusPage(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	// A pointer, so a body of `null` is refused: decoded into a value it was
	// an empty page that replaced the stored one without a word.
	var in *StatusPageConfig
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in == nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	cfg := normalizeStatusPage(*in)

	// A service named after its URL is the normalise fallback; use the
	// bookmark's own name instead.
	names := map[string]string{}
	// Where each check lives, so a service keeps only checks that still exist
	// on its own bookmark. A switched-off check stays listed (it comes back
	// when switched on); a deleted one, or one of another bookmark, goes.
	checkAt := map[string]string{}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			key := canonicalBookmarkURLKey(bm.URL)
			if bm.Monitor || len(bm.Checks) > 0 {
				names[key] = bm.Name
			}
			for _, c := range bm.Checks {
				if c.ID != "" {
					checkAt[c.ID] = key
				}
			}
		}
	}
	for gi := range cfg.Groups {
		for si := range cfg.Groups[gi].Services {
			s := &cfg.Groups[gi].Services[si]
			if len(s.NetChecks) > 0 {
				anchor := ""
				if s.MonitorURL != "" {
					anchor = canonicalBookmarkURLKey(s.MonitorURL)
				}
				kept := []string{}
				for _, id := range s.NetChecks {
					if at, ok := checkAt[id]; ok && (anchor == "" || at == anchor) {
						kept = append(kept, id)
					}
				}
				s.NetChecks = kept
				if len(kept) == 0 {
					s.NetChecks = nil
				}
			}
			if s.MonitorURL != "" && s.Name == s.MonitorURL {
				if name := names[canonicalBookmarkURLKey(s.MonitorURL)]; name != "" {
					s.Name = clipRunes(name, statusNameMax)
				}
			}
		}
	}

	// Overwrites an unreadable file too: that is how Config repairs it.
	statusPageMu.Lock()
	err := writeStatusPage(cfg)
	statusPageMu.Unlock()
	if !respondStorePersistError(w, err) {
		return
	}
	// ensureStatusToken takes statusPageMu itself.
	if cfg.Enabled {
		if _, err := ensureStatusToken(); !respondStorePersistError(w, err) {
			return
		}
	}

	if !h.pruneMaintenanceStatusGroups(cfg) {
		http.Error(w, "Failed to save data", http.StatusInternalServerError)
		return
	}
	writeStatusJSON(w, statusPageReply{Config: cfg, Path: statusLinkPath()})
}

// pruneMaintenanceStatusGroups drops group ids from maintenance windows that
// the saved layout no longer has. Settings are saved only when one changed.
func (h *Handlers) pruneMaintenanceStatusGroups(cfg StatusPageConfig) bool {
	live := map[string]bool{}
	for _, g := range cfg.Groups {
		live[g.ID] = true
	}
	h.settingsMu.Lock()
	defer h.settingsMu.Unlock()
	settings := h.store.GetSettings()
	changed := false
	windows := make([]MaintenanceWindow, len(settings.MaintenanceWindows))
	for i, mw := range settings.MaintenanceWindows {
		windows[i] = mw
		if len(mw.StatusGroups) == 0 {
			continue
		}
		kept := make([]string, 0, len(mw.StatusGroups))
		for _, id := range mw.StatusGroups {
			if live[id] {
				kept = append(kept, id)
			}
		}
		if len(kept) != len(mw.StatusGroups) {
			windows[i].StatusGroups = kept
			changed = true
		}
	}
	if !changed {
		return true
	}
	settings.MaintenanceWindows = windows
	return h.store.SaveSettings(settings) == nil
}

func (h *Handlers) NewStatusPageLink(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	tok, err := rotateStatusToken()
	if !respondStorePersistError(w, err) {
		return
	}
	writeStatusJSON(w, map[string]string{"path": "/s/" + tok})
}

type statusMonitorSource struct {
	URL  string `json:"url"`
	Name string `json:"name"`
	Page string `json:"page"`
	// Monitor is false for a bookmark listed only for its network checks.
	Monitor bool `json:"monitor"`
	// Checks are what the owner can opt in for this bookmark (owner API only).
	Checks []statusCheckSource `json:"checks,omitempty"`
}

type statusCheckSource struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Type    string `json:"type"`
	Enabled bool   `json:"enabled"`
}

func (h *Handlers) StatusPageSources(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	out := []statusMonitorSource{}
	at := map[string]int{}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			key := canonicalBookmarkURLKey(bm.URL)
			if !bm.Monitor && len(bm.Checks) == 0 {
				continue
			}
			i, seen := at[key]
			if !seen {
				i = len(out)
				at[key] = i
				out = append(out, statusMonitorSource{URL: bm.URL, Name: bm.Name, Page: p.Name})
			}
			out[i].Monitor = out[i].Monitor || bm.Monitor
			have := map[string]bool{}
			for _, c := range out[i].Checks {
				have[c.ID] = true
			}
			for _, c := range bm.Checks {
				if c.ID != "" && !have[c.ID] {
					out[i].Checks = append(out[i].Checks, statusCheckSource{ID: c.ID, Label: netCheckLabel(c, bm), Type: c.Type, Enabled: c.Enabled})
				}
			}
		}
	}
	writeStatusJSON(w, map[string]interface{}{"monitors": out})
}
