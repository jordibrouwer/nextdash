package app

import (
	"slices"
	"testing"
)

func everywhereStore(t *testing.T) *FileStore {
	t.Helper()
	h := newTestHandlers(t)
	for _, page := range []Page{{ID: 1, Name: "One"}, {ID: 2, Name: "Two"}, {ID: 3, Name: "Three"}} {
		if err := h.store.SavePage(page); err != nil {
			t.Fatalf("SavePage %d: %v", page.ID, err)
		}
	}
	return h.store.(*FileStore)
}

func ptrTrue() *bool { on := true; return &on }

func widgetOn(t *testing.T, fs *FileStore, pageID int, id string) (Widget, bool) {
	t.Helper()
	widgets, _ := fs.GetPageBlocks(pageID)
	for _, widget := range widgets {
		if widget.ID == id {
			return widget, true
		}
	}
	return Widget{}, false
}

// putEverywhere stores one notes widget on page 1 with the setting on and
// answers its id.
func putEverywhere(t *testing.T, fs *FileStore) string {
	t.Helper()
	err := fs.SavePageBlocks(1, []Widget{{
		ID: "w_aaaaaaaaaaaa", Type: WidgetTypeNotes, Title: "Shopping", Everywhere: ptrTrue(),
		Config: map[string]any{"text": "milk"},
	}}, nil)
	if err != nil {
		t.Fatalf("SavePageBlocks: %v", err)
	}
	return "w_aaaaaaaaaaaa"
}

func TestEverywhereWidgetGetsACopyOnEveryOtherPage(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	for _, pageID := range []int{2, 3} {
		copy, ok := widgetOn(t, fs, pageID, id)
		if !ok {
			t.Fatalf("page %d has no copy", pageID)
		}
		if !copy.everywhereOn() || copy.Title != "Shopping" || copy.Config["text"] != "milk" {
			t.Errorf("page %d copy = %+v", pageID, copy)
		}
		_, order := fs.GetPageBlocks(pageID)
		if !slices.Contains(order, id) {
			t.Errorf("page %d order %v does not name the copy", pageID, order)
		}
	}
}

// What a page decides about its own layout survives a change made elsewhere.
func TestEverywhereChangeKeepsWhatEachPageDecidedForItself(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	copy, _ := widgetOn(t, fs, 2, id)
	copy.VisibleOn = "mobile"
	copy.Config["columns"] = 2
	copy.Config["enabled"] = false
	if err := fs.SavePageBlocks(2, []Widget{copy}, nil); err != nil {
		t.Fatalf("save page 2: %v", err)
	}

	source, _ := widgetOn(t, fs, 1, id)
	source.Title = "Groceries"
	source.Config["text"] = "bread"
	if err := fs.SavePageBlocks(1, []Widget{source}, nil); err != nil {
		t.Fatalf("save page 1: %v", err)
	}

	got, _ := widgetOn(t, fs, 2, id)
	if got.Title != "Groceries" || got.Config["text"] != "bread" {
		t.Errorf("shared state did not follow: %+v", got)
	}
	if got.VisibleOn != "mobile" || got.Config["enabled"] != false || got.Config["columns"] == nil {
		t.Errorf("page 2 lost its own layout: %+v", got)
	}
}

// A save that only changes something else must not overwrite a copy edited a
// moment ago from another page.
func TestEverywhereSaveWithoutSharedChangeLeavesCopiesAlone(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	copy, _ := widgetOn(t, fs, 3, id)
	copy.Title = "Edited on three"
	if err := fs.SavePageBlocks(3, []Widget{copy}, nil); err != nil {
		t.Fatalf("save page 3: %v", err)
	}
	// Page 1 widens its own copy; that is not a shared change.
	wide, _ := widgetOn(t, fs, 1, id)
	wide.Config["columns"] = 2
	if err := fs.SavePageBlocks(1, []Widget{wide}, nil); err != nil {
		t.Fatalf("save page 1: %v", err)
	}
	two, _ := widgetOn(t, fs, 2, id)
	if two.Title != "Edited on three" || two.Config["columns"] != nil {
		t.Errorf("page 2 = %+v: a per-page change travelled, or the page 3 edit was lost", two)
	}
}

func TestEverywhereRemovingOneCopyKeepsTheOthersAndTheSkip(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	if err := fs.SavePageBlocks(2, []Widget{}, nil); err != nil {
		t.Fatalf("remove on page 2: %v", err)
	}
	if _, ok := widgetOn(t, fs, 2, id); ok {
		t.Fatal("page 2 still has its copy")
	}
	for _, pageID := range []int{1, 3} {
		got, ok := widgetOn(t, fs, pageID, id)
		if !ok || !slices.Equal(got.EverywhereSkip, []int{2}) {
			t.Errorf("page %d: copy %v, skip %v", pageID, ok, got.EverywhereSkip)
		}
	}

	// An edit on another page must not bring page 2's copy back.
	source, _ := widgetOn(t, fs, 1, id)
	source.Title = "Renamed"
	if err := fs.SavePageBlocks(1, []Widget{source}, nil); err != nil {
		t.Fatalf("rename on page 1: %v", err)
	}
	if _, ok := widgetOn(t, fs, 2, id); ok {
		t.Error("page 2 got its copy back")
	}
	if got, _ := widgetOn(t, fs, 3, id); got.Title != "Renamed" {
		t.Errorf("page 3 title = %q", got.Title)
	}
}

