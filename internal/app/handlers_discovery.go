package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// The routes of app discovery. Reading is open like the other GETs; every POST
// needs the write token.
func registerDiscoveryRoutes(r *mux.Router, h *Handlers) {
	r.HandleFunc("/api/discovery", h.DiscoveryGetHandler).Methods("GET")
	r.HandleFunc("/api/discovery/run", h.DiscoveryRunHandler).Methods("POST")
	r.HandleFunc("/api/discovery/add", h.DiscoveryAddHandler).Methods("POST")
	r.HandleFunc("/api/discovery/undo", h.DiscoveryUndoHandler).Methods("POST")
	r.HandleFunc("/api/discovery/ack", h.DiscoveryAckHandler).Methods("POST")
	r.HandleFunc("/api/discovery/ignore", h.DiscoveryIgnoreHandler).Methods("POST")
	r.HandleFunc("/api/discovery/unignore", h.DiscoveryUnignoreHandler).Methods("POST")
	r.HandleFunc("/api/discovery/link", h.DiscoveryLinkHandler).Methods("POST")
	r.HandleFunc("/api/discovery/close", h.DiscoveryCloseHandler).Methods("POST")
	r.HandleFunc("/api/discovery/host-seen", h.DiscoveryHostSeenHandler).Methods("POST")
}

const discoveryMaxBody = 64 << 10

func decodeDiscoveryBody(w http.ResponseWriter, r *http.Request, into any) bool {
	if r.Body == nil || r.ContentLength == 0 {
		return true
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, discoveryMaxBody)).Decode(into); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return false
	}
	return true
}

func discoveryContainerName(raw string) string {
	name := strings.TrimPrefix(strings.TrimSpace(raw), "/")
	if name == "" || len(name) > dockerMaxHiddenNameLen {
		return ""
	}
	return name
}

type discoveryGetResponse struct {
	Enabled      bool                 `json:"enabled"`
	Docker       bool                 `json:"docker"`
	Running      bool                 `json:"running"`
	FirstRunDone bool                 `json:"firstRunDone"`
	CardDone     bool                 `json:"cardDone"`
	Apps         []discoveredApp      `json:"apps"`
	RecentAdds   []discoveryRecentAdd `json:"recentAdds"`
}

// DiscoveryGetHandler answers what the card and the notice need: the apps
// found that still have no bookmark, and the direct adds not yet acknowledged.
func (h *Handlers) DiscoveryGetHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	settings := h.store.GetSettings()
	out := discoveryGetResponse{
		Enabled:    settings.DiscoverApps && !demoMode(),
		Docker:     h.discoveryDocker.Load(),
		Running:    h.discoveryRunning.Load(),
		CardDone:   settings.DiscoveryCardDone,
		Apps:       []discoveredApp{},
		RecentAdds: []discoveryRecentAdd{},
	}
	h.discoveryMu.Lock()
	st := h.discoveryLocked()
	out.FirstRunDone = st.FirstRunDone
	runHost := st.Host
	apps := append([]discoveredApp(nil), st.Apps...)
	out.RecentAdds = append(out.RecentAdds, st.RecentAdds...)
	h.discoveryMu.Unlock()

	if out.Enabled {
		bookmarks := h.store.GetAllBookmarks()
		host := h.discoveryHost(settings)
		hosts := discoveryHosts(settings, host)
		for _, a := range apps {
			a = a.onHost(runHost, host)
			if containsString(settings.DiscoveryIgnored, a.Name) || containsString(settings.DockerHiddenContainers, a.Name) {
				continue
			}
			if discoveryAppMatches(a, bookmarks, settings.DockerBookmarkLinks, hosts) {
				continue
			}
			a.IconURL = discoveryIconURL(a.Icon)
			out.Apps = append(out.Apps, a)
		}
	}
	writeJSON(w, out)
}

// DiscoveryRunHandler runs discovery now, so nobody waits five minutes.
func (h *Handlers) DiscoveryRunHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	res, err := h.runDiscovery(ctx, time.Now())
	if err != nil {
		http.Error(w, "Failed to save data", http.StatusInternalServerError)
		return
	}
	writeJSON(w, res)
}

