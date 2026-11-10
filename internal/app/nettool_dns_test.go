package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// A DNS server on a local UDP port that answers from a table, so the
// resolver code runs for real without a network. Names are "host/TYPE".
type fakeDNS struct {
	answers map[string][]dnsmessage.Resource
}

func dnsName(s string) dnsmessage.Name { return dnsmessage.MustNewName(s) }

func aRec(name, ip string) dnsmessage.Resource {
	ipv4 := net.ParseIP(ip).To4()
	var a [4]byte
	copy(a[:], ipv4)
	return dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: dnsName(name), Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.AResource{A: a}}
}

func mxRec(name string, pref uint16, host string) dnsmessage.Resource {
	return dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: dnsName(name), Type: dnsmessage.TypeMX, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.MXResource{Pref: pref, MX: dnsName(host)}}
}

// txtRec is one TXT record; a text over 255 bytes goes in as several strings,
// which the resolver joins, as a real long TXT record is.
func txtRec(name, text string) dnsmessage.Resource {
	var parts []string
	for len(text) > 200 {
		parts = append(parts, text[:200])
		text = text[200:]
	}
	parts = append(parts, text)
	return dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: dnsName(name), Type: dnsmessage.TypeTXT, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.TXTResource{TXT: parts}}
}

func nsRec(name, host string) dnsmessage.Resource {
	return dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: dnsName(name), Type: dnsmessage.TypeNS, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.NSResource{NS: dnsName(host)}}
}

func cnameRec(name, target string) dnsmessage.Resource {
	return dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: dnsName(name), Type: dnsmessage.TypeCNAME, Class: dnsmessage.ClassINET, TTL: 60}, Body: &dnsmessage.CNAMEResource{CNAME: dnsName(target)}}
}

func (f *fakeDNS) serve(t *testing.T) *net.Resolver {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pc.Close() })
	go func() {
		buf := make([]byte, 1500)
		for {
			n, from, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			var req dnsmessage.Message
			if req.Unpack(buf[:n]) != nil || len(req.Questions) != 1 {
				continue
			}
			q := req.Questions[0]
			resp := dnsmessage.Message{
				Header:    dnsmessage.Header{ID: req.ID, Response: true, Authoritative: true, RecursionAvailable: true},
				Questions: req.Questions,
			}
			for _, rr := range f.answers[strings.ToLower(q.Name.String())] {
				// A CNAME answers a question of any address type.
				if rr.Header.Type == q.Type || (rr.Header.Type == dnsmessage.TypeCNAME) {
					resp.Answers = append(resp.Answers, rr)
				}
			}
			if len(resp.Answers) == 0 && len(f.answers[strings.ToLower(q.Name.String())]) == 0 {
				resp.RCode = dnsmessage.RCodeNameError
			}
			out, err := resp.Pack()
			if err == nil {
				_, _ = pc.WriteTo(out, from)
			}
		}
	}()
	return &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "udp", pc.LocalAddr().String())
	}}
}

func dnsTestTarget(host string) netTarget { return netTarget{Host: host} }

func runFakeDNS(t *testing.T, f *fakeDNS, g netGuard, host string, c NetCheck) NetResult {
	t.Helper()
	h, _ := patchTestHandlers(t)
	g.resolver = f.serve(t)
	c.Type = netTypeDNS
	return h.runDNS(context.Background(), g, dnsTestTarget(host), c)
}

func TestNetDNSRecords(t *testing.T) {
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{
		"mail.test.": {mxRec("mail.test.", 20, "mx2.mail.test."), mxRec("mail.test.", 10, "mx1.mail.test.")},
		"web.test.":  {aRec("web.test.", "93.184.216.34")},
		"txt.test.":  {txtRec("txt.test.", "v=spf1 -all")},
		"ns.test.":   {nsRec("ns.test.", "ns1.test.")},
		"www.test.":  {cnameRec("www.test.", "web.test.")},
	}}
	cases := []struct {
		host, record, wantFirst string
		wantPrio, wantN         int
	}{
		{"mail.test", "MX", "mx2.mail.test.", 20, 2},
		{"web.test", "A", "93.184.216.34", 0, 1},
		{"txt.test", "TXT", "v=spf1 -all", 0, 1},
		{"ns.test", "NS", "ns1.test.", 0, 1},
		{"www.test", "CNAME", "web.test.", 0, 1},
	}
	for _, tc := range cases {
		res := runFakeDNS(t, f, netGuard{allowLocal: true}, tc.host, NetCheck{Record: tc.record})
		if !res.OK || res.DNS == nil || len(res.DNS.Records) != tc.wantN {
			t.Fatalf("%s %s: %+v", tc.host, tc.record, res)
		}
		if tc.record != "MX" && res.DNS.Records[0].Value != tc.wantFirst {
			t.Fatalf("%s %s: first = %+v", tc.host, tc.record, res.DNS.Records[0])
		}
		if tc.record == "MX" {
			got := map[string]int{}
			for _, r := range res.DNS.Records {
				got[r.Value] = r.Prio
			}
			if got["mx1.mail.test."] != 10 || got["mx2.mail.test."] != 20 {
				t.Fatalf("MX priorities: %+v", res.DNS.Records)
			}
		}
		if res.DNS.Resolver != "system" || res.Detail == "" {
			t.Fatalf("%s %s: resolver/detail: %+v", tc.host, tc.record, res)
		}
	}
}

