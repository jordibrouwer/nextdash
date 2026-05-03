package main

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type Handlers struct {
	store Store
	files embed.FS
}

func normalizeShortcut(shortcut string) string {
	return strings.ToUpper(strings.TrimSpace(shortcut))
}

// canonicalBookmarkURLKey normalizes URLs so obvious duplicates (trailing slash, hash, case) match.
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
	host := strings.ToLower(u.Host)
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

func NewHandlers(store Store, files embed.FS) *Handlers {
	return &Handlers{
		store: store,
		files: files,
	}
}

func (h *Handlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(h.files, "templates/dashboard.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, settings); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())
}

func (h *Handlers) Config(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(h.files, "templates/config.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, settings); err != nil {
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
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
		if err := validateBookmarkURL(bookmark.URL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid bookmark URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
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

	h.store.SaveBookmarksByPage(pageID, bookmarks)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) AddBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
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
	if err := validateBookmarkURL(request.Bookmark.URL); err != nil {
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

	h.store.AddBookmarkToPage(request.Page, request.Bookmark)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) DeleteBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w)
	if r.Method == "OPTIONS" {
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
		http.Error(w, "Error deleting bookmark", http.StatusInternalServerError)
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
	var finders []Finder
	if err := json.NewDecoder(r.Body).Decode(&finders); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	h.store.SaveFinders(finders)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) SaveCategories(w http.ResponseWriter, r *http.Request) {
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

	h.store.SaveCategoriesByPage(pageID, categories)
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
	h.store.SavePageOrder(order)

	// Save each page individually
	// Note: This assumes bookmarks are saved separately via SaveBookmarks endpoint
	for _, page := range pages {
		// Get existing bookmarks for this page to preserve them
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		h.store.SavePage(page, bookmarks)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) DeletePage(w http.ResponseWriter, r *http.Request) {
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
	h.store.SavePageOrder(newOrder)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(settings)
}

func (h *Handlers) SaveSettings(w http.ResponseWriter, r *http.Request) {
	var settings Settings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	h.store.SaveSettings(settings)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) Colors(w http.ResponseWriter, r *http.Request) {
	tmpl, err := template.ParseFS(h.files, "templates/colors.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()

	data := struct {
		Theme                     string
		FontSize                  string
		FontPreset                string
		ShowBackgroundDots        bool
		ShowTitle                 bool
		ShowDate                  bool
		ShowConfigButton          bool
		ShowSearchButton          bool
		ShowFindersButton         bool
		ShowCommandsButton        bool
		ShowSearchButtonText      bool
		ShowFindersButtonText     bool
		ShowCommandsButtonText    bool
		ShowStatus                bool
		ShowPing                  bool
		ShowStatusLoading         bool
		SkipFastPing              bool
		GlobalShortcuts           bool
		HyprMode                  bool
		AnimationsEnabled         bool
		EnableCustomTitle         bool
		CustomTitle               string
		ShowPageInTitle           bool
		ShowPageNamesInTabs       bool
		EnableCustomFavicon       bool
		CustomFaviconPath         string
		EnableCustomFont          bool
		CustomFontPath            string
		Language                  string
		InterleaveMode            bool
		ShowPageTabs              bool
		EnableFuzzySuggestions    bool
		FuzzySuggestionsStartWith bool
		KeepSearchOpenWhenEmpty   bool
		ShowIcons                 bool
		IncludeFindersInSearch    bool
		AlwaysCollapseCategories  bool
	}{
		Theme:                     settings.Theme,
		FontSize:                  settings.FontSize,
		FontPreset:                settings.FontPreset,
		ShowBackgroundDots:        settings.ShowBackgroundDots,
		ShowTitle:                 settings.ShowTitle,
		ShowDate:                  settings.ShowDate,
		ShowConfigButton:          settings.ShowConfigButton,
		ShowSearchButton:          settings.ShowSearchButton,
		ShowFindersButton:         settings.ShowFindersButton,
		ShowCommandsButton:        settings.ShowCommandsButton,
		ShowSearchButtonText:      settings.ShowSearchButtonText,
		ShowFindersButtonText:     settings.ShowFindersButtonText,
		ShowCommandsButtonText:    settings.ShowCommandsButtonText,
		ShowStatus:                settings.ShowStatus,
		ShowPing:                  settings.ShowPing,
		ShowStatusLoading:         settings.ShowStatusLoading,
		SkipFastPing:              settings.SkipFastPing,
		GlobalShortcuts:           settings.GlobalShortcuts,
		HyprMode:                  settings.HyprMode,
		AnimationsEnabled:         settings.AnimationsEnabled,
		EnableCustomTitle:         settings.EnableCustomTitle,
		CustomTitle:               settings.CustomTitle,
		ShowPageInTitle:           settings.ShowPageInTitle,
		ShowPageNamesInTabs:       settings.ShowPageNamesInTabs,
		EnableCustomFavicon:       settings.EnableCustomFavicon,
		CustomFaviconPath:         settings.CustomFaviconPath,
		EnableCustomFont:          settings.EnableCustomFont,
		CustomFontPath:            settings.CustomFontPath,
		Language:                  settings.Language,
		InterleaveMode:            settings.InterleaveMode,
		ShowPageTabs:              settings.ShowPageTabs,
		EnableFuzzySuggestions:    settings.EnableFuzzySuggestions,
		FuzzySuggestionsStartWith: settings.FuzzySuggestionsStartWith,
		KeepSearchOpenWhenEmpty:   settings.KeepSearchOpenWhenEmpty,
		ShowIcons:                 settings.ShowIcons,
		IncludeFindersInSearch:    settings.IncludeFindersInSearch,
		AlwaysCollapseCategories:  settings.AlwaysCollapseCategories,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	w.Write(buf.Bytes())
}

func (h *Handlers) GetColors(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(colors)
}

func (h *Handlers) SaveColors(w http.ResponseWriter, r *http.Request) {
	var colors ColorTheme
	if err := json.NewDecoder(r.Body).Decode(&colors); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	h.store.SaveColors(colors)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) ResetColors(w http.ResponseWriter, r *http.Request) {
	// Get current colors to preserve custom themes
	currentColors := h.store.GetColors()

	// Reset only light and dark themes to defaults, keep custom themes
	defaultColors := ColorTheme{
		Light:   getDefaultLightTheme(),
		Dark:    getDefaultDarkTheme(),
		BuiltIn: getDefaultBuiltInThemes(),
		Custom:  currentColors.Custom, // Preserve existing custom themes
	}

	h.store.SaveColors(defaultColors)
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

func (h *Handlers) CustomThemeCSS(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()

	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	css := `/* Custom Theme Variables - Loaded from colors.json */

/* Light Theme Variables */
html[data-theme="light"] body {
    /* Text Colors */
    --text-primary: ` + colors.Light.TextPrimary + `;
    --text-secondary: ` + colors.Light.TextSecondary + `;
    --text-tertiary: ` + colors.Light.TextTertiary + `;
    
    /* Background Colors */
    --background-primary: ` + colors.Light.BackgroundPrimary + `;
    --background-secondary: ` + colors.Light.BackgroundSecondary + `;
    --background-dots: ` + colors.Light.BackgroundDots + `;
    --background-modal: ` + colors.Light.BackgroundModal + `;
    
    /* Border Colors */
    --border-primary: ` + colors.Light.BorderPrimary + `;
    --border-secondary: ` + colors.Light.BorderSecondary + `;
    
    /* Accent Colors */
    --accent-success: ` + colors.Light.AccentSuccess + `;
    --accent-warning: ` + colors.Light.AccentWarning + `;
    --accent-error: ` + colors.Light.AccentError + `;
}

/* Dark Theme Variables */
html[data-theme="dark"] body {
    /* Text Colors */
    --text-primary: ` + colors.Dark.TextPrimary + `;
    --text-secondary: ` + colors.Dark.TextSecondary + `;
    --text-tertiary: ` + colors.Dark.TextTertiary + `;
    
    /* Background Colors */
    --background-primary: ` + colors.Dark.BackgroundPrimary + `;
    --background-secondary: ` + colors.Dark.BackgroundSecondary + `;
    --background-dots: ` + colors.Dark.BackgroundDots + `;
    --background-modal: ` + colors.Dark.BackgroundModal + `;
    
    /* Border Colors */
    --border-primary: ` + colors.Dark.BorderPrimary + `;
    --border-secondary: ` + colors.Dark.BorderSecondary + `;
    
    /* Accent Colors */
    --accent-success: ` + colors.Dark.AccentSuccess + `;
    --accent-warning: ` + colors.Dark.AccentWarning + `;
    --accent-error: ` + colors.Dark.AccentError + `;
}
`

	// Add custom themes CSS
	for themeID, themeColors := range colors.Custom {
		customThemeCSS := `
/* Custom Theme: ` + themeID + ` */
html[data-theme="` + themeID + `"] body {
    /* Text Colors */
    --text-primary: ` + themeColors.TextPrimary + `;
    --text-secondary: ` + themeColors.TextSecondary + `;
    --text-tertiary: ` + themeColors.TextTertiary + `;
    
    /* Background Colors */
    --background-primary: ` + themeColors.BackgroundPrimary + `;
    --background-secondary: ` + themeColors.BackgroundSecondary + `;
    --background-dots: ` + themeColors.BackgroundDots + `;
    --background-modal: ` + themeColors.BackgroundModal + `;
    
    /* Border Colors */
    --border-primary: ` + themeColors.BorderPrimary + `;
    --border-secondary: ` + themeColors.BorderSecondary + `;
    
    /* Accent Colors */
    --accent-success: ` + themeColors.AccentSuccess + `;
    --accent-warning: ` + themeColors.AccentWarning + `;
    --accent-error: ` + themeColors.AccentError + `;
}
`
		css += customThemeCSS
	}

	// Add built-in themes CSS
	builtInThemeIDs := make([]string, 0, len(colors.BuiltIn))
	for themeID := range colors.BuiltIn {
		builtInThemeIDs = append(builtInThemeIDs, themeID)
	}
	sort.Strings(builtInThemeIDs)
	for _, themeID := range builtInThemeIDs {
		themeColors := colors.BuiltIn[themeID]
		builtInThemeCSS := `
/* Built-in Theme: ` + themeID + ` */
html[data-theme="` + themeID + `"] body {
    --text-primary: ` + themeColors.TextPrimary + `;
    --text-secondary: ` + themeColors.TextSecondary + `;
    --text-tertiary: ` + themeColors.TextTertiary + `;
    --background-primary: ` + themeColors.BackgroundPrimary + `;
    --background-secondary: ` + themeColors.BackgroundSecondary + `;
    --background-dots: ` + themeColors.BackgroundDots + `;
    --background-modal: ` + themeColors.BackgroundModal + `;
    --border-primary: ` + themeColors.BorderPrimary + `;
    --border-secondary: ` + themeColors.BorderSecondary + `;
    --accent-success: ` + themeColors.AccentSuccess + `;
    --accent-warning: ` + themeColors.AccentWarning + `;
    --accent-error: ` + themeColors.AccentError + `;
}
`
		css += builtInThemeCSS
	}

	w.Write([]byte(css))
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Analytics endpoint
func (h *Handlers) GetAnalytics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pages := h.store.GetPages()
	var allBookmarks []BookmarkWithCount
	var unusedCount int
	var staleBookmarks []BookmarkWithCount
	nowMillis := time.Now().UnixMilli()
	const staleThresholdMillis = int64(30 * 24 * 60 * 60 * 1000) // 30 days

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		for _, bm := range bookmarks {
			effectiveOpenCount := bm.OpenCount
			if effectiveOpenCount <= 0 && bm.LastOpened > 0 {
				// Backward-compatible usage signal for older data.
				effectiveOpenCount = 1
			}

			allBookmarks = append(allBookmarks, BookmarkWithCount{
				Name:       bm.Name,
				URL:        bm.URL,
				OpenCount:  effectiveOpenCount,
				LastOpened: bm.LastOpened,
				PageID:     page.ID,
			})
			if effectiveOpenCount == 0 {
				unusedCount++
			}

			isStale := bm.LastOpened == 0 || (nowMillis-bm.LastOpened) > staleThresholdMillis
			if isStale {
				staleBookmarks = append(staleBookmarks, BookmarkWithCount{
					Name:       bm.Name,
					URL:        bm.URL,
					OpenCount:  effectiveOpenCount,
					LastOpened: bm.LastOpened,
					PageID:     page.ID,
				})
			}
		}
	}

	analytics := BookmarkAnalytics{
		TotalBookmarks: len(allBookmarks),
		UnusedCount:    unusedCount,
		StaleCount:     len(staleBookmarks),
	}

	// Sort for most opened
	if len(allBookmarks) > 0 {
		sort.Slice(allBookmarks, func(i, j int) bool {
			return allBookmarks[i].OpenCount > allBookmarks[j].OpenCount
		})
		analytics.MostOpened = allBookmarks
	}

	if len(staleBookmarks) > 0 {
		sort.Slice(staleBookmarks, func(i, j int) bool {
			left := staleBookmarks[i].LastOpened
			right := staleBookmarks[j].LastOpened
			if left == 0 {
				return true
			}
			if right == 0 {
				return false
			}
			return left < right
		})
		analytics.StaleBookmarks = staleBookmarks
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(analytics)
}

// Duplicate detection endpoint
func (h *Handlers) CheckDuplicates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	pages := h.store.GetPages()
	duplicates := make(map[string][]BookmarkRef)

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		for idx, bm := range bookmarks {
			normalizedURL := strings.ToLower(strings.TrimSpace(bm.URL))
			duplicates[normalizedURL] = append(duplicates[normalizedURL], BookmarkRef{
				Name:   bm.Name,
				Index:  idx,
				PageID: page.ID,
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

	warning := DuplicateWarning{
		DuplicateURLs: duplicateGroups,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(warning)
}

// Build search index
func (h *Handlers) BuildSearchIndex(w http.ResponseWriter, r *http.Request) {
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
	h.store.SaveSettings(settings)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(index)
}

// Get bookmark preview metadata
func (h *Handlers) GetBookmarkPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	url := r.URL.Query().Get("url")
	if url == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "URL required"})
		return
	}

	// Simple preview extraction (in production, use a library like colly or metascraper)
	preview := BookmarkPreview{
		URL:       url,
		Title:     "",
		Domain:    extractDomain(url),
		FetchedAt: 0,
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(preview)
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

// Track bookmark opens for analytics
func (h *Handlers) TrackBookmarkOpen(w http.ResponseWriter, r *http.Request) {
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

	bookmarks := h.store.GetBookmarksByPage(pageID)
	if index < 0 || index >= len(bookmarks) {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	bookmarks[index].OpenCount++
	bookmarks[index].LastOpened = time.Now().UnixMilli()
	h.store.SaveBookmarksByPage(pageID, bookmarks)

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
