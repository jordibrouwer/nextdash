package app

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// gzipMiddleware transparently gzip-compresses responses for clients that
// advertise support, for text-like content only. Static JS/CSS, HTML pages,
// JSON API responses, and SVG shrink by roughly 70-80%; already-compressed
// binaries (woff2, png, ico, jpg) are left untouched.

// gzipWriterPool reuses gzip.Writer instances across requests to avoid
// per-request allocation of the (fairly large) compressor state.
var gzipWriterPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(io.Discard, gzip.DefaultCompression)
		return w
	},
}

// compressibleContentType reports whether a Content-Type is worth gzipping.
// Anything already compressed (images, fonts, archives) gains nothing and
// only wastes CPU, so we compress only text-like types.
func compressibleContentType(ct string) bool {
	if ct == "" {
		return false
	}
	// Strip any "; charset=..." parameter.
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	ct = strings.TrimSpace(strings.ToLower(ct))
	switch ct {
	case "text/html", "text/css", "text/plain", "text/xml",
		"application/javascript", "text/javascript",
		"application/json", "application/manifest+json",
		"application/xml", "image/svg+xml",
		"application/rss+xml", "application/atom+xml":
		return true
	}
	return false
}

func clientAcceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		if strings.EqualFold(strings.TrimSpace(strings.SplitN(part, ";", 2)[0]), "gzip") {
			return true
		}
	}
	return false
}

// gzipResponseWriter buffers the decision to compress until the first Write,
// once the downstream handler has set Content-Type. If the type is not
// compressible (or the response is already encoded), it streams through
// uncompressed and transparent.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	wroteHeader bool
	compress    bool // decided at first WriteHeader/Write
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true

	h := w.Header()
	// Don't compress: already-encoded responses, or non-compressible types.
	// 1xx/204/304 have no body worth compressing either.
	if h.Get("Content-Encoding") == "" &&
		compressibleContentType(h.Get("Content-Type")) &&
		status != http.StatusNoContent && status != http.StatusNotModified &&
		status >= 200 {
		w.compress = true
		h.Set("Content-Encoding", "gzip")
		// Length changes after compression; let the transport chunk it.
		h.Del("Content-Length")
		gz := gzipWriterPool.Get().(*gzip.Writer)
		gz.Reset(w.ResponseWriter)
		w.gz = gz
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.compress {
		return w.gz.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// close flushes and returns the gzip.Writer to the pool. Safe to call once.
func (w *gzipResponseWriter) close() {
	if w.gz != nil {
		w.gz.Close()
		w.gz.Reset(io.Discard) // drop reference to the real writer before pooling
		gzipWriterPool.Put(w.gz)
		w.gz = nil
	}
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !clientAcceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		// Advertise that responses vary by Accept-Encoding so caches key correctly.
		w.Header().Add("Vary", "Accept-Encoding")

		gw := &gzipResponseWriter{ResponseWriter: w}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}
