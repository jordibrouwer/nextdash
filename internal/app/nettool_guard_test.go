package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Fase 0b: the guard is the only place network checks touch a socket.

func TestNetToolsNeverDialDirectly(t *testing.T) {
	re := regexp.MustCompile(`net\.Dial|DialTimeout|net\.Dialer\{|icmp\.ListenPacket|tls\.Dial|tls\.Client\(|net\.Resolver\{|DefaultResolver|LookupHost|LookupIP|http\.Client\{|http\.Transport\{`)
	files, _ := filepath.Glob("nettool_*.go")
	checked := 0
	for _, file := range files {
		if file == "nettool_guard.go" || strings.HasSuffix(file, "_test.go") {
			continue
		}
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		checked++
		if m := re.Find(src); m != nil {
			t.Errorf("%s uses %q; only nettool_guard.go may reach a socket or a resolver", file, m)
		}
	}
	if checked < 4 {
		t.Fatalf("only %d nettool files checked; the glob is wrong", checked)
	}
}

func TestNetGuardRefusesPrivateWhenLocalOff(t *testing.T) {
	ctx := context.Background()
	if _, err := (netGuard{allowLocal: false}).resolve(ctx, "127.0.0.1"); !errors.Is(err, errNetGuardBlocked) {
		t.Fatalf("loopback literal with local off: %v", err)
	}
	if _, err := (netGuard{allowLocal: false}).resolve(ctx, "192.168.1.20"); !errors.Is(err, errNetGuardBlocked) {
		t.Fatalf("private literal with local off: %v", err)
	}
	addrs, err := (netGuard{allowLocal: true}).resolve(ctx, "127.0.0.1")
	if err != nil || len(addrs) != 1 || addrs[0] != netip.MustParseAddr("127.0.0.1") {
		t.Fatalf("loopback with local on: %v %v", addrs, err)
	}
	if _, _, err := (netGuard{allowLocal: false}).dialTCP(ctx, "127.0.0.1", 9, time.Second); !errors.Is(err, errNetGuardBlocked) {
		t.Fatalf("dialTCP with local off: %v", err)
	}
}

// resolvePinnedHostAddrs hands back a cached pin without testing allowLocal
// again, and the cache is shared across allowLocal values (A8).
func TestNetGuardRefilterPinnedAddrs(t *testing.T) {
	host := "pinned-private.test"
	pinHostAddrs(host, []netip.Addr{netip.MustParseAddr("10.1.2.3")})
	t.Cleanup(func() {
		globalHostIPPin.mu.Lock()
		delete(globalHostIPPin.entries, host)
		globalHostIPPin.mu.Unlock()
	})
	if _, err := (netGuard{allowLocal: false}).resolve(context.Background(), host); !errors.Is(err, errNetGuardBlocked) {
		t.Fatalf("a pinned private address passed with local off: %v", err)
	}
	addrs, err := (netGuard{allowLocal: true}).resolve(context.Background(), host)
	if err != nil || len(addrs) != 1 {
		t.Fatalf("a pinned private address with local on: %v %v", addrs, err)
	}
}

func TestNetGuardDialTCPLocal(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		if c, err := ln.Accept(); err == nil {
			c.Close()
		}
	}()
	port := ln.Addr().(*net.TCPAddr).Port
	conn, ip, err := (netGuard{allowLocal: true}).dialTCP(context.Background(), "127.0.0.1", port, 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if ip != netip.MustParseAddr("127.0.0.1") || conn.RemoteAddr().(*net.TCPAddr).IP.String() != "127.0.0.1" {
		t.Fatalf("connected to %v / %v", ip, conn.RemoteAddr())
	}
}

func TestNetGuardDemoRefuses(t *testing.T) {
	t.Setenv("NEXTDASH_DEMO", "1")
	ctx := context.Background()
	g := netGuard{allowLocal: true}
	if _, err := g.resolve(ctx, "127.0.0.1"); !errors.Is(err, errDemoOutbound) {
		t.Fatalf("resolve in the demo: %v", err)
	}
	if _, _, err := g.dialTCP(ctx, "127.0.0.1", 80, time.Second); !errors.Is(err, errDemoOutbound) {
		t.Fatalf("dialTCP in the demo: %v", err)
	}
	if got := g.explainBlocked(ctx, "example.test"); got != nil {
		t.Fatalf("explainBlocked looked a host up in the demo: %v", got)
	}
	if cls := netErrorClass(errDemoOutbound); cls != "demo" {
		t.Fatalf("class %q", cls)
	}
	// Even with AllowLocalBookmarks on, a handler's guard never opens the local network in the demo.
	h, store := patchTestHandlers(t)
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if h.netGuard().allowLocal {
		t.Fatal("the demo guard allows the local network")
	}
}

func TestNetGuardFollowsTheSettingPerCall(t *testing.T) {
	h, store := patchTestHandlers(t)
	settings := store.GetSettings()
	settings.AllowLocalBookmarks = false
	_ = store.SaveSettings(settings)
	if h.netGuard().allowLocal {
		t.Fatal("local allowed while the setting is off")
	}
	settings.AllowLocalBookmarks = true
	_ = store.SaveSettings(settings)
	if !h.netGuard().allowLocal {
		t.Fatal("the guard cached the old setting")
	}
}

func TestNetGuardExplainBlockedDoesNotPin(t *testing.T) {
	g := netGuard{allowLocal: false}
	got := g.explainBlocked(context.Background(), "192.168.1.20")
	if len(got) != 1 || got[0] != netip.MustParseAddr("192.168.1.20") {
		t.Fatalf("explain: %v", got)
	}
	if _, ok := pinnedHostAddrs("192.168.1.20"); ok {
		t.Fatal("explainBlocked pinned an address")
	}
}

type timeoutErr struct{}

func (timeoutErr) Error() string   { return "i/o timeout" }
func (timeoutErr) Timeout() bool   { return true }
func (timeoutErr) Temporary() bool { return true }

func TestNetErrorClass(t *testing.T) {
	cases := []struct {
		err  error
		want string
	}{
		{nil, ""},
		{errNetGuardBlocked, "guard"},
		{errICMPNotPermitted, "icmp"},
		{errDemoOutbound, "demo"},
		{&net.DNSError{Err: "no such host", Name: "x"}, "dns"},
		{&net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}, "refused"},
		{context.DeadlineExceeded, "timeout"},
		{timeoutErr{}, "timeout"},
		{errors.New("x509: certificate signed by unknown authority"), "tls"},
		{errors.New("something odd"), "other"},
	}
	for _, c := range cases {
		if got := netErrorClass(c.err); got != c.want {
			t.Errorf("netErrorClass(%v) = %q, want %q", c.err, got, c.want)
		}
	}
	// Wrapped errors still classify by type, not by text.
	if got := netErrorClass(errors.Join(errors.New("wrapped"), errNetGuardBlocked)); got != "guard" {
		t.Errorf("wrapped guard error: %q", got)
	}
}
