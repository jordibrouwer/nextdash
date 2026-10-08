package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The demo's own Umami website, as the plan names it. A test id: the code
// reads the one the operator sets, it does not know this one.
const testDemoAnalyticsID = "257bdc36-89c5-4fdd-9e3a-401599dc1005"

func demoEnv(t *testing.T, demoOn bool, demoID string) {
	t.Helper()
	if demoOn {
		t.Setenv("NEXTDASH_DEMO", "1")
	} else {
		t.Setenv("NEXTDASH_DEMO", "")
	}
	t.Setenv(demoAnalyticsIDEnv, demoID)
	t.Setenv("DISABLE_TELEMETRY", "")
}

func TestAnalyticsTargetTable(t *testing.T) {
	cases := []struct {
		name        string
		demo        bool
		demoID      string
		disable     string
		optIn       bool
		wantID      string
		wantOn      bool
		wantSnapped bool
	}{
		{name: "DISABLE_TELEMETRY on a normal install", disable: "true", optIn: true},
		{name: "DISABLE_TELEMETRY in the demo", demo: true, demoID: testDemoAnalyticsID, disable: "true"},
		{name: "DISABLE_TELEMETRY in the demo, opted in", demo: true, demoID: testDemoAnalyticsID, disable: "1", optIn: true},
		{name: "demo with the demo id", demo: true, demoID: testDemoAnalyticsID, wantID: testDemoAnalyticsID, wantOn: true},
		{name: "demo without a demo id", demo: true},
		{name: "demo with a malformed id", demo: true, demoID: "<script>alert(1)</script>"},
		{name: "demo with the id padded by spaces", demo: true, demoID: " " + testDemoAnalyticsID + " ", wantID: testDemoAnalyticsID, wantOn: true},
		{name: "demo, opted in, still the demo id", demo: true, demoID: testDemoAnalyticsID, optIn: true, wantID: testDemoAnalyticsID, wantOn: true},
		{name: "demo, opted in, no demo id: nothing, not the shared id", demo: true, optIn: true},
		{name: "normal install, opted in", optIn: true, wantID: analyticsWebsiteID, wantOn: true, wantSnapped: true},
		{name: "normal install, opted in, demo id set", demoID: testDemoAnalyticsID, optIn: true, wantID: analyticsWebsiteID, wantOn: true, wantSnapped: true},
		{name: "normal install, not opted in", demoID: testDemoAnalyticsID},
		{name: "normal install, not opted in, nothing set"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			demoEnv(t, tc.demo, tc.demoID)
			t.Setenv("DISABLE_TELEMETRY", tc.disable)
			id, on, snaps := analyticsTarget(Settings{AnalyticsOptIn: tc.optIn})
			if id != tc.wantID || on != tc.wantOn || snaps != tc.wantSnapped {
				t.Fatalf("analyticsTarget = (%q, %v, %v), want (%q, %v, %v)",
					id, on, snaps, tc.wantID, tc.wantOn, tc.wantSnapped)
			}
		})
	}
}

// The data-pollution rule: whatever the settings say, the demo never writes the
// shared website id, and a normal install never gets the demo's.
func TestDemoNeverGetsTheSharedWebsiteID(t *testing.T) {
	for _, optIn := range []bool{false, true} {
		for _, demoID := range []string{"", testDemoAnalyticsID} {
			demoEnv(t, true, demoID)
			id, _, _ := analyticsTarget(Settings{AnalyticsOptIn: optIn})
			if id == analyticsWebsiteID {
				t.Fatalf("demo (optIn=%v, demoID=%q) was given the shared website id", optIn, demoID)
			}
		}
	}
}

func TestNormalInstallNeverGetsTheDemoID(t *testing.T) {
	demoEnv(t, false, testDemoAnalyticsID)
	for _, optIn := range []bool{false, true} {
		id, _, _ := analyticsTarget(Settings{AnalyticsOptIn: optIn})
		if id == testDemoAnalyticsID {
			t.Fatalf("a normal install (optIn=%v) was given the demo website id", optIn)
		}
	}
}

func TestAnalyticsRecorderOnlyInTheDemoWithTheDemoID(t *testing.T) {
	cases := []struct {
		name    string
		demo    bool
		demoID  string
		optIn   bool
		disable string
		want    bool
	}{
		{name: "demo with id", demo: true, demoID: testDemoAnalyticsID, want: true},
		{name: "demo without id", demo: true},
		{name: "demo, telemetry disabled", demo: true, demoID: testDemoAnalyticsID, disable: "true"},
		{name: "normal, opted in", optIn: true},
		{name: "normal, opted in, demo id set", demoID: testDemoAnalyticsID, optIn: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			demoEnv(t, tc.demo, tc.demoID)
			t.Setenv("DISABLE_TELEMETRY", tc.disable)
			id, on, _ := analyticsTarget(Settings{AnalyticsOptIn: tc.optIn})
			if got := analyticsRecorderOn(id, on); got != tc.want {
				t.Fatalf("analyticsRecorderOn = %v, want %v", got, tc.want)
			}
		})
	}
	// An id that is not the demo's never gets it, whatever the flags say.
	demoEnv(t, true, testDemoAnalyticsID)
	if analyticsRecorderOn(analyticsWebsiteID, true) {
		t.Fatal("the recorder was switched on for the shared website id")
	}
}

