package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

/*
A self-hosted service behind an API key answers 401 to an anonymous check, so
monitoring one means the row reads "broken" while the service is fine. These
cover the three ways out and the boundaries each of them must keep.
*/

// The secret goes in its own file, not on the bookmark, because bookmarks-N.json
// is in the backup allowlist and in every export.
func TestCredentialsAreStoredOutsideTheBookmarksFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	const secret = "super-secret-api-key"
	if err := saveHealthCredential("sonarr:attic", HealthCredential{
		Label:   "Sonarr",
		Headers: map[string]string{"X-Api-Key": secret},
	}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(healthCredentialFilePath())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), secret) {
		t.Fatal("the credential was not stored")
	}

	info, err := os.Stat(healthCredentialFilePath())
	if err != nil {
		t.Fatal(err)
	}
	// 0600, for the same reason sources.json is: on a multi-user host 0644
	// means every account on the machine can read it.
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("mode is %o, want 600", perm)
	}
}

// The form needs labels to offer a choice; it never needs the values, and a
// route that returns them is a route that can be asked for them.
func TestListingCredentialsHandsBackNoSecrets(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "do-not-leak-me"
	if err := saveHealthCredential("gitea", HealthCredential{
		Label:         "Gitea",
		Headers:       map[string]string{"Authorization": "token " + secret},
		BasicUser:     "someone",
		BasicPassword: secret,
	}); err != nil {
		t.Fatal(err)
	}

	labels := listHealthCredentials()
	if labels["gitea"] != "Gitea" {
		t.Errorf("label = %q", labels["gitea"])
	}
	for id, label := range labels {
		if strings.Contains(label, secret) || strings.Contains(id, secret) {
			t.Errorf("a secret reached the listing: %q -> %q", id, label)
		}
	}
}

// A header value carrying a newline would end the header and start something of
// its own, and a name outside the token rule would be dropped by net/http later
// anyway -- better refused while someone is looking at the form.
func TestCredentialSanitisingRefusesHeadersThatCouldSplitARequest(t *testing.T) {
	cleaned := sanitizeHealthCredential(HealthCredential{
		Headers: map[string]string{
			"X-Api-Key":       "fine",
			"X-Bad\nInjected": "value",
			"X-Newline-Value": "one\r\nX-Injected: yes",
			"Host":            "elsewhere.example",
			"Content-Length":  "0",
		},
	})
	if _, ok := cleaned.Headers["X-Api-Key"]; !ok {
		t.Error("the legitimate header was dropped")
	}
	for name, value := range cleaned.Headers {
		if strings.ContainsAny(name, "\r\n") || strings.ContainsAny(value, "\r\n") {
			t.Errorf("a header survived with a line break: %q: %q", name, value)
		}
	}
	// The transport owns these, and a check sends no body.
	for _, refused := range []string{"Host", "Content-Length"} {
		if _, ok := cleaned.Headers[http.CanonicalHeaderKey(refused)]; ok {
			t.Errorf("%s was accepted", refused)
		}
	}
}

// Basic auth is two fields the reader understands, turned into a header here so
// nobody base64s anything by hand.
func TestBasicAuthBecomesAnAuthorizationHeader(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	applyHealthCredential(req, HealthCredential{BasicUser: "me", BasicPassword: "pw"})
	user, pass, ok := req.BasicAuth()
	if !ok || user != "me" || pass != "pw" {
		t.Errorf("basic auth not set: %q %q %v", user, pass, ok)
	}
}

// Someone who typed an Authorization header meant it.
func TestAnExplicitAuthorizationHeaderBeatsBasicAuth(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	if err != nil {
		t.Fatal(err)
	}
	applyHealthCredential(req, HealthCredential{
		Headers:       map[string]string{"Authorization": "token abc"},
		BasicUser:     "me",
		BasicPassword: "pw",
	})
	if got := req.Header.Get("Authorization"); got != "token abc" {
		t.Errorf("Authorization = %q, want the header that was typed", got)
	}
}

/*
The check reaches the service, rather than the login page in front of it.

This is the whole point: a bookmark at a web interface answering 401 reads as
broken on the row, and the only way out today is to stop monitoring it.
*/
func TestACheckSendsTheStoredCredential(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "the-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	/*
	 * Checked with an explicit expected status, because the default rule treats
	 * anything under 500 as reachable -- a 401 reads as "online" without one.
	 * That is the honest shape of the problem: someone monitoring a service
	 * behind a key sets ExpectStatus so a login page stops counting as up, and
	 * it is only then that the missing credential shows.
	 */
	expectOK := expectation{Status: "200", Monitored: true}

	anonymous := h.pingURLExpecting(context.Background(), server.URL, expectOK)
	if anonymous.Status == "online" {
		t.Fatal("the stub answered an anonymous request, so this proves nothing")
	}

	withKey := expectOK
	withKey.Credential = HealthCredential{Headers: map[string]string{"X-Api-Key": "the-key"}}
	result := h.pingURLExpecting(context.Background(), server.URL, withKey)
	if result.Status != "online" {
		t.Errorf("status = %q (%s), want online with the key sent",
			result.Status, result.ErrorDetail)
	}
}

