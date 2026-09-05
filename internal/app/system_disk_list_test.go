package app

import "testing"

/*
The mounts worth offering, out of everything the kernel lists.

A container's mount table is mostly plumbing -- proc, sysfs, devpts, cgroup,
and a dozen overlay and tmpfs entries. Offering all of it as "disks you could
watch" is the same noise the widget refuses to render, so the list is filtered
down to filesystems that actually hold storage.
*/

const sampleMountInfo = `155 95 0:55 / / rw,relatime - overlay overlay rw,lowerdir=/x
157 155 0:71 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw
158 155 0:72 / /dev rw,nosuid - tmpfs tmpfs rw,size=65536k,mode=755
159 158 0:73 / /dev/pts rw,nosuid,noexec,relatime - devpts devpts rw,gid=5
201 155 8:1 / /host/root/mnt/user rw,relatime - xfs /dev/sda1 rw
202 155 8:2 / /host/root/mnt/cache rw,relatime - btrfs /dev/sdb1 rw
203 155 8:3 / /host/root/mnt/disk1 ro,relatime - ext4 /dev/sdc1 ro
204 155 0:99 / /sys/fs/cgroup rw,nosuid - cgroup2 cgroup rw
205 155 8:4 / /var/lib/docker/overlay2/abc/merged rw - overlay overlay rw
`

func TestParseMountInfoKeepsOnlyRealStorage(t *testing.T) {
	got := parseMountInfo([]byte(sampleMountInfo))

	paths := map[string]string{}
	for _, m := range got {
		paths[m.Path] = m.FSType
	}

	for _, want := range []string{"/host/root/mnt/user", "/host/root/mnt/cache", "/host/root/mnt/disk1"} {
		if _, ok := paths[want]; !ok {
			t.Fatalf("%q missing from %v", want, paths)
		}
	}
	// The plumbing is not storage anybody watches.
	for _, unwanted := range []string{"/proc", "/dev", "/dev/pts", "/sys/fs/cgroup"} {
		if _, ok := paths[unwanted]; ok {
			t.Fatalf("%q should not be offered", unwanted)
		}
	}
	if paths["/host/root/mnt/user"] != "xfs" {
		t.Fatalf("fstype = %q, want xfs", paths["/host/root/mnt/user"])
	}
}

/*
A container is handed a fistful of mounts nobody would ever watch: the single
files Docker injects (/etc/hosts, /etc/resolv.conf, /etc/hostname) and whatever
bind mounts the app itself was given. Offering those as "disks" is the noise the
whole list exists to avoid.
*/
func TestParseMountInfoDropsInjectedFilesAndAppMounts(t *testing.T) {
	const noisy = `301 155 8:1 / /etc/hostname rw,relatime - ext4 /dev/vda1 rw
302 155 8:1 / /etc/hosts rw,relatime - ext4 /dev/vda1 rw
303 155 8:1 / /etc/resolv.conf rw,relatime - ext4 /dev/vda1 rw
304 155 0:80 / /app/data rw,relatime - virtiofs data rw
305 155 0:81 / /app/static rw,relatime - virtiofs static rw
306 155 8:2 / /mnt/user rw,relatime - xfs /dev/sda1 rw
`
	got := parseMountInfo([]byte(noisy))

	paths := []string{}
	for _, m := range got {
		paths = append(paths, m.Path)
	}
	if len(paths) != 1 || paths[0] != "/mnt/user" {
		t.Fatalf("offered %v, want only /mnt/user", paths)
	}
}

// Docker's own overlay directories are storage in the strictest sense and
// noise in every practical one: nobody watches a layer directory.
func TestParseMountInfoDropsContainerPlumbing(t *testing.T) {
	for _, m := range parseMountInfo([]byte(sampleMountInfo)) {
		if m.Path == "/var/lib/docker/overlay2/abc/merged" {
			t.Fatal("a docker layer directory should not be offered")
		}
	}
}

/*
The reader configures paths as the host knows them, so the list has to be
handed back that way too -- offering /host/root/mnt/user would have them type in the
container's view of their own machine.
*/
func TestListMountsReportsHostPaths(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/root")

	got := hostPathsFrom(parseMountInfo([]byte(sampleMountInfo)))

	want := map[string]bool{"/mnt/user": true, "/mnt/cache": true, "/mnt/disk1": true}
	for _, m := range got {
		if !want[m.Path] {
			t.Fatalf("unexpected path %q -- should be the host's name for it", m.Path)
		}
		delete(want, m.Path)
	}
	if len(want) != 0 {
		t.Fatalf("missing paths: %v", want)
	}
}

// Without a prefix the paths are already the host's own.
func TestListMountsWithoutPrefixIsUnchanged(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "")
	got := hostPathsFrom(parseMountInfo([]byte(sampleMountInfo)))

	found := false
	for _, m := range got {
		if m.Path == "/host/root/mnt/user" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected the path as listed when no prefix is configured")
	}
}

// A mount outside the configured prefix cannot be read anyway, so offering it
// would be offering a path that fails the moment it is used.
func TestListMountsSkipsWhatIsOutsideThePrefix(t *testing.T) {
	t.Setenv("NEXTDASH_HOST_ROOT", "/host/root")
	for _, m := range hostPathsFrom(parseMountInfo([]byte(sampleMountInfo))) {
		if m.Path == "/" {
			t.Fatal("the container's own root is not reachable through the prefix")
		}
	}
}
