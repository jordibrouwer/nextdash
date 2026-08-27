package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Outgoing webhooks: telling something else that a bookmark changed.

Everything nextDash talks to today, it talks to on its own schedule -- it polls
a feed, it checks a host, it fetches an icon. Nothing outside can find out that
something happened here without asking, which means anything built around this
install has to poll it. A webhook inverts that: the change is pushed, once, to
whoever asked to hear about it.

The receiver is somebody's automation -- n8n, Home Assistant, a script behind a
tunnel. That has two consequences this file is built around.

The first is that the body has to be signed. An endpoint listening for "a
bookmark was added" is a URL that anyone who learns it can post to, and a
receiver that acts on an unauthenticated POST is acting on whatever the internet
tells it. The Standard Webhooks scheme is used rather than a scheme of our own,
because the receivers above already know how to verify it and because "we
invented a signature format" is the sentence before every signature bug.

The second is that delivery fails. A laptop is asleep, a tunnel is down, a
container is restarting. So a failed post is retried a few times with a growing
gap, and then given up on -- there is no durable queue here, and pretending
otherwise by retrying forever would fill memory to hide the same lost event.
*/

const (
	// webhookMaxEndpoints bounds the file. Past a handful this is a message
	// bus, not a dashboard setting.
	webhookMaxEndpoints = 16
	// webhookTimeout per attempt. A receiver that needs longer than this to
	// acknowledge should acknowledge first and work afterwards, which is what
	// every webhook guide already tells it to do.
	webhookTimeout = 10 * time.Second
	// webhookAttempts including the first. Three tries over about half a
	// minute covers a restart; anything longer needs a queue we do not have.
	webhookAttempts = 3
	// webhookSignatureVersion is the scheme identifier Standard Webhooks puts
	// in front of the signature, so a receiver can be handed a second one
	// later without the first stopping.
	webhookSignatureVersion = "v1"
)

// webhookRetryDelay is the gap after the first failed attempt, growing with
// each one. A variable rather than a constant only so a test can wait
// milliseconds instead of seconds to watch a retry happen.
var webhookRetryDelay = 5 * time.Second

func webhookRetryDelayForTest(d time.Duration) func() {
	previous := webhookRetryDelay
	webhookRetryDelay = d
	return func() { webhookRetryDelay = previous }
}

// Event names. Kept as constants because they are a published interface: a
// receiver filters on these strings, and a rename is a breaking change for
// somebody's automation rather than a refactor.
const (
	webhookEventBookmarkAdded   = "bookmark.added"
	webhookEventBookmarkUpdated = "bookmark.updated"
	webhookEventBookmarkDeleted = "bookmark.deleted"
	webhookEventHealthDown      = "health.down"
	webhookEventHealthUp        = "health.up"
)

// webhookEventNames is every event that can be subscribed to, in the order the
// config screen should list them.
var webhookEventNames = []string{
	webhookEventBookmarkAdded,
	webhookEventBookmarkUpdated,
	webhookEventBookmarkDeleted,
	webhookEventHealthDown,
	webhookEventHealthUp,
}

/*
WebhookEndpoint is one receiver.

Events is a filter rather than a fan-out of everything: a receiver that only
cares about a bookmark being added should not have to wake for every health
check, and an empty list means all of them, because "I want the lot" is the
common case and should not require ticking five boxes.
*/
type WebhookEndpoint struct {
	// Label is what the reader sees. Purely for the config screen.
	Label string `json:"label,omitempty"`
	URL   string `json:"url"`
	// Secret signs the body. Generated here rather than typed, because a
	// signing key someone invents is a signing key someone can guess.
	Secret string `json:"secret,omitempty"`
	// Events to send. Empty means every event.
	Events  []string `json:"events,omitempty"`
	Enabled bool     `json:"enabled"`
}

// WebhookFile is the whole set on disk.
type WebhookFile struct {
	Endpoints map[string]WebhookEndpoint `json:"endpoints"`
}

var errInvalidWebhookID = errors.New("invalid webhook id")
var errTooManyWebhooks = errors.New("too many webhook endpoints")

var webhookMu sync.Mutex

