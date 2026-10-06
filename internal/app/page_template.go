package app

/*
Page templates: one page, as a file someone else can import.

Somebody who has built a good homelab page has no way to hand it over. A backup
is the whole install, and a page file is full of things that are nobody else's
business: when each link was last opened, how often it failed, the addresses of
the sender's own machines. A template is the page with all of that left out --
the layout, the categories, the widgets and the links -- in a file small enough
to paste into a forum post.

The part that makes it worth having is the addresses. A homelab page points at
http://192.168.1.10:8096 and https://nas.lan:5001, which mean nothing on the
receiver's network and say too much about the sender's. So an address on a
private host becomes a variable: {{jellyfin}}/web/index.html. The receiver fills
in each variable once, for each service rather than for each link, and the links
come out pointing at their own machines.

What goes into the file is an allowlist (templateBookmark and the copy in
buildPageTemplate), not a denylist: a field added to Bookmark later stays at
home until somebody decides it belongs in a template.

Importing always makes a new page. A template that quietly merged into a page
you already have could not be taken back out.
*/

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

const (
	pageTemplateKind    = "page-template"
	pageTemplateVersion = 1

	// pageTemplateMaxBytes caps an imported file. A page of a hundred links
	// with their icons is well under this; a file larger than it is not a
	// page somebody built by hand.
	pageTemplateMaxBytes = 2 << 20

	// Icons travel inside the file, so the receiver sees them at once rather
	// than letters until a prefetch round. Small ones only: an icon is a
	// favicon, and a file meant for a forum post must stay pasteable.
	templateIconMaxBytes   = 32 << 10
	templateIconsMaxBytes  = 1 << 20
	templateMaxBookmarks   = 500
	templateMaxCategories  = 100
	templateMaxWidgets     = 50
	templateMaxVariables   = 50
	templateMaxLabelLength = 60
)

// templateVariableRE is a variable's key, and templateRefRE finds one used in
// an address.
var (
	templateVariableRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	templateRefRE      = regexp.MustCompile(`^\{\{([a-z0-9][a-z0-9-]{0,39})\}\}`)
	templateColorRE    = regexp.MustCompile(`^#[0-9a-fA-F]{3,8}$`)
	// templateShortcutRE is a shortcut as the bookmark form stores one.
	templateShortcutRE = regexp.MustCompile(`^[A-Z]{1,5}$`)
)

// PageTemplate is the file.
type PageTemplate struct {
	Nextdash   string             `json:"nextdash"`
	Version    int                `json:"version"`
	Name       string             `json:"name"`
	Icon       string             `json:"icon,omitempty"`
	Color      string             `json:"color,omitempty"`
	Variables  []TemplateVariable `json:"variables,omitempty"`
	Categories []Category         `json:"categories"`
	Widgets    []Widget           `json:"widgets,omitempty"`
	BlockOrder []string           `json:"blockOrder,omitempty"`
	Bookmarks  []templateBookmark `json:"bookmarks"`
	// Icons maps a key a bookmark names to the icon itself, as a data URI.
	Icons map[string]string `json:"icons,omitempty"`
}

// TemplateVariable is one address the receiver fills in.
type TemplateVariable struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Default is the address a bundled template proposes, such as
	// "http://{server}:8096", where {server} is the one address the
	// first-start card asks for. An export never writes it.
	Default string `json:"default,omitempty"`
}

