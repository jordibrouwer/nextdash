package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/mux"
)

func duplicateRouter(h *Handlers) *mux.Router {
	r := mux.NewRouter()
	r.HandleFunc("/api/pages/{id:[0-9]+}/blocks", h.SavePageBlocksHandler).Methods(http.MethodPut)
	r.HandleFunc("/api/pages/{id:[0-9]+}/widgets/{widget}/duplicate", h.DuplicateWidgetHandler).Methods(http.MethodPost)
	return r
}

func duplicate(t *testing.T, h *Handlers, widgetID, body string) (int, struct {
	PageBlocksResponse
	ID string `json:"id"`
}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/pages/1/widgets/"+widgetID+"/duplicate", strings.NewReader(body))
	rec := httptest.NewRecorder()
	duplicateRouter(h).ServeHTTP(rec, req)
	var out struct {
		PageBlocksResponse
		ID string `json:"id"`
	}
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec.Code, out
}

// The copy stands right after the source, with its own id, and keeps the
// address the browser never sees.
func TestDuplicateWidgetKeepsTheAddressAndStandsNextToTheSource(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[
		{"type":"custom","title":"Speed","config":{"url":"http://192.168.1.5/api","ttl":120}},
		{"type":"health","title":"Status"}]}`)
	source := saved.Widgets[0]

	code, out := duplicate(t, h, source.ID, `{"title":"Speed (copy)"}`)
	if code != http.StatusOK {
		t.Fatalf("duplicate = %d", code)
	}
	if out.ID == "" || out.ID == source.ID || !isWidgetID(out.ID) {
		t.Fatalf("new id = %q", out.ID)
	}
	if len(out.Widgets) != 3 || out.Widgets[1].ID != out.ID {
		t.Fatalf("copy should stand second of three: %+v", out.Widgets)
	}
	if out.Widgets[1].Title != "Speed (copy)" {
		t.Errorf("title = %q", out.Widgets[1].Title)
	}
	if got, _ := out.Widgets[1].Config["url"].(string); got != "http://192.168.1.5/api" {
		t.Errorf("the copy lost its address: %v", out.Widgets[1].Config)
	}
	at := map[string]int{}
	for i, id := range out.Order {
		at[id] = i
	}
	if at[out.ID] != at[source.ID]+1 {
		t.Errorf("order %v: the copy is not right after the source", out.Order)
	}
}

// A sign-in the source minted for itself is filed again under the copy's id.
func TestDuplicateWidgetCopiesItsOwnSignIn(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"custom","config":{"url":"http://192.168.1.5/api"}}]}`)
	source := saved.Widgets[0]
	if err := saveHealthCredential("widget:"+source.ID, HealthCredential{Headers: map[string]string{"X-Api-Key": "s3cret"}}); err != nil {
		t.Fatal(err)
	}

	code, out := duplicate(t, h, source.ID, ``)
	if code != http.StatusOK {
		t.Fatalf("duplicate = %d", code)
	}
	got, ok := lookupHealthCredential("widget:" + out.ID)
	if !ok || got.Headers["X-Api-Key"] != "s3cret" {
		t.Errorf("the copy has no sign-in of its own: %+v (found %v)", got, ok)
	}
	if _, still := lookupHealthCredential("widget:" + source.ID); !still {
		t.Error("the source lost its sign-in")
	}
}

func TestDuplicateWidgetRefusesAnUnknownWidget(t *testing.T) {
	h := newTestHandlers(t)
	callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"health"}]}`)
	if code, _ := duplicate(t, h, "w_nope", ``); code != http.StatusNotFound {
		t.Errorf("code = %d, want 404", code)
	}
}

// blocksMeanwhileStore runs a write right after the first read of a page's
// blocks, standing in for a second tab that saves while a copy is made.
type blocksMeanwhileStore struct {
	Store
	between func()
}

func (s *blocksMeanwhileStore) GetPageBlocks(pageID int) ([]Widget, []string) {
	widgets, order := s.Store.GetPageBlocks(pageID)
	if f := s.between; f != nil {
		s.between = nil
		f()
	}
	return widgets, order
}

// A widget saved between the copy's read and its write survives the copy.
func TestDuplicateWidgetKeepsAWidgetAddedMeanwhile(t *testing.T) {
	h := newTestHandlers(t)
	saved := callBlocks(t, h, http.MethodPut, `{"widgets":[{"type":"health","title":"Status"}]}`)
	source := saved.Widgets[0]
	inner := h.store
	h.store = &blocksMeanwhileStore{Store: inner, between: func() {
		widgets, order := inner.GetPageBlocks(1)
		widgets = append(widgets, Widget{ID: "w_meanwhile01", Type: WidgetTypeHealth, Title: "Meanwhile"})
		if err := inner.SavePageBlocks(1, widgets, order); err != nil {
			t.Fatalf("save meanwhile: %v", err)
		}
	}}

	code, out := duplicate(t, h, source.ID, "")
	if code != http.StatusOK {
		t.Fatalf("duplicate = %d", code)
	}
	titles := []string{}
	for _, widget := range out.Widgets {
		titles = append(titles, widget.Title)
	}
	if len(out.Widgets) != 3 {
		t.Fatalf("widgets = %v, want the source, its copy and the one saved meanwhile", titles)
	}
	if out.Widgets[1].ID != out.ID {
		t.Errorf("widgets = %v: the copy is not right after the source", titles)
	}
}
