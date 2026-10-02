package app

import (
	"strings"
	"testing"
)

// Every built-in theme has a backdrop that was chosen for it: an entry for its
// pair in themeBackdropChoice, or a recipe of its own in the Backdrop field.
func TestEveryBuiltInThemeHasAChosenBackdrop(t *testing.T) {
	for id, tc := range getDefaultBuiltInThemes() {
		key := themeBackdropHashID(id)
		if _, ok := themeBackdropChoice[key]; !ok && themeBackdropRecipeIndex(tc.Backdrop) < 0 {
			t.Errorf("%s has no entry for %s and no Backdrop of its own", id, key)
		}
	}
}

func TestEveryChosenBackdropIsARecipe(t *testing.T) {
	for key, recipe := range themeBackdropChoice {
		if themeBackdropRecipeIndex(recipe) < 0 {
			t.Errorf("%s is given %q, which is not a recipe", key, recipe)
		}
		if recipe != strings.ToLower(recipe) {
			t.Errorf("%s: %q should be written in lower case", key, recipe)
		}
	}
}

// A pair is one theme in two colourings, and a reader switching between them
// should see the same shape change colour.
func TestBothHalvesOfAPairGetTheSameRecipe(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for key, recipe := range themeBackdropChoice {
		for _, id := range []string{key, strings.TrimSuffix(key, "-light") + "-dark"} {
			tc, ok := themes[id]
			if !ok {
				t.Errorf("%s is missing from the built-in themes", id)
				continue
			}
			got := themeBackdropRecipes[themeBackdropRecipeFor(themeBackdropHashID(id), tc)]
			if got != recipe {
				t.Errorf("%s draws %q, the choice for %s is %q", id, got, key, recipe)
			}
		}
	}
}

// Spread: no recipe is a theme's alone and none is the whole library's.
func TestChosenBackdropsAreSpreadAcrossTheRecipes(t *testing.T) {
	uses := map[string]int{}
	for _, recipe := range themeBackdropChoice {
		uses[recipe]++
	}
	for _, name := range themeBackdropRecipes {
		if n := uses[name]; n < 3 || n > 10 {
			t.Errorf("%s is used by %d pairs, want 3 to 10", name, n)
		}
	}
}

// A theme that was renamed or removed leaves an entry nobody will notice.
func TestNoChoiceIsLeftForAThemeThatIsGone(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for key := range themeBackdropChoice {
		if !strings.HasSuffix(key, "-light") {
			t.Errorf("%s: pairs are keyed by their -light id", key)
			continue
		}
		if _, ok := themes[key]; !ok {
			t.Errorf("%s has an entry but no theme", key)
		}
		if _, ok := themes[strings.TrimSuffix(key, "-light")+"-dark"]; !ok {
			t.Errorf("%s has an entry but no dark half", key)
		}
	}
	// Every pair has an entry, so the count of entries is the count of pairs.
	pairs := map[string]bool{}
	for id := range themes {
		pairs[themeBackdropHashID(id)] = true
	}
	if len(themeBackdropChoice) != len(pairs) {
		t.Errorf("%d entries for %d pairs", len(themeBackdropChoice), len(pairs))
	}
}

// A theme that names a recipe itself, which is how a custom theme chooses one,
// still wins over the choice made for a built-in of the same id.
func TestAThemeOwnBackdropBeatsTheChoice(t *testing.T) {
	const key = "absinthe-light"
	if themeBackdropChoice[key] == "" {
		t.Skip("absinthe has no entry")
	}
	own := "waves"
	if themeBackdropChoice[key] == own {
		own = "mesh"
	}
	got := themeBackdropRecipes[themeBackdropRecipeFor(key, ThemeColors{Backdrop: own})]
	if got != own {
		t.Errorf("own backdrop %q lost to the choice, drew %q", own, got)
	}
}
