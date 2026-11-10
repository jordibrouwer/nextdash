package app

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
)

// tlsTestCA is a certificate authority made for one test.
type tlsTestCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pool *x509.CertPool
}

func tlsTestKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func newTLSTestCA(t *testing.T) *tlsTestCA {
	t.Helper()
	key := tlsTestKey(t)
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test Root CA"},
		NotBefore:             time.Now().Add(-48 * time.Hour),
		NotAfter:              time.Now().Add(10 * 365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &tlsTestCA{cert: cert, key: key, pool: pool}
}

// issue makes a leaf for 127.0.0.1 and the given names, valid for the span.
func (ca *tlsTestCA) issue(t *testing.T, notBefore, notAfter time.Time, dns ...string) tls.Certificate {
	t.Helper()
	key := tlsTestKey(t)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "leaf.test"},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		DNSNames:     dns,
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// selfSigned is a leaf that signs itself: not in any root pool.
func selfSignedTLSCert(t *testing.T) tls.Certificate {
	t.Helper()
	key := tlsTestKey(t)
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(99),
		Subject:      pkix.Name{CommonName: "self.test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(90 * 24 * time.Hour),
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// serveTLS starts a TLS listener on 127.0.0.1 that finishes the handshake and
// hangs up. It returns the port.
func serveTLS(t *testing.T, cert tls.Certificate) int {
	t.Helper()
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{"h2", "http/1.1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				if tc, ok := c.(*tls.Conn); ok {
					_ = tc.Handshake()
				}
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func runTLSTest(t *testing.T, g netGuard, port int, c NetCheck) NetResult {
	t.Helper()
	h, _ := patchTestHandlers(t)
	c.Type = netTypeTLS
	return h.runTLS(context.Background(), g, netTarget{Host: "127.0.0.1", Port: port}, c)
}

func TestNetTLSValid(t *testing.T) {
	ca := newTLSTestCA(t)
	port := serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(90*24*time.Hour)))
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
	if !res.OK || res.Warn || res.Class != "" || res.TLS == nil || !res.TLS.Valid {
		t.Fatalf("%+v tls=%+v", res, res.TLS)
	}
	if res.TLS.Version != "TLS 1.3" || res.TLS.Cipher == "" || res.TLS.ALPN == "" {
		t.Errorf("version/cipher/alpn = %q %q %q", res.TLS.Version, res.TLS.Cipher, res.TLS.ALPN)
	}
	if res.TLS.DaysLeft < 89 || res.TLS.DaysLeft > 90 || res.Secondary != res.TLS.DaysLeft {
		t.Errorf("days left = %d secondary = %d", res.TLS.DaysLeft, res.Secondary)
	}
	if len(res.TLS.Chain) != 1 || res.TLS.Chain[0].Subject != "leaf.test" || res.TLS.Chain[0].Issuer != "Test Root CA" ||
		res.TLS.Chain[0].SigAlg == "" || len(res.TLS.Chain[0].SAN) == 0 || res.TLS.Chain[0].NotAfter <= res.TLS.Chain[0].NotBefore {
		t.Errorf("chain = %+v", res.TLS.Chain)
	}
	if !strings.Contains(res.Detail, "TLS 1.3") || !strings.Contains(res.Detail, "days left") {
		t.Errorf("detail = %q", res.Detail)
	}
}

func TestNetTLSExpired(t *testing.T) {
	ca := newTLSTestCA(t)
	port := serveTLS(t, ca.issue(t, time.Now().Add(-30*24*time.Hour), time.Now().Add(-3*24*time.Hour)))
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
	if res.OK || res.Class != "tls" || res.TLS == nil || res.TLS.Valid {
		t.Fatalf("%+v tls=%+v", res, res.TLS)
	}
	if res.TLS.DaysLeft > -3 || res.TLS.DaysLeft < -4 || len(res.TLS.Chain) != 1 {
		t.Errorf("days left = %d chain = %d: an expired certificate is still shown", res.TLS.DaysLeft, len(res.TLS.Chain))
	}
	if !strings.Contains(res.Error, "expired") || !strings.Contains(res.Detail, "expired") {
		t.Errorf("error %q detail %q", res.Error, res.Detail)
	}
	if res.Secondary != res.TLS.DaysLeft {
		t.Errorf("secondary = %d, want the (negative) days left", res.Secondary)
	}
}

func TestNetTLSSelfSigned(t *testing.T) {
	port := serveTLS(t, selfSignedTLSCert(t))
	// The roots hold a different CA, as the system roots would.
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: newTLSTestCA(t).pool}, port, NetCheck{})
	if res.OK || res.Class != "tls" || res.TLS == nil || res.TLS.Valid {
		t.Fatalf("%+v tls=%+v", res, res.TLS)
	}
	if len(res.TLS.Chain) != 1 || res.TLS.Chain[0].Subject != "self.test" || !strings.Contains(res.Error, "not trusted") {
		t.Errorf("chain %+v error %q", res.TLS.Chain, res.Error)
	}
}

