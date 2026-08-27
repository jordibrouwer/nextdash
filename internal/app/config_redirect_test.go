package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Config no longer renders a page; it redirects into the dashboard shell where
// configuration lives as the #config view. These tests pin that contract and the
// legacy ?section= mapping onto the regrouped view sections.

func TestConfigRedirectsToHash(t *testing.T) {
	t.Parallel()
	h := testHandlersWithLocalBookmarks(t)

	req := httptest.NewRequest(http.MethodGet, "/config", nil)
	rec := httptest.NewRecorder()
	h.Config(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	if got := rec.Header().Get("Location"); got != "/#config" {
		t.Fatalf("Location = %q, want %q", got, "/#config")
	}
}

func TestConfigRedirectMapsLegacySection(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"pages":      "/#config/pages-tags",
		"categories": "/#config/pages-tags",
		"tags":       "/#config/pages-tags",
		"colors":     "/#config/appearance",
		"keyboard":   "/#config/behavior",
		"backups":    "/#config/data-backups",
		"bookmarks":  "/#config", // maps to overview → bare hash
		"unknown":    "/#config",
	}
	for section, want := range cases {
		section, want := section, want
		t.Run(section, func(t *testing.T) {
			t.Parallel()
			h := testHandlersWithLocalBookmarks(t)
			req := httptest.NewRequest(http.MethodGet, "/config?section="+section, nil)
			rec := httptest.NewRecorder()
			h.Config(rec, req)

			if rec.Code != http.StatusFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
			}
			if got := rec.Header().Get("Location"); got != want {
				t.Fatalf("section %q: Location = %q, want %q", section, got, want)
			}
		})
	}
}

// The old /colors bookmark used to redirect to /config#colors. That chained
// through the /config redirect, which reads only ?section= and never sees the
// fragment, so it landed on the overview instead of the colour settings.
func TestColorsRedirectsToAppearance(t *testing.T) {
	t.Parallel()
	h := testHandlersWithLocalBookmarks(t)

	req := httptest.NewRequest(http.MethodGet, "/colors", nil)
	rec := httptest.NewRecorder()
	h.Colors(rec, req)

	if rec.Code != http.StatusMovedPermanently {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMovedPermanently)
	}
	if got := rec.Header().Get("Location"); got != "/#config/appearance" {
		t.Fatalf("Location = %q, want %q", got, "/#config/appearance")
	}
}
