package app

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"math/rand"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/miekg/dns"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
)

// The only file in nettool_*.go that touches a socket or a resolver. Everything
// else (targets, validation, the run function, the planner) asks the guard, so
// one test (TestNetToolsNeverDialDirectly) can say "no other file dials".

var (
	errNetGuardBlocked  = errors.New("blocked by the address guard")
	errICMPNotPermitted = errors.New("ICMP is not permitted here")
)

// icmpState is what the first real ping learned: 0 unknown, 1 works, 2 blocked.
// /api/net/capabilities reads it.
var icmpState atomic.Int32

const (
	icmpUnknown int32 = 0
	icmpWorks   int32 = 1
	icmpBlocked int32 = 2
)

// netGuard carries the one decision every network check shares: may it reach
// the host's own network? It is built per call, so a setting that changes is
// honoured by the next check.
type netGuard struct {
	allowLocal bool
	// dialHook replaces the dialer in tests only (a deterministic timeout);
	// resolve still runs first. Production code never sets it.
	dialHook func(ctx context.Context, network, address string) (net.Conn, error)
	// resolver replaces the system resolver in tests only (a fake DNS server
	// on a local UDP port); nil means net.DefaultResolver.
	resolver *net.Resolver
	// dnsServers replaces the resolver addresses ("host:port" list) of the
	// miekg path in tests only (a fake DNS server on a local port); nil means
	// port 53 of the chosen resolver, or the nameservers of resolv.conf.
	dnsServers func(resolver string) []string
	// tlsRoots replaces the system roots in tests only (a CA made in the test);
	// nil means the system roots.
	tlsRoots *x509.CertPool
}

// netGuard reads AllowLocalBookmarks now (not cached) and never opens the
// local network in the demo.
func (h *Handlers) netGuard() netGuard {
	return netGuard{allowLocal: h.allowLocalBookmarks() && !demoMode()}
}

// resolve turns a host into addresses a check may dial. The demo refuses
// first. A cached pin from resolvePinnedHostAddrs is returned without a new
// allowLocal test and is shared across allowLocal values, so every address is
// tested again here.
func (g netGuard) resolve(ctx context.Context, host string) ([]netip.Addr, error) {
	if demoDialRefused(ctx) {
		return nil, errDemoOutbound
	}
	host = strings.TrimSpace(host)
	if ip, err := netip.ParseAddr(host); err == nil {
		ip = ip.Unmap()
		if !isAllowedDialIP(ip, g.allowLocal && !demoMode()) {
			return nil, errNetGuardBlocked
		}
		return []netip.Addr{ip}, nil
	}
	addrs, err := resolvePinnedHostAddrs(ctx, host, g.allowLocal)
	if err != nil {
		if err.Error() == "dial to disallowed IP" {
			return nil, errNetGuardBlocked
		}
		return nil, err
	}
	out := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		if !isAllowedDialIP(addr, g.allowLocal && !demoMode()) {
			return nil, errNetGuardBlocked
		}
		out = append(out, addr)
	}
	return out, nil
}

// explainBlocked says where a refused host points ("resolves to 192.168.1.20"),
// for the error state only. It dials nothing and pins nothing: a plain lookup
// that is shown, never used.
func (g netGuard) explainBlocked(ctx context.Context, host string) []netip.Addr {
	if demoDialRefused(ctx) {
		return nil
	}
	host = strings.TrimSpace(host)
	if ip, err := netip.ParseAddr(host); err == nil {
		return []netip.Addr{ip.Unmap()}
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil
	}
	return netIPAddrsToPin(ips)
}

// dialTCP connects to host:port through the shared SSRF-safe dialer, one
// resolved address at a time, and reports which address answered.
func (g netGuard) dialTCP(ctx context.Context, host string, port int, timeout time.Duration) (net.Conn, netip.Addr, error) {
	addrs, err := g.resolve(ctx, host)
	if err != nil {
		return nil, netip.Addr{}, err
	}
	dial := ssrfSafeDialContext(g.allowLocal, timeout)
	if g.dialHook != nil {
		dial = g.dialHook
	}
	var lastErr error
	for _, addr := range addrs {
		conn, err := dial(ctx, "tcp", net.JoinHostPort(addr.String(), strconv.Itoa(port)))
		if err == nil {
			return conn, addr, nil
		}
		lastErr = err
		if ctx.Err() != nil {
			break
		}
	}
	return nil, netip.Addr{}, lastErr
}

