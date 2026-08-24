package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
The source register: where bookmarks come from, and what the last round did.

Cluster A is a dozen services that all answer the same three questions — what is
my token, what did I already import, and what happened last time I asked. Written
once per service that would be a dozen half-remembered shapes; written once here,
every later source is only a parser.

Modelled on feeds.json: one file in the data directory, one mutex, and per entry
what is known about the last round. The differences are deliberate.

A source may hold a token, which makes this the second file in nextDash to hold a
credential — settings.json has held the Pushover token since monitoring shipped.
That precedent is followed rather than improved on: stored as given, behind the
write token, never handed back to a browser. What is added is the part that
precedent got wrong — the file is 0600 rather than 0644, and it is deliberately
NOT in the backup allowlist.

That last one is a real trade. A restored install re-imports from scratch, which
costs one round against the API and produces duplicates the dedupe already knows
how to skip. The alternative is writing a personal access token into a ZIP that
gets copied to a NAS, mailed to a laptop and dropped in a Downloads folder. The
cursor is worth less than the token is dangerous, so the cursor is what is lost.
*/

const (
	// sourceMaxResultLen bounds the human-readable summary kept per source.
	// It is shown in the config UI verbatim; a source that wants to say more
	// than this is saying it to the wrong audience.
	sourceMaxResultLen = 200
	// sourceMaxCursorLen bounds an opaque cursor. Every cursor in cluster A is a
	// timestamp, an ETag or a page token; anything longer is a bug upstream, not
	// a cursor worth keeping.
	sourceMaxCursorLen = 512
)

// SourceState is one configured import source.
//
// Keyed in the file by an id the caller chooses — "github:stars" — so a reader
// with two accounts on the same service is a second entry rather than a schema
// change.
type SourceState struct {
	// Kind selects the importer. Ids are chosen by the caller and may carry an
	// account name; the kind is what the code dispatches on.
	Kind  string `json:"kind"`
	Label string `json:"label,omitempty"`
	// Token is a credential for the service, stored as given.
	//
	// Never serialised towards a browser: the API layer answers with hasToken
	// instead (see SourceStatus). Anything reading this file directly is already
	// past the write token and inside the data directory, where settings.json
	// sits with the Pushover token in it.
	Token string `json:"token,omitempty"`
	// Cursor is whatever the importer needs to resume — a timestamp, an ETag, a
	// page token. Opaque here on purpose: this file should not have to change
	// when a service changes how it paginates.
	Cursor string `json:"cursor,omitempty"`
	// TargetPage and TargetCategory are where imported bookmarks land.
	TargetPage     int    `json:"targetPage,omitempty"`
	TargetCategory string `json:"targetCategory,omitempty"`
	LastRun        int64  `json:"lastRun,omitempty"`
	// LastResult is the last round in one line — "34 new, 0 changed" — and
	// LastError is set instead when the round failed. Exactly one of the two is
	// meaningful, so a source that failed does not still show the summary of
	// the last time it worked.
	LastResult string `json:"lastResult,omitempty"`
	LastError  string `json:"lastError,omitempty"`
	Enabled    bool   `json:"enabled"`
}

// SourceStateFile is the whole register on disk.
type SourceStateFile struct {
	Sources map[string]SourceState `json:"sources"`
}

// errInvalidSourceID rejects an id that could not be a map key or a URL segment.
var errInvalidSourceID = errors.New("invalid source id")

var sourceStateMu sync.Mutex

func sourceStateFilePath() string {
	return filepath.Join(ResolveDataDir(), "sources.json")
}

func readSourceStateFile() SourceStateFile {
	data, err := os.ReadFile(sourceStateFilePath())
	if err != nil {
		return SourceStateFile{Sources: map[string]SourceState{}}
	}
	var state SourceStateFile
	if err := json.Unmarshal(data, &state); err != nil || state.Sources == nil {
		return SourceStateFile{Sources: map[string]SourceState{}}
	}
	return state
}

// writeSourceStateFile persists the register with 0600.
//
// Not writeIndentJSONFile, which writes 0644: this file can hold a personal
// access token, and on a multi-user host 0644 means every account on the machine
// can read it. The atomic write helper underneath is the same one.
func writeSourceStateFile(state SourceStateFile) error {
	if state.Sources == nil {
		state.Sources = map[string]SourceState{}
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(sourceStateFilePath(), data, 0600)
}

func normalizeSourceID(raw string) string {
	id := strings.TrimSpace(raw)
	if len(id) > 128 {
		return ""
	}
	// A source id becomes a map key and travels through URLs; anything that
	// could be read as a path separator is refused rather than sanitised, so an
	// id always means exactly what it says.
	if id == "" || strings.ContainsAny(id, "/\\.\x00") {
		return ""
	}
	return id
}

func truncateForState(raw string, max int) string {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) <= max {
		return trimmed
	}
	return trimmed[:max]
}

// GetSource reads one entry.
func GetSource(id string) (SourceState, bool) {
	id = normalizeSourceID(id)
	if id == "" {
		return SourceState{}, false
	}
	sourceStateMu.Lock()
	defer sourceStateMu.Unlock()
	source, ok := readSourceStateFile().Sources[id]
	return source, ok
}

