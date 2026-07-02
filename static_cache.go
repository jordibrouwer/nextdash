package main

import (
	"net/http"
	"strings"
)

// applyStaticCacheControl sets long-lived cache headers for versioned static assets.
// Templates append ?v= cache-bust tokens to /static/ URLs.
func applyStaticCacheControl(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("v") != "" {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	ext := strings.ToLower(r.URL.Path)
	switch {
	case strings.HasSuffix(ext, ".css"),
		strings.HasSuffix(ext, ".js"),
		strings.HasSuffix(ext, ".woff"),
		strings.HasSuffix(ext, ".woff2"),
		strings.HasSuffix(ext, ".ttf"),
		strings.HasSuffix(ext, ".otf"),
		strings.HasSuffix(ext, ".png"),
		strings.HasSuffix(ext, ".jpg"),
		strings.HasSuffix(ext, ".jpeg"),
		strings.HasSuffix(ext, ".gif"),
		strings.HasSuffix(ext, ".webp"),
		strings.HasSuffix(ext, ".ico"),
		strings.HasSuffix(ext, ".svg"):
		w.Header().Set("Cache-Control", "public, max-age=86400")
	}
}
