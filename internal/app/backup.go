package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

func extractPageIDFromCategoriesFilename(filename string) (int, bool) {
	if !strings.HasPrefix(filename, "categories-") || !strings.HasSuffix(filename, ".json") {
		return 0, false
	}
	numberPart := strings.TrimPrefix(strings.TrimSuffix(filename, ".json"), "categories-")
	pageID, err := strconv.Atoi(numberPart)
	if err != nil || pageID <= 0 {
		return 0, false
	}
	return pageID, true
}

// validateBookmarkURL checks scheme and optionally blocks private/loopback hosts.
func validateBookmarkURL(bookmarkURL string, allowLocal bool) error {
	if bookmarkURL == "" {
		return nil // Allow empty URLs
	}
	return validateHTTPURL(bookmarkURL, allowLocal)
}

// sanitizeImportedBookmarkFile removes bookmarks with disallowed URLs from an import payload.
func sanitizeImportedBookmarkFile(content []byte, allowLocal bool) ([]byte, int, error) {
	var page PageWithBookmarks
	if err := json.Unmarshal(content, &page); err != nil {
		return nil, 0, err
	}
	if len(page.Bookmarks) == 0 {
		return content, 0, nil
	}

	filtered := make([]Bookmark, 0, len(page.Bookmarks))
	skipped := 0
	for _, bookmark := range page.Bookmarks {
		if err := validateBookmarkURL(bookmark.URL, allowLocal); err != nil {
			skipped++
			continue
		}
		bookmark.Icon = sanitizeBookmarkIcon(bookmark.Icon)
		filtered = append(filtered, bookmark)
	}

	page.Bookmarks = filtered
	out, err := json.MarshalIndent(page, "", "  ")
	if err != nil {
		return nil, skipped, err
	}
	return out, skipped, nil
}

type stagedImportFile struct {
	filename string
	content  []byte
}

func normalizeImportFilename(filename string) string {
	return strings.ReplaceAll(filename, "\\", "/")
}

// allowLocalBookmarksFromSettingsJSON mirrors GetSettings defaulting when the key is absent.
func allowLocalBookmarksFromSettingsJSON(content []byte) (bool, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(content, &raw); err != nil {
		return false, err
	}
	if _, ok := raw["allowLocalBookmarks"]; !ok {
		return true, nil
	}
	var settings Settings
	if err := json.Unmarshal(content, &settings); err != nil {
		return false, err
	}
	return settings.AllowLocalBookmarks, nil
}

func resolveImportAllowLocalBookmarks(staged []stagedImportFile, fallback bool) bool {
	for _, item := range staged {
		if item.filename != "settings.json" {
			continue
		}
		allowLocal, err := allowLocalBookmarksFromSettingsJSON(item.content)
		if err != nil {
			log.Printf("import: could not read allowLocalBookmarks from settings.json: %v; using fallback", err)
			return fallback
		}
		return allowLocal
	}
	return fallback
}

type preparedImportFile struct {
	relPath string // path relative to data/ (e.g. settings.json, icons/foo.png)
	content []byte
}

var importManagedRootFilenames = []string{
	"settings.json",
	"colors.json",
	"pages.json",
	"finders.json",
	"inbox.json",
	"health-history.json",
	"trash.json",
	"favicon.ico",
	"favicon.png",
	"favicon.jpg",
	"favicon.gif",
	"font.woff",
	"font.woff2",
	"font.ttf",
	"font.otf",
	".custom-themes-reset-v1",
}

func isImportRootImage(filename string) bool {
	if strings.Contains(filename, "/") {
		return false
	}
	validImageExtensions := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"}
	for _, ext := range validImageExtensions {
		if strings.HasSuffix(filename, ext) {
			return true
		}
	}
	return false
}

// canonicalDataAssetPath is the canonical path under data/ for bookmark icons and backup ZIP entries.
// Legacy root-level images (data/foo.png) map to icons/foo.png so backup/import round-trips stay stable.
func canonicalDataAssetPath(filename string) string {
	filename = normalizeImportFilename(filename)
	if strings.HasPrefix(filename, "icons/") || strings.HasPrefix(filename, "favicon.") {
		return filename
	}
	if isImportRootImage(filename) {
		return "icons/" + filepath.Base(filename)
	}
	return filename
}

