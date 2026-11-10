package app

import (
	"context"
	"net"
	"strconv"
	"testing"
	"time"
)

func tcpListener(t *testing.T) (port int, closeFn func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			c.Close()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, func() { ln.Close() }
}

func TestNetTCPOpen(t *testing.T) {
	h, _ := patchTestHandlers(t)
	port, stop := tcpListener(t)
	defer stop()
	res := h.runTCP(context.Background(), netGuard{allowLocal: true},
		netTarget{Host: "127.0.0.1", Port: port}, NetCheck{ID: "c1", Type: netTypeTCP})
	if !res.OK || res.Slow || res.Class != "" || res.IP != "127.0.0.1" || res.Port != port || res.Ms < 1 {
		t.Fatalf("%+v", res)
	}
	if res.TCP == nil || !res.TCP.Open || res.TCP.IP != "127.0.0.1" || res.Detail != strconv.Itoa(port)+" open" {
		t.Fatalf("tcp %+v detail %q", res.TCP, res.Detail)
	}
	// The same check through the guard that guards the handler: the loopback is refused while local is off.
	blocked := h.runTCP(context.Background(), netGuard{allowLocal: false},
		netTarget{Host: "127.0.0.1", Port: port}, NetCheck{Type: netTypeTCP})
	if blocked.OK || blocked.Class != "guard" || blocked.Error == "" {
		t.Fatalf("guard: %+v", blocked)
	}
}

func TestNetTCPRefused(t *testing.T) {
	h, _ := patchTestHandlers(t)
	port, stop := tcpListener(t)
	stop() // nothing listens on this port any more
	time.Sleep(20 * time.Millisecond)
	res := h.runTCP(context.Background(), netGuard{allowLocal: true},
		netTarget{Host: "127.0.0.1", Port: port}, NetCheck{Type: netTypeTCP})
	if res.OK || res.Class != "refused" || res.Error == "" || res.TCP == nil || res.TCP.Open {
		t.Fatalf("%+v", res)
	}
}

// A dial that never answers: the hook waits for the context, so the timeout is
// deterministic without a non-routable address.
func TestNetTCPTimeout(t *testing.T) {
	h, _ := patchTestHandlers(t)
	g := netGuard{allowLocal: true, dialHook: func(ctx context.Context, network, address string) (net.Conn, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	res := h.runTCP(ctx, g, netTarget{Host: "127.0.0.1", Port: 9}, NetCheck{Type: netTypeTCP})
	if res.OK || res.Class != "timeout" || res.Error == "" {
		t.Fatalf("%+v", res)
	}
}

func TestNetTCPSlowIsUpWithDetail(t *testing.T) {
	h, _ := patchTestHandlers(t)
	g := netGuard{allowLocal: true, dialHook: func(ctx context.Context, network, address string) (net.Conn, error) {
		time.Sleep(30 * time.Millisecond)
		a, b := net.Pipe()
		b.Close()
		return a, nil
	}}
	res := h.runTCP(context.Background(), g, netTarget{Host: "127.0.0.1", Port: 443}, NetCheck{Type: netTypeTCP, MaxMs: 5})
	if !res.OK || !res.Slow || res.Detail != "slow" {
		t.Fatalf("%+v", res)
	}
	fast := h.runTCP(context.Background(), g, netTarget{Host: "127.0.0.1", Port: 443}, NetCheck{Type: netTypeTCP, MaxMs: 5000})
	if !fast.OK || fast.Slow || fast.Detail != "443 open" {
		t.Fatalf("under the limit: %+v", fast)
	}
}

func TestRunNetCheckRoutesTCP(t *testing.T) {
	h, store := patchTestHandlers(t)
	s := store.GetSettings()
	s.AllowLocalBookmarks = true
	_ = store.SaveSettings(s)
	port, stop := tcpListener(t)
	defer stop()
	res := h.runNetCheck(context.Background(), Bookmark{URL: "http://127.0.0.1/"}, NetCheck{ID: "z", Type: netTypeTCP, Port: port})
	if !res.OK || res.CheckID != "z" || res.Host != "127.0.0.1" || res.Port != port {
		t.Fatalf("%+v", res)
	}
}
