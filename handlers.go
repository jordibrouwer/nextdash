package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

type Handlers struct {
	store          Store
	files          embed.FS
	previewCacheMu sync.RWMutex
	healthCacheMu  sync.RWMutex
	prefetchMu     sync.Mutex
}

const previewCachePath = "data/preview-cache.json"
const previewCacheTTLMs = int64(7 * 24 * 60 * 60 * 1000) // 7 days in ms

func normalizeShortcut(shortcut string) string {
	return strings.ToUpper(strings.TrimSpace(shortcut))
}

func respondStorePersistError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	http.Error(w, "Failed to save data", http.StatusInternalServerError)
	return false
}

func respondBookmarkMutationError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, ErrBookmarkNotFound) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return false
	}
	return respondStorePersistError(w, err)
}

func isDefaultURLPort(scheme, port string) bool {
	switch scheme {
	case "https":
		return port == "443"
	case "http":
		return port == "80"
	default:
		return false
	}
}

func canonicalURLHost(u *url.URL, scheme string) string {
	hostname := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" || isDefaultURLPort(scheme, port) {
		return hostname
	}
	if strings.Contains(hostname, ":") {
		return "[" + hostname + "]:" + port
	}
	return hostname + ":" + port
}

// canonicalBookmarkURLKey normalizes URLs so obvious duplicates (trailing slash, hash, case, default ports) match.
func canonicalBookmarkURLKey(raw string) string {
	s := strings.TrimSpace(raw)
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		fallback := strings.ToLower(s)
		if i := strings.Index(fallback, "#"); i >= 0 {
			fallback = fallback[:i]
		}
		return strings.TrimSuffix(fallback, "/")
	}
	u.Fragment = ""
	u.RawFragment = ""
	scheme := strings.ToLower(u.Scheme)
	host := canonicalURLHost(u, scheme)
	path := u.EscapedPath()
	if path == "/" {
		path = ""
	} else {
		path = strings.TrimSuffix(path, "/")
	}
	if u.RawQuery != "" {
		return scheme + "://" + host + path + "?" + u.RawQuery
	}
	return scheme + "://" + host + path
}

func findDuplicateShortcutInList(bookmarks []Bookmark) string {
	seen := make(map[string]struct{})
	for _, bookmark := range bookmarks {
		shortcut := normalizeShortcut(bookmark.Shortcut)
		if shortcut == "" {
			continue
		}
		if _, exists := seen[shortcut]; exists {
			return shortcut
		}
		seen[shortcut] = struct{}{}
	}
	return ""
}

func findShortcutConflictWithExisting(bookmarks []Bookmark, shortcut string) *Bookmark {
	normalized := normalizeShortcut(shortcut)
	if normalized == "" {
		return nil
	}
	for i := range bookmarks {
		if normalizeShortcut(bookmarks[i].Shortcut) == normalized {
			return &bookmarks[i]
		}
	}
	return nil
}

func (h *Handlers) parsePageTemplates(templateFiles ...string) (*template.Template, error) {
	if info, err := os.Stat("templates"); err == nil && info.IsDir() {
		diskFiles := make([]string, len(templateFiles))
		for i, name := range templateFiles {
			diskFiles[i] = filepath.FromSlash(name)
		}
		return template.ParseFiles(diskFiles...)
	}
	return template.ParseFS(h.files, templateFiles...)
}

func NewHandlers(store Store, files embed.FS) *Handlers {
	h := &Handlers{
		store: store,
		files: files,
	}
	if store.TakeDefaultBookmarkIconPrefetch() {
		h.startDefaultBookmarkIconPrefetch()
	}
	return h
}

func (h *Handlers) HealthPage(w http.ResponseWriter, r *http.Request) {
	tmpl, err := h.parsePageTemplates("templates/health.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, h.htmlPageData(h.store.GetSettings())); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())
}

func (h *Handlers) GetBookmarkHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	report := h.buildBookmarkHealthReport()
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(report)
}

func healthReasonLegacyLabel(r HealthReason) string {
	switch r.Code {
	case "duplicate_url":
		if n := r.Params["count"]; n != "" {
			return fmt.Sprintf("Duplicate URL in %s bookmarks", n)
		}
	case "shortcut_conflict":
		if n := r.Params["count"]; n != "" {
			return fmt.Sprintf("Shortcut conflict with %s bookmarks", n)
		}
	case "status_never_run":
		return "Status check has never run"
	case "status_stale":
		return "Status check is stale"
	case "not_opened_30_days":
		return "Not opened in over 30 days"
	case "never_opened":
		return "Never opened"
	case "no_preview":
		return "No preview metadata yet"
	case "unreachable":
		return "Unreachable"
	case "last_error":
		if d := strings.TrimSpace(r.Detail); d != "" {
			return d
		}
	}
	if d := strings.TrimSpace(r.Detail); d != "" {
		return d
	}
	return r.Code
}

func appendHealthReason(details *[]HealthReason, legacy *[]string, reason HealthReason) {
	*details = append(*details, reason)
	*legacy = append(*legacy, healthReasonLegacyLabel(reason))
}

