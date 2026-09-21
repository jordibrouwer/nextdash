package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// "Mark all read" and "Clear read" sent one request per item, each rewriting
// inbox.json whole. The batch route does the lot under one lock, one write.

func batchInbox(t *testing.T, h *Handlers, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/inbox/batch", bytes.NewReader(raw))
	rec := httptest.NewRecorder()
	h.BatchInbox(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func seedInbox(t *testing.T, store *FileStore, urls ...string) []string {
	t.Helper()
	ids := make([]string, 0, len(urls))
	for _, u := range urls {
		created, _, err := store.AddInboxLink(InboxLink{URL: u}, true, 500)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, created.ID)
	}
	return ids
}

func TestBatchInboxReadUnreadSnoozeDelete(t *testing.T) {
	h, raw := patchTestHandlers(t)
	store := raw.(*FileStore)
	ids := seedInbox(t, store, "https://a.example/", "https://b.example/", "https://c.example/")

	rec, out := batchInbox(t, h, map[string]any{"op": "read", "ids": append(ids[:2:2], "missing-id")})
	if rec.Code != http.StatusOK {
		t.Fatalf("read status = %d %s", rec.Code, rec.Body.String())
	}
	if out["done"].(float64) != 2 || len(out["missing"].([]any)) != 1 {
		t.Fatalf("read out = %+v", out)
	}
	read := 0
	for _, item := range store.GetInboxItems() {
		if item.ReadAt > 0 {
			read++
		}
	}
	if read != 2 {
		t.Fatalf("read = %d, want 2", read)
	}

	batchInbox(t, h, map[string]any{"op": "unread", "ids": ids[:1]})
	batchInbox(t, h, map[string]any{"op": "snooze", "ids": ids[2:], "snoozedUntil": 1 << 62})
	for _, item := range store.GetInboxItems() {
		switch item.ID {
		case ids[0]:
			if item.ReadAt != 0 {
				t.Fatalf("unread did not clear ReadAt")
			}
		case ids[2]:
			if item.SnoozedUntil == 0 {
				t.Fatalf("snooze not applied")
			}
		}
	}

	batchInbox(t, h, map[string]any{"op": "delete", "ids": ids[1:]})
	left := store.GetInboxItems()
	if len(left) != 1 || left[0].ID != ids[0] {
		t.Fatalf("after delete = %+v", left)
	}
}

func TestBatchInboxRejectsUnknownOp(t *testing.T) {
	h, _ := patchTestHandlers(t)
	rec, _ := batchInbox(t, h, map[string]any{"op": "explode", "ids": []string{"x"}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestBatchInboxTagMergesPerItem(t *testing.T) {
	h, raw := patchTestHandlers(t)
	store := raw.(*FileStore)
	ids := seedInbox(t, store, "https://a.example/", "https://b.example/")
	if _, err := store.UpdateInboxLink(ids[0], func(l *InboxLink) error { l.Tags = []string{"old", "keep"}; return nil }); err != nil {
		t.Fatal(err)
	}
	rec, _ := batchInbox(t, h, map[string]any{"op": "tag", "ids": ids, "addTags": []string{"New"}, "removeTags": []string{"old"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	for _, item := range store.GetInboxItems() {
		want := "new"
		if item.ID == ids[0] {
			want = "keep,new"
		}
		got := ""
		for i, tag := range item.Tags {
			if i > 0 {
				got += ","
			}
			got += tag
		}
		if got != want {
			t.Fatalf("item %s tags = %q, want %q", item.URL, got, want)
		}
	}
}
