package app

import (
	"net/http"
	"strings"
)

/*
 * Serving files out of the data directory, and nothing else.
 *
 * Narrowed to what the UI actually links: data/icons/*, data/preview-images/*,
 * and the uploaded favicon/font at the data root. A bare FileServer over the
 * whole data directory also served settings.json, every bookmarks-N.json,
 * inbox.json, trash.json and the auto-backup ZIPs -- ungated and with directory
 * listings, while /api/backup returns the same content only behind
 * requireWriteAccess.
 *
 * Lifted out of Run() so the cases can be tested directly. Adding a directory
 * here means adding a case; there is deliberately no way to widen it at once.
 */
func dataFileHandler(dataDir string) http.HandlerFunc {
	fileServer := http.StripPrefix("/data/", http.FileServer(http.Dir(dataDir)))

	return func(w http.ResponseWriter, req *http.Request) {
		rel := strings.TrimPrefix(req.URL.Path, "/data/")
		if rel == "" || strings.Contains(rel, "..") {
			http.NotFound(w, req)
			return
		}
		switch {
		case isBareFileUnder(rel, "icons/"):
			// Icon filenames carry 8 random bytes and are never rewritten in
			// place, so they can be frozen. These are the most numerous requests
			// on the dashboard -- one per bookmark -- and had no Cache-Control at
			// all, costing a conditional round trip each on every load.
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		case isBareFileUnder(rel, previewImageDirName+"/"):
			// Named for the source URL rather than for its bytes, so the same
			// address is rewritten in place when a site changes its og:image.
			// That rules out `immutable`: it has to revalidate, the way the
			// uploaded favicon below does.
			w.Header().Set("Cache-Control", "public, max-age=300")
		case strings.HasPrefix(rel, "favicon.") || strings.HasPrefix(rel, "font."):
			// Overwritten in place by the upload handlers, so it must revalidate.
			w.Header().Set("Cache-Control", "public, max-age=300")
		default:
			http.NotFound(w, req)
			return
		}
		fileServer.ServeHTTP(w, req)
	}
}

// isBareFileUnder matches one directory level and no deeper: a nested path is
// not part of any case, so it falls through to the 404 rather than being served.
func isBareFileUnder(rel, prefix string) bool {
	if !strings.HasPrefix(rel, prefix) {
		return false
	}
	name := strings.TrimPrefix(rel, prefix)
	return name != "" && !strings.Contains(name, "/")
}