// templateBookmark is everything of a bookmark that leaves the house.
type templateBookmark struct {
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Category string   `json:"category,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Pinned   bool     `json:"pinned,omitempty"`
	Shortcut string   `json:"shortcut,omitempty"`
	Icon     string   `json:"icon,omitempty"`
	IconMode string   `json:"iconMode,omitempty"`
}

// TemplateHost is one origin on the page, as the export dialog offers it.
type TemplateHost struct {
	Origin   string `json:"origin"`
	Private  bool   `json:"private"`
	Variable bool   `json:"variable"`
	Key      string `json:"key"`
	Label    string `json:"label"`
	Count    int    `json:"count"`
}

// TemplateExportOptions are the sender's choices.
type TemplateExportOptions struct {
	// Hosts overrides what detectTemplateHosts proposes. Absent means the
	// proposal: every private host a variable, every public one as it is.
	Hosts []TemplateHost `json:"hosts,omitempty"`
	// IncludeNotes keeps a Notes widget's text. Off by default: a note is more
	// often private than useful to somebody else.
	IncludeNotes bool `json:"includeNotes,omitempty"`
}

// ---- hosts ----------------------------------------------------------------

// templateOrigin is scheme://host[:port] of an address, lower-cased, or "".
func templateOrigin(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return ""
	}
	return strings.ToLower(parsed.Scheme + "://" + parsed.Host)
}

// isTemplatePrivateHost says whether a host only means something on its own
// network. No DNS lookup: an export must not depend on what the sender's
// resolver says, and a name like nas.lan is private by its suffix alone.
func isTemplatePrivateHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.Trim(host, "[]"), "."))
	if host == "" {
		return false
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsUnspecified()
	}
	if host == "localhost" || !strings.Contains(host, ".") {
		return true
	}
	for _, suffix := range []string{".lan", ".local", ".localhost", ".home", ".internal", ".home.arpa", ".localdomain", ".intranet", ".corp", ".private"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

// templateKeyFrom turns a bookmark name into a variable key: "Jellyfin" ->
// "jellyfin", "Home Assistant" -> "home-assistant".
func templateKeyFrom(name string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case b.Len() > 0 && !dash:
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= 40 {
			break
		}
	}
	key := strings.Trim(b.String(), "-")
	if key == "" || !templateVariableRE.MatchString(key) {
		return "host"
	}
	return key
}

/*
detectTemplateHosts lists the page's origins, the way the export dialog shows
them: each with how many links use it, whether it is private, and a proposed
variable named after the first bookmark on it.
*/
func detectTemplateHosts(bookmarks []Bookmark, widgets []Widget) []TemplateHost {
	byOrigin := map[string]*TemplateHost{}
	order := []string{}
	add := func(raw, name string) {
		origin := templateOrigin(raw)
		if origin == "" {
			return
		}
		host, ok := byOrigin[origin]
		if !ok {
			parsed, _ := url.Parse(origin)
			private := isTemplatePrivateHost(parsed.Hostname())
			host = &TemplateHost{Origin: origin, Private: private, Variable: private, Label: strings.TrimSpace(name)}
			if host.Label == "" {
				host.Label = parsed.Hostname()
			}
			byOrigin[origin] = host
			order = append(order, origin)
		}
		host.Count++
	}
	for _, bookmark := range bookmarks {
		add(bookmark.URL, bookmark.Name)
	}
	for _, widget := range widgets {
		for _, raw := range templateWidgetURLs(widget) {
			add(raw, widget.Title)
		}
	}
	used := map[string]int{}
	out := make([]TemplateHost, 0, len(order))
	for _, origin := range order {
		host := byOrigin[origin]
		host.Label = truncateRunes(host.Label, templateMaxLabelLength)
		key := templateKeyFrom(host.Label)
		used[key]++
		if used[key] > 1 {
			key = fmt.Sprintf("%s-%d", key, used[key])
		}
		host.Key = key
		out = append(out, *host)
	}
	return out
}

// templateWidgetURLs are the addresses a widget's config holds.
func templateWidgetURLs(widget Widget) []string {
	var out []string
	switch widget.Type {
	case WidgetTypeCustom:
		if raw, ok := widget.Config["url"].(string); ok && raw != "" {
			out = append(out, raw)
		}
	case WidgetTypeRSS:
		if list, ok := widget.Config["feedUrls"].([]any); ok {
			for _, item := range list {
				if raw, ok := item.(string); ok && raw != "" {
					out = append(out, raw)
				}
			}
		}
	}
	return out
}

// templateSecretParam is a query parameter that is a key rather than a
// setting. An address like /api/stats?apikey=… keeps working on the
// receiver's side without it -- they add their own -- and the sender's key
// does not end up on a forum.
var templateSecretParam = regexp.MustCompile(`(?i)(key|token|secret|pass|auth|sig|session|cred)`)

// scrubTemplateURL drops the secret-looking query parameters and the fragment's
// credentials, and the userinfo (user:password@).
func scrubTemplateURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	parsed.User = nil
	if parsed.RawQuery != "" {
		query := parsed.Query()
		for name := range query {
			if templateSecretParam.MatchString(name) {
				query.Del(name)
			}
		}
		parsed.RawQuery = query.Encode()
	}
	return parsed.String()
}

// templatizeURL replaces an address's origin with its variable, when the host
// is one.
func templatizeURL(raw string, variables map[string]string) string {
	clean := scrubTemplateURL(raw)
	origin := templateOrigin(clean)
	if key, ok := variables[origin]; ok && origin != "" {
		// The origin as written may differ in case from the lower-cased key.
		return "{{" + key + "}}" + clean[len(origin):]
	}
	return clean
}

// ---- export ---------------------------------------------------------------

/*
buildPageTemplate copies what a template carries out of a stored page.

Notes text, and an icon that is not a small raster file, stay behind; a widget
that points at one of the sender's pages points at every page instead.
*/
func buildPageTemplate(page PageWithBookmarks, options TemplateExportOptions, iconsDir string) PageTemplate {
	hosts := options.Hosts
	if hosts == nil {
		hosts = detectTemplateHosts(page.Bookmarks, page.Widgets)
	}
	variables := map[string]string{}
	tpl := PageTemplate{
		Nextdash:   pageTemplateKind,
		Version:    pageTemplateVersion,
		Name:       page.Page.Name,
		Icon:       page.Page.Icon,
		Color:      page.Page.Color,
		Categories: []Category{},
		Bookmarks:  []templateBookmark{},
	}
	seenKeys := map[string]bool{}
	for _, host := range hosts {
		origin := templateOrigin(host.Origin)
		key := strings.TrimSpace(host.Key)
		if !host.Variable || origin == "" || !templateVariableRE.MatchString(key) || seenKeys[key] {
			continue
		}
		seenKeys[key] = true
		variables[origin] = key
		label := strings.TrimSpace(host.Label)
		if label == "" {
			label = key
		}
		// By runes: cut by bytes, a label in another script broke mid-character.
		label = truncateRunes(label, templateMaxLabelLength)
		tpl.Variables = append(tpl.Variables, TemplateVariable{Key: key, Label: label})
	}

	for _, category := range page.Categories {
		tpl.Categories = append(tpl.Categories, Category{
			ID:       category.ID,
			Name:     category.Name,
			Icon:     category.Icon,
			SortMode: category.SortMode,
			Spread:   category.Spread,
		})
	}

	for _, widget := range page.Widgets {
		config := make(map[string]any, len(widget.Config))
		for key, value := range widget.Config {
			config[key] = value
		}
		delete(config, "credentialId")
		switch widget.Type {
		case WidgetTypeNotes:
			if !options.IncludeNotes {
				delete(config, "text")
			}
		case WidgetTypeCustom:
			if raw, ok := config["url"].(string); ok {
				config["url"] = templatizeURL(raw, variables)
			}
		case WidgetTypeRSS:
			if list, ok := config["feedUrls"].([]any); ok {
				out := make([]any, 0, len(list))
				for _, item := range list {
					if raw, ok := item.(string); ok {
						out = append(out, templatizeURL(raw, variables))
					}
				}
				config["feedUrls"] = out
			}
		}
		if _, ok := config["pageId"]; ok {
			config["pageId"] = 0
		}
		tpl.Widgets = append(tpl.Widgets, Widget{ID: widget.ID, Type: widget.Type, Title: widget.Title, Config: config})
	}
	tpl.BlockOrder = append([]string(nil), page.BlockOrder...)

	iconKeys := map[string]string{}
	iconBytes := 0
	for _, bookmark := range page.Bookmarks {
		out := templateBookmark{
			Name:     bookmark.Name,
			URL:      templatizeURL(bookmark.URL, variables),
			Category: bookmark.Category,
			Tags:     append([]string(nil), bookmark.Tags...),
			Pinned:   bookmark.Pinned,
			Shortcut: bookmark.Shortcut,
			IconMode: bookmark.IconMode,
		}
		if file := sanitizeBookmarkIcon(bookmark.Icon); file != "" && iconsDir != "" {
			if key, done := iconKeys[file]; done {
				out.Icon = key
			} else if uri := templateIconDataURI(filepath.Join(iconsDir, file)); uri != "" && iconBytes+len(uri) <= templateIconsMaxBytes {
				key := fmt.Sprintf("i%d", len(iconKeys)+1)
				iconKeys[file] = key
				iconBytes += len(uri)
				if tpl.Icons == nil {
					tpl.Icons = map[string]string{}
				}
				tpl.Icons[key] = uri
				out.Icon = key
			}
		}
		tpl.Bookmarks = append(tpl.Bookmarks, out)
	}
	return tpl
}

// templateIconMIME is what an icon may be. SVG is not on it: an SVG can carry
// script, and the receiver did not choose to trust the sender.
var templateIconMIME = map[string]string{
	"image/png":                ".png",
	"image/jpeg":               ".jpg",
	"image/webp":               ".webp",
	"image/gif":                ".gif",
	"image/x-icon":             ".ico",
	"image/vnd.microsoft.icon": ".ico",
}

// templateIconDataURI reads an icon file as a data URI, or "" when it is too
// large or not a raster image.
func templateIconDataURI(path string) string {
	data, err := os.ReadFile(path)
	if err != nil || len(data) == 0 || len(data) > templateIconMaxBytes {
		return ""
	}
	mime := templateSniffIcon(data)
	if mime == "" {
		return ""
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// templateSniffIcon names an icon's type by its bytes, never by its claim.
func templateSniffIcon(data []byte) string {
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0, 0, 1, 0}) {
		return "image/x-icon"
	}
	mime := http.DetectContentType(data)
	if _, ok := templateIconMIME[mime]; ok {
		return mime
	}
	return ""
}

// ---- import ---------------------------------------------------------------

// TemplateImportRequest is what the import dialog sends.
type TemplateImportRequest struct {
	Template json.RawMessage   `json:"template"`
	Values   map[string]string `json:"values,omitempty"`
	// IntoPage fills an existing page instead of making one -- only a page
	// with no bookmarks and no widgets, where there is nothing to merge with
	// and so nothing an import could not be taken back out of.
	IntoPage int `json:"intoPage,omitempty"`
}

// TemplateImportResult says what an import did, or would do.
type TemplateImportResult struct {
	PageID     int                     `json:"pageId,omitempty"`
	Name       string                  `json:"name"`
	Categories int                     `json:"categories"`
	Widgets    int                     `json:"widgets"`
	Bookmarks  int                     `json:"bookmarks"`
	Variables  []TemplateVariableCount `json:"variables"`
	Skipped    TemplateImportSkipped   `json:"skipped"`
}

// TemplateVariableCount is a variable with how many links wait on it.
type TemplateVariableCount struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Default string `json:"default,omitempty"`
	Count   int    `json:"count"`
}

// TemplateImportSkipped is what did not make it, and why.
type TemplateImportSkipped struct {
	Widgets    []string `json:"widgets,omitempty"`
	Bookmarks  int      `json:"bookmarks,omitempty"`
	Unfilled   int      `json:"unfilled,omitempty"`
	Duplicates int      `json:"duplicates,omitempty"`
	Icons      int      `json:"icons,omitempty"`
	Shortcuts  int      `json:"shortcuts,omitempty"`
}

// parsePageTemplate reads and bounds an untrusted file.
func parsePageTemplate(raw []byte) (PageTemplate, error) {
	var tpl PageTemplate
	if len(raw) == 0 {
		return tpl, fmt.Errorf("the file is empty")
	}
	if len(raw) > pageTemplateMaxBytes {
		return tpl, fmt.Errorf("the file is larger than %d MB", pageTemplateMaxBytes>>20)
	}
	if err := json.Unmarshal(raw, &tpl); err != nil {
		return tpl, fmt.Errorf("this is not a page template")
	}
	if tpl.Nextdash != pageTemplateKind {
		return tpl, fmt.Errorf("this is not a page template")
	}
	if tpl.Version < 1 || tpl.Version > pageTemplateVersion {
		return tpl, fmt.Errorf("this template is version %d; this nextDash reads up to version %d", tpl.Version, pageTemplateVersion)
	}
	if len(tpl.Bookmarks) > templateMaxBookmarks || len(tpl.Categories) > templateMaxCategories ||
		len(tpl.Widgets) > templateMaxWidgets || len(tpl.Variables) > templateMaxVariables {
		return tpl, fmt.Errorf("this template is larger than a page can be")
	}
	return tpl, nil
}

// resolveTemplateValue checks a receiver's address for a variable: an http(s)
// origin, with a path prefix allowed, and no trailing slash.
func resolveTemplateValue(raw string) (string, bool) {
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	if value == "" {
		return "", false
	}
	if !strings.Contains(value, "://") {
		value = "http://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", false
	}
	return value, true
}

// fillTemplateURL puts the receiver's address in place of a variable. ok is
// false when the variable is one they left empty.
func fillTemplateURL(raw string, values map[string]string) (string, bool) {
	match := templateRefRE.FindStringSubmatch(raw)
	if match == nil {
		return raw, true
	}
	value, ok := values[match[1]]
	if !ok || value == "" {
		return "", false
	}
	return value + raw[len(match[0]):], true
}

type pageTemplatePlan struct {
	page       Page
	categories []Category
	widgets    []Widget
	order      []string
	bookmarks  []Bookmark
	icons      map[int][]byte // bookmark index -> icon bytes
	result     TemplateImportResult
}

/*
planPageTemplate turns a parsed template into what would be written, without
writing anything: the dry run answers with its result, and the real import
writes exactly what it planned.
*/
func (h *Handlers) planPageTemplate(tpl PageTemplate, rawValues map[string]string) pageTemplatePlan {
	return h.planPageTemplateReplacing(tpl, rawValues, 0)
}

// planPageTemplateReplacing plans a template that will take the place of
// page replacing: that page's own shortcuts are not counted as taken, since
// its bookmarks are about to go.
func (h *Handlers) planPageTemplateReplacing(tpl PageTemplate, rawValues map[string]string, replacing int) pageTemplatePlan {
	plan := pageTemplatePlan{icons: map[int][]byte{}}
	plan.page = Page{
		Name:  h.freeTemplatePageName(clampEntityName(tpl.Name)),
		Icon:  truncateRunes(strings.TrimSpace(tpl.Icon), 16),
		Color: strings.TrimSpace(tpl.Color),
	}
	if !templateColorRE.MatchString(plan.page.Color) {
		plan.page.Color = ""
	}
	now := time.Now().UnixMilli()

	values := map[string]string{}
	for key, raw := range rawValues {
		if value, ok := resolveTemplateValue(raw); ok && templateVariableRE.MatchString(key) {
			values[key] = value
		}
	}

	// Categories: kept by id, since categories belong to their page and a new
	// page has none to collide with.
	categoryIDs := map[string]bool{}
	for _, category := range tpl.Categories {
		id := strings.TrimSpace(category.ID)
		if id == "" || categoryIDs[id] || len(id) > 120 {
			continue
		}
		categoryIDs[id] = true
		icon := category.Icon
		if strings.ContainsAny(icon, "/\\") || len(icon) > 64 {
			icon = ""
		}
		plan.categories = append(plan.categories, Category{
			ID: id, Name: clampEntityName(category.Name), Icon: icon,
			SortMode: category.SortMode, Spread: category.Spread,
		})
	}

	// Variables, with how many links wait on each -- counted before the
	// widgets below fill their addresses in.
	counts := map[string]int{}
	for _, bookmark := range tpl.Bookmarks {
		if match := templateRefRE.FindStringSubmatch(bookmark.URL); match != nil {
			counts[match[1]]++
		}
	}
	for _, widget := range tpl.Widgets {
		for _, raw := range templateWidgetURLs(widget) {
			if match := templateRefRE.FindStringSubmatch(raw); match != nil {
				counts[match[1]]++
			}
		}
	}
	for _, variable := range tpl.Variables {
		if !templateVariableRE.MatchString(variable.Key) {
			continue
		}
		label := strings.TrimSpace(variable.Label)
		// By runes: cut by bytes, a label in another script broke mid-character.
		label = truncateRunes(label, templateMaxLabelLength)
		plan.result.Variables = append(plan.result.Variables, TemplateVariableCount{
			Key: variable.Key, Label: label, Count: counts[variable.Key],
			Default: truncateRunes(strings.TrimSpace(variable.Default), 200),
		})
	}

	// Widgets: new ids (the sender's may already exist here), the order
	// rewritten to match, and each through the same check a saved one meets.
	widgetIDs := map[string]string{}
	for _, widget := range tpl.Widgets {
		if widget.Config == nil {
			widget.Config = map[string]any{}
		}
		switch widget.Type {
		case WidgetTypeCustom:
			if raw, ok := widget.Config["url"].(string); ok {
				filled, _ := fillTemplateURL(raw, values)
				widget.Config["url"] = filled
			}
		case WidgetTypeRSS:
			if list, ok := widget.Config["feedUrls"].([]any); ok {
				out := make([]any, 0, len(list))
				for _, item := range list {
					if raw, ok := item.(string); ok {
						if filled, ok := fillTemplateURL(raw, values); ok && filled != "" {
							out = append(out, filled)
						}
					}
				}
				widget.Config["feedUrls"] = out
			}
		}
		delete(widget.Config, "credentialId")
		if _, ok := widget.Config["pageId"]; ok {
			widget.Config["pageId"] = 0
		}
		oldID := widget.ID
		widget.ID = newWidgetID()
		normalized, err := normalizeWidget(widget)
		if err != nil {
			name := string(widget.Type)
			if len(name) > 40 {
				name = name[:40]
			}
			plan.result.Skipped.Widgets = append(plan.result.Skipped.Widgets, name)
			continue
		}
		widgetIDs[oldID] = normalized.ID
		plan.widgets = append(plan.widgets, normalized)
	}
	for _, id := range tpl.BlockOrder {
		if newID, ok := widgetIDs[id]; ok {
			plan.order = append(plan.order, newID)
		} else if categoryIDs[id] {
			plan.order = append(plan.order, id)
		}
	}

	// Bookmarks.
	takenShortcuts := map[string]bool{}
	for _, existing := range h.store.GetAllBookmarks() {
		if replacing != 0 && existing.PageID == replacing {
			continue
		}
		if s := normalizeShortcut(existing.Shortcut); s != "" {
			takenShortcuts[s] = true
		}
	}
	// A finder's letters are taken too: typed, they would go to the search.
	for _, finder := range h.store.GetFinders() {
		if s := normalizeShortcut(finder.Shortcut); s != "" {
			takenShortcuts[s] = true
		}
	}
	seenURLs := map[string]bool{}
	for _, in := range tpl.Bookmarks {
		address, ok := fillTemplateURL(strings.TrimSpace(in.URL), values)
		if !ok {
			plan.result.Skipped.Unfilled++
			continue
		}
		if address == "" || templateOrigin(address) == "" || h.validateBookmarkURL(address) != nil {
			plan.result.Skipped.Bookmarks++
			continue
		}
		key := canonicalBookmarkURLKey(address)
		if seenURLs[key] {
			plan.result.Skipped.Duplicates++
			continue
		}
		seenURLs[key] = true
		bookmark := Bookmark{
			Name:      clampEntityName(in.Name),
			URL:       address,
			Pinned:    in.Pinned,
			IconMode:  in.IconMode,
			CreatedAt: now,
		}
		if categoryIDs[in.Category] {
			bookmark.Category = in.Category
		}
		for _, tag := range in.Tags {
			if tag = strings.TrimSpace(tag); tag != "" && len(tag) <= 64 && len(bookmark.Tags) < 20 {
				bookmark.Tags = append(bookmark.Tags, tag)
			}
		}
		if raw := strings.TrimSpace(in.Shortcut); raw != "" {
			// Shortcuts are the reader's own keys; one the receiver already uses
			// stays theirs. Only what the form itself stores -- one to five
			// letters -- comes in: anything else could never be typed, and
			// the next edit would cut it down without a word.
			s := normalizeShortcut(raw)
			if !templateShortcutRE.MatchString(s) || takenShortcuts[s] {
				plan.result.Skipped.Shortcuts++
			} else {
				takenShortcuts[s] = true
				bookmark.Shortcut = s
			}
		}
		normalizeBookmarkIconMode(&bookmark)
		if in.Icon != "" {
			if data := decodeTemplateIcon(tpl.Icons[in.Icon]); data != nil {
				plan.icons[len(plan.bookmarks)] = data
			} else {
				plan.result.Skipped.Icons++
			}
		}
		plan.bookmarks = append(plan.bookmarks, bookmark)
	}

	plan.result.Name = plan.page.Name
	plan.result.Categories = len(plan.categories)
	plan.result.Widgets = len(plan.widgets)
	plan.result.Bookmarks = len(plan.bookmarks)
	return plan
}

// decodeTemplateIcon reads a data URI back into bytes, if it is a small raster
// image by its own bytes.
func decodeTemplateIcon(uri string) []byte {
	const marker = ";base64,"
	if !strings.HasPrefix(uri, "data:image/") {
		return nil
	}
	at := strings.Index(uri, marker)
	if at < 0 {
		return nil
	}
	data, err := base64.StdEncoding.DecodeString(uri[at+len(marker):])
	if err != nil || len(data) == 0 || len(data) > templateIconMaxBytes || templateSniffIcon(data) == "" {
		return nil
	}
	return data
}

// freeTemplatePageName adds " (2)", " (3)" … to a name another page has.
func (h *Handlers) freeTemplatePageName(name string) string {
	if strings.TrimSpace(name) == "" {
		name = "Imported page"
	}
	taken := map[string]bool{}
	for _, page := range h.store.GetPages() {
		taken[strings.ToLower(page.Name)] = true
	}
	if !taken[strings.ToLower(name)] {
		return name
	}
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("%s (%d)", name, n)
		if !taken[strings.ToLower(candidate)] {
			return candidate
		}
	}
}

// pageTemplateImportMu holds an import's id choice and writes together.
var pageTemplateImportMu sync.Mutex

// nextTemplatePageID is one past every page id in use, the trash's included:
// a restored page writes its old id back.
func (h *Handlers) nextTemplatePageID() int {
	highest := 0
	for _, page := range h.store.GetPages() {
		if page.ID > highest && page.ID < unsortedPageID {
			highest = page.ID
		}
	}
	for id := range h.trashedPageIDs() {
		if id > highest && id < unsortedPageID {
			highest = id
		}
	}
	return highest + 1
}

// writePageTemplate writes a plan as a new page and appends it to the order.
func (h *Handlers) writePageTemplate(plan pageTemplatePlan) (int, error) {
	pageID := h.nextTemplatePageID()
	page := normalizePageMeta(plan.page, pageID)
	page.ID = pageID
	page.Name = plan.page.Name

	for index, data := range plan.icons {
		if file, err := saveIconBytes(data, templateIconMIME[templateSniffIcon(data)]); err == nil && file != "" {
			plan.bookmarks[index].Icon = file
		}
	}
	if err := h.store.SavePage(page); err != nil {
		return 0, err
	}
	categories := plan.categories
	if categories == nil {
		categories = []Category{}
	}
	if err := h.store.SaveCategoriesByPage(pageID, categories); err != nil {
		return 0, err
	}
	bookmarks := plan.bookmarks
	if bookmarks == nil {
		bookmarks = []Bookmark{}
	}
	if err := h.store.SaveBookmarksByPage(pageID, bookmarks); err != nil {
		return 0, err
	}
	widgets := plan.widgets
	if widgets == nil {
		widgets = []Widget{}
	}
	if err := h.store.SavePageBlocks(pageID, widgets, plan.order); err != nil {
		return 0, err
	}
	order := h.store.GetPageOrder()
	order = append(order, pageID)
	if err := h.store.SavePageOrder(order); err != nil {
		return 0, err
	}
	return pageID, nil
}

// emptyTemplateTarget finds a page an import may fill: visible, and with no
// bookmarks and no widgets. Its categories do not count -- a new page comes
// with defaults nobody chose.
func (h *Handlers) emptyTemplateTarget(pageID int) (Page, bool) {
	if pageID <= 0 || pageID == unsortedPageID {
		return Page{}, false
	}
	for _, page := range h.store.GetPages() {
		if page.ID != pageID || page.Hidden {
			continue
		}
		widgets, _ := h.store.GetPageBlocks(pageID)
		if len(h.store.GetBookmarksByPage(pageID)) > 0 || len(widgets) > 0 {
			return Page{}, false
		}
		return page, true
	}
	return Page{}, false
}

// fillPageWithTemplate writes a plan into an empty page, keeping its name.
func (h *Handlers) fillPageWithTemplate(page Page, plan pageTemplatePlan) error {
	for index, data := range plan.icons {
		if file, err := saveIconBytes(data, templateIconMIME[templateSniffIcon(data)]); err == nil && file != "" {
			plan.bookmarks[index].Icon = file
		}
	}
	if page.Icon == "" || page.Color == "" {
		if page.Icon == "" {
			page.Icon = plan.page.Icon
		}
		if page.Color == "" {
			page.Color = plan.page.Color
		}
		if err := h.store.SavePage(page); err != nil {
			return err
		}
	}
	categories := plan.categories
	if categories == nil {
		categories = []Category{}
	}
	if err := h.store.SaveCategoriesByPage(page.ID, categories); err != nil {
		return err
	}
	bookmarks := plan.bookmarks
	if bookmarks == nil {
		bookmarks = []Bookmark{}
	}
	if err := h.store.SaveBookmarksByPage(page.ID, bookmarks); err != nil {
		return err
	}
	widgets := plan.widgets
	if widgets == nil {
		widgets = []Widget{}
	}
	return h.store.SavePageBlocks(page.ID, widgets, plan.order)
}

// ---- routes ---------------------------------------------------------------

func templatePageIDFrom(r *http.Request) (int, bool) {
	id, err := strconv.Atoi(mux.Vars(r)["id"])
	return id, err == nil && id > 0 && id != unsortedPageID
}

// readTemplatePage reads the stored page with its widgets as written, not as
// the tokenless blocks route redacts them.
func (h *Handlers) readTemplatePage(pageID int) (PageWithBookmarks, bool) {
	var page PageWithBookmarks
	found := false
	for _, p := range h.store.GetPages() {
		if p.ID == pageID && !p.Hidden {
			page.Page = p
			found = true
		}
	}
	if !found {
		return page, false
	}
	page.Categories = h.store.GetCategoriesByPage(pageID)
	page.Widgets, page.BlockOrder = h.store.GetPageBlocks(pageID)
	page.Bookmarks = h.store.GetBookmarksByPage(pageID)
	return page, true
}

// PageTemplateHosts answers GET /api/pages/{id}/template/hosts: the origins
// the export dialog lists. Behind the token, because widget addresses are.
func (h *Handlers) PageTemplateHosts(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, ok := templatePageIDFrom(r)
	if !ok {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	page, found := h.readTemplatePage(pageID)
	if !found {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}
	hosts := detectTemplateHosts(page.Bookmarks, page.Widgets)
	sort.SliceStable(hosts, func(i, j int) bool { return hosts[i].Private && !hosts[j].Private })
	writeJSON(w, map[string]any{"name": page.Page.Name, "hosts": hosts, "hasNotes": templatePageHasNotes(page.Widgets)})
}

func templatePageHasNotes(widgets []Widget) bool {
	for _, widget := range widgets {
		if text, _ := widget.Config["text"].(string); widget.Type == WidgetTypeNotes && strings.TrimSpace(text) != "" {
			return true
		}
	}
	return false
}

// ExportPageTemplate answers POST /api/pages/{id}/template with the file.
func (h *Handlers) ExportPageTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, ok := templatePageIDFrom(r)
	if !ok {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	var options TemplateExportOptions
	if r.ContentLength != 0 {
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&options); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
	}
	page, found := h.readTemplatePage(pageID)
	if !found {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}
	tpl := buildPageTemplate(page, options, filepath.Join(ResolveDataDir(), "icons"))
	// Not HTML-escaped: the file is read by people, and "&" as \u0026 in
	// every address is noise in a forum post.
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(tpl); err != nil {
		http.Error(w, "Failed to build the template", http.StatusInternalServerError)
		return
	}
	body := buf.Bytes()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", templateFileName(page.Page.Name)))
	_, _ = w.Write(body)
}

// templateFileName is the page's name as a file name.
func templateFileName(name string) string {
	slug := templateKeyFrom(name)
	if slug == "host" {
		slug = "page"
	}
	return slug + ".nextdash-page.json"
}

// ImportPageTemplate answers POST /api/pages/template. With ?dryRun=1 it only
// says what it would do.
func (h *Handlers) ImportPageTemplate(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var req TemplateImportRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, pageTemplateMaxBytes+64<<10)).Decode(&req); err != nil {
		http.Error(w, "This is not a page template", http.StatusBadRequest)
		return
	}
	raw := []byte(req.Template)
	// Pasted text arrives as a JSON string holding the file.
	var pasted string
	if json.Unmarshal(raw, &pasted) == nil {
		raw = []byte(pasted)
	}
	tpl, err := parsePageTemplate(raw)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	plan := h.planPageTemplate(tpl, req.Values)
	// One import at a time, from the checks to the last write: a new page's
	// id is read before it is written, and an empty page is checked before
	// it is filled, so two imports at once (two tabs) took the same id or
	// filled the same page, the second overwriting the first.
	pageTemplateImportMu.Lock()
	defer pageTemplateImportMu.Unlock()
	if req.IntoPage != 0 {
		target, ok := h.emptyTemplateTarget(req.IntoPage)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Only an empty page can be filled from a template"})
			return
		}
		plan.result.Name = target.Name
		if r.URL.Query().Get("dryRun") == "1" {
			writeJSON(w, plan.result)
			return
		}
		if !respondStorePersistError(w, h.fillPageWithTemplate(target, plan)) {
			return
		}
		plan.result.PageID = target.ID
		writeJSON(w, plan.result)
		return
	}
	if r.URL.Query().Get("dryRun") == "1" {
		writeJSON(w, plan.result)
		return
	}
	pageID, err := h.writePageTemplate(plan)
	if !respondStorePersistError(w, err) {
		return
	}
	plan.result.PageID = pageID
	writeJSON(w, plan.result)
}
