package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"sync"
	"syscall"
	"testing"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

// fakeICMP answers echo requests without a real socket. drop decides per
// sequence number whether the reply is lost. Replies carry another echo ID,
// like an unprivileged Linux socket does.
type fakeICMP struct {
	mu       sync.Mutex
	dsts     []net.Addr
	replies  chan fakeReply
	deadline time.Time
	drop     func(seq int) bool
	from     net.Addr
	keepID   bool // reply with the request's own echo ID (a raw socket)
}

type fakeReply struct {
	b    []byte
	peer net.Addr
}

func (f *fakeICMP) WriteTo(b []byte, dst net.Addr) (int, error) {
	f.mu.Lock()
	f.dsts = append(f.dsts, dst)
	f.mu.Unlock()
	msg, err := icmp.ParseMessage(1, b)
	if err != nil {
		return 0, err
	}
	echo := msg.Body.(*icmp.Echo)
	if f.drop != nil && f.drop(echo.Seq) {
		return len(b), nil
	}
	replyID := echo.ID + 1
	if f.keepID {
		replyID = echo.ID
	}
	reply := icmp.Message{Type: ipv4.ICMPTypeEchoReply, Body: &icmp.Echo{ID: replyID, Seq: echo.Seq, Data: echo.Data}}
	wire, _ := reply.Marshal(nil)
	peer := f.from
	if peer == nil {
		peer = dst
	}
	f.replies <- fakeReply{wire, peer}
	return len(b), nil
}

func (f *fakeICMP) ReadFrom(b []byte) (int, net.Addr, error) {
	f.mu.Lock()
	d := f.deadline
	f.mu.Unlock()
	wait := time.Until(d)
	if wait < 0 {
		wait = 0
	}
	select {
	case r := <-f.replies:
		return copy(b, r.b), r.peer, nil
	case <-time.After(wait):
		return 0, nil, os.ErrDeadlineExceeded
	}
}
func (f *fakeICMP) SetReadDeadline(t time.Time) error {
	f.mu.Lock()
	f.deadline = t
	f.mu.Unlock()
	return nil
}
func (f *fakeICMP) Close() error { return nil }

// useFakeICMP swaps the socket opener for the test and restores everything.
func useFakeICMP(t *testing.T, open func(network, address string) (icmpPacketConn, error)) {
	t.Helper()
	old, oldPer := listenICMP, netPingPerPacket
	listenICMP = open
	netPingPerPacket = 40 * time.Millisecond
	icmpState.Store(icmpUnknown)
	t.Cleanup(func() { listenICMP, netPingPerPacket = old, oldPer; icmpState.Store(icmpUnknown) })
}

func newFakeICMP(drop func(int) bool) *fakeICMP {
	return &fakeICMP{replies: make(chan fakeReply, 16), drop: drop}
}

func notPermitted(string, string) (icmpPacketConn, error) {
	return nil, &net.OpError{Op: "listen", Err: syscall.EPERM}
}

func TestNetPingStatsAndVerdict(t *testing.T) {
	st := pingStatsFrom([]time.Duration{10 * time.Millisecond, 30 * time.Millisecond}, 4)
	if st.Sent != 4 || st.Received != 2 || st.LossPct != 50 || st.MinMs != 10 || st.MaxMs != 30 || st.AvgMs != 20 || st.JitterMs != 20 {
		t.Fatalf("%+v", st)
	}
	if st := pingStatsFrom([]time.Duration{300 * time.Microsecond}, 1); st.AvgMs != 1 {
		t.Fatalf("a sub-millisecond answer must not read as 0 ms: %+v", st)
	}
}

