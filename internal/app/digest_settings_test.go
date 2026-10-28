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

func TestDigestSettingsIgnoreAnOldOffSwitch(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"digestEnabled":false,"digestHealth":false,"digestWeekday":0,"digestTime":"21:30"}`)
	s := h.store.GetSettings()
	if !s.DigestEnabled || !s.DigestHealth {
		t.Fatalf("the digest and its Now group cannot be switched off: enabled=%v health=%v", s.DigestEnabled, s.DigestHealth)
	}
	if s.DigestWeekday != 0 || s.DigestTime != "21:30" {
		t.Fatalf("day and hour lost: %d %q", s.DigestWeekday, s.DigestTime)
	}
}

func TestNormalizeDigestSettingsForcesOn(t *testing.T) {
	s := Settings{DigestEnabled: false, DigestHealth: false, DigestWeekday: 3, DigestTime: "07:05"}
	normalizeDigestSettings(&s)
	if !s.DigestEnabled || !s.DigestHealth || s.DigestWeekday != 3 || s.DigestTime != "07:05" {
		t.Fatalf("got enabled=%v health=%v %d %q", s.DigestEnabled, s.DigestHealth, s.DigestWeekday, s.DigestTime)
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
