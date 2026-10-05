package app

import "testing"

func TestClampNotesProcessing(t *testing.T) {
	cases := map[string]string{
		"":       "server",
		"server": "server",
		"client": "client",
		"weird":  "server",
		"CLIENT": "server",
	}
	for in, want := range cases {
		s := Settings{NotesProcessing: in}
		clampNotesProcessing(&s)
		if s.NotesProcessing != want {
			t.Errorf("clamp(%q) = %q, want %q", in, s.NotesProcessing, want)
		}
	}
}

func TestNotesProcessingDefaultsToServer(t *testing.T) {
	h := newTestHandlers(t)
	if got := h.store.GetSettings().NotesProcessing; got != "server" {
		t.Fatalf("default NotesProcessing = %q, want server", got)
	}
}
