package app

import (
	"strings"
	"testing"
)

// The setting wins when it is set, and stays out of the way when it is not.
func TestApplyLogSettingsPrecedence(t *testing.T) {
	t.Setenv("NEXTDASH_ACTIVITY_LOG", "mutate")
	setLogLevelForTest(t, logLevelInfoName)
	t.Cleanup(clearActivityLogTestOverride)

	resetActivityLogForTest(loadActivityLogConfig())
	applyLogSettings(Settings{ServerLogLevel: "debug", ActivityChannels: []string{"health", "feeds"}})
	if got := currentLogLevel(); got != logLevelDebugName {
		t.Fatalf("level = %q, want debug", got)
	}
	if !activityEnabled("health") || !activityEnabled("feeds") {
		t.Fatal("the chosen channels are not on")
	}
	if activityEnabled("mutate") {
		t.Fatal("the environment variable was not overridden by the setting")
	}

	// Unset settings leave the environment in charge.
	resetActivityLogForTest(loadActivityLogConfig())
	applyLogSettings(Settings{})
	if !activityEnabled("mutate") {
		t.Fatal("an empty setting should leave NEXTDASH_ACTIVITY_LOG alone")
	}
	if got := currentLogLevel(); got != logLevelDebugName {
		t.Fatalf("an empty level should leave the floor alone, got %q", got)
	}
}

// Persistence is the environment's business, not the channel list's: choosing
// which channels to record must not silently stop writing them to disk.
func TestApplyLogSettingsKeepsPersistence(t *testing.T) {
	t.Cleanup(clearActivityLogTestOverride)
	resetActivityLogForTest(activityLogConfig{
		enabled:  map[string]bool{activityCategoryMutate: true},
		persist:  true,
		filePath: "/tmp/nextdash-activity-test.log",
	})

	applyLogSettings(Settings{ActivityChannels: []string{"health"}})

	cfg := activityConfig()
	if !cfg.persist || cfg.filePath != "/tmp/nextdash-activity-test.log" {
		t.Fatalf("persistence was lost: persist=%v path=%q", cfg.persist, cfg.filePath)
	}
	if !cfg.enabled["health"] || cfg.enabled[activityCategoryMutate] {
		t.Fatalf("the channel list was not replaced: %v", cfg.enabled)
	}
}

// Verbose reaches the call sites, and Normal shuts them off again — the loop
// someone follows when they turn the level up to find something out.
func TestVerboseTurnsDebugLinesOnAndOff(t *testing.T) {
	buf := captureLog(t)
	setLogLevelForTest(t, logLevelInfoName)

	logDebug(logComponentFeeds, "example.com answered 304, nothing new")
	if strings.Contains(buf.String(), "304") {
		t.Fatalf("a debug line was written at Normal: %q", buf.String())
	}

	applyLogSettings(Settings{ServerLogLevel: "debug"})
	logDebug(logComponentFeeds, "example.com answered 304, nothing new")
	if !strings.Contains(buf.String(), "DEBUG feeds example.com answered 304") {
		t.Fatalf("no debug line at Verbose: %q", buf.String())
	}

	applyLogSettings(Settings{ServerLogLevel: "info"})
	buf.Reset()
	logDebug(logComponentFeeds, "example.com answered 304, nothing new")
	if strings.TrimSpace(buf.String()) != "" {
		t.Fatalf("debug lines did not stop at Normal: %q", buf.String())
	}
}
