package app

import (
	"encoding/json"
	"testing"
	"time"
)

func TestMaintenanceWindowStatusGroupsNormalised(t *testing.T) {
	out := normalizeMaintenanceWindows([]MaintenanceWindow{{
		Start: "02:00", End: "04:00", StatusGroups: []string{" media ", "", "media", "home"},
	}})
	got := out[0].StatusGroups
	if len(got) != 2 || got[0] != "media" || got[1] != "home" {
		t.Fatalf("statusGroups = %v, want [media home]", got)
	}
}

func TestMaintenanceWindowWithoutGroupsHasNoField(t *testing.T) {
	raw, _ := json.Marshal(MaintenanceWindow{Start: "02:00", End: "04:00"})
	if string(raw) != `{"start":"02:00","end":"04:00"}` {
		t.Fatalf("an unlinked window must not grow a field on disk: %s", raw)
	}
}

func TestMaintenanceNextOccurrence(t *testing.T) {
	loc := time.UTC
	// Wednesday 7 Oct 2026, 10:00.
	now := time.Date(2026, 10, 7, 10, 0, 0, 0, loc)
	sat := MaintenanceWindow{Days: []int{6}, Start: "02:00", End: "04:00"}
	start, end, active, ok := sat.nextOccurrence(now, 7*24*time.Hour)
	if !ok || active || !start.Equal(time.Date(2026, 10, 10, 2, 0, 0, 0, loc)) || !end.Equal(time.Date(2026, 10, 10, 4, 0, 0, 0, loc)) {
		t.Fatalf("next Saturday window wrong: %v %v %v %v", start, end, active, ok)
	}
	// Inside a window: active, with today's start.
	daily := MaintenanceWindow{Start: "09:30", End: "10:30"}
	start, _, active, ok = daily.nextOccurrence(now, 7*24*time.Hour)
	if !ok || !active || !start.Equal(time.Date(2026, 10, 7, 9, 30, 0, 0, loc)) {
		t.Fatalf("open window not reported active: %v %v %v", start, active, ok)
	}
	// Wraps past midnight: Tuesday 23:00–01:00 is open at Wednesday 00:30.
	wrap := MaintenanceWindow{Days: []int{2}, Start: "23:00", End: "01:00"}
	_, end, active, ok = wrap.nextOccurrence(time.Date(2026, 10, 7, 0, 30, 0, 0, loc), 7*24*time.Hour)
	if !ok || !active || !end.Equal(time.Date(2026, 10, 7, 1, 0, 0, 0, loc)) {
		t.Fatalf("wrapping window: end %v active %v ok %v", end, active, ok)
	}
	// Beyond the horizon: none.
	if _, _, _, ok := sat.nextOccurrence(now, 24*time.Hour); ok {
		t.Fatal("a window two days out is beyond a one-day horizon")
	}
}
