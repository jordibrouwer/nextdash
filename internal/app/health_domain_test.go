package app

import (
	"testing"
	"time"
)

func TestRegistrableDomain(t *testing.T) {
	cases := []struct {
		host string
		want string
		ok   bool
	}{
		{"nas.example.com", "example.com", true},
		{"WWW.Example.COM.", "example.com", true},
		{"example.co.uk", "example.co.uk", true},
		{"a.b.example.co.uk", "example.co.uk", true},
		{"nextdash.cc", "nextdash.cc", true},
		{"user.github.io", "", false}, // private suffix: a page on someone else's registration
		{"192.168.1.10", "", false},
		{"::1", "", false},
		{"localhost", "", false},
		{"nas.local", "", false},
		{"router.lan", "", false},
		{"printer.home.arpa", "", false},
		{"app.test", "", false},
		{"", "", false},
		{"com", "", false},
	}
	for _, c := range cases {
		got, ok := registrableDomain(c.host)
		if got != c.want || ok != c.ok {
			t.Errorf("registrableDomain(%q) = %q, %v; want %q, %v", c.host, got, ok, c.want, c.ok)
		}
	}
}

// The three answers below were fetched from the live services on 17 October
// 2026 and trimmed to the fields the parser reads.
func TestParseRDAPDomain(t *testing.T) {
	withDate := []byte(`{"ldhName":"NEXTDASH.CC","status":["client transfer prohibited"],"events":[
		{"eventAction":"registration","eventDate":"2026-04-28T12:33:47Z"},
		{"eventAction":"expiration","eventDate":"2027-04-28T12:33:47Z"},
		{"eventAction":"last changed","eventDate":"2026-04-28T12:33:52Z"}]}`)
	got, err := parseRDAPDomain(withDate)
	if err != nil || got.State != domainStateOK {
		t.Fatalf("with a date: %+v, %v", got, err)
	}
	want := time.Date(2027, 4, 28, 12, 33, 47, 0, time.UTC).UnixMilli()
	if got.ExpiresAt != want {
		t.Errorf("ExpiresAt = %d, want %d", got.ExpiresAt, want)
	}
	if len(got.Status) != 1 || got.Status[0] != "client transfer prohibited" {
		t.Errorf("Status = %v", got.Status)
	}

	// .nl answers, and leaves the expiry date out.
	noDate := []byte(`{"ldhName":"jordibrw.nl","status":["active"],"events":[
		{"eventAction":"registration","eventDate":"2025-10-14T11:28:18Z"},
		{"eventAction":"last changed","eventDate":"2026-02-15T19:13:23Z"}]}`)
	got, err = parseRDAPDomain(noDate)
	if err != nil || got.State != domainStateHidden || got.ExpiresAt != 0 {
		t.Errorf("without a date: %+v, %v", got, err)
	}

	if _, err := parseRDAPDomain([]byte(`not json`)); err == nil {
		t.Error("malformed JSON should be an error")
	}
}

func TestParseRDAPBootstrap(t *testing.T) {
	raw := []byte(`{"publication":"2026-09-30T23:00:03Z","services":[
		[["com","net"],["https://rdap.verisign.com/com/v1/"]],
		[["nl"],["http://insecure.example/","https://rdap.sidn.nl"]],
		[["onlyhttp"],["http://insecure.example/"]]]}`)
	servers, err := parseRDAPBootstrap(raw)
	if err != nil {
		t.Fatal(err)
	}
	if servers["com"] != "https://rdap.verisign.com/com/v1/" || servers["net"] != servers["com"] {
		t.Errorf("com/net = %q / %q", servers["com"], servers["net"])
	}
	if servers["nl"] != "https://rdap.sidn.nl/" {
		t.Errorf("nl should pick the https server and end in a slash, got %q", servers["nl"])
	}
	if _, ok := servers["onlyhttp"]; ok {
		t.Error("an extension with only a plain-http server must be left out")
	}
	if servers["de"] != "" {
		t.Error("an extension that is not listed has no server")
	}
	if _, err := parseRDAPBootstrap([]byte(`{"services":[]}`)); err == nil {
		t.Error("an empty list is an error, not a result")
	}
}

