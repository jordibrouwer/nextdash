package app

import (
	"embed"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/gorilla/mux"
)

/*
Three page templates ship inside the binary: Homelab, Media server and
Developer. The first-start card offers them on a fresh install, the import
dialog offers them as "Or start from", and the demo seeds its pages from them.

They are ordinary template files, made the way an export makes one, with one
addition an export never writes: each variable carries a Default such as
"http://{server}:8096", so one address fills every service on it.
*/

//go:embed bundled_templates/*.nextdash-page.json
var bundledTemplateFS embed.FS

// bundledTemplateIDs is the order the card and the import dialog show them in.
var bundledTemplateIDs = []string{"homelab", "media-server", "developer"}

// bundledTemplateServer is the token in a Default the one address replaces.
const bundledTemplateServer = "{server}"

func bundledTemplateRaw(id string) ([]byte, bool) {
	for _, known := range bundledTemplateIDs {
		if known == id {
			data, err := bundledTemplateFS.ReadFile("bundled_templates/" + id + ".nextdash-page.json")
			return data, err == nil
		}
	}
	return nil, false
}

func bundledTemplate(id string) (PageTemplate, bool) {
	raw, ok := bundledTemplateRaw(id)
	if !ok {
		return PageTemplate{}, false
	}
	tpl, err := parsePageTemplate(raw)
	return tpl, err == nil
}

/*
expandTemplateDefault fills a variable's Default with the one server address.

The address may be a bare host ("192.168.1.10", "nas.local"), or carry a
scheme or a port. A scheme typed there wins over the Default's: someone who
writes https:// means it for every service. A port typed there wins too. A
Default without {server} (the router's 192.168.1.1) is used as it is. ok is
false for an address that is not a plain host: a path, a query or a user name
have no place in a value that is about to be shared by every link.
*/
func expandTemplateDefault(def, server string) (string, bool) {
	def = strings.TrimSpace(def)
	if def == "" {
		return "", false
	}
	if !strings.Contains(def, bundledTemplateServer) {
		return resolveTemplateValue(def)
	}
	server = strings.TrimRight(strings.TrimSpace(server), "/")
	if server == "" {
		return "", false
	}
	scheme := ""
	if at := strings.Index(server, "://"); at >= 0 {
		scheme = strings.ToLower(server[:at])
		server = server[at+3:]
	}
	typed, err := url.Parse("http://" + server)
	if err != nil || typed.Hostname() == "" || typed.User != nil || typed.Path != "" ||
		typed.RawQuery != "" || typed.Fragment != "" || strings.ContainsAny(server, "/?#@") {
		return "", false
	}
	if scheme != "" && scheme != "http" && scheme != "https" {
		return "", false
	}
	base, err := url.Parse(strings.Replace(def, bundledTemplateServer, "server.invalid", 1))
	if err != nil {
		return "", false
	}
	if scheme == "" {
		scheme = base.Scheme
	}
	port := typed.Port()
	if port == "" {
		port = base.Port()
	}
	host := typed.Hostname()
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	value := scheme + "://" + host
	if port != "" {
		value += ":" + port
	}
	return resolveTemplateValue(value)
}

/*
bundledTemplateValues is the address per variable: what the reader typed
under More, and otherwise the Default filled with the server address.
*/
func bundledTemplateValues(tpl PageTemplate, server string, typed map[string]string) map[string]string {
	values := map[string]string{}
	for _, variable := range tpl.Variables {
		if raw := strings.TrimSpace(typed[variable.Key]); raw != "" {
			values[variable.Key] = raw
			continue
		}
		if value, ok := expandTemplateDefault(variable.Default, server); ok {
			values[variable.Key] = value
		}
	}
	return values
}

/*
isUntouchedMainPage says whether main is still exactly what a fresh install
wrote: the same name, categories, links and widgets, the example note
unedited. Icons, dates and health do not count; they change by themselves.
Only then may a template take its place.
*/
func (h *Handlers) isUntouchedMainPage() bool {
	seed := defaultMainPage()
	page, ok := h.readTemplatePage(seed.Page.ID)
	if !ok || page.Page.Name != seed.Page.Name {
		return false
	}
	if len(page.Categories) != len(seed.Categories) || len(page.Bookmarks) != len(seed.Bookmarks) ||
		len(page.Widgets) != len(seed.Widgets) {
		return false
	}
	for i, category := range seed.Categories {
		if page.Categories[i].ID != category.ID || page.Categories[i].Name != category.Name {
			return false
		}
	}
	for i, bookmark := range seed.Bookmarks {
		got := page.Bookmarks[i]
		if got.Name != bookmark.Name || got.URL != bookmark.URL || got.Category != bookmark.Category ||
			got.Shortcut != bookmark.Shortcut {
			return false
		}
	}
	for i, widget := range seed.Widgets {
		got := page.Widgets[i]
		if got.ID != widget.ID || got.Type != widget.Type {
			return false
		}
		if widget.Type == WidgetTypeNotes {
			want, _ := widget.Config["text"].(string)
			have, _ := got.Config["text"].(string)
			if have != want {
				return false
			}
		}
	}
	return true
}

