package app

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRedactLogPath(t *testing.T) {
	cases := map[string]string{
		"/s/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG":           "/s/…",
		"/s/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG/data.json": "/s/…/data.json",
		"/s/short":            "/s/…",
		"/api/status-page":    "/api/status-page",
		"/static/status/x.js": "/static/status/x.js",
		"/settings":           "/settings",
	}
	for in, want := range cases {
		if got := redactLogPath(in); got != want {
			t.Errorf("%q = %q, want %q", in, got, want)
		}
	}
}

func TestRequestLogNeverHoldsTheStatusToken(t *testing.T) {
	var buf bytes.Buffer
	old := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(old) })
	setLogLevelForTest(t, logLevelInfoName)

	token := strings.Repeat("Q", 43)
	h := requestLogging(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }))
	for _, p := range []string{"/s/" + token, "/s/" + token + "/data.json"} {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", p, nil))
	}
	if strings.Contains(buf.String(), token) {
		t.Fatalf("token in the request log: %s", buf.String())
	}
	if !strings.Contains(buf.String(), "/s/…") {
		t.Fatalf("redacted path not logged: %s", buf.String())
	}
}