func TestNetTLSNameMismatch(t *testing.T) {
	ca := newTLSTestCA(t)
	// The certificate has no IP SAN for the address it is asked for by name.
	port := serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(90*24*time.Hour), "other.example"))
	g := netGuard{allowLocal: true, tlsRoots: ca.pool}
	out, err := g.tlsInspect(context.Background(), "127.0.0.1", port, "wrong.example", 5*time.Second)
	if err == nil || out.Valid || len(out.Chain) == 0 {
		t.Fatalf("err %v valid %v chain %d", err, out.Valid, len(out.Chain))
	}
	if cls := netErrorClass(err); cls != "tls" {
		t.Errorf("class = %q", cls)
	}
	_, sentence, _ := tlsVerifyFailure(err, out, "wrong.example")
	if !strings.Contains(sentence, "not valid for wrong.example") {
		t.Errorf("sentence = %q", sentence)
	}
}

func TestNetTLSNeverTrustsInvalid(t *testing.T) {
	// Nothing about the handshake being accepted makes a certificate valid: a
	// self-signed one against the system roots (nil here) must be refused.
	port := serveTLS(t, selfSignedTLSCert(t))
	g := netGuard{allowLocal: true}
	out, err := g.tlsInspect(context.Background(), "127.0.0.1", port, "127.0.0.1", 5*time.Second)
	if err == nil || out.Valid {
		t.Fatalf("a self-signed certificate was trusted: valid=%v err=%v", out.Valid, err)
	}
	if len(out.Chain) != 1 {
		t.Errorf("the chain of an invalid certificate must still be shown, got %d", len(out.Chain))
	}
}

func TestNetTLSWarnBelowMinDays(t *testing.T) {
	ca := newTLSTestCA(t)
	port := serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(10*24*time.Hour+time.Hour)))
	g := netGuard{allowLocal: true, tlsRoots: ca.pool}

	// 10 days left, default threshold 14: up, but warn.
	res := runTLSTest(t, g, port, NetCheck{})
	if !res.OK || !res.Warn || res.Class != "" || res.Secondary != 10 || res.Detail != "10 days left" {
		t.Fatalf("default: %+v", res)
	}
	// A threshold of 7: no warning.
	res = runTLSTest(t, g, port, NetCheck{MinDaysLeft: 7})
	if !res.OK || res.Warn {
		t.Fatalf("min 7: %+v", res)
	}
	// And the state read back from the sample follows the check's own threshold.
	sample := res.sample(false)
	if st := netCheckStateFor(NetCheck{Type: netTypeTLS, MinDaysLeft: 7}, []HealthSample{sample}); st.Warn {
		t.Errorf("state warns at 10 days with a threshold of 7")
	}
	if st := netCheckStateFor(NetCheck{Type: netTypeTLS, MinDaysLeft: 30}, []HealthSample{sample}); !st.Warn {
		t.Errorf("state does not warn at 10 days with a threshold of 30")
	}
}

