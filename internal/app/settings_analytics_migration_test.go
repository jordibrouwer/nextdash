package app

import (
	"os"
	"path/filepath"
	"testing"
)

// writeSettings drops a raw settings.json into a fresh temp data dir and
// returns the settings as GetSettings() resolves them.
func writeSettings(t *testing.T, raw string) Settings {
	t.Helper()

	tmp := t.TempDir()
	t.Chdir(tmp)

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ResolveDataDir(), "settings.json"), []byte(raw), 0644); err != nil {
		t.Fatal(err)
	}

	return NewStore().GetSettings()
}

func TestFreshInstallAnalyticsIsOptedOut(t *testing.T) {

	tmp := t.TempDir()
	t.Chdir(tmp)

	if NewStore().GetSettings().AnalyticsOptIn {
		t.Fatal("fresh install: analyticsOptIn should be false until the user opts in")
	}
}

// An install running the pre-rename build stored the setting under the old
// name. A stored `true` carries over so analytics is not silently switched off
// underneath a running instance.
func TestLegacyAnalyticsEnabledMigratesToOptIn(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"enableUsageAnalytics":true}`)

	if !settings.AnalyticsOptIn {
		t.Fatal("migration: stored enableUsageAnalytics=true should migrate to analyticsOptIn=true")
	}
}

// The opt-out must survive the rename: someone who actively unticked the box
// may never be flipped back on.
func TestLegacyAnalyticsDisabledStaysOff(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"enableUsageAnalytics":false}`)

	if settings.AnalyticsOptIn {
		t.Fatal("migration: stored enableUsageAnalytics=false must stay opted out")
	}
}

// An install predating both names never expressed a preference at all.
func TestMissingAnalyticsKeysStayOptedOut(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"theme":"cherry-graphite-dark"}`)

	if settings.AnalyticsOptIn {
		t.Fatal("migration: absent analytics keys should leave analyticsOptIn false")
	}
}

// Once the new key is stored it is authoritative, even if a stale legacy key is
// still sitting in the file alongside it.
func TestNewAnalyticsKeyWinsOverLegacyKey(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"analyticsOptIn":false,"enableUsageAnalytics":true}`)

	if settings.AnalyticsOptIn {
		t.Fatal("migration: stored analyticsOptIn=false must win over the legacy key")
	}
}

// Opted-in users have a working install; the card would only interrupt them.
func TestOptedInUsersAreNotAskedAgain(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"enableUsageAnalytics":true}`)

	if !settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("migration: an opted-in user should count as having chosen")
	}
}

// The core of this change: dismissing the old announce-only card is not an
// answer, so these users must still be asked.
func TestLegacySeenNoticeStillGetsAsked(t *testing.T) {

	settings := writeSettings(t,
		`{"currentPage":1,"enableUsageAnalytics":false,"quickStart":{"seenAnalyticsNotice":true}}`)

	if settings.AnalyticsOptIn {
		t.Fatal("migration: analytics should stay off")
	}
	if settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("migration: the legacy seenAnalyticsNotice flag must not count as a choice")
	}
}

// A user who never expressed anything gets the card.
func TestUntouchedInstallGetsAsked(t *testing.T) {

	settings := writeSettings(t, `{"currentPage":1,"theme":"cherry-graphite-dark"}`)

	if settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("migration: an install with no analytics history should still be asked")
	}
}

// A stored decline must survive reloads, otherwise the card reappears forever.
func TestStoredDeclineIsPreserved(t *testing.T) {

	settings := writeSettings(t,
		`{"currentPage":1,"analyticsOptIn":false,"quickStart":{"analyticsChoiceMade":true}}`)

	if !settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("migration: a stored decline must not be re-seeded to false")
	}
	if settings.AnalyticsOptIn {
		t.Fatal("migration: a decline must leave analytics off")
	}
}

// A snooze is not an answer, so the question stays open -- but the timestamp
// has to survive a reload or the card would return on the very next load.
func TestSnoozeSurvivesReload(t *testing.T) {

	settings := writeSettings(t,
		`{"currentPage":1,"quickStart":{"analyticsAskAfter":4102444800,"analyticsSnoozes":1}}`)

	if settings.QuickStart.AnalyticsAskAfter != 4102444800 {
		t.Fatalf("analyticsAskAfter = %d, want 4102444800", settings.QuickStart.AnalyticsAskAfter)
	}
	if settings.QuickStart.AnalyticsSnoozes != 1 {
		t.Fatalf("analyticsSnoozes = %d, want 1", settings.QuickStart.AnalyticsSnoozes)
	}
	if settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("a snooze must not count as an answer")
	}
}

// Showing the card writes a cooldown without touching the escalation counter,
// so that combination -- a future timestamp with no snoozes -- must persist.
// Otherwise reloading past an untouched card re-shows it every single load.
func TestShownCooldownPersistsWithoutSnoozeCount(t *testing.T) {

	settings := writeSettings(t,
		`{"currentPage":1,"quickStart":{"analyticsAskAfter":4102444800}}`)

	if settings.QuickStart.AnalyticsAskAfter != 4102444800 {
		t.Fatalf("analyticsAskAfter = %d, want 4102444800", settings.QuickStart.AnalyticsAskAfter)
	}
	if settings.QuickStart.AnalyticsSnoozes != 0 {
		t.Fatalf("analyticsSnoozes = %d, want 0 -- being shown must not consume a step",
			settings.QuickStart.AnalyticsSnoozes)
	}
	if settings.QuickStart.AnalyticsChoiceMade {
		t.Fatal("a cooldown must not count as an answer")
	}
}

// Config and `:telemetry` record the choice too, not just the card. Without
// that, turning analytics off in config reads as "never chose" and the card
// comes back asking to enable what the user just disabled.
func TestChoiceFromConfigRoundTripsThroughMerge(t *testing.T) {

	stored := Settings{AnalyticsOptIn: true}

	merged, err := mergeSettingsFromBody(stored,
		[]byte(`{"analyticsOptIn":false,"quickStart":{"analyticsChoiceMade":true,"analyticsAskAfter":0}}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.AnalyticsOptIn {
		t.Fatal("analyticsOptIn should be false after opting out")
	}
	if !merged.QuickStart.AnalyticsChoiceMade {
		t.Fatal("opting out via config must count as a choice, or the card re-prompts")
	}
}

// The client writes these through the normal settings save, so they must round
// trip through the merge rather than being dropped as unknown fields.
func TestSnoozeRoundTripsThroughMerge(t *testing.T) {

	stored := Settings{Theme: "dark"}

	merged, err := mergeSettingsFromBody(stored,
		[]byte(`{"quickStart":{"analyticsAskAfter":4102444800,"analyticsSnoozes":2}}`))
	if err != nil {
		t.Fatalf("mergeSettingsFromBody: %v", err)
	}
	if merged.QuickStart.AnalyticsAskAfter != 4102444800 {
		t.Fatalf("analyticsAskAfter = %d, want 4102444800", merged.QuickStart.AnalyticsAskAfter)
	}
	if merged.QuickStart.AnalyticsSnoozes != 2 {
		t.Fatalf("analyticsSnoozes = %d, want 2", merged.QuickStart.AnalyticsSnoozes)
	}
	if merged.Theme != "dark" {
		t.Fatalf("theme = %q, want dark", merged.Theme)
	}
}
