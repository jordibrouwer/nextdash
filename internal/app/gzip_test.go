package app

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func gzipRequest(target string, headers map[string]string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return req
}

/*
A byte range is not a document, and compressing one produces nonsense.

The middleware compressed anything with a status of 200 or more except 204 and
304, deleted Content-Length, and left Content-Range alone. So a Range request
for a text asset -- the /static FileServer answers those, and so does
http.ServeFile behind /api/archives/{name} -- came back as a gzip stream
labelled as bytes 0-19 of the uncompressed file. There is no way for a client to
make sense of that.
*/
func TestPartialContentIsNotCompressed(t *testing.T) {
	body := strings.Repeat("compressible text, over and over. ", 200)

	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Header().Set("Content-Range", "bytes 0-19/"+"6600")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.WriteString(w, body[:20])
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, gzipRequest("/static/big.txt", map[string]string{"Range": "bytes=0-19"}))

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q on a 206, want none", got)
	}
	if got := rec.Body.String(); got != body[:20] {
		t.Errorf("body = %q, want the range verbatim", got)
	}
	if got := rec.Header().Get("Content-Range"); got == "" {
		t.Error("Content-Range was dropped")
	}
}

// A Content-Range on a 200 is the same trap wearing a different status, so it
// is refused on the header rather than on the code.
func TestAContentRangeIsNeverCompressed(t *testing.T) {
	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Range", "bytes 0-9/100")
		_, _ = io.WriteString(w, `{"a":"bc"}`)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, gzipRequest("/api/thing", nil))

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q beside a Content-Range, want none", got)
	}
}

// And an ordinary whole answer is still compressed, which is what the
// middleware is for.
func TestAWholeTextResponseIsStillCompressed(t *testing.T) {
	body := strings.Repeat("compressible text, over and over. ", 200)

	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, body)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, gzipRequest("/static/big.txt", nil))

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if rec.Body.Len() >= len(body) {
		t.Errorf("compressed body is %d bytes, source is %d", rec.Body.Len(), len(body))
	}
	zr, err := gzip.NewReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("not a gzip stream: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(got) != body {
		t.Error("the compressed body does not unpack to what was written")
	}
}

/*
The wrapper must not take away what the writer underneath could do.

gzipResponseWriter answered only the ResponseWriter interface, so wrapping a
handler in it silently removed Flush and Hijack -- which a streaming handler
needs and which nothing would report as missing.
*/
func TestGzipWriterKeepsFlushAndHijack(t *testing.T) {
	var sawFlusher, sawHijacker bool

	handler := gzipMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, sawFlusher = w.(http.Flusher)
		_, sawHijacker = w.(http.Hijacker)
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "hello")
	}))

	handler.ServeHTTP(&flushHijackRecorder{ResponseRecorder: httptest.NewRecorder()}, gzipRequest("/x", nil))

	if !sawFlusher {
		t.Error("the handler could not flush through the wrapper")
	}
	if !sawHijacker {
		t.Error("the handler could not hijack through the wrapper")
	}
}

// A recorder that claims both, so the wrapper has something to pass through.
type flushHijackRecorder struct {
	*httptest.ResponseRecorder
}

func (r *flushHijackRecorder) Flush() {}

func (r *flushHijackRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, http.ErrNotSupported
}
