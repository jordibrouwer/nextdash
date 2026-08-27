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
