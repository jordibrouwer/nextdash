package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPStatusReachable(t *testing.T) {
	tests := []struct {
		code int
		want bool
	}{
		{200, true},
		{301, true},
		{302, true},
		{401, true},
		{403, true},
		{404, true},
		{429, true},
		{500, false},
		{502, false},
		{503, false},
	}
	for _, tc := range tests {
		if got := httpStatusReachable(tc.code); got != tc.want {
			t.Errorf("httpStatusReachable(%d) = %v, want %v", tc.code, got, tc.want)
		}
	}
}

func TestPingURLDetailedTreatsClientErrorsAsOnline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	h := &Handlers{store: &FileStore{}}
	result := h.pingURLDetailed(context.Background(), server.URL)
	if result.Status != "online" {
		t.Fatalf("status = %q, want online for HTTP 404", result.Status)
	}
	if result.HTTPStatus != http.StatusNotFound {
		t.Fatalf("http status = %d, want 404", result.HTTPStatus)
	}
	if result.ErrorDetail != "" {
		t.Fatalf("error detail = %q, want empty for reachable 404", result.ErrorDetail)
	}
}

func TestPingURLDetailedTreatsServerErrorsAsOffline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	h := &Handlers{store: &FileStore{}}
	result := h.pingURLDetailed(context.Background(), server.URL)
	if result.Status != "offline" {
		t.Fatalf("status = %q, want offline for HTTP 503", result.Status)
	}
	if result.ErrorDetail != "HTTP 503" {
		t.Fatalf("error detail = %q, want HTTP 503", result.ErrorDetail)
	}
}