func (h *Handlers) buildBookmarkHealthReport() BookmarkHealthReport {
	pages := h.store.GetPages()
	pageNames := make(map[int]string, len(pages))
	for _, page := range pages {
		pageNames[page.ID] = page.Name
	}

	type bookmarkEntry struct {
		bookmark Bookmark
		index    int
	}

	bookmarksByPage := make(map[int][]bookmarkEntry, len(pages))
	duplicateRefs := make(map[string][]BookmarkRef)
	duplicateCounts := make(map[string]int)
	shortcutCounts := make(map[string]int)

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		entries := make([]bookmarkEntry, 0, len(bookmarks))
		for idx, bm := range bookmarks {
			entry := bookmarkEntry{bookmark: bm, index: idx}
			entries = append(entries, entry)

			key := canonicalBookmarkURLKey(bm.URL)
			if key != "" {
				duplicateCounts[key]++
				duplicateRefs[key] = append(duplicateRefs[key], BookmarkRef{
					Name:      bm.Name,
					Index:     idx,
					PageID:    page.ID,
					Category:  bm.Category,
					OpenCount: bm.OpenCount,
					Pinned:    bm.Pinned,
					CreatedAt: bm.CreatedAt,
				})
			}

			shortcut := normalizeShortcut(bm.Shortcut)
			if shortcut != "" {
				shortcutCounts[shortcut]++
			}
		}
		bookmarksByPage[page.ID] = entries
	}

	report := BookmarkHealthReport{
		GeneratedAt: time.Now().UnixMilli(),
	}

	issueRank := func(status string) int {
		switch status {
		case "broken":
			return 0
		case "duplicate":
			return 1
		case "shortcut-conflict":
			return 2
		case "unchecked":
			return 3
		case "stale":
			return 4
		case "unused":
			return 5
		case "missing-preview":
			return 6
		default:
			return 7
		}
	}

	missingPreview := func(bm Bookmark) bool {
		return strings.TrimSpace(bm.PreviewTitle) == "" && strings.TrimSpace(bm.PreviewDesc) == "" && strings.TrimSpace(bm.PreviewImage) == ""
	}

	for _, page := range pages {
		for _, entry := range bookmarksByPage[page.ID] {
			bm := entry.bookmark
			key := canonicalBookmarkURLKey(bm.URL)
			duplicateCount := duplicateCounts[key]
			isDuplicate := duplicateCount > 1
			isBroken := strings.TrimSpace(bm.LastError) != ""
			isChecked := bm.CheckStatus
			isUnchecked := isChecked && bm.LastChecked == 0
			isStaleCheck := isChecked && bm.LastChecked > 0 && time.Since(time.UnixMilli(bm.LastChecked)) > 7*24*time.Hour
			isUnused := bm.OpenCount == 0 && bm.LastOpened == 0
			isStale := bm.OpenCount > 0 && bm.LastOpened > 0 && time.Since(time.UnixMilli(bm.LastOpened)) > 30*24*time.Hour
			isMissingPreview := missingPreview(bm)
			shortcutKey := normalizeShortcut(bm.Shortcut)
			isShortcutConflict := shortcutKey != "" && shortcutCounts[shortcutKey] > 1

			status := "healthy"
			reasons := make([]string, 0, 4)
			reasonDetails := make([]HealthReason, 0, 4)
			score := 100

			if isBroken {
				status = "broken"
				if detail := strings.TrimSpace(bm.LastError); detail != "" {
					appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "last_error", Detail: detail})
				} else {
					appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "unreachable"})
				}
				score -= 60
			}
			if isDuplicate {
				if status == "healthy" {
					status = "duplicate"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{
					Code:   "duplicate_url",
					Params: map[string]string{"count": strconv.Itoa(duplicateCount)},
				})
				score -= 15
			}
			if isShortcutConflict {
				if status == "healthy" {
					status = "shortcut-conflict"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{
					Code:   "shortcut_conflict",
					Params: map[string]string{"count": strconv.Itoa(shortcutCounts[shortcutKey])},
				})
				score -= 15
			}
			if isUnchecked {
				if status == "healthy" {
					status = "unchecked"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "status_never_run"})
				score -= 10
			} else if isStaleCheck {
				if status == "healthy" {
					status = "unchecked"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "status_stale"})
				score -= 5
			}
			if isStale {
				if status == "healthy" {
					status = "stale"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "not_opened_30_days"})
				score -= 10
			}
			if isUnused {
				if status == "healthy" {
					status = "unused"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "never_opened"})
				score -= 10
			}
			if isMissingPreview {
				if status == "healthy" {
					status = "missing-preview"
				}
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "no_preview"})
				score -= 5
			}

			if score < 0 {
				score = 0
			}

			report.Summary.TotalBookmarks++
			if bm.Pinned {
				report.Summary.PinnedCount++
			}
			if isBroken {
				report.Summary.BrokenCount++
			}
			if isDuplicate {
				report.Summary.DuplicateCount++
			}
			if isShortcutConflict {
				report.Summary.ShortcutConflictCount++
			}
			if isChecked && (isUnchecked || isStaleCheck) {
				report.Summary.UncheckedCount++
			}
			if isStale {
				report.Summary.StaleCount++
			}
			if isMissingPreview {
				report.Summary.MissingPreviewCount++
			}
			if isUnused {
				report.Summary.UnusedCount++
			}
			if status == "healthy" {
				report.Summary.HealthyCount++
			}

			report.Issues = append(report.Issues, HealthIssue{
				Name:           bm.Name,
				URL:            bm.URL,
				Shortcut:       bm.Shortcut,
				Category:       bm.Category,
				PageID:         page.ID,
				PageName:       pageNames[page.ID],
				Index:          entry.index,
				Pinned:         bm.Pinned,
				CheckStatus:    bm.CheckStatus,
				OpenCount:      bm.OpenCount,
				LastOpened:     bm.LastOpened,
				LastChecked:    bm.LastChecked,
				LastError:      bm.LastError,
				PreviewTitle:   bm.PreviewTitle,
				PreviewDesc:    bm.PreviewDesc,
				PreviewImage:   bm.PreviewImage,
				Icon:           bm.Icon,
				Status:         status,
				Score:          score,
				Reasons:        reasons,
				ReasonDetails:  reasonDetails,
				DuplicateCount: duplicateCount,
			})
		}
	}

	for key, refs := range duplicateRefs {
		if len(refs) < 2 {
			continue
		}
		sortDuplicateRefsBestFirst(refs)
		report.DuplicateGroups = append(report.DuplicateGroups, DuplicateGroup{
			URL:       key,
			Bookmarks: refs,
		})
	}

	sort.Slice(report.DuplicateGroups, func(i, j int) bool {
		if len(report.DuplicateGroups[i].Bookmarks) == len(report.DuplicateGroups[j].Bookmarks) {
			return report.DuplicateGroups[i].URL < report.DuplicateGroups[j].URL
		}
		return len(report.DuplicateGroups[i].Bookmarks) > len(report.DuplicateGroups[j].Bookmarks)
	})

	sort.Slice(report.Issues, func(i, j int) bool {
		if report.Issues[i].Score == report.Issues[j].Score {
			rankI := issueRank(report.Issues[i].Status)
			rankJ := issueRank(report.Issues[j].Status)
			if rankI == rankJ {
				if report.Issues[i].PageID == report.Issues[j].PageID {
					return report.Issues[i].Name < report.Issues[j].Name
				}
				return report.Issues[i].PageID < report.Issues[j].PageID
			}
			return rankI < rankJ
		}
		return report.Issues[i].Score < report.Issues[j].Score
	})

	return report
}

