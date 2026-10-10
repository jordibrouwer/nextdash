package app

import (
	"os"
	"regexp"
	"testing"
)

func TestNewStatusTokenShape(t *testing.T) {
	tok, err := newStatusToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(tok) < statusTokenMinLen || !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(tok) {
		t.Fatalf("token %q is not ≥32 URL-safe chars", tok)
	}
	other, _ := newStatusToken()
	if other == tok {
		t.Fatal("two tokens are the same")
	}
}

func TestStatusTokenEnsureRotateAndMatch(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if statusTokenMatches("") || statusTokenMatches("anything-at-all-anything-at-all-xx") {
		t.Fatal("no token on disk must match nothing")
	}
	first, err := ensureStatusToken()
	if err != nil {
		t.Fatal(err)
	}
	again, _ := ensureStatusToken()
	if again != first {
		t.Fatal("ensure must keep an existing token")
	}
	if !statusTokenMatches(first) {
		t.Fatal("the saved token must match")
	}
	if statusTokenMatches(first[:len(first)-1]) {
		t.Fatal("a prefix must not match")
	}
	second, err := rotateStatusToken()
	if err != nil {
		t.Fatal(err)
	}
	if second == first || statusTokenMatches(first) || !statusTokenMatches(second) {
		t.Fatal("rotation must stop the old link at once")
	}
	info, err := os.Stat(statusSecretsFilePath())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o077 != 0 {
		t.Fatalf("secrets file is readable by others: %v", info.Mode().Perm())
	}
}

func TestStatusTokenRejectsShortStoredToken(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.WriteFile(statusSecretsFilePath(), []byte(`{"token":"short"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if statusTokenMatches("short") {
		t.Fatal("a hand-edited short token must not open the page")
	}
}
