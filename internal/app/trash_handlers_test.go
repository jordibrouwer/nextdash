package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTrashHandlerFixture(t *testing.T, pageJSON string) *Handlers {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "pages.json"), []byte(`{"order":[1]}`), 0o644); err != nil {
		t.Fatalf("write pages: %v", err)
	}
	store := &FileStore{
		settingsFile:  filepath.Join(dir, "settings.json"),
		colorsFile:    filepath.Join(dir, "colors.json"),
		pageOrderFile: filepath.Join(dir, "pages.json"),
		dataDir:       dir,
	}
	return &Handlers{store: store}
}

func pageBookmarkNames(t *testing.T, h *Handlers, pageID int) []string {
	t.Helper()
	names := []string{}
	for _, b := range h.store.GetBookmarksByPage(pageID) {
		names = append(names, b.Name)
	}
	return names
}

// A restored bookmark goes back to the position it was deleted from, not to the
// end of the page.
func TestRestoreTrashItemPutsBookmarkBackAtItsIndex(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"C","url":"https://c.example"}
	]}`)

	// "B" sat between A and C.
	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		PageID:   1,
		Index:    1,
		Bookmark: Bookmark{Name: "B", URL: "https://b.example"},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	got := pageBookmarkNames(t, h, 1)
	want := []string{"A", "B", "C"}
	if len(got) != len(want) {
		t.Fatalf("bookmarks = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("bookmarks = %v, want %v", got, want)
		}
	}

	if len(h.store.GetTrashItems()) != 0 {
		t.Fatal("restored item is still in the trash")
	}
}

// The stored index is a hint: the page may have shrunk since the delete, and a
// stale index must not panic or drop the bookmark.
func TestRestoreTrashItemClampsStaleIndex(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`)

	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		PageID: 1,
		// Deleted from position 9 on a page that now holds one bookmark.
		Index:    9,
		Bookmark: Bookmark{Name: "Z", URL: "https://z.example"},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	got := pageBookmarkNames(t, h, 1)
	if len(got) != 2 || got[1] != "Z" {
		t.Fatalf("bookmarks = %v, want [A Z]", got)
	}
}

// Restoring onto a page that no longer exists must keep the item in the trash
// rather than consuming it — otherwise the failure is a second deletion.
func TestRestoreTrashItemKeepsItemWhenPageIsGone(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[]}`)

	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		PageID:   77,
		Index:    0,
		Bookmark: Bookmark{Name: "Orphan", URL: "https://orphan.example"},
	}}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}
	id := h.store.GetTrashItems()[0].ID

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"`+id+`"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("expected a failure status, got %d", rec.Code)
	}

	items := h.store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("trash items = %d, want 1 (item must survive a failed restore)", len(items))
	}
	if items[0].Bookmark.Name != "Orphan" {
		t.Fatalf("surviving item = %q", items[0].Bookmark.Name)
	}
}

func TestRestoreTrashItemUnknownIDIs404(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[]}`)

	req := httptest.NewRequest(http.MethodPost, "/api/trash/restore", strings.NewReader(`{"id":"trs_missing"}`))
	rec := httptest.NewRecorder()
	h.RestoreTrashItem(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// The POST fills in the page name so the list can name the origin page even
// after that page is renamed or deleted.
func TestAddTrashItemsStampsPageName(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Research"},"bookmarks":[]}`)

	body := `{"source":"dashboard","items":[{"pageId":1,"index":0,"bookmark":{"name":"X","url":"https://x.example"}}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/trash", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.AddTrashItems(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	items := h.store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	if items[0].PageName != "Research" {
		t.Fatalf("pageName = %q, want Research", items[0].PageName)
	}
	if items[0].Source != "dashboard" {
		t.Fatalf("source = %q, want dashboard", items[0].Source)
	}
}

func TestGetTrashReportsRetention(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[]}`)

	req := httptest.NewRequest(http.MethodGet, "/api/trash", nil)
	rec := httptest.NewRecorder()
	h.GetTrash(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var payload struct {
		Count         int `json:"count"`
		RetentionDays int `json:"retentionDays"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.RetentionDays != 30 {
		t.Fatalf("retentionDays = %d, want 30", payload.RetentionDays)
	}
}

func TestDeleteTrashItemAllEmptiesTrash(t *testing.T) {
	h := newTrashHandlerFixture(t, `{"page":{"id":1,"name":"Page 1"},"bookmarks":[]}`)

	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{
		{PageID: 1, Bookmark: Bookmark{Name: "One", URL: "https://one.example"}},
		{PageID: 1, Bookmark: Bookmark{Name: "Two", URL: "https://two.example"}},
	}); err != nil {
		t.Fatalf("AddTrashedBookmarks: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/trash", strings.NewReader(`{"all":true}`))
	rec := httptest.NewRecorder()
	h.DeleteTrashItem(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if len(h.store.GetTrashItems()) != 0 {
		t.Fatal("expected an empty trash")
	}
}
