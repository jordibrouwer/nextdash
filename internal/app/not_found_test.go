package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
A mistyped address gets a page with a way back.

Nothing registered a NotFoundHandler, so the router fell through to net/http's
own "404 page not found": plain text, white page, no link anywhere -- in an app
whose whole business is addresses people keep, and which is therefore mistyped
and stale-bookmarked more than most.
*/
func TestNotFoundServesAPageWithAWayBack(t *testing.T) {
	h := newTemplateHandlers(t)

	rec := httptest.NewRecorder()
	h.NotFoundHandler(rec, httptest.NewRequest(http.MethodGet, "/no-such-place", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Errorf("Content-Type = %q, want HTML", ct)
	}
	body := rec.Body.String()
	if strings.TrimSpace(body) == "404 page not found" {
		t.Fatal("this is still Go's own answer")
	}
	if !strings.Contains(body, `href="/"`) {
		t.Errorf("the page offers no way back: %s", body)
	}
	if !strings.Contains(body, "Nothing here") {
		t.Errorf("the page does not say what happened: %s", body)
	}
}

// And it answers in the install's language, through the same reader the capture
// page uses.
func TestNotFoundFollowsTheInstallLanguage(t *testing.T) {
	h := newTemplateHandlers(t)
	settings := h.store.GetSettings()
	settings.Language = "nl"
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	h.NotFoundHandler(rec, httptest.NewRequest(http.MethodGet, "/no-such-place", nil))

	body := rec.Body.String()
	if !strings.Contains(body, "Hier staat niets") {
		t.Errorf("the page is not in Dutch: %s", body)
	}
	if !strings.Contains(body, `lang="nl"`) {
		t.Errorf("the page does not declare its language: %s", body)
	}
}

/*
An API path keeps a plain answer.

What is on the other end of /api/ is a fetch, and a page of HTML where JSON was
expected is harder to read than the one line it replaces.
*/
func TestNotFoundKeepsAPIAnswersPlain(t *testing.T) {
	h := newTemplateHandlers(t)

	rec := httptest.NewRecorder()
	h.NotFoundHandler(rec, httptest.NewRequest(http.MethodGet, "/api/no-such-route", nil))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "<html") {
		t.Errorf("an API route was answered with a page: %s", rec.Body.String())
	}
}
