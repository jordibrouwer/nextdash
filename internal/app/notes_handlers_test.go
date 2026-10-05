package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postNotes(t *testing.T, h *Handlers, fn http.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	rec := httptest.NewRecorder()
	fn(rec, req)
	return rec
}

func TestNotesRenderHandler(t *testing.T) {
	h := newTestHandlers(t)
	rec := postNotes(t, h, h.NotesRenderHandler, `{"text":"# Hi\n[x] ok"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"type":"heading"`) || !strings.Contains(rec.Body.String(), `"tasksDone":1`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	long := `{"text":"` + strings.Repeat("a", widgetMaxNoteLen+1) + `"}`
	if rec := postNotes(t, h, h.NotesRenderHandler, long); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("too long: %d", rec.Code)
	}
	if rec := postNotes(t, h, h.NotesRenderHandler, `not json`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", rec.Code)
	}
}

func TestNotesCommandHandler(t *testing.T) {
	h := newTestHandlers(t)
	rec := postNotes(t, h, h.NotesCommandHandler, `{"command":"h1","value":"x","start":0,"end":0}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"value":"# x"`) {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	full := `{"command":"table","value":"` + strings.Repeat("a", widgetMaxNoteLen) + `","start":0,"end":0}`
	if rec := postNotes(t, h, h.NotesCommandHandler, full); !strings.Contains(rec.Body.String(), `"error":"full"`) {
		t.Fatalf("full: %d %s", rec.Code, rec.Body.String())
	}
	if rec := postNotes(t, h, h.NotesCommandHandler, `{"command":"nope","value":""}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown: %d", rec.Code)
	}
}
