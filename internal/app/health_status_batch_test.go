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

// Loading the dashboard used to send one POST per row that pinged -- ten of
// them, seven seconds apart, each taking the store lock and rewriting the whole
// page file. They arrive as one array now, and it is keyed on the URL rather
// than on an array position.
//
// The position mattered: `index` is where the bookmark sat in the client's copy
// when the ping started, and anything that reorders the page before the write
// lands -- a delete, a move, a rename that resorts -- points it at a different
// bookmark. Demonstrated in the browser: index 5 was one bookmark, and after a
// single delete the same index was another.
func batchTestHandlers(t *testing.T, pageJSON string) (*Handlers, string) {
	t.Helper()
	h, dir := healthRecheckTestHandlers(t, `{}`)
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}
	return h, dir
}

func TestUpdateStatusesWritesEveryResultInOnePass(t *testing.T) {
	h, dir := batchTestHandlers(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"One","url":"https://one.example","checkStatus":true},
		{"name":"Two","url":"https://two.example","checkStatus":true},
		{"name":"Three","url":"https://three.example","checkStatus":true}
	]}`)

	body := `{"pageId":1,"results":[
		{"url":"https://one.example","status":"online"},
		{"url":"https://two.example","status":"offline","error":"Connection refused"},
		{"url":"https://three.example","status":"offline"}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatuses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		Updated int `json:"updated"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if out.Updated != 3 {
		t.Fatalf("updated = %d, want 3", out.Updated)
	}

	got := readPageBookmarks(t, dir, 1)
	if got[0].LastError != "" {
		t.Errorf("online bookmark kept an error: %q", got[0].LastError)
	}
	if got[0].LastChecked == 0 {
		t.Error("online bookmark was not stamped as checked")
	}
	if got[1].LastError != "Connection refused" {
		t.Errorf("error detail = %q, want the reported one", got[1].LastError)
	}
	// An offline result with no detail still has to say something, the way the
	// single-write path did.
	if got[2].LastError != "Unreachable" {
		t.Errorf("bare offline = %q, want the Unreachable default", got[2].LastError)
	}
}

// The whole point of keying on the URL: a result written against a collection
// that has since been reordered still lands on the bookmark it was measured on.
func TestUpdateStatusesFollowTheBookmarkNotThePosition(t *testing.T) {
	h, dir := batchTestHandlers(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"First","url":"https://first.example","checkStatus":true},
		{"name":"Target","url":"https://target.example","checkStatus":true}
	]}`)

	// The row the ping was measured on moves away from position 0 before the
	// write lands, exactly as an insert above it would do. Deliberately not
	// moved *to* the front: a result written by position would then land on it
	// by luck, and the test would pass for the wrong reason.
	reordered := `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Inserted","url":"https://inserted.example","checkStatus":true},
		{"name":"First","url":"https://first.example","checkStatus":true},
		{"name":"Target","url":"https://target.example","checkStatus":true}
	]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(reordered), 0o644); err != nil {
		t.Fatalf("rewrite bookmarks: %v", err)
	}

	body := `{"pageId":1,"results":[{"url":"https://target.example","status":"offline","error":"Timed out"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatuses(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	got := readPageBookmarks(t, dir, 1)
	for _, bm := range got {
		switch bm.URL {
		case "https://target.example":
			if bm.LastError != "Timed out" {
				t.Errorf("the measured bookmark did not get its result: %q", bm.LastError)
			}
			if bm.LastChecked == 0 {
				t.Error("the measured bookmark was not stamped as checked")
			}
		default:
			// Everything else has to be untouched: a write that landed by
			// position would have marked whatever now sits where the target
			// used to be.
			if bm.LastError != "" || bm.LastChecked != 0 {
				t.Errorf("%s was written but was never checked (error=%q checked=%d)",
					bm.URL, bm.LastError, bm.LastChecked)
			}
		}
	}
}

// URLs are matched the way the rest of the app matches them, so a trailing
// slash or a differently cased host is the same bookmark.
func TestUpdateStatusesMatchTheUrlCanonically(t *testing.T) {
	h, dir := batchTestHandlers(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Trailing","url":"https://Example.COM/path/","checkStatus":true}
	]}`)

	body := `{"pageId":1,"results":[{"url":"https://example.com/path","status":"offline","error":"404"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatuses(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}

	got := readPageBookmarks(t, dir, 1)
	if got[0].LastError != "404" {
		t.Errorf("canonically equal URL did not match: %q", got[0].LastError)
	}
}

// A URL nobody on the page has is skipped rather than failing the batch: the
// row may have been deleted while the ping was in flight, and the other results
// in the same array are still good.
func TestUpdateStatusesSkipUnknownUrls(t *testing.T) {
	h, _ := batchTestHandlers(t, `{"id":1,"name":"Page 1","bookmarks":[
		{"name":"Known","url":"https://known.example","checkStatus":true}
	]}`)

	body := `{"pageId":1,"results":[
		{"url":"https://known.example","status":"offline","error":"Gone"},
		{"url":"https://deleted.example","status":"offline","error":"Gone"}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.UpdateBookmarkHealthStatuses(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var out struct {
		Updated int `json:"updated"`
		Skipped int `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Updated != 1 || out.Skipped != 1 {
		t.Fatalf("updated=%d skipped=%d, want 1 and 1", out.Updated, out.Skipped)
	}
}

func TestUpdateStatusesRejectBadRequests(t *testing.T) {
	h, _ := batchTestHandlers(t, `{"id":1,"name":"Page 1","bookmarks":[]}`)

	for _, tc := range []struct {
		name string
		body string
		code int
	}{
		{"no page", `{"results":[{"url":"https://a.example","status":"online"}]}`, http.StatusBadRequest},
		{"empty results", `{"pageId":1,"results":[]}`, http.StatusBadRequest},
		{"not json", `nonsense`, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/health/statuses", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()
			h.UpdateBookmarkHealthStatuses(rec, req)
			if rec.Code != tc.code {
				t.Fatalf("code = %d, want %d (%s)", rec.Code, tc.code, rec.Body.String())
			}
		})
	}
}
