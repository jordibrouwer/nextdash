package app

import (
	"strings"
	"testing"
)

// ThinkDashboard (Classic) is the first release's page brought back: its own
// palette, drawn the way it was before there were materials, on a grid of dots.
func TestThinkDashboardClassicIsThePageOfTheFirstRelease(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	want := map[string]struct {
		bg, secondary, dots, text, textSecondary, textTertiary, border string
	}{
		"thinkdashboard-classic-dark":  {"#000000", "#1F2937", "#1F2937", "#E5E7EB", "#9CA3AF", "#6B7280", "#4B5563"},
		"thinkdashboard-classic-light": {"#F9FAFB", "#F3F4F6", "#E5E7EB", "#1F2937", "#6B7280", "#9CA3AF", "#D1D5DB"},
	}
	for id, w := range want {
		tc, ok := themes[id]
		if !ok {
			t.Fatalf("%s is not a built-in theme", id)
		}
		if tc.Name != "ThinkDashboard [dark]" && tc.Name != "ThinkDashboard [light]" {
			t.Errorf("%s is called %q", id, tc.Name)
		}
		if tc.Collection != "classic" {
			t.Errorf("%s is in collection %q, want classic", id, tc.Collection)
		}
		if tc.MaterialStyle != "classic" || tc.Character != "" {
			t.Errorf("%s: material style %q, character %q; want classic and none", id, tc.MaterialStyle, tc.Character)
		}
		if tc.Backdrop != "dots" {
			t.Errorf("%s: backdrop %q, want dots", id, tc.Backdrop)
		}
		if tc.BackgroundPrimary != w.bg || tc.BackgroundSecondary != w.secondary || tc.BackgroundDots != w.dots ||
			tc.TextPrimary != w.text || tc.TextSecondary != w.textSecondary || tc.TextTertiary != w.textTertiary ||
			tc.BorderPrimary != w.border {
			t.Errorf("%s: palette is not the one v1.0.0 shipped: %+v", id, tc)
		}
	}
	if !strings.Contains(strings.Join(themeCollectionOrder, ","), "classic") {
		t.Errorf("the browser does not list the classic collection: %v", themeCollectionOrder)
	}
}

// The dots are plain: the dot colour of the palette on a 15 pixel tile, with no
// quiet centre over them and no accent colour under them.
func TestTheDotsBackdropIsPlainDots(t *testing.T) {
	tc := getDefaultBuiltInThemes()["thinkdashboard-classic-dark"]
	css := renderThemeCSSBlock("thinkdashboard-classic-dark", tc)
	if !strings.Contains(css, "--theme-backdrop: radial-gradient(var(--background-dots) 1px, transparent 1px);") {
		t.Errorf("the backdrop is not the dot grid:\n%s", css)
	}
	if !strings.Contains(css, "--theme-backdrop-size: calc(15px * var(--bd-scale, 1)) calc(15px * var(--bd-scale, 1));") {
		t.Errorf("the dots are not on a 15 pixel tile that --bd-scale stretches:\n%s", css)
	}
	if !strings.Contains(css, "--theme-backdrop-scrim: 0;") {
		t.Errorf("the dots ask for a scrim:\n%s", css)
	}
	look := themeBackdropSeeded("thinkdashboard-classic-light", getDefaultBuiltInThemes()["thinkdashboard-classic-light"], 7)
	if strings.Contains(look.Image, "var(--accent") || strings.Contains(look.Image, "--bd-calm") {
		t.Errorf("the dots carry colour or a quiet centre: %s", look.Image)
	}
	if got := splitBackdropList(look.Image); len(got) != 1 {
		t.Errorf("%d layers, want just the dots", len(got))
	}
}
