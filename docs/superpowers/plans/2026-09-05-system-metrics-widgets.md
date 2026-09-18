# System Metrics Widgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four built-in dashboard widgets — CPU, memory, disks and Docker container count — that read host metrics on a per-widget refresh interval.

**Architecture:** One Go endpoint (`/api/system/metrics`) serves four independent sources, each reading the host through explicit read-only mounts and each reporting its own availability. The existing custom-widget refresh timer is widened from one hard-coded type to a per-type table, so built-in widgets can poll on their own cadence. Four renderers follow the established `window.DashboardWidgets.<type>` convention.

**Tech Stack:** Go 1.24 stdlib only (no new dependencies — `/proc` parsing, `syscall.Statfs`, `net/http` over a unix socket), vanilla JS widgets, Playwright for the browser tests.

**Spec:** `docs/superpowers/specs/2026-09-05-system-metrics-widgets-design.md`

## Global Constraints

- **No new Go dependencies.** The whole tree is `github.com/gorilla/mux v1.8.0` and `golang.org/x/net v0.38.0`. Docker is read with `net/http` over a unix socket; do not add the Docker SDK or gopsutil.
- **Target platform is Linux** — Unraid above all, then Synology/QNAP and plain Linux servers. macOS is a development machine only: CPU and memory report `available: false, reason: "unsupported-platform"` there.
- **Never fabricate a number.** An unavailable source returns `{"available": false, "reason": "..."}`, never zeros. The widget prints the reason.
- **Host access is opt-in** via three independent env vars: `NEXTDASH_HOST_PROC`, `NEXTDASH_HOST_ROOT`, `NEXTDASH_DOCKER_SOCKET`. Unset means that source is unavailable, not that it is guessed.
- **Refresh floors:** CPU 1s, memory 2s, Docker 2s, disks 5s. Maximum 3600s everywhere. The custom widget's own `ttl` field and its 30s floor are **not** touched.
- **Mountpoints are an explicit user list**, never auto-enumerated. Resolved paths are cleaned and must stay within the `NEXTDASH_HOST_ROOT` prefix.
- **Five locale files must stay in parity:** `locales/{en,nl,de,fr,zh}.json`.
- **Every new widget type touches 11 registration points.** Two fail loudly: `widgetTypeNames()` panics (`internal/app/widgets_config.go:378`) and `tests/dashboard-widgets-ring0.spec.js:44-47` asserts every offered type declares settings.
- **Tests:** `PW_WORKERS=2` for Playwright; never use port 8080 (the user's); write Playwright output to a file, never pipe to `tail` (a pipe reports exit 0 while tests fail).
- **Every behaviour change is falsified:** revert the fix, confirm the test fails, restore.
- **CHANGELOG.md gets a line for every change**, not only releases.

---

## File Structure

**Go — new:**
- `internal/app/system_source.go` — shared: env resolution, availability reasons, the `SourceStatus` shape
- `internal/app/system_cpu.go` — `/proc/stat` + `/proc/loadavg`, cumulative delta
- `internal/app/system_mem.go` — `/proc/meminfo`
- `internal/app/system_disk.go` — `syscall.Statfs` per configured mount, prefix-confined
- `internal/app/system_docker.go` — Docker Engine API over unix socket
- `internal/app/system_metrics.go` — cache + aggregation across sources
- `internal/app/handlers_system.go` — the HTTP handler
- Tests: `system_cpu_test.go`, `system_mem_test.go`, `system_disk_test.go`, `system_docker_test.go`, `system_metrics_test.go`, plus `testdata/proc/`

**Go — modified:**
- `internal/app/widgets.go` — four type constants + `knownWidgetTypes`
- `internal/app/widgets_config.go` — `widgetTypeNames` ordered slice + `widgetFields`
- `internal/app/main.go` — one route

**JS — new:**
- `static/js/dashboard/dashboard-widget-system.js` — shared fetch/cache/format for all four
- `static/js/dashboard/dashboard-widget-cpu.js`
- `static/js/dashboard/dashboard-widget-memory.js`
- `static/js/dashboard/dashboard-widget-disks.js`
- `static/js/dashboard/dashboard-widget-docker.js`

**JS — modified:**
- `static/js/dashboard/dashboard-render-core.js` — widen the timer gate
- `static/js/dashboard/dashboard-config.js` — `WIDGET_TYPES`, `WIDGET_SETTINGS`, `WIDGET_TYPE_GROUPS`, `widgetTypeAbout`
- `templates/dashboard.html` — five script tags

**Other:** five locale files, `docker-compose*.yml`, `MANUAL.md`, `CHANGELOG.md`, `internal/app/asset_hashes_gen.go` (generated).

---

## Task 1: Shared source plumbing

**Files:**
- Create: `internal/app/system_source.go`
- Test: `internal/app/system_source_test.go`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `type SourceStatus struct { Available bool `json:"available"`; Reason string `json:"reason,omitempty"` }`
  - `func hostProcDir() string` — `NEXTDASH_HOST_PROC`, else `/proc`
  - `func hostRootDir() string` — `NEXTDASH_HOST_ROOT`, else `""`
  - `func dockerSocketPath() string` — `NEXTDASH_DOCKER_SOCKET`, else `""`
  - `func resolveHostPath(userPath string) (string, error)` — prefixes and confines
  - Reason constants: `reasonNoHostProc`, `reasonUnsupportedPlatform`, `reasonNoDockerSocket`, `reasonReadFailed`

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"path/filepath"
	"testing"
)

func TestHostProcDirDefaultsToProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", "")
	if got := hostProcDir(); got != "/proc" {
		t.Fatalf("hostProcDir() = %q, want /proc", got)
	}
}

func TestHostProcDirHonoursEnv(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", "/host/proc")
	if got := hostProcDir(); got != "/host/proc" {
		t.Fatalf("hostProcDir() = %q, want /host/proc", got)
	}
}

// A configured mount is written the way the host knows it. With a prefix set,
// the server reads it inside the container without the settings UI ever
// showing the container's view.
func TestResolveHostPathPrefixes(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/mnt")
	got, err := resolveHostPath("/mnt/user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := filepath.Clean("/host/mnt/mnt/user"); got != want {
		t.Fatalf("resolveHostPath = %q, want %q", got, want)
	}
}

func TestResolveHostPathWithoutPrefixIsIdentity(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got, err := resolveHostPath("/mnt/user")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "/mnt/user" {
		t.Fatalf("resolveHostPath = %q, want /mnt/user", got)
	}
}

// Mountpoints are user input that reaches a syscall, so a path that climbs out
// of the prefix is refused rather than cleaned into something surprising.
func TestResolveHostPathRefusesEscape(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/mnt")
	if _, err := resolveHostPath("/../../etc/shadow"); err == nil {
		t.Fatal("expected an error for a path escaping the prefix")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run 'TestHostProcDir|TestResolveHostPath' -v`
Expected: FAIL — `undefined: hostProcDir`, `undefined: resolveHostPath`

- [ ] **Step 3: Write minimal implementation**

```go
package app

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

/*
Reading the host from inside a container.

nextDash ships as a container, and a container reading /proc sees its own
cgroup rather than the machine. So the host is reached through explicit,
read-only mounts named by these variables: set, the source is read; unset, it
is reported unavailable. Nothing is inferred, because a plausible wrong number
is worse than an honest gap.
*/

// SourceStatus is the availability half of every source's answer. A source
// that cannot be read says why rather than returning zeros.
type SourceStatus struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

const (
	reasonNoHostProc          = "no-host-proc"
	reasonUnsupportedPlatform = "unsupported-platform"
	reasonNoDockerSocket      = "no-docker-socket"
	reasonReadFailed          = "read-failed"
)

var errPathEscapesPrefix = errors.New("path escapes the host prefix")

func envPath(name string) string {
	return strings.TrimSpace(os.Getenv(name))
}

// hostProcDir is where /proc is readable. Outside a container that is /proc
// itself, which is why the default is not empty.
func hostProcDir() string {
	if v := envPath("NEXTDASH_HOST_PROC"); v != "" {
		return filepath.Clean(v)
	}
	return "/proc"
}

// hostRootDir is the prefix configured mountpoints are read through. Empty
// means paths are used as given -- the bare-metal case.
func hostRootDir() string {
	if v := envPath("NEXTDASH_HOST_ROOT"); v != "" {
		return filepath.Clean(v)
	}
	return ""
}

func dockerSocketPath() string {
	return envPath("NEXTDASH_DOCKER_SOCKET")
}

/*
resolveHostPath turns a mountpoint as the host knows it into one this process
can read.

The user configures /mnt/user because that is what their machine calls it; with
a prefix set that is read at /host/mnt/mnt/user. Keeping the translation here
means the settings UI never shows the container's view of anything.

Mountpoints are user input arriving at a syscall, so the result is confined to
the prefix: a path that climbs out is refused rather than quietly cleaned into
something else.
*/
func resolveHostPath(userPath string) (string, error) {
	clean := filepath.Clean("/" + strings.TrimSpace(userPath))
	prefix := hostRootDir()
	if prefix == "" {
		return clean, nil
	}
	joined := filepath.Clean(filepath.Join(prefix, clean))
	if joined != prefix && !strings.HasPrefix(joined, prefix+string(os.PathSeparator)) {
		return "", errPathEscapesPrefix
	}
	return joined, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app/ -run 'TestHostProcDir|TestResolveHostPath' -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Falsify the escape guard**

Temporarily change the `if joined != prefix && ...` guard to `if false`. Run the tests again: `TestResolveHostPathRefusesEscape` must FAIL. Restore the guard and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/app/system_source.go internal/app/system_source_test.go
git commit -m "add host path resolution for system metrics"
```

---

## Task 2: CPU source

**Files:**
- Create: `internal/app/system_cpu.go`, `internal/app/testdata/proc/stat`, `internal/app/testdata/proc/loadavg`
- Test: `internal/app/system_cpu_test.go`

**Interfaces:**
- Consumes: `hostProcDir()`, `SourceStatus`, reason constants (Task 1)
- Produces:
  - `type CPUMetrics struct { SourceStatus; Percent *float64 `json:"percent"`; Load1, Load5, Load15 float64 `json:"load1","load5","load15"`; Cores int `json:"cores"` }`
  - `type cpuSampler struct{ ... }` with `func newCPUSampler() *cpuSampler` and `func (s *cpuSampler) Read() CPUMetrics`
  - `func parseProcStat(data []byte) (idle, total uint64, cores int, err error)`
  - `func parseLoadAvg(data []byte) (l1, l5, l15 float64, err error)`

- [ ] **Step 1: Create the fixtures**

`internal/app/testdata/proc/stat`:
```
cpu  1250000 12000 340000 8900000 45000 0 8000 0 0 0
cpu0 320000 3000 85000 2220000 11000 0 2000 0 0 0
cpu1 310000 3000 85000 2230000 11000 0 2000 0 0 0
intr 123456789
ctxt 987654321
```

`internal/app/testdata/proc/loadavg`:
```
0.07 0.15 0.11 1/512 12345
```

`internal/app/testdata/proc/stat_second` (the same counters, advanced — used for the delta test):
```
cpu  1250400 12010 340100 8901600 45010 0 8010 0 0 0
cpu0 320100 3002 85025 2220400 11002 0 2002 0 0 0
cpu1 310100 3002 85025 2220400 11002 0 2002 0 0 0
```

- [ ] **Step 2: Write the failing test**

```go
package app

import (
	"os"
	"path/filepath"
	"testing"
)

func readFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "proc", name))
	if err != nil {
		t.Fatalf("fixture %s: %v", name, err)
	}
	return data
}

