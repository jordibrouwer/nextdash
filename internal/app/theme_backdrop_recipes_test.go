package app

import (
	"strings"
	"testing"
)

// splitBackdropList splits a CSS comma list at the top level only: the commas
// inside gradient(), calc() and var() belong to those and not to the list.
func splitBackdropList(list string) []string {
	var parts []string
	depth, start := 0, 0
	for i, r := range list {
		switch r {
		case '(':
			depth++
		case ')':
			depth--
		case ',':
			if depth == 0 {
				parts = append(parts, strings.TrimSpace(list[start:i]))
				start = i + 1
			}
		}
	}
	return append(parts, strings.TrimSpace(list[start:]))
}

// TestEveryBackdropRecipeIsWellFormed holds all recipes to the same contract:
// something is drawn, every layer is a real image layer (a bare colour is not
// a valid background-image), and size and position carry exactly one entry per
// layer, because theme-backdrop.css hands them out by index.
func TestEveryBackdropRecipeIsWellFormed(t *testing.T) {
	if len(themeBackdropRecipes) != 26 {
		t.Fatalf("%d recipes, want 26", len(themeBackdropRecipes))
	}
	for _, name := range themeBackdropRecipes {
		t.Run(name, func(t *testing.T) {
			tc := ThemeColors{Backdrop: name, AccentPrimary: "#39FF6A", AccentError: "#FF3968", BackgroundPrimary: "#050705"}
			look := themeBackdropImage("theme-"+name, tc)
			if look.Image == "" || look.Size == "" || look.Position == "" {
				t.Fatalf("empty output: %+v", look)
			}
			images := splitBackdropList(look.Image)
			for _, layer := range images {
				if !strings.Contains(layer, "gradient(") || strings.HasPrefix(layer, "var(") || strings.HasPrefix(layer, "#") {
					t.Errorf("layer is not an image: %q", layer)
				}
			}
			if sizes := splitBackdropList(look.Size); len(sizes) != len(images) {
				t.Errorf("%d sizes for %d layers: %s", len(sizes), len(images), look.Size)
			}
			if positions := splitBackdropList(look.Position); len(positions) != len(images) {
				t.Errorf("%d positions for %d layers: %s", len(positions), len(images), look.Position)
			}
		})
	}
}

func TestEveryArchetypeBindsARecipe(t *testing.T) {
	want := map[string]string{
		"glass": "mesh", "frost": "bokeh", "paper": "topo", "ink": "halftone",
		"carbon": "hexagons", "terminal": "perspective", "neon": "prism",
		"velvet": "nebula", "brushed": "pinstripe", "enamel": "dunes",
		"lacquer": "sweep", "aurora": "blooms",
	}
	if len(want) != len(themeArchetypes) {
		t.Fatalf("%d archetypes, test knows %d", len(themeArchetypes), len(want))
	}
	for name, recipe := range want {
		if got := archetypeBackdrop(ThemeColors{Character: name}); got != recipe {
			t.Errorf("%s binds %q, want %q", name, got, recipe)
		}
		if themeBackdropRecipeIndex(recipe) < 0 {
			t.Errorf("%s binds %q, which is not a recipe", name, recipe)
		}
	}
	// A theme's own choice still wins over its archetype.
	if got := archetypeBackdrop(ThemeColors{Character: "glass", Backdrop: "waves"}); got != "waves" {
		t.Errorf("own backdrop lost to the archetype: %q", got)
	}
}

// TestBackdropSeedMovesPositionsNotTheRecipe: the seed is a different roll of
// the same shape. The recipe shows in the tile sizes, which no seed touches,
// so equal sizes with different images is "same recipe, moved".
func TestBackdropSeedMovesPositionsNotTheRecipe(t *testing.T) {
	tc := ThemeColors{AccentPrimary: "#39FF6A", AccentError: "#FF3968", BackgroundPrimary: "#050705"}
	if themeBackdropSeeded("theme-abc", tc, 0) != themeBackdropImage("theme-abc", tc) {
		t.Fatal("seed 0 is not the backdrop an id has always had")
	}
	moved := 0
	for _, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p"} {
		plain := themeBackdropSeeded(id, tc, 0)
		rolled := themeBackdropSeeded(id, tc, 7)
		if plain.Size != rolled.Size {
			t.Errorf("%s: seed changed the recipe: %q -> %q", id, plain.Size, rolled.Size)
		}
		if plain.Image != rolled.Image {
			moved++
		}
	}
	if moved == 0 {
		t.Error("no seed moved anything")
	}
}
