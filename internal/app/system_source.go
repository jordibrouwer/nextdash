package app

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

/*
Reading the host from inside a container.

nextDash ships as a container, and a container reading /proc sees its own
cgroup rather than the machine. Free space is whatever was mounted in; the
Docker socket is absent unless it was passed. So the host is reached through
explicit, read-only mounts named by these variables: set, the source is read;
unset, it is reported unavailable.

Nothing is inferred, because a plausible wrong number is worse than an honest
gap -- a tile confidently reporting the container's 0.8 GB rootfs as "your
disk" is the failure this arrangement exists to prevent.
*/

// MetricStatus is the availability half of every source's answer. A source
// that cannot be read says why rather than returning zeros.
type MetricStatus struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

const (
	reasonNoHostProc          = "no-host-proc"
	reasonUnsupportedPlatform = "unsupported-platform"
	reasonNoDockerSocket      = "no-docker-socket"
	reasonNoMountsConfigured  = "no-mounts-configured"
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

// dockerSocketPath is empty unless the reader opted in. The path is a variable
// rather than a constant because it genuinely moves: Docker Desktop keeps it
// at ~/.docker/run/docker.sock where Unraid and most Linux hosts use
// /var/run/docker.sock.
func dockerSocketPath() string {
	return envPath("NEXTDASH_DOCKER_SOCKET")
}

// procIsSupported reports whether this platform has /proc at all. Development
// happens on macOS, where an honest "unsupported" beats a fabricated reading.
func procIsSupported() bool {
	return runtime.GOOS == "linux"
}

// procUnavailableReason separates "the mount is missing" from "this machine
// has no /proc", which are different things to tell the reader.
func procUnavailableReason(err error) string {
	if os.IsNotExist(err) && !procIsSupported() {
		return reasonUnsupportedPlatform
	}
	return reasonNoHostProc
}

/*
resolveHostPath turns a mountpoint as the host knows it into one this process
can read.

The reader configures /mnt/user because that is what their machine calls it;
with a prefix set that is read at /host/mnt/mnt/user. Keeping the translation
here means the settings UI never has to show the container's view of anything.

Mountpoints are reader input arriving at a syscall, so the result is confined
to the prefix: a path that climbs out is refused rather than quietly cleaned
into something else.
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
