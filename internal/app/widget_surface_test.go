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

// A widget has a background on every surface, and none only when it is asked
// to have none: auto is the word an older install has stored, and means the same
// as background.
func TestResolveWidgetBackground(t *testing.T) {
	for setting, want := range map[string]string{
		"": "background", "auto": "background", "background": "background",
		"none": "none", "NONE": "none", "nonsense": "background",
	} {
		if got := resolveWidgetBackground(setting); got != want {
			t.Errorf("resolveWidgetBackground(%q) = %q, want %q", setting, got, want)
		}
	}
}

func TestFreshInstallWidgetSurfaceIsTheDefaultWord(t *testing.T) {
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

func TestNormalizeWidgetOpacity(t *testing.T) {
	for in, want := range map[int]int{-5: 0, 0: 0, 6: 6, 80: 80, 100: 100, 101: 100, 500: 100} {
		if got := normalizeWidgetOpacity(in); got != want {
			t.Errorf("normalizeWidgetOpacity(%d) = %d, want %d", in, got, want)
		}
	}
}

// The default is 70 percent, a card that is mostly solid, for a fresh install
// and for one from before the setting; and 0 is an answer, not a missing one.
func TestWidgetOpacityDefaultAndZero(t *testing.T) {
	if got := gridSettings(t, nil); got.WidgetOpacity != 70 {
		t.Errorf("fresh install: %d, want 70", got.WidgetOpacity)
	}
	if got := gridSettings(t, gridFile(map[string]any{"theme": "slate-dark"})); got.WidgetOpacity != 70 {
		t.Errorf("an install from before the setting: %d, want 70", got.WidgetOpacity)
	}
	if got := gridSettings(t, gridFile(map[string]any{"widgetOpacity": 0})); got.WidgetOpacity != 0 {
		t.Errorf("a reader's 0 became %d", got.WidgetOpacity)
	}
	if got := gridSettings(t, gridFile(map[string]any{"widgetOpacity": 25})); got.WidgetOpacity != 25 {
		t.Errorf("a reader's 25 became %d", got.WidgetOpacity)
	}
	if got := gridSettings(t, gridFile(map[string]any{"widgetOpacity": 250})); got.WidgetOpacity != 100 {
		t.Errorf("250 was kept as %d, want 100", got.WidgetOpacity)
	}
}
