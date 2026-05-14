package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

type Bookmark struct {
	Name         string   `json:"name"`
	URL          string   `json:"url"`
	PageID       int      `json:"pageId,omitempty"`
	Shortcut     string   `json:"shortcut"`
	Category     string   `json:"category"`
	Pinned       bool     `json:"pinned,omitempty"`
	CheckStatus  bool     `json:"checkStatus"`
	Icon         string   `json:"icon"`
	CreatedAt    int64    `json:"createdAt,omitempty"` // Timestamp when bookmark was created
	LastOpened   int64    `json:"lastOpened,omitempty"`
	LastChecked  int64    `json:"lastChecked,omitempty"`
	LastError    string   `json:"lastError,omitempty"`
	OpenCount    int      `json:"openCount,omitempty"`    // Analytics: track opens
	PreviewTitle string   `json:"previewTitle,omitempty"` // Preview metadata
	PreviewDesc  string   `json:"previewDesc,omitempty"`  // Preview description
	PreviewImage string   `json:"previewImage,omitempty"` // Preview image URL
	Note         string   `json:"note,omitempty"`         // User note for bookmark
	Tags         []string `json:"tags,omitempty"`
}

type Finder struct {
	Name      string   `json:"name"`
	SearchUrl string   `json:"searchUrl"`
	Shortcut  string   `json:"shortcut"`
	Tags      []string `json:"tags,omitempty"`
	UseCount  int      `json:"useCount,omitempty"`
	LastUsed  int64    `json:"lastUsed,omitempty"`
}

type CollectionRule struct {
	Field    string `json:"field"`    // "tag", "category", "shortcut"
	Operator string `json:"operator"` // "includes", "excludes"
	Value    string `json:"value"`
}

type Collection struct {
	ID    string           `json:"id"`
	Name  string           `json:"name"`
	Icon  string           `json:"icon,omitempty"`
	Logic string           `json:"logic"` // "and" | "or"
	Rules []CollectionRule `json:"rules"`
}

type Category struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	OriginalID string `json:"originalId,omitempty"` // Track original ID for renames
	Icon       string `json:"icon,omitempty"`       // Custom icon for category
}

type Page struct {
	ID   int    `json:"id"`   // Numeric ID matching the file number (bookmarks-1.json = id: 1)
	Name string `json:"name"` // Editable page name
}

type PageWithBookmarks struct {
	Page       Page       `json:"page"`
	Categories []Category `json:"categories,omitempty"`
	Bookmarks  []Bookmark `json:"bookmarks"`
}

type PageOrder struct {
	Order []int `json:"order"` // Array of page IDs in display order
}

type Settings struct {
	CurrentPage                 int                              `json:"currentPage"` // Numeric ID of the current page
	Theme                       string                           `json:"theme"`       // "light" or "dark"
	OpenInNewTab                bool                             `json:"openInNewTab"`
	ColumnsPerRow               int                              `json:"columnsPerRow"`
	FontSize                    string                           `json:"fontSize"` // "small", "medium", or "large"
	ShowBackgroundDots          bool                             `json:"showBackgroundDots"`
	ShowTitle                   bool                             `json:"showTitle"`
	ShowDate                    bool                             `json:"showDate"`
	ShowTime                    bool                             `json:"showTime"`
	TimeFormat                  string                           `json:"timeFormat"`          // 24h or 12h
	DateFormat                  string                           `json:"dateFormat"`          // Date format: short-slash, short-dash, long-weekday
	ShowWeatherWithDate         bool                             `json:"showWeatherWithDate"` // Show weather info next to date
	WeatherSource               string                           `json:"weatherSource"`       // manual or browser
	WeatherLocation             string                           `json:"weatherLocation"`     // Manual location query (city)
	WeatherUnit                 string                           `json:"weatherUnit"`         // celsius or fahrenheit
	WeatherRefreshMinutes       int                              `json:"weatherRefreshMinutes"`
	ShowConfigButton            bool                             `json:"showConfigButton"`
	ShowHealthDashboard         bool                             `json:"showHealthDashboard"`
	ShowSearchButton            bool                             `json:"showSearchButton"`
	ShowFindersButton           bool                             `json:"showFindersButton"`
	ShowCommandsButton          bool                             `json:"showCommandsButton"`
	ShowRecentButton            bool                             `json:"showRecentButton"`
	ShowTips                    bool                             `json:"showTips"`
	ShowSearchFlowBanner        bool                             `json:"showSearchFlowBanner"`
	ShowCheatSheetButton        bool                             `json:"showCheatSheetButton"`
	ShowSearchButtonText        bool                             `json:"showSearchButtonText"`
	ShowFindersButtonText       bool                             `json:"showFindersButtonText"`
	ShowCommandsButtonText      bool                             `json:"showCommandsButtonText"`
	ShowStatus                  bool                             `json:"showStatus"`
	ColorizeStatus              bool                             `json:"colorizeStatus"` // Keep online/offline/checking color changes on bookmark rows
	ShowPing                    bool                             `json:"showPing"`
	ShowStatusLoading           bool                             `json:"showStatusLoading"`
	SkipFastPing                bool                             `json:"skipFastPing"`
	GlobalShortcuts             bool                             `json:"globalShortcuts"`             // Use shortcuts from all pages
	HyprMode                    bool                             `json:"hyprMode"`                    // Launcher mode for PWA usage
	AnimationsEnabled           bool                             `json:"animationsEnabled"`           // Enable or disable animations globally
	EnableCustomTitle           bool                             `json:"enableCustomTitle"`           // Enable custom page title
	CustomTitle                 string                           `json:"customTitle"`                 // Custom page title
	ShowPageInTitle             bool                             `json:"showPageInTitle"`             // Show current page name in title
	ShowPageNamesInTabs         bool                             `json:"showPageNamesInTabs"`         // Show page names in tabs instead of numbers
	EnableCustomFavicon         bool                             `json:"enableCustomFavicon"`         // Enable custom favicon
	CustomFaviconPath           string                           `json:"customFaviconPath"`           // Path to custom favicon file
	EnableCustomFont            bool                             `json:"enableCustomFont"`            // Enable custom font
	CustomFontPath              string                           `json:"customFontPath"`              // Path to custom font file
	Language                    string                           `json:"language"`                    // Language code, e.g., "en" or "es"
	InterleaveMode              bool                             `json:"interleaveMode"`              // Interleave mode for search (/ for shortcuts, direct input for fuzzy)
	ShowPageTabs                bool                             `json:"showPageTabs"`                // Show page navigation tabs
	AlwaysCollapseCategories    bool                             `json:"alwaysCollapseCategories"`    // Always collapse categories on load
	EnableFuzzySuggestions      bool                             `json:"enableFuzzySuggestions"`      // Enable fuzzy suggestions in shortcut search
	FuzzySuggestionsStartWith   bool                             `json:"fuzzySuggestionsStartWith"`   // Fuzzy suggestions start with query instead of contains
	KeepSearchOpenWhenEmpty     bool                             `json:"keepSearchOpenWhenEmpty"`     // Keep search interface open when query is empty
	ShowIcons                   bool                             `json:"showIcons"`                   // Show bookmark icons
	ShowLinkPreviewCards        bool                             `json:"showLinkPreviewCards"`        // Show link preview cards on hover
	LinkPreviewHoverDelayMs     int                              `json:"linkPreviewHoverDelayMs"`     // Hover delay before preview card appears
	ShowShortcuts               bool                             `json:"showShortcuts"`               // Show bookmark shortcuts
	ShowPinIcon                 bool                             `json:"showPinIcon"`                 // Show pin icon next to pinned bookmarks
	ShowNoteIcon                bool                             `json:"showNoteIcon"`                // Show note icon next to bookmarks with a note
	IncludeFindersInSearch      bool                             `json:"includeFindersInSearch"`      // Include finders in normal search
	SortMethod                  string                           `json:"sortMethod"`                  // Sort method for bookmarks: order, az, recent, custom
	LayoutPreset                string                           `json:"layoutPreset"`                // Dashboard layout preset
	DensityMode                 string                           `json:"densityMode"`                 // Dashboard density mode: comfortable, compact, dense
	PackedColumns               bool                             `json:"packedColumns"`               // Stack categories in vertical columns (round-robin) to reduce empty space
	BackgroundOpacity           float64                          `json:"backgroundOpacity"`           // Background opacity (0.0-1.0)
	FontWeight                  string                           `json:"fontWeight"`                  // Font weight: normal, 600, bold
	FontPreset                  string                           `json:"fontPreset"`                  // UI font preset: source-code-pro, jetbrains-mono, etc.
	AutoDarkMode                bool                             `json:"autoDarkMode"`                // Auto-detect dark mode from system
	ShowSmartRecentCollection   bool                             `json:"showSmartRecentCollection"`   // Show smart recently opened collection
	ShowSmartTodayCollection    bool                             `json:"showSmartTodayCollection"`    // Show smart start "today" collection
	ShowSmartStaleCollection    bool                             `json:"showSmartStaleCollection"`    // Show smart stale bookmarks collection
	ShowSmartMostUsedCollection bool                             `json:"showSmartMostUsedCollection"` // Show smart most used bookmarks collection
	SmartTodayLimit             int                              `json:"smartTodayLimit"`             // Max items in smart today (0 = unlimited)
	SmartRecentLimit            int                              `json:"smartRecentLimit"`            // Max items in smart recently opened (0 = unlimited)
	SmartStaleLimit             int                              `json:"smartStaleLimit"`             // Max items in smart stale bookmarks (0 = unlimited)
	SmartMostUsedLimit          int                              `json:"smartMostUsedLimit"`          // Max items in smart most used (0 = unlimited)
	SmartTodayWorkKeywords      string                           `json:"smartTodayWorkKeywords"`      // Comma-separated work-hour keyword boosts
	SmartTodayEveningKeywords   string                           `json:"smartTodayEveningKeywords"`   // Comma-separated evening keyword boosts
	SmartTodayWeekendKeywords   string                           `json:"smartTodayWeekendKeywords"`   // Comma-separated weekend keyword boosts
	SmartTodayPageIds           []int                            `json:"smartTodayPageIds"`           // Page IDs where smart today is enabled (empty = all)
	SmartRecentPageIds          []int                            `json:"smartRecentPageIds"`          // Page IDs where smart recent is enabled (empty = all)
	SmartStalePageIds           []int                            `json:"smartStalePageIds"`           // Page IDs where smart stale is enabled (empty = all)
	SmartMostUsedPageIds        []int                            `json:"smartMostUsedPageIds"`        // Page IDs where smart most used is enabled (empty = all)
	ArchivedPageIds             []int                            `json:"archivedPageIds"`             // Archived pages hidden from active management flows
	Collections                 []Collection                     `json:"collections,omitempty"`       // User-defined dynamic collections
	ShowTagCollections          bool                             `json:"showTagCollections"`          // Auto-generate a collection per tag
	TagCollectionsMinCount      int                              `json:"tagCollectionsMinCount"`      // Minimum bookmarks per tag to show collection (0 = all)
	FaviconRefreshPolicy        string                           `json:"faviconRefreshPolicy"`        // Favicon policy: manual, on-save
	SearchIndexed               bool                             `json:"searchIndexed"`               // Is search index built
	OnboardingCompleted         bool                             `json:"onboardingCompleted"`
	CustomKeyBindings           map[string]string                `json:"customKeyBindings,omitempty"` // Custom keyboard key remappings (e.g., {"search": "s", "commands": "c"})
	BackgroundType              string                           `json:"backgroundType"`              // "auto", "none", "gradient", "image"
	BackgroundGradient          string                           `json:"backgroundGradient"`          // preset name used when type="gradient"
	BackgroundImageUrl          string                           `json:"backgroundImageUrl"`          // URL used when type="image"
	ThemeIconStyling            map[string]ThemeIconStylingEntry `json:"themeIconStyling,omitempty"`
}

