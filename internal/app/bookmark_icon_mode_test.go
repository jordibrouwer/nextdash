package app

import (
	"encoding/json"
	"testing"
)

// The letter is the one mode a bookmark keeps, and only while it has no icon
// of its own: choosing an icon is the newer choice.
func TestNormalizeBookmarkIconMode(t *testing.T) {
	cases := []struct {
		name, icon, mode, want string
	}{
		{"letter without an icon stays", "", "letter", "letter"},
		{"an icon of its own clears it", "sonarr.svg", "letter", ""},
		{"anything else is automatic", "", "emoji", ""},
		{"automatic stays automatic", "", "", ""},
	}
	for _, c := range cases {
		b := Bookmark{Icon: c.icon, IconMode: c.mode}
		normalizeBookmarkIconMode(&b)
		if b.IconMode != c.want {
			t.Errorf("%s: IconMode = %q, want %q", c.name, b.IconMode, c.want)
		}
	}
}

// The side panel writes the mode through the generic field patch, so the
// merge has to carry it -- and drop it again when an icon arrives with it.
func TestMergeBookmarkFieldsCarriesIconMode(t *testing.T) {
	b := Bookmark{Name: "Sonarr", URL: "https://sonarr.example.com"}
	next, err := mergeBookmarkFields(b, map[string]json.RawMessage{"iconMode": json.RawMessage(`"letter"`)})
	if err != nil {
		t.Fatal(err)
	}
	if next.IconMode != "letter" {
		t.Fatalf("IconMode = %q, want letter", next.IconMode)
	}
	next, err = mergeBookmarkFields(next, map[string]json.RawMessage{"icon": json.RawMessage(`"sonarr.svg"`)})
	if err != nil {
		t.Fatal(err)
	}
	if next.IconMode != "" {
		t.Fatalf("an icon of its own left IconMode = %q", next.IconMode)
	}
}

// A bookmark set to its letter lacks nothing: the favicon fill leaves it
// alone, Refresh all included.
func TestIconCandidatesSkipTheLetter(t *testing.T) {
	bookmarks := []Bookmark{
		{Name: "a", URL: "https://a.example.com"},
		{Name: "b", URL: "https://b.example.com", IconMode: "letter"},
	}
	for _, all := range []bool{false, true} {
		got := collectIconCandidates(bookmarks, true, all)
		if len(got) != 1 || got[0].url != "https://a.example.com" {
			t.Errorf("refreshAll=%v: candidates = %+v, want only a", all, got)
		}
	}
}
