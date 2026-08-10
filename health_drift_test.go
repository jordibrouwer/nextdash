package main

import "testing"

// Sites redirect constantly for reasons nobody wants to hear about. Reporting
// those would bury the one case that counts under a hundred that do not.
func TestRedirectDriftIgnoresCosmeticRedirects(t *testing.T) {
	for _, tc := range []struct{ name, from, to string }{
		{"scheme upgrade", "http://example.com/docs", "https://example.com/docs"},
		{"www added", "https://example.com/docs", "https://www.example.com/docs"},
		{"www dropped", "https://www.example.com/docs", "https://example.com/docs"},
		{"trailing slash", "https://example.com/docs/", "https://example.com/docs"},
		{"case in host", "https://EXAMPLE.com/docs", "https://example.com/docs"},
		{"query changed", "https://example.com/docs?a=1", "https://example.com/docs?utm=x"},
		{"locale prefix added", "https://example.com/docs/intro", "https://example.com/en/docs/intro"},
		{"locale prefix dropped", "https://example.com/en-gb/docs", "https://example.com/docs"},
	} {
		if got := redirectDriftKind(tc.from, tc.to); got != "" {
			t.Errorf("%s: reported %q, want silence", tc.name, got)
		}
	}
}

func TestRedirectDriftReportsRealMoves(t *testing.T) {
	for _, tc := range []struct{ name, from, to, want string }{
		{"different host", "https://example.com/docs", "https://other.com/docs", "host"},
		// A subdomain is a different place, and saying so is the point: the www
		// stripping is about one cosmetic case, not about subdomains generally.
		{"subdomain dropped", "https://docs.example.com/x", "https://example.com/x", "host"},
		{"collapsed to front page", "https://example.com/docs/intro", "https://example.com", "root"},
		{"different page", "https://example.com/docs/intro", "https://example.com/pricing", "path"},
	} {
		if got := redirectDriftKind(tc.from, tc.to); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestTitleDriftSeparatesParkedFromRetitled(t *testing.T) {
	for _, tc := range []struct{ name, stored, current, want string }{
		{"unchanged", "Acme Docs", "Acme Docs", ""},
		{"site name appended", "Intro", "Intro | Acme Docs", ""},
		{"site name removed", "Intro | Acme Docs", "Intro", ""},
		{"whitespace only", "Acme  Docs", "Acme Docs", ""},
		// An absent title is unknown, not evidence — a page that failed to
		// render a title must not read as a dead link.
		{"no current title", "Acme Docs", "", ""},
		{"no stored title", "", "Domain for sale", ""},
		{"parked", "Acme Docs — Intro", "Domain for sale", "parked"},
		{"suspended", "Acme Docs", "Account Suspended", "parked"},
		// Saved on a placeholder page in the first place: not drift.
		{"was already a placeholder", "Coming soon", "Coming soon — Acme", ""},
		{"retitled", "Acme Docs — Intro", "Widget Handbook — Chapter 2", "changed"},
	} {
		if got := titleDriftKind(tc.stored, tc.current); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

// The fingerprint has to survive the churn every page has — a footer date, a
// view counter — while changing wholesale when the page becomes something else.
func TestContentFingerprintSurvivesChurn(t *testing.T) {
	day1 := contentFingerprint(`<html><body><h1>Installing the widget framework</h1>
		<p>The widget framework installs through the package manager. Configure the
		widget registry before installing components.</p>
		<footer>Updated 2026-08-10. Visitors: 4213</footer></body></html>`)
	day2 := contentFingerprint(`<html><body><h1>Installing the widget framework</h1>
		<p>The widget framework installs through the package manager. Configure the
		widget registry before installing components.</p>
		<aside>Related: widget plugins</aside>
		<footer>Updated 2027-01-22. Visitors: 58712</footer></body></html>`)
	if contentDrifted(day1, day2) {
		t.Errorf("the same page a day later drifted (score %.2f)", contentDriftScore(day1, day2))
	}

	parked := contentFingerprint(`<html><body><h1>example.com is available</h1>
		<p>Buy this premium domain today. Contact our brokerage team about
		acquiring this domain name.</p></body></html>`)
	if !contentDrifted(day1, parked) {
		t.Errorf("an article becoming a parking page did not drift (score %.2f)",
			contentDriftScore(day1, parked))
	}

	// An empty side is unknown, never drift: a body that failed to read must not
	// mark a healthy bookmark as rotten.
	if contentDrifted("", parked) || contentDrifted(day1, "") {
		t.Error("a missing fingerprint should read as unknown, not as drift")
	}
}

// The first check after switching this on establishes normal rather than judging
// it, and a drifted page must never become its own new baseline — that would
// report the finding once and then call the parking page normal.
func TestDriftBaselineIsEstablishedOnceAndNotOverwritten(t *testing.T) {
	bm := Bookmark{URL: "https://example.com/docs", Monitor: true, WatchDrift: true}
	good := PingResult{
		Status: "online", FinalURL: "https://example.com/docs",
		Title: "Acme Docs", Fingerprint: "acme components docs framework install widget",
	}

	applyDriftResult(&bm, good, 1000)
	if bm.DriftNoticed != "" {
		t.Fatalf("first check reported %q; it should only record the baseline", bm.DriftNoticed)
	}
	if bm.DriftFingerprint == "" || bm.DriftTitle != "Acme Docs" {
		t.Fatal("first check did not record a baseline")
	}

	parked := PingResult{
		Status: "online", FinalURL: "https://example.com/docs",
		Title: "Domain for sale", Fingerprint: "acquire brokerage buy domain premium sale",
	}
	applyDriftResult(&bm, parked, 2000)
	if bm.DriftNoticed != "title-parked" {
		t.Fatalf("parked page reported %q, want title-parked", bm.DriftNoticed)
	}
	if bm.DriftTitle != "Acme Docs" {
		t.Errorf("baseline title became %q — a drifted page must not overwrite it", bm.DriftTitle)
	}

	// The finding stands, so its timestamp must not creep forward on each check.
	applyDriftResult(&bm, parked, 3000)
	if bm.DriftSince != 2000 {
		t.Errorf("DriftSince moved to %d; it should stay at when the drift was first seen", bm.DriftSince)
	}

	// Restored pages clear the finding, like a recovered outage clears its error.
	applyDriftResult(&bm, good, 4000)
	if bm.DriftNoticed != "" || bm.DriftReason != "" {
		t.Errorf("a restored page kept %q / %q", bm.DriftNoticed, bm.DriftReason)
	}
}

// A redirect to another host makes the title and body meaningless as
// comparisons, so the strongest signal wins rather than reporting three
// findings for one dead link.
func TestDriftReportsOneFindingPerCheck(t *testing.T) {
	bm := Bookmark{
		URL: "https://example.com/a", WatchDrift: true,
		DriftURL: "https://example.com/a", DriftTitle: "A", DriftFingerprint: "alpha beta gamma delta",
	}
	applyDriftResult(&bm, PingResult{
		Status: "online", FinalURL: "https://other.example/a",
		Title: "Totally different", Fingerprint: "whiskey xray yankee zulu",
	}, 1000)
	if bm.DriftNoticed != "host" {
		t.Errorf("got %q, want host — the strongest signal should win", bm.DriftNoticed)
	}
}

func TestDriftIsInertWhenNotWatched(t *testing.T) {
	bm := Bookmark{URL: "https://example.com/a", Monitor: true}
	applyDriftResult(&bm, PingResult{
		Status: "online", FinalURL: "https://other.example/a", Title: "Domain for sale",
	}, 1000)
	if bm.DriftNoticed != "" || bm.DriftFingerprint != "" || bm.DriftURL != "" {
		t.Error("a bookmark that never opted in should record nothing")
	}
}
