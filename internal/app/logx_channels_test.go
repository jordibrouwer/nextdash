package app

import (
	"context"
	"strings"
	"testing"
	"time"
)

// A check round says what it did, which is the line someone watching the
// container wants and the one the server never wrote.
func TestCheckRoundLogsItsOutcome(t *testing.T) {
	buf := captureLog(t)
	setLogLevelForTest(t, logLevelInfoName)
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	t.Cleanup(clearActivityLogTestOverride)

	logCheckRound(110, 2, 1400*time.Millisecond)

	got := strings.TrimSpace(buf.String())
	want := "INFO health checked 110 bookmarks, 2 failed, 1.4s"
	if got != want {
		t.Fatalf("line = %q, want %q", got, want)
	}
}

// The eight new channels exist but stay off until someone asks for them: a
// trail nobody switched on should not start filling the disk on upgrade.
func TestNewActivityChannelsAreOffByDefault(t *testing.T) {
	t.Setenv("NEXTDASH_ACTIVITY_LOG", "")
	cfg := loadActivityLogConfig()
	for _, category := range []string{
		activityCategoryHealth, activityCategorySources, activityCategoryFeeds,
		activityCategoryArchive, activityCategoryBackup, activityCategoryStore,
		activityCategoryWidgets, activityCategoryNotify,
	} {
		if cfg.enabled[category] {
			t.Errorf("%s is on by default", category)
		}
	}
	if !cfg.enabled[activityCategoryMutate] || !cfg.enabled[activityCategoryStatus] {
		t.Fatal("the two channels that were on by default are no longer on")
	}
}

// Every way out of a capture says what became of it, including the early
// refusals — those return through a shadowed err, and the named result is what
// the deferred line reads.
func TestCaptureLogsItsOutcomeOnAnEarlyRefusal(t *testing.T) {
	buf := captureLog(t)
	setLogLevelForTest(t, logLevelInfoName)
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{}})
	t.Cleanup(clearActivityLogTestOverride)

	h := newTestHandlers(t)
	if _, err := h.CaptureLocally(context.Background(), "not-a-url"); err == nil {
		t.Fatal("an unusable address should not be captured")
	}

	if !strings.Contains(buf.String(), "WARN archive") {
		t.Fatalf("the refusal was not logged: %q", buf.String())
	}
}