func TestParseProcStat(t *testing.T) {
	idle, total, cores, err := parseProcStat(readFixture(t, "stat"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// idle = idle(8900000) + iowait(45000)
	if idle != 8945000 {
		t.Fatalf("idle = %d, want 8945000", idle)
	}
	// total = every field on the "cpu " line
	if total != 10555000 {
		t.Fatalf("total = %d, want 10555000", total)
	}
	if cores != 2 {
		t.Fatalf("cores = %d, want 2", cores)
	}
}

func TestParseLoadAvg(t *testing.T) {
	l1, l5, l15, err := parseLoadAvg(readFixture(t, "loadavg"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if l1 != 0.07 || l5 != 0.15 || l15 != 0.11 {
		t.Fatalf("load = %v %v %v, want 0.07 0.15 0.11", l1, l5, l15)
	}
}

// /proc/stat is cumulative, so a percentage is the delta between two reads.
// One sample cannot produce one, and inventing a number from it would be wrong.
func TestCPUPercentNeedsTwoSamples(t *testing.T) {
	sampler := newCPUSampler()

	first := sampler.percentFrom(8945000, 10555000)
	if first != nil {
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

func TestParseProcStatRejectsGarbage(t *testing.T) {
	if _, _, _, err := parseProcStat([]byte("not a proc file")); err == nil {
		t.Fatal("expected an error for a malformed /proc/stat")
	}
}

// A missing /proc says so rather than reporting a machine at 0%.
func TestCPUUnavailableWithoutProc(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_PROC", filepath.Join(t.TempDir(), "absent"))
	got := newCPUSampler().Read()
	if got.Available {
		t.Fatal("expected unavailable when /proc is missing")
	}
	if got.Reason == "" {
		t.Fatal("expected a reason explaining why")
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/app/ -run 'TestParseProcStat|TestParseLoadAvg|TestCPU' -v`
Expected: FAIL — `undefined: parseProcStat`, `undefined: newCPUSampler`

- [ ] **Step 4: Write the implementation**

```go
package app

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

/*
CPU: a percentage and the load average.

/proc/stat counts jiffies since boot, so a percentage is the difference between
two reads rather than anything a single read contains. The sampler keeps the
previous one; the first call after startup reports available with a null
percentage and the widget shows load average until the second beat. Blocking
inside the request to take a second sample would make every first paint slow,
and guessing from one sample would be wrong.
*/

// CPUMetrics is what the endpoint reports for the processor. Percent is a
// pointer because "not yet known" is a real state, distinct from 0%.
type CPUMetrics struct {
	SourceStatus
	Percent *float64 `json:"percent"`
	Load1   float64  `json:"load1"`
	Load5   float64  `json:"load5"`
	Load15  float64  `json:"load15"`
	Cores   int      `json:"cores"`
}

var errMalformedProcStat = errors.New("malformed /proc/stat")

type cpuSampler struct {
	mu       sync.Mutex
	lastIdle uint64
	lastAll  uint64
	seeded   bool
}

func newCPUSampler() *cpuSampler { return &cpuSampler{} }

// parseProcStat reads the aggregate "cpu " line. Idle counts idle+iowait, both
// of which are time the processor was not working.
func parseProcStat(data []byte) (idle, total uint64, cores int, err error) {
	found := false
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || !strings.HasPrefix(fields[0], "cpu") {
			continue
		}
		if fields[0] != "cpu" {
			cores++
			continue
		}
		if len(fields) < 5 {
			return 0, 0, 0, errMalformedProcStat
		}
		for i, raw := range fields[1:] {
			value, convErr := strconv.ParseUint(raw, 10, 64)
			if convErr != nil {
				return 0, 0, 0, errMalformedProcStat
			}
			total += value
			// Fields are user, nice, system, idle, iowait, ...
			if i == 3 || i == 4 {
				idle += value
			}
		}
		found = true
	}
	if !found {
		return 0, 0, 0, errMalformedProcStat
	}
	return idle, total, cores, nil
}

func parseLoadAvg(data []byte) (l1, l5, l15 float64, err error) {
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0, errors.New("malformed /proc/loadavg")
	}
	if l1, err = strconv.ParseFloat(fields[0], 64); err != nil {
		return 0, 0, 0, err
	}
	if l5, err = strconv.ParseFloat(fields[1], 64); err != nil {
		return 0, 0, 0, err
	}
	if l15, err = strconv.ParseFloat(fields[2], 64); err != nil {
		return 0, 0, 0, err
	}
	return l1, l5, l15, nil
}

// percentFrom folds one cumulative reading into the previous one. Returns nil
// until there is a previous one to compare against.
func (s *cpuSampler) percentFrom(idle, total uint64) *float64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	prevIdle, prevAll, seeded := s.lastIdle, s.lastAll, s.seeded
	s.lastIdle, s.lastAll, s.seeded = idle, total, true
	if !seeded || total <= prevAll {
		return nil
	}
	deltaAll := float64(total - prevAll)
	deltaIdle := float64(idle - prevIdle)
	percent := (deltaAll - deltaIdle) / deltaAll * 100
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	return &percent
}

func (s *cpuSampler) Read() CPUMetrics {
	dir := hostProcDir()
	statData, err := os.ReadFile(filepath.Join(dir, "stat"))
	if err != nil {
		return CPUMetrics{SourceStatus: SourceStatus{Reason: cpuUnavailableReason(err)}}
	}
	idle, total, cores, err := parseProcStat(statData)
	if err != nil {
		return CPUMetrics{SourceStatus: SourceStatus{Reason: reasonReadFailed}}
	}
	out := CPUMetrics{
		SourceStatus: SourceStatus{Available: true},
		Percent:      s.percentFrom(idle, total),
		Cores:        cores,
	}
	if loadData, loadErr := os.ReadFile(filepath.Join(dir, "loadavg")); loadErr == nil {
		out.Load1, out.Load5, out.Load15, _ = parseLoadAvg(loadData)
	}
	return out
}

// A missing /proc on Linux means the mount was not passed in; on macOS or
// Windows it means this is a development machine, which is a different thing
// to tell the reader.
func cpuUnavailableReason(err error) string {
	if os.IsNotExist(err) && !procIsSupported() {
		return reasonUnsupportedPlatform
	}
	return reasonNoHostProc
}
```

Add to `internal/app/system_source.go`:

```go
// procIsSupported reports whether this build runs on a platform with /proc at
// all. Development happens on macOS, where an honest "unsupported" beats a
// fabricated reading.
func procIsSupported() bool {
	return runtime.GOOS == "linux"
}
```

(add `"runtime"` to that file's imports)

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/app/ -run 'TestParseProcStat|TestParseLoadAvg|TestCPU' -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Falsify the two-sample rule**

Change `if !seeded || total <= prevAll` to `if total <= prevAll`. Run the tests: `TestCPUPercentNeedsTwoSamples` must FAIL (the first sample now returns a number). Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/app/system_cpu.go internal/app/system_cpu_test.go internal/app/system_source.go internal/app/testdata/proc/
git commit -m "read cpu percentage and load from /proc"
```

---

## Task 3: Memory source

**Files:**
- Create: `internal/app/system_mem.go`, `internal/app/testdata/proc/meminfo`
- Test: `internal/app/system_mem_test.go`

**Interfaces:**
- Consumes: `hostProcDir()`, `SourceStatus`, `procIsSupported()`, reason constants
- Produces:
  - `type MemoryMetrics struct { SourceStatus; TotalBytes, UsedBytes, AvailableBytes uint64 }`
  - `func parseMemInfo(data []byte) (total, available uint64, err error)`
  - `func readMemory() MemoryMetrics`

- [ ] **Step 1: Create the fixture**

`internal/app/testdata/proc/meminfo`:
```
MemTotal:        8123456 kB
MemFree:          912345 kB
MemAvailable:    1987654 kB
Buffers:          123456 kB
Cached:          2345678 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
```

- [ ] **Step 2: Write the failing test**

```go
package app

import (
	"path/filepath"
	"testing"
)

func TestParseMemInfo(t *testing.T) {
	total, available, err := parseMemInfo(readFixture(t, "meminfo"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Values are kB in the file and bytes in the API.
	if want := uint64(8123456) * 1024; total != want {
		t.Fatalf("total = %d, want %d", total, want)
	}
	if want := uint64(1987654) * 1024; available != want {
		t.Fatalf("available = %d, want %d", available, want)
	}
}

// Used is total minus MemAvailable, not total minus MemFree: cache and buffers
// are reclaimable, and counting them as used is the classic Linux memory
// misreport that makes every machine look nearly full.
func TestMemoryUsedExcludesReclaimable(t *testing.T) {
	total, available, err := parseMemInfo(readFixture(t, "meminfo"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	used := total - available
	if want := (uint64(8123456) - uint64(1987654)) * 1024; used != want {
		t.Fatalf("used = %d, want %d", used, want)
	}
	freeOnly := (uint64(8123456) - uint64(912345)) * 1024
	if used >= freeOnly {
		t.Fatal("used should be smaller than the MemFree-based figure")
	}
}

func TestParseMemInfoRejectsGarbage(t *testing.T) {
	if _, _, err := parseMemInfo([]byte("nothing useful here")); err == nil {
		t.Fatal("expected an error for a malformed /proc/meminfo")
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `go test ./internal/app/ -run 'TestParseMemInfo|TestMemory' -v`
Expected: FAIL — `undefined: parseMemInfo`

- [ ] **Step 4: Write the implementation**

```go
package app

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

/*
Memory, counted the way the machine actually experiences it.

Used is total minus MemAvailable rather than total minus MemFree. Page cache
and buffers are reclaimable the moment something needs them, so counting them
as used is what makes a healthy Linux box look permanently full -- the single
most common way this number is reported wrongly.
*/

type MemoryMetrics struct {
	SourceStatus
	TotalBytes     uint64 `json:"totalBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}

var errMalformedMemInfo = errors.New("malformed /proc/meminfo")

func parseMemInfo(data []byte) (total, available uint64, err error) {
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, convErr := strconv.ParseUint(fields[1], 10, 64)
		if convErr != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			total = value * 1024
		case "MemAvailable":
			available = value * 1024
		}
	}
	if total == 0 {
		return 0, 0, errMalformedMemInfo
	}
	return total, available, nil
}

func readMemory() MemoryMetrics {
	data, err := os.ReadFile(filepath.Join(hostProcDir(), "meminfo"))
	if err != nil {
		reason := reasonNoHostProc
		if os.IsNotExist(err) && !procIsSupported() {
			reason = reasonUnsupportedPlatform
		}
		return MemoryMetrics{SourceStatus: SourceStatus{Reason: reason}}
	}
	total, available, err := parseMemInfo(data)
	if err != nil {
		return MemoryMetrics{SourceStatus: SourceStatus{Reason: reasonReadFailed}}
	}
	used := uint64(0)
	if total > available {
		used = total - available
	}
	return MemoryMetrics{
		SourceStatus:   SourceStatus{Available: true},
		TotalBytes:     total,
		UsedBytes:      used,
		AvailableBytes: available,
	}
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `go test ./internal/app/ -run 'TestParseMemInfo|TestMemory' -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Falsify the reclaimable-memory rule**

Change `case "MemAvailable":` to `case "MemFree":`. Run the tests: `TestParseMemInfo` and `TestMemoryUsedExcludesReclaimable` must FAIL. Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add internal/app/system_mem.go internal/app/system_mem_test.go internal/app/testdata/proc/meminfo
git commit -m "read memory totals from /proc/meminfo"
```

---

## Task 4: Disk source

**Files:**
- Create: `internal/app/system_disk.go`
- Test: `internal/app/system_disk_test.go`

**Interfaces:**
- Consumes: `resolveHostPath()`, `SourceStatus`, reason constants
- Produces:
  - `type DiskMount struct { Path, Label string; TotalBytes, FreeBytes uint64; Error string }`
  - `type DiskMetrics struct { SourceStatus; Mounts []DiskMount }`
  - `func readDisks(paths []string, labels map[string]string) DiskMetrics`

- [ ] **Step 1: Write the failing test**

```go
package app

import "testing"

// statfs against a path that certainly exists. Exact figures belong to the
// machine, so this asserts the shape and the invariants rather than numbers.
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
	if m.Path != "/" {
		t.Fatalf("path = %q, want / -- the host's name, not the container's", m.Path)
	}
}

// One unreadable mount is that mount's problem. An Unraid array with a disk
// spun down or unmounted must not blank the whole tile.
func TestReadDisksIsolatesOneBadMount(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/", "/definitely/not/here"}, nil)
	if !got.Available {
		t.Fatal("one bad mount must not make the source unavailable")
	}
	if len(got.Mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(got.Mounts))
	}
	if got.Mounts[0].Error != "" {
		t.Fatalf("good mount carries error %q", got.Mounts[0].Error)
	}
	if got.Mounts[1].Error == "" {
		t.Fatal("bad mount should carry an error")
	}
	if got.Mounts[1].TotalBytes != 0 {
		t.Fatal("a failed mount must not report figures")
	}
}

// The label is what makes a tile read "System / Jellyfin / Files" rather than
// three paths.
func TestReadDisksUsesConfiguredLabel(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := readDisks([]string{"/"}, map[string]string{"/": "System"})
	if got.Mounts[0].Label != "System" {
		t.Fatalf("label = %q, want System", got.Mounts[0].Label)
	}
}

// A path climbing out of the prefix is refused, not read.
func TestReadDisksRefusesEscapingPath(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/mnt")
	got := readDisks([]string{"/../../etc"}, nil)
	if len(got.Mounts) != 1 || got.Mounts[0].Error == "" {
		t.Fatal("expected the escaping path to be refused")
	}
}

func TestReadDisksWithNoPathsIsUnavailable(t *testing.T) {
	got := readDisks(nil, nil)
	if got.Available {
		t.Fatal("no configured mounts means nothing to report")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run TestReadDisks -v`
Expected: FAIL — `undefined: readDisks`

- [ ] **Step 3: Write the implementation**

```go
package app

import (
	"syscall"
)

/*
Free space per filesystem.

Mountpoints are named by the reader rather than enumerated: a container sees
dozens of overlay and tmpfs mounts, and listing them all produces a tile of
noise. On Unraid the interesting ones are /mnt/user and /mnt/cache; on Synology
/volume1.

statfs on an Unraid user share reports the pool total, which is the number
Unraid's own dashboard shows and the one the reader expects. Individual
/mnt/diskN paths report per-disk. Both come through this same call -- noted
because summing the disks to "fix" the pool figure would be wrong.
*/

type DiskMount struct {
	Path       string `json:"path"`
	Label      string `json:"label,omitempty"`
	TotalBytes uint64 `json:"totalBytes"`
	FreeBytes  uint64 `json:"freeBytes"`
	// Error is this mount's own failure. One unreadable disk does not blank
	// the tile: a spun-down or unmounted array disk is exactly the case where
	// the other figures still matter.
	Error string `json:"error,omitempty"`
}

type DiskMetrics struct {
	SourceStatus
	Mounts []DiskMount `json:"mounts"`
}

func readDisks(paths []string, labels map[string]string) DiskMetrics {
	if len(paths) == 0 {
		return DiskMetrics{SourceStatus: SourceStatus{Reason: "no-mounts-configured"}}
	}
	out := DiskMetrics{
		SourceStatus: SourceStatus{Available: true},
		Mounts:       make([]DiskMount, 0, len(paths)),
	}
	for _, path := range paths {
		mount := DiskMount{Path: path, Label: labels[path]}
		resolved, err := resolveHostPath(path)
		if err != nil {
			mount.Error = "refused"
			out.Mounts = append(out.Mounts, mount)
			continue
		}
		var st syscall.Statfs_t
		if err := syscall.Statfs(resolved, &st); err != nil {
			mount.Error = "unreadable"
			out.Mounts = append(out.Mounts, mount)
			continue
		}
		mount.TotalBytes = uint64(st.Bsize) * st.Blocks
		// Bavail, not Bfree: the reserved blocks are not free to anyone here.
		mount.FreeBytes = uint64(st.Bsize) * st.Bavail
		out.Mounts = append(out.Mounts, mount)
	}
	return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app/ -run TestReadDisks -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Falsify the per-mount isolation**

Change the `syscall.Statfs` failure branch to `return DiskMetrics{SourceStatus: SourceStatus{Reason: "unreadable"}}`. Run the tests: `TestReadDisksIsolatesOneBadMount` must FAIL. Restore and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add internal/app/system_disk.go internal/app/system_disk_test.go
git commit -m "report free space per configured mount"
```

---

## Task 5: Docker source

**Files:**
- Create: `internal/app/system_docker.go`
- Test: `internal/app/system_docker_test.go`

**Interfaces:**
- Consumes: `dockerSocketPath()`, `SourceStatus`, reason constants
- Produces:
  - `type DockerMetrics struct { SourceStatus; Running, Total int; ByStatus map[string]int }`
  - `func dockerClientFor(socket string) *http.Client`
  - `func countContainers(body io.Reader) (running, total int, byStatus map[string]int, err error)`
  - `func readDocker() DockerMetrics`

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCountContainers(t *testing.T) {
	payload := `[
		{"Id":"a","State":"running"},
		{"Id":"b","State":"running"},
		{"Id":"c","State":"exited"},
		{"Id":"d","State":"paused"}
	]`
	running, total, byStatus, err := countContainers(strings.NewReader(payload))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if running != 2 {
		t.Fatalf("running = %d, want 2", running)
	}
	if total != 4 {
		t.Fatalf("total = %d, want 4", total)
	}
	if byStatus["exited"] != 1 || byStatus["paused"] != 1 {
		t.Fatalf("byStatus = %v", byStatus)
	}
}

// The dial path is the part that cannot be checked by reading it: a stub
// daemon on a real unix socket proves the client reaches it with stdlib alone.
func TestDockerClientReachesUnixSocket(t *testing.T) {
	dir := t.TempDir()
	socket := filepath.Join(dir, "docker.sock")

	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Skipf("unix sockets unavailable here: %v", err)
	}
	defer listener.Close()

	server := &httptest.Server{
		Listener: listener,
		Config: &http.Server{Handler: http.HandlerFunc(
			func(w http.ResponseWriter, r *http.Request) {
				if !strings.Contains(r.URL.Path, "/containers/json") {
					http.NotFound(w, r)
					return
				}
				json.NewEncoder(w).Encode([]map[string]any{
					{"Id": "a", "State": "running"},
					{"Id": "b", "State": "exited"},
				})
			})},
	}
	server.Start()
	defer server.Close()

	t.Setenv("NEXTDASH_DOCKER_SOCKET", socket)
	got := readDocker()
	if !got.Available {
		t.Fatalf("expected available, got reason %q", got.Reason)
	}
	if got.Running != 1 || got.Total != 2 {
		t.Fatalf("running=%d total=%d, want 1 and 2", got.Running, got.Total)
	}
}

// No socket configured is the default, and it is not an error state.
func TestDockerUnavailableWithoutSocket(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	got := readDocker()
	if got.Available {
		t.Fatal("expected unavailable with no socket configured")
	}
	if got.Reason != reasonNoDockerSocket {
		t.Fatalf("reason = %q, want %q", got.Reason, reasonNoDockerSocket)
	}
}

// A configured socket that is not there says so rather than reporting zero
// containers, which would read as "your containers are all gone".
func TestDockerUnavailableWhenSocketMissing(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", filepath.Join(t.TempDir(), "absent.sock"))
	got := readDocker()
	if got.Available {
		t.Fatal("expected unavailable for a missing socket")
	}
	if got.Total != 0 {
		t.Fatal("an unavailable source must not report counts")
	}
	_ = os.Stdout
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run 'TestCountContainers|TestDocker' -v`
Expected: FAIL — `undefined: countContainers`, `undefined: readDocker`

- [ ] **Step 3: Write the implementation**

```go
package app

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"time"
)

/*
How many containers are running.

Over the Docker Engine API on its unix socket, with net/http and a custom
dialler -- no SDK, which would be the first dependency in this tree beyond mux
and x/net for a call this small.

The socket is opt-in and stays that way. Read-only access still exposes the
daemon's whole read API: every container, its image, its environment, its
mounts. That is a real grant, so it is off unless NEXTDASH_DOCKER_SOCKET names
a path, the widget is not offered until it does, and the documentation says
what is being handed over rather than only how to hand it over.
*/

const dockerAPIVersion = "v1.41"

type DockerMetrics struct {
	SourceStatus
	Running  int            `json:"running"`
	Total    int            `json:"total"`
	ByStatus map[string]int `json:"byStatus,omitempty"`
}

func dockerClientFor(socket string) *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "unix", socket)
			},
		},
		Timeout: 3 * time.Second,
	}
}

func countContainers(body io.Reader) (running, total int, byStatus map[string]int, err error) {
	var list []struct {
		State string `json:"State"`
	}
	if err = json.NewDecoder(body).Decode(&list); err != nil {
		return 0, 0, nil, err
	}
	byStatus = make(map[string]int, 4)
	for _, item := range list {
		total++
		byStatus[item.State]++
		if item.State == "running" {
			running++
		}
	}
	return running, total, byStatus, nil
}

func readDocker() DockerMetrics {
	socket := dockerSocketPath()
	if socket == "" {
		return DockerMetrics{SourceStatus: SourceStatus{Reason: reasonNoDockerSocket}}
	}
	resp, err := dockerClientFor(socket).Get(
		"http://docker/" + dockerAPIVersion + "/containers/json?all=1")
	if err != nil {
		return DockerMetrics{SourceStatus: SourceStatus{Reason: reasonNoDockerSocket}}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return DockerMetrics{SourceStatus: SourceStatus{Reason: reasonReadFailed}}
	}
	running, total, byStatus, err := countContainers(resp.Body)
	if err != nil {
		return DockerMetrics{SourceStatus: SourceStatus{Reason: reasonReadFailed}}
	}
	return DockerMetrics{
		SourceStatus: SourceStatus{Available: true},
		Running:      running,
		Total:        total,
		ByStatus:     byStatus,
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app/ -run 'TestCountContainers|TestDocker' -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/app/system_docker.go internal/app/system_docker_test.go
git commit -m "count docker containers over the socket"
```

---

## Task 6: The metrics endpoint

**Files:**
- Create: `internal/app/system_metrics.go`, `internal/app/handlers_system.go`
- Modify: `internal/app/main.go` (beside the other `/api/` routes, around line 197)
- Test: `internal/app/system_metrics_test.go`

**Interfaces:**
- Consumes: `newCPUSampler()`, `readMemory()`, `readDisks()`, `readDocker()` (Tasks 2-5)
- Produces:
  - `type SystemMetrics struct { CPU *CPUMetrics; Memory *MemoryMetrics; Disks *DiskMetrics; Docker *DockerMetrics }`
  - `func (s *systemMetricsCache) Get(want []string, mounts []string, labels map[string]string) SystemMetrics`
  - `func SystemMetricsHandler(w http.ResponseWriter, r *http.Request)`

- [ ] **Step 1: Write the failing test**

```go
package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Only what was asked for: a page with one memory widget must not make the
// server read disks.
func TestMetricsReturnsOnlyRequestedSources(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/system/metrics?want=memory", nil)
	rec := httptest.NewRecorder()
	SystemMetricsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if _, ok := body["memory"]; !ok {
		t.Fatal("memory missing from the response")
	}
	if _, ok := body["disks"]; ok {
		t.Fatal("disks present though it was not asked for")
	}
	if _, ok := body["cpu"]; ok {
		t.Fatal("cpu present though it was not asked for")
	}
}

// Four widgets polling at one second must not become four reads per second.
func TestMetricsCacheSharesOneReadPerFloor(t *testing.T) {
	cache := newSystemMetricsCache()
	reads := 0
	cache.readMemoryFn = func() MemoryMetrics {
		reads++
		return MemoryMetrics{SourceStatus: SourceStatus{Available: true}, TotalBytes: 1}
	}
	for i := 0; i < 5; i++ {
		cache.Get([]string{"memory"}, nil, nil)
	}
	if reads != 1 {
		t.Fatalf("read the source %d times, want 1 within the cache floor", reads)
	}

	cache.now = func() time.Time { return time.Now().Add(2 * time.Second) }
	cache.Get([]string{"memory"}, nil, nil)
	if reads != 2 {
		t.Fatalf("read %d times, want 2 once the floor had passed", reads)
	}
}

// An unavailable source is reported as such, never as zeros.
func TestMetricsReportsUnavailableHonestly(t *testing.T) {
	t.Setenv("NEXTDASH_DOCKER_SOCKET", "")
	req := httptest.NewRequest(http.MethodGet, "/api/system/metrics?want=docker", nil)
	rec := httptest.NewRecorder()
	SystemMetricsHandler(rec, req)

	var body struct {
		Docker struct {
			Available bool   `json:"available"`
			Reason    string `json:"reason"`
		} `json:"docker"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body.Docker.Available {
		t.Fatal("expected docker unavailable with no socket")
	}
	if body.Docker.Reason == "" {
		t.Fatal("expected a reason")
	}
}

func TestMetricsRejectsUnknownSource(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/system/metrics?want=passwords", nil)
	rec := httptest.NewRecorder()
	SystemMetricsHandler(rec, req)

	var body map[string]json.RawMessage
	json.Unmarshal(rec.Body.Bytes(), &body)
	if len(body) != 0 {
		t.Fatalf("unknown source produced %v", body)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run TestMetrics -v`
Expected: FAIL — `undefined: SystemMetricsHandler`, `undefined: newSystemMetricsCache`

- [ ] **Step 3: Write the implementation**

```go
package app

import (
	"sync"
	"time"
)

/*
One endpoint for four sources.

Four widgets polling separately at a second each would be four requests a
second and four copies of the availability logic. One endpoint answers with
only what was asked for, and one cache underneath means the beats coincide
rather than multiply.

Disks get a longer floor than the rest: free space does not move quickly, and
statfs on a spun-down array disk can block for a while.
*/

type SystemMetrics struct {
	CPU    *CPUMetrics    `json:"cpu,omitempty"`
	Memory *MemoryMetrics `json:"memory,omitempty"`
	Disks  *DiskMetrics   `json:"disks,omitempty"`
	Docker *DockerMetrics `json:"docker,omitempty"`
}

const (
	metricsFloor     = time.Second
	metricsDiskFloor = 5 * time.Second
)

type cachedEntry struct {
	at    time.Time
	value any
}

type systemMetricsCache struct {
	mu      sync.Mutex
	entries map[string]cachedEntry
	sampler *cpuSampler

	// Swappable for the tests, so the cache can be exercised without touching
	// the host.
	now          func() time.Time
	readMemoryFn func() MemoryMetrics
	readDockerFn func() DockerMetrics
	readDisksFn  func([]string, map[string]string) DiskMetrics
}

func newSystemMetricsCache() *systemMetricsCache {
	return &systemMetricsCache{
		entries:      map[string]cachedEntry{},
		sampler:      newCPUSampler(),
		now:          time.Now,
		readMemoryFn: readMemory,
		readDockerFn: readDocker,
		readDisksFn:  readDisks,
	}
}

var systemCache = newSystemMetricsCache()

func (c *systemMetricsCache) fresh(key string, floor time.Duration) (any, bool) {
	entry, ok := c.entries[key]
	if !ok || c.now().Sub(entry.at) >= floor {
		return nil, false
	}
	return entry.value, true
}

func (c *systemMetricsCache) store(key string, value any) {
	c.entries[key] = cachedEntry{at: c.now(), value: value}
}

func (c *systemMetricsCache) Get(want []string, mounts []string, labels map[string]string) SystemMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := SystemMetrics{}
	for _, source := range want {
		switch source {
		case "cpu":
			if v, ok := c.fresh("cpu", metricsFloor); ok {
				value := v.(CPUMetrics)
				out.CPU = &value
				continue
			}
			value := c.sampler.Read()
			c.store("cpu", value)
			out.CPU = &value
		case "memory":
			if v, ok := c.fresh("memory", metricsFloor); ok {
				value := v.(MemoryMetrics)
				out.Memory = &value
				continue
			}
			value := c.readMemoryFn()
			c.store("memory", value)
			out.Memory = &value
		case "docker":
			if v, ok := c.fresh("docker", metricsFloor); ok {
				value := v.(DockerMetrics)
				out.Docker = &value
				continue
			}
			value := c.readDockerFn()
			c.store("docker", value)
			out.Docker = &value
		case "disks":
			if v, ok := c.fresh("disks", metricsDiskFloor); ok {
				value := v.(DiskMetrics)
				out.Disks = &value
				continue
			}
			value := c.readDisksFn(mounts, labels)
			c.store("disks", value)
			out.Disks = &value
		}
		// Anything else is ignored: an unknown name is not an error, it is
		// simply not a source.
	}
	return out
}
```

`internal/app/handlers_system.go`:

```go
package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// SystemMetricsHandler serves host metrics for the system widgets.
//
// Read-only and not token-gated, like the other figures the dashboard must
// draw without being signed in. It exposes no paths beyond the ones the reader
// configured and no container detail beyond a count.
func SystemMetricsHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	want := []string{}
	for _, raw := range strings.Split(query.Get("want"), ",") {
		if name := strings.TrimSpace(raw); name != "" {
			want = append(want, name)
		}
	}

	mounts := []string{}
	for _, raw := range strings.Split(query.Get("mounts"), ",") {
		if path := strings.TrimSpace(raw); path != "" {
			mounts = append(mounts, path)
		}
	}
	labels := map[string]string{}
	for _, pair := range strings.Split(query.Get("labels"), ",") {
		if at := strings.Index(pair, "="); at > 0 {
			labels[strings.TrimSpace(pair[:at])] = strings.TrimSpace(pair[at+1:])
		}
	}

	w.Header().Set("Content-Type", "application/json")
	// Always fresh: a cached metric is a wrong metric, and the server-side
	// floor already stops this becoming a read per request.
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(systemCache.Get(want, mounts, labels))
}
```

In `internal/app/main.go`, beside the other `/api/widgets` routes (around line 197):

```go
	api.HandleFunc("/system/metrics", SystemMetricsHandler).Methods("GET")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/app/ -run TestMetrics -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Falsify the cache**

Change `c.now().Sub(entry.at) >= floor` to `return nil, false` at the top of `fresh`. Run the tests: `TestMetricsCacheSharesOneReadPerFloor` must FAIL with 5 reads instead of 1. Restore and confirm PASS.

- [ ] **Step 6: Run the whole Go suite**

Run: `go test ./... 2>&1 | tail -20`
Expected: PASS. Nothing here changes existing behaviour, so a failure means something was disturbed — fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add internal/app/system_metrics.go internal/app/handlers_system.go internal/app/system_metrics_test.go internal/app/main.go
git commit -m "serve host metrics from one endpoint"
```

---

## Task 7: Register the four widget types server-side

**Files:**
- Modify: `internal/app/widgets.go` (constants around line 33-95, `knownWidgetTypes` around line 100-115)
- Modify: `internal/app/widgets_config.go` (`widgetFields` around line 80, `widgetTypeNames` around line 357)
- Test: `internal/app/widgets_system_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks (registration is independent of the sources)
- Produces: `WidgetTypeCPU`, `WidgetTypeMemory`, `WidgetTypeDisks`, `WidgetTypeDocker` — the `WidgetType` values the JS renderers key on (`"cpu"`, `"memory"`, `"disks"`, `"docker"`)

- [ ] **Step 1: Write the failing test**

```go
package app

import "testing"

func TestSystemWidgetTypesAreRegistered(t *testing.T) {
	for _, widgetType := range []WidgetType{
		WidgetTypeCPU, WidgetTypeMemory, WidgetTypeDisks, WidgetTypeDocker,
	} {
		if _, ok := knownWidgetTypes[widgetType]; !ok {
			t.Fatalf("%q is not in knownWidgetTypes", widgetType)
		}
	}
}

// widgetTypeNames panics when it lists fewer types than the register holds,
// so calling it is the assertion.
func TestWidgetTypeNamesCoversTheSystemTypes(t *testing.T) {
	names := widgetTypeNames()
	seen := map[string]bool{}
	for _, name := range names {
		seen[name] = true
	}
	for _, want := range []string{"cpu", "memory", "disks", "docker"} {
		if !seen[want] {
			t.Fatalf("%q missing from widgetTypeNames()", want)
		}
	}
}

// A refresh interval below the floor is narrowed rather than stored: a CPU
// tile asking every 100ms is measurement noise and pointless load.
func TestSystemWidgetConfigIsNarrowed(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeCPU, map[string]any{
		"refreshSeconds": 0,
		"showLoad":       true,
		"nonsense":       "dropped",
	})
	if _, ok := got["nonsense"]; ok {
		t.Fatal("an undeclared key was kept")
	}
	if got["showLoad"] != true {
		t.Fatal("showLoad was not kept")
	}
	if seconds, ok := got["refreshSeconds"]; ok {
		if n, isInt := seconds.(int); isInt && n < 1 {
			t.Fatalf("refreshSeconds = %d, want the floor applied or the key absent", n)
		}
	}
}

// Disks take a list of mountpoints, because enumerating them is noise.
func TestDisksWidgetAcceptsMountList(t *testing.T) {
	got := sanitizeWidgetConfig(WidgetTypeDisks, map[string]any{
		"mounts": []any{"/mnt/user", "/mnt/cache"},
	})
	mounts, ok := got["mounts"].([]string)
	if !ok || len(mounts) != 2 {
		t.Fatalf("mounts = %#v, want two paths", got["mounts"])
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/app/ -run 'TestSystemWidget|TestWidgetTypeNamesCovers|TestDisksWidget' -v`
Expected: FAIL — `undefined: WidgetTypeCPU`

- [ ] **Step 3: Add the constants and register them**

In `internal/app/widgets.go`, inside the `const` block after `WidgetTypeCustom`:

```go
	// WidgetTypeCPU reports processor load: a percentage and the load average
	// in one tile, because either alone answers half the question.
	WidgetTypeCPU WidgetType = "cpu"
	// WidgetTypeMemory reports RAM in use against the total.
	WidgetTypeMemory WidgetType = "memory"
	// WidgetTypeDisks reports free space per configured mount -- the array and
	// the cache on Unraid, a volume on a NAS.
	WidgetTypeDisks WidgetType = "disks"
	// WidgetTypeDocker counts containers: how many are running of how many
	// exist.
	WidgetTypeDocker WidgetType = "docker"
```

In `knownWidgetTypes`, before the closing brace:

```go
	WidgetTypeCPU:        {},
	WidgetTypeMemory:     {},
	WidgetTypeDisks:      {},
	WidgetTypeDocker:     {},
```

- [ ] **Step 4: Add the field schemas**

In `internal/app/widgets_config.go`, inside `widgetFields`:

```go
	WidgetTypeCPU: {
		// One second is the floor: below that the delta between two /proc
		// reads is noise rather than a measurement.
		{Key: "refreshSeconds", Kind: "int", Min: 1, Max: 3600},
		{Key: "showLoad", Kind: "bool"},
		{Key: "showCores", Kind: "bool"},
	},
	WidgetTypeMemory: {
		{Key: "refreshSeconds", Kind: "int", Min: 2, Max: 3600},
		{Key: "display", Kind: "string", Allowed: []string{"bytes", "percent"}},
	},
	WidgetTypeDisks: {
		{Key: "refreshSeconds", Kind: "int", Min: 5, Max: 3600},
		// Named rather than enumerated: a container sees dozens of overlay
		// mounts, and a tile listing them all is noise.
		{Key: "mounts", Kind: "list"},
		{Key: "labels", Kind: "list"},
		{Key: "showMeter", Kind: "bool"},
	},
	WidgetTypeDocker: {
		{Key: "refreshSeconds", Kind: "int", Min: 2, Max: 3600},
		{Key: "splitByStatus", Kind: "bool"},
	},
```

- [ ] **Step 5: Add them to the ordered list**

In `widgetTypeNames()`, in the `ordered` slice — **before** `WidgetTypeCustom`, which the comment there requires stays last:

```go
		WidgetTypeCPU, WidgetTypeMemory, WidgetTypeDisks, WidgetTypeDocker,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `go test ./internal/app/ -run 'TestSystemWidget|TestWidgetTypeNamesCovers|TestDisksWidget' -v`
Expected: PASS (4 tests)

- [ ] **Step 7: Verify the panic guard still guards**

Temporarily remove `WidgetTypeDocker` from the `ordered` slice (leaving it in `knownWidgetTypes`). Run `go test ./internal/app/ -run TestWidgetTypeNames -v`: it must **panic** with "widgetTypeNames lists 17 of 18 registered types". Restore and confirm PASS. This proves the guard the whole registration depends on is live.

- [ ] **Step 8: Run the Go suite**

Run: `go test ./... 2>&1 | tail -20`
Expected: PASS, including `internal/app/widgets_config_test.go` catalogue-parity tests.

- [ ] **Step 9: Commit**

```bash
git add internal/app/widgets.go internal/app/widgets_config.go internal/app/widgets_system_test.go
git commit -m "register the four system widget types"
```

---

## Task 8: Widen the refresh timer to any polled type

**Files:**
- Modify: `static/js/dashboard/dashboard-render-core.js:597-654` (and the call site at :570, the cache list at :723-732)
- Test: `tests/widget-poll-timer.spec.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `POLLED_WIDGET_TYPES` — a map of type to `{ configKey, floor, fallback }`
  - `startWidgetTimer(widget)` / `tickWidget(widget)` / `stopWidgetTimer(id)` / `stopWidgetTimers()`
  - `startCustomWidgetTimer` / `tickCustomWidget` / `stopCustomWidgetTimer` / `stopCustomWidgetTimers` kept as aliases so existing callers and tests keep working

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The refresh machinery was written for the custom widget and gated to it by
 * name. The system widgets need the same thing -- one timer per widget on its
 * own cadence, stopping when the tab is hidden, stopping itself when its body
 * leaves the DOM -- so the gate becomes a table rather than a type check.
 *
 * What is pinned here is that widening it did not loosen it: still one clock
 * per tile, still nothing for a type that does not poll.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('the widget refresh timer', () => {
    test('starts for a polled type and not for a passive one', async ({ page }) => {
        await openDashboard(page);

        const started = await page.evaluate(() => {
            const core = window.dashboardInstance.renderCore || window.dashboardInstance;
            core.stopWidgetTimers();
            core.startWidgetTimer({ id: 'w_cpu1', type: 'cpu', config: { refreshSeconds: 5 } });
            const afterPolled = core.widgetTimerCount();
            core.startWidgetTimer({ id: 'w_health1', type: 'health', config: {} });
            const afterPassive = core.widgetTimerCount();
            core.stopWidgetTimers();
            return { afterPolled, afterPassive };
        });

        expect(started.afterPolled).toBe(1);
        // Health draws from data the dashboard already holds; a clock on it
        // would redraw the same figures forever.
        expect(started.afterPassive).toBe(1);
    });

    test('one tile keeps one clock across redraws', async ({ page }) => {
        await openDashboard(page);

        const count = await page.evaluate(() => {
            const core = window.dashboardInstance.renderCore || window.dashboardInstance;
            core.stopWidgetTimers();
            const widget = { id: 'w_mem1', type: 'memory', config: { refreshSeconds: 10 } };
            core.startWidgetTimer(widget);
            core.startWidgetTimer(widget);
            core.startWidgetTimer(widget);
            const total = core.widgetTimerCount();
            core.stopWidgetTimers();
            return total;
        });

        expect(count).toBe(1);
    });

    test('the interval floor is applied per type', async ({ page }) => {
        await openDashboard(page);

        const floors = await page.evaluate(() => {
            const core = window.dashboardInstance.renderCore || window.dashboardInstance;
            return {
                cpu: core.widgetPollSeconds({ type: 'cpu', config: { refreshSeconds: 0 } }),
                disks: core.widgetPollSeconds({ type: 'disks', config: { refreshSeconds: 1 } }),
                custom: core.widgetPollSeconds({ type: 'custom', config: { ttl: 5 } }),
            };
        });

        expect(floors.cpu).toBe(1);
        // Free space does not move fast, and statfs on a spun-down disk blocks.
        expect(floors.disks).toBe(5);
        // The custom widget keeps its own field and its own 30s floor.
        expect(floors.custom).toBe(30);
    });

    test('the custom widget still refreshes exactly as before', async ({ page }) => {
        await openDashboard(page);

        const kept = await page.evaluate(() => {
            const core = window.dashboardInstance.renderCore || window.dashboardInstance;
            core.stopCustomWidgetTimers();
            core.startCustomWidgetTimer({ id: 'w_c1', type: 'custom', config: { ttl: 60 } });
            const n = core.customWidgetTimerCount();
            core.stopCustomWidgetTimers();
            return n;
        });

        expect(kept).toBe(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-poll-timer.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -30 /tmp/pre.txt`
Expected: FAIL — `core.startWidgetTimer is not a function`

- [ ] **Step 3: Widen the gate**

Replace the four timer methods in `dashboard-render-core.js` (lines ~597-654). The bodies below keep the visibility check, the self-cleaning and the one-timer-per-id map exactly as they were:

```js
    /*
     * Which types keep a clock, and how fast.
     *
     * A table rather than a type check, because there are now five: the custom
     * widget asking a service of the reader's own, and four reading the host.
     * Each floor is the interval below which the reading stops meaning
     * anything -- a second for a CPU delta, five for free space, and the
     * custom widget's own thirty, which is a cache expiry as well as a cadence
     * and is deliberately left alone.
     */
    static POLLED_WIDGET_TYPES = {
        custom: { configKey: 'ttl', floor: 30, fallback: 300 },
        cpu: { configKey: 'refreshSeconds', floor: 1, fallback: 5 },
        memory: { configKey: 'refreshSeconds', floor: 2, fallback: 10 },
        docker: { configKey: 'refreshSeconds', floor: 2, fallback: 30 },
        disks: { configKey: 'refreshSeconds', floor: 5, fallback: 60 },
    };

    widgetPollSpec(widget) {
        return this.constructor.POLLED_WIDGET_TYPES?.[widget?.type]
            || DashboardRenderCore.POLLED_WIDGET_TYPES[widget?.type]
            || null;
    }

    /** The cadence this tile actually beats at, floor applied. */
    widgetPollSeconds(widget) {
        const spec = this.widgetPollSpec(widget);
        if (!spec) return 0;
        const asked = Number(widget?.config?.[spec.configKey]) || spec.fallback;
        return Math.max(asked, spec.floor);
    }

    /*
     * One timer per widget rather than one shared tick, because the cadences
     * differ with reason: 60s for a download speed, 300s for a queue, 3600s
     * for an hourly speed test, one second for a processor. A single tick on
     * the shortest would redraw the hourly tile 1,440 times a day and make its
     * own setting meaningless.
     */
    startWidgetTimer(widget) {
        if (!widget || !widget.id || !this.widgetPollSpec(widget)) return;
        this._widgetTimers = this._widgetTimers || new Map();
        // Drawn again -- a repaint, a drag ending, a health figure arriving --
        // is not a second clock. Without this every redraw would double the
        // requests the tile makes from then on.
        this.stopWidgetTimer(widget.id);

        const seconds = this.widgetPollSeconds(widget);
        const timer = setInterval(() => {
            void this.tickWidget(widget);
        }, seconds * 1000);
        this._widgetTimers.set(widget.id, timer);
    }

    /*
     * One beat: forget what this tile held, and draw it again.
     *
     * A hidden tab asks nothing. A dashboard open on a second monitor would
     * otherwise keep questioning a service -- or reading the host -- all day,
     * and the health badge already pauses for the same reason. Nothing is
     * caught up on the way back: the tile shows what it had until its next
     * beat, which is better than every tile saying "Loading..." at once.
     */
    async tickWidget(widget) {
        if (document.visibilityState !== 'visible') return;
        const d = this.dash;
        const pageId = Number(d?.currentPageId) || Number(d?.pages?.[0]?.id) || 1;
        if (widget.type === 'custom' && d._widgetCustom) {
            delete d._widgetCustom[`${pageId}:${widget.id}`];
        }
        if (d._widgetSystem) delete d._widgetSystem[widget.id];

        const block = document.querySelector(
            `.dashboard-widget[data-widget-id="${CSS.escape(String(widget.id))}"]`);
        const body = block?.querySelector('.dashboard-widget-body');
        // Gone from the page: the tile was closed or the reader moved on, and
        // the clock has nothing left to draw into.
        if (!body) {
            this.stopWidgetTimer(widget.id);
            return;
        }
        const cursor = d.keyboardNavigation?.captureWidgetCursor?.() || null;
        await window.DashboardWidgets?.[widget.type]?.(body, widget, d);
        if (cursor) d.keyboardNavigation?.restoreWidgetCursor?.(cursor);
    }

    stopWidgetTimer(id) {
        const timer = this._widgetTimers?.get(id);
        if (timer) {
            clearInterval(timer);
            this._widgetTimers.delete(id);
        }
    }

    /* Every clock at once: leaving the dashboard, or rebuilding the grid. */
    stopWidgetTimers() {
        this._widgetTimers?.forEach((timer) => clearInterval(timer));
        this._widgetTimers?.clear();
    }

    widgetTimerCount() {
        return this._widgetTimers?.size || 0;
    }

    // The custom widget's names, kept so existing callers and the tests
    // written against them keep working. Same map, same clocks.
    startCustomWidgetTimer(widget) { return this.startWidgetTimer(widget); }
    tickCustomWidget(widget) { return this.tickWidget(widget); }
    stopCustomWidgetTimer(id) { return this.stopWidgetTimer(id); }
    stopCustomWidgetTimers() { return this.stopWidgetTimers(); }
    customWidgetTimerCount() { return this.widgetTimerCount(); }
```

- [ ] **Step 4: Update the call site**

At line ~570, replace the custom-only start:

```js
            // Any type with a cadence gets a clock; the table decides which.
            this.startWidgetTimer(widget);
```

- [ ] **Step 5: Register the system cache**

In `forgetWidgetCaches()` (~line 723-732), add `_widgetSystem` to the list of caches cleared, beside `_widgetCustom` and the rest.

- [ ] **Step 6: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-poll-timer.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (4 tests)

- [ ] **Step 7: Falsify the one-clock rule**

Remove the `this.stopWidgetTimer(widget.id);` line from `startWidgetTimer`. Re-run: "one tile keeps one clock across redraws" must FAIL with 3. Restore and confirm PASS.

- [ ] **Step 8: Regression on the custom widget**

Run: `PW_WORKERS=2 npx playwright test tests/ --grep "custom" > /tmp/reg.txt 2>&1; echo $?; grep -E "passed|failed" /tmp/reg.txt`
Expected: PASS. The custom widget's behaviour must be untouched — this task widened the gate, it did not change what custom does.

- [ ] **Step 9: Commit**

```bash
git add static/js/dashboard/dashboard-render-core.js tests/widget-poll-timer.spec.js
git commit -m "let any widget type keep a refresh clock"
```

---

## Task 9: Shared widget front-end helper

**Files:**
- Create: `static/js/dashboard/dashboard-widget-system.js`
- Modify: `templates/dashboard.html` (beside the other widget script tags, ~line 439-454)
- Test: covered by Tasks 10-13; this task's own check is Step 4

**Interfaces:**
- Consumes: `window.DashboardWidgetUtils`
- Produces: `window.DashboardWidgetSystem` with
  - `fetchMetrics(dash, want, params)` → the parsed JSON, cached on `dash._widgetSystem[want]`
  - `unavailableText(dash, reason)` → the human sentence for a reason code
  - `formatBytes(n)` → `"1.9 GiB"`
  - `pollSeconds(widget, fallback)`

- [ ] **Step 1: Write the file**

```js
/**
 * What the four system widgets share.
 *
 * Each tile asks for only its own source, and one endpoint answers with a
 * cache underneath, so four tiles beating at once are one read rather than
 * four. The rest is the honesty rule: a source that cannot be read says why,
 * and no tile ever prints a zero it did not measure.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /**
     * Why a source is not answering, in a sentence rather than a code.
     *
     * Every one of these is a setup step the reader can act on, which is why
     * they name the mount rather than saying "unavailable".
     */
    function unavailableText(dash, reason) {
        const map = {
            'no-host-proc': ['dashboard.widgetSystemNoProc',
                'Not reading the host yet — mount /proc and set NEXTDASH_HOST_PROC.'],
            'unsupported-platform': ['dashboard.widgetSystemUnsupported',
                'This reading is available on Linux hosts.'],
            'no-docker-socket': ['dashboard.widgetSystemNoDocker',
                'Not connected to Docker — mount the socket and set NEXTDASH_DOCKER_SOCKET.'],
            'no-mounts-configured': ['dashboard.widgetSystemNoMounts',
                'No disks chosen yet — name them in this widget’s settings.'],
            'read-failed': ['dashboard.widgetSystemReadFailed',
                'The host answered with something unreadable.'],
        };
        const entry = map[reason] || map['read-failed'];
        return label(dash, entry[0], entry[1]);
    }

    /**
     * Ask for one source.
     *
     * Cached per widget id on the dash so a redraw between beats does not
     * re-ask; the timer clears that entry when it is genuinely time again.
     */
    async function fetchMetrics(dash, want, params) {
        dash._widgetSystem = dash._widgetSystem || {};
        const key = params?.cacheKey || want;
        if (dash._widgetSystem[key]) return dash._widgetSystem[key];

        const query = new URLSearchParams({ want });
        if (params?.mounts?.length) query.set('mounts', params.mounts.join(','));
        if (params?.labels) query.set('labels', params.labels);
        try {
            const res = await fetch(`/api/system/metrics?${query.toString()}`);
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetSystem[key] = data;
            return data;
        } catch (_error) {
            return null;
        }
    }

    /** Bytes as a person reads them: 1.9 GiB, 400 GB is 372.5 GiB. */
    function formatBytes(size) {
        const n = Number(size) || 0;
        if (n <= 0) return '0 B';
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
        let value = n;
        let at = 0;
        while (value >= 1024 && at < units.length - 1) {
            value /= 1024;
            at += 1;
        }
        return `${value >= 100 || at === 0 ? Math.round(value) : value.toFixed(1)} ${units[at]}`;
    }

    function pollSeconds(widget, fallback) {
        return Math.max(Number(widget?.config?.refreshSeconds) || fallback, 1);
    }

    window.DashboardWidgetSystem = {
        fetchMetrics, unavailableText, formatBytes, pollSeconds, label,
    };
}());
```

- [ ] **Step 2: Add the script tag**

In `templates/dashboard.html`, beside the other widget scripts (~line 439-454). It must come **before** the four widget files that use it:

```html
    <script src="{{asset "js/dashboard/dashboard-widget-system.js"}}" defer></script>
```

- [ ] **Step 3: Regenerate asset hashes**

Run: `go generate ./... && git diff --stat internal/app/asset_hashes_gen.go`
Expected: the generated file gains an entry for the new JS file.

- [ ] **Step 4: Verify it loads**

Run the server on port 8099 against a scratch data directory, then:
```bash
curl -s "http://localhost:8099/static/js/dashboard/dashboard-widget-system.js" | head -3
```
Expected: the file's opening comment. Then in a browser console on that dashboard, `window.DashboardWidgetSystem.formatBytes(2040109465)` must give `"1.9 GiB"`.

- [ ] **Step 5: Commit**

```bash
git add static/js/dashboard/dashboard-widget-system.js templates/dashboard.html internal/app/asset_hashes_gen.go
git commit -m "add the shared helper for system widgets"
```

---

## Task 10: CPU widget

**Files:**
- Create: `static/js/dashboard/dashboard-widget-cpu.js`
- Modify: `templates/dashboard.html`
- Test: `tests/widget-cpu.spec.js`

**Interfaces:**
- Consumes: `window.DashboardWidgetSystem` (Task 9), `/api/system/metrics` (Task 6)
- Produces: `window.DashboardWidgets.cpu` — `async render(body, widget, dash)`

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * The CPU tile: a percentage and the load average together, because either
 * alone answers half the question. A load of 4 on four cores is a busy machine
 * that is keeping up; 30% with a load of 12 is a machine that is not.
 *
 * The endpoint is intercepted so the test never depends on the host it runs on.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function renderCPU(page, payload, config = {}) {
    await page.route('**/api/system/metrics**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));

    return page.evaluate(async (cfg) => {
        const host = document.createElement('div');
        host.className = 'dashboard-widget-body';
        document.body.appendChild(host);
        await window.DashboardWidgets.cpu(host, { id: 'w_t', type: 'cpu', config: cfg },
            window.dashboardInstance);
        return host.textContent;
    }, config);
}

test.describe('the cpu widget', () => {
    test('shows the percentage and the load average', async ({ page }) => {
        await openDashboard(page);
        const text = await renderCPU(page, {
            cpu: { available: true, percent: 12.4, load1: 0.07, load5: 0.15, load15: 0.11, cores: 4 },
        }, { showLoad: true });

        expect(text).toContain('12');
        expect(text).toContain('0.07');
    });

    test('says why when the host is not readable, and shows no figures', async ({ page }) => {
        await openDashboard(page);
        const text = await renderCPU(page, {
            cpu: { available: false, reason: 'no-host-proc' },
        });

        // The reason names the setup step, and no invented number appears.
        expect(text.toLowerCase()).toContain('proc');
        expect(text).not.toContain('0%');
    });

    test('waits for the second sample rather than inventing a percentage', async ({ page }) => {
        await openDashboard(page);
        const text = await renderCPU(page, {
            cpu: { available: true, percent: null, load1: 0.07, load5: 0.15, load15: 0.11, cores: 4 },
        }, { showLoad: true });

        // The load average is known immediately; the percentage is not, and
        // showing 0% would be a lie about an idle machine.
        expect(text).toContain('0.07');
        expect(text).not.toContain('0%');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-cpu.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -20 /tmp/pre.txt`
Expected: FAIL — `window.DashboardWidgets.cpu is not a function`

- [ ] **Step 3: Write the widget**

```js
/**
 * Processor: a percentage and the load average, in one tile.
 *
 * Either number alone answers half the question. A load of 4 on four cores is
 * a busy machine keeping up; 30% with a load of 12 is a machine that is not.
 * Shown together they say which of the two is happening.
 *
 * The percentage is missing on the first beat after startup, because /proc/stat
 * is cumulative and a percentage is the delta between two reads. The tile shows
 * the load average and waits rather than printing a zero it did not measure.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const cpu = data?.cpu;

        if (!cpu || !cpu.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, cpu?.reason || 'read-failed'));
            return;
        }

        const config = widget?.config || {};
        const showLoad = config.showLoad !== false;

        if (typeof cpu.percent === 'number') {
            u.headline(panel, `${Math.round(cpu.percent)}%`,
                s.label(dash, 'dashboard.widgetCpuBusy', 'in use'));
        } else {
            // First beat: honest about not knowing yet.
            u.headline(panel, '—', s.label(dash, 'dashboard.widgetCpuSampling', 'measuring…'));
        }

        if (showLoad) {
            const grid = u.statGrid(panel);
            u.row(grid, s.label(dash, 'dashboard.widgetCpuLoad1', '1 min'), cpu.load1.toFixed(2));
            u.row(grid, s.label(dash, 'dashboard.widgetCpuLoad5', '5 min'), cpu.load5.toFixed(2));
            u.row(grid, s.label(dash, 'dashboard.widgetCpuLoad15', '15 min'), cpu.load15.toFixed(2));
        }

        if (config.showCores && cpu.cores > 0) {
            u.footnote(panel, s.label(dash, 'dashboard.widgetCpuCores', '{n} cores')
                .replace('{n}', String(cpu.cores)));
        }
    }

    async function render(body, widget, dash) {
        body.replaceChildren();
        const data = await S().fetchMetrics(dash, 'cpu', { cacheKey: `cpu:${widget.id}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.cpu = render;
}());
```

- [ ] **Step 4: Add the script tag and regenerate hashes**

```html
    <script src="{{asset "js/dashboard/dashboard-widget-cpu.js"}}" defer></script>
```
Then: `go generate ./...`

- [ ] **Step 5: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-cpu.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (3 tests)

- [ ] **Step 6: Falsify the null-percentage rule**

Change `if (typeof cpu.percent === 'number')` to `if (true)` and render `${Math.round(cpu.percent)}%`. Re-run: "waits for the second sample" must FAIL (it prints `0%` or `NaN%`). Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-widget-cpu.js templates/dashboard.html internal/app/asset_hashes_gen.go tests/widget-cpu.spec.js
git commit -m "add the cpu widget"
```

---

## Task 11: Memory widget

**Files:**
- Create: `static/js/dashboard/dashboard-widget-memory.js`
- Modify: `templates/dashboard.html`
- Test: `tests/widget-memory.spec.js`

**Interfaces:**
- Consumes: `window.DashboardWidgetSystem`, `/api/system/metrics`
- Produces: `window.DashboardWidgets.memory`

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Memory: what is in use against the total, with a meter.
 *
 * The number that is most often reported wrongly on Linux, because counting
 * reclaimable page cache as "used" makes every healthy machine look full. The
 * server already subtracts MemAvailable; this pins that the tile shows that
 * figure rather than recomputing it from free.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function renderMemory(page, payload, config = {}) {
    await page.route('**/api/system/metrics**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));

    return page.evaluate(async (cfg) => {
        const host = document.createElement('div');
        host.className = 'dashboard-widget-body';
        document.body.appendChild(host);
        await window.DashboardWidgets.memory(host, { id: 'w_m', type: 'memory', config: cfg },
            window.dashboardInstance);
        return host.textContent;
    }, config);
}

test.describe('the memory widget', () => {
    test('shows what is in use against the total', async ({ page }) => {
        await openDashboard(page);
        // 8 GiB total, 2 GiB in use.
        const text = await renderMemory(page, {
            memory: {
                available: true,
                totalBytes: 8 * 1024 ** 3,
                usedBytes: 2 * 1024 ** 3,
                availableBytes: 6 * 1024 ** 3,
            },
        });

        expect(text).toContain('2');
        expect(text).toContain('8');
        expect(text).toContain('GiB');
    });

    test('can show a percentage instead', async ({ page }) => {
        await openDashboard(page);
        const text = await renderMemory(page, {
            memory: {
                available: true,
                totalBytes: 8 * 1024 ** 3,
                usedBytes: 2 * 1024 ** 3,
                availableBytes: 6 * 1024 ** 3,
            },
        }, { display: 'percent' });

        expect(text).toContain('25');
    });

    test('says why when the host is not readable', async ({ page }) => {
        await openDashboard(page);
        const text = await renderMemory(page, {
            memory: { available: false, reason: 'unsupported-platform' },
        });

        expect(text.toLowerCase()).toContain('linux');
        expect(text).not.toContain('0 B');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-memory.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -20 /tmp/pre.txt`
Expected: FAIL — `window.DashboardWidgets.memory is not a function`

- [ ] **Step 3: Write the widget**

```js
/**
 * Memory: in use against the total.
 *
 * The server subtracts MemAvailable rather than MemFree, so this is memory the
 * machine genuinely cannot hand out -- not page cache it would drop the moment
 * anything asked. Showing the other figure is the classic way to make a
 * perfectly healthy Linux box look permanently full.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const mem = data?.memory;

        if (!mem || !mem.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, mem?.reason || 'read-failed'));
            return;
        }

        const total = Number(mem.totalBytes) || 0;
        const used = Number(mem.usedBytes) || 0;
        const percent = total > 0 ? Math.round((used / total) * 100) : 0;

        if ((widget?.config || {}).display === 'percent') {
            u.headline(panel, `${percent}%`, s.label(dash, 'dashboard.widgetMemoryUsed', 'in use'));
        } else {
            u.headline(panel, s.formatBytes(used),
                s.label(dash, 'dashboard.widgetMemoryOf', 'of {total}')
                    .replace('{total}', s.formatBytes(total)));
        }

        u.meter(panel, used, total, percent > 90 ? 'warn' : 'ok');

        u.footnote(panel, s.label(dash, 'dashboard.widgetMemoryFree', '{free} available')
            .replace('{free}', s.formatBytes(mem.availableBytes)));
    }

    async function render(body, widget, dash) {
        body.replaceChildren();
        const data = await S().fetchMetrics(dash, 'memory', { cacheKey: `memory:${widget.id}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.memory = render;
}());
```

- [ ] **Step 4: Add the script tag and regenerate hashes**

```html
    <script src="{{asset "js/dashboard/dashboard-widget-memory.js"}}" defer></script>
```
Then: `go generate ./...`

- [ ] **Step 5: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-memory.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-widget-memory.js templates/dashboard.html internal/app/asset_hashes_gen.go tests/widget-memory.spec.js
git commit -m "add the memory widget"
```

---

## Task 12: Disks widget

**Files:**
- Create: `static/js/dashboard/dashboard-widget-disks.js`
- Modify: `templates/dashboard.html`
- Test: `tests/widget-disks.spec.js`

**Interfaces:**
- Consumes: `window.DashboardWidgetSystem`, `/api/system/metrics`
- Produces: `window.DashboardWidgets.disks`

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Free space per disk, several in one tile.
 *
 * The tile an Unraid reader wants: the array, the cache and a share, each with
 * its own name, side by side. One disk being unreadable -- spun down, or
 * unmounted -- is that row's problem and must not blank the others.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function renderDisks(page, payload, config = {}) {
    await page.route('**/api/system/metrics**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));

    return page.evaluate(async (cfg) => {
        const host = document.createElement('div');
        host.className = 'dashboard-widget-body';
        document.body.appendChild(host);
        await window.DashboardWidgets.disks(host, { id: 'w_d', type: 'disks', config: cfg },
            window.dashboardInstance);
        return host.textContent;
    }, config);
}

test.describe('the disks widget', () => {
    test('lists each disk by its label with free and total', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDisks(page, {
            disks: {
                available: true,
                mounts: [
                    { path: '/mnt/user', label: 'Files', totalBytes: 1000 * 1024 ** 3, freeBytes: 400 * 1024 ** 3 },
                    { path: '/mnt/cache', label: 'Cache', totalBytes: 500 * 1024 ** 3, freeBytes: 62 * 1024 ** 3 },
                ],
            },
        }, { mounts: ['/mnt/user', '/mnt/cache'] });

        expect(text).toContain('Files');
        expect(text).toContain('Cache');
        // Both figures, so "400 free" is readable against what it is free of.
        expect(text).toMatch(/400|1000/);
    });

    test('one unreadable disk does not blank the others', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDisks(page, {
            disks: {
                available: true,
                mounts: [
                    { path: '/mnt/user', label: 'Files', totalBytes: 1000 * 1024 ** 3, freeBytes: 400 * 1024 ** 3 },
                    { path: '/mnt/disk9', label: 'Disk 9', totalBytes: 0, freeBytes: 0, error: 'unreadable' },
                ],
            },
        }, { mounts: ['/mnt/user', '/mnt/disk9'] });

        // The good disk is still reported...
        expect(text).toContain('Files');
        // ...and the bad one says so rather than showing 0 of 0.
        expect(text).toContain('Disk 9');
        expect(text).not.toMatch(/Disk 9[^A-Za-z]*0 B of 0 B/);
    });

    test('with no disks chosen it says so instead of showing nothing', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDisks(page, {
            disks: { available: false, reason: 'no-mounts-configured' },
        });

        expect(text.length).toBeGreaterThan(0);
        expect(text.toLowerCase()).toContain('settings');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-disks.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -20 /tmp/pre.txt`
Expected: FAIL — `window.DashboardWidgets.disks is not a function`

- [ ] **Step 3: Write the widget**

```js
/**
 * Free space, per disk the reader named.
 *
 * Named rather than enumerated: a container sees dozens of overlay and tmpfs
 * mounts, and a tile listing them all is noise. On Unraid the ones that matter
 * are /mnt/user and /mnt/cache; on a NAS, /volume1. Labels are what turn three
 * paths into "System / Jellyfin / Files".
 *
 * A disk that cannot be read says so on its own row. An array with one drive
 * spun down is exactly the moment the other figures still matter.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const disks = data?.disks;

        if (!disks || !disks.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, disks?.reason || 'no-mounts-configured'));
            return;
        }

        const showMeter = (widget?.config || {}).showMeter !== false;
        const list = u.rowList(panel);

        (disks.mounts || []).forEach((mount) => {
            const name = mount.label || mount.path;
            if (mount.error) {
                u.row(list, name, s.label(dash, 'dashboard.widgetDisksUnreadable', 'unreadable'));
                return;
            }
            const total = Number(mount.totalBytes) || 0;
            const free = Number(mount.freeBytes) || 0;
            const used = total > free ? total - free : 0;
            u.row(list, name, s.label(dash, 'dashboard.widgetDisksFree', '{free} free of {total}')
                .replace('{free}', s.formatBytes(free))
                .replace('{total}', s.formatBytes(total)));
            if (showMeter && total > 0) {
                u.meter(list, used, total, free / total < 0.1 ? 'warn' : 'ok');
            }
        });
    }

    async function render(body, widget, dash) {
        body.replaceChildren();
        const config = widget?.config || {};
        const mounts = Array.isArray(config.mounts) ? config.mounts : [];
        // Labels travel as path=name pairs, so a renamed disk needs no second
        // request and the server never has to know what a label means.
        const labels = Array.isArray(config.labels) ? config.labels.join(',') : '';
        const data = await S().fetchMetrics(dash, 'disks', {
            mounts, labels, cacheKey: `disks:${widget.id}`,
        });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.disks = render;
}());
```

- [ ] **Step 4: Add the script tag and regenerate hashes**

```html
    <script src="{{asset "js/dashboard/dashboard-widget-disks.js"}}" defer></script>
```
Then: `go generate ./...`

- [ ] **Step 5: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-disks.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (3 tests)

- [ ] **Step 6: Falsify the per-row error handling**

Remove the `if (mount.error) { ... return; }` branch. Re-run: "one unreadable disk does not blank the others" must FAIL (the bad row prints `0 B free of 0 B`). Restore and confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add static/js/dashboard/dashboard-widget-disks.js templates/dashboard.html internal/app/asset_hashes_gen.go tests/widget-disks.spec.js
git commit -m "add the disks widget"
```

---

## Task 13: Docker widget

**Files:**
- Create: `static/js/dashboard/dashboard-widget-docker.js`
- Modify: `templates/dashboard.html`
- Test: `tests/widget-docker.spec.js`

**Interfaces:**
- Consumes: `window.DashboardWidgetSystem`, `/api/system/metrics`
- Produces: `window.DashboardWidgets.docker`

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * How many containers are running, of how many exist.
 *
 * "12 running" alone cannot say whether something has stopped; "12 of 17" can.
 * When the socket is not mounted the tile says that rather than reporting zero
 * containers, which would read as "everything is gone".
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

async function renderDocker(page, payload, config = {}) {
    await page.route('**/api/system/metrics**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }));

    return page.evaluate(async (cfg) => {
        const host = document.createElement('div');
        host.className = 'dashboard-widget-body';
        document.body.appendChild(host);
        await window.DashboardWidgets.docker(host, { id: 'w_k', type: 'docker', config: cfg },
            window.dashboardInstance);
        return host.textContent;
    }, config);
}

test.describe('the docker widget', () => {
    test('counts running against total', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDocker(page, {
            docker: { available: true, running: 12, total: 17, byStatus: { running: 12, exited: 5 } },
        });

        expect(text).toContain('12');
        expect(text).toContain('17');
    });

    test('can split by status', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDocker(page, {
            docker: { available: true, running: 12, total: 17, byStatus: { running: 12, exited: 4, paused: 1 } },
        }, { splitByStatus: true });

        expect(text.toLowerCase()).toContain('exited');
        expect(text.toLowerCase()).toContain('paused');
    });

    test('an unmounted socket says so rather than reporting zero containers', async ({ page }) => {
        await openDashboard(page);
        const text = await renderDocker(page, {
            docker: { available: false, reason: 'no-docker-socket' },
        });

        expect(text.toLowerCase()).toContain('docker');
        // "0 of 0" would read as every container having disappeared.
        expect(text).not.toContain('0 of 0');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-docker.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -20 /tmp/pre.txt`
Expected: FAIL — `window.DashboardWidgets.docker is not a function`

- [ ] **Step 3: Write the widget**

```js
/**
 * Containers: how many are running, of how many exist.
 *
 * The second number is the one that makes the first mean something. "12
 * running" cannot tell you a container stopped last night; "12 of 17" can,
 * because 17 was 17 yesterday too.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function draw(body, widget, dash, data) {
        const u = U();
        const s = S();
        const panel = u.panel(body);
        const docker = data?.docker;

        if (!docker || !docker.available) {
            u.say(panel, 'dashboard-widget-empty',
                s.unavailableText(dash, docker?.reason || 'no-docker-socket'));
            return;
        }

        const running = Number(docker.running) || 0;
        const total = Number(docker.total) || 0;

        u.headline(panel, `${running}`,
            s.label(dash, 'dashboard.widgetDockerOf', 'of {total} running')
                .replace('{total}', String(total)));

        if (total > 0) u.meter(panel, running, total, running < total ? 'warn' : 'ok');

        if ((widget?.config || {}).splitByStatus && docker.byStatus) {
            const list = u.rowList(panel);
            Object.entries(docker.byStatus)
                .filter(([state]) => state !== 'running')
                .sort((a, b) => b[1] - a[1])
                .forEach(([state, count]) => u.row(list, state, String(count)));
        }
    }

    async function render(body, widget, dash) {
        body.replaceChildren();
        const data = await S().fetchMetrics(dash, 'docker', { cacheKey: `docker:${widget.id}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.docker = render;
}());
```

- [ ] **Step 4: Add the script tag and regenerate hashes**

```html
    <script src="{{asset "js/dashboard/dashboard-widget-docker.js"}}" defer></script>
```
Then: `go generate ./...`

- [ ] **Step 5: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-docker.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add static/js/dashboard/dashboard-widget-docker.js templates/dashboard.html internal/app/asset_hashes_gen.go tests/widget-docker.spec.js
git commit -m "add the docker widget"
```

---

## Task 14: Config surfaces and settings panels

**Files:**
- Modify: `static/js/dashboard/dashboard-config.js` — `WIDGET_TYPES` (~15318), `WIDGET_SETTINGS` (~15335), `WIDGET_TYPE_GROUPS` (~13411), `widgetTypeGroupLabel` (~13417), `widgetTypeAbout` (~16988)
- Test: `tests/widget-system-config.spec.js`

**Interfaces:**
- Consumes: the four registered types (Task 7)
- Produces: the four types appear in the Types catalogue with working settings panels

- [ ] **Step 1: Write the failing test**

```js
// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The four system types have to be offered, describable and settable.
 *
 * The two tables are deliberate mirrors -- a field the server accepts and the
 * panel never writes is invisible, and a field the panel writes and the server
 * drops is a setting that silently does nothing. The ring0 spec already
 * asserts every offered type declares settings; this adds the specifics.
 */

async function openConfig(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

test.describe('system widgets in config', () => {
    test('all four are offered and grouped', async ({ page }) => {
        await openConfig(page);

        const shape = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            const grouped = C.WIDGET_TYPE_GROUPS.flatMap(([, types]) => types);
            return {
                offered: ['cpu', 'memory', 'disks', 'docker'].filter((t) => C.WIDGET_TYPES.includes(t)),
                grouped: ['cpu', 'memory', 'disks', 'docker'].filter((t) => grouped.includes(t)),
            };
        });

        expect(shape.offered).toHaveLength(4);
        // A type missing from every group never appears in the catalogue.
        expect(shape.grouped).toHaveLength(4);
    });

    test('each declares settings, with the interval floors', async ({ page }) => {
        await openConfig(page);

        const floors = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            const read = (type) => {
                const field = (C.WIDGET_SETTINGS[type] || [])
                    .find((f) => f.key === 'refreshSeconds');
                return field ? field.min : null;
            };
            return { cpu: read('cpu'), memory: read('memory'), disks: read('disks'), docker: read('docker') };
        });

        expect(floors.cpu).toBe(1);
        expect(floors.memory).toBe(2);
        expect(floors.docker).toBe(2);
        expect(floors.disks).toBe(5);
    });

    test('the disks widget takes a list of mountpoints', async ({ page }) => {
        await openConfig(page);

        const kinds = await page.evaluate(() => {
            const C = window.dashboardInstance.config.constructor;
            const field = (C.WIDGET_SETTINGS.disks || []).find((f) => f.key === 'mounts');
            return field ? field.kind : null;
        });

        // A free list, because mountpoints cannot be a fixed set of choices.
        expect(kinds).toBe('tags');
    });

    test('every system type has an about line', async ({ page }) => {
        await openConfig(page);

        const missing = await page.evaluate(() => {
            const cfg = window.dashboardInstance.config;
            return ['cpu', 'memory', 'disks', 'docker']
                .filter((t) => !cfg.widgetTypeAbout(t));
        });

        expect(missing).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PW_WORKERS=2 npx playwright test tests/widget-system-config.spec.js > /tmp/pre.txt 2>&1; echo $?; tail -30 /tmp/pre.txt`
Expected: FAIL — the types are not in `WIDGET_TYPES`

- [ ] **Step 3: Add to WIDGET_TYPES**

```js
    static WIDGET_TYPES = ['health', 'uptime', 'certs', 'trend', 'inbox', 'feeds', 'sources',
        'neglected', 'archive', 'unchecked', 'duplicates', 'trash', 'backups',
        'cpu', 'memory', 'disks', 'docker', 'custom'];
```

- [ ] **Step 4: Add a group**

```js
    static WIDGET_TYPE_GROUPS = [
        ['links', ['health', 'uptime', 'certs', 'trend']],
        ['incoming', ['inbox', 'feeds', 'sources']],
        ['upkeep', ['neglected', 'unchecked', 'duplicates', 'archive', 'trash', 'backups']],
        ['system', ['cpu', 'memory', 'disks', 'docker']],
    ];
```

And in `widgetTypeGroupLabel`'s map:

```js
            system: ['config.widgetGroupSystem', 'How is the machine doing?'],
```

- [ ] **Step 5: Add the settings schemas**

In `WIDGET_SETTINGS`, mirroring `widgetFields` from Task 7 exactly:

```js
        cpu: [
            { key: 'refreshSeconds', kind: 'int', min: 1, max: 3600,
              label: ['config.widgetRefreshSeconds', 'Refresh every (seconds)'],
              hint: ['config.widgetCpuRefreshHint', 'One second is the fastest useful reading.'] },
            { key: 'showLoad', kind: 'bool',
              label: ['config.widgetCpuShowLoad', 'Show load average'] },
            { key: 'showCores', kind: 'bool',
              label: ['config.widgetCpuShowCores', 'Show core count'] },
        ],
        memory: [
            { key: 'refreshSeconds', kind: 'int', min: 2, max: 3600,
              label: ['config.widgetRefreshSeconds', 'Refresh every (seconds)'] },
            { key: 'display', kind: 'choice',
              options: [['bytes', 'config.widgetMemoryBytes', 'Gigabytes'],
                        ['percent', 'config.widgetMemoryPercent', 'Percentage']],
              label: ['config.widgetMemoryDisplay', 'Show as'] },
        ],
        disks: [
            { key: 'refreshSeconds', kind: 'int', min: 5, max: 3600,
              label: ['config.widgetRefreshSeconds', 'Refresh every (seconds)'] },
            { key: 'mounts', kind: 'tags',
              label: ['config.widgetDisksMounts', 'Disks to show'],
              hint: ['config.widgetDisksMountsHint',
                     'Paths as this machine knows them — on Unraid, /mnt/user and /mnt/cache.'] },
            { key: 'labels', kind: 'tags',
              label: ['config.widgetDisksLabels', 'Names for them'],
              hint: ['config.widgetDisksLabelsHint',
                     'Written as path=name, so /mnt/user=Files.'] },
            { key: 'showMeter', kind: 'bool',
              label: ['config.widgetDisksMeter', 'Show a bar per disk'] },
        ],
        docker: [
            { key: 'refreshSeconds', kind: 'int', min: 2, max: 3600,
              label: ['config.widgetRefreshSeconds', 'Refresh every (seconds)'] },
            { key: 'splitByStatus', kind: 'bool',
              label: ['config.widgetDockerSplit', 'List stopped and paused separately'] },
        ],
```

- [ ] **Step 6: Add the about lines**

In `widgetTypeAbout`'s fallback map:

```js
            cpu: 'Processor use and load average, read from the host.',
            memory: 'Memory in use against the total, read from the host.',
            disks: 'Free space on the disks you name.',
            docker: 'How many containers are running, of how many exist.',
```

- [ ] **Step 7: Run test to verify it passes**

Run: `PW_WORKERS=2 npx playwright test tests/widget-system-config.spec.js > /tmp/post.txt 2>&1; echo $?; tail -20 /tmp/post.txt`
Expected: PASS (4 tests)

- [ ] **Step 8: Run the ring0 parity spec**

Run: `PW_WORKERS=2 npx playwright test tests/dashboard-widgets-ring0.spec.js > /tmp/ring0.txt 2>&1; echo $?; grep -E "passed|failed" /tmp/ring0.txt`
Expected: PASS. This is the spec that asserts every offered type has a renderer and settings — the four new types must satisfy it.

- [ ] **Step 9: Commit**

```bash
git add static/js/dashboard/dashboard-config.js tests/widget-system-config.spec.js
git commit -m "offer the system widgets in config"
```

---

## Task 15: Locale parity

**Files:**
- Modify: `locales/en.json`, `locales/nl.json`, `locales/de.json`, `locales/fr.json`, `locales/zh.json`

**Interfaces:**
- Consumes: every `label()` key used in Tasks 9-14
- Produces: five files in parity

- [ ] **Step 1: Collect every key the code uses**

Run:
```bash
grep -ohrE "'(dashboard|config)\.widget(System|Cpu|Memory|Disks|Docker|Refresh|Group)[A-Za-z0-9]*'" \
  static/js/dashboard/dashboard-widget-{system,cpu,memory,disks,docker}.js \
  static/js/dashboard/dashboard-config.js | sort -u
```
Expected: the full list, including `dashboard.widgetSystemNoProc`, `dashboard.widgetCpuBusy`, `config.widgetDisksMounts`, `config.widgetGroupSystem` and the rest.

- [ ] **Step 2: Add every key to all five files**

English values are the fallbacks already written in the code. Translate the others; keep placeholders (`{n}`, `{total}`, `{free}`) intact and untranslated. Setup instructions naming environment variables keep those names verbatim in every language.

Sample for `locales/en.json` (`dashboard` section):
```json
    "widgetSystemNoProc": "Not reading the host yet — mount /proc and set NEXTDASH_HOST_PROC.",
    "widgetSystemUnsupported": "This reading is available on Linux hosts.",
    "widgetSystemNoDocker": "Not connected to Docker — mount the socket and set NEXTDASH_DOCKER_SOCKET.",
    "widgetSystemNoMounts": "No disks chosen yet — name them in this widget’s settings.",
    "widgetSystemReadFailed": "The host answered with something unreadable.",
    "widgetCpuBusy": "in use",
    "widgetCpuSampling": "measuring…",
    "widgetCpuLoad1": "1 min",
    "widgetCpuLoad5": "5 min",
    "widgetCpuLoad15": "15 min",
    "widgetCpuCores": "{n} cores",
    "widgetMemoryUsed": "in use",
    "widgetMemoryOf": "of {total}",
    "widgetMemoryFree": "{free} available",
    "widgetDisksFree": "{free} free of {total}",
    "widgetDisksUnreadable": "unreadable",
    "widgetDockerOf": "of {total} running",
```

And the type names, in the existing `dashboard.widgetType` block:
```json
    "cpu": "Processor",
    "memory": "Memory",
    "disks": "Disks",
    "docker": "Containers",
```

- [ ] **Step 3: Validate parity**

Run: `npm run validate:locale-parity`
Expected: PASS. Then confirm all five files are valid JSON:
```bash
for f in en nl de fr zh; do python3 -c "import json; json.load(open('locales/$f.json')); print('$f ok')"; done
```

- [ ] **Step 4: Verify a translation actually reaches the tile**

Set `language` to `nl` in the scratch data directory's `settings.json`, restart the server on 8099, and render a system widget. Its strings must be Dutch. (Setting the language through `page.evaluate` alone does not apply — it is a server setting.)

- [ ] **Step 5: Commit**

```bash
git add locales/
git commit -m "translate the system widget strings"
```

---

## Task 16: Compose files, documentation and changelog

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.prod.yml`, `docker-compose.proxy.yml`, `MANUAL.md`, `CHANGELOG.md`
- Modify: `locales/*.json` — the Config → Help body for widgets

**Interfaces:**
- Consumes: everything above
- Produces: a reader can set this up without reading the source

- [ ] **Step 1: Add the mounts, commented out, to each compose file**

```yaml
      # System widgets (CPU, memory, disks, containers) read the host through
      # these read-only mounts. Each is optional and independent: add only the
      # ones whose widgets you want.
      #
      # The Docker socket is the one to think about. Read-only still exposes
      # the daemon's whole read API — every container, its image, its
      # environment, its mounts. Use a socket proxy if you would rather not
      # grant that for a container count.
      # - /proc:/host/proc:ro
      # - /mnt:/host/mnt:ro,rslave
      # - /var/run/docker.sock:/var/run/docker.sock:ro
```

and beside the other environment entries:

```yaml
      # - NEXTDASH_HOST_PROC=/host/proc
      # - NEXTDASH_HOST_ROOT=/host/mnt
      # - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock
```

- [ ] **Step 2: Write the MANUAL section**

Add a "System widgets" section written for an Unraid reader adding a container through the template UI, in this order:

1. What the four widgets show.
2. **Unraid, in the template UI** — three Path rows (Container Path `/host/proc`, Host Path `/proc`, Access Mode **Read Only**; `/host/mnt` ← `/mnt`; `/var/run/docker.sock` ← `/var/run/docker.sock`) and three Variable rows with the values above.
3. **Suggested disks:** `/mnt/user` and `/mnt/cache`, with a note that a user share reports the pool total — the same figure Unraid's own dashboard shows.
4. **What the Docker socket grants**, plainly, and the socket-proxy alternative.
5. A compose snippet for Synology, plain Docker and bare-metal Linux.
6. A line saying each widget's refresh interval is set in its own settings, and that a hidden tab stops polling.

- [ ] **Step 3: Update Config → Help in five locales**

Extend the widgets help body with a paragraph naming the four types and pointing at the MANUAL for the mounts. Per convention, Help is translated in all five languages.

- [ ] **Step 4: Add the changelog entry**

Under the existing `## Unreleased` heading, in a `### Widgets` section:

```markdown
- **new — four system widgets.** Processor (percentage and load average), memory, free space per disk, and a Docker container count, each refreshing on its own interval set in its settings. They read the host through read-only mounts you opt into — `/proc`, your disks, and optionally the Docker socket — and a source that is not mounted says so rather than reporting zeros. Built for Unraid and NAS hosts; the manual gives the template rows.
```

- [ ] **Step 5: Verify the docs describe what was built**

Re-read the MANUAL section against the implementation: every environment variable name, every default interval, and every suggested path must match the code. A wrong variable name in the manual is worse than no manual.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml docker-compose.proxy.yml MANUAL.md CHANGELOG.md locales/
git commit -m "document the system widget mounts"
```

---

## Task 17: End-to-end verification against a real host

**Files:** none — this task proves the whole thing works outside the test doubles.

**Interfaces:**
- Consumes: everything
- Produces: a verified working feature, and a written note of what could not be verified

- [ ] **Step 1: Verify the Docker source against a real daemon**

The dial path, the pinned `v1.41` API version and the `State`-field counting
were **proven against a live Docker daemon during planning**: HTTP 200 over the
unix socket with stdlib alone, and `running=1 total=1` matching `docker ps -a`.
So this step is a confirmation, not an open question.

**The socket path is not always `/var/run/docker.sock`.** Docker Desktop puts it
at `~/.docker/run/docker.sock`, which is why `NEXTDASH_DOCKER_SOCKET` is a
variable rather than a constant. Check the machine's real path first:

```bash
docker context ls        # the DOCKER ENDPOINT column names the socket
```

Then:
```bash
NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock PORT=8099 ./nextdash &
curl -s "http://localhost:8099/api/system/metrics?want=docker" | python3 -m json.tool
```
Expected: `available: true` with counts matching `docker ps -aq | wc -l` and
`docker ps -q | wc -l`.

Note when cross-checking: a container restarting between two reads legitimately
reports a different state, which was observed during planning. Compare against
the CLI at the same moment before concluding the counting is wrong.

- [ ] **Step 2: Verify the /proc sources on Linux**

On the same Linux host:
```bash
curl -s "http://localhost:8099/api/system/metrics?want=cpu,memory" | python3 -m json.tool
sleep 2
curl -s "http://localhost:8099/api/system/metrics?want=cpu,memory" | python3 -m json.tool
```
Expected: the first call has `"percent": null`, the second a real number. Memory `totalBytes` must match `free -b`'s total, and `usedBytes` must be well below it on an idle machine.

- [ ] **Step 3: Verify the disks source**

```bash
curl -s "http://localhost:8099/api/system/metrics?want=disks&mounts=/&labels=/=System" | python3 -m json.tool
```
Expected: figures matching `df -B1 /`.

- [ ] **Step 4: Verify in a container with the mounts**

Build the image, run it with the three mounts and three variables from Task 16, and check that the figures now describe the **host** rather than the container: memory total should match the host's, not a cgroup limit.

- [ ] **Step 5: Verify the whole path through the UI**

On a dashboard with real data on port 8099: add each of the four widgets through Config → Widgets, set an interval, confirm the tile updates on its own cadence (watch the number change), and confirm that switching to another tab stops the requests (browser devtools network panel). Then confirm one tile keeps one clock: `window.dashboardInstance.renderCore.widgetTimerCount()`.

- [ ] **Step 6: Regression across the widget suite**

Run:
```bash
PW_WORKERS=2 npx playwright test tests/ --grep "widget" > /tmp/widgets.txt 2>&1; echo $?
grep -E "passed|failed" /tmp/widgets.txt
```
Expected: PASS. Then `go test ./... 2>&1 | tail -20`: PASS.

- [ ] **Step 7: Write down what could not be verified**

If any step could not be run (no Unraid box, no Synology), say so explicitly in the commit message and to the user rather than implying full coverage. Verified-on-Linux-with-Docker is a different claim from verified-on-Unraid.

- [ ] **Step 8: Commit any fixes**

```bash
git add -A
git commit -m "fix what real-host testing found"
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: the mounts and env vars (Tasks 1, 16), the four sources (2-5), the endpoint with `want` and the shared cache (6), Unraid specifics (4, 14, 16), registration (7, 14), the timer widening (8), the four renderers (10-13), settings mirrors (7, 14), locale parity (15), documentation (16), and the "verify against a real daemon" risk the spec called out (17). The spec's "deliberately not in scope" list is respected — no network, temperature, per-container detail, history or alerting appears in any task.

**Placeholders.** None. Every code step carries the actual code; every test step carries the actual test; every run step carries the actual command and its expected result.

**Type consistency.** `SourceStatus` is embedded in all four metrics structs. `resolveHostPath` is defined in Task 1 and used in Task 4. `readMemory`/`readDocker`/`readDisks` are defined in Tasks 3-5 and wired in Task 6. The JS `window.DashboardWidgetSystem` API defined in Task 9 (`fetchMetrics`, `unavailableText`, `formatBytes`, `label`) is exactly what Tasks 10-13 call. `widgetPollSeconds`/`widgetTimerCount` are defined in Task 8 and asserted in its own tests and Task 17. Config keys (`refreshSeconds`, `showLoad`, `showCores`, `display`, `mounts`, `labels`, `showMeter`, `splitByStatus`) match between Go `widgetFields` (Task 7), JS `WIDGET_SETTINGS` (Task 14) and the renderers (Tasks 10-13).

**One thing worth flagging to the executor:** Task 9 assumes `DashboardWidgetUtils` exposes `panel`, `statGrid`, `meter`, `headline`, `footnote`, `rowList`, `row`, `say` and `label` with those signatures. Confirm against `static/js/dashboard/dashboard-widget-utils.js:385-389` before writing Task 10, and adjust the renderers to the real helper names if any differ.
