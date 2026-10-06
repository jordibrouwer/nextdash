package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

var githubLatestReleaseURL = "https://api.github.com/repos/jordibrouwer/nextdash/releases/latest"

// githubReleaseListURL is read first so the highest version wins regardless of
// publication order; githubLatestReleaseURL is the fallback.
//
// Derived from githubLatestReleaseURL rather than declared alongside it, so
// that pointing the latter at a test server redirects both. Two independent
// vars let a test stub one and silently reach the real API with the other.
func releaseListURL() string {
	base := strings.TrimSuffix(strings.TrimSpace(githubLatestReleaseURL), "/latest")
	return base + "?per_page=30"
}

const (
	updateCheckCacheTTL       = 24 * time.Hour
	updateCheckRequestTimeout = 10 * time.Second
	updateCheckUserAgent      = "nextDash-update-check"
)

// UpdateStatusResponse is returned by GET /api/update-status.
type UpdateStatusResponse struct {
	Enabled         bool   `json:"enabled"`
	Current         string `json:"current"`
	Latest          string `json:"latest,omitempty"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl,omitempty"`
	CheckedAt       int64  `json:"checkedAt,omitempty"`
	Source          string `json:"source,omitempty"`
	Error           string `json:"error,omitempty"`
	// ErrorCode says why the check failed, for the client to explain:
	// rate-limited, local-limit, unreachable or http.
	ErrorCode string `json:"errorCode,omitempty"`
	// RetryAt is when the next try goes out after a failure, Unix ms.
	RetryAt int64 `json:"retryAt,omitempty"`
	// Authenticated is true when the check ran with the GitHub token from
	// Config -> Containers, which lifts the hourly limit from 60 to 5000.
	Authenticated bool `json:"authenticated,omitempty"`
}

type upstreamReleaseInfo struct {
	Tag         string
	ReleaseURL  string
	PublishedAt string
}

type updateCheckCacheEntry struct {
	info      upstreamReleaseInfo
	fetchedAt time.Time
	err       error
	// etag is the release listing's ETag for info. Sent back as If-None-Match,
	// GitHub answers 304 when nothing changed, and a 304 does not count
	// against the hourly limit. Kept across failures, with info, so the next
	// try can still ask conditionally.
	etag          string
	authenticated bool
}

// updateCheckDisabledByEnv reports whether DISABLE_UPDATE_CHECK switches the
// GitHub release check off server-wide, regardless of user settings.
func updateCheckDisabledByEnv() bool {
	raw := strings.TrimSpace(os.Getenv("DISABLE_UPDATE_CHECK"))
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func updateCheckEnabled(settings Settings) bool {
	if updateCheckDisabledByEnv() {
		return false
	}
	return settings.UpdateCheckEnabled
}

// calendarVersionFloor is the first segment above which a tag is read as a
// calendar version rather than a semantic one.
//
// nextDash tagged releases as vYYYY.MM.N for its whole life and is moving to
// semver, which breaks a plain numeric comparison: 1 is less than 2026, so
// v1.0.0 would read as older than every release before it and no running
// install would ever be told an update exists. Nothing else separates the two
// schemes — both are dot-separated integers — so the year is the signal, and
// 1000 is chosen simply because no semantic major version will plausibly reach
// it while every calendar year clears it.
const calendarVersionFloor = 1000

// releaseTagScheme reports whether a tag's segments read as a calendar version.
func releaseTagIsCalendar(parts []int) bool {
	return len(parts) > 0 && parts[0] >= calendarVersionFloor
}

// compareReleaseTags compares tags like v2026.08.02.3 or v1.2.0 using numeric
// segment ordering, matching the What's new modal sort in whats-new-modal.js.
//
// A semantic tag always sorts above a calendar one, whatever the numbers say.
// That is the whole point of the switch: v1.0.0 succeeds v2026.09.09.3, and
// comparing them segment by segment would conclude the opposite.
func compareReleaseTags(a, b string) int {
	pa := releaseTagParts(a)
	pb := releaseTagParts(b)

	// Only when both parse. An unparseable tag has no segments and falls
	// through to the numeric path below, which treats it as all-zero — the
	// existing behaviour for junk input, kept deliberately.
	if len(pa) > 0 && len(pb) > 0 {
		calA, calB := releaseTagIsCalendar(pa), releaseTagIsCalendar(pb)
		if calA != calB {
			if calA {
				return -1 // a is the old calendar scheme, b is semver
			}
			return 1
		}
	}

	maxLen := len(pa)
	if len(pb) > maxLen {
		maxLen = len(pb)
	}
	for i := 0; i < maxLen; i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va = pa[i]
		}
		if i < len(pb) {
			vb = pb[i]
		}
		if va < vb {
			return -1
		}
		if va > vb {
			return 1
		}
	}
	return 0
}

