package app

import (
	"encoding/json"
	"strings"
	"testing"
)

/*
A collection's place on a page is stored in that page's block order.

The server cannot say whether a collection renders there -- that is the page
list, a show switch and whether anything matches -- so it keeps the id where
the order put it and leaves the deciding to the dashboard, which skips an id
that draws nothing.
*/
func TestResolveBlockOrderKeepsCollectionIds(t *testing.T) {
	categories := []Category{{ID: "development"}, {ID: "media"}}
	widgets := []Widget{{ID: "w_one"}}

	got := resolveBlockOrder([]string{"development", "__smart_stale__", "custom:abc", "w_one", "tag:home", "media"}, categories, widgets)
	want := "development,__smart_stale__,custom:abc,w_one,tag:home,media"
	if strings.Join(got, ",") != want {
		t.Errorf("order = %v, want %s", got, want)
	}
}

// Keeping collection ids is not keeping everything: an id that is neither a
// block on the page nor a collection is still dropped.
func TestResolveBlockOrderStillDropsUnknownIdsBesideCollections(t *testing.T) {
	categories := []Category{{ID: "development"}}
	got := resolveBlockOrder([]string{"deleted", "__smart_recent__", "development", "w_gone"}, categories, nil)
	if strings.Join(got, ",") != "__smart_recent__,development" {
		t.Errorf("order = %v", got)
	}
}

func TestResolveBlockOrderNeverRepeatsACollection(t *testing.T) {
	categories := []Category{{ID: "development"}}
	got := resolveBlockOrder([]string{"custom:a", "development", "custom:a", " custom:a "}, categories, nil)
	if strings.Join(got, ",") != "custom:a,development" {
		t.Errorf("order = %v, want one entry per collection", got)
	}
}

// A collection's width and a user collection's page list survive a save and a
// read, through the same merge the settings route uses.
func TestSettingsRoundTripCollectionColumnsAndPageIds(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()

	body := []byte(`{"collectionColumns":{"__smart_stale__":2,"custom:abc":2,"tag:x":1},` +
		`"collections":[{"id":"abc","name":"Mine","logic":"and","rules":[{"field":"tag","operator":"includes","value":"x"}],"pageIds":[3]}]}`)
	merged, err := mergeSettingsFromBody(store.GetSettings(), body)
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	merged.CollectionColumns = normalizeCollectionColumns(merged.CollectionColumns)
	if err := store.SaveSettings(merged); err != nil {
		t.Fatalf("save: %v", err)
	}

	got := NewStore().GetSettings()
	if got.CollectionColumns["__smart_stale__"] != 2 || got.CollectionColumns["custom:abc"] != 2 {
		t.Errorf("collectionColumns = %v", got.CollectionColumns)
	}
	// One column is the default, not a value worth storing.
	if _, kept := got.CollectionColumns["tag:x"]; kept {
		t.Errorf("a one-column entry was stored: %v", got.CollectionColumns)
	}
	if len(got.Collections) != 1 || len(got.Collections[0].PageIds) != 1 || got.Collections[0].PageIds[0] != 3 {
		t.Errorf("collections = %+v, want pageIds [3]", got.Collections)
	}

	// Missing means every page, and stays missing rather than turning into [].
	raw, _ := json.Marshal(Collection{ID: "b", Name: "B"})
	if strings.Contains(string(raw), "pageIds") {
		t.Errorf("an unscoped collection wrote pageIds: %s", raw)
	}
}
