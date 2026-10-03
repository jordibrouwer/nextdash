package app

import "testing"

func TestThemeMetaMarksOwnAndRecoloured(t *testing.T) {
	builtIns := getDefaultBuiltInThemes()
	var id string
	var shipped ThemeColors
	for k, v := range builtIns {
		id, shipped = k, v
		break
	}
	changed := shipped
	changed.AccentSuccess = "#123456"

	own := themeMetaFor("theme-1", ThemeColors{Name: "Mine", BackgroundPrimary: "#111111"})
	markThemeMetaOrigin(&own, ThemeColors{}, nil, true)
	if !own.Own || own.Recoloured {
		t.Fatalf("custom: own=%v recoloured=%v", own.Own, own.Recoloured)
	}

	same := themeMetaFor(id, shipped)
	markThemeMetaOrigin(&same, shipped, &shipped, false)
	if same.Own || same.Recoloured {
		t.Fatalf("untouched built-in marked: %+v", same)
	}

	recoloured := themeMetaFor(id, changed)
	markThemeMetaOrigin(&recoloured, changed, &shipped, false)
	if !recoloured.Recoloured {
		t.Fatal("a changed built-in is not marked recoloured")
	}

	renamed := shipped
	renamed.Name = "Something else"
	r := themeMetaFor(id, renamed)
	markThemeMetaOrigin(&r, renamed, &shipped, false)
	if r.Recoloured {
		t.Fatal("a new name alone is not a recolour")
	}
}
