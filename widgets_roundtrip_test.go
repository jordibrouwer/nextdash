package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

/*
A widget survives the three paths that read bookmarks-N.json.

That file is read by the store's page mutation, by the backup writer and by the
import merge, and each one unmarshals it into PageWithBookmarks and marshals it
back. A field that any of the three did not know about would be dropped on the
first write after it -- silently, since nothing errors when JSON has a key the
struct lacks.

Worth a test rather than a reading of the code: it is the failure this codebase
is most prone to, and the one that only shows up a week later when somebody's
widgets are gone.
*/

func writeWidgetIntoPage(t *testing.T, dir string, widgets []Widget, order []string) {
	t.Helper()
	path := filepath.Join(dir, "bookmarks-1.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read page: %v", err)
	}
	var page PageWithBookmarks
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("unmarshal page: %v", err)
	}
	page.Widgets = widgets
	page.BlockOrder = order
	out, err := json.MarshalIndent(page, "", "  ")
	if err != nil {
		t.Fatalf("marshal page: %v", err)
	}
	if err := os.WriteFile(path, out, 0644); err != nil {
		t.Fatalf("write page: %v", err)
	}
}

func readPageFile(t *testing.T, dir string) PageWithBookmarks {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "bookmarks-1.json"))
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	var page PageWithBookmarks
	if err := json.Unmarshal(raw, &page); err != nil {
		t.Fatalf("unmarshal back: %v", err)
	}
	return page
}

// An ordinary bookmark write rewrites the whole file.
func TestWidgetsSurviveABookmarkWrite(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := NewStore()

	writeWidgetIntoPage(t, dir,
		[]Widget{{ID: "w_abc123", Type: WidgetTypeHealth, Title: "Status"}},
		[]string{"development", "w_abc123", "media"})

	if err := store.SaveBookmarksByPage(1, store.GetBookmarksByPage(1)); err != nil {
		t.Fatalf("save: %v", err)
	}

	page := readPageFile(t, dir)
	if len(page.Widgets) != 1 {
		t.Fatalf("widgets after a bookmark write: %d, want 1", len(page.Widgets))
	}
	if page.Widgets[0].Title != "Status" {
		t.Errorf("widget title = %q", page.Widgets[0].Title)
	}
	if len(page.BlockOrder) != 3 || page.BlockOrder[1] != "w_abc123" {
		t.Errorf("blockOrder = %v, want the widget still between the categories", page.BlockOrder)
	}
}

// The backup ZIP and the import that reads it back.
func TestWidgetsSurviveABackupRoundTrip(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	h := &Handlers{store: NewStore()}

	writeWidgetIntoPage(t, dir,
		[]Widget{{ID: "w_keepme", Type: WidgetTypeHealth, Title: "Kept"}},
		[]string{"w_keepme", "development"})

	zip, err := h.buildBackupZip()
	if err != nil {
		t.Fatalf("buildBackupZip: %v", err)
	}

	// Into a fresh install, so nothing carries over except what the ZIP holds.
	restoreDir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", restoreDir)
	restored := &Handlers{store: NewStore()}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "backup.zip")
	if err != nil {
		t.Fatalf("form: %v", err)
	}
	if _, err := part.Write(zip); err != nil {
		t.Fatalf("write zip: %v", err)
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	restored.Import(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import = %d: %s", rec.Code, rec.Body.String())
	}

	page := readPageFile(t, restoreDir)
	if len(page.Widgets) != 1 || page.Widgets[0].ID != "w_keepme" {
		t.Fatalf("widgets after a backup round trip: %+v", page.Widgets)
	}
	if len(page.BlockOrder) == 0 || page.BlockOrder[0] != "w_keepme" {
		t.Errorf("blockOrder = %v, want the widget still first", page.BlockOrder)
	}
}
