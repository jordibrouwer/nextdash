package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

/*
A handler that needs longer than the server's WriteTimeout -- a container update
pulling a large image -- extends its own deadline through
http.ResponseController. That only reaches the connection if every wrapper in
between hands back the writer it wraps.
*/
func TestMiddlewareWritersLetAHandlerExtendItsDeadline(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(time.Minute))
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			io.WriteString(w, err.Error())
			return
		}
		io.WriteString(w, "ok")
	})
	srv := httptest.NewServer(requestLogging(gzipMiddleware(securityHeaders(handler))))
	defer srv.Close()
	req, _ := http.NewRequest("GET", srv.URL+"/api/x", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d body = %s", resp.StatusCode, body)
	}
}