// netErrorClass is the class a failed check stores in HealthSample.Fail.
// Typed errors first; the text-based failureClass is the last resort.
func netErrorClass(err error) string {
	if err == nil {
		return ""
	}
	var dnsErr *net.DNSError
	var unknownAuth x509.UnknownAuthorityError
	var hostErr x509.HostnameError
	var certInvalid x509.CertificateInvalidError
	var certVerify *tls.CertificateVerificationError
	var recordHeader tls.RecordHeaderError
	var tlsErr netTLSError
	var netErr net.Error
	switch {
	case errors.Is(err, errDemoOutbound):
		return "demo"
	case errors.Is(err, errNetGuardBlocked):
		return "guard"
	case errors.Is(err, errICMPNotPermitted):
		return "icmp"
	case errors.As(err, &dnsErr):
		return "dns"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.As(err, &netErr) && netErr.Timeout():
		return "timeout"
	case errors.As(err, &unknownAuth), errors.As(err, &hostErr), errors.As(err, &certInvalid),
		errors.As(err, &certVerify), errors.As(err, &recordHeader), errors.As(err, &tlsErr):
		return "tls"
	}
	return failureClass(err.Error())
}

// icmpPacketConn is the slice of *icmp.PacketConn an echo needs; tests swap
// listenICMP for a fake so no real ICMP (and no root) is needed.
type icmpPacketConn interface {
	WriteTo(b []byte, dst net.Addr) (int, error)
	ReadFrom(b []byte) (int, net.Addr, error)
	SetReadDeadline(t time.Time) error
	Close() error
}

// listenICMP opens an ICMP socket: network is "udp4"/"udp6" (unprivileged) or
// "ip4:icmp"/"ip6:ipv6-icmp" (privileged).
var listenICMP = func(network, address string) (icmpPacketConn, error) {
	return icmp.ListenPacket(network, address)
}

// icmpNotPermitted is true for the errors that mean "this process may not (or
// cannot) open an ICMP socket", as opposed to "the host did not answer".
func icmpNotPermitted(err error) bool {
	return errors.Is(err, syscall.EPERM) || errors.Is(err, syscall.EACCES) ||
		errors.Is(err, syscall.EAFNOSUPPORT) || errors.Is(err, syscall.EPROTONOSUPPORT)
}

