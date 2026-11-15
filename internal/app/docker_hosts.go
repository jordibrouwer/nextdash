package app

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"
)

/*
The Docker hosts besides this one. `local` is the env socket and is never in
this file; everything here is a remote daemon reached over tcp (a socket proxy)
or tls (the daemon's own TLS, with or without a client certificate).

Kept in docker-hosts.json, not in settings: the general settings page posts a
whole copy back, and a stale copy must not be able to drop or resurrect a host.
Only the hosts API writes this file. The certificates sit apart, in
docker-secrets.json at 0600, and are never handed back.
*/

const (
	dockerLocalHostID    = "local"
	dockerMaxRemoteHosts = 4 // five hosts with `local`
	dockerHostNameMax    = 64
)

const reasonUnknownDockerHost = "unknown-host"

type DockerHost struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"` // "tcp" | "tls"
	Address      string `json:"address"`
	AllowActions bool   `json:"allowActions"`
}

// dockerHostSecret is the PEM material of a tls host. Never serialised into an
// API response; the hosts API reports only whether each part is set.
type dockerHostSecret struct {
	CA   string `json:"ca,omitempty"`
	Cert string `json:"cert,omitempty"`
	Key  string `json:"key,omitempty"`
}

// dockerHostSecretUpdate changes parts of a secret: nil keeps, a pointer to ""
// clears, anything else replaces.
type dockerHostSecretUpdate struct{ CA, Cert, Key *string }

var dockerHostsMu sync.Mutex // before dockerSecretsMu, never the other way

func dockerHostsFilePath() string {
	return filepath.Join(ResolveDataDir(), "docker-hosts.json")
}

// dockerHostIDRe is what the server generates. A file restored from a backup
// is read back through it too: an id becomes part of a file name, so one that
// is not of this shape is never trusted.
var dockerHostIDRe = regexp.MustCompile(`^d_[0-9a-f]{12}$`)

func readDockerHostsLocked() []DockerHost {
	var all []DockerHost
	if data, err := os.ReadFile(dockerHostsFilePath()); err == nil {
		_ = json.Unmarshal(data, &all)
	}
	var out []DockerHost
	for _, h := range all {
		if dockerHostIDRe.MatchString(h.ID) {
			out = append(out, h)
		}
	}
	return out
}