/*
A separate address to check, for a bookmark that cannot answer for itself.

The bookmark stays what you open; the check goes somewhere that answers to
nobody in particular.
*/
func TestACheckCanTargetADifferentAddress(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	var asked []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.Path)
		if r.URL.Path == "/ping" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	result := h.pingURLExpecting(context.Background(), server.URL+"/", expectation{
		CheckURL: server.URL + "/ping",
	})
	if result.Status != "online" {
		t.Errorf("status = %q (%s)", result.Status, result.ErrorDetail)
	}
	if len(asked) != 1 || asked[0] != "/ping" {
		t.Errorf("asked %v, want only /ping", asked)
	}
}

/*
The substituted address is validated exactly like the bookmark's own.

It comes from a form, so a check that skipped validateHTTPURL would be a way to
ask the server to fetch anything it can reach.
*/
func TestASubstitutedAddressStillPassesTheHostChecks(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	for _, probe := range []string{
		"http://169.254.169.254/latest/meta-data/",
		"file:///etc/passwd",
		"http://localhost:9/",
	} {
		result := h.pingURLExpecting(context.Background(), "https://example.com/", expectation{
			CheckURL: probe,
		})
		if result.Status == "online" {
			t.Errorf("%s was reached through checkUrl", probe)
		}
	}
}

// Relaxing the certificate must not relax which hosts may be reached.
func TestAllowingAnUntrustedCertificateDoesNotOpenTheAddressChecks(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	result := h.pingURLExpecting(context.Background(), "http://169.254.169.254/latest/", expectation{
		AllowInsecureTLS: true,
	})
	if result.Status == "online" {
		t.Error("the metadata address was reached with the certificate check relaxed")
	}
}

// A bookmark pointing at a credential that was deleted checks anonymously,
// which is the answer it gave before the credential existed.
func TestADeletedCredentialLeavesTheBookmarkCheckingAnonymously(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	if err := saveHealthCredential("gone", HealthCredential{
		Headers: map[string]string{"X-Api-Key": "k"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := deleteHealthCredential("gone"); err != nil {
		t.Fatal(err)
	}

	expect := expectationFor(Bookmark{URL: "https://example.com/", CredentialID: "gone"})
	if len(expect.Credential.Headers) != 0 {
		t.Errorf("a deleted credential was still applied: %v", expect.Credential.Headers)
	}
}

/*
Reachability applies whether or not monitoring is on.

expectationFor returns nothing for an unmonitored bookmark, which is right for
what to expect back and wrong for how to get there: "Retest all" and a manual
re-check both run on unmonitored bookmarks, and answering 401 there is the same
wrong answer it would be on a schedule.
*/
func TestReachabilitySurvivesAnUnmonitoredBookmark(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := saveHealthCredential("svc", HealthCredential{
		Headers: map[string]string{"X-Api-Key": "k"},
	}); err != nil {
		t.Fatal(err)
	}

	expect := expectationFor(Bookmark{
		URL:              "https://example.com/",
		Monitor:          false,
		CheckURL:         "https://example.com/ping",
		CredentialID:     "svc",
		AllowInsecureTLS: true,
		ExpectText:       "ignored while unmonitored",
	})
	if expect.CheckURL == "" || !expect.AllowInsecureTLS || len(expect.Credential.Headers) == 0 {
		t.Errorf("reachability was dropped for an unmonitored bookmark: %+v", expect)
	}
	// What to expect back is still gated on Monitor, as it was.
	if expect.Text != "" || expect.Monitored {
		t.Errorf("expectations leaked onto an unmonitored bookmark: %+v", expect)
	}
}

/*
A self-signed certificate is accepted only where it was asked for.

httptest's TLS server presents exactly the case this exists for: a certificate
the machine has no reason to trust. Without the option the check fails on the
certificate, which on the row is indistinguishable from the service being down.
*/
func TestAnUntrustedCertificateIsAcceptedOnlyWhenAsked(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Setenv("NEXTDASH_ALLOW_LOCAL_BOOKMARKS", "true")
	h := newTestHandlers(t)

	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	strict := h.pingURLExpecting(context.Background(), server.URL, expectation{})
	if strict.Status == "online" {
		t.Fatal("the certificate was trusted without being asked, so this proves nothing")
	}

	relaxed := h.pingURLExpecting(context.Background(), server.URL, expectation{AllowInsecureTLS: true})
	if relaxed.Status != "online" {
		t.Errorf("status = %q (%s), want online with the certificate accepted",
			relaxed.Status, relaxed.ErrorDetail)
	}
}