func TestNetTLSWarnAtTheThreshold(t *testing.T) {
	ca := newTLSTestCA(t)
	// 14 days and an hour left: 14 full days, which is at the default threshold.
	port := serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(14*24*time.Hour+time.Hour)))
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
	if !res.OK || !res.Warn || res.Secondary != 14 {
		t.Fatalf("14 days at a threshold of 14 must warn: %+v", res)
	}
	sample := res.sample(false)
	if st := netCheckStateFor(NetCheck{Type: netTypeTLS}, []HealthSample{sample}); !st.Warn {
		t.Errorf("state must warn at exactly the threshold")
	}
	// 15 days: no warning.
	port = serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(15*24*time.Hour+time.Hour)))
	if res = runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{}); res.Warn {
		t.Errorf("15 days must not warn: %+v", res)
	}
}

func TestNetTLSChainAndSANLimits(t *testing.T) {
	ca := newTLSTestCA(t)
	var names []string
	for i := 0; i < 30; i++ {
		names = append(names, "n"+strings.Repeat("x", i)+".example")
	}
	leaf := ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(90*24*time.Hour), names...)
	// Seven certificates in the chain: the leaf and six copies of the CA.
	for i := 0; i < 6; i++ {
		leaf.Certificate = append(leaf.Certificate, ca.cert.Raw)
	}
	port := serveTLS(t, leaf)
	res := runTLSTest(t, netGuard{allowLocal: true, tlsRoots: ca.pool}, port, NetCheck{})
	if res.TLS == nil || len(res.TLS.Chain) != netTLSMaxChain || res.TLS.ChainTotal != 7 {
		t.Fatalf("chain %d total %d", len(res.TLS.Chain), res.TLS.ChainTotal)
	}
	first := res.TLS.Chain[0]
	if len(first.SAN) != netTLSMaxSAN || first.SANMore != 11 { // 30 names + the IP address, minus 20
		t.Errorf("san %d more %d", len(first.SAN), first.SANMore)
	}
}

func TestNetTLSNotTLSPort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_, _ = c.Write([]byte("220 mail.example ESMTP ready\r\n"))
			time.Sleep(200 * time.Millisecond)
			c.Close()
		}
	}()
	res := runTLSTest(t, netGuard{allowLocal: true}, ln.Addr().(*net.TCPAddr).Port, NetCheck{})
	if res.OK || res.Class != "tls" || res.TLS != nil || !strings.Contains(res.Error, "STARTTLS") {
		t.Fatalf("%+v", res)
	}
}

func TestNetTLSGuardAndRefused(t *testing.T) {
	ca := newTLSTestCA(t)
	port := serveTLS(t, ca.issue(t, time.Now().Add(-time.Hour), time.Now().Add(90*24*time.Hour)))
	// Local addresses are off: the guard refuses before any socket opens.
	res := runTLSTest(t, netGuard{allowLocal: false, tlsRoots: ca.pool}, port, NetCheck{})
	if res.OK || res.Class != "guard" {
		t.Fatalf("guard: %+v", res)
	}
	// Nothing listens.
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	dead := l.Addr().(*net.TCPAddr).Port
	l.Close()
	res = runTLSTest(t, netGuard{allowLocal: true}, dead, NetCheck{})
	if res.OK || res.Class != "refused" {
		t.Fatalf("refused: %+v", res)
	}
}

func TestNetTLSDemoRefused(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	res := runTLSTest(t, netGuard{allowLocal: true}, 443, NetCheck{})
	if res.OK || res.Class != "demo" {
		t.Fatalf("%+v", res)
	}
}

