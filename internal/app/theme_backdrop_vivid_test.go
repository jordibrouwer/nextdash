package app

import (
	"strings"
	"testing"
)

// The three colour-burst recipes exist, draw differently from each other, and
// are drawn in the theme's own colours.
func TestVividBackdropRecipes(t *testing.T) {
	looks := map[string]string{}
	for _, name := range []string{"burst", "splash", "leak"} {
		if themeBackdropRecipeIndex(name) < 0 {
			t.Fatalf("recipe %q is not in themeBackdropRecipes", name)
		}
		look := themeBackdropSeeded("recipe:"+name, ThemeColors{Backdrop: name, AccentPrimary: "var"}, 0)
		if look.Image == "" || look.Size == "" || look.Position == "" {
			t.Errorf("%s: an empty look %+v", name, look)
		}
		looks[name] = look.Image
	}
	if looks["burst"] == looks["splash"] || looks["splash"] == looks["leak"] || looks["burst"] == looks["leak"] {
		t.Errorf("two of the colour-burst recipes draw the same thing")
	}
}

// A recipe a theme does not name is taken from the hash of its id, and adding
// recipes must not move any theme that was already on one: only the ones a
// hash could reach before may be reached by it now.
func TestNewRecipesAreNotReachedByTheHash(t *testing.T) {
	reachable := themeBackdropHashedRecipes
	for _, name := range []string{"burst", "splash", "leak"} {
		if themeBackdropRecipeIndex(name) < reachable {
			t.Errorf("%s sits inside the hashed range and would move other themes", name)
		}
	}
	for id := range getDefaultBuiltInThemes() {
		got := pick23(fnv32(themeBackdropHashID(id)))
		if got < 0 || got >= reachable {
			t.Errorf("%s hashes to recipe %d, outside the first %d", id, got, reachable)
		}
	}
}

// A colour burst is the loudest thing on the page, so it brings a floor of
// theme tint with it -- the automatic scrim that keeps text readable -- and the
// quiet recipes bring none.
func TestVividRecipesCarryAScrimFloor(t *testing.T) {
	for name, want := range map[string]string{"burst": "0.24", "splash": "0.22", "leak": "0.2", "blooms": "0", "mesh": "0"} {
		look := themeBackdropSeeded("recipe:"+name, ThemeColors{Backdrop: name, AccentPrimary: "var"}, 0)
		if look.Scrim != want {
			t.Errorf("%s: scrim %q, want %q", name, look.Scrim, want)
		}
	}
	css := themeBackdropOverrideCSS(0)
	if !strings.Contains(css, `html body[data-backdrop-recipe="burst"] {`) || !strings.Contains(css, "--theme-backdrop-scrim: 0.24;") {
		t.Error("the override rule for burst does not carry its scrim floor")
	}
}
