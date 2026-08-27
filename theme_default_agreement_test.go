package main

import (
	"os"
	"regexp"
	"testing"
)

/*
The server and the first paint have to name the same default.

theme-loader.js runs synchronously in <head> so the page is painted before any
settings arrive, which means it carries its own idea of the default. It carried
a bare "dark" -- a real theme, but not the one a fresh install is given -- so
the app had two defaults and showed whichever got there first. That is
invisible in the common case, because the server fills the data-theme attribute
in and the loader reads it; it shows up exactly where the stored choice is
missing, which is where a default is the only thing there is.

Asserted against the source rather than against a rendered page on purpose: a
browser test would only catch it on the path it happens to drive.
*/
func TestThemeLoaderAgreesWithTheServerDefault(t *testing.T) {
	source, err := os.ReadFile("static/js/theme-loader.js")
	if err != nil {
		t.Fatal(err)
	}

	declared := regexp.MustCompile(`const DEFAULT_THEME = '([^']+)'`).FindSubmatch(source)
	if declared == nil {
		t.Fatal("theme-loader.js declares no DEFAULT_THEME; the fallback is loose in the file again")
	}
	if got := string(declared[1]); got != defaultThemeID {
		t.Errorf("theme-loader DEFAULT_THEME = %q, server defaultThemeID = %q", got, defaultThemeID)
	}

	// And nothing may quietly reintroduce one beside it.
	for _, pattern := range []string{`\|\| 'dark'`, `return 'dark';`, `= 'dark';`} {
		if regexp.MustCompile(pattern).Match(source) {
			t.Errorf("theme-loader.js still falls back to a bare 'dark' (%s); use DEFAULT_THEME", pattern)
		}
	}
}