func TestNetDNSExpectMatch(t *testing.T) {
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{
		"mail.test.": {mxRec("mail.test.", 10, "mx1.mail.test.")},
		"txt.test.":  {txtRec("txt.test.", "v=spf1 include:_spf.example.net -all")},
	}}
	g := netGuard{allowLocal: true}
	if res := runFakeDNS(t, f, g, "mail.test", NetCheck{Record: "MX", Expect: "MX1.mail.test"}); !res.OK {
		t.Fatalf("expected value (case and trailing dot ignored): %+v", res)
	}
	res := runFakeDNS(t, f, g, "mail.test", NetCheck{Record: "MX", Expect: "other.test"})
	if res.OK || res.Class != "content" || len(res.DNS.Records) != 1 {
		t.Fatalf("a different value must fail with class content and still show the records: %+v", res)
	}
	if res := runFakeDNS(t, f, g, "txt.test", NetCheck{Record: "TXT", Expect: "include:_spf.example.net"}); !res.OK {
		t.Fatalf("a TXT record may contain the expected text: %+v", res)
	}
}

func TestNetDNSNXDomain(t *testing.T) {
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{}}
	res := runFakeDNS(t, f, netGuard{allowLocal: true}, "nope.test", NetCheck{Record: "A"})
	if res.OK || res.Class != "dns" || !strings.Contains(res.Error, "No A records") {
		t.Fatalf("NXDOMAIN: %+v", res)
	}
	// The name exists but has no record of the asked type.
	f2 := &fakeDNS{answers: map[string][]dnsmessage.Resource{"web.test.": {aRec("web.test.", "93.184.216.34")}}}
	res = runFakeDNS(t, f2, netGuard{allowLocal: true}, "web.test", NetCheck{Record: "MX"})
	if res.OK || res.Class != "dns" {
		t.Fatalf("no MX records: %+v", res)
	}
	// An IP address is not a name to look up.
	res = runFakeDNS(t, f, netGuard{allowLocal: true}, "93.184.216.34", NetCheck{Record: "A"})
	if res.OK || res.Class != "other" {
		t.Fatalf("an IP literal: %+v", res)
	}
}

func TestNetDNSOutputLimits(t *testing.T) {
	// Many records (an answer has to fit one UDP packet, so they are short).
	var many []dnsmessage.Resource
	for i := 0; i < 36; i++ {
		many = append(many, txtRec("many.test.", "r"+string(rune('a'+i%26))+string(rune('a'+i/26))))
	}
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{
		"many.test.": many,
		"long.test.": {txtRec("long.test.", strings.Repeat("y", 600))},
	}}
	res := runFakeDNS(t, f, netGuard{allowLocal: true}, "many.test", NetCheck{Record: "TXT"})
	if !res.OK || len(res.DNS.Records) != netDNSMaxRecords {
		t.Fatalf("want exactly %d of 36 records, got %d: %+v", netDNSMaxRecords, len(res.DNS.Records), res)
	}
	res = runFakeDNS(t, f, netGuard{allowLocal: true}, "long.test", NetCheck{Record: "TXT"})
	if !res.OK || len(res.DNS.Records) != 1 {
		t.Fatalf("%+v", res)
	}
	v := res.DNS.Records[0].Value
	if n := len([]rune(v)); n != netDNSMaxTXT+1 || !strings.HasSuffix(v, "…") { // +1: the ellipsis
		t.Fatalf("a 600-character TXT value must be cut to %d characters, got %d", netDNSMaxTXT, len([]rune(v)))
	}
	if len([]rune(res.sample(false).D)) > netDetailMax {
		t.Fatal("the sample detail is longer than the limit")
	}
}

