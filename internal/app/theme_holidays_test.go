package app

import "testing"

// The Holidays group: three seasonal pairs that the theme browser files under
// one word, while each keeps a real material underneath.
func TestHolidayThemesFormTheHolidaysGroup(t *testing.T) {
	themes := getDefaultBuiltInThemes()
	families := []string{"holiday-christmas", "holiday-northern-lights", "holiday-gingerbread"}
	for _, family := range families {
		for _, half := range []string{"-dark", "-light"} {
			id := family + half
			tc, ok := themes[id]
			if !ok {
				t.Fatalf("%s is missing", id)
			}
			meta := themeMetaFor(id, tc)
			if meta.Group != "holidays" {
				t.Errorf("%s: group %q, want holidays", id, meta.Group)
			}
			if meta.Character == "" {
				t.Errorf("%s: no material underneath; the page would draw no surface", id)
			}
		}
	}

	count := 0
	for id := range themes {
		if themeGroupFor(id) == "holidays" {
			count++
		}
	}
	if count != len(families)*2 {
		t.Errorf("%d themes in Holidays, want %d", count, len(families)*2)
	}
}

func TestOrdinaryThemesHaveNoGroup(t *testing.T) {
	if g := themeGroupFor("look-ocean-dark"); g != "" {
		t.Errorf("look-ocean-dark: group %q, want none", g)
	}
	found := false
	for _, g := range themeGroupOrder {
		if g == "holidays" {
			found = true
		}
	}
	if !found {
		t.Error("holidays is not in themeGroupOrder, so the browser shows no chip for it")
	}
}
