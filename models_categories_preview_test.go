package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeCategoryPage(t *testing.T, dir string, page PageWithBookmarks) {
	t.Helper()
	data, err := json.MarshalIndent(page, "", "  ")
	if err != nil {
		t.Fatalf("marshal page: %v", err)
	}
	path := filepath.Join(dir, "bookmarks-1.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write page: %v", err)
	}
}

func basePage() PageWithBookmarks {
	return PageWithBookmarks{
		Page: Page{ID: 1, Name: "main"},
		Categories: []Category{
			{ID: "work", Name: "Work"},
			{ID: "personal", Name: "Personal"},
		},
		Bookmarks: []Bookmark{
			{Name: "Job board", URL: "https://jobs.example", Category: "work"},
			{Name: "Recipes", URL: "https://recipes.example", Category: "personal"},
			{Name: "Loose", URL: "https://loose.example", Category: ""},
		},
	}
}

// The rename the remap handles correctly: originalId present, so the bookmark
// travels with its category.
func TestPreviewReportsRenameAsAMove(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}
	writeCategoryPage(t, dir, basePage())

	preview, err := store.PreviewCategoriesByPage(1, []Category{
		{ID: "job", Name: "Job", OriginalID: "work"},
		{ID: "personal", Name: "Personal", OriginalID: "personal"},
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if len(preview.Moved) != 1 {
		t.Fatalf("Moved = %+v, want exactly the renamed category's bookmark", preview.Moved)
	}
	if preview.Moved[0].BookmarkName != "Job board" ||
		preview.Moved[0].FromCategory != "work" || preview.Moved[0].ToCategory != "job" {
		t.Errorf("unexpected move: %+v", preview.Moved[0])
	}
	if len(preview.Orphaned) != 0 {
		t.Errorf("Orphaned = %+v, want none — the bookmark follows its category", preview.Orphaned)
	}
	if preview.Rejected {
		t.Errorf("Rejected = true, want a clean apply")
	}
}

// The fragile case this preview exists for: a rename submitted without
// originalId. The save succeeds and reports nothing, the category list updates,
// and the bookmark is quietly left pointing at an id that no longer exists.
func TestPreviewWarnsAboutRenameMissingOriginalID(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}
	writeCategoryPage(t, dir, basePage())

	next := []Category{
		{ID: "job", Name: "Job"}, // meant as a rename of "work", but no originalId
		{ID: "personal", Name: "Personal", OriginalID: "personal"},
	}

	preview, err := store.PreviewCategoriesByPage(1, next)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if len(preview.Moved) != 0 {
		t.Errorf("Moved = %+v, want none — nothing links \"work\" to \"job\"", preview.Moved)
	}
	if len(preview.Orphaned) != 1 || preview.Orphaned[0].BookmarkName != "Job board" {
		t.Fatalf("Orphaned = %+v, want the bookmark left behind by the rename", preview.Orphaned)
	}
	if len(preview.MissingOriginalID) != 1 || preview.MissingOriginalID[0] != "job" {
		t.Errorf("MissingOriginalID = %+v, want [job]", preview.MissingOriginalID)
	}

	// And the prediction has to match reality: applying the same input must
	// leave the bookmark exactly where the preview said it would.
	if err := store.SaveCategoriesByPage(1, next); err != nil {
		t.Fatalf("save: %v", err)
	}
	got := store.GetBookmarksByPage(1)
	for _, bm := range got {
		if bm.Name == "Job board" && bm.Category != "work" {
			t.Errorf("after save, Job board category = %q, want \"work\" (orphaned) as previewed", bm.Category)
		}
	}
}

// Deleting a category orphans its bookmarks, and the save says nothing about
// it. The preview has to, since the dashboard renders an orphan and an
// uncategorized row identically.
func TestPreviewReportsDeletionOrphans(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}
	writeCategoryPage(t, dir, basePage())

	preview, err := store.PreviewCategoriesByPage(1, []Category{
		{ID: "personal", Name: "Personal", OriginalID: "personal"},
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}

	if len(preview.Orphaned) != 1 || preview.Orphaned[0].FromCategory != "work" {
		t.Fatalf("Orphaned = %+v, want the deleted category's bookmark", preview.Orphaned)
	}
	// An uncategorized bookmark is not an orphan — it was never in a category.
	for _, o := range preview.Orphaned {
		if o.BookmarkName == "Loose" {
			t.Errorf("an uncategorized bookmark must not be reported as orphaned")
		}
	}
}

// A save that will be refused must not be previewed as a clean apply.
func TestPreviewReportsRejectionInsteadOfPromisingAnApply(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}
	writeCategoryPage(t, dir, basePage())

	preview, err := store.PreviewCategoriesByPage(1, []Category{})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if !preview.Rejected || preview.Reason != "categories_still_referenced" {
		t.Fatalf("preview = %+v, want a rejection matching ErrCategoriesStillReferenced", preview)
	}

	// The save it predicts really does refuse.
	if err := store.SaveCategoriesByPage(1, []Category{}); err == nil {
		t.Errorf("save accepted an empty list the preview said would be rejected")
	}
}

// The property that matters most: whatever the preview says about where
// bookmarks land, the save must actually do. Both go through
// buildCategoryRemap, so this fails the moment one of them grows its own logic.
func TestPreviewMatchesSaveAcrossShapes(t *testing.T) {
	t.Parallel()

	cases := map[string][]Category{
		"rename with originalId": {
			{ID: "job", Name: "Job", OriginalID: "work"},
			{ID: "personal", Name: "Personal", OriginalID: "personal"},
		},
		"rename without originalId": {
			{ID: "job", Name: "Job"},
			{ID: "personal", Name: "Personal", OriginalID: "personal"},
		},
		"drop one category": {
			{ID: "personal", Name: "Personal", OriginalID: "personal"},
		},
		"reorder only": {
			{ID: "personal", Name: "Personal", OriginalID: "personal"},
			{ID: "work", Name: "Work", OriginalID: "work"},
		},
		"add a category": {
			{ID: "work", Name: "Work", OriginalID: "work"},
			{ID: "personal", Name: "Personal", OriginalID: "personal"},
			{ID: "reading", Name: "Reading"},
		},
	}

	for name, next := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			store := &FileStore{dataDir: dir}
			writeCategoryPage(t, dir, basePage())

			preview, err := store.PreviewCategoriesByPage(1, next)
			if err != nil {
				t.Fatalf("preview: %v", err)
			}

			predicted := map[string]string{}
			for _, bm := range basePage().Bookmarks {
				if bm.Category != "" {
					predicted[bm.Name] = bm.Category
				}
			}
			for _, move := range preview.Moved {
				predicted[move.BookmarkName] = move.ToCategory
			}

			if err := store.SaveCategoriesByPage(1, next); err != nil {
				t.Fatalf("save: %v", err)
			}

			for _, bm := range store.GetBookmarksByPage(1) {
				want, tracked := predicted[bm.Name]
				if !tracked {
					continue
				}
				if bm.Category != want {
					t.Errorf("%s: category = %q, preview predicted %q", bm.Name, bm.Category, want)
				}
			}
		})
	}
}

// A page that does not exist yet is created by the save with no bookmarks, so
// there is nothing to remap and nothing to warn about.
func TestPreviewOnMissingPageIsEmpty(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	preview, err := store.PreviewCategoriesByPage(9, []Category{{ID: "work", Name: "Work"}})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if len(preview.Moved) != 0 || len(preview.Orphaned) != 0 || preview.Rejected {
		t.Errorf("preview = %+v, want an empty clean preview", preview)
	}
}
