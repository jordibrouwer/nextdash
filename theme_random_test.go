package main

import "testing"

func TestAllThemeIDsIncludesLegacyAndCustom(t *testing.T) {
	colors := ColorTheme{
		BuiltIn: map[string]ThemeColors{
			"moss-stone-dark": {Name: "Moss Stone Dark"},
		},
		Custom: map[string]ThemeColors{
			"my-theme": {Name: "Mine"},
		},
	}
	ids := allThemeIDs(colors)
	want := map[string]bool{
		"dark":            true,
		"light":           true,
		"moss-stone-dark": true,
		"my-theme":        true,
	}
	if len(ids) != len(want) {
		t.Fatalf("allThemeIDs() = %v, want %d ids", ids, len(want))
	}
	for _, id := range ids {
		if !want[id] {
			t.Fatalf("unexpected theme id %q in %v", id, ids)
		}
	}
}

func TestFilterThemePoolForAutoDark(t *testing.T) {
	pool := []string{"dark", "light", "moss-stone-dark", "moss-stone-light", "my-theme"}

	darkOnly := filterThemePoolForAutoDark(pool, true)
	if len(darkOnly) != 2 {
		t.Fatalf("dark filter = %v, want [dark moss-stone-dark]", darkOnly)
	}
	for _, id := range darkOnly {
		if id != "dark" && id != "moss-stone-dark" {
			t.Fatalf("unexpected dark-pool id %q", id)
		}
	}

	lightOnly := filterThemePoolForAutoDark(pool, false)
	if len(lightOnly) != 2 {
		t.Fatalf("light filter = %v, want [light moss-stone-light]", lightOnly)
	}
	for _, id := range lightOnly {
		if id != "light" && id != "moss-stone-light" {
			t.Fatalf("unexpected light-pool id %q", id)
		}
	}

	customOnly := filterThemePoolForAutoDark([]string{"my-theme", "another-custom"}, true)
	if len(customOnly) != 1 || customOnly[0] != "dark" {
		t.Fatalf("custom-only dark fallback = %v, want [dark]", customOnly)
	}
	lightFallback := filterThemePoolForAutoDark([]string{"my-theme"}, false)
	if len(lightFallback) != 1 || lightFallback[0] != "light" {
		t.Fatalf("custom-only light fallback = %v, want [light]", lightFallback)
	}
}

func TestPickRandomThemeID(t *testing.T) {
	pool := []string{"a", "b", "c"}
	seen := make(map[string]struct{})
	for i := 0; i < 30; i++ {
		seen[pickRandomThemeID(pool)] = struct{}{}
	}
	if len(seen) == 0 {
		t.Fatal("pickRandomThemeID returned nothing")
	}
	for id := range seen {
		if id != "a" && id != "b" && id != "c" {
			t.Fatalf("unexpected pick %q", id)
		}
	}
}

func TestPickRandomThemeIDEmptyPool(t *testing.T) {
	if got := pickRandomThemeID(nil); got != "dark" {
		t.Fatalf("empty pool = %q, want dark", got)
	}
}

func TestNormalizeRandomThemeMode(t *testing.T) {
	if got := normalizeRandomThemeMode("", true); got != "refresh" {
		t.Fatalf("legacy refresh = %q, want refresh", got)
	}
	if got := normalizeRandomThemeMode("view", false); got != "view" {
		t.Fatalf("view = %q", got)
	}
	if got := normalizeRandomThemeMode("off", true); got != "off" {
		t.Fatalf("explicit off = %q, want off", got)
	}
	if got := normalizeRandomThemeMode("", false); got != "off" {
		t.Fatalf("default = %q, want off", got)
	}
}

func TestNormalizeLegacyThemeID(t *testing.T) {
	cases := map[string]string{
		"forest":          "forest-moss-dark",
		"forest-moss":     "forest-moss-dark",
		"neon-grid":       "neon-grid-dark",
		"":                "dark",
		"moss-stone-dark": "moss-stone-dark",
	}
	for in, want := range cases {
		if got := normalizeLegacyThemeID(in); got != want {
			t.Fatalf("normalizeLegacyThemeID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestThemeBackgroundPrimary(t *testing.T) {
	colors := getDefaultColors()
	if got := themeBackgroundPrimary("moss-stone-dark", colors); got != colors.BuiltIn["moss-stone-dark"].BackgroundPrimary {
		t.Fatalf("built-in = %q, want %q", got, colors.BuiltIn["moss-stone-dark"].BackgroundPrimary)
	}
	if got := themeBackgroundPrimary("forest", colors); got != colors.BuiltIn["forest-moss-dark"].BackgroundPrimary {
		t.Fatalf("legacy forest = %q, want forest-moss-dark bg", got)
	}
}
