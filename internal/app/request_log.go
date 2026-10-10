package app

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

const requestIDHeader = "X-Request-ID"

type responseRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

// Unwrap hands http.ResponseController the writer underneath, so a handler can
// still reach the connection -- to extend its write deadline, say.
func (r *responseRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func (r *responseRecorder) WriteHeader(code int) {
	if r.status == 0 {
		r.status = code
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func newRequestID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(buf)
}

func shouldSkipRequestLog(path string) bool {
	return strings.HasPrefix(path, "/static/") || strings.HasPrefix(path, "/locales/")
}

func requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldSkipRequestLog(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		reqID := strings.TrimSpace(r.Header.Get(requestIDHeader))
		if reqID == "" {
			reqID = newRequestID()
		}
		w.Header().Set(requestIDHeader, reqID)

		start := time.Now()
		rec := &responseRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)

		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		logRequestLine("%s %s %s %d %dB %s",
			reqID,
			r.Method,
			redactLogPath(r.URL.Path),
			status,
			rec.bytes,
			time.Since(start),
		)
	})
}

// redactLogPath keeps the status page's secret out of the log. The link is
// the only key that page has; a log line read in Config, in docker logs or
// in a support paste must not hand it on.
func redactLogPath(path string) string {
	rest, ok := strings.CutPrefix(path, "/s/")
	if !ok || rest == "" {
		return path
	}
	if _, tail, found := strings.Cut(rest, "/"); found {
		return "/s/…/" + tail
	}
	return "/s/…"
}