type discoveryAddRequest struct {
	PageID int `json:"pageId"`
	Apps   []struct {
		Name     string `json:"name"`
		Category string `json:"category"`
	} `json:"apps"`
}

// DiscoveryAddHandler is the card's Add. The addresses come from what the run
// found, never from the request: it can only pick among those apps.
func (h *Handlers) DiscoveryAddHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req discoveryAddRequest
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	if !h.pageExists(req.PageID) {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}

	host := h.discoveryHost(h.store.GetSettings())
	h.discoveryMu.Lock()
	found := map[string]discoveredApp{}
	runHost := h.discoveryLocked().Host
	for _, a := range h.discoveryLocked().Apps {
		found[a.Name] = a.onHost(runHost, host)
	}
	h.discoveryMu.Unlock()

	// Icons are fetched before the state lock is taken again.
	var items []discoveryAddItem
	seen := map[string]bool{}
	for _, want := range req.Apps {
		a, ok := found[want.Name]
		if !ok || seen[want.Name] {
			continue
		}
		seen[want.Name] = true
		items = append(items, discoveryAddItem{App: a, Category: want.Category, IconFile: discoveryIconFile(r.Context(), a.Icon)})
	}

	h.discoveryMu.Lock()
	defer h.discoveryMu.Unlock()
	st := h.discoveryLocked()
	added, _, err := h.addDiscoveredBookmarks(r.Context(), st, req.PageID, items, false, true)
	if saveErr := h.saveDiscoveryLocked(); saveErr != nil && err == nil {
		err = saveErr
	}
	if !respondStorePersistError(w, err) {
		return
	}
	if added == nil {
		added = []discoveryRecentAdd{}
	}
	writeJSON(w, map[string]any{"status": "success", "added": added})
}

