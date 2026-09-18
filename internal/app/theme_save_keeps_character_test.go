package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/*
Saving the colours used to drop every field that is not a flat colour: the
sanitiser rebuilt each theme from the colour fields alone. One edit in the
theme editor therefore stripped the character -- corners, glass, glow, label
style, the info accent -- from every theme in colors.json, and loading only
ever put the primary accent back.
*/

// A built-in theme that ships with at least one character field set.
func builtInWithCharacter(t *testing.T) (string, ThemeColors) {
	t.Helper()
	for id, tc := range getDefaultBuiltInThemes() {
		if tc.RadiusScale != 0 || tc.LabelTransform != "" || tc.SurfaceAlpha != 0 {
			return id, tc
		}
	}
	t.Skip("no built-in theme declares a character field")
	return "", ThemeColors{}
}

func TestSavingColoursKeepsEveryThemeField(t *testing.T) {
	custom := ThemeColors{
		Name:              "Mine",
		TextPrimary:       "#eeeeee",
		BackgroundPrimary: "#111111",
		AccentSuccess:     "#22aa55",
		AccentPrimary:     "#aa2255",
		AccentInfo:        "#2255aa",
		SurfaceStep:       1.4,
		SurfaceAlpha:      0.5,
		SurfaceBlur:       12,
		SurfaceGlow:       -1,
		RadiusScale:       0.05,
		LabelTransform:    "uppercase",
		LabelSpacing:      "0.12em",
		LabelWeight:       650,
	}
	got := sanitizeThemeColors(custom)

	if got.AccentInfo != "#2255aa" || got.AccentPrimary != "#aa2255" {
		t.Fatalf("accents lost: primary %q info %q", got.AccentPrimary, got.AccentInfo)
	}
	if got.SurfaceStep != 1.4 || got.SurfaceAlpha != 0.5 || got.SurfaceBlur != 12 {
		t.Fatalf("surface fields lost: %+v", got)
	}
	if got.SurfaceGlow != -1 {
		t.Fatalf("an explicit no-glow became %v", got.SurfaceGlow)
	}
	if got.RadiusScale != 0.05 || got.LabelTransform != "uppercase" || got.LabelSpacing != "0.12em" {
		t.Fatalf("shape or label fields lost: %+v", got)
	}
	if got.LabelWeight != 600 {
		t.Fatalf("label weight = %d, want 600 (rounded to a weight the fonts carry)", got.LabelWeight)
	}
}

func TestSavingColoursHoldsCharacterToItsRange(t *testing.T) {
	got := sanitizeThemeColors(ThemeColors{
		SurfaceStep:    9,
		SurfaceAlpha:   0.01,
		SurfaceBlur:    500,
		SurfaceGlow:    4,
		RadiusScale:    7,
		LabelTransform: "capitalize; color: red",
		LabelSpacing:   "3px",
		LabelWeight:    950,
		AccentInfo:     "url(javascript:alert(1))",
	})
	want := ThemeColors{
		SurfaceStep:  1.8,
		SurfaceAlpha: 0.3,
		SurfaceBlur:  32,
		SurfaceGlow:  1,
		RadiusScale:  1.6,
	}
	if got.SurfaceStep != want.SurfaceStep || got.SurfaceAlpha != want.SurfaceAlpha ||
		got.SurfaceBlur != want.SurfaceBlur || got.SurfaceGlow != want.SurfaceGlow ||
		got.RadiusScale != want.RadiusScale {
		t.Fatalf("not clamped: %+v", got)
	}
	if got.LabelTransform != "" || got.LabelSpacing != "" || got.LabelWeight != 0 {
		t.Fatalf("invalid label values kept: %q %q %d", got.LabelTransform, got.LabelSpacing, got.LabelWeight)
	}
	if got.AccentInfo == "url(javascript:alert(1))" {
		t.Fatal("a non-colour reached the info accent")
	}
}

func TestAnEditedColourSaveLeavesTheBuiltInCharacterIntact(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	id, shipped := builtInWithCharacter(t)

	store := NewStore()
	colors := store.GetColors()
	// What the editor posts back: the whole set, through the handler's sanitiser.
	colors.Custom["theme-x"] = ThemeColors{Name: "x", BackgroundPrimary: "#000000", TextPrimary: "#ffffff"}
	if err := store.SaveColors(sanitizeColorTheme(colors)); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(ResolveDataDir(), "colors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var onDisk ColorTheme
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatal(err)
	}
	kept := onDisk.BuiltIn[id]
	if kept.RadiusScale != shipped.RadiusScale || kept.LabelTransform != shipped.LabelTransform ||
		kept.SurfaceAlpha != shipped.SurfaceAlpha {
		t.Fatalf("%s lost its character on save: got %+v, shipped %+v", id, kept, shipped)
	}
}

func TestAStrippedInstallGetsTheBuiltInCharacterBack(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	id, shipped := builtInWithCharacter(t)

	// colors.json as an older release left it: the colours of a built-in
	// theme, with a colour of the reader's own, and no character at all.
	stripped := ThemeColors{
		Name:              shipped.Name,
		TextPrimary:       "#123456",
		BackgroundPrimary: shipped.BackgroundPrimary,
		AccentSuccess:     shipped.AccentSuccess,
	}
	if err := os.MkdirAll(ResolveDataDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(ColorTheme{BuiltIn: map[string]ThemeColors{id: stripped}})
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "colors.json"), body, 0o644); err != nil {
		t.Fatal(err)
	}

	got := NewStore().GetColors().BuiltIn[id]
	if got.RadiusScale != shipped.RadiusScale || got.LabelTransform != shipped.LabelTransform ||
		got.SurfaceAlpha != shipped.SurfaceAlpha || got.LabelWeight != shipped.LabelWeight {
		t.Fatalf("%s character not restored: got %+v, shipped %+v", id, got, shipped)
	}
	if got.TextPrimary != "#123456" {
		t.Fatalf("the reader's own colour was overwritten: %q", got.TextPrimary)
	}
}

func TestAThemeCanPickItsBackdrop(t *testing.T) {
	tc := ThemeColors{BackgroundPrimary: "#101010", AccentSuccess: "#22aa55"}
	hashed := themeBackdropImage("theme-abc", tc)

	seen := map[string]bool{}
	for _, name := range themeBackdropRecipes {
		tc.Backdrop = name
		seen[themeBackdropImage("theme-abc", tc)] = true
	}
	if len(seen) != len(themeBackdropRecipes) {
		t.Fatalf("%d recipes drew %d different backdrops", len(themeBackdropRecipes), len(seen))
	}
	if !seen[hashed] {
		t.Fatal("the hashed backdrop is not one of the named recipes")
	}

	// Unset, or a name nobody knows, keeps the hashed one.
	tc.Backdrop = ""
	if themeBackdropImage("theme-abc", tc) != hashed {
		t.Fatal("an unset backdrop changed the hashed recipe")
	}
	if got := sanitizeThemeColors(ThemeColors{Backdrop: "Rings"}).Backdrop; got != "rings" {
		t.Fatalf("backdrop = %q, want rings", got)
	}
	if got := sanitizeThemeColors(ThemeColors{Backdrop: "url(x)"}).Backdrop; got != "" {
		t.Fatalf("an unknown backdrop was kept: %q", got)
	}
}
