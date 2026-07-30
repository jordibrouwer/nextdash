package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// autoBackupDirName is the subdirectory under the data dir where automatic
	// backups are kept. It is excluded from regular backups (no backup-in-backup).
	autoBackupDirName = "auto-backups"
	// autoBackupPrefix + a sortable UTC timestamp + ".zip" forms each filename.
	autoBackupPrefix = "nextdash-auto-backup-"
	// maxAutoBackups is the rotation limit: the oldest is pruned beyond this.
	maxAutoBackups = 3
	// autoBackupInterval is the minimum age of the newest backup before a new one is made.
	autoBackupInterval = 7 * 24 * time.Hour
	// autoBackupCheckInterval is how often the scheduler re-checks whether a backup is due.
	// A short-ish cadence keeps "weekly" robust across container restarts.
	autoBackupCheckInterval = 6 * time.Hour
	// autoBackupTimeLayout is the sortable, filesystem-safe timestamp used in filenames.
	autoBackupTimeLayout = "2006-01-02T150405Z"
)

// autoBackupNameRe matches valid automatic-backup filenames (prefix + timestamp,
// with an optional "-N" disambiguator when several are made in the same second,
// + .zip). Used to validate download/delete requests and to filter the listing.
var autoBackupNameRe = regexp.MustCompile(`^nextdash-auto-backup-\d{4}-\d{2}-\d{2}T\d{6}Z(-\d+)?\.zip$`)

// uniqueAutoBackupName returns a filename that does not yet exist in dir. The
// timestamp has second resolution, so two backups made within the same second
// get a "-2", "-3", … suffix instead of silently overwriting each other.
func uniqueAutoBackupName(dir string) string {
	stamp := autoBackupPrefix + time.Now().UTC().Format(autoBackupTimeLayout)
	name := stamp + ".zip"
	for i := 2; ; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name
		}
		name = fmt.Sprintf("%s-%d.zip", stamp, i)
	}
}

// autoBackupDir returns the directory holding automatic backups.
func autoBackupDir() string {
	return filepath.Join(ResolveDataDir(), autoBackupDirName)
}

// autoBackupInfo describes one stored automatic backup for the API.
type autoBackupInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"` // RFC3339, derived from mod time
}

// autoBackupListResponse is the payload for GET /api/auto-backups.
type autoBackupListResponse struct {
	Enabled bool             `json:"enabled"`
	Backups []autoBackupInfo `json:"backups"`
	// NextBackupAt is when the next automatic backup is due (RFC3339), or empty
	// when automatic backups are disabled. When it's in the past, one is due now.
	NextBackupAt string `json:"nextBackupAt,omitempty"`
}

// nextAutoBackupTime returns when the next automatic backup is due: the newest
// backup's time plus the interval, or now when none exists yet.
func nextAutoBackupTime() time.Time {
	newest, ok := newestAutoBackupModTime()
	if !ok {
		return time.Now()
	}
	return newest.Add(autoBackupInterval)
}

// listAutoBackupFiles returns the valid auto-backup filenames sorted newest-first.
func listAutoBackupFiles() ([]string, error) {
	entries, err := os.ReadDir(autoBackupDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if autoBackupNameRe.MatchString(entry.Name()) {
			names = append(names, entry.Name())
		}
	}
	// Timestamp in the name is sortable, so reverse-lexicographic = newest first.
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	return names, nil
}

// writeAutoBackup builds a fresh backup ZIP, writes it atomically into the
// auto-backup directory, and prunes the oldest beyond maxAutoBackups.
func (h *Handlers) writeAutoBackup() error {
	h.autoBackupMu.Lock()
	defer h.autoBackupMu.Unlock()

	data, err := h.buildBackupZip()
	if err != nil {
		return err
	}

	dir := autoBackupDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	if err := writeFileAtomic(filepath.Join(dir, uniqueAutoBackupName(dir)), data, 0644); err != nil {
		return err
	}

	return pruneAutoBackups()
}

