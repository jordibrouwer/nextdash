package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

/*
The secrets a health check needs, kept out of the bookmarks file.

A self-hosted service behind an API key answers 401 to an anonymous request, so
monitoring one means sending a credential with the check. That credential has to
live somewhere, and the obvious place -- a field on the bookmark -- is the wrong
one: bookmarks-N.json is in the backup allowlist and in every export, so a key
for Sonarr would travel in a ZIP to a NAS, to a laptop, into a Downloads folder.

So this follows sources.json rather than the bookmark: one file in the data
directory, 0600, deliberately NOT in the backup allowlist, never handed back to
a browser. The bookmark keeps only an id pointing here, which is meaningless on
its own -- a restored install has the monitoring settings and has to be told the
key again, which is the same trade sources.json makes for its tokens.

Kept separate from sources.json rather than folded into it: a source is a place
bookmarks come from, and one of these is a way to reach a bookmark that already
exists. Sharing a file would mean one schema answering to two unrelated
lifecycles.
*/

const (
	// healthCredentialMaxHeaders bounds one entry. A check that needs more than
	// this is not a health check.
	healthCredentialMaxHeaders = 8
	// healthCredentialMaxValueLen bounds a header value. Tokens are long; a
	// kilobyte is past every real one and short of anything worth storing here.
	healthCredentialMaxValueLen = 1024
	healthCredentialMaxNameLen  = 128
)

/*
HealthCredential is what to send with a check, for one service.

Named and reusable rather than per bookmark: someone monitoring five Sonarr
endpoints has one API key, and pasting it five times means changing it five
times when it rotates.
*/
type HealthCredential struct {
	// Label is what the reader sees in the bookmark form.
	Label string `json:"label"`
	// Headers are sent verbatim with the check.
	Headers map[string]string `json:"headers,omitempty"`
	// BasicUser and BasicPassword become an Authorization header. Kept as two
	// fields because that is how the reader thinks of them, and because
	// building the header here means never asking anyone to base64 by hand.
	BasicUser     string `json:"basicUser,omitempty"`
	BasicPassword string `json:"basicPassword,omitempty"`
}

// HealthCredentialFile is the whole set on disk.
type HealthCredentialFile struct {
	Credentials map[string]HealthCredential `json:"credentials"`
}

var errInvalidCredentialID = errors.New("invalid credential id")

var healthCredentialMu sync.Mutex

func healthCredentialFilePath() string {
	return filepath.Join(ResolveDataDir(), "health-credentials.json")
}

func readHealthCredentialFile() HealthCredentialFile {
	data, err := os.ReadFile(healthCredentialFilePath())
	if err != nil {
		return HealthCredentialFile{Credentials: map[string]HealthCredential{}}
	}
	var file HealthCredentialFile
	if err := json.Unmarshal(data, &file); err != nil || file.Credentials == nil {
		return HealthCredentialFile{Credentials: map[string]HealthCredential{}}
	}
	return file
}

