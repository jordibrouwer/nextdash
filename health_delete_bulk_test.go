package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func newBulkDeleteFixture(t *testing.T, pages map[int]string) *Handlers {
	t.Helper()
	dir := t.TempDir()
	order := []string{}
	for id, pageJSON := range pages {
		name := filepath.Join(dir, "bookmarks-"+strconv.Itoa(id)+".json")
		if err := os.WriteFile(name, []byte(pageJSON), 0o644); err != nil {
			t.Fatalf("write bookmarks-%d: %v", id, err)
		}
		order = append(order, strconv.Itoa(id))
	}
	pagesJSON := `{"order":[` + strings.Join(order, ",") + `]}`
	if err := os.WriteFile(filepath.Join(dir, "pages.json"), []byte(pagesJSON), 0o644); err != nil {
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

func postBulkDelete(t *testing.T, h *Handlers, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/health/delete-bookmarks", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.DeleteHealthBookmarksBulk(rec, req)
	var payload map[string]any
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v (body %q)", err, rec.Body.String())
		}
	}
	return rec, payload
}

// The whole reason this endpoint exists: deleting several rows by index must not
// let an earlier removal shift the ones still to come onto the wrong bookmark.
func TestBulkDeleteRemovesExactlyTheRequestedRows(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"},
		{"name":"C","url":"https://c.example"},
		{"name":"D","url":"https://d.example"},
		{"name":"E","url":"https://e.example"}
	]}`})

	// Ascending order on purpose — the handler must sort descending itself.
	rec, payload := postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":1,"url":"https://b.example"},
		{"pageId":1,"index":3,"url":"https://d.example"}
	]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if got := payload["deleted"]; got != float64(2) {
		t.Fatalf("deleted = %v, want 2", got)
	}

	names := pageBookmarkNames(t, h, 1)
	want := []string{"A", "C", "E"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("remaining = %v, want %v", names, want)
	}
}

// A stale report describes a bookmark that has since moved. Deleting by index
// alone would take the wrong row, so the URL has to agree.
func TestBulkDeleteSkipsRowsWhoseURLNoLongerMatches(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"}
	]}`})

	_, payload := postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":0,"url":"https://gone.example"}
	]}`)
	if got := payload["deleted"]; got != float64(0) {
		t.Fatalf("deleted = %v, want 0", got)
	}
	skipped, _ := payload["skipped"].([]any)
	if len(skipped) != 1 {
		t.Fatalf("skipped = %v, want one entry", skipped)
	}
	entry, _ := skipped[0].(map[string]any)
	if entry["reason"] != healthBulkSkipStale {
		t.Fatalf("reason = %v, want %q", entry["reason"], healthBulkSkipStale)
	}

	if names := pageBookmarkNames(t, h, 1); len(names) != 2 {
		t.Fatalf("page changed to %v, want both bookmarks untouched", names)
	}
}

// One stale row in a batch must not stop the rows that are still accurate.
func TestBulkDeleteAppliesGoodRowsBesideASkippedOne(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"},
		{"name":"C","url":"https://c.example"}
	]}`})

	_, payload := postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":0,"url":"https://a.example"},
		{"pageId":1,"index":1,"url":"https://wrong.example"}
	]}`)
	if got := payload["deleted"]; got != float64(1) {
		t.Fatalf("deleted = %v, want 1", got)
	}
	names := pageBookmarkNames(t, h, 1)
	want := []string{"B", "C"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("remaining = %v, want %v", names, want)
	}
}

// An index past the end of the page is reported, not silently ignored.
func TestBulkDeleteReportsOutOfRangeIndex(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`})

	_, payload := postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":7,"url":"https://a.example"}
	]}`)
	skipped, _ := payload["skipped"].([]any)
	if len(skipped) != 1 {
		t.Fatalf("skipped = %v, want one entry", skipped)
	}
	entry, _ := skipped[0].(map[string]any)
	if entry["reason"] != healthBulkSkipOutOfRange {
		t.Fatalf("reason = %v, want %q", entry["reason"], healthBulkSkipOutOfRange)
	}
}

// Rows spread over several pages are each removed from their own page.
func TestBulkDeleteSpansPages(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{
		1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
			{"name":"A","url":"https://a.example"},
			{"name":"B","url":"https://b.example"}
		]}`,
		2: `{"page":{"id":2,"name":"Page 2"},"bookmarks":[
			{"name":"C","url":"https://c.example"},
			{"name":"D","url":"https://d.example"}
		]}`,
	})

	_, payload := postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":0,"url":"https://a.example"},
		{"pageId":2,"index":1,"url":"https://d.example"}
	]}`)
	if got := payload["deleted"]; got != float64(2) {
		t.Fatalf("deleted = %v, want 2", got)
	}
	if names := pageBookmarkNames(t, h, 1); strings.Join(names, ",") != "B" {
		t.Fatalf("page 1 = %v, want [B]", names)
	}
	if names := pageBookmarkNames(t, h, 2); strings.Join(names, ",") != "C" {
		t.Fatalf("page 2 = %v, want [C]", names)
	}
}

// Deleted rows land in the trash, so a bulk cleanup is as recoverable as any
// other delete.
func TestBulkDeleteRecordsToTheTrash(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"}
	]}`})

	postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":0,"url":"https://a.example"},
		{"pageId":1,"index":1,"url":"https://b.example"}
	]}`)

	items := h.store.GetTrashItems()
	if len(items) != 2 {
		t.Fatalf("trash has %d items, want 2", len(items))
	}
	for _, item := range items {
		if item.Source != "health-bulk" {
			t.Fatalf("source = %q, want health-bulk", item.Source)
		}
		if item.PageName != "Page 1" {
			t.Fatalf("pageName = %q, want Page 1", item.PageName)
		}
	}
}

// A skipped row must not appear in the trash: it was never deleted.
func TestBulkDeleteDoesNotTrashSkippedRows(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`})

	postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":0,"url":"https://mismatch.example"}
	]}`)
	if items := h.store.GetTrashItems(); len(items) != 0 {
		t.Fatalf("trash has %d items, want none", len(items))
	}
}

// The trash entry keeps the index it was deleted from, so restore puts it back
// where it was rather than at the end.
func TestBulkDeleteTrashEntriesKeepTheirIndex(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"},
		{"name":"B","url":"https://b.example"},
		{"name":"C","url":"https://c.example"}
	]}`})

	postBulkDelete(t, h, `{"items":[
		{"pageId":1,"index":2,"url":"https://c.example"}
	]}`)
	items := h.store.GetTrashItems()
	if len(items) != 1 {
		t.Fatalf("trash has %d items, want 1", len(items))
	}
	if items[0].Index != 2 {
		t.Fatalf("index = %d, want 2", items[0].Index)
	}
}

func TestBulkDeleteRejectsItemsWithoutURL(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[
		{"name":"A","url":"https://a.example"}
	]}`})

	rec, _ := postBulkDelete(t, h, `{"items":[{"pageId":1,"index":0}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if names := pageBookmarkNames(t, h, 1); len(names) != 1 {
		t.Fatalf("page changed to %v, want untouched", names)
	}
}

func TestBulkDeleteRejectsEmptyRequest(t *testing.T) {
	h := newBulkDeleteFixture(t, map[int]string{1: `{"page":{"id":1,"name":"Page 1"},"bookmarks":[]}`})
	rec, _ := postBulkDelete(t, h, `{"items":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
