package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/miekg/dns"
	"golang.org/x/net/dns/dnsmessage"
)

// Fase 2b: a fake DNS server made with miekg/dns on 127.0.0.1 (UDP and TCP on
// one port), reached through the guard's dnsServers seam. No external network.
type miekgDNS struct {
	answers map[string][]dns.RR // "host./TYPE" -> records
	ad      bool                // set the AD flag on the answer
	bigUDP  bool                // answer over UDP is cut off (TC), TCP is complete
	rcode   int
	queries atomic.Int32
	addr    string
}

func (f *miekgDNS) serve(t *testing.T) func(string) []string {
	t.Helper()
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f.addr = pc.LocalAddr().String()
	ln, err := net.Listen("tcp", f.addr)
	if err != nil {
		t.Fatal(err)
	}
	handler := dns.HandlerFunc(func(w dns.ResponseWriter, req *dns.Msg) {
		f.queries.Add(1)
		m := new(dns.Msg)
		m.SetReply(req)
		m.Rcode = f.rcode
		m.AuthenticatedData = f.ad
		q := req.Question[0]
		_, isUDP := w.RemoteAddr().(*net.UDPAddr)
		if f.bigUDP && isUDP {
			m.Truncated = true
		} else {
			m.Answer = append(m.Answer, f.answers[strings.ToLower(q.Name)+"/"+dns.TypeToString[q.Qtype]]...)
		}
		_ = w.WriteMsg(m)
	})
	udp := &dns.Server{PacketConn: pc, Handler: handler}
	tcp := &dns.Server{Listener: ln, Handler: handler}
	go udp.ActivateAndServe()
	go tcp.ActivateAndServe()
	t.Cleanup(func() { _ = udp.Shutdown(); _ = tcp.Shutdown() })
	return func(string) []string { return []string{f.addr} }
}

func mustRR(t *testing.T, s string) dns.RR {
	t.Helper()
	rr, err := dns.NewRR(s)
	if err != nil {
		t.Fatal(err)
	}
	return rr
}

func runMiekgDNS(t *testing.T, f *miekgDNS, g netGuard, host string, c NetCheck) NetResult {
	t.Helper()
	h, _ := patchTestHandlers(t)
	g.dnsServers = f.serve(t)
	c.Type = netTypeDNS
	return h.runDNS(context.Background(), g, dnsTestTarget(host), c)
}

func TestNetDNSFixedResolverOnly(t *testing.T) {
	// Validation: the system resolver and the two fixed ones, nothing else.
	s := netTestSettings()
	for _, ok := range []string{"", "1.1.1.1", "8.8.8.8"} {
		out, err := normalizeNetChecks([]NetCheck{{Type: netTypeDNS, Record: "A", Resolver: ok}}, nil, Bookmark{URL: "https://a.example"}, s, map[string]bool{}, 0)
		if err != nil || out[0].Resolver != ok {
			t.Fatalf("resolver %q: %+v %v", ok, out, err)
		}
	}
	for _, bad := range []string{"9.9.9.9", "127.0.0.1", "192.168.1.1", "1.1.1.1:5353", "dns.google", "8.8.4.4"} {
		if _, err := normalizeNetChecks([]NetCheck{{Type: netTypeDNS, Record: "A", Resolver: bad}}, nil, Bookmark{URL: "https://a.example"}, s, map[string]bool{}, 0); err == nil {
			t.Fatalf("resolver %q was accepted", bad)
		}
	}

	// A one-off test: 400 before anything runs.
	h, dir := healthRecheckTestHandlers(t, `{}`)
	netTestPage(t, dir, `{"name":"A","url":"https://a.example"}`)
	ran := 0
	h.netRunner = func(ctx context.Context, bm Bookmark, c NetCheck) NetResult {
		ran++
		return NetResult{Type: c.Type, OK: true}
	}
	one := func(resolver string) int {
		_, status, _ := h.runNetTestForSpec(context.Background(), "c", 1, "https://a.example", "dns", "", "A", netOneOffJSON{Resolver: resolver})
		return status
	}
	if one("9.9.9.9") != http.StatusBadRequest || ran != 0 {
		t.Fatalf("a free resolver must be refused before the run (ran=%d)", ran)
	}
	if one("8.8.8.8") != http.StatusOK || ran != 1 {
		t.Fatal("8.8.8.8 must be accepted")
	}

	// The lookup itself refuses a resolver outside the list and asks nobody.
	f := &miekgDNS{answers: map[string][]dns.RR{}}
	g := netGuard{allowLocal: true, dnsServers: f.serve(t)}
	if _, err := g.lookup(context.Background(), "web.test", "A", "9.9.9.9"); err == nil || f.queries.Load() != 0 {
		t.Fatalf("lookup with a free resolver: err=%v queries=%d", err, f.queries.Load())
	}
}