func (h *Handlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	tmpl, err := h.parsePageTemplates("templates/dashboard.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, h.htmlPageData(settings)); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())
}

func (h *Handlers) Config(w http.ResponseWriter, r *http.Request) {
	tmpl, err := h.parsePageTemplates("templates/config.html", "templates/partials/theme-colors-editor.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, h.htmlPageData(h.store.GetSettings())); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())
}

func (h *Handlers) setCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-NextDash-Token")
}

type htmlPageData struct {
	Settings
	WriteToken string `json:"-"`
}

func (h *Handlers) htmlPageData(settings Settings) htmlPageData {
	return htmlPageData{
		Settings:   settings,
		WriteToken: writeAccessToken(),
	}
}

func (h *Handlers) allowLocalBookmarks() bool {
	return h.store.GetSettings().AllowLocalBookmarks
}

func (h *Handlers) validateBookmarkURL(bookmarkURL string) error {
	return validateBookmarkURL(bookmarkURL, h.allowLocalBookmarks())
}

func (h *Handlers) GetBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	all := r.URL.Query().Get("all")
	var bookmarks []Bookmark

	if all == "true" {
		// Get bookmarks from all pages
		bookmarks = h.store.GetAllBookmarks()
	} else if pageIDStr != "" {
		pageID, err := strconv.Atoi(pageIDStr)
		if err != nil {
			http.Error(w, "Invalid page ID", http.StatusBadRequest)
			return
		}
		bookmarks = h.store.GetBookmarksByPage(pageID)
	} else {
		// No page ID provided - return empty array
		// Pages are required now, no global bookmarks
		bookmarks = []Bookmark{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(bookmarks)
}

func (h *Handlers) SaveBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		http.Error(w, "Page ID is required", http.StatusBadRequest)
		return
	}

	var bookmarks []Bookmark
	if err := json.NewDecoder(r.Body).Decode(&bookmarks); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate each bookmark URL
	for _, bookmark := range bookmarks {
		if err := h.validateBookmarkURL(bookmark.URL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid bookmark URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	// Reject duplicate URLs within the submitted page payload.
	seenURLKeys := make(map[string]struct{}, len(bookmarks))
	for _, bookmark := range bookmarks {
		urlKey := canonicalBookmarkURLKey(bookmark.URL)
		if urlKey == "" {
			continue
		}
		if _, exists := seenURLKeys[urlKey]; exists {
			http.Error(w, "Duplicate bookmark URL in submitted bookmarks", http.StatusConflict)
			return
		}
		seenURLKeys[urlKey] = struct{}{}
	}

	// Validate shortcut uniqueness in payload first.
	if duplicateShortcut := findDuplicateShortcutInList(bookmarks); duplicateShortcut != "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{
			"error":    "duplicate_shortcut",
			"message":  "Duplicate shortcut in submitted bookmarks",
			"shortcut": duplicateShortcut,
		})
		return
	}

	// Validate shortcut uniqueness across all pages (exclude current page, since payload replaces it).
	allBookmarks := h.store.GetAllBookmarks()
	existingOtherPages := make([]Bookmark, 0, len(allBookmarks))
	for _, existing := range allBookmarks {
		if existing.PageID == pageID {
			continue
		}
		existingOtherPages = append(existingOtherPages, existing)
	}
	for _, bookmark := range bookmarks {
		shortcut := normalizeShortcut(bookmark.Shortcut)
		if shortcut == "" {
			continue
		}
		if conflict := findShortcutConflictWithExisting(existingOtherPages, shortcut); conflict != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":    "duplicate_shortcut",
				"message":  "Shortcut already exists on another page",
				"shortcut": shortcut,
				"conflict": map[string]any{
					"name":   conflict.Name,
					"url":    conflict.URL,
					"pageId": conflict.PageID,
				},
			})
			return
		}
	}

	for i := range bookmarks {
		bookmarks[i].Tags = normalizeTags(bookmarks[i].Tags)
		bookmarks[i].Icon = sanitizeBookmarkIcon(bookmarks[i].Icon)
	}

	if !respondStorePersistError(w, h.store.SaveBookmarksByPage(pageID, bookmarks)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) AddBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Page     int      `json:"page"`
		Bookmark Bookmark `json:"bookmark"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate the bookmark URL
	if err := h.validateBookmarkURL(request.Bookmark.URL); err != nil {
		http.Error(w, fmt.Sprintf("Invalid bookmark URL: %v", err), http.StatusBadRequest)
		return
	}

	existingBookmarks := h.store.GetBookmarksByPage(request.Page)
	newKey := canonicalBookmarkURLKey(request.Bookmark.URL)
	for _, existingBookmark := range existingBookmarks {
		if canonicalBookmarkURLKey(existingBookmark.URL) == newKey {
			http.Error(w, "Duplicate bookmark URL", http.StatusConflict)
			return
		}
	}

	shortcut := normalizeShortcut(request.Bookmark.Shortcut)
	if shortcut != "" {
		if conflict := findShortcutConflictWithExisting(h.store.GetAllBookmarks(), shortcut); conflict != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":    "duplicate_shortcut",
				"message":  "Shortcut already exists",
				"shortcut": shortcut,
				"conflict": map[string]any{
					"name":   conflict.Name,
					"url":    conflict.URL,
					"pageId": conflict.PageID,
				},
			})
			return
		}
	}

	// Set CreatedAt timestamp if not already set
	if request.Bookmark.CreatedAt == 0 {
		request.Bookmark.CreatedAt = time.Now().UnixMilli()
	}

	request.Bookmark.Tags = normalizeTags(request.Bookmark.Tags)
	request.Bookmark.Icon = sanitizeBookmarkIcon(request.Bookmark.Icon)

	if !respondStorePersistError(w, h.store.AddBookmarkToPage(request.Page, request.Bookmark)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// normalizeTags trims, lowercases, deduplicates, and removes empty tag values.
func normalizeTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, t := range tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if _, exists := seen[t]; exists {
			continue
		}
		seen[t] = struct{}{}
		result = append(result, t)
	}
	return result
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var result strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			result.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			result.WriteRune('-')
		}
	}
	return strings.Trim(result.String(), "-")
}

func (h *Handlers) ImportBrowserBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		PageID    int `json:"pageId"`
		Bookmarks []struct {
			Name     string `json:"name"`
			URL      string `json:"url"`
			Category string `json:"category"`
		} `json:"bookmarks"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if request.PageID <= 0 {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	for _, bm := range request.Bookmarks {
		if err := h.validateBookmarkURL(bm.URL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	existing := h.store.GetBookmarksByPage(request.PageID)
	existingURLs := make(map[string]struct{}, len(existing))
	for _, b := range existing {
		existingURLs[canonicalBookmarkURLKey(b.URL)] = struct{}{}
	}

	categories := h.store.GetCategoriesByPage(request.PageID)
	knownCatIDs := make(map[string]struct{}, len(categories))
	for _, c := range categories {
		knownCatIDs[c.ID] = struct{}{}
	}

	newCatNames := make(map[string]string)
	var newCatOrder []string
	for _, bm := range request.Bookmarks {
		if bm.Category == "" {
			continue
		}
		id := slugify(bm.Category)
		if id == "" {
			continue
		}
		if _, exists := knownCatIDs[id]; !exists {
			if _, already := newCatNames[bm.Category]; !already {
				newCatNames[bm.Category] = id
				newCatOrder = append(newCatOrder, bm.Category)
				knownCatIDs[id] = struct{}{}
			}
		}
	}
	if len(newCatOrder) > 0 {
		for _, name := range newCatOrder {
			categories = append(categories, Category{ID: newCatNames[name], Name: name})
		}
		if !respondStorePersistError(w, h.store.SaveCategoriesByPage(request.PageID, categories)) {
			return
		}
	}

	imported := 0
	skipped := 0
	for _, bm := range request.Bookmarks {
		key := canonicalBookmarkURLKey(bm.URL)
		if _, dup := existingURLs[key]; dup {
			skipped++
			continue
		}
		catID := ""
		if bm.Category != "" {
			catID = slugify(bm.Category)
		}
		if !respondStorePersistError(w, h.store.AddBookmarkToPage(request.PageID, Bookmark{
			Name:     bm.Name,
			URL:      bm.URL,
			Category: catID,
			PageID:   request.PageID,
		})) {
			return
		}
		existingURLs[key] = struct{}{}
		imported++
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"imported": imported, "skipped": skipped})
}

func (h *Handlers) DeleteBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Page     int      `json:"page"`
		Bookmark Bookmark `json:"bookmark"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := h.store.DeleteBookmarkFromPage(request.Page, request.Bookmark); err != nil {
		if errors.Is(err, ErrBookmarkNotFound) {
			http.Error(w, "Bookmark not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetCategories(w http.ResponseWriter, r *http.Request) {
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		// No page param provided - return empty array
		// Categories are now per-page only, no global categories
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Category{})
		return
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	categories := h.store.GetCategoriesByPage(pageID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(categories)
}

func (h *Handlers) GetFinders(w http.ResponseWriter, r *http.Request) {
	finders := h.store.GetFinders()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(finders)
}

func (h *Handlers) SaveFinders(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var finders []Finder
	if err := json.NewDecoder(r.Body).Decode(&finders); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if !respondStorePersistError(w, h.store.SaveFinders(finders)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) SaveCategories(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		http.Error(w, "Page ID is required", http.StatusBadRequest)
		return
	}

	var categories []Category
	if err := json.NewDecoder(r.Body).Decode(&categories); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	if !respondStorePersistError(w, h.store.SaveCategoriesByPage(pageID, categories)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetPages(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
		return
	}
	pages := h.store.GetPages()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pages)
}

func (h *Handlers) SavePages(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var pages []Page
	if err := json.NewDecoder(r.Body).Decode(&pages); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Extract page order (array of IDs)
	order := make([]int, len(pages))
	for i, page := range pages {
		order[i] = page.ID
	}

	// Save the order
	if !respondStorePersistError(w, h.store.SavePageOrder(order)) {
		return
	}

	// Save each page individually; bookmarks are preserved from disk (see SavePage).
	for _, page := range pages {
		page = normalizePageMeta(page, page.ID)
		if !respondStorePersistError(w, h.store.SavePage(page)) {
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) DeletePage(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	vars := mux.Vars(r)
	pageIDStr := vars["id"]

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	// Prevent deleting page 1 (main page)
	if pageID == 1 {
		http.Error(w, "Cannot delete the main page", http.StatusBadRequest)
		return
	}

	// Delete the page file
	if err := h.store.DeletePage(pageID); err != nil {
		http.Error(w, "Error deleting page", http.StatusInternalServerError)
		return
	}

	// Update the page order - remove the deleted page ID
	order := h.store.GetPageOrder()
	newOrder := make([]int, 0, len(order))
	for _, id := range order {
		if id != pageID {
			newOrder = append(newOrder, id)
		}
	}
	if !respondStorePersistError(w, h.store.SavePageOrder(newOrder)) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) ResetAllData(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Confirm bool `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !req.Confirm {
		http.Error(w, "Confirmation required", http.StatusBadRequest)
		return
	}

	if err := h.store.ResetAllData(); err != nil {
		http.Error(w, "Error resetting data", http.StatusInternalServerError)
		return
	}
	if h.store.TakeDefaultBookmarkIconPrefetch() {
		h.startDefaultBookmarkIconPrefetch()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func mergeSettingsFromBody(stored Settings, body []byte) (Settings, error) {
	storedJSON, err := json.Marshal(stored)
	if err != nil {
		return Settings{}, err
	}
	var base map[string]json.RawMessage
	if err := json.Unmarshal(storedJSON, &base); err != nil {
		return Settings{}, err
	}
	var incoming map[string]json.RawMessage
	if err := json.Unmarshal(body, &incoming); err != nil {
		return Settings{}, err
	}
	for key, value := range incoming {
		base[key] = value
	}
	mergedJSON, err := json.Marshal(base)
	if err != nil {
		return Settings{}, err
	}
	var settings Settings
	if err := json.Unmarshal(mergedJSON, &settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (h *Handlers) SaveSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	settings, err := mergeSettingsFromBody(h.store.GetSettings(), body)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate and sanitize collections
	seenIDs := make(map[string]struct{})
	sanitized := settings.Collections[:0]
	for _, col := range settings.Collections {
		col.ID = strings.TrimSpace(col.ID)
		col.Name = strings.TrimSpace(col.Name)
		if col.ID == "" || col.Name == "" {
			continue
		}
		if _, dup := seenIDs[col.ID]; dup {
			continue
		}
		seenIDs[col.ID] = struct{}{}
		validRules := col.Rules[:0]
		for _, rule := range col.Rules {
			rule.Value = strings.TrimSpace(rule.Value)
			if rule.Value != "" {
				validRules = append(validRules, rule)
			}
		}
		if len(validRules) == 0 {
			continue
		}
		col.Rules = validRules
		sanitized = append(sanitized, col)
	}
	settings.Collections = sanitized

	if !respondStorePersistError(w, h.store.SaveSettings(settings)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) Colors(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/config#colors", http.StatusMovedPermanently)
}

func (h *Handlers) GetColors(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(colors)
}

func (h *Handlers) SaveColors(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var colors ColorTheme
	if err := json.NewDecoder(r.Body).Decode(&colors); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	colors = sanitizeColorTheme(colors)

	if !respondStorePersistError(w, h.store.SaveColors(colors)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) ResetColors(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	// Get current colors to preserve custom themes
	currentColors := h.store.GetColors()

	// Reset only light and dark themes to defaults, keep custom themes
	defaultColors := ColorTheme{
		Light:   getDefaultLightTheme(),
		Dark:    getDefaultDarkTheme(),
		BuiltIn: getDefaultBuiltInThemes(),
		Custom:  currentColors.Custom, // Preserve existing custom themes
	}

	if !respondStorePersistError(w, h.store.SaveColors(defaultColors)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(defaultColors)
}

func (h *Handlers) GetCustomThemesList(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()

	themesMap := make(map[string]string)
	for themeID, themeColors := range colors.BuiltIn {
		themesMap[themeID] = themeColors.Name
	}
	for themeID, themeColors := range colors.Custom {
		themesMap[themeID] = themeColors.Name
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(themesMap)
}

func renderThemeCSSBlock(selector string, tc ThemeColors) string {
	s := sanitizeThemeColors(tc)
	return `html[data-theme="` + selector + `"] body {
    --text-primary: ` + s.TextPrimary + `;
    --text-secondary: ` + s.TextSecondary + `;
    --text-tertiary: ` + s.TextTertiary + `;
    --background-primary: ` + s.BackgroundPrimary + `;
    --background-secondary: ` + s.BackgroundSecondary + `;
    --background-dots: ` + s.BackgroundDots + `;
    --background-modal: ` + s.BackgroundModal + `;
    --border-primary: ` + s.BorderPrimary + `;
    --border-secondary: ` + s.BorderSecondary + `;
    --accent-success: ` + s.AccentSuccess + `;
    --accent-primary: ` + s.AccentSuccess + `;
    --accent-warning: ` + s.AccentWarning + `;
    --accent-error: ` + s.AccentError + `;
}
`
}

func (h *Handlers) CustomThemeCSS(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()

	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	css := "/* Custom Theme Variables - Loaded from colors.json */\n\n"
	css += "/* Light Theme Variables */\n" + renderThemeCSSBlock("light", colors.Light) + "\n"
	css += "/* Dark Theme Variables */\n" + renderThemeCSSBlock("dark", colors.Dark) + "\n"

	// Add custom themes CSS
	for themeID, themeColors := range colors.Custom {
		safeID := sanitizeCSSIdent(themeID)
		if safeID == "" {
			continue
		}
		css += "/* Custom Theme: " + safeID + " */\n" + renderThemeCSSBlock(safeID, themeColors) + "\n"
	}

	// Add built-in themes CSS
	builtInThemeIDs := make([]string, 0, len(colors.BuiltIn))
	for themeID := range colors.BuiltIn {
		builtInThemeIDs = append(builtInThemeIDs, themeID)
	}
	sort.Strings(builtInThemeIDs)
	for _, themeID := range builtInThemeIDs {
		safeID := sanitizeCSSIdent(themeID)
		if safeID == "" {
			continue
		}
		css += "/* Built-in Theme: " + safeID + " */\n" + renderThemeCSSBlock(safeID, colors.BuiltIn[themeID]) + "\n"
	}

	w.Write([]byte(css))
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func findURLDuplicateGroups(pages []Page, getBookmarks func(pageID int) []Bookmark) []DuplicateGroup {
	duplicates := make(map[string][]BookmarkRef)
	for _, page := range pages {
		bookmarks := getBookmarks(page.ID)
		for idx, bm := range bookmarks {
			key := canonicalBookmarkURLKey(bm.URL)
			if key == "" {
				continue
			}
			duplicates[key] = append(duplicates[key], BookmarkRef{
				Name:     bm.Name,
				Index:    idx,
				PageID:   page.ID,
				Category: bm.Category,
			})
		}
	}

	var duplicateGroups []DuplicateGroup
	for url, refs := range duplicates {
		if len(refs) > 1 {
			duplicateGroups = append(duplicateGroups, DuplicateGroup{
				URL:       url,
				Bookmarks: refs,
			})
		}
	}
	return duplicateGroups
}

// Duplicate detection endpoint
func (h *Handlers) CheckDuplicates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	warning := DuplicateWarning{
		DuplicateURLs: findURLDuplicateGroups(h.store.GetPages(), h.store.GetBookmarksByPage),
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(warning)
}

// Build search index
func (h *Handlers) BuildSearchIndex(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	pages := h.store.GetPages()
	var entries []SearchEntry

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		for idx, bm := range bookmarks {
			keywords := bm.Name + " " + bm.URL + " " + bm.Shortcut + " " + bm.Category
			entries = append(entries, SearchEntry{
				Name:     bm.Name,
				URL:      bm.URL,
				Shortcut: bm.Shortcut,
				Category: bm.Category,
				Keywords: strings.ToLower(keywords),
				Index:    idx,
				PageID:   page.ID,
			})
		}
	}

	index := SearchIndex{Entries: entries}
	settings := h.store.GetSettings()
	settings.SearchIndexed = true
	if !respondStorePersistError(w, h.store.SaveSettings(settings)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(index)
}

func (h *Handlers) outboundHTTPClient(timeout time.Duration, maxRedirects int) *http.Client {
	return newOutboundHTTPClient(h.allowLocalBookmarks(), timeout, maxRedirects)
}

func (h *Handlers) fetchBookmarkPreview(rawURL string, cache *PreviewCacheFile, useCache bool) BookmarkPreview {
	rawURL = strings.TrimSpace(rawURL)
	if err := validateHTTPURL(rawURL, h.allowLocalBookmarks()); err != nil {
		return BookmarkPreview{URL: rawURL, FetchedAt: time.Now().UnixMilli()}
	}
	cacheKey := canonicalBookmarkURLKey(rawURL)
	if useCache && cache != nil {
		if entry, ok := cache.Cache[cacheKey]; ok {
			if time.Now().UnixMilli()-entry.FetchedAt < previewCacheTTLMs {
				return entry
			}
		}
	}

	preview := BookmarkPreview{
		URL:       rawURL,
		Domain:    extractDomain(rawURL),
		FetchedAt: time.Now().UnixMilli(),
	}

	client := h.outboundHTTPClient(8*time.Second, 5)
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return preview
	}
	req.Header.Set("User-Agent", "nextDash PreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil || resp == nil {
		return preview
	}
	defer resp.Body.Close()

	if resp.Request != nil && resp.Request.URL != nil {
		preview.URL = resp.Request.URL.String()
		preview.Domain = extractDomain(preview.URL)
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return preview
	}

	htmlBody := string(bodyBytes)
	preview.Title = h.extractTitleFromHTML(htmlBody)
	if preview.Title == "" {
		preview.Title = h.extractMetaFromHTML(htmlBody, "property", "og:title")
	}
	preview.Description = h.extractMetaFromHTML(htmlBody, "name", "description")
	if preview.Description == "" {
		preview.Description = h.extractMetaFromHTML(htmlBody, "property", "og:description")
	}
	preview.Image = h.extractMetaFromHTML(htmlBody, "property", "og:image")
	if preview.Image != "" {
		preview.Image = h.resolveRelativeURL(preview.URL, preview.Image)
	}
	preview.Icon = h.extractIconFromHTML(htmlBody)
	if preview.Icon != "" {
		preview.Icon = h.resolveRelativeURL(preview.URL, preview.Icon)
	}

	if cache != nil {
		if cache.Cache == nil {
			cache.Cache = make(map[string]BookmarkPreview)
		}
		cache.Cache[cacheKey] = preview
	}
	return preview
}

func bookmarkHasPreviewMetadata(bm Bookmark) bool {
	return strings.TrimSpace(bm.PreviewTitle) != "" ||
		strings.TrimSpace(bm.PreviewDesc) != "" ||
		strings.TrimSpace(bm.PreviewImage) != ""
}

func applyPreviewToBookmark(bm *Bookmark, preview BookmarkPreview) {
	bm.PreviewTitle = strings.TrimSpace(preview.Title)
	bm.PreviewDesc = strings.TrimSpace(preview.Description)
	bm.PreviewImage = strings.TrimSpace(preview.Image)
}

func clearBookmarkPreviewFields(bm *Bookmark) {
	bm.PreviewTitle = ""
	bm.PreviewDesc = ""
	bm.PreviewImage = ""
}

// Get bookmark preview metadata
func (h *Handlers) GetBookmarkPreview(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "URL required"})
		return
	}
	if err := validateHTTPURL(rawURL, h.allowLocalBookmarks()); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	cacheKey := canonicalBookmarkURLKey(rawURL)
	forceRefresh := strings.EqualFold(r.URL.Query().Get("refresh"), "1") ||
		strings.EqualFold(r.URL.Query().Get("refresh"), "true")
	if !forceRefresh {
		if cached, ok := h.getPreviewCacheEntry(cacheKey); ok {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(cached)
			return
		}
	}

	localCache := &PreviewCacheFile{Cache: make(map[string]BookmarkPreview)}
	preview := h.fetchBookmarkPreview(rawURL, localCache, false)
	_ = h.mergePreviewCacheUpdates(localCache.Cache)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(preview)
}

// ClearAllBookmarkPreviews removes stored preview metadata from every bookmark and empties the server cache.
func (h *Handlers) ClearAllBookmarkPreviews(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	cleared := 0
	for _, page := range h.store.GetPages() {
		pageCleared := 0
		err := h.store.MutateBookmarksOnPage(page.ID, func(bookmarks []Bookmark) ([]Bookmark, error) {
			for i := range bookmarks {
				if !bookmarkHasPreviewMetadata(bookmarks[i]) {
					continue
				}
				clearBookmarkPreviewFields(&bookmarks[i])
				pageCleared++
			}
			return bookmarks, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			if !respondBookmarkMutationError(w, err) {
				return
			}
		}
		cleared += pageCleared
	}

	if !respondStorePersistError(w, h.replacePreviewCache(PreviewCacheFile{Cache: map[string]BookmarkPreview{}})) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "completed",
		"cleared": cleared,
	})
}

// RefreshAllBookmarkPreviews re-fetches preview metadata for every bookmark with a URL.
func (h *Handlers) RefreshAllBookmarkPreviews(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	cache := PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	refreshed := 0
	skipped := 0

	for _, page := range h.store.GetPages() {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		previewByKey := make(map[string]BookmarkPreview)
		for _, bm := range bookmarks {
			rawURL := strings.TrimSpace(bm.URL)
			if rawURL == "" {
				skipped++
				continue
			}
			preview := h.fetchBookmarkPreview(rawURL, &cache, false)
			key := canonicalBookmarkURLKey(rawURL)
			if key != "" {
				previewByKey[key] = preview
			}
			refreshed++
		}

		if len(previewByKey) == 0 {
			continue
		}

		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				key := canonicalBookmarkURLKey(current[i].URL)
				if key == "" {
					continue
				}
				if preview, ok := previewByKey[key]; ok {
					applyPreviewToBookmark(&current[i], preview)
				}
			}
			return current, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			if !respondBookmarkMutationError(w, err) {
				return
			}
		}
	}

	if !respondStorePersistError(w, h.mergePreviewCacheUpdates(cache.Cache)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "completed",
		"refreshed": refreshed,
		"skipped":   skipped,
	})
}

