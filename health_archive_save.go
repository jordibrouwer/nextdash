package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"strings"
	"sync"
	"time"
)

/*
Save Page Now: archiving a bookmark the day it is saved, not the day it dies.

Everything else in the health view is diagnosis. It tells you a link is dead,
offers the last capture somebody else happened to take, and that is the end of
what it can do. Which capture exists is not up to you, and for a page nobody
else bookmarked there is usually none at all.

This is the other half. A page captured on the day it was saved is a page that
survives its own site: 38% of what was online in 2013 is gone, and no amount of
monitoring recovers a page that was never archived. Asking the archive to keep a
copy costs one request and turns a decade-long statistic into a solved problem.

Two things shape the code below.

The API is asynchronous. POST /save answers with a job id, and the capture
happens over the following seconds to minutes. Nothing here waits for it: a
bookmark save must not hang on a third party, so the job id is recorded and
whoever cares can ask later.

And it is rate limited per account -- roughly 8.000 captures a day
unauthenticated, 100.000 with keys. A dashboard with two thousand bookmarks that
archives on every save would spend that budget, so this only ever fires for
addresses it has not already asked about.
*/

// spnSaveAPI and spnStatusAPI are vars so a test can point them at a stub.
var (
	spnSaveAPI   = "https://web.archive.org/save"
	spnStatusAPI = "https://web.archive.org/save/status"
)

const (
	// spnRequestTimeout bounds the submit, not the capture. The archive answers
	// with a job id quickly; the work behind it takes as long as it takes.
	spnRequestTimeout = 20 * time.Second
	spnMaxBody        = 64 << 10
	// spnRecentWindow is how long an address is considered already-asked-about.
	// The archive will not usefully re-capture an unchanged page sooner, and
	// this is what keeps a bulk import from spending the day's budget.
	spnRecentWindow = 24 * time.Hour
	// spnMaxRecent bounds the in-memory record of what has been asked. Beyond
	// this the oldest are forgotten, which at worst costs one duplicate request.
	spnMaxRecent = 4096
)

var errSPNNoCredentials = errors.New("no archive.org keys configured")

// ErrSPNRateLimited is what the archive says when the day's budget is spent.
var ErrSPNRateLimited = errors.New("archive.org capture budget reached")

// SPNResult is what one submit produced.
type SPNResult struct {
	JobID string `json:"jobId,omitempty"`
	URL   string `json:"url,omitempty"`
	// Queued is false when the request was deliberately skipped -- already
	// asked recently -- rather than failed, which the caller must not report as
	// an error.
	Queued  bool   `json:"queued"`
	Skipped string `json:"skipped,omitempty"`
}

// spnSubmitResponse is the subset of POST /save's answer that matters.
type spnSubmitResponse struct {
	JobID   string `json:"job_id"`
	URL     string `json:"url"`
	Message string `json:"message"`
	Status  string `json:"status"`
}

/*
spnRecentlyAsked remembers which addresses were submitted, so a page is not
queued twice.

In memory rather than on disk: it is a politeness cache, not state anyone would
miss after a restart, and writing a file per capture request would cost more
than the duplicate request it prevents.
*/
var spnRecentlyAsked = struct {
	sync.Mutex
	at map[string]time.Time
}{at: map[string]time.Time{}}

// spnShouldAsk reports whether this address is due, and records the ask.
func spnShouldAsk(key string, now time.Time) bool {
	if key == "" {
		return false
	}
	spnRecentlyAsked.Lock()
	defer spnRecentlyAsked.Unlock()

	if last, seen := spnRecentlyAsked.at[key]; seen && now.Sub(last) < spnRecentWindow {
		return false
	}
	if len(spnRecentlyAsked.at) >= spnMaxRecent {
		// Drop everything older than the window rather than tracking insertion
		// order: those entries would have expired on their next check anyway.
		for k, at := range spnRecentlyAsked.at {
			if now.Sub(at) >= spnRecentWindow {
				delete(spnRecentlyAsked.at, k)
			}
		}
		// Still full: forget an arbitrary entry rather than growing without
		// bound. The cost of being wrong here is one extra request.
		if len(spnRecentlyAsked.at) >= spnMaxRecent {
			for k := range spnRecentlyAsked.at {
				delete(spnRecentlyAsked.at, k)
				break
			}
		}
	}
	spnRecentlyAsked.at[key] = now
	return true
}

