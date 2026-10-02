package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
The page tells Dark Reader to leave it alone.

nextDash draws its own dark themes, and the extension rewrites colour custom
properties as it goes. A long gradient such as a backdrop recipe came out of
that invalid, so the backdrop was missing on a page opened from a link and
back after a refresh. The lock has to be in the <head> of the first response,
before the extension's own script runs.
*/
func TestDashboardHeadLocksDarkReader(t *testing.T) {
	h := newTemplateHandlers(t)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	body := rec.Body.String()
	head, _, found := strings.Cut(body, "</head>")
	if !found {
		t.Fatal("the page has no </head>")
	}
	if !strings.Contains(head, `<meta name="darkreader-lock">`) {
		t.Error(`the <head> has no <meta name="darkreader-lock">`)
	}
}
