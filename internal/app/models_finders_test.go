package app

import (
	"encoding/json"
	"testing"
)

func TestFinderJSONRoundTripWithID(t *testing.T) {
	original := []Finder{{
		ID:        "finder-du",
		Name:      "DuckDuckGo",
		SearchUrl: "https://duckduckgo.com/?q=%s",
		Shortcut:  "du",
		Tags:      []string{"search"},
		UseCount:  3,
		LastUsed:  1710000000000,
	}}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded []Finder
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded) != 1 {
		t.Fatalf("expected 1 finder, got %d", len(decoded))
	}
	if decoded[0].ID != "finder-du" {
		t.Fatalf("id = %q, want finder-du", decoded[0].ID)
	}
	if decoded[0].SearchUrl != original[0].SearchUrl {
		t.Fatalf("searchUrl mismatch")
	}
}
