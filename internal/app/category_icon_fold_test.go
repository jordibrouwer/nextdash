package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writePageFile(t *testing.T, id int, page PageWithBookmarks) {
	t.Helper()
	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "bookmarks-"+strconv.Itoa(id)+".json"), body, 0644); err != nil {
		t.Fatal(err)
	}
}

// The icon field is gone. What a category had in it goes to the front of its
// name, once: an emoji as text, an uploaded icon as :file:. Nobody loses an
// icon, and the field is empty afterwards.
func TestCategoryIconsFoldIntoTheName(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	writePageFile(t, 1, PageWithBookmarks{
		Page: Page{ID: 1, Name: "Main"},
		Categories: []Category{
			{ID: "media", Name: "Media", Icon: "📺"},
			{ID: "docker", Name: "Docker", Icon: "docker-abc.svg"},
			{ID: "plain", Name: "Plain"},
		},
	})
	writePageFile(t, 2, PageWithBookmarks{
		Page:       Page{ID: 2, Name: "Two"},
		Categories: []Category{{ID: "tools", Name: "Tools", Icon: "🔧"}},
	})

	store := NewStore()
	names := map[string]string{}
	for _, page := range []int{1, 2} {
		for _, c := range store.GetCategoriesByPage(page) {
			if c.Icon != "" {
				t.Errorf("%s still has icon %q", c.ID, c.Icon)
			}
			names[c.ID] = c.Name
		}
	}
	want := map[string]string{"media": "📺 Media", "docker": ":docker-abc.svg: Docker", "plain": "Plain", "tools": "🔧 Tools"}
	for id, name := range want {
		if names[id] != name {
			t.Errorf("%s is %q, want %q", id, names[id], name)
		}
	}

	// A second start finds nothing left to fold.
	again := NewStore()
	for _, c := range again.GetCategoriesByPage(1) {
		if c.ID == "media" && c.Name != "📺 Media" {
			t.Errorf("the second start changed media to %q", c.Name)
		}
	}
}

// Saving a category never writes an icon back.
func TestSavingACategoryDropsTheIconField(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	pageID := store.GetPages()[0].ID
	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "x", Name: "X", Icon: "🔧"}}); err != nil {
		t.Fatal(err)
	}
	for _, c := range store.GetCategoriesByPage(pageID) {
		if c.ID == "x" && (c.Icon != "" || c.Name != "🔧 X") {
			t.Errorf("a saved category came back as name %q icon %q", c.Name, c.Icon)
		}
	}
}
