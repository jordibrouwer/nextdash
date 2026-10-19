package app

import "testing"

func TestNormalizeWidgetSurface(t *testing.T) {
	for in, want := range map[string]string{
		"": "auto", "auto": "auto", "AUTO": "auto", " background ": "background", "none": "none",
		"follow": "auto", "glass": "auto", "nonsense": "auto",
	} {
		if got := normalizeWidgetSurface(in); got != want {
			t.Errorf("normalizeWidgetSurface(%q) = %q, want %q", in, got, want)
		}
	}
}

// Automatic gives a widget its own background where nothing else frames it:
// on open. On glass and card the pane is the frame.
func TestResolveWidgetBackground(t *testing.T) {
	cases := []struct{ setting, cat, want string }{
		{"auto", "open", "background"}, {"auto", "glass", "none"}, {"auto", "card", "none"},
		{"background", "open", "background"}, {"background", "glass", "background"}, {"background", "card", "background"},
		{"none", "open", "none"}, {"none", "glass", "none"}, {"", "open", "background"}, {"", "glass", "none"},
	}
	for _, c := range cases {
		if got := resolveWidgetBackground(c.setting, c.cat, false); got != c.want {
			t.Errorf("resolveWidgetBackground(%q, %q) = %q, want %q", c.setting, c.cat, got, c.want)
		}
	}
}

// Whatever sends a theme to open -- its own answer, an archetype, flat depth,
// the reader's choice for one theme or for all -- gives automatic its background,
// because it follows the resolved surface and not a list of themes.
func TestAutomaticFollowsTheResolvedSurface(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	open, other := 0, 0
	for id, tc := range themes {
		r := resolveSurfaces(Settings{}, id, tc)
		got := resolveWidgetBackground("auto", r.CatSurface, false)
		if r.CatSurface == "open" {
			open++
			if got != "background" {
				t.Errorf("%s is open and has no widget background", id)
			}
		} else {
			other++
			if got != "none" {
				t.Errorf("%s is %s and has a widget background it does not need", id, r.CatSurface)
			}
		}
	}
	if open == 0 || other == 0 {
		t.Fatalf("expected both kinds of theme, got %d open and %d other", open, other)
	}
	forced := resolveSurfaces(Settings{CategorySurface: "open"}, "slate-dark", themes["slate-dark"])
	if resolveWidgetBackground("auto", forced.CatSurface, false) != "background" {
		t.Error("a forced open surface did not give the widgets a background")
	}
}

func TestFreshInstallWidgetSurfaceIsAutomatic(t *testing.T) {
	got := gridSettings(t, nil)
	if got.WidgetSurface != "auto" {
		t.Errorf("fresh install: widget surface %q, want auto", got.WidgetSurface)
	}
	old := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark"}))
	if old.WidgetSurface != "auto" {
		t.Errorf("an install from before the setting: %q, want auto", old.WidgetSurface)
	}
	kept := gridSettings(t, gridFile(map[string]any{"widgetSurface": "none"}))
	if kept.WidgetSurface != "none" {
		t.Errorf("a reader's none was changed to %q", kept.WidgetSurface)
	}
}

// A category that has been given a pane of its own (own card glass) is framed:
// automatic steps back, and an explicit background does not.
func TestAutomaticStepsBackForOwnGlass(t *testing.T) {
	if got := resolveWidgetBackground("auto", "open", true); got != "none" {
		t.Errorf("auto on open with own glass = %q, want none", got)
	}
	if got := resolveWidgetBackground("background", "open", true); got != "background" {
		t.Errorf("background on open with own glass = %q, want background", got)
	}
}
