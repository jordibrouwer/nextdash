package app

import (
	"strings"
	"testing"
)

func TestNormalizeCategoryDividers(t *testing.T) {
	got := normalizeCategoryDividers([]CategoryDivider{
		{ID: "a", Name: "  Media ", Index: 3},
		{ID: "b", Name: "   ", Index: 1},
		{ID: "a", Name: "Beheer", Index: -4},
		{Name: strings.Repeat("é", 200), Index: 3},
	})
	if len(got) != 3 {
		t.Fatalf("want 3 dividers (empty name dropped), got %d: %+v", len(got), got)
	}
	if got[0].Name != "Beheer" || got[0].Index != 0 {
		t.Errorf("negative slot not lifted and sorted first: %+v", got[0])
	}
	if got[1].Name != "Media" || got[1].ID != "a" {
		t.Errorf("name not trimmed or first id lost: %+v", got[1])
	}
	if got[0].ID == got[1].ID || got[1].ID == got[2].ID || got[0].ID == got[2].ID || got[0].ID == "" || got[2].ID == "" {
		t.Errorf("ids must be unique and non-empty: %+v", got)
	}
	if n := len([]rune(got[2].Name)); n != maxCategoryDividerName {
		t.Errorf("name cut by runes to %d, got %d", maxCategoryDividerName, n)
	}
}

func TestNormalizeCategoryDividersCapAndEmpty(t *testing.T) {
	if normalizeCategoryDividers(nil) != nil || normalizeCategoryDividers([]CategoryDivider{{Name: " "}}) != nil {
		t.Error("nothing usable must give nil so the field is omitted")
	}
	many := make([]CategoryDivider, 80)
	for i := range many {
		many[i] = CategoryDivider{Name: "x"}
	}
	if n := len(normalizeCategoryDividers(many)); n != maxCategoryDividers {
		t.Errorf("want cap %d, got %d", maxCategoryDividers, n)
	}
}

// Dividers survive a save and a read, a cleaned-out list is not stored, and the
// bookmark list of the page never carries one.
func TestCategoryDividersAreKeptOnSave(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	pageID := store.GetPages()[0].ID

	err := store.SaveCategoriesByPage(pageID, []Category{
		{ID: "media", Name: "Media", Dividers: []CategoryDivider{{ID: "a", Name: " Beheer ", Index: 2}}},
		{ID: "work", Name: "Work", Dividers: []CategoryDivider{{ID: "b", Name: " "}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][]CategoryDivider{}
	for _, c := range store.GetCategoriesByPage(pageID) {
		got[c.ID] = c.Dividers
	}
	if len(got["media"]) != 1 || got["media"][0].Name != "Beheer" || got["media"][0].Index != 2 {
		t.Errorf("media dividers after a save: %+v", got["media"])
	}
	if got["work"] != nil {
		t.Errorf("a divider with no name must not be stored: %+v", got["work"])
	}
	for _, b := range store.GetBookmarksByPage(pageID) {
		if b.Name == "Beheer" {
			t.Errorf("a divider turned up in the bookmark list: %+v", b)
		}
	}
}
