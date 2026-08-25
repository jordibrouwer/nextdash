package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
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
		_ = json.NewEncoder(w).Encode(map[string]any{"credentials": listHealthCredentials()})
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
		_ = json.NewEncoder(w).Encode(map[string]any{"credentials": listHealthCredentials()})

	case http.MethodDelete:
		if err := deleteHealthCredential(r.URL.Query().Get("id")); err != nil {
			http.Error(w, "Invalid credential id", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"credentials": listHealthCredentials()})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