func extractDomain(url string) string {
	if strings.HasPrefix(url, "http://") {
		url = url[7:]
	} else if strings.HasPrefix(url, "https://") {
		url = url[8:]
	}

	if idx := strings.Index(url, "/"); idx != -1 {
		url = url[:idx]
	}

	return url
}

func (h *Handlers) extractTitleFromHTML(htmlBody string) string {
	lower := strings.ToLower(htmlBody)
	titleOpen := strings.Index(lower, "<title")
	if titleOpen < 0 {
		return ""
	}
	startRel := strings.Index(lower[titleOpen:], ">")
	if startRel < 0 {
		return ""
	}
	contentStart := titleOpen + startRel + 1
	endRel := strings.Index(lower[contentStart:], "</title>")
	if endRel < 0 {
		return ""
	}
	title := strings.TrimSpace(htmlBody[contentStart : contentStart+endRel])
	if title == "" {
		return ""
	}
	return strings.Join(strings.Fields(title), " ")
}

func (h *Handlers) extractMetaFromHTML(htmlBody, attrName, attrValue string) string {
	lower := strings.ToLower(htmlBody)
	attrMatch := strings.ToLower(attrName) + "=\"" + strings.ToLower(attrValue) + "\""
	idx := strings.Index(lower, attrMatch)
	if idx < 0 {
		attrMatch = strings.ToLower(attrName) + "='" + strings.ToLower(attrValue) + "'"
		idx = strings.Index(lower, attrMatch)
	}
	if idx < 0 {
		return ""
	}

	tagStart := strings.LastIndex(lower[:idx], "<meta")
	if tagStart < 0 {
		return ""
	}
	tagEndRel := strings.Index(lower[idx:], ">")
	if tagEndRel < 0 {
		return ""
	}
	tag := htmlBody[tagStart : idx+tagEndRel]
	tagLower := strings.ToLower(tag)

	contentPos := strings.Index(tagLower, "content=")
	if contentPos < 0 {
		return ""
	}
	value := h.extractQuotedAttribute(tag[contentPos+8:])
	return strings.TrimSpace(strings.Join(strings.Fields(value), " "))
}