// pruneAutoBackups deletes the oldest auto-backups until at most maxAutoBackups remain.
func pruneAutoBackups() error {
	names, err := listAutoBackupFiles()
	if err != nil {
		return err
	}
	// names is newest-first; anything past the limit is oldest and gets removed.
	for _, name := range names[min(len(names), maxAutoBackups):] {
		if err := os.Remove(filepath.Join(autoBackupDir(), name)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// newestAutoBackupModTime returns the most recent auto-backup mod time, and false if none exist.
func newestAutoBackupModTime() (time.Time, bool) {
	names, err := listAutoBackupFiles()
	if err != nil || len(names) == 0 {
		return time.Time{}, false
	}
	var newest time.Time
	found := false
	for _, name := range names {
		info, err := os.Stat(filepath.Join(autoBackupDir(), name))
		if err != nil {
			continue
		}
		if !found || info.ModTime().After(newest) {
			newest = info.ModTime()
			found = true
		}
	}
	return newest, found
}

// autoBackupDue reports whether a new automatic backup should be created now:
// when none exists yet or the newest is older than autoBackupInterval.
func autoBackupDue() bool {
	newest, ok := newestAutoBackupModTime()
	if !ok {
		return true
	}
	return time.Since(newest) >= autoBackupInterval
}

// StartAutoBackupScheduler runs a weekly backup loop until stop is closed.
// It respects the AutoBackupEnabled setting (checked before each run) and is
// robust across restarts by comparing the newest backup's age rather than
// relying on an in-process timer.
func (h *Handlers) StartAutoBackupScheduler(stop <-chan struct{}) {
	go func() {
		ticker := time.NewTicker(autoBackupCheckInterval)
		defer ticker.Stop()

		h.maybeRunAutoBackup()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				h.maybeRunAutoBackup()
			}
		}
	}()
}

// maybeRunAutoBackup creates a backup if the setting is enabled and one is due.
func (h *Handlers) maybeRunAutoBackup() {
	if !h.store.GetSettings().AutoBackupEnabled {
		return
	}
	if !autoBackupDue() {
		return
	}
	if err := h.writeAutoBackup(); err != nil {
		log.Printf("auto-backup: failed to create scheduled backup: %v", err)
		h.pushAutoBackupResult(context.Background(), err)
		return
	}
	log.Printf("auto-backup: created scheduled backup")
	h.pushAutoBackupResult(context.Background(), nil)
}

// ListAutoBackups returns the stored automatic backups as JSON, newest first,
// along with whether automatic backups are enabled and when the next one is due.
func (h *Handlers) ListAutoBackups(w http.ResponseWriter, r *http.Request) {
	names, err := listAutoBackupFiles()
	if err != nil {
		http.Error(w, "Failed to list backups", http.StatusInternalServerError)
		return
	}
	backups := make([]autoBackupInfo, 0, len(names))
	for _, name := range names {
		info, err := os.Stat(filepath.Join(autoBackupDir(), name))
		if err != nil {
			continue
		}
		backups = append(backups, autoBackupInfo{
			Name:      name,
			Size:      info.Size(),
			CreatedAt: info.ModTime().UTC().Format(time.RFC3339),
		})
	}

	resp := autoBackupListResponse{
		Enabled: h.store.GetSettings().AutoBackupEnabled,
		Backups: backups,
	}
	if resp.Enabled {
		resp.NextBackupAt = nextAutoBackupTime().UTC().Format(time.RFC3339)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// DownloadAutoBackup streams a stored automatic backup by name.
func (h *Handlers) DownloadAutoBackup(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	path, ok := resolveAutoBackupPath(name)
	if !ok {
		http.Error(w, "Invalid backup name", http.StatusBadRequest)
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		http.Error(w, "Backup not found", http.StatusNotFound)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "Failed to open backup", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename="+name)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	http.ServeContent(w, r, name, info.ModTime(), file)
}

// DeleteAutoBackup removes a stored automatic backup by name.
func (h *Handlers) DeleteAutoBackup(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	name := r.URL.Query().Get("name")
	path, ok := resolveAutoBackupPath(name)
	if !ok {
		http.Error(w, "Invalid backup name", http.StatusBadRequest)
		return
	}

	h.autoBackupMu.Lock()
	err := os.Remove(path)
	h.autoBackupMu.Unlock()

	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Backup not found", http.StatusNotFound)
			return
		}
		log.Printf("auto-backup: failed to delete %q: %v", name, err)
		http.Error(w, "Failed to delete backup", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "success"})
}

// resolveAutoBackupPath validates a request-supplied backup name and returns its
// on-disk path, or ok=false when the name is malformed (path traversal etc.).
func resolveAutoBackupPath(name string) (string, bool) {
	if name != filepath.Base(name) || !autoBackupNameRe.MatchString(name) {
		return "", false
	}
	return filepath.Join(autoBackupDir(), name), true
}

// commonZipPrefix returns the single top-level directory every entry in the
// archive sits under, as a "name/" prefix, or "" when the entries are already at
// the root or spread across several directories.
//
// "icons/" is deliberately not treated as a wrapper: it is a real part of the
// backup layout, and stripping it would flatten icons into the data directory.
func commonZipPrefix(files []*zip.File) string {
	prefix := ""
	for _, f := range files {
		name := normalizeImportFilename(f.Name)
		if name == "" {
			continue
		}
		idx := strings.Index(name, "/")
		if idx <= 0 {
			// An entry at the archive root means there is no single wrapper.
			return ""
		}
		top := name[:idx+1]
		if top == "icons/" {
			return ""
		}
		if prefix == "" {
			prefix = top
		} else if prefix != top {
			return ""
		}
	}
	return prefix
}

// stagedFilesFromZip unpacks a backup ZIP into staged import files, applying the
// same filename validation and JSON check as the upload import path.
func (h *Handlers) stagedFilesFromZip(data []byte) ([]stagedImportFile, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("could not read backup archive: %w", err)
	}
	// Unzipping a backup and zipping it up again — which the Finder and most
	// archive tools do by wrapping everything in a folder — puts every entry
	// behind a "backup-name/" prefix. Those names all fail validation, so the
	// restore used to reject a perfectly good archive as "No files provided".
	// Strip the prefix when the whole archive shares one.
	prefix := commonZipPrefix(zr.File)

	staged := make([]stagedImportFile, 0, len(zr.File))
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		filename := strings.TrimPrefix(normalizeImportFilename(f.Name), prefix)
		if !h.isValidImportFilename(filename) {
			// Skip unexpected entries rather than failing the whole restore.
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("could not read %s from backup: %w", filename, err)
		}
		content, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("could not read %s from backup: %w", filename, err)
		}
		if strings.HasSuffix(filename, ".json") && !json.Valid(content) {
			return nil, fmt.Errorf("invalid JSON in backup file: %s", filename)
		}
		staged = append(staged, stagedImportFile{filename: filename, content: content})
	}
	return staged, nil
}