// icmpEcho pings one address that came out of resolve (never a name) and
// returns the round-trip times of the packets that were answered, in order.
// Unprivileged datagram ICMP first, then raw; when neither may be opened the
// error is errICMPNotPermitted. The payload is 32 bytes and no TTL, fragment
// or control-message option is set. Replies are matched on sequence number and
// source address, not on the echo ID: unprivileged Linux sockets rewrite it.
func (g netGuard) icmpEcho(ctx context.Context, addr netip.Addr, count int, per time.Duration) ([]time.Duration, error) {
	if demoDialRefused(ctx) {
		return nil, errDemoOutbound
	}
	addr = addr.Unmap()
	if !isAllowedDialIP(addr, g.allowLocal && !demoMode()) {
		return nil, errNetGuardBlocked
	}
	if count < 1 {
		count = 1
	}
	if count > 10 {
		count = 10
	}
	if per <= 0 {
		per = time.Second
	}
	v6 := addr.Is6()
	var modes [2]struct{ network, listen string }
	var proto int
	var reqType icmp.Type
	var replyType icmp.Type
	if v6 {
		modes = [2]struct{ network, listen string }{{"udp6", "::"}, {"ip6:ipv6-icmp", "::"}}
		proto, reqType, replyType = 58, ipv6.ICMPTypeEchoRequest, ipv6.ICMPTypeEchoReply
	} else {
		modes = [2]struct{ network, listen string }{{"udp4", "0.0.0.0"}, {"ip4:icmp", "0.0.0.0"}}
		proto, reqType, replyType = 1, ipv4.ICMPTypeEcho, ipv4.ICMPTypeEchoReply
	}
	var conn icmpPacketConn
	var dst net.Addr
	for _, m := range modes {
		c, err := listenICMP(m.network, m.listen)
		if err != nil {
			if icmpNotPermitted(err) {
				continue
			}
			return nil, err
		}
		conn = c
		if m.network[:3] == "udp" {
			dst = &net.UDPAddr{IP: addr.AsSlice()}
		} else {
			dst = &net.IPAddr{IP: addr.AsSlice()}
		}
		break
	}
	if conn == nil {
		icmpState.Store(icmpBlocked)
		return nil, errICMPNotPermitted
	}
	defer conn.Close()

	id := rand.Intn(0xffff)
	payload := make([]byte, 32)
	for i := range payload {
		payload[i] = byte('a' + i%26)
	}
	var rtts []time.Duration
	buf := make([]byte, 1500)
	for seq := 0; seq < count; seq++ {
		if ctx.Err() != nil {
			break
		}
		msg := icmp.Message{Type: reqType, Code: 0, Body: &icmp.Echo{ID: id, Seq: seq, Data: payload}}
		wire, err := msg.Marshal(nil)
		if err != nil {
			return rtts, err
		}
		start := time.Now()
		if _, err := conn.WriteTo(wire, dst); err != nil {
			if icmpNotPermitted(err) {
				icmpState.Store(icmpBlocked)
				return nil, errICMPNotPermitted
			}
			return rtts, err
		}
		icmpState.Store(icmpWorks)
		deadline := start.Add(per)
		if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
			deadline = d
		}
		for {
			_ = conn.SetReadDeadline(deadline)
			n, peer, err := conn.ReadFrom(buf)
			if err != nil {
				break // this packet is lost (timeout); on to the next
			}
			if peerIP(peer) != addr {
				continue
			}
			reply, err := icmp.ParseMessage(proto, buf[:n])
			if err != nil || reply.Type != replyType {
				continue
			}
			echo, ok := reply.Body.(*icmp.Echo)
			if !ok || echo.Seq != seq {
				continue
			}
			rtts = append(rtts, time.Since(start))
			break
		}
	}
	return rtts, ctx.Err()
}

func peerIP(a net.Addr) netip.Addr {
	switch v := a.(type) {
	case *net.UDPAddr:
		ip, _ := netip.AddrFromSlice(v.IP)
		return ip.Unmap()
	case *net.IPAddr:
		ip, _ := netip.AddrFromSlice(v.IP)
		return ip.Unmap()
	}
	return netip.Addr{}
}

// Limits on what a DNS answer may put on screen and in the history.
const (
	netDNSMaxRecords = 30
	netDNSMaxTXT     = 512
)

// netDNSRecords are the record types a DNS check can ask for in phase 2a.
var netDNSRecords = map[string]bool{"A": true, "AAAA": true, "CNAME": true, "MX": true, "TXT": true, "NS": true, "CAA": true}

// netDNSResolvers is the whole list of resolvers a DNS check may ask: the
// system one ("") and two fixed public ones. There is no free resolver field:
// an address typed by the user would turn this server into a DNS proxy.
var netDNSResolvers = map[string]bool{"": true, "1.1.1.1": true, "8.8.8.8": true}

// DNSSEC values of a DNSResult: what the AD flag of the answer said.
const (
	dnssecValidated = "validated" // the resolver set the AD flag
	dnssecNot       = "not-validated"
	dnssecUnknown   = "unknown" // the system resolver: no way to ask
)

var errNetDNSNeedsName = errors.New("a DNS check needs a host name, not an IP address")

func (g netGuard) sysResolver() *net.Resolver {
	if g.resolver != nil {
		return g.resolver
	}
	return net.DefaultResolver
}

