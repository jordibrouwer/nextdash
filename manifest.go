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
	}

	w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(manifest)
}
