package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
			logWarn(logComponentStore, "settings.json could not be read for allowLocalBookmarks (%v); the safe default applies", err)
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

/*
dataFilePolicy is what a backup and a restore do with one named file in the
data directory.

The lists this replaces were kept by hand -- what a backup may carry, what a
restore removes when an archive omits it, which files are credentials, which
are 0600 -- and a feature that added a file had to remember all four. The
Containers view did not, and its update choices and token were in no backup.
TestEveryDataFileHasABackupPolicy now fails for a file nobody decided about.
*/
type dataFilePolicy int

const (
	// Not carried: rebuilt on its own, bound to this host, or a log.
	dataNever dataFilePolicy = iota
	// Not carried, and removed on restore so it is rebuilt against the
	// restored data rather than describing the old.
	dataCache
	// Carried, and replaced wholesale: a restore removes it when the archive
	// does not have it.
	dataReplace
	// Carried, and left alone when an archive does not have it -- an archive
	// written before the feature existed must not take its data with it.
	dataKeep
	// Carried unless BackupExcludeSecrets; restored 0600; left alone when
	// absent, which is also what an archive made with secrets excluded is.
	dataSecret
)

var dataFiles = map[string]dataFilePolicy{
	"settings.json":           dataReplace,
	"colors.json":             dataReplace,
	"pages.json":              dataReplace,
	"inbox.json":              dataReplace,
	"favicon.ico":             dataReplace,
	"favicon.png":             dataReplace,
	"favicon.jpg":             dataReplace,
	"favicon.gif":             dataReplace,
	"font.woff":               dataReplace,
	"font.woff2":              dataReplace,
	"font.ttf":                dataReplace,
	"font.otf":                dataReplace,
	".custom-themes-reset-v1": dataReplace, // migration marker (FileStore.customThemesMigrationMarker)

	"finders.json": dataKeep, // predates the finders feature in archives
	// Uptime samples for monitored bookmarks. Unlike the caches these cannot
	// be recomputed: a 30-day window takes 30 days to earn back.
	"health-history.json": dataKeep,
	// Deleted bookmarks still inside their 30 days; dropping them would empty
	// the one place they still existed.
	"trash.json": dataKeep,
	// Left out one at a time, each for a reason that held alone -- a trend
	// re-records daily, a feed re-polls -- and together a restored install
	// that had to earn back weeks of history. health-trend needs three days
	// before its chart appears at all.
	"health-trend.json":       dataKeep,
	"feeds.json":              dataKeep,
	"inbox-stats.json":        dataKeep,
	"site-news.json":          dataKeep,
	"push-subscriptions.json": dataKeep,
	// Which images are held, and which update was skipped.
	"docker-updates.json": dataKeep,

	/*
	 * Credentials, at the owner's explicit instruction.
	 *
	 * Import tokens, the keys and passwords a health check sends, the keys
	 * outgoing deliveries are signed with, and the GitHub token the container
	 * changelogs are fetched with. Including them makes a restore complete;
	 * it also makes every backup file a secret in its own right, since a ZIP
	 * has no permissions to carry the 0600 these have on disk.
	 */
	"sources.json":            dataSecret,
	"health-credentials.json": dataSecret,
	"webhooks.json":           dataSecret,
	"docker-secrets.json":     dataSecret,
	"web-search-secrets.json": dataSecret,
	"unraid-secrets.json":     dataSecret,

	"preview-cache.json": dataCache,
	"health-cache.json":  dataCache,

	"docker-bind-sizes.json":     dataNever, // measured from this host's disks
	"docker-events.json":         dataNever, // this host's container timeline
	"docker-update-history.json": dataNever, // rollbacks name this host's image ids
	"activity.log":               dataNever,
	"server.log":                 dataNever,
}

