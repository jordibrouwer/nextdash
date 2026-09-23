package app

import "testing"

func TestUnsortedWidgetTypeIsRegistered(t *testing.T) {
	if _, ok := knownWidgetTypes[WidgetTypeUnsorted]; !ok {
		t.Error("WidgetTypeUnsorted not accepted as a valid widget type")
	}
}

func TestUnsortedWidgetConfigSchemaHasRowsField(t *testing.T) {
	schema, ok := widgetFields[WidgetTypeUnsorted]
	if !ok {
		t.Fatal("no config schema registered for WidgetTypeUnsorted")
	}
	found := false
	for _, f := range schema {
		if f.Key == "rows" {
			found = true
		}
	}
	if !found {
		t.Error("unsorted widget schema has no rows field")
	}
}

func TestWidgetTypeNamesIncludesUnsorted(t *testing.T) {
	names := widgetTypeNames()
	found := false
	for _, n := range names {
		if n == string(WidgetTypeUnsorted) {
			found = true
		}
	}
	if !found {
		t.Error("widgetTypeNames() does not include unsorted")
	}
}

/*
 * The order and the tag survive a save.
 *
 * sanitizeWidgetConfig drops every key a type does not declare, so a setting
 * added to the panel and to the widget but not to this table is written by the
 * browser, accepted with a 200, and quietly gone on the next read -- which is
 * exactly what happened to the Kept widget's order in v1.13.0.
 */
func TestUnsortedWidgetKeepsOrderAndTag(t *testing.T) {
	clean := sanitizeWidgetConfig(WidgetTypeUnsorted, map[string]any{
		"rows": 8,
		"sort": "tag",
		"tag":  []any{"homelab"},
	})

	if clean["sort"] != "tag" {
		t.Errorf("sort not kept: %#v", clean["sort"])
	}
	tags, ok := clean["tag"].([]string)
	if !ok || len(tags) != 1 || tags[0] != "homelab" {
		t.Errorf("tag not kept: %#v", clean["tag"])
	}

	// A rule nobody asked for is still refused.
	if got := sanitizeWidgetConfig(WidgetTypeUnsorted, map[string]any{"sort": "sideways"}); got["sort"] != nil {
		t.Errorf("an unknown order was accepted: %#v", got["sort"])
	}
}

/*
 * Reordering the grid must not erase what its widgets were told to watch.
 *
 * A drag sends the order and no widget list, so handlers_widgets.go writes back
 * the widgets it just read from the store. Those come back with their lists as
 * []string, and widgetConfigList only knew []any -- so every list on the page
 * was refused and dropped. One drag erased the disks a Disks widget watched,
 * the figures Containers and Health showed, and the tags Uptime and Neglected
 * filtered by.
 *
 * The same round trip the handler makes, at the level the loss happened.
 */
func TestWidgetListsSurviveASaveOfWhatWasRead(t *testing.T) {
	cases := []struct {
		widgetType WidgetType
		key        string
		value      []any
		want       string
	}{
		{WidgetTypeDisks, "mounts", []any{"/mnt/user"}, "/mnt/user"},
		{WidgetTypeDocker, "show", []any{"running"}, "running"},
		{WidgetTypeHealth, "show", []any{"broken"}, "broken"},
		{WidgetTypeUptime, "tags", []any{"homelab"}, "homelab"},
		{WidgetTypeNeglected, "tags", []any{"reading"}, "reading"},
	}

	for _, tc := range cases {
		// As the browser sends it: a JSON array arrives as []any.
		first := sanitizeWidgetConfig(tc.widgetType, map[string]any{tc.key: tc.value})
		stored, ok := first[tc.key].([]string)
		if !ok || len(stored) != 1 || stored[0] != tc.want {
			t.Fatalf("%s.%s was not kept on the way in: %#v", tc.widgetType, tc.key, first[tc.key])
		}

		// As a reorder saves it: the value read back from the store, unchanged.
		second := sanitizeWidgetConfig(tc.widgetType, map[string]any{tc.key: stored})
		again, ok := second[tc.key].([]string)
		if !ok || len(again) != 1 || again[0] != tc.want {
			t.Errorf("%s.%s was erased by a save of what was read: %#v",
				tc.widgetType, tc.key, second[tc.key])
		}
	}
}
