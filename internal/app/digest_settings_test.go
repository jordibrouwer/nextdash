package app

import "testing"

func TestDigestSettingsDefaultsForAnOldFile(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	s := h.store.GetSettings()
	if !s.DigestEnabled || !s.DigestHealth || !s.DigestUpdates || !s.DigestUsage {
		t.Fatalf("digest switches should default on: %+v", s)
	}
	if s.DigestWeekday != 1 || s.DigestTime != "08:00" {
		t.Fatalf("want Monday 08:00, got %d %q", s.DigestWeekday, s.DigestTime)
	}
}

func TestDigestSettingsKeepAnExplicitOff(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"digestEnabled":false,"digestWeekday":0,"digestTime":"21:30"}`)
	s := h.store.GetSettings()
	if s.DigestEnabled || s.DigestWeekday != 0 || s.DigestTime != "21:30" {
		t.Fatalf("explicit choices lost: %+v", s)
	}
}

func TestNormalizeDigestSettings(t *testing.T) {
	s := Settings{DigestWeekday: 9, DigestTime: "25:99"}
	normalizeDigestSettings(&s)
	if s.DigestWeekday != 1 || s.DigestTime != "08:00" {
		t.Fatalf("got %d %q", s.DigestWeekday, s.DigestTime)
	}
	if h, m := parseDigestTime("07:05"); h != 7 || m != 5 {
		t.Fatalf("parse: %d:%d", h, m)
	}
}