type ThemeIconStylingEntry struct {
	Enabled   bool    `json:"enabled"`
	Style     string  `json:"style"`
	Intensity float64 `json:"intensity"`
}

func isValidFontPreset(s string) bool {
	switch s {
	case "source-code-pro", "jetbrains-mono", "ibm-plex-mono", "inter", "ibm-plex-sans", "dm-sans", "system":
		return true
	default:
		return false
	}
}

func normalizeFontPreset(s string) string {
	if isValidFontPreset(s) {
		return s
	}
	return "source-code-pro"
}

type ColorTheme struct {
	Light   ThemeColors            `json:"light"`
	Dark    ThemeColors            `json:"dark"`
	BuiltIn map[string]ThemeColors `json:"builtIn"`
	Custom  map[string]ThemeColors `json:"custom"` // Custom themes with dynamic keys
}

type ThemeColors struct {
	Name                string `json:"name,omitempty"` // Optional name for custom themes
	TextPrimary         string `json:"textPrimary"`
	TextSecondary       string `json:"textSecondary"`
	TextTertiary        string `json:"textTertiary"`
	BackgroundPrimary   string `json:"backgroundPrimary"`
	BackgroundSecondary string `json:"backgroundSecondary"`
	BackgroundDots      string `json:"backgroundDots"`
	BackgroundModal     string `json:"backgroundModal"`
	BorderPrimary       string `json:"borderPrimary"`
	BorderSecondary     string `json:"borderSecondary"`
	AccentSuccess       string `json:"accentSuccess"`
	AccentWarning       string `json:"accentWarning"`
	AccentError         string `json:"accentError"`
}

type Store interface {
	// Bookmarks - per page only
	GetBookmarksByPage(pageID int) []Bookmark
	GetAllBookmarks() []Bookmark
	BookmarkURLExists(url string) bool
	SaveBookmarksByPage(pageID int, bookmarks []Bookmark)
	AddBookmarkToPage(pageID int, bookmark Bookmark)
	DeleteBookmarkFromPage(pageID int, bookmark Bookmark) error
	// Categories - per page only
	GetCategoriesByPage(pageID int) []Category
	SaveCategoriesByPage(pageID int, categories []Category)
	// Finders
	GetFinders() []Finder
	SaveFinders(finders []Finder)
	// Pages
	GetPages() []Page
	SavePage(page Page, bookmarks []Bookmark)
	DeletePage(pageID int) error
	GetPageOrder() []int
	SavePageOrder(order []int)
	// Settings
	GetSettings() Settings
	SaveSettings(settings Settings)
	// Colors
	GetColors() ColorTheme
	SaveColors(colors ColorTheme)
}

type FileStore struct {
	settingsFile                string
	colorsFile                  string
	pageOrderFile               string
	dataDir                     string
	customThemesMigrationMarker string
	mutex                       sync.RWMutex
}

func NewStore() Store {
	store := &FileStore{
		settingsFile:                "data/settings.json",
		colorsFile:                  "data/colors.json",
		pageOrderFile:               "data/pages.json",
		dataDir:                     "data",
		customThemesMigrationMarker: "data/.custom-themes-reset-v1",
	}

	// Initialize default files if they don't exist
	store.initializeDefaultFiles()

	return store
}

func (fs *FileStore) initializeDefaultFiles() {
	fs.ensureDataDir()

	// Initialize bookmarks for main page if file doesn't exist
	mainPageBookmarksFile := "data/bookmarks-1.json"
	if _, err := os.Stat(mainPageBookmarksFile); os.IsNotExist(err) {
		defaultPageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   1,
				Name: "main",
			},
			Categories: []Category{
				{ID: "development", Name: "Development"},
				{ID: "media", Name: "Media"},
				{ID: "social", Name: "Social"},
				{ID: "search", Name: "Search"},
				{ID: "utilities", Name: "Utilities"},
			},
			Bookmarks: []Bookmark{
				{Name: "GitHub", URL: "https://github.com", Shortcut: "G", Category: "development", CheckStatus: false},
				{Name: "GitHub Issues", URL: "https://github.com/issues", Shortcut: "GI", Category: "development", CheckStatus: false},
				{Name: "GitHub Pull Requests", URL: "https://github.com/pulls", Shortcut: "GP", Category: "development", CheckStatus: false},
				{Name: "YouTube", URL: "https://youtube.com", Shortcut: "Y", Category: "media", CheckStatus: false},
				{Name: "YouTube Studio", URL: "https://studio.youtube.com", Shortcut: "YS", Category: "media", CheckStatus: false},
				{Name: "Facebook", URL: "https://facebook.com", Shortcut: "F", Category: "social", CheckStatus: false},
				{Name: "Instagram", URL: "https://instagram.com", Shortcut: "INS", Category: "social", CheckStatus: false},
				{Name: "Google", URL: "https://google.com", Shortcut: "", Category: "search", CheckStatus: false},
			},
		}
		data, _ := json.MarshalIndent(defaultPageWithBookmarks, "", "  ")
		os.WriteFile(mainPageBookmarksFile, data, 0644)
	}

	// Initialize settings if file doesn't exist
	if _, err := os.Stat(fs.settingsFile); os.IsNotExist(err) {
		defaultSettings := Settings{
			CurrentPage:                 1,
			Theme:                       "cherry-graphite-dark",
			OpenInNewTab:                true,
			ColumnsPerRow:               3,
			FontSize:                    "medium",
			ShowBackgroundDots:          true,
			ShowTitle:                   true,
			ShowDate:                    true,
			ShowTime:                    true,
			TimeFormat:                  "24h",
			DateFormat:                  "short-slash",
			ShowWeatherWithDate:         false,
			WeatherSource:               "manual",
			WeatherLocation:             "",
			WeatherUnit:                 "celsius",
			WeatherRefreshMinutes:       30,
			ShowConfigButton:            true,
			ShowHealthDashboard:         false,
			ShowSearchButton:            true,
			ShowFindersButton:           false,
			ShowCommandsButton:          true,
			ShowRecentButton:            true,
			ShowTips:                    false,
			ShowSearchFlowBanner:        true,
			ShowCheatSheetButton:        true,
			ShowSearchButtonText:        true,
			ShowFindersButtonText:       true,
			ShowCommandsButtonText:      true,
			ShowStatus:                  false,
			ColorizeStatus:              true,
			ShowPing:                    false,
			ShowStatusLoading:           false,
			SkipFastPing:                false,
			GlobalShortcuts:             true,
			HyprMode:                    false,
			AnimationsEnabled:           true,
			EnableCustomTitle:           false,
			CustomTitle:                 "",
			ShowPageInTitle:             false,
			ShowPageNamesInTabs:         false,
			EnableCustomFavicon:         false,
			CustomFaviconPath:           "",
			EnableCustomFont:            false,
			CustomFontPath:              "",
			Language:                    "en",
			InterleaveMode:              false,
			ShowPageTabs:                true,
			AlwaysCollapseCategories:    false,
			EnableFuzzySuggestions:      false,
			FuzzySuggestionsStartWith:   false,
			KeepSearchOpenWhenEmpty:     false,
			ShowIcons:                   false,
			ShowLinkPreviewCards:        true,
			LinkPreviewHoverDelayMs:     150,
			ShowShortcuts:               true,
			ShowPinIcon:                 false,
			ShowNoteIcon:                true,
			IncludeFindersInSearch:      false,
			SortMethod:                  "order",
			LayoutPreset:                "default",
			BackgroundOpacity:           1,
			FontWeight:                  "normal",
			FontPreset:                  "source-code-pro",
			AutoDarkMode:                false,
			ShowSmartRecentCollection:   false,
			ShowSmartTodayCollection:    true,
			ShowSmartStaleCollection:    false,
			ShowSmartMostUsedCollection: false,
			SmartTodayLimit:             8,
			SmartRecentLimit:            50,
			SmartMostUsedLimit:          25,
			SmartTodayWorkKeywords:      "calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams",
			SmartTodayEveningKeywords:   "youtube,spotify,netflix,reddit",
			SmartTodayWeekendKeywords:   "news,weather,maps",
			SmartTodayPageIds:           []int{},
			SmartRecentPageIds:          []int{},
			SmartStalePageIds:           []int{},
			SmartMostUsedPageIds:        []int{},
			ArchivedPageIds:             []int{},
			FaviconRefreshPolicy:        "on-save",
			OnboardingCompleted:         false,
			PackedColumns:               true,
		}
		data, _ := json.MarshalIndent(defaultSettings, "", "  ")
		os.WriteFile(fs.settingsFile, data, 0644)
	}

	// Initialize colors if file doesn't exist
	if _, err := os.Stat(fs.colorsFile); os.IsNotExist(err) {
		defaultColors := getDefaultColors()
		data, _ := json.MarshalIndent(defaultColors, "", "  ")
		os.WriteFile(fs.colorsFile, data, 0644)
	}

	// One-time migration: remove existing custom themes and reset active custom theme to dark.
	fs.migrateCustomThemesToUserManaged()

}

