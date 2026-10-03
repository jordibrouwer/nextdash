package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
Keeping the two icon-set indexes on disk and in memory.

Both indexes come from jsDelivr, once a week, with a conditional GET so an
unchanged index costs a 304. The raw files are mirrored in data/icon-sets/,
which a backup leaves out: everything in it comes back from the CDN. A failed
or unreadable fetch keeps the mirror that was there, the way site_news.go keeps
its feed, so a server that loses its connection keeps its icons.

A server that never reached the CDN has no index at all, and then nothing
matches: favicons and letters work exactly as before.

DISABLE_ICON_SETS=1 switches it all off, for a server that should not reach
jsDelivr. NEXTDASH_ICON_SETS_FIXTURE reads indexes and icon files from a
directory instead and never goes out -- for the end-to-end tests, which cannot
use a local stub because outbound fetches refuse local hosts.
*/

const (
	defaultIconSetsCDNBase = "https://cdn.jsdelivr.net/gh/"
	iconSetsTTL            = 7 * 24 * time.Hour
	iconSetsRetryAfter     = time.Hour
	iconSetsIndexMaxBytes  = 8 << 20
	iconSetsDirName        = "icon-sets"
	// iconSetsStateName lives inside icon-sets/, never at the data root, so it
	// needs no dataFiles entry: buildBackupZip skips the directory whole.
	iconSetsStateName = "state.json"
)

// iconSetsCDNBase is a variable so a test can point it at a stub.
var iconSetsCDNBase = defaultIconSetsCDNBase

type iconSetSource struct {
	set, repo, path, mirror string
}

var iconSetSources = []iconSetSource{
	{iconSetDashboard, "homarr-labs/dashboard-icons/", "metadata.json", "index-dashboard-icons.json"},
	{iconSetSelfhst, "selfhst/icons/", "index.json", "index-selfhst.json"},
}

type iconSetsState struct {
	ETag         map[string]string `json:"etag,omitempty"`
	LastModified map[string]string `json:"lastModified,omitempty"`
	FetchedAt    int64             `json:"fetchedAt,omitempty"`
}

var iconSets struct {
	mu      sync.Mutex // one refresh at a time; guards state and triedAt
	index   atomic.Pointer[iconSetIndex]
	state   iconSetsState
	triedAt time.Time
}

func iconSetsDisabled() bool { return os.Getenv("DISABLE_ICON_SETS") == "1" }

func iconSetsFixtureDir() string { return strings.TrimSpace(os.Getenv("NEXTDASH_ICON_SETS_FIXTURE")) }

func iconSetsDir() string {
	if d := iconSetsFixtureDir(); d != "" {
		return d
	}
	return filepath.Join(ResolveDataDir(), iconSetsDirName)
}

// currentIconSets is the loaded index, or nil when switched off or never loaded.
func currentIconSets() *iconSetIndex {
	if iconSetsDisabled() {
		return nil
	}
	return iconSets.index.Load()
}

func resetIconSetsForTest() {
	iconSets.mu.Lock()
	defer iconSets.mu.Unlock()
	iconSets.index.Store(nil)
	iconSets.state = iconSetsState{}
	iconSets.triedAt = time.Time{}
	iconSetMisses.Range(func(k, _ any) bool {
		iconSetMisses.Delete(k)
		return true
	})
}

// loadIconSetsFromDisk parses whatever mirrors exist. A missing or broken one
// leaves that set out rather than failing both.
func loadIconSetsFromDisk() {
	iconSets.mu.Lock()
	defer iconSets.mu.Unlock()
	loadIconSetsFromDiskLocked()
}

func loadIconSetsFromDiskLocked() {
	if iconSetsDisabled() {
		return
	}
	dir := iconSetsDir()
	var di, sh []*iconSetEntry
	if b, err := os.ReadFile(filepath.Join(dir, iconSetSources[0].mirror)); err == nil {
		di, _ = parseDashboardIconsIndex(b)
	}
	if b, err := os.ReadFile(filepath.Join(dir, iconSetSources[1].mirror)); err == nil {
		sh, _ = parseSelfhstIndex(b)
	}
	if len(di)+len(sh) > 0 {
		iconSets.index.Store(buildIconSetIndex(di, sh))
	}
	if b, err := os.ReadFile(filepath.Join(dir, iconSetsStateName)); err == nil {
		_ = json.Unmarshal(b, &iconSets.state)
	}
}