// A name that resolves to a private address while local bookmarks are off is
// a guard result, not a success; with them on it is fine.
func TestNetDNSPrivateAnswerNeedsAllowLocal(t *testing.T) {
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{"lan.test.": {aRec("lan.test.", "192.168.1.20")}}}
	res := runFakeDNS(t, f, netGuard{allowLocal: false}, "lan.test", NetCheck{Record: "A"})
	if res.OK || res.Class != "guard" {
		t.Fatalf("private answer with local off: %+v", res)
	}
	if res := runFakeDNS(t, f, netGuard{allowLocal: true}, "lan.test", NetCheck{Record: "A"}); !res.OK {
		t.Fatalf("private answer with local on: %+v", res)
	}
}

func TestNetDNSDemoRefused(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	f := &fakeDNS{answers: map[string][]dnsmessage.Resource{"web.test.": {aRec("web.test.", "93.184.216.34")}}}
	res := runFakeDNS(t, f, netGuard{allowLocal: false}, "web.test", NetCheck{Record: "A"})
	if res.OK || res.Class != "demo" {
		t.Fatalf("the demo must not look anything up: %+v", res)
	}
}

func TestNetDNSFingerprintSetSemantics(t *testing.T) {
	a := dnsValueSet("A", []DNSRecord{{Value: "1.1.1.1", TTL: 10}, {Value: "2.2.2.2"}})
	b := dnsValueSet("A", []DNSRecord{{Value: "2.2.2.2", TTL: 999}, {Value: "1.1.1.1"}, {Value: "1.1.1.1"}})
	if dnsFingerprint("A", a) != dnsFingerprint("A", b) {
		t.Fatalf("order, duplicates and TTL must not matter: %v vs %v", a, b)
	}
	c := dnsValueSet("A", []DNSRecord{{Value: "1.1.1.1"}, {Value: "3.3.3.3"}})
	if dnsFingerprint("A", a) == dnsFingerprint("A", c) {
		t.Fatal("a different set must give a different fingerprint")
	}
	if dnsFingerprint("A", a) == dnsFingerprint("AAAA", a) {
		t.Fatal("the record type is part of the fingerprint")
	}
	if len(dnsFingerprint("A", a)) != 16 {
		t.Fatalf("fingerprint %q is not 16 hex", dnsFingerprint("A", a))
	}
	mx := dnsValueSet("MX", []DNSRecord{{Value: "Mail.Example.org.", Prio: 10}})
	if mx[0] != "10 mail.example.org" {
		t.Fatalf("MX value = %q", mx[0])
	}
	if d := dnsDiff("MX", []string{"10 mail.example.org"}, []string{"10 mail.example.org", "20 mail2.example.org"}); d != "MX +20 mail2.example.org" {
		t.Fatalf("diff = %q", d)
	}
	if d := dnsDiff("MX", []string{"10 a", "20 b"}, []string{"10 a", "30 c"}); d != "MX +30 c −20 b" {
		t.Fatalf("diff = %q", d)
	}
}

func dnsResultOf(record string, at int64, vals ...string) NetResult {
	res := NetResult{Type: netTypeDNS, OK: true, At: at, DNS: &DNSResult{Record: record}}
	for _, v := range vals {
		res.DNS.Records = append(res.DNS.Records, DNSRecord{Value: v})
	}
	return res
}

func TestNetDNSDriftFirstSetsBaseline(t *testing.T) {
	c := NetCheck{Type: netTypeDNS, Record: "NS", WatchDrift: true}
	d := dnsDriftApply(c, dnsResultOf("NS", 1, "ns1.test", "ns2.test"))
	if d.check.Baseline == "" || !d.touched || d.changed || d.newDrift || d.check.DriftDiff != "" || d.check.DriftSet != "" {
		t.Fatalf("the first answer must become the baseline without a drift: %+v", d)
	}
	// The same set again changes nothing and writes nothing.
	d2 := dnsDriftApply(d.check, dnsResultOf("NS", 2, "ns2.test", "ns1.test"))
	if d2.touched || d2.changed {
		t.Fatalf("the same set in another order: %+v", d2)
	}
}

