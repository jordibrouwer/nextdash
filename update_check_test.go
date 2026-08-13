package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCompareReleaseTags(t *testing.T) {
	tests := []struct {
		a, b string
		want int
	}{
		{"v2026.08.06", "v2026.08.05", 1},
		{"v2026.08.05", "v2026.08.06", -1},
		{"v2026.08.02.3", "v2026.08.02.2", 1},
		{"v2026.08.02", "v2026.08.02.1", -1},
		{"v2026.08.06", "v2026.08.06", 0},
		{"", "v2026.08.06", -1},
	}
	for _, tc := range tests {
		got := compareReleaseTags(tc.a, tc.b)
		if got != tc.want {
			t.Errorf("compareReleaseTags(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

// The move from vYYYY.MM.N to semver.
//
// A plain numeric comparison reads v1.0.0 as older than v2026.09.09.3, because
// 1 is less than 2026. That is not a cosmetic sorting detail: updateStatus only
// sets UpdateAvailable when the published tag compares greater than the running
// one, so every existing install would sit on the last calendar release and
// never be told a v1 exists. A semantic tag therefore outranks a calendar one
// regardless of the numbers.
func TestCompareReleaseTagsAcrossVersionSchemes(t *testing.T) {
	tests := []struct {
		a, b string
		want int
		why  string
	}{
		{"v1.0.0", "v2026.09.09.3", 1, "the first semver release succeeds the last calendar one"},
		{"v2026.09.09.3", "v1.0.0", -1, "and the reverse holds"},
		{"v1.0", "v2026.09.09.3", 1, "a two-segment semver tag too"},
		{"v0.9.0", "v2026.01.01", 1, "even a 0.x tag, since the scheme decides rather than the value"},

		// Within one scheme nothing changes.
		{"v1.1.0", "v1.0.9", 1, "semver still compares numerically"},
		{"v1.0.0", "v1.0.1", -1, "including patch segments"},
		{"v2.0.0", "v1.9.9", 1, "and majors"},
		{"v2026.09.09.3", "v2026.09.09", 1, "calendar tags are untouched"},
		{"v1.0.0", "v1.0.0", 0, "equal is still equal"},

		// The boundary itself.
		{"v999.0.0", "v1000.0.0", 1, "999 is semver, 1000 is a year, so 999 wins"},
	}
	for _, tc := range tests {
		if got := compareReleaseTags(tc.a, tc.b); got != tc.want {
			t.Errorf("compareReleaseTags(%q, %q) = %d, want %d — %s", tc.a, tc.b, got, tc.want, tc.why)
		}
	}
}

// The comparison exists to drive this one decision, so it is worth asserting
// end to end rather than trusting the sign of an integer.
func TestUpdateAvailableAcrossVersionSchemes(t *testing.T) {
	if compareReleaseTags("v1.0.0", "v2026.09.09.3") <= 0 {
		t.Fatal("an install on the last calendar release would never be offered v1.0.0")
	}
	if compareReleaseTags("v2026.09.09.3", "v1.0.0") >= 0 {
		t.Fatal("an install already on v1.0.0 would be offered the old calendar release as an update")
	}
}

func TestUpdateCheckEnabledRespectsEnv(t *testing.T) {
	t.Setenv("DISABLE_UPDATE_CHECK", "true")
	settings := Settings{UpdateCheckEnabled: true}
	if updateCheckEnabled(settings) {
		t.Fatal("expected update check disabled when env is set")
	}
}

func TestUpdateCheckEnabledByDefault(t *testing.T) {
	settings := NewStore().GetSettings()
	if !settings.UpdateCheckEnabled {
		t.Fatal("UpdateCheckEnabled should default to true")
	}
}

func TestBuildUpdateStatusWhenDisabled(t *testing.T) {
	h := &Handlers{store: NewStore()}
	settings := h.store.GetSettings()
	settings.UpdateCheckEnabled = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	status := h.buildUpdateStatus(false)
	if status.Enabled {
		t.Fatalf("status = %+v, want enabled=false by default", status)
	}
	if status.Current == "" && releaseTag() != "" {
		t.Fatalf("current = %q, want %q", status.Current, releaseTag())
	}
}

func TestBuildUpdateStatusDetectsNewerRelease(t *testing.T) {
	current := releaseTag()
	if current == "" {
		t.Skip("no release tag in this build")
	}

	h := &Handlers{store: NewStore()}
	settings := h.store.GetSettings()
	settings.UpdateCheckEnabled = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	h.setUpdateCheckCache(updateCheckCacheEntry{
		info: upstreamReleaseInfo{
			Tag:        "v99.0.0",
			ReleaseURL: "https://github.com/jordibrouwer/nextdash/releases/tag/v99.0.0",
		},
		fetchedAt: time.Now(),
	})

	status := h.buildUpdateStatus(false)
	if !status.UpdateAvailable {
		t.Fatalf("status = %+v, want updateAvailable=true", status)
	}
	if status.Latest != "v99.0.0" {
		t.Fatalf("latest = %q", status.Latest)
	}
}

func TestFetchGitHubLatestRelease(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/repos/jordibrouwer/nextdash/releases/latest" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"tag_name":     "v2026.08.06",
			"html_url":     "https://github.com/jordibrouwer/nextdash/releases/tag/v2026.08.06",
			"published_at": "2026-08-06T12:00:00Z",
			"draft":        false,
			"prerelease":   false,
		})
	}))
	defer srv.Close()

	oldURL := githubLatestReleaseURL
	githubLatestReleaseURL = srv.URL + "/repos/jordibrouwer/nextdash/releases/latest"
	t.Cleanup(func() { githubLatestReleaseURL = oldURL })

	h := newPushTestHandlers(t, newFakePushService(t), nil)
	info, err := h.fetchGitHubLatestRelease(context.Background())
	if err != nil {
		t.Fatalf("fetchGitHubLatestRelease: %v", err)
	}
	if info.Tag != "v2026.08.06" {
		t.Fatalf("tag = %q", info.Tag)
	}
}

func TestUpdateCheckSettingsSerializeFalseValue(t *testing.T) {
	data, err := json.Marshal(Settings{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	value, ok := decoded["updateCheckEnabled"]
	if !ok {
		t.Fatal("updateCheckEnabled missing from JSON when false")
	}
	if value != false {
		t.Fatalf("updateCheckEnabled = %v, want false", value)
	}
}
