package app

import "testing"

func TestResolveSurfacesFollowsTheTheme(t *testing.T) {
	settings := Settings{ThemeDepth: surfaceFollow, GlowStrength: surfaceFollow, ThemeEffects: surfaceFollow}
	velvet := ThemeColors{BackgroundPrimary: "#170E2B", TextPrimary: "#F5F3FF", Character: "velvet"}
	paper := ThemeColors{BackgroundPrimary: "#F6F7FB", TextPrimary: "#1A1F2B", Character: "paper"}

	if got := resolveSurfaces(settings, "royal-amethyst-dark", velvet); got.Depth != "rich" {
		t.Errorf("velvet resolved to depth %q, want rich", got.Depth)
	}
	if got := resolveSurfaces(settings, "paper-ink-light", paper); got.Depth != "soft" || got.Glow != "off" {
		t.Errorf("paper resolved to %q/%q, want soft/off", got.Depth, got.Glow)
	}
}

// A forced value is the whole reason "follow" is a value rather than the only
// behaviour: it has to win over both the theme and the reader's own change.
func TestAForcedSettingBeatsEverything(t *testing.T) {
	settings := Settings{
		ThemeDepth:        "flat",
		GlowStrength:      surfaceFollow,
		ThemeEffects:      surfaceFollow,
		ThemeSurfacePrefs: map[string]ThemeSurfacePref{"x": {Depth: "glass"}},
	}
	got := resolveSurfaces(settings, "x", ThemeColors{Character: "neon"})
	if got.Depth != "flat" {
		t.Errorf("a forced flat lost to %q", got.Depth)
	}
	if got.Glow != "full" {
		t.Errorf("glow was left to follow and gave %q, want full for neon", got.Glow)
	}
}

// The reader's change belongs to one theme, and beats that theme's own idea.
func TestAPerThemeChangeBeatsTheThemesIdeal(t *testing.T) {
	settings := Settings{
		ThemeDepth:        surfaceFollow,
		ThemeSurfacePrefs: map[string]ThemeSurfacePref{"a": {Depth: "flat"}},
	}
	terminal := ThemeColors{Character: "terminal"}
	if got := resolveSurfaces(settings, "a", terminal); got.Depth != "flat" {
		t.Errorf("theme a: depth %q, want the reader's flat", got.Depth)
	}
	// And a different theme is untouched by it -- that is the point of the map.
	if got := resolveSurfaces(settings, "b", terminal); got.Depth != "soft" {
		t.Errorf("theme b: depth %q, want terminal's own soft", got.Depth)
	}
}

func TestSurfacePrefsAreSanitised(t *testing.T) {
	in := map[string]ThemeSurfacePref{
		"good":    {Depth: "VIVID", Glow: "full"},
		"bad":     {Depth: "purple", Glow: "loud"},
		"":        {Depth: "rich"},
		"unknown": {Depth: "rich"},
	}
	out := sanitizeSurfacePrefs(in, map[string]bool{"good": true, "bad": true})

	if out["good"].Depth != "vivid" || out["good"].Glow != "full" {
		t.Errorf("a good entry came out as %+v", out["good"])
	}
	if _, ok := out["bad"]; ok {
		t.Errorf("an entry with nothing valid left was kept")
	}
	if _, ok := out[""]; ok {
		t.Errorf("an entry with no theme id was kept")
	}
	if _, ok := out["unknown"]; ok {
		t.Errorf("an entry for a theme that does not exist was kept")
	}
	if sanitizeSurfacePrefs(nil, nil) != nil {
		t.Errorf("an empty map should come back as nil, not an empty map")
	}
}

// Every theme has to resolve to words the stylesheet actually defines, or an
// attribute lands that matches no rule.
func TestEveryThemeResolvesToKnownWords(t *testing.T) {
	depths := map[string]bool{"flat": true, "soft": true, "rich": true, "vivid": true, "glass": true}
	glows := map[string]bool{"off": true, "soft": true, "full": true}
	effects := map[string]bool{"off": true, "held": true, "full": true}
	settings := Settings{ThemeDepth: surfaceFollow, GlowStrength: surfaceFollow, ThemeEffects: surfaceFollow}

	for id, tc := range getDefaultBuiltInThemes() {
		got := resolveSurfaces(settings, id, tc)
		if !depths[got.Depth] {
			t.Errorf("%s resolved to depth %q", id, got.Depth)
		}
		if !glows[got.Glow] {
			t.Errorf("%s resolved to glow %q", id, got.Glow)
		}
		if !effects[got.Effects] {
			t.Errorf("%s resolved to effects %q", id, got.Effects)
		}
	}
}
