package app

import (
	"context"
	"fmt"
	"net"
	"net/netip"
	"strings"
	"sync"
	"time"
)

const hostIPPinTTL = 2 * time.Minute

type hostIPPinEntry struct {
	addrs   []netip.Addr
	expires time.Time
}

type hostIPPinCache struct {
	mu      sync.Mutex
	entries map[string]hostIPPinEntry
}

var globalHostIPPin = &hostIPPinCache{
	entries: make(map[string]hostIPPinEntry),
}

func normalizePinHost(host string) string {
	return strings.ToLower(strings.TrimSpace(host))
}

func netIPAddrsToPin(addrs []net.IPAddr) []netip.Addr {
	pinned := make([]netip.Addr, 0, len(addrs))
	for _, addr := range addrs {
		ip, ok := netip.AddrFromSlice(addr.IP)
		if !ok {
			continue
		}
		pinned = append(pinned, ip)
	}
	return pinned
}

func pinHostAddrs(host string, addrs []netip.Addr) {
	host = normalizePinHost(host)
	if host == "" || len(addrs) == 0 {
		return
	}
	now := time.Now()
	globalHostIPPin.mu.Lock()
	defer globalHostIPPin.mu.Unlock()
	// Entries were only ever dropped when the same host was looked up again, so
	// a host resolved once and never revisited stayed pinned for the process
	// lifetime. Swept here, under the lock we already hold.
	if len(globalHostIPPin.entries) > hostIPPinSweepThreshold {
		for pinned, entry := range globalHostIPPin.entries {
			if pinned != host && now.After(entry.expires) {
				delete(globalHostIPPin.entries, pinned)
			}
		}
	}
	globalHostIPPin.entries[host] = hostIPPinEntry{
		addrs:   append([]netip.Addr(nil), addrs...),
		expires: now.Add(hostIPPinTTL),
	}
}

// hostIPPinSweepThreshold is the entry count above which pinHostAddrs drops
// expired pins. High enough that a normal instance never sweeps.
const hostIPPinSweepThreshold = 512

func pinnedHostAddrs(host string) ([]netip.Addr, bool) {
	host = normalizePinHost(host)
	if host == "" {
		return nil, false
	}
	globalHostIPPin.mu.Lock()
	defer globalHostIPPin.mu.Unlock()
	entry, ok := globalHostIPPin.entries[host]
	if !ok || time.Now().After(entry.expires) || len(entry.addrs) == 0 {
		if ok {
			delete(globalHostIPPin.entries, host)
		}
		return nil, false
	}
	return append([]netip.Addr(nil), entry.addrs...), true
}

func resolvePinnedHostAddrs(ctx context.Context, host string, allowLocal bool) ([]netip.Addr, error) {
	host = normalizePinHost(host)
	if host == "" {
		return nil, fmt.Errorf("empty host")
	}
	if addrs, ok := pinnedHostAddrs(host); ok {
		return addrs, nil
	}

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no addresses for host")
	}

	addrs := make([]netip.Addr, 0, len(ips))
	for _, ipAddr := range ips {
		addr, ok := netip.AddrFromSlice(ipAddr.IP)
		if !ok || !isAllowedDialIP(addr, allowLocal) {
			return nil, fmt.Errorf("dial to disallowed IP")
		}
		addrs = append(addrs, addr)
	}

	pinHostAddrs(host, addrs)
	return addrs, nil
}
