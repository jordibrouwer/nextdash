package main

import (
	"crypto/rand"
	"encoding/binary"
	"sort"
	"strings"
)

// allThemeIDs returns every selectable theme id: legacy dark/light, built-in
// pairs, and user custom themes.
func allThemeIDs(colors ColorTheme) []string {
	seen := make(map[string]struct{}, len(colors.BuiltIn)+len(colors.Custom)+2)
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		seen[id] = struct{}{}
	}

	add("dark")
	add("light")
	for id := range colors.BuiltIn {
		add(id)
	}
	for id := range colors.Custom {
		add(id)
	}

	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// filterThemePoolForAutoDark keeps only theme ids that match the requested
// appearance when auto dark mode is active: dark variants for dark OS, light
// variants for light OS. Custom themes without a -dark/-light suffix are
// excluded because they have no paired variant. When nothing matches, falls
// back to the legacy dark/light themes.
func filterThemePoolForAutoDark(pool []string, wantsDark bool) []string {
	if len(pool) == 0 {
		if wantsDark {
			return []string{"dark"}
		}
		return []string{"light"}
	}
	out := make([]string, 0, len(pool))
	for _, id := range pool {
		switch {
		case id == "dark":
			if wantsDark {
				out = append(out, id)
			}
		case id == "light":
			if !wantsDark {
				out = append(out, id)
			}
		case strings.HasSuffix(id, "-dark"):
			if wantsDark {
				out = append(out, id)
			}
		case strings.HasSuffix(id, "-light"):
			if !wantsDark {
				out = append(out, id)
			}
		}
	}
	if len(out) > 0 {
		return out
	}
	if wantsDark {
		return []string{"dark"}
	}
	return []string{"light"}
}

func customThemeIDsCSV(colors ColorTheme) string {
	ids := make([]string, 0, len(colors.Custom))
	for id := range colors.Custom {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func themePoolCSV(colors ColorTheme) string {
	return strings.Join(allThemeIDs(colors), ",")
}

func pickRandomThemeID(pool []string) string {
	if len(pool) == 0 {
		return "dark"
	}
	if len(pool) == 1 {
		return pool[0]
	}
	var n uint64
	if err := binary.Read(rand.Reader, binary.LittleEndian, &n); err != nil {
		return pool[0]
	}
	return pool[int(n%uint64(len(pool)))]
}

// normalizeRandomThemeMode returns a validated random-theme mode. Legacy
// randomThemeOnRefresh=true maps to "refresh" when mode is unset.
func normalizeRandomThemeMode(mode string, legacyRefresh bool) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "refresh", "view":
		return strings.ToLower(strings.TrimSpace(mode))
	case "off":
		return "off"
	default:
		if legacyRefresh {
			return "refresh"
		}
		return "off"
	}
}

// legacyThemeMap migrates pre-pair theme ids saved by older clients.
var legacyThemeMap = map[string]string{
	"aurora":            "midnight-neon-dark",
	"cyberpunk":         "neon-grid-dark",
	"ember":             "desert-sand-dark",
	"forest":            "forest-moss-dark",
	"lavender":          "lavender-mist-dark",
	"matcha":            "forest-moss-dark",
	"midnight":          "midnight-neon-dark",
	"mint":              "glacier-mint-dark",
	"nerd":              "retro-crt-dark",
	"ocean":             "ocean-depth-dark",
	"paper":             "paper-ink-dark",
	"peach":             "desert-sand-dark",
	"sunset":            "solar-ember-dark",
	"synthwave":         "neon-grid-dark",
	"void":              "monochrome-mist-dark",
	"aurora-borealis":   "midnight-neon-dark",
	"desert-ember":      "desert-sand-dark",
	"forest-moss":       "forest-moss-dark",
	"lavender-mist":     "lavender-mist-dark",
	"midnight-terminal": "midnight-neon-dark",
	"iceberg":           "glacier-mint-dark",
	"neon-grid":         "neon-grid-dark",
	"paper-ink":         "paper-ink-dark",
	"sunset-pulse":      "solar-ember-dark",
	"void-mono":         "monochrome-mist-dark",
}

func normalizeLegacyThemeID(themeID string) string {
	themeID = strings.TrimSpace(themeID)
	if themeID == "" {
		return "dark"
	}
	if mapped, ok := legacyThemeMap[strings.ToLower(themeID)]; ok {
		return mapped
	}
	if mapped, ok := legacyThemeMap[themeID]; ok {
		return mapped
	}
	return themeID
}

func themeBackgroundPrimary(themeID string, colors ColorTheme) string {
	themeID = normalizeLegacyThemeID(themeID)
	switch themeID {
	case "light":
		return colors.Light.BackgroundPrimary
	case "dark":
		return colors.Dark.BackgroundPrimary
	}
	if tc, ok := colors.BuiltIn[themeID]; ok {
		return tc.BackgroundPrimary
	}
	if tc, ok := colors.Custom[themeID]; ok {
		return tc.BackgroundPrimary
	}
	if tc, ok := colors.BuiltIn[defaultThemeID]; ok {
		return tc.BackgroundPrimary
	}
	return "#131210"
}
