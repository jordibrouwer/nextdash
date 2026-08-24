package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthPageRedirectsToHash(t *testing.T) {
	t.Parallel()
	h := testHandlersWithLocalBookmarks(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.HealthPage(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	if got := rec.Header().Get("Location"); got != "/#health" {
		t.Fatalf("Location = %q, want %q", got, "/#health")
	}
}

func TestHealthPageRedirectMapsLegacyQueryParams(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"/health?filter=broken":         "/?hv_filter=broken#health",
		"/health?q=example":             "/?hv_q=example#health",
		"/health?sort=name":             "/?hv_sort=name#health",
		"/health?refresh=1":             "/?hv_refresh=1#health",
		"/health?page=2":                "/?page=2#health",
		"/health?id=1%3A4":              "/?hv_id=1%3A4#health",
		"/health?filter=stale&id=1%3A0": "/?hv_filter=stale&hv_id=1%3A0#health",
	}
	for path, want := range cases {
		path, want := path, want
		t.Run(path, func(t *testing.T) {
			t.Parallel()
			h := testHandlersWithLocalBookmarks(t)
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			h.HealthPage(rec, req)

			if rec.Code != http.StatusFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
			}
			if got := rec.Header().Get("Location"); got != want {
				t.Fatalf("Location = %q, want %q", got, want)
			}
		})
	}
}
