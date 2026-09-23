package app

import (
	"net/http"
	"regexp"
	"strings"
)

// generatedIconName matches what saveIconBytes writes, and nothing else: the
// literal "icon-", 8 random bytes as hex, and an extension.
var generatedIconName = regexp.MustCompile(`^icon-[0-9a-f]{16}\.[a-zA-Z0-9]+$`)

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
			/*
			 * Frozen only for the names that earn it.
			 *
			 * A generated name carries 8 random bytes and is never written
			 * twice, so a year-long immutable entry is exactly right -- and
			 * these are the most numerous requests on the dashboard, one per
			 * bookmark, which had no Cache-Control at all before.
			 *
			 * Every other name in this directory was put there by a version
			 * that kept the browser's own filename on an upload, and those are
			 * rewritten in place. Freezing one means a replaced icon never
			 * reaches a browser that saw the old one, and `immutable` defeats a
			 * reload as well. They revalidate instead, like the uploaded
			 * favicon below.
			 */
			if generatedIconName.MatchString(strings.TrimPrefix(rel, "icons/")) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "public, max-age=300")
			}
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
