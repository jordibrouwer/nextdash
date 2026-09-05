package app

import "testing"

// statfs against a path that certainly exists. Exact figures belong to the
// machine, so this pins the shape and the invariants rather than numbers.
func TestReadDisksReportsRealFigures(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/"}, nil)

	if !got.Available {
		t.Fatalf("expected available, got reason %q", got.Reason)
	}
	if len(got.Mounts) != 1 {
		t.Fatalf("got %d mounts, want 1", len(got.Mounts))
	}
	m := got.Mounts[0]
	if m.TotalBytes == 0 {
		t.Fatal("total is zero")
	}
	if m.FreeBytes > m.TotalBytes {
		t.Fatalf("free %d exceeds total %d", m.FreeBytes, m.TotalBytes)
	}
	// used + available + reserved is the whole disk, which is the arithmetic
	// every figure on the tile is read against.
	if m.UsedBytes+m.FreeBytes+m.ReservedBytes != m.TotalBytes {
		t.Fatalf("used %d + free %d + reserved %d != total %d",
			m.UsedBytes, m.FreeBytes, m.ReservedBytes, m.TotalBytes)
	}
	if m.Path != "/" {
		t.Fatalf("path = %q, want / -- the host's name for it, not the container's", m.Path)
	}
	if m.UsedPercent < 0 || m.UsedPercent > 100 {
		t.Fatalf("usedPercent = %v, want 0..100", m.UsedPercent)
	}
}

/*
Used counts what the filesystem gave away, which is not the same as what is
left over from what a reader can still write.

Reserved blocks belong to root: they are neither used nor available. Counting
them as free overstates the room by whole gigabytes on a big disk, and counting
them as used makes a fresh filesystem look dirty.
*/
func TestReadDisksSeparatesReservedFromFree(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/"}, nil)
	m := got.Mounts[0]

	// Whatever this filesystem reserves, free is what a reader may actually
	// have -- never more than the kernel's own free count.
	if m.FreeBytes > m.TotalBytes-m.UsedBytes {
		t.Fatalf("free %d exceeds total-used %d", m.FreeBytes, m.TotalBytes-m.UsedBytes)
	}
}

// One unreadable mount is that mount's problem. An array with a disk spun down
// or unmounted must not blank the whole tile.
func TestReadDisksIsolatesOneBadMount(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/", "/definitely/not/here"}, nil)

	if !got.Available {
		t.Fatal("one bad mount must not make the whole source unavailable")
	}
	if len(got.Mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(got.Mounts))
	}
	if got.Mounts[0].Error != "" {
		t.Fatalf("the good mount carries error %q", got.Mounts[0].Error)
	}
	if got.Mounts[1].Error == "" {
		t.Fatal("the bad mount should carry an error")
	}
	if got.Mounts[1].TotalBytes != 0 {
		t.Fatal("a failed mount must not report figures")
	}
}

// The label is what makes a tile read "System / Media / Files" rather than
// three paths.
func TestReadDisksUsesConfiguredLabel(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/"}, map[string]string{"/": "System"})
	if got.Mounts[0].Label != "System" {
		t.Fatalf("label = %q, want System", got.Mounts[0].Label)
	}
}

// Mountpoints are reader input arriving at a syscall.
func TestReadDisksRefusesEscapingPath(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/mnt")
	got := readDisks([]string{"/../../etc"}, nil)
	if len(got.Mounts) != 1 || got.Mounts[0].Error == "" {
		t.Fatal("expected the escaping path to be refused")
	}
}

// Nothing chosen is not a failure, but there is nothing to report either.
func TestReadDisksWithNoPathsIsUnavailable(t *testing.T) {
	got := readDisks(nil, nil)
	if got.Available {
		t.Fatal("no configured mounts means nothing to report")
	}
	if got.Reason != reasonNoMountsConfigured {
		t.Fatalf("reason = %q, want %q", got.Reason, reasonNoMountsConfigured)
	}
}

// The totals across every readable mount, so a tile can lead with one figure
// rather than making the reader add disks up.
func TestReadDisksTotalsAcrossMounts(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/", "/definitely/not/here"}, nil)

	if got.TotalBytes != got.Mounts[0].TotalBytes {
		t.Fatalf("total %d should count only the readable mount (%d)",
			got.TotalBytes, got.Mounts[0].TotalBytes)
	}
	if got.UsedBytes+got.FreeBytes > got.TotalBytes {
		t.Fatal("used + free cannot exceed the total")
	}
	if got.Readable != 1 {
		t.Fatalf("readable = %d, want 1 of 2", got.Readable)
	}
}
