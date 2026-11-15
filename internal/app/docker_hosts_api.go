package app

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/mux"
)

/*
The hosts API behind Config -> Containers -> Connection. Every write takes the
write token. Certificates go in and never come out: a host is reported with
whether each part is set, nothing more.
*/

type dockerHostView struct {
	DockerHost
	HasCA   bool `json:"hasCA"`
	HasCert bool `json:"hasCert"`
	HasKey  bool `json:"hasKey"`
}

type dockerHostBody struct {
	Name         string  `json:"name"`
	Kind         string  `json:"kind"`
	Address      string  `json:"address"`
	AllowActions bool    `json:"allowActions"`
	CA           *string `json:"ca"`
	Cert         *string `json:"cert"`
	Key          *string `json:"key"`
}

func (b dockerHostBody) host() DockerHost {
	return DockerHost{Name: b.Name, Kind: b.Kind, Address: b.Address, AllowActions: b.AllowActions}
}

func (b dockerHostBody) secrets() dockerHostSecretUpdate {
	return dockerHostSecretUpdate{CA: b.CA, Cert: b.Cert, Key: b.Key}
}

func viewDockerHost(h DockerHost) dockerHostView {
	s := readDockerHostSecret(h.ID)
	return dockerHostView{DockerHost: h, HasCA: s.CA != "", HasCert: s.Cert != "", HasKey: s.Key != ""}
}

func readDockerHostBody(w http.ResponseWriter, r *http.Request) (dockerHostBody, bool) {
	var body dockerHostBody
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return body, false
	}
	return body, true
}

func (h *Handlers) DockerHostsListHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	hosts := listDockerHosts()
	out := make([]dockerHostView, 0, len(hosts))
	for _, host := range hosts {
		out = append(out, viewDockerHost(host))
	}
	writeJSON(w, map[string]any{"hosts": out, "max": dockerMaxRemoteHosts})
}

func (h *Handlers) DockerHostAddHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := readDockerHostBody(w, r)
	if !ok {
		return
	}
	host, err := addDockerHost(body.host(), body.secrets())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	logActivity(activityCategoryMutate, "docker.host-add", map[string]any{"id": host.ID, "kind": host.Kind},
		"docker: host "+host.Name+" added")
	writeJSON(w, viewDockerHost(host))
}

func (h *Handlers) DockerHostUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := readDockerHostBody(w, r)
	if !ok {
		return
	}
	id := mux.Vars(r)["id"]
	host, err := updateDockerHost(id, body.host(), body.secrets())
	if errors.Is(err, errDockerHostUnknown) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	logActivity(activityCategoryMutate, "docker.host-edit", map[string]any{"id": host.ID},
		"docker: host "+host.Name+" changed")
	writeJSON(w, viewDockerHost(host))
}

func (h *Handlers) DockerHostRemoveHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	id := mux.Vars(r)["id"]
	host, _ := findDockerHost(id)
	if err := removeDockerHost(id); errors.Is(err, errDockerHostUnknown) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "Could not remove the host", http.StatusInternalServerError)
		return
	}
	logActivity(activityCategoryMutate, "docker.host-remove", map[string]any{"id": id},
		"docker: host "+host.Name+" removed")
	writeJSON(w, map[string]bool{"ok": true})
}

// DockerHostTestHandler checks a host before it is saved, or a saved one by
// id. Parts of the certificate left out of an id-based test come from the
// stored ones, so Edit -> Test works without pasting the key again.
func (h *Handlers) DockerHostTestHandler(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		dockerHostBody
		ID string `json:"id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	host := body.host()
	secret := dockerHostSecret{}
	if body.ID != "" {
		saved, ok := findDockerHost(body.ID)
		if !ok {
			http.Error(w, errDockerHostUnknown.Error(), http.StatusNotFound)
			return
		}
		if host.Address == "" && host.Kind == "" {
			host = saved
		}
		secret = readDockerHostSecret(body.ID)
	}
	secret = applyDockerHostSecretUpdate(secret, body.secrets())
	if _, err := normalizeDockerHost(DockerHost{ID: body.ID, Name: "test", Kind: host.Kind, Address: host.Address}, nil); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, probeDockerHost(r.Context(), dockerEndpointOf(host, secret)))
}

type dockerHostProbe struct {
	OK      bool   `json:"ok"`
	Reason  string `json:"reason,omitempty"`
	Version string `json:"version,omitempty"`
}

func probeDockerHost(ctx context.Context, e dockerHostEndpoint) dockerHostProbe {
	// A client of its own, dropped afterwards: an unsaved host must leave
	// nothing in the caches.
	defer forgetDockerEndpoint(e)
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	get := func(path string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.baseURL()+path, nil)
		if err != nil {
			return nil, err
		}
		return dockerClientFor(e).Do(req)
	}
	// _ping is what a socket proxy allows by default and what every daemon
	// answers; the version is a bonus when /version is allowed too.
	resp, err := get("_ping")
	if err != nil {
		return dockerHostProbe{Reason: dockerHostFailure(err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return dockerHostProbe{Reason: "denied"}
	}
	pong, _ := io.ReadAll(io.LimitReader(resp.Body, 16))
	if resp.StatusCode != http.StatusOK || strings.TrimSpace(string(pong)) != "OK" {
		return dockerHostProbe{Reason: "not-docker"}
	}
	// A socket proxy can pass _ping and still refuse the container list.
	if cr, err := get("containers/json?limit=1"); err == nil {
		cr.Body.Close()
		if cr.StatusCode == http.StatusUnauthorized || cr.StatusCode == http.StatusForbidden {
			return dockerHostProbe{Reason: "containers-denied"}
		}
	}
	out := dockerHostProbe{OK: true}
	if vr, err := get("version"); err == nil {
		defer vr.Body.Close()
		var v struct {
			Version string `json:"Version"`
		}
		if vr.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(vr.Body, 64<<10)).Decode(&v) == nil {
			out.Version = v.Version
		}
	}
	return out
}

// dockerHostFailure puts a dial or handshake error into the few words the
// reader can act on.
func dockerHostFailure(err error) string {
	var unknown x509.UnknownAuthorityError
	var host x509.HostnameError
	var invalid x509.CertificateInvalidError
	var netErr net.Error
	msg := err.Error()
	switch {
	case errors.As(err, &unknown), errors.As(err, &host), errors.As(err, &invalid):
		return "tls-untrusted"
	case strings.Contains(msg, "remote error: tls"), strings.Contains(msg, "certificate required"):
		return "tls-rejected"
	case strings.Contains(msg, "server gave HTTP response to HTTPS client"):
		return "wrong-protocol"
	case strings.Contains(msg, "not a PEM"), strings.Contains(msg, "do not form a pair"):
		return "tls-config"
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		return "timeout"
	}
	return "unreachable"
}
