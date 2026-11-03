package app

import (
	"net"
	"strings"
	"time"
)

/*
The "this server has no network" guard.

After a reboot or a wifi change the first sweep can run before the machine is
online. Every lookup then fails with "DNS lookup failed", and without a guard
that writes a broken status onto every bookmark, a failing sample onto every
monitor's history and a pile of fake rot into the Bookmarks view and its Work
through list. A DNS or TLS failure is rightly a statement about the host
(failureIsUncertain), so the per-bookmark rules cannot tell: the evidence is
that nearly *every* host failed at the transport level in one sweep.

The decision uses only the results the sweep already has. Nothing is probed and
nothing is sent to any third party.
*/

const (
	// networkGuardMinHosts is how many distinct hosts a sweep must cover before
	// it can look offline. Under that, a few dead sites are just a few dead
	// sites, and a small collection must never trip the guard.
	networkGuardMinHosts = 10
	// networkGuardFailedPercent is the share of those hosts that must have
	// failed. 80 rather than 100 so one cached or hosts-file entry that still
	// answers does not defeat the guard.
	networkGuardFailedPercent = 80
	// networkGuardTransportPercent is the share of the failures that must be
	// transport-level (DNS or timeout). A sweep where most failures are HTTP
	// 404s, TLS errors or content checks reached the network and is real rot.
	networkGuardTransportPercent = 80
	// networkGuardRetryAfter is when held-back checks are tried again: soon, as
	// the connection usually returns within a minute or two.
	networkGuardRetryAfter = 60 * time.Second
	// networkGuardMaxHold is how long consecutive offline-looking sweeps keep
	// holding failures back. A real long outage (the site list really is down,
	// or the uplink is gone for hours) must eventually be recorded, so after
	// this the failures are persisted as usual while the flag stays set.
	networkGuardMaxHold = 30 * time.Minute
	// networkGuardEpisodeGap is the longest pause between two offline-looking
	// sweeps that still counts as the same episode. A flag left over from before
	// a restart must not make the first sweep after a reboot look like the
	// thirty-first minute of an outage.
	networkGuardEpisodeGap = 10 * time.Minute
)

// sweepHostResult is one host's outcome in a sweep.
type sweepHostResult struct {
	Host     string
	Answered bool   // got a response of any kind, or is a name that never needs the internet
	Class    string // failureClass of the failure; only read when !Answered
}

// sweepLooksOffline is the pure decision: does this batch of per-host results
// look like the server itself has no connection?
//
// Results are folded by host: a host that answered in any of its results
// counts as answered. Hosts that never need the internet (IP addresses,
// loopback, private names such as .lan, .local, single-label names) count as
// answered whatever happened, and stay in the denominator, so an install that
// mostly checks its own LAN never trips the guard.
func sweepLooksOffline(results []sweepHostResult) bool {
	type state struct {
		answered bool
		class    string
	}
	hosts := map[string]*state{}
	for _, r := range results {
		host := strings.ToLower(strings.TrimSpace(r.Host))
		if host == "" {
			continue
		}
		s := hosts[host]
		if s == nil {
			s = &state{}
			hosts[host] = s
		}
		if r.Answered || hostNeedsNoInternet(host) {
			s.answered = true
			continue
		}
		if s.class == "" {
			s.class = r.Class
		}
	}
	if len(hosts) < networkGuardMinHosts {
		return false
	}
	failed, transport := 0, 0
	for _, s := range hosts {
		if s.answered {
			continue
		}
		failed++
		if s.class == "dns" || s.class == "timeout" || s.class == "refused" {
			transport++
		}
	}
	if failed*100 < networkGuardFailedPercent*len(hosts) {
		return false
	}
	return transport*100 >= networkGuardTransportPercent*failed
}

