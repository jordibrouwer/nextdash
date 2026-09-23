package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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
		{"open broken", http.MethodPost, "/api/health/open-broken"},
		{"auto-heal suggest", http.MethodGet, "/api/health/auto-heal-suggest?pageId=1&index=0"},
		{"ping", http.MethodGet, "/api/ping?url=https://example.com"},
	}

	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rec := httptest.NewRecorder()
		switch tc.name {
		case "backup":
			h.Backup(rec, req)
		case "bookmark preview":
			h.GetBookmarkPreview(rec, req)
		case "open broken":
			h.OpenBroken(rec, req)
		case "auto-heal suggest":
			h.AutoHealSuggest(rec, req)
		case "ping":
			h.PingURL(rec, req)
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

func TestSanitizeSVGStripsForeignObjectAndDataHref(t *testing.T) {
	t.Parallel()

	raw := []byte(`<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject><image xlink:href="data:text/html,<script>alert(1)</script>"/></svg>`)
	out := string(sanitizeSVGContent(raw))
	if contains := func(s, sub string) bool { return bytes.Contains([]byte(s), []byte(sub)) }; contains(out, "foreignObject") || contains(out, "data:text/html") {
		t.Fatalf("unsafe SVG content remained: %s", out)
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

func TestSecurityHeadersIncludeCSP(t *testing.T) {
	t.Setenv("NEXTDASH_CSP", "")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	securityHeaders(inner).ServeHTTP(rec, req)

	csp := rec.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("expected Content-Security-Policy header")
	}
	if !strings.Contains(csp, "default-src 'self'") {
		t.Fatalf("unexpected CSP: %q", csp)
	}
	if !strings.Contains(csp, "https://api.open-meteo.com") {
		t.Fatalf("expected open-meteo in connect-src, got %q", csp)
	}
	if !strings.Contains(csp, "worker-src 'self' blob:") {
		t.Fatalf("expected worker-src blob in CSP, got %q", csp)
	}
}

func TestSecurityHeadersOmitCSPWhenDisabled(t *testing.T) {
	t.Setenv("NEXTDASH_CSP", "off")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	securityHeaders(inner).ServeHTTP(rec, req)

	if csp := rec.Header().Get("Content-Security-Policy"); csp != "" {
		t.Fatalf("expected no CSP header, got %q", csp)
	}
}

/*
 * Two secrets are compared in time that does not depend on how much matches.
 *
 * `==` on a string stops at the first byte that differs, so how long the answer
 * took says how much of a guess was right, and a guess can be refined from
 * that one byte at a time.
 *
 * What a test can hold is the behaviour, not the timing: same answer, and
 * comparisons that a byte-at-a-time attacker would find informative all read
 * alike.
 */
func TestTokensMatchAnswersTheSameAsEquality(t *testing.T) {
	cases := []struct {
		provided string
		expected string
		want     bool
	}{
		{"s3cret", "s3cret", true},
		{"", "", true},
		{"s3cret", "s3crey", false},
		{"s3cre", "s3cret", false},
		{"s3crett", "s3cret", false},
		{"", "s3cret", false},
		{"s3cret", "", false},
		{"S3CRET", "s3cret", false},
	}
	for _, c := range cases {
		if got := tokensMatch(c.provided, c.expected); got != c.want {
			t.Errorf("tokensMatch(%q, %q) = %v, want %v", c.provided, c.expected, got, c.want)
		}
	}
}

// And the two routes that hold a secret go through it.
func TestWriteAndCaptureAccessUseTheConstantTimeCompare(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "the-write-token")

	req := httptest.NewRequest(http.MethodGet, "/api/anything", nil)
	req.Header.Set("X-NextDash-Token", "the-write-token")
	if !hasWriteAccess(req) {
		t.Error("the right write token was refused")
	}
	req.Header.Set("X-NextDash-Token", "the-write-toke")
	if hasWriteAccess(req) {
		t.Error("a prefix of the write token was accepted")
	}

	capture := httptest.NewRequest(http.MethodGet, "/add?token=the-write-token", nil)
	if !captureAccessAllowed(capture) {
		t.Error("the write token was refused on the capture route")
	}
	wrong := httptest.NewRequest(http.MethodGet, "/add?token=the-write-toke", nil)
	if captureAccessAllowed(wrong) {
		t.Error("a prefix of the write token was accepted on the capture route")
	}
}
