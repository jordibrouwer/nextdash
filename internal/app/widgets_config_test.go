package app

import (
	"fmt"
	"strings"
	"testing"
)

/*
Config used to reach bookmarks-N.json untouched.

normalizeWidget checked the type, the id and the title and passed the map
through, so a client could write unknown keys, values of any size and nesting of
any depth into the file that holds every bookmark someone owns.
*/
func TestUnknownConfigKeysNeverReachStorage(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeCerts, map[string]any{
		"withinDays":  30,
		"nonsense":    "whatever",
		"__proto__":   map[string]any{"polluted": true},
		"hugePayload": strings.Repeat("x", 100000),
		"nested":      map[string]any{"deep": map[string]any{"deeper": true}},
	})
	if got, ok := clean["withinDays"]; !ok || got != 30 {
		t.Errorf("the declared field was lost: %v", clean)
	}
	for _, key := range []string{"nonsense", "__proto__", "hugePayload", "nested"} {
		if _, present := clean[key]; present {
			t.Errorf("%q was stored", key)
		}
	}
	if len(clean) != 1 {
		t.Errorf("kept %d keys, want 1: %v", len(clean), clean)
	}
}

/*
A number the reader typed is brought into range; nonsense is still dropped.

The two cases are not the same mistake. Someone asking for a refresh every 5
seconds means it -- they just did not know the floor is 30, because nothing on
screen said so -- and dropping the key sent them back to the default with no
sign anything had happened. Clamping answers what they meant.

A string, a fraction or a negative is a caller sending the wrong shape, not a
reader choosing badly. Those still become absent, which the renderer reads as
"use the default", so a widget written by a newer version degrades rather than
refusing to load.
*/
func TestOutOfRangeNumbersAreClampedAndNonsenseIsDropped(t *testing.T) {
	// rows is bounded by widgetMinRows..widgetMaxRows.
	for name, tc := range map[string]struct {
		in   any
		want int
	}{
		"past the ceiling": {5000, widgetMaxRows},
		"below the floor":  {0, widgetMinRows},
	} {
		clean := sanitizeWidgetConfig(WidgetTypeInbox, map[string]any{"rows": tc.in})
		if clean["rows"] != tc.want {
			t.Errorf("%s: rows = %v, want %d", name, clean["rows"], tc.want)
		}
	}

	// The custom widget's ttl is the case this was written for: 5 seconds is a
	// reader who wants it often, not a caller sending rubbish.
	clean := sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{
		"url": "https://example.com/api",
		"ttl": 5,
	})
	if clean["ttl"] != customWidgetMinTTL {
		t.Errorf("ttl = %v, want %d", clean["ttl"], customWidgetMinTTL)
	}
	clean = sanitizeWidgetConfig(WidgetTypeCustom, map[string]any{
		"url": "https://example.com/api",
		"ttl": 999999,
	})
	if clean["ttl"] != customWidgetMaxTTL {
		t.Errorf("ttl = %v, want %d", clean["ttl"], customWidgetMaxTTL)
	}

	// Not a whole number at all: still dropped, so the default applies.
	for name, config := range map[string]map[string]any{
		"negative rows":      {"rows": -3},
		"rows as a string":   {"rows": "12"},
		"rows as a fraction": {"rows": 3.7},
	} {
		clean := sanitizeWidgetConfig(WidgetTypeInbox, config)
		if _, present := clean["rows"]; present {
			t.Errorf("%s: stored %v", name, clean["rows"])
		}
	}

	// A value inside the range survives untouched, including the float64 JSON gives.
	for name, raw := range map[string]any{"int": 8, "float from JSON": float64(8)} {
		clean := sanitizeWidgetConfig(WidgetTypeInbox, map[string]any{"rows": raw})
		if clean["rows"] != 8 {
			t.Errorf("%s: rows = %v, want 8", name, clean["rows"])
		}
	}
}

// A list field takes only the values its type declares, and only so many.
func TestListFieldsAreBoundedAndChecked(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeHealth, map[string]any{
		"show": []any{"broken", "healthy", "invented", "", "broken", 42},
	})
	list, ok := clean["show"].([]string)
	if !ok {
		t.Fatalf("show = %#v", clean["show"])
	}
	// "invented" is not a figure the widget can draw; the blank and the number
	// are not values at all; "broken" appears once.
	want := []string{"broken", "healthy"}
	if strings.Join(list, ",") != strings.Join(want, ",") {
		t.Errorf("show = %v, want %v", list, want)
	}

	/*
	 * A free-form list is bounded by count and by entry length.
	 *
	 * The entries have to be distinct: 200 copies of one string collapse to a
	 * single tag through the duplicate check, and the count limit is then never
	 * reached -- measured, after a first version of this test passed while the
	 * limit was removed.
	 */
	long := make([]any, 0, 200)
	for i := 0; i < 200; i++ {
		long = append(long, fmt.Sprintf("tag-%03d-%s", i, strings.Repeat("t", 500)))
	}
	tags := sanitizeWidgetConfig(WidgetTypeUptime, map[string]any{"tags": long})
	stored, _ := tags["tags"].([]string)
	if len(stored) > widgetMaxListLen {
		t.Errorf("kept %d tags, max is %d", len(stored), widgetMaxListLen)
	}
	for _, tag := range stored {
		if len(tag) > widgetMaxIDLen {
			t.Errorf("kept a %d-character tag, max is %d", len(tag), widgetMaxIDLen)
		}
	}
}

