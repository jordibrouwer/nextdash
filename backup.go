package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
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
			// Keep existing finders when older ZIPs omit finders.json.
			if name == "finders.json" {
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

func writePreparedImportStaging(stagingDataDir string, prepared []preparedImportFile) error {
	for _, file := range prepared {
		dest := filepath.Join(stagingDataDir, file.relPath)
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(dest, file.content, 0644); err != nil {
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
		if err := os.WriteFile(dest, content, 0644); err != nil {
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
	// Allow / only in icons/ prefix
	if strings.Contains(filename, "/") && !strings.HasPrefix(filename, "icons/") {
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
		"favicon.ico",
		"favicon.png",
		"favicon.jpg",
		"favicon.gif",
		"font.woff",
		"font.woff2",
		"font.ttf",
		"font.otf",
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

	allowLocalBookmarks := resolveImportAllowLocalBookmarks(staged, h.store.GetSettings().AllowLocalBookmarks)

	prepared, importedCategoriesByPage, skippedBookmarks, err := prepareImportFromStaged(staged, allowLocalBookmarks)
	if err != nil {
		log.Printf("import: prepare failed: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	prepared, importedCategoriesByPage = mergeImportCategoriesIntoPrepared(prepared, importedCategoriesByPage)

	if err := commitPreparedImport(dataDir, prepared); err != nil {
		log.Printf("import: commit failed: %v", err)
		http.Error(w, "Failed to apply import", http.StatusInternalServerError)
		return
	}

	for pageID, categories := range importedCategoriesByPage {
		if err := h.store.SaveCategoriesByPage(pageID, categories); err != nil {
			log.Printf("import: save categories for page %d failed: %v", pageID, err)
			http.Error(w, "Failed to save imported categories", http.StatusInternalServerError)
			return
		}
	}

	h.invalidateHealthReportCache()
	log.Printf("import: success (%d files, %d bookmarks skipped)", len(prepared), skippedBookmarks)
	logDataImport("backup_zip", len(prepared), skippedBookmarks, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":            "success",
		"skippedBookmarks": skippedBookmarks,
	})
}

// buildBackupZip assembles the full data-directory backup as a ZIP archive in memory.
// It is shared by the download handler (Backup) and the automatic backup scheduler so
// both produce identical archives.
func (h *Handlers) buildBackupZip() ([]byte, error) {
	// Ensure base data directory exists so backup works on first run.
	dataDir := ResolveDataDir()
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
