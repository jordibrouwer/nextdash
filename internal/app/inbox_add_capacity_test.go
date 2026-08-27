package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// trimInboxItems cuts oldest-first, so an item added with an AddedAt older than
// everything already there used to be dropped by the very call that added it —
// and reported as a success, so the client believed it had landed and only found
// out on the next reload. The add path now protects the incoming item the way
// RestoreInboxLink already did: it survives, and the oldest item that was
// already there is evicted instead.
func TestAddInboxLinkKeepsAnOlderNewItemAndEvictsInstead(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	for _, u := range []string{"https://a.example", "https://b.example", "https://c.example"} {
		if _, _, err := store.AddInboxLink(InboxLink{URL: u}, false, 3); err != nil {
			t.Fatalf("seed %s: %v", u, err)
		}
	}

	// Older than everything present, into a full inbox.
	if _, _, err := store.AddInboxLink(InboxLink{URL: "https://old.example", AddedAt: 1000}, false, 3); err != nil {
		t.Fatalf("add: %v", err)
	}

	items := store.GetInboxItems()
	if len(items) != 3 {
		t.Fatalf("len = %d, want 3", len(items))
	}
	stored := map[string]bool{}
	for _, item := range items {
		stored[item.URL] = true
	}
	if !stored["https://old.example"] {
		t.Error("the added item was trimmed away by its own add")
	}
	if stored["https://a.example"] {
		t.Error("the oldest existing item should have been evicted instead")
	}
}

// The control: a normal add into a full inbox still works, evicting the oldest.
// Without this the test above would pass against a check that refuses every add
// once the inbox is full.
func TestAddInboxLinkStillEvictsTheOldestForANewItem(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	for _, u := range []string{"https://a.example", "https://b.example", "https://c.example"} {
		if _, _, err := store.AddInboxLink(InboxLink{URL: u}, false, 3); err != nil {
			t.Fatalf("seed %s: %v", u, err)
		}
	}

	if _, _, err := store.AddInboxLink(InboxLink{URL: "https://fresh.example"}, false, 3); err != nil {
		t.Fatalf("add: %v", err)
	}

	items := store.GetInboxItems()
	if len(items) != 3 {
		t.Fatalf("len = %d, want 3", len(items))
	}
	found := false
	for _, item := range items {
		if item.URL == "https://fresh.example" {
			found = true
		}
	}
	if !found {
		t.Fatal("the newly added item is missing")
	}
}

func inboxTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	dir := t.TempDir()
	t.Chdir(dir)
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	return NewHandlers(NewStore(), embeddedFiles)
}

// validateBookmarkURL allows an empty string, because a bookmark may have no
// URL. An inbox item is nothing but a URL, so an empty one used to slip through
// and fail deeper as a generic 500 — a client mistake reported as a server fault.
func TestAddInboxItemRejectsEmptyURLWith400(t *testing.T) {
	h := inboxTestHandlers(t)

	for _, body := range []string{`{"url":""}`, `{"url":"   "}`} {
		req := httptest.NewRequest(http.MethodPost, "/api/inbox", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.AddInboxItem(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
}

// PUT restores a whole client-supplied InboxLink, so it has to clear the same
// bar as the add path. It was the one route that would store a URL the add path
// refuses.
func TestPutInboxItemValidatesTheURLLikeAdd(t *testing.T) {
	h := inboxTestHandlers(t)

	for _, url := range []string{"javascript:alert(1)", ""} {
		payload, err := json.Marshal(map[string]any{
			"item": map[string]any{"id": "inl_probe", "url": url},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		req := httptest.NewRequest(http.MethodPut, "/api/inbox", bytes.NewReader(payload))
		rec := httptest.NewRecorder()
		h.PutInboxItem(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("url %q: status = %d, want 400", url, rec.Code)
		}
	}

	// The control: a real URL still restores, or the check above would be
	// indistinguishable from one that rejects everything.
	payload, _ := json.Marshal(map[string]any{
		"item": map[string]any{"id": "inl_ok", "url": "https://fine.example"},
	})
	req := httptest.NewRequest(http.MethodPut, "/api/inbox", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	h.PutInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body = %s", rec.Code, rec.Body.String())
	}
}
