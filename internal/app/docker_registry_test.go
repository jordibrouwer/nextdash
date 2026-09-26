package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseImageRef(t *testing.T) {
	cases := map[string]imageRef{
		"nginx":                                   {"registry-1.docker.io", "library/nginx", "latest"},
		"linuxserver/sonarr:4.0":                  {"registry-1.docker.io", "linuxserver/sonarr", "4.0"},
		"lscr.io/linuxserver/sonarr:latest":       {"lscr.io", "linuxserver/sonarr", "latest"},
		"ghcr.io/jordibrouwer/nextdash":           {"ghcr.io", "jordibrouwer/nextdash", "latest"},
		"host:5000/app:1":                         {"host:5000", "app", "1"},
		"docker.io/library/nginx:1.27":            {"registry-1.docker.io", "library/nginx", "1.27"},
		"localhost:5000/app":                      {"localhost:5000", "app", "latest"},
		"quay.io/prometheus/node-exporter:v1.8.0": {"quay.io", "prometheus/node-exporter", "v1.8.0"},
	}
	for in, want := range cases {
		got, ok := parseImageRef(in)
		if !ok || got != want {
			t.Fatalf("%q = %+v, want %+v", in, got, want)
		}
	}
	if _, ok := parseImageRef("nginx@sha256:abc"); ok {
		t.Fatal("a digest-pinned ref has no update to find")
	}
}

func TestRemoteDigestFollowsBearerChallenge(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			if r.URL.Query().Get("scope") != "repository:library/nginx:pull" {
				t.Errorf("scope = %q", r.URL.Query().Get("scope"))
			}
			w.Write([]byte(`{"token":"t0k"}`))
		case r.Header.Get("Authorization") != "Bearer t0k":
			w.Header().Set("Www-Authenticate", `Bearer realm="`+srv.URL+`/token",service="reg"`)
			w.WriteHeader(401)
		case r.Method == http.MethodHead && r.URL.Path == "/v2/library/nginx/manifests/latest":
			w.Header().Set("Docker-Content-Digest", "sha256:remote")
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	l := &registryLookup{client: srv.Client(), scheme: "http"}
	ref := imageRef{Registry: strings.TrimPrefix(srv.URL, "http://"), Repo: "library/nginx", Tag: "latest"}
	digest, reason, err := l.remoteDigest(context.Background(), ref)
	if err != nil || reason != "" || digest != "sha256:remote" {
		t.Fatalf("digest = %q reason = %q err = %v", digest, reason, err)
	}
}

func TestRemoteDigestReasons(t *testing.T) {
	for code, want := range map[int]string{429: "rate-limited", 404: "not-found", 403: "auth-required"} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(code) }))
		l := &registryLookup{client: srv.Client(), scheme: "http"}
		_, reason, _ := l.remoteDigest(context.Background(), imageRef{strings.TrimPrefix(srv.URL, "http://"), "a/b", "1"})
		srv.Close()
		if reason != want {
			t.Fatalf("%d -> %q, want %q", code, reason, want)
		}
	}
}
