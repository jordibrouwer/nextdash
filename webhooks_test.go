package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
The signature is what makes the delivery worth acting on.

A receiver that acts on an unauthenticated POST acts on whatever anyone who
learns the URL sends it, so the verification a receiver library performs has to
match what is sent here byte for byte.
*/
func TestWebhookSignatureIsOverIDTimestampAndBody(t *testing.T) {
	endpoint := WebhookEndpoint{URL: "https://receiver.example/hook", Secret: "s3cret"}
	now := time.Unix(1750000000, 0)

	req, err := buildWebhookRequest(context.Background(), endpoint,
		webhookEventBookmarkAdded, map[string]any{"name": "X"}, now)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(req.Body)

	id := req.Header.Get("webhook-id")
	stamp := req.Header.Get("webhook-timestamp")
	if id == "" || stamp != strconv.FormatInt(now.Unix(), 10) {
		t.Fatalf("id = %q, timestamp = %q", id, stamp)
	}

	// Recomputed the way a receiver does, from the headers and the bytes that
	// arrived -- not by calling the signing function, which would pass even if
	// the request carried something else entirely.
	mac := hmac.New(sha256.New, []byte("s3cret"))
	mac.Write([]byte(id + "." + stamp + "."))
	mac.Write(body)
	want := "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if got := req.Header.Get("webhook-signature"); got != want {
		t.Errorf("signature = %q, want %q", got, want)
	}
}

/*
Both signed fields have to be signed, or they are only sent.

The id is how a receiver recognises a redelivery it already acted on and the
timestamp is how it refuses one replayed a day later; either left out of the
MAC can be rewritten in flight and the signature still verifies.
*/
func TestWebhookSignatureCoversBothHeaders(t *testing.T) {
	base := signWebhookPayload("k", "msg_1", 100, []byte(`{"a":1}`))
	for name, other := range map[string]string{
		"the id":        signWebhookPayload("k", "msg_2", 100, []byte(`{"a":1}`)),
		"the timestamp": signWebhookPayload("k", "msg_1", 200, []byte(`{"a":1}`)),
		"the body":      signWebhookPayload("k", "msg_1", 100, []byte(`{"a":2}`)),
		"the secret":    signWebhookPayload("j", "msg_1", 100, []byte(`{"a":1}`)),
	} {
		if other == base {
			t.Errorf("changing %s leaves the signature unchanged", name)
		}
	}
	// And the separator is a real one: without it, an id ending in a digit and
	// a timestamp would sign the same bytes as a shorter id and a longer stamp.
	if signWebhookPayload("k", "a", 1, nil) == signWebhookPayload("k", "a1", 0, nil) {
		t.Error("the id and the timestamp run together in the signed bytes")
	}
}

/*
A subscription is a filter, and an empty one means everything -- "I want the
lot" should not require ticking every box.
*/
func TestWebhookEventFilter(t *testing.T) {
	all := WebhookEndpoint{URL: "https://x.example/", Enabled: true}
	if !all.wants(webhookEventHealthDown) || !all.wants(webhookEventBookmarkAdded) {
		t.Error("an empty filter did not mean every event")
	}

	one := WebhookEndpoint{URL: "https://x.example/", Enabled: true,
		Events: []string{webhookEventBookmarkAdded}}
	if !one.wants(webhookEventBookmarkAdded) || one.wants(webhookEventHealthDown) {
		t.Error("the filter did not select")
	}

	// Disabled and blank-URL endpoints are still in the file; neither is a
	// receiver.
	off := WebhookEndpoint{URL: "https://x.example/"}
	if off.wants(webhookEventBookmarkAdded) {
		t.Error("a disabled endpoint wanted an event")
	}
	if (WebhookEndpoint{Enabled: true}).wants(webhookEventBookmarkAdded) {
		t.Error("an endpoint with no address wanted an event")
	}
}

