package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func postLookSettings(t *testing.T, h *Handlers, body string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.SaveSettings(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("save settings: %d %s", rec.Code, rec.Body.String())
	}
}

// A tuning object that leaves keys out takes the default for them, as a
// settings file does: a tab still running the page from before the quiet
// centre existed sends no calm, and 0 is a real answer for it.
func TestSaveSettingsFillsMissingBackdropTuning(t *testing.T) {
	h := newTestHandlers(t)

	postLookSettings(t, h, `{"backdropTuning":{"strength":1.5,"seed":3}}`)
	got := h.store.GetSettings().BackdropTuning
	def := defaultBackdropTuning()
	if got.Calm != def.Calm {
		t.Errorf("a missing calm was stored as %v, want %v", got.Calm, def.Calm)
	}
	if got.Scale != def.Scale || got.Brightness != def.Brightness || got.Saturate != def.Saturate {
		t.Errorf("missing keys were not defaulted: %+v", got)
	}
	if got.Strength != 1.5 || got.Seed != 3 {
		t.Errorf("sent keys were lost: %+v", got)
	}

	// An explicit 0 stays 0.
	postLookSettings(t, h, `{"backdropTuning":{"strength":0,"scale":1,"brightness":1,"saturate":0,"calm":0}}`)
	got = h.store.GetSettings().BackdropTuning
	if got.Calm != 0 || got.Strength != 0 || got.Saturate != 0 {
		t.Errorf("an answer of 0 was replaced: %+v", got)
	}

	// A save that does not mention the tuning leaves it alone.
	postLookSettings(t, h, `{"bookmarkStaleDays":9}`)
	if after := h.store.GetSettings().BackdropTuning; after != got {
		t.Errorf("an unrelated save changed the tuning: %+v -> %+v", got, after)
	}
}