/*
webhooks.json sits beside health-credentials.json rather than in settings.json,
and for the same reason: it holds a signing secret. settings.json is handed to
every browser that loads the dashboard, so a secret in it is a secret in the
page source.
*/
func webhookFilePath() string {
	return filepath.Join(ResolveDataDir(), "webhooks.json")
}

func readWebhookFile() WebhookFile {
	data, err := os.ReadFile(webhookFilePath())
	if err != nil {
		return WebhookFile{Endpoints: map[string]WebhookEndpoint{}}
	}
	var file WebhookFile
	if err := json.Unmarshal(data, &file); err != nil || file.Endpoints == nil {
		return WebhookFile{Endpoints: map[string]WebhookEndpoint{}}
	}
	return file
}

// writeWebhookFile persists the set with 0600: on a shared host, 0644 means
// every account can read the signing keys and forge a delivery.
func writeWebhookFile(file WebhookFile) error {
	if file.Endpoints == nil {
		file.Endpoints = map[string]WebhookEndpoint{}
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(webhookFilePath(), data, 0600)
}

// normalizeWebhookID follows the credential rule, so an id can name the
// receiver ("n8n:bookmarks") and still be safe in a URL.
func normalizeWebhookID(raw string) string {
	id := strings.TrimSpace(raw)
	if id == "" || len(id) > 128 {
		return ""
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_', r == ':', r == '.':
		default:
			return ""
		}
	}
	return id
}

// newWebhookSecret returns a fresh signing key. 32 bytes because that is the
// block size of the SHA-256 HMAC that consumes it, hex because a receiver's
// config field has to survive being pasted into a YAML file.
func newWebhookSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// sanitizeWebhookEndpoint drops what cannot be delivered and bounds what can.
func sanitizeWebhookEndpoint(in WebhookEndpoint) WebhookEndpoint {
	out := WebhookEndpoint{
		Label:   trimToLength(strings.TrimSpace(in.Label), 128),
		URL:     trimToLength(strings.TrimSpace(in.URL), 2048),
		Secret:  trimToLength(strings.TrimSpace(in.Secret), 256),
		Enabled: in.Enabled,
	}
	known := map[string]bool{}
	for _, name := range webhookEventNames {
		known[name] = true
	}
	for _, name := range in.Events {
		name = strings.TrimSpace(name)
		// An unknown event is dropped rather than stored: keeping it would
		// silently subscribe the endpoint to nothing while the screen shows a
		// filter that looks like it does something.
		if known[name] && !containsString(out.Events, name) {
			out.Events = append(out.Events, name)
		}
	}
	return out
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// wants reports whether this endpoint should hear about event. An empty filter
// means everything.
func (e WebhookEndpoint) wants(event string) bool {
	if !e.Enabled || strings.TrimSpace(e.URL) == "" {
		return false
	}
	return len(e.Events) == 0 || containsString(e.Events, event)
}

/*
listWebhookEndpoints is what the config screen gets, with the secret replaced
by a flag saying whether one is set.

The secret is shown exactly once, in the response to the save that generated
it, because that is the only moment the reader can copy it into the receiver.
After that it exists to be verified against, not to be read back -- a screen
that re-displays it turns every shoulder and every screenshot into a leak.
*/
func listWebhookEndpoints() []map[string]any {
	webhookMu.Lock()
	defer webhookMu.Unlock()
	file := readWebhookFile()
	ids := make([]string, 0, len(file.Endpoints))
	for id := range file.Endpoints {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		endpoint := file.Endpoints[id]
		out = append(out, map[string]any{
			"id":        id,
			"label":     endpoint.Label,
			"url":       endpoint.URL,
			"events":    endpoint.Events,
			"enabled":   endpoint.Enabled,
			"hasSecret": endpoint.Secret != "",
		})
	}
	return out
}

func lookupWebhookEndpoint(id string) (WebhookEndpoint, bool) {
	id = normalizeWebhookID(id)
	if id == "" {
		return WebhookEndpoint{}, false
	}
	webhookMu.Lock()
	defer webhookMu.Unlock()
	endpoint, ok := readWebhookFile().Endpoints[id]
	return endpoint, ok
}

/*
saveWebhookEndpoint writes one entry and returns it as stored.

An empty secret on an entry that already has one keeps the stored key: the
screen never had the secret to send back, so treating "absent" as "clear it"
would silently unsign every delivery the moment someone renamed the endpoint.
A genuinely new entry gets a generated key.
*/
func saveWebhookEndpoint(id string, endpoint WebhookEndpoint) (WebhookEndpoint, error) {
	id = normalizeWebhookID(id)
	if id == "" {
		return WebhookEndpoint{}, errInvalidWebhookID
	}
	endpoint = sanitizeWebhookEndpoint(endpoint)
	if endpoint.URL == "" {
		return WebhookEndpoint{}, errInvalidWebhookID
	}

	webhookMu.Lock()
	defer webhookMu.Unlock()
	file := readWebhookFile()
	if file.Endpoints == nil {
		file.Endpoints = map[string]WebhookEndpoint{}
	}
	existing, exists := file.Endpoints[id]
	if !exists && len(file.Endpoints) >= webhookMaxEndpoints {
		return WebhookEndpoint{}, errTooManyWebhooks
	}
	if endpoint.Secret == "" {
		if exists && existing.Secret != "" {
			endpoint.Secret = existing.Secret
		} else {
			secret, err := newWebhookSecret()
			if err != nil {
				return WebhookEndpoint{}, err
			}
			endpoint.Secret = secret
		}
	}
	file.Endpoints[id] = endpoint
	if err := writeWebhookFile(file); err != nil {
		return WebhookEndpoint{}, err
	}
	return endpoint, nil
}

func deleteWebhookEndpoint(id string) error {
	id = normalizeWebhookID(id)
	if id == "" {
		return errInvalidWebhookID
	}
	webhookMu.Lock()
	defer webhookMu.Unlock()
	file := readWebhookFile()
	if _, ok := file.Endpoints[id]; !ok {
		return nil
	}
	delete(file.Endpoints, id)
	return writeWebhookFile(file)
}

/*
signWebhookPayload implements the Standard Webhooks signature.

The id and the timestamp are signed alongside the body, not merely sent with
it. Signing the body alone would leave both free to be rewritten in flight,
which costs the receiver exactly the two defences they exist for: the id is how
it recognises a redelivery it has already acted on, and the timestamp is how it
refuses one replayed at it a day later.
*/
func signWebhookPayload(secret, id string, timestamp int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(id))
	mac.Write([]byte("."))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10)))
	mac.Write([]byte("."))
	mac.Write(body)
	return webhookSignatureVersion + "," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// newWebhookMessageID is the id a receiver deduplicates on. Random rather than
