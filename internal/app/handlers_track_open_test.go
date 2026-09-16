package app

import (
	"net/http"
	"strings"
	"testing"
)

// newTrackOpenTestHandlers wires a store with one bookmark on page 1, index 0,
// so TrackBookmarkOpen has something real to resolve.
func newTrackOpenTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)

	store := NewStore()
	if err := store.AddBookmarkToPage(1, Bookmark{Name: "Example", URL: "https://example.com"}); err != nil {
		t.Fatalf("AddBookmarkToPage: %v", err)
	}
	return NewHandlers(store, embeddedFiles)
}

func TestTrackBookmarkOpenWithoutSourceOrMethod(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryOpen: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{"pageId": 1, "index": 0})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if strings.Contains(lines[0], `"openSource"`) || strings.Contains(lines[0], `"method"`) {
		t.Fatalf("expected no openSource/method field, got %s", lines[0])
	}
}

func TestTrackBookmarkOpenWithValidSourceAndMethod(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryOpen: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0, "source": "search", "method": "keyboard-enter",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], `"openSource":"search"`) {
		t.Fatalf("expected openSource=search, got %s", lines[0])
	}
	if !strings.Contains(lines[0], `"method":"keyboard-enter"`) {
		t.Fatalf("expected method=keyboard-enter, got %s", lines[0])
	}
}

func TestTrackBookmarkOpenDropsInvalidSourceAndMethod(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryOpen: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0, "source": "<script>", "method": "teleport",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if strings.Contains(lines[0], `"openSource"`) || strings.Contains(lines[0], `"method"`) {
		t.Fatalf("expected invalid values dropped, got %s", lines[0])
	}
}