/*
ArchiveKeys are the archive.org S3-style credentials, from settings.

Stored the way the Pushover token has been stored since monitoring shipped:
plainly in settings.json, behind the write token. That is the house precedent
and this does not quietly depart from it -- what it does add is that the keys
never leave the server, which is the part the precedent lacks.
*/
func archiveKeys(s Settings) (accessKey, secret string) {
	return strings.TrimSpace(s.ArchiveSaveAccessKey), strings.TrimSpace(s.ArchiveSaveSecret)
}

/*
SubmitArchiveCapture asks the archive to keep a copy of one page.

Returns without waiting for the capture. The job id is the receipt; the status
endpoint turns it into an answer whenever someone asks.
*/
func (h *Handlers) SubmitArchiveCapture(ctx context.Context, target string) (SPNResult, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return SPNResult{}, errors.New("url is required")
	}
	if parsed, err := neturl.Parse(target); err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return SPNResult{}, errors.New("url must be http or https")
	}

	settings := h.store.GetSettings()
	accessKey, secret := archiveKeys(settings)
	if accessKey == "" || secret == "" {
		return SPNResult{}, errSPNNoCredentials
	}

	// The canonical key, so http/https and a trailing slash are one page rather
	// than three requests against the same budget.
	if !spnShouldAsk(canonicalBookmarkURLKey(target), time.Now()) {
		return SPNResult{Skipped: "asked recently"}, nil
	}

	form := neturl.Values{}
	form.Set("url", target)
	// Capture what the page pulls in, so an archived page still looks like the
	// page. Outlinks are deliberately off: one bookmark must not turn into a
	// crawl of everything it links to, against the same daily budget.
	form.Set("capture_all", "1")
	form.Set("skip_first_archive", "1")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, spnSaveAPI, strings.NewReader(form.Encode()))
	if err != nil {
		return SPNResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "LOW "+accessKey+":"+secret)
	req.Header.Set("User-Agent", updateCheckUserAgent)

	client := h.outboundHTTPClient(spnRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return SPNResult{}, err
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(resp.Body, spnMaxBody))
	if readErr != nil {
		return SPNResult{}, readErr
	}

	switch {
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return SPNResult{}, errors.New("archive.org rejected those keys")
	case resp.StatusCode == http.StatusTooManyRequests:
		return SPNResult{}, ErrSPNRateLimited
	case resp.StatusCode >= 400:
		return SPNResult{}, fmt.Errorf("archive.org answered %d", resp.StatusCode)
	}

	var parsed spnSubmitResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return SPNResult{}, fmt.Errorf("archive.org sent something that is not a job: %w", err)
	}
	if strings.TrimSpace(parsed.JobID) == "" {
		// A 200 with no job id is how this API reports refusals -- an excluded
		// domain, a spent budget stated in prose. The message is the answer.
		if msg := strings.TrimSpace(parsed.Message); msg != "" {
			return SPNResult{}, errors.New(msg)
		}
		return SPNResult{}, errors.New("archive.org returned no job id")
	}

	return SPNResult{JobID: parsed.JobID, URL: target, Queued: true}, nil
}

// SPNStatus is where a submitted capture got to.
type SPNStatus struct {
	JobID     string `json:"jobId"`
	Status    string `json:"status"`
	Timestamp string `json:"timestamp,omitempty"`
	// SnapshotURL is filled once the capture exists, so the caller has
	// something to link to without going back to the index.
	SnapshotURL string `json:"snapshotUrl,omitempty"`
	Message     string `json:"message,omitempty"`
}

