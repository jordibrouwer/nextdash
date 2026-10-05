package app

import (
	"strings"
	"testing"
)

// A notes widget that is new -- no id yet -- starts with the example note, so
// the first thing it shows is what it can do.
func TestNewNotesWidgetGetsTheStarterText(t *testing.T) {
	got, err := normalizeWidget(Widget{Type: WidgetTypeNotes})
	if err != nil {
		t.Fatal(err)
	}
	text, _ := got.Config["text"].(string)
	if text != notesStarterText {
		t.Fatalf("new notes widget text = %q, want the starter text", text)
	}
	if !strings.Contains(text, "https://github.com/jordibrouwer/nextdash") {
		t.Error("starter text should link to the repository")
	}
}

// One that already exists keeps what it has, empty included: emptying a note
// must not bring the example back on the next save.
func TestExistingNotesWidgetKeepsItsText(t *testing.T) {
	for _, config := range []map[string]any{{}, {"text": "mine"}} {
		got, err := normalizeWidget(Widget{ID: defaultNotesWidgetID, Type: WidgetTypeNotes, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		want, _ := config["text"].(string)
		if text, _ := got.Config["text"].(string); text != want {
			t.Errorf("existing widget text = %q, want %q", text, want)
		}
	}
	got, _ := normalizeWidget(Widget{Type: WidgetTypeNotes, Config: map[string]any{"text": "given"}})
	if text, _ := got.Config["text"].(string); text != "given" {
		t.Errorf("new widget with text = %q, want it kept", text)
	}
}

func TestSeededNotesWidgetHasTheStarterText(t *testing.T) {
	h := newTestHandlers(t)
	widgets, _ := h.store.GetPageBlocks(1)
	for _, w := range widgets {
		if w.Type == WidgetTypeNotes {
			if text, _ := w.Config["text"].(string); text != notesStarterText {
				t.Fatalf("seeded notes text = %q", text)
			}
			return
		}
	}
	t.Fatal("no seeded notes widget on page 1")
}

func TestStarterTextFitsAndParses(t *testing.T) {
	stats := noteStats(notesStarterText)
	if total, _ := stats["tasksTotal"].(int); total < 3 {
		t.Errorf("starter text has %d checklist items, want a checklist of at least 3", total)
	}
	links := 0
	for _, b := range parseNoteMarkdown(notesStarterText) {
		if spans, ok := b["spans"].([]noteSpan); ok {
			for _, s := range spans {
				if s["t"] == "link" {
					links++
				}
			}
		}
	}
	if links == 0 {
		t.Error("starter text link should parse as a link")
	}
}