// writeHealthCredentialFile persists the set with 0600, for the same reason
// sources.json does: on a multi-user host 0644 means every account can read it.
func writeHealthCredentialFile(file HealthCredentialFile) error {
	if file.Credentials == nil {
		file.Credentials = map[string]HealthCredential{}
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(healthCredentialFilePath(), data, 0600)
}

/*
normalizeCredentialID keeps an id usable as a map key and a URL segment.

Same rule as source ids: letters, digits, dash, underscore and colon, so an id
can name the service and the account ("sonarr:attic") without ever needing
escaping on the way to a route.
*/
func normalizeCredentialID(raw string) string {
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

/*
sanitizeHealthCredential drops what cannot be sent and bounds what can.

Header names are checked against the same rule net/http applies, because a name
with a newline in it is a request-splitting attempt rather than a typo, and
because an invalid name would be silently dropped later anyway -- better to
refuse it while someone is looking at the form.
*/
func sanitizeHealthCredential(in HealthCredential) HealthCredential {
	out := HealthCredential{
		Label:         trimToLength(strings.TrimSpace(in.Label), healthCredentialMaxNameLen),
		BasicUser:     trimToLength(strings.TrimSpace(in.BasicUser), healthCredentialMaxValueLen),
		BasicPassword: trimToLength(in.BasicPassword, healthCredentialMaxValueLen),
	}
	if len(in.Headers) == 0 {
		return out
	}
	out.Headers = map[string]string{}
	for name, value := range in.Headers {
		if len(out.Headers) >= healthCredentialMaxHeaders {
			break
		}
		name = strings.TrimSpace(name)
		value = strings.TrimSpace(value)
		if name == "" || value == "" {
			continue
		}
		if !validHeaderFieldName(name) || !validHeaderFieldValue(value) {
			continue
		}
		// Host and Content-Length are the transport's to set, and a check sends
		// no body: honouring either would produce a request that describes
		// itself wrongly.
		switch http.CanonicalHeaderKey(name) {
		case "Host", "Content-Length", "Transfer-Encoding", "Connection":
			continue
		}
		out.Headers[http.CanonicalHeaderKey(name)] = trimToLength(value, healthCredentialMaxValueLen)
	}
	if len(out.Headers) == 0 {
		out.Headers = nil
	}
	return out
}

// validHeaderFieldName mirrors the token rule from RFC 7230 that net/http
// enforces, so a name refused here is exactly one that would be refused later.
func validHeaderFieldName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case strings.ContainsRune("!#$%&'*+-.^_`|~", r):
		default:
			return false
		}
	}
	return true
}

// validHeaderFieldValue refuses the control characters that would let a value
// end the header and start something of its own.
func validHeaderFieldValue(value string) bool {
	for _, r := range value {
		if r == '\n' || r == '\r' || r == 0 {
			return false
		}
	}
	return true
}

// lookupHealthCredential reads one entry, or the zero value when the id names
// nothing -- a bookmark pointing at a credential that was deleted checks
// anonymously rather than failing, which is the same answer it gave before the
// credential existed.
func lookupHealthCredential(id string) (HealthCredential, bool) {
	id = normalizeCredentialID(id)
	if id == "" {
		return HealthCredential{}, false
	}
	healthCredentialMu.Lock()
	defer healthCredentialMu.Unlock()
	file := readHealthCredentialFile()
	credential, ok := file.Credentials[id]
	return credential, ok
}

// saveHealthCredential writes one entry, replacing whatever was there.
func saveHealthCredential(id string, credential HealthCredential) error {
	id = normalizeCredentialID(id)
	if id == "" {
		return errInvalidCredentialID
	}
	healthCredentialMu.Lock()
	defer healthCredentialMu.Unlock()
	file := readHealthCredentialFile()
	file.Credentials[id] = sanitizeHealthCredential(credential)
	return writeHealthCredentialFile(file)
}

// deleteHealthCredential forgets one entry.
func deleteHealthCredential(id string) error {
	id = normalizeCredentialID(id)
	if id == "" {
		return errInvalidCredentialID
	}
	healthCredentialMu.Lock()
	defer healthCredentialMu.Unlock()
	file := readHealthCredentialFile()
	delete(file.Credentials, id)
	return writeHealthCredentialFile(file)
}

/*
listHealthCredentials names what is stored without handing back a single secret.

The form needs to offer a choice, which needs labels; it never needs the values,
and a route that returns them is a route that can be asked for them.
*/
func listHealthCredentials() map[string]string {
	healthCredentialMu.Lock()
	defer healthCredentialMu.Unlock()
	file := readHealthCredentialFile()
	labels := map[string]string{}
	for id, credential := range file.Credentials {
		label := credential.Label
		if label == "" {
			label = id
		}
		labels[id] = label
	}
	return labels
}

/*
CredentialSummary describes one entry without describing what is in it.

The list route hands back labels and nothing else, which is right for a picker
and not enough for a screen that edits: a row reading only "Sonarr" cannot say
whether it carries a header or a username, and someone about to replace it has
no way to check they are replacing the right kind of thing.

Header names, never values. A name is what the service documents publicly --
X-Api-Key is written on Sonarr's own settings page -- and the value is the part
that is worth stealing. Basic auth is reported as a flag and a username for the
same reason: the username is on the login screen, the password is not.
*/
type CredentialSummary struct {
	Label string `json:"label"`
	// Headers are the header names this entry sets, sorted so the list does not
	// reshuffle itself between two reads of the same file.
	Headers []string `json:"headers,omitempty"`
	Basic   bool     `json:"basic,omitempty"`
	// BasicUser is shown so a row can say which account it signs in as. The
	// password has no counterpart here and never will.
	BasicUser string `json:"basicUser,omitempty"`
}

