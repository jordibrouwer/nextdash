package main

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

func (h *Handlers) fetchGitHubLatestRelease(ctx context.Context) (upstreamReleaseInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, githubLatestReleaseURL, nil)
	if err != nil {
		return upstreamReleaseInfo{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", updateCheckUserAgent)
	if tag := strings.TrimSpace(releaseTag()); tag != "" {
		req.Header.Set("User-Agent", fmt.Sprintf("%s/%s", updateCheckUserAgent, tag))
	}

	client := h.outboundHTTPClient(updateCheckRequestTimeout, 3)
	resp, err := client.Do(req)
	if err != nil {
		return upstreamReleaseInfo{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return upstreamReleaseInfo{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return upstreamReleaseInfo{}, fmt.Errorf("GitHub API HTTP %d", resp.StatusCode)
	}

	var payload struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
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

	run()
	ticker := time.NewTicker(updateCheckCacheTTL)
	go func() {
		defer ticker.Stop()
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
