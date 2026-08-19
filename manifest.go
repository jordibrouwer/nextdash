package main

import (
	"encoding/json"
	"net/http"
	"strings"
)

type webManifest struct {
	Name            string         `json:"name"`
	ShortName       string         `json:"short_name"`
	Description     string         `json:"description"`
	StartURL        string         `json:"start_url"`
	Scope           string         `json:"scope"`
	Display         string         `json:"display"`
	BackgroundColor string         `json:"background_color"`
	ThemeColor      string         `json:"theme_color"`
	Icons           []manifestIcon `json:"icons"`
	// ShareTarget puts nextDash in the phone's share sheet. GET rather than
	// POST: POST needs a service worker to catch the form, and a redirect is
	// the whole of what this needs to do.
	ShareTarget *manifestShareTarget `json:"share_target,omitempty"`
	// Shortcuts are the long-press menu on the installed icon.
	Shortcuts []manifestShortcut `json:"shortcuts,omitempty"`
}

type manifestShareTarget struct {
	Action string              `json:"action"`
	Method string              `json:"method"`
	Params manifestShareParams `json:"params"`
}

// The three fields a share sheet sends. Android fills them inconsistently —
// often the URL arrives inside `text` — which the handler sorts out.
type manifestShareParams struct {
	Title string `json:"title"`
	Text  string `json:"text"`
	URL   string `json:"url"`
}

type manifestShortcut struct {
	Name  string         `json:"name"`
	URL   string         `json:"url"`
	Icons []manifestIcon `json:"icons,omitempty"`
}

type manifestIcon struct {
	Src     string `json:"src"`
	Sizes   string `json:"sizes"`
	Type    string `json:"type"`
	Purpose string `json:"purpose,omitempty"`
}

func manifestAppName(settings Settings) string {
	if settings.EnableCustomTitle && strings.TrimSpace(settings.CustomTitle) != "" {
		return strings.TrimSpace(settings.CustomTitle)
	}
	return "nextDash"
}

func manifestShortName(name string) string {
	runes := []rune(name)
	if len(runes) <= 12 {
		return name
	}
	return string(runes[:12])
}

func faviconMimeFromPath(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lower, ".png"):
		return "image/png"
	case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
		return "image/jpeg"
	case strings.HasSuffix(lower, ".gif"):
		return "image/gif"
	default:
		return "image/x-icon"
	}
}

func manifestIcons(settings Settings) []manifestIcon {
	if settings.EnableCustomFavicon && strings.TrimSpace(settings.CustomFaviconPath) != "" {
		path := strings.TrimSpace(settings.CustomFaviconPath)
		mime := faviconMimeFromPath(path)
		return []manifestIcon{
			{Src: path, Sizes: "48x48", Type: mime},
			{Src: path, Sizes: "192x192", Type: mime},
			{Src: path, Sizes: "512x512", Type: mime},
		}
	}
	return []manifestIcon{
		{Src: "/static/favicon.ico", Sizes: "48x48", Type: "image/x-icon"},
		{Src: "/static/nextdash-logo.png", Sizes: "192x192", Type: "image/png"},
		{Src: "/static/nextdash-logo.png", Sizes: "512x512", Type: "image/png", Purpose: "any maskable"},
	}
}

// manifestShortcuts is the installed icon's long-press menu. The inbox entry is
// left out when the inbox is switched off, so the menu cannot offer a view that
// is not there.
func manifestShortcuts(settings Settings) []manifestShortcut {
	shortcuts := make([]manifestShortcut, 0, 4)
	if settings.InboxEnabled {
		shortcuts = append(shortcuts, manifestShortcut{Name: "Inbox", URL: "/#inbox"})
	}
	// Only destinations the app already knows how to open from a URL. A
	// long-press entry that lands on the plain dashboard because nothing reads
	// its query parameter is worse than one entry fewer.
	shortcuts = append(shortcuts,
		manifestShortcut{Name: "Health", URL: "/#health"},
		manifestShortcut{Name: "Config", URL: "/#config"},
	)
	return shortcuts
}

func (h *Handlers) WebAppManifest(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	colors := h.store.GetColors()
	name := manifestAppName(settings)
	themeColor := themeBackgroundPrimary(normalizeLegacyThemeID(settings.Theme), colors)

	manifest := webManifest{
		Name:            name,
		ShortName:       manifestShortName(name),
		Description:     "Keyboard-first bookmark dashboard",
		StartURL:        "/",
		Scope:           "/",
		Display:         "standalone",
		BackgroundColor: themeColor,
		ThemeColor:      themeColor,
		Icons:           manifestIcons(settings),
		ShareTarget: &manifestShareTarget{
			Action: "/share",
			Method: "GET",
			Params: manifestShareParams{Title: "title", Text: "text", URL: "url"},
		},
		Shortcuts: manifestShortcuts(settings),
	}

	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(manifest)
}