func dataFilePolicyOf(relPath string) (dataFilePolicy, bool) {
	policy, ok := dataFiles[relPath]
	return policy, ok
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
			logWarn(logComponentImport, "%s holds unreadable bookmark JSON (%v); its categories were left as they were", file.relPath, err)
			continue
		}
		pageWithBookmarks.Categories = cats
		data, err := json.MarshalIndent(pageWithBookmarks, "", "  ")
		if err != nil {
			logWarn(logComponentImport, "the merged categories for %s could not be written back (%v); that page was left as it was", file.relPath, err)
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
		if _, ok := parseBookmarkPageIDFromFilename(base); ok {
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
		if _, ok := parseBookmarkPageIDFromFilename(name); ok {
			if !bookmarkNames[name] {
				if err := os.Remove(filepath.Join(dataDir, name)); err != nil {
					return err
				}
			}
		}
	}

	for name, policy := range dataFiles {
		switch policy {
		case dataReplace:
			if !preparedHasRelPath(prepared, name) {
				_ = os.Remove(filepath.Join(dataDir, name))
			}
		case dataCache:
			_ = os.Remove(filepath.Join(dataDir, name))
		}
	}

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
	if policy, _ := dataFilePolicyOf(relPath); policy == dataSecret {
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

	// Every file is written beside its destination first, and only when all of
	// them are on disk is any renamed into place. Written and renamed one by
	// one, a full disk half-way left half the archive and half the old data,
	// with the orphan cleanup never run.
	type stagedFile struct{ tmp, dest string }
	staged := make([]stagedFile, 0, len(prepared))
	discard := func() {
		for _, f := range staged {
			_ = os.Remove(f.tmp)
		}
	}
	for _, file := range prepared {
		src := filepath.Join(stagingDataDir, file.relPath)
		dest := filepath.Join(dataDir, file.relPath)
		content, err := os.ReadFile(src)
		if err != nil {
			discard()
			return err
		}
		// With the mode set on an existing file too (WriteFile only sets it on create).
		tmp, err := stageFileBeside(dest, content, importFileMode(file.relPath))
		if err != nil {
			discard()
			return err
		}
		staged = append(staged, stagedFile{tmp: tmp, dest: dest})
	}
	dirs := map[string]bool{}
	for _, f := range staged {
		if err := os.Rename(f.tmp, f.dest); err != nil {
			discard()
			return err
		}
		dirs[filepath.Dir(f.dest)] = true
	}
	for dir := range dirs {
		syncDir(dir)
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

	// A named file is allowed when the register carries it.
	if policy, ok := dataFilePolicyOf(filename); ok {
		return policy != dataNever && policy != dataCache
	}

	// Check if it's a bookmarks file (bookmarks- followed by digits and .json)
	// The same test the store reads pages with: bookmarks-0.json passed a plain
	// Atoi, skipped the URL sanitizing, satisfied the "has pages" guard and then
	// had every real page removed as an orphan.
	if _, ok := parseBookmarkPageIDFromFilename(filename); ok {
		return true
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
		logError(logComponentImport, "the data directory could not be prepared, so the import stopped: %v", err)
		http.Error(w, "Failed to prepare data directory", http.StatusInternalServerError)
		return
	}

	/*
	 * Parse the form, buffering 32 MB of it in memory and spilling the rest to
	 * temp files.
	 *
	 * This argument is maxMemory, not a size limit -- it was 256 MB, which
	 * meant an icon-heavy backup was held in RAM in its entirety. How large the
	 * upload may be is decided once, by multipartBodyLimit in securityHeaders;
	 * this only decides how much of it sits in memory on the way past.
	 */
	err := r.ParseMultipartForm(32 << 20)
	if err != nil {
		logWarn(logComponentImport, "the uploaded file could not be read (%v); nothing was imported", err)
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
		logDebug(logComponentImport, "staging %s", filename)

		if !h.isValidImportFilename(filename) {
			logWarn(logComponentImport, "%s was refused: that name is not one nextDash writes", filename)
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
			logWarn(logComponentImport, "%s does not hold valid JSON and was skipped", filename)
			http.Error(w, fmt.Sprintf("Invalid JSON content in file: %s", filename), http.StatusBadRequest)
			return
		}

		staged = append(staged, stagedImportFile{filename: filename, content: content})
	}

	skippedBookmarks, impErr := h.applyStagedImport(dataDir, staged)
	if impErr != nil {
		logError(logComponentImport, "the import did not finish: %v", impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	logInfo(logComponentImport, "import finished, %d bookmarks skipped", skippedBookmarks)
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

	// A copy of what is about to be replaced, taken here because this is the one
	// path both the ZIP import and the auto-backup restore commit through.
	//
	// After every check rather than before: the backup prunes the rotation, so
	// one taken for an archive that is then refused spent a slot on nothing --
	// and three refused attempts replaced every older backup with copies of the
	// state someone was trying to recover from. Failure is logged and the
	// import proceeds — refusing to import because the safety copy could not be
	// written would leave someone stuck with no way forward and no way back.
	if err := h.writeSafetyBackup(); err != nil {
		logWarn(logComponentImport, "the safety backup could not be made (%v); the import went ahead without one", err)
	} else {
		logInfo(logComponentImport, "safety backup written before the data was replaced")
	}

	// Under the store lock, so no bookmark write lands between the files.
	if err := h.store.ReplaceDataFiles(func() error { return commitPreparedImport(dataDir, prepared) }); err != nil {
		return 0, &importError{msg: fmt.Sprintf("commit failed: %v", err), code: http.StatusInternalServerError}
	}

	for pageID, categories := range importedCategoriesByPage {
		if err := h.store.SaveCategoriesByPage(pageID, categories); err != nil {
			return 0, &importError{msg: fmt.Sprintf("save categories for page %d failed: %v", pageID, err), code: http.StatusInternalServerError}
		}
	}

	h.invalidateHealthReportCache()
	applyRuntimeSettings(h.store.GetSettings())
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

func (s backupSkips) skip(relPath string) bool {
	if s.archives && strings.HasPrefix(relPath, archiveDirName+"/") {
		return true
	}
	policy, _ := dataFilePolicyOf(relPath)
	return s.secrets && policy == dataSecret
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
			// Cached preview media. isValidImportFilename already refuses it
			// one file at a time -- this only saves the stats, the same reason
			// archives above is refused whole. Never in a backup on purpose:
			// it is re-fetchable decoration capped at a couple of hundred
			// megabytes, and a restore heals it from the source URL the preview
			// cache still holds.
			if info.Name() == previewImageDirName && filepath.Dir(path) == dataDir {
				return filepath.SkipDir
			}
			// The app-icon set mirrors and their cached icons: all of it comes
			// back from the CDN, the same as cached previews.
			if info.Name() == iconSetsDirName && filepath.Dir(path) == dataDir {
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
		logError(logComponentImport, "the archive %q could not be restored: %v", fh.Filename, impErr)
		http.Error(w, impErr.Error(), impErr.status())
		return
	}

	logInfo(logComponentImport, "restored from the uploaded archive %q, %d bookmarks skipped", fh.Filename, skipped)
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
