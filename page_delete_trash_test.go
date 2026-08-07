package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

// newPageDeleteFixture builds a store with a main page and a second page that
// holds `pageTwoJSON`, which is the only page DeletePage will actually delete.
func newPageDeleteFixture(t *testing.T, pageTwoJSON string) (*Handlers, string) {
	t.Helper()
	dir := t.TempDir()
	write := func(name, body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	write("bookmarks-1.json", `{"page":{"id":1,"name":"Main"},"bookmarks":[]}`)
	write("bookmarks-2.json", pageTwoJSON)
	write("pages.json", `{"order":[1,2]}`)

	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	return &Handlers{store: store}, dir
}

// deletePageViaRouter goes through a real router so mux.Vars sees the id the way
// it does in production.
func deletePageViaRouter(t *testing.T, h *Handlers, id string) *httptest.ResponseRecorder {
	t.Helper()
	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}", h.DeletePage).Methods("DELETE")
	req := httptest.NewRequest(http.MethodDelete, "/api/pages/"+id, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

// Deleting a page removes bookmarks-N.json from disk. The whole page must land
// in the trash first, as one entry, or the delete is unrecoverable.
func TestDeletePageMovesPageToTrash(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"categories":[
		{"id":"tools","name":"Tools"}
	],"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"}
	]}`)

	rec := deletePageViaRouter(t, h, "2")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}

	items := h.store.GetTrashItems()
	// One entry, not one per bookmark: restoring is a single action that brings
	// the page back whole.
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}

	item := items[0]
	if item.Kind != TrashKindPage {
		t.Fatalf("Kind = %q, want %q", item.Kind, TrashKindPage)
	}
	if item.PageID != 2 {
		t.Errorf("PageID = %d, want 2", item.PageID)
	}
	if item.PageName != "Work" {
		t.Errorf("PageName = %q, want \"Work\"", item.PageName)
	}
	if item.Source != "page-delete" {
		t.Errorf("Source = %q, want \"page-delete\"", item.Source)
	}

	snapshot := item.TrashedPage
	if snapshot == nil {
		t.Fatal("TrashedPage payload is missing")
	}
	if snapshot.Page.ID != 2 || snapshot.Page.Name != "Work" {
		t.Errorf("snapshot page = %+v, want id 2 named Work", snapshot.Page)
	}
	names := []string{}
	for _, b := range snapshot.Bookmarks {
		names = append(names, b.Name)
	}
	if len(names) != 2 || names[0] != "A" || names[1] != "B" {
		t.Errorf("snapshot bookmarks = %v, want [A B]", names)
	}
	// The categories go too, or a restored page loses its structure.
	if len(snapshot.Categories) != 1 || snapshot.Categories[0].ID != "tools" {
		t.Errorf("snapshot categories = %+v, want [tools]", snapshot.Categories)
	}
}

// Restoring brings the page back at its original id, with everything on it.
func TestRestoreTrashedPageRebuildsThePage(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"categories":[
		{"id":"tools","name":"Tools"}
	],"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"}
	]}`)

	if rec := deletePageViaRouter(t, h, "2"); rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want 200", rec.Code)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}

	// The id is what every bookmark's pageId refers to — a restore under a new
	// id would produce a page nothing points at.
	restored := h.store.GetBookmarksByPage(2)
	if len(restored) != 2 {
		t.Fatalf("restored bookmarks = %d, want 2", len(restored))
	}
	if restored[0].Name != "A" || restored[1].Name != "B" {
		t.Errorf("restored order = %q,%q, want A,B", restored[0].Name, restored[1].Name)
	}
	if cats := h.store.GetCategoriesByPage(2); len(cats) != 1 || cats[0].ID != "tools" {
		t.Errorf("restored categories = %+v, want [tools]", cats)
	}

	found := false
	for _, p := range h.store.GetPages() {
		if p.ID == 2 && p.Name == "Work" {
			found = true
		}
	}
	if !found {
		t.Error("page 2 is not back in the page list")
	}
	if items := h.store.GetTrashItems(); len(items) != 0 {
		t.Errorf("trash items = %d, want 0 after a successful restore", len(items))
	}
}