func (h *Handlers) extractIconFromHTML(htmlBody string) string {
	lower := strings.ToLower(htmlBody)
	start := 0
	for {
		linkIdx := strings.Index(lower[start:], "<link")
		if linkIdx < 0 {
			return ""
		}
		linkIdx += start
		endIdxRel := strings.Index(lower[linkIdx:], ">")
		if endIdxRel < 0 {
			return ""
		}
		tag := htmlBody[linkIdx : linkIdx+endIdxRel+1]
		tagLower := strings.ToLower(tag)
		if strings.Contains(tagLower, "rel=\"icon\"") ||
			strings.Contains(tagLower, "rel='icon'") ||
			strings.Contains(tagLower, "rel=\"shortcut icon\"") ||
			strings.Contains(tagLower, "rel='shortcut icon'") {
			hrefPos := strings.Index(tagLower, "href=")
			if hrefPos >= 0 {
				return strings.TrimSpace(h.extractQuotedAttribute(tag[hrefPos+5:]))
			}
		}
		start = linkIdx + endIdxRel + 1
	}
}

func (h *Handlers) extractQuotedAttribute(text string) string {
	if text == "" {
		return ""
	}
	quote := text[0]
	if quote == '"' || quote == '\'' {
		end := strings.IndexByte(text[1:], quote)
		if end >= 0 {
			return text[1 : 1+end]
		}
		return ""
	}
	// Unquoted attribute value fallback.
	end := strings.IndexAny(text, " \t\r\n>")
	if end < 0 {
		return text
	}
	return text[:end]
}

