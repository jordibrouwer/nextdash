package app

import "testing"

func TestCountdownKeepsAValidDateAndTime(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeCountdown, map[string]any{"date": " 2026-12-24 ", "time": "18:30", "showTime": true})
	if got["date"] != "2026-12-24" || got["time"] != "18:30" || got["showTime"] != true {
		t.Errorf("got %v", got)
	}
}

func TestCountdownDropsWhatIsNotADate(t *testing.T) {
	for _, date := range []any{"tomorrow", "2026-13-01", "2026-02-30", "24-12-2026", 20261224, ""} {
		got := sanitizeWidgetConfig(WidgetTypeCountdown, map[string]any{"date": date, "time": "25:00"})
		if _, kept := got["date"]; kept {
			t.Errorf("date %v survived: %v", date, got)
		}
		if _, kept := got["time"]; kept {
			t.Errorf("time 25:00 survived: %v", got)
		}
	}
}

func TestClockKeepsItsZonesAndFlags(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeClock, map[string]any{"zones": []any{"Tokyo=Asia/Tokyo", "Europe/London"}, "hour12": true, "showDate": true})
	zones, _ := got["zones"].([]string)
	if len(zones) != 2 || got["hour12"] != true || got["showDate"] != true {
		t.Errorf("got %v", got)
	}
}
