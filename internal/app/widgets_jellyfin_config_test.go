package app

import (
	"reflect"
	"testing"
)

func TestJellyfinWidgetConfigKeepsWhatItDeclares(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeJellyfin, map[string]any{
		"server":       "http://jellyfin.lan:8096",
		"credentialId": "widget:w_0123456789ab",
		"userId":       "4f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b",
		"libraries":    []any{"lib-movies", "lib-anime"},
		"layout":       "grid",
		"click":        "detail",
		"target":       "_self",
		"hideWatched":  true,
		"rows":         float64(8),
		"ttl":          float64(600),
		"secret":       "dropped",
	})
	want := map[string]any{
		"server":       "http://jellyfin.lan:8096",
		"credentialId": "widget:w_0123456789ab",
		"userId":       "4f2a9c1e8b7d4e6f9a0b1c2d3e4f5a6b",
		"libraries":    []string{"lib-movies", "lib-anime"},
		"layout":       "grid",
		"click":        "detail",
		"target":       "_self",
		"hideWatched":  true,
		"rows":         8,
		"ttl":          600,
	}
	for key, value := range want {
		if !reflect.DeepEqual(clean[key], value) {
			t.Errorf("%s = %#v, want %#v", key, clean[key], value)
		}
	}
	if _, kept := clean["secret"]; kept {
		t.Error("an undeclared key was kept")
	}
}

func TestJellyfinWidgetConfigNarrowsBadValues(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeJellyfin, map[string]any{
		"server": "ftp://jellyfin.lan",
		"layout": "carousel",
		"click":  "play",
		"target": "_top",
		"rows":   float64(99),
		"ttl":    float64(5),
	})
	for _, key := range []string{"server", "layout", "click", "target"} {
		if _, kept := clean[key]; kept {
			t.Errorf("%s kept a value it does not allow: %#v", key, clean[key])
		}
	}
	if clean["rows"] != widgetMaxRows {
		t.Errorf("rows = %#v, want %d", clean["rows"], widgetMaxRows)
	}
	if clean["ttl"] != 60 {
		t.Errorf("ttl = %#v, want 60", clean["ttl"])
	}
}

func TestJellyfinWidgetWithholdsItsAddressAndKey(t *testing.T) {
	withheld := withheldWidgetKeys[WidgetTypeJellyfin]
	for _, key := range []string{"server", "credentialId", "userId"} {
		if !withheld[key] {
			t.Errorf("%s is handed to a tokenless reader", key)
		}
	}
}
