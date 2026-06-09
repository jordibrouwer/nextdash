package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
			return fallback
		}
		return allowLocal
	}
	return fallback
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
	if err := os.MkdirAll("data", 0755); err != nil {
		http.Error(w, "Failed to prepare data directory", http.StatusInternalServerError)
		return
	}

	// Parse multipart form.
	// Keep this comfortably above typical icon-heavy backups.
	err := r.ParseMultipartForm(256 << 20) // 256MB max
	if err != nil {
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
		fmt.Printf("Staging file: %s\n", filename)

		if !h.isValidImportFilename(filename) {
			fmt.Printf("Invalid filename: %s\n", filename)
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
			fmt.Printf("Invalid JSON in file: %s\n", filename)
			http.Error(w, fmt.Sprintf("Invalid JSON content in file: %s", filename), http.StatusBadRequest)
			return
		}

		staged = append(staged, stagedImportFile{filename: filename, content: content})
	}

	allowLocalBookmarks := resolveImportAllowLocalBookmarks(staged, h.store.GetSettings().AllowLocalBookmarks)

	importedCategoriesByPage := make(map[int][]Category)
	skippedBookmarks := 0

	for _, item := range staged {
		filename := item.filename
		content := item.content

		fmt.Printf("Processing file: %s\n", filename)

		if pageID, ok := extractPageIDFromCategoriesFilename(filename); ok {
			var categories []Category
			if err := json.Unmarshal(content, &categories); err != nil {
				http.Error(w, fmt.Sprintf("Invalid categories JSON in file: %s", filename), http.StatusBadRequest)
				return
			}
			importedCategoriesByPage[pageID] = categories
			continue
		}

		if _, ok := parseBookmarkPageIDFromFilename(filepath.Base(filename)); ok {
			sanitized, skipped, err := sanitizeImportedBookmarkFile(content, allowLocalBookmarks)
			if err != nil {
				http.Error(w, fmt.Sprintf("Invalid bookmarks JSON in file: %s", filename), http.StatusBadRequest)
				return
			}
			content = sanitized
			skippedBookmarks += skipped
		}

		var destPath string
		if strings.HasPrefix(filename, "favicon.") {
			destPath = filepath.Join("data", filename)
		} else if !strings.Contains(filename, "/") {
			validImageExtensions := []string{".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"}
			isImage := false
			for _, ext := range validImageExtensions {
				if strings.HasSuffix(filename, ext) {
					isImage = true
					break
				}
			}
			if isImage {
				destPath = filepath.Join("data", "icons", filename)
			} else {
				destPath = filepath.Join("data", filename)
			}
		} else {
			destPath = filepath.Join("data", filename)
		}

		dir := filepath.Dir(destPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			http.Error(w, "Failed to create directory", http.StatusInternalServerError)
			return
		}

		if err := os.WriteFile(destPath, content, 0644); err != nil {
			http.Error(w, "Failed to write file", http.StatusInternalServerError)
			return
		}
	}

	// Apply imported categories after bookmark/page files have been restored.
	for pageID, categories := range importedCategoriesByPage {
		h.store.SaveCategoriesByPage(pageID, categories)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":            "success",
		"skippedBookmarks": skippedBookmarks,
	})
}

// Backup creates a zip file with all data from the data directory
func (h *Handlers) Backup(w http.ResponseWriter, r *http.Request) {
	// Ensure base data directory exists so backup works on first run.
	dataDir := "data"
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		http.Error(w, "Failed to prepare backup directory", http.StatusInternalServerError)
		return
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

		// Skip directories
		if info.IsDir() {
			return nil
		}

		// Create a relative path for the zip entry
		relPath, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		relPath = strings.ReplaceAll(relPath, "\\", "/")

		// Only include files that are valid for import.
		// This keeps backup->import round-trips stable even when data/ contains
		// unrelated files (e.g. acme-account keys from reverse proxies).
		if !h.isValidImportFilename(relPath) {
			return nil
		}

		// Create zip file entry
		zipFile, err := zipWriter.Create(relPath)
		if err != nil {
			return err
		}

		// Open the file
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		// Copy file content to zip
		_, err = io.Copy(zipFile, file)
		return err
	})

	if err != nil {
		http.Error(w, "Failed to create backup", http.StatusInternalServerError)
		return
	}

	// Also include per-page categories as dedicated files for compatibility.
	for _, page := range h.store.GetPages() {
		categories := h.store.GetCategoriesByPage(page.ID)
		categoriesData, err := json.MarshalIndent(categories, "", "  ")
		if err != nil {
			http.Error(w, "Failed to serialize categories", http.StatusInternalServerError)
			return
		}
		entryName := fmt.Sprintf("categories-%d.json", page.ID)
		zipFile, err := zipWriter.Create(entryName)
		if err != nil {
			http.Error(w, "Failed to include categories in backup", http.StatusInternalServerError)
			return
		}
		if _, err := zipFile.Write(categoriesData); err != nil {
			http.Error(w, "Failed to write categories in backup", http.StatusInternalServerError)
			return
		}
	}

	// Close the zip writer
	err = zipWriter.Close()
	if err != nil {
		http.Error(w, "Failed to finalize backup", http.StatusInternalServerError)
		return
	}

	// Set headers for file download
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=nextDash-backup.zip")
	w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))

	// Write the zip content to response
	w.Write(buf.Bytes())
}
