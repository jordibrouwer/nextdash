package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const importFixture = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
        <DT><A HREF="https://go.dev/blog/" ADD_DATE="1610000000" TAGS="Go, weekly">The Go blog</A>
        <DD>Kept for the release notes
        <DT><A HREF="https://example.com/later" TOREAD="1">Something for later</A>
    </DL><p>
    <DT><A HREF="javascript:void(0)">bookmarklet</A>
</DL><p>`

// What the browser-side parser threw away: an export carries tags, a note and
// a date, and until this route existed all three were dropped between the file
// and the store.
func TestImportBookmarksHTMLKeepsWhatTheFileCarries(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html?page=1", strings.NewReader(importFixture))
	rec := httptest.NewRecorder()
	h.ImportBookmarksHTML(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var blog, later *Bookmark
	rows := store.GetBookmarksByPage(1)
	for i := range rows {
		switch rows[i].URL {
		case "https://go.dev/blog/":
			blog = &rows[i]
		case "https://example.com/later":
			later = &rows[i]
		case "javascript:void(0)":
			t.Error("a javascript: bookmarklet was imported")
		}
	}
	if blog == nil || later == nil {
		t.Fatalf("expected both bookmarks, got %d rows", len(rows))
	}

	if blog.CreatedAt != 1610000000*1000 {
		t.Errorf("createdAt = %d, want the file's ADD_DATE in millis", blog.CreatedAt)
	}
	if len(blog.Tags) != 2 || blog.Tags[0] != "go" || blog.Tags[1] != "weekly" {
		t.Errorf("tags = %v, want [go weekly]", blog.Tags)
	}
	if blog.Note != "Kept for the release notes" {
		t.Errorf("note = %q, want the <DD> that follows the row", blog.Note)
	}
	// The folder becomes the category, created on the page if it is new.
	if blog.Category != slugify("Reading") {
		t.Errorf("category = %q, want the folder slugified", blog.Category)
	}
	var named bool
	for _, c := range store.GetCategoriesByPage(1) {
		if c.Name == "Reading" {
			named = true
		}
	}
	if !named {
		t.Error("the folder did not become a category with its own name")
	}

	// nextDash has no read state, so TOREAD becomes a tag rather than a field
	// invented for one importer -- the same answer linkding and Karakeep give.
	if len(later.Tags) != 1 || later.Tags[0] != "toread" {
		t.Errorf("tags = %v for a TOREAD row, want [toread]", later.Tags)
	}
}

// Re-importing the same file must not double the collection: de-duplication is
// the existing behaviour of the shared import path, and this proves the HTML
// route goes through it rather than around it.
func TestImportBookmarksHTMLSkipsWhatIsAlreadyThere(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html?page=1", strings.NewReader(importFixture))
		rec := httptest.NewRecorder()
		h.ImportBookmarksHTML(rec, req)
		return rec
	}

	if got := post().Body.String(); !strings.Contains(got, `"imported":2`) {
		t.Fatalf("first import = %s, want two", got)
	}
	if got := post().Body.String(); !strings.Contains(got, `"skipped":2`) {
		t.Fatalf("second import = %s, want both skipped", got)
	}
	// Counted by URL rather than by page size: a fresh install seeds its own
	// starter bookmarks, and this is about the two from the file.
	fromFile := 0
	for _, bm := range store.GetBookmarksByPage(1) {
		if bm.URL == "https://go.dev/blog/" || bm.URL == "https://example.com/later" {
			fromFile++
		}
	}
	if fromFile != 2 {
		t.Errorf("the file's bookmarks appear %d times after importing twice, want 2", fromFile)
	}
}

func TestImportBookmarksHTMLNeedsAPage(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	h := NewHandlers(NewStore(), embeddedFiles)

	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html", strings.NewReader(importFixture))
	rec := httptest.NewRecorder()
	h.ImportBookmarksHTML(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d without a page, want 400", rec.Code)
	}
}

// Export and import are the same format read by the same code, so the file
// this writes has to come back through the parser intact -- that is what makes
// the collection portable rather than merely stored.
func TestExportBookmarksHTMLIsReadableAgain(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	store := NewStore()
	h := NewHandlers(store, embeddedFiles)

	imp := httptest.NewRequest(http.MethodPost, "/api/bookmarks/import-html?page=1", strings.NewReader(importFixture))
	h.ImportBookmarksHTML(httptest.NewRecorder(), imp)

	rec := httptest.NewRecorder()
	h.ExportBookmarksHTML(rec, httptest.NewRequest(http.MethodGet, "/api/bookmarks/export-html", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("export status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Disposition"); !strings.Contains(ct, "nextdash-bookmarks.html") {
		t.Errorf("Content-Disposition = %q, want a download filename", ct)
	}

	back, err := ParseNetscapeBookmarks(strings.NewReader(rec.Body.String()))
	if err != nil {
		t.Fatalf("the exported file does not parse: %v", err)
	}
	var found bool
	for _, bm := range back {
		if bm.URL != "https://go.dev/blog/" {
			continue
		}
		found = true
		if bm.Note != "Kept for the release notes" {
			t.Errorf("note = %q after a round trip", bm.Note)
		}
		if len(bm.Tags) != 2 {
			t.Errorf("tags = %v after a round trip", bm.Tags)
		}
		if bm.CreatedAt != 1610000000*1000 {
			t.Errorf("createdAt = %d after a round trip", bm.CreatedAt)
		}
		// The page name leads the folder, so a file imported elsewhere keeps
		// the structure it had here.
		if !strings.Contains(bm.Folder, "Reading") {
			t.Errorf("folder = %q, want the category named in it", bm.Folder)
		}
	}
	if !found {
		t.Error("the exported file does not contain the bookmark that was imported")
	}
}
