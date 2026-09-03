package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// GetCategories/SaveCategories used to accept any pageID without checking it
// against the registered pages, so a typo'd query param silently returned an
// empty list (GetCategories) or materialized a brand-new bookmarks-N.json file
// as a side effect of a categories save (SaveCategories) — a page effectively
// created by accident instead of an explicit 404.

func TestGetCategoriesReturns404ForNonexistentPage(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	req := httptest.NewRequest(http.MethodGet, "/api/categories?page=999", nil)
	rec := httptest.NewRecorder()
	h.GetCategories(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}
}

func TestSaveCategoriesReturns404ForNonexistentPageAndDoesNotCreateFile(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	body := []byte(`[{"id":"work","name":"Work"}]`)
	req := httptest.NewRequest(http.MethodPost, "/api/categories?page=999", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveCategories(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404, body = %s", rec.Code, rec.Body.String())
	}

	got := store.GetCategoriesByPage(999)
	if len(got) != 0 {
		t.Fatalf("categories = %+v, want none — a save on a nonexistent page must not materialize it", got)
	}
}

// SaveCategoriesByPage used to answer an empty-categories save with a silent
// nil (200 success) when bookmarks on the page still referenced one — a
// client asking to clear every category got told it worked while nothing
// changed. It now returns ErrCategoriesStillReferenced, which the handler
// must surface as a real error rather than paper over with a 200.
func TestSaveCategoriesReturns409WhenBookmarksStillReferenceCategories(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("expected at least one page from a fresh store")
	}
	pageID := pages[0].ID

	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "work", Name: "Work"}}); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if err := store.SaveBookmarksByPage(pageID, []Bookmark{
		{Name: "Referencing", URL: "https://example.com/still-referenced", Category: "work"},
	}); err != nil {
		t.Fatalf("seed bookmark: %v", err)
	}

	body := []byte(`[]`)
	req := httptest.NewRequest(http.MethodPost, "/api/categories?page="+strconv.Itoa(pageID), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveCategories(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409, body = %s", rec.Code, rec.Body.String())
	}

	got := store.GetCategoriesByPage(pageID)
	if len(got) != 1 || got[0].ID != "work" {
		t.Fatalf("categories = %+v, want the category preserved", got)
	}
}

func TestSaveCategoriesStillWorksForAnExistingPage(t *testing.T) {
	// The control: without this, the tests above would pass just as well
	// against a check that rejects every page, not only missing ones.
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("expected at least one page from a fresh store")
	}
	pageID := pages[0].ID

	body := []byte(`[{"id":"work","name":"Work"}]`)
	req := httptest.NewRequest(http.MethodPost, "/api/categories?page="+strconv.Itoa(pageID), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveCategories(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	got := store.GetCategoriesByPage(pageID)
	if len(got) != 1 || got[0].ID != "work" {
		t.Fatalf("categories = %+v, want [{work Work}]", got)
	}
}

// The dry-run must answer with the same shape the save would produce and, above
// all, write nothing — a preview that mutates is worse than no preview.
func TestSaveCategoriesDryRunPreviewsWithoutWriting(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	pages := store.GetPages()
	if len(pages) == 0 {
		t.Fatal("expected at least one page from a fresh store")
	}
	pageID := pages[0].ID

	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "work", Name: "Work"}}); err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if err := store.SaveBookmarksByPage(pageID, []Bookmark{
		{Name: "Job board", URL: "https://jobs.example", Category: "work"},
	}); err != nil {
		t.Fatalf("seed bookmark: %v", err)
	}

	// A rename with no originalId: the case that silently orphans.
	body := []byte(`[{"id":"job","name":"Job"}]`)
	req := httptest.NewRequest(http.MethodPost, "/api/categories?page="+strconv.Itoa(pageID)+"&dryRun=1", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveCategories(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}

	var preview CategoryRemapPreview
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatalf("decode preview: %v (body %s)", err, rec.Body.String())
	}
	if len(preview.Orphaned) != 1 || preview.Orphaned[0].BookmarkName != "Job board" {
		t.Errorf("Orphaned = %+v, want the bookmark the rename would leave behind", preview.Orphaned)
	}
	if len(preview.MissingOriginalID) != 1 || preview.MissingOriginalID[0] != "job" {
		t.Errorf("MissingOriginalID = %+v, want [job]", preview.MissingOriginalID)
	}

	// Nothing changed on disk.
	categories := store.GetCategoriesByPage(pageID)
	if len(categories) != 1 || categories[0].ID != "work" {
		t.Errorf("categories = %+v, want the original list untouched by a dry run", categories)
	}
	bookmarks := store.GetBookmarksByPage(pageID)
	if len(bookmarks) != 1 || bookmarks[0].Category != "work" {
		t.Errorf("bookmarks = %+v, want the original category untouched by a dry run", bookmarks)
	}
}

// Without dryRun the same request must still apply, or the flag has quietly
// turned every save into a no-op.
func TestSaveCategoriesWithoutDryRunStillApplies(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	pageID := store.GetPages()[0].ID
	if err := store.SaveCategoriesByPage(pageID, []Category{{ID: "work", Name: "Work"}}); err != nil {
		t.Fatalf("seed category: %v", err)
	}

	body := []byte(`[{"id":"job","name":"Job","originalId":"work"}]`)
	req := httptest.NewRequest(http.MethodPost, "/api/categories?page="+strconv.Itoa(pageID), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.SaveCategories(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
	categories := store.GetCategoriesByPage(pageID)
	if len(categories) != 1 || categories[0].ID != "job" {
		t.Errorf("categories = %+v, want the rename applied", categories)
	}
}
