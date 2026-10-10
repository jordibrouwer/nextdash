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
	var in StatusPageConfig
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	cfg := normalizeStatusPage(in)

	// A service named after its URL is the normalise fallback; use the
	// bookmark's own name instead.
	names := map[string]string{}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			if bm.Monitor {
				names[canonicalBookmarkURLKey(bm.URL)] = bm.Name
			}
		}
	}
	for gi := range cfg.Groups {
		for si := range cfg.Groups[gi].Services {
			s := &cfg.Groups[gi].Services[si]
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
}

func (h *Handlers) StatusPageSources(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	out := []statusMonitorSource{}
	seen := map[string]bool{}
	for _, p := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(p.ID) {
			key := canonicalBookmarkURLKey(bm.URL)
			if !bm.Monitor || seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, statusMonitorSource{URL: bm.URL, Name: bm.Name, Page: p.Name})
		}
	}
	writeStatusJSON(w, map[string]interface{}{"monitors": out})
}
