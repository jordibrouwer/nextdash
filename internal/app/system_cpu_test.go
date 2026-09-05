package app

import (
	"os"
	"path/filepath"
	"testing"
)

func readProcFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "proc", name))
	if err != nil {
		t.Fatalf("fixture %s: %v", name, err)
	}
	return data
}

func TestParseProcStat(t *testing.T) {
	idle, total, cores, err := parseProcStat(readProcFixture(t, "stat"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// idle counts idle(8900000) + iowait(45000): both are time the processor
	// was not working.
	if want := uint64(8945000); idle != want {
		t.Fatalf("idle = %d, want %d", idle, want)
	}
	if want := uint64(10555000); total != want {
		t.Fatalf("total = %d, want %d", total, want)
	}
	if cores != 2 {
		t.Fatalf("cores = %d, want 2", cores)
	}
}

func TestParseLoadAvg(t *testing.T) {
	l1, l5, l15, err := parseLoadAvg(readProcFixture(t, "loadavg"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if l1 != 0.07 || l5 != 0.15 || l15 != 0.11 {
		t.Fatalf("load = %v %v %v, want 0.07 0.15 0.11", l1, l5, l15)
	}
}

/*
/proc/stat is cumulative, so a percentage is the delta between two reads. One
sample cannot produce one, and inventing a number from it would report an idle
machine as 0% busy when nothing has actually been measured yet.
*/
func TestCPUPercentNeedsTwoSamples(t *testing.T) {
	sampler := newCPUSampler()

	if first := sampler.percentFrom(8945000, 10555000); first != nil {
		t.Fatalf("first sample produced %v, want nil", *first)
	}

	second := sampler.percentFrom(8946610, 10557620)
	if second == nil {
		t.Fatal("second sample produced nil, want a percentage")
	}
	// busy delta 1010 of total delta 2620 = 38.5%
	if *second < 38.0 || *second > 39.0 {
		t.Fatalf("percent = %v, want ~38.5", *second)
	}
}

// A counter that went backwards means the machine rebooted or the mount
// changed underneath us. Reporting a negative or wild percentage from that is
// worse than waiting one beat for a fresh pair.
func TestCPUPercentIgnoresACounterReset(t *testing.T) {
	sampler := newCPUSampler()
	sampler.percentFrom(8945000, 10555000)
	if got := sampler.percentFrom(100, 200); got != nil {
		t.Fatalf("a counter reset produced %v, want nil", *got)
	}
}

func TestParseProcStatRejectsGarbage(t *testing.T) {
	if _, _, _, err := parseProcStat([]byte("not a proc file")); err == nil {
		t.Fatal("expected an error for a malformed /proc/stat")
	}
}

// A missing /proc says so rather than reporting a machine sitting at 0%.
func TestCPUUnavailableWithoutProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", filepath.Join(t.TempDir(), "absent"))
	got := newCPUSampler().Read()
	if got.Available {
		t.Fatal("expected unavailable when /proc is missing")
	}
	if got.Reason == "" {
		t.Fatal("expected a reason explaining why")
	}
	if got.Percent != nil {
		t.Fatal("an unavailable source must not report a percentage")
	}
}

// The fixture directory stands in for a mounted host /proc, which is how this
// Linux-only code stays testable on the development machine.
func TestCPUReadsAMountedProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", filepath.Join("testdata", "proc"))
	sampler := newCPUSampler()

	first := sampler.Read()
	if !first.Available {
		t.Fatalf("expected available, got reason %q", first.Reason)
	}
	if first.Percent != nil {
		t.Fatal("the first read has nothing to compare against yet")
	}
	if first.Load1 != 0.07 {
		t.Fatalf("load1 = %v, want 0.07 -- known from the first read", first.Load1)
	}
	if first.Cores != 2 {
		t.Fatalf("cores = %d, want 2", first.Cores)
	}

	// The same fixture read twice is a zero delta, which is a real answer
	// (nothing happened) rather than an error.
	second := sampler.Read()
	if second.Percent == nil {
		t.Fatal("the second read should produce a percentage")
	}
}