func TestNetTLSTargetPort(t *testing.T) {
	cases := []struct {
		url  string
		port int
		want int
	}{
		{"https://a.example", 0, 443},
		{"https://a.example:8443/x", 0, 8443},
		{"http://a.example:8080", 0, 443}, // the port of a plain http address is not a TLS port
		{"http://a.example", 0, 443},
		{"https://a.example:8443", 993, 993},
	}
	for _, tc := range cases {
		got, err := netCheckTarget(Bookmark{URL: tc.url}, NetCheck{Type: netTypeTLS, Port: tc.port}, Settings{})
		if err != nil || got.Port != tc.want {
			t.Errorf("%s port %d: got %+v err %v, want %d", tc.url, tc.port, got, err, tc.want)
		}
	}
}

func TestNetTLSValidation(t *testing.T) {
	s := Settings{NetToolsMaxChecks: 10}
	out, err := normalizeNetChecks([]NetCheck{{Type: netTypeTLS, Port: 8443, MinDaysLeft: 21, Enabled: true}}, nil, Bookmark{}, s, map[string]bool{}, 0)
	if err != nil || len(out) != 1 || out[0].Port != 8443 || out[0].MinDaysLeft != 21 {
		t.Fatalf("%+v %v", out, err)
	}
	for _, bad := range []NetCheck{{Type: netTypeTLS, MinDaysLeft: 500}, {Type: netTypeTLS, MinDaysLeft: -1}, {Type: netTypeTLS, Port: 70000}} {
		if _, err := normalizeNetChecks([]NetCheck{bad}, nil, Bookmark{}, s, map[string]bool{}, 0); err == nil {
			t.Errorf("%+v was accepted", bad)
		}
	}
	// MinDaysLeft belongs to tls only.
	out, _ = normalizeNetChecks([]NetCheck{{Type: netTypeTCP, MinDaysLeft: 5}}, nil, Bookmark{}, s, map[string]bool{}, 0)
	if len(out) != 1 || out[0].MinDaysLeft != 0 {
		t.Errorf("a tcp check kept a TLS threshold: %+v", out)
	}
}

func tlsOutcomeAt(id string, notAfter time.Time, muted bool) netOutcome {
	return netOutcome{
		due: netDue{key: netHistoryKey(id), bm: Bookmark{Name: "Nas", URL: "https://nas.example"}, check: NetCheck{ID: id, Type: netTypeTLS, Port: 8443}, muted: muted},
		res: NetResult{Type: netTypeTLS, CheckID: id, OK: true, TLS: &TLSResult{Valid: true, Chain: []TLSCert{{NotAfter: notAfter.UnixMilli()}}}},
	}
}

func tlsOutcome(id string, days int, muted bool, warn bool) netOutcome {
	return tlsOutcomeAt(id, time.Now().Add(time.Duration(days)*24*time.Hour+time.Hour), muted)
}

func TestNetTLSCertExpiringNotification(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	id := "aaaaaaaaaaaa"
	expires := time.Now().Add(40 * 24 * time.Hour)
	// The same certificate seen on later days.
	on := func(daysLeft int, e time.Time) []monitorNotification {
		return h.netCertNotifications([]netOutcome{tlsOutcomeAt(id, e, false)}, e.Add(-time.Duration(daysLeft)*24*time.Hour-time.Hour))
	}

	if got := on(40, expires); len(got) != 0 {
		t.Fatalf("40 days: %+v", got)
	}
	// 12 days: crosses the check's own mark of 14, once.
	got := on(12, expires)
	if len(got) != 1 || got[0].Event != "cert-expiring" || got[0].Check != "TLS 8443" || got[0].CheckID != id ||
		got[0].Name != "Nas" || got[0].DaysLeft != 12 || got[0].Status != "warning" {
		t.Fatalf("12 days: %+v", got)
	}
	// Every further round at the same mark is silent.
	for i := 0; i < 3; i++ {
		if again := on(12, expires); len(again) != 0 {
			t.Fatalf("round %d repeated the warning: %+v", i, again)
		}
	}
	if again := on(9, expires); len(again) != 0 {
		t.Fatalf("9 days is still inside the mark that was told: %+v", again)
	}
	// 2 days: the next mark of the ladder (14, 3, 1) is crossed.
	if next := on(2, expires); len(next) != 1 || next[0].DaysLeft != 2 {
		t.Fatalf("2 days: %+v", next)
	}
	// A renewal starts over: the new certificate has its own marks.
	renewed := expires.Add(90 * 24 * time.Hour)
	if got := on(80, renewed); len(got) != 0 {
		t.Fatalf("renewed: %+v", got)
	}
	if again := on(10, renewed); len(again) != 1 {
		t.Fatalf("after a renewal the next expiry must warn again: %+v", again)
	}
	// The marks live apart from the HTTP certificate list.
	if certs := h.hostCertificates(); len(certs) != 0 {
		t.Errorf("a TLS check showed up as a host certificate: %+v", certs)
	}
}

