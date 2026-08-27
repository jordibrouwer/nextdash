package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
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
	stale := entry.fetchedAt.IsZero() || time.Since(entry.fetchedAt) >= updateCheckCacheTTL
	if forceRefresh || stale {
		ctx, cancel := context.WithTimeout(context.Background(), updateCheckRequestTimeout)
		defer cancel()
		info, err := h.fetchGitHubLatestRelease(ctx)
		entry = updateCheckCacheEntry{info: info, fetchedAt: time.Now(), err: err}
		h.setUpdateCheckCache(entry)
	}

	if !entry.fetchedAt.IsZero() {
		status.CheckedAt = entry.fetchedAt.UnixMilli()
	}
	if entry.err != nil {
		status.Error = entry.err.Error()
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

// getGitHubJSON performs the GET the two release endpoints share.
func (h *Handlers) getGitHubJSON(ctx context.Context, url string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", updateCheckUserAgent)
	if tag := strings.TrimSpace(releaseTag()); tag != "" {
		req.Header.Set("User-Agent", fmt.Sprintf("%s/%s", updateCheckUserAgent, tag))
	}

	client := h.outboundHTTPClient(updateCheckRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API HTTP %d", resp.StatusCode)
	}
	return json.Unmarshal(body, out)
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
func (h *Handlers) fetchGitHubHighestRelease(ctx context.Context) (upstreamReleaseInfo, error) {
	var releases []githubRelease
	if err := h.getGitHubJSON(ctx, releaseListURL(), &releases); err != nil {
		return upstreamReleaseInfo{}, err
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
		return upstreamReleaseInfo{}, errors.New("no published GitHub releases")
	}
	return upstreamReleaseInfo{
		Tag:         strings.TrimSpace(best.TagName),
		ReleaseURL:  strings.TrimSpace(best.HTMLURL),
		PublishedAt: strings.TrimSpace(best.PublishedAt),
	}, nil
}

// fetchGitHubLatestRelease reads the highest published release, falling back to
// GitHub's own /releases/latest when the listing cannot be read (a rate limit,
// say) so the check degrades rather than going silent.
func (h *Handlers) fetchGitHubLatestRelease(ctx context.Context) (upstreamReleaseInfo, error) {
	if info, err := h.fetchGitHubHighestRelease(ctx); err == nil {
		return info, nil
	}

	var payload githubRelease
	if err := h.getGitHubJSON(ctx, githubLatestReleaseURL, &payload); err != nil {
		return upstreamReleaseInfo{}, err
	}
	tag := strings.TrimSpace(payload.TagName)
	if tag == "" {
		return upstreamReleaseInfo{}, errors.New("GitHub release has no tag")
	}
	if payload.Draft || payload.Prerelease {
		return upstreamReleaseInfo{}, errors.New("GitHub latest release is a draft or pre-release")
	}
	return upstreamReleaseInfo{
		Tag:         tag,
		ReleaseURL:  strings.TrimSpace(payload.HTMLURL),
		PublishedAt: strings.TrimSpace(payload.PublishedAt),
	}, nil
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