// hostNeedsNoInternet is true for hosts a dead uplink cannot make fail: IP
// addresses, loopback, and names that only resolve on a local network.
func hostNeedsNoInternet(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
	if host == "" {
		return true
	}
	if net.ParseIP(strings.Trim(host, "[]")) != nil {
		return true
	}
	if !strings.Contains(host, ".") {
		return true
	}
	for _, suffix := range []string{".lan", ".local", ".localhost", ".internal", ".home", ".home.arpa", ".intranet", ".localdomain"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

// sweepHostResultFor turns one check into the pure function's input. ok is
// false for a check with no usable host (an invalid URL says nothing about
// the network).
func sweepHostResultFor(rawURL string, result PingResult) (sweepHostResult, bool) {
	host := monitorHostKey(rawURL)
	if host == "" {
		return sweepHostResult{}, false
	}
	if result.Status == "online" {
		return sweepHostResult{Host: host, Answered: true}, true
	}
	class := failureClass(result.ErrorDetail)
	// Guard-only reading of two classes the rest of the app keeps as they are.
	// "Unreachable" is what classifyPingError makes of the errors a machine
	// with no network gives on Linux and in Docker (server misbehaving from the
	// embedded resolver, network is unreachable, no route to host), and a
	// refused UDP read is the resolver's own port. Matched on the exact text so
	// "Invalid URL", "URL host is not allowed" and the demo's line stay out.
	if strings.TrimSpace(result.ErrorDetail) == "Unreachable" || class == "refused" {
		class = "timeout"
	}
	return sweepHostResult{Host: host, Class: class}, true
}

// holdableFailure is whether a failed check may be held back when a sweep looks
// offline: only a host that needs the internet. A failing LAN host, IP address
// or .local name is a real finding whatever the uplink is doing.
func holdableFailure(rawURL, status string) bool {
	if status == "online" {
		return false
	}
	return !hostNeedsNoInternet(monitorHostKey(rawURL))
}

// networkGuard records what one sweep looked like and says whether its
// failures must be held back (not persisted anywhere).
//
// The state lives in the health cache file (networkDownSince,
// lastOfflineSweepAt) so the Bookmarks view can say so and a restart does not
// forget it.
//
// start is when the sweep began and now when it ended: a long sweep (hundreds
// of sequential checks) must be judged against the episode from its start, or
// it would always look like a new one. ownsFlag is false for the browser's
// posted batches, which may hold failures during an episode but never start,
// refresh or clear one.
//
// Only a sweep in which a host that really needs the internet answered ends an
// episode. A sweep that is too small, or that merely does not look offline
// (a LAN-heavy install during an outage), leaves the episode to age out.
func (h *Handlers) networkGuard(results []sweepHostResult, start, now time.Time, ownsFlag bool) (hold bool) {
	looks := sweepLooksOffline(results)
	hosts, answeredOutside := sweepFacts(results)
	conclusive := hosts >= networkGuardMinHosts

	h.healthCacheMu.Lock()
	cache := readHealthCacheFile()
	before := cache.NetworkDownSince
	beforeLast := cache.LastOfflineSweepAt
	nowMs := now.UnixMilli()
	active := cache.NetworkDownSince > 0 && cache.LastOfflineSweepAt > 0 &&
		start.Sub(time.UnixMilli(cache.LastOfflineSweepAt)) <= networkGuardEpisodeGap
	switch {
	case ownsFlag && conclusive && looks:
		// Not the same episode when the last offline-looking sweep is long
		// gone (a restart, a pause): start counting again.
		if !active {
			cache.NetworkDownSince = nowMs
		}
		cache.LastOfflineSweepAt = nowMs
		hold = now.Sub(time.UnixMilli(cache.NetworkDownSince)) <= networkGuardMaxHold
	case answeredOutside:
		if ownsFlag {
			cache.NetworkDownSince = 0
			cache.LastOfflineSweepAt = 0
		}
	case active:
		hold = now.Sub(time.UnixMilli(cache.NetworkDownSince)) <= networkGuardMaxHold
	}
	changed := cache.NetworkDownSince != before || cache.LastOfflineSweepAt != beforeLast
	var err error
	if changed {
		err = writeHealthCacheFile(cache)
	}
	h.healthCacheMu.Unlock()
	if err != nil {
		// Without the episode on disk the hold cannot be told apart from a
		// new one next time; record normally rather than hold forever.
		logWarn(logComponentHealth, "the offline state could not be saved (%v)", err)
		hold = false
	}
	if changed {
		h.invalidateHealthReportCache()
	}
	if hold && before == 0 {
		logWarn(logComponentHealth, "almost every host failed to resolve or answer; this server looks offline, so the failures are not recorded and the checks are tried again shortly")
	}
	return hold
}

// sweepFacts counts the distinct hosts in a sweep and says whether any host
// that really needs the internet answered.
func sweepFacts(results []sweepHostResult) (hosts int, answeredOutside bool) {
	seen := map[string]bool{}
	for _, r := range results {
		host := strings.ToLower(strings.TrimSpace(r.Host))
		if host == "" {
			continue
		}
		seen[host] = true
		if r.Answered && !hostNeedsNoInternet(host) {
			answeredOutside = true
		}
	}
	return len(seen), answeredOutside
}

// networkDownFor is what the health report carries while failures are being
// held back; nil otherwise. After the hold has expired (a long outage that is
// being recorded) the line would say "paused" and be wrong, so it goes.
func networkDownFor(cache HealthScanCacheFile) *NetworkDownInfo {
	if cache.NetworkDownSince <= 0 {
		return nil
	}
	last := cache.LastOfflineSweepAt
	if last <= 0 {
		last = cache.NetworkDownSince
	}
	if time.UnixMilli(last).Sub(time.UnixMilli(cache.NetworkDownSince)) > networkGuardMaxHold {
		return nil
	}
	// Nothing has swept for a while (the server was off, say): not a statement
	// about now.
	if time.Since(time.UnixMilli(last)) > networkGuardEpisodeGap {
		return nil
	}
	return &NetworkDownInfo{Since: cache.NetworkDownSince, LastSweepAt: last}
}

// NetworkDownInfo is the report's note that failures are being held back
// because this server has no connection.
type NetworkDownInfo struct {
	Since       int64 `json:"since"`
	LastSweepAt int64 `json:"lastSweepAt"`
}
