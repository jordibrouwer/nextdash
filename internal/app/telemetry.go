package app

import (
	"os"
	"regexp"
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

// demoAnalyticsIDEnv names the Umami website the public demo counts into. It
// is an environment variable rather than a constant so that a fork, a local
// demo or a test counts nothing unless somebody sets it on purpose.
const demoAnalyticsIDEnv = "NEXTDASH_DEMO_ANALYTICS_ID"

// analyticsRecorderSrc is the heatmap and replay recorder of the same Umami
// host. It only ever loads in demo mode with the demo website id.
const analyticsRecorderSrc = "https://stats.nextdash.cc/recorder.js"

// umamiWebsiteIDPattern is the shape of an Umami website id. The value ends
// up in a page, so anything else (a typo, a stray space, markup) is treated as
// not set rather than written out.
var umamiWebsiteIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// demoAnalyticsID is the demo's own Umami website id, or "" when the operator
// has not set one (or set something that is not an id).
func demoAnalyticsID() string {
	id := strings.TrimSpace(os.Getenv(demoAnalyticsIDEnv))
	if !umamiWebsiteIDPattern.MatchString(id) {
		return ""
	}
	return strings.ToLower(id)
}

// analyticsTarget decides which Umami website, if any, a page may report to.
//
//	DISABLE_TELEMETRY set          none
//	demo, demo id set              the demo id, never the snapshots
//	demo, no demo id               none
//	normal install, opted in       the shared id, with the snapshots
//	normal install, not opted in   none
//
// The two ids never cross. In demo mode the shared id is not written into the
// page whatever the settings say, so a visitor who ticks the Privacy box in
// the demo still lands only in the demo's website; and a normal install never
// gets the demo id, even with the variable set. The snapshots describe a real
// collection, which the demo's seeded one is not.
func analyticsTarget(settings Settings) (id string, enabled bool, snapshots bool) {
	if telemetryDisabledByEnv() {
		return "", false, false
	}
	if demoMode() {
		demoID := demoAnalyticsID()
		if demoID == "" {
			return "", false, false
		}
		return demoID, true, false
	}
	if !settings.AnalyticsOptIn {
		return "", false, false
	}
	return analyticsWebsiteID, true, true
}

// analyticsRecorderOn reports whether the heatmap and replay recorder goes on
// the page: demo mode, counting, and only into the demo's own website.
func analyticsRecorderOn(id string, enabled bool) bool {
	return enabled && demoMode() && id != "" && id == demoAnalyticsID()
}
