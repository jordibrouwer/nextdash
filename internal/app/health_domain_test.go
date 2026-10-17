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

	if hit := recordDomainResult(stored, "example.com", in(200), nil, now, ladder); hit != nil {
		t.Fatal("200 days out is not a warning")
	}
	hit := recordDomainResult(stored, "example.com", in(55), nil, now, ladder)
	if hit == nil {
		t.Fatal("55 days crosses the 60-day mark")
	}
	if recordDomainResult(stored, "example.com", in(54), nil, now, ladder) != nil {
		t.Error("the same mark must not fire twice")
	}
	if recordDomainResult(stored, "example.com", in(5), nil, now, ladder) == nil {
		t.Error("5 days crosses the 7-day mark")
	}

	// A later date is a renewal: the history clears and the next expiry warns again.
	if recordDomainResult(stored, "example.com", in(365), nil, now, ladder) != nil {
		t.Error("a year out is quiet")
	}
	if len(stored["example.com"].NotifiedDays) != 0 {
		t.Errorf("a renewal clears the history, still %v", stored["example.com"].NotifiedDays)
	}
	if recordDomainResult(stored, "example.com", in(50), nil, now, ladder) == nil {
		t.Error("after a renewal the 60-day mark is new again")
	}
}

func TestRecordDomainResultKeepsDateOnError(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	stored := map[string]HostDomain{}
	expires := now.Add(30 * 24 * time.Hour).UnixMilli()
	recordDomainResult(stored, "example.com", rdapResult{State: domainStateOK, ExpiresAt: expires}, nil, now, []int{60, 7, 3})
	recordDomainResult(stored, "example.com", rdapResult{}, errTestLookup, now.Add(time.Hour), []int{60, 7, 3})
	got := stored["example.com"]
	if got.State != domainStateError || got.ExpiresAt != expires {
		t.Errorf("a failed lookup keeps the known date: %+v", got)
	}
	// A registry that stops publishing the date is not a failure and drops it.
	recordDomainResult(stored, "example.com", rdapResult{State: domainStateHidden}, nil, now.Add(2*time.Hour), []int{60, 7, 3})
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
