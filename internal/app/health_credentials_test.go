package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
freshOutboundBudget gives this test its own share of the outbound limiter.

The limiter is one global bucket for the whole binary, and a test that signs in
before it reads spends two requests where most spend one -- enough, across a
package this size, to starve a test that runs later and looks unrelated when it
fails. Reset here rather than raised in production: the budget is right, and a
test suite is not the thing it is protecting against.
*/
func freshOutboundBudget(t *testing.T) {
	t.Helper()
	previous := globalOutboundLimiter
	globalOutboundLimiter = newSlidingWindowLimiter(outboundRequestsPerMinute(), time.Minute)
	t.Cleanup(func() { globalOutboundLimiter = previous })
}

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
denyLocalAddresses turns AllowLocalBookmarks off for a test's store.

It ships on, because the dashboards this is for are full of 192.168 services,
and while it is on the SSRF guards in validateHTTPURL and the dialer stand
aside. The address tests below are about those guards, so they have to ask for
the setting that arms them -- left at the default they proved nothing, and
passed only on machines where nothing happens to answer at 169.254.169.254.
GitHub's runners are not such a machine: the Azure metadata service lives
there, so both tests failed on CI and nowhere else.
*/
func denyLocalAddresses(t *testing.T, h *Handlers) {
	t.Helper()
	settings := h.store.GetSettings()
	settings.AllowLocalBookmarks = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("save settings: %v", err)
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
	denyLocalAddresses(t, h)

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
	denyLocalAddresses(t, h)

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

/*
A credential does not follow a redirect to another service.

net/http copies a request's headers onto the redirect it follows, and it drops
only Authorization and Cookie -- and only on a domain change. A stored API key
travels in a header of the service's own choosing, so nothing in the standard
library stops it arriving wherever a 302 points.

Two stub servers, which on this machine differ only in port. That is the case
worth proving: on the hosts nextDash runs on, Sonarr and Radarr are the same
name with two numbers after it, so a rule comparing hostnames alone would have
called this the same place and sent the key on.
*/
func TestACredentialDoesNotFollowARedirectToAnotherService(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	var (
		mu      sync.Mutex
		sawKey  string
		sawAuth string
		arrived bool
	)
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		arrived = true
		sawKey = r.Header.Get("X-Api-Key")
		sawAuth = r.Header.Get("Authorization")
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer elsewhere.Close()

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, elsewhere.URL+"/landed", http.StatusFound)
	}))
	defer origin.Close()

	result := h.pingURLExpecting(context.Background(), origin.URL, expectation{
		Credential: HealthCredential{
			Headers:       map[string]string{"X-Api-Key": "the-key"},
			BasicUser:     "me",
			BasicPassword: "pw",
		},
	})

	mu.Lock()
	defer mu.Unlock()
	if !arrived {
		t.Fatalf("the redirect was never followed (%q, %s), so this proves nothing",
			result.Status, result.ErrorDetail)
	}
	if sawKey != "" {
		t.Errorf("X-Api-Key = %q at the redirect target, want it stripped", sawKey)
	}
	if sawAuth != "" {
		t.Errorf("Authorization = %q at the redirect target, want it stripped", sawAuth)
	}
}

/*
A redirect that stays on the same service keeps the credential.

The strip has to be narrow, or every service that redirects / to /login is a
check that reports its own login page.
*/
func TestACredentialSurvivesARedirectOnTheSameService(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := newTestHandlers(t)

	var (
		mu     sync.Mutex
		sawKey string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/landed" {
			http.Redirect(w, r, "/landed", http.StatusFound)
			return
		}
		mu.Lock()
		sawKey = r.Header.Get("X-Api-Key")
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	h.pingURLExpecting(context.Background(), server.URL, expectation{
		Credential: HealthCredential{Headers: map[string]string{"X-Api-Key": "the-key"}},
	})

	mu.Lock()
	defer mu.Unlock()
	if sawKey != "the-key" {
		t.Errorf("X-Api-Key = %q after a redirect within the service, want it kept", sawKey)
	}
}

