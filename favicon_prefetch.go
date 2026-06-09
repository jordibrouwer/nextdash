package main

import (
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

	client := &http.Client{
		Timeout:       8 * time.Second,
		CheckRedirect: safeRedirectCheck(allowLocalHosts, 3),
	}

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

	contentType := strings.ToLower(strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0]))
	ext, ok := iconExtensionFromContentType(contentType)
	if !ok {
		return "", nil
	}

	const maxIconSize = 2 << 20
	limitedBody := io.LimitReader(resp.Body, maxIconSize+1)
	data, err := io.ReadAll(limitedBody)
	if err != nil || len(data) == 0 || len(data) > maxIconSize {
		return "", err
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

	iconsDir := "data/icons"
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
	preview := h.fetchBookmarkPreview(bookmarkURL, nil, false)
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

func (h *Handlers) prefetchDefaultBookmarkIcons() {
	const pageID = 1
	bookmarks := h.store.GetBookmarksByPage(pageID)
	if len(bookmarks) == 0 {
		return
	}

	type iconResult struct {
		index  int
		urlKey string
		icon   string
	}

	var wg sync.WaitGroup
	results := make(chan iconResult, len(bookmarks))

	for i := range bookmarks {
		if strings.TrimSpace(bookmarks[i].Icon) != "" {
			continue
		}
		urlStr := strings.TrimSpace(bookmarks[i].URL)
		if urlStr == "" {
			continue
		}
		urlKey := canonicalBookmarkURLKey(urlStr)
		wg.Add(1)
		go func(idx int, bookmarkURL, key string) {
			defer wg.Done()
			if icon := h.fetchAndStoreBookmarkIcon(bookmarkURL); icon != "" {
				results <- iconResult{index: idx, urlKey: key, icon: icon}
			}
		}(i, urlStr, urlKey)
	}

	wg.Wait()
	close(results)

	updates := make([]PrefetchIconUpdate, 0, len(bookmarks))
	for result := range results {
		updates = append(updates, PrefetchIconUpdate{
			Index:  result.index,
			URLKey: result.urlKey,
			Icon:   result.icon,
		})
	}

	if applied := h.store.MergePrefetchBookmarkIcons(pageID, updates); applied > 0 {
		log.Printf("nextDash: prefetched favicons for %d default bookmarks on page %d", applied, pageID)
	}
}