func (h *Handlers) resolveRelativeURL(baseURL, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err == nil && u.IsAbs() {
		return raw
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return raw
	}
	rel, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return base.ResolveReference(rel).String()
}

// Track bookmark opens for analytics
func (h *Handlers) TrackBookmarkOpen(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	pageID, ok := parseIntFromAny(raw["pageId"])
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	index, ok := parseIntFromAny(raw["index"])
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if err := h.store.TrackBookmarkOpen(pageID, index); err != nil {
		if !respondBookmarkMutationError(w, err) {
			return
		}
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func parseIntFromAny(value interface{}) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case string:
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// CacheScanResult persists a single ping result for later retrieval
func (h *Handlers) CacheScanResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		URL    string `json:"url"`
		Status string `json:"status"`
		PingMs int    `json:"pingMs"`
		Error  string `json:"error"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	key := canonicalBookmarkURLKey(req.URL)
	if key == "" {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}
	if !respondStorePersistError(w, h.mergeHealthCacheUpdates(map[string]HealthScanCache{
		key: {
			URL:         key,
			Status:      req.Status,
			PingMs:      req.PingMs,
			LastScanned: time.Now().UnixMilli(),
			Error:       req.Error,
		},
	})) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "cached"})
}

// UpdateBookmarkHealthStatus writes ping outcome back to bookmark health fields.
func (h *Handlers) UpdateBookmarkHealthStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID int    `json:"pageId"`
		Index  int    `json:"index"`
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}

	err := h.store.MutateBookmarkAt(req.PageID, req.Index, func(bookmark *Bookmark) error {
		bookmark.LastChecked = time.Now().UnixMilli()
		if strings.TrimSpace(req.Status) == "online" {
			bookmark.LastError = ""
		} else {
			errMsg := strings.TrimSpace(req.Error)
			if errMsg == "" {
				errMsg = "Unreachable"
			}
			bookmark.LastError = errMsg
		}
		return nil
	})
	if !respondBookmarkMutationError(w, err) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

// RetestAll runs ping checks on all bookmarks marked with checkStatus=true
func (h *Handlers) RetestAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	pages := h.store.GetPages()
	var results []map[string]interface{}
	healthUpdates := make(map[string]HealthScanCache)

	// Retest all bookmarks with checkStatus=true
	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		type retestUpdate struct {
			lastError   string
			lastChecked int64
		}
		updatesByKey := make(map[string]retestUpdate)

		for _, bm := range bookmarks {
			if !bm.CheckStatus {
				continue
			}

			result := h.pingURLDetailed(bm.URL)
			errMsg := ""
			if result.Status != "online" {
				errMsg = result.ErrorDetail
				if errMsg == "" {
					errMsg = "Unreachable"
				}
			}
			lastChecked := time.Now().UnixMilli()

			key := canonicalBookmarkURLKey(bm.URL)
			if key != "" {
				updatesByKey[key] = retestUpdate{
					lastError:   errMsg,
					lastChecked: lastChecked,
				}
				healthUpdates[key] = HealthScanCache{
					URL:         key,
					Status:      result.Status,
					PingMs:      result.PingMs,
					LastScanned: lastChecked,
					Error:       errMsg,
				}
			}

			results = append(results, map[string]interface{}{
				"name":   bm.Name,
				"url":    bm.URL,
				"status": result.Status,
				"pingMs": result.PingMs,
				"error":  errMsg,
			})
		}

		if len(updatesByKey) == 0 {
			continue
		}

		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				if !current[i].CheckStatus {
					continue
				}
				key := canonicalBookmarkURLKey(current[i].URL)
				if key == "" {
					continue
				}
				update, ok := updatesByKey[key]
				if !ok {
					continue
				}
				current[i].LastChecked = update.lastChecked
				current[i].LastError = update.lastError
			}
			return current, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			if !respondBookmarkMutationError(w, err) {
				return
			}
		}
	}

	if !respondStorePersistError(w, h.mergeHealthCacheUpdates(healthUpdates)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "completed",
		"count":   len(results),
		"results": results,
	})
}

// OpenBroken returns broken bookmark URLs for client-side opening.
// Optional JSON body: { "limit": N } (default 10, max 25).
func (h *Handlers) OpenBroken(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	const defaultLimit = 10
	const maxLimit = 25
	limit := defaultLimit

	var req struct {
		Limit int `json:"limit"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Limit > 0 {
			limit = req.Limit
			if limit > maxLimit {
				limit = maxLimit
			}
		}
	}

	pages := h.store.GetPages()
	var brokenURLs []string

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		for _, bm := range bookmarks {
			if strings.TrimSpace(bm.LastError) != "" {
				brokenURLs = append(brokenURLs, bm.URL)
			}
		}
	}

	totalBroken := len(brokenURLs)
	if limit > 0 && len(brokenURLs) > limit {
		brokenURLs = brokenURLs[:limit]
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"count":       len(brokenURLs),
		"totalBroken": totalBroken,
		"limit":       limit,
		"urls":        brokenURLs,
	})
}

