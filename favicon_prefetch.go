package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type prefetchIconsBatchResult struct {
	Total     int  `json:"total"`
	Remaining int  `json:"remaining"`
	Attempted int  `json:"attempted"`
	Applied   int  `json:"applied"`
	Done      bool `json:"done"`
}

type pendingIconBookmark struct {
	index  int
	url    string
	urlKey string
}

func deriveFaviconURL(bookmarkURL string) string {
	bookmarkURL = strings.TrimSpace(bookmarkURL)
	if bookmarkURL == "" {
		return ""
	}
	parsed, err := url.Parse(bookmarkURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host + "/favicon.ico"
}

func iconHostAllowed(host string, allowLocal bool) bool {
	host = strings.TrimSpace(host)
	if host == "" {
		return false
	}
	if allowLocal {
		return true
	}
	return isPublicHost(host)
}

func downloadIconFromURL(sourceURL string, allowLocalHosts bool) (string, error) {
	sourceURL = strings.TrimSpace(sourceURL)
	if sourceURL == "" {
		return "", nil
	}

	parsedURL, err := url.Parse(sourceURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Hostname() == "" {
		return "", nil
	}
	if !iconHostAllowed(parsedURL.Hostname(), allowLocalHosts) {
		return "", nil
	}

	client := newOutboundHTTPClient(allowLocalHosts, 8*time.Second, 3)

	req, err := http.NewRequest(http.MethodGet, sourceURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "nextDash-icon-fetcher/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", nil
	}

	const maxIconSize = 2 << 20
	limitedBody := io.LimitReader(resp.Body, maxIconSize+1)
	data, err := io.ReadAll(limitedBody)
	if err != nil || len(data) == 0 || len(data) > maxIconSize {
		return "", err
	}

	detectedType := detectImageType(data)
	ext, ok := iconExtensionFromContentType(detectedType)
	if !ok {
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
		ext, ok = iconExtensionFromContentType(contentType)
		if !ok {
			return "", nil
		}
	}

	return saveIconBytes(data, ext)
}

func saveIconBytes(data []byte, ext string) (string, error) {
	if ext == ".svg" {
		data = sanitizeSVGContent(data)
		if len(data) == 0 {
			return "", nil
		}
	}

	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		return "", err
	}
	fileName := "icon-" + randomHex(8) + ext
	filePath := filepath.Join(iconsDir, fileName)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return "", err
	}
	return fileName, nil
}

func (h *Handlers) fetchAndStoreBookmarkIcon(bookmarkURL string) string {
	bookmarkURL = strings.TrimSpace(bookmarkURL)
	if bookmarkURL == "" {
		return ""
	}
	if err := validateHTTPURL(bookmarkURL, h.allowLocalBookmarks()); err != nil {
		return ""
	}

	allowLocal := h.allowLocalBookmarks()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	preview := h.fetchBookmarkPreview(ctx, bookmarkURL, nil, false)
	if iconURL := strings.TrimSpace(preview.Icon); iconURL != "" {
		if fileName, err := downloadIconFromURL(iconURL, allowLocal); err == nil && fileName != "" {
			return fileName
		}
	}

	if fallback := deriveFaviconURL(bookmarkURL); fallback != "" {
		if fileName, err := downloadIconFromURL(fallback, allowLocal); err == nil && fileName != "" {
			return fileName
		}
	}

	return ""
}

func (h *Handlers) startDefaultBookmarkIconPrefetch() {
	if os.Getenv("NEXTDASH_DISABLE_PREFETCH") == "1" {
		return
	}
	go func() {
		h.prefetchMu.Lock()
		defer h.prefetchMu.Unlock()
		h.prefetchDefaultBookmarkIcons()
	}()
}

func (h *Handlers) prefetchDefaultBookmarkIcons() {
	const pageID = 1
	const batchLimit = 8
	totalApplied := 0
	for {
		result := h.prefetchBookmarkIconsBatch(pageID, batchLimit, false, false, 0)
		totalApplied += result.Applied
		// Stop when done, when nothing was attempted, OR when a batch made no
		// progress. Without the Applied==0 guard, a single bookmark whose favicon
		// can never be fetched (dead URL, timeout, blocked outbound) stays
		// "needing icon" forever, so Done never flips and this loop spins on the
		// same failing network fetches — a busy loop that pins CPU (worst on
		// servers with restricted outbound access).
		if result.Done || result.Attempted == 0 || result.Applied == 0 {
			break
		}
	}
	if totalApplied > 0 {
		log.Printf("nextDash: prefetched favicons for %d default bookmarks on page %d", totalApplied, pageID)
	}
}

func bookmarksNeedingIcons(bookmarks []Bookmark, allowLocal bool) []pendingIconBookmark {
	return collectIconCandidates(bookmarks, allowLocal, false)
}