/*
listHealthCredentialDetails describes each entry, still without a secret.

Beside listHealthCredentials rather than replacing it: the bookmark form and the
widget panel want a name for a dropdown and should not start receiving a
structure they have no use for.
*/
func listHealthCredentialDetails() map[string]CredentialSummary {
	healthCredentialMu.Lock()
	defer healthCredentialMu.Unlock()
	file := readHealthCredentialFile()
	out := make(map[string]CredentialSummary, len(file.Credentials))
	for id, credential := range file.Credentials {
		label := credential.Label
		if label == "" {
			label = id
		}
		summary := CredentialSummary{
			Label:     label,
			Basic:     credential.BasicUser != "" || credential.BasicPassword != "",
			BasicUser: credential.BasicUser,
		}
		for name := range credential.Headers {
			summary.Headers = append(summary.Headers, name)
		}
		sort.Strings(summary.Headers)
		out[id] = summary
	}
	return out
}

/*
credentialHeaderNames lists the headers this credential puts on a request.

Authorization is in the list whenever basic auth is set, even though net/http
drops it on a redirect of its own accord: its rule is a domain match, so a
redirect to a sibling host under the same domain keeps it. The rule here is the
host, exactly, and saying so in one place beats relying on two rules that nearly
agree.
*/
func credentialHeaderNames(credential HealthCredential) []string {
	names := make([]string, 0, len(credential.Headers)+1)
	for name := range credential.Headers {
		names = append(names, name)
	}
	if credential.BasicUser != "" {
		names = append(names, "Authorization")
	}
	return names
}

/*
credentialRedirectCheck keeps a secret from following a redirect off its host.

A credential is stored for one service. net/http copies the headers of a request
onto the redirect it follows, so a monitored host that answers 302 -- because it
was misconfigured, or because somebody arranged it -- receives this install's
API key at whatever address it named. The address itself is already checked by
the wrapper below; this is about what the request carries once it gets there.

Host and port, not the hostname alone. On the machines this runs on, every
service is the same hostname on a different port: a key for Sonarr on :8989 has
no business arriving at whatever answers :9999, and a rule that compared only
names would have called those the same place. The cost is that a redirect which
changes an explicit port -- http://nas:5000 to https://nas:5001 -- strips too,
and the check then reports what an anonymous request sees. That is the safe
direction to be wrong in.

Stripped rather than refused, so a service that legitimately redirects to a
login host is still reachable.
*/
func credentialRedirectCheck(credential HealthCredential, next func(*http.Request, []*http.Request) error) func(*http.Request, []*http.Request) error {
	names := credentialHeaderNames(credential)
	return func(req *http.Request, via []*http.Request) error {
		if next != nil {
			if err := next(req, via); err != nil {
				return err
			}
		}
		if len(names) == 0 || len(via) == 0 || req.URL == nil || via[0].URL == nil {
			return nil
		}
		if strings.EqualFold(req.URL.Host, via[0].URL.Host) {
			return nil
		}
		for _, name := range names {
			req.Header.Del(name)
		}
		logWarn(logComponentHealth, "%s redirected to %s; the stored credential was not sent on",
			via[0].URL.Host, req.URL.Host)
		return nil
	}
}

/*
applyHealthCredential puts the stored secrets on a request.

Basic auth is built here rather than stored as a header, so nobody has to
base64 anything by hand and a rotated password is one field rather than a
re-encoded blob. An explicit Authorization header wins: someone who typed one
meant it.
*/
func applyHealthCredential(req *http.Request, credential HealthCredential) {
	if req == nil {
		return
	}
	for name, value := range credential.Headers {
		req.Header.Set(name, value)
	}
	if credential.BasicUser != "" && req.Header.Get("Authorization") == "" {
		req.SetBasicAuth(credential.BasicUser, credential.BasicPassword)
	}
}

