package app

import (
	"encoding/json"
	"net/http"
	"time"
	"unicode/utf8"
)

// The notes widget's processing, for the default "On the server" setting.
// Neither endpoint reads or writes anything: they take text and give text back,
// so the only limits are the size of the request and of a note.

const notesBodyLimit = 64 << 10

func (h *Handlers) NotesRenderHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, notesBodyLimit)).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(req.Text) > widgetMaxNoteLen {
		http.Error(w, "Text too long", http.StatusRequestEntityTooLarge)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"blocks": parseNoteMarkdown(req.Text),
		"stats":  noteStats(req.Text),
	})
}

func (h *Handlers) NotesCommandHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var req struct {
		Command       string `json:"command"`
		Value         string `json:"value"`
		Start         int    `json:"start"`
		End           int    `json:"end"`
		TZ            string `json:"tz"`
		OffsetMinutes int    `json:"offsetMinutes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, notesBodyLimit)).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(req.Value) > widgetMaxNoteLen {
		http.Error(w, "Text too long", http.StatusRequestEntityTooLarge)
		return
	}
	now := time.Now().In(noteLocation(req.TZ, req.OffsetMinutes))
	result, fitted, known := runNoteCommand(req.Command, noteEdit{Value: req.Value, Start: req.Start, End: req.End}, widgetMaxNoteLen, now)
	if !known {
		http.Error(w, "Unknown command", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !fitted {
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "full"})
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}
