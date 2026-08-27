package main

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
