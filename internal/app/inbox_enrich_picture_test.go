package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The fetch only names a picture; the local copy came from a worker that writes
// the preview cache and never the inbox item, so a new link never had one.
func TestInboxEnrichmentStoresThePicture(t *testing.T) {
	h := newTestHandlers(t)
	t.Setenv("NEXTDASH_DISABLE_PREFETCH", "")
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82")
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/img.png" || r.URL.Path == "/favicon.ico" {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png)
			return
		}
		fmt.Fprintf(w, `<html><head><title>Hello</title><meta property="og:image" content="%s/img.png"></head><body>x</body></html>`, srv.URL)
	}))
	defer srv.Close()
	link, _, err := h.store.AddInboxLink(InboxLink{URL: srv.URL + "/article"}, true, 500)
	if err != nil {
		t.Fatal(err)
	}
	h.enrichInboxPreviewAsync(link.ID, link.URL)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		for _, it := range h.store.GetInboxItems() {
			if it.ID == link.ID && it.IconFetchedAt != 0 {
				if !strings.HasPrefix(it.PreviewImage, "/data/preview-images/") {
					t.Fatalf("previewImage = %q, want the local copy", it.PreviewImage)
				}
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("never enriched")
}
