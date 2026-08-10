package main

import (
	"net/url"
	"regexp"
	"sort"
	"strings"
)

/*
Redirect drift: a bookmark that quietly stopped pointing where you saved it.

This is rot the reachability check cannot see. A link that now redirects to a
domain root, a shop's front page, or an entirely different host answers 200 and
looks perfectly healthy — but the page you saved is gone, which is the whole
question this view exists to answer.

The check already follows redirects, and http.Response.Request.URL is where it
ended up. So this costs nothing extra: no second request, no new setting, just
comparing where you aimed with where you landed.

The hard part is not detecting a redirect. It is deciding which ones matter.
Sites redirect constantly for reasons nobody wants to hear about — http to https,
adding or dropping www, a trailing slash, a locale prefix, a tracking parameter.
Reporting those would bury the one case that counts under a hundred that do not.
*/

// redirectDriftKind classifies where a check landed relative to where it aimed.
//
// Returns "" when the difference is not worth reporting, which is the common
// case: most redirects are cosmetic.
//
//	"host"    — a different site entirely. The strongest signal.
//	"root"    — same host, but the path collapsed to the front page. Classic
//	            behaviour of a CMS that dropped the article you saved.
//	"path"    — same host, meaningfully different page.
func redirectDriftKind(from, to string) string {
	src, err1 := url.Parse(strings.TrimSpace(from))
	dst, err2 := url.Parse(strings.TrimSpace(to))
	if err1 != nil || err2 != nil || src.Host == "" || dst.Host == "" {
		return ""
	}

	srcHost := registrableHost(src.Hostname())
	dstHost := registrableHost(dst.Hostname())
	if srcHost != dstHost {
		return "host"
	}

	srcPath := normalizeDriftPath(src.EscapedPath())
	dstPath := normalizeDriftPath(dst.EscapedPath())
	if srcPath == dstPath {
		// Same page. Scheme upgrades, www, trailing slashes and query changes
		// all land here, which is exactly where they belong: none of them mean
		// the bookmark stopped working.
		return ""
	}
	// Landing on the front page when you aimed at a page inside the site is the
	// most common shape of a dead link that still answers.
	if dstPath == "" {
		return "root"
	}
	// A locale or region prefix appearing in front of the same path is routing,
	// not rot: /docs/intro becoming /en/docs/intro is the same document.
	if isLocalePrefixOf(srcPath, dstPath) || isLocalePrefixOf(dstPath, srcPath) {
		return ""
	}
	return "path"
}

// registrableHost strips a leading "www.", so example.com and www.example.com
// are one site. Deliberately not a full public-suffix walk: the aim is to stop
// the single most common cosmetic redirect from being reported, not to resolve
// every possible subdomain relationship — docs.example.com and example.com are
// genuinely different places and should be reported as such.
func registrableHost(host string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	return strings.TrimPrefix(host, "www.")
}

// normalizeDriftPath reduces a path to what a reader would call "the same page":
// lowercase, no trailing slash, and "/" treated as empty.
func normalizeDriftPath(path string) string {
	path = strings.ToLower(strings.TrimSpace(path))
	path = strings.TrimSuffix(path, "/")
	if path == "/" {
		return ""
	}
	return path
}

// isLocalePrefixOf reports whether long is short with a short leading segment in
// front — /docs/intro against /en/docs/intro.
//
// The added segment is length-capped rather than matched against a list of
// locales: a real language or region tag is short, and anything longer is a
// different path that happens to share a suffix.
func isLocalePrefixOf(short, long string) bool {
	if short == "" || long == "" || !strings.HasSuffix(long, short) {
		return false
	}
	prefix := strings.TrimSuffix(long, short)
	prefix = strings.Trim(prefix, "/")
	// One segment, and short enough to be a tag like "en" or "en-gb".
	return prefix != "" && !strings.Contains(prefix, "/") && len(prefix) <= 5
}

