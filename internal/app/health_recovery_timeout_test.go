package app

import (
	"testing"
	"time"
)

// A recovery message carried the name, the URL and the time, and nothing else —
// so "X is back online" left the one question a recovery raises unanswered.
func TestOutageDurationReadsLikeAPersonSaysIt(t *testing.T) {
	for ms, want := range map[int64]string{
		0:                    "",
		-5:                   "",
		45 * 1000:            "45s",
		90 * 1000:            "1m",
		45 * 60 * 1000:       "45m",
		2 * 3600 * 1000:      "2h",
		(2*3600 + 90) * 1000: "2h 1m",
		26 * 3600 * 1000:     "1d 2h",
		48 * 3600 * 1000:     "2d",
	} {
		if got := formatOutageDuration(ms); got != want {
			t.Fatalf("formatOutageDuration(%d) = %q, want %q", ms, got, want)
		}
	}
}

func TestRecoveryTitleNamesTheDuration(t *testing.T) {
	title := monitorNotificationTitle(monitorNotification{
		Event:      "up",
		Name:       "Jellyfin",
		Status:     "online",
		DurationMs: 3 * 3600 * 1000,
	})
	if title != "Jellyfin is back online after 3h" {
		t.Fatalf("title = %q", title)
	}

	// Without a duration — an older history, or a recovery whose start cannot be
	// located — it says what it always said rather than "after 0m".
	plain := monitorNotificationTitle(monitorNotification{Event: "up", Name: "Jellyfin"})
	if plain != "Jellyfin is back online" {
		t.Fatalf("plain title = %q", plain)
	}
}

// Three seconds was hardcoded for every check in the app, which classified a
// service that legitimately needs four or five as "Timeout" — offline — with no
// control anywhere.
func TestHealthCheckTimeoutClampsAndDefaults(t *testing.T) {
	tmp := t.TempDir()
	t.Chdir(tmp)
	t.Setenv("NEXTDASH_DATA_DIR", tmp)
	h := &Handlers{store: NewStore()}

	if got := h.healthCheckTimeout(); got != defaultHealthCheckTimeout {
		t.Fatalf("unset timeout = %v, want the built-in default", got)
	}

	for _, tc := range []struct {
		seconds int
		want    time.Duration
	}{
		{1, minHealthCheckTimeout},
		{5, 5 * time.Second},
		{300, maxHealthCheckTimeout},
	} {
		settings := h.store.GetSettings()
		settings.HealthCheckTimeoutSeconds = tc.seconds
		if err := h.store.SaveSettings(settings); err != nil {
			t.Fatal(err)
		}
		if got := h.healthCheckTimeout(); got != tc.want {
			t.Fatalf("timeout for %ds = %v, want %v", tc.seconds, got, tc.want)
		}
	}
}

// The dial budget stays a fraction of the whole: a connection that cannot be
// opened should fail well before the body has a chance to be read.
func TestDialTimeoutStaysProportional(t *testing.T) {
	if got := dialTimeoutFor(3 * time.Second); got != 2*time.Second {
		t.Fatalf("dial for 3s = %v, want the 2s it always was", got)
	}
	if got := dialTimeoutFor(30 * time.Second); got != 20*time.Second {
		t.Fatalf("dial for 30s = %v, want 20s", got)
	}
	// A floor, so a short total still leaves room to connect at all.
	if got := dialTimeoutFor(time.Second); got != time.Second {
		t.Fatalf("dial for 1s = %v, want the 1s floor", got)
	}
}
