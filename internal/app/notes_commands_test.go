package app

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"
	"time"
)

func TestNoteCommandFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../tests/fixtures/notes-command-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name    string    `json:"name"`
		Command string    `json:"command"`
		Max     int       `json:"max"`
		State   noteEdit  `json:"state"`
		Expect  *noteEdit `json:"expect"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			max := c.Max
			if max == 0 {
				max = widgetMaxNoteLen
			}
			got, fitted, known := runNoteCommand(c.Command, c.State, max, time.Now())
			if !known {
				t.Fatalf("unknown command %q", c.Command)
			}
			if c.Expect == nil {
				if fitted {
					t.Fatalf("want it refused for length, got %+v", got)
				}
				return
			}
			if !fitted || got != *c.Expect {
				t.Fatalf("got %+v (fitted %v), want %+v", got, fitted, *c.Expect)
			}
		})
	}
}

func TestNoteDateTimeUUID(t *testing.T) {
	now := time.Date(2026, 10, 5, 14, 32, 0, 0, time.UTC)
	got, _, _ := runNoteCommand("date", noteEdit{}, 100, now)
	if got.Value != "2026-10-05" || got.Start != 10 {
		t.Errorf("date = %+v", got)
	}
	got, _, _ = runNoteCommand("time", noteEdit{}, 100, now)
	if got.Value != "14:32" {
		t.Errorf("time = %+v", got)
	}
	got, _, _ = runNoteCommand("uuid", noteEdit{}, 100, now)
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(got.Value) {
		t.Errorf("uuid = %q", got.Value)
	}
}

func TestNoteLocationFallsBackToOffset(t *testing.T) {
	loc := noteLocation("Not/AZone", -120) // JS getTimezoneOffset: UTC+2 is -120
	_, off := time.Date(2026, 10, 5, 0, 0, 0, 0, loc).Zone()
	if off != 2*3600 {
		t.Errorf("offset = %d, want 7200", off)
	}
	if noteLocation("Europe/Amsterdam", 0).String() != "Europe/Amsterdam" {
		t.Error("a valid zone name should win over the offset")
	}
}

func TestUnknownNoteCommand(t *testing.T) {
	if _, _, known := runNoteCommand("nope", noteEdit{}, 100, time.Now()); known {
		t.Fatal("unknown command reported as known")
	}
}
