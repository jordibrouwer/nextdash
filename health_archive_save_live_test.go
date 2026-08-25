package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

/*
What archive.org actually answers, and what the reader is told about it.

SPN2 had only ever been exercised against a stub. Measured against the real
service on 25 August 2026, with no keys and with keys it does not accept:

	POST /save            -> 401 application/json
	                         {"message":"You need to be logged in to use Save Page Now."}
	GET  /save/status/... -> 401, the same body

Authorisation is checked before anything else -- an excluded domain answers the
same 401 -- and the body is always JSON carrying the reason. Reporting the
status code alone discards the only sentence that tells someone what to do.
*/
func TestSPNSurfacesTheArchivesOwnRefusal(t *testing.T) {
	const realMessage = "You need to be logged in to use Save Page Now."

	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"the refusal measured live", http.StatusUnauthorized,
			`{"message":"` + realMessage + `"}`, realMessage},
		{"a domain the archive will not take", http.StatusForbidden,
			`{"message":"This URL is in the exclusion list."}`, "exclusion list"},
		// An outage answers HTML, and a wall of markup is not an error message.
		{"an outage page", http.StatusBadGateway, "<html><body>502 Bad Gateway</body></html>",
			"archive.org answered 502"},
		{"a JSON body with nothing in it", http.StatusInternalServerError, `{"message":"  "}`,
			"archive.org answered 500"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Driven through SubmitArchiveCapture rather than the helper alone:
			// a helper that reads the message proves nothing if the caller
			// never asks it.
			h := newTestHandlers(t)
			withArchiveKeys(t, h, true)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			previous := spnSaveAPI
			spnSaveAPI = server.URL
			defer func() { spnSaveAPI = previous }()

			_, err := h.SubmitArchiveCapture(context.Background(), uniqueSPNTarget(tc.name))
			if err == nil {
				t.Fatal("no error for a refusal")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("got %q, want it to mention %q", err.Error(), tc.want)
			}
			if strings.Contains(err.Error(), "<html>") {
				t.Errorf("HTML surfaced as an error message: %v", err)
			}
		})
	}
}

// Submissions are deduplicated per canonical URL, so each case needs its own.
func uniqueSPNTarget(name string) string {
	return "https://example.com/" + strings.ReplaceAll(name, " ", "-")
}

/*
The status endpoint checks authorisation before it looks at the job id, so keys
that expire between submitting a capture and asking after it land there. That
path reported the bare status code and had no branch for 401 at all.
*/
func TestArchiveCaptureStatusReportsRejectedKeys(t *testing.T) {
	h := newTestHandlers(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"You need to be logged in to use Save Page Now."}`))
	}))
	defer server.Close()

	withArchiveKeys(t, h, true)

	previous := spnStatusAPI
	spnStatusAPI = server.URL
	defer func() { spnStatusAPI = previous }()

	_, err := h.ArchiveCaptureStatus(context.Background(), "some-job-id")
	if err == nil {
		t.Fatal("no error for keys the archive rejects")
	}
	if !strings.Contains(err.Error(), "logged in") {
		t.Errorf("the archive's own words were dropped: %v", err)
	}
}

/*
A refusal must not spend the address's turn.

The submission window exists so fifty bookmarks on one host do not become fifty
requests, and it is recorded before the request goes out. That is right for a
capture the archive accepts and wrong for one it refuses: measured live, keys it
does not accept answer 401, and someone correcting them presses the button again
within the same window. Before this, the second press answered "asked recently"
and nothing reached the archive for an hour.
*/
func TestARefusalDoesNotSpendTheSubmissionWindow(t *testing.T) {
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	const target = "https://example.com/retry-after-a-refusal"
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.Header().Set("Content-Type", "application/json")
		if attempts == 1 {
			// The keys were wrong the first time.
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"You need to be logged in to use Save Page Now."}`))
			return
		}
		_, _ = w.Write([]byte(`{"job_id":"spn2-job-1"}`))
	}))
	defer server.Close()

	previous := spnSaveAPI
	spnSaveAPI = server.URL
	defer func() { spnSaveAPI = previous }()

	if _, err := h.SubmitArchiveCapture(context.Background(), target); err == nil {
		t.Fatal("the first attempt should have been refused")
	}

	// The correction, immediately: the same address, inside the same window.
	result, err := h.SubmitArchiveCapture(context.Background(), target)
	if err != nil {
		t.Fatalf("the retry was refused: %v", err)
	}
	if result.Skipped != "" {
		t.Fatalf("the retry was skipped as %q, so the refusal held the window", result.Skipped)
	}
	if result.JobID != "spn2-job-1" {
		t.Errorf("no job id from the retry: %+v", result)
	}
	if attempts != 2 {
		t.Errorf("the archive saw %d attempts, want 2", attempts)
	}
}

