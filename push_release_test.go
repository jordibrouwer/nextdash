package main

import (
	"encoding/json"
	"testing"
)

// A false boolean must still appear in the JSON. With `omitempty` it would be
// dropped, the config checkbox would read `undefined` rather than unchecked, and
// switching a toggle off would silently fail to survive a reload.
func TestPushSettingsSerializeFalseValues(t *testing.T) {
	data, err := json.Marshal(Settings{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	for _, field := range []string{"pushNotifyEnabled", "pushNotifyMonitor", "pushNotifyBackup", "pushNotifyRelease"} {
		value, ok := decoded[field]
		if !ok {
			t.Errorf("%s is missing from the JSON when false; the config toggle would read undefined", field)
			continue
		}
		if value != false {
			t.Errorf("%s = %v, want false", field, value)
		}
	}
}

// Enabling the toggle must not fire a notification for the version already
// running: the first pass only records what is installed.
func TestNotifyReleaseOnStartupIsSilentOnFirstRun(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, nil)

	h.notifyReleaseOnStartup()

	if got := f.count(); got != 0 {
		t.Errorf("sent %d notifications on the first run, want 0", got)
	}
	// The running release is recorded, so the next restart can compare against it.
	if state := readPushReleaseState(); state.LastNotifiedTag == "" && releaseTag() != "" {
		t.Error("first run did not record the running release")
	}
}

// Restarting the same version must stay quiet — otherwise every container
// restart would notify.
func TestNotifyReleaseOnStartupIsQuietForSameVersion(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, nil)

	h.notifyReleaseOnStartup() // records
	h.notifyReleaseOnStartup() // same version
	h.notifyReleaseOnStartup()

	if got := f.count(); got != 0 {
		t.Errorf("sent %d notifications for an unchanged version, want 0", got)
	}
}

// A newer tag than the one last announced is the case that should notify.
func TestNotifyReleaseOnStartupAnnouncesNewVersion(t *testing.T) {
	f := newFakePushService(t)
	h := newPushTestHandlers(t, f, nil)

	// Pretend an older release was the last one announced.
	writePushReleaseState(pushReleaseState{LastNotifiedTag: "v0000.00.00.0"})

	h.notifyReleaseOnStartup()

	if releaseTag() == "" {
		t.Skip("no release tag available in this build")
	}
	if got := f.count(); got != 1 {
		t.Fatalf("sent %d notifications for a new version, want 1", got)
	}
	// The new tag is recorded so the announcement happens only once.
	if state := readPushReleaseState(); state.LastNotifiedTag != releaseTag() {
		t.Errorf("recorded tag = %q, want %q", state.LastNotifiedTag, releaseTag())
	}
}

func TestNotifyReleaseOnStartupRespectsToggles(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Settings)
	}{
		{"push disabled", func(s *Settings) { s.PushNotifyEnabled = false }},
		{"release category off", func(s *Settings) { s.PushNotifyRelease = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakePushService(t)
			h := newPushTestHandlers(t, f, tc.mutate)
			writePushReleaseState(pushReleaseState{LastNotifiedTag: "v0000.00.00.0"})

			h.notifyReleaseOnStartup()

			if got := f.count(); got != 0 {
				t.Errorf("sent %d notifications with the toggle off, want 0", got)
			}
		})
	}
}

// The push settings must survive the real save/load path, or the toggles would
// silently reset and notifications would stop.
func TestPushSettingsRoundTripThroughStore(t *testing.T) {
	withTempPushData(t)

	store := NewStore()
	settings := store.GetSettings()
	settings.PushNotifyEnabled = true
	settings.PushNotifyMonitor = true
	settings.PushNotifyBackup = true
	settings.PushNotifyRelease = true
	settings.PushNotifySubject = "admin@example.com"
	if err := store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	got := NewStore().GetSettings()
	if !got.PushNotifyEnabled || !got.PushNotifyMonitor || !got.PushNotifyBackup || !got.PushNotifyRelease {
		t.Errorf("push toggles did not survive a round trip: %+v", got)
	}
	// A bare address is promoted to a valid mailto: rather than being discarded.
	if got.PushNotifySubject != "mailto:admin@example.com" {
		t.Errorf("PushNotifySubject = %q, want it normalized to a mailto:", got.PushNotifySubject)
	}
}