func TestNetDNSDriftChangeKeepsUp(t *testing.T) {
	c := NetCheck{Type: netTypeDNS, Record: "NS", WatchDrift: true}
	base := dnsDriftApply(c, dnsResultOf("NS", 1, "ns1.test")).check
	res := dnsResultOf("NS", 5, "ns1.test", "ns3.test")
	d := dnsDriftApply(base, res)
	if !d.changed || !d.newDrift || d.check.DriftDiff != "NS +ns3.test" || d.check.DriftAt != 5 || d.check.DriftSet == "" {
		t.Fatalf("a changed set must be recorded as drift: %+v", d)
	}
	if d.check.Baseline != base.Baseline {
		t.Fatal("the baseline moves only when it is accepted")
	}
	// The verdict does not touch the result's own up/down.
	if !res.OK {
		t.Fatal("drift must not make the result fail")
	}
	// Seen again: still changed, but not a new drift, nothing to write.
	d2 := dnsDriftApply(d.check, dnsResultOf("NS", 9, "ns3.test", "ns1.test"))
	if !d2.changed || d2.newDrift || d2.touched {
		t.Fatalf("the same drift twice: %+v", d2)
	}
	// The records go back: the drift clears.
	d3 := dnsDriftApply(d.check, dnsResultOf("NS", 10, "ns1.test"))
	if d3.changed || !d3.touched || d3.check.DriftSet != "" || d3.check.DriftDiff != "" {
		t.Fatalf("records back to the baseline: %+v", d3)
	}
	// A failed lookup says nothing about the records.
	failed := NetResult{Type: netTypeDNS, Class: "dns", At: 11, DNS: &DNSResult{Record: "NS"}}
	if d4 := dnsDriftApply(d.check, failed); d4.touched || d4.changed {
		t.Fatalf("a failed lookup: %+v", d4)
	}
}

func TestNetDNSDriftDefaultOffForA(t *testing.T) {
	// The check is only watched when it asks for it: an A record that rotates
	// does not write a baseline or a drift.
	c := NetCheck{Type: netTypeDNS, Record: "A"}
	if d := dnsDriftApply(c, dnsResultOf("A", 1, "1.1.1.1")); d.touched || d.check.Baseline != "" {
		t.Fatalf("an unwatched check: %+v", d)
	}
	// The server keeps no baseline for a check that stops watching, and starts
	// over for another record type.
	prev := []NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeDNS, Record: "MX", WatchDrift: true, Baseline: "x\ny", DriftSet: "z", DriftDiff: "d", DriftAt: 1}}
	s := netTestSettings()
	out, err := normalizeNetChecks([]NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeDNS, Record: "mx", WatchDrift: true, Baseline: "client", DriftDiff: "client"}}, prev, Bookmark{URL: "https://a.example"}, s, map[string]bool{}, 0)
	if err != nil || out[0].Baseline != "x\ny" || out[0].DriftDiff != "d" || out[0].Record != "MX" {
		t.Fatalf("a PUT keeps the server's drift fields and ignores the client's: %+v %v", out, err)
	}
	out, _ = normalizeNetChecks([]NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeDNS, Record: "TXT", WatchDrift: true}}, prev, Bookmark{URL: "https://a.example"}, s, map[string]bool{}, 0)
	if out[0].Baseline != "" || out[0].DriftDiff != "" {
		t.Fatalf("another record type starts over: %+v", out[0])
	}
	out, _ = normalizeNetChecks([]NetCheck{{ID: "aaaaaaaaaaaa", Type: netTypeDNS, Record: "MX", WatchDrift: false}}, prev, Bookmark{URL: "https://a.example"}, s, map[string]bool{}, 0)
	if out[0].Baseline != "" || out[0].DriftSet != "" {
		t.Fatalf("a check that stops watching drops its baseline: %+v", out[0])
	}
	if _, err := normalizeNetChecks([]NetCheck{{Type: netTypeDNS, Record: "SRV"}}, nil, Bookmark{}, s, map[string]bool{}, 0); err == nil {
		t.Fatal("an unknown record type must be refused")
	}
	if _, err := normalizeNetChecks([]NetCheck{{Type: netTypeDNS}}, nil, Bookmark{}, s, map[string]bool{}, 0); err == nil {
		t.Fatal("a DNS check needs a record type")
	}
}

