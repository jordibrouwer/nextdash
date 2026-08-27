package app

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
The whole data directory, not a hand-picked half of it.

Files were left out one at a time, each for a reason that held on its own: a
trend re-records daily, a feed re-polls, a cache regenerates. Together they made
a restore an install that had lost its history and had to earn it back over
weeks — health-trend needs three days before its chart appears at all.
*/
func TestBackupCarriesTheRestOfTheDataDirectory(t *testing.T) {
	// newTestHandlers sets its own data directory, so the files have to be
	// written into that one -- writing them first put them somewhere the backup
	// never looked.
	h := newTestHandlers(t)
	dir := ResolveDataDir()

	// One of each, with contents that can be told apart afterwards.
	written := map[string]string{
		"health-trend.json":       `{"points":[{"t":1,"n":40}]}`,
		"feeds.json":              `{"feeds":{}}`,
		"inbox-stats.json":        `{"version":1,"totalAdded":7}`,
		"site-news.json":          `{"posts":[]}`,
		"push-subscriptions.json": `[]`,
		"sources.json":            `{"sources":{"github:stars":{"kind":"github-stars","token":"tok"}}}`,
		"health-credentials.json": `{"credentials":{"sonarr":{"label":"Sonarr"}}}`,
	}
	for name, body := range written {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	// A capture, which is the one thing here that cannot be fetched again.
	if err := os.MkdirAll(filepath.Join(dir, archiveDirName), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, archiveDirName, "example-com-2026.html"),
		[]byte("<html>a page as it was</html>"), 0644); err != nil {
		t.Fatal(err)
	}
	// And an auto-backup, which must not end up inside a backup.
	if err := os.MkdirAll(filepath.Join(dir, autoBackupDirName), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, autoBackupDirName, "old.zip"), []byte("PK"), 0644); err != nil {
		t.Fatal(err)
	}

	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	inZip := map[string]bool{}
	for _, f := range reader.File {
		inZip[f.Name] = true
	}

	for name := range written {
		if !inZip[name] {
			t.Errorf("%s was left out of the backup", name)
		}
	}
	if !inZip[archiveDirName+"/example-com-2026.html"] {
		t.Error("the local capture was left out")
	}
	// A backup inside a backup doubles on every round.
	for name := range inZip {
		if strings.HasPrefix(name, autoBackupDirName+"/") {
			t.Errorf("the auto-backup store went into the backup: %s", name)
		}
	}
}

/*
A restore puts the tighter permissions back.

sources.json and health-credentials.json are 0600 on disk so the account next
door cannot read a token. A ZIP carries no permissions, so a restore that wrote
everything 0644 would put the file back and leave the protection behind.
*/
func TestRestoredCredentialFilesKeepTheirPermissions(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	prepared := []preparedImportFile{
		{relPath: "settings.json", content: []byte(`{}`)},
		{relPath: "sources.json", content: []byte(`{"sources":{}}`)},
		{relPath: "health-credentials.json", content: []byte(`{"credentials":{}}`)},
	}
	if err := writePreparedImportStaging(dir, prepared); err != nil {
		t.Fatal(err)
	}

	for name, want := range map[string]os.FileMode{
		"settings.json":           0644,
		"sources.json":            0600,
		"health-credentials.json": 0600,
	} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != want {
			t.Errorf("%s is %o, want %o", name, got, want)
		}
	}
}

/*
An older ZIP must not delete what it never knew about.

removeImportOrphans deletes the files it manages when the archive omits them,
which is right for a file the archive replaces and wrong for one written before
the feature existed: a backup made yesterday would take today's trend history,
tokens and credentials with it.
*/
func TestAnOlderBackupDoesNotDeleteTheNewFiles(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)

	keep := []string{"health-trend.json", "sources.json", "health-credentials.json",
		"feeds.json", "inbox-stats.json", "site-news.json", "push-subscriptions.json"}
	for _, name := range keep {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(`{"kept":true}`), 0600); err != nil {
			t.Fatal(err)
		}
	}

	// An import carrying only what an old archive held.
	prepared := []preparedImportFile{{relPath: "settings.json", content: []byte(`{}`)}}
	if err := removeImportOrphans(dir, prepared); err != nil {
		t.Fatal(err)
	}

	for _, name := range keep {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s was deleted by an import that never mentioned it", name)
		}
	}
}

/*
Leaving things out is a choice, and it is spelled to survive an upgrade.

Both settings are "exclude" rather than "include" so that a settings file
written before they existed — where an absent boolean reads as false — keeps
making the fuller backup it already made.
*/
func TestBackupHonoursWhatTheInstallChoseToLeaveOut(t *testing.T) {
	h := newTestHandlers(t)
	dir := ResolveDataDir()

	if err := os.WriteFile(filepath.Join(dir, "sources.json"), []byte(`{"sources":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "health-credentials.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "health-trend.json"), []byte(`{"points":[]}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, archiveDirName), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, archiveDirName, "page.html"), []byte("<html></html>"), 0644); err != nil {
		t.Fatal(err)
	}

	contents := func() map[string]bool {
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

	// Nothing said: the fuller backup, which is what an install that never saw
	// these settings already made.
	full := contents()
	for _, name := range []string{"sources.json", "health-credentials.json",
		"health-trend.json", archiveDirName + "/page.html"} {
		if !full[name] {
			t.Errorf("default backup left out %s", name)
		}
	}

	settings := h.store.GetSettings()
	settings.BackupExcludeArchives = true
	settings.BackupExcludeSecrets = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	trimmed := contents()
	for _, name := range []string{"sources.json", "health-credentials.json", archiveDirName + "/page.html"} {
		if trimmed[name] {
			t.Errorf("%s was carried after being switched off", name)
		}
	}
	// Switching off the credentials must not take the data with it.
	if !trimmed["health-trend.json"] {
		t.Error("ordinary data was dropped along with the excluded files")
	}
	if !trimmed["settings.json"] {
		t.Error("settings.json was dropped")
	}
}

/*
A backup that omits archives must still be able to restore one.

The filtering is in the backup writer and not in isValidImportFilename, which
both paths consult: refusing them on the way in would mean a ZIP made before the
setting existed could no longer restore what it contains.
*/
func TestExcludingArchivesDoesNotRefuseThemOnImport(t *testing.T) {
	h := newTestHandlers(t)
	settings := h.store.GetSettings()
	settings.BackupExcludeArchives = true
	settings.BackupExcludeSecrets = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{archiveDirName + "/page.html", "sources.json", "health-credentials.json"} {
		if !h.isValidImportFilename(name) {
			t.Errorf("%s would be refused on import", name)
		}
	}
}
