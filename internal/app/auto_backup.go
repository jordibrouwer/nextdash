package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	// defaultMaxAutoBackups is the rotation limit: the oldest is pruned beyond
	// this. Override with NEXTDASH_AUTO_BACKUP_KEEP.
	defaultMaxAutoBackups = 3
	// autoBackupInterval is the default minimum age of the newest backup before
	// a new one is made. Settings.AutoBackupIntervalDays overrides it.
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
	// Bounded, and any stat error that is not "missing" counts as free. The
	// unbounded version spun forever on a permission or I/O error -- while
	// holding autoBackupMu, which also blocks restore and delete.
	for i := 2; i < 1000; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			return name
		}
		name = fmt.Sprintf("%s-%d.zip", stamp, i)
	}
	return name
}

// autoBackupDir returns the directory holding automatic backups.
//
// NEXTDASH_AUTO_BACKUP_DIR moves it off the data directory entirely, which is
// the point of it: backups kept inside the thing they are backing up are lost
// with it. An absolute path is required — a relative one would resolve against
// the working directory, which differs between running the binary and running
// it in a container.
func autoBackupDir() string {
	if custom := strings.TrimSpace(os.Getenv("NEXTDASH_AUTO_BACKUP_DIR")); custom != "" && filepath.IsAbs(custom) {
		return custom
	}
	return filepath.Join(ResolveDataDir(), autoBackupDirName)
}

/*
How many backups are kept, and how often one is made.

Both were constants. The count is now an environment variable, because it is an
operator's decision about disk rather than a user's about behaviour; the
interval is a setting, because it is the opposite. Neither can be set to
something that would quietly stop backups happening: the count floors at one,
and the interval falls back to weekly when unset.
*/
func maxAutoBackups() int {
	if raw := strings.TrimSpace(os.Getenv("NEXTDASH_AUTO_BACKUP_KEEP")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n >= 1 && n <= 50 {
			return n
		}
	}
	return defaultMaxAutoBackups
}

func (h *Handlers) autoBackupInterval() time.Duration {
	days := h.store.GetSettings().AutoBackupIntervalDays
	if days >= 1 && days <= 30 {
		return time.Duration(days) * 24 * time.Hour
	}
	return autoBackupInterval
}

// autoBackupInfo describes one stored automatic backup for the API.
type autoBackupInfo struct {
	Name      string `json:"name"`
	Size      int64  `json:"size"`
	CreatedAt string `json:"createdAt"` // RFC3339, derived from mod time
	// What is in it, read from the archive's own files. Size in kilobytes says
	// nothing about whether this is the backup from before the import that went
	// wrong; "412 bookmarks across 5 pages" does. Zero when the archive cannot
	// be read, which the client renders as nothing rather than as "0".
	Bookmarks int `json:"bookmarks,omitempty"`
	Pages     int `json:"pages,omitempty"`
}

// autoBackupListResponse is the payload for GET /api/auto-backups.
type autoBackupListResponse struct {
	Enabled bool             `json:"enabled"`
	Backups []autoBackupInfo `json:"backups"`
	// Keep is the rotation limit and IntervalDays how often one is made, both
	// so the panel can say what will happen rather than only what has happened.
	Keep         int `json:"keep"`
	IntervalDays int `json:"intervalDays"`
	// NextBackupAt is when the next automatic backup is due (RFC3339), or empty
	// when automatic backups are disabled. When it's in the past, one is due now.
	NextBackupAt string `json:"nextBackupAt,omitempty"`
	// LastRunAt and LastRunError are the outcome of the most recent scheduled
	// attempt, whether or not it produced a file.
	//
	// A failing run wrote a log line and — only with Web Push configured and on
	// — sent a push. The panel showed nothing: a full disk or a bad
	// NEXTDASH_AUTO_BACKUP_DIR could stop backups for months while the screen
	// looked normal, which is precisely the failure a backup feature exists to
	// survive. The newest file's timestamp cannot stand in for this, because a
	// run that failed leaves the old file exactly where it was.
	LastRunAt    string `json:"lastRunAt,omitempty"`
	LastRunError string `json:"lastRunError,omitempty"`
}

// autoBackupRunState is the outcome of the last scheduled attempt, kept beside
// the archives so it survives a restart and needs no schema change anywhere
// else.
type autoBackupRunState struct {
	At    string `json:"at"`
	Error string `json:"error,omitempty"`
}

func autoBackupStatePath() string {
	return filepath.Join(autoBackupDir(), ".last-run.json")
}

func readAutoBackupRunState() autoBackupRunState {
	var state autoBackupRunState
	data, err := os.ReadFile(autoBackupStatePath())
	if err != nil {
		return state
	}
	_ = json.Unmarshal(data, &state)
	return state
}

// recordAutoBackupRun stores the outcome of a scheduled attempt. Best-effort:
// failing to record that a backup failed must not itself fail anything.
func recordAutoBackupRun(runErr error) {
	state := autoBackupRunState{At: time.Now().UTC().Format(time.RFC3339)}
	if runErr != nil {
		state.Error = runErr.Error()
	}
	data, err := json.Marshal(state)
	if err != nil {
		return
	}
	if err := os.MkdirAll(autoBackupDir(), 0755); err != nil {
		return
	}
	if err := writeFileAtomic(autoBackupStatePath(), data, 0644); err != nil {
		logWarn(logComponentBackup, "the backup ran but its run time could not be recorded (%v); the next one may come early", err)
	}
}