func importDataRelPath(filename string) string {
	return canonicalDataAssetPath(filename)
}

func isLegacyRootImagePath(relPath string) bool {
	relPath = normalizeImportFilename(relPath)
	return !strings.Contains(relPath, "/") && isImportRootImage(relPath)
}

func shouldSkipBackupRootImageDuplicate(dataDir, relPath string) bool {
	if !isLegacyRootImagePath(relPath) {
		return false
	}
	canonical := filepath.FromSlash(canonicalDataAssetPath(relPath))
	if _, err := os.Stat(filepath.Join(dataDir, canonical)); err == nil {
		return true
	}
	return false
}

func mergePreparedImports(prepared []preparedImportFile) []preparedImportFile {
	indexByPath := make(map[string]int, len(prepared))
	out := make([]preparedImportFile, 0, len(prepared))
	for _, file := range prepared {
		key := filepath.ToSlash(file.relPath)
		if idx, ok := indexByPath[key]; ok {
			out[idx] = file
			continue
		}
		indexByPath[key] = len(out)
		out = append(out, file)
	}
	return out
}

func prepareImportFromStaged(staged []stagedImportFile, allowLocal bool) ([]preparedImportFile, map[int][]Category, int, error) {
	categories := make(map[int][]Category)
	prepared := make([]preparedImportFile, 0, len(staged))
	skippedBookmarks := 0

	for _, item := range staged {
		filename := item.filename
		content := item.content

		if pageID, ok := extractPageIDFromCategoriesFilename(filename); ok {
			var cats []Category
			if err := json.Unmarshal(content, &cats); err != nil {
				return nil, nil, 0, fmt.Errorf("invalid categories JSON in file: %s", filename)
			}
			categories[pageID] = cats
			continue
		}

		if _, ok := parseBookmarkPageIDFromFilename(filepath.Base(filename)); ok {
			sanitized, skipped, err := sanitizeImportedBookmarkFile(content, allowLocal)
			if err != nil {
				return nil, nil, 0, fmt.Errorf("invalid bookmarks JSON in file: %s", filename)
			}
			content = sanitized
			skippedBookmarks += skipped
		}

		prepared = append(prepared, preparedImportFile{
			relPath: importDataRelPath(filename),
			content: content,
		})
	}

	return mergePreparedImports(prepared), categories, skippedBookmarks, nil
}

// mergeImportCategoriesIntoPrepared embeds standalone categories-*.json payloads into
// matching bookmarks-*.json files before commit so a failed post-commit category save
// cannot leave bookmarks committed without their categories.
func mergeImportCategoriesIntoPrepared(prepared []preparedImportFile, categoriesByPage map[int][]Category) ([]preparedImportFile, map[int][]Category) {
	if len(categoriesByPage) == 0 {
		return prepared, categoriesByPage
	}

	remaining := make(map[int][]Category, len(categoriesByPage))
	for pageID, cats := range categoriesByPage {
		remaining[pageID] = cats
	}

	for i, file := range prepared {
		pageID, ok := parseBookmarkPageIDFromFilename(filepath.Base(file.relPath))
		if !ok {
			continue
		}
		cats, hasCats := remaining[pageID]
		if !hasCats {
			continue
		}

		var pageWithBookmarks PageWithBookmarks
		if err := json.Unmarshal(file.content, &pageWithBookmarks); err != nil {
			log.Printf("import: skip merging categories into %s: invalid bookmarks JSON: %v", file.relPath, err)
			continue
		}
		pageWithBookmarks.Categories = cats
		data, err := json.MarshalIndent(pageWithBookmarks, "", "  ")
		if err != nil {
			log.Printf("import: skip merging categories into %s: marshal failed: %v", file.relPath, err)
			continue
		}
		prepared[i].content = data
		delete(remaining, pageID)
	}

	return prepared, remaining
}

