package app

import "testing"

func TestCategoryViewWordsNormalise(t *testing.T) {
	for in, want := range map[string]string{
		"": "", "rows": "", "tiles": "tiles", " Tiles ": "tiles", "grid": "",
	} {
		if got := normalizeCategoryView(in); got != want {
			t.Errorf("view %q = %q, want %q", in, got, want)
		}
	}
}

// A category without the field is rows, and tiles survive a save and a read.
func TestCategoryViewIsKeptOnSave(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	pageID := store.GetPages()[0].ID

	err := store.SaveCategoriesByPage(pageID, []Category{
		{ID: "media", Name: "Media", View: "tiles"},
		{ID: "work", Name: "Work"},
		{ID: "odd", Name: "Odd", View: "carousel"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, c := range store.GetCategoriesByPage(pageID) {
		got[c.ID] = c.View
	}
	if got["media"] != "tiles" || got["work"] != "" || got["odd"] != "" {
		t.Errorf("views after a save: %+v", got)
	}
}
