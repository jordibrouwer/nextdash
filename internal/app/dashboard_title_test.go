package app

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

var titleTag = regexp.MustCompile(`(?s)<title>(.*?)</title>`)

// newTemplateHandlers is newTestHandlers plus the embedded templates, which
// rendering a page needs and the bare test store does not carry.
func newTemplateHandlers(t *testing.T) *Handlers {
	t.Helper()
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	globalOutboundLimiter.reset()
	return NewHandlers(NewStore(), embeddedFiles)
}

func dashboardTitle(t *testing.T, h *Handlers) string {
	t.Helper()
	rec := httptest.NewRecorder()
	h.Dashboard(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	m := titleTag.FindStringSubmatch(rec.Body.String())
	if m == nil {
		t.Fatal("the page has no <title> at all")
	}
	return strings.TrimSpace(m[1])
}

/*
The first paint already says which dashboard this is.

The template rendered "Dashboard" and dashboard-page-nav.js corrected it once
the scripts had run -- so a new tab, a bookmark of the dashboard and the PWA all
caught the generic name first, and whatever was bookmarked kept it.
*/
func TestDashboardTitleNamesTheLandingPage(t *testing.T) {
	h := newTemplateHandlers(t)
	pages := h.store.GetPages()
	if len(pages) == 0 {
		t.Fatal("a fresh store has no pages")
	}

	got := dashboardTitle(t, h)
	if got == "Dashboard" {
		t.Fatal(`the title is still the generic "Dashboard"`)
	}
	if !strings.Contains(got, pages[0].Name) {
		t.Errorf("title = %q, want it to name the landing page %q", got, pages[0].Name)
	}
	if !strings.Contains(got, "nextDash") {
		t.Errorf("title = %q, want the app name in it", got)
	}
}

// A custom title still wins, and still takes the page name only when the
// reader asked for it -- the two branches dashboard-page-nav.js has.
func TestDashboardTitleFollowsTheCustomTitleSettings(t *testing.T) {
	h := newTemplateHandlers(t)
	pageName := h.store.GetPages()[0].Name

	settings := h.store.GetSettings()
	settings.EnableCustomTitle = true
	settings.CustomTitle = "Homebase"
	settings.ShowPageInTitle = false
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if got := dashboardTitle(t, h); got != "Homebase" {
		t.Errorf("title = %q, want just the custom title", got)
	}

	settings.ShowPageInTitle = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	got := dashboardTitle(t, h)
	if !strings.Contains(got, pageName) || !strings.Contains(got, "Homebase") {
		t.Errorf("title = %q, want the page name beside the custom title", got)
	}
}
