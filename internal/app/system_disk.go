package app

import (
	"syscall"
)

/*
Free space, per filesystem the reader named.

Named rather than enumerated: a container sees dozens of overlay and tmpfs
mounts, and a tile listing them all is noise. On Unraid the ones that matter are
/mnt/user and /mnt/cache; on a NAS, /volume1.

statfs on an Unraid user share reports the pool total, which is the number
Unraid's own dashboard shows and the one the reader expects. Individual
/mnt/diskN paths report per disk. Both come through this same call -- noted
because summing the disks to "fix" the pool figure would be wrong.
*/

// DiskMount is one filesystem, as the reader named it.
//
// Used, free and reserved are kept apart rather than derived from each other:
// reserved blocks belong to root, so they are neither space in use nor space
// anybody can write to, and folding them into either one misreports the disk by
// whole gigabytes.
type DiskMount struct {
	Path          string  `json:"path"`
	Label         string  `json:"label,omitempty"`
	TotalBytes    uint64  `json:"totalBytes"`
	UsedBytes     uint64  `json:"usedBytes"`
	FreeBytes     uint64  `json:"freeBytes"`
	ReservedBytes uint64  `json:"reservedBytes"`
	UsedPercent   float64 `json:"usedPercent"`
	// Inodes run out independently of space -- a filesystem full of small
	// files can refuse a write with gigabytes showing free.
	InodesTotal uint64 `json:"inodesTotal,omitempty"`
	InodesFree  uint64 `json:"inodesFree,omitempty"`
	// Error is this mount's own failure. One unreadable disk does not blank
	// the tile: a spun-down or unmounted array disk is exactly the case where
	// the other figures still matter.
	Error string `json:"error,omitempty"`
}

// DiskMetrics carries the per-mount rows and the totals across them, so a tile
// can lead with one figure instead of making the reader add disks up.
type DiskMetrics struct {
	MetricStatus
	Mounts      []DiskMount `json:"mounts"`
	TotalBytes  uint64      `json:"totalBytes"`
	UsedBytes   uint64      `json:"usedBytes"`
	FreeBytes   uint64      `json:"freeBytes"`
	UsedPercent float64     `json:"usedPercent"`
	Readable    int         `json:"readable"`
	Unreadable  int         `json:"unreadable"`
}

// statfsBytes answers total and available bytes for a path, or nil when the
// filesystem cannot be read. Shared with the mount listing so both ask the
// kernel the same question in the same way.
func statfsBytes(path string) []uint64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return nil
	}
	block := uint64(st.Bsize)
	return []uint64{block * st.Blocks, block * st.Bavail}
}

func readDisks(paths []string, labels map[string]string) DiskMetrics {
	if len(paths) == 0 {
		return DiskMetrics{MetricStatus: MetricStatus{Reason: reasonNoMountsConfigured}}
	}

	out := DiskMetrics{
		MetricStatus: MetricStatus{Available: true},
		Mounts:       make([]DiskMount, 0, len(paths)),
	}
	for _, path := range paths {
		mount := DiskMount{Path: path, Label: labels[path]}

		resolved, err := resolveHostPath(path)
		if err != nil {
			mount.Error = "refused"
			out.Mounts = append(out.Mounts, mount)
			out.Unreadable++
			continue
		}

		var st syscall.Statfs_t
		if err := syscall.Statfs(resolved, &st); err != nil {
			mount.Error = "unreadable"
			out.Mounts = append(out.Mounts, mount)
			out.Unreadable++
			continue
		}

		block := uint64(st.Bsize)
		mount.TotalBytes = block * st.Blocks
		// Bavail, not Bfree: the difference is reserved for root and is not
		// free to whoever is filling this disk up.
		mount.FreeBytes = block * st.Bavail
		mount.UsedBytes = block * (st.Blocks - st.Bfree)
		if st.Bfree >= st.Bavail {
			mount.ReservedBytes = block * (st.Bfree - st.Bavail)
		}
		if mount.TotalBytes > 0 {
			mount.UsedPercent = float64(mount.UsedBytes) / float64(mount.TotalBytes) * 100
		}
		mount.InodesTotal = st.Files
		mount.InodesFree = st.Ffree

		out.Mounts = append(out.Mounts, mount)
		out.Readable++
		out.TotalBytes += mount.TotalBytes
		out.UsedBytes += mount.UsedBytes
		out.FreeBytes += mount.FreeBytes
	}

	if out.TotalBytes > 0 {
		out.UsedPercent = float64(out.UsedBytes) / float64(out.TotalBytes) * 100
	}
	return out
}