// ListSources returns every entry, ordered by id so the config UI does not
// reshuffle itself between two reads of the same file.
func ListSources() []SourceStatus {
	sourceStateMu.Lock()
	state := readSourceStateFile()
	sourceStateMu.Unlock()

	ids := make([]string, 0, len(state.Sources))
	for id := range state.Sources {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	out := make([]SourceStatus, 0, len(ids))
	for _, id := range ids {
		out = append(out, sourceStatusOf(id, state.Sources[id]))
	}
	return out
}

// SourceStatus is what a source looks like from outside the server.
//
// The token is reduced to a boolean here, and this is the only shape the API
// hands out. A settings page that could read a token back would put it in a
// response body, a browser cache and anything that logs one.
type SourceStatus struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Label          string `json:"label,omitempty"`
	HasToken       bool   `json:"hasToken"`
	TargetPage     int    `json:"targetPage,omitempty"`
	TargetCategory string `json:"targetCategory,omitempty"`
	LastRun        int64  `json:"lastRun,omitempty"`
	LastResult     string `json:"lastResult,omitempty"`
	LastError      string `json:"lastError,omitempty"`
	Enabled        bool   `json:"enabled"`
}

func sourceStatusOf(id string, source SourceState) SourceStatus {
	return SourceStatus{
		ID:             id,
		Kind:           source.Kind,
		Label:          source.Label,
		HasToken:       strings.TrimSpace(source.Token) != "",
		TargetPage:     source.TargetPage,
		TargetCategory: source.TargetCategory,
		LastRun:        source.LastRun,
		LastResult:     source.LastResult,
		LastError:      source.LastError,
		Enabled:        source.Enabled,
	}
}

/*
SaveSource creates or updates one entry.

An empty token keeps the stored one rather than clearing it. That is what lets
the config UI submit the whole form back without ever having received the token:
the browser sends "" for a field it was never given, and the meaning of "" has to
be "unchanged" or every save would log the reader out of their own source.
Clearing is therefore its own operation, ClearSourceToken, which cannot happen by
accident.
*/
func SaveSource(id string, next SourceState) (SourceStatus, error) {
	id = normalizeSourceID(id)
	if id == "" {
		return SourceStatus{}, errInvalidSourceID
	}

	sourceStateMu.Lock()
	defer sourceStateMu.Unlock()

	state := readSourceStateFile()
	if state.Sources == nil {
		state.Sources = map[string]SourceState{}
	}
	existing := state.Sources[id]

	merged := existing
	merged.Kind = strings.TrimSpace(next.Kind)
	merged.Label = truncateForState(next.Label, sourceMaxResultLen)
	merged.TargetPage = next.TargetPage
	merged.TargetCategory = strings.TrimSpace(next.TargetCategory)
	merged.Enabled = next.Enabled
	if token := strings.TrimSpace(next.Token); token != "" {
		// A changed token invalidates the cursor: it may be a different account,
		// and resuming someone else's import from this one's position would
		// silently skip everything older than the last round.
		if token != existing.Token {
			merged.Cursor = ""
		}
		merged.Token = token
	}

	state.Sources[id] = merged
	if err := writeSourceStateFile(state); err != nil {
		return SourceStatus{}, err
	}
	return sourceStatusOf(id, merged), nil
}

// ClearSourceToken forgets the credential and the position behind it.
func ClearSourceToken(id string) error {
	id = normalizeSourceID(id)
	if id == "" {
		return errInvalidSourceID
	}
	sourceStateMu.Lock()
	defer sourceStateMu.Unlock()
	state := readSourceStateFile()
	source, ok := state.Sources[id]
	if !ok {
		return nil
	}
	source.Token = ""
	// The cursor goes with it. Keeping a position for a credential that is gone
	// means the next token to arrive resumes mid-history.
	source.Cursor = ""
	source.Enabled = false
	state.Sources[id] = source
	return writeSourceStateFile(state)
}

// DeleteSource removes an entry entirely.
func DeleteSource(id string) error {
	id = normalizeSourceID(id)
	if id == "" {
		return errInvalidSourceID
	}
	sourceStateMu.Lock()
	defer sourceStateMu.Unlock()
	state := readSourceStateFile()
	if _, ok := state.Sources[id]; !ok {
		return nil
	}
	delete(state.Sources, id)
	return writeSourceStateFile(state)
}

/*
RecordSourceRun writes down what a round did.

Read-modify-write under the lock rather than taking a SourceState from the
caller: an importer holds its copy for the length of a network round trip, and
writing that copy back whole would undo a token the reader changed while it ran.
Only the four fields a round actually produces are touched.
*/
func RecordSourceRun(id string, cursor string, result string, runErr error) {
	id = normalizeSourceID(id)
	if id == "" {
		return
	}
	sourceStateMu.Lock()
	defer sourceStateMu.Unlock()
	state := readSourceStateFile()
	source, ok := state.Sources[id]
	if !ok {
		return
	}
	source.LastRun = time.Now().UnixMilli()
	if runErr != nil {
		source.LastError = truncateForState(runErr.Error(), sourceMaxResultLen)
		// The summary of the last successful round is cleared: a panel showing
		// "34 new" beside a failure reads as though the failure was harmless.
		source.LastResult = ""
		// The cursor is left exactly as it was. A failed round imported nothing,
		// so moving the position would skip whatever it failed to read.
		state.Sources[id] = source
		_ = writeSourceStateFile(state)
		return
	}
	source.LastError = ""
	source.LastResult = truncateForState(result, sourceMaxResultLen)
	if cursor = truncateForState(cursor, sourceMaxCursorLen); cursor != "" {
		source.Cursor = cursor
	}
	state.Sources[id] = source
	_ = writeSourceStateFile(state)
}
