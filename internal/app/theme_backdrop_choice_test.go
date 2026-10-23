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
	for i, name := range themeBackdropRecipes {
		n := uses[name]
		if i >= themeBackdropHashedRecipes {
			// The colour-burst recipes are chosen by the looks written for them,
			// not by the older pairs; they only may not be the whole library's.
			if n > 10 {
				t.Errorf("%s is used by %d pairs, want at most 10", name, n)
			}
			continue
		}
		if n < 2 || n > 10 {
			t.Errorf("%s is used by %d pairs, want 2 to 10", name, n)
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
	// Every pair has an entry, so the count of entries is the count of pairs --
	// leaving out a look that names its own recipe and was never given one.
	pairs := map[string]bool{}
	for id, tc := range themes {
		key := themeBackdropHashID(id)
		if _, chosen := themeBackdropChoice[key]; !chosen && themeBackdropRecipeIndex(tc.Backdrop) >= 0 {
			continue
		}
		pairs[key] = true
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

// A material is drawn behind the backdrops of its own pool. The choice for a
// pair has to be one of them, so two paper themes can differ and both are paper.
func TestEveryChoiceComesFromThePoolOfItsMaterial(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	for key, recipe := range themeBackdropChoice {
		for _, id := range []string{key, strings.TrimSuffix(key, "-light") + "-dark"} {
			material := materialAttr(themes[id])
			if !themeBackdropInPool(material, recipe) {
				t.Errorf("%s (%s) is drawn behind %q, which is not in the pool of %s", id, material, recipe, material)
			}
		}
	}
}

// Every name in a pool is a recipe, and every material has a pool.
func TestThePoolsAreMadeOfRecipes(t *testing.T) {
	for _, material := range themeArchetypeOrder {
		pool := themeBackdropPoolFor(material)
		if len(pool) < 6 {
			t.Errorf("%s has %d recipes in its pool, want at least 6", material, len(pool))
		}
		for _, name := range pool {
			if themeBackdropRecipeIndex(name) < 0 {
				t.Errorf("%s pools %q, which is not a recipe", material, name)
			}
		}
	}
}
