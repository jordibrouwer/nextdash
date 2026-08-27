package app

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

// withSourceDir points the register at a throwaway data directory.
func withSourceDir(t *testing.T) {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
}

// The whole reason the API answers with hasToken: a saved token must survive a
// form that submits every other field back without it. If "" cleared the token,
// changing a category would sign the reader out of their own source.
func TestSaveSourceKeepsTokenWhenBlank(t *testing.T) {
	withSourceDir(t)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_first", Enabled: true}); err != nil {
		t.Fatalf("first save: %v", err)
	}
	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", TargetCategory: "code", Enabled: true}); err != nil {
		t.Fatalf("second save: %v", err)
	}

	got, ok := GetSource("github:stars")
	if !ok {
		t.Fatal("source disappeared")
	}
	if got.Token != "ghp_first" {
		t.Errorf("token = %q, want it kept", got.Token)
	}
	if got.TargetCategory != "code" {
		t.Errorf("category = %q, want code", got.TargetCategory)
	}
}

// A different token may be a different account, and resuming that account's
// import from this one's position would skip everything older than the cursor.
func TestSaveSourceResetsCursorOnNewToken(t *testing.T) {
	withSourceDir(t)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_first"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	RecordSourceRun("github:stars", "cursor-position", "3 new", nil)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_second"}); err != nil {
		t.Fatalf("resave: %v", err)
	}
	got, _ := GetSource("github:stars")
	if got.Cursor != "" {
		t.Errorf("cursor = %q, want cleared for a new token", got.Cursor)
	}

	// The same token again is not a new account, so the position stays.
	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_second"}); err != nil {
		t.Fatalf("resave same: %v", err)
	}
	RecordSourceRun("github:stars", "second-position", "1 new", nil)
	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_second"}); err != nil {
		t.Fatalf("resave same again: %v", err)
	}
	if got, _ = GetSource("github:stars"); got.Cursor != "second-position" {
		t.Errorf("cursor = %q, want kept for an unchanged token", got.Cursor)
	}
}

// A failed round imported nothing, so moving the position would skip whatever it
// failed to read — and a stale "34 new" beside an error reads as harmless.
func TestRecordSourceRunFailureKeepsCursorAndClearsResult(t *testing.T) {
	withSourceDir(t)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_x"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	RecordSourceRun("github:stars", "good-position", "34 new, 0 changed", nil)
	RecordSourceRun("github:stars", "should-be-ignored", "", errors.New("401 Unauthorized"))

	got, _ := GetSource("github:stars")
	if got.Cursor != "good-position" {
		t.Errorf("cursor = %q, want the position from the last good round", got.Cursor)
	}
	if got.LastResult != "" {
		t.Errorf("lastResult = %q, want cleared beside an error", got.LastResult)
	}
	if got.LastError != "401 Unauthorized" {
		t.Errorf("lastError = %q", got.LastError)
	}
	if got.LastRun == 0 {
		t.Error("lastRun not stamped")
	}
}

// The status shape is the only thing the API hands out, so the token must not be
// reachable through it.
func TestSourceStatusNeverCarriesTheToken(t *testing.T) {
	withSourceDir(t)

	status, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_secret", Enabled: true})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if !status.HasToken {
		t.Error("hasToken = false for a source that has one")
	}

	for _, s := range ListSources() {
		if s.ID != "github:stars" {
			continue
		}
		if !s.HasToken {
			t.Error("listed source lost hasToken")
		}
	}
	// The struct has no token field at all, which is what makes this true by
	// construction rather than by remembering to strip it.
	if got := marshalStatus(t, status); strings.Contains(got, "ghp_secret") {
		t.Errorf("status JSON leaked the token: %s", got)
	}
}

// A credential that is gone must not leave a position behind for the next token
// to resume from.
func TestClearSourceTokenDropsCursorAndDisables(t *testing.T) {
	withSourceDir(t)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_x", Enabled: true}); err != nil {
		t.Fatalf("save: %v", err)
	}
	RecordSourceRun("github:stars", "somewhere", "3 new", nil)
	if err := ClearSourceToken("github:stars"); err != nil {
		t.Fatalf("clear: %v", err)
	}

	got, _ := GetSource("github:stars")
	if got.Token != "" || got.Cursor != "" || got.Enabled {
		t.Errorf("after clear: token=%q cursor=%q enabled=%v", got.Token, got.Cursor, got.Enabled)
	}
}

// The file holds a personal access token; on a shared host 0644 means every
// account on the machine can read it.
func TestSourceFileIsNotWorldReadable(t *testing.T) {
	withSourceDir(t)

	if _, err := SaveSource("github:stars", SourceState{Kind: "github-stars", Token: "ghp_x"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat(sourceStateFilePath())
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("mode = %04o, want 0600", perm)
	}
}

// An id becomes a map key and a URL segment; a path separator in one would let a
// caller name a file instead of a source.
func TestNormalizeSourceIDRefusesPathish(t *testing.T) {
	for _, bad := range []string{"", "  ", "a/b", `a\b`, "../x", "a.b", "a\x00b"} {
		if got := normalizeSourceID(bad); got != "" {
			t.Errorf("normalizeSourceID(%q) = %q, want refused", bad, got)
		}
	}
	if got := normalizeSourceID(" github:stars "); got != "github:stars" {
		t.Errorf("normalizeSourceID trimmed to %q", got)
	}
	if _, err := SaveSource("a/b", SourceState{Kind: "x"}); !errors.Is(err, errInvalidSourceID) {
		t.Errorf("SaveSource with a path-ish id: %v", err)
	}
}

func marshalStatus(t *testing.T, status SourceStatus) string {
	t.Helper()
	data, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(data)
}