// lookup asks the system resolver for one record type of a host name. The
// demo refuses first. Answers that are addresses (A, AAAA) are shown but each
// one is tested with isAllowedDialIP: a name that resolves to a private or
// reserved address while local bookmarks are off comes back with the records
// and errNetGuardBlocked, never as a plain success. Nothing here dials, and
// the answers are used for nothing but showing. At most netDNSMaxRecords
// records, a TXT value at most netDNSMaxTXT characters.
func (g netGuard) lookup(ctx context.Context, host, record, resolver string) (DNSResult, error) {
	out := DNSResult{Record: record, Resolver: "system", DNSSEC: dnssecUnknown}
	if resolver != "" {
		out.Resolver = resolver
	}
	if demoDialRefused(ctx) {
		return out, errDemoOutbound
	}
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if _, err := netip.ParseAddr(host); err == nil {
		return out, errNetDNSNeedsName
	}
	if !netDNSRecords[record] {
		return out, errors.New("unsupported record type")
	}
	if !netDNSResolvers[resolver] {
		return out, errors.New("unsupported resolver")
	}
	// A fixed resolver is asked through miekg/dns. So is CAA with the system
	// resolver, which the standard library cannot ask for.
	if resolver != "" || record == "CAA" {
		return g.lookupMiekg(ctx, out, host, record, resolver)
	}
	r := g.sysResolver()
	var err error
	blocked := false
	switch record {
	case "A", "AAAA":
		network := "ip4"
		if record == "AAAA" {
			network = "ip6"
		}
		var addrs []netip.Addr
		addrs, err = r.LookupNetIP(ctx, network, host)
		for _, a := range addrs {
			a = a.Unmap()
			if !isAllowedDialIP(a, g.allowLocal && !demoMode()) {
				blocked = true
			}
			out.Records = append(out.Records, DNSRecord{Value: a.String()})
		}
	case "CNAME":
		var cname string
		cname, err = r.LookupCNAME(ctx, host)
		if err == nil {
			// The resolver answers with the name itself when there is no alias.
			if c := strings.TrimSuffix(strings.ToLower(cname), "."); c == host || c == "" {
				err = &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
			} else {
				out.Records = append(out.Records, DNSRecord{Value: cname})
			}
		}
	case "MX":
		var mx []*net.MX
		mx, err = r.LookupMX(ctx, host)
		for _, m := range mx {
			out.Records = append(out.Records, DNSRecord{Value: m.Host, Prio: int(m.Pref)})
		}
	case "TXT":
		var txt []string
		txt, err = r.LookupTXT(ctx, host)
		for _, v := range txt {
			if rs := []rune(v); len(rs) > netDNSMaxTXT {
				v = string(rs[:netDNSMaxTXT]) + "…"
			}
			out.Records = append(out.Records, DNSRecord{Value: v})
		}
	case "NS":
		var ns []*net.NS
		ns, err = r.LookupNS(ctx, host)
		for _, n := range ns {
			out.Records = append(out.Records, DNSRecord{Value: n.Host})
		}
	}
	if len(out.Records) > netDNSMaxRecords {
		out.Records = out.Records[:netDNSMaxRecords]
	}
	if blocked {
		return out, errNetGuardBlocked
	}
	// The resolver reports a partly unreadable answer together with the
	// records it could read; what was read is shown.
	if err != nil && len(out.Records) == 0 {
		return out, err
	}
	return out, nil
}

// Limits on what a certificate chain may put on screen and in the history.
const (
	netTLSMaxChain = 5
	netTLSMaxSAN   = 20
	netTLSMaxName  = 200
)

// netTLSError marks a failure of the TLS handshake itself (the port does not
// speak TLS, no common version, the server hung up), so it is classed "tls"
// unless something more specific (a time-out, a refusal) is wrapped inside.
type netTLSError struct{ err error }

func (e netTLSError) Error() string { return e.err.Error() }
func (e netTLSError) Unwrap() error { return e.err }