// Restoring onto an id that has been reused must not clobber the live page.
func TestRestoreTrashedPageRefusesWhenIDIsTaken(t *testing.T) {
	h, dir := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`)

	if rec := deletePageViaRouter(t, h, "2"); rec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want 200", rec.Code)
	}
	id := h.store.GetTrashItems()[0].ID

	// Someone made a new page 2 in the meantime.
	if err := os.WriteFile(
		filepath.Join(dir, "bookmarks-2.json"),
		[]byte(`{"page":{"id":2,"name":"Something else"},"bookmarks":[{"name":"New","url":"https://new.example"}]}`),
		0o644,
	); err != nil {
		t.Fatalf("recreate page 2: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}

	// The live page survives untouched, and the entry stays restorable.
	live := h.store.GetBookmarksByPage(2)
	if len(live) != 1 || live[0].Name != "New" {
		t.Errorf("live page 2 = %+v, want the new page intact", live)
	}
	if items := h.store.GetTrashItems(); len(items) != 1 {
		t.Fatalf("trash items = %d, want 1 (a failed restore must not consume it)", len(items))
	}
}

// The page still has to actually go away — trashing its bookmarks is an
// addition to the delete, not a replacement for it.
func TestDeletePageStillRemovesThePage(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`)

	if rec := deletePageViaRouter(t, h, "2"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	if got := h.store.GetBookmarksByPage(2); len(got) != 0 {
		t.Fatalf("page 2 still has %d bookmarks", len(got))
	}
	for _, id := range h.store.GetPageOrder() {
		if id == 2 {
			t.Fatal("page 2 is still in the page order")
		}
	}
}

// An empty page is still worth restoring: the page, its name and its position
// are what was lost, and a bookmark count of zero does not make that free.
func TestDeleteEmptyPageIsStillRecorded(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Empty"},"bookmarks":[]}`)

	if rec := deletePageViaRouter(t, h, "2"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	items := h.store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}
	if items[0].TrashedPage == nil || items[0].TrashedPage.Page.Name != "Empty" {
		t.Fatalf("entry = %+v, want the empty page", items[0])
	}
}

// Refusing to delete the main page must not trash its bookmarks — otherwise a
// rejected request still half-empties the page.
func TestDeleteMainPageLeavesTrashUntouched(t *testing.T) {
	h, dir := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"bookmarks":[]}`)
	if err := os.WriteFile(
		filepath.Join(dir, "bookmarks-1.json"),
		[]byte(`{"page":{"id":1,"name":"Main"},"bookmarks":[{"name":"Keep","url":"https://keep.example"}]}`),
		0o644,
	); err != nil {
		t.Fatalf("rewrite page 1: %v", err)
	}

	rec := deletePageViaRouter(t, h, "1")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if items := h.store.GetTrashItems(); len(items) != 0 {
		t.Fatalf("trash items = %d, want 0", len(items))
	}
	if got := h.store.GetBookmarksByPage(1); len(got) != 1 {
		t.Fatalf("page 1 bookmarks = %d, want 1", len(got))
	}
}

// A category entry restores the definition at its old position. Its bookmarks
// were never deleted, so there is nothing else to put back.
func TestRestoreTrashedCategoryPutsItBackAtItsIndex(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"categories":[
		{"id":"a","name":"A"},
		{"id":"c","name":"C"}
	],"bookmarks":[]}`)

	// "b" sat between a and c.
	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		Kind:   TrashKindCategory,
		PageID: 2,
		TrashedCategory: &TrashedCategory{
			Category: Category{ID: "b", Name: "B"},
			Index:    1,
		},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}

	ids := []string{}
	for _, c := range h.store.GetCategoriesByPage(2) {
		ids = append(ids, c.ID)
	}
	if len(ids) != 3 || ids[0] != "a" || ids[1] != "b" || ids[2] != "c" {
		t.Fatalf("categories = %v, want [a b c]", ids)
	}
}

// Restoring a category onto a page that is gone must not resurrect the page as
// a side effect, and must not consume the entry.
func TestRestoreTrashedCategoryRefusesWhenPageIsGone(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"bookmarks":[]}`)

	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		Kind:   TrashKindCategory,
		PageID: 77,
		TrashedCategory: &TrashedCategory{
			Category: Category{ID: "orphan", Name: "Orphan"},
		},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	if items := h.store.GetTrashItems(); len(items) != 1 {
		t.Fatalf("trash items = %d, want 1", len(items))
	}
}

// Entries written before pages and categories could be trashed have no `kind`
// field. They must keep restoring as bookmarks rather than being misread.
func TestTrashEntryWithoutKindStillRestoresAsABookmark(t *testing.T) {
	h, _ := newPageDeleteFixture(t, `{"page":{"id":2,"name":"Work"},"bookmarks":[]}`)

	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		PageID:   2,
		Index:    0,
		Bookmark: Bookmark{Name: "Legacy", URL: "https://legacy.example"},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	stored := h.store.GetTrashItems()[0]
	if stored.Kind != "" {
		t.Fatalf("Kind = %q, want empty (the old on-disk shape)", stored.Kind)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+stored.ID+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %q)", rec.Code, rec.Body.String())
	}
	if got := pageBookmarkNames(t, h, 2); len(got) != 1 || got[0] != "Legacy" {
		t.Fatalf("page 2 = %v, want [Legacy]", got)
	}
}