// A capture that was accepted still holds its place, which is what the window
// is for.
func TestAQueuedCaptureKeepsItsPlaceInTheWindow(t *testing.T) {
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	const target = "https://example.com/queued-once"
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"job_id":"spn2-job-2"}`))
	}))
	defer server.Close()

	previous := spnSaveAPI
	spnSaveAPI = server.URL
	defer func() { spnSaveAPI = previous }()

	if _, err := h.SubmitArchiveCapture(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	second, err := h.SubmitArchiveCapture(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if second.Skipped == "" {
		t.Error("the same page was submitted twice inside the window")
	}
	if attempts != 1 {
		t.Errorf("the archive saw %d attempts, want 1", attempts)
	}
}

/*
A spent budget arrives as a 200, not a 429.

Measured live on 25 August 2026 with real keys: a sixth capture of the same page
in one day answered

	HTTP 200
	{"status":"error","status_ext":"error:too-many-daily-captures",
	 "message":"This URL has been already captured 5 times today, ..."}

so the http.StatusTooManyRequests branch never fires for the case it was written
for. Without reading status_ext the caller cannot tell "wait until tomorrow"
from "this address will never work", and the handler cannot answer 429 -- which
is the signal a queue needs in order to stop rather than retry.
*/
func TestASpentDailyBudgetIsRecognisedDespiteThe200(t *testing.T) {
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	const measured = `{"status":"error","status_ext":"error:too-many-daily-captures",` +
		`"message":"This URL has been already captured 5 times today, which is a daily limit we have set for that Resource type."}`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// The status the archive really sends for this.
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(measured))
	}))
	defer server.Close()

	previous := spnSaveAPI
	spnSaveAPI = server.URL
	defer func() { spnSaveAPI = previous }()

	_, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/spent-budget")
	if err == nil {
		t.Fatal("a refusal was reported as success")
	}
	if !errors.Is(err, ErrSPNRateLimited) {
		t.Errorf("not recognised as a spent budget, so the handler cannot answer 429: %v", err)
	}
	// The archive's own sentence still reaches the reader.
	if !strings.Contains(err.Error(), "captured 5 times today") {
		t.Errorf("the explanation was dropped: %v", err)
	}
}

// A refusal that is not about the budget must not be reported as one, or a
// queue waits until tomorrow for an address that will never work.
func TestAnExcludedAddressIsNotMistakenForASpentBudget(t *testing.T) {
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"error","status_ext":"error:invalid-url-syntax","message":"URL syntax is not valid."}`))
	}))
	defer server.Close()

	previous := spnSaveAPI
	spnSaveAPI = server.URL
	defer func() { spnSaveAPI = previous }()

	_, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/excluded")
	if err == nil {
		t.Fatal("a refusal was reported as success")
	}
	if errors.Is(err, ErrSPNRateLimited) {
		t.Error("an address the archive will not take was reported as a spent budget")
	}
	if !strings.Contains(err.Error(), "syntax") {
		t.Errorf("the explanation was dropped: %v", err)
	}
}
