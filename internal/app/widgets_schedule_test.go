package app

import (
	"reflect"
	"testing"
)

func TestWidgetScheduleKeepsAValidWindowAndDays(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeHealth, map[string]any{
		"showFrom": "07:00", "showUntil": "09:30", "showDays": []any{"mon", "fri", "xyz"},
	})
	if got["showFrom"] != "07:00" || got["showUntil"] != "09:30" {
		t.Errorf("window = %v–%v", got["showFrom"], got["showUntil"])
	}
	if !reflect.DeepEqual(got["showDays"], []string{"mon", "fri"}) {
		t.Errorf("days = %v", got["showDays"])
	}
}

// One time alone has no meaning, a bad time is no time, and every day is no limit.
func TestWidgetScheduleDropsWhatCannotBeRead(t *testing.T) {
	for name, config := range map[string]map[string]any{
		"only a start":  {"showFrom": "07:00"},
		"past the day":  {"showFrom": "24:00", "showUntil": "09:00"},
		"free text":     {"showFrom": "morning", "showUntil": "noon"},
		"seconds":       {"showFrom": "07:00:00", "showUntil": "09:00"},
		"every day":     {"showDays": []any{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}},
		"no known days": {"showDays": []any{"someday"}},
	} {
		got := sanitizeWidgetConfig(WidgetTypeHealth, config)
		for _, key := range []string{"showFrom", "showUntil", "showDays"} {
			if _, kept := got[key]; kept {
				t.Errorf("%s: %s survived: %v", name, key, got)
			}
		}
	}
}
