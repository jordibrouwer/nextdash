package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// withFakeMonolith stands in for the binary with a script this test controls.
func withFakeMonolith(t *testing.T, script string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "monolith")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0755); err != nil {
		t.Fatalf("write stub: %v", err)
	}
	original := monolithLookup
	monolithLookup = func() (string, error) { return path, nil }
	t.Cleanup(func() { monolithLookup = original })
}

func withNoMonolith(t *testing.T) {
	t.Helper()
	original := monolithLookup
	monolithLookup = func() (string, error) { return "", errors.New("not found") }
	t.Cleanup(func() { monolithLookup = original })
}

// The capture lands in the data directory, so backing up data/ backs up the
// archive with it.
func TestCaptureLocallyStoresTheFile(t *testing.T) {
	h := newTestHandlers(t)
	// $2 is the -o path: write something recognisable there.
	withFakeMonolith(t, `echo "<html>captured</html>" > "$2"`)

	capture, err := h.CaptureLocally(context.Background(), "https://example.com/page")
	if err != nil {
		t.Fatalf("capture: %v", err)
	}
	if capture.Bytes == 0 {
		t.Error("stored an empty capture")
	}
	if !strings.HasPrefix(capture.Path, localArchiveDir()) {
		t.Errorf("stored at %q, want it inside %q", capture.Path, localArchiveDir())
	}
	body, err := os.ReadFile(capture.Path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !strings.Contains(string(body), "captured") {
		t.Errorf("file holds %q", string(body))
	}
	// Behind the write token, not under /data/, which is served unauthenticated.
	if !strings.HasPrefix(capture.URL, "/api/archives/") {
		t.Errorf("url = %q, want it behind the API", capture.URL)
	}
}

/*
A failed run leaves nothing behind.

monolith writes as it goes, so a run that dies halfway leaves a partial file --
and a partial file that stays is indistinguishable from a stored page until
somebody opens it, years later, looking for something that is not there.
*/
func TestCaptureLocallyRemovesAPartialFile(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `echo "half a pa" > "$2"; exit 3`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err == nil {
		t.Fatal("a failing run reported success")
	}
	entries, err := os.ReadDir(localArchiveDir())
	if err == nil && len(entries) > 0 {
		t.Errorf("left %d file(s) behind after a failed run", len(entries))
	}
}

// An empty file is not a capture either.
func TestCaptureLocallyRejectsAnEmptyFile(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `: > "$2"`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err == nil {
		t.Error("stored an empty file as a capture")
	}
}

// Not installed is a setup problem, told apart so the caller can say so.
func TestCaptureLocallyReportsAMissingBinary(t *testing.T) {
	h := newTestHandlers(t)
	withNoMonolith(t)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); !errors.Is(err, errMonolithMissing) {
		t.Errorf("err = %v, want errMonolithMissing", err)
	}
	if MonolithAvailable() {
		t.Error("MonolithAvailable is true with no binary")
	}
}

/*
The URL never becomes part of the path.

The filename comes from the canonical key with everything unusual replaced, so
an address carrying slashes, dots or a traversal cannot decide where the file
lands.
*/
func TestLocalArchiveNameCannotEscapeTheDirectory(t *testing.T) {
	at := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	for _, target := range []string{
		"https://example.com/../../etc/passwd",
		"https://example.com/a/b/c?q=../..",
		"https://example.com/",
	} {
		name := localArchiveName(target, at)
		if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
			t.Errorf("localArchiveName(%q) = %q, which is not a bare filename", target, name)
		}
		if filepath.Base(name) != name {
			t.Errorf("localArchiveName(%q) = %q, which is a path", target, name)
		}
	}
}

// Two captures of the same page are two files: the point of a local archive is
// having the version you saved.
func TestLocalArchiveNameKeepsSuccessiveCaptures(t *testing.T) {
	first := localArchiveName("https://example.com/x", time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC))
	second := localArchiveName("https://example.com/x", time.Date(2026, 3, 2, 12, 0, 0, 0, time.UTC))
	if first == second {
		t.Errorf("both captures named %q; the first would be overwritten", first)
	}
}

// A page that never finishes must not hold the capture open for ever.
func TestCaptureLocallyTimesOut(t *testing.T) {
	h := newTestHandlers(t)
	withFakeMonolith(t, `sleep 30`)

	ctx, cancel := context.WithTimeout(context.Background(), 700*time.Millisecond)
	defer cancel()

	started := time.Now()
	_, err := h.CaptureLocally(ctx, "https://example.com/slow")
	if err == nil {
		t.Fatal("a hanging run reported success")
	}
	if elapsed := time.Since(started); elapsed > 10*time.Second {
		t.Errorf("waited %s on a hanging run", elapsed)
	}
}

/*
The arguments are the ones monolith actually takes.

The first version passed -s, which monolith 2.10 does not have: every capture
died in the argument parser, and the stub in these tests accepted anything, so
nothing here noticed. This asserts the flags rather than the behaviour, which is
usually the wrong test to write -- but the flags are an interface with a program
outside this repo, and getting them wrong fails every capture at once.
*/
func TestCaptureLocallyPassesTheFlagsMonolithHas(t *testing.T) {
	h := newTestHandlers(t)
	argsFile := filepath.Join(t.TempDir(), "args.txt")
	// Record what it was called with, then write the output file so the run
	// succeeds and the rest of the path is exercised too.
	withFakeMonolith(t, `echo "$@" > `+argsFile+`
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then echo "<html>ok</html>" > "$2"; fi
  shift
done`)

	if _, err := h.CaptureLocally(context.Background(), "https://example.com/page"); err != nil {
		t.Fatalf("capture: %v", err)
	}

	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read args: %v", err)
	}
	args := string(raw)

	// -q quiet, -I isolate (the saved page must not reach the network when it
	// is opened years later), -t a per-request timeout.
	for _, want := range []string{"-o", "-q", "-I", "-t", "https://example.com/page"} {
		if !strings.Contains(args, want) {
			t.Errorf("monolith called without %q; got: %s", want, args)
		}
	}
	// -s was the flag that did not exist. Its absence is the regression.
	if strings.Contains(args, " -s") {
		t.Errorf("passed -s, which monolith 2.10 refuses: %s", args)
	}
	// Stripping content would archive something the reader never saw.
	for _, unwanted := range []string{"-j", "-i", "--no-js", "--no-images"} {
		if strings.Contains(args, " "+unwanted) {
			t.Errorf("passed %q, which saves less than the page: %s", unwanted, args)
		}
	}
}