// derived from the event, because two identical events are two deliveries and
// collapsing them would be the sender deciding what the receiver already knows.
func newWebhookMessageID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "msg_" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "msg_" + hex.EncodeToString(buf)
}

/*
webhookDelivery is the body. Flat and small on purpose: the receiver is often a
no-code node where reaching a nested field is a chore.
*/
type webhookDelivery struct {
	// Type is the event name, under the key Standard Webhooks receivers and
	// most no-code nodes already look at.
	Type string `json:"type"`
	// Timestamp in RFC 3339 for a human reading a log, alongside the epoch
	// seconds in the signed header for the verification step.
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

// buildWebhookRequest formats and signs one delivery. Separate from sending it
// so the signature can be checked in a test without a server, and so the test
// path and the dispatch path can never sign different bytes.
func buildWebhookRequest(ctx context.Context, endpoint WebhookEndpoint, event string, data map[string]any, now time.Time) (*http.Request, error) {
	body, err := json.Marshal(webhookDelivery{
		Type:      event,
		Timestamp: now.UTC().Format(time.RFC3339),
		Data:      data,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	id := newWebhookMessageID()
	timestamp := now.Unix()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "nextDash-Webhook/1.0")
	req.Header.Set("webhook-id", id)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(timestamp, 10))
	req.Header.Set("webhook-signature", signWebhookPayload(endpoint.Secret, id, timestamp, body))
	return req, nil
}

/*
webhookAllowLocal reports whether this install may deliver to a local address.

A function rather than a value, because the setting can be changed while the
process runs and a copy taken at startup would keep answering with whatever it
was then. It defaults to refusing, so a build that never registers a handler
gets the stricter answer rather than the looser one by accident.
*/
var webhookAllowLocal = func() bool { return false }

// RegisterWebhookDelivery wires delivery to this install's settings, the way
// registerHandlerSources wires the importers.
func (h *Handlers) RegisterWebhookDelivery() {
	webhookAllowLocal = h.allowLocalBookmarks
}

// webhookAllowLocalForTest lets a test deliver to httptest's loopback server,
// the same way webhookRetryDelayForTest lets it watch a retry in milliseconds.
func webhookAllowLocalForTest(allow bool) func() {
	previous := webhookAllowLocal
	webhookAllowLocal = func() bool { return allow }
	return func() { webhookAllowLocal = previous }
}

/*
webhookHTTPClient is the guarded client every other outbound request uses.

An endpoint URL is checked against the SSRF rules when it is saved, which is
what lets the screen say "this address is refused" while somebody is looking at
the field. That check cannot be the only one, though: it ran against what the
name answered then, and a name is resolved again at delivery. Without a guard
here, a receiver that answers 302 -- or one whose DNS points somewhere else by
the time an event fires -- reaches an address the save had already refused.

Zero redirects, because a webhook receiver has nowhere to send us. The contract
is to acknowledge a POST; a 3xx is either a misconfiguration worth seeing in the
log or somebody steering the delivery, and neither is worth following.
*/
func webhookHTTPClient() *http.Client {
	return newOutboundHTTPClient(webhookAllowLocal(), webhookTimeout, 0)
}

/*
deliverWebhook posts one delivery, retrying a failure.

Only a transport error or a 5xx is retried. A 4xx is the receiver saying the
request itself is wrong -- a bad path, a rejected signature -- and sending it
again unchanged produces the same answer while looking like an outage.
*/
func deliverWebhook(endpoint WebhookEndpoint, event string, data map[string]any) {
	client := webhookHTTPClient()
	for attempt := 1; attempt <= webhookAttempts; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), webhookTimeout)
		req, err := buildWebhookRequest(ctx, endpoint, event, data, time.Now())
		if err != nil {
			cancel()
			log.Printf("webhook: failed to build %s for %s: %v", event, endpoint.URL, err)
			return
		}
		resp, err := client.Do(req)
		if err == nil {
			status := resp.StatusCode
			drainAndCloseResponse(resp)
			cancel()
			if status < 400 {
				return
			}
			if status < 500 {
				log.Printf("webhook: %s refused %s with HTTP %d", endpoint.URL, event, status)
				return
			}
			err = errors.New("HTTP " + strconv.Itoa(status))
		} else {
			cancel()
		}
		if attempt == webhookAttempts {
			log.Printf("webhook: gave up on %s for %s after %d attempts: %v",
				event, endpoint.URL, webhookAttempts, err)
			return
		}
		// Growing gap: a receiver that is restarting is usually back within
		// seconds, and hammering it while it boots is how a slow start becomes
		// a failed one.
		time.Sleep(time.Duration(attempt) * webhookRetryDelay)
	}
}

