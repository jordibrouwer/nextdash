package app

import (
	"context"
	"fmt"
	"time"
)

const netTCPDefaultTimeout = 5 * time.Second

// netCheckTimeout is the check's own timeout (1..10 s) or the type's default.
func netCheckTimeout(c NetCheck, def time.Duration) time.Duration {
	if c.TimeoutSec > 0 {
		if c.TimeoutSec > 10 {
			return 10 * time.Second
		}
		return time.Duration(c.TimeoutSec) * time.Second
	}
	return def
}

// ceilMs is a duration in whole milliseconds, never 0 for a real measurement
// (a LAN answer in 300 µs is 1 ms, not "no time").
func ceilMs(d time.Duration) int {
	ms := int((d + 500*time.Microsecond) / time.Millisecond)
	if ms < 1 && d > 0 {
		ms = 1
	}
	return ms
}

// runTCP opens a TCP connection through the guard and closes it again.
func (h *Handlers) runTCP(ctx context.Context, g netGuard, t netTarget, c NetCheck) NetResult {
	res := netCheckResult(c, t)
	timeout := netCheckTimeout(c, netTCPDefaultTimeout)
	dialCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	conn, ip, err := g.dialTCP(dialCtx, t.Host, t.Port, timeout)
	elapsed := time.Since(start)
	res.Ms = ceilMs(elapsed)
	if err != nil {
		res = g.netFail(ctx, res, err, timeout)
		res.TCP = &TCPResult{Open: false, Port: t.Port}
		return res
	}
	_ = conn.Close()
	res.OK = true
	res.IP = ip.String()
	res.TCP = &TCPResult{Open: true, ConnectMs: res.Ms, IP: res.IP, Port: t.Port}
	res.Detail = fmt.Sprintf("%d open", t.Port)
	if c.MaxMs > 0 && res.Ms > c.MaxMs {
		res.Slow = true
		res.Detail = "slow"
	}
	return res
}
