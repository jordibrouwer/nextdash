package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
A capture failure explains itself without handing over the machinery.

The page answered with err.Error(), which is internal text on a surface anyone
holding the bookmarklet can reach, and which told a reader nothing they could
act on. The detail goes to the log, where somebody who can act on it is looking.
*/
func TestCaptureFailureDoesNotEchoTheInternalError(t *testing.T) {
	h := newTestHandlers(t)

	rec := httptest.NewRecorder()
	h.AddCapture(rec, httptest.NewRequest(http.MethodGet, "/add?url=not-a-web-address", nil))

	body := rec.Body.String()
	for _, leak := range []string{"ErrInbox", "internal/app", "goroutine", "*errors."} {
		if strings.Contains(body, leak) {
			t.Errorf("the page carries internal text (%q): %s", leak, body)
		}
	}
}
