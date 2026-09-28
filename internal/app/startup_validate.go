package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func validateListenPort(raw string) (string, error) {
	port := strings.TrimSpace(raw)
	if port == "" {
		return "8080", nil
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return "", fmt.Errorf("invalid PORT %q: must be a number between 1 and 65535", port)
	}
	return strconv.Itoa(n), nil
}

func validateDataDirAtStartup() error {
	dir, err := filepath.Abs(ResolveDataDir())
	if err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: invalid path: %w", err)
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: cannot create %s: %w", dir, err)
	}
	probe := filepath.Join(dir, ".nextdash-write-test")
	if err := os.WriteFile(probe, []byte("ok"), 0600); err != nil {
		return fmt.Errorf("NEXTDASH_DATA_DIR: %s is not writable: %w", dir, err)
	}
	_ = os.Remove(probe)
	return nil
}

// minTokenLength is where a token stops being guessable by hand. Well short of
// what `openssl rand -hex 32` gives, so it only catches the obvious ones.
const minTokenLength = 16

// placeholderTokens are the example values from the compose files and the
// docs. Copied as they stand, they are a token everyone who read the README
// already knows.
var placeholderTokens = []string{
	"change-me",
	"change-me-to-a-long-random-string",
	"a-second-long-random-string",
}

/*
weakTokenReason says why a token is not worth having, or "" when it is.

A warning, not a refusal: an install that starts with a weak token is still
better off than one that will not start at all, and refusing would turn a
docs example into an outage on upgrade.
*/
func weakTokenReason(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	for _, placeholder := range placeholderTokens {
		if strings.EqualFold(token, placeholder) {
			return "it is the example value from the docs"
		}
	}
	if len(token) < minTokenLength {
		return fmt.Sprintf("it is shorter than %d characters", minTokenLength)
	}
	return ""
}

// warnAboutWeakTokens logs, once at startup, each token that is set but weak.
func warnAboutWeakTokens() {
	for _, name := range []string{"NEXTDASH_WRITE_TOKEN", "NEXTDASH_CAPTURE_TOKEN"} {
		if reason := weakTokenReason(os.Getenv(name)); reason != "" {
			logWarn(logComponentAuth, "%s is weak: %s; use a long random string, such as the output of `openssl rand -hex 32`", name, reason)
		}
	}
}