/*
monitorNotificationFields is a health notification as webhook data.

Built by hand rather than by marshalling the struct, so what a receiver sees is
a deliberate interface: the struct carries fields that exist to render a chat
message, and every one of them added later would silently become part of a
payload somebody's automation parses.
*/
func monitorNotificationFields(n monitorNotification) map[string]any {
	fields := map[string]any{
		"name":   strings.TrimSpace(n.Name),
		"url":    strings.TrimSpace(n.URL),
		"status": n.Status,
		"at":     n.At,
	}
	if n.Error != "" {
		fields["error"] = n.Error
	}
	if n.Failures > 0 {
		fields["failures"] = n.Failures
	}
	if n.DurationMs > 0 {
		fields["durationMs"] = n.DurationMs
	}
	return fields
}

/*
emitWebhookEvent sends event to every endpoint subscribed to it.

Returns immediately: this is called from the middle of saving a bookmark, and a
receiver that takes ten seconds to answer must not be able to hold up the
request that triggered it -- or, worse, to make saving a bookmark fail because
something unrelated is down.
*/
func emitWebhookEvent(event string, data map[string]any) {
	webhookMu.Lock()
	file := readWebhookFile()
	webhookMu.Unlock()

	for _, endpoint := range file.Endpoints {
		if !endpoint.wants(event) {
			continue
		}
		go deliverWebhook(endpoint, event, data)
	}
}