/*
The summary route describes an entry without describing what is in it.

The widget's sign-in block needs to know that a key is set and which header
carries it, so it can say so instead of showing an empty box over a stored
credential. Header names are public -- X-Api-Key is printed on Sonarr's own
settings page -- and the values are the whole reason this file exists, so this
pins the line between them.
*/
func TestCredentialSummariesCarryNoSecrets(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	if err := saveHealthCredential("widget:w_abc123", HealthCredential{
		Label:   "Sonarr",
		Headers: map[string]string{"X-Api-Key": "super-secret-value"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := saveHealthCredential("adguard", HealthCredential{
		Label:         "AdGuard",
		BasicUser:     "admin",
		BasicPassword: "hunter2",
	}); err != nil {
		t.Fatal(err)
	}

	details := listHealthCredentialDetails()
	if len(details) != 2 {
		t.Fatalf("described %d of 2 entries", len(details))
	}

	key := details["widget:w_abc123"]
	if key.Label != "Sonarr" {
		t.Errorf("label = %q, want Sonarr", key.Label)
	}
	if len(key.Headers) != 1 || key.Headers[0] != "X-Api-Key" {
		t.Errorf("headers = %v, want the name only", key.Headers)
	}
	if key.Basic {
		t.Error("a header credential reported basic auth")
	}

	basic := details["adguard"]
	if !basic.Basic || basic.BasicUser != "admin" {
		t.Errorf("basic = %v, user = %q", basic.Basic, basic.BasicUser)
	}

	// The whole point: nothing anywhere in the answer is a secret.
	encoded, err := json.Marshal(details)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"super-secret-value", "hunter2"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("a stored secret reached the summary: %s", encoded)
		}
	}
}

/*
The reveal route is the one place a stored secret comes back, so what it refuses
matters more than what it returns. These cover the three things that keep the
exception from becoming a way to read the whole credential store.
*/

// The panel that stores a widget key is the panel where "what did I actually
// paste in there" is asked, and a bare token looks identical to a correct one.
func TestRevealingAWidgetSecretHandsBackTheStoredValue(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "Bearer NhTg7x2ab9"
	if err := saveHealthCredential("widget:speedtest", HealthCredential{
		Label:   "Speedtest",
		Headers: map[string]string{"Authorization": secret},
	}); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodGet,
		"/api/health/credentials/reveal?id=widget:speedtest&field=Authorization", nil)
	rec := httptest.NewRecorder()
	h.HealthCredentialRevealHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Value != secret {
		t.Errorf("value = %q, want %q", body.Value, secret)
	}
}

// A shared sign-in was named on purpose and several checks point at it. It stays
// write-only, so this route cannot be walked to read the store.
func TestRevealingRefusesACredentialThatIsNotAWidgetsOwn(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "do-not-leak-me"
	if err := saveHealthCredential("sonarr:attic", HealthCredential{
		Label:   "Sonarr",
		Headers: map[string]string{"X-Api-Key": secret},
	}); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodGet,
		"/api/health/credentials/reveal?id=sonarr:attic&field=X-Api-Key", nil)
	rec := httptest.NewRecorder()
	h.HealthCredentialRevealHandler(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Error("the refusal carried the secret it refused")
	}
}

