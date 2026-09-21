package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The health report can be minutes old, so the index a row carries may name a
// different bookmark by the time it is acted on. Every write from the view now
// sends the URL it means: a moved row is found by it, a vanished one is refused.

const staleTwoRows = `{"id":1,"name":"Page 1","bookmarks":[{"name":"A","url":"https://a.example/"},{"name":"B","url":"https://b.example/"}]}`

func postHealthJSON(h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)))
	return rec
}

func TestDeleteHealthBookmarkFollowsTheURLNotTheIndex(t *testing.T) {
	h, store := healthTestStore(t, staleTwoRows)
	// Index 0 is A, but the row the user clicked was B.
	rec := postHealthJSON(h.DeleteHealthBookmark, `{"pageId":1,"index":0,"url":"https://b.example/"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	left := store.GetBookmarksByPage(1)
	if len(left) != 1 || left[0].Name != "A" {
		t.Fatalf("left = %+v, want only A", left)
	}
	var body struct {
		TrashIDs []string `json:"trashIds"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body.TrashIDs) != 1 {
		t.Fatalf("trashIds = %v, want one: a single delete goes to the trash too", body.TrashIDs)
	}
	trash := store.GetTrashItems()
	if len(trash) != 1 || trash[0].Bookmark.Name != "B" {
		t.Fatalf("trash = %+v", trash)
	}
}

func TestDeleteHealthBookmarkRefusesAGoneURLAndMissingURL(t *testing.T) {
	h, store := healthTestStore(t, staleTwoRows)
	if rec := postHealthJSON(h.DeleteHealthBookmark, `{"pageId":1,"index":0,"url":"https://gone.example/"}`); rec.Code != http.StatusConflict {
		t.Fatalf("gone url status = %d, want 409", rec.Code)
	}
	if rec := postHealthJSON(h.DeleteHealthBookmark, `{"pageId":1,"index":0}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("missing url status = %d, want 400", rec.Code)
	}
	if n := len(store.GetBookmarksByPage(1)); n != 2 {
		t.Fatalf("rows = %d, want 2 untouched", n)
	}
}

func TestUpdateStatusFollowsTheURL(t *testing.T) {
	h, store := healthTestStore(t, staleTwoRows)
	rec := postHealthJSON(h.UpdateBookmarkHealthStatus, `{"pageId":1,"index":0,"url":"https://b.example/","status":"offline","error":"HTTP 500"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	rows := store.GetBookmarksByPage(1)
	if rows[0].LastError != "" || rows[1].LastError == "" {
		t.Fatalf("A.err=%q B.err=%q, want only B marked", rows[0].LastError, rows[1].LastError)
	}
	if rec := postHealthJSON(h.UpdateBookmarkHealthStatus, `{"pageId":1,"index":0,"url":"https://gone.example/","status":"online"}`); rec.Code != http.StatusConflict {
		t.Fatalf("gone url status = %d, want 409", rec.Code)
	}
}

func TestAutoHealApplyFollowsTheURLAndReportsWhatItReplaced(t *testing.T) {
	h, store := healthTestStore(t, staleTwoRows)
	rec := postHealthJSON(h.AutoHealApply, `{"pageId":1,"index":0,"url":"https://b.example/","newUrl":"https://b2.example/","refreshTitle":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	rows := store.GetBookmarksByPage(1)
	if rows[0].URL != "https://a.example/" || rows[1].URL != "https://b2.example/" {
		t.Fatalf("urls = %q %q", rows[0].URL, rows[1].URL)
	}
	var body struct {
		Previous struct {
			URL  string `json:"url"`
			Name string `json:"name"`
		} `json:"previous"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Previous.URL != "https://b.example/" || body.Previous.Name != "B" {
		t.Fatalf("previous = %+v", body.Previous)
	}
	if rec := postHealthJSON(h.AutoHealApply, `{"pageId":1,"index":0,"url":"https://gone.example/","newUrl":"https://x.example/"}`); rec.Code != http.StatusConflict {
		t.Fatalf("gone url status = %d, want 409", rec.Code)
	}
}

func TestBulkDeleteFindsAMovedRowByURLAndReturnsTrashIDs(t *testing.T) {
	h, store := healthTestStore(t, staleTwoRows)
	rec := postHealthJSON(h.DeleteHealthBookmarksBulk, `{"items":[{"pageId":1,"index":0,"url":"https://b.example/"}]}`)
	var body struct {
		Deleted  int      `json:"deleted"`
		TrashIDs []string `json:"trashIds"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Deleted != 1 || len(body.TrashIDs) != 1 {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if left := store.GetBookmarksByPage(1); len(left) != 1 || left[0].Name != "A" {
		t.Fatalf("left = %+v", left)
	}
}