/*
Title and content drift.

Two more signals the reachability check cannot see, both reading the same body
the keyword check already fetches — so a bookmark that opts into any of these
pays for one body read, not three.

Title drift is the cheap, legible one: "Acme Docs — Getting Started" becoming
"Domain for sale" needs no interpretation. Content drift is the strongest signal
and the fiddliest, because pages change constantly for reasons nobody cares
about — a timestamp in the footer, a rotating quote, a view counter. Comparing
exact bytes would fire on every one of them.
*/

// driftParkedPhrases are what a dead domain usually says once somebody else has
// it. Matched case-insensitively against the title, where these appear almost
// exclusively — a body can mention "domain for sale" while being a perfectly
// good article about domains.
// Short, generic entries ("parked", "coming soon", "this domain") were dropped:
// they are ordinary words that show up in perfectly innocent titles too ("Where
// I Parked My Car", "Coming Soon: Our New Release"), and a word-boundary match
// does not fix that since they are legitimate whole words in both cases. What
// is left is long and specific enough that an unrelated title would not
// plausibly contain it verbatim.
var driftParkedPhrases = []string{
	"domain for sale",
	"buy this domain",
	"domain is for sale",
	"account suspended",
	"site suspended",
	"under construction",
	"page not found",
	"error 404",
	"index of /",
}

// driftParkedPhrasePattern matches driftParkedPhrases as whole words, not
// substrings. Plain strings.Contains false-positived on ordinary titles that
// happen to contain one of these short, generic phrases — "Where I Parked My
// Car" or "Coming Soon: Our New Release" are not a dead domain.
var driftParkedPhrasePattern = func() *regexp.Regexp {
	escaped := make([]string, len(driftParkedPhrases))
	for i, phrase := range driftParkedPhrases {
		escaped[i] = regexp.QuoteMeta(phrase)
	}
	return regexp.MustCompile(`\b(?:` + strings.Join(escaped, "|") + `)\b`)
}()

// titleDriftKind compares a stored title with a freshly read one.
//
//	"parked"  — the new title says the domain is for sale or suspended. The
//	            clearest possible statement that a bookmark is dead.
//	"changed" — meaningfully different text. Weaker: sites retitle pages for
//	            innocent reasons, so this is a prompt to look, not a verdict.
//
// Returns "" when there is nothing to say, including when either title is
// missing — an absent title is unknown, not evidence.
func titleDriftKind(stored, current string) string {
	stored = normalizeDriftText(stored)
	current = normalizeDriftText(current)
	if stored == "" || current == "" || stored == current {
		return ""
	}
	lowerCurrent := strings.ToLower(current)
	lowerStored := strings.ToLower(stored)
	for _, match := range driftParkedPhrasePattern.FindAllString(lowerCurrent, -1) {
		// Only when the stored title did not already say it: a bookmark
		// deliberately saved on a "coming soon" page has not drifted.
		if !driftParkedPhrasePattern.MatchString(lowerStored) || !strings.Contains(lowerStored, match) {
			return "parked"
		}
	}
	// Titles routinely gain or lose a site-name suffix — "Intro" against
	// "Intro | Acme Docs" is the same page. Containment either way is not drift.
	if strings.Contains(lowerCurrent, strings.ToLower(stored)) ||
		strings.Contains(strings.ToLower(stored), lowerCurrent) {
		return ""
	}
	return "changed"
}

// normalizeDriftText collapses whitespace and trims, so formatting changes alone
// never read as drift.
func normalizeDriftText(v string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(v)), " ")
}

var driftWordPattern = regexp.MustCompile(`[a-z0-9]+`)

