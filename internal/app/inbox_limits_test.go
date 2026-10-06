package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// V6 — no write path bounded its text fields. inbox.json is read and rewritten
// in full on every mutation and shipped whole on every dashboard load, so one
// runaway value is paid for by every later request, not just the one that
// stored it.
func TestInboxFieldsAreBounded(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	huge := strings.Repeat("x", 300_000)
	created, _, err := store.AddInboxLink(InboxLink{
		URL:   "https://long.example",
		Title: huge,
		Note:  huge,
	}, false, 500)
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	if len([]rune(created.Title)) != inboxMaxTitleLen {
		t.Errorf("title kept %d runes, want it clamped to %d", len([]rune(created.Title)), inboxMaxTitleLen)
	}
	if len([]rune(created.Note)) != inboxMaxNoteLen {
		t.Errorf("note kept %d runes, want it clamped to %d", len([]rune(created.Note)), inboxMaxNoteLen)
	}

	// Stored, not just returned: the clamp has to survive the write.
	stored := store.GetInboxItems()
	if len(stored) != 1 {
		t.Fatalf("len = %d, want 1", len(stored))
	}
	if len([]rune(stored[0].Title)) != inboxMaxTitleLen {
		t.Errorf("persisted title is %d runes, want %d", len([]rune(stored[0].Title)), inboxMaxTitleLen)
	}
}

// The control: an ordinary title is left exactly as it was. Without this, a
// clamp that truncated everything would pass the test above.
func TestInboxFieldsUnderTheLimitAreUntouched(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	title := "A perfectly ordinary title"
	created, _, err := store.AddInboxLink(InboxLink{URL: "https://short.example", Title: title}, false, 500)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if created.Title != title {
		t.Errorf("title = %q, want it unchanged", created.Title)
	}
}

// truncateRunes must not split a multi-byte character in half, which a byte
// slice would.
func TestTruncateRunesKeepsCharactersWhole(t *testing.T) {
	got := truncateRunes("héllo wörld", 5)
	if got != "héllo" {
		t.Errorf("got %q, want %q", got, "héllo")
	}
	if !strings.HasSuffix(got, "o") {
		t.Errorf("got %q, which looks like a split rune", got)
	}
}

// V7 — SnoozedUntil was carefully clamped and ReadAt right above it was not, so
// a negative or far-future timestamp was stored verbatim and corrupted the
// read/unread reconciliation the client does against this field.
func TestPatchClampsReadAt(t *testing.T) {
	h := inboxTestHandlers(t)

	created, _, err := h.store.AddInboxLink(InboxLink{URL: "https://read.example"}, false, 500)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	// The id travels in the body on this endpoint, not the query string.
	patch := func(fields string) InboxLink {
		t.Helper()
		body := `{"id":"` + created.ID + `",` + fields + `}`
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

	if got := patch(`"readAt":-5`); got.ReadAt != 0 {
		t.Errorf("negative readAt stored as %d, want 0", got.ReadAt)
	}

	future := time.Now().UnixMilli() + 99_000_000_000
	got := patch(`"readAt":` + itoa(future))
	if got.ReadAt > time.Now().UnixMilli()+1000 {
		t.Errorf("far-future readAt stored as %d, want it clamped to now", got.ReadAt)
	}
	if got.ReadAt == 0 {
		t.Error("a future readAt should still count as read, not be cleared")
	}
}

// V8 — only the explicit DELETE path ever cleaned up an icon, so every capacity
// eviction left a favicon behind in data/icons/ for good. The evicted items are
// also what tells the client an add pushed something out (V5).
func TestCapacityEvictionReportsIconsToClean(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	now := time.Now().UnixMilli()
	// Oldest, and the one the next add will evict.
	if _, _, err := store.AddInboxLink(InboxLink{
		URL: "https://evicted.example", Icon: "evicted-icon.ico", AddedAt: now - 10_000,
	}, false, 2); err != nil {
		t.Fatalf("seed evicted: %v", err)
	}
	if _, _, err := store.AddInboxLink(InboxLink{
		URL: "https://kept.example", Icon: "kept-icon.ico", AddedAt: now - 5_000,
	}, false, 2); err != nil {
		t.Fatalf("seed kept: %v", err)
	}

	_, evicted, err := store.AddInboxLink(InboxLink{URL: "https://fresh.example", AddedAt: now}, false, 2)
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	if len(evicted) != 1 || evicted[0].Icon != "evicted-icon.ico" {
		t.Fatalf("evicted = %+v, want the one item carrying evicted-icon.ico", evicted)
	}
	if evicted[0].URL != "https://evicted.example" {
		t.Errorf("evicted the wrong item: %q", evicted[0].URL)
	}
}

// The control: an add that evicts nothing reports nothing to clean, so the
// handler cannot delete an icon that is still in use.
func TestAddWithRoomReportsNoIconsToClean(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	store := &FileStore{dataDir: dir}

	if _, _, err := store.AddInboxLink(InboxLink{
		URL: "https://one.example", Icon: "one.ico",
	}, false, 100); err != nil {
		t.Fatalf("seed: %v", err)
	}
	_, evicted, err := store.AddInboxLink(InboxLink{URL: "https://two.example"}, false, 100)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(evicted) != 0 {
		t.Errorf("evicted = %+v, want none", evicted)
	}
}

// The inbox has no cap: past the old limit of 500, an add through the handler
// keeps every earlier link and its icon.
func TestAddInboxItemNeverDropsAnOlderLink(t *testing.T) {
	h := inboxTestHandlers(t)

	dataDir := os.Getenv("NEXTDASH_DATA_DIR")
	iconDir := filepath.Join(dataDir, "icons")
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	iconPath := filepath.Join(iconDir, "oldest.ico")
	if err := os.WriteFile(iconPath, []byte("x"), 0o644); err != nil {
		t.Fatalf("write icon: %v", err)
	}

	now := time.Now().UnixMilli()
	if _, _, err := h.store.AddInboxLink(InboxLink{
		URL: "https://oldest.example", Icon: "oldest.ico", AddedAt: now - 10_000_000,
	}, false, 0); err != nil {
		t.Fatalf("seed: %v", err)
	}
	for i := 0; i < 520; i++ {
		if _, _, err := h.store.AddInboxLink(InboxLink{
			URL: fmt.Sprintf("https://n%d.example", i), AddedAt: now - int64(i),
		}, false, 0); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/inbox", strings.NewReader(`{"url":"https://newest.example"}`))
	rec := httptest.NewRecorder()
	h.AddInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	items := h.store.GetInboxItems()
	if len(items) != 522 {
		t.Fatalf("inbox holds %d items, want all 522", len(items))
	}
	found := false
	for _, item := range items {
		if item.URL == "https://oldest.example" {
			found = true
		}
	}
	if !found {
		t.Error("the oldest link was dropped")
	}
	if _, err := os.Stat(iconPath); err != nil {
		t.Errorf("the oldest link's icon is gone: %v", err)
	}
}
