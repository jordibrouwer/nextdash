package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

// sourcesRouter mirrors the production routes so mux.Vars sees the id.
func sourcesRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/sources", h.ListSourcesHandler).Methods("GET")
	r.HandleFunc("/api/sources/{id}", h.SaveSourceHandler).Methods("PUT")
	r.HandleFunc("/api/sources/{id}", h.DeleteSourceHandler).Methods("DELETE")
	r.HandleFunc("/api/sources/{id}/run", h.RunSourceHandler).Methods("GET", "POST")
	return r
}

func doSources(t *testing.T, h *Handlers, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	rec := httptest.NewRecorder()
	sourcesRouter(h).ServeHTTP(rec, req)
	return rec
}

// The register holds a personal access token. No response may carry it back --
// this is the property the whole SourceStatus shape exists to guarantee.
func TestSourcesAPINeverReturnsTheToken(t *testing.T) {
	h := newTestHandlers(t)

	save := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","label":"Stars","token":"ghp_supersecret","enabled":true}`)
	if save.Code != http.StatusOK {
		t.Fatalf("save = %d: %s", save.Code, save.Body.String())
	}
	if strings.Contains(save.Body.String(), "ghp_supersecret") {
		t.Errorf("the save response echoed the token: %s", save.Body.String())
	}

	list := doSources(t, h, http.MethodGet, "/api/sources", "")
	if strings.Contains(list.Body.String(), "ghp_supersecret") {
		t.Errorf("the list response carried the token: %s", list.Body.String())
	}
	if !strings.Contains(list.Body.String(), `"hasToken":true`) {
		t.Errorf("the list does not say a token is set: %s", list.Body.String())
	}

	// And it really was stored -- otherwise this test would pass on a register
	// that quietly dropped every token.
	if got, _ := GetSource("github:stars"); got.Token != "ghp_supersecret" {
		t.Errorf("stored token = %q", got.Token)
	}
}

// A kind with no importer behind it would save cleanly and then fail on every
// run, which is a setting that cannot work presented as one that can.
func TestSaveSourceRejectsUnknownKind(t *testing.T) {
	h := newTestHandlers(t)
	rec := doSources(t, h, http.MethodPut, "/api/sources/x", `{"kind":"telepathy","enabled":true}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", rec.Code)
	}
}

// A preview must not move the cursor: a reader who looks and thinks better of it
// would otherwise never see those stars again.
func TestRunSourceDryRunImportsNothingAndKeepsTheCursor(t *testing.T) {
	h := newTestHandlers(t)
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, starPage(
			[]string{"golang/go", "rust-lang/rust"},
			[]string{"2026-03-01T00:00:00Z", "2026-02-01T00:00:00Z"},
		))
	})

	if rec := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","token":"ghp_x","targetPage":1,"enabled":true}`); rec.Code != http.StatusOK {
		t.Fatalf("save = %d", rec.Code)
	}

	before := len(h.store.GetBookmarksByPage(1))
	rec := doSources(t, h, http.MethodGet, "/api/sources/github:stars/run", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("dry run = %d: %s", rec.Code, rec.Body.String())
	}

	var preview struct {
		New        int  `json:"new"`
		Duplicates int  `json:"duplicates"`
		Truncated  bool `json:"truncated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if preview.New != 2 {
		t.Errorf("new = %d, want 2", preview.New)
	}
	if got := len(h.store.GetBookmarksByPage(1)); got != before {
		t.Errorf("a dry run wrote %d bookmarks", got-before)
	}
	if source, _ := GetSource("github:stars"); source.Cursor != "" {
		t.Errorf("a dry run moved the cursor to %q", source.Cursor)
	}
}

// The round that writes is also the round that records where it got to.
func TestRunSourceImportsAndAdvancesTheCursor(t *testing.T) {
	h := newTestHandlers(t)
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, starPage([]string{"golang/go"}, []string{"2026-03-01T00:00:00Z"}))
	})
	if rec := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","token":"ghp_x","targetPage":1,"enabled":true}`); rec.Code != http.StatusOK {
		t.Fatalf("save = %d", rec.Code)
	}

	rec := doSources(t, h, http.MethodPost, "/api/sources/github:stars/run", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("run = %d: %s", rec.Code, rec.Body.String())
	}

	var found bool
	for _, b := range h.store.GetBookmarksByPage(1) {
		if b.URL == "https://github.com/golang/go" {
			found = true
			if len(b.Tags) == 0 {
				t.Error("imported star carries no tags")
			}
			if b.CreatedAt == 0 {
				t.Error("imported star carries no star date")
			}
		}
	}
	if !found {
		t.Fatal("the star was not imported")
	}

	source, _ := GetSource("github:stars")
	if source.Cursor != "2026-03-01T00:00:00Z" {
		t.Errorf("cursor = %q, want the newest star", source.Cursor)
	}
	if !strings.Contains(source.LastResult, "1 new") {
		t.Errorf("lastResult = %q", source.LastResult)
	}
	if source.LastError != "" {
		t.Errorf("lastError = %q on a good round", source.LastError)
	}
}