func (fs *FileStore) migrateCustomThemesToUserManaged() {
	if _, err := os.Stat(fs.customThemesMigrationMarker); err == nil {
		return
	}

	colors := fs.GetColors()
	colors.Custom = map[string]ThemeColors{}
	fs.SaveColors(colors)

	settings := fs.GetSettings()
	if !isValidThemeID(settings.Theme) {
		settings.Theme = "cherry-graphite-dark"
		fs.SaveSettings(settings)
	}

	_ = os.WriteFile(fs.customThemesMigrationMarker, []byte("migrated"), 0644)
}

func (fs *FileStore) ensureDataDir() {
	os.MkdirAll("data", 0755)
}

// getDefaultNewPageCategories returns the default categories for a newly created page
func getDefaultNewPageCategories() []Category {
	return []Category{
		{ID: "others", Name: "dashboard.others"},
	}
}

func (fs *FileStore) GetBookmarksByPage(pageID int) []Bookmark {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	// Read directly from bookmarks-{pageID}.json
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return []Bookmark{}
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return []Bookmark{}
	}

	for i := range pageWithBookmarks.Bookmarks {
		pageWithBookmarks.Bookmarks[i].PageID = pageID
	}

	return pageWithBookmarks.Bookmarks
}

func (fs *FileStore) SaveBookmarksByPage(pageID int, bookmarks []Bookmark) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Read the existing page data
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	for i := range bookmarks {
		bookmarks[i].PageID = pageID
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		// If file doesn't exist, create new page with this ID and default categories
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: getDefaultNewPageCategories(),
			Bookmarks:  bookmarks,
		}
		newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
		os.WriteFile(filePath, newData, 0644)
		return
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return
	}

	// Update only bookmarks, preserve page metadata and categories
	pageWithBookmarks.Bookmarks = bookmarks
	newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
	os.WriteFile(filePath, newData, 0644)
}

func (fs *FileStore) AddBookmarkToPage(pageID int, bookmark Bookmark) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Read the existing page data
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		// If file doesn't exist, create new page with this ID and default categories
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: getDefaultNewPageCategories(),
			Bookmarks:  []Bookmark{bookmark},
		}
		newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
		os.WriteFile(filePath, newData, 0644)
		return
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return
	}

	// Add the new bookmark to existing bookmarks
	bookmark.PageID = pageID
	pageWithBookmarks.Bookmarks = append(pageWithBookmarks.Bookmarks, bookmark)
	newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
	os.WriteFile(filePath, newData, 0644)
}

func (fs *FileStore) DeleteBookmarkFromPage(pageID int, bookmarkToDelete Bookmark) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Read the existing page data
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return err
	}

	// Find and remove the bookmark
	originalLength := len(pageWithBookmarks.Bookmarks)
	pageWithBookmarks.Bookmarks = fs.removeBookmarkFromSlice(pageWithBookmarks.Bookmarks, bookmarkToDelete)

	// If no bookmark was removed, return error
	if len(pageWithBookmarks.Bookmarks) == originalLength {
		return fmt.Errorf("bookmark not found")
	}

	// Save the updated data
	newData, err := json.MarshalIndent(pageWithBookmarks, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, newData, 0644)
}

func (fs *FileStore) removeBookmarkFromSlice(bookmarks []Bookmark, toDelete Bookmark) []Bookmark {
	result := make([]Bookmark, 0)
	removed := false
	for _, b := range bookmarks {
		if !removed && b.Name == toDelete.Name && b.URL == toDelete.URL {
			removed = true
			// Skip this bookmark (remove only the first match)
		} else {
			result = append(result, b)
		}
	}
	return result
}

func (fs *FileStore) GetAllBookmarks() []Bookmark {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	var allBookmarks []Bookmark

	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return allBookmarks
	}

	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}

		filePath := fmt.Sprintf("%s/%s", fs.dataDir, file.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var pageWithBookmarks PageWithBookmarks
		if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
			continue
		}

		pageID := pageWithBookmarks.Page.ID
		for i := range pageWithBookmarks.Bookmarks {
			pageWithBookmarks.Bookmarks[i].PageID = pageID
		}
		allBookmarks = append(allBookmarks, pageWithBookmarks.Bookmarks...)
	}

	return allBookmarks
}

// BookmarkURLExists reports whether url matches any bookmark (single pass; for /api/ping validation).
func (fs *FileStore) BookmarkURLExists(urlParam string) bool {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return false
	}

	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}

		filePath := fmt.Sprintf("%s/%s", fs.dataDir, file.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var pageWithBookmarks PageWithBookmarks
		if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
			continue
		}

		for i := range pageWithBookmarks.Bookmarks {
			if pageWithBookmarks.Bookmarks[i].URL == urlParam {
				return true
			}
		}
	}

	return false
}

func (fs *FileStore) GetFinders() []Finder {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/finders.json", fs.dataDir)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return []Finder{}
	}

	var finders []Finder
	if err := json.Unmarshal(data, &finders); err != nil {
		return []Finder{}
	}

	return finders
}

func (fs *FileStore) SaveFinders(finders []Finder) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/finders.json", fs.dataDir)
	data, err := json.MarshalIndent(finders, "", "  ")
	if err != nil {
		return
	}

	os.WriteFile(filePath, data, 0644)
}

// GetCategoriesByPage returns categories stored inside bookmarks-{pageID}.json if present
func (fs *FileStore) GetCategoriesByPage(pageID int) []Category {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return []Category{}
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return []Category{}
	}

	return pageWithBookmarks.Categories
}

// SaveCategoriesByPage saves categories inside bookmarks-{pageID}.json, creating the file if needed
// It also updates bookmarks to use the new category IDs when category names change
func (fs *FileStore) SaveCategoriesByPage(pageID int, categories []Category) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		// Create new page file with provided categories and empty bookmarks
		// Note: This is called when explicitly saving categories for a page
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: categories,
			Bookmarks:  []Bookmark{},
		}
		newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
		os.WriteFile(filePath, newData, 0644)
		return
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return
	}

	// Create a mapping from old category IDs to new category IDs
	// This allows us to update bookmarks when category names (and thus IDs) change
	oldToNewCategoryMap := make(map[string]string)

	// Build the mapping using originalId if available, otherwise try to match by position or name
	for i, newCat := range categories {
		// If originalId is set, use it to find the old category
		if newCat.OriginalID != "" {
			oldToNewCategoryMap[newCat.OriginalID] = newCat.ID
			// Also map from current ID to new ID in case they're different
			if newCat.OriginalID != newCat.ID {
				oldToNewCategoryMap[newCat.OriginalID] = newCat.ID
			}
		} else if i < len(pageWithBookmarks.Categories) {
			// Fallback: map by position if originalId is not available
			oldCat := pageWithBookmarks.Categories[i]
			oldToNewCategoryMap[oldCat.ID] = newCat.ID
		}
	}

	// Update bookmarks to use new category IDs
	for i := range pageWithBookmarks.Bookmarks {
		oldCategoryID := pageWithBookmarks.Bookmarks[i].Category
		if newCategoryID, exists := oldToNewCategoryMap[oldCategoryID]; exists {
			pageWithBookmarks.Bookmarks[i].Category = newCategoryID
		}
	}

	pageWithBookmarks.Categories = categories
	newData, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
	os.WriteFile(filePath, newData, 0644)
}

func (fs *FileStore) GetPages() []Page {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	return fs.getPages()
}