func TestNetDNSCAA(t *testing.T) {
	f := &miekgDNS{answers: map[string][]dns.RR{
		"web.test./CAA": {
			mustRR(t, `web.test. 300 IN CAA 0 issue "letsencrypt.org"`),
			mustRR(t, `web.test. 300 IN CAA 128 iodef "mailto:sec@web.test"`),
		},
	}}
	res := runMiekgDNS(t, f, netGuard{allowLocal: false}, "web.test", NetCheck{Record: "CAA", Resolver: "1.1.1.1", Expect: "issue letsencrypt.org"})
	if !res.OK || res.DNS == nil || len(res.DNS.Records) != 2 {
		t.Fatalf("CAA: %+v", res)
	}
	got := map[string]bool{}
	for _, r := range res.DNS.Records {
		got[r.Value] = true
	}
	if !got["0 issue letsencrypt.org"] || !got["128 iodef mailto:sec@web.test"] {
		t.Fatalf("CAA display is 'flags tag value': %+v", res.DNS.Records)
	}
	if res.Detail == "" || !strings.HasPrefix(res.Detail, "CAA ") {
		t.Fatalf("detail: %q", res.Detail)
	}

	// The system resolver cannot be asked for CAA by the standard library; the
	// system's own nameservers are asked through miekg instead.
	f2 := &miekgDNS{answers: f.answers}
	res = runMiekgDNS(t, f2, netGuard{allowLocal: false}, "web.test", NetCheck{Record: "CAA", Expect: "0 issue letsencrypt.org"})
	if !res.OK || res.DNS.Resolver != "system" || res.DNS.DNSSEC != dnssecUnknown {
		t.Fatalf("CAA via the system resolver: %+v", res)
	}
	// A wrong expectation is a content failure.
	f3 := &miekgDNS{answers: f.answers}
	if res := runMiekgDNS(t, f3, netGuard{}, "web.test", NetCheck{Record: "CAA", Resolver: "8.8.8.8", Expect: "issue other.org"}); res.OK || res.Class != "content" {
		t.Fatalf("CAA expectation: %+v", res)
	}
}

func TestNetDNSTTL(t *testing.T) {
	f := &miekgDNS{answers: map[string][]dns.RR{
		"web.test./A":   {mustRR(t, "web.test. 300 IN A 93.184.216.34"), mustRR(t, "web.test. 60 IN A 93.184.216.35")},
		"mail.test./MX": {mustRR(t, "mail.test. 3600 IN MX 10 mx1.mail.test.")},
	}}
	res := runMiekgDNS(t, f, netGuard{}, "web.test", NetCheck{Record: "A", Resolver: "1.1.1.1"})
	if !res.OK || len(res.DNS.Records) != 2 {
		t.Fatalf("A: %+v", res)
	}
	ttls := map[string]int{}
	for _, r := range res.DNS.Records {
		ttls[r.Value] = r.TTL
	}
	if ttls["93.184.216.34"] != 300 || ttls["93.184.216.35"] != 60 {
		t.Fatalf("TTL per record: %+v", res.DNS.Records)
	}
	mx := runMiekgDNS(t, &miekgDNS{answers: f.answers}, netGuard{}, "mail.test", NetCheck{Record: "MX", Resolver: "8.8.8.8"})
	if len(mx.DNS.Records) != 1 || mx.DNS.Records[0].TTL != 3600 || mx.DNS.Records[0].Prio != 10 {
		t.Fatalf("MX: %+v", mx.DNS)
	}
	// The TTL is not part of the drift fingerprint: it ticks down on every answer.
	a := dnsValueSet("A", []DNSRecord{{Value: "1.2.3.4", TTL: 300}})
	b := dnsValueSet("A", []DNSRecord{{Value: "1.2.3.4", TTL: 12}})
	if dnsFingerprint("A", a) != dnsFingerprint("A", b) {
		t.Fatal("TTL changed the fingerprint")
	}
}