// tlsInspect connects to host:port through dialTCP (so the address guard, the
// pin and the demo refusal all apply), starts a TLS handshake over that
// connection and reads what the server presents. Nothing is sent after the
// handshake and the connection is closed straight away.
//
// The handshake verifies: system roots (g.tlsRoots in tests), the intermediates
// the server sends, the host name serverName and the current time. There is no
// InsecureSkipVerify. TLSResult.Valid is true only when the handshake itself
// accepted the chain. A chain that does not verify (expired, self-signed, wrong
// name, unknown issuer) aborts the handshake with a
// *tls.CertificateVerificationError, which carries the certificates the server
// sent; those are still shown (and the error is returned, class "tls"). The
// version, cipher and ALPN are only known for a handshake that completed.
func (g netGuard) tlsInspect(ctx context.Context, host string, port int, serverName string, timeout time.Duration) (TLSResult, error) {
	var out TLSResult
	conn, _, err := g.dialTCP(ctx, host, port, timeout)
	if err != nil {
		return out, err
	}
	defer conn.Close() // the raw connection: no close_notify is written
	_ = conn.SetDeadline(time.Now().Add(timeout))

	tc := tls.Client(conn, &tls.Config{
		ServerName: serverName,
		RootCAs:    g.tlsRoots,
		NextProtos: []string{"h2", "http/1.1"},
	})
	hsErr := tc.HandshakeContext(ctx)
	now := time.Now()
	var peers []*x509.Certificate
	var verifyErr *tls.CertificateVerificationError
	if hsErr == nil {
		state := tc.ConnectionState()
		out.Version = tls.VersionName(state.Version)
		out.Cipher = tls.CipherSuiteName(state.CipherSuite)
		out.ALPN = state.NegotiatedProtocol
		peers = state.PeerCertificates
		if len(peers) == 0 {
			return out, netTLSError{errors.New("the server presented no certificate")}
		}
		out.Valid = true
	} else if errors.As(hsErr, &verifyErr) {
		peers = verifyErr.UnverifiedCertificates
	} else {
		return out, netTLSError{hsErr}
	}
	if len(peers) > 0 {
		out.ChainTotal = len(peers)
		for i, c := range peers {
			if i >= netTLSMaxChain {
				break
			}
			out.Chain = append(out.Chain, tlsCertSummary(c))
		}
		out.DaysLeft = certDaysLeft(peers[0].NotAfter.UnixMilli(), now)
	}
	if hsErr != nil {
		return out, hsErr
	}
	return out, nil
}

func netCutName(s string) string {
	if r := []rune(s); len(r) > netTLSMaxName {
		return string(r[:netTLSMaxName]) + "…"
	}
	return s
}

// tlsCertSummary is what a certificate shows: subject, issuer, validity, the
// signature algorithm and at most netTLSMaxSAN names.
func tlsCertSummary(c *x509.Certificate) TLSCert {
	out := TLSCert{
		Subject:   netCutName(tlsDistinguishedName(c.Subject.CommonName, c.Subject.String())),
		Issuer:    netCutName(tlsDistinguishedName(c.Issuer.CommonName, c.Issuer.String())),
		NotBefore: c.NotBefore.UnixMilli(),
		NotAfter:  c.NotAfter.UnixMilli(),
		SigAlg:    c.SignatureAlgorithm.String(),
	}
	var names []string
	names = append(names, c.DNSNames...)
	for _, ip := range c.IPAddresses {
		names = append(names, ip.String())
	}
	if len(names) > netTLSMaxSAN {
		out.SANMore = len(names) - netTLSMaxSAN
		names = names[:netTLSMaxSAN]
	}
	for _, n := range names {
		out.SAN = append(out.SAN, netCutName(n))
	}
	return out
}

func tlsDistinguishedName(cn, full string) string {
	if cn != "" {
		return cn
	}
	return full
}

// Limits of an HTTP-detail run.
const (
	netHTTPMaxBody      = 1 << 20 // the body is read up to here and no further
	netHTTPMaxRedirects = 10
	netHTTPMaxHeaderRaw = 64 << 10 // what the client accepts of a response's headers
)