/*
Saving generates a signing key rather than asking for one, and never loses it.

The config screen is never handed the secret back, so a save that treated an
absent secret as "clear it" would silently unsign every delivery the moment
someone renamed the endpoint.
*/
func TestSavingAnEndpointKeepsItsSecret(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	first, err := saveWebhookEndpoint("n8n", WebhookEndpoint{URL: "https://x.example/", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Secret) < 32 {
		t.Fatalf("generated secret is %d characters", len(first.Secret))
	}

	renamed, err := saveWebhookEndpoint("n8n", WebhookEndpoint{URL: "https://x.example/", Label: "n8n", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if renamed.Secret != first.Secret {
		t.Error("a save without a secret replaced the stored one")
	}

	// A second endpoint gets its own key: one leaked secret must not be every
	// receiver's secret.
	second, err := saveWebhookEndpoint("ha", WebhookEndpoint{URL: "https://y.example/", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if second.Secret == first.Secret {
		t.Error("two endpoints share a signing key")
	}

	// And the file is not world-readable: 0644 here means the account next
	// door can forge a delivery.
	info, err := os.Stat(webhookFilePath())
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("webhooks.json is %v", perm)
	}
}

// The secret is shown once, in the response to the save that made it. After
// that the screen gets a flag, because a screen that re-displays a key turns
// every screenshot into a leak.
func TestListedEndpointsCarryNoSecret(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if _, err := saveWebhookEndpoint("n8n", WebhookEndpoint{URL: "https://x.example/", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	listed, err := json.Marshal(listWebhookEndpoints())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(listed), "secret") && !strings.Contains(string(listed), "hasSecret") {
		t.Fatalf("listing carries a secret field: %s", listed)
	}
	stored, _ := lookupWebhookEndpoint("n8n")
	if strings.Contains(string(listed), stored.Secret) {
		t.Errorf("the signing key is in the listing: %s", listed)
	}
	if !strings.Contains(string(listed), `"hasSecret":true`) {
		t.Errorf("the listing does not say a secret is set: %s", listed)
	}
}

/*
The full path: a saved endpoint hears about a bookmark, and one that filtered
it out does not.
*/
func TestEmitReachesOnlySubscribedEndpoints(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	var mu sync.Mutex
	received := map[string][]byte{}
	done := make(chan string, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		received[r.URL.Path] = body
		mu.Unlock()
		done <- r.URL.Path
	}))
	defer server.Close()

	if _, err := saveWebhookEndpoint("all", WebhookEndpoint{URL: server.URL + "/all", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := saveWebhookEndpoint("health", WebhookEndpoint{
		URL: server.URL + "/health", Enabled: true,
		Events: []string{webhookEventHealthDown},
	}); err != nil {
		t.Fatal(err)
	}

	// httptest listens on loopback, which delivery now refuses unless this
	// install allows local addresses.
	defer webhookAllowLocalForTest(true)()

	emitWebhookEvent(webhookEventBookmarkAdded, map[string]any{"name": "Sonarr"})
	select {
	case path := <-done:
		if path != "/all" {
			t.Fatalf("delivered to %s", path)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no delivery arrived")
	}

	// The health-only endpoint must stay silent. Nothing to wait for, so this
	// waits out the window a delivery would have arrived in.
	select {
	case path := <-done:
		t.Fatalf("an unsubscribed endpoint was sent %s", path)
	case <-time.After(300 * time.Millisecond):
	}

	mu.Lock()
	body := received["/all"]
	mu.Unlock()
	var delivery struct {
		Type string         `json:"type"`
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &delivery); err != nil {
		t.Fatal(err)
	}
	if delivery.Type != webhookEventBookmarkAdded || delivery.Data["name"] != "Sonarr" {
		t.Errorf("delivered %s / %v", delivery.Type, delivery.Data)
	}
}

/*
A 4xx is the receiver saying the request is wrong -- a bad path, a rejected
signature. Sending it again unchanged gets the same answer while looking like
an outage, so it is not retried. A 5xx is, because that is a receiver that is
merely down.
*/
func TestOnlyServerErrorsAreRetried(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		wantMin int
	}{
		{"a rejected request", http.StatusUnauthorized, 1},
		{"a receiver that is down", http.StatusBadGateway, webhookAttempts},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			attempts := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				attempts++
				mu.Unlock()
				w.WriteHeader(tc.status)
			}))
			defer server.Close()

			// The real delay between attempts is seconds; shortened so the
			// retry behaviour can be tested without the wait.
			restore := webhookRetryDelayForTest(time.Millisecond)
			defer restore()
			defer webhookAllowLocalForTest(true)()

			deliverWebhook(WebhookEndpoint{URL: server.URL, Secret: "k", Enabled: true},
				webhookEventBookmarkAdded, map[string]any{})

			mu.Lock()
			defer mu.Unlock()
			if attempts != tc.wantMin {
				t.Errorf("%d attempts, want %d", attempts, tc.wantMin)
			}
		})
	}
}

// A success is not retried either.
func TestASuccessfulDeliveryIsSentOnce(t *testing.T) {
	var mu sync.Mutex
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
	}))
	defer server.Close()

	restore := webhookRetryDelayForTest(time.Millisecond)
	defer restore()
	defer webhookAllowLocalForTest(true)()
	deliverWebhook(WebhookEndpoint{URL: server.URL, Secret: "k", Enabled: true},
		webhookEventBookmarkAdded, map[string]any{})

	mu.Lock()
	defer mu.Unlock()
	if attempts != 1 {
		t.Errorf("a delivery that was accepted was sent %d times", attempts)
	}
}

