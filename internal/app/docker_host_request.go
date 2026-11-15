package app

import (
	"net/http"
	"strings"
)

/*
Which host a Containers-view request is about. `?host=` names one; no value or
`local` is the env socket and behaves exactly as it did before hosts existed.
One host per request: the view shows one host at a time, so nothing here
merges lists.

Everything that reads or writes this install's own state (update choices, the
timeline, history, disk figures, the notifier) is local only. A remote host
asking for one of them is refused with reasonDockerLocalOnly rather than being
answered with the local host's data under the remote's name.
*/

const reasonDockerLocalOnly = "local-only"

// dockerHostOf is the host id of a request, "local" when none is named.
func dockerHostOf(r *http.Request) string {
	id := strings.TrimSpace(r.URL.Query().Get("host"))
	if id == "" {
		return dockerLocalHostID
	}
	return id
}

func dockerRemote(r *http.Request) bool { return dockerHostOf(r) != dockerLocalHostID }

func (h *Handlers) dockerAPIFor(r *http.Request) (*dockerAPI, string) {
	return dockerHostAPI(dockerHostOf(r))
}

// dockerLocalOnly refuses a remote host's request and says so; true means the
// handler must stop.
func dockerLocalOnly(w http.ResponseWriter, r *http.Request) bool {
	if !dockerRemote(r) {
		return false
	}
	dockerRefuse(w, http.StatusForbidden, reasonDockerLocalOnly)
	return true
}

// dockerHostControl is whether actions are switched on for the host a request
// names: the env opt-in for local, the host's own switch for a remote one.
func dockerHostControl(r *http.Request) bool {
	if !dockerRemote(r) {
		return dockerControlEnabled()
	}
	host, ok := findDockerHost(dockerHostOf(r))
	return ok && host.AllowActions
}

// dockerReasonFor says why a host cannot be reached: the socket words for the
// local host, and for a remote one what a person can act on (refused, timeout,
// a certificate that does not fit).
func dockerReasonFor(r *http.Request, err error) string {
	if dockerRemote(r) {
		return dockerHostFailure(err)
	}
	return dockerDialReason(err)
}
