package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestClampHealthAutoRecheckIntervalHours(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{0, defaultHealthAutoRecheckIntervalHours},
		{-5, defaultHealthAutoRecheckIntervalHours},
		{1, 1},
		{24, 24},
		{maxHealthAutoRecheckIntervalHours, maxHealthAutoRecheckIntervalHours},
		{maxHealthAutoRecheckIntervalHours + 100, maxHealthAutoRecheckIntervalHours},
	}
	for _, c := range cases {
		if got := clampHealthAutoRecheckIntervalHours(c.in); got != c.want {
			t.Errorf("clamp(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

// healthRecheckTestHandlers wires a Handlers backed by a temp data dir and points
// the shared cache-file path at it via NEXTDASH_DATA_DIR. Returns the dir so tests
// can seed page files.
func healthRecheckTestHandlers(t *testing.T, settingsJSON string) (*Handlers, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	settingsPath := filepath.Join(dir, "settings.json")
	if err := os.WriteFile(settingsPath, []byte(settingsJSON), 0o644); err != nil {
		t.Fatalf("write settings: %v", err)
	}
	/*
	 * Every path the store may write to, not just the two this helper's own
	 * tests read.
	 *
	 * With pageOrderFile left empty, GetPages -- which anything touching a
	 * bookmark reaches eventually -- called savePageOrder with no filename, and
	 * writeFileAtomic then built its temporary in the *working* directory and
	 * failed to rename it. Harmless-looking: the write is discarded and the
	 * error is only logged. But the working directory during a suite run
	 * belongs to whichever test last called t.Chdir, and a stray `.tmp-...`
	 * file appearing in someone else's t.TempDir made that test fail on
	 * cleanup instead -- "directory not empty", on a test that had done
	 * nothing wrong. That is what took go-test down in CI run #460, on
	 * TestAddInboxItemKeepsTags.
	 */
	return &Handlers{store: &FileStore{
		settingsFile:                settingsPath,
		colorsFile:                  filepath.Join(dir, "colors.json"),
		pageOrderFile:               filepath.Join(dir, "pages.json"),
		customThemesMigrationMarker: filepath.Join(dir, ".custom-themes-reset-v1"),
		dataDir:                     dir,
	}}, dir
}

func TestHealthAutoRecheckDue(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"healthAutoRecheckEnabled":true,"healthAutoRecheckIntervalHours":24}`)

	// No prior run recorded → due.
	if !h.healthAutoRecheckDue() {
		t.Fatalf("expected due when never run")
	}

	// A run just now → not due.
	if err := h.markHealthAutoRecheck(time.Now()); err != nil {
		t.Fatalf("mark: %v", err)
	}
	if h.healthAutoRecheckDue() {
		t.Fatalf("expected not due immediately after a run")
	}

	// A run 25h ago (interval 24h) → due again, and it survives a fresh read.
	if err := h.markHealthAutoRecheck(time.Now().Add(-25 * time.Hour)); err != nil {
		t.Fatalf("mark old: %v", err)
	}
	if !h.healthAutoRecheckDue() {
		t.Fatalf("expected due after interval elapsed")
	}
	if last := lastHealthAutoRecheck(); last <= 0 {
		t.Fatalf("expected persisted last-recheck timestamp, got %d", last)
	}
}

func TestMaybeRunHealthAutoRecheckDisabledIsNoop(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{"healthAutoRecheckEnabled":false}`)
	h.maybeRunHealthAutoRecheck()
	if last := lastHealthAutoRecheck(); last != 0 {
		t.Fatalf("disabled recheck should not run, but stamped %d", last)
	}
}

func TestMaybeRunHealthAutoRecheckPingsAndStamps(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h, dir := healthRecheckTestHandlers(t, `{"allowLocalBookmarks":true,"healthAutoRecheckEnabled":true,"healthAutoRecheckIntervalHours":24}`)
	// One status-checked bookmark on a page in the temp data dir.
	pageJSON := `{"id":1,"name":"Page 1","bookmarks":[{"name":"Local","url":"` + server.URL + `","checkStatus":true}]}`
	if err := os.WriteFile(filepath.Join(dir, "bookmarks-1.json"), []byte(pageJSON), 0o644); err != nil {
		t.Fatalf("write bookmarks: %v", err)
	}

	h.maybeRunHealthAutoRecheck()

	if last := lastHealthAutoRecheck(); last <= 0 {
		t.Fatalf("expected a run to stamp the last-recheck time, got %d", last)
	}
	// The ping result should have been persisted into the health cache.
	cache := readHealthCacheFile()
	if len(cache.Cache) == 0 {
		t.Fatalf("expected the recheck to write a health cache entry")
	}

	// A second immediate call is not due, so it must not re-run (stamp unchanged).
	before := lastHealthAutoRecheck()
	time.Sleep(2 * time.Millisecond)
	h.maybeRunHealthAutoRecheck()
	if after := lastHealthAutoRecheck(); after != before {
		t.Fatalf("expected no re-run within the interval; stamp changed %d → %d", before, after)
	}
}
