package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
A sign-in that answers with a token in its body rather than a cookie: Nginx
Proxy Manager, Pi-hole v6, Duplicati, every PocketBase app. Same cache and same
sign-in-again on a refusal as the cookie; the token travels in the header the
preset names, with or without a prefix.
*/

type tokenService struct {
	logins   int
	lastBody map[string]any
	valid    string
	server   *httptest.Server
}

func newTokenService(t *testing.T, loginPath, answer, header, prefix string) *tokenService {
	t.Helper()
	svc := &tokenService{}
	svc.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == loginPath {
			svc.logins++
			svc.lastBody = map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&svc.lastBody)
			if r.Header.Get("Content-Type") != "application/json" || svc.lastBody["password"] == "wrong" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			svc.valid = fmt.Sprintf("tok-%d", svc.logins)
			_, _ = fmt.Fprintf(w, answer, svc.valid)
			return
		}
		if r.Header.Get(header) != prefix+svc.valid || svc.valid == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"proxy":20,"dead":1}`))
	}))
	t.Cleanup(svc.server.Close)
	return svc
}

func askWithSession(t *testing.T, svc *tokenService, session *CredentialSession) (*Handlers, customWidgetSpec, customWidgetAnswer) {
	t.Helper()
	if err := saveHealthCredential("widget:tok", HealthCredential{Session: session}); err != nil {
		t.Fatal(err)
	}
	h := NewHandlers(NewStore(), embeddedFiles)
	allowLocalForTest(t, h, true)
	spec := customWidgetSpec{URL: svc.server.URL + "/api/reports/hosts", Method: http.MethodGet, CredentialID: "widget:tok"}
	return h, spec, h.askCustomWidget(context.Background(), spec, nil)
}

func TestATokenLoginSendsTheTokenWithItsPrefix(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() { credentialSessionCache = map[string]string{} })
	// Nginx Proxy Manager's shape: identity and secret in, "token" out, Bearer.
	svc := newTokenService(t, "/api/tokens", `{"expires":"2026-10-03T00:00:00Z","token":"%s"}`, "Authorization", "Bearer ")
	h, spec, answer := askWithSession(t, svc, &CredentialSession{
		LoginPath: "/api/tokens", Format: "json", UserField: "identity", PassField: "password",
		User: "admin@example.com", Password: "secret", TokenPath: "token", TokenPrefix: "Bearer ",
	})
	if answer.Status != http.StatusOK || !answer.SignedIn {
		t.Fatalf("status %d, signed in %v, error %q", answer.Status, answer.SignedIn, answer.Error)
	}
	if svc.lastBody["identity"] != "admin@example.com" {
		t.Errorf("login body %v", svc.lastBody)
	}
	// The cached token is reused; a refusal signs in once more.
	_ = h.askCustomWidget(context.Background(), spec, nil)
	if svc.logins != 1 {
		t.Fatalf("signed in %d times, want 1", svc.logins)
	}
	svc.valid = "expired"
	if again := h.askCustomWidget(context.Background(), spec, nil); again.Status != http.StatusOK {
		t.Fatalf("after expiry %d (%q)", again.Status, again.Error)
	}
	if svc.logins != 2 {
		t.Errorf("signed in %d times, want 2", svc.logins)
	}
}

func TestATokenLoginWithoutPrefixAndPasswordOnly(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() { credentialSessionCache = map[string]string{} })
	// Pi-hole v6: a password only, the token one level down, in its own header.
	svc := newTokenService(t, "/api/auth", `{"session":{"valid":true,"sid":"%s","validity":1800}}`, "X-FTL-SID", "")
	_, _, answer := askWithSession(t, svc, &CredentialSession{
		LoginPath: "/api/auth", Format: "json", PassField: "password", Password: "pw",
		TokenPath: "session.sid", TokenHeader: "X-FTL-SID",
		Extra: map[string]any{"remember": false},
	})
	if answer.Status != http.StatusOK {
		t.Fatalf("status %d (%q)", answer.Status, answer.Error)
	}
	if _, sent := svc.lastBody["username"]; sent {
		t.Errorf("a password-only login sent a username: %v", svc.lastBody)
	}
	if svc.lastBody["remember"] != false {
		t.Errorf("the preset's extra field did not go along: %v", svc.lastBody)
	}
}

func TestATokenLoginThatAnswersNoTokenFails(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() { credentialSessionCache = map[string]string{} })
	// A 2FA account on Nginx Proxy Manager answers 200 with a challenge.
	svc := newTokenService(t, "/api/tokens", `{"requires_2fa":true,"challenge_token":"%s"}`, "Authorization", "Bearer ")
	_, _, answer := askWithSession(t, svc, &CredentialSession{
		LoginPath: "/api/tokens", Format: "json", UserField: "identity",
		User: "a@b.c", Password: "secret", TokenPath: "token", TokenPrefix: "Bearer ",
	})
	if answer.Error != "could not sign in to that service" {
		t.Fatalf("error %q, status %d", answer.Error, answer.Status)
	}
	if svc.logins != 1 {
		t.Errorf("signed in %d times, want 1 -- no loop on a refusal", svc.logins)
	}
}

func TestATokenLoginHeaderIsSanitised(t *testing.T) {
	got := sanitizeCredentialSession(&CredentialSession{
		LoginPath: "/login", Format: "json", Password: "p", TokenPath: "token",
		TokenHeader: "Cookie", Extra: map[string]any{"ok": true, "nested": map[string]any{"x": 1}},
	})
	if got.TokenHeader != "Authorization" {
		t.Errorf("token header %q, want Authorization instead of a transport-owned one", got.TokenHeader)
	}
	if _, kept := got.Extra["nested"]; kept || got.Extra["ok"] != true {
		t.Errorf("extra %v", got.Extra)
	}
	if plain := sanitizeCredentialSession(&CredentialSession{LoginPath: "/l", Password: "p", Format: "xml", TokenPath: "t"}); plain.Format != "" || plain.TokenPath != "" {
		t.Errorf("an unknown format kept token fields: %+v", plain)
	}
}
