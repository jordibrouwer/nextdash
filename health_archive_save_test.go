package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// withSPN points the save and status endpoints at a stub.
func withSPN(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	save, status := spnSaveAPI, spnStatusAPI
	spnSaveAPI = server.URL + "/save"
	spnStatusAPI = server.URL + "/save/status"
	t.Cleanup(func() {
		spnSaveAPI, spnStatusAPI = save, status
		server.Close()
	})
	return server
}

// resetSPNRecent clears the politeness cache, which is process-wide.
func resetSPNRecent(t *testing.T) {
	t.Helper()
	spnRecentlyAsked.Lock()
	spnRecentlyAsked.at = map[string]time.Time{}
	spnRecentlyAsked.Unlock()
}

func withArchiveKeys(t *testing.T, h *Handlers, enabled bool) {
	t.Helper()
	settings := h.store.GetSettings()
	settings.ArchiveSaveEnabled = enabled
	settings.ArchiveSaveAccessKey = "access"
	settings.ArchiveSaveSecret = "secret"
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
}

// The keys are S3-style and go in an Authorization header the archive expects
// verbatim; getting the shape wrong is a silent 403.
func TestSubmitArchiveCaptureSendsTheKeys(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	var gotAuth, gotURL string
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = r.ParseForm()
		gotURL = r.Form.Get("url")
		fmt.Fprint(w, `{"job_id":"spn2-job-1","url":"https://example.com/x"}`)
	})

	result, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x")
	if err != nil {
		t.Fatalf("submit: %v", err)
	}
	if gotAuth != "LOW access:secret" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotURL != "https://example.com/x" {
		t.Errorf("url = %q", gotURL)
	}
	if !result.Queued || result.JobID != "spn2-job-1" {
		t.Errorf("result = %+v, want a queued job", result)
	}
}

/*
The daily budget is shared and finite -- 100.000 captures with keys, and far
fewer without. A dashboard that asked on every save would spend it on pages it
already submitted this morning, so an address asked about recently is skipped.

Skipped is not failed: the caller must be able to tell "already done" from
"could not".
*/
func TestSubmitArchiveCaptureSkipsAnAddressAskedRecently(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	var calls int
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		fmt.Fprintf(w, `{"job_id":"job-%d"}`, calls)
	})

	if _, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x"); err != nil {
		t.Fatalf("first submit: %v", err)
	}
	// The same page, spelled differently: canonicalised, so it is one address
	// rather than three requests against the same budget.
	second, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x/")
	if err != nil {
		t.Fatalf("second submit: %v", err)
	}
	if second.Queued {
		t.Error("queued the same address twice")
	}
	if second.Skipped == "" {
		t.Error("a skip must say it was skipped rather than look like a failure")
	}
	if calls != 1 {
		t.Errorf("made %d requests, want one", calls)
	}
}

// Without keys there is nothing to send, and that is a setup problem the reader
// can fix -- not an upstream failure.
func TestSubmitArchiveCaptureNeedsKeys(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("asked the archive with no keys configured")
	})
	if _, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x"); !errors.Is(err, errSPNNoCredentials) {
		t.Errorf("err = %v, want errSPNNoCredentials", err)
	}
}

// A spent budget needs a different answer from a broken request: one means wait,
// the other means fix something.
func TestSubmitArchiveCaptureReportsARateLimit(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})
	if _, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x"); !errors.Is(err, ErrSPNRateLimited) {
		t.Errorf("err = %v, want ErrSPNRateLimited", err)
	}
}

// This API reports refusals as a 200 with no job id and a sentence. Treating
// that as success would report a capture that will never happen.
func TestSubmitArchiveCaptureRejectsA200WithNoJob(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"message":"This domain is excluded from the Wayback Machine."}`)
	})

	_, err := h.SubmitArchiveCapture(context.Background(), "https://example.com/x")
	if err == nil {
		t.Fatal("a refusal read as a queued capture")
	}
	if !strings.Contains(err.Error(), "excluded") {
		t.Errorf("err = %v, want the archive's own sentence", err)
	}
}

func TestSubmitArchiveCaptureRefusesNonHTTP(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)
	for _, bad := range []string{"", "javascript:void(0)", "file:///etc/passwd"} {
		if _, err := h.SubmitArchiveCapture(context.Background(), bad); err == nil {
			t.Errorf("submitted %q", bad)
		}
	}
}

// A finished capture is worth a link; an unfinished one is not.
func TestArchiveCaptureStatusLinksOnlyWhenDone(t *testing.T) {
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	var body string
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, body)
	})

	// Carrying the fields a link would be built from, so the only thing keeping
	// this from being linked is the status itself.
	body = `{"status":"pending","job_id":"job-1","timestamp":"20260101120000","original_url":"https://example.com/x"}`
	pending, err := h.ArchiveCaptureStatus(context.Background(), "job-1")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if pending.SnapshotURL != "" {
		t.Errorf("linked to a capture that has not happened: %q", pending.SnapshotURL)
	}

	body = `{"status":"success","job_id":"job-1","timestamp":"20260101120000","original_url":"https://example.com/x"}`
	done, err := h.ArchiveCaptureStatus(context.Background(), "job-1")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	want := "https://web.archive.org/web/20260101120000/https://example.com/x"
	if done.SnapshotURL != want {
		t.Errorf("snapshotUrl = %q, want %q", done.SnapshotURL, want)
	}
}

/*
Saving a bookmark must not wait on archive.org.

The whole feature is worthless if it makes the ordinary act of saving a bookmark
take twenty seconds -- that is the version nobody leaves switched on. The
capture is asked for in the background, so a slow or dead archive costs the save
nothing.
*/
func TestArchiveNewBookmarkDoesNotBlockTheSave(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, true)

	var wg sync.WaitGroup
	wg.Add(1)
	release := make(chan struct{})
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		defer wg.Done()
		<-release // hold the request open
		fmt.Fprint(w, `{"job_id":"slow"}`)
	})

	started := time.Now()
	h.archiveNewBookmark("https://example.com/slow")
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Errorf("the save waited %s on the archive", elapsed)
	}

	close(release)
	wg.Wait()
}

// Switched off means no outbound request at all, which is the promise a
// local-first tool makes about every third party it can reach.
func TestArchiveNewBookmarkStaysOffWhenDisabled(t *testing.T) {
	resetSPNRecent(t)
	h := newTestHandlers(t)
	withArchiveKeys(t, h, false)

	var called int32
	withSPN(t, func(w http.ResponseWriter, r *http.Request) {
		called = 1
		fmt.Fprint(w, `{"job_id":"x"}`)
	})

	h.archiveNewBookmark("https://example.com/x")
	time.Sleep(300 * time.Millisecond)
	if called != 0 {
		t.Error("asked the archive while the setting was off")
	}
}