func TestNetPingLossVerdict(t *testing.T) {
	// Default limit 50 %: losing half is down, losing a quarter is up.
	if ok, _ := pingVerdict(PingStats{Sent: 4, Received: 2, LossPct: 50}, NetCheck{}); ok {
		t.Fatal("50% loss against the default limit of 50 must be down")
	}
	if ok, _ := pingVerdict(PingStats{Sent: 4, Received: 3, LossPct: 25}, NetCheck{}); !ok {
		t.Fatal("25% loss must be up")
	}
	if ok, _ := pingVerdict(PingStats{Sent: 4, Received: 0, LossPct: 100}, NetCheck{MaxLossPct: 100}); ok {
		t.Fatal("nothing answered is always down")
	}
	if ok, _ := pingVerdict(PingStats{Sent: 4, Received: 2, LossPct: 50}, NetCheck{MaxLossPct: 60}); !ok {
		t.Fatal("an explicit higher limit must be honoured")
	}
	// End to end through the echo loop.
	h, _ := patchTestHandlers(t)
	fake := newFakeICMP(func(seq int) bool { return seq%2 == 1 })
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) { return fake, nil })
	g := netGuard{allowLocal: false}
	res := h.runPing(context.Background(), g, netTarget{Host: "93.184.216.34"}, NetCheck{Type: netTypePing, Count: 4}, "auto")
	if res.OK || res.Class != "timeout" || res.Secondary != 50 || res.Ping == nil || res.Ping.Received != 2 {
		t.Fatalf("half lost: %+v", res)
	}
	fake = newFakeICMP(func(seq int) bool { return seq == 3 })
	res = h.runPing(context.Background(), g, netTarget{Host: "93.184.216.34"}, NetCheck{Type: netTypePing, Count: 4}, "auto")
	if !res.OK || res.Secondary != 25 || res.Detail != "loss 25%" || res.ViaTCP || res.Ms < 1 {
		t.Fatalf("a quarter lost: %+v", res)
	}
	if icmpState.Load() != icmpWorks {
		t.Fatal("a real echo must mark ICMP as working")
	}
}

func TestNetPingFallsBackToTCPWhenNotPermitted(t *testing.T) {
	h, _ := patchTestHandlers(t)
	useFakeICMP(t, notPermitted)
	port, stop := tcpListener(t)
	defer stop()
	res := h.runPing(context.Background(), netGuard{allowLocal: true},
		netTarget{Host: "127.0.0.1", FallbackPort: port}, NetCheck{Type: netTypePing}, "auto")
	if !res.OK || !res.ViaTCP || res.Detail != "via TCP" || res.Port != port || res.Ping == nil || !res.Ping.ViaTCP {
		t.Fatalf("%+v", res)
	}
	if icmpState.Load() != icmpBlocked {
		t.Fatal("a refused ICMP socket must mark ICMP as blocked")
	}
	// The fallback still goes through the guard.
	blocked := h.runPing(context.Background(), netGuard{allowLocal: false},
		netTarget{Host: "127.0.0.1", FallbackPort: port}, NetCheck{Type: netTypePing}, "auto")
	if blocked.OK || blocked.Class != "guard" {
		t.Fatalf("guard: %+v", blocked)
	}
}

func TestNetPingTCPOnlyMode(t *testing.T) {
	h, _ := patchTestHandlers(t)
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) {
		t.Fatal("tcp-only must not open an ICMP socket")
		return nil, errors.New("unreachable")
	})
	port, stop := tcpListener(t)
	defer stop()
	res := h.runPing(context.Background(), netGuard{allowLocal: true},
		netTarget{Host: "127.0.0.1", FallbackPort: port}, NetCheck{Type: netTypePing}, "tcp-only")
	if !res.OK || !res.ViaTCP {
		t.Fatalf("%+v", res)
	}
}

func TestNetPingOffMode(t *testing.T) {
	h, _ := patchTestHandlers(t)
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) {
		t.Fatal("off must not open an ICMP socket")
		return nil, errors.New("unreachable")
	})
	res := h.runPing(context.Background(), netGuard{allowLocal: true}, netTarget{Host: "127.0.0.1"}, NetCheck{Type: netTypePing}, "off")
	if res.OK || res.Class != "icmp" || res.Error != "Ping is switched off" {
		t.Fatalf("%+v", res)
	}
}

