package app

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// UploadFavicon handles favicon file uploads
func (h *Handlers) UploadFavicon(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, "Unable to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("favicon")
	if err != nil {
		http.Error(w, "Error retrieving file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read content for magic-byte detection
	data, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		http.Error(w, "Unable to read file", http.StatusInternalServerError)
		return
	}

	contentType := detectImageType(data)
	var ext string
	switch contentType {
	case "image/x-icon":
		ext = ".ico"
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	case "image/gif":
		ext = ".gif"
	default:
		http.Error(w, "Invalid file type. Only ico, png, jpg, gif allowed", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(ResolveDataDir(), 0755); err != nil {
		http.Error(w, "Unable to create directory", http.StatusInternalServerError)
		return
	}

	faviconPath := filepath.Join(ResolveDataDir(), "favicon"+ext)
	if err := os.WriteFile(faviconPath, data, 0644); err != nil {
		http.Error(w, "Unable to save file", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()
	settings.CustomFaviconPath = "/data/favicon" + ext
	if !respondStorePersistError(w, h.store.SaveSettings(settings)) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "path": settings.CustomFaviconPath})
}

// UploadFont handles custom font file uploads
func (h *Handlers) UploadFont(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	// Parse multipart form
	err := r.ParseMultipartForm(10 << 20) // 10 MB max
	if err != nil {
		http.Error(w, "Unable to parse form", http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("font")
	if err != nil {
		http.Error(w, "Error retrieving file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		http.Error(w, "Unable to read file", http.StatusInternalServerError)
		return
	}

	contentType := detectFontType(data)
	ext := fontExtensionFromDetectedType(contentType)
	if ext == "" {
		http.Error(w, "Invalid file type. Only woff, woff2, ttf, otf allowed", http.StatusBadRequest)
		return
	}

	dataDir := ResolveDataDir()
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		http.Error(w, "Unable to create directory", http.StatusInternalServerError)
		return
	}

	fontPath := filepath.Join(dataDir, "font"+ext)
	if err := os.WriteFile(fontPath, data, 0644); err != nil {
		http.Error(w, "Unable to save file", http.StatusInternalServerError)
		return
	}

	// Update settings with the new font path
	settings := h.store.GetSettings()
	settings.CustomFontPath = "/data/font" + ext
	if !respondStorePersistError(w, h.store.SaveSettings(settings)) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "path": settings.CustomFontPath})
}

// UploadIcon handles bookmark icon file uploads
func (h *Handlers) UploadIcon(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	err := r.ParseMultipartForm(10 << 20)
	if err != nil {
		http.Error(w, "Unable to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("icon")
	if err != nil {
		http.Error(w, "Error retrieving file", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Read content for magic-byte detection (before trusting client Content-Type)
	data, err := io.ReadAll(io.LimitReader(file, 10<<20))
	if err != nil {
		http.Error(w, "Unable to read file", http.StatusInternalServerError)
		return
	}

	contentType := detectImageType(data)
	var ext string
	switch contentType {
	case "image/x-icon":
		ext = ".ico"
	case "image/png":
		ext = ".png"
	case "image/jpeg":
		ext = ".jpg"
	case "image/gif":
		ext = ".gif"
	case "image/webp":
		ext = ".webp"
	case "image/svg+xml":
		ext = ".svg"
		// Strip <script> blocks and event-handler attributes from SVG
		data = sanitizeSVGContent(data)
	default:
		http.Error(w, "Invalid file type. Only ico, png, jpg, gif, webp, svg allowed", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(filepath.Join(ResolveDataDir(), "icons"), 0755); err != nil {
		http.Error(w, "Unable to create directory", http.StatusInternalServerError)
		return
	}

	// Sanitize filename: strip path traversal characters
	baseName := strings.TrimSuffix(header.Filename, filepath.Ext(header.Filename))
	baseName = strings.ReplaceAll(baseName, "..", "")
	baseName = strings.ReplaceAll(baseName, "/", "")
	baseName = strings.ReplaceAll(baseName, "\\", "")

	fileName := baseName + ext
	if strings.TrimSpace(baseName) == "" {
		fileName = "icon-" + randomHex(8) + ext
	}
	filePath := filepath.Join(ResolveDataDir(), "icons", fileName)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		http.Error(w, "Unable to save file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "icon": fileName})
}

// UploadIconFromURL handles bookmark icon download from URL and stores it locally.
func (h *Handlers) UploadIconFromURL(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	type iconURLRequest struct {
		URL string `json:"url"`
	}

	var payload iconURLRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}

	sourceURL := strings.TrimSpace(payload.URL)
	if sourceURL == "" {
		http.Error(w, "Missing icon URL", http.StatusBadRequest)
		return
	}

	fileName, err := downloadIconFromURL(sourceURL, h.allowLocalBookmarks())
	if err != nil {
		http.Error(w, "Unable to fetch icon URL", http.StatusBadRequest)
		return
	}
	if fileName == "" {
		http.Error(w, "Icon URL returned no usable image", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "icon": fileName})
}

func iconExtensionFromContentType(contentType string) (string, bool) {
	switch contentType {
	case "image/x-icon", "image/vnd.microsoft.icon":
		return ".ico", true
	case "image/png":
		return ".png", true
	case "image/jpeg":
		return ".jpg", true
	case "image/gif":
		return ".gif", true
	case "image/svg+xml":
		return ".svg", true
	case "image/webp":
		return ".webp", true
	default:
		return "", false
	}
}

func randomHex(byteLen int) string {
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}
