package app

import (
	"net/http"
	"strings"
	"testing"
)

const validSessionID = "0123456789abcdef0123456789abcdef"

func TestTrackSearchAcceptsValidPayload(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategorySearch: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackSearch, "/api/track-search", map[string]any{
			"query": "widgets", "resultCount": 5, "opened": true, "sessionId": validSessionID,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d (%v)", len(lines), lines)
	}
	for _, want := range []string{`"query":"widgets"`, `"resultCount":5`, `"opened":true`, `"sessionId":"` + validSessionID + `"`} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("expected %s in %s", want, lines[0])
		}
	}
}

func TestTrackSearchTruncatesQueryAndDropsBadSessionID(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategorySearch: true}})
	h := newTrackOpenTestHandlers(t)

	longQuery := strings.Repeat("x", activityMaxQueryRunes+50)
	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackSearch, "/api/track-search", map[string]any{
			"query": longQuery, "resultCount": -1, "sessionId": "not-hex!!",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d (%v)", len(lines), lines)
	}
	if strings.Contains(lines[0], strings.Repeat("x", activityMaxQueryRunes+1)) {
		t.Fatalf("query was not truncated: %s", lines[0])
	}
	if strings.Contains(lines[0], `"resultCount"`) || strings.Contains(lines[0], `"sessionId"`) {
		t.Fatalf("expected invalid resultCount/sessionId dropped, got %s", lines[0])
	}
}

func TestTrackSearchOffByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackSearch, "/api/track-search", map[string]any{"query": "widgets"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no lines with search off, got %v", lines)
	}
}

func TestTrackKeysLogsOneLinePerKey(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryKeys: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackKeys, "/api/track-keys", map[string]any{
			"keys": map[string]any{"j": 3, "k": 1},
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 2 {
		t.Fatalf("expected 2 lines (one per key), got %d (%v)", len(lines), lines)
	}
	joined := strings.Join(lines, "\n")
	if !strings.Contains(joined, `"key":"j"`) || !strings.Contains(joined, `"count":3`) {
		t.Fatalf("missing j:3 in %v", lines)
	}
	if !strings.Contains(joined, `"key":"k"`) || !strings.Contains(joined, `"count":1`) {
		t.Fatalf("missing k:1 in %v", lines)
	}
}

func TestTrackKeysDropsInvalidEntries(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryKeys: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackKeys, "/api/track-keys", map[string]any{
			"keys": map[string]any{
				"ok":                     2,
				"":                       5,
				strings.Repeat("z", 999): 1,
				"negative":               -1,
			},
		})
	})

	if len(lines) != 1 {
		t.Fatalf("expected only the one valid key logged, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], `"key":"ok"`) {
		t.Fatalf("expected the valid key, got %v", lines)
	}
}

func TestTrackKeysOffByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackKeys, "/api/track-keys", map[string]any{"keys": map[string]any{"j": 1}})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no lines with keys off, got %v", lines)
	}
}

func TestTrackNavAcceptsKnownActionAndDropsUnknown(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryNav: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackNav, "/api/track-nav", map[string]any{"action": "category-expand", "detail": "work"})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"nav.category-expand"`) {
		t.Fatalf("expected a nav.category-expand line, got %v", lines)
	}

	lines = captureActivityLogs(t, func() {
		postJSON(t, h.TrackNav, "/api/track-nav", map[string]any{"action": "teleport"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected an unknown action dropped, got %v", lines)
	}
}

// "view" (switching between the bookmark grid, Health, Inbox and Config) is
// deliberately a different action from "page" (switching bookmark pages
// 1-9) — see the comment on activityNavActions.
func TestTrackNavAcceptsViewAction(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryNav: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackNav, "/api/track-nav", map[string]any{"action": "view", "detail": "health"})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"event":"nav.view"`) || !strings.Contains(lines[0], `"detail":"health"`) {
		t.Fatalf("expected a nav.view line with detail=health, got %v", lines)
	}
}

func TestTrackNavOffByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackNav, "/api/track-nav", map[string]any{"action": "page"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no lines with nav off, got %v", lines)
	}
}

func TestTrackSessionRequiresAValidSessionID(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategorySession: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackSession, "/api/track-session", map[string]any{"pageId": 1, "sessionId": validSessionID})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})
	if len(lines) != 1 || !strings.Contains(lines[0], `"sessionId":"`+validSessionID+`"`) {
		t.Fatalf("expected a session line with the id, got %v", lines)
	}

	lines = captureActivityLogs(t, func() {
		postJSON(t, h.TrackSession, "/api/track-session", map[string]any{"pageId": 1, "sessionId": "short"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no line without a usable session id, got %v", lines)
	}
}

func TestTrackSessionOffByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackSession, "/api/track-session", map[string]any{"pageId": 1, "sessionId": validSessionID})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no lines with session off, got %v", lines)
	}
}

func TestTrackClientErrorTruncatesAndStripsScriptQuery(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryClientError: true}})
	h := newTrackOpenTestHandlers(t)

	longStack := strings.Repeat("a", activityMaxStackRunes+100)
	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackClientError, "/api/track-clienterror", map[string]any{
			"message": "boom", "stack": longStack,
			"script": "https://example.com/static/js/widget.js?token=secret123",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 line, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], `"script":"/static/js/widget.js"`) {
		t.Fatalf("expected the query dropped from script, got %s", lines[0])
	}
	if strings.Contains(lines[0], "token=secret123") {
		t.Fatalf("query string leaked into the log: %s", lines[0])
	}
	if strings.Contains(lines[0], strings.Repeat("a", activityMaxStackRunes+1)) {
		t.Fatalf("stack was not truncated: %s", lines[0])
	}
}

func TestTrackClientErrorRequiresAMessage(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryClientError: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackClientError, "/api/track-clienterror", map[string]any{"stack": "at foo()"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no line without a message, got %v", lines)
	}
}

func TestTrackClientErrorOffByDefault(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		postJSON(t, h.TrackClientError, "/api/track-clienterror", map[string]any{"message": "boom"})
	})
	if len(lines) != 0 {
		t.Fatalf("expected no lines with clienterror off, got %v", lines)
	}
}
