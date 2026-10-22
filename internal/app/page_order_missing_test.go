package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Pages that have a bookmarks file but are not in pages.json are appended after
// the ordered ones; they used to come in map order, so the tabs reshuffled.
func TestGetPagesAppendsUnorderedPagesByID(t *testing.T) {
	h := newTestHandlers(t)
	for _, id := range []int{1, 2, 3, 5, 7, 9} {
		if err := h.store.SavePage(Page{ID: id, Name: "p"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.store.SavePageOrder([]int{2, 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ResolveDataDir(), "pages.json")); err != nil {
		t.Fatal(err)
	}
	want := []int{2, 1, 3, 5, 7, 9}
	for run := 0; run < 20; run++ {
		var got []int
		for _, p := range h.store.GetPages() {
			got = append(got, p.ID)
		}
		if len(got) != len(want) {
			t.Fatalf("run %d: pages = %v, want %v", run, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("run %d: pages = %v, want %v", run, got, want)
			}
		}
	}
}