// The echo goes to the address the guard resolved, never to a name, and the
// guard refuses a private one before any socket opens.
func TestNetPingNeverByName(t *testing.T) {
	h, _ := patchTestHandlers(t)
	fake := newFakeICMP(nil)
	opened := 0
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) { opened++; return fake, nil })
	host := "ping-by-name.test"
	pinHostAddrs(host, []netip.Addr{netip.MustParseAddr("93.184.216.34")})
	t.Cleanup(func() {
		globalHostIPPin.mu.Lock()
		delete(globalHostIPPin.entries, host)
		globalHostIPPin.mu.Unlock()
	})
	res := h.runPing(context.Background(), netGuard{}, netTarget{Host: host}, NetCheck{Type: netTypePing, Count: 1}, "auto")
	if !res.OK || len(fake.dsts) != 1 {
		t.Fatalf("%+v dsts %v", res, fake.dsts)
	}
	if u, ok := fake.dsts[0].(*net.UDPAddr); !ok || u.IP.String() != "93.184.216.34" {
		t.Fatalf("the echo went to %v, want the resolved address", fake.dsts[0])
	}
	if res.IP != "93.184.216.34" {
		t.Fatalf("result IP %q", res.IP)
	}
	// A name that resolves to a private address never reaches the socket.
	pinHostAddrs("ping-private.test", []netip.Addr{netip.MustParseAddr("10.0.0.5")})
	t.Cleanup(func() {
		globalHostIPPin.mu.Lock()
		delete(globalHostIPPin.entries, "ping-private.test")
		globalHostIPPin.mu.Unlock()
	})
	before := opened
	priv := h.runPing(context.Background(), netGuard{allowLocal: false}, netTarget{Host: "ping-private.test"}, NetCheck{Type: netTypePing}, "auto")
	if priv.OK || priv.Class != "guard" || opened != before {
		t.Fatalf("private: %+v, sockets opened %d -> %d", priv, before, opened)
	}
}

// A reply from another host must not count as ours.
func TestNetPingIgnoresForeignReplies(t *testing.T) {
	fake := newFakeICMP(nil)
	fake.from = &net.UDPAddr{IP: net.ParseIP("8.8.8.8")}
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) { return fake, nil })
	rtts, err := (netGuard{}).icmpEcho(context.Background(), netip.MustParseAddr("93.184.216.34"), 2, 40*time.Millisecond)
	if err != nil || len(rtts) != 0 {
		t.Fatalf("rtts %v err %v", rtts, err)
	}
}

// A raw socket hears every echo reply on the machine, so a reply must carry
// our echo ID there; a datagram socket has its ID rewritten and only the
// sequence number and the source can be matched.
func TestNetICMPRawMatchesEchoID(t *testing.T) {
	addr := netip.MustParseAddr("93.184.216.34")
	rawOnly := func(fake *fakeICMP) func(string, string) (icmpPacketConn, error) {
		return func(network, _ string) (icmpPacketConn, error) {
			if network == "udp4" {
				return nil, &net.OpError{Op: "listen", Err: syscall.EPERM}
			}
			return fake, nil
		}
	}
	// Raw, the reply has another ID (someone else's ping): not ours.
	foreign := newFakeICMP(nil)
	useFakeICMP(t, rawOnly(foreign))
	rtts, _ := netGuard{}.icmpEcho(context.Background(), addr, 2, 40*time.Millisecond)
	if len(rtts) != 0 {
		t.Fatalf("a raw reply with a foreign echo ID was counted: %v", rtts)
	}
	// Raw, the reply keeps our ID: counted.
	own := newFakeICMP(nil)
	own.keepID = true
	useFakeICMP(t, rawOnly(own))
	rtts, _ = netGuard{}.icmpEcho(context.Background(), addr, 2, 40*time.Millisecond)
	if len(rtts) != 2 {
		t.Fatalf("a raw reply with our echo ID was not counted: %v", rtts)
	}
	// Datagram: the kernel rewrote the ID, the reply still counts.
	dgram := newFakeICMP(nil)
	useFakeICMP(t, func(string, string) (icmpPacketConn, error) { return dgram, nil })
	rtts, _ = netGuard{}.icmpEcho(context.Background(), addr, 2, 40*time.Millisecond)
	if len(rtts) != 2 {
		t.Fatalf("a datagram reply with a rewritten ID was not counted: %v", rtts)
	}
}
