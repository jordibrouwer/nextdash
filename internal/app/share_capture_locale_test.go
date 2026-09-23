package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
The capture page answers in the install's language.

It is the one surface a reader meets that no script ever touches -- the
bookmarklet lands on it and there is nothing to fetch a locale file -- so it was
English whatever the install was set to, in a product that holds six locales in
exact parity and validates them three ways. It is also the only place a capture
failure is explained.
*/
func captureBody(t *testing.T, h *Handlers, target string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	h.AddCapture(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec.Body.String()
}

func TestCapturePageFollowsTheInstallLanguage(t *testing.T) {
	h := newTemplateHandlers(t)

	english := captureBody(t, h, "/add")
	if !strings.Contains(english, "Nothing to save") {
		t.Fatalf("the English page does not say what went wrong: %s", english)
	}

	settings := h.store.GetSettings()
	settings.Language = "nl"
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	dutch := captureBody(t, h, "/add")
	if strings.Contains(dutch, "Nothing to save") {
		t.Errorf("the page is still English with the install set to Dutch: %s", dutch)
	}
	if !strings.Contains(dutch, "Niets om op te slaan") {
		t.Errorf("the page does not carry the Dutch string: %s", dutch)
	}
	// The way back is translated too, not just the headline.
	if !strings.Contains(dutch, "Open de inbox") {
		t.Errorf("the link back is still English: %s", dutch)
	}
}

// A language with no file, or a key a translator has not reached yet, falls
// back to English rather than to a bare key.
func TestCapturePageFallsBackToEnglish(t *testing.T) {
	h := newTemplateHandlers(t)
	settings := h.store.GetSettings()
	settings.Language = "qq-not-a-language"
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}

	body := captureBody(t, h, "/add")
	if !strings.Contains(body, "Nothing to save") {
		t.Errorf("an unknown language did not fall back to English: %s", body)
	}
	if strings.Contains(body, "others.capture") {
		t.Errorf("a raw key reached the page: %s", body)
	}
}
