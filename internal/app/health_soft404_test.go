package app

import "testing"

// "404" counts on its own, not inside a longer number: an issue tracker's
// #14042 or a DS1404 admin page is a page that is there.
func TestSoftNotFoundTitleMatches404AsANumberOfItsOwn(t *testing.T) {
	for _, title := range []string{"Fix crash · Issue #14042 · acme/app", "Synology DS1404 – Admin", "Build 4040"} {
		if got := softNotFoundReason(title, ""); got != "" {
			t.Errorf("%q read as missing: %q", title, got)
		}
	}
	for _, title := range []string{"404", "404 - Not Here", "Error 404", "Oops (404)"} {
		if softNotFoundReason(title, "") == "" {
			t.Errorf("%q not read as missing", title)
		}
	}
}