func iconSetsMirrorsPresent() bool {
	for _, src := range iconSetSources {
		if _, err := os.Stat(filepath.Join(iconSetsDir(), src.mirror)); err != nil {
			return false
		}
	}
	return true
}

// iconSetsHTTPClient refuses local hosts unless a test pointed the base at one.
func iconSetsHTTPClient(timeout time.Duration) *http.Client {
	return newOutboundHTTPClient(iconSetsCDNBase != defaultIconSetsCDNBase, timeout, 3)
}

// refreshIconSets fetches both indexes once. Each source stands alone: one
// that fails keeps its old mirror while the other still updates. The last
// error is returned.
func refreshIconSets(ctx context.Context) error {
	if iconSetsDisabled() || iconSetsFixtureDir() != "" {
		return nil
	}
	iconSets.mu.Lock()
	defer iconSets.mu.Unlock()
	iconSets.triedAt = time.Now()
	if iconSets.state.ETag == nil {
		iconSets.state.ETag = map[string]string{}
	}
	if iconSets.state.LastModified == nil {
		iconSets.state.LastModified = map[string]string{}
	}
	dir := iconSetsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	var lastErr error
	ok := 0
	for _, src := range iconSetSources {
		if err := refreshIconSetSource(ctx, dir, src); err != nil {
			lastErr = err
			continue
		}
		ok++
	}
	if ok > 0 {
		iconSets.state.FetchedAt = time.Now().UnixMilli()
	}
	if data, err := json.Marshal(iconSets.state); err == nil {
		_ = writeFileAtomic(filepath.Join(dir, iconSetsStateName), data, 0644)
	}
	loadIconSetsFromDiskLocked()
	return lastErr
}

func refreshIconSetSource(ctx context.Context, dir string, src iconSetSource) error {
	mirror := filepath.Join(dir, src.mirror)
	_, statErr := os.Stat(mirror)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, iconSetsCDNBase+src.repo+src.path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "nextDash/1.0 (+https://nextdash.cc)")
	// Conditional only while the mirror is there: a 304 for a file that was
	// deleted would leave nothing to read.
	if statErr == nil {
		if v := iconSets.state.ETag[src.set]; v != "" {
			req.Header.Set("If-None-Match", v)
		}
		if v := iconSets.state.LastModified[src.set]; v != "" {
			req.Header.Set("If-Modified-Since", v)
		}
	}
	resp, err := iconSetsHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s: HTTP %d", src.set, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, iconSetsIndexMaxBytes+1))
	if err != nil {
		return err
	}
	if len(body) > iconSetsIndexMaxBytes {
		return fmt.Errorf("%s: index too large", src.set)
	}
	var entries []*iconSetEntry
	if src.set == iconSetDashboard {
		entries, err = parseDashboardIconsIndex(body)
	} else {
		entries, err = parseSelfhstIndex(body)
	}
	if err != nil || len(entries) == 0 {
		// Reachable but unreadable: keep what was there.
		return errors.Join(fmt.Errorf("%s: unreadable index", src.set), err)
	}
	if err := writeFileAtomic(mirror, body, 0644); err != nil {
		return err
	}
	iconSets.state.ETag[src.set] = strings.TrimSpace(resp.Header.Get("ETag"))
	iconSets.state.LastModified[src.set] = strings.TrimSpace(resp.Header.Get("Last-Modified"))
	return nil
}

// iconSetsDue: a mirror is missing, the week is over, or the back-off after a
// failure has passed.
func iconSetsDue(now time.Time) bool {
	iconSets.mu.Lock()
	defer iconSets.mu.Unlock()
	if !iconSets.triedAt.IsZero() && now.Sub(iconSets.triedAt) < iconSetsRetryAfter {
		return false
	}
	if !iconSetsMirrorsPresent() {
		return true
	}
	return now.Sub(time.UnixMilli(iconSets.state.FetchedAt)) >= iconSetsTTL
}

// StartIconSetsScheduler loads the mirrors and keeps them a week fresh. All
// inside the goroutine, so blocked egress never holds up startup.
func (h *Handlers) StartIconSetsScheduler(stop <-chan struct{}) {
	go func() {
		loadIconSetsFromDisk()
		if iconSetsDisabled() || iconSetsFixtureDir() != "" {
			return
		}
		run := func() {
			if !iconSetsDue(time.Now()) {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if err := refreshIconSets(ctx); err != nil {
				logDebug("icon-sets", "refresh: %v", err)
			}
		}
		run()
		ticker := time.NewTicker(iconSetsRetryAfter)
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
