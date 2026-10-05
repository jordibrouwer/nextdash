package app

import (
	"encoding/json"
	"os"
	"testing"
)

/*
A fresh install has a widget on its page, not only bookmarks.

A page being able to hold something other than links was a v1.4.0 feature that
nothing on a new install mentioned: widgets were a config section you had to go
looking for, which is a poor way to find out the thing exists. One health block
ships on the seeded page, above the categories it summarises.
*/
func TestFreshInstallSeedsAHealthWidget(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	store := NewStore()

	widgets, order := store.GetPageBlocks(1)

	if len(widgets) != 2 {
		t.Fatalf("seeded widgets = %d, want 2 (health and notes)", len(widgets))
	}
	if widgets[1].Type != WidgetTypeNotes || widgets[1].ID != defaultNotesWidgetID {
		t.Errorf("second seeded widget = %+v, want the notes widget", widgets[1])
	}
	w := widgets[0]
	if w.Type != WidgetTypeHealth {
		t.Errorf("seeded widget type = %q, want %q", w.Type, WidgetTypeHealth)
	}
	if w.ID != defaultHealthWidgetID {
		t.Errorf("seeded widget id = %q, want the fixed %q", w.ID, defaultHealthWidgetID)
	}
	// The prefix is what tells a block id apart from a category slug; a seeded
	// id that failed this would be drawn as a missing category.
	if !isWidgetID(w.ID) {
		t.Errorf("seeded widget id %q does not read as a widget id", w.ID)
	}

	categories := store.GetCategoriesByPage(1)

	// It leads: without an explicit order the widget falls in after every
	// category it is meant to summarise.
	if len(order) == 0 || order[0] != defaultHealthWidgetID {
		t.Fatalf("block order = %v, want the widget first", order)
	}
	// And every category is still placed, or the ones left out would not draw.
	for _, c := range categories {
		found := false
		for _, id := range order {
			if id == c.ID {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("category %q is missing from the block order", c.ID)
		}
	}
	if len(order) != len(categories)+2 {
		t.Errorf("block order has %d entries, want %d categories plus the two widgets",
			len(order), len(categories))
	}
}

// An install that predates the notes widget gets one, once, last on its first
// page; deleting it afterwards is final.
func TestExistingInstallGetsANotesWidgetOnce(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	fs := NewStore().(*FileStore)
	// As an install updated from before the widget: only health, no marker.
	if err := fs.SavePageBlocks(1, []Widget{{ID: defaultHealthWidgetID, Type: WidgetTypeHealth, Config: map[string]any{}}},
		[]string{defaultHealthWidgetID}); err != nil {
		t.Fatal(err)
	}
	clearMigrationMarker(t, fs, "notesWidgetSeeded")

	fs.migrateNotesWidgetOnFirstPage()
	widgets, order := fs.GetPageBlocks(1)
	if len(widgets) != 2 || widgets[1].Type != WidgetTypeNotes {
		t.Fatalf("widgets after the migration = %+v, want health then notes", widgets)
	}
	if order[len(order)-1] != defaultNotesWidgetID {
		t.Errorf("block order = %v, want the notes widget last", order)
	}

	// Deleted by the reader, and not brought back by the next start.
	if err := fs.SavePageBlocks(1, widgets[:1], order[:len(order)-1]); err != nil {
		t.Fatal(err)
	}
	fs.migrateNotesWidgetOnFirstPage()
	if after, _ := fs.GetPageBlocks(1); len(after) != 1 {
		t.Errorf("the migration ran twice: %d widgets", len(after))
	}
}

func TestNotesMigrationSkipsAnInstallThatAlreadyHasOne(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	fs := NewStore().(*FileStore)
	mine := Widget{ID: "w_mine00000001", Type: WidgetTypeNotes, Config: map[string]any{"text": "keep me"}}
	if err := fs.SavePageBlocks(1, []Widget{mine}, []string{mine.ID}); err != nil {
		t.Fatal(err)
	}
	clearMigrationMarker(t, fs, "notesWidgetSeeded")

	fs.migrateNotesWidgetOnFirstPage()
	widgets, _ := fs.GetPageBlocks(1)
	if len(widgets) != 1 || widgets[0].ID != mine.ID {
		t.Fatalf("widgets = %+v, want only the one the reader made", widgets)
	}
}

func clearMigrationMarker(t *testing.T, fs *FileStore, key string) {
	t.Helper()
	raw, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	delete(m, key)
	out, _ := json.Marshal(m)
	_ = os.WriteFile(fs.settingsFile, out, 0o644)
}
