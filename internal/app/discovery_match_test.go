package app

import (
	"encoding/json"
	"os"
	"testing"
)

type matchFixtureCase struct {
	Name      string                     `json:"name"`
	Container discoveryContainer         `json:"container"`
	Bookmarks []Bookmark                 `json:"bookmarks"`
	Links     map[string]string          `json:"links"`
	Hosts     []string                   `json:"hosts"`
	Want      *struct{ Key, Via string } `json:"want"`
}

func TestMatchContainerBookmarkFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/container-bookmark-match.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []matchFixtureCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			key, via, ok := matchContainerBookmark(tc.Container, tc.Bookmarks, tc.Links, tc.Hosts)
			if tc.Want == nil {
				if ok {
					t.Fatalf("want no match, got %q via %s", key, via)
				}
				return
			}
			if !ok || key != tc.Want.Key || via != tc.Want.Via {
				t.Fatalf("want %q via %s, got %q via %s (ok=%v)", tc.Want.Key, tc.Want.Via, key, via, ok)
			}
		})
	}
}
