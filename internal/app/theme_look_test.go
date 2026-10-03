package app

import "testing"

func fptr(v float64) *float64 { return &v }
func bptr(v bool) *bool       { return &v }

func TestThemeLookSurvivesSanitising(t *testing.T) {
	in := &ThemeLook{
		Backdrop: "nebula",
		Tuning:   &BackdropTuning{Strength: 1.2, Scale: 1, Brightness: 1, Saturate: 1},
		Glass:    &ThemeLookGlass{Alpha: fptr(0.55), Blur: fptr(14), Border: "on"},
		Depth:    "glass",
		Heads:    &ThemeLookHeads{CategoryHeaderStyle: "boxed", CategoryHeaderSize: "m", ShowCategoryCount: bptr(true)},
		Text:     &ThemeLookText{FontPreset: "inter", DensityMode: "comfortable", CategorySpacing: "airy"},
	}
	got := sanitizeThemeLook(in)
	if got == nil || got.Backdrop != "nebula" || got.Depth != "glass" {
		t.Fatalf("look lost: %+v", got)
	}
	if *got.Glass.Alpha != 0.55 || *got.Glass.Blur != 14 || got.Glass.Border != "on" {
		t.Fatalf("glass lost: %+v", got.Glass)
	}
	if got.Heads.CategoryHeaderStyle != "boxed" || !*got.Heads.ShowCategoryCount {
		t.Fatalf("heads lost: %+v", got.Heads)
	}
	if got.Text.FontPreset != "inter" || got.Text.CategorySpacing != "airy" {
		t.Fatalf("text lost: %+v", got.Text)
	}
}

func TestThemeLookIsHeldToItsRanges(t *testing.T) {
	got := sanitizeThemeLook(&ThemeLook{
		Backdrop: "url(x)",
		Tuning:   &BackdropTuning{Strength: 99, Scale: 99, Brightness: 99, Saturate: 99, Tint: 99},
		Glass:    &ThemeLookGlass{Alpha: fptr(0.01), Blur: fptr(500), Border: "yes please"},
		Depth:    "deep",
		Heads:    &ThemeLookHeads{CategoryHeaderStyle: "wavy", CategoryHeaderSize: "xxl"},
		Text:     &ThemeLookText{FontPreset: "comic-sans", DensityMode: "cosy", CategorySpacing: "wide"},
	})
	if got == nil {
		t.Fatal("tuning and glass were valid after clamping; the look should stay")
	}
	if got.Backdrop != "" || got.Depth != "" {
		t.Fatalf("unknown words kept: backdrop %q depth %q", got.Backdrop, got.Depth)
	}
	if *got.Glass.Alpha != glassAlphaMin || *got.Glass.Blur != glassBlurMax || got.Glass.Border != "" {
		t.Fatalf("glass not clamped: %+v", got.Glass)
	}
	if got.Tuning.Strength != backdropStrengthMax {
		t.Fatalf("tuning not clamped: %+v", got.Tuning)
	}
	if got.Heads != nil || got.Text != nil {
		t.Fatalf("all-invalid heads/text should be dropped: %+v %+v", got.Heads, got.Text)
	}
}

func TestEmptyThemeLookIsNil(t *testing.T) {
	if sanitizeThemeLook(&ThemeLook{Backdrop: "nope"}) != nil {
		t.Fatal("a look with nothing valid should be nil")
	}
	if sanitizeThemeLook(nil) != nil {
		t.Fatal("nil in, nil out")
	}
}

func TestThemeLookKeepsOffAndTheThemesOwnHeaders(t *testing.T) {
	got := sanitizeThemeLook(&ThemeLook{Backdrop: "OFF", Heads: &ThemeLookHeads{CategoryHeaderStyle: "theme"}})
	if got == nil || got.Backdrop != "off" || got.Heads == nil || got.Heads.CategoryHeaderStyle != "theme" {
		t.Fatalf("off or theme lost: %+v", got)
	}
}

func TestOnlyCustomThemesCarryALook(t *testing.T) {
	l := &ThemeLook{Backdrop: "stars"}
	got := sanitizeColorTheme(ColorTheme{
		Dark:    ThemeColors{Look: l},
		BuiltIn: map[string]ThemeColors{"slate-dark": {Look: l}},
		Custom:  map[string]ThemeColors{"theme-1": {Look: l}},
	})
	if got.Dark.Look != nil || got.BuiltIn["slate-dark"].Look != nil {
		t.Fatal("a built-in kept a look")
	}
	if got.Custom["theme-1"].Look == nil || got.Custom["theme-1"].Look.Backdrop != "stars" {
		t.Fatal("the custom theme lost its look")
	}
}

func TestThemeMetaSaysWhichOwnThemesBringALook(t *testing.T) {
	m := themeMetaFor("theme-1", ThemeColors{})
	markThemeMetaOrigin(&m, ThemeColors{Look: &ThemeLook{Backdrop: "stars"}}, nil, true)
	if !m.Look {
		t.Fatal("a theme with a look is not marked")
	}
}
