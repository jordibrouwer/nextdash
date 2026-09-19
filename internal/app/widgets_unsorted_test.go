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