// contentFingerprint reduces a page body to something stable enough to compare
// across days.
//
// Not a hash of the bytes: that changes when a footer timestamp ticks over, and
// would report drift on every page that shows the time. Instead it keeps the
// most common words, which survive small edits and change wholesale when the
// page becomes something else.
//
// Deliberately lossy and deliberately cheap. This is a smoke alarm, not a diff.
func contentFingerprint(body string) string {
	if strings.TrimSpace(body) == "" {
		return ""
	}
	text := stripDriftMarkup(strings.ToLower(body))
	counts := map[string]int{}
	for _, word := range driftWordPattern.FindAllString(text, -1) {
		// Very short tokens are almost all stop words and digits from dates,
		// which are exactly the parts that churn.
		if len(word) < 4 {
			continue
		}
		counts[word]++
	}
	if len(counts) == 0 {
		return ""
	}

	type wordCount struct {
		word  string
		count int
	}
	words := make([]wordCount, 0, len(counts))
	for word, count := range counts {
		words = append(words, wordCount{word, count})
	}
	sort.Slice(words, func(i, j int) bool {
		if words[i].count != words[j].count {
			return words[i].count > words[j].count
		}
		return words[i].word < words[j].word
	})

	const keep = 24
	if len(words) > keep {
		words = words[:keep]
	}
	// Sorted alphabetically for the stored form, so two fingerprints of the same
	// page compare equal regardless of small shifts in relative frequency.
	out := make([]string, 0, len(words))
	for _, w := range words {
		out = append(out, w.word)
	}
	sort.Strings(out)
	return strings.Join(out, " ")
}

var driftTagPattern = regexp.MustCompile(`(?s)<(script|style)[^>]*>.*?</(script|style)>|<[^>]*>`)

// stripDriftMarkup removes tags and the two elements whose contents are never
// prose, so a page's fingerprint reflects what a reader sees.
func stripDriftMarkup(body string) string {
	return driftTagPattern.ReplaceAllString(body, " ")
}

// contentDriftScore is how much two fingerprints disagree, from 0 (identical) to
// 1 (nothing in common).
func contentDriftScore(stored, current string) float64 {
	a := strings.Fields(stored)
	b := strings.Fields(current)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	inB := make(map[string]struct{}, len(b))
	for _, w := range b {
		inB[w] = struct{}{}
	}
	shared := 0
	for _, w := range a {
		if _, ok := inB[w]; ok {
			shared++
		}
	}
	union := len(inB)
	for _, w := range a {
		if _, ok := inB[w]; !ok {
			union++
		}
	}
	if union == 0 {
		return 0
	}
	return 1 - float64(shared)/float64(union)
}

// contentDriftThreshold is how far a page may move before it is worth
// mentioning.
//
// Set high on purpose. Below this, sites are simply being sites: a new sidebar,
// a changed intro paragraph, a different set of related links. Above it, the
// common vocabulary of the page has been replaced — which is what happens when
// an article becomes a login wall, a parking page, or somebody else's site.
const contentDriftThreshold = 0.75

// contentDrifted reports whether a page has changed beyond recognition.
func contentDrifted(stored, current string) bool {
	if strings.TrimSpace(stored) == "" || strings.TrimSpace(current) == "" {
		return false
	}
	return contentDriftScore(stored, current) >= contentDriftThreshold
}

// driftOutcome is what one check concluded about a page's identity.
type driftOutcome struct {
	// Kind is "" when nothing is worth reporting.
	Kind string
	// Baseline values to store. Set on the first check after watching is
	// switched on, and left empty afterwards so a drifted page does not quietly
	// become its own new baseline — that would report the change once and then
	// call the parking page normal.
	URL         string
	Title       string
	Fingerprint string
	// Reason is the sentence shown on the row.
	Reason string
}

