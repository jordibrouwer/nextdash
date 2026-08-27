package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// U1 — InboxLink.Tags was stored and normalised on add, but PATCH had no field
// for it, so a tag could never be changed or removed once set. The extension
// could file a link with tags the user could neither see nor edit.
func TestPatchUpdatesTags(t *testing.T) {
	h := inboxTestHandlers(t)

	created, _, err := h.store.AddInboxLink(InboxLink{
		URL:  "https://tagged.example",
		Tags: []string{"first"},
	}, false, 500)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	patch := func(body string) InboxLink {
		t.Helper()
		req := httptest.NewRequest(http.MethodPatch, "/api/inbox", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.PatchInboxItem(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
		for _, item := range h.store.GetInboxItems() {
			if item.ID == created.ID {
				return item
			}
		}
		t.Fatal("item vanished")
		return InboxLink{}
	}

	got := patch(`{"id":"` + created.ID + `","tags":["Work","READING","work"]}`)
	// normalizeTags: lowercased, deduplicated, empties dropped — the same
	// treatment the add path gives them, so one tag typed two ways is one tag.
	if len(got.Tags) != 2 {
		t.Fatalf("tags = %v, want 2 after normalisation", got.Tags)
	}
	if got.Tags[0] != "work" || got.Tags[1] != "reading" {
		t.Errorf("tags = %v, want [work reading]", got.Tags)
	}

	// An explicit empty list clears them; the field is a pointer precisely so
	// this is distinguishable from "not sent".
	if cleared := patch(`{"id":"` + created.ID + `","tags":[]}`); len(cleared.Tags) != 0 {
		t.Errorf("tags = %v, want cleared", cleared.Tags)
	}
}

// The control: a patch that does not mention tags must leave them alone, or
// every note edit would wipe them.
func TestPatchWithoutTagsLeavesThemAlone(t *testing.T) {
	h := inboxTestHandlers(t)

	created, _, err := h.store.AddInboxLink(InboxLink{
		URL:  "https://keep.example",
		Tags: []string{"keep"},
	}, false, 500)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPatch, "/api/inbox",
		strings.NewReader(`{"id":"`+created.ID+`","note":"just a note"}`))
	rec := httptest.NewRecorder()
	h.PatchInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	for _, item := range h.store.GetInboxItems() {
		if item.ID == created.ID {
			if len(item.Tags) != 1 || item.Tags[0] != "keep" {
				t.Errorf("tags = %v, want [keep] untouched", item.Tags)
			}
			return
		}
	}
	t.Fatal("item vanished")
}

// Tags are client-supplied, so they are bounded like every other stored field.
func TestTagsAreBounded(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	many := make([]string, 0, 100)
	for i := 0; i < 100; i++ {
		many = append(many, strings.Repeat("t", 200)+itoa(int64(i)))
	}
	created, _, err := store.AddInboxLink(InboxLink{URL: "https://many.example", Tags: many}, false, 500)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(created.Tags) > inboxMaxTags {
		t.Errorf("kept %d tags, want at most %d", len(created.Tags), inboxMaxTags)
	}
	for _, tag := range created.Tags {
		if len([]rune(tag)) > inboxMaxTagLen {
			t.Errorf("tag of %d runes, want at most %d", len([]rune(tag)), inboxMaxTagLen)
		}
	}
}