func importIconBasenames(prepared []preparedImportFile) map[string]bool {
	names := make(map[string]bool)
	for _, file := range prepared {
		rel := filepath.ToSlash(file.relPath)
		if strings.HasPrefix(rel, "icons/") {
			names[strings.TrimPrefix(rel, "icons/")] = true
		}
	}
	return names
}

func importBookmarkFilenames(prepared []preparedImportFile) map[string]bool {
	names := make(map[string]bool)
	for _, file := range prepared {
		base := filepath.Base(file.relPath)
		if strings.HasPrefix(base, "bookmarks-") && strings.HasSuffix(base, ".json") {
			names[base] = true
		}
	}
	return names
}

func preparedHasRelPath(prepared []preparedImportFile, relPath string) bool {
	relPath = filepath.ToSlash(relPath)
	for _, file := range prepared {
		if filepath.ToSlash(file.relPath) == relPath {
			return true
		}
	}
	return false
}

func removeImportOrphans(dataDir string, prepared []preparedImportFile) error {
	bookmarkNames := importBookmarkFilenames(prepared)
	iconNames := importIconBasenames(prepared)

	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, "bookmarks-") && strings.HasSuffix(name, ".json") {
			if !bookmarkNames[name] {
				if err := os.Remove(filepath.Join(dataDir, name)); err != nil {
					return err
				}
			}
		}
	}

	for _, name := range importManagedRootFilenames {
		if !preparedHasRelPath(prepared, name) {
			// Keep what is already there when an older ZIP omits the file.
			// finders.json predates the finders feature in archives; every ZIP
			// written before monitoring history was included omits that too, and
			// deleting it would throw away measurements the import cannot restore
			// for a feature the archive simply did not know about.
			// trash.json is the same case: a ZIP written before the trash
			// existed omits it, and removing it would permanently destroy
			// bookmarks that were still restorable.
			if name == "finders.json" || name == "health-history.json" || name == "trash.json" {
				continue
			}
			_ = os.Remove(filepath.Join(dataDir, name))
		}
	}

	_ = os.Remove(filepath.Join(dataDir, "preview-cache.json"))
	_ = os.Remove(filepath.Join(dataDir, "health-cache.json"))

	iconsDir := filepath.Join(dataDir, "icons")
	iconEntries, err := os.ReadDir(iconsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range iconEntries {
		if entry.IsDir() {
			continue
		}
		if !iconNames[entry.Name()] {
			if err := os.Remove(filepath.Join(iconsDir, entry.Name())); err != nil {
				return err
			}
		}
	}

	return nil
}

/*
importFileMode is the permission a restored file gets.

Most of the data directory is 0644 and always has been. Two files are not:
sources.json and health-credentials.json hold tokens, API keys and passwords,
and are written 0600 so that on a multi-user host the account next door cannot
read them. A restore that wrote them 0644 would undo that quietly — the file
would be back, and the protection would not.

A ZIP carries no permissions, so this is where they are put back rather than
where they are preserved.
*/
func importFileMode(relPath string) os.FileMode {
	switch relPath {
	case "sources.json", "health-credentials.json", "webhooks.json":
		return 0600
	}
	return 0644
}

func writePreparedImportStaging(stagingDataDir string, prepared []preparedImportFile) error {
	for _, file := range prepared {
		dest := filepath.Join(stagingDataDir, file.relPath)
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(dest, file.content, importFileMode(file.relPath)); err != nil {
			return err
		}
	}
	return nil
}

func commitPreparedImport(dataDir string, prepared []preparedImportFile) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}

	stagingRoot, err := os.MkdirTemp("", "nextdash-import-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stagingRoot)

	stagingDataDir := filepath.Join(stagingRoot, "data")
	if err := writePreparedImportStaging(stagingDataDir, prepared); err != nil {
		return err
	}

	for _, file := range prepared {
		src := filepath.Join(stagingDataDir, file.relPath)
		dest := filepath.Join(dataDir, file.relPath)
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		content, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		if err := os.WriteFile(dest, content, importFileMode(file.relPath)); err != nil {
			return err
		}
	}

	if err := removeImportOrphans(dataDir, prepared); err != nil {
		return err
	}

	return nil
}

