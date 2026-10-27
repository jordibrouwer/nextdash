package app

import (
	"os"
	"path/filepath"
	"testing"
)

// With analytics off the install code is not worked out and the file it comes
// from is not created: someone who opted out must not gain an identity file for
// a feature they never switched on.
func TestAnalyticsInstallRefNotCollectedWhenDisabled(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	if got := analyticsInstallRef(false); got != "" {
		t.Fatalf("install ref with analytics off = %q, want empty", got)
	}
	if got := analyticsDistribution(false); got != "" {
		t.Fatalf("distribution with analytics off = %q, want empty", got)
	}
	if _, err := os.Stat(filepath.Join(dir, installIDFile)); !os.IsNotExist(err) {
		t.Fatalf("install-id was created while analytics is off (err=%v)", err)
	}
}

// The code is stable for an install, differs from the install count's own id,
// and changes with the file.
func TestAnalyticsInstallRefIsDerivedAndStable(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	first := analyticsInstallRef(true)
	if len(first) != 16 {
		t.Fatalf("install ref = %q, want 16 hex characters", first)
	}
	if again := analyticsInstallRef(true); again != first {
		t.Fatalf("install ref changed between calls: %q then %q", first, again)
	}
	raw, err := os.ReadFile(filepath.Join(dir, installIDFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) == first || len(first) >= len(raw) {
		t.Fatalf("install ref must not be the install count's id")
	}

	if err := os.Remove(filepath.Join(dir, installIDFile)); err != nil {
		t.Fatal(err)
	}
	if renewed := analyticsInstallRef(true); renewed == first {
		t.Fatalf("deleting install-id must give a new code")
	}
}
