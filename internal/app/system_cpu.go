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
Processor: a percentage and the load average.

/proc/stat counts jiffies since boot, so a percentage is the difference between
two reads rather than anything a single read contains. The sampler keeps the
previous one; the first call after startup reports available with a null
percentage, and the tile shows the load average until the second beat.

Blocking inside the request to take a second sample would make every first
paint slow, and guessing from one sample would report a number nobody measured.
Both figures are shown together because either alone answers half the question:
a load of 4 on four cores is a busy machine keeping up, while 30% with a load
of 12 is a machine that is not.
*/

// CPUMetrics is what the endpoint reports for the processor. Percent is a
// pointer because "not known yet" is a real state, distinct from 0%.
type CPUMetrics struct {
	MetricStatus
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

/*
parseProcStat reads the aggregate "cpu " line and counts the per-core lines.

Idle is idle+iowait, both being time the processor was not working. Total is
every field on that line, so the busy share is the remainder -- which keeps
this correct as kernels add fields to the end.
*/
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
			// user, nice, system, idle, iowait, ...
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

/*
percentFrom folds one cumulative reading into the previous one.

Returns nil until there is a previous one to compare against, and again if the
counters went backwards -- a reboot, or the mount changing underneath us. One
beat of "measuring" is better than one beat of nonsense.
*/
func (s *cpuSampler) percentFrom(idle, total uint64) *float64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	prevIdle, prevAll, seeded := s.lastIdle, s.lastAll, s.seeded
	s.lastIdle, s.lastAll, s.seeded = idle, total, true
	if !seeded || total < prevAll || idle < prevIdle {
		return nil
	}
	deltaAll := float64(total - prevAll)
	if deltaAll <= 0 {
		// No time passed between reads: nothing happened, which is 0% busy.
		zero := 0.0
		return &zero
	}
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
		return CPUMetrics{MetricStatus: MetricStatus{Reason: procUnavailableReason(err)}}
	}
	idle, total, cores, err := parseProcStat(statData)
	if err != nil {
		return CPUMetrics{MetricStatus: MetricStatus{Reason: reasonReadFailed}}
	}
	out := CPUMetrics{
		MetricStatus: MetricStatus{Available: true},
		Percent:      s.percentFrom(idle, total),
		Cores:        cores,
	}
	// The load average is a separate file, and a machine without it is not a
	// reason to withhold the percentage.
	if loadData, loadErr := os.ReadFile(filepath.Join(dir, "loadavg")); loadErr == nil {
		out.Load1, out.Load5, out.Load15, _ = parseLoadAvg(loadData)
	}
	return out
}
