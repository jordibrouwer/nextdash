package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func layoutRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", h.SavePageBlocksHandler).Methods(http.MethodPut)
	r.HandleFunc("/api/pages/{id:[0-9]+}/layout-history", h.LayoutHistoryHandler).Methods(http.MethodGet)
	r.HandleFunc("/api/pages/{id:[0-9]+}/layout-history/{snapshot}/restore", h.RestoreLayoutHandler).Methods(http.MethodPost)
	return r
}

func layoutList(t *testing.T, h *Handlers) []layoutHistoryEntry {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/pages/1/layout-history", nil)
	rec := httptest.NewRecorder()
	layoutRouter(h).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Entries []layoutHistoryEntry `json:"entries"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Entries
}

// Edits that follow each other closely are one step, and the step is the layout
// from before the first of them.
func TestLayoutHistoryKeepsTheStateBeforeABurst(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"One"}]}`)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"One"},{"id":"w_bbbbbbbbbbbb","type":"uptime","title":"Two"}]}`)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"One"},{"id":"w_bbbbbbbbbbbb","type":"uptime","title":"Two"},{"id":"w_cccccccccccc","type":"cpu","title":"Three"}]}`)

	entries := layoutList(t, h)
	if len(entries) != 1 {
		t.Fatalf("a burst of three saves left %d entries, want 1", len(entries))
	}
	// The one entry is the page before the burst began -- the three widgets a
	// new page starts with -- so restoring it takes away all three the burst added
	// (the later saves of the burst are not entries of their own).
	if entries[0].Widgets != 3 || len(entries[0].Removes) != 3 {
		t.Errorf("entry = %+v", entries[0])
	}
	for _, name := range entries[0].Removes {
		if name != "One" && name != "Two" && name != "Three" {
			t.Errorf("unexpected widget in Removes: %q", name)
		}
	}
}

func TestLayoutHistoryRestoreBringsBackAndCanBeUndone(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"Keep"},{"id":"w_bbbbbbbbbbbb","type":"uptime","title":"Gone"}]}`)

	// Let the burst pass by ageing what the history holds.
	age := func() {
		h2 := h.store.(*FileStore)
		doc := readLayoutHistory(h2.dataDir)
		for key, list := range doc.Pages {
			for i := range list {
				list[i].At -= int64(time.Minute / time.Millisecond)
			}
			doc.Pages[key] = list
		}
		if err := writeCompactJSONFile(layoutHistoryPath(h2.dataDir), doc); err != nil {
			t.Fatal(err)
		}
	}
	age()
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"Keep"}]}`)

	entries := layoutList(t, h)
	if len(entries) < 1 {
		t.Fatal("no history")
	}
	first := entries[0]
	if len(first.Brings) != 1 || first.Brings[0] != "Gone" {
		t.Fatalf("restoring should bring back Gone: %+v", first)
	}

	post := func(id string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/pages/1/layout-history/"+id+"/restore", strings.NewReader(""))
		rec := httptest.NewRecorder()
		layoutRouter(h).ServeHTTP(rec, req)
		return rec
	}
	if rec := post(first.ID); rec.Code != http.StatusOK {
		t.Fatalf("restore = %d: %s", rec.Code, rec.Body.String())
	}
	widgets, _ := h.store.GetPageBlocks(1)
	if len(widgets) != 2 {
		t.Fatalf("after restore the page holds %d widgets, want 2", len(widgets))
	}

	// The layout the restore replaced is the newest entry, even inside the
	// burst window: restoring can be undone.
	after := layoutList(t, h)
	if len(after) == 0 || len(after[0].Brings) != 0 || len(after[0].Removes) != 1 {
		t.Fatalf("the replaced layout was not kept: %+v", after)
	}
}

func TestLayoutHistoryRestoreRefusesAnUnknownEntry(t *testing.T) {
	h := newTestHandlers(t)
	req := httptest.NewRequest(http.MethodPost, "/api/pages/1/layout-history/nope/restore", strings.NewReader(""))
	rec := httptest.NewRecorder()
	layoutRouter(h).ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", rec.Code)
	}
}

func TestLayoutHistoryIsCappedPerPage(t *testing.T) {
	h := newTestHandlers(t)
	fs := h.store.(*FileStore)
	for i := 0; i < layoutHistoryPerPage+5; i++ {
		fs.recordLayoutSnapshot(1, []Widget{{ID: "w_aaaaaaaaaaaa", Type: WidgetTypeHealth, Title: string(rune('a' + i%26))}}, nil, true)
	}
	if got := len(fs.LayoutHistory(1)); got != layoutHistoryPerPage {
		t.Errorf("kept %d, want %d", got, layoutHistoryPerPage)
	}
}

// Taking a widget away files the layout it was in even inside a burst: the state
// before the burst may be from before the widget was set up.
func TestLayoutHistoryAlwaysKeepsWhatARemovalTakesAway(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"Base"}]}`)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"Base"},{"id":"w_bbbbbbbbbbbb","type":"uptime","title":"Fresh","config":{"rows":7}}]}`)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"id":"w_aaaaaaaaaaaa","type":"health","title":"Base"}]}`)

	var sawFresh bool
	for _, entry := range layoutList(t, h) {
		for _, name := range entry.Brings {
			if name == "Fresh" {
				sawFresh = true
			}
		}
	}
	if !sawFresh {
		t.Errorf("no entry brings back the widget that was just removed: %+v", layoutList(t, h))
	}
}

func TestLayoutHistoryGoesWithItsPage(t *testing.T) {
	h := newTestHandlers(t)
	fs := h.store.(*FileStore)
	fs.recordLayoutSnapshot(1, []Widget{{ID: "w_aaaaaaaaaaaa", Type: WidgetTypeHealth}}, nil, true)
	fs.recordLayoutSnapshot(2, []Widget{{ID: "w_bbbbbbbbbbbb", Type: WidgetTypeHealth}}, nil, true)
	fs.mutex.Lock()
	fs.forgetLayoutHistory(1)
	fs.mutex.Unlock()
	if got := len(fs.LayoutHistory(1)); got != 0 {
		t.Errorf("page 1 kept %d entries", got)
	}
	if got := len(fs.LayoutHistory(2)); got != 1 {
		t.Errorf("page 2 has %d entries, want 1", got)
	}
}