func TestNetTLSCertExpiringSkipsMutedAndFailed(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	now := time.Now()
	if got := h.netCertNotifications([]netOutcome{tlsOutcome("bbbbbbbbbbbb", 5, true, true)}, now); len(got) != 0 {
		t.Fatalf("muted: %+v", got)
	}
	// Unmuted, the mark was not used up: it tells now.
	if got := h.netCertNotifications([]netOutcome{tlsOutcome("bbbbbbbbbbbb", 5, false, true)}, now); len(got) != 1 {
		t.Fatalf("after unmuting: %+v", got)
	}
	failed := tlsOutcome("cccccccccccc", 5, false, true)
	failed.res.OK = false
	failed.res.TLS.Valid = false
	if got := h.netCertNotifications([]netOutcome{failed}, now); len(got) != 0 {
		t.Fatalf("a failed check is down, not expiring: %+v", got)
	}
}

func TestNetTLSPruneDropsDeletedChecks(t *testing.T) {
	h, _ := healthRecheckTestHandlers(t, `{}`)
	h.netCertNotifications([]netOutcome{tlsOutcome("dddddddddddd", 5, false, true), tlsOutcome("eeeeeeeeeeee", 5, false, true)}, time.Now())
	h.pruneNetCertificates(map[string]bool{netHistoryKey("dddddddddddd"): true})
	cache := readHealthCacheFile()
	if _, ok := cache.NetCertificates[netHistoryKey("dddddddddddd")]; !ok {
		t.Errorf("the mark of an existing check was pruned")
	}
	if _, ok := cache.NetCertificates[netHistoryKey("eeeeeeeeeeee")]; ok {
		t.Errorf("the mark of a deleted check stayed")
	}
}

func TestNetTLSMonitorRoundRecordsMarks(t *testing.T) {
	h, dir := healthRecheckTestHandlers(t, `{}`)
	id := netTestCheckID(7)
	netTestPage(t, dir, `{"name":"Nas","url":"https://nas.example","checks":[{"id":"`+id+`","type":"tls","enabled":true}]}`)
	notAfter := time.Now().Add(5*24*time.Hour + time.Hour).UnixMilli()
	stub := &netStub{res: func(c NetCheck, call int) NetResult {
		return NetResult{OK: true, Warn: true, Secondary: 5, Detail: "5 days left",
			TLS: &TLSResult{Valid: true, DaysLeft: 5, Chain: []TLSCert{{NotAfter: notAfter}}}}
	}}
	h.netRunner = stub.run
	h.runDueMonitors()
	cache := readHealthCacheFile()
	entry, ok := cache.NetCertificates[netHistoryKey(id)]
	if !ok || len(entry.NotifiedDays) == 0 {
		t.Fatalf("the round did not record the expiry mark: %+v", cache.NetCertificates)
	}
	samples := h.healthHistoryFor(netHistoryKey(id))
	if len(samples) != 1 || !samples[0].Up || samples[0].L != 5 || samples[0].D != "5 days left" {
		t.Fatalf("samples = %#v", samples)
	}
}