type spnStatusResponse struct {
	Status      string `json:"status"`
	JobID       string `json:"job_id"`
	Timestamp   string `json:"timestamp"`
	OriginalURL string `json:"original_url"`
	Message     string `json:"message"`
}

// ArchiveCaptureStatus turns a job id into an answer.
func (h *Handlers) ArchiveCaptureStatus(ctx context.Context, jobID string) (SPNStatus, error) {
	jobID = strings.TrimSpace(jobID)
	if jobID == "" {
		return SPNStatus{}, errors.New("job id is required")
	}

	settings := h.store.GetSettings()
	accessKey, secret := archiveKeys(settings)
	if accessKey == "" || secret == "" {
		return SPNStatus{}, errSPNNoCredentials
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, spnStatusAPI+"/"+neturl.PathEscape(jobID), nil)
	if err != nil {
		return SPNStatus{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "LOW "+accessKey+":"+secret)
	req.Header.Set("User-Agent", updateCheckUserAgent)

	client := h.outboundHTTPClient(spnRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return SPNStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return SPNStatus{}, fmt.Errorf("archive.org answered %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, spnMaxBody))
	if err != nil {
		return SPNStatus{}, err
	}

	var parsed spnStatusResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return SPNStatus{}, fmt.Errorf("archive.org sent something that is not a status: %w", err)
	}

	status := SPNStatus{
		JobID:     jobID,
		Status:    strings.TrimSpace(parsed.Status),
		Timestamp: strings.TrimSpace(parsed.Timestamp),
		Message:   strings.TrimSpace(parsed.Message),
	}
	// Only a finished capture has somewhere to point.
	if status.Status == "success" && status.Timestamp != "" && strings.TrimSpace(parsed.OriginalURL) != "" {
		status.SnapshotURL = "https://web.archive.org/web/" + status.Timestamp + "/" + strings.TrimSpace(parsed.OriginalURL)
	}
	return status, nil
}

// SaveArchiveCapture answers POST /api/health/archive-save.
func (h *Handlers) SaveArchiveCapture(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}

	target := strings.TrimSpace(r.URL.Query().Get("url"))
	result, err := h.SubmitArchiveCapture(r.Context(), target)
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		// Every one of these is something the reader can act on -- add keys,
		// wait for the budget, fix the address -- so the message goes back
		// rather than a bare status.
		status := http.StatusBadGateway
		switch {
		case errors.Is(err, errSPNNoCredentials):
			status = http.StatusPreconditionFailed
		case errors.Is(err, ErrSPNRateLimited):
			status = http.StatusTooManyRequests
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(result)
}

// ArchiveCaptureStatusHandler answers GET /api/health/archive-save-status.
func (h *Handlers) ArchiveCaptureStatusHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	status, err := h.ArchiveCaptureStatus(r.Context(), r.URL.Query().Get("jobId"))
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(status)
}

/*
archiveNewBookmark asks for a capture in the background, if that is switched on.

Deliberately fire-and-forget, on its own context: saving a bookmark is a local
write and must not wait on archive.org, nor fail because archive.org did. A
capture that does not happen costs nothing today; a save that hangs for twenty
seconds is the feature nobody leaves on.
*/
func (h *Handlers) archiveNewBookmark(target string) {
	settings := h.store.GetSettings()
	if !settings.ArchiveSaveEnabled {
		return
	}
	if accessKey, secret := archiveKeys(settings); accessKey == "" || secret == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), spnRequestTimeout+5*time.Second)
		defer cancel()
		result, err := h.SubmitArchiveCapture(ctx, target)
		if err != nil {
			if !errors.Is(err, errSPNNoCredentials) {
				logArchiveCaptureFailure(target, err)
			}
			return
		}
		// The receipt, kept on the bookmark. Without it the status route has
		// nothing to look up, and a capture that was queued is indistinguishable
		// from one the archive quietly refused.
		if result.Queued && result.JobID != "" {
			h.recordArchiveJob(target, result.JobID)
		}
	}()
}

