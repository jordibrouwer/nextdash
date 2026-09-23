package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The /data/ route is deliberately narrow. A bare FileServer over the data
// directory also served settings.json, every bookmarks-N.json, inbox.json and
// the backup ZIPs -- ungated and with directory listings -- while /api/backup
// returns the same content only behind requireWriteAccess. Adding a directory
// means adding a case, never widening the route.
func TestDataFileRouteServesOnlyWhatItNames(t *testing.T) {
	dir := t.TempDir()
	write := func(rel string, body string) {
		full := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("preview-images/pi-abc123.png", "png bytes")
	write("preview-images/nested/deep.png", "png bytes")
	write("icons/icon-0123456789abcdef.png", "png bytes")
	// What an older version wrote: an upload kept the browser's own filename,
	// and those are overwritten in place when the same name comes back.
	write("icons/logo.png", "png bytes")
	write("settings.json", `{"secret":true}`)

	handler := dataFileHandler(dir)

	cases := []struct {
		path       string
		wantStatus int
		wantCache  string
	}{
		// Named for the source URL, so the same address is rewritten in place
		// when a site changes its og:image -- it must revalidate.
		{"/data/preview-images/pi-abc123.png", http.StatusOK, "public, max-age=300"},
		// A generated icon name carries 8 random bytes and is never written
		// twice, so it freezes.
		{"/data/icons/icon-0123456789abcdef.png", http.StatusOK, "public, max-age=31536000, immutable"},
		// A name from before uploads were content-addressed can be rewritten in
		// place, so freezing it would hide the replacement for a year -- past a
		// reload, too. It revalidates instead.
		{"/data/icons/logo.png", http.StatusOK, "public, max-age=300"},
		{"/data/preview-images/nested/deep.png", http.StatusNotFound, ""},
		{"/data/preview-images/", http.StatusNotFound, ""},
		{"/data/settings.json", http.StatusNotFound, ""},
		{"/data/../settings.json", http.StatusNotFound, ""},
	}

	for _, c := range cases {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		if rec.Code != c.wantStatus {
			t.Errorf("GET %s = %d, want %d", c.path, rec.Code, c.wantStatus)
			continue
		}
		if got := rec.Header().Get("Cache-Control"); got != c.wantCache {
			t.Errorf("GET %s Cache-Control = %q, want %q", c.path, got, c.wantCache)
		}
	}
}
