package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

// A page's Hidden flag has to round-trip through the same file SavePage
// already writes -- PageWithBookmarks embeds Page, so this is a spot-check
// that the new field doesn't get dropped anywhere along that path.
func TestPageHiddenFieldRoundTrips(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	if err := store.SavePage(Page{ID: unsortedPageID, Name: "Unsorted", Hidden: true}); err != nil {
		t.Fatalf("SavePage: %v", err)
	}

	pages := store.getPages()
	var found *Page
	for i := range pages {
		if pages[i].ID == unsortedPageID {
			found = &pages[i]
		}
	}
	if found == nil {
		t.Fatal("unsorted page not found in getPages()")
	}
	if !found.Hidden {
		t.Error("Hidden = false, want true")
	}
}

func TestEnsureUnsortedPageIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	store := &FileStore{dataDir: dir}

	first, err := store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("first EnsureUnsortedPage: %v", err)
	}
	if first.ID != unsortedPageID || !first.Hidden {
		t.Fatalf("first = %+v, want id=%d hidden=true", first, unsortedPageID)
	}

	if err := store.AddBookmarkToPage(unsortedPageID, Bookmark{Name: "kept", URL: "https://kept.example"}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}

	second, err := store.EnsureUnsortedPage()
	if err != nil {
		t.Fatalf("second EnsureUnsortedPage: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("second call returned a different id: %d != %d", second.ID, first.ID)
	}
	if len(store.GetBookmarksByPage(unsortedPageID)) != 1 {
		t.Fatal("bookmark lost across a second EnsureUnsortedPage call")
	}
}

func TestGetPagesHandlerOmitsHiddenPage(t *testing.T) {
	h := newTestHandlers(t)
	if _, err := h.store.EnsureUnsortedPage(); err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/pages", nil)
	rec := httptest.NewRecorder()
	h.GetPages(rec, req)

	var pages []Page
	if err := json.Unmarshal(rec.Body.Bytes(), &pages); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, p := range pages {
		if p.ID == unsortedPageID {
			t.Fatalf("GET /api/pages included the hidden unsorted page: %+v", p)
		}
	}

	all := h.store.GetPages()
	found := false
	for _, p := range all {
		if p.ID == unsortedPageID {
			found = true
		}
	}
	if !found {
		t.Fatal("store.GetPages() no longer returns the hidden page")
	}
}

func TestDeletePageRefusesReservedUnsortedID(t *testing.T) {
	h := newTestHandlers(t)
	if _, err := h.store.EnsureUnsortedPage(); err != nil {
		t.Fatalf("EnsureUnsortedPage: %v", err)
	}

	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}", h.DeletePage).Methods(http.MethodDelete)
	req := httptest.NewRequest(http.MethodDelete, "/api/pages/999999", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatal("DeletePage accepted the reserved unsorted page id")
	}
}