// RestoreAutoBackup replaces all current data with the contents of a stored
// automatic backup, reusing the shared import pipeline.
func (h *Handlers) RestoreAutoBackup(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	name := r.URL.Query().Get("name")
	path, ok := resolveAutoBackupPath(name)
	if !ok {
		http.Error(w, "Invalid backup name", http.StatusBadRequest)
		return
	}

	// Serialize against writes/rotation so the archive can't be pruned mid-read.
	h.autoBackupMu.Lock()
	data, err := os.ReadFile(path)
	h.autoBackupMu.Unlock()
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "Backup not found", http.StatusNotFound)
			return
		}
		log.Printf("auto-backup: restore read %q failed: %v", name, err)
		http.Error(w, "Failed to read backup", http.StatusInternalServerError)
		return
	}

	staged, err := h.stagedFilesFromZip(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	dataDir := ResolveDataDir()
	skipped, impErr := h.applyStagedImport(dataDir, staged)
	if impErr != nil {
		log.Printf("auto-backup: restore %q: %v", name, impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	log.Printf("auto-backup: restored from %q (%d bookmarks skipped)", name, skipped)
	logDataImport("auto_backup_restore", len(staged), skipped, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "success", "skippedBookmarks": skipped})
}

// RunAutoBackup creates an automatic backup on demand (manual "Back up now").
// Works regardless of the AutoBackupEnabled setting.
func (h *Handlers) RunAutoBackup(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if err := h.writeAutoBackup(); err != nil {
		log.Printf("auto-backup: manual run failed: %v", err)
		http.Error(w, "Failed to create backup", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "success"})
}
