package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// repoFile resolves a path stated relative to the repository root.
//
// A handful of tests read the shipped assets themselves — the theme loader, the
// what's-new index, the config module — to check that the server's idea of a
// default matches the one the browser will see. Those files live beside go.mod,
// but `go test` runs with the package directory as the working directory, which
// is two levels down. Spelling "../../static/..." at every call site works right
// up until the package moves again; asking for the root once does not.
func repoFile(t *testing.T, rel ...string) string {
	t.Helper()
	return filepath.Join(append([]string{repoRoot(t)}, rel...)...)
}

// installTestAssetFS points the package's asset set at the real static/,
// templates/ and locales/ directories on disk.
//
// In production Run receives the embed.FS the root package declares, and it is
// never empty. Under `go test` nothing calls Run, so without this the variable
// would sit at nil and every embed-backed read — the what's-new index, the push
// service worker, template parsing — would fail in a way that never happens to
// a running server. Reading the same trees from disk gives tests the asset set
// the binary ships.
//
// Called from TestMain, before any test runs.
func installTestAssetFS() {
	root, err := findRepoRoot()
	if err != nil {
		panic("could not locate the repository root for the test asset set: " + err.Error())
	}
	fsys, ok := os.DirFS(root).(assetFS)
	if !ok {
		panic("os.DirFS no longer satisfies assetFS")
	}
	embeddedFiles = fsys
}

// repoRoot returns the directory holding go.mod, failing the test if there is
// none above the working directory.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := findRepoRoot()
	if err != nil {
		t.Fatalf("%v", err)
	}
	return dir
}

// findRepoRoot walks up from the working directory to the one holding go.mod.
func findRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("working directory: %w", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no go.mod above %s — cannot locate the repository root", dir)
		}
		dir = parent
	}
}