// httpDial is the dialer of the HTTP-detail client. It resolves through the
// guard (so every address passes isAllowedDialIP again, the demo refuses, the
// pin applies) and then dials one literal address at a time, the same way
// dialTCP does. The resolution is reported to the request's httptrace by hand:
// net/http only sees a name to dial, and the timeline would have no DNS step
// otherwise.
func (g netGuard) httpDial(timeout time.Duration) func(ctx context.Context, network, address string) (net.Conn, error) {
	dial := ssrfSafeDialContext(g.allowLocal, timeout)
	if g.dialHook != nil {
		dial = g.dialHook
	}
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		trace := httptrace.ContextClientTrace(ctx)
		if trace != nil && trace.DNSStart != nil {
			trace.DNSStart(httptrace.DNSStartInfo{Host: host})
		}
		addrs, err := g.resolve(ctx, host)
		if trace != nil && trace.DNSDone != nil {
			info := httptrace.DNSDoneInfo{Err: err}
			for _, a := range addrs {
				info.Addrs = append(info.Addrs, net.IPAddr{IP: a.AsSlice()})
			}
			trace.DNSDone(info)
		}
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, addr := range addrs {
			conn, err := dial(ctx, network, net.JoinHostPort(addr.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
			if ctx.Err() != nil {
				break
			}
		}
		return nil, lastErr
	}
}

// httpClient is the client of HTTP-detail: every connection goes through
// httpDial, nothing is reused (a redirect to another host never rides on the
// first connection), no proxy from the environment, no cookies, no automatic
// redirects (the caller follows them one by one and asks the guard about every
// hop first), and no transparent decompression (the body is read as sent, so a
// compressed bomb cannot outgrow the read limit). The certificate is verified
// against the system roots (tlsRoots in tests) unless insecureTLS is true,
// which is the bookmark's own, existing "allow an untrusted certificate" choice.
func (g netGuard) httpClient(timeout time.Duration, insecureTLS bool) *http.Client {
	tr := &http.Transport{
		Proxy:                  nil,
		DialContext:            g.httpDial(timeout),
		ForceAttemptHTTP2:      true,
		DisableKeepAlives:      true,
		DisableCompression:     true,
		TLSHandshakeTimeout:    timeout,
		ResponseHeaderTimeout:  timeout,
		MaxResponseHeaderBytes: netHTTPMaxHeaderRaw,
		TLSClientConfig: &tls.Config{
			RootCAs:            g.tlsRoots,
			InsecureSkipVerify: insecureTLS,
		},
	}
	return &http.Client{
		Transport:     tr,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// dnsServerAddrs are the "host:port" addresses the miekg path asks, in order.
// A fixed resolver is port 53 of that address (the caller has checked it
// against netDNSResolvers). The system resolver is whatever resolv.conf lists,
// at most three, as the standard library would use them.
func (g netGuard) dnsServerAddrs(resolver string) []string {
	if g.dnsServers != nil {
		return g.dnsServers(resolver)
	}
	if resolver != "" {
		return []string{net.JoinHostPort(resolver, "53")}
	}
	cfg, err := dns.ClientConfigFromFile("/etc/resolv.conf")
	if err != nil {
		return nil
	}
	var out []string
	for _, s := range cfg.Servers {
		if len(out) == 3 {
			break
		}
		out = append(out, net.JoinHostPort(s, cfg.Port))
	}
	return out
}

// dnsExchange sends one query to one server over UDP and asks again over TCP
// when the answer was cut off.
func dnsExchange(ctx context.Context, m *dns.Msg, addr string) (*dns.Msg, error) {
	c := &dns.Client{Net: "udp", Timeout: 10 * time.Second}
	r, _, err := c.ExchangeContext(ctx, m, addr)
	if err == nil && r.Truncated {
		c = &dns.Client{Net: "tcp", Timeout: 10 * time.Second}
		r, _, err = c.ExchangeContext(ctx, m, addr)
	}
	return r, err
}

// lookupMiekg asks a resolver for one record type with miekg/dns. The query
// goes to a fixed public resolver or to the system's own nameservers, never to
// an address anybody typed. The answer is shown with its TTLs and, for a fixed
// resolver, the AD flag (DNSSEC validated). An address answer is judged by
// isAllowedDialIP like in the standard-library path: a private one without
// allowLocal comes back with its records and errNetGuardBlocked.
func (g netGuard) lookupMiekg(ctx context.Context, out DNSResult, host, record, resolver string) (DNSResult, error) {
	qtypes := map[string]uint16{"A": dns.TypeA, "AAAA": dns.TypeAAAA, "CNAME": dns.TypeCNAME,
		"MX": dns.TypeMX, "TXT": dns.TypeTXT, "NS": dns.TypeNS, "CAA": dns.TypeCAA}
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(host), qtypes[record])
	m.RecursionDesired = true
	m.SetEdns0(1232, true) // the DO bit makes a validating resolver set AD
	addrs := g.dnsServerAddrs(resolver)
	if len(addrs) == 0 {
		return out, &net.DNSError{Err: "no resolver is configured", Name: host}
	}
	var resp *dns.Msg
	var err error
	for _, addr := range addrs {
		resp, err = dnsExchange(ctx, m, addr)
		if err == nil || ctx.Err() != nil {
			break
		}
	}
	if err != nil {
		var netErr net.Error
		if (errors.As(err, &netErr) && netErr.Timeout()) || ctx.Err() != nil {
			return out, err
		}
		return out, &net.DNSError{Err: err.Error(), Name: host}
	}
	if resolver != "" {
		out.DNSSEC = dnssecNot
		if resp.AuthenticatedData {
			out.DNSSEC = dnssecValidated
		}
	}
	switch resp.Rcode {
	case dns.RcodeSuccess:
	case dns.RcodeNameError:
		return out, &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}
	default:
		return out, &net.DNSError{Err: "the resolver answered " + dns.RcodeToString[resp.Rcode], Name: host}
	}
	blocked := false
	addAddr := func(ip net.IP, ttl int) {
		a, _ := netip.AddrFromSlice(ip)
		a = a.Unmap()
		if !isAllowedDialIP(a, g.allowLocal && !demoMode()) {
			blocked = true
		}
		out.Records = append(out.Records, DNSRecord{Value: a.String(), TTL: ttl})
	}
	for _, rr := range resp.Answer {
		ttl := int(rr.Header().Ttl)
		switch v := rr.(type) {
		case *dns.A:
			if record == "A" {
				addAddr(v.A, ttl)
			}
		case *dns.AAAA:
			if record == "AAAA" {
				addAddr(v.AAAA, ttl)
			}
		case *dns.CNAME:
			if record == "CNAME" {
				out.Records = append(out.Records, DNSRecord{Value: v.Target, TTL: ttl})
			}
		case *dns.MX:
			if record == "MX" {
				out.Records = append(out.Records, DNSRecord{Value: v.Mx, Prio: int(v.Preference), TTL: ttl})
			}
		case *dns.TXT:
			if record == "TXT" {
				text := strings.Join(v.Txt, "")
				if rs := []rune(text); len(rs) > netDNSMaxTXT {
					text = string(rs[:netDNSMaxTXT]) + "…"
				}
				out.Records = append(out.Records, DNSRecord{Value: text, TTL: ttl})
			}
		case *dns.NS:
			if record == "NS" {
				out.Records = append(out.Records, DNSRecord{Value: v.Ns, TTL: ttl})
			}
		case *dns.CAA:
			if record == "CAA" {
				value := v.Tag + " " + v.Value
				if rs := []rune(value); len(rs) > netDNSMaxTXT {
					value = string(rs[:netDNSMaxTXT]) + "…"
				}
				out.Records = append(out.Records, DNSRecord{Value: strconv.Itoa(int(v.Flag)) + " " + value, TTL: ttl})
			}
		}
	}
	if len(out.Records) > netDNSMaxRecords {
		out.Records = out.Records[:netDNSMaxRecords]
	}
	if blocked {
		return out, errNetGuardBlocked
	}
	return out, nil
}