func TestEverywhereSwitchedOffRemovesTheOtherCopies(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	source, _ := widgetOn(t, fs, 1, id)
	off := false
	source.Everywhere = &off
	if err := fs.SavePageBlocks(1, []Widget{source}, nil); err != nil {
		t.Fatalf("switch off: %v", err)
	}
	if got, ok := widgetOn(t, fs, 1, id); !ok || got.everywhereOn() {
		t.Errorf("page 1 copy = %+v, kept %v", got, ok)
	}
	for _, pageID := range []int{2, 3} {
		if _, ok := widgetOn(t, fs, pageID, id); ok {
			t.Errorf("page %d still has a copy", pageID)
		}
		if _, order := fs.GetPageBlocks(pageID); slices.Contains(order, id) {
			t.Errorf("page %d order still names it", pageID)
		}
	}
}

func TestEverywhereAPageCreatedLaterCarriesTheWidget(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	if err := fs.SavePage(Page{ID: 4, Name: "Four"}); err != nil {
		t.Fatalf("SavePage: %v", err)
	}
	if got, ok := widgetOn(t, fs, 4, id); !ok || got.Config["text"] != "milk" {
		t.Errorf("page 4 copy = %+v, found %v", got, ok)
	}

	// Renaming a page that exists is not a new page.
	if err := fs.SavePageBlocks(4, []Widget{}, nil); err != nil {
		t.Fatalf("clear page 4: %v", err)
	}
	if err := fs.SavePage(Page{ID: 4, Name: "Four, renamed"}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	if _, ok := widgetOn(t, fs, 4, id); ok {
		t.Error("a rename put the copy back")
	}
}

func TestEverywhereDoesNotApplyToAStack(t *testing.T) {
	fs := everywhereStore(t)
	err := fs.SavePageBlocks(1, []Widget{{ID: "w_bbbbbbbbbbbb", Type: WidgetTypeStack, Everywhere: ptrTrue()}}, nil)
	if err != nil {
		t.Fatalf("SavePageBlocks: %v", err)
	}
	if got, _ := widgetOn(t, fs, 1, "w_bbbbbbbbbbbb"); got.everywhereOn() {
		t.Error("a stack kept the setting")
	}
	if _, ok := widgetOn(t, fs, 2, "w_bbbbbbbbbbbb"); ok {
		t.Error("a stack was copied to another page")
	}
}

// A save that leaves the flag out (an older tab) keeps it; only false switches it off.
func TestEverywhereAbsentFlagKeepsTheSettingAndFalseTurnsItOff(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)

	bare, _ := widgetOn(t, fs, 1, id)
	bare.Everywhere = nil
	bare.Title = "Older tab"
	if err := fs.SavePageBlocks(1, []Widget{bare}, nil); err != nil {
		t.Fatalf("save without the flag: %v", err)
	}
	if got, ok := widgetOn(t, fs, 2, id); !ok || got.Title != "Older tab" {
		t.Fatalf("a save without the flag removed or skipped the copies: %+v, %v", got, ok)
	}

	off := false
	bare.Everywhere = &off
	if err := fs.SavePageBlocks(1, []Widget{bare}, nil); err != nil {
		t.Fatalf("save with false: %v", err)
	}
	if _, ok := widgetOn(t, fs, 2, id); ok {
		t.Error("an explicit false left the copies in place")
	}
}

// A stale list sent back cannot forget a page that took its copy off, and
// switching off and on again starts the list over.
func TestEverywhereSkipListIsKeptByTheServer(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)
	if err := fs.SavePageBlocks(2, []Widget{}, nil); err != nil {
		t.Fatalf("remove on page 2: %v", err)
	}

	stale, _ := widgetOn(t, fs, 1, id)
	stale.EverywhereSkip = nil
	stale.Title = "Stale list"
	if err := fs.SavePageBlocks(1, []Widget{stale}, nil); err != nil {
		t.Fatalf("stale save: %v", err)
	}
	if _, ok := widgetOn(t, fs, 2, id); ok {
		t.Error("a stale skip list brought page 2's copy back")
	}
	if got, _ := widgetOn(t, fs, 3, id); !slices.Equal(got.EverywhereSkip, []int{2}) {
		t.Errorf("page 3 skip = %v", got.EverywhereSkip)
	}

	off := false
	source, _ := widgetOn(t, fs, 1, id)
	source.Everywhere = &off
	if err := fs.SavePageBlocks(1, []Widget{source}, nil); err != nil {
		t.Fatalf("off: %v", err)
	}
	source.Everywhere = ptrTrue()
	if err := fs.SavePageBlocks(1, []Widget{source}, nil); err != nil {
		t.Fatalf("on: %v", err)
	}
	if _, ok := widgetOn(t, fs, 2, id); !ok {
		t.Error("off and on again did not bring page 2's copy back")
	}
}

func TestEverywhereDeletedPageLeavesNoSkipBehind(t *testing.T) {
	fs := everywhereStore(t)
	id := putEverywhere(t, fs)
	if err := fs.SavePageBlocks(2, []Widget{}, nil); err != nil {
		t.Fatalf("remove on page 2: %v", err)
	}
	if err := fs.DeletePage(2); err != nil {
		t.Fatalf("DeletePage: %v", err)
	}
	if got, _ := widgetOn(t, fs, 1, id); len(got.EverywhereSkip) != 0 {
		t.Errorf("skip list still names the deleted page: %v", got.EverywhereSkip)
	}
}
