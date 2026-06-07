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