// nextAutoBackupTime returns when the next automatic backup is due: the newest
// backup's time plus the interval, or now when none exists yet.
func (h *Handlers) nextAutoBackupTime() time.Time {
	newest, ok := newestAutoBackupModTime()
	if !ok {
		return time.Now()
	}
	return newest.Add(h.autoBackupInterval())
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

// pruneAutoBackups deletes the oldest auto-backups until at most maxAutoBackups() remain.
func pruneAutoBackups() error {
	names, err := listAutoBackupFiles()
	if err != nil {
		return err
	}
	keep := maxAutoBackups()
	// names is newest-first; anything past the limit is oldest and gets removed.
	removed := 0
	for _, name := range names[min(len(names), keep):] {
		if err := os.Remove(filepath.Join(autoBackupDir(), name)); err != nil && !os.IsNotExist(err) {
			return err
		}
		removed++
	}
	if removed > 0 {
		logInfo(logComponentBackup, "removed %s past the limit of %d", plural(removed, "backup", "backups"), keep)
		if activityEnabled(activityCategoryBackup) {
			logActivity(activityCategoryBackup, "backup.prune", map[string]any{
				"removed": removed,
				"keep":    keep,
			}, "")
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
func (h *Handlers) autoBackupDue() bool {
	newest, ok := newestAutoBackupModTime()
	if !ok {
		return true
	}
	return time.Since(newest) >= h.autoBackupInterval()
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
	if !h.autoBackupDue() {
		return
	}
	if err := h.writeAutoBackup(); err != nil {
		logError(logComponentBackup, "the scheduled backup could not be written: %v", err)
		recordAutoBackupRun(err)
		h.pushAutoBackupResult(context.Background(), err)
		return
	}
	logInfo(logComponentBackup, "scheduled backup written")
	recordAutoBackupRun(nil)
	h.pushAutoBackupResult(context.Background(), nil)
}

// ListAutoBackups returns the stored automatic backups as JSON, newest first,
// along with whether automatic backups are enabled and when the next one is due.
func (h *Handlers) ListAutoBackups(w http.ResponseWriter, r *http.Request) {
	// Same gate as the run/restore/delete siblings: this lists what the archive
	// store holds. The client fetches it through nextDashFetch, so the token
	// travels with it.
	if !h.requireWriteAccess(w, r) {
		return
	}
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
		entry := autoBackupInfo{
			Name:      name,
			Size:      info.Size(),
			CreatedAt: info.ModTime().UTC().Format(time.RFC3339),
		}
		entry.Bookmarks, entry.Pages = countBackupContents(filepath.Join(autoBackupDir(), name))
		backups = append(backups, entry)
	}

	settings := h.store.GetSettings()
	resp := autoBackupListResponse{
		Enabled: settings.AutoBackupEnabled,
		Backups: backups,
		// The rotation limit was a constant the client could not see, so the
		// panel could only say how many backups exist — never that a fourth
		// pushes the oldest out, which is what makes "Make a backup now" a
		// destructive button on a full rotation.
		Keep:         maxAutoBackups(),
		IntervalDays: int(h.autoBackupInterval() / (24 * time.Hour)),
	}
	if resp.Enabled {
		resp.NextBackupAt = h.nextAutoBackupTime().UTC().Format(time.RFC3339)
	}
	if state := readAutoBackupRunState(); state.At != "" {
		resp.LastRunAt = state.At
		resp.LastRunError = state.Error
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// DownloadAutoBackup streams a stored automatic backup by name.
func (h *Handlers) DownloadAutoBackup(w http.ResponseWriter, r *http.Request) {
	// This hands over a full copy of the data directory -- the same content
	// /api/backup refuses without a token. The client downloads it via
	// downloadViaBlob -> writeFetch, which carries the token.
	if !h.requireWriteAccess(w, r) {
		return
	}
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
		logWarn(logComponentBackup, "the old backup %q could not be removed (%v); it still takes up space", name, err)
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
		logError(logComponentBackup, "the backup %q could not be read, so nothing was restored: %v", name, err)
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
		logError(logComponentBackup, "restoring from %q did not finish: %v", name, impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	logInfo(logComponentBackup, "restored from %q, %d bookmarks skipped", name, skipped)
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
		logError(logComponentBackup, "the backup you started could not be made: %v", err)
		http.Error(w, "Failed to create backup", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "success"})
}

// countBackupContents reads an archive and reports what it holds: how many
// bookmarks, across how many pages.
//
// Read from the zip rather than recorded when it was written, so it also works
// for archives made before this existed — and for one that was imported from
// somewhere else. Failures are silent and report zero: a listing that refuses
// to render because one old archive is unreadable is worse than a row without
// a count.
func countBackupContents(path string) (bookmarks int, pages int) {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, 0
	}
	for _, f := range zr.File {
		name := filepath.Base(f.Name)
		if !strings.HasPrefix(name, "bookmarks-") || !strings.HasSuffix(name, ".json") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(rc, 32<<20))
		rc.Close()
		if err != nil {
			continue
		}
		var page struct {
			Bookmarks []json.RawMessage `json:"bookmarks"`
		}
		if json.Unmarshal(body, &page) != nil {
			continue
		}
		pages++
		bookmarks += len(page.Bookmarks)
	}
	return bookmarks, pages
}