func (fs *FileStore) getPages() []Page {
	fs.ensureDataDir()

	var pages []Page

	// Read all bookmarks files in data directory
	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return []Page{{ID: 1, Name: "main"}}
	}

	// First, collect all pages from bookmark files
	pageMap := make(map[int]Page)
	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}

		filePath := fmt.Sprintf("%s/%s", fs.dataDir, file.Name())
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		var pageWithBookmarks PageWithBookmarks
		if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
			continue
		}

		pageMap[pageWithBookmarks.Page.ID] = pageWithBookmarks.Page
	}

	if len(pageMap) == 0 {
		return []Page{{ID: 1, Name: "main"}}
	}

	// Get the order from pages.json
	order := fs.getPageOrder()

	// If no order file exists, create default order
	if len(order) == 0 {
		for id := range pageMap {
			order = append(order, id)
		}
		// Save the default order
		fs.savePageOrder(order)
	}

	// Build pages array in the specified order
	for _, id := range order {
		if page, exists := pageMap[id]; exists {
			pages = append(pages, page)
		}
	}

	// Add any pages that exist in files but not in order
	for id, page := range pageMap {
		found := false
		for _, orderId := range order {
			if orderId == id {
				found = true
				break
			}
		}
		if !found {
			pages = append(pages, page)
		}
	}

	return pages
}

func (fs *FileStore) GetPageOrder() []int {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	return fs.getPageOrder()
}

func (fs *FileStore) getPageOrder() []int {
	fs.ensureDataDir()

	data, err := os.ReadFile(fs.pageOrderFile)
	if err != nil {
		return []int{}
	}

	var pageOrder PageOrder
	if err := json.Unmarshal(data, &pageOrder); err != nil {
		return []int{}
	}

	return pageOrder.Order
}

func (fs *FileStore) SavePageOrder(order []int) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.savePageOrder(order)
}

func (fs *FileStore) savePageOrder(order []int) {
	fs.ensureDataDir()

	pageOrder := PageOrder{
		Order: order,
	}

	data, _ := json.MarshalIndent(pageOrder, "", "  ")
	os.WriteFile(fs.pageOrderFile, data, 0644)
}

func (fs *FileStore) SavePage(page Page, bookmarks []Bookmark) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()
	// The page ID IS the file number
	// bookmarks-1.json has page.id = 1
	// When saving, try to preserve existing categories stored in the file
	fileName := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, page.ID)

	var existing PageWithBookmarks
	if data, err := os.ReadFile(fileName); err == nil {
		_ = json.Unmarshal(data, &existing)
	}

	pageWithBookmarks := PageWithBookmarks{
		Page:       page,
		Categories: existing.Categories,
		Bookmarks:  bookmarks,
	}

	if pageWithBookmarks.Categories == nil {
		pageWithBookmarks.Categories = getDefaultNewPageCategories()
	}

	data, _ := json.MarshalIndent(pageWithBookmarks, "", "  ")
	os.WriteFile(fileName, data, 0644)
}

func (fs *FileStore) DeletePage(pageID int) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Delete bookmarks-{pageID}.json
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	return os.Remove(filePath)
}

func (fs *FileStore) GetSettings() Settings {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		// Return default settings if file doesn't exist
		return Settings{
			CurrentPage:               1,
			Theme:                     "cherry-graphite-dark",
			OpenInNewTab:              true,
			ColumnsPerRow:             3,
			FontSize:                  "m",
			ShowBackgroundDots:        true,
			ShowTitle:                 true,
			ShowDate:                  true,
			ShowTime:                  true,
			TimeFormat:                "24h",
			DateFormat:                "short-slash",
			ShowWeatherWithDate:       false,
			WeatherSource:             "manual",
			WeatherLocation:           "",
			WeatherUnit:               "celsius",
			WeatherRefreshMinutes:     30,
			ShowConfigButton:          true,
			ShowHealthDashboard:       true,
			ShowSearchButton:          true,
			ShowFindersButton:         false,
			ShowCommandsButton:        true,
			ShowRecentButton:          true,
			ShowTips:                  false,
			ShowSearchFlowBanner:      true,
			ShowCheatSheetButton:      true,
			ShowSearchButtonText:      true,
			ShowFindersButtonText:     true,
			ShowCommandsButtonText:    true,
			ShowStatus:                false,
			ColorizeStatus:            true,
			ShowPing:                  false,
			ShowStatusLoading:         false,
			SkipFastPing:              false,
			GlobalShortcuts:           true,
			HyprMode:                  false,
			AnimationsEnabled:         true,
			EnableCustomTitle:         false,
			CustomTitle:               "",
			ShowPageInTitle:           false,
			ShowPageNamesInTabs:       false,
			EnableCustomFavicon:       false,
			CustomFaviconPath:         "",
			EnableCustomFont:          false,
			CustomFontPath:            "",
			Language:                  "en",
			InterleaveMode:            false,
			ShowPageTabs:              true,
			AlwaysCollapseCategories:  false,
			EnableFuzzySuggestions:    false,
			FuzzySuggestionsStartWith: false,
			KeepSearchOpenWhenEmpty:   false,
			ShowIcons:                 false,
			ShowLinkPreviewCards:      true,
			LinkPreviewHoverDelayMs:   150,
			ShowShortcuts:             true,
			ShowPinIcon:               false,
			ShowNoteIcon:              true,
			IncludeFindersInSearch:    false,
			BackgroundOpacity:         1,
			FontWeight:                "normal",
			FontPreset:                "source-code-pro",
			AutoDarkMode:              false,
			ShowSmartRecentCollection: false,
			ShowSmartTodayCollection:  true,
			ShowSmartStaleCollection:  false,
			SmartTodayLimit:           8,
			SmartRecentLimit:          50,
			SmartStaleLimit:           50,
			SmartTodayWorkKeywords:    "calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams",
			SmartTodayEveningKeywords: "youtube,spotify,netflix,reddit",
			SmartTodayWeekendKeywords: "news,weather,maps",
			SmartTodayPageIds:         []int{},
			SmartRecentPageIds:        []int{},
			SmartStalePageIds:         []int{},
			ArchivedPageIds:           []int{},
			FaviconRefreshPolicy:      "on-save",
			DensityMode:               "compact",
			PackedColumns:             true,
			BackgroundType:            "none",
			BackgroundGradient:        "",
			BackgroundImageUrl:        "",
			ThemeIconStyling:          map[string]ThemeIconStylingEntry{},
		}
	}

	var settings Settings
	json.Unmarshal(data, &settings)

	var rawSettings map[string]json.RawMessage
	if err := json.Unmarshal(data, &rawSettings); err == nil {
		if _, ok := rawSettings["showCheatSheetButton"]; !ok {
			settings.ShowCheatSheetButton = true
		}
		if _, ok := rawSettings["colorizeStatus"]; !ok {
			settings.ColorizeStatus = true
		}
		if _, ok := rawSettings["showShortcuts"]; !ok {
			settings.ShowShortcuts = true
		}
		if _, ok := rawSettings["showLinkPreviewCards"]; !ok {
			settings.ShowLinkPreviewCards = true
		}
		if _, ok := rawSettings["linkPreviewHoverDelayMs"]; !ok {
			settings.LinkPreviewHoverDelayMs = 150
		}
		if settings.LinkPreviewHoverDelayMs != 100 && settings.LinkPreviewHoverDelayMs != 150 && settings.LinkPreviewHoverDelayMs != 250 {
			settings.LinkPreviewHoverDelayMs = 150
		}
		if _, ok := rawSettings["showPinIcon"]; !ok {
			settings.ShowPinIcon = false
		}
		if _, ok := rawSettings["showNoteIcon"]; !ok {
			settings.ShowNoteIcon = true
		}
		if _, ok := rawSettings["showRecentButton"]; !ok {
			settings.ShowRecentButton = true
		}
		if _, ok := rawSettings["showHealthDashboard"]; !ok {
			settings.ShowHealthDashboard = true
		}
		if _, ok := rawSettings["showTips"]; !ok {
			settings.ShowTips = false
		}
		if _, ok := rawSettings["showSearchFlowBanner"]; !ok {
			settings.ShowSearchFlowBanner = true
		}
		if _, ok := rawSettings["showSmartRecentCollection"]; !ok {
			settings.ShowSmartRecentCollection = false
		}
		if _, ok := rawSettings["showSmartTodayCollection"]; !ok {
			settings.ShowSmartTodayCollection = true
		}
		if _, ok := rawSettings["showSmartStaleCollection"]; !ok {
			settings.ShowSmartStaleCollection = false
		}
		if _, ok := rawSettings["smartTodayLimit"]; !ok || settings.SmartTodayLimit < 0 {
			settings.SmartTodayLimit = 8
		}
		if _, ok := rawSettings["smartRecentLimit"]; !ok || settings.SmartRecentLimit < 0 {
			settings.SmartRecentLimit = 50
		}
		if _, ok := rawSettings["smartStaleLimit"]; !ok || settings.SmartStaleLimit < 0 {
			settings.SmartStaleLimit = 50
		}
		if _, ok := rawSettings["smartRecentPageIds"]; !ok || settings.SmartRecentPageIds == nil {
			settings.SmartRecentPageIds = []int{}
		}
		if _, ok := rawSettings["smartTodayPageIds"]; !ok || settings.SmartTodayPageIds == nil {
			settings.SmartTodayPageIds = []int{}
		}
		if _, ok := rawSettings["smartTodayWorkKeywords"]; !ok || strings.TrimSpace(settings.SmartTodayWorkKeywords) == "" {
			settings.SmartTodayWorkKeywords = "calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams"
		}
		if _, ok := rawSettings["smartTodayEveningKeywords"]; !ok || strings.TrimSpace(settings.SmartTodayEveningKeywords) == "" {
			settings.SmartTodayEveningKeywords = "youtube,spotify,netflix,reddit"
		}
		if _, ok := rawSettings["smartTodayWeekendKeywords"]; !ok || strings.TrimSpace(settings.SmartTodayWeekendKeywords) == "" {
			settings.SmartTodayWeekendKeywords = "news,weather,maps"
		}
		if _, ok := rawSettings["smartStalePageIds"]; !ok || settings.SmartStalePageIds == nil {
			settings.SmartStalePageIds = []int{}
		}
		if _, ok := rawSettings["archivedPageIds"]; !ok || settings.ArchivedPageIds == nil {
			settings.ArchivedPageIds = []int{}
		}
		if _, ok := rawSettings["faviconRefreshPolicy"]; !ok || (settings.FaviconRefreshPolicy != "manual" && settings.FaviconRefreshPolicy != "on-save") {
			settings.FaviconRefreshPolicy = "on-save"
		}
		if _, ok := rawSettings["onboardingCompleted"]; !ok {
			settings.OnboardingCompleted = true
		}
		if _, ok := rawSettings["packedColumns"]; !ok {
			settings.PackedColumns = true
		}
		if _, ok := rawSettings["densityMode"]; !ok || (settings.DensityMode != "comfortable" && settings.DensityMode != "compact" && settings.DensityMode != "dense" && settings.DensityMode != "auto") {
			settings.DensityMode = "compact"
		}
		if _, ok := rawSettings["dateFormat"]; !ok || settings.DateFormat == "" {
			settings.DateFormat = "short-slash"
		}
		if _, ok := rawSettings["showTime"]; !ok {
			settings.ShowTime = true
		}
		if _, ok := rawSettings["timeFormat"]; !ok || (settings.TimeFormat != "24h" && settings.TimeFormat != "12h") {
			settings.TimeFormat = "24h"
		}
		if _, ok := rawSettings["showWeatherWithDate"]; !ok {
			settings.ShowWeatherWithDate = false
		}
		if _, ok := rawSettings["weatherSource"]; !ok || settings.WeatherSource == "" {
			settings.WeatherSource = "manual"
		}
		if _, ok := rawSettings["weatherLocation"]; !ok {
			settings.WeatherLocation = ""
		}
		if _, ok := rawSettings["weatherUnit"]; !ok || settings.WeatherUnit == "" {
			settings.WeatherUnit = "celsius"
		}
		if _, ok := rawSettings["weatherRefreshMinutes"]; !ok || settings.WeatherRefreshMinutes <= 0 {
			settings.WeatherRefreshMinutes = 30
		}
		if _, ok := rawSettings["fontPreset"]; !ok || !isValidFontPreset(settings.FontPreset) {
			settings.FontPreset = "source-code-pro"
		}
		if _, ok := rawSettings["backgroundType"]; !ok {
			settings.BackgroundType = "none"
		}
		if _, ok := rawSettings["backgroundGradient"]; !ok {
			settings.BackgroundGradient = ""
		}
		if _, ok := rawSettings["backgroundImageUrl"]; !ok {
			settings.BackgroundImageUrl = ""
		}
	}

	// Set default language if empty
	if settings.Language == "" {
		settings.Language = "en"
	}
	if !isValidThemeID(settings.Theme) {
		settings.Theme = "cherry-graphite-dark"
	}
	settings.FontPreset = normalizeFontPreset(settings.FontPreset)

	return settings
}

