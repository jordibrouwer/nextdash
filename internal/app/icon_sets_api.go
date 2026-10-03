package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

/*
The icon-set API: what the page asks once it has rendered.

  POST /api/icon-sets/match   {urls}           -> {matches: {url: ref}}
  GET  /api/icon-sets/search  ?q=              -> {unavailable, results}
  GET  /api/icon-sets/suggest ?url=            -> {results}
  POST /api/icon-sets/adopt   {set,name,variant} -> {icon}

match and suggest read only; adopt writes a file into data/icons/ and sits
behind the write token like an icon upload. Every URL in an answer points at
/data/icon-sets/, never at the CDN. With no index -- offline, switched off --
every answer is empty, and the page carries on with favicons and letters.
*/

// iconSetRef is one app's icon as the page sees it: three addresses it picks
// from by theme, light and dark empty when the set has no such variant.
type iconSetRef struct {
	Set   string `json:"set"`
	Name  string `json:"name"`
	Label string `json:"label"`
	Base  string `json:"base"`
	Light string `json:"light,omitempty"`
	Dark  string `json:"dark,omitempty"`
}

func iconSetRefOf(e *iconSetEntry) *iconSetRef {
	if e == nil {
		return nil
	}
	ref := &iconSetRef{Set: e.Set, Name: e.Name, Label: e.Label, Base: iconSetFileURL(e.Set, e.variantFile("base"))}
	if f := e.variantFile("light"); f != "" {
		ref.Light = iconSetFileURL(e.Set, f)
	}
	if f := e.variantFile("dark"); f != "" {
		ref.Dark = iconSetFileURL(e.Set, f)
	}
	return ref
}

const (
	iconSetsMatchMaxURLs  = 500
	iconSetsSearchLimit   = 60
	iconSetsSuggestLimit  = 3
	iconSetsQueryMaxBytes = 200
)

// bookmarkLinkedContainers maps a bookmark address to the container that the
// Containers view links it to, by canonical URL.
func (h *Handlers) bookmarkLinkedContainers() map[string]string {
	out := map[string]string{}
	for name, link := range h.store.GetSettings().DockerBookmarkLinks {
		_, address, ok := strings.Cut(link, "::")
		if !ok || link == "-" {
			continue
		}
		if key := canonicalBookmarkURLKey(address); key != "" {
			out[key] = name
		}
	}
	return out
}

// containerImages reads image by container name, once per request and only
// when a linked bookmark needs it. No Docker: no images, and the name alone
// still matches.
func containerImages(ctx context.Context) map[string]string {
	out := map[string]string{}
	api, _ := newDockerAPI()
	if api == nil {
		return out
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	list, err := api.listContainers(ctx)
	if err != nil {
		return out
	}
	for _, c := range list {
		out[c.name()] = c.Image
	}
	return out
}

// bookmarkIconMatcher answers "which app is this bookmark", for many URLs at
// once: a linked container first, then the host.
type bookmarkIconMatcher struct {
	x      *iconSetIndex
	links  map[string]string
	images map[string]string
	ctx    context.Context
}

func (h *Handlers) newBookmarkIconMatcher(ctx context.Context, x *iconSetIndex) *bookmarkIconMatcher {
	return &bookmarkIconMatcher{x: x, links: h.bookmarkLinkedContainers(), ctx: ctx}
}

func (m *bookmarkIconMatcher) candidates(rawURL string) []string {
	var cands []string
	if name, ok := m.links[canonicalBookmarkURLKey(rawURL)]; ok {
		if m.images == nil {
			m.images = containerImages(m.ctx)
		}
		cands = append(cands, containerIconCandidates(m.images[name], name)...)
	}
	return append(cands, bookmarkHostCandidates(rawURL)...)
}

func (m *bookmarkIconMatcher) match(rawURL string) *iconSetEntry {
	return m.x.firstMatch(m.candidates(rawURL))
}

// bookmarkHasSetIcon: the gate the favicon fetchers ask first. A bookmark the
// sets know shows its set icon, so no favicon is fetched for it.
func (h *Handlers) bookmarkHasSetIcon(rawURL string) bool {
	x := currentIconSets()
	if x == nil {
		return false
	}
	e := h.newBookmarkIconMatcher(context.Background(), x).match(rawURL)
	if e == nil {
		return false
	}
	// Only when the icon can be had: a file the CDN would not give left the
	// row on a letter, with its own favicon never fetched.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := ensureIconSetFile(ctx, e.Set, e.variantFile("base"))
	return err == nil
}

func (h *Handlers) IconSetsMatchHandler(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		URLs []string `json:"urls"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	matches := map[string]*iconSetRef{}
	if x := currentIconSets(); x != nil {
		m := h.newBookmarkIconMatcher(r.Context(), x)
		for i, u := range payload.URLs {
			if i == iconSetsMatchMaxURLs {
				break
			}
			if ref := iconSetRefOf(m.match(u)); ref != nil {
				matches[u] = ref
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"matches": matches})
}

func (h *Handlers) IconSetsSearchHandler(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) > iconSetsQueryMaxBytes {
		q = q[:iconSetsQueryMaxBytes]
	}
	x := currentIconSets()
	results := []*iconSetRef{}
	for _, e := range x.search(q, iconSetsSearchLimit) {
		results = append(results, iconSetRefOf(e))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"unavailable": x == nil, "results": results})
}

func (h *Handlers) IconSetsSuggestHandler(w http.ResponseWriter, r *http.Request) {
	results := []*iconSetRef{}
	if x := currentIconSets(); x != nil {
		m := h.newBookmarkIconMatcher(r.Context(), x)
		for _, e := range x.suggestionsFor(m.candidates(r.URL.Query().Get("url")), iconSetsSuggestLimit) {
			results = append(results, iconSetRefOf(e))
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, map[string]any{"results": results})
}

func (h *Handlers) IconSetsAdoptHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var payload struct {
		Set     string `json:"set"`
		Name    string `json:"name"`
		Variant string `json:"variant"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	if payload.Variant == "" {
		payload.Variant = "base"
	}
	entry := currentIconSets().entry(payload.Set, payload.Name)
	if entry == nil {
		http.Error(w, "Unknown icon", http.StatusNotFound)
		return
	}
	file := entry.variantFile(payload.Variant)
	if file == "" {
		http.Error(w, "Unknown variant", http.StatusBadRequest)
		return
	}
	name, err := adoptIconSetFile(r.Context(), entry.Set, file)
	if err != nil {
		http.Error(w, "Unable to fetch icon", http.StatusBadGateway)
		return
	}
	writeJSON(w, map[string]string{"icon": name})
}