// isValidImportFilename validates that the filename is safe and allowed for import
func (h *Handlers) isValidImportFilename(filename string) bool {
	// Prevent path traversal, but allow icons/ subdirectory
	if strings.Contains(filename, "..") {
		return false
	}
	if strings.Contains(filename, "\\") {
		return false
	}
	// Allow / only in the two directories a backup carries.
	if strings.Contains(filename, "/") &&
		!strings.HasPrefix(filename, "icons/") && !strings.HasPrefix(filename, archiveDirName+"/") {
		return false
	}

	// Allow only specific filenames with their extensions
	allowedFiles := []string{
		".custom-themes-reset-v1", // migration marker under data/ (see FileStore.customThemesMigrationMarker)
		"settings.json",
		"colors.json",
		"pages.json",
		"finders.json",
		"inbox.json",
		// Uptime samples for monitored bookmarks. Unlike preview-cache.json and
		// health-cache.json — which are re-derived by scanning and are dropped on
		// import — these are measurements that cannot be recomputed: losing them
		// resets every monitored row's chart, uptime windows and outage list, and
		// a 30-day window takes 30 days to earn back.
		"health-history.json",
		// Deleted bookmarks still inside their 30 days. A restore that dropped
		// these would quietly empty the one place they still existed.
		"trash.json",
		"favicon.ico",
		"favicon.png",
		"favicon.jpg",
		"favicon.gif",
		"font.woff",
		"font.woff2",
		"font.ttf",
		"font.otf",
		/*
		 * The rest of the data directory.
		 *
		 * These were left out one at a time, each for a reason that made sense
		 * alone: a trend is re-recorded daily, a feed re-polls, a cache
		 * regenerates. Together they meant a restored install lost its history
		 * and its counters and had to earn them back over weeks — health-trend
		 * needs three days before its chart appears at all, and thirty before
		 * the window it claims is real.
		 */
		"health-trend.json",
		"feeds.json",
		"inbox-stats.json",
		"site-news.json",
		"push-subscriptions.json",
		/*
		 * Credentials, at the owner's explicit instruction.
		 *
		 * sources.json holds import tokens and health-credentials.json holds API
		 * keys and passwords, and both were deliberately kept out of the backup:
		 * a ZIP travels to a NAS, to a laptop, into a Downloads folder, and a
		 * token is worth more than the cursor beside it. Including them makes a
		 * restore complete — nothing to type in again — and makes every backup
		 * file a secret in its own right. Both files are 0600 on disk; a backup
		 * has no permissions to carry, so that protection ends at the ZIP.
		 */
		"sources.json",
		"health-credentials.json",
		// webhooks.json holds the keys deliveries are signed with. Same trade:
		// a restore that has them is complete, and a backup that has them is
		// enough to forge a delivery to somebody's automation.
		"webhooks.json",
	}

	// Check if it's one of the specific files
	for _, allowed := range allowedFiles {
		if filename == allowed {
			return true
		}
	}

	// Check if it's a bookmarks file (bookmarks- followed by digits and .json)
	if strings.HasPrefix(filename, "bookmarks-") && strings.HasSuffix(filename, ".json") {
		// Extract the number part
		numberPart := strings.TrimPrefix(strings.TrimSuffix(filename, ".json"), "bookmarks-")
		if _, err := strconv.Atoi(numberPart); err == nil {
			return true
		}
	}

	// Check if it's a per-page categories file (categories-{page}.json)
	if _, ok := extractPageIDFromCategoriesFilename(filename); ok {
		return true
	}

	// Check if it's an image file in root data directory
	if !strings.Contains(filename, "/") {
		validImageExtensions := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"}
		for _, ext := range validImageExtensions {
			if strings.HasSuffix(filename, ext) {
				return true
			}
		}
	}

	/*
	 * Local captures, which are the one thing here that cannot be re-fetched.
	 *
	 * A monolith capture is a copy of a page as it was; the page it came from
	 * may be gone. Any file under archives/ is carried, because a capture is a
	 * single HTML file whose name is the archive's own and whose extension it
	 * chose.
	 */
	if strings.HasPrefix(filename, archiveDirName+"/") {
		rest := strings.TrimPrefix(filename, archiveDirName+"/")
		return rest != "" && !strings.Contains(rest, "/")
	}

	// Check if it's an icon file (icons/ followed by filename with image extension)
	if strings.HasPrefix(filename, "icons/") {
		// Allow common image extensions
		validExtensions := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"}
		for _, ext := range validExtensions {
			if strings.HasSuffix(filename, ext) {
				return true
			}
		}
	}

	return false
}

