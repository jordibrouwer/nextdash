package app

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"net/http"
)

/*
Where a Docker daemon is reached. The env socket is the unix kind and always
was; the other two are for daemons on another machine, behind a socket proxy
(tcp) or with the daemon's own TLS (tls, optionally with a client certificate).

Kind "unix" exists only in code: settings only ever hold tcp and tls.
*/
type dockerHostEndpoint struct {
	Kind    string // "unix" | "tcp" | "tls"
	Address string // unix: socket path; tcp and tls: "host:port"
	// PEM, tls only. Cert and Key are optional but only used as a pair.
	CA, Cert, Key string
}

func unixDockerEndpoint(path string) dockerHostEndpoint {
	return dockerHostEndpoint{Kind: "unix", Address: path}
}

// key names the endpoint in the client caches. A tls key carries a hash of the
// PEMs, never the PEMs, so a replaced certificate gets a new client and no
// secret ends up in a map key that might be logged.
func (e dockerHostEndpoint) key() string {
	switch e.Kind {
	case "tcp":
		return "tcp://" + e.Address
	case "tls":
		sum := sha256.Sum256([]byte(e.CA + "\x00" + e.Cert + "\x00" + e.Key))
		return "tls://" + e.Address + "#" + hex.EncodeToString(sum[:])[:12]
	}
	return "unix:" + e.Address
}

// baseURL is what every path is appended to. A unix socket has no host, so any
// name does; tcp and tls use the real address, which is also what the TLS
// handshake checks the certificate against.
func (e dockerHostEndpoint) baseURL() string {
	switch e.Kind {
	case "tcp":
		return "http://" + e.Address + "/"
	case "tls":
		return "https://" + e.Address + "/"
	}
	return "http://docker/"
}

func (e dockerHostEndpoint) tlsConfig() (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if e.CA != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(e.CA)) {
			return nil, errors.New("the CA is not a PEM certificate")
		}
		cfg.RootCAs = pool
	}
	if e.Cert != "" || e.Key != "" {
		pair, err := tls.X509KeyPair([]byte(e.Cert), []byte(e.Key))
		if err != nil {
			return nil, errors.New("the client certificate and key do not form a pair")
		}
		cfg.Certificates = []tls.Certificate{pair}
	}
	return cfg, nil
}

// brokenTransport answers every request with the error that kept the real
// transport from being built, so a bad certificate shows as a failed call with
// a reason rather than as a client that was never made.
type brokenTransport struct{ err error }

func (b brokenTransport) RoundTrip(*http.Request) (*http.Response, error) { return nil, b.err }
