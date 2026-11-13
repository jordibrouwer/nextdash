package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMobileHomeDefaultsToSearch(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if got := h.store.GetSettings().MobileHome; got != "search" {
		t.Fatalf("missing key = %q, want search", got)
	}
	h, _ = healthRecheckTestHandlers(t, `{"mobileHome":"status"}`)
	if got := h.store.GetSettings().MobileHome; got != "status" {
		t.Fatalf("explicit status = %q", got)
	}
	h, _ = healthRecheckTestHandlers(t, `{"mobileHome":"nonsense"}`)
	if got := h.store.GetSettings().MobileHome; got != "search" {
		t.Fatalf("unknown word = %q, want search", got)
	}
}

func TestNormalizeVisibleOn(t *testing.T) {
	for in, want := range map[string]string{"": "", "desktop": "desktop", " Mobile ": "mobile", "tablet": "", "all": ""} {
		if got := normalizeVisibleOn(in); got != want {
			t.Errorf("normalizeVisibleOn(%q) = %q, want %q", in, got, want)
		}
	}
	got := normalizeCollectionVisibleOn(map[string]string{"__smart_today__": "mobile", "custom:a": "x", "foo": "desktop", "tag:x": "desktop"})
	if len(got) != 2 || got["__smart_today__"] != "mobile" || got["tag:x"] != "desktop" {
		t.Fatalf("collection map = %v", got)
	}
}

func TestPauseHoldsNoticesLikeQuietHours(t *testing.T) {
	now := time.Date(2026, 11, 13, 14, 30, 0, 0, time.UTC)
	s := Settings{MaintenanceTimeZone: "UTC"}
	if quietNow(s, now) {
		t.Fatal("nothing paused, no quiet hours: must not hold")
	}
	end, ok := pauseEnd(s, "hour", now)
	if !ok || !end.Equal(now.Add(time.Hour)) {
		t.Fatalf("hour = %v %v", end, ok)
	}
	s.NotifyPausedUntil = end.UnixMilli()
	if !quietNow(s, now) || quietNow(s, end.Add(time.Second)) {
		t.Fatal("pause must hold until its end and not after")
	}
	if got := quietEndsAt(s, now); got.Before(end) || got.After(end.Add(time.Minute)) {
		t.Fatalf("quietEndsAt = %v, want about %v", got, end)
	}
	tomorrow, _ := pauseEnd(s, "tomorrow", now)
	if !tomorrow.Equal(time.Date(2026, 11, 14, 7, 0, 0, 0, time.UTC)) {
		t.Fatalf("tomorrow = %v", tomorrow)
	}
	late := time.Date(2026, 11, 13, 23, 50, 0, 0, time.UTC)
	if got, _ := pauseEnd(s, "tomorrow", late); !got.Equal(time.Date(2026, 11, 14, 7, 0, 0, 0, time.UTC)) {
		t.Fatalf("late tomorrow = %v", got)
	}
	if _, ok := pauseEnd(s, "later", now); ok {
		t.Fatal("unknown mode accepted")
	}
}

func pauseRequest(h *Handlers, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/notify/pause", strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-NextDash-Token", token)
	}
	rec := httptest.NewRecorder()
	h.PauseNotifications(rec, req)
	return rec
}

func TestPauseRouteNeedsTheWriteTokenAndAKnownMode(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret")
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if rec := pauseRequest(h, `{"mode":"hour"}`, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without the token: %d, want 401", rec.Code)
	}
	if h.store.GetSettings().NotifyPausedUntil != 0 {
		t.Fatal("a refused request paused the notices")
	}
	if rec := pauseRequest(h, `{"mode":"later"}`, "secret"); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown mode: %d, want 400", rec.Code)
	}
	if rec := pauseRequest(h, `not json`, "secret"); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad body: %d, want 400", rec.Code)
	}
	if rec := pauseRequest(h, `{"mode":"hour"}`, "secret"); rec.Code != http.StatusOK {
		t.Fatalf("hour: %d", rec.Code)
	}
	if until := h.store.GetSettings().NotifyPausedUntil; until <= time.Now().UnixMilli() {
		t.Fatalf("pause not stored: %d", until)
	}
	if rec := pauseRequest(h, `{"mode":"off"}`, "secret"); rec.Code != http.StatusOK || h.store.GetSettings().NotifyPausedUntil != 0 {
		t.Fatalf("off: %d, until %d", rec.Code, h.store.GetSettings().NotifyPausedUntil)
	}
}

func TestSavingSettingsKeepsThePause(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	if rec := pauseRequest(h, `{"mode":"hour"}`, ""); rec.Code != http.StatusOK {
		t.Fatalf("pause: %d", rec.Code)
	}
	want := h.store.GetSettings().NotifyPausedUntil
	// A page that loaded its settings before the pause sends them back with 0.
	req := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"notifyPausedUntil":0,"theme":"dark"}`))
	rec := httptest.NewRecorder()
	h.SaveSettings(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if got := h.store.GetSettings().NotifyPausedUntil; got != want {
		t.Fatalf("a settings save changed the pause: %d, want %d", got, want)
	}
}