func TestRecordDomainResultThresholds(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ladder := []int{60, 7, 3}
	stored := map[string]HostDomain{}
	in := func(days int) rdapResult {
		return rdapResult{State: domainStateOK, ExpiresAt: now.Add(time.Duration(days)*24*time.Hour + time.Hour).UnixMilli()}
	}

	if hit := recordDomainResult(stored, "example.com", in(200), nil, now, ladder, 0); hit != nil {
		t.Fatal("200 days out is not a warning")
	}
	hit := recordDomainResult(stored, "example.com", in(55), nil, now, ladder, 0)
	if hit == nil {
		t.Fatal("55 days crosses the 60-day mark")
	}
	if recordDomainResult(stored, "example.com", in(54), nil, now, ladder, 0) != nil {
		t.Error("the same mark must not fire twice")
	}
	if recordDomainResult(stored, "example.com", in(5), nil, now, ladder, 0) == nil {
		t.Error("5 days crosses the 7-day mark")
	}

	// A later date is a renewal: the history clears and the next expiry warns again.
	if recordDomainResult(stored, "example.com", in(365), nil, now, ladder, 0) != nil {
		t.Error("a year out is quiet")
	}
	if len(stored["example.com"].NotifiedDays) != 0 {
		t.Errorf("a renewal clears the history, still %v", stored["example.com"].NotifiedDays)
	}
	if recordDomainResult(stored, "example.com", in(50), nil, now, ladder, 0) == nil {
		t.Error("after a renewal the 60-day mark is new again")
	}
}

func TestRecordDomainResultKeepsDateOnError(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	stored := map[string]HostDomain{}
	expires := now.Add(30 * 24 * time.Hour).UnixMilli()
	recordDomainResult(stored, "example.com", rdapResult{State: domainStateOK, ExpiresAt: expires}, nil, now, []int{60, 7, 3}, 0)
	recordDomainResult(stored, "example.com", rdapResult{}, errTestLookup, now.Add(time.Hour), []int{60, 7, 3}, 0)
	got := stored["example.com"]
	if got.State != domainStateError || got.ExpiresAt != expires {
		t.Errorf("a failed lookup keeps the known date: %+v", got)
	}
	// A registry that stops publishing the date is not a failure and drops it.
	recordDomainResult(stored, "example.com", rdapResult{State: domainStateHidden}, nil, now.Add(2*time.Hour), []int{60, 7, 3}, 0)
	if got := stored["example.com"]; got.State != domainStateHidden || got.ExpiresAt != 0 {
		t.Errorf("hidden clears the date: %+v", got)
	}
}

type testLookupError struct{}

func (testLookupError) Error() string { return "boom" }

var errTestLookup error = testLookupError{}

func TestDomainDue(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	at := func(ago time.Duration) int64 { return now.Add(-ago).UnixMilli() }
	if !domainDue(HostDomain{}, false, now) {
		t.Error("an unknown domain is always due")
	}
	if domainDue(HostDomain{State: domainStateOK, CheckedAt: at(time.Hour)}, true, now) {
		t.Error("an hour old is not due")
	}
	if !domainDue(HostDomain{State: domainStateOK, CheckedAt: at(25 * time.Hour)}, true, now) {
		t.Error("a day old is due")
	}
	if domainDue(HostDomain{State: domainStateError, CheckedAt: at(time.Hour)}, true, now) {
		t.Error("a failure waits before the retry")
	}
	if !domainDue(HostDomain{State: domainStateError, CheckedAt: at(7 * time.Hour)}, true, now) {
		t.Error("a failure is retried after its wait")
	}
}

func TestDomainThresholdsFor(t *testing.T) {
	cases := map[int][]int{0: {60, 7, 3}, 30: {30, 7, 3}, 3: {8, 7, 3}, 999: {180, 7, 3}}
	for days, want := range cases {
		got := domainThresholdsFor(Settings{DomainWarnDays: days})
		if len(got) != 3 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
			t.Errorf("DomainWarnDays %d: %v, want %v", days, got, want)
		}
	}
}

func TestSummarizeDomains(t *testing.T) {
	stored := map[string]HostDomain{
		"a.com": {State: domainStateOK, ExpiresAt: 1},
		"b.nl":  {State: domainStateHidden},
		"c.io":  {State: domainStateUnsupported},
		"d.org": {State: domainStateError},
	}
	got := summarizeDomains(stored, true)
	if !got.Enabled || got.Watched != 3 || len(got.NoDate) != 2 || got.NoDate[0].Domain != "b.nl" {
		t.Errorf("summary = %+v", got)
	}
	if off := summarizeDomains(stored, false); off.Enabled || off.Watched != 0 || len(off.NoDate) != 0 {
		t.Errorf("off should be empty, got %+v", off)
	}
}

