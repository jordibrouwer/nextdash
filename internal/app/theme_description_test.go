package app

import (
	"regexp"
	"testing"
	"unicode/utf8"
)

// Every family has a line, and no line is written for a family that does not
// exist. Both halves of that check matter: the first is the feature, the
// second is what catches a rename.
func TestEveryFamilyHasADescription(t *testing.T) {
	families := map[string]bool{}
	for id := range getDefaultBuiltInThemes() {
		families[themeFamilyOf(id)] = true
	}
	if len(families) == 0 {
		t.Fatal("no built-in themes found")
	}
	for family := range families {
		if themeDescriptions[family] == "" {
			t.Errorf("%s has no description", family)
		}
	}
	for family := range themeDescriptions {
		if !families[family] {
			t.Errorf("a description is written for %q, which is not a family", family)
		}
	}
}

// Both halves of a family share one line, which is the reason it is keyed by
// family at all.
func TestBothHalvesShareOneDescription(t *testing.T) {
	dark, light := themeDescription("paper-ink-dark"), themeDescription("paper-ink-light")
	if dark == "" || dark != light {
		t.Errorf("the halves of paper-ink read %q and %q", dark, light)
	}
	if themeDescription("something-nobody-wrote") != "" {
		t.Errorf("an unknown theme should have no description")
	}
}

// House rules from the comment above the map, enforced rather than hoped for:
// short enough for a card, and no sentence-ending full stop to line up badly
// against the ones that have none.
func TestDescriptionsStayShort(t *testing.T) {
	trailing := regexp.MustCompile(`[.\s]$`)
	for family, line := range themeDescriptions {
		if n := utf8.RuneCountInString(line); n > 72 {
			t.Errorf("%s: %d characters, the card fits about 70", family, n)
		}
		if trailing.MatchString(line) {
			t.Errorf("%s: ends with a stop or a space: %q", family, line)
		}
	}
}
