package app

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"math/rand"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

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
		errors.As(err, &certVerify), errors.As(err, &recordHeader):
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
