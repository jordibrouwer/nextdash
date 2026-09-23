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
