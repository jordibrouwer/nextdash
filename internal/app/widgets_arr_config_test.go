package app

import "testing"

func TestArrWidgetConfig(t *testing.T) {
	for _, wt := range []WidgetType{WidgetTypeSonarr, WidgetTypeRadarr} {
		clean := sanitizeWidgetConfig(wt, map[string]any{
			"server": "http://arr.lan:8989", "show": "queue", "days": float64(99), "layout": "carousel",
		})
		if clean["show"] != "queue" || clean["days"] != 30 || clean["layout"] != nil {
			t.Errorf("%s: %#v", wt, clean)
		}
		if !withheldWidgetKeys[wt]["server"] || !withheldWidgetKeys[wt]["credentialId"] {
			t.Errorf("%s hands its address or key to a tokenless reader", wt)
		}
	}
}