// collectIconCandidates lists bookmarks whose icon can be fetched. With
// includeExisting the current icon is ignored, so every bookmark with a
// fetchable URL is re-fetched — used by the "refresh all favicons" command to
// replace icons that have gone stale, not just fill in missing ones.
func collectIconCandidates(bookmarks []Bookmark, allowLocal bool, includeExisting bool) []pendingIconBookmark {
	var pending []pendingIconBookmark
	for i, b := range bookmarks {
		if !includeExisting && strings.TrimSpace(b.Icon) != "" {
			continue
		}
		urlStr := strings.TrimSpace(b.URL)
		if urlStr == "" {
			continue
		}
		if err := validateHTTPURL(urlStr, allowLocal); err != nil {
			continue
		}
		pending = append(pending, pendingIconBookmark{
			index:  i,
			url:    urlStr,
			urlKey: canonicalBookmarkURLKey(urlStr),
		})
	}
	return pending
}

func countBookmarksNeedingIcons(bookmarks []Bookmark, allowLocal bool) int {
	return len(bookmarksNeedingIcons(bookmarks, allowLocal))
}

// prefetchBookmarkIconsBatch fetches one batch of icons for a page.
//
// Two modes. By default only bookmarks without an icon are candidates, and
// progress is measured by how many still lack one — each batch shrinks that set,
// so the caller can loop until Remaining hits 0.
//
// With refreshAll every bookmark is a candidate, so re-fetching does not shrink
// anything. The caller walks the list with `offset` instead, and Remaining is
// whatever sits past the batch just handled.
func (h *Handlers) prefetchBookmarkIconsBatch(pageID, limit int, countOnly bool, refreshAll bool, offset int) prefetchIconsBatchResult {
	bookmarks := h.store.GetBookmarksByPage(pageID)
	allowLocal := h.allowLocalBookmarks()
	pending := collectIconCandidates(bookmarks, allowLocal, refreshAll)
	total := len(pending)
	if total == 0 {
		return prefetchIconsBatchResult{Done: true}
	}
	if countOnly {
		return prefetchIconsBatchResult{
			Total:     total,
			Remaining: total,
			Done:      false,
		}
	}

	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return prefetchIconsBatchResult{Total: total, Remaining: 0, Done: true}
	}

	batch := pending[offset:]
	if limit > 0 && len(batch) > limit {
		batch = batch[:limit]
	}

	type iconResult struct {
		index  int
		urlKey string
		icon   string
	}

	var wg sync.WaitGroup
	results := make(chan iconResult, len(batch))
	for _, item := range batch {
		wg.Add(1)
		go func(idx int, bookmarkURL, key string) {
			defer wg.Done()
			if icon := h.fetchAndStoreBookmarkIcon(bookmarkURL); icon != "" {
				results <- iconResult{index: idx, urlKey: key, icon: icon}
			}
		}(item.index, item.url, item.urlKey)
	}
	wg.Wait()
	close(results)

	updates := make([]PrefetchIconUpdate, 0, len(batch))
	for result := range results {
		updates = append(updates, PrefetchIconUpdate{
			Index:     result.index,
			URLKey:    result.urlKey,
			Icon:      result.icon,
			Overwrite: refreshAll,
		})
	}

	applied := h.store.MergePrefetchBookmarkIcons(pageID, updates)
	// In refreshAll mode a re-fetched bookmark still has an icon, so counting
	// icon-less bookmarks would report 0 remaining after the first batch and cut
	// the run short. Track position in the candidate list instead.
	var remaining int
	if refreshAll {
		remaining = total - (offset + len(batch))
		if remaining < 0 {
			remaining = 0
		}
	} else {
		remaining = countBookmarksNeedingIcons(h.store.GetBookmarksByPage(pageID), allowLocal)
	}

	return prefetchIconsBatchResult{
		Total:     total,
		Remaining: remaining,
		Attempted: len(batch),
		Applied:   applied,
		Done:      remaining == 0 || len(batch) == 0,
	}
}

func (h *Handlers) PrefetchBookmarkIcons(w http.ResponseWriter, r *http.Request) {
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

	var req struct {
		PageID    int  `json:"pageId"`
		Limit     int  `json:"limit"`
		CountOnly bool `json:"countOnly"`
		// RefreshAll re-fetches icons for every bookmark on the page, not just
		// the ones missing an icon; Offset walks the list across batches.
		RefreshAll bool `json:"refreshAll"`
		Offset     int  `json:"offset"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	limit := req.Limit
	if limit <= 0 {
		limit = 4
	}
	if limit > 8 {
		limit = 8
	}

	result := h.prefetchBookmarkIconsBatch(req.PageID, limit, req.CountOnly, req.RefreshAll, req.Offset)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
