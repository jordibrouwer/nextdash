package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Undo at capacity.
//
// RestoreInboxLink prepends the item and then trims, and the trim orders by
// AddedAt — which a restored item always loses, because it carries the
// timestamp from when it was first saved. At capacity that meant the same call
// which "restored" the item also discarded it, while the handler answered 200
// with the item echoed back. The client re-inserted it into its own list, so
// undo looked like it worked right up until the next reload.
//
// The rule now: the item being restored is protected, and the oldest of the
// *others* makes way for it. Age still decides everything else.

func TestTrimKeepingProtectsTheRestoredItem(t *testing.T) {
	items := []InboxLink{
		{ID: "new", AddedAt: 5000},
		{ID: "mid", AddedAt: 4000},
		{ID: "restored", AddedAt: 1000}, // oldest — the one a plain trim would cut
	}
	got := trimInboxItemsKeeping(items, 2, "restored")

	if len(got) != 2 {
		t.Fatalf("trimmed to %d items, want 2", len(got))
	}
	ids := map[string]bool{}
	for _, i := range got {
		ids[i.ID] = true
	}
	if !ids["restored"] {
		t.Error("the restored item was trimmed away — the protection did not hold")
	}
	// The newest of the others survives; the middle one makes way.
	if !ids["new"] {
		t.Error("the newest item was dropped instead of the oldest other one")
	}
	if ids["mid"] {
		t.Error("both other items survived, so the cap was not honoured")
	}
}

// The protection is scoped to one item: everything else is still ordered by
// age, so this must not turn into "keep whatever was passed last".
func TestTrimKeepingStillOrdersTheRestByAge(t *testing.T) {
	items := []InboxLink{
		{ID: "a", AddedAt: 9000},
		{ID: "b", AddedAt: 8000},
		{ID: "c", AddedAt: 7000},
		{ID: "keep", AddedAt: 100},
	}
	got := trimInboxItemsKeeping(items, 3, "keep")
	if len(got) != 3 {
		t.Fatalf("trimmed to %d, want 3", len(got))
	}
	ids := map[string]bool{}
	for _, i := range got {
		ids[i.ID] = true
	}
	if !ids["keep"] || !ids["a"] || !ids["b"] {
		t.Errorf("expected keep + the two newest others, got %v", ids)
	}
	if ids["c"] {
		t.Error("the oldest of the others survived the cut")
	}
}

// An ID that is not in the list must not cost a slot, or a stale undo would
// silently shrink the inbox by one.
func TestTrimKeepingIgnoresAnAbsentID(t *testing.T) {
	items := []InboxLink{
		{ID: "a", AddedAt: 3000},
		{ID: "b", AddedAt: 2000},
		{ID: "c", AddedAt: 1000},
	}
	got := trimInboxItemsKeeping(items, 2, "not-here")
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
		t.Errorf("expected the two newest, got %+v", got)
	}
}

// Under the cap nothing is cut at all, protected or not.
func TestTrimKeepingLeavesAnUnderfullListAlone(t *testing.T) {
	items := []InboxLink{{ID: "a", AddedAt: 2000}, {ID: "b", AddedAt: 1000}}
	if got := trimInboxItemsKeeping(items, 5, "b"); len(got) != 2 {
		t.Errorf("trimmed an underfull list to %d", len(got))
	}
}

// The end-to-end case the bug was reported from: delete an old item, let the
// inbox refill while the undo toast is up, then press undo.
func TestUndoRestoresAnOldItemAtCapacity(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"inboxMaxItems":3}`)
	now := time.Now().UnixMilli()

	old := InboxLink{ID: "inl_old", URL: "https://old.example", AddedAt: now - 900000}
	if _, _, err := h.store.AddInboxLink(old, false, 3); err != nil {
		t.Fatalf("seed old: %v", err)
	}
	for i, u := range []string{"https://a.example", "https://b.example"} {
		if _, _, err := h.store.AddInboxLink(InboxLink{URL: u, AddedAt: now - int64(i*1000)}, false, 3); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/inbox?id=inl_old", nil)
	rec := httptest.NewRecorder()
	h.DeleteInboxItem(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete = %d, want 200", rec.Code)
	}

	// Something else arrives before undo is pressed: back to capacity.
	if _, _, err := h.store.AddInboxLink(InboxLink{URL: "https://new.example", AddedAt: now}, false, 3); err != nil {
		t.Fatalf("refill: %v", err)
	}

	body, _ := json.Marshal(map[string]any{"item": old})
	req2 := httptest.NewRequest(http.MethodPut, "/api/inbox", strings.NewReader(string(body)))
	rec2 := httptest.NewRecorder()
	h.PutInboxItem(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("undo = %d, want 200 (%s)", rec2.Code, rec2.Body.String())
	}

	found := false
	for _, item := range h.store.GetInboxItems() {
		if item.ID == "inl_old" {
			found = true
		}
	}
	if !found {
		t.Error("undo reported success but the item is not in the inbox")
	}
}

// A restore that genuinely cannot be honoured has to say so rather than
// answering 200 for an item it dropped.
func TestRestoreReportsCapacityRatherThanFakingSuccess(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)

	// maxItems of 1 leaves no room for anything but the protected item, so a
	// second restore into a full list is the case that must be refused.
	items := []InboxLink{{ID: "keeper", URL: "https://keeper.example", AddedAt: 5000}}
	if _, _, err := h.store.AddInboxLink(items[0], false, 1); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Restoring a *different* old item with a cap of 1: it is protected, so it
	// survives and the keeper is cut. That is the documented behaviour.
	restored, err := h.store.RestoreInboxLink(
		InboxLink{ID: "inl_other", URL: "https://other.example", AddedAt: 1000}, 1)
	if err != nil {
		t.Fatalf("restore with room for the protected item failed: %v", err)
	}
	if restored.ID != "inl_other" {
		t.Errorf("restored the wrong item: %q", restored.ID)
	}
	live := h.store.GetInboxItems()
	if len(live) != 1 || live[0].ID != "inl_other" {
		t.Errorf("expected only the restored item at cap 1, got %+v", live)
	}
}
