package app

import (
	"strings"
	"testing"
)

func TestNormalizeNeutralAccent(t *testing.T) {
	for in, want := range map[string]string{
		"blue": "blue", " Teal ": "teal", "VIOLET": "violet", "rose": "rose", "amber": "amber", "green": "green",
		"theme": "theme", "": "theme", "red": "theme", "#ff0000": "theme",
	} {
		if got := normalizeNeutralAccent(in); got != want {
			t.Errorf("normalizeNeutralAccent(%q) = %q, want %q", in, got, want)
		}
	}
}

// The accent goes on the neutrals and on nothing else, and "theme" leaves
// every base the accent it was drawn with.
func TestApplyNeutralAccentOnlyTouchesTheNeutrals(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for id, tc := range themes {
		got := applyNeutralAccent(tc, "rose")
		if tc.Collection == "neutrals" {
			if got.AccentPrimary == tc.AccentPrimary {
				t.Errorf("%s kept its own accent under rose", id)
			}
		} else if got.AccentPrimary != tc.AccentPrimary {
			t.Errorf("%s is not a neutral and its accent changed to %s", id, got.AccentPrimary)
		}
		if same := applyNeutralAccent(tc, "theme"); same.AccentPrimary != tc.AccentPrimary {
			t.Errorf("%s changed under \"theme\"", id)
		}
	}
}

// Every colour word reads on every neutral base, light and dark: the same
// floor the neutrals are held to without it.
func TestNeutralAccentsReadOnEveryBase(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for id, tc := range themes {
		if tc.Collection != "neutrals" {
			continue
		}
		bg, ok := parseHexColor(tc.BackgroundPrimary)
		if !ok {
			t.Fatalf("%s: background %q", id, tc.BackgroundPrimary)
		}
		for _, word := range neutralAccentOrder {
			accent := applyNeutralAccent(tc, word).AccentPrimary
			fg, ok := parseHexColor(accent)
			if !ok {
				t.Errorf("%s under %s: accent %q is not a colour", id, word, accent)
				continue
			}
			if got := contrastRatio(fg, bg); got < 4.5 {
				t.Errorf("%s under %s: accent %s is %.1f:1 on the page, want at least 4.5", id, word, accent, got)
			}
			if card, ok := parseHexColor(tc.BackgroundSecondary); ok {
				if got := contrastRatio(fg, card); got < 4.5 {
					t.Errorf("%s under %s: accent %s is %.1f:1 on the card, want at least 4.5", id, word, accent, got)
				}
			}
		}
	}
}

// The stylesheet carries the reader's accent for a neutral and leaves other
// themes alone, and the memo does not hand back the old one.
func TestThemeCSSMemoFollowsTheAccent(t *testing.T) {
	h := &Handlers{store: NewStore()}
	plain := h.customThemeCSSSeeded(0, neutralAccentTheme)
	rose := h.customThemeCSSSeeded(0, "rose")
	if plain == rose {
		t.Fatal("the memo handed back the stylesheet of the other accent")
	}
	if again := h.customThemeCSSSeeded(0, neutralAccentTheme); again != plain {
		t.Error("the memo lost the plain stylesheet after a rose one")
	}
}

// The stylesheet carries the reader's accent for a neutral and leaves other
// themes alone.
func TestThemeCSSCarriesTheNeutralAccent(t *testing.T) {
	h := &Handlers{store: NewStore()}
	plain := h.renderThemeCSS(0, neutralAccentTheme)
	rose := h.renderThemeCSS(0, "rose")
	block := func(css, id string) string {
		start := strings.Index(css, `html[data-theme="`+id+`"] {`)
		if start < 0 {
			t.Fatalf("no block for %s", id)
		}
		end := strings.Index(css[start:], "}")
		return css[start : start+end]
	}
	if block(plain, "slate-dark") == block(rose, "slate-dark") {
		t.Error("a neutral theme drew the same under rose")
	}
	if block(plain, "gloss-jade-dark") != block(rose, "gloss-jade-dark") {
		t.Error("a theme outside the neutrals changed under rose")
	}
}
