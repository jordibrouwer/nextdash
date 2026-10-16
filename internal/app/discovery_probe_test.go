package app

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProbeAcceptsHTMLIncludingLogin(t *testing.T) {
	for _, code := range []int{200, 401, 403} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(code)
			_, _ = w.Write([]byte("<html><head><title>Sonarr</title></head></html>"))
		}))
		res := probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: srv.URL, Source: discoveryPort})
		srv.Close()
		if !res.OK || res.Title != "Sonarr" {
			t.Errorf("%d: %+v", code, res)
		}
	}
}

func TestProbeRejectsNonHTML(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	if probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: srv.URL, Source: discoveryPort}).OK {
		t.Fatal("JSON is not a web app")
	}
	srv404 := httptest.NewServer(http.NotFoundHandler())
	defer srv404.Close()
	if probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: srv404.URL, Source: discoveryPort}).OK {
		t.Fatal("404 is not a web app")
	}
}

func TestProbePortFallsBackToHTTPS(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<title>Secure</title>"))
	}))
	defer srv.Close()
	httpURL := "http://" + strings.TrimPrefix(srv.URL, "https://")
	res := probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: httpURL, Source: discoveryPort})
	if !res.OK {
		t.Fatalf("self-signed https on the port must be accepted for the probe: %+v", res)
	}
}

func TestProbeProxyUnresolvableIsAccepted(t *testing.T) {
	res := probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: "https://sonarr.nextdash-test.invalid", Source: discoveryProxy})
	if !res.OK || res.Reason != "unresolved" {
		t.Fatalf("split DNS: %+v", res)
	}
}

func TestProbeProxyRefusedIsRejected(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close() // nothing listens now
	res := probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: "http://" + addr, Source: discoveryProxy})
	if res.OK {
		t.Fatalf("refused must fall back: %+v", res)
	}
}

func TestProbeManualAndLabelSkipProbe(t *testing.T) {
	for _, src := range []discoverySource{discoveryManual, discoveryLabel} {
		if !probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: "http://127.0.0.1:1", Source: src}).OK {
			t.Errorf("%s must be trusted", src)
		}
	}
}

func TestProbeAcceptsOnlyPageAndLoginStatuses(t *testing.T) {
	for _, code := range []int{400, 405, 410, 429} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(code)
			_, _ = w.Write([]byte("<title>Error</title>"))
		}))
		res := probeDiscoveryCandidate(context.Background(), discoveryCandidate{URL: srv.URL, Source: discoveryProxy})
		srv.Close()
		if res.OK {
			t.Errorf("%d with an html error page is not a web app: %+v", code, res)
		}
	}
}
