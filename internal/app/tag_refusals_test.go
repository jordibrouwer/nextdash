package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

// A refusal writes the whole settings back, so it waits for a settings save in
// flight: while SaveSettings holds settingsMu, the refusal must not land, or
// one of the two writes is lost.
func TestRefusalWaitsForTheSettingsLock(t *testing.T) {
	h, store := patchTestHandlers(t)
	saveTestPage(t, h, []map[string]any{
		{"name": "Tube", "url": "https://www.youtube.com/watch?v=1", "category": "x", "tags": []string{"video"}},
	})

	h.settingsMu.Lock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		saveTestPage(t, h, []map[string]any{
			{"name": "Tube", "url": "https://www.youtube.com/watch?v=1", "category": "x", "tags": []string{}},
		})
	}()
	time.Sleep(200 * time.Millisecond)
	if got := store.GetSettings().DismissedTagSuggestions; len(got) != 0 {
		h.settingsMu.Unlock()
		<-done
		t.Fatalf("the refusal was written while a settings save held the lock: %v", got)
	}
	h.settingsMu.Unlock()
	<-done
	if got := store.GetSettings().DismissedTagSuggestions; !reflect.DeepEqual(got, []string{"youtube.com|video"}) {
		t.Errorf("after the lock was released: %v", got)
	}
}

func saveTestPage(t *testing.T, h *Handlers, rows []map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(rows)
	rec := httptest.NewRecorder()
	h.SaveBookmarks(rec, httptest.NewRequest(http.MethodPost, "/api/bookmarks?page=1", bytes.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	return rec
}

func TestTakingATagOffABookmarkTurnsItDown(t *testing.T) {
	h, store := patchTestHandlers(t)
	saveTestPage(t, h, []map[string]any{
		{"name": "Tube", "url": "https://www.youtube.com/watch?v=1", "category": "x", "tags": []string{"video", "music"}},
		{"name": "Docs", "url": "https://docs.docker.com/", "category": "x", "tags": []string{"containers"}},
	})
	if got := store.GetSettings().DismissedTagSuggestions; len(got) != 0 {
		t.Fatalf("adding tags refused something: %v", got)
	}

	// The whole-page save: #video comes off one bookmark, the other is left alone.
	rec := saveTestPage(t, h, []map[string]any{
		{"name": "Tube", "url": "https://www.youtube.com/watch?v=1", "category": "x", "tags": []string{"music"}},
		{"name": "Docs", "url": "https://docs.docker.com/", "category": "x", "tags": []string{"containers"}},
	})
	if got := store.GetSettings().DismissedTagSuggestions; !reflect.DeepEqual(got, []string{"youtube.com|video"}) {
		t.Errorf("after the save: %v", got)
	}
	if rec.Header().Get(refusedTagsHeader) != "youtube.com|video" {
		t.Errorf("header: %q", rec.Header().Get(refusedTagsHeader))
	}

	// The patch route: a bulk "remove tag".
	rec = doPatch(t, h, map[string]any{"page": 1, "updates": []map[string]any{
		{"url": "https://docs.docker.com/", "removeTags": []string{"containers"}},
	}})
	if rec.Code != http.StatusOK {
		t.Fatalf("patch status %d: %s", rec.Code, rec.Body.String())
	}
	want := []string{"youtube.com|video", "docs.docker.com|containers"}
	if got := store.GetSettings().DismissedTagSuggestions; !reflect.DeepEqual(got, want) {
		t.Errorf("after the patch: %v, want %v", got, want)
	}
}

func TestDeletingABookmarkRefusesNothing(t *testing.T) {
	h, store := patchTestHandlers(t)
	saveTestPage(t, h, []map[string]any{
		{"name": "Tube", "url": "https://tube.example.org/", "category": "x", "tags": []string{"video"}},
	})
	rec := saveTestPage(t, h, []map[string]any{})
	if got := store.GetSettings().DismissedTagSuggestions; len(got) != 0 || rec.Header().Get(refusedTagsHeader) != "" {
		t.Errorf("a deleted bookmark refused %v", got)
	}
}

func TestRefusalsKeepTheNewestWhenFull(t *testing.T) {
	h, store := patchTestHandlers(t)
	settings := store.GetSettings()
	for i := 0; i < dismissedTagSuggestionsMax; i++ {
		settings.DismissedTagSuggestions = append(settings.DismissedTagSuggestions, "old.example|t"+string(rune('a'+i%26))+string(rune('a'+i/26)))
	}
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	saveTestPage(t, h, []map[string]any{{"name": "A", "url": "https://a.example.org/", "category": "x", "tags": []string{"keep"}}})
	saveTestPage(t, h, []map[string]any{{"name": "A", "url": "https://a.example.org/", "category": "x", "tags": []string{}}})
	got := store.GetSettings().DismissedTagSuggestions
	if len(got) != dismissedTagSuggestionsMax || got[len(got)-1] != "a.example.org|keep" {
		t.Errorf("len %d, last %q: the newest refusal must survive", len(got), got[len(got)-1])
	}
}

func TestAnUndoRefusesNothing(t *testing.T) {
	h, store := patchTestHandlers(t)
	saveTestPage(t, h, []map[string]any{{"name": "P", "url": "https://plan.example.org/", "category": "x", "tags": []string{}}})
	doPatch(t, h, map[string]any{"page": 1, "updates": []map[string]any{{"url": "https://plan.example.org/", "addTags": []string{"code"}}}})
	// The undo of an applied suggestion takes the tag back off.
	raw, _ := json.Marshal(map[string]any{"page": 1, "updates": []map[string]any{{"url": "https://plan.example.org/", "removeTags": []string{"code"}}}})
	req := httptest.NewRequest(http.MethodPatch, "/api/bookmarks", bytes.NewReader(raw))
	req.Header.Set(undoHeader, "1")
	rec := httptest.NewRecorder()
	h.PatchBookmarks(rec, req)
	if got := store.GetSettings().DismissedTagSuggestions; len(got) != 0 {
		t.Errorf("an undo refused %v", got)
	}
}

func TestPuttingATagBackForgetsTheRefusal(t *testing.T) {
	h, store := patchTestHandlers(t)
	saveTestPage(t, h, []map[string]any{{"name": "T", "url": "https://tube.example.org/", "category": "x", "tags": []string{"video"}}})
	saveTestPage(t, h, []map[string]any{{"name": "T", "url": "https://tube.example.org/", "category": "x", "tags": []string{}}})
	if got := store.GetSettings().DismissedTagSuggestions; !reflect.DeepEqual(got, []string{"tube.example.org|video"}) {
		t.Fatalf("not refused: %v", got)
	}
	rec := saveTestPage(t, h, []map[string]any{{"name": "T", "url": "https://tube.example.org/", "category": "x", "tags": []string{"video"}}})
	if got := store.GetSettings().DismissedTagSuggestions; len(got) != 0 {
		t.Errorf("still refused after putting it back: %v", got)
	}
	if rec.Header().Get(wantedTagsHeader) != "tube.example.org|video" {
		t.Errorf("header: %q", rec.Header().Get(wantedTagsHeader))
	}
}
