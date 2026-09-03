package app

import (
	"os"
	"testing"
)

/*
TestMain gives the whole Go suite a data directory of its own.

Without this, ResolveDataDir falls back to "data" — the working directory's
own store, which for anyone running the tests from a checkout is their live
install. The suite does not merely read it: constructing a store seeds a fresh
one, so `go test ./...` overwrites bookmarks-N.json, settings.json, pages.json,
colors.json, the inbox, the finders and the icon cache with a default install.
Measured against a temp directory, one run writes all of those plus a stray
font.woff. A library was lost to exactly this.

Individual tests that want their own directory still call t.Setenv, and that
keeps working — this only decides where a test that never thought about it
lands. An externally set NEXTDASH_DATA_DIR is honoured so CI or a debugging
run can still point the suite somewhere deliberate.

t.TempDir is not available here: TestMain has no *testing.T, so the directory
is made and removed by hand.
*/
func TestMain(m *testing.M) {
	os.Setenv("NEXTDASH_DISABLE_PREFETCH", "1")
	/*
	 * The outbound rate limiter is a package-level singleton on one bucket with
	 * a one-minute window, so every test in this binary shares it. A full run
	 * makes far more than the production limit of 120 in that window, and once
	 * it is spent, later tests fail with "outbound rate limit exceeded" rather
	 * than on their own subject -- and which ones fail moves with the order
	 * they happened to run in. Twelve of thirteen failures in a full run were
	 * this, not the tests.
	 *
	 * Set here rather than per test so a test that talks to an httptest server
	 * without going through newTestHandlers is covered too. Tests that mean to
	 * exercise the limiter build their own rather than reading this one.
	 */
	if os.Getenv("NEXTDASH_OUTBOUND_REQUESTS_PER_MIN") == "" {
		os.Setenv("NEXTDASH_OUTBOUND_REQUESTS_PER_MIN", "1000000")
	}
	installTestAssetFS()

	if os.Getenv("NEXTDASH_DATA_DIR") == "" {
		dir, err := os.MkdirTemp("", "nextdash-gotest-")
		if err != nil {
			// Refuse rather than fall back to ./data: the fallback is the
			// failure this exists to prevent.
			panic("could not create a temp data directory for the test suite: " + err.Error())
		}
		os.Setenv("NEXTDASH_DATA_DIR", dir)
		code := m.Run()
		os.RemoveAll(dir)
		os.Exit(code)
	}

	os.Exit(m.Run())
}
