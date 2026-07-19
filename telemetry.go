package main

import (
	"os"
	"strconv"
	"strings"
)

// telemetryDisabledByEnv reports whether DISABLE_TELEMETRY switches usage
// analytics off for the whole instance.
//
// This is an operator-level kill switch: when set, analytics is off regardless
// of the per-user setting, the setting cannot be turned back on through the API,
// and the Privacy checkbox in config renders disabled. Intended for deployments
// where sending anything to a third-party host is not acceptable, so the
// decision does not rest on every user leaving the toggle alone.
//
// Accepts the usual truthy spellings (1, t, T, true, TRUE, yes, on); anything
// else — including unset — leaves analytics under user control.
func telemetryDisabledByEnv() bool {
	raw := strings.TrimSpace(os.Getenv("DISABLE_TELEMETRY"))
	if raw == "" {
		return false
	}
	switch strings.ToLower(raw) {
	case "yes", "y", "on":
		return true
	}
	// strconv covers 1/t/T/true/TRUE/True and their false counterparts.
	if v, err := strconv.ParseBool(raw); err == nil {
		return v
	}
	return false
}

// analyticsEnabled reports whether the tracker should run for this request:
// the user's own setting, unless the operator disabled telemetry outright.
func analyticsEnabled(settings Settings) bool {
	if telemetryDisabledByEnv() {
		return false
	}
	return settings.EnableUsageAnalytics
}