func TestInstallPingStaysOffInTheDemo(t *testing.T) {
	demoEnv(t, true, testDemoAnalyticsID)
	if installPingEnabled(Settings{InstallPingEnabled: true}) {
		t.Fatal("the install ping is on in demo mode")
	}
	// And a ping that is attempted anyway is refused, as before.
	if err := sendInstallPing(t.Context(), "id", "v1", ""); err != errDemoOutbound {
		t.Fatalf("a demo install ping got %v, want errDemoOutbound", err)
	}
	demoEnv(t, false, testDemoAnalyticsID)
	if !installPingEnabled(Settings{InstallPingEnabled: true}) {
		t.Fatal("the ping went off on a normal install")
	}
}

// pageHTML renders the real dashboard template the way a visitor gets it.
func pageHTML(t *testing.T, settings Settings) string {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Setenv("NEXTDASH_DISABLE_PREFETCH", "1")
	h := &Handlers{store: NewStore(), files: embeddedFiles}
	h.registerHandlerSources()
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	h.Dashboard(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard answered %d: %s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

func TestDashboardPageCarriesTheRightWebsite(t *testing.T) {
	t.Run("demo: the demo id, both scripts, no snapshots", func(t *testing.T) {
		demoEnv(t, true, testDemoAnalyticsID)
		// Opted in on purpose: the setting must not matter in the demo.
		page := pageHTML(t, Settings{AnalyticsOptIn: true})
		if strings.Contains(page, analyticsWebsiteID) {
			t.Fatal("the shared website id is on the demo page")
		}
		if !strings.Contains(page, `data-website-id="`+testDemoAnalyticsID+`"`) {
			t.Fatal("the demo id is not on the demo page")
		}
		if !strings.Contains(page, `data-mode="demo"`) || strings.Count(page, `data-do-not-track="true"`) != 2 {
			t.Fatal("the demo tracker is not marked as the demo's, with do-not-track on both scripts")
		}
		if !strings.Contains(page, `src="`+analyticsRecorderSrc+`"`) {
			t.Fatal("the recorder is missing from the demo page")
		}
		if !strings.Contains(page, `data-content=""`) || !strings.Contains(page, `data-snapshots=""`) {
			t.Fatal("the demo page carries snapshots")
		}
	})
	t.Run("demo without an id: no tracker at all", func(t *testing.T) {
		demoEnv(t, true, "")
		page := pageHTML(t, Settings{AnalyticsOptIn: true})
		if strings.Contains(page, "umami-analytics") || strings.Contains(page, analyticsWebsiteID) ||
			strings.Contains(page, "recorder.js") {
			t.Fatal("a demo without a demo id has analytics on the page")
		}
	})
	t.Run("normal install: the shared id, never the demo id, no recorder", func(t *testing.T) {
		demoEnv(t, false, testDemoAnalyticsID)
		page := pageHTML(t, Settings{AnalyticsOptIn: true})
		if strings.Contains(page, testDemoAnalyticsID) {
			t.Fatal("the demo id is on a normal page")
		}
		if !strings.Contains(page, `data-website-id="`+analyticsWebsiteID+`"`) {
			t.Fatal("the shared id is missing from an opted-in page")
		}
		if strings.Contains(page, `data-mode="demo"`) || strings.Contains(page, "recorder.js") ||
			strings.Contains(page, "data-do-not-track") {
			t.Fatal("a normal page carries demo markings")
		}
	})
	t.Run("normal install, not opted in: nothing", func(t *testing.T) {
		demoEnv(t, false, testDemoAnalyticsID)
		page := pageHTML(t, Settings{})
		if strings.Contains(page, "umami-analytics") || strings.Contains(page, testDemoAnalyticsID) {
			t.Fatal("an opted-out page has analytics on it")
		}
	})
	t.Run("DISABLE_TELEMETRY: nothing, in the demo too", func(t *testing.T) {
		demoEnv(t, true, testDemoAnalyticsID)
		t.Setenv("DISABLE_TELEMETRY", "true")
		page := pageHTML(t, Settings{AnalyticsOptIn: true})
		if strings.Contains(page, "umami-analytics") || strings.Contains(page, "recorder.js") ||
			strings.Contains(page, testDemoAnalyticsID) || strings.Contains(page, analyticsWebsiteID) {
			t.Fatal("DISABLE_TELEMETRY did not switch the demo's analytics off")
		}
	})
}

// The two Privacy switches are not the demo's visitor's: they read as off, and
// a save cannot turn them on, as under DISABLE_TELEMETRY.
func TestDemoPrivacySwitchesReadOffAndStayOff(t *testing.T) {
	h := newDemoHandlers(t)
	t.Setenv(demoAnalyticsIDEnv, testDemoAnalyticsID)

	get := func() Settings {
		rec := httptest.NewRecorder()
		h.GetSettings(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
		var out Settings
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := get(); got.AnalyticsOptIn || got.InstallPingEnabled {
		t.Fatalf("the demo reports a Privacy switch as on: %+v", got)
	}

	stored := h.store.GetSettings()
	stored.AnalyticsOptIn = true
	stored.InstallPingEnabled = true
	if err := h.store.SaveSettings(stored); err != nil {
		t.Fatal(err)
	}
	if got := get(); got.AnalyticsOptIn || got.InstallPingEnabled {
		t.Fatalf("a stored opt-in shows through in the demo: %+v", got)
	}
}

func postSettings(t *testing.T, h *Handlers, body string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.SaveSettings(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/settings answered %d: %s", rec.Code, rec.Body.String())
	}
}

// The clamp in SaveSettings: a client that POSTs the two switches on in the
// demo changes nothing. The same POST on a normal install is the control.
func TestDemoSaveSettingsKeepsThePrivacySwitchesOff(t *testing.T) {
	h := newDemoHandlers(t)
	off := h.store.GetSettings()
	off.AnalyticsOptIn = false
	off.InstallPingEnabled = false
	if err := h.store.SaveSettings(off); err != nil {
		t.Fatal(err)
	}
	postSettings(t, h, `{"analyticsOptIn":true,"installPingEnabled":true}`)
	if got := h.store.GetSettings(); got.AnalyticsOptIn || got.InstallPingEnabled {
		t.Fatalf("a POST turned a Privacy switch on in the demo: optIn=%v ping=%v", got.AnalyticsOptIn, got.InstallPingEnabled)
	}
}

func TestSaveSettingsTurnsThePrivacySwitchesOnOutsideTheDemo(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "")
	t.Setenv("DISABLE_TELEMETRY", "")
	h := newTestHandlers(t)
	off := h.store.GetSettings()
	off.AnalyticsOptIn = false
	off.InstallPingEnabled = false
	if err := h.store.SaveSettings(off); err != nil {
		t.Fatal(err)
	}
	postSettings(t, h, `{"analyticsOptIn":true,"installPingEnabled":true}`)
	if got := h.store.GetSettings(); !got.AnalyticsOptIn || !got.InstallPingEnabled {
		t.Fatalf("the control POST did not turn the switches on: optIn=%v ping=%v", got.AnalyticsOptIn, got.InstallPingEnabled)
	}
}

// Every server-side field of Config → Behavior → Privacy & sync is the demo's,
// not the visitor's: a save that flips them changes nothing. The control is the
// same POST on an ordinary install.
func TestDemoSaveSettingsKeepsThePrivacyTabAsItWas(t *testing.T) {
	body := `{"enableSessionTips":false,"enableTagSuggestionNotice":false,"enableHealthReviewNotice":false,` +
		`"updateCheckEnabled":false,"showSiteNews":false,"analyticsOptIn":true,"installPingEnabled":true}`
	prime := func(h *Handlers, on bool) {
		s := h.store.GetSettings()
		s.EnableSessionTips, s.EnableTagSuggestionNotice, s.EnableHealthReviewNotice = on, on, on
		s.UpdateCheckEnabled, s.ShowSiteNews = on, on
		s.AnalyticsOptIn, s.InstallPingEnabled = !on, !on
		if err := h.store.SaveSettings(s); err != nil {
			t.Fatal(err)
		}
	}
	fields := func(s Settings) []bool {
		return []bool{s.EnableSessionTips, s.EnableTagSuggestionNotice, s.EnableHealthReviewNotice,
			s.UpdateCheckEnabled, s.ShowSiteNews, s.AnalyticsOptIn, s.InstallPingEnabled}
	}

	t.Run("demo: nothing changes", func(t *testing.T) {
		h := newDemoHandlers(t)
		prime(h, true)
		before := fields(h.store.GetSettings())
		postSettings(t, h, body)
		after := fields(h.store.GetSettings())
		for i := range before {
			if before[i] != after[i] {
				t.Fatalf("field %d changed in the demo: %v -> %v", i, before, after)
			}
		}
	})
	t.Run("control: an ordinary install takes them", func(t *testing.T) {
		t.Setenv("NEXTDASH_DEMO", "")
		t.Setenv("DISABLE_TELEMETRY", "")
		t.Setenv("DISABLE_UPDATE_CHECK", "")
		h := newTestHandlers(t)
		prime(h, true)
		postSettings(t, h, body)
		got := fields(h.store.GetSettings())
		want := []bool{false, false, false, false, false, true, true}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("the control POST did not apply: %v, want %v", got, want)
			}
		}
	})
}