// Import handles the import of backup files
func (h *Handlers) Import(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	// Ensure base data directory exists before writing imported files.
	dataDir := ResolveDataDir()
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Printf("import: failed to prepare data directory: %v", err)
		http.Error(w, "Failed to prepare data directory", http.StatusInternalServerError)
		return
	}

	// Parse multipart form.
	// Keep this comfortably above typical icon-heavy backups.
	err := r.ParseMultipartForm(256 << 20) // 256MB max
	if err != nil {
		log.Printf("import: failed to parse multipart form: %v", err)
		http.Error(w, "Failed to parse form (backup may be too large)", http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		// A whole .zip under "file" is the other shape a client can send: the
		// old config unpacked the archive in the browser with JSZip, which is a
		// CDN dependency the dashboard does not carry. Unpack it here instead,
		// reusing the same staging the auto-backup restore uses so both paths
		// validate archives identically.
		if zipped := r.MultipartForm.File["file"]; len(zipped) == 1 {
			h.importFromZipUpload(w, r, dataDir, zipped[0])
			return
		}
		http.Error(w, "No files provided", http.StatusBadRequest)
		return
	}

	staged := make([]stagedImportFile, 0, len(files))
	for _, fileHeader := range files {
		filename := normalizeImportFilename(fileHeader.Filename)
		log.Printf("import: staging %s", filename)

		if !h.isValidImportFilename(filename) {
			log.Printf("import: rejected invalid filename: %s", filename)
			http.Error(w, fmt.Sprintf("Invalid filename: %s", filename), http.StatusBadRequest)
			return
		}

		file, err := fileHeader.Open()
		if err != nil {
			http.Error(w, "Failed to open file", http.StatusInternalServerError)
			return
		}
		content, err := io.ReadAll(file)
		closeErr := file.Close()
		if err != nil {
			http.Error(w, "Failed to read file", http.StatusInternalServerError)
			return
		}
		if closeErr != nil {
			http.Error(w, "Failed to process upload", http.StatusInternalServerError)
			return
		}

		if strings.HasSuffix(filename, ".json") && !json.Valid(content) {
			log.Printf("import: invalid JSON in file: %s", filename)
			http.Error(w, fmt.Sprintf("Invalid JSON content in file: %s", filename), http.StatusBadRequest)
			return
		}

		staged = append(staged, stagedImportFile{filename: filename, content: content})
	}

	skippedBookmarks, impErr := h.applyStagedImport(dataDir, staged)
	if impErr != nil {
		log.Printf("import: %v", impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	log.Printf("import: success (%d bookmarks skipped)", skippedBookmarks)
	logDataImport("backup_zip", len(staged), skippedBookmarks, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":           "success",
		"skippedBookmarks": skippedBookmarks,
	})
}

// importError carries an HTTP status alongside the message so both the upload
// import and the restore-from-stored-backup paths can share applyStagedImport.
type importError struct {
	msg  string
	code int
}

func (e *importError) Error() string { return e.msg }
func (e *importError) status() int   { return e.code }

// applyStagedImport runs the shared import pipeline (prepare, merge categories,
// atomic commit, save categories) for a set of staged files. It returns the
// number of skipped bookmarks, or an *importError with an HTTP status.
func (h *Handlers) applyStagedImport(dataDir string, staged []stagedImportFile) (int, *importError) {
	// A copy of what is about to be replaced, taken here because this is the one
	// path both the ZIP import and the auto-backup restore commit through.
	//
	// After staging rather than before: staging is what proves the archive is
	// readable, and a backup taken for an import that then turns out to be
	// rubbish is a rotation slot spent on nothing. Failure is logged and the
	// import proceeds — refusing to import because the safety copy could not be
	// written would leave someone stuck with no way forward and no way back.
	if err := h.writeAutoBackup(); err != nil {
		log.Printf("import: safety backup before replacing data failed: %v", err)
	} else {
		log.Printf("import: safety backup written before replacing data")
	}

	allowLocalBookmarks := resolveImportAllowLocalBookmarks(staged, h.store.GetSettings().AllowLocalBookmarks)

	prepared, importedCategoriesByPage, skippedBookmarks, err := prepareImportFromStaged(staged, allowLocalBookmarks)
	if err != nil {
		return 0, &importError{msg: err.Error(), code: http.StatusBadRequest}
	}

	prepared, importedCategoriesByPage = mergeImportCategoriesIntoPrepared(prepared, importedCategoriesByPage)

	// Refuse an archive that carries no bookmark page at all. commitPreparedImport
	// treats every bookmarks-*.json that the archive does not name as an orphan and
	// deletes it, so a payload of unrelated-but-valid files (a stray settings.json,
	// a ZIP whose entries all failed the filename check) would silently wipe the
	// whole library and still answer 200. An import that replaces everything must
	// at least contain the everything it replaces.
	if len(importBookmarkFilenames(prepared)) == 0 {
		return 0, &importError{msg: "archive contains no bookmark pages", code: http.StatusBadRequest}
	}

	if err := commitPreparedImport(dataDir, prepared); err != nil {
		return 0, &importError{msg: fmt.Sprintf("commit failed: %v", err), code: http.StatusInternalServerError}
	}

	h.store.InvalidateReadCache()

	for pageID, categories := range importedCategoriesByPage {
		if err := h.store.SaveCategoriesByPage(pageID, categories); err != nil {
			return 0, &importError{msg: fmt.Sprintf("save categories for page %d failed: %v", pageID, err), code: http.StatusInternalServerError}
		}
	}

	h.invalidateHealthReportCache()
	return skippedBookmarks, nil
}

// buildBackupZip assembles the full data-directory backup as a ZIP archive in memory.
// It is shared by the download handler (Backup) and the automatic backup scheduler so
// both produce identical archives.

/*
backupSkips reports what this install has chosen to leave out of a backup.

Read once per backup rather than per file: the settings do not change halfway
through a walk, and asking the store for every icon would be thousands of reads
for two booleans.

The filtering lives here and not in isValidImportFilename, which both the backup
and the import consult: leaving a file out of the ZIP is a choice about what to
write, while refusing it on the way back in would mean a backup that contains
archives could not restore them.
*/
type backupSkips struct {
	archives bool
	secrets  bool
}

// backupSecretFilenames are the files that hold credentials rather than data:
// import tokens, the keys and passwords a health check sends, and the keys
// outgoing deliveries are signed with.
var backupSecretFilenames = map[string]bool{
	"sources.json":            true,
	"health-credentials.json": true,
	"webhooks.json":           true,
}

func (s backupSkips) skip(relPath string) bool {
	if s.archives && strings.HasPrefix(relPath, archiveDirName+"/") {
		return true
	}
	return s.secrets && backupSecretFilenames[relPath]
}

func (h *Handlers) buildBackupZip() ([]byte, error) {
	// Ensure base data directory exists so backup works on first run.
	dataDir := ResolveDataDir()
	settings := h.store.GetSettings()
	skips := backupSkips{
		archives: settings.BackupExcludeArchives,
		secrets:  settings.BackupExcludeSecrets,
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}

	// Create a buffer to write our archive to
	buf := new(bytes.Buffer)

	// Create a new zip archive
	zipWriter := zip.NewWriter(buf)

	// Walk through the data directory
	err := filepath.Walk(dataDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Never include the auto-backup store itself (avoid backup-in-backup).
		if info.IsDir() {
			if info.Name() == autoBackupDirName && filepath.Dir(path) == dataDir {
				return filepath.SkipDir
			}
			// Refused whole rather than a file at a time: an archive of a few
			// hundred captures is a few hundred pointless stats otherwise.
			if skips.archives && info.Name() == archiveDirName && filepath.Dir(path) == dataDir {
				return filepath.SkipDir
			}
			return nil
		}

		// Create a relative path for the zip entry
		relPath, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		relPath = strings.ReplaceAll(relPath, "\\", "/")

		// finders.json is always written from the store snapshot below.
		if relPath == "finders.json" {
			return nil
		}

		// Only include files that are valid for import.
		// This keeps backup->import round-trips stable even when data/ contains
		// unrelated files (e.g. acme-account keys from reverse proxies).
		if !h.isValidImportFilename(relPath) {
			return nil
		}

		if shouldSkipBackupRootImageDuplicate(dataDir, relPath) {
			return nil
		}

		if skips.skip(relPath) {
			return nil
		}

		zipEntryPath := strings.ReplaceAll(canonicalDataAssetPath(relPath), "\\", "/")

		// Create zip file entry
		zipFile, err := zipWriter.Create(zipEntryPath)
		if err != nil {
			return err
		}

		// Open the file
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(zipFile, file)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		return closeErr
	})

	if err != nil {
		return nil, err
	}

	// Also include per-page categories as dedicated files for compatibility.
	for _, page := range h.store.GetPages() {
		categories := h.store.GetCategoriesByPage(page.ID)
		categoriesData, err := json.MarshalIndent(categories, "", "  ")
		if err != nil {
			return nil, err
		}
		entryName := fmt.Sprintf("categories-%d.json", page.ID)
		zipFile, err := zipWriter.Create(entryName)
		if err != nil {
			return nil, err
		}
		if _, err := zipFile.Write(categoriesData); err != nil {
			return nil, err
		}
	}

	finders := h.store.GetFinders()
	findersData, err := json.MarshalIndent(finders, "", "  ")
	if err != nil {
		return nil, err
	}
	findersZip, err := zipWriter.Create("finders.json")
	if err != nil {
		return nil, err
	}
	if _, err := findersZip.Write(findersData); err != nil {
		return nil, err
	}

	// Close the zip writer
	if err := zipWriter.Close(); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// Backup creates a zip file with all data from the data directory
// importFromZipUpload handles an /api/import upload that is a single .zip
// rather than the loose files the old config posted. It routes through the same
// staging and apply path as the auto-backup restore, so an archive is validated
// and written the same way regardless of which client sent it.
func (h *Handlers) importFromZipUpload(w http.ResponseWriter, r *http.Request, dataDir string, fh *multipart.FileHeader) {
	f, err := fh.Open()
	if err != nil {
		http.Error(w, "Failed to open file", http.StatusInternalServerError)
		return
	}
	data, err := io.ReadAll(f)
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		http.Error(w, "Failed to read file", http.StatusInternalServerError)
		return
	}

	staged, err := h.stagedFilesFromZip(data)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if len(staged) == 0 {
		http.Error(w, "No files provided", http.StatusBadRequest)
		return
	}

	skipped, impErr := h.applyStagedImport(dataDir, staged)
	if impErr != nil {
		log.Printf("import: zip upload %q: %v", fh.Filename, impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	log.Printf("import: restored from uploaded archive %q (%d bookmarks skipped)", fh.Filename, skipped)
	logDataImport("backup_zip_import", len(staged), skipped, r)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "success", "skippedBookmarks": skipped})
}

func (h *Handlers) Backup(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	data, err := h.buildBackupZip()
	if err != nil {
		http.Error(w, "Failed to create backup", http.StatusInternalServerError)
		return
	}

	// Set headers for file download
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=nextDash-backup.zip")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))

	// Write the zip content to response
	w.Write(data)
}