// logArchiveCaptureFailure records a capture that did not happen. One line, at
// the level the rest of the outbound work uses: the reader did not ask for this
// request and should not be interrupted by it failing.
func logArchiveCaptureFailure(target string, err error) {
	log.Printf("archive: could not queue a capture for %s: %v", target, err)
}

/*
ArchiveKeysStatus is what the config panel is told: whether keys are stored,
never what they are.

A route of its own rather than reading them off /api/settings, which hands back
every credential it holds -- the Pushover token has travelled in that payload
since monitoring shipped. That is existing behaviour and not this feature's to
change, but there is no reason for a second pair of keys to inherit it.
*/
type ArchiveKeysStatus struct {
	Enabled   bool   `json:"enabled"`
	HasKeys   bool   `json:"hasKeys"`
	LastJob   string `json:"lastJob,omitempty"`
	LastError string `json:"lastError,omitempty"`
}

// ArchiveSettingsHandler answers GET and PUT on /api/health/archive-settings.
func (h *Handlers) ArchiveSettingsHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	if r.Method == http.MethodGet {
		settings := h.store.GetSettings()
		accessKey, secret := archiveKeys(settings)
		writeJSON(w, ArchiveKeysStatus{
			Enabled: settings.ArchiveSaveEnabled,
			HasKeys: accessKey != "" && secret != "",
		})
		return
	}

	var body struct {
		Enabled   *bool   `json:"enabled"`
		AccessKey *string `json:"accessKey"`
		Secret    *string `json:"secret"`
		// Forget clears both keys and switches archiving off, which cannot
		// happen by submitting an empty field.
		Forget bool `json:"forget"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	settings := h.store.GetSettings()
	if body.Forget {
		settings.ArchiveSaveAccessKey = ""
		settings.ArchiveSaveSecret = ""
		settings.ArchiveSaveEnabled = false
	} else {
		// An empty field means "keep what is stored". The panel never receives
		// the keys, so it submits blanks for anything the reader did not
		// retype -- and that must not erase them.
		if body.AccessKey != nil && strings.TrimSpace(*body.AccessKey) != "" {
			settings.ArchiveSaveAccessKey = strings.TrimSpace(*body.AccessKey)
		}
		if body.Secret != nil && strings.TrimSpace(*body.Secret) != "" {
			settings.ArchiveSaveSecret = strings.TrimSpace(*body.Secret)
		}
		if body.Enabled != nil {
			settings.ArchiveSaveEnabled = *body.Enabled
		}
	}

	if err := h.store.SaveSettings(settings); err != nil {
		http.Error(w, "Could not save", http.StatusInternalServerError)
		return
	}
	accessKey, secret := archiveKeys(settings)
	writeJSON(w, ArchiveKeysStatus{
		Enabled: settings.ArchiveSaveEnabled,
		HasKeys: accessKey != "" && secret != "",
	})
}

/*
recordArchiveJob writes the receipt onto every bookmark with this address.

Across pages, because the same URL can be bookmarked on more than one and the
capture was asked for once on behalf of all of them.
*/
func (h *Handlers) recordArchiveJob(target, jobID string) {
	key := canonicalBookmarkURLKey(target)
	if key == "" || jobID == "" {
		return
	}
	now := time.Now().UnixMilli()
	for _, page := range h.store.GetPages() {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		changed := false
		for i := range bookmarks {
			if canonicalBookmarkURLKey(bookmarks[i].URL) != key {
				continue
			}
			bookmarks[i].ArchiveJobID = jobID
			bookmarks[i].ArchiveJobAt = now
			changed = true
		}
		if changed {
			_ = h.store.SaveBookmarksByPage(page.ID, bookmarks)
		}
	}
}