// MergeDuplicates consolidates duplicate bookmarks into a single target
func (h *Handlers) MergeDuplicates(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var req struct {
		TargetPageID  int   `json:"targetPageId"`
		TargetIndex   int   `json:"targetIndex"`
		SourcePageIDs []int `json:"sourcePageIds"`
		SourceIndices []int `json:"sourceIndices"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if len(req.SourcePageIDs) != len(req.SourceIndices) {
		http.Error(w, "sourcePageIds and sourceIndices length mismatch", http.StatusBadRequest)
		return
	}
	if req.TargetPageID <= 0 {
		http.Error(w, "Invalid target page ID", http.StatusBadRequest)
		return
	}

	targetBookmarks := h.store.GetBookmarksByPage(req.TargetPageID)
	if req.TargetIndex < 0 || req.TargetIndex >= len(targetBookmarks) {
		http.Error(w, "Invalid target index", http.StatusBadRequest)
		return
	}

	keeper := targetBookmarks[req.TargetIndex]
	keeperKey := canonicalBookmarkURLKey(keeper.URL)
	if keeperKey == "" {
		http.Error(w, "Invalid target bookmark URL", http.StatusBadRequest)
		return
	}

	sources := make([]Bookmark, 0, len(req.SourcePageIDs))
	deletes := make([]mergeDeleteRef, 0, len(req.SourcePageIDs))
	for i := 0; i < len(req.SourcePageIDs); i++ {
		pageID := req.SourcePageIDs[i]
		index := req.SourceIndices[i]
		if pageID == req.TargetPageID && index == req.TargetIndex {
			continue
		}
		bookmarks := h.store.GetBookmarksByPage(pageID)
		if index < 0 || index >= len(bookmarks) {
			http.Error(w, "Invalid source index", http.StatusBadRequest)
			return
		}
		src := bookmarks[index]
		if canonicalBookmarkURLKey(src.URL) != keeperKey {
			http.Error(w, "Source URL does not match target", http.StatusBadRequest)
			return
		}
		sources = append(sources, src)
		deletes = append(deletes, mergeDeleteRef{pageID: pageID, index: index})
	}

	merged := keeper
	mergeBookmarkMetadata(&merged, sources)

	involvedPages := map[int]struct{}{req.TargetPageID: {}}
	for _, del := range deletes {
		involvedPages[del.pageID] = struct{}{}
	}
	pageSnapshots := make(map[int][]Bookmark, len(involvedPages))
	for pageID := range involvedPages {
		existing := h.store.GetBookmarksByPage(pageID)
		pageSnapshots[pageID] = append([]Bookmark(nil), existing...)
	}

	sort.Slice(deletes, func(i, j int) bool {
		if deletes[i].pageID != deletes[j].pageID {
			return deletes[i].pageID < deletes[j].pageID
		}
		return deletes[i].index > deletes[j].index
	})

	targetIndex := req.TargetIndex
	mergedCount := 0
	for _, del := range deletes {
		bookmarks := pageSnapshots[del.pageID]
		if del.index < 0 || del.index >= len(bookmarks) {
			http.Error(w, "Invalid source index", http.StatusBadRequest)
			return
		}
		if del.pageID == req.TargetPageID && del.index < targetIndex {
			targetIndex--
		}
		pageSnapshots[del.pageID] = append(bookmarks[:del.index], bookmarks[del.index+1:]...)
		mergedCount++
	}

	targetBookmarks = pageSnapshots[req.TargetPageID]
	if targetIndex < 0 || targetIndex >= len(targetBookmarks) {
		http.Error(w, "Target bookmark missing after merge", http.StatusInternalServerError)
		return
	}
	targetBookmarks[targetIndex] = merged
	pageSnapshots[req.TargetPageID] = targetBookmarks

	if !respondStorePersistError(w, h.store.SaveBookmarkPageUpdates(pageSnapshots)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "merged",
		"count":  mergedCount,
	})
}

// DeleteHealthBookmark removes one bookmark by page/index from health view.
func (h *Handlers) DeleteHealthBookmark(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID int `json:"pageId"`
		Index  int `json:"index"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}

	if !respondBookmarkMutationError(w, h.store.DeleteBookmarkAt(req.PageID, req.Index)) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "deleted"})
}