func (fs *FileStore) SaveSettings(settings Settings) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	settings.FontPreset = normalizeFontPreset(settings.FontPreset)

	data, _ := json.MarshalIndent(settings, "", "  ")
	os.WriteFile(fs.settingsFile, data, 0644)
}

func getDefaultLightTheme() ThemeColors {
	return ThemeColors{
		TextPrimary:         "#1F2937",
		TextSecondary:       "#6B7280",
		TextTertiary:        "#9CA3AF",
		BackgroundPrimary:   "#F9FAFB",
		BackgroundSecondary: "#F3F4F6",
		BackgroundDots:      "#E5E7EB",
		BackgroundModal:     "rgba(255, 255, 255, 0.9)",
		BorderPrimary:       "#D1D5DB",
		BorderSecondary:     "#E5E7EB",
		AccentSuccess:       "#059669",
		AccentWarning:       "#D97706",
		AccentError:         "#DC2626",
	}
}

func getDefaultDarkTheme() ThemeColors {
	return ThemeColors{
		TextPrimary:         "#E5E7EB",
		TextSecondary:       "#9CA3AF",
		TextTertiary:        "#6B7280",
		BackgroundPrimary:   "#000",
		BackgroundSecondary: "#1F2937",
		BackgroundDots:      "#1F2937",
		BackgroundModal:     "rgba(0, 0, 0, 0.8)",
		BorderPrimary:       "#4B5563",
		BorderSecondary:     "#374151",
		AccentSuccess:       "#10B981",
		AccentWarning:       "#F59E0B",
		AccentError:         "#EF4444",
	}
}

func getDefaultBuiltInThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		"cherry-graphite-dark":  {Name: "Cherry Graphite [dark]", TextPrimary: "#F3F4F6", TextSecondary: "#D1D5DB", TextTertiary: "#9CA3AF", BackgroundPrimary: "#111318", BackgroundSecondary: "#1B1F2A", BackgroundDots: "#2A1E2C", BackgroundModal: "rgba(17, 19, 24, 0.85)", BorderPrimary: "#3A2E3F", BorderSecondary: "#2C2532", AccentSuccess: "#34D399", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"cherry-graphite-light": {Name: "Cherry Graphite [light]", TextPrimary: "#1F2937", TextSecondary: "#4B5563", TextTertiary: "#6B7280", BackgroundPrimary: "#FBFBFC", BackgroundSecondary: "#F3F4F6", BackgroundDots: "#F5E8EE", BackgroundModal: "rgba(255, 255, 255, 0.92)", BorderPrimary: "#E5E7EB", BorderSecondary: "#D1D5DB", AccentSuccess: "#059669", AccentWarning: "#D97706", AccentError: "#BE123C"},
		"desert-sand-dark":      {Name: "Desert Sand [dark]", TextPrimary: "#FDE68A", TextSecondary: "#FCD34D", TextTertiary: "#D6A96C", BackgroundPrimary: "#1A120B", BackgroundSecondary: "#2B1F14", BackgroundDots: "#3A2A1C", BackgroundModal: "rgba(26, 18, 11, 0.84)", BorderPrimary: "#5A3E26", BorderSecondary: "#3E2B1C", AccentSuccess: "#86EFAC", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"desert-sand-light":     {Name: "Desert Sand [light]", TextPrimary: "#3F2D1D", TextSecondary: "#6B4C2A", TextTertiary: "#8B6A42", BackgroundPrimary: "#FFF8ED", BackgroundSecondary: "#FDEFD8", BackgroundDots: "#F3E2C2", BackgroundModal: "rgba(255, 248, 237, 0.9)", BorderPrimary: "#E8CFAD", BorderSecondary: "#E2BE8E", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"forest-moss-dark":      {Name: "Forest Moss [dark]", TextPrimary: "#DCFCE7", TextSecondary: "#86EFAC", TextTertiary: "#4ADE80", BackgroundPrimary: "#0E1712", BackgroundSecondary: "#142119", BackgroundDots: "#1B2F22", BackgroundModal: "rgba(14, 23, 18, 0.84)", BorderPrimary: "#2E4A37", BorderSecondary: "#22372A", AccentSuccess: "#22C55E", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"forest-moss-light":     {Name: "Forest Moss [light]", TextPrimary: "#1B4332", TextSecondary: "#2D6A4F", TextTertiary: "#40916C", BackgroundPrimary: "#F4FFF8", BackgroundSecondary: "#E8F5EC", BackgroundDots: "#D8EEDC", BackgroundModal: "rgba(244, 255, 248, 0.9)", BorderPrimary: "#B7D7C2", BorderSecondary: "#9CCCB0", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"lavender-mist-dark":    {Name: "Lavender Mist [dark]", TextPrimary: "#F5F3FF", TextSecondary: "#DDD6FE", TextTertiary: "#C4B5FD", BackgroundPrimary: "#151224", BackgroundSecondary: "#1F1A34", BackgroundDots: "#2A2350", BackgroundModal: "rgba(21, 18, 36, 0.86)", BorderPrimary: "#4C3F73", BorderSecondary: "#362B55", AccentSuccess: "#34D399", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"lavender-mist-light":   {Name: "Lavender Mist [light]", TextPrimary: "#312E81", TextSecondary: "#4338CA", TextTertiary: "#6366F1", BackgroundPrimary: "#FAF9FF", BackgroundSecondary: "#F1EEFF", BackgroundDots: "#E8E2FF", BackgroundModal: "rgba(250, 249, 255, 0.9)", BorderPrimary: "#D7CCFF", BorderSecondary: "#C4B5FD", AccentSuccess: "#059669", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"midnight-neon-dark":    {Name: "Midnight Neon [dark]", TextPrimary: "#E0F2FE", TextSecondary: "#93C5FD", TextTertiary: "#60A5FA", BackgroundPrimary: "#04050A", BackgroundSecondary: "#0B1020", BackgroundDots: "#111A34", BackgroundModal: "rgba(4, 5, 10, 0.86)", BorderPrimary: "#1E3A8A", BorderSecondary: "#172554", AccentSuccess: "#22D3EE", AccentWarning: "#F59E0B", AccentError: "#F43F5E"},
		"midnight-neon-light":   {Name: "Midnight Neon [light]", TextPrimary: "#0F172A", TextSecondary: "#1E3A8A", TextTertiary: "#334155", BackgroundPrimary: "#F7FAFF", BackgroundSecondary: "#ECF3FF", BackgroundDots: "#DCE8FF", BackgroundModal: "rgba(247, 250, 255, 0.9)", BorderPrimary: "#BFDBFE", BorderSecondary: "#93C5FD", AccentSuccess: "#0891B2", AccentWarning: "#D97706", AccentError: "#BE123C"},
		"neon-grid-dark":        {Name: "Neon Grid [dark]", TextPrimary: "#E0E0E0", TextSecondary: "#00FFFF", TextTertiary: "#FF00FF", BackgroundPrimary: "#121212", BackgroundSecondary: "#1A1A1A", BackgroundDots: "#00FFFF40", BackgroundModal: "rgba(0, 0, 0, 0.9)", BorderPrimary: "#00FFFF", BorderSecondary: "#FF00FF", AccentSuccess: "#00FF00", AccentWarning: "#FFC000", AccentError: "#FF3333"},
		"neon-grid-light":       {Name: "Neon Grid [light]", TextPrimary: "#171717", TextSecondary: "#0891B2", TextTertiary: "#C026D3", BackgroundPrimary: "#FAFAFA", BackgroundSecondary: "#F0F0F0", BackgroundDots: "#00FFFF26", BackgroundModal: "rgba(255, 255, 255, 0.92)", BorderPrimary: "#06B6D4", BorderSecondary: "#D946EF", AccentSuccess: "#059669", AccentWarning: "#D97706", AccentError: "#DC2626"},
		"glacier-mint-dark":     {Name: "Glacier Mint [dark]", TextPrimary: "#F0FDFA", TextSecondary: "#5EEAD4", TextTertiary: "#67E8F9", BackgroundPrimary: "#060A10", BackgroundSecondary: "#0C1520", BackgroundDots: "#0F2847", BackgroundModal: "rgba(6, 10, 16, 0.9)", BorderPrimary: "#2DD4BF", BorderSecondary: "#14B8A6", AccentSuccess: "#34D399", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"glacier-mint-light":    {Name: "Glacier Mint [light]", TextPrimary: "#134E4A", TextSecondary: "#0F766E", TextTertiary: "#0D9488", BackgroundPrimary: "#F6FFFE", BackgroundSecondary: "#ECFEFF", BackgroundDots: "#CCFBF1", BackgroundModal: "rgba(246, 255, 254, 0.92)", BorderPrimary: "#99F6E4", BorderSecondary: "#5EEAD4", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"kelp-drift-dark":       {Name: "Kelp Drift [dark]", TextPrimary: "#D1FAE5", TextSecondary: "#86EFAC", TextTertiary: "#5C8570", BackgroundPrimary: "#0C120F", BackgroundSecondary: "#141F19", BackgroundDots: "#1A2E24", BackgroundModal: "rgba(12, 18, 15, 0.88)", BorderPrimary: "#2E503D", BorderSecondary: "#1F3D2E", AccentSuccess: "#22C55E", AccentWarning: "#EAB308", AccentError: "#F87171"},
		"kelp-drift-light":      {Name: "Kelp Drift [light]", TextPrimary: "#14532D", TextSecondary: "#166534", TextTertiary: "#3D5A45", BackgroundPrimary: "#F5FBF7", BackgroundSecondary: "#E8F5EC", BackgroundDots: "#DCFCE7", BackgroundModal: "rgba(245, 251, 247, 0.92)", BorderPrimary: "#BBF7D0", BorderSecondary: "#86EFAC", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#B91C1C"},
		"mulberry-silk-dark":    {Name: "Mulberry Silk [dark]", TextPrimary: "#F5F3FF", TextSecondary: "#E9D5FF", TextTertiary: "#9D7CCF", BackgroundPrimary: "#140816", BackgroundSecondary: "#1E0F24", BackgroundDots: "#2A1A38", BackgroundModal: "rgba(20, 8, 22, 0.88)", BorderPrimary: "#6B21A8", BorderSecondary: "#4C1D95", AccentSuccess: "#34D399", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"mulberry-silk-light":   {Name: "Mulberry Silk [light]", TextPrimary: "#4C1D95", TextSecondary: "#6B21A8", TextTertiary: "#7C3AED", BackgroundPrimary: "#FDF8FF", BackgroundSecondary: "#FAF5FF", BackgroundDots: "#F3E8FF", BackgroundModal: "rgba(253, 248, 255, 0.92)", BorderPrimary: "#E9D5FF", BorderSecondary: "#DDD6FE", AccentSuccess: "#059669", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"rusted-rail-dark":      {Name: "Rusted Rail [dark]", TextPrimary: "#FEF3C7", TextSecondary: "#FDBA74", TextTertiary: "#B45309", BackgroundPrimary: "#120C0A", BackgroundSecondary: "#1C1410", BackgroundDots: "#3D2418", BackgroundModal: "rgba(18, 12, 10, 0.88)", BorderPrimary: "#9A3412", BorderSecondary: "#7C2D12", AccentSuccess: "#4ADE80", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"rusted-rail-light":     {Name: "Rusted Rail [light]", TextPrimary: "#431407", TextSecondary: "#7C2D12", TextTertiary: "#9A3412", BackgroundPrimary: "#FFFAF5", BackgroundSecondary: "#FFF1E6", BackgroundDots: "#FFEDD5", BackgroundModal: "rgba(255, 250, 245, 0.92)", BorderPrimary: "#FDBA74", BorderSecondary: "#FB923C", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"steel-dawn-dark":       {Name: "Steel Dawn [dark]", TextPrimary: "#E2E8F0", TextSecondary: "#94A3B8", TextTertiary: "#64748B", BackgroundPrimary: "#0B0F14", BackgroundSecondary: "#121922", BackgroundDots: "#1A2332", BackgroundModal: "rgba(11, 15, 20, 0.88)", BorderPrimary: "#3D4F5F", BorderSecondary: "#2A3542", AccentSuccess: "#2DD4BF", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"steel-dawn-light":      {Name: "Steel Dawn [light]", TextPrimary: "#1E293B", TextSecondary: "#475569", TextTertiary: "#64748B", BackgroundPrimary: "#F4F6F8", BackgroundSecondary: "#EEF2F6", BackgroundDots: "#DDE4ED", BackgroundModal: "rgba(244, 246, 248, 0.92)", BorderPrimary: "#CBD5E1", BorderSecondary: "#94A3B8", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"nordic-frost-dark":     {Name: "Nordic Frost [dark]", TextPrimary: "#E2E8F0", TextSecondary: "#CBD5E1", TextTertiary: "#94A3B8", BackgroundPrimary: "#0A1118", BackgroundSecondary: "#111C28", BackgroundDots: "#1B2C3D", BackgroundModal: "rgba(10, 17, 24, 0.86)", BorderPrimary: "#334155", BorderSecondary: "#1E293B", AccentSuccess: "#22C55E", AccentWarning: "#F59E0B", AccentError: "#EF4444"},
		"nordic-frost-light":    {Name: "Nordic Frost [light]", TextPrimary: "#0F172A", TextSecondary: "#334155", TextTertiary: "#64748B", BackgroundPrimary: "#F8FBFF", BackgroundSecondary: "#EDF2F7", BackgroundDots: "#E1E8F0", BackgroundModal: "rgba(248, 251, 255, 0.9)", BorderPrimary: "#CBD5E1", BorderSecondary: "#94A3B8", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"ocean-depth-dark":      {Name: "Ocean Depth [dark]", TextPrimary: "#E0F2FE", TextSecondary: "#7DD3FC", TextTertiary: "#38BDF8", BackgroundPrimary: "#05131D", BackgroundSecondary: "#0A2433", BackgroundDots: "#12384D", BackgroundModal: "rgba(5, 19, 29, 0.86)", BorderPrimary: "#1D4ED8", BorderSecondary: "#1E3A8A", AccentSuccess: "#14B8A6", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"ocean-depth-light":     {Name: "Ocean Depth [light]", TextPrimary: "#0C4A6E", TextSecondary: "#0369A1", TextTertiary: "#0284C7", BackgroundPrimary: "#F3FBFF", BackgroundSecondary: "#E0F2FE", BackgroundDots: "#CFEFFF", BackgroundModal: "rgba(243, 251, 255, 0.9)", BorderPrimary: "#BAE6FD", BorderSecondary: "#7DD3FC", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"paper-ink-dark":        {Name: "Paper Ink [dark]", TextPrimary: "#FAFAF9", TextSecondary: "#E7E5E4", TextTertiary: "#A8A29E", BackgroundPrimary: "#171717", BackgroundSecondary: "#262626", BackgroundDots: "#3F3F46", BackgroundModal: "rgba(23, 23, 23, 0.86)", BorderPrimary: "#525252", BorderSecondary: "#3F3F46", AccentSuccess: "#22C55E", AccentWarning: "#F59E0B", AccentError: "#EF4444"},
		"paper-ink-light":       {Name: "Paper Ink [light]", TextPrimary: "#1C1917", TextSecondary: "#44403C", TextTertiary: "#78716C", BackgroundPrimary: "#FFFEFA", BackgroundSecondary: "#F5F5F4", BackgroundDots: "#E7E5E4", BackgroundModal: "rgba(255, 254, 250, 0.92)", BorderPrimary: "#D6D3D1", BorderSecondary: "#A8A29E", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"retro-crt-dark":        {Name: "Retro CRT [dark]", TextPrimary: "#C7FFCC", TextSecondary: "#86EFAC", TextTertiary: "#4ADE80", BackgroundPrimary: "#030705", BackgroundSecondary: "#07140E", BackgroundDots: "#0B2118", BackgroundModal: "rgba(3, 7, 5, 0.88)", BorderPrimary: "#14532D", BorderSecondary: "#166534", AccentSuccess: "#22C55E", AccentWarning: "#EAB308", AccentError: "#F43F5E"},
		"retro-crt-light":       {Name: "Retro CRT [light]", TextPrimary: "#14532D", TextSecondary: "#166534", TextTertiary: "#15803D", BackgroundPrimary: "#F4FFF6", BackgroundSecondary: "#E8FEEB", BackgroundDots: "#D7F6DC", BackgroundModal: "rgba(244, 255, 246, 0.92)", BorderPrimary: "#A7F3D0", BorderSecondary: "#6EE7B7", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#BE123C"},
		"arctic-cyan-dark":      {Name: "Arctic Cyan [dark]", TextPrimary: "#E0F7FF", TextSecondary: "#7DD3FC", TextTertiary: "#22D3EE", BackgroundPrimary: "#06141B", BackgroundSecondary: "#0C2430", BackgroundDots: "#133847", BackgroundModal: "rgba(6, 20, 27, 0.88)", BorderPrimary: "#0E7490", BorderSecondary: "#155E75", AccentSuccess: "#22C55E", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"arctic-cyan-light":     {Name: "Arctic Cyan [light]", TextPrimary: "#0C4A6E", TextSecondary: "#0E7490", TextTertiary: "#0891B2", BackgroundPrimary: "#F2FCFF", BackgroundSecondary: "#E0F7FF", BackgroundDots: "#C8F0FF", BackgroundModal: "rgba(242, 252, 255, 0.92)", BorderPrimary: "#7DD3FC", BorderSecondary: "#22D3EE", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"copper-circuit-dark":   {Name: "Copper Circuit [dark]", TextPrimary: "#FEE2D5", TextSecondary: "#FDBA74", TextTertiary: "#FB923C", BackgroundPrimary: "#1A110E", BackgroundSecondary: "#281A14", BackgroundDots: "#3A241A", BackgroundModal: "rgba(26, 17, 14, 0.88)", BorderPrimary: "#C2410C", BorderSecondary: "#9A3412", AccentSuccess: "#22D3EE", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"copper-circuit-light":  {Name: "Copper Circuit [light]", TextPrimary: "#7C2D12", TextSecondary: "#9A3412", TextTertiary: "#C2410C", BackgroundPrimary: "#FFF8F2", BackgroundSecondary: "#FEEAD8", BackgroundDots: "#FCD9BD", BackgroundModal: "rgba(255, 248, 242, 0.92)", BorderPrimary: "#FDBA74", BorderSecondary: "#FB923C", AccentSuccess: "#0E7490", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"coral-reef-dark":       {Name: "Coral Reef [dark]", TextPrimary: "#FFE4E6", TextSecondary: "#FDA4AF", TextTertiary: "#FB7185", BackgroundPrimary: "#151C24", BackgroundSecondary: "#1E2B35", BackgroundDots: "#28404D", BackgroundModal: "rgba(21, 28, 36, 0.88)", BorderPrimary: "#0F766E", BorderSecondary: "#115E59", AccentSuccess: "#14B8A6", AccentWarning: "#F59E0B", AccentError: "#F43F5E"},
		"coral-reef-light":      {Name: "Coral Reef [light]", TextPrimary: "#134E4A", TextSecondary: "#0F766E", TextTertiary: "#0D9488", BackgroundPrimary: "#F4FFFF", BackgroundSecondary: "#E6FFFB", BackgroundDots: "#CCFBF1", BackgroundModal: "rgba(244, 255, 255, 0.92)", BorderPrimary: "#99F6E4", BorderSecondary: "#5EEAD4", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"emerald-matrix-dark":   {Name: "Emerald Matrix [dark]", TextPrimary: "#D1FAE5", TextSecondary: "#6EE7B7", TextTertiary: "#34D399", BackgroundPrimary: "#06130D", BackgroundSecondary: "#0D1F16", BackgroundDots: "#143026", BackgroundModal: "rgba(6, 19, 13, 0.88)", BorderPrimary: "#047857", BorderSecondary: "#065F46", AccentSuccess: "#22C55E", AccentWarning: "#EAB308", AccentError: "#F87171"},
		"emerald-matrix-light":  {Name: "Emerald Matrix [light]", TextPrimary: "#064E3B", TextSecondary: "#065F46", TextTertiary: "#047857", BackgroundPrimary: "#F3FFF8", BackgroundSecondary: "#E8FCEF", BackgroundDots: "#CFF7DE", BackgroundModal: "rgba(243, 255, 248, 0.92)", BorderPrimary: "#86EFAC", BorderSecondary: "#4ADE80", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#BE123C"},
		"monochrome-mist-dark":  {Name: "Monochrome Mist [dark]", TextPrimary: "#F5F5F5", TextSecondary: "#D4D4D4", TextTertiary: "#A3A3A3", BackgroundPrimary: "#111111", BackgroundSecondary: "#1F1F1F", BackgroundDots: "#2E2E2E", BackgroundModal: "rgba(17, 17, 17, 0.88)", BorderPrimary: "#525252", BorderSecondary: "#3F3F46", AccentSuccess: "#22C55E", AccentWarning: "#F59E0B", AccentError: "#EF4444"},
		"monochrome-mist-light": {Name: "Monochrome Mist [light]", TextPrimary: "#171717", TextSecondary: "#3F3F46", TextTertiary: "#525252", BackgroundPrimary: "#FCFCFC", BackgroundSecondary: "#F5F5F5", BackgroundDots: "#E5E5E5", BackgroundModal: "rgba(252, 252, 252, 0.92)", BorderPrimary: "#D4D4D4", BorderSecondary: "#A3A3A3", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"obsidian-gold-dark":    {Name: "Obsidian Gold [dark]", TextPrimary: "#FEF3C7", TextSecondary: "#FCD34D", TextTertiary: "#FBBF24", BackgroundPrimary: "#0B0B0D", BackgroundSecondary: "#15161B", BackgroundDots: "#252733", BackgroundModal: "rgba(11, 11, 13, 0.9)", BorderPrimary: "#A16207", BorderSecondary: "#854D0E", AccentSuccess: "#34D399", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"obsidian-gold-light":   {Name: "Obsidian Gold [light]", TextPrimary: "#3F2A00", TextSecondary: "#713F12", TextTertiary: "#92400E", BackgroundPrimary: "#FFFCF5", BackgroundSecondary: "#FEF7E7", BackgroundDots: "#FDE7B8", BackgroundModal: "rgba(255, 252, 245, 0.92)", BorderPrimary: "#FCD34D", BorderSecondary: "#FBBF24", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"royal-amethyst-dark":   {Name: "Royal Amethyst [dark]", TextPrimary: "#F5F3FF", TextSecondary: "#E9D5FF", TextTertiary: "#C4B5FD", BackgroundPrimary: "#170E2B", BackgroundSecondary: "#23153F", BackgroundDots: "#321E59", BackgroundModal: "rgba(23, 14, 43, 0.88)", BorderPrimary: "#6D28D9", BorderSecondary: "#4C1D95", AccentSuccess: "#34D399", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"royal-amethyst-light":  {Name: "Royal Amethyst [light]", TextPrimary: "#312E81", TextSecondary: "#5B21B6", TextTertiary: "#6D28D9", BackgroundPrimary: "#FCFAFF", BackgroundSecondary: "#F5F0FF", BackgroundDots: "#EBDDFF", BackgroundModal: "rgba(252, 250, 255, 0.92)", BorderPrimary: "#D8B4FE", BorderSecondary: "#C4B5FD", AccentSuccess: "#059669", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"sakura-night-dark":     {Name: "Sakura Night [dark]", TextPrimary: "#FCE7F3", TextSecondary: "#F9A8D4", TextTertiary: "#F472B6", BackgroundPrimary: "#1A1020", BackgroundSecondary: "#2A1730", BackgroundDots: "#3A2143", BackgroundModal: "rgba(26, 16, 32, 0.88)", BorderPrimary: "#9D174D", BorderSecondary: "#831843", AccentSuccess: "#34D399", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"sakura-night-light":    {Name: "Sakura Night [light]", TextPrimary: "#831843", TextSecondary: "#9D174D", TextTertiary: "#BE185D", BackgroundPrimary: "#FFF7FB", BackgroundSecondary: "#FCE7F3", BackgroundDots: "#FBCFE8", BackgroundModal: "rgba(255, 247, 251, 0.92)", BorderPrimary: "#F9A8D4", BorderSecondary: "#F472B6", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#BE123C"},
		"solar-ember-dark":      {Name: "Solar Ember [dark]", TextPrimary: "#FFF7ED", TextSecondary: "#FDBA74", TextTertiary: "#FB923C", BackgroundPrimary: "#1A0F08", BackgroundSecondary: "#2D1A12", BackgroundDots: "#442617", BackgroundModal: "rgba(26, 15, 8, 0.86)", BorderPrimary: "#7C2D12", BorderSecondary: "#9A3412", AccentSuccess: "#4ADE80", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"solar-ember-light":     {Name: "Solar Ember [light]", TextPrimary: "#7C2D12", TextSecondary: "#9A3412", TextTertiary: "#C2410C", BackgroundPrimary: "#FFF8F1", BackgroundSecondary: "#FFEDD5", BackgroundDots: "#FED7AA", BackgroundModal: "rgba(255, 248, 241, 0.92)", BorderPrimary: "#FDBA74", BorderSecondary: "#FB923C", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"sunflower-ink-dark":    {Name: "Sunflower Ink [dark]", TextPrimary: "#FEF3C7", TextSecondary: "#FCD34D", TextTertiary: "#FBBF24", BackgroundPrimary: "#1A1710", BackgroundSecondary: "#262114", BackgroundDots: "#3B3118", BackgroundModal: "rgba(26, 23, 16, 0.88)", BorderPrimary: "#92400E", BorderSecondary: "#78350F", AccentSuccess: "#34D399", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"sunflower-ink-light":   {Name: "Sunflower Ink [light]", TextPrimary: "#713F12", TextSecondary: "#854D0E", TextTertiary: "#A16207", BackgroundPrimary: "#FFFBEB", BackgroundSecondary: "#FEF3C7", BackgroundDots: "#FDE68A", BackgroundModal: "rgba(255, 251, 235, 0.92)", BorderPrimary: "#FCD34D", BorderSecondary: "#FBBF24", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B91C1C"},
		"volcanic-ash-dark":     {Name: "Volcanic Ash [dark]", TextPrimary: "#FFE4E6", TextSecondary: "#FDA4AF", TextTertiary: "#FB7185", BackgroundPrimary: "#1B1415", BackgroundSecondary: "#2A1C1E", BackgroundDots: "#3F272A", BackgroundModal: "rgba(27, 20, 21, 0.88)", BorderPrimary: "#B91C1C", BorderSecondary: "#7F1D1D", AccentSuccess: "#4ADE80", AccentWarning: "#F59E0B", AccentError: "#F43F5E"},
		"volcanic-ash-light":    {Name: "Volcanic Ash [light]", TextPrimary: "#7F1D1D", TextSecondary: "#991B1B", TextTertiary: "#B91C1C", BackgroundPrimary: "#FFF7F7", BackgroundSecondary: "#FFE4E6", BackgroundDots: "#FECDD3", BackgroundModal: "rgba(255, 247, 247, 0.92)", BorderPrimary: "#FDA4AF", BorderSecondary: "#FB7185", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#BE123C"},
	}
}

func isValidThemeID(themeID string) bool {
	if themeID == "dark" || themeID == "light" {
		return true
	}
	_, exists := getDefaultBuiltInThemes()[themeID]
	return exists
}

func getDefaultColors() ColorTheme {
	return ColorTheme{
		Light:   getDefaultLightTheme(),
		Dark:    getDefaultDarkTheme(),
		BuiltIn: getDefaultBuiltInThemes(),
		Custom:  map[string]ThemeColors{},
	}
}

func (fs *FileStore) GetColors() ColorTheme {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.colorsFile)
	if err != nil {
		// Return default colors if file doesn't exist
		return getDefaultColors()
	}

	var colors ColorTheme
	if err := json.Unmarshal(data, &colors); err != nil {
		return getDefaultColors()
	}

	// Ensure custom themes map is initialized
	if colors.Custom == nil {
		colors.Custom = make(map[string]ThemeColors)
	}
	// Ensure built-in themes are initialized and complete
	if colors.BuiltIn == nil {
		colors.BuiltIn = make(map[string]ThemeColors)
	}
	for themeID, themeColors := range getDefaultBuiltInThemes() {
		if _, ok := colors.BuiltIn[themeID]; !ok {
			colors.BuiltIn[themeID] = themeColors
		}
	}

	return colors
}

func (fs *FileStore) SaveColors(colors ColorTheme) {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	if colors.BuiltIn == nil {
		colors.BuiltIn = make(map[string]ThemeColors)
	}
	for themeID, themeColors := range getDefaultBuiltInThemes() {
		colors.BuiltIn[themeID] = themeColors
	}
	if colors.Custom == nil {
		colors.Custom = map[string]ThemeColors{}
	}

	data, _ := json.MarshalIndent(colors, "", "  ")
	os.WriteFile(fs.colorsFile, data, 0644)
}

// Analytics and metadata types
type BookmarkAnalytics struct {
	MostOpened     []BookmarkWithCount `json:"mostOpened"`
	LeastUsed      []BookmarkWithCount `json:"leastUsed"`
	StaleBookmarks []BookmarkWithCount `json:"staleBookmarks"`
	TotalBookmarks int                 `json:"totalBookmarks"`
	UnusedCount    int                 `json:"unusedCount"`
	StaleCount     int                 `json:"staleCount"`
}

type HealthSummary struct {
	TotalBookmarks      int `json:"totalBookmarks"`
	HealthyCount        int `json:"healthyCount"`
	BrokenCount         int `json:"brokenCount"`
	DuplicateCount      int `json:"duplicateCount"`
	UncheckedCount      int `json:"uncheckedCount"`
	StaleCount          int `json:"staleCount"`
	MissingPreviewCount int `json:"missingPreviewCount"`
	UnusedCount         int `json:"unusedCount"`
	PinnedCount         int `json:"pinnedCount"`
}

type HealthIssue struct {
	Name           string   `json:"name"`
	URL            string   `json:"url"`
	Shortcut       string   `json:"shortcut,omitempty"`
	Category       string   `json:"category,omitempty"`
	PageID         int      `json:"pageId"`
	PageName       string   `json:"pageName,omitempty"`
	Index          int      `json:"index"`
	Pinned         bool     `json:"pinned"`
	CheckStatus    bool     `json:"checkStatus"`
	OpenCount      int      `json:"openCount"`
	LastOpened     int64    `json:"lastOpened,omitempty"`
	LastChecked    int64    `json:"lastChecked,omitempty"`
	LastError      string   `json:"lastError,omitempty"`
	PreviewTitle   string   `json:"previewTitle,omitempty"`
	PreviewDesc    string   `json:"previewDesc,omitempty"`
	PreviewImage   string   `json:"previewImage,omitempty"`
	Status         string   `json:"status"`
	Score          int      `json:"score"`
	Reasons        []string `json:"reasons"`
	DuplicateCount int      `json:"duplicateCount"`
}

type BookmarkHealthReport struct {
	GeneratedAt     int64            `json:"generatedAt"`
	Summary         HealthSummary    `json:"summary"`
	Issues          []HealthIssue    `json:"issues"`
	DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
}

type BookmarkWithCount struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	OpenCount  int    `json:"openCount"`
	LastOpened int64  `json:"lastOpened,omitempty"`
	PageID     int    `json:"pageId,omitempty"`
}

type DuplicateWarning struct {
	DuplicateURLs []DuplicateGroup `json:"duplicateUrls"`
}

type DuplicateGroup struct {
	URL        string        `json:"url"`
	Bookmarks  []BookmarkRef `json:"bookmarks"`
	MatchScore float64       `json:"matchScore"`
}

type BookmarkRef struct {
	Name   string `json:"name"`
	Index  int    `json:"index"`
	PageID int    `json:"pageId"`
}

// PreviewCacheFile stores cached bookmark preview metadata keyed by canonical URL.
type PreviewCacheFile struct {
	Cache map[string]BookmarkPreview `json:"cache"`
}

// HealthScanCache stores cached ping results for bookmarks
type HealthScanCache struct {
	URL         string `json:"url"`
	Status      string `json:"status"`      // "online", "offline", "error"
	PingMs      int    `json:"pingMs"`      // Response time in milliseconds
	LastScanned int64  `json:"lastScanned"` // Unix milliseconds
	Error       string `json:"error,omitempty"`
}

type HealthScanCacheFile struct {
	GeneratedAt int64                      `json:"generatedAt"`
	Cache       map[string]HealthScanCache `json:"cache"` // Keyed by canonical URL
}

// Search indexing
type SearchIndex struct {
	Entries []SearchEntry `json:"entries"`
}

type SearchEntry struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Shortcut string `json:"shortcut"`
	Category string `json:"category"`
	Keywords string `json:"keywords"` // Combined searchable text
	Index    int    `json:"index"`
	PageID   int    `json:"pageId"`
}

// Undo/Redo history
type HistoryEntry struct {
	Timestamp   int64     `json:"timestamp"`
	Action      string    `json:"action"` // "add", "remove", "update", "move"
	PageID      int       `json:"pageId"`
	Bookmark    *Bookmark `json:"bookmark,omitempty"`
	OldBookmark *Bookmark `json:"oldBookmark,omitempty"`
	Index       int       `json:"index"`
}

type UndoRedoManager struct {
	History      []HistoryEntry
	CurrentIndex int
}

// Bookmark preview metadata
type BookmarkPreview struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Domain      string `json:"domain"`
	Icon        string `json:"icon"`
	FetchedAt   int64  `json:"fetchedAt"`
}
