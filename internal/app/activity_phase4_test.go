package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Every Phase 4 knob defaults to exactly what the trail already did: text,
// full URLs, unsampled, no age limit. This pins the container-log line for
// one ordinary mutate event so a change to any default shows up here first.
func TestActivityLogDefaultsMatchTodayByteForByte(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{enabled: map[string]bool{activityCategoryMutate: true}})
	setLogLevelForTest(t, logLevelInfoName)
	buf := captureLog(t)

	logBookmarkAdd(Bookmark{PageID: 1, Name: "X", URL: "https://x.example/path?q=1"}, nil)

	want := "INFO mutate added \"X\" (https://x.example/path?q=1)\n"
	if got := buf.String(); got != want {
		t.Fatalf("default container-log line changed:\n got  %q\n want %q", got, want)
	}
}

func TestActivityLogFormatJSONWritesStructuredLine(t *testing.T) {
	resetActivityLogForTest(activityLogConfig{
		enabled: map[string]bool{activityCategoryMutate: true},
		format:  "json",
	})
	setLogLevelForTest(t, logLevelInfoName)
	buf := captureLog(t)

	logBookmarkAdd(Bookmark{PageID: 1, Name: "X", URL: "https://x.example"}, nil)

	got := buf.String()
	if !strings.Contains(got, `"event":"bookmark.add"`) {
		t.Fatalf("expected the JSON entry on the container log, got %q", got)
	}
	if strings.Contains(got, `added "X"`) {
		t.Fatalf("json format should not also print the sentence, got %q", got)
	}
}

func TestActivityLogURLsHostReducesBookmarkURL(t *testing.T) {
	dir := t.TempDir()
	resetActivityLogForTest(activityLogConfig{
		enabled:  map[string]bool{activityCategoryMutate: true},
		persist:  true,
		filePath: filepath.Join(dir, "activity.log"),
		urls:     "host",
	})

	logBookmarkAdd(Bookmark{PageID: 1, Name: "X", URL: "https://x.example/path?token=secret"}, nil)

	data, err := os.ReadFile(filepath.Join(dir, "activity.log"))
	if err != nil {
		t.Fatalf("read activity log: %v", err)
	}
	line := string(data)
	if !strings.Contains(line, `"url":"https://x.example"`) {
		t.Fatalf("expected host-only url, got %s", line)
	}
	if strings.Contains(line, "token=secret") {
		t.Fatalf("query string leaked through host mode: %s", line)
	}
}

func TestActivityLogURLsOffDropsBookmarkURL(t *testing.T) {
	dir := t.TempDir()
	resetActivityLogForTest(activityLogConfig{
		enabled:  map[string]bool{activityCategoryMutate: true},
		persist:  true,
		filePath: filepath.Join(dir, "activity.log"),
		urls:     "off",
	})

	logBookmarkAdd(Bookmark{PageID: 1, Name: "X", URL: "https://x.example/path"}, nil)

	data, err := os.ReadFile(filepath.Join(dir, "activity.log"))
	if err != nil {
		t.Fatalf("read activity log: %v", err)
	}
	if strings.Contains(string(data), `"url"`) {
		t.Fatalf("expected url dropped entirely, got %s", string(data))
	}
}

func TestActivityUserTextSameSettingAsBookmarkURLs(t *testing.T) {
	t.Cleanup(clearActivityLogTestOverride)

	resetActivityLogForTest(activityLogConfig{urls: "full"})
	if got := activityUserText("widgets and gadgets"); got != "widgets and gadgets" {
		t.Fatalf("full should pass through, got %q", got)
	}

	resetActivityLogForTest(activityLogConfig{urls: "host"})
	if got := activityUserText("https://example.com/search?q=widgets"); got != "https://example.com" {
		t.Fatalf("host should reduce a URL-shaped query, got %q", got)
	}
	if got := activityUserText("widgets and gadgets"); got != "widgets and gadgets" {
		t.Fatalf("host should leave non-URL text alone, got %q", got)
	}

	resetActivityLogForTest(activityLogConfig{urls: "off"})
	if got := activityUserText("widgets and gadgets"); got != "" {
		t.Fatalf("off should drop the text entirely, got %q", got)
	}
}

func TestActivityLogSampleMalformedFallsBackToUnsampledWithWarning(t *testing.T) {
	t.Setenv("NEXTDASH_ACTIVITY_LOG_SAMPLE", "open=not-a-number")
	setLogLevelForTest(t, logLevelInfoName)
	buf := captureLog(t)

	cfg := loadActivityLogConfig()

	if cfg.sampleRates != nil {
		t.Fatalf("expected sampling disabled on a malformed value, got %v", cfg.sampleRates)
	}
	if !strings.Contains(buf.String(), "NEXTDASH_ACTIVITY_LOG_SAMPLE") || !strings.Contains(buf.String(), "open=not-a-number") {
		t.Fatalf("expected a startup line naming the bad value, got %q", buf.String())
	}
}

