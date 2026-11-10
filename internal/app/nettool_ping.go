package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	netPingDefaultCount   = 4
	netPingDefaultMaxLoss = 50
)

// netPingPerPacket is how long one echo may stay unanswered (a variable so a
// test does not wait seconds for a lost packet).
var netPingPerPacket = time.Second

// pingStatsFrom turns the round-trip times of the answered packets into the
// numbers the UI shows. sent is how many packets went out.
func pingStatsFrom(rtts []time.Duration, sent int) PingStats {
	st := PingStats{Sent: sent, Received: len(rtts)}
	if sent > 0 {
		st.LossPct = (sent - len(rtts)) * 100 / sent
	}
	if len(rtts) == 0 {
		return st
	}
	min, max, sum := rtts[0], rtts[0], time.Duration(0)
	var jitter time.Duration
	for i, r := range rtts {
		if r < min {
			min = r
		}
		if r > max {
			max = r
		}
		sum += r
		if i > 0 {
			d := r - rtts[i-1]
			if d < 0 {
				d = -d
			}
			jitter += d
		}
		st.RTTs = append(st.RTTs, ceilMs(r))
	}
	st.MinMs, st.MaxMs = ceilMs(min), ceilMs(max)
	st.AvgMs = ceilMs(sum / time.Duration(len(rtts)))
	if len(rtts) > 1 {
		st.JitterMs = ceilMs(jitter / time.Duration(len(rtts)-1))
	}
	return st
}

// pingVerdict: up when something answered and the loss stays under the limit
// (default 50 %); slow (still up) when the average exceeds MaxMs.
func pingVerdict(st PingStats, c NetCheck) (ok, slow bool) {
	maxLoss := c.MaxLossPct
	if maxLoss <= 0 {
		maxLoss = netPingDefaultMaxLoss
	}
	ok = st.Received > 0 && st.LossPct < maxLoss
	slow = ok && c.MaxMs > 0 && st.AvgMs > c.MaxMs
	return ok, slow
}

// runPing sends ICMP echoes to the first address the guard resolves. mode is
// the NetToolsPing setting: "auto" falls back to a TCP connect when ICMP is not
// permitted, "tcp-only" goes straight to TCP, "off" refuses.
func (h *Handlers) runPing(ctx context.Context, g netGuard, t netTarget, c NetCheck, mode string) NetResult {
	res := netCheckResult(c, t)
	switch mode {
	case "off":
		res.Class, res.Error = "icmp", "Ping is switched off"
		return res
	case "tcp-only":
		return h.pingViaTCP(ctx, g, t, c, res)
	}
	addrs, err := g.resolve(ctx, t.Host)
	if err != nil {
		return g.netFail(ctx, res, err, netPingPerPacket)
	}
	count := c.Count
	if count <= 0 {
		count = netPingDefaultCount
	}
	if count > 10 {
		count = 10
	}
	rtts, err := g.icmpEcho(ctx, addrs[0], count, netPingPerPacket)
	if errors.Is(err, errICMPNotPermitted) {
		return h.pingViaTCP(ctx, g, t, c, res)
	}
	res.IP = addrs[0].String()
	if err != nil && len(rtts) == 0 {
		return g.netFail(ctx, res, err, netRunDeadline)
	}
	st := pingStatsFrom(rtts, count)
	res.Ping = &st
	res.Ms = st.AvgMs
	res.Secondary = st.LossPct
	res.OK, res.Slow = pingVerdict(st, c)
	var parts []string
	if st.LossPct > 0 {
		parts = append(parts, fmt.Sprintf("loss %d%%", st.LossPct))
	}
	if res.Slow {
		parts = append(parts, "slow")
	}
	res.Detail = strings.Join(parts, " · ")
	if !res.OK {
		res.Class = "timeout"
		if st.Received == 0 {
			res.Error = "No ping answers came back."
		} else {
			res.Error = fmt.Sprintf("Too many packets were lost (%d%%).", st.LossPct)
		}
	}
	return res
}

// pingViaTCP is the ping fallback: a TCP connect to the URL's port, else 443
// then 80, through the guard. The result says it is not a real ping.
func (h *Handlers) pingViaTCP(ctx context.Context, g netGuard, t netTarget, c NetCheck, res NetResult) NetResult {
	ports := []int{443, 80}
	if t.FallbackPort > 0 {
		ports = []int{t.FallbackPort}
	}
	var last NetResult
	for _, port := range ports {
		tt := t
		tt.Port = port
		tc := c
		tc.Type, tc.MaxMs = netTypeTCP, 0
		r := h.runTCP(ctx, g, tt, tc)
		if r.OK {
			res.Port, res.IP, res.Ms = port, r.IP, r.Ms
			res.OK, res.ViaTCP, res.TCP = true, true, r.TCP
			res.Ping = &PingStats{Sent: 1, Received: 1, MinMs: r.Ms, AvgMs: r.Ms, MaxMs: r.Ms, RTTs: []int{r.Ms}, ViaTCP: true}
			res.Detail = "via TCP"
			if c.MaxMs > 0 && res.Ms > c.MaxMs {
				res.Slow = true
				res.Detail = "via TCP · slow"
			}
			return res
		}
		last = r
		if last.Class == "guard" || last.Class == "demo" || last.Class == "dns" {
			break
		}
	}
	res.Port, res.Ms, res.ViaTCP = last.Port, last.Ms, true
	res.Class, res.Error, res.TCP = last.Class, last.Error, last.TCP
	return res
}
