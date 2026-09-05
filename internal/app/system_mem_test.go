package app

import (
	"path/filepath"
	"testing"
)

const kB = uint64(1024)

func TestParseMemInfo(t *testing.T) {
	got, err := parseMemInfo(readProcFixture(t, "meminfo"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := 8123872 * kB; got.TotalBytes != want {
		t.Fatalf("total = %d, want %d", got.TotalBytes, want)
	}
	if want := 7330932 * kB; got.AvailableBytes != want {
		t.Fatalf("available = %d, want %d", got.AvailableBytes, want)
	}
	if want := (294176 + 4597552) * kB; got.CacheBytes != want {
		t.Fatalf("cache = %d, want buffers+cached = %d", got.CacheBytes, want)
	}
	if want := 1048572 * kB; got.SwapTotalBytes != want {
		t.Fatalf("swap total = %d, want %d", got.SwapTotalBytes, want)
	}
	if want := (1048572 - 786432) * kB; got.SwapUsedBytes != want {
		t.Fatalf("swap used = %d, want %d", got.SwapUsedBytes, want)
	}
}

/*
Used is total minus MemAvailable, not total minus MemFree.

Page cache and buffers are handed back the moment anything asks for them, so
counting them as used is what makes a perfectly healthy Linux box look
permanently full -- the single most common way this number is reported wrongly.
*/
func TestMemoryUsedExcludesReclaimable(t *testing.T) {
	got, err := parseMemInfo(readProcFixture(t, "meminfo"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if want := (8123872 - 7330932) * kB; got.UsedBytes != want {
		t.Fatalf("used = %d, want %d", got.UsedBytes, want)
	}
	// The MemFree-based figure is the wrong one, and much larger: 5.7 GiB of
	// "used" on a machine that is really using 0.8.
	freeBased := (8123872 - 2375708) * kB
	if got.UsedBytes >= freeBased {
		t.Fatalf("used %d should be well below the MemFree figure %d", got.UsedBytes, freeBased)
	}
}

// The three parts add up to the whole, which is what a bar can be drawn from.
func TestMemoryPartsAccountForTheWhole(t *testing.T) {
	got, _ := parseMemInfo(readProcFixture(t, "meminfo"))
	if got.UsedBytes+got.CacheBytes+got.FreeBytes < got.TotalBytes/2 {
		t.Fatal("used, cache and free should account for most of the machine")
	}
	if got.UsedPercent <= 0 || got.UsedPercent >= 100 {
		t.Fatalf("usedPercent = %v, want a real share", got.UsedPercent)
	}
}

func TestParseMemInfoRejectsGarbage(t *testing.T) {
	if _, err := parseMemInfo([]byte("nothing useful here")); err == nil {
		t.Fatal("expected an error for a malformed /proc/meminfo")
	}
}

// A machine with swap turned off is not a failure, and reports no swap rather
// than nought-of-nought.
func TestMemoryWithoutSwap(t *testing.T) {
	got, err := parseMemInfo([]byte("MemTotal: 100 kB\nMemAvailable: 40 kB\nMemFree: 30 kB\n"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.HasSwap {
		t.Fatal("expected no swap to be reported")
	}
}

func TestMemoryUnavailableWithoutProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", filepath.Join(t.TempDir(), "absent"))
	got := readMemory()
	if got.Available {
		t.Fatal("expected unavailable when /proc is missing")
	}
	if got.TotalBytes != 0 || got.UsedBytes != 0 {
		t.Fatal("an unavailable source must not report figures")
	}
}

// The fixture stands in for a mounted host /proc, which is how this
// Linux-only code stays testable on the development machine.
func TestMemoryReadsAMountedProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", filepath.Join("testdata", "proc"))
	got := readMemory()
	if !got.Available {
		t.Fatalf("expected available, got reason %q", got.Reason)
	}
	if got.TotalBytes == 0 {
		t.Fatal("total is zero")
	}
	if !got.HasSwap {
		t.Fatal("the fixture has swap, so it should be reported")
	}
}