/*
HealthCredentialsHandler answers /api/health/credentials.

GET lists ids and labels — never a value, because a route that returns secrets
is a route that can be asked for them, and nothing on screen needs them back.
PUT stores one, DELETE forgets one. Behind the write token, like every other
route that changes stored state.
*/
func (h *Handlers) HealthCredentialsHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		// credentials stays exactly what it was, for the two pickers that read
		// it; details is beside it for the screen that edits.
		_ = json.NewEncoder(w).Encode(map[string]any{
			"credentials": listHealthCredentials(),
			"details":     listHealthCredentialDetails(),
		})
		return
	}

	if !h.requireWriteAccess(w, r) {
		return
	}

	switch r.Method {
	case http.MethodPut:
		var body struct {
			ID string `json:"id"`
			HealthCredential
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10)).Decode(&body); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if err := saveHealthCredential(body.ID, body.HealthCredential); err != nil {
			http.Error(w, "Invalid credential id", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"credentials": listHealthCredentials(),
			"details":     listHealthCredentialDetails(),
		})

	case http.MethodDelete:
		if err := deleteHealthCredential(r.URL.Query().Get("id")); err != nil {
			http.Error(w, "Invalid credential id", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"credentials": listHealthCredentials(),
			"details":     listHealthCredentialDetails(),
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

/*
widgetCredentialPrefix marks an entry as belonging to one custom widget.

The config panel derives this id from the widget rather than asking anyone to
name a secret, so the prefix is the one durable difference between "a key that
exists because somebody filled in a widget" and "a sign-in somebody made on
purpose and pointed several checks at".
*/
const widgetCredentialPrefix = "widget:"

/*
HealthCredentialRevealHandler hands back one stored secret, for one widget.

This is the deliberate exception to the rule the rest of this file keeps: a
value written here does not come back. It exists because the panel that stores a
key is also the panel where "what did I actually paste in there" is the question
that cannot otherwise be answered -- an Authorization header missing its "Bearer"
prefix looks identical to a correct one from the outside, and the only way to
see the difference was to read the file over somebody's shoulder.

Three things keep the exception narrow, and all three are the point:

  - Only widget: ids. A shared sign-in is pointed at by several checks and was
    named on purpose; it stays write-only, so this route cannot be used to walk
    the credential store.
  - One field per request, named. There is no shape here that returns
    everything, so a caller has to already know what it is asking for.
  - Behind the write token, and logged. Revealing is a write-shaped act even
    though it changes nothing, and it leaves a trace.
*/
func (h *Handlers) HealthCredentialRevealHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The same gate PUT and DELETE sit behind. Reading a secret is not a
	// lesser act than replacing one.
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	id := normalizeCredentialID(r.URL.Query().Get("id"))
	if id == "" || !strings.HasPrefix(id, widgetCredentialPrefix) {
		// Deliberately the same answer as an id that does not exist: a caller
		// probing this route learns nothing about which shared sign-ins are
		// stored.
		http.Error(w, "Unknown credential", http.StatusNotFound)
		return
	}
	credential, ok := lookupHealthCredential(id)
	if !ok {
		http.Error(w, "Unknown credential", http.StatusNotFound)
		return
	}

	field := strings.TrimSpace(r.URL.Query().Get("field"))
	var value string
	switch {
	case field == "basicPassword":
		value = credential.BasicPassword
	case field != "":
		// A header, by name. Canonicalised so the caller may ask with whatever
		// casing the form showed it in.
		if credential.Headers != nil {
			value = credential.Headers[http.CanonicalHeaderKey(field)]
		}
	}
	if value == "" {
		http.Error(w, "Unknown field", http.StatusNotFound)
		return
	}

	// Named, not valued: the log says a secret was read and which one, so the
	// trace is useful without the trace itself becoming a second copy.
	logWarn(logComponentHealth, "the stored secret for %s (%s) was revealed to the config panel", id, field)
	_ = json.NewEncoder(w).Encode(map[string]any{"value": value})
}
