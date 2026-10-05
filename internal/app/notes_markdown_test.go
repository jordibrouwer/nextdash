package app

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func roundTripJSON(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestNoteMarkdownFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/notes-markdown-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string `json:"name"`
		Text   string `json:"text"`
		Blocks any    `json:"blocks"`
		Stats  any    `json:"stats"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := roundTripJSON(t, parseNoteMarkdown(c.Text)); !reflect.DeepEqual(got, c.Blocks) {
				t.Errorf("blocks\n got  %v\n want %v", got, c.Blocks)
			}
			if got := roundTripJSON(t, noteStats(c.Text)); !reflect.DeepEqual(got, c.Stats) {
				t.Errorf("stats\n got  %v\n want %v", got, c.Stats)
			}
		})
	}
}