func TestNetDNSADFlag(t *testing.T) {
	answers := map[string][]dns.RR{"web.test./A": {mustRR(t, "web.test. 60 IN A 93.184.216.34")}}
	cases := []struct {
		name, resolver, record string
		ad                     bool
		want                   string
	}{
		{"validated", "1.1.1.1", "A", true, dnssecValidated},
		{"not validated", "8.8.8.8", "A", false, dnssecNot},
		// The system resolver says nothing we can rely on.
		{"system CAA", "", "CAA", true, dnssecUnknown},
	}
	answers["web.test./CAA"] = []dns.RR{mustRR(t, `web.test. 60 IN CAA 0 issue "x.org"`)}
	for _, tc := range cases {
		f := &miekgDNS{answers: answers, ad: tc.ad}
		res := runMiekgDNS(t, f, netGuard{}, "web.test", NetCheck{Record: tc.record, Resolver: tc.resolver})
		if !res.OK || res.DNS.DNSSEC != tc.want {
			t.Fatalf("%s: want %s, got %+v", tc.name, tc.want, res)
		}
	}
	// A not-validated answer never makes the check fail.
	f := &miekgDNS{answers: answers}
	if res := runMiekgDNS(t, f, netGuard{}, "web.test", NetCheck{Record: "A", Resolver: "1.1.1.1"}); !res.OK {
		t.Fatalf("an answer without AD is still up: %+v", res)
	}
	// The standard-library path reports unknown.
	sys := runFakeDNS(t, &fakeDNS{answers: map[string][]dnsmessage.Resource{"web.test.": {aRec("web.test.", "93.184.216.34")}}}, netGuard{}, "web.test", NetCheck{Record: "A"})
	if !sys.OK || sys.DNS.DNSSEC != dnssecUnknown {
		t.Fatalf("system resolver: %+v", sys)
	}
}

func TestNetDNSFixedResolverGuardAndLimits(t *testing.T) {
	// A private answer without allowLocal is a guard result, with the records shown.
	lan := &miekgDNS{answers: map[string][]dns.RR{"lan.test./A": {mustRR(t, "lan.test. 60 IN A 192.168.1.20")}}}
	res := runMiekgDNS(t, lan, netGuard{allowLocal: false}, "lan.test", NetCheck{Record: "A", Resolver: "1.1.1.1"})
	if res.OK || res.Class != "guard" || res.DNS == nil || len(res.DNS.Records) != 1 {
		t.Fatalf("private answer, local off: %+v", res)
	}
	if res := runMiekgDNS(t, &miekgDNS{answers: lan.answers}, netGuard{allowLocal: true}, "lan.test", NetCheck{Record: "A", Resolver: "1.1.1.1"}); !res.OK {
		t.Fatalf("private answer, local on: %+v", res)
	}

	// Demo: refused before any packet leaves.
	t.Setenv("NEXTDASH_DEMO", "1")
	demo := &miekgDNS{answers: map[string][]dns.RR{"web.test./A": {mustRR(t, "web.test. 60 IN A 93.184.216.34")}}}
	res = runMiekgDNS(t, demo, netGuard{}, "web.test", NetCheck{Record: "A", Resolver: "8.8.8.8"})
	if res.OK || res.Class != "demo" || demo.queries.Load() != 0 {
		t.Fatalf("demo: %+v queries=%d", res, demo.queries.Load())
	}
}

func TestNetDNSFixedResolverLimitsAndTruncation(t *testing.T) {
	var rrs []dns.RR
	for i := 1; i <= 40; i++ {
		rrs = append(rrs, mustRR(t, fmt.Sprintf("many.test. 60 IN A 93.184.216.%d", i)))
	}
	long := strings.Repeat("x", 600)
	f := &miekgDNS{bigUDP: true, answers: map[string][]dns.RR{
		"many.test./A":   rrs,
		"long.test./TXT": {mustRR(t, fmt.Sprintf(`long.test. 60 IN TXT "%s" "%s"`, long[:255], long[255:]))},
	}}
	// The UDP answer is cut off; the TCP retry brings the full set, cut to 30.
	res := runMiekgDNS(t, f, netGuard{}, "many.test", NetCheck{Record: "A", Resolver: "1.1.1.1"})
	if !res.OK || len(res.DNS.Records) != netDNSMaxRecords || f.queries.Load() != 2 {
		t.Fatalf("truncation fallback: %d records, %d queries, %+v", len(res.DNS.Records), f.queries.Load(), res)
	}
	f2 := &miekgDNS{answers: f.answers}
	txt := runMiekgDNS(t, f2, netGuard{}, "long.test", NetCheck{Record: "TXT", Resolver: "1.1.1.1"})
	if !txt.OK || len([]rune(txt.DNS.Records[0].Value)) > netDNSMaxTXT+1 {
		t.Fatalf("TXT limit: %d", len([]rune(txt.DNS.Records[0].Value)))
	}
	// NXDOMAIN and SERVFAIL are failures with a sentence.
	nx := &miekgDNS{rcode: dns.RcodeNameError}
	if res := runMiekgDNS(t, nx, netGuard{}, "gone.test", NetCheck{Record: "A", Resolver: "1.1.1.1"}); res.OK || res.Class != "dns" || !strings.Contains(res.Error, "No A records") {
		t.Fatalf("NXDOMAIN: %+v", res)
	}
	sf := &miekgDNS{rcode: dns.RcodeServerFailure}
	if res := runMiekgDNS(t, sf, netGuard{}, "bad.test", NetCheck{Record: "A", Resolver: "1.1.1.1"}); res.OK || res.Class != "dns" {
		t.Fatalf("SERVFAIL: %+v", res)
	}
}
