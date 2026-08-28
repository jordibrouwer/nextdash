package app

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// captureLog redirects the standard logger for one test and hands back what was
// written. Flags are cleared too, so an assertion can name the whole line
// rather than working around a timestamp that changes every run.
func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	previousOut := log.Writer()
	previousFlags := log.Flags()
	log.SetOutput(&buf)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(previousOut)
		log.SetFlags(previousFlags)
	})
	return &buf
}

// setLogLevelForTest sets the floor and puts it back afterwards, so one test
// cannot silence the next.
func setLogLevelForTest(t *testing.T, level string) {
	t.Helper()
	previous := currentLogLevel()
	setLogLevel(level)
	t.Cleanup(func() { setLogLevel(previous) })
}

// A line carries its level and its component, in the shape the buffer parses.
func TestLogLineCarriesLevelAndComponent(t *testing.T) {
	buf := captureLog(t)
	setLogLevelForTest(t, logLevelInfoName)

	logWarn(logComponentArchive, "%s refused the request (403)", "dash.example")

	got := strings.TrimSpace(buf.String())
	want := "WARN archive dash.example refused the request (403)"
	if got != want {
		t.Fatalf("line = %q, want %q", got, want)
	}
}

// Below the floor is not written at all, so what is switched off costs nothing.
func TestLogLevelFloorSilencesLowerLevels(t *testing.T) {
	buf := captureLog(t)
	setLogLevelForTest(t, logLevelWarnName)

	logInfo(logComponentHealth, "checked 110 bookmarks")
	logDebug(logComponentFeeds, "asked example.com")
	logWarn(logComponentHealth, "2 checks failed")

	out := buf.String()
	if strings.Contains(out, "checked 110") || strings.Contains(out, "asked example.com") {
		t.Fatalf("lines below the floor were written: %q", out)
	}
	if !strings.Contains(out, "WARN health 2 checks failed") {
		t.Fatalf("the warning was not written: %q", out)
	}
}

// An unknown level name leaves the floor where it was rather than opening it.
func TestSetLogLevelRefusesNonsense(t *testing.T) {
	setLogLevelForTest(t, logLevelWarnName)
	setLogLevel("shout")
	if got := currentLogLevel(); got != logLevelWarnName {
		t.Fatalf("level = %q, want it unchanged at %q", got, logLevelWarnName)
	}
}

/*
One way to write a log line.

A component spelled two ways is two components to anyone reading the log, and a
line without a level is one the viewer has to guess about — which is the guessing
this whole layer exists to end. logx.go is the one place allowed to reach for the
standard logger.
*/
func TestNoDirectPrintfOutsideLogx(t *testing.T) {
	matches, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	for _, file := range matches {
		if file == "logx.go" || strings.HasSuffix(file, "_test.go") {
			continue
		}
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		if bytes.Contains(source, []byte("log.Printf(")) {
			t.Errorf("%s still calls log.Printf directly; use logInfo/logWarn/logError/logDebug", file)
		}
	}
}