func releaseTagParts(tag string) []int {
	tag = strings.TrimSpace(tag)
	tag = strings.TrimPrefix(tag, "v")
	if tag == "" {
		return nil
	}
	segments := strings.Split(tag, ".")
	out := make([]int, 0, len(segments))
	for _, seg := range segments {
		n, err := strconv.Atoi(strings.TrimSpace(seg))
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}

// updateCheckErrorRetry is how long a failed update check is kept before a
// read tries again.
const updateCheckErrorRetry = 15 * time.Minute

// updateCheckLocalLimitRetry is the wait after nextDash's own outbound limiter
// turned the request down: that window is a minute, not GitHub's hour.
const updateCheckLocalLimitRetry = time.Minute

// updateCheckGitHubToken is the token the check sends, when there is one: the
// same one Config -> Containers stores for the changelogs. A variable so tests
// can supply one without writing the secrets file.
var updateCheckGitHubToken = dockerGitHubToken

// githubAPIError is a GitHub answer other than 200 or 304.
//
// Users saw "Could not reach GitHub" whatever went wrong. Most of the time it
// was GitHub's limit of 60 unauthenticated requests an hour per public
// address -- shared with the container changelogs, other homelab tools and,
// behind CGNAT, the neighbours -- which no amount of trying again fixes
// before the hour turns. The code and the reset time let the check wait for
// that and the client say so.
type githubAPIError struct {
	Status  int
	Code    string    // rate-limited, auth-failed or http
	ResetAt time.Time // rate-limited only: when GitHub lifts the limit
}

func (e *githubAPIError) Error() string {
	if e.Code == "rate-limited" {
		return fmt.Sprintf("GitHub API rate limit reached (HTTP %d)", e.Status)
	}
	return fmt.Sprintf("GitHub API HTTP %d", e.Status)
}

// githubErrorFromResponse classifies a non-OK answer.
func githubErrorFromResponse(resp *http.Response) *githubAPIError {
	e := &githubAPIError{Status: resp.StatusCode, Code: "http"}
	limited := resp.StatusCode == http.StatusTooManyRequests ||
		(resp.StatusCode == http.StatusForbidden && resp.Header.Get("X-RateLimit-Remaining") == "0")
	switch {
	case limited:
		e.Code = "rate-limited"
		if reset, err := strconv.ParseInt(strings.TrimSpace(resp.Header.Get("X-RateLimit-Reset")), 10, 64); err == nil && reset > 0 {
			e.ResetAt = time.Unix(reset, 0)
		} else if secs, err := strconv.Atoi(strings.TrimSpace(resp.Header.Get("Retry-After"))); err == nil && secs > 0 {
			e.ResetAt = time.Now().Add(time.Duration(secs) * time.Second)
		}
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		e.Code = "auth-failed"
	}
	return e
}

func isGitHubRateLimit(err error) bool {
	var apiErr *githubAPIError
	return errors.As(err, &apiErr) && apiErr.Code == "rate-limited"
}

// updateCheckErrorCode is the client-facing reason for a failed check.
func updateCheckErrorCode(err error) string {
	var apiErr *githubAPIError
	switch {
	case err == nil:
		return ""
	case errors.As(err, &apiErr):
		if apiErr.Code == "rate-limited" {
			return "rate-limited"
		}
		return "http"
	case errors.Is(err, errOutboundRateLimited):
		return "local-limit"
	default:
		var netErr interface{ Timeout() bool }
		var urlErr *url.Error
		if errors.As(err, &urlErr) || errors.As(err, &netErr) {
			return "unreachable"
		}
		return "http"
	}
}

// updateCheckRetryAt is when a failed entry is tried again: when GitHub lifts
// its limit, a minute after the local limiter said no, otherwise after
// updateCheckErrorRetry.
func updateCheckRetryAt(entry updateCheckCacheEntry) time.Time {
	var apiErr *githubAPIError
	switch {
	case errors.As(entry.err, &apiErr) && apiErr.Code == "rate-limited" && !apiErr.ResetAt.IsZero():
		return apiErr.ResetAt
	case errors.Is(entry.err, errOutboundRateLimited):
		return entry.fetchedAt.Add(updateCheckLocalLimitRetry)
	default:
		return entry.fetchedAt.Add(updateCheckErrorRetry)
	}
}

func (h *Handlers) getUpdateCheckCache() updateCheckCacheEntry {
	h.updateCheckMu.RLock()
	defer h.updateCheckMu.RUnlock()
	return h.updateCheckCache
}

func (h *Handlers) setUpdateCheckCache(entry updateCheckCacheEntry) {
	h.updateCheckMu.Lock()
	h.updateCheckCache = entry
	h.updateCheckMu.Unlock()
}

func (h *Handlers) buildUpdateStatus(forceRefresh bool) UpdateStatusResponse {
	current := strings.TrimSpace(releaseTag())
	status := UpdateStatusResponse{
		Enabled: updateCheckEnabled(h.store.GetSettings()),
		Current: current,
		Source:  "github",
	}

	if !status.Enabled {
		return status
	}

	entry := h.getUpdateCheckCache()
	stale := entry.fetchedAt.IsZero() || time.Since(entry.fetchedAt) >= updateCheckCacheTTL ||
		// A failure is retried sooner than a day: a container that starts
		// before its network is up failed its first check and showed that
		// error, and no update notice, until the next day.
		(entry.err != nil && !time.Now().Before(updateCheckRetryAt(entry)))
	// Check now asks again, except while GitHub's limit is still on: that
	// answer is known until the reset, and asking only confirms it.
	limited := entry.err != nil && isGitHubRateLimit(entry.err) && time.Now().Before(updateCheckRetryAt(entry))
	if (forceRefresh && !limited) || stale {
		ctx, cancel := context.WithTimeout(context.Background(), updateCheckRequestTimeout)
		defer cancel()
		info, etag, authenticated, err := h.fetchGitHubLatestReleaseConditional(ctx, entry.info, entry.etag)
		if err != nil {
			// Keep the last good answer's ETag, so the try after this one can
			// still be a free 304.
			entry = updateCheckCacheEntry{info: entry.info, etag: entry.etag, fetchedAt: time.Now(), err: err, authenticated: authenticated}
		} else {
			entry = updateCheckCacheEntry{info: info, etag: etag, fetchedAt: time.Now(), authenticated: authenticated}
		}
		h.setUpdateCheckCache(entry)
	}

	if !entry.fetchedAt.IsZero() {
		status.CheckedAt = entry.fetchedAt.UnixMilli()
	}
	status.Authenticated = entry.authenticated
	if entry.err != nil {
		status.Error = entry.err.Error()
		status.ErrorCode = updateCheckErrorCode(entry.err)
		status.RetryAt = updateCheckRetryAt(entry).UnixMilli()
		return status
	}

	status.Latest = entry.info.Tag
	status.ReleaseURL = entry.info.ReleaseURL
	if current != "" && entry.info.Tag != "" && compareReleaseTags(entry.info.Tag, current) > 0 {
		status.UpdateAvailable = true
	}
	return status
}

// githubRelease is the subset of GitHub's release payload the check reads.
// Both endpoints return the same shape — one object, or an array of them.
type githubRelease struct {
	TagName     string `json:"tag_name"`
	HTMLURL     string `json:"html_url"`
	PublishedAt string `json:"published_at"`
	Draft       bool   `json:"draft"`
	Prerelease  bool   `json:"prerelease"`
}

// githubGet is one answer from the release endpoints.
type githubGet struct {
	etag          string
	notModified   bool // 304: what the caller had is still current
	authenticated bool // the answer came with the token
}

// getGitHubJSON performs the GET the two release endpoints share.
//
// With a token from Config -> Containers it asks with it first; a token GitHub
// turns down (expired, revoked, mistyped) is not a reason for the version
// check to stop, so that answer is asked again without one. ifNoneMatch, when
// set, makes the request conditional.
func (h *Handlers) getGitHubJSON(ctx context.Context, url, ifNoneMatch string, out any) (githubGet, error) {
	token := strings.TrimSpace(updateCheckGitHubToken())
	got, err := h.getGitHubJSONOnce(ctx, url, ifNoneMatch, token, out)
	var apiErr *githubAPIError
	if token != "" && errors.As(err, &apiErr) && apiErr.Code == "auth-failed" {
		return h.getGitHubJSONOnce(ctx, url, ifNoneMatch, "", out)
	}
	return got, err
}

func (h *Handlers) getGitHubJSONOnce(ctx context.Context, url, ifNoneMatch, token string, out any) (githubGet, error) {
	got := githubGet{authenticated: token != ""}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return got, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", updateCheckUserAgent)
	if tag := strings.TrimSpace(releaseTag()); tag != "" {
		req.Header.Set("User-Agent", fmt.Sprintf("%s/%s", updateCheckUserAgent, tag))
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}

	client := h.outboundHTTPClient(updateCheckRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return got, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified && ifNoneMatch != "" {
		got.etag = ifNoneMatch
		got.notModified = true
		return got, nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return got, err
	}
	if resp.StatusCode != http.StatusOK {
		return got, githubErrorFromResponse(resp)
	}
	got.etag = strings.TrimSpace(resp.Header.Get("ETag"))
	return got, json.Unmarshal(body, out)
}

// fetchGitHubHighestRelease picks the highest release by version, not by
// publication date.
//
// GitHub's /releases/latest resolves "latest" as most-recently-published, which
// is not the same question. Publish a patch on an older line after a newer one
// — a v2026.09.09.4 landing after v1.0.0 — and that endpoint names the older
// tag, which compareReleaseTags then correctly rejects as not newer. The real
// release would never be announced. Ordering the listing ourselves makes the
// check independent of the order releases happen to be published in.
//
// With prev and its etag, the listing is asked conditionally and a 304 hands
// prev back unchanged.
func (h *Handlers) fetchGitHubHighestRelease(ctx context.Context, prev upstreamReleaseInfo, etag string) (upstreamReleaseInfo, githubGet, error) {
	if prev.Tag == "" {
		etag = ""
	}
	var releases []githubRelease
	got, err := h.getGitHubJSON(ctx, releaseListURL(), etag, &releases)
	if err != nil {
		return upstreamReleaseInfo{}, got, err
	}
	if got.notModified {
		return prev, got, nil
	}

	var best githubRelease
	for _, rel := range releases {
		if rel.Draft || rel.Prerelease || strings.TrimSpace(rel.TagName) == "" {
			continue
		}
		if best.TagName == "" || compareReleaseTags(rel.TagName, best.TagName) > 0 {
			best = rel
		}
	}
	if best.TagName == "" {
		return upstreamReleaseInfo{}, got, errors.New("no published GitHub releases")
	}
	return upstreamReleaseInfo{
		Tag:         strings.TrimSpace(best.TagName),
		ReleaseURL:  strings.TrimSpace(best.HTMLURL),
		PublishedAt: strings.TrimSpace(best.PublishedAt),
	}, got, nil
}

// fetchGitHubLatestRelease reads the highest published release, unconditionally.
func (h *Handlers) fetchGitHubLatestRelease(ctx context.Context) (upstreamReleaseInfo, error) {
	info, _, _, err := h.fetchGitHubLatestReleaseConditional(ctx, upstreamReleaseInfo{}, "")
	return info, err
}

// fetchGitHubLatestReleaseConditional reads the highest published release,
// falling back to GitHub's own /releases/latest when the listing cannot be
// read so the check degrades rather than going silent. Not on GitHub's rate
// limit: the fallback is held to the same limit and would only spend a second
// request to hear it again.
func (h *Handlers) fetchGitHubLatestReleaseConditional(ctx context.Context, prev upstreamReleaseInfo, etag string) (upstreamReleaseInfo, string, bool, error) {
	info, got, err := h.fetchGitHubHighestRelease(ctx, prev, etag)
	if err == nil {
		return info, got.etag, got.authenticated, nil
	}
	if isGitHubRateLimit(err) || errors.Is(err, errOutboundRateLimited) {
		return upstreamReleaseInfo{}, "", got.authenticated, err
	}

	var payload githubRelease
	got, err = h.getGitHubJSON(ctx, githubLatestReleaseURL, "", &payload)
	if err != nil {
		return upstreamReleaseInfo{}, "", got.authenticated, err
	}
	tag := strings.TrimSpace(payload.TagName)
	if tag == "" {
		return upstreamReleaseInfo{}, "", got.authenticated, errors.New("GitHub release has no tag")
	}
	if payload.Draft || payload.Prerelease {
		return upstreamReleaseInfo{}, "", got.authenticated, errors.New("GitHub latest release is a draft or pre-release")
	}
	// No ETag: it belongs to the other endpoint, and the next check starts
	// from the listing again.
	return upstreamReleaseInfo{
		Tag:         tag,
		ReleaseURL:  strings.TrimSpace(payload.HTMLURL),
		PublishedAt: strings.TrimSpace(payload.PublishedAt),
	}, "", got.authenticated, nil
}

// GetUpdateStatus reports whether a newer release exists on GitHub. The check
// runs only when the user has opted in (and the operator has not disabled it).
func (h *Handlers) GetUpdateStatus(w http.ResponseWriter, r *http.Request) {
	forceRefresh := strings.TrimSpace(r.URL.Query().Get("refresh")) == "1"
	if forceRefresh && !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	status := h.buildUpdateStatus(forceRefresh)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	_ = json.NewEncoder(w).Encode(status)
}

// StartUpdateCheckScheduler refreshes the GitHub release cache on a 24h ticker
// when update check is enabled.
func (h *Handlers) StartUpdateCheckScheduler(stop <-chan struct{}) {
	run := func() {
		if !updateCheckEnabled(h.store.GetSettings()) {
			return
		}
		_ = h.buildUpdateStatus(true)
	}

	ticker := time.NewTicker(updateCheckCacheTTL)
	go func() {
		defer ticker.Stop()
		// Inside the goroutine, like every other scheduler here. Called from
		// main before ListenAndServe it blocked startup for the full 10s GitHub
		// timeout whenever egress to api.github.com is blocked -- long enough to
		// fail a container healthcheck on boot.
		run()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				run()
			}
		}
	}()
}