// A walk cut short by the page bound imported what it read, but advancing the
// cursor past the unread remainder would skip it permanently.
func TestRunSourceDoesNotAdvanceTheCursorOnATruncatedWalk(t *testing.T) {
	h := newTestHandlers(t)
	withGitHubMaxPages(t, 3)
	var page int
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		page++
		names := make([]string, githubStarsPerPage)
		at := make([]string, githubStarsPerPage)
		for i := range names {
			names[i] = fmt.Sprintf("owner/repo-%d-%d", page, i)
			at[i] = "2026-01-01T00:00:00Z"
		}
		fmt.Fprint(w, starPage(names, at))
	})
	if rec := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","token":"ghp_x","targetPage":1,"enabled":true}`); rec.Code != http.StatusOK {
		t.Fatalf("save = %d", rec.Code)
	}

	if rec := doSources(t, h, http.MethodPost, "/api/sources/github:stars/run", ""); rec.Code != http.StatusOK {
		t.Fatalf("run = %d: %s", rec.Code, rec.Body.String())
	}
	if source, _ := GetSource("github:stars"); source.Cursor != "" {
		t.Errorf("cursor = %q, want it left alone while stars are unread", source.Cursor)
	}
}

// A rejected token is the one failure a reader can act on, so it must not arrive
// as a generic upstream error.
func TestRunSourceReportsARejectedToken(t *testing.T) {
	h := newTestHandlers(t)
	withGitHubAPI(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})
	if rec := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","token":"ghp_bad","targetPage":1,"enabled":true}`); rec.Code != http.StatusOK {
		t.Fatalf("save = %d", rec.Code)
	}

	rec := doSources(t, h, http.MethodPost, "/api/sources/github:stars/run", "")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code = %d, want 401", rec.Code)
	}
	source, _ := GetSource("github:stars")
	if source.LastError == "" {
		t.Error("a failed round left no error on the source")
	}
}

func TestRunSourceUnknownIDIs404(t *testing.T) {
	h := newTestHandlers(t)
	if rec := doSources(t, h, http.MethodPost, "/api/sources/nope/run", ""); rec.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", rec.Code)
	}
}

func TestDeleteSourceRemovesIt(t *testing.T) {
	h := newTestHandlers(t)
	if rec := doSources(t, h, http.MethodPut, "/api/sources/github:stars",
		`{"kind":"github-stars","token":"ghp_x"}`); rec.Code != http.StatusOK {
		t.Fatalf("save = %d", rec.Code)
	}
	if rec := doSources(t, h, http.MethodDelete, "/api/sources/github:stars", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", rec.Code)
	}
	if _, ok := GetSource("github:stars"); ok {
		t.Error("source survived the delete")
	}
}

/*
An import lands on the page the source was configured with.

Not on page 1, and not on whichever page happens to be open: the reader picks a
page in the panel, and a source imported months later has to still go there.
Worth its own test because everything else about the run path defaults to page 1
when nothing is set, and a default that quietly wins is indistinguishable from a
setting that works until the day it does not.
*/
func TestRunSourceWritesToTheConfiguredPage(t *testing.T) {
	h := newTestHandlers(t)
	raindropStub(t,
		[]map[string]any{raindropItemJSON("https://rd.example.com/1", "One", 42, "2026-03-01T00:00:00Z", nil, "", "")},
		[]map[string]any{{"_id": 42, "title": "Reading"}})

	pagesRouter := mux.NewRouter()
	pagesRouter.HandleFunc("/api/pages", h.SavePages).Methods(http.MethodPost)
	req := httptest.NewRequest(http.MethodPost, "/api/pages",
		strings.NewReader(`[{"id":1,"name":"main"},{"id":2,"name":"Second"}]`))
	rec := httptest.NewRecorder()
	pagesRouter.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("creating the second page = %d", rec.Code)
	}

	if got := doSources(t, h, http.MethodPut, "/api/sources/raindrop:all",
		`{"kind":"raindrop","token":"t","targetPage":2,"targetCategory":"Raindrop","enabled":true}`); got.Code != http.StatusOK {
		t.Fatalf("save = %d: %s", got.Code, got.Body.String())
	}
	if got := doSources(t, h, http.MethodPost, "/api/sources/raindrop:all/run", ""); got.Code != http.StatusOK {
		t.Fatalf("run = %d: %s", got.Code, got.Body.String())
	}

	count := func(pageID int) int {
		n := 0
		for _, b := range h.store.GetBookmarksByPage(pageID) {
			if b.URL == "https://rd.example.com/1" {
				n++
			}
		}
		return n
	}
	if got := count(2); got != 1 {
		t.Errorf("page 2 holds %d, want the import", got)
	}
	if got := count(1); got != 0 {
		t.Errorf("page 1 holds %d, want none", got)
	}

	// And the collection's category was made on that page, not on page 1 --
	// without it the imported bookmark has no category to be edited back to.
	var found bool
	for _, c := range h.store.GetCategoriesByPage(2) {
		if c.Name == "Reading" {
			found = true
		}
	}
	if !found {
		t.Error("the collection's category was not created on the target page")
	}
}
