package app

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

/*
Which disks this machine has, so the settings can offer them.

Typing a mountpoint blind is the weak point of naming disks by hand: the reader
has to know what their own machine calls a share, and a typo produces a tile
that says "unreadable" without saying why. So the server lists what is actually
mounted and the panel offers it.

Most of a mount table is plumbing -- proc, sysfs, cgroup, devpts, and a dozen
tmpfs and overlay entries. Offering all of it would be the same noise the
widget refuses to render, so only filesystems that hold storage are kept.
*/

// MountCandidate is one filesystem the reader could watch.
type MountCandidate struct {
	Path   string `json:"path"`
	FSType string `json:"fsType"`
	// TotalBytes and FreeBytes are filled in for the panel, so a reader picks
	// by size rather than by guessing which /mnt/diskN is the big one.
	TotalBytes uint64 `json:"totalBytes,omitempty"`
	FreeBytes  uint64 `json:"freeBytes,omitempty"`
}

// Filesystems that hold nothing a reader would watch. Kept as a deny-list
// rather than an allow-list of real ones, because an allow-list silently drops
// whatever filesystem somebody's NAS turns out to use.
var pseudoFilesystems = map[string]struct{}{
	"proc": {}, "sysfs": {}, "devpts": {}, "devtmpfs": {}, "tmpfs": {},
	"cgroup": {}, "cgroup2": {}, "mqueue": {}, "hugetlbfs": {}, "debugfs": {},
	"tracefs": {}, "securityfs": {}, "pstore": {}, "bpf": {}, "configfs": {},
	"fusectl": {}, "binfmt_misc": {}, "autofs": {}, "ramfs": {}, "squashfs": {},
	"overlay": {}, "nsfs": {}, "rpc_pipefs": {},
}

/*
Paths that are storage in the strictest sense and noise in every practical one.

Beyond the kernel's own trees and container layer directories, a container is
handed the single files Docker injects -- /etc/hosts, /etc/resolv.conf,
/etc/hostname, each a separate mount -- and whatever bind mounts the app itself
was given under /app. None of them is a disk anybody watches.
*/
var noisyMountPrefixes = []string{
	"/var/lib/docker/", "/var/lib/containers/", "/var/lib/kubelet/",
	"/proc", "/sys", "/dev", "/run", "/etc", "/app", "/boot/config",
}

/*
parseMountInfo reads /proc/self/mountinfo.

The format puts optional fields between the mountpoint and a "-" separator, so
the filesystem type is found relative to that separator rather than at a fixed
column -- the mistake that makes a naive parser report the wrong type on any
machine using shared subtrees.
*/
func parseMountInfo(data []byte) []MountCandidate {
	seen := map[string]struct{}{}
	out := []MountCandidate{}

	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		sep := -1
		for i, f := range fields {
			if f == "-" {
				sep = i
				break
			}
		}
		if sep < 0 || sep+1 >= len(fields) {
			continue
		}
		mountPoint := fields[4]
		fsType := fields[sep+1]

		if _, pseudo := pseudoFilesystems[fsType]; pseudo {
			continue
		}
		if isNoisyMount(mountPoint) {
			continue
		}
		if _, done := seen[mountPoint]; done {
			continue
		}
		seen[mountPoint] = struct{}{}
		out = append(out, MountCandidate{Path: mountPoint, FSType: fsType})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func isNoisyMount(path string) bool {
	for _, prefix := range noisyMountPrefixes {
		if path == prefix || strings.HasPrefix(path, prefix+"/") || strings.HasPrefix(path, prefix) && prefix[len(prefix)-1] == '/' {
			return true
		}
	}
	return false
}

/*
hostPathsFrom turns the container's view back into the reader's.

With a prefix configured, /host/mnt/user is /mnt/user as far as the machine is
concerned, and that is what belongs in the settings: offering the container's
path would have somebody typing a view of their own machine that only this
process holds. Anything outside the prefix is dropped -- it could not be read
even if it were chosen.
*/
func hostPathsFrom(mounts []MountCandidate) []MountCandidate {
	prefix := hostRootDir()
	if prefix == "" {
		return mounts
	}

	out := make([]MountCandidate, 0, len(mounts))
	for _, m := range mounts {
		if m.Path != prefix && !strings.HasPrefix(m.Path, prefix+"/") {
			continue
		}
		trimmed := strings.TrimPrefix(m.Path, prefix)
		if trimmed == "" {
			trimmed = "/"
		}
		m.Path = filepath.Clean(trimmed)
		out = append(out, m)
	}
	return out
}

// listMountCandidates reads the machine's mount table, or nothing at all on a
// platform without one -- an empty list means the panel simply offers no
// shortcuts, which is the state it was in before this existed.
func listMountCandidates() []MountCandidate {
	data, err := os.ReadFile(filepath.Join(hostProcDir(), "self", "mountinfo"))
	if err != nil {
		return []MountCandidate{}
	}
	mounts := hostPathsFrom(parseMountInfo(data))

	// Sizes make the list pickable: on Unraid every /mnt/diskN looks alike
	// until you can see which one is the big one.
	for i := range mounts {
		if resolved, err := resolveHostPath(mounts[i].Path); err == nil {
			if stat := statfsBytes(resolved); stat != nil {
				mounts[i].TotalBytes = stat[0]
				mounts[i].FreeBytes = stat[1]
			}
		}
	}
	return mounts
}
