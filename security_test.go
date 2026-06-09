package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestResetAllDataRequiresConfirm(t *testing.T) {
	t.Parallel()

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodPost, "/api/reset", bytes.NewReader([]byte(`{}`)))
	rec := httptest.NewRecorder()
	h.ResetAllData(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestResetAllDataRequiresTokenWhenConfigured(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-token")

	h := NewHandlers(NewStore(), embeddedFiles)
	body, _ := json.Marshal(map[string]bool{"confirm": true})
	req := httptest.NewRequest(http.MethodPost, "/api/reset", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ResetAllData(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/reset", bytes.NewReader(body))
	req.Header.Set("X-NextDash-Token", "secret-token")
	rec = httptest.NewRecorder()
	h.ResetAllData(rec, req)
	if rec.Code == http.StatusUnauthorized {
		t.Fatalf("expected authorized reset, got 401")
	}

	_ = os.Unsetenv("NEXTDASH_WRITE_TOKEN")
}

func TestHeavyEndpointsRequireTokenWhenConfigured(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-token")

	h := NewHandlers(NewStore(), embeddedFiles)
	cases := []struct {
		name   string
		method string
		path   string
	}{
		{"backup", http.MethodGet, "/api/backup"},
		{"bookmark preview", http.MethodGet, "/api/bookmark-preview?url=https://example.com"},
		{"search index", http.MethodPost, "/api/search-index"},
		{"open broken", http.MethodPost, "/api/health/open-broken"},
		{"auto-heal suggest", http.MethodGet, "/api/health/auto-heal-suggest?pageId=1&index=0"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rec := httptest.NewRecorder()
		switch tc.name {
		case "backup":
			h.Backup(rec, req)
		case "bookmark preview":
			h.GetBookmarkPreview(rec, req)
		case "search index":
			h.BuildSearchIndex(rec, req)
		case "open broken":
			h.OpenBroken(rec, req)
		case "auto-heal suggest":
			h.AutoHealSuggest(rec, req)
		}
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", tc.name, rec.Code)
		}
	}

	_ = os.Unsetenv("NEXTDASH_WRITE_TOKEN")
}

func TestHeavyEndpointsWorkWithoutTokenWhenUnset(t *testing.T) {
	_ = os.Unsetenv("NEXTDASH_WRITE_TOKEN")

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodGet, "/api/bookmark-preview?url=https://example.com", nil)
	rec := httptest.NewRecorder()
	h.GetBookmarkPreview(rec, req)
	if rec.Code == http.StatusUnauthorized {
		t.Fatal("preview should not require token when NEXTDASH_WRITE_TOKEN is unset")
	}
}

func TestDeletePageRequiresTokenWhenConfigured(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-token")

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodDelete, "/api/pages/2", nil)
	rec := httptest.NewRecorder()
	h.DeletePage(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
