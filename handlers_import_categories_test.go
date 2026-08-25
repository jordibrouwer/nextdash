package main

import "testing"

/*
Category resolution for every importer.

Two collections' worth of real-world names, and both used to be lost:

A name with nothing sluggable in it -- an emoji folder, a Chinese one, a French
one that is all accents -- produced an empty id, and the old code skipped it. No
category was created, every bookmark in it landed uncategorised, and the name it
arrived with was gone. There is nothing to recover it from afterwards.

Two different names collapsing into one category is the other half. Raindrop
allows the same collection name under different parents, and any two names
differing only in punctuation slugify identically -- so two lists the reader
deliberately keeps apart merged into one, silently.
*/
func TestResolveImportCategoriesKeepsNamesWithNothingSluggable(t *testing.T) {
	rows := []ImportedRow{
		{Category: "📚"},
		{Category: "读书"},
		{Category: "Reading"},
	}
	nameToID, created := resolveImportCategories(nil, rows)

	for _, name := range []string{"📚", "读书", "Reading"} {
		id, ok := nameToID[name]
		if !ok || id == "" {
			t.Errorf("%q got no category id", name)
		}
	}
	if nameToID["📚"] == nameToID["读书"] {
		t.Errorf("two unsluggable names share the id %q", nameToID["📚"])
	}
	if len(created) != 3 {
		t.Fatalf("created %d categories, want 3", len(created))
	}
	// The reader sees the name; the id only has to be stable and unique.
	byID := map[string]string{}
	for _, c := range created {
		byID[c.ID] = c.Name
	}
	if byID[nameToID["📚"]] != "📚" {
		t.Errorf("the emoji folder lost its name: %q", byID[nameToID["📚"]])
	}
	if byID[nameToID["读书"]] != "读书" {
		t.Errorf("the Chinese folder lost its name: %q", byID[nameToID["读书"]])
	}
}

// Names that slugify the same are still different categories.
func TestResolveImportCategoriesDoesNotMergeDifferentNames(t *testing.T) {
	rows := []ImportedRow{{Category: "Reading"}, {Category: "Reading 2"}, {Category: "reading!"}}
	nameToID, created := resolveImportCategories(nil, rows)

	seen := map[string]string{}
	for name, id := range nameToID {
		if other, clash := seen[id]; clash {
			t.Errorf("%q and %q both resolved to %q", name, other, id)
		}
		seen[id] = name
	}
	if len(created) != 3 {
		t.Errorf("created %d categories, want one per distinct name", len(created))
	}
}

// Importing into a category the page already has adds to it rather than making
// a second one -- the behaviour that was there before and must stay.
func TestResolveImportCategoriesReusesAnExistingOne(t *testing.T) {
	existing := []Category{{ID: "development", Name: "Development"}}
	// Same name, different case and spacing: not a different category.
	rows := []ImportedRow{{Category: " development "}}

	nameToID, created := resolveImportCategories(existing, rows)
	if len(created) != 0 {
		t.Errorf("created %+v, want the existing category reused", created)
	}
	if got := nameToID["development"]; got != "development" {
		t.Errorf("id = %q, want the existing one", got)
	}
}

// A different name that happens to slugify onto an existing id gets its own
// category rather than quietly joining a list it has nothing to do with.
func TestResolveImportCategoriesDoesNotJoinAnUnrelatedCategory(t *testing.T) {
	existing := []Category{{ID: "reading", Name: "Leeslijst"}}
	rows := []ImportedRow{{Category: "Reading"}}

	nameToID, created := resolveImportCategories(existing, rows)
	if got := nameToID["Reading"]; got == "reading" {
		t.Error("joined a category with an unrelated name")
	}
	if len(created) != 1 || created[0].Name != "Reading" {
		t.Errorf("created %+v, want its own category", created)
	}
}

// The same name twice in one import is one category, not two.
func TestResolveImportCategoriesIsStablePerName(t *testing.T) {
	rows := []ImportedRow{{Category: "Reading"}, {Category: "Reading"}, {Category: "Reading"}}
	nameToID, created := resolveImportCategories(nil, rows)
	if len(created) != 1 {
		t.Errorf("created %d categories for one name", len(created))
	}
	if nameToID["Reading"] == "" {
		t.Error("no id for the name")
	}
}
