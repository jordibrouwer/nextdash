package app

import (
	"errors"
	"testing"
)

/*
A save that cannot be carried out is refused, not partly applied.

Reading and writing had one normaliser between them, and it dropped whatever it
could not render. That is right for a file arriving from another version -- it
should still open, minus the block nothing draws. It is wrong for a write: a
client sending one unknown widget had every other widget on the page silently
discarded and got a 200 saying so, which is how a dashboard loses fourteen
tiles to one typo.
*/

func TestSaveRefusesAnUnknownWidgetType(t *testing.T) {
	_, err := normalizeWidgetsForSave([]Widget{
		{Type: WidgetTypeHealth},
		{Type: "telepathy"},
	})
	if err == nil {
		t.Fatal("expected a save with an unknown type to be refused")
	}
	if !errors.Is(err, errUnknownWidgetType) {
		t.Fatalf("err = %v, want it to name the unknown type", err)
	}
}

// The good ones alone still save: refusing is about what was sent, not a
// blanket ban on writing.
func TestSaveAcceptsKnownTypes(t *testing.T) {
	got, err := normalizeWidgetsForSave([]Widget{
		{Type: WidgetTypeHealth},
		{Type: WidgetTypeUptime},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("saved %d widgets, want 2", len(got))
	}
}

/*
Too many is refused rather than truncated for the same reason: a client sending
thirty widgets and getting twenty-four back, with a 200, has lost six without
being told.
*/
func TestSaveRefusesMoreThanThePageHolds(t *testing.T) {
	many := make([]Widget, widgetMaxPerPage+1)
	for i := range many {
		many[i] = Widget{Type: WidgetTypeHealth}
	}
	if _, err := normalizeWidgetsForSave(many); err == nil {
		t.Fatal("expected more widgets than the page holds to be refused")
	}
}

func TestSaveAcceptsExactlyTheMaximum(t *testing.T) {
	many := make([]Widget, widgetMaxPerPage)
	for i := range many {
		many[i] = Widget{Type: WidgetTypeHealth}
	}
	got, err := normalizeWidgetsForSave(many)
	if err != nil {
		t.Fatalf("unexpected error at the cap: %v", err)
	}
	if len(got) != widgetMaxPerPage {
		t.Fatalf("saved %d, want %d", len(got), widgetMaxPerPage)
	}
}

/*
Reading keeps its tolerance. A file written by another version, or by hand,
opens with the blocks that can be drawn rather than failing entirely -- which
is what the dropping behaviour was written for.
*/
func TestReadingStillDropsWhatItCannotDraw(t *testing.T) {
	got := normalizeWidgets([]Widget{
		{Type: WidgetTypeHealth},
		{Type: "telepathy"},
	})
	if len(got) != 1 {
		t.Fatalf("read %d widgets, want the one that can be drawn", len(got))
	}
	if got[0].Type != WidgetTypeHealth {
		t.Fatalf("kept %q, want health", got[0].Type)
	}
}

// The whole point of the fix: the other widgets survive a bad one.
func TestSaveDoesNotDiscardTheRestOfThePage(t *testing.T) {
	page := []Widget{
		{Type: WidgetTypeHealth}, {Type: WidgetTypeUptime}, {Type: WidgetTypeInbox},
		{Type: "telepathy"},
	}
	if _, err := normalizeWidgetsForSave(page); err == nil {
		t.Fatal("expected refusal rather than a partial write")
	}
	// And nothing was written, so the stored page is whatever it was before:
	// the caller decides what to do, having been told.
}