// AutoHealSuggest returns healing suggestions for a broken bookmark.
func (h *Handlers) AutoHealSuggest(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil || pageID <= 0 {
		http.Error(w, "Invalid pageId", http.StatusBadRequest)
		return
	}
	index, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("index")))
	if err != nil || index < 0 {
		http.Error(w, "Invalid index", http.StatusBadRequest)
		return
	}

	bookmarks := h.store.GetBookmarksByPage(pageID)
	if index >= len(bookmarks) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return
	}
	bookmark := bookmarks[index]
	currentURL := strings.TrimSpace(bookmark.URL)
	if currentURL == "" {
		http.Error(w, "Bookmark URL missing", http.StatusBadRequest)
		return
	}

	redirectURL := h.detectRedirectURL(currentURL)
	suggestedTitle := h.fetchPageTitleSafe(func() string {
		if redirectURL != "" {
			return redirectURL
		}
		return currentURL
	}())

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pageId":         pageID,
		"index":          index,
		"currentUrl":     currentURL,
		"redirectUrl":    redirectURL,
		"archiveUrl":     "https://web.archive.org/web/*/" + currentURL,
		"suggestedTitle": suggestedTitle,
	})
}

// AutoHealApply applies a one-click URL/title fix for a bookmark.
func (h *Handlers) AutoHealApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID       int    `json:"pageId"`
		Index        int    `json:"index"`
		NewURL       string `json:"newUrl"`
		RefreshTitle bool   `json:"refreshTitle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}

	updatedURL := strings.TrimSpace(req.NewURL)
	if updatedURL != "" {
		if err := h.validateBookmarkURL(updatedURL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid fix URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	appliedURL := false
	appliedTitle := false
	var result Bookmark
	err := h.store.MutateBookmarkAt(req.PageID, req.Index, func(bookmark *Bookmark) error {
		if updatedURL != "" && updatedURL != strings.TrimSpace(bookmark.URL) {
			bookmark.URL = updatedURL
			appliedURL = true
		}

		if req.RefreshTitle {
			targetURL := strings.TrimSpace(bookmark.URL)
			title := h.fetchPageTitleSafe(targetURL)
			if title != "" {
				bookmark.PreviewTitle = title
				// Keep user-defined names unless empty; fallback to fetched title.
				if strings.TrimSpace(bookmark.Name) == "" || appliedURL {
					bookmark.Name = title
				}
				appliedTitle = true
			}
		}

		if appliedURL {
			bookmark.LastError = ""
			bookmark.LastChecked = time.Now().UnixMilli()
		}

		result = *bookmark
		return nil
	})
	if !respondBookmarkMutationError(w, err) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":       "ok",
		"appliedUrl":   appliedURL,
		"appliedTitle": appliedTitle,
		"url":          result.URL,
		"title":        result.PreviewTitle,
	})
}

func (h *Handlers) detectRedirectURL(urlStr string) string {
	if err := validateHTTPURL(strings.TrimSpace(urlStr), h.allowLocalBookmarks()); err != nil {
		return ""
	}
	allowLocal := h.allowLocalBookmarks()
	client := &http.Client{
		Timeout:   6 * time.Second,
		Transport: newSSRFSafeTransport(allowLocal, 2*time.Second),
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	resp, err := client.Get(urlStr)
	if err == nil && resp != nil {
		defer resp.Body.Close()
		if resp.StatusCode >= 300 && resp.StatusCode < 400 {
			location := strings.TrimSpace(resp.Header.Get("Location"))
			if location != "" {
				base, parseErr := url.Parse(urlStr)
				locURL, locErr := url.Parse(location)
				if parseErr == nil && locErr == nil {
					resolved := base.ResolveReference(locURL).String()
					if strings.TrimSpace(resolved) != strings.TrimSpace(urlStr) {
						if err := validateHTTPURL(resolved, h.allowLocalBookmarks()); err == nil {
							return resolved
						}
					}
				}
			}
		}
	}

	followClient := h.outboundHTTPClient(7*time.Second, 5)
	resp, err = followClient.Get(urlStr)
	if err != nil || resp == nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL := strings.TrimSpace(resp.Request.URL.String())
		if finalURL != "" && finalURL != strings.TrimSpace(urlStr) {
			if err := validateHTTPURL(finalURL, h.allowLocalBookmarks()); err == nil {
				return finalURL
			}
		}
	}
	return ""
}

func (h *Handlers) fetchPageTitleSafe(urlStr string) string {
	urlStr = strings.TrimSpace(urlStr)
	if urlStr == "" {
		return ""
	}
	if err := validateHTTPURL(urlStr, h.allowLocalBookmarks()); err != nil {
		return ""
	}
	client := h.outboundHTTPClient(8*time.Second, 5)
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "nextDash AutoHealer/1.0")

	resp, err := client.Do(req)
	if err != nil || resp == nil {
		return ""
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return ""
	}
	html := string(body)
	lower := strings.ToLower(html)
	titleOpen := strings.Index(lower, "<title")
	if titleOpen < 0 {
		return ""
	}
	titleStart := strings.Index(lower[titleOpen:], ">")
	if titleStart < 0 {
		return ""
	}
	titleStart = titleOpen + titleStart + 1
	titleEndRel := strings.Index(lower[titleStart:], "</title>")
	if titleEndRel < 0 {
		return ""
	}
	title := strings.TrimSpace(html[titleStart : titleStart+titleEndRel])
	if title == "" {
		return ""
	}
	return strings.Join(strings.Fields(title), " ")
}