/*
A type only accepts what it can act on.

The certificates tile has no bookmark filter -- expiry belongs to the host, and
ten bookmarks on one domain are one line -- and the trend tile has none either,
because filtering the line changes what it means. Storing such a setting anyway
would put a control in the file that nothing reads.
*/
func TestATypeRefusesSettingsItCannotActOn(t *testing.T) {
	certs := sanitizeWidgetConfig(WidgetTypeCerts, map[string]any{
		"withinDays": 14, "pageId": 3, "tags": []any{"home"}, "downOnly": true,
	})
	for _, key := range []string{"pageId", "tags", "downOnly"} {
		if _, present := certs[key]; present {
			t.Errorf("the certificates tile stored %q", key)
		}
	}

	trend := sanitizeWidgetConfig(WidgetTypeTrend, map[string]any{"days": 30, "pageId": 3})
	if _, present := trend["pageId"]; present {
		t.Error("the trend tile stored a page filter, which would change what the line means")
	}
	if trend["days"] != 30 {
		t.Errorf("days = %v", trend["days"])
	}
}

// Every type carries the shown/hidden toggle, so it is handled once rather than
// declared eight times.
func TestTheShownToggleSurvivesForEveryType(t *testing.T) {
	for _, name := range widgetTypeNames() {
		clean := sanitizeWidgetConfig(WidgetType(name), map[string]any{"enabled": false})
		if clean["enabled"] != false {
			t.Errorf("%s: the shown toggle was dropped", name)
		}
	}
}

// The whole path: what a client sends is narrowed before it is stored.
func TestNormalizeWidgetNarrowsTheConfig(t *testing.T) {
	widget, err := normalizeWidget(Widget{
		Type: WidgetTypeUptime,
		Config: map[string]any{
			"rows": 5, "downOnly": true, "smuggled": "value", "rows2": 999,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, present := widget.Config["smuggled"]; present {
		t.Error("an undeclared key reached the stored widget")
	}
	if widget.Config["rows"] != 5 || widget.Config["downOnly"] != true {
		t.Errorf("declared fields were lost: %v", widget.Config)
	}
}

// A type in the register that the UI list forgot would be addable through the
// API and absent from the screen.
func TestEveryRegisteredTypeIsOffered(t *testing.T) {
	names := widgetTypeNames()
	if len(names) != len(knownWidgetTypes) {
		t.Fatalf("offered %d of %d registered types", len(names), len(knownWidgetTypes))
	}
	// And every offered type has its settings declared, even if empty.
	for _, name := range names {
		if _, ok := knownWidgetTypes[WidgetType(name)]; !ok {
			t.Errorf("%s is offered but not registered", name)
		}
	}
}

/*
A shape survives being saved, and a meter survives only where it means anything.

The sanitiser builds a fresh object rather than narrowing the one it was given,
so a setting it does not name is dropped -- silently, and only visible as a
choice that would not stick. That is exactly what happened to the shape before
this: the panel offered it, the tile could draw it, and the save threw it away
in between.
*/
func TestSanitizeCustomWidgetFieldsKeepsShape(t *testing.T) {
	fields := sanitizeCustomWidgetFields([]any{
		map[string]any{"path": "cpu", "format": "percent", "shape": "meter", "tone": "bad"},
		map[string]any{"path": "queries", "format": "count", "shape": "meter"},
		map[string]any{"path": "name", "format": "text", "shape": "large"},
		map[string]any{"path": "plain", "format": "count", "shape": "normal"},
		map[string]any{"path": "odd", "format": "count", "shape": "sideways"},
	})
	if len(fields) != 5 {
		t.Fatalf("got %d fields, want 5", len(fields))
	}
	get := func(i int, key string) string {
		entry, _ := fields[i].(map[string]any)
		value, _ := entry[key].(string)
		return value
	}
	if get(0, "shape") != "meter" || get(0, "tone") != "bad" {
		t.Errorf("a meter over a percentage was not kept: %v", fields[0])
	}
	// A bar with no whole to be a share of, and a shape nobody offers.
	if got := get(1, "shape"); got != "" {
		t.Errorf("a meter over a count was kept: %q", got)
	}
	if got := get(4, "shape"); got != "" {
		t.Errorf("a shape nobody offers was kept: %q", got)
	}
	if get(2, "shape") != "large" {
		t.Errorf("large was not kept: %v", fields[2])
	}
	// normal is the absence of a shape, so it is not worth storing.
	if got := get(3, "shape"); got != "" {
		t.Errorf("normal was written out rather than left off: %q", got)
	}
}
