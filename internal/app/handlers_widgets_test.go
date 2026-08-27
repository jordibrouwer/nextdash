package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func blocksRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", h.GetPageBlocksHandler).Methods(http.MethodGet)
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", h.SavePageBlocksHandler).Methods(http.MethodPut)
	return r
}

func callBlocks(t *testing.T, h *Handlers, method, body string) PageBlocksResponse {
	t.Helper()
	req := httptest.NewRequest(method, "/api/pages/1/blocks", strings.NewReader(body))
	rec := httptest.NewRecorder()
	blocksRouter(h).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s = %d: %s", method, rec.Code, rec.Body.String())
	}
	var out PageBlocksResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out
}

// A widget added through the API comes back with an id and a place in the order.
func TestSaveBlocksStoresAWidget(t *testing.T) {
	h := newTestHandlers(t)

	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"health","title":"Status"}]}`)
	if len(saved.Widgets) != 1 {
		t.Fatalf("widgets = %+v", saved.Widgets)
	}
	if !isWidgetID(saved.Widgets[0].ID) {
		t.Errorf("id = %q, want a widget id", saved.Widgets[0].ID)
	}
	// Present in the order, or it would be stored and never drawn.
	var found bool
	for _, id := range saved.Order {
		if id == saved.Widgets[0].ID {
			found = true
		}
	}
	if !found {
		t.Errorf("order %v does not include the widget", saved.Order)
	}
}

/*
A drag sends only the order, and must not delete the widgets.

The two halves travel in one request, so "not sent" and "sent empty" have to be
different things -- read as an empty list, a reorder would wipe every widget on
the page.
*/
func TestSaveBlocksOrderOnlyKeepsTheWidgets(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"health","title":"Status"}]}`)
	widgetID := saved.Widgets[0].ID

	// What a drop sends: the new order, nothing else.
	after := callBlocks(t, h, http.MethodPut,
		`{"order":["`+widgetID+`","development","media"]}`)

	if len(after.Widgets) != 1 {
		t.Fatalf("a reorder deleted the widgets: %+v", after.Widgets)
	}
	if after.Order[0] != widgetID {
		t.Errorf("order = %v, want the widget first", after.Order)
	}
}

// An explicitly empty list does delete them, which is how removal works.
func TestSaveBlocksCanClearTheWidgets(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"health"}]}`)

	after := callBlocks(t, h, http.MethodPut, `{"widgets":[]}`)
	if len(after.Widgets) != 0 {
		t.Errorf("widgets = %+v, want none", after.Widgets)
	}
	// And the order no longer names it.
	for _, id := range after.Order {
		if isWidgetID(id) {
			t.Errorf("order still names a deleted widget: %v", after.Order)
		}
	}
}

// A type nothing renders is dropped rather than stored as an invisible block.
func TestSaveBlocksRefusesAnUnknownType(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"telepathy"}]}`)
	if len(saved.Widgets) != 0 {
		t.Errorf("stored %+v", saved.Widgets)
	}
}

/*
The order that comes back is the resolved one, not the one sent.

A caller working from a stale copy would otherwise be told its version took, and
draw a grid that the next load contradicts.
*/
func TestSaveBlocksAnswersWithTheResolvedOrder(t *testing.T) {
	h := newTestHandlers(t)

	after := callBlocks(t, h, http.MethodPut, `{"order":["media","nosuchthing"]}`)
	for _, id := range after.Order {
		if id == "nosuchthing" {
			t.Errorf("order kept an id that names nothing: %v", after.Order)
		}
	}
	if after.Order[0] != "media" {
		t.Errorf("order = %v, want the sent order honoured first", after.Order)
	}
	// Everything else still there, appended.
	if len(after.Order) < 2 {
		t.Errorf("order = %v, want the unnamed categories kept", after.Order)
	}
}

// A page with no widgets answers with an empty list, not null: a caller should
// not have to handle two kinds of nothing.
//
// The page is emptied first rather than taken as it comes. A fresh install now
// seeds a health widget, so page 1 is not the "no widgets" case any more — and
// this test is about the shape of nothing, not about what a new install ships.
func TestGetBlocksAnswersEmptyRatherThanNull(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[]}`)

	req := httptest.NewRequest(http.MethodGet, "/api/pages/1/blocks", nil)
	rec := httptest.NewRecorder()
	blocksRouter(h).ServeHTTP(rec, req)
	if !strings.Contains(rec.Body.String(), `"widgets":[]`) {
		t.Errorf("body = %s", rec.Body.String())
	}
}
