package main

import (
	"bytes"
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

func TestSaveCategoriesStillWorksForAnExistingPage(t *testing.T) {
	// The control: without this, the tests above would pass just as well
	// against a check that rejects every page, not only missing ones.
	tmp := t.TempDir()
	t.Chdir(tmp)

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