// A failed lookup keeps the known date, and the report and the summary keep
// showing it rather than dropping the domain until the next success.
func TestAFailedLookupKeepsTheDomainInTheReport(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	stored := map[string]HostDomain{}
	expires := now.Add(20 * 24 * time.Hour).UnixMilli()
	recordDomainResult(stored, "example.com", rdapResult{State: domainStateOK, ExpiresAt: expires}, nil, now, []int{60, 7, 3}, 0)
	recordDomainResult(stored, "example.com", rdapResult{}, errTestLookup, now.Add(24*time.Hour), []int{60, 7, 3}, 0)
	if got := datedDomains(stored); got["example.com"].ExpiresAt != expires {
		t.Errorf("the report lost the date after a failed lookup: %+v", got)
	}
	if got := summarizeDomains(stored, true); got.Watched != 1 {
		t.Errorf("the summary stopped watching it: %+v", got)
	}
	// An error with no date ever learned has nothing to show.
	stored["never.org"] = HostDomain{Domain: "never.org", State: domainStateError}
	if _, ok := datedDomains(stored)["never.org"]; ok {
		t.Error("an error without a date is not dated")
	}
}

func TestSanitizeDomainExpiryManual(t *testing.T) {
	got := sanitizeDomainExpiryManual(map[string]string{
		"example.nl":     "2027-03-01",
		"EXAMPLE.DE":     "2027-03-01", // folded to lower case
		"nas.example.nl": "2027-03-01", // a host, not the registered name
		"example.eu":     "01-03-2027", // not a date
		"localhost":      "2027-03-01",
		"example.be":     "2027-02-30", // no such day
		" example.io ":   "2027-03-01",
	})
	want := map[string]string{"example.nl": "2027-03-01", "example.de": "2027-03-01", "example.io": "2027-03-01"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestManualDateFillsWhatTheRegistryLeavesOut(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ladder := []int{60, 7, 3}
	stored := map[string]HostDomain{}
	manual := now.Add(40 * 24 * time.Hour).UnixMilli()

	// .nl: the registry answers and leaves the date out.
	hit := recordDomainResult(stored, "example.nl", rdapResult{State: domainStateHidden}, nil, now, ladder, manual)
	if hit == nil {
		t.Fatal("40 days out crosses the 60-day mark")
	}
	got := stored["example.nl"]
	if !got.Manual || got.ExpiresAt != manual || got.State != domainStateHidden {
		t.Errorf("typed date not laid over a hidden registry: %+v", got)
	}
	if recordDomainResult(stored, "example.nl", rdapResult{State: domainStateHidden}, nil, now.Add(24*time.Hour), ladder, manual) != nil {
		t.Error("the same mark must not fire twice across lookups")
	}
	// A failed lookup keeps the typed date.
	recordDomainResult(stored, "example.nl", rdapResult{}, errTestLookup, now.Add(48*time.Hour), ladder, manual)
	if got := stored["example.nl"]; !got.Manual || got.ExpiresAt != manual {
		t.Errorf("an error drops the typed date: %+v", got)
	}
	// Removing the typed date clears it.
	recordDomainResult(stored, "example.nl", rdapResult{State: domainStateHidden}, nil, now.Add(72*time.Hour), ladder, 0)
	if got := stored["example.nl"]; got.Manual || got.ExpiresAt != 0 || len(got.NotifiedDays) != 0 {
		t.Errorf("removal leaves a date behind: %+v", got)
	}
	// Unsupported extension (.de) takes a typed date as well.
	recordDomainResult(stored, "example.de", rdapResult{State: domainStateUnsupported}, nil, now, ladder, manual)
	if got := stored["example.de"]; !got.Manual || got.State != domainStateUnsupported {
		t.Errorf("unsupported + typed date: %+v", got)
	}
}

func TestRegistryDateBeatsTypedDate(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ladder := []int{60, 7, 3}
	stored := map[string]HostDomain{}
	typed := now.Add(10 * 24 * time.Hour).UnixMilli()
	registry := now.Add(300 * 24 * time.Hour).UnixMilli()

	recordDomainResult(stored, "example.nl", rdapResult{State: domainStateHidden}, nil, now, ladder, typed)
	// The registry starts publishing: its date replaces the typed one, and the
	// warning history of the typed date does not carry over.
	if hit := recordDomainResult(stored, "example.nl", rdapResult{State: domainStateOK, ExpiresAt: registry}, nil, now.Add(time.Hour), ladder, typed); hit != nil {
		t.Error("300 days out is quiet")
	}
	got := stored["example.nl"]
	if got.Manual || got.ExpiresAt != registry || len(got.NotifiedDays) != 0 {
		t.Errorf("registry date must win: %+v", got)
	}
	// And a failed lookup after that keeps the registry's date, not the typed one.
	recordDomainResult(stored, "example.nl", rdapResult{}, errTestLookup, now.Add(2*time.Hour), ladder, typed)
	if got := stored["example.nl"]; got.Manual || got.ExpiresAt != registry {
		t.Errorf("an error must not swap in the typed date: %+v", got)
	}
}

func TestChangingTypedDate(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	ladder := []int{60, 7, 3}
	entry := HostDomain{Domain: "example.nl", State: domainStateHidden}
	first := now.Add(5 * 24 * time.Hour).UnixMilli()
	if applyManualDate(&entry, first, now, ladder) == nil {
		t.Fatal("5 days crosses the 7-day mark")
	}
	if applyManualDate(&entry, first, now, ladder) != nil {
		t.Error("unchanged date must stay quiet")
	}
	if applyManualDate(&entry, first-86400000, now, ladder) != nil {
		t.Error("a date moved earlier (a typo fixed) keeps what was warned")
	}
	// Moved later, into the quiet zone and back to a new mark: a renewal.
	applyManualDate(&entry, now.Add(200*24*time.Hour).UnixMilli(), now, ladder)
	if len(entry.NotifiedDays) != 0 {
		t.Errorf("a later date clears the history, still %v", entry.NotifiedDays)
	}
	// Earlier than the 200-day date, history empty: nothing was sent, so it warns.
	if applyManualDate(&entry, now.Add(50*24*time.Hour).UnixMilli(), now, ladder) == nil {
		t.Error("an earlier date inside the 60-day mark warns when nothing was sent")
	}
}

func TestManualDateIsTheWholeDay(t *testing.T) {
	ms, ok := parseManualDomainDate("2027-03-01")
	if !ok {
		t.Fatal("valid date refused")
	}
	endOfDay := time.Date(2027, 3, 1, 23, 59, 59, 0, time.UTC)
	if when := time.UnixMilli(ms).UTC(); when.Before(endOfDay) || when.After(time.Date(2027, 3, 2, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("typed date must be the end of that day, got %v", when)
	}
	// Noon on the day itself is still a day left, never "expired".
	if days := certDaysLeft(ms, time.Date(2027, 3, 1, 12, 0, 0, 0, time.UTC)); days != 0 {
		t.Errorf("on the day itself: %d", days)
	}
}

func TestOverlayDropsARemovedTypedDate(t *testing.T) {
	stored := map[string]HostDomain{
		"example.nl": {Domain: "example.nl", State: domainStateHidden, Manual: true, ExpiresAt: 1000, NotifiedDays: []int{60}},
	}
	out := overlayManualDomains(stored, nil, map[string]struct{}{"example.nl": {}})
	if e := out["example.nl"]; e.Manual || e.ExpiresAt != 0 {
		t.Errorf("a removed typed date must leave the report at once: %+v", e)
	}
	if !stored["example.nl"].Manual {
		t.Error("overlay must not write into the stored map")
	}
	if _, ok := datedDomains(out)["example.nl"]; ok {
		t.Error("removed date still listed as dated")
	}
}

func TestFailedLookupWithoutDateIsListed(t *testing.T) {
	summary := summarizeDomains(map[string]HostDomain{
		"example.nl":  {Domain: "example.nl", State: domainStateError},
		"example.com": {Domain: "example.com", State: domainStateError, ExpiresAt: 5000},
	}, true)
	if len(summary.Failed) != 1 || summary.Failed[0] != "example.nl" {
		t.Errorf("failed = %v", summary.Failed)
	}
	if len(summary.NoDate) != 0 {
		t.Errorf("a failure is not 'no date': %v", summary.NoDate)
	}
}

func TestOverlayManualDomains(t *testing.T) {
	stored := map[string]HostDomain{
		"example.nl":  {Domain: "example.nl", State: domainStateHidden},
		"example.de":  {Domain: "example.de", State: domainStateUnsupported},
		"example.com": {Domain: "example.com", State: domainStateOK, ExpiresAt: 5000},
	}
	live := map[string]struct{}{"example.nl": {}, "example.com": {}, "example.eu": {}}
	manual := map[string]int64{"example.nl": 1000, "example.de": 1000, "example.com": 1000, "example.eu": 2000}
	out := overlayManualDomains(stored, manual, live)

	if e := out["example.nl"]; !e.Manual || e.ExpiresAt != 1000 {
		t.Errorf("hidden domain: %+v", e)
	}
	if e := out["example.de"]; e.Manual {
		t.Errorf("a domain no checked bookmark points at gets nothing: %+v", e)
	}
	if e := out["example.com"]; e.Manual || e.ExpiresAt != 5000 {
		t.Errorf("registry date must win: %+v", e)
	}
	if e := out["example.eu"]; !e.Manual || e.ExpiresAt != 2000 {
		t.Errorf("a live domain with no entry yet still shows its typed date: %+v", e)
	}
	if stored["example.nl"].Manual {
		t.Error("overlay must not write into the stored map")
	}

	dated := datedDomains(out)
	if _, ok := dated["example.nl"]; !ok {
		t.Error("typed date belongs in the dated list")
	}
	summary := summarizeDomains(out, true)
	for _, n := range summary.NoDate {
		if n.Domain == "example.nl" {
			t.Error("a domain with a typed date is not 'no date'")
		}
	}
}
