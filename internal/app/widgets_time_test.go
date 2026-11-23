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

func TestClockKeepsItsLookAndSkyFlags(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeClock, map[string]any{"look": "list", "showSeconds": false, "showMoon": false, "showSun": true})
	if got["look"] != "list" || got["showSeconds"] != false || got["showMoon"] != false || got["showSun"] != true {
		t.Errorf("got %v", got)
	}
	got = sanitizeWidgetConfig(WidgetTypeClock, map[string]any{"look": "sundial"})
	if _, kept := got["look"]; kept {
		t.Errorf("an unknown look survived: %v", got)
	}
}

func TestClockKeepsItsZonesAndFlags(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeClock, map[string]any{"zones": []any{"Tokyo=Asia/Tokyo", "Europe/London"}, "hour12": true, "showDate": true})
	zones, _ := got["zones"].([]string)
	if len(zones) != 2 || got["hour12"] != true || got["showDate"] != true {
		t.Errorf("got %v", got)
	}
}

func TestTimerKeepsItsModeLookAndLimits(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeTimer, map[string]any{
		"mode": "pomodoro", "look": "row", "presets": []any{"5", "10"},
		"focusMinutes": 50, "shortBreakMinutes": 10, "longBreakMinutes": 20, "rounds": 3,
		"autoNext": true, "sound": false, "notify": true,
	})
	if got["mode"] != "pomodoro" || got["look"] != "row" || got["rounds"] != 3 ||
		got["autoNext"] != true || got["sound"] != false || got["notify"] != true {
		t.Errorf("got %v", got)
	}
	for _, key := range []string{"focusMinutes", "shortBreakMinutes", "longBreakMinutes"} {
		if _, kept := got[key]; !kept {
			t.Errorf("%s was dropped: %v", key, got)
		}
	}
}

func TestTimerDropsUnknownWordsAndClampsNumbers(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeTimer, map[string]any{
		"mode": "stopwatch", "look": "sundial", "focusMinutes": 9999, "rounds": 1,
	})
	for _, key := range []string{"mode", "look"} {
		if _, kept := got[key]; kept {
			t.Errorf("%s survived: %v", key, got)
		}
	}
	if got["focusMinutes"] != 180 || got["rounds"] != 2 {
		t.Errorf("numbers were not clamped: %v", got)
	}
}
