package app

import (
	"reflect"
	"testing"
)

// The mode replaces a boolean that every install already carries, so the
// migration is the whole story: nobody's cards may switch on or off because the
// field they are stored in changed name.
func TestLinkPreviewModeFollowsTheOldBoolean(t *testing.T) {
	cases := []struct {
		name   string
		mode   string
		legacy bool
		want   string
	}{
		{"unset with cards on becomes hover", "", true, "hover"},
		{"unset with cards off stays off", "", false, "off"},
		{"a stored mode wins over the boolean", "keyboard", false, "keyboard"},
		{"case and spacing are not a new mode", "  Hover ", false, "hover"},
		{"nonsense falls back to the boolean", "sometimes", true, "hover"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeLinkPreviewMode(tc.mode, tc.legacy); got != tc.want {
				t.Fatalf("normalizeLinkPreviewMode(%q, %v) = %q, want %q", tc.mode, tc.legacy, got, tc.want)
			}
		})
	}
}

// Absent and empty are different answers: never chosen means every row, and
// choosing none of them is a card with only its header — which someone is
// allowed to want.
func TestLinkPreviewPartsKeepsAbsentAndEmptyApart(t *testing.T) {
	if got := normalizeLinkPreviewParts(nil); got != nil {
		t.Fatalf("nil parts should stay nil, got %#v", got)
	}
	empty := normalizeLinkPreviewParts([]string{})
	if empty == nil || len(empty) != 0 {
		t.Fatalf("an empty choice should survive as empty, got %#v", empty)
	}
}

func TestLinkPreviewPartsDropsWhatTheCardCannotDraw(t *testing.T) {
	got := normalizeLinkPreviewParts([]string{"opens", "sparkline", " NOTE ", "image"})
	// Stored in the card's own order, so the setting cannot reorder the card.
	want := []string{"image", "note", "opens"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeLinkPreviewParts = %#v, want %#v", got, want)
	}
}

/*
 * Every row the card knows has to be in the filter.
 *
 * This list is what a save is measured against, so a row missing here is
 * stripped out of the reader's own choice. The byline and the player were
 * added to the card and to the checklist and never here, and the result was a
 * setting that could be ticked and never stuck.
 */
func TestLinkPreviewPartsKeepsTheBylineAndThePlayer(t *testing.T) {
	got := normalizeLinkPreviewParts([]string{"image", "byline", "embed", "description"})
	want := []string{"image", "byline", "embed", "description"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeLinkPreviewParts = %#v, want %#v", got, want)
	}
}

/*
 * A row that did not exist cannot have been refused.
 *
 * A list stored while the server was still stripping these two reads as "both
 * switched off"; putting them back once is the difference between a reader's
 * choice and an accident. A list that was never stored, or one that is empty
 * on purpose, is left exactly as it is.
 */
func TestLaterLinkPreviewPartsAreAddedToAStoredList(t *testing.T) {
	got := withLaterLinkPreviewParts([]string{"image", "description", "tags"})
	want := []string{"image", "byline", "embed", "description", "tags"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("withLaterLinkPreviewParts = %#v, want %#v", got, want)
	}

	if nilList := withLaterLinkPreviewParts(nil); nilList != nil {
		t.Fatalf("a list nobody stored should stay absent, got %#v", nilList)
	}
	empty := withLaterLinkPreviewParts([]string{})
	if empty == nil || len(empty) != 0 {
		t.Fatalf("an empty choice is a choice, got %#v", empty)
	}
}
