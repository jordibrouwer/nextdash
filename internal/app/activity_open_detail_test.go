package app

import (
	"net/http"
	"strings"
	"testing"
)

func TestActivityOpenDetailLevelDefaultsToBasic(t *testing.T) {
	t.Cleanup(clearActivityLogTestOverride)

	for _, raw := range []string{"", "garbage", "  "} {
		resetActivityLogForTest(activityLogConfig{openDetail: raw})
		if got := activityOpenDetailLevel(); got != "basic" {
			t.Fatalf("openDetail %q => %q, want basic", raw, got)
		}
	}
}

func TestActivityOpenDetailLevelParsesValidValues(t *testing.T) {
	t.Cleanup(clearActivityLogTestOverride)

	cases := map[string]string{"off": "off", "OFF": "off", " full ": "full", "Full": "full", "basic": "basic"}
	for raw, want := range cases {
		resetActivityLogForTest(activityLogConfig{openDetail: raw})
		if got := activityOpenDetailLevel(); got != want {
			t.Fatalf("openDetail %q => %q, want %q", raw, got, want)
		}
	}
}

// The setting wins when set, environment otherwise — the same precedence
// ActivityChannels already follows.
func TestApplyLogSettingsActivityOpenDetailPrecedence(t *testing.T) {
	t.Setenv("NEXTDASH_ACTIVITY_OPEN_DETAIL", "full")
	t.Cleanup(clearActivityLogTestOverride)

	resetActivityLogForTest(loadActivityLogConfig())
	if got := activityOpenDetailLevel(); got != "full" {
		t.Fatalf("env level = %q, want full", got)
	}

	applyLogSettings(Settings{ActivityOpenDetail: "basic"})
	if got := activityOpenDetailLevel(); got != "basic" {
		t.Fatalf("setting did not override env: %q", got)
	}

	applyLogSettings(Settings{})
	if got := activityOpenDetailLevel(); got != "basic" {
		t.Fatalf("an empty setting should leave the level alone, got %q", got)
	}
}

func TestTrackBookmarkOpenLevelOffSuppressesSourceAndMethod(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled:    map[string]bool{activityCategoryOpen: true},
		openDetail: "off",
	})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0, "source": "search", "method": "mouse",
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if strings.Contains(lines[0], `"openSource"`) || strings.Contains(lines[0], `"method"`) {
		t.Fatalf("off should suppress source/method, got %s", lines[0])
	}
	if !strings.Contains(lines[0], `"pageId"`) || !strings.Contains(lines[0], `"index"`) {
		t.Fatalf("off should still keep the plain record, got %s", lines[0])
	}
}

func TestTrackBookmarkOpenLevelBasicOmitsFullExtras(t *testing.T) {
	// openDetail left unset: basic is the default.
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryOpen: true}})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0, "source": "search", "method": "mouse",
			"resultRank": 2, "queryLength": 5, "newTab": true, "category": "work",
			"rowIndex": 1, "msSinceRender": 300,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], `"openSource":"search"`) {
		t.Fatalf("basic should still carry source, got %s", lines[0])
	}
	for _, field := range []string{"resultRank", "queryLength", "newTab", "category", "rowIndex", "msSinceRender"} {
		if strings.Contains(lines[0], `"`+field+`"`) {
			t.Fatalf("basic should not carry %q, got %s", field, lines[0])
		}
	}
}

func TestTrackBookmarkOpenLevelFullIncludesValidExtras(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled:    map[string]bool{activityCategoryOpen: true},
		openDetail: "full",
	})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0, "source": "search", "method": "mouse",
			"resultRank": 2, "queryLength": 5, "newTab": true, "category": "work",
			"rowIndex": 1, "msSinceRender": 300,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	for _, want := range []string{
		`"resultRank":2`, `"queryLength":5`, `"newTab":true`,
		`"category":"work"`, `"rowIndex":1`, `"msSinceRender":300`,
	} {
		if !strings.Contains(lines[0], want) {
			t.Fatalf("expected %s in %s", want, lines[0])
		}
	}
}

func TestTrackBookmarkOpenLevelFullDropsInvalidExtras(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled:    map[string]bool{activityCategoryOpen: true},
		openDetail: "full",
	})
	h := newTrackOpenTestHandlers(t)

	lines := captureActivityLogs(t, func() {
		rec := postJSON(t, h.TrackBookmarkOpen, "/api/track-open", map[string]any{
			"pageId": 1, "index": 0,
			"resultRank": -1, "queryLength": "nope", "newTab": "yes",
			"category": strings.Repeat("x", 100), "rowIndex": 999999999, "msSinceRender": -5,
		})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
		}
	})

	if len(lines) != 1 {
		t.Fatalf("expected 1 activity line, got %d (%v)", len(lines), lines)
	}
	for _, field := range []string{"resultRank", "queryLength", "newTab", "category", "rowIndex", "msSinceRender"} {
		if strings.Contains(lines[0], `"`+field+`"`) {
			t.Fatalf("expected %q dropped, got %s", field, lines[0])
		}
	}
}