// The monitor round writes the baseline and then the drift to the stored
// check, keeps the check up, and puts the diff on the sample.
func TestNetDNSMonitorRoundWritesDrift(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	id := netTestCheckID(7)
	netTestPage(t, dir, `{"name":"M","url":"https://m.example","checks":[{"id":"`+id+`","type":"dns","record":"MX","enabled":true,"watchDrift":true}]}`)
	answer := []string{"10 mail.example.org"}
	h.netRunner = func(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
		vals := answer
		res := NetResult{Type: c.Type, CheckID: c.ID, At: time.Now().Add(-2 * time.Hour).UnixMilli(), OK: true, Ms: 3, DNS: &DNSResult{Record: "MX"}}
		for _, v := range vals {
			parts := strings.SplitN(v, " ", 2)
			prio, _ := strconv.Atoi(parts[0])
			res.DNS.Records = append(res.DNS.Records, DNSRecord{Value: parts[1], Prio: prio})
		}
		res.Detail = "MX " + v0(vals)
		return res
	}
	h.runDueMonitors()
	stored := func() NetCheck { return h.store.GetBookmarksByPage(1)[0].Checks[0] }
	if stored().Baseline == "" || stored().DriftDiff != "" {
		t.Fatalf("round 1 should set the baseline only: %+v", stored())
	}
	// Make the check due again, then change the records.
	answer = []string{"10 mail.example.org", "20 mail2.example.org"}
	h.runDueMonitors()
	chk := stored()
	if chk.DriftDiff != "MX +20 mail2.example.org" || chk.DriftSet == "" || chk.DriftAt == 0 {
		t.Fatalf("round 2 should record the drift: %+v", chk)
	}
	samples := h.healthHistoryFor(netHistoryKey(id))
	last := samples[len(samples)-1]
	if !last.Up || last.D != "MX +20 mail2.example.org" {
		t.Fatalf("the check stays up and the sample says what changed: %+v", last)
	}
}

func v0(vals []string) string { return vals[0] }

func TestNetAcceptBaseline(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	idA, idB := netTestCheckID(1), netTestCheckID(2)
	row := func(name, id string) string {
		return `{"name":"` + name + `","url":"https://` + name + `.example","checks":[{"id":"` + id + `","type":"dns","record":"MX","watchDrift":true,"baseline":"old\n10 a","driftSet":"new\n10 b","driftDiff":"MX +10 b","driftAt":5}]}`
	}
	netTestPage(t, dir, row("a", idA), row("b", idB))
	post := func(body string) (*httptest.ResponseRecorder, map[string]any) {
		rec := httptest.NewRecorder()
		h.AcceptNetBaseline(rec, httptest.NewRequest(http.MethodPost, "/api/net/accept-baseline", strings.NewReader(body)))
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec, out
	}
	if rec, _ := post(`{}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("an empty body = %d", rec.Code)
	}
	if rec, _ := post(`{"checkId":"ffffffffffff"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("an unknown check = %d", rec.Code)
	}
	rec, out := post(`{"checkId":"` + idA + `"}`)
	if rec.Code != http.StatusOK || out["accepted"] != float64(1) {
		t.Fatalf("accept one: %d %v", rec.Code, out)
	}
	list := h.store.GetBookmarksByPage(1)
	a, b := list[0].Checks[0], list[1].Checks[0]
	if a.Baseline != "new\n10 b" || a.DriftSet != "" || a.DriftDiff != "" || a.DriftAt != 0 {
		t.Fatalf("accepted check: %+v", a)
	}
	if b.Baseline != "old\n10 a" || b.DriftDiff == "" {
		t.Fatalf("the other check must be left alone: %+v", b)
	}
	if rec, out = post(`{"all":true}`); rec.Code != http.StatusOK || out["accepted"] != float64(1) {
		t.Fatalf("accept all: %d %v", rec.Code, out)
	}
	if h.store.GetBookmarksByPage(1)[1].Checks[0].DriftSet != "" {
		t.Fatal("accept all left a drift behind")
	}
}

func TestNetDNSOneOffRecord(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	var seen NetCheck
	h.netRunner = func(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
		seen = c
		return NetResult{Type: c.Type, OK: true}
	}
	if _, status, err := h.runNetTestForRecord(context.Background(), "c", 1, "https://a.example", "dns", "", "mx"); err != nil || status != http.StatusOK || seen.Record != "MX" {
		t.Fatalf("one-off DNS: %v %d %+v", err, status, seen)
	}
	if _, _, err := h.runNetTestForRecord(context.Background(), "c", 1, "https://a.example", "dns", "", ""); err != nil || seen.Record != "A" {
		t.Fatalf("the default record is A: %v %+v", err, seen)
	}
	if _, status, _ := h.runNetTestForRecord(context.Background(), "c", 1, "https://a.example", "dns", "", "SRV"); status != http.StatusBadRequest {
		t.Fatalf("an unknown record = %d", status)
	}
}