// replacePageWithTemplate writes a plan over an existing page, taking the
// template's name, icon and colour with it.
func (h *Handlers) replacePageWithTemplate(page Page, plan pageTemplatePlan) error {
	page.Name = plan.page.Name
	page.Icon = plan.page.Icon
	page.Color = plan.page.Color
	if err := h.store.SavePage(page); err != nil {
		return err
	}
	return h.fillPageWithTemplate(page, plan)
}

// BundledTemplateSummary is one template as the card and the import dialog
// list it.
type BundledTemplateSummary struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Icon      string             `json:"icon,omitempty"`
	Links     int                `json:"links"`
	Services  []string           `json:"services"`
	Variables []TemplateVariable `json:"variables"`
}

// BundledTemplates answers GET /api/page-templates/bundled. replacesMain
// tells the card which sentence goes under its button.
func (h *Handlers) BundledTemplates(w http.ResponseWriter, r *http.Request) {
	list := make([]BundledTemplateSummary, 0, len(bundledTemplateIDs))
	for _, id := range bundledTemplateIDs {
		tpl, ok := bundledTemplate(id)
		if !ok {
			continue
		}
		summary := BundledTemplateSummary{ID: id, Name: tpl.Name, Icon: tpl.Icon, Links: len(tpl.Bookmarks),
			Services: []string{}, Variables: tpl.Variables}
		for _, bookmark := range tpl.Bookmarks {
			if bookmark.Name != "nextDash" {
				summary.Services = append(summary.Services, bookmark.Name)
			}
		}
		list = append(list, summary)
	}
	writeJSON(w, map[string]any{"templates": list, "replacesMain": h.isUntouchedMainPage()})
}

// BundledTemplateFile answers GET /api/page-templates/bundled/{id} with the
// file itself, for the import dialog to read like any other.
func (h *Handlers) BundledTemplateFile(w http.ResponseWriter, r *http.Request) {
	raw, ok := bundledTemplateRaw(mux.Vars(r)["id"])
	if !ok {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// OnboardingTemplateRequest is what the first-start card sends.
type OnboardingTemplateRequest struct {
	ID     string            `json:"id"`
	Server string            `json:"server"`
	Values map[string]string `json:"values,omitempty"`
}

/*
ApplyOnboardingTemplate answers POST /api/onboarding/template.

Main still the seed: the template takes its place. Otherwise it becomes a new
page, so choosing again later never overwrites anything somebody made.
*/
func (h *Handlers) ApplyOnboardingTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req OnboardingTemplateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	tpl, ok := bundledTemplate(req.ID)
	if !ok {
		http.Error(w, "Template not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(req.Server) != "" {
		if _, ok := expandTemplateDefault("http://"+bundledTemplateServer, req.Server); !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Enter an address like 192.168.1.10 or nas.local"})
			return
		}
	}
	values := bundledTemplateValues(tpl, req.Server, req.Values)

	pageTemplateImportMu.Lock()
	defer pageTemplateImportMu.Unlock()
	if h.isUntouchedMainPage() {
		seed := defaultMainPage()
		plan := h.planPageTemplateReplacing(tpl, values, seed.Page.ID)
		var target Page
		for _, page := range h.store.GetPages() {
			if page.ID == seed.Page.ID {
				target = page
			}
		}
		if !respondStorePersistError(w, h.replacePageWithTemplate(target, plan)) {
			return
		}
		// The public links (GitHub, nextdash.cc) get their favicons the way the
		// starter links did; LAN addresses are skipped by the prefetch itself.
		h.startDefaultBookmarkIconPrefetch()
		plan.result.PageID = target.ID
		plan.result.Name = tpl.Name
		writeJSON(w, map[string]any{"result": plan.result, "replaced": true})
		return
	}
	plan := h.planPageTemplate(tpl, values)
	pageID, err := h.writePageTemplate(plan)
	if !respondStorePersistError(w, err) {
		return
	}
	plan.result.PageID = pageID
	writeJSON(w, map[string]any{"result": plan.result, "replaced": false})
}
