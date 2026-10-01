package app

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

/*
Every file the server writes into the data directory has a decided place in a
backup.

The backup lists were kept by hand, and a feature that added a file had to
remember four of them. The Containers view added four files and none made it:
the update choices and the GitHub token were simply not in any backup. This
reads the sources for the paths the server joins onto the data directory and
fails for any name the register does not know, so the next one is a decision
rather than an omission.
*/
func TestEveryDataFileHasABackupPolicy(t *testing.T) {
	sources, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	joined := regexp.MustCompile(`Join\(([^,()]+(?:\(\))?),\s*"([^"/]+\.(?:json|jsonl|log))"\)|"%s/([^"%]+\.(?:json|log))"`)

	seen := 0
	for _, path := range sources {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range joined.FindAllStringSubmatch(string(src), -1) {
			base, name := m[1], m[2]
			if name == "" {
				name = m[3]
			}
			// Inside auto-backups/, which is never carried as a whole.
			if base == "autoBackupDir()" {
				continue
			}
			// Pages are matched by pattern, not by name.
			if _, ok := parseBookmarkPageIDFromFilename(name); ok {
				continue
			}
			seen++
			if _, ok := dataFiles[name]; !ok {
				t.Errorf("%s (in %s) is written to the data directory but has no entry in dataFiles", name, path)
			}
		}
	}
	// The scan itself must find something, or a changed idiom passes silently.
	if seen < 20 {
		t.Fatalf("the scan found only %d data files; the pattern no longer matches how paths are built", seen)
	}
}

func backupZipNames(t *testing.T, h *Handlers) map[string]bool {
	t.Helper()
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	return names
}

/*
The Containers view's own state travels with the rest.

docker-updates.json holds which images were held or had an update skipped;
docker-secrets.json holds the GitHub token the changelogs are fetched with, and
is a credential like sources.json, so it follows the same switch.
*/
func TestBackupCarriesTheContainerChoicesAndToken(t *testing.T) {
	h := newTestHandlers(t)
	dir := ResolveDataDir()

	for name, body := range map[string]string{
		"docker-updates.json": `{"checkedAt":1,"images":{},"held":{"nginx:latest":true}}`,
		"docker-secrets.json": `{"githubToken":"ghp_x"}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}

	full := backupZipNames(t, h)
	for _, name := range []string{"docker-updates.json", "docker-secrets.json"} {
		if !full[name] {
			t.Errorf("%s was left out of the backup", name)
		}
		if !h.isValidImportFilename(name) {
			t.Errorf("%s would be refused on import", name)
		}
	}

	settings := h.store.GetSettings()
	settings.BackupExcludeSecrets = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	trimmed := backupZipNames(t, h)
	if trimmed["docker-secrets.json"] {
		t.Error("docker-secrets.json was carried with credentials switched off")
	}
	if !trimmed["docker-updates.json"] {
		t.Error("docker-updates.json was dropped along with the credentials")
	}
}

/*
What is decided to stay out, stays out.

Each is either rebuilt on its own (caches, sizes) or belongs to this host (a
container timeline, rollbacks that name local image ids, the server's logs).
*/
func TestBackupLeavesOutHostBoundAndRebuiltFiles(t *testing.T) {
	h := newTestHandlers(t)
	dir := ResolveDataDir()

	never := []string{"docker-events.json", "docker-update-history.json", "docker-bind-sizes.json",
		"activity.log", "server.log", "preview-cache.json", "health-cache.json"}
	for _, name := range never {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(`{}`), 0644); err != nil {
			t.Fatal(err)
		}
	}

	names := backupZipNames(t, h)
	for _, name := range never {
		if names[name] {
			t.Errorf("%s went into the backup", name)
		}
	}
}

func TestRestoredDockerTokenIsPrivate(t *testing.T) {
	dir := t.TempDir()
	prepared := []preparedImportFile{{relPath: "docker-secrets.json", content: []byte(`{}`)}}
	if err := writePreparedImportStaging(dir, prepared); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, "docker-secrets.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Errorf("docker-secrets.json is %o, want 600", got)
	}
}

// A backup made before the Containers view existed must not take its state.
func TestAnOlderBackupKeepsTheContainerState(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"docker-updates.json", "docker-secrets.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(`{}`), 0600); err != nil {
			t.Fatal(err)
		}
	}
	prepared := []preparedImportFile{{relPath: "settings.json", content: []byte(`{}`)}}
	if err := removeImportOrphans(dir, prepared); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"docker-updates.json", "docker-secrets.json"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was deleted by an import that never mentioned it", name)
		}
	}
}