// Reading a secret is not a lesser act than replacing one, so it sits behind the
// same gate PUT and DELETE do.
func TestRevealingRequiresTheWriteTokenWhenConfigured(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Setenv("NEXTDASH_WRITE_TOKEN", "secret-token")

	const secret = "Bearer NhTg7x2ab9"
	if err := saveHealthCredential("widget:speedtest", HealthCredential{
		Headers: map[string]string{"Authorization": secret},
	}); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	url := "/api/health/credentials/reveal?id=widget:speedtest&field=Authorization"

	rec := httptest.NewRecorder()
	h.HealthCredentialRevealHandler(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Error("an unauthorized refusal carried the secret")
	}

	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("X-NextDash-Token", "secret-token")
	rec = httptest.NewRecorder()
	h.HealthCredentialRevealHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

/*
Three services take their key in the address and offer no header form at all:
SABnzbd, Tautulli and Pi-hole v5. The key still belongs in the credential file,
because a widget's url is stored in bookmarks-N.json and travels in every
export.
*/

// The placeholder a preset writes is what marks the slot as free.
func TestAQueryCredentialFillsInTheAddress(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "746071e5e78f4f36b71b3536e46f1ec9"
	if err := saveHealthCredential("widget:sab", HealthCredential{
		Label: "SABnzbd",
		Query: map[string]string{"apikey": secret},
	}); err != nil {
		t.Fatal(err)
	}
	credential, ok := lookupHealthCredential("widget:sab")
	if !ok {
		t.Fatal("the credential was not stored")
	}

	req := httptest.NewRequest(http.MethodGet,
		"http://sab.local:8081/api?mode=queue&output=json&apikey=YOUR_KEY", nil)
	applyHealthCredential(req, credential)

	if got := req.URL.Query().Get("apikey"); got != secret {
		t.Errorf("apikey = %q, want the stored key", got)
	}
	// The rest of the address is untouched: a preset's path carries the mode
	// and the output format, and losing either asks for something else.
	if got := req.URL.Query().Get("mode"); got != "queue" {
		t.Errorf("mode = %q, want queue", got)
	}
	if got := req.URL.Query().Get("output"); got != "json" {
		t.Errorf("output = %q, want json", got)
	}
}

// A key typed into the address by hand is somebody's working widget, and
// overwriting it would break it.
func TestAQueryCredentialLeavesARealValueAlone(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	if err := saveHealthCredential("widget:sab", HealthCredential{
		Query: map[string]string{"apikey": "from-the-credential-file"},
	}); err != nil {
		t.Fatal(err)
	}
	credential, _ := lookupHealthCredential("widget:sab")

	req := httptest.NewRequest(http.MethodGet,
		"http://sab.local:8081/api?apikey=typed-by-hand", nil)
	applyHealthCredential(req, credential)

	if got := req.URL.Query().Get("apikey"); got != "typed-by-hand" {
		t.Errorf("apikey = %q, want the value that was already there", got)
	}
}

// An empty slot is a slot nobody filled, so it takes the key like a placeholder.
func TestAQueryCredentialFillsAnEmptyParameter(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	if err := saveHealthCredential("widget:sab", HealthCredential{
		Query: map[string]string{"apikey": "the-key"},
	}); err != nil {
		t.Fatal(err)
	}
	credential, _ := lookupHealthCredential("widget:sab")

	req := httptest.NewRequest(http.MethodGet, "http://sab.local:8081/api?apikey=", nil)
	applyHealthCredential(req, credential)

	if got := req.URL.Query().Get("apikey"); got != "the-key" {
		t.Errorf("apikey = %q, want the stored key", got)
	}
}

// A key that happens to be uppercase is not a placeholder, or a real key would
// be silently replaced by another one.
func TestAnUppercaseKeyIsNotMistakenForAPlaceholder(t *testing.T) {
	for _, c := range []struct {
		value string
		want  bool
	}{
		{"YOUR_KEY", true},
		{"YOUR_TOKEN", true},
		{"YOUR_API_KEY_2", true},
		{"ABCDEF123456", false},
		{"YOUR-KEY", false},
		{"your_key", false},
		{"YOUR_KEY.", false},
		{"", false},
	} {
		if got := isCredentialPlaceholder(c.value); got != c.want {
			t.Errorf("isCredentialPlaceholder(%q) = %v, want %v", c.value, got, c.want)
		}
	}
}

// A name or value carrying & or = would end this parameter and start another --
// the query-string form of the request splitting the header rule refuses.
func TestQuerySanitisingRefusesParametersThatCouldSplitAnAddress(t *testing.T) {
	out := sanitizeCredentialQuery(map[string]string{
		"apikey":     "fine",
		"bad&name":   "value",
		"badvalue":   "a&injected=1",
		"has=equals": "value",
		"":           "no name",
		"empty":      "",
	})
	if _, ok := out["apikey"]; !ok {
		t.Error("a valid parameter was dropped")
	}
	if len(out) != 1 {
		t.Errorf("kept %d parameters, want only the valid one: %v", len(out), out)
	}
}

// The panel has to be able to say a key is set without the value coming back.
func TestCredentialSummaryNamesQueryParametersWithoutTheirValues(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "do-not-leak-me"
	if err := saveHealthCredential("widget:sab", HealthCredential{
		Query: map[string]string{"apikey": secret},
	}); err != nil {
		t.Fatal(err)
	}

	summaries := listHealthCredentialDetails()
	summary, ok := summaries["widget:sab"]
	if !ok {
		t.Fatal("the credential is missing from the summary")
	}
	if len(summary.Query) != 1 || summary.Query[0] != "apikey" {
		t.Errorf("query names = %v, want [apikey]", summary.Query)
	}
	blob, _ := json.Marshal(summaries)
	if strings.Contains(string(blob), secret) {
		t.Error("the summary carried the secret it names")
	}
}

// The eye reads a query key the same way it reads a header.
func TestRevealingHandsBackAQueryKey(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "746071e5e78f4f36b71b3536e46f1ec9"
	if err := saveHealthCredential("widget:sab", HealthCredential{
		Query: map[string]string{"apikey": secret},
	}); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	req := httptest.NewRequest(http.MethodGet,
		"/api/health/credentials/reveal?id=widget:sab&field=query:apikey", nil)
	rec := httptest.NewRecorder()
	h.HealthCredentialRevealHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Value string `json:"value"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Value != secret {
		t.Errorf("value = %q, want the stored key", body.Value)
	}
}

/*
qBittorrent hands out a session rather than taking a key: no API key exists,
only a login that answers with a SID cookie -- and that cookie expires. Storing
the cookie is a widget that works for an afternoon and then reads 403, so what
is stored is the username and password and the session is fetched.
*/

// The whole round trip: sign in, keep the cookie, use it.
func TestASessionCredentialSignsInAndUsesTheCookie(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() { credentialSessionCache = map[string]string{} })

	var logins int
	var sawReferer, sawCookie string
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v2/auth/login" {
			logins++
			sawReferer = r.Header.Get("Referer")
			_ = r.ParseForm()
			if r.PostForm.Get("username") != "jordi" || r.PostForm.Get("password") != "secret" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: "session-one"})
			_, _ = w.Write([]byte("Ok."))
			return
		}
		sawCookie = r.Header.Get("Cookie")
		if sawCookie == "" {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("Forbidden"))
			return
		}
		_, _ = w.Write([]byte(`{"dl_info_speed":42}`))
	}))
	defer service.Close()

	credential := HealthCredential{Session: &CredentialSession{
		LoginPath: "/api/v2/auth/login",
		UserField: "username", PassField: "password",
		User: "jordi", Password: "secret", Referer: true,
	}}
	if err := saveHealthCredential("widget:qb", credential); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	// The test service is on 127.0.0.1, which the outbound client reaches only
	// when local addresses are allowed -- and that is a stored setting, so a
	// fresh data dir starts with it off.
	allowLocalForTest(t, h, true)
	spec := customWidgetSpec{
		URL: service.URL + "/api/v2/transfer/info", Method: http.MethodGet,
		CredentialID: "widget:qb",
	}
	answer := h.askCustomWidget(context.Background(), spec, nil)

	if answer.Status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (error %q)", answer.Status, answer.Error)
	}
	if !answer.SignedIn {
		t.Error("the answer did not report a sign-in")
	}
	if sawCookie != "SID=session-one" {
		t.Errorf("the service saw cookie %q", sawCookie)
	}
	// qBittorrent refuses a login with no Referer, and the refusal reads as a
	// wrong password.
	if sawReferer == "" {
		t.Error("no Referer went with the login")
	}

	// The second read reuses the session rather than signing in again: a login
	// per refresh per tile is a lot of requests to somebody's own machine.
	if answer := h.askCustomWidget(context.Background(), spec, nil); answer.Status != http.StatusOK {
		t.Fatalf("second read status = %d", answer.Status)
	}
	if logins != 1 {
		t.Errorf("signed in %d times, want 1", logins)
	}
}

// An expired session is a refusal the reader did nothing to cause, so it signs
// in again rather than reporting a 403 nobody can act on.
func TestAnExpiredSessionIsRenewedRatherThanReported(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Cleanup(func() { credentialSessionCache = map[string]string{} })

	var logins int
	valid := ""
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			logins++
			valid = fmt.Sprintf("session-%d", logins)
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: valid})
			return
		}
		if r.Header.Get("Cookie") != "SID="+valid {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer service.Close()

	if err := saveHealthCredential("widget:qb", HealthCredential{Session: &CredentialSession{
		LoginPath: "/login", User: "u", Password: "p",
	}}); err != nil {
		t.Fatal(err)
	}

	h := NewHandlers(NewStore(), embeddedFiles)
	// The test service is on 127.0.0.1, which the outbound client reaches only
	// when local addresses are allowed -- and that is a stored setting, so a
	// fresh data dir starts with it off.
	allowLocalForTest(t, h, true)
	spec := customWidgetSpec{URL: service.URL + "/data", Method: http.MethodGet, CredentialID: "widget:qb"}
	if answer := h.askCustomWidget(context.Background(), spec, nil); answer.Status != http.StatusOK {
		t.Fatalf("first read = %d", answer.Status)
	}

	// The service forgets the session, exactly as it does when one lapses.
	valid = "gone"
	answer := h.askCustomWidget(context.Background(), spec, nil)
	if answer.Status != http.StatusOK {
		t.Fatalf("after expiry status = %d, want 200 (error %q)", answer.Status, answer.Error)
	}
	if logins != 2 {
		t.Errorf("signed in %d times, want 2 -- one for the expiry", logins)
	}
}

// A login path with a host in it would post the username and password to
// whatever that named, which is credential theft rather than a typo.
func TestASessionLoginPathMustBeAPath(t *testing.T) {
	for _, path := range []string{
		"https://attacker.test/login", "//attacker.test/login", "attacker.test/login", "",
	} {
		got := sanitizeCredentialSession(&CredentialSession{
			LoginPath: path, User: "u", Password: "p",
		})
		if got != nil {
			t.Errorf("login path %q was accepted", path)
		}
	}
	if got := sanitizeCredentialSession(&CredentialSession{
		LoginPath: "/api/v2/auth/login", User: "u", Password: "p",
	}); got == nil {
		t.Error("an ordinary login path was refused")
	}
}

// The panel has to say a session is set, and as whom, without the password.
func TestASessionSummaryCarriesNoPassword(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	const secret = "do-not-leak-me"
	if err := saveHealthCredential("widget:qb", HealthCredential{Session: &CredentialSession{
		LoginPath: "/login", User: "jordi", Password: secret,
	}}); err != nil {
		t.Fatal(err)
	}
	summaries := listHealthCredentialDetails()
	summary := summaries["widget:qb"]
	if !summary.Session || summary.SessionUser != "jordi" {
		t.Errorf("summary = %+v, want a session for jordi", summary)
	}
	blob, _ := json.Marshal(summaries)
	if strings.Contains(string(blob), secret) {
		t.Error("the summary carried the password")
	}
}
