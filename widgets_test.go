package main

import (
	"strings"
	"testing"
)

/*
The block order is one list of ids, and the rules that make it safe to add.

A file written before this field existed has no order at all, so the fallback is
the whole feature for every install that upgrades: get it wrong and everyone's
categories come back shuffled.
*/
func TestResolveBlockOrderFallsBackToTheExistingOrder(t *testing.T) {
	categories := []Category{{ID: "development"}, {ID: "media"}, {ID: "social"}}

	got := resolveBlockOrder(nil, categories, nil)
	want := []string{"development", "media", "social"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("with no stored order: %v, want the categories as they were", got)
	}
}

func TestResolveBlockOrderPutsAWidgetBetweenCategories(t *testing.T) {
	categories := []Category{{ID: "development"}, {ID: "media"}}
	widgets := []Widget{{ID: "w_one"}}

	got := resolveBlockOrder([]string{"development", "w_one", "media"}, categories, widgets)
	if strings.Join(got, ",") != "development,w_one,media" {
		t.Errorf("order = %v", got)
	}
}

/*
An id naming something that no longer exists is skipped, not left as a hole.

Deleting a category is an ordinary act and nothing rewrites every stored order
when it happens, so a stale id is the normal state of this list rather than an
error.
*/
func TestResolveBlockOrderSkipsWhatIsGone(t *testing.T) {
	categories := []Category{{ID: "development"}}
	got := resolveBlockOrder([]string{"deleted", "development", "w_gone"}, categories, nil)
	if strings.Join(got, ",") != "development" {
		t.Errorf("order = %v, want only what still exists", got)
	}
}

// Anything the stored order does not name still has to appear, or adding a
// category would make it invisible until something rewrote the order.
func TestResolveBlockOrderAppendsWhatIsMissing(t *testing.T) {
	categories := []Category{{ID: "development"}, {ID: "brandnew"}}
	widgets := []Widget{{ID: "w_new"}}

	got := resolveBlockOrder([]string{"development"}, categories, widgets)
	if len(got) != 3 {
		t.Fatalf("order = %v, want everything present", got)
	}
	if got[0] != "development" {
		t.Errorf("stored order lost its place: %v", got)
	}
	// Categories before widgets among the unplaced, so a new widget does not
	// jump ahead of a category added at the same time.
	if got[1] != "brandnew" || got[2] != "w_new" {
		t.Errorf("order = %v, want the new category before the new widget", got)
	}
}

// A duplicate in the stored order must not draw a block twice.
func TestResolveBlockOrderNeverRepeats(t *testing.T) {
	categories := []Category{{ID: "development"}}
	got := resolveBlockOrder([]string{"development", "development"}, categories, nil)
	if len(got) != 1 {
		t.Errorf("order = %v, want one entry", got)
	}
}

/*
A widget whose type nothing renders is refused.

Stored, it would take a place in the order and draw nothing: a gap in the grid
that cannot be selected, moved or removed from the dashboard.
*/
func TestNormalizeWidgetRefusesAnUnknownType(t *testing.T) {
	if _, err := normalizeWidget(Widget{Type: "telepathy"}); err == nil {
		t.Error("stored a widget nothing can draw")
	}
	if _, err := normalizeWidget(Widget{Type: WidgetTypeHealth}); err != nil {
		t.Errorf("refused a known type: %v", err)
	}
}

func TestNormalizeWidgetMintsAnIDAndNeverCollidesWithACategory(t *testing.T) {
	widget, err := normalizeWidget(Widget{Type: WidgetTypeHealth})
	if err != nil {
		t.Fatalf("normalize: %v", err)
	}
	if !isWidgetID(widget.ID) {
		t.Errorf("id = %q, want the widget prefix so a block id says what it is", widget.ID)
	}
	// A category id is a slug: never prefixed, so the two spaces cannot meet.
	if isWidgetID(slugify("Development")) {
		t.Error("a category slug reads as a widget id")
	}
	// Config is never nil after this, so a renderer can read it without a check.
	if widget.Config == nil {
		t.Error("config is nil")
	}
}

// Two widgets must not share an id, or the order cannot tell them apart.
func TestNormalizeWidgetsDropsDuplicatesAndUnknowns(t *testing.T) {
	got := normalizeWidgets([]Widget{
		{ID: "w_same", Type: WidgetTypeHealth},
		{ID: "w_same", Type: WidgetTypeHealth},
		{ID: "w_other", Type: "telepathy"},
	})
	if len(got) != 1 {
		t.Fatalf("kept %+v, want one", got)
	}
	if got[0].ID != "w_same" {
		t.Errorf("kept %q", got[0].ID)
	}
}