// webhooksConfigured reports whether anything is listening. Used to skip work
// that only exists to feed a webhook, so an install with none pays nothing.
func webhooksConfigured() bool {
	webhookMu.Lock()
	defer webhookMu.Unlock()
	for _, endpoint := range readWebhookFile().Endpoints {
		if endpoint.Enabled && strings.TrimSpace(endpoint.URL) != "" {
			return true
		}
	}
	return false
}

/*
WebhooksHandler is the config screen's CRUD.

A test send is a POST to .../test rather than a flag on the save, because the
question "is my receiver reachable" is asked again long after the endpoint was
created -- usually right after somebody changed something on the other side.
*/
func (h *Handlers) WebhooksHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	/*
	 * The token first, GET included.
	 *
	 * An endpoint URL is not a description of a webhook, it is the webhook: a
	 * receiver acts on whatever posts to it, which is the whole reason the body
	 * is signed at all. Answering the list before the check made that address
	 * readable by anything that can reach this route -- and since the default
	 * Access-Control-Allow-Origin is *, that includes any page open in the
	 * reader's browser.
	 *
	 * Nothing on screen loses by it: the config panel fetches this through
	 * nextDashFetch, which carries the token already, and an install with no
	 * token set is unaffected.
	 */
	if !h.requireWriteAccess(w, r) {
		return
	}

	if r.Method == http.MethodGet {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"endpoints": listWebhookEndpoints(),
			"events":    webhookEventNames,
		})
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body struct {
			ID string `json:"id"`
			WebhookEndpoint
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		// Same rule a monitor's notify target goes through: a local receiver is
		// reachable only on an install that has already allowed local
		// addresses. Refused here, where the reader can still fix the field.
		if err := validateHTTPURL(strings.TrimSpace(body.URL), h.allowLocalBookmarks()); err != nil {
			http.Error(w, "Webhook URL refused: "+err.Error(), http.StatusBadRequest)
			return
		}
		saved, err := saveWebhookEndpoint(body.ID, body.WebhookEndpoint)
		if err != nil {
			if errors.Is(err, errTooManyWebhooks) {
				http.Error(w, "Too many webhook endpoints", http.StatusBadRequest)
				return
			}
			http.Error(w, "Invalid webhook endpoint", http.StatusBadRequest)
			return
		}
		// The one moment the secret travels back: whoever just created the
		// endpoint needs it to configure the far side, and will never be shown
		// it again.
		_ = json.NewEncoder(w).Encode(map[string]any{
			"endpoints": listWebhookEndpoints(),
			"secret":    saved.Secret,
		})

	case http.MethodDelete:
		if err := deleteWebhookEndpoint(r.URL.Query().Get("id")); err != nil {
			http.Error(w, "Invalid webhook id", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"endpoints": listWebhookEndpoints()})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

/*
TestWebhookHandler posts one delivery and reports what came back.

Synchronous, unlike a real event: the reader is standing in front of the screen
waiting to find out whether it worked, and "queued" is not an answer to that
question.
*/
func (h *Handlers) TestWebhookHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if !h.requireWriteAccess(w, r) {
		return
	}

	endpoint, ok := lookupWebhookEndpoint(r.URL.Query().Get("id"))
	if !ok {
		http.Error(w, "Unknown webhook id", http.StatusNotFound)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), webhookTimeout)
	defer cancel()
	req, err := buildWebhookRequest(ctx, endpoint, webhookEventBookmarkAdded, map[string]any{
		"test":   true,
		"name":   "nextDash test",
		"url":    "https://example.com/",
		"pageId": 1,
	}, time.Now())
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	resp, err := webhookHTTPClient().Do(req)
	if err != nil {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	defer drainAndCloseResponse(resp)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     resp.StatusCode < 400,
		"status": resp.StatusCode,
	})
}
