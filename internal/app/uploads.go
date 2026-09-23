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

	// The name the browser sent is deliberately not read: what the file is
	// called decides nothing here any more.
	file, _, err := r.FormFile("icon")
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
	default:
		http.Error(w, "Invalid file type. Only ico, png, jpg, gif, webp, svg allowed", http.StatusBadRequest)
		return
	}

	/*
	 * Named for nothing but chance, through the same helper the favicon
	 * prefetcher uses -- which also strips <script> and event handlers out of
	 * an SVG, so that no longer has to be remembered here.
	 *
	 * The browser's filename used to be kept, with "..", "/" and "\\" stripped
	 * out of it. No traversal was reachable, but two consequences were. Two
	 * bookmarks given different pictures both called icon.png meant the second
	 * overwrote the first. And /data/icons/ is served with a year-long
	 * immutable cache entry on the stated premise that these names carry random
	 * bytes and are never rewritten -- true of the prefetcher's names, and not
	 * of anything that came through here. A replaced icon was invisible to
	 * every browser that had already seen the old one, reload or no reload.
	 */
	fileName, err := saveIconBytes(data, ext)
	if err != nil {
		http.Error(w, "Unable to save file", http.StatusInternalServerError)
		return
	}
	if fileName == "" {
		// An SVG that was nothing but script has no picture left in it.
		http.Error(w, "Invalid file type. Only ico, png, jpg, gif, webp, svg allowed", http.StatusBadRequest)
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
