package app

import (
	"os"
	"path/filepath"
	"testing"
)

// A move names the page it comes from: the moved row brings its own checks,
// not those of the same address on another page.
func TestChecksOfMovedRowTakesTheSourcePage(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true}`)
	write := func(id int, checkID string) {
		page := `{"id":` + itoa(int64(id)) + `,"name":"P","bookmarks":[{"name":"NAS","url":"https://nas.example.com/","checks":[{"id":"` + checkID + `","type":"tcp","port":22}]}]}`
		if err := os.WriteFile(filepath.Join(dir, "bookmarks-"+itoa(int64(id))+".json"), []byte(page), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(1, "aaaaaaaaaaaa")
	write(2, "bbbbbbbbbbbb")
	got := checksOfMovedRow(h.store, "https://nas.example.com/", 2, 3)
	if len(got) != 1 || got[0].ID != "bbbbbbbbbbbb" {
		t.Fatalf("the move took the checks of another row: %+v", got)
	}
}
