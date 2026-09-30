package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// With a write token set, GET /api/settings (CORS *) must not hand the stored
// keys to a reader without it, and a settings POST that leaves them out keeps
// them.
func TestGetSettingsBlanksSecretsWithoutTheToken(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	h := newTestHandlers(t)
	s := h.store.GetSettings()
	s.ArchiveSaveSecret = "archive-secret"
	s.MonitorNotifyPushoverToken = "po-token"
	s.MonitorNotifyURL = "https://api.telegram.org/botSECRET/sendMessage"
	if err := h.store.SaveSettings(s); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.GetSettings(rec, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
	body := rec.Body.String()
	for _, secret := range []string{"archive-secret", "po-token", "botSECRET"} {
		if strings.Contains(body, secret) {
			t.Fatalf("settings without the token leak %q", secret)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/settings", nil)
	req.Header.Set("X-NextDash-Token", "tok")
	rec = httptest.NewRecorder()
	h.GetSettings(rec, req)
	var withToken Settings
	_ = json.Unmarshal(rec.Body.Bytes(), &withToken)
	if withToken.ArchiveSaveSecret != "archive-secret" {
		t.Fatalf("the app's own read, with the token, must see the stored key")
	}

	post := httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(`{"theme":"default"}`))
	post.Header.Set("X-NextDash-Token", "tok")
	rec = httptest.NewRecorder()
	h.SaveSettings(rec, post)
	if rec.Code != http.StatusOK {
		t.Fatalf("save = %d %s", rec.Code, rec.Body.String())
	}
	if got := h.store.GetSettings().MonitorNotifyPushoverToken; got != "po-token" {
		t.Fatalf("a save without the key wiped it: %q", got)
	}
}

func TestGetServerLogNeedsTheToken(t *testing.T) {
	t.Setenv("NEXTDASH_WRITE_TOKEN", "tok")
	h := newTestHandlers(t)
	rec := httptest.NewRecorder()
	h.GetServerLog(rec, httptest.NewRequest(http.MethodGet, "/api/logs", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 like download and clear", rec.Code)
	}
}
