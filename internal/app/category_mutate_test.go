package app

import (
	"testing"
	"time"
)

// A save that arrives while a mutation is between its read and its write waits
// for the write, so the mutation cannot put back what the save changed.
func TestMutateCategoriesByPageHoldsTheLockFromReadToSave(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	pageID := store.GetPages()[0].ID
	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "media", Name: "Media"}}); err != nil {
		t.Fatal(err)
	}

	renamed := make(chan error, 1)
	err := store.MutateCategoriesByPage(pageID, func(cats []Category) ([]Category, bool) {
		go func() {
			renamed <- store.SaveCategoriesByPage(pageID, []Category{{ID: "media", OriginalID: "media", Name: "Films"}})
		}()
		// Time for the rename to land, were nothing holding it back.
		time.Sleep(100 * time.Millisecond)
		return append([]Category{{ID: "apps", OriginalID: "apps", Name: "Apps"}}, cats...), true
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := <-renamed; err != nil {
		t.Fatal(err)
	}

	for _, c := range store.GetCategoriesByPage(pageID) {
		if c.ID == "media" && c.Name != "Films" {
			t.Fatalf("the rename was undone: %+v", store.GetCategoriesByPage(pageID))
		}
	}
}

// mutate answering false writes nothing.
func TestMutateCategoriesByPageUnchangedWritesNothing(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	pageID := store.GetPages()[0].ID
	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "media", Name: "Media"}}); err != nil {
		t.Fatal(err)
	}
	err := store.MutateCategoriesByPage(pageID, func(cats []Category) ([]Category, bool) {
		return nil, false
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := store.GetCategoriesByPage(pageID); len(got) != 1 || got[0].Name != "Media" {
		t.Fatalf("categories after an unchanged mutate: %+v", got)
	}
}
