package main

import (
	"context"
	"net/netip"
	"testing"
	"time"
)

func TestPinnedHostAddrsReuseResolvedIPs(t *testing.T) {
	globalHostIPPin.mu.Lock()
	globalHostIPPin.entries = make(map[string]hostIPPinEntry)
	globalHostIPPin.mu.Unlock()

	public := netip.MustParseAddr("93.184.216.34")
	pinHostAddrs("example.com", []netip.Addr{public})

	got, ok := pinnedHostAddrs("example.com")
	if !ok || len(got) != 1 || got[0] != public {
		t.Fatalf("pinnedHostAddrs() = %v, %v; want [%v]", got, ok, public)
	}

	globalHostIPPin.mu.Lock()
	globalHostIPPin.entries["example.com"] = hostIPPinEntry{
		addrs:   []netip.Addr{public},
		expires: time.Now().Add(-time.Second),
	}
	globalHostIPPin.mu.Unlock()

	if _, ok := pinnedHostAddrs("example.com"); ok {
		t.Fatal("expired pin should be ignored")
	}
}

func TestResolvePinnedHostAddrsUsesCacheWithoutLookup(t *testing.T) {
	globalHostIPPin.mu.Lock()
	globalHostIPPin.entries = make(map[string]hostIPPinEntry)
	globalHostIPPin.mu.Unlock()

	public := netip.MustParseAddr("1.1.1.1")
	pinHostAddrs("cached.example", []netip.Addr{public})

	addrs, err := resolvePinnedHostAddrs(context.Background(), "cached.example", false)
	if err != nil {
		t.Fatalf("resolvePinnedHostAddrs() error: %v", err)
	}
	if len(addrs) != 1 || addrs[0] != public {
		t.Fatalf("resolvePinnedHostAddrs() = %v, want [%v]", addrs, public)
	}
}
