package app

import "testing"

// On "Follow the theme" every theme keeps its own header, Confetti too (it keeps
// the // grip and a widget's panel icon); a style the reader chose is never replaced.
func TestResolveCategoryHeader(t *testing.T) {
	cases := []struct{ style, theme, want string }{
		{"theme", "look-confetti-dark", "theme"},
		{"theme", "look-confetti-light", "theme"},
		{"", "look-confetti-dark", "theme"},
		{"theme", "slate-dark", "theme"},
		{"theme", "gloss-liquid-chrome-dark", "theme"},
		{"boxed", "look-confetti-dark", "boxed"},
		{"underlined", "slate-dark", "underlined"},
		{"clean", "slate-dark", "clean"},
		{"nonsense", "look-confetti-dark", "theme"},
	}
	for _, c := range cases {
		if got := resolveCategoryHeader(c.style, c.theme); got != c.want {
			t.Errorf("resolveCategoryHeader(%q, %q) = %q, want %q", c.style, c.theme, got, c.want)
		}
	}
}

// The settings still say "theme": the choice is the reader's, the resolution is
// the page's.
func TestResolveCategoryHeaderKeepsTheStoredWord(t *testing.T) {
	got := gridSettings(t, gridFile(map[string]any{"theme": "look-confetti-dark"}))
	if got.CategoryHeaderStyle != categoryHeaderThemeOwn {
		t.Errorf("stored header style = %q, want %q", got.CategoryHeaderStyle, categoryHeaderThemeOwn)
	}
}