func writeDockerHostsLocked(hosts []DockerHost) error {
	if len(hosts) == 0 {
		err := os.Remove(dockerHostsFilePath())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	data, err := json.Marshal(hosts)
	if err != nil {
		return err
	}
	return writeFileAtomic(dockerHostsFilePath(), data, 0600)
}

func listDockerHosts() []DockerHost {
	dockerHostsMu.Lock()
	defer dockerHostsMu.Unlock()
	return readDockerHostsLocked()
}

func findDockerHost(id string) (DockerHost, bool) {
	for _, h := range listDockerHosts() {
		if h.ID == id {
			return h, true
		}
	}
	return DockerHost{}, false
}

// normalizeDockerHost trims and checks one host against the others. It keeps
// the ID and AllowActions it was given.
func normalizeDockerHost(h DockerHost, others []DockerHost) (DockerHost, error) {
	h.Name = strings.TrimSpace(h.Name)
	h.Address = strings.TrimSpace(h.Address)
	if h.Name == "" {
		return h, errors.New("A host needs a name")
	}
	if utf8.RuneCountInString(h.Name) > dockerHostNameMax {
		return h, errors.New("The name is longer than 64 characters")
	}
	if lower := strings.ToLower(h.Name); lower == "local" || lower == "all" {
		return h, errors.New("That name is taken")
	}
	for _, o := range others {
		if o.ID != h.ID && strings.EqualFold(o.Name, h.Name) {
			return h, errors.New("That name is taken")
		}
	}
	if h.Kind != "tcp" && h.Kind != "tls" {
		return h, errors.New("The kind is tcp or tls")
	}
	host, port, err := net.SplitHostPort(h.Address)
	if err != nil || host == "" || strings.ContainsAny(h.Address, " \t/@?#") {
		return h, errors.New("The address is host:port")
	}
	if n, perr := strconv.Atoi(port); perr != nil || n < 1 || n > 65535 {
		return h, errors.New("The port is 1 to 65535")
	}
	return h, nil
}

func applyDockerHostSecretUpdate(s dockerHostSecret, u dockerHostSecretUpdate) dockerHostSecret {
	if u.CA != nil {
		s.CA = strings.TrimSpace(*u.CA)
	}
	if u.Cert != nil {
		s.Cert = strings.TrimSpace(*u.Cert)
	}
	if u.Key != nil {
		s.Key = strings.TrimSpace(*u.Key)
	}
	return s
}

// checkDockerHostSecret refuses PEM that could never connect, so a bad paste is
// told at once and not on the first call.
func checkDockerHostSecret(h DockerHost, s dockerHostSecret) error {
	if h.Kind != "tls" {
		return nil
	}
	_, err := dockerHostEndpoint{Kind: "tls", Address: h.Address, CA: s.CA, Cert: s.Cert, Key: s.Key}.tlsConfig()
	return err
}

var errDockerHostLimit = errors.New("There is room for four more hosts")

// addDockerHost stores a new host and its certificate material.
func addDockerHost(h DockerHost, u dockerHostSecretUpdate) (DockerHost, error) {
	dockerHostsMu.Lock()
	defer dockerHostsMu.Unlock()
	hosts := readDockerHostsLocked()
	if len(hosts) >= dockerMaxRemoteHosts {
		return h, errDockerHostLimit
	}
	h.ID = "d_" + randomHex(6)
	h, err := normalizeDockerHost(h, hosts)
	if err != nil {
		return h, err
	}
	secret := applyDockerHostSecretUpdate(dockerHostSecret{}, u)
	if h.Kind != "tls" {
		// A tcp host has no use for certificates; none are kept.
		secret = dockerHostSecret{}
	}
	if err := checkDockerHostSecret(h, secret); err != nil {
		return h, err
	}
	if err := saveDockerHostSecret(h.ID, secret); err != nil {
		return h, err
	}
	if err := writeDockerHostsLocked(append(hosts, h)); err != nil {
		_ = saveDockerHostSecret(h.ID, dockerHostSecret{})
		return h, err
	}
	return h, nil
}

var errDockerHostUnknown = errors.New("No such host")

// updateDockerHost changes a host. Changing kind or address of a tls host keeps
// its certificates unless the update clears them.
func updateDockerHost(id string, in DockerHost, u dockerHostSecretUpdate) (DockerHost, error) {
	dockerHostsMu.Lock()
	defer dockerHostsMu.Unlock()
	hosts := readDockerHostsLocked()
	at := -1
	for i := range hosts {
		if hosts[i].ID == id {
			at = i
		}
	}
	if at < 0 {
		return DockerHost{}, errDockerHostUnknown
	}
	old := hosts[at]
	in.ID = id
	h, err := normalizeDockerHost(in, hosts)
	if err != nil {
		return h, err
	}
	oldSecret := readDockerHostSecret(id)
	secret := applyDockerHostSecretUpdate(oldSecret, u)
	if h.Kind != "tls" {
		secret = dockerHostSecret{}
	}
	if err := checkDockerHostSecret(h, secret); err != nil {
		return h, err
	}
	if err := saveDockerHostSecret(id, secret); err != nil {
		return h, err
	}
	hosts[at] = h
	if err := writeDockerHostsLocked(hosts); err != nil {
		return h, err
	}
	forgetDockerEndpoint(dockerEndpointOf(old, oldSecret))
	return h, nil
}

// removeDockerHost deletes a host, its certificates and what was cached for it.
func removeDockerHost(id string) error {
	dockerHostsMu.Lock()
	defer dockerHostsMu.Unlock()
	hosts := readDockerHostsLocked()
	kept := hosts[:0:0]
	var gone *DockerHost
	for i := range hosts {
		if hosts[i].ID == id {
			gone = &hosts[i]
			continue
		}
		kept = append(kept, hosts[i])
	}
	if gone == nil {
		return errDockerHostUnknown
	}
	secret := readDockerHostSecret(id)
	if err := writeDockerHostsLocked(kept); err != nil {
		return err
	}
	if err := saveDockerHostSecret(id, dockerHostSecret{}); err != nil {
		return err
	}
	forgetDockerEndpoint(dockerEndpointOf(*gone, secret))
	// What was found about its images goes with it.
	if err := os.Remove(dockerUpdatesPathFor(id)); err != nil && !os.IsNotExist(err) {
		logWarn(logComponentMutate, "the update results of a removed Docker host could not be deleted: %v", err)
	}
	return nil
}

func dockerEndpointOf(h DockerHost, s dockerHostSecret) dockerHostEndpoint {
	e := dockerHostEndpoint{Kind: h.Kind, Address: h.Address}
	if h.Kind == "tls" {
		e.CA, e.Cert, e.Key = s.CA, s.Cert, s.Key
	}
	return e
}

func readDockerHostSecret(id string) dockerHostSecret {
	dockerSecretsMu.Lock()
	defer dockerSecretsMu.Unlock()
	return readDockerSecrets().Hosts[id]
}

func saveDockerHostSecret(id string, s dockerHostSecret) error {
	dockerSecretsMu.Lock()
	defer dockerSecretsMu.Unlock()
	secrets := readDockerSecrets()
	if s == (dockerHostSecret{}) {
		delete(secrets.Hosts, id)
	} else {
		if secrets.Hosts == nil {
			secrets.Hosts = map[string]dockerHostSecret{}
		}
		secrets.Hosts[id] = s
	}
	return writeDockerSecretsLocked(secrets)
}

// dockerHostAPI is the client for one host: `local` (or no id) is the env
// socket exactly as before, anything else is a configured remote host.
func dockerHostAPI(id string) (*dockerAPI, string) {
	if id == "" || id == dockerLocalHostID {
		return newDockerAPI()
	}
	h, ok := findDockerHost(id)
	if !ok {
		return nil, reasonUnknownDockerHost
	}
	e := dockerEndpointOf(h, readDockerHostSecret(id))
	return &dockerAPI{client: dockerClientFor(e), endpoint: e}, ""
}

// pruneDockerHostSecrets drops certificates of hosts that are no longer in
// docker-hosts.json. A restore that brings back an older list (or none) leaves
// them behind otherwise, unreferenced and unreachable from the UI.
func pruneDockerHostSecrets() {
	dockerHostsMu.Lock()
	defer dockerHostsMu.Unlock()
	known := map[string]bool{}
	for _, h := range readDockerHostsLocked() {
		known[h.ID] = true
	}
	dockerSecretsMu.Lock()
	defer dockerSecretsMu.Unlock()
	secrets := readDockerSecrets()
	changed := false
	for id := range secrets.Hosts {
		if !known[id] {
			delete(secrets.Hosts, id)
			changed = true
		}
	}
	if changed {
		if err := writeDockerSecretsLocked(secrets); err != nil {
			logWarn(logComponentImport, "certificates of removed Docker hosts could not be dropped (%v)", err)
		}
	}
}
