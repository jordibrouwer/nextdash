package app

import (
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

	if len(widgets) != 1 {
		t.Fatalf("seeded widgets = %d, want 1", len(widgets))
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
	if len(order) != len(categories)+1 {
		t.Errorf("block order has %d entries, want %d categories plus the widget",
			len(order), len(categories))
	}
}