// evaluateDrift compares a check against a bookmark's stored baseline.
//
// The order is deliberate: a redirect to another host makes the title and body
// meaningless as comparisons, so the strongest signal wins and the weaker ones
// are not consulted. Reporting three findings for one dead link would be three
// times the noise for the same fact.
func evaluateDrift(bm Bookmark, result PingResult) driftOutcome {
	if !bm.WatchDrift || result.Status != "online" {
		return driftOutcome{}
	}

	landed := strings.TrimSpace(result.FinalURL)
	title := normalizeDriftText(result.Title)
	fingerprint := strings.TrimSpace(result.Fingerprint)

	// No baseline yet: record what the page is today and say nothing. The first
	// check after switching this on is establishing normal, not judging it.
	if strings.TrimSpace(bm.DriftURL) == "" && strings.TrimSpace(bm.DriftFingerprint) == "" {
		return driftOutcome{
			URL:         firstNonEmpty(landed, bm.URL),
			Title:       title,
			Fingerprint: fingerprint,
		}
	}

	if landed != "" {
		switch redirectDriftKind(firstNonEmpty(bm.DriftURL, bm.URL), landed) {
		case "host":
			return driftOutcome{Kind: "host", Reason: "Now redirects to " + hostOf(landed)}
		case "root":
			return driftOutcome{Kind: "root", Reason: "Now redirects to the site's front page"}
		case "path":
			return driftOutcome{Kind: "path", Reason: "Now redirects to " + landed}
		}
	}

	switch titleDriftKind(bm.DriftTitle, title) {
	case "parked":
		return driftOutcome{Kind: "title-parked", Reason: "Page title now reads " + quoteShort(title)}
	case "changed":
		return driftOutcome{Kind: "title-changed", Reason: "Page title changed to " + quoteShort(title)}
	}

	if contentDrifted(bm.DriftFingerprint, fingerprint) {
		return driftOutcome{Kind: "content", Reason: "The page content has changed beyond recognition"}
	}

	return driftOutcome{}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func hostOf(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return raw
	}
	return u.Host
}

// quoteShort renders a title for a one-line reason, truncated so a long one does
// not push everything else off the row.
func quoteShort(v string) string {
	const limit = 60
	v = normalizeDriftText(v)
	if len([]rune(v)) > limit {
		v = string([]rune(v)[:limit]) + "…"
	}
	return "\"" + v + "\""
}

// applyDriftResult records a check's drift verdict on the bookmark.
//
// Split from evaluateDrift so the decision stays a pure function of its inputs
// and only this half touches state.
func applyDriftResult(bm *Bookmark, result PingResult, at int64) {
	if bm == nil || !bm.WatchDrift {
		return
	}
	outcome := evaluateDrift(*bm, result)

	// Baseline. evaluateDrift only fills these fields on its no-baseline branch
	// — it never recomputes them once bm.DriftURL is set — so this is always the
	// first check after WatchDrift went on, never a drifted page adopting its
	// new self as normal.
	if outcome.Fingerprint != "" {
		bm.DriftURL = outcome.URL
		bm.DriftTitle = outcome.Title
		bm.DriftFingerprint = outcome.Fingerprint
	}

	if outcome.Kind == "" {
		// Recovered: a redirect withdrawn or a page restored clears the finding,
		// the same way a recovered outage clears its error.
		if bm.DriftNoticed != "" && result.Status == "online" {
			bm.DriftNoticed = ""
			bm.DriftSince = 0
			bm.DriftReason = ""
		}
		return
	}

	// Keep the original timestamp while the same finding stands, so "drifted 3
	// weeks ago" does not reset to "just now" on every check.
	if bm.DriftNoticed != outcome.Kind {
		bm.DriftNoticed = outcome.Kind
		bm.DriftSince = at
	}
	bm.DriftReason = outcome.Reason
}

// driftReportFields is what the report shows for a bookmark's drift state.
type driftReportFields struct {
	noticed string
	reason  string
	since   int64
}

// driftFieldsFor limits drift reporting to monitored bookmarks that opted in —
// the same rule expectFieldsFor applies, and for the same reason: an
// unmonitored bookmark's stored drift state is never acted on, so showing it
// would display a setting doing nothing.
func driftFieldsFor(b Bookmark) driftReportFields {
	if !b.Monitor || !b.WatchDrift {
		return driftReportFields{}
	}
	return driftReportFields{noticed: b.DriftNoticed, reason: b.DriftReason, since: b.DriftSince}
}