// DiscoveryUndoHandler takes a direct add back: the bookmark goes to the trash
// as any delete does, its link is cleared, and the container is ignored.
func (h *Handlers) DiscoveryUndoHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	name := discoveryContainerName(req.Name)
	var recent *discoveryRecentAdd
	h.discoveryMu.Lock()
	for _, a := range h.discoveryLocked().RecentAdds {
		if a.Name == name {
			a := a
			recent = &a
		}
	}
	h.discoveryMu.Unlock()
	if name == "" || recent == nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	if page, address, ok := strings.Cut(recent.Key, "::"); ok {
		if pageID, err := strconv.Atoi(page); err == nil {
			h.trashDiscoveredBookmark(r, pageID, address)
		}
	}
	if !respondStorePersistError(w, h.updateSettings(func(s *Settings) {
		delete(s.DockerBookmarkLinks, name)
		if !containsString(s.DiscoveryIgnored, name) {
			s.DiscoveryIgnored = append(s.DiscoveryIgnored, name)
		}
	})) {
		return
	}
	err := h.withDiscoveryState(func(st *discoveryState) { st.dropRecent([]string{name}) })
	if !respondStorePersistError(w, err) {
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// trashDiscoveredBookmark deletes the bookmark at address on the page the way a
// delete does, keeping it in the trash.
func (h *Handlers) trashDiscoveredBookmark(r *http.Request, pageID int, address string) {
	want := canonicalBookmarkURLKey(address)
	index := -1
	for i, b := range h.store.GetBookmarksByPage(pageID) {
		if canonicalBookmarkURLKey(b.URL) == want {
			index = i
			break
		}
	}
	if index < 0 {
		return // already gone
	}
	removed, _ := h.deleteHealthBookmarksOnPage(pageID, []healthBulkDeleteItem{{PageID: pageID, Index: index, URL: address}})
	if len(removed) == 0 {
		return
	}
	entry := removed[0]
	for _, p := range h.store.GetPages() {
		if p.ID == pageID {
			entry.PageName = p.Name
		}
	}
	entry.Source = "discovery"
	_ = h.store.AddTrashedBookmarks([]TrashedBookmark{entry})
	h.invalidateHealthReportCache()
	deleted := entry.Bookmark
	deleted.PageID = pageID
	logBookmarkDelete(deleted, r)
}

func (st *discoveryState) dropRecent(names []string) {
	kept := st.RecentAdds[:0:0]
	for _, a := range st.RecentAdds {
		if !containsString(names, a.Name) {
			kept = append(kept, a)
		}
	}
	st.RecentAdds = kept
}

// DiscoveryAckHandler drops direct adds the browser has shown.
func (h *Handlers) DiscoveryAckHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Names []string `json:"names"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	if !respondStorePersistError(w, h.withDiscoveryState(func(st *discoveryState) { st.dropRecent(req.Names) })) {
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// DiscoveryIgnoreHandler turns a container down for good, and takes its
// proposal out of the Inbox.
func (h *Handlers) DiscoveryIgnoreHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	name := discoveryContainerName(req.Name)
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if !respondStorePersistError(w, h.updateSettings(func(s *Settings) {
		if !containsString(s.DiscoveryIgnored, name) {
			s.DiscoveryIgnored = append(s.DiscoveryIgnored, name)
		}
	})) {
		return
	}
	for _, item := range h.store.GetInboxItems() {
		if item.ContainerName != name {
			continue
		}
		if err := h.store.DeleteInboxLink(item.ID); err == nil {
			h.store.removeUnusedIconFile(item.Icon)
		}
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// DiscoveryUnignoreHandler is Config's Remove on the ignored list. The list
// has routes of its own because the settings save leaves it out: a page loaded
// before an Ignore would otherwise send the old list back.
func (h *Handlers) DiscoveryUnignoreHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	name := discoveryContainerName(req.Name)
	if name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if !respondStorePersistError(w, h.updateSettings(func(s *Settings) {
		kept := s.DiscoveryIgnored[:0:0]
		for _, n := range s.DiscoveryIgnored {
			if n != name {
				kept = append(kept, n)
			}
		}
		s.DiscoveryIgnored = kept
	})) {
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// DiscoveryLinkHandler ties a container to the bookmark an Inbox proposal was
// promoted to. The key is the stored bookmark's own, found by its address on
// that page, so it matches what the Containers view looks up.
func (h *Handlers) DiscoveryLinkHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Name   string `json:"name"`
		PageID int    `json:"pageId"`
		URL    string `json:"url"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	name := discoveryContainerName(req.Name)
	key := canonicalBookmarkURLKey(req.URL)
	if name == "" || key == "" || req.PageID <= 0 {
		http.Error(w, "name, pageId and url are required", http.StatusBadRequest)
		return
	}
	b := findBookmarkByURLKeyOnPage(h.store, req.PageID, key)
	if b == nil {
		http.Error(w, "Bookmark not found", http.StatusNotFound)
		return
	}
	link := strconv.Itoa(req.PageID) + "::" + b.URL
	if !respondStorePersistError(w, h.updateSettings(func(s *Settings) {
		if s.DockerBookmarkLinks == nil {
			s.DockerBookmarkLinks = map[string]string{}
		}
		s.DockerBookmarkLinks[name] = link
	})) {
		return
	}
	writeJSON(w, map[string]string{"status": "success", "key": link})
}

// DiscoveryCloseHandler is the card's Close: nothing added, not shown again.
func (h *Handlers) DiscoveryCloseHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !respondStorePersistError(w, h.updateSettings(func(s *Settings) { s.DiscoveryCardDone = true })) {
		return
	}
	writeJSON(w, map[string]string{"status": "success"})
}

// DiscoveryHostSeenHandler keeps the host the dashboard was opened on, for the
// links of ports when no host address is set.
func (h *Handlers) DiscoveryHostSeenHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req struct {
		Host string `json:"host"`
	}
	if !decodeDiscoveryBody(w, r, &req) {
		return
	}
	host := normalizeDockerHostAddress(req.Host)
	if host == "" {
		http.Error(w, "host is not a host name or address", http.StatusBadRequest)
		return
	}
	if h.store.GetSettings().DockerHostSeen != host {
		if !respondStorePersistError(w, h.updateSettings(func(s *Settings) { s.DockerHostSeen = host })) {
			return
		}
	}
	writeJSON(w, map[string]string{"status": "success"})
}