/*
The events are wired to the code that saves a bookmark, and are not wired to
the activity log's switch.

Those two live in the same functions, so it would be easy for a webhook
subscriber to work only on installs that happen to have activity logging on --
and to stop, silently, the day somebody turns it off.
*/
func TestBookmarkChangesReachWebhooksWithTheActivityLogOff(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	resetActivityLogForTest(activityLogConfig{disabled: true})
	defer clearActivityLogTestOverride()
	// httptest listens on loopback, which delivery now refuses unless this
	// install allows local addresses.
	defer webhookAllowLocalForTest(true)()

	delivered := make(chan string, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var delivery struct {
			Type string `json:"type"`
		}
		_ = json.Unmarshal(body, &delivery)
		delivered <- delivery.Type
	}))
	defer server.Close()
	if _, err := saveWebhookEndpoint("all", WebhookEndpoint{URL: server.URL, Enabled: true}); err != nil {
		t.Fatal(err)
	}

	before := []Bookmark{
		{PageID: 1, Name: "Sonarr", URL: "https://sonarr.example/"},
		{PageID: 1, Name: "Gone", URL: "https://gone.example/"},
	}
	after := []Bookmark{
		{PageID: 1, Name: "Sonarr renamed", URL: "https://sonarr.example/"},
		{PageID: 1, Name: "New", URL: "https://new.example/"},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/bookmarks", nil)
	logBookmarkSaveDiff(1, before, after, req)

	seen := map[string]bool{}
	deadline := time.After(5 * time.Second)
	for len(seen) < 3 {
		select {
		case event := <-delivered:
			seen[event] = true
		case <-deadline:
			t.Fatalf("only saw %v", seen)
		}
	}
	for _, want := range []string{webhookEventBookmarkAdded, webhookEventBookmarkUpdated, webhookEventBookmarkDeleted} {
		if !seen[want] {
			t.Errorf("%s never arrived", want)
		}
	}
}

// An install with nothing listening pays nothing: the diff above is only walked
// because something asked for it.
func TestNothingIsWalkedWhenNobodyIsListening(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if webhooksConfigured() {
		t.Fatal("an empty data directory reported a configured webhook")
	}
	if _, err := saveWebhookEndpoint("off", WebhookEndpoint{URL: "https://x.example/"}); err != nil {
		t.Fatal(err)
	}
	if webhooksConfigured() {
		t.Error("a disabled endpoint counted as listening")
	}
	if _, err := saveWebhookEndpoint("on", WebhookEndpoint{URL: "https://x.example/", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if !webhooksConfigured() {
		t.Error("an enabled endpoint did not count as listening")
	}
}

/*
An address that cannot be delivered to is refused while the reader is looking
at the field.

The alternative -- accepting it and failing on every delivery -- produces a
receiver that appears configured and silently never fires, which is the failure
mode this whole file exists to avoid.
*/
func TestALocalAddressIsRefusedUnlessTheInstallAllowsThem(t *testing.T) {
	h := newTestHandlers(t)

	save := func(id, target string) *httptest.ResponseRecorder {
		body := `{"id":"` + id + `","url":"` + target + `","enabled":true}`
		req := httptest.NewRequest(http.MethodPut, "/api/webhooks", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		h.WebhooksHandler(res, req)
		return res
	}

	// A fresh install allows local addresses, and the likeliest receiver of
	// all is on the same machine -- so this is the case that has to keep
	// working, not the one to guard against.
	if res := save("local", "http://127.0.0.1:9/hook"); res.Code != http.StatusOK {
		t.Fatalf("HTTP %d: %s", res.Code, res.Body.String())
	}
	if _, ok := lookupWebhookEndpoint("local"); !ok {
		t.Error("the accepted endpoint was not stored")
	}

	// And on an install that has turned local addresses off, the same address
	// is refused rather than accepted and quietly never delivered to.
	settings := h.store.GetSettings()
	settings.AllowLocalBookmarks = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if res := save("blocked", "http://127.0.0.1:9/hook"); res.Code != http.StatusBadRequest {
		t.Errorf("a loopback receiver was accepted with HTTP %d", res.Code)
	}
	if _, ok := lookupWebhookEndpoint("blocked"); ok {
		t.Error("the refused endpoint was stored anyway")
	}

	// A scheme nothing can be posted to is refused either way.
	if res := save("scheme", "ftp://files.example/hook"); res.Code != http.StatusBadRequest {
		t.Errorf("an ftp receiver was accepted with HTTP %d", res.Code)
	}
}
