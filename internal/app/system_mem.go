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
and buffers are handed back the moment anything needs them, so counting them as
used is what makes a healthy Linux box look permanently full -- the single most
common way this figure is reported wrongly, and the reason a NAS owner panics
about "7 GB used" on an idle machine.

Cache is reported separately rather than hidden, because it is the other half
of that story: memory that is busy and instantly available at the same time.
*/

// MemoryMetrics is what the endpoint reports for memory.
type MemoryMetrics struct {
	MetricStatus
	TotalBytes     uint64  `json:"totalBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	FreeBytes      uint64  `json:"freeBytes"`
	CacheBytes     uint64  `json:"cacheBytes"`
	UsedPercent    float64 `json:"usedPercent"`

	// Swap is absent on plenty of machines, so "none" is said rather than
	// drawn as nought of nought.
	HasSwap        bool    `json:"hasSwap"`
	SwapTotalBytes uint64  `json:"swapTotalBytes,omitempty"`
	SwapUsedBytes  uint64  `json:"swapUsedBytes,omitempty"`
	SwapPercent    float64 `json:"swapPercent,omitempty"`
}

var errMalformedMemInfo = errors.New("malformed /proc/meminfo")

// parseMemInfo reads the fields worth reporting out of /proc/meminfo, whose
// values are in kB whatever the label says.
func parseMemInfo(data []byte) (MemoryMetrics, error) {
	fields := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		value, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			continue
		}
		fields[strings.TrimSuffix(parts[0], ":")] = value * 1024
	}

	total := fields["MemTotal"]
	if total == 0 {
		return MemoryMetrics{}, errMalformedMemInfo
	}

	out := MemoryMetrics{
		MetricStatus:   MetricStatus{Available: true},
		TotalBytes:     total,
		AvailableBytes: fields["MemAvailable"],
		FreeBytes:      fields["MemFree"],
		CacheBytes:     fields["Buffers"] + fields["Cached"],
	}
	if total > out.AvailableBytes {
		out.UsedBytes = total - out.AvailableBytes
	}
	out.UsedPercent = float64(out.UsedBytes) / float64(total) * 100

	if swapTotal := fields["SwapTotal"]; swapTotal > 0 {
		out.HasSwap = true
		out.SwapTotalBytes = swapTotal
		if free := fields["SwapFree"]; swapTotal > free {
			out.SwapUsedBytes = swapTotal - free
		}
		out.SwapPercent = float64(out.SwapUsedBytes) / float64(swapTotal) * 100
	}
	return out, nil
}

func readMemory() MemoryMetrics {
	data, err := os.ReadFile(filepath.Join(hostProcDir(), "meminfo"))
	if err != nil {
		return MemoryMetrics{MetricStatus: MetricStatus{Reason: procUnavailableReason(err)}}
	}
	out, err := parseMemInfo(data)
	if err != nil {
		return MemoryMetrics{MetricStatus: MetricStatus{Reason: reasonReadFailed}}
	}
	return out
}
