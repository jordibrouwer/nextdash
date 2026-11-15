package app

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDockerEndpointTCPListsContainers(t *testing.T) {
	f, addr := startFakeDockerTCP(t)
	f.add(fakeContainer{ID: strings.Repeat("a", 64), Name: "pihole", State: "running"})
	e := dockerHostEndpoint{Kind: "tcp", Address: addr}
	api := &dockerAPI{endpoint: e, client: dockerClientFor(e)}
	list, err := api.listContainers(context.Background())
	if err != nil || len(list) != 1 || list[0].name() != "pihole" {
		t.Fatalf("list = %+v, %v", list, err)
	}
}

func TestDockerEndpointTLSNeedsClientCert(t *testing.T) {
	f, addr, pki := startFakeDockerTLS(t, true)
	f.add(fakeContainer{ID: strings.Repeat("b", 64), Name: "web", State: "running"})

	without := dockerHostEndpoint{Kind: "tls", Address: addr, CA: pki.CA}
	api := &dockerAPI{endpoint: without, client: dockerClientFor(without)}
	if _, err := api.listContainers(context.Background()); err == nil {
		t.Fatal("listed without a client certificate")
	}

	with := dockerHostEndpoint{Kind: "tls", Address: addr, CA: pki.CA, Cert: pki.Cert, Key: pki.Key}
	api = &dockerAPI{endpoint: with, client: dockerClientFor(with)}
	list, err := api.listContainers(context.Background())
	if err != nil || len(list) != 1 {
		t.Fatalf("with cert: %+v, %v", list, err)
	}
}

func TestDockerEndpointTLSRefusesAnUnknownCA(t *testing.T) {
	_, addr, _ := startFakeDockerTLS(t, false)
	other := newDockerTestPKI(t)
	e := dockerHostEndpoint{Kind: "tls", Address: addr, CA: other.CA}
	api := &dockerAPI{endpoint: e, client: dockerClientFor(e)}
	if _, err := api.listContainers(context.Background()); err == nil {
		t.Fatal("trusted a daemon whose certificate the CA did not sign")
	}
}

func TestDockerEndpointKeyChangesWithSecrets(t *testing.T) {
	a := dockerHostEndpoint{Kind: "tls", Address: "h:2376", CA: "x"}
	b := dockerHostEndpoint{Kind: "tls", Address: "h:2376", CA: "y"}
	if a.key() == b.key() {
		t.Fatal("a new CA must give a new client")
	}
	if strings.Contains(a.key(), "x\x00") || strings.Contains(a.key(), "CA") {
		t.Fatal("key must not carry the PEM")
	}
}

func TestDockerEndpointBadPEMIsAnError(t *testing.T) {
	e := dockerHostEndpoint{Kind: "tls", Address: "h:2376", CA: "not a pem"}
	if _, err := e.tlsConfig(); err == nil {
		t.Fatal("want an error for a CA that is not PEM")
	}
	api := &dockerAPI{endpoint: e, client: dockerClientFor(e)}
	if _, err := api.listContainers(context.Background()); err == nil {
		t.Fatal("a call through a broken certificate must fail, not dial")
	}
}

func TestForgetDockerEndpointDropsTheClient(t *testing.T) {
	e := dockerHostEndpoint{Kind: "tcp", Address: "127.0.0.1:1"}
	first := dockerClientFor(e)
	forgetDockerEndpoint(e)
	if dockerClientFor(e) == first {
		t.Fatal("client survived forgetDockerEndpoint")
	}
}

// A proxy that answers 503 while the daemon behind it starts must not pin the
// default version: Docker 29 refuses anything below 1.44.
func TestAPIVersionIsNotCachedFromAServerError(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/version" {
			http.NotFound(w, r)
			return
		}
		if fail.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"MinAPIVersion":"1.44"}`))
	}))
	defer srv.Close()
	e := dockerHostEndpoint{Kind: "tcp", Address: strings.TrimPrefix(srv.URL, "http://")}
	defer forgetDockerEndpoint(e)
	if got := dockerAPIVersionFor(e); got != dockerAPIVersion {
		t.Fatalf("while down: %s", got)
	}
	fail.Store(false)
	if got := dockerAPIVersionFor(e); got != "v1.44" {
		t.Fatalf("after it came up: %s (the 503 was cached)", got)
	}
}

func TestAPIVersionLookupDoesNotWaitOutAHungHost(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			defer c.Close()
		}
	}()
	old := dockerAPIVersionLookupTimeout
	dockerAPIVersionLookupTimeout = 200 * time.Millisecond
	defer func() { dockerAPIVersionLookupTimeout = old }()
	e := dockerHostEndpoint{Kind: "tcp", Address: ln.Addr().String()}
	defer forgetDockerEndpoint(e)
	start := time.Now()
	dockerAPIVersionFor(e)
	if time.Since(start) > 2*time.Second {
		t.Fatalf("lookup held for %v", time.Since(start))
	}
}