func TestActivityLogSampleParsesValidChannelRates(t *testing.T) {
	rates, bad := parseActivitySampleRates("open=0.1,keys=0.25")
	if bad != "" {
		t.Fatalf("unexpected bad segment %q", bad)
	}
	if rates["open"] != 0.1 || rates["keys"] != 0.25 {
		t.Fatalf("unexpected rates: %v", rates)
	}
}

func TestActivitySampleAllowsAppliesRate(t *testing.T) {
	t.Cleanup(clearActivityLogTestOverride)
	previous := activitySampleRand
	t.Cleanup(func() { activitySampleRand = previous })

	resetActivityLogForTest(activityLogConfig{sampleRates: map[string]float64{"open": 0.5}})

	activitySampleRand = func() float64 { return 0.4 }
	if !activitySampleAllows("open") {
		t.Fatal("a roll under the rate should log")
	}
	activitySampleRand = func() float64 { return 0.6 }
	if activitySampleAllows("open") {
		t.Fatal("a roll over the rate should not log")
	}
	if !activitySampleAllows("keys") {
		t.Fatal("a channel absent from the map is unsampled")
	}
}

func TestActivityRotatingFilePrunesBackupsOlderThanMaxAge(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "activity.log")
	old := base + ".1"
	recent := base + ".2"
	for _, p := range []string{old, recent} {
		if err := os.WriteFile(p, []byte("x\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().Add(-40 * 24 * time.Hour)
	recentTime := time.Now().Add(-1 * time.Hour)
	if err := os.Chtimes(old, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(recent, recentTime, recentTime); err != nil {
		t.Fatal(err)
	}

	f := &activityRotatingFile{path: base, maxAgeDays: 30}
	if err := f.write([]byte("line\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("expected the 40-day-old backup pruned, stat err = %v", err)
	}
	if _, err := os.Stat(recent); err != nil {
		t.Fatalf("expected the 1-hour-old backup kept: %v", err)
	}
}

func TestActivityRotatingFileMaxAgeZeroPrunesNothing(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "activity.log")
	old := base + ".1"
	if err := os.WriteFile(old, []byte("x\n"), 0644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-400 * 24 * time.Hour)
	if err := os.Chtimes(old, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	f := &activityRotatingFile{path: base}
	if err := f.write([]byte("line\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	if _, err := os.Stat(old); err != nil {
		t.Fatalf("default (off) must not prune anything, stat err = %v", err)
	}
}

// The bug this guards against: a raw bm.URL or query interpolated straight
// into a sentence with fmt.Sprintf bypasses activityUserText entirely, so
// "host" or "off" redacted the JSON field while the sentence — written to
// both the container log and, via logActivity, the persisted file — still
// carried the full address. Checked across both outputs, for both a
// nameless bookmark (bookmarkActivityName's own fallback to the URL) and a
// search whose query happens to look like one.
func TestActivityLogURLsHideFullURLEverywhereForOpenAndSearch(t *testing.T) {
	const secretURL = "https://x.example/private/path?token=secret123"
	const needle = "path?token=secret123"

	for _, level := range []string{"full", "host", "off"} {
		t.Run(level, func(t *testing.T) {
			dir := t.TempDir()
			resetActivityLogForTest(activityLogConfig{
				enabled:  map[string]bool{activityCategoryOpen: true, activityCategorySearch: true},
				persist:  true,
				filePath: filepath.Join(dir, "activity.log"),
				urls:     level,
			})
			setLogLevelForTest(t, logLevelInfoName)
			buf := captureLog(t)

			// No name: bookmarkActivityName falls back to the URL, which is
			// exactly the path a raw interpolation would have skipped.
			logBookmarkOpen(1, 0, Bookmark{PageID: 1, URL: secretURL}, "dashboard", "mouse", "", nil, nil)
			logSearchActivity(secretURL, 3, true, "", nil)

			fileData, err := os.ReadFile(filepath.Join(dir, "activity.log"))
			if err != nil {
				t.Fatalf("read activity log: %v", err)
			}
			combined := buf.String() + string(fileData)

			if level == "full" {
				if !strings.Contains(combined, needle) {
					t.Fatalf("full should keep the query, got %s", combined)
				}
				return
			}
			if strings.Contains(combined, needle) {
				t.Fatalf("%s: full URL path/query leaked into the trail: %s", level, combined)
			}
		})
	}
}
