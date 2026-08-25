package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var ErrBookmarkNotFound = errors.New("bookmark not found")

// ErrCategoriesStillReferenced is returned by SaveCategoriesByPage when the
// caller submits an empty category list while bookmarks on the page still
// reference one. Saving is refused rather than silently ignored, so a client
// that really means to clear every category (moving those bookmarks to
// uncategorized) gets a signal instead of a 200 that changed nothing.
var ErrCategoriesStillReferenced = errors.New("categories still referenced by bookmarks")

type Bookmark struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	PageID      int    `json:"pageId,omitempty"`
	Shortcut    string `json:"shortcut"`
	Category    string `json:"category"`
	Pinned      bool   `json:"pinned,omitempty"`
	CheckStatus bool   `json:"checkStatus"`
	Icon        string `json:"icon"`
	CreatedAt   int64  `json:"createdAt,omitempty"` // Timestamp when bookmark was created
	// UpdatedAt records the last change to a bookmark's own content — name, URL,
	// category, tags and the like. It is deliberately not touched by the health
	// monitor or by opening a bookmark: LastChecked and LastOpened already carry
	// those, and letting them bump this would leave every monitored bookmark
	// permanently reading "changed a minute ago". See bookmarkContentFingerprint.
	UpdatedAt    int64    `json:"updatedAt,omitempty"`
	LastOpened   int64    `json:"lastOpened,omitempty"`
	LastChecked  int64    `json:"lastChecked,omitempty"`
	LastError    string   `json:"lastError,omitempty"`
	OpenCount    int      `json:"openCount,omitempty"`    // Analytics: track opens
	PreviewTitle string   `json:"previewTitle,omitempty"` // Preview metadata
	PreviewDesc  string   `json:"previewDesc,omitempty"`  // Preview description
	PreviewImage string   `json:"previewImage,omitempty"` // Preview image URL
	Note         string   `json:"note,omitempty"`         // User note for bookmark
	Tags         []string `json:"tags,omitempty"`
	// Monitor opts a bookmark into uptime monitoring: a separate, faster tier than
	// CheckStatus. Monitored bookmarks are pinged on their own interval and are the
	// only ones that accumulate sample history (see health_history.go), so enabling
	// it for everything would bloat the history file for no benefit.
	Monitor                bool `json:"monitor,omitempty"`
	MonitorIntervalMinutes int  `json:"monitorIntervalMinutes,omitempty"` // 5..1440, 0 = use default
	// ExpectText is a string the page must contain to count as healthy. A page
	// that answers 200 while showing "database connection failed" is up by every
	// other measure, and this is the only way to say otherwise.
	//
	// Empty means no content check, which is the default and costs nothing: the
	// body is only read when this is set, so bookmarks without it never pay for
	// the feature.
	ExpectText string `json:"expectText,omitempty"`
	// ExpectTextAbsent inverts the test — healthy when the string is *missing*,
	// for catching an error banner rather than confirming a good page.
	ExpectTextAbsent bool `json:"expectTextAbsent,omitempty"`
	// ExpectStatus narrows what counts as reachable, as a comma-separated list of
	// codes and ranges ("200", "200-299", "200,301,401"). Empty keeps the default
	// rule in httpStatusReachable, which treats anything under 500 as up — right
	// for bookmarks generally, but unable to tell an endpoint that *should* return
	// 401 from one that just started to.
	ExpectStatus string `json:"expectStatus,omitempty"`
	// WatchDrift opts a monitored bookmark into rot detection: where the check
	// lands after redirects, what the page is titled, and roughly what it says.
	// Off by default and separate from the expectations above, because it reads
	// the page body — the one part of a check that costs real bandwidth.
	WatchDrift bool `json:"watchDrift,omitempty"`
	// The baseline the drift checks compare against, recorded on the first check
	// after WatchDrift is switched on. Empty means "no baseline yet", which reads
	// as unknown rather than as drift.
	DriftURL string `json:"driftUrl,omitempty"`
	// BrokenSince is when the current run of failures started, kept across
	// checks so a link that died months ago does not read like one that broke
	// this morning. Cleared the moment a check succeeds, so it is always "how
	// long has it been failing", never "when did it last fail".
	BrokenSince int64 `json:"brokenSince,omitempty"`
	/*
	 * ArchiveDiedAt is when the web lost the page, as the Wayback index sees it
	 * -- the first capture after the last one that answered 200.
	 *
	 * A different fact from BrokenSince, which is when *this install* started
	 * seeing failures. A bookmark added last week to a page that died in 2019
	 * has a BrokenSince of last week and an ArchiveDiedAt of 2019, and only the
	 * second one tells the reader what actually happened.
	 *
	 * Stored on the bookmark rather than fetched on demand because the preview
	 * card is drawn from memory and never makes a request: hovering a row has
	 * to stay free.
	 */
	ArchiveDiedAt int64 `json:"archiveDiedAt,omitempty"`
	// ArchiveSnapshotURL is the last capture that worked, so a card can offer it
	// without asking the index again.
	ArchiveSnapshotURL string `json:"archiveSnapshotUrl,omitempty"`
	// ArchiveCheckedAt is when the index was last asked, so it is not asked
	// again for every check.
	ArchiveCheckedAt int64 `json:"archiveCheckedAt,omitempty"`
	/*
	 * ArchiveJobID is the receipt for a capture that was asked for.
	 *
	 * Save Page Now answers with a job id and does the work over the following
	 * seconds to minutes, so the id is the only way to find out afterwards
	 * whether the capture happened. Thrown away, as it was at first, the status
	 * route had nothing to look up and a reader had no way to tell a queued
	 * capture from one the archive quietly refused.
	 */
	ArchiveJobID string `json:"archiveJobId,omitempty"`
	// ArchiveJobAt is when that capture was asked for, so a job id that never
	// finished can be recognised as stale rather than pending for ever.
	ArchiveJobAt     int64  `json:"archiveJobAt,omitempty"`
	DriftTitle       string `json:"driftTitle,omitempty"`
	DriftFingerprint string `json:"driftFingerprint,omitempty"`
	// DriftNoticed is what the last check found, as one of the kinds in
	// health_drift.go ("host", "root", "path", "title-parked", "title-changed",
	// "content"). Empty while the page is still recognisably itself.
	DriftNoticed string `json:"driftNoticed,omitempty"`
	DriftSince   int64  `json:"driftSince,omitempty"`
	// DriftReason is the sentence shown on the row — "Now redirects to
	// example.org", "Page title now reads …". Stored rather than re-derived,
	// because the baseline it was computed against is deliberately not updated
	// once drift is found.
	DriftReason string `json:"driftReason,omitempty"`
	// NotifyMuted silences outbound alerts for this one bookmark: it is still
	// checked, still recorded, and still shown as down in the view — only the
	// webhook and browser push are held back.
	//
	// Deliberately phrased as "muted" rather than "notify enabled". The notifying
	// default is on, and a bool with omitempty drops its false value from the
	// JSON entirely — so an "enabled" field would read back as false for every
	// bookmark saved before this existed and silently mute the whole collection.
	// Muted-by-absence is the migration-free direction.
	NotifyMuted bool `json:"notifyMuted,omitempty"`
	// CertHost is the hostname a check's TLS handshake was actually served for,
	// which after a redirect can differ from this bookmark's own URL. Certificates
	// are stored per host, not per bookmark (health_cert.go), so the report needs
	// this to look one up under the right key instead of guessing from URL.
	CertHost string `json:"certHost,omitempty"`
}

type Finder struct {
	ID        string   `json:"id,omitempty"`
	Name      string   `json:"name"`
	SearchUrl string   `json:"searchUrl"`
	Shortcut  string   `json:"shortcut"`
	Tags      []string `json:"tags,omitempty"`
	UseCount  int      `json:"useCount,omitempty"`
	LastUsed  int64    `json:"lastUsed,omitempty"`
}

type CollectionRule struct {
	// "tag", "category", "shortcut", plus the ones that are a question on
	// their own: "pinned", "untagged", "notOpenedDays", "changedDays".
	Field    string `json:"field"`
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
	SortMode   string `json:"sortMode,omitempty"`   // Bookmark sort within category: order, az, recent
	Spread     bool   `json:"spread,omitempty"`     // May run across several grid columns; how many follows from the item limit
}

type Page struct {
	ID    int    `json:"id"`              // Numeric ID matching the file number (bookmarks-1.json = id: 1)
	Name  string `json:"name"`            // Editable page name
	Icon  string `json:"icon,omitempty"`  // Optional emoji icon shown in the tab
	Color string `json:"color,omitempty"` // Optional accent color (hex) for the tab indicator
}

type PageWithBookmarks struct {
	Page       Page       `json:"page"`
	Categories []Category `json:"categories,omitempty"`
	// Widgets are blocks on this page that hold something other than bookmarks.
	// Beside the categories rather than in a file of their own, because the two
	// share one ordering -- see BlockOrder.
	Widgets []Widget `json:"widgets,omitempty"`
	/*
	 * BlockOrder is the order the dashboard draws blocks in: category ids and
	 * widget ids in one list.
	 *
	 * One list rather than a number on each, because two numbered lists drift
	 * the moment something is inserted between them -- every other number has to
	 * shift, and a single missed write leaves the order scrambled. This is the
	 * same shape `categories` already has, where the array order is the order.
	 *
	 * Absent means "as they come": resolveBlockOrder falls back to the existing
	 * category order, so a file written before this field renders exactly as it
	 * did.
	 */
	BlockOrder []string   `json:"blockOrder,omitempty"`
	Bookmarks  []Bookmark `json:"bookmarks"`
}

type PageOrder struct {
	Order []int `json:"order"` // Array of page IDs in display order
}

type Settings struct {
	CurrentPage                     int    `json:"currentPage"` // Numeric ID of the current page
	Theme                           string `json:"theme"`       // "light" or "dark"
	OpenInNewTab                    bool   `json:"openInNewTab"`
	ColumnsPerRow                   int    `json:"columnsPerRow"`
	FontSize                        string `json:"fontSize"` // xs, s, sm, m, lg, l, xl (legacy: small/medium/large normalized on load/save)
	ShowBackgroundDots              bool   `json:"showBackgroundDots"`
	ShowTitle                       bool   `json:"showTitle"`
	ShowDate                        bool   `json:"showDate"`
	ShowTime                        bool   `json:"showTime"`
	TimeFormat                      string `json:"timeFormat"`          // 24h or 12h
	DateFormat                      string `json:"dateFormat"`          // Date format: short-slash, short-dash, long-weekday
	ShowWeatherWithDate             bool   `json:"showWeatherWithDate"` // Show weather info next to date
	WeatherSource                   string `json:"weatherSource"`       // manual or browser
	WeatherLocation                 string `json:"weatherLocation"`     // Manual location query (city)
	WeatherUnit                     string `json:"weatherUnit"`         // celsius or fahrenheit
	WeatherRefreshMinutes           int    `json:"weatherRefreshMinutes"`
	ShowConfigButton                bool   `json:"showConfigButton"`
	ShowHealthDashboard             bool   `json:"showHealthDashboard"`
	ShowSearchButton                bool   `json:"showSearchButton"`
	ShowAddBookmarkButton           bool   `json:"showAddBookmarkButton"`
	ShowFindersButton               bool   `json:"showFindersButton"`
	ShowCommandsButton              bool   `json:"showCommandsButton"`
	ShowRecentButton                bool   `json:"showRecentButton"`
	ShowTagCloudButton              bool   `json:"showTagCloudButton"`                        // Dashboard / key: horizontal tag cloud toggle
	TagCloudDefaultMigrated         bool   `json:"tagCloudDefaultMigrated,omitempty"`         // one-time: enable tag cloud for existing installs
	LinkPreviewCardsOffMigrated     bool   `json:"linkPreviewCardsOffMigrated,omitempty"`     // one-time: default hover preview cards to off
	ShortcutTooltipsOffMigrated     bool   `json:"shortcutTooltipsOffMigrated,omitempty"`     // one-time: default the toolbar shortcut hints to off
	ShortcutOpenModeInstantMigrated bool   `json:"shortcutOpenModeInstantMigrated,omitempty"` // one-time: undo v1.2.0's "Enter opens" default
	ConfigButtonDefaultOnMigrated   bool   `json:"configButtonDefaultOnMigrated,omitempty"`   // one-time: restore config header icon after visibility fix
	ShowSearchFlowBanner            bool   `json:"showSearchFlowBanner"`
	ShowCheatSheetButton            bool   `json:"showCheatSheetButton"`
	ShowCollapseAllButton           bool   `json:"showCollapseAllButton"`
	ShowSearchButtonText            bool   `json:"showSearchButtonText"`
	ShowFindersButtonText           bool   `json:"showFindersButtonText"`
	ShowCommandsButtonText          bool   `json:"showCommandsButtonText"`
	ShowStatus                      bool   `json:"showStatus"`
	ColorizeStatus                  bool   `json:"colorizeStatus"`  // Keep online/offline/checking color changes on bookmark rows
	MonitorEmphasis                 string `json:"monitorEmphasis"` // How much monitored bookmarks stand out on the dashboard: problems, always, never
	ShowPing                        bool   `json:"showPing"`
	ShowStatusLoading               bool   `json:"showStatusLoading"`
	SkipFastPing                    bool   `json:"skipFastPing"`
	StatusOfflineRetries            int    `json:"statusOfflineRetries"`         // Failed pings per check before marking offline (1-10)
	StatusOfflineRetryDelayMs       int    `json:"statusOfflineRetryDelayMs"`    // Delay between retry pings in ms (100-3000)
	StatusRecheckIntervalMinutes    int    `json:"statusRecheckIntervalMinutes"` // Background re-check interval in minutes (1-60)
	GlobalShortcuts                 bool   `json:"globalShortcuts"`              // Use shortcuts from all pages
	HyprMode                        bool   `json:"hyprMode"`                     // Launcher mode for PWA usage
	AnimationsEnabled               bool   `json:"animationsEnabled"`            // Enable or disable animations globally
	EnableCustomTitle               bool   `json:"enableCustomTitle"`            // Enable custom page title
	CustomTitle                     string `json:"customTitle"`                  // Custom page title
	ShowPageInTitle                 bool   `json:"showPageInTitle"`              // Show current page name in title
	ShowPageNamesInTabs             bool   `json:"showPageNamesInTabs"`          // Show page names in tabs instead of numbers
	EnableCustomFavicon             bool   `json:"enableCustomFavicon"`          // Enable custom favicon
	CustomFaviconPath               string `json:"customFaviconPath"`            // Path to custom favicon file
	EnableCustomFont                bool   `json:"enableCustomFont"`             // Enable custom font
	CustomFontPath                  string `json:"customFontPath"`               // Path to custom font file
	Language                        string `json:"language"`                     // Language code, e.g., "en" or "es"
	InterleaveMode                  bool   `json:"interleaveMode"`               // Interleave mode for search (/ for shortcuts, direct input for fuzzy)
	ShowPageTabs                    bool   `json:"showPageTabs"`                 // Show page navigation tabs
	AlwaysCollapseCategories        bool   `json:"alwaysCollapseCategories"`     // Always collapse categories on load
	HideEmptyCategories             bool   `json:"hideEmptyCategories"`          // Hide categories with no bookmarks
	HideEmptyCategoriesMigrated     bool   `json:"hideEmptyCategoriesMigrated"`  // Migration marker for hide-empty default-on
	EnableFuzzySuggestions          bool   `json:"enableFuzzySuggestions"`       // Enable fuzzy suggestions in shortcut search
	FuzzySuggestionsStartWith       bool   `json:"fuzzySuggestionsStartWith"`    // Fuzzy suggestions start with query instead of contains
	KeepSearchOpenWhenEmpty         bool   `json:"keepSearchOpenWhenEmpty"`      // Keep search interface open when query is empty
	ShowIcons                       bool   `json:"showIcons"`                    // Show bookmark icons
	ShowLinkPreviewCards            bool   `json:"showLinkPreviewCards"`         // Show link preview cards on hover. Kept in step with LinkPreviewMode, which is the field that decides
	// LinkPreviewMode is how the card is reached: "off", "hover" or
	// "keyboard". Some people want what the card says and not a panel
	// appearing under the pointer, and their only answer used to be off —
	// throwing away the whole feature to avoid one behaviour of it.
	LinkPreviewMode string `json:"linkPreviewMode"`
	// ShowSiteNews draws the five most recent nextdash.cc posts on the config
	// overview. On by default; off means the server never fetches the feed at
	// all, rather than fetching and hiding it.
	ShowSiteNews bool `json:"showSiteNews"`
	// LinkPreviewParts names the rows the card may draw, from the set in
	// normalizeLinkPreviewParts. Absent means all of them; someone who writes
	// no notes never needs the note row.
	LinkPreviewParts            []string                     `json:"linkPreviewParts,omitempty"`
	LinkPreviewHoverDelayMs     int                          `json:"linkPreviewHoverDelayMs"`     // Hover delay before preview card appears
	ShowShortcuts               bool                         `json:"showShortcuts"`               // Show bookmark shortcuts
	ShowPinIcon                 bool                         `json:"showPinIcon"`                 // Show pin icon next to pinned bookmarks
	ShowNoteIcon                bool                         `json:"showNoteIcon"`                // Show note icon next to bookmarks with a note
	IncludeFindersInSearch      bool                         `json:"includeFindersInSearch"`      // Include finders in normal search
	SortMethod                  string                       `json:"sortMethod,omitempty"`        // Legacy global sort (migrated to per-category sortMode)
	CategorySortModes           map[string]map[string]string `json:"categorySortModes,omitempty"` // Per-page sort for uncategorized/orphan categories
	CategorySortModesMigrated   bool                         `json:"categorySortModesMigrated"`   // Legacy sortMethod migrated to per-category modes
	LayoutPreset                string                       `json:"layoutPreset"`                // Dashboard layout preset
	LayoutVersion               string                       `json:"layoutVersion"`               // Dashboard layout version: classic, modern
	DensityMode                 string                       `json:"densityMode"`                 // Dashboard density mode: comfortable, compact, dense
	CategorySpacing             string                       `json:"categorySpacing"`             // Vertical space between category rows: snug, balanced, airy
	SideMargin                  string                       `json:"sideMargin"`                  // Left/right page margin on the dashboard: snug, balanced, airy
	PackedColumns               bool                         `json:"packedColumns"`               // Stack categories in vertical columns (round-robin) to reduce empty space
	DefaultCategorySpread       bool                         `json:"defaultCategorySpread"`       // New categories may run across columns
	CategorySpreadResetScope    string                       `json:"categorySpreadResetScope"`    // What "turn spreading off everywhere" covers: page, all
	CategorySpreads             map[string]map[string]bool   `json:"categorySpreads,omitempty"`   // Per-page switch for uncategorized/smart collections, which have no stored category
	LauncherIconSize            string                       `json:"launcherIconSize"`            // Launcher tile icon size: small, normal, large
	CalendarUrl                 string                       `json:"calendarUrl"`                 // URL for calendar link in date popover (empty = hidden)
	ButtonBarPosition           string                       `json:"buttonBarPosition"`           // Button bar position: bottom, bottom-left, bottom-right, side-left, side-right
	ShowDockLayoutSelector      bool                         `json:"showDockLayoutSelector"`      // Show layout selector button in side-dock
	BackgroundOpacity           float64                      `json:"backgroundOpacity"`           // Background opacity (0.0-1.0)
	FontWeight                  string                       `json:"fontWeight"`                  // Font weight: normal, 600, bold
	FontPreset                  string                       `json:"fontPreset"`                  // UI font preset: source-code-pro, jetbrains-mono, etc.
	AutoDarkMode                bool                         `json:"autoDarkMode"`                // Auto-detect dark mode from system
	RandomThemeOnRefresh        bool                         `json:"randomThemeOnRefresh"`        // Legacy: migrated to randomThemeMode
	RandomThemeMode             string                       `json:"randomThemeMode"`             // off, refresh, or view
	ShowSmartRecentCollection   bool                         `json:"showSmartRecentCollection"`   // Show smart recently opened collection
	ShowSmartTodayCollection    bool                         `json:"showSmartTodayCollection"`    // Show smart start "today" collection
	ShowSmartStaleCollection    bool                         `json:"showSmartStaleCollection"`    // Show smart stale bookmarks collection
	ShowSmartMostUsedCollection bool                         `json:"showSmartMostUsedCollection"` // Show smart most used bookmarks collection
	SmartTodayLimit             int                          `json:"smartTodayLimit"`             // Max items in smart today (0 = unlimited)
	SmartRecentLimit            int                          `json:"smartRecentLimit"`            // Max items in smart recently opened (0 = unlimited)
	SmartStaleLimit             int                          `json:"smartStaleLimit"`             // Max items in smart stale bookmarks (0 = unlimited)
	SmartMostUsedLimit          int                          `json:"smartMostUsedLimit"`          // Max items in smart most used (0 = unlimited)
	ShowSmartAddedCollection    bool                         `json:"showSmartAddedCollection"`    // Show smart recently added collection
	SmartAddedLimit             int                          `json:"smartAddedLimit"`             // Max items in smart recently added (0 = unlimited)
	SmartAddedPageIds           []int                        `json:"smartAddedPageIds"`           // Page IDs where smart recently added is enabled (empty = all)
	ShowRowTags                 bool                         `json:"showRowTags"`                 // Show tag chips on dashboard bookmark rows
	RowTagsMax                  int                          `json:"rowTagsMax"`                  // Chips shown before a "+N" (rest collapse)
	CategoryItemLimit           int                          `json:"categoryItemLimit"`           // Max bookmarks shown per category before a "show more" toggle (0 = unlimited)
	SmartTodayWorkKeywords      string                       `json:"smartTodayWorkKeywords"`      // Comma-separated work-hour keyword boosts
	SmartTodayEveningKeywords   string                       `json:"smartTodayEveningKeywords"`   // Comma-separated evening keyword boosts
	SmartTodayWeekendKeywords   string                       `json:"smartTodayWeekendKeywords"`   // Comma-separated weekend keyword boosts
	SmartTodayPageIds           []int                        `json:"smartTodayPageIds"`           // Page IDs where smart today is enabled (empty = all)
	SmartRecentPageIds          []int                        `json:"smartRecentPageIds"`          // Page IDs where smart recent is enabled (empty = all)
	SmartStalePageIds           []int                        `json:"smartStalePageIds"`           // Page IDs where smart stale is enabled (empty = all)
	SmartMostUsedPageIds        []int                        `json:"smartMostUsedPageIds"`        // Page IDs where smart most used is enabled (empty = all)
	Collections                 []Collection                 `json:"collections,omitempty"`       // User-defined dynamic collections
	ShowTagCollections          bool                         `json:"showTagCollections"`          // Auto-generate a collection per tag
	TagCollectionsMinCount      int                          `json:"tagCollectionsMinCount"`      // Minimum bookmarks per tag to show collection (0 = all)
	FaviconRefreshPolicy        string                       `json:"faviconRefreshPolicy"`        // Favicon policy: manual, on-save
	OnboardingCompleted         bool                         `json:"onboardingCompleted"`
	AnalyticsOptIn              bool                         `json:"analyticsOptIn"`       // Privacy-friendly Umami analytics — opt-in, off until the user turns it on in Config → General
	EnableSessionTips           bool                         `json:"enableSessionTips"`    // Occasional cheat-sheet tip toast, rate-limited by discoverabilityState.tipsNotBefore (default on, opt-out in Config → General)
	ShowShortcutTooltips        bool                         `json:"showShortcutTooltips"` // Keyboard-shortcut popovers on toolbar and header icons (default OFF since the shortcutTooltipsOffMigrated migration; opt-in in Config → Behavior or `:shortcuts on`)
	ShowGridKeyLegend           bool                         `json:"showGridKeyLegend"`
	ShortcutOpenMode            string                       `json:"shortcutOpenMode,omitempty"`
	RememberScrollPosition      bool                         `json:"rememberScrollPosition"` // Return to where you were on a page instead of the top, after a page switch or a trip through Health, Inbox or config
	DetectSoftNotFound          bool                         `json:"detectSoftNotFound"`     // Judge whether a monitored page answering 200 is really a "page not found" template. Costs one bounded body read per check, which is why it is a choice
	CertWarnDays                int                          `json:"certWarnDays,omitempty"` // How many days before expiry a certificate starts warning. 0 means the built-in 30; clamped to 3–120 on save. The two tighter marks follow it // What typing a bookmark shortcut does: "instant" (default, opens the moment it matches), "delay" (opens after a short pause with no further key), "enter" (Enter opens). Empty reads as "instant"; installs carrying the v1.2.0 default are moved once, see migrateShortcutOpenModeDefaultInstant
	// HealthCheckTimeoutSeconds is how long one availability check may take.
	// 0 means the built-in default (3s), which is what every install had before
	// this was a choice. Clamped to 2–30 on save.
	HealthCheckTimeoutSeconds int             `json:"healthCheckTimeoutSeconds,omitempty"` // Short key legend under the bookmark grid. On for a fresh install; an existing settings.json without the key keeps the zero value, so nobody has it appear under a dashboard they already know
	QuickStart                QuickStartState `json:"quickStart"`                          // First-run quick-start progress (server-side, per-user)
	// ConfigGeneralLayer is the last Essentials/Advanced/all layer used in
	// Config → General. Empty means "never chosen", which starts on Essentials.
	// Stored here rather than localStorage so the choice follows the user across
	// browsers, like every other per-user preference.
	ConfigGeneralLayer string `json:"configGeneralLayer,omitempty"`
	// ConfigGeneralPanels records which General sections are expanded, keyed by
	// panel id (and "sc:<id>" for smart-collection groups). Absent means the
	// defaults apply: everything collapsed.
	ConfigGeneralPanels            map[string]bool                  `json:"configGeneralPanels,omitempty"`
	ConfigGeneralTourCompleted     bool                             `json:"configGeneralTourCompleted"`
	ConfigBookmarksTourCompleted   bool                             `json:"configBookmarksTourCompleted"`
	ConfigFindersTourCompleted     bool                             `json:"configFindersTourCompleted"`
	ConfigStatsTourCompleted       bool                             `json:"configStatsTourCompleted"`
	ConfigCategoriesTourCompleted  bool                             `json:"configCategoriesTourCompleted"`
	ConfigTagsTourCompleted        bool                             `json:"configTagsTourCompleted"`
	ConfigPagesTourCompleted       bool                             `json:"configPagesTourCompleted"`
	ConfigCollectionsTourCompleted bool                             `json:"configCollectionsTourCompleted"`
	ConfigThemeTourCompleted       bool                             `json:"configThemeTourCompleted"`
	BackgroundType                 string                           `json:"backgroundType"`     // "auto", "none", "gradient", "image"
	BackgroundGradient             string                           `json:"backgroundGradient"` // preset name used when type="gradient"
	BackgroundImageUrl             string                           `json:"backgroundImageUrl"` // URL used when type="image"
	ThemeIconStyling               map[string]ThemeIconStylingEntry `json:"themeIconStyling,omitempty"`
	PasteUrlQuickAdd               bool                             `json:"pasteUrlQuickAdd"`        // Enable paste URL to quick-add bookmark on dashboard
	InboxEnabled                   bool                             `json:"inboxEnabled"`            // Enable inbox page and paste-to-inbox flow
	PasteDestination               string                           `json:"pasteDestination"`        // ask, bookmark, or inbox when pasting a URL
	InboxDedupeUrls                bool                             `json:"inboxDedupeUrls"`         // Skip duplicate URLs in inbox
	InboxMaxItems                  int                              `json:"inboxMaxItems"`           // Max inbox items (0 = unlimited)
	InboxShowInPageTabs            bool                             `json:"inboxShowInPageTabs"`     // Show Inbox tab in page navigation
	InboxDeleteAfterPromote        bool                             `json:"inboxDeleteAfterPromote"` // Remove inbox item after promote to bookmark
	AllowLocalBookmarks            bool                             `json:"allowLocalBookmarks"`     // Allow http(s) bookmarks to localhost and private hosts
	AutoBackupEnabled              bool                             `json:"autoBackupEnabled"`       // Automatically create a local backup (keeps the latest few)
	// AutoBackupIntervalDays is how often that runs. 0 means the built-in
	// weekly default, which is what every install carried before this was a
	// choice — so an absent key keeps the old behaviour rather than reading as
	// "never".
	AutoBackupIntervalDays         int  `json:"autoBackupIntervalDays,omitempty"`
	HealthAutoRecheckEnabled       bool `json:"healthAutoRecheckEnabled"`       // Periodically re-ping status-checked bookmarks in the background
	HealthAutoRecheckIntervalHours int  `json:"healthAutoRecheckIntervalHours"` // Hours between background rechecks (min 1, default 24)
	// FeedsEnabled turns on feed polling: a bookmark whose page advertises a
	// feed can then say when it has published something since you last opened
	// it. Off by default because it is the only thing here that reaches out to
	// the internet on a schedule without a bookmark having asked for it —
	// discovery happens regardless, so switching this on needs no re-fetch.
	FeedsEnabled bool `json:"feedsEnabled"`
	// FeedsMarkQuiet puts a mark on a row whose page publishes but has nothing
	// new. Off by default and deliberately so: most of those rows are silent
	// most of the time, and a mark on twenty of them is the noise Fresh exists
	// to avoid. It is here for the reader who wants to see which bookmarks are
	// taking part at a glance rather than one at a time in the editor.
	FeedsMarkQuiet          bool `json:"feedsMarkQuiet"`
	ServerLogRetentionHours int  `json:"serverLogRetentionHours"` // Hours of server log to keep in "time" mode (0 = until cleared, max 90 days)
	// Which cap applies: "time" uses ServerLogRetentionHours and ignores the
	// entry count, "count" uses ServerLogMaxEntries and ignores the age. The
	// two are deliberately exclusive — a log capped both ways silently drops
	// lines for a reason the chosen setting does not explain.
	ServerLogRetentionMode string `json:"serverLogRetentionMode"` // "time" (default) or "count"
	ServerLogMaxEntries    int    `json:"serverLogMaxEntries"`    // Lines to keep in "count" mode (100…5000)
	// Off by default, so an install that never opens the log viewer pays
	// nothing for it: while this is false the sink returns before taking a lock
	// or touching the disk. No "omitempty" — with it a false value drops out of
	// the JSON entirely and the switch reads back as undefined in the config UI.
	ServerLogEnabled     bool   `json:"serverLogEnabled"`               // Capture server log lines for the in-app viewer (default off)
	MonitorNotifyURL     string `json:"monitorNotifyUrl,omitempty"`     // Webhook posted when a monitored bookmark goes down/recovers (empty = off)
	MonitorNotifyRetries int    `json:"monitorNotifyRetries,omitempty"` // Consecutive failures before alerting (min 1, default 3)
	// MonitorNotifyPreset shapes the webhook body for a specific service instead
	// of nextDash's own raw JSON. Empty keeps today's exact behaviour, so an
	// existing webhook receiver built against the raw shape needs no migration.
	MonitorNotifyPreset string `json:"monitorNotifyPreset,omitempty"` // "", "slack", "discord", "telegram", "gotify", "ntfy", "pushover"
	// MonitorNotifyTelegramChatID is only read when MonitorNotifyPreset is
	// "telegram" — the bot API needs a chat to post into, separate from the
	// bot-token URL, and getting it wrong is otherwise a silent failure.
	MonitorNotifyTelegramChatID string `json:"monitorNotifyTelegramChatId,omitempty"`
	// Pushover has no user-chosen URL at all: the endpoint is fixed
	// (api.pushover.net) and delivery is keyed on these two values instead.
	MonitorNotifyPushoverToken   string `json:"monitorNotifyPushoverToken,omitempty"`
	MonitorNotifyPushoverUserKey string `json:"monitorNotifyPushoverUserKey,omitempty"`
	// Archiving a bookmark the day it is saved, rather than looking for a copy
	// the day it dies. The keys are archive.org's S3-style pair from
	// archive.org/account/s3.php; without them the archive still accepts
	// captures but at a far smaller daily budget, so this is opt-in by having
	// keys rather than by a separate switch.
	ArchiveSaveEnabled   bool   `json:"archiveSaveEnabled,omitempty"`
	ArchiveSaveAccessKey string `json:"archiveSaveAccessKey,omitempty"`
	ArchiveSaveSecret    string `json:"archiveSaveSecret,omitempty"`
	// MaintenanceWindows are recurring periods when downtime is expected. Checks
	// still run and samples are still recorded — the heartbeat stays honest — but
	// failures inside a window raise no alert and do not count against uptime.
	MaintenanceWindows []MaintenanceWindow `json:"maintenanceWindows,omitempty"`
	// The push booleans deliberately omit "omitempty": with it, a false value is
	// dropped from the JSON entirely and the config checkbox reads `undefined`
	// instead of unchecked, so turning a toggle off would not survive a reload.
	PushNotifyEnabled    bool                  `json:"pushNotifyEnabled"`              // Master switch for browser push notifications (Web Push)
	PushNotifySubject    string                `json:"pushNotifySubject,omitempty"`    // VAPID contact (mailto: or https:) sent to push services
	PushNotifyMonitor    bool                  `json:"pushNotifyMonitor"`              // Push when a monitored bookmark goes down/recovers
	PushNotifyBackup     bool                  `json:"pushNotifyBackup"`               // Push when an automatic backup succeeds or fails
	PushNotifyRelease    bool                  `json:"pushNotifyRelease"`              // Deprecated: release updates use in-app toast only
	UpdateCheckEnabled   bool                  `json:"updateCheckEnabled"`             // Poll GitHub for newer releases (on by default)
	DiscoverabilityState *DiscoverabilityState `json:"discoverabilityState,omitempty"` // Cross-browser what's-new and tips state
	SavedSearches        []SavedSearch         `json:"savedSearches,omitempty"`        // Named queries from the search bar

	// Config → Bookmarks. The list view had no settings of its own; these are
	// the choices it used to make on the user's behalf.
	ConfigBookmarksSort       string `json:"configBookmarksSort"`           // Sort the list opens on: page/name/recent/lastOpened/opens/pinned
	ConfigBookmarksPageSize   int    `json:"configBookmarksPageSize"`       // Rows added per "load more" step
	BookmarkDeleteConfirmFrom int    `json:"bookmarkDeleteConfirmFrom"`     // Ask before deleting this many rows or more (1 = always)
	DefaultMonitorIntervalMin int    `json:"defaultMonitorIntervalMinutes"` // Interval a bookmark gets when switched to Monitor
	NewBookmarkCheckMode      string `json:"newBookmarkCheckMode"`          // Availability a quick-added bookmark starts on: off/periodic/monitor
	NewBookmarkPinned         bool   `json:"newBookmarkPinned"`             // Quick-add pins by default
	NewBookmarkCategory       string `json:"newBookmarkCategory"`           // Category id a quick-added bookmark lands in ("" = none)
	BookmarkStaleDays         int    `json:"bookmarkStaleDays"`             // "Not opened in N days" in the cleanup score and stats
	BulkFaviconConfirmFrom    int    `json:"bulkFaviconConfirmFrom"`        // Ask before refreshing icons for this many rows (0 = never)
	BookmarkArchiveUrl        string `json:"bookmarkArchiveUrl"`            // Archive service, {url} replaced with the bookmark's address
}

// SavedSearch is a query the user named and kept from the search bar.
//
// Stored in settings.json rather than localStorage, which is where they used to
// live: :save and :saved are a documented feature, but the entries survived
// neither a cleared cache nor a move to another browser, and — the part that
// mattered — they were in no backup at all, so a reassuring ZIP did not contain
// them.
type SavedSearch struct {
	Name  string `json:"name"`
	Query string `json:"query"`
}

// DiscoverabilityState persists UI discoverability progress in settings.json (shared across browsers).
type DiscoverabilityState struct {
	LastWhatsNewRelease string `json:"lastWhatsNewRelease,omitempty"`
	TipsPromoUntil      int64  `json:"tipsPromoUntil,omitempty"`
	TipsNotBefore       int64  `json:"tipsNotBefore,omitempty"`
	// SeenTips lists tip ids already shown as a session tip; each is shown once, ever.
	SeenTips []string `json:"seenTips,omitempty"`
	// SeenSettingPromos lists dismissed config setting highlight popovers.
	SeenSettingPromos []string `json:"seenSettingPromos,omitempty"`
}

// defaultThemeID is the theme a fresh install starts on. Existing dashboards
// keep whatever they already have.
const defaultThemeID = "retro-crt-dark"

// defaultThemeLightID is the light counterpart auto dark mode switches to.
const defaultThemeLightID = "retro-crt-light"

type ThemeIconStylingEntry struct {
	Enabled   bool    `json:"enabled"`
	Style     string  `json:"style"`
	Intensity float64 `json:"intensity"`
}

// defaultThemeIconStyling switches favicon harmonisation on for the default
// theme of a fresh install, so mismatched site favicons blend with Retro CRT
// out of the box. Existing installs keep whatever map they already stored.
//
// Both variants are listed because the setting is keyed by the *displayed*
// theme id, and auto dark mode (also on by default) swaps between the dark and
// light Retro CRT. With only one entry, harmonisation would silently apply for
// half the day.
//
// Values match the fallback the config UI assumes for an absent entry, so the
// form shows the same style and intensity it would have defaulted to.
func defaultThemeIconStyling() map[string]ThemeIconStylingEntry {
	entry := ThemeIconStylingEntry{Enabled: true, Style: "muted", Intensity: 0.5}
	return map[string]ThemeIconStylingEntry{
		defaultThemeID:      entry,
		defaultThemeLightID: entry,
	}
}

// QuickStartState tracks first-run quick-start progress, persisted per-user in
// settings JSON (not client localStorage) so it is consistent across devices.
type QuickStartState struct {
	SetupDone           bool `json:"setupDone"`           // Compact setup card finished or skipped
	Dismissed           bool `json:"dismissed"`           // Checklist completed or dismissed
	VisitedConfig       bool `json:"visitedConfig"`       // Opened Config → General (checklist item)
	SeenCheatsheet      bool `json:"seenCheatsheet"`      // Opened the keyboard cheat sheet (checklist item)
	SeenAnalyticsNotice bool `json:"seenAnalyticsNotice"` // Legacy: dismissed the old card that merely announced analytics was on. Not a choice — see AnalyticsChoiceMade.
	AnalyticsChoiceMade bool `json:"analyticsChoiceMade"` // User actively answered the opt-in card (turned it on, or declined)
	// Unix seconds before which the opt-in card stays hidden. Set when the user
	// leaves the question open (closes the card or reads the detail without
	// deciding) so a hesitant user is not asked again on the very next load.
	AnalyticsAskAfter int64 `json:"analyticsAskAfter,omitempty"`
	// How often the question has been put off, indexing a backoff schedule so
	// each further hesitation waits longer than the last.
	AnalyticsSnoozes int `json:"analyticsSnoozes,omitempty"`
	// Same three-part state for the browser-notification invitation: whether it
	// was actually answered, how long it stays hidden after being left open, and
	// how often that has happened. Registering a device is per browser, so this
	// records the decision rather than the subscription.
	PushChoiceMade bool  `json:"pushChoiceMade,omitempty"`
	PushAskAfter   int64 `json:"pushAskAfter,omitempty"`
	PushSnoozes    int   `json:"pushSnoozes,omitempty"`
	// Bookmark counts at the moment setup finished. The checklist ticks "add a
	// bookmark" / "tag a bookmark" only once the user gets past these, so the
	// seeded example bookmarks (which already carry tags) do not tick them for
	// free. -1 means "not captured yet".
	BaselineBookmarks int `json:"baselineBookmarks"`
	BaselineTagged    int `json:"baselineTagged"`
}

func isValidFontPreset(s string) bool {
	switch s {
	case "source-code-pro", "jetbrains-mono", "ibm-plex-mono", "inter", "ibm-plex-sans", "dm-sans", "system", "custom":
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

func normalizeFontSize(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "xs", "s", "sm", "m", "lg", "l", "xl":
		return strings.ToLower(strings.TrimSpace(s))
	case "small":
		return "s"
	case "medium":
		return "m"
	case "large":
		return "l"
	default:
		return "m"
	}
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
	SaveBookmarksByPage(pageID int, bookmarks []Bookmark) error
	SaveBookmarkPageUpdates(updates map[int][]Bookmark) error
	TrackBookmarkOpen(pageID int, index int) error
	MutateBookmarkAt(pageID int, index int, mutate func(*Bookmark) error) error
	MutateBookmarksOnPage(pageID int, mutate func([]Bookmark) ([]Bookmark, error)) error
	DeleteBookmarkAt(pageID int, index int) error
	AddBookmarkToPage(pageID int, bookmark Bookmark) error
	DeleteBookmarkFromPage(pageID int, bookmark Bookmark) error
	// DeleteAllBookmarks empties every page's bookmarks while keeping pages/categories/settings.
	DeleteAllBookmarks() error
	// Categories - per page only
	GetCategoriesByPage(pageID int) []Category
	SaveCategoriesByPage(pageID int, categories []Category) error
	PreviewCategoriesByPage(pageID int, categories []Category) (CategoryRemapPreview, error)
	// Finders
	GetFinders() []Finder
	SaveFinders(finders []Finder) error
	// Pages
	GetPages() []Page
	// Widgets and the order every block on a page is drawn in. One pair,
	// because an order is only meaningful beside the things it orders.
	GetPageBlocks(pageID int) ([]Widget, []string)
	SavePageBlocks(pageID int, widgets []Widget, order []string) error
	SavePage(page Page) error
	DeletePage(pageID int) error
	GetPageOrder() []int
	SavePageOrder(order []int) error
	// Settings
	GetSettings() Settings
	SaveSettings(settings Settings) error
	// Colors
	GetColors() ColorTheme
	SaveColors(colors ColorTheme) error
	// Reset
	ResetAllData() error
	// TakeDefaultBookmarkIconPrefetch reports whether default bookmarks were just created and clears the flag.
	TakeDefaultBookmarkIconPrefetch() bool
	// MergePrefetchBookmarkIcons applies icon filenames to bookmarks when index/URL still match and
	// the icon is empty, or the update sets Overwrite.
	MergePrefetchBookmarkIcons(pageID int, updates []PrefetchIconUpdate) int
	// GetDataRevision returns a fingerprint of on-disk data for client cache invalidation.
	GetDataRevision() string
	// GetSettingsRevision fingerprints only what decides how the app looks and
	// behaves, so a polling client can tell a config change from a data change.
	GetSettingsRevision() string
	// InvalidateReadCache drops in-memory read caches after out-of-band disk writes (import/restore).
	InvalidateReadCache()
	// Inbox
	GetInboxItems() []InboxLink
	AddInboxLink(link InboxLink, dedupe bool, maxItems int) (InboxLink, []InboxLink, error)
	RestoreInboxLink(link InboxLink, maxItems int) (InboxLink, error)
	DeleteInboxLink(id string) error
	UpdateInboxLink(id string, mutate func(*InboxLink) error) (InboxLink, error)
	// removeUnusedIconFile deletes a stored favicon file when no bookmark or inbox
	// item still references it (best-effort). Called after an inbox item that owned
	// the icon is deleted or promoted, so its file does not linger in data/icons/.
	removeUnusedIconFile(fileName string)

	// Inbox stats (durable aggregate; survives triaged-away items)
	RecordInboxEvent(evt InboxEvent)
	GetInboxStats() InboxStats

	// Trash (deleted bookmarks, pages and categories, restorable for 30 days)
	GetTrashItems() []TrashedBookmark
	RestorePage(snapshot TrashedPage) error
	AddTrashedBookmarks(entries []TrashedBookmark) error
	TakeTrashItem(id string) (TrashedBookmark, error)
	DeleteTrashItem(id string) error
	EmptyTrash() (int, error)
	PruneTrash() (int, error)
}

// PrefetchIconUpdate is a merge-safe favicon write keyed by bookmark index and canonical URL.
type PrefetchIconUpdate struct {
	Index  int
	URLKey string
	Icon   string
	// Overwrite replaces an icon the bookmark already has. Off by default so the
	// background prefetch can never clobber a user-chosen icon; the "refresh all
	// favicons" command sets it deliberately.
	Overwrite bool
}

type FileStore struct {
	settingsFile                 string
	colorsFile                   string
	pageOrderFile                string
	dataDir                      string
	customThemesMigrationMarker  string
	mutex                        sync.RWMutex
	readCache                    storeReadCache
	prefetchDefaultBookmarkIcons bool
}

func NewStore() Store {
	root := ResolveDataDir()
	store := &FileStore{
		settingsFile:                filepath.Join(root, "settings.json"),
		colorsFile:                  filepath.Join(root, "colors.json"),
		pageOrderFile:               filepath.Join(root, "pages.json"),
		dataDir:                     root,
		customThemesMigrationMarker: filepath.Join(root, ".custom-themes-reset-v1"),
		readCache:                   newStoreReadCache(),
	}

	// Initialize default files if they don't exist
	store.initializeDefaultFiles()

	return store
}

// stampDefaultBookmarkCreatedAt dates the starter bookmarks to the moment the
// install was seeded, so CreatedAt carries a real value from the first run
// rather than the zero that "Recently added" and the age columns read as
// "unknown".
//
// Each entry is one millisecond after the one before it. A single shared
// timestamp would leave the recency sort with nothing to order by, making the
// list of starter bookmarks shuffle between renders; the offsets keep it in the
// order they are written here.
func stampDefaultBookmarkCreatedAt(bookmarks []Bookmark, now time.Time) {
	base := now.UnixMilli()
	for i := range bookmarks {
		bookmarks[i].CreatedAt = base + int64(i)
	}
}

func (fs *FileStore) initializeDefaultFiles() {
	fs.ensureDataDir()

	// Initialize bookmarks for main page if file doesn't exist
	mainPageBookmarksFile := filepath.Join(fs.dataDir, "bookmarks-1.json")
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
				// The project's own site, in the seed rather than only behind the
				// "follow it from your own dashboard" button in About: it is the
				// place a new install finds out what changed, it publishes a feed
				// so Fresh has something to count on day one, and a bookmark
				// dashboard whose own site is not on the dashboard is an odd
				// advertisement for itself. Deletable like any other starter row.
				{Name: "nextDash", URL: "https://nextdash.cc/", Shortcut: "N", Category: "development", CheckStatus: false, Tags: []string{"dev", "bookmarks", "self-hosted"}},
				{Name: "GitHub", URL: "https://github.com", Shortcut: "G", Category: "development", CheckStatus: true, Tags: []string{"dev", "code"}},
				{Name: "GitHub Issues", URL: "https://github.com/issues", Shortcut: "GI", Category: "development", CheckStatus: false, Tags: []string{"dev", "github"}},
				{Name: "GitHub Pull Requests", URL: "https://github.com/pulls", Shortcut: "GP", Category: "development", CheckStatus: false, Tags: []string{"dev", "github"}},
				{Name: "YouTube", URL: "https://youtube.com", Shortcut: "Y", Category: "media", CheckStatus: false, Tags: []string{"video", "entertainment"}},
				{Name: "YouTube Studio", URL: "https://studio.youtube.com", Shortcut: "YS", Category: "media", CheckStatus: false, Tags: []string{"video", "creator"}},
				{Name: "Bluesky", URL: "https://bsky.app", Shortcut: "B", Category: "social", CheckStatus: false, Tags: []string{"social"}},
				{Name: "Google", URL: "https://google.com", Shortcut: "", Category: "search", CheckStatus: false, Tags: []string{"search"}},
			},
		}
		stampDefaultBookmarkCreatedAt(defaultPageWithBookmarks.Bookmarks, time.Now())
		data, _ := json.MarshalIndent(defaultPageWithBookmarks, "", "  ")
		writeFileAtomic(mainPageBookmarksFile, data, 0644)
		fs.markDefaultBookmarkIconPrefetch()
	}

	// Initialize settings if file doesn't exist
	if _, err := os.Stat(fs.settingsFile); os.IsNotExist(err) {
		defaultSettings := Settings{
			CurrentPage:                  1,
			Theme:                        defaultThemeID,
			OpenInNewTab:                 true,
			AnalyticsOptIn:               false,
			EnableSessionTips:            true,
			ShowShortcutTooltips:         false,
			ShowGridKeyLegend:            true,
			ShortcutOpenMode:             "instant",
			RememberScrollPosition:       true,
			DetectSoftNotFound:           true,
			ColumnsPerRow:                3,
			FontSize:                     "m",
			ShowBackgroundDots:           true,
			ShowTitle:                    true,
			ShowDate:                     true,
			ShowTime:                     true,
			TimeFormat:                   "24h",
			DateFormat:                   "short-slash",
			ShowWeatherWithDate:          false,
			WeatherSource:                "manual",
			WeatherLocation:              "",
			WeatherUnit:                  "celsius",
			WeatherRefreshMinutes:        30,
			ShowConfigButton:             true,
			ShowHealthDashboard:          true,
			ShowSearchButton:             true,
			ShowAddBookmarkButton:        true,
			ShowFindersButton:            true,
			ShowCommandsButton:           true,
			ShowRecentButton:             false,
			ShowTagCloudButton:           true,
			ShowSearchFlowBanner:         true,
			ShowCheatSheetButton:         false,
			ShowCollapseAllButton:        false,
			ShowSearchButtonText:         true,
			ShowFindersButtonText:        true,
			ShowCommandsButtonText:       true,
			ShowStatus:                   true,
			ColorizeStatus:               true,
			MonitorEmphasis:              "problems",
			ShowPing:                     true,
			ShowStatusLoading:            false,
			SkipFastPing:                 false,
			StatusOfflineRetries:         3,
			StatusOfflineRetryDelayMs:    450,
			StatusRecheckIntervalMinutes: 5,
			GlobalShortcuts:              true,
			HyprMode:                     false,
			AnimationsEnabled:            true,
			EnableCustomTitle:            false,
			CustomTitle:                  "",
			ShowPageInTitle:              false,
			ShowPageNamesInTabs:          false,
			EnableCustomFavicon:          false,
			CustomFaviconPath:            "",
			EnableCustomFont:             false,
			CustomFontPath:               "",
			Language:                     "en",
			InterleaveMode:               false,
			ShowPageTabs:                 true,
			AlwaysCollapseCategories:     false,
			HideEmptyCategories:          true,
			EnableFuzzySuggestions:       false,
			FuzzySuggestionsStartWith:    false,
			KeepSearchOpenWhenEmpty:      false,
			ShowIcons:                    true,
			ShowLinkPreviewCards:         true,
			LinkPreviewMode:              "hover",
			ShowSiteNews:                 true,
			LinkPreviewHoverDelayMs:      250,
			ShowShortcuts:                true,
			ShowPinIcon:                  false,
			ShowNoteIcon:                 true,
			IncludeFindersInSearch:       false,
			SortMethod:                   "order",
			LayoutPreset:                 "default",
			LayoutVersion:                "classic",
			BackgroundOpacity:            1,
			FontWeight:                   "normal",
			FontPreset:                   "source-code-pro",
			AutoDarkMode:                 true,
			ShowSmartRecentCollection:    false,
			ShowSmartTodayCollection:     true,
			ShowSmartStaleCollection:     false,
			ShowSmartMostUsedCollection:  false,
			SmartTodayLimit:              8,
			SmartRecentLimit:             50,
			SmartMostUsedLimit:           25,
			CategoryItemLimit:            15,
			QuickStart:                   QuickStartState{BaselineBookmarks: -1, BaselineTagged: -1},
			SmartTodayWorkKeywords:       "calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams",
			SmartTodayEveningKeywords:    "youtube,spotify,netflix,reddit",
			SmartTodayWeekendKeywords:    "news,weather,maps",
			SmartTodayPageIds:            []int{},
			SmartRecentPageIds:           []int{},
			SmartStalePageIds:            []int{},
			SmartMostUsedPageIds:         []int{},
			SmartAddedPageIds:            []int{},
			SmartAddedLimit:              20,
			RowTagsMax:                   2,
			FaviconRefreshPolicy:         "on-save",
			OnboardingCompleted:          false,
			ConfigBookmarksSort:          defaultConfigBookmarksSort,
			ConfigBookmarksPageSize:      defaultConfigBookmarksPageSize,
			BookmarkDeleteConfirmFrom:    defaultBookmarkDeleteConfirmFrom,
			DefaultMonitorIntervalMin:    defaultMonitorIntervalMinutes,
			NewBookmarkCheckMode:         defaultNewBookmarkCheckMode,
			BookmarkStaleDays:            defaultBookmarkStaleDays,
			BookmarkArchiveUrl:           defaultBookmarkArchiveUrl,
			ThemeIconStyling:             defaultThemeIconStyling(),
			PackedColumns:                true,
			DefaultCategorySpread:        false,
			CategorySpreadResetScope:     defaultCategorySpreadResetScope,
			// Was omitted here while both other Settings constructions set it,
			// so a fresh install was served "" for a field whose documented
			// default is "none". Harmless to the rendering, which treats an
			// empty value as none, but it made the setting permanently unequal
			// to its own default — so config offered a reset for it on an
			// install nobody had touched.
			BackgroundType:                 "none",
			LauncherIconSize:               "normal",
			ButtonBarPosition:              "bottom-right",
			ShowDockLayoutSelector:         true,
			PasteUrlQuickAdd:               true,
			InboxEnabled:                   true,
			PasteDestination:               "ask",
			InboxDedupeUrls:                true,
			InboxMaxItems:                  500,
			InboxShowInPageTabs:            true,
			InboxDeleteAfterPromote:        true,
			AllowLocalBookmarks:            true,
			AutoBackupEnabled:              true,
			HealthAutoRecheckEnabled:       false,
			HealthAutoRecheckIntervalHours: defaultHealthAutoRecheckIntervalHours,
			// Set explicitly rather than left to the clamp, which would normalise
			// them on read anyway: a stored 0 / "" reads as a setting nobody
			// chose, and config compares against the documented default.
			ServerLogRetentionMode: serverLogModeTime,
			ServerLogMaxEntries:    serverLogDefaultMaxEntries,
			UpdateCheckEnabled:     true,
		}
		data, _ := json.MarshalIndent(defaultSettings, "", "  ")
		writeFileAtomic(fs.settingsFile, data, 0644)
	}

	// Initialize default finders if file doesn't exist
	findersFile := fmt.Sprintf("%s/finders.json", fs.dataDir)
	if _, err := os.Stat(findersFile); os.IsNotExist(err) {
		defaultFinders := []Finder{
			{Name: "DuckDuckGo", SearchUrl: "https://duckduckgo.com/?q=%s", Shortcut: "du"},
		}
		data, _ := json.MarshalIndent(defaultFinders, "", "  ")
		writeFileAtomic(findersFile, data, 0644)
	}

	// Initialize inbox if file doesn't exist
	inboxFile := inboxFilePath(fs.dataDir)
	if _, err := os.Stat(inboxFile); os.IsNotExist(err) {
		defaultInbox := InboxData{Version: inboxDataVersion, Items: []InboxLink{}}
		data, _ := json.MarshalIndent(defaultInbox, "", "  ")
		writeFileAtomic(inboxFile, data, 0644)
	}

	// Initialize colors if file doesn't exist
	if _, err := os.Stat(fs.colorsFile); os.IsNotExist(err) {
		defaultColors := getDefaultColors()
		data, _ := json.MarshalIndent(defaultColors, "", "  ")
		writeFileAtomic(fs.colorsFile, data, 0644)
	}

	// One-time migration: remove existing custom themes and reset active custom theme to dark.
	fs.migrateCustomThemesToUserManaged()
	fs.migrateLinkPreviewCardsDefaultOff()
	fs.migrateShortcutTooltipsDefaultOff()
	fs.migrateShortcutOpenModeDefaultInstant()
	fs.migrateHideEmptyCategoriesDefaultOn()
	fs.migrateConfigButtonDefaultOn()

}

func (fs *FileStore) migrateCustomThemesToUserManaged() {
	if _, err := os.Stat(fs.customThemesMigrationMarker); err == nil {
		return
	}

	colors := fs.GetColors()
	colors.Custom = map[string]ThemeColors{}
	if err := fs.SaveColors(colors); err != nil {
		return
	}

	settings := fs.GetSettings()
	settings.Theme = normalizeLegacyThemeID(settings.Theme)
	if !fs.isValidThemeIDFor(settings.Theme) {
		settings.Theme = defaultThemeID
		if err := fs.SaveSettings(settings); err != nil {
			return
		}
	}

	_ = writeFileAtomic(fs.customThemesMigrationMarker, []byte("migrated"), 0644)
}

func (fs *FileStore) migrateLinkPreviewCardsDefaultOff() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if migrated, ok := raw["linkPreviewCardsOffMigrated"]; ok {
		var done bool
		if json.Unmarshal(migrated, &done) == nil && done {
			return
		}
	}
	// An install created since link previews grew a mode has already answered
	// this question — with "hover", the default it was installed with. Without
	// this check the migration would switch the cards off on every new install
	// the first time it starts.
	if _, ok := raw["linkPreviewMode"]; ok {
		raw["linkPreviewCardsOffMigrated"] = json.RawMessage(`true`)
		if out, err := json.MarshalIndent(raw, "", "  "); err == nil {
			_ = writeFileAtomic(fs.settingsFile, out, 0644)
		}
		return
	}

	raw["showLinkPreviewCards"] = json.RawMessage(`false`)
	raw["linkPreviewMode"] = json.RawMessage(`"off"`)
	raw["linkPreviewCardsOffMigrated"] = json.RawMessage(`true`)

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return
	}
	_ = writeFileAtomic(fs.settingsFile, out, 0644)
}

// migrateShortcutTooltipsDefaultOff turns the toolbar shortcut hints off once,
// for everyone.
//
// Unlike the fresh-install defaults changed elsewhere, this one reaches
// existing dashboards on purpose: the setting has been on since it existed and
// is written into every stored settings file, so a default change alone would
// have left every current install exactly as it was.
//
// The marker is what keeps it a one-time event. Without it the flip would run
// on every start and nobody could ever switch the hints back on — which is the
// difference between changing a default and taking a choice away.
func (fs *FileStore) migrateShortcutTooltipsDefaultOff() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if migrated, ok := raw["shortcutTooltipsOffMigrated"]; ok {
		var done bool
		if json.Unmarshal(migrated, &done) == nil && done {
			return
		}
	}

	raw["showShortcutTooltips"] = json.RawMessage(`false`)
	raw["shortcutTooltipsOffMigrated"] = json.RawMessage(`true`)

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return
	}
	_ = writeFileAtomic(fs.settingsFile, out, 0644)
}

// migrateShortcutOpenModeDefaultInstant undoes v1.2.0's "Enter opens" default,
// once, for everyone still carrying it.
//
// v1.2.0 made typing stop opening anything: the list narrowed and Enter opened
// the top result. It was defensible on paper and wrong in the hand — a shortcut
// is a shortcut, and asking for a second key to finish it takes away the reason
// to have one. The default is "instant" again.
//
// A default change alone would reach nobody: the field is written into every
// settings file v1.2.0 touched. So installs still on "enter" — the value nobody
// chose, because it arrived as the default — are moved over. "delay" is left
// exactly as it is: that one can only be there because someone picked it.
//
// The marker keeps it a one-time event. Without it, anyone who preferred Enter
// and set it back would have it taken away again on the next restart, which is
// the difference between changing a default and removing a choice.
func (fs *FileStore) migrateShortcutOpenModeDefaultInstant() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if migrated, ok := raw["shortcutOpenModeInstantMigrated"]; ok {
		var done bool
		if json.Unmarshal(migrated, &done) == nil && done {
			return
		}
	}

	mode := ""
	if stored, ok := raw["shortcutOpenMode"]; ok {
		_ = json.Unmarshal(stored, &mode)
	}
	if mode == "" || mode == "enter" {
		raw["shortcutOpenMode"] = json.RawMessage(`"instant"`)
	}
	raw["shortcutOpenModeInstantMigrated"] = json.RawMessage(`true`)

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return
	}
	_ = writeFileAtomic(fs.settingsFile, out, 0644)
}

func (fs *FileStore) migrateHideEmptyCategoriesDefaultOn() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if migrated, ok := raw["hideEmptyCategoriesMigrated"]; ok {
		var done bool
		if json.Unmarshal(migrated, &done) == nil && done {
			return
		}
	}

	raw["hideEmptyCategories"] = json.RawMessage(`true`)
	raw["hideEmptyCategoriesMigrated"] = json.RawMessage(`true`)

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return
	}
	_ = writeFileAtomic(fs.settingsFile, out, 0644)
}

// One-time: turn the config header icon back on for existing installs. A broken
// hide selector and a DOM-removal bug could leave the button missing even when
// users wanted it; this migration resets visibility once on upgrade. Users can
// still turn it off afterwards in Config → Essentials.
func (fs *FileStore) migrateConfigButtonDefaultOn() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		return
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return
	}
	if migrated, ok := raw["configButtonDefaultOnMigrated"]; ok {
		var done bool
		if json.Unmarshal(migrated, &done) == nil && done {
			return
		}
	}

	raw["showConfigButton"] = json.RawMessage(`true`)
	raw["configButtonDefaultOnMigrated"] = json.RawMessage(`true`)

	out, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return
	}
	_ = writeFileAtomic(fs.settingsFile, out, 0644)
	fs.readCache.settingsOK = false
}

func (fs *FileStore) ensureDataDir() {
	os.MkdirAll(fs.dataDir, 0755)
}

// getDefaultNewPageCategories returns the default categories for a newly created page
func getDefaultNewPageCategories() []Category {
	return []Category{
		{ID: "others", Name: "dashboard.others"},
	}
}

func bookmarksReferenceCategories(bookmarks []Bookmark) bool {
	for _, bookmark := range bookmarks {
		if strings.TrimSpace(bookmark.Category) != "" {
			return true
		}
	}
	return false
}

func rebuildCategoriesFromBookmarkRefs(bookmarks []Bookmark) []Category {
	if !bookmarksReferenceCategories(bookmarks) {
		return nil
	}
	seen := make(map[string]struct{})
	out := make([]Category, 0)
	for _, bookmark := range bookmarks {
		id := strings.TrimSpace(bookmark.Category)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, Category{
			ID:         id,
			OriginalID: id,
			Name:       formatRecoveredCategoryName(id),
		})
	}
	return out
}

func formatRecoveredCategoryName(categoryID string) string {
	slug := strings.TrimSpace(categoryID)
	if slug == "" {
		return "Category"
	}
	if strings.HasPrefix(slug, "cat_") {
		name := strings.ReplaceAll(strings.TrimPrefix(slug, "cat_"), "_", " ")
		if name == "" {
			return slug
		}
		return name
	}
	return strings.ReplaceAll(strings.ReplaceAll(slug, "-", " "), "_", " ")
}

func (fs *FileStore) GetBookmarksByPage(pageID int) []Bookmark {
	fs.mutex.RLock()
	if cached, ok := fs.readCache.bookmarks[pageID]; ok {
		out := cloneBookmarks(cached)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	if cached, ok := fs.readCache.bookmarks[pageID]; ok {
		return cloneBookmarks(cached)
	}

	fs.ensureReadCacheMaps()
	fs.ensureDataDir()

	// Read directly from bookmarks-{pageID}.json
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		fs.readCache.bookmarks[pageID] = []Bookmark{}
		return []Bookmark{}
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		fs.readCache.bookmarks[pageID] = []Bookmark{}
		return []Bookmark{}
	}

	if pageWithBookmarks.Bookmarks == nil {
		fs.readCache.bookmarks[pageID] = []Bookmark{}
		return []Bookmark{}
	}
	for i := range pageWithBookmarks.Bookmarks {
		pageWithBookmarks.Bookmarks[i].PageID = pageID
	}

	fs.readCache.bookmarks[pageID] = cloneBookmarks(pageWithBookmarks.Bookmarks)
	return cloneBookmarks(pageWithBookmarks.Bookmarks)
}

func (fs *FileStore) readPageWithBookmarksLocked(pageID int) (PageWithBookmarks, error) {
	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return PageWithBookmarks{}, ErrBookmarkNotFound
		}
		return PageWithBookmarks{}, err
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return PageWithBookmarks{}, fmt.Errorf("decode bookmarks page %d: %w", pageID, err)
	}
	return pageWithBookmarks, nil
}

func (fs *FileStore) writePageWithBookmarksLocked(pageID int, pageWithBookmarks PageWithBookmarks) error {
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	for i := range pageWithBookmarks.Bookmarks {
		pageWithBookmarks.Bookmarks[i].PageID = pageID
	}
	return fs.writeStoreJSONFile(filePath, pageWithBookmarks, pageID)
}

func (fs *FileStore) TrackBookmarkOpen(pageID int, index int) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	pageWithBookmarks, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(pageWithBookmarks.Bookmarks) {
		return ErrBookmarkNotFound
	}

	pageWithBookmarks.Bookmarks[index].OpenCount++
	pageWithBookmarks.Bookmarks[index].LastOpened = time.Now().UnixMilli()

	return fs.writePageWithBookmarksLocked(pageID, pageWithBookmarks)
}

func (fs *FileStore) MutateBookmarkAt(pageID int, index int, mutate func(*Bookmark) error) error {
	if mutate == nil {
		return fmt.Errorf("bookmark mutate callback is required")
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	pageWithBookmarks, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(pageWithBookmarks.Bookmarks) {
		return ErrBookmarkNotFound
	}

	if err := mutate(&pageWithBookmarks.Bookmarks[index]); err != nil {
		return err
	}

	return fs.writePageWithBookmarksLocked(pageID, pageWithBookmarks)
}

func (fs *FileStore) MutateBookmarksOnPage(pageID int, mutate func([]Bookmark) ([]Bookmark, error)) error {
	if mutate == nil {
		return fmt.Errorf("bookmarks mutate callback is required")
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	pageWithBookmarks, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return err
	}

	updated, err := mutate(pageWithBookmarks.Bookmarks)
	if err != nil {
		return err
	}

	pageWithBookmarks.Bookmarks = updated
	return fs.writePageWithBookmarksLocked(pageID, pageWithBookmarks)
}

func (fs *FileStore) DeleteBookmarkAt(pageID int, index int) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	pageWithBookmarks, err := fs.readPageWithBookmarksLocked(pageID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(pageWithBookmarks.Bookmarks) {
		return ErrBookmarkNotFound
	}

	pageWithBookmarks.Bookmarks = append(
		pageWithBookmarks.Bookmarks[:index],
		pageWithBookmarks.Bookmarks[index+1:]...,
	)
	return fs.writePageWithBookmarksLocked(pageID, pageWithBookmarks)
}

func (fs *FileStore) saveBookmarksByPageLocked(pageID int, bookmarks []Bookmark) error {
	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	for i := range bookmarks {
		bookmarks[i].PageID = pageID
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: getDefaultNewPageCategories(),
			Bookmarks:  bookmarks,
		}
		// A new bookmarks-N.json file changes what GetPages() reports (its
		// list is filename-driven — see getPages), so this is not a
		// single-page-scoped write even though it only touches one page's file.
		return fs.writeStoreJSONFile(filePath, pageWithBookmarks, 0)
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return fmt.Errorf("decode bookmarks page %d: %w", pageID, err)
	}

	stampBookmarkUpdatedAt(pageWithBookmarks.Bookmarks, bookmarks, time.Now().UnixMilli())
	pageWithBookmarks.Bookmarks = bookmarks
	return fs.writeStoreJSONFile(filePath, pageWithBookmarks, pageID)
}

// stampBookmarkUpdatedAt sets UpdatedAt on every bookmark in next whose content
// differs from the matching bookmark in prev.
//
// Matching is by canonical URL, which is also the identity the rest of the store
// uses. A bookmark whose URL itself changed therefore looks new here and is
// stamped — correct, since editing the URL is a content change.
//
// Only the fields a person edits are compared (bookmarkContentFingerprint), so
// a health check writing LastChecked or an open bumping OpenCount does not count
// as a change. Without that the field would be worthless: every monitored
// bookmark would claim to have been edited on every ping.
//
// An unchanged bookmark keeps whatever UpdatedAt it already had, so callers that
// rewrite a whole page (a reorder, a bulk tag) do not restamp the rest.
func stampBookmarkUpdatedAt(prev, next []Bookmark, now int64) {
	previous := make(map[string]Bookmark, len(prev))
	for _, bm := range prev {
		key := canonicalBookmarkURLKey(bm.URL)
		if key == "" {
			continue
		}
		previous[key] = bm
	}

	for i := range next {
		key := canonicalBookmarkURLKey(next[i].URL)
		old, existed := previous[key]
		if !existed {
			// New to this page: created and moved bookmarks both land here, and
			// CreatedAt already distinguishes them.
			if next[i].UpdatedAt == 0 {
				next[i].UpdatedAt = now
			}
			continue
		}
		// Carry the stored stamp forward: clients round-trip bookmarks without
		// it, so trusting the incoming value would silently clear the history.
		next[i].UpdatedAt = old.UpdatedAt
		if bookmarkContentFingerprint(old) != bookmarkContentFingerprint(next[i]) {
			next[i].UpdatedAt = now
		}
	}
}

func (fs *FileStore) SaveBookmarksByPage(pageID int, bookmarks []Bookmark) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	return fs.saveBookmarksByPageLocked(pageID, bookmarks)
}

func (fs *FileStore) SaveBookmarkPageUpdates(updates map[int][]Bookmark) error {
	if len(updates) == 0 {
		return nil
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	for pageID, bookmarks := range updates {
		if err := fs.saveBookmarksByPageLocked(pageID, bookmarks); err != nil {
			return err
		}
	}
	return nil
}

// DeleteAllBookmarks empties every page's bookmark list while preserving pages,
// categories, finders, and settings. No default bookmarks are recreated.
func (fs *FileStore) DeleteAllBookmarks() error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return err
	}

	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}
		pageID, ok := parseBookmarkPageIDFromFilename(file.Name())
		if !ok {
			continue
		}
		if err := fs.saveBookmarksByPageLocked(pageID, []Bookmark{}); err != nil {
			return err
		}
	}

	return nil
}

func (fs *FileStore) AddBookmarkToPage(pageID int, bookmark Bookmark) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		bookmark.PageID = pageID
		if bookmark.UpdatedAt == 0 {
			bookmark.UpdatedAt = time.Now().UnixMilli()
		}
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: getDefaultNewPageCategories(),
			Bookmarks:  []Bookmark{bookmark},
		}
		// New bookmarks-N.json file — see the same note in
		// saveBookmarksByPageLocked.
		return fs.writeStoreJSONFile(filePath, pageWithBookmarks, 0)
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return fmt.Errorf("decode bookmarks page %d: %w", pageID, err)
	}

	bookmark.PageID = pageID
	if bookmark.UpdatedAt == 0 {
		bookmark.UpdatedAt = time.Now().UnixMilli()
	}
	pageWithBookmarks.Bookmarks = append(pageWithBookmarks.Bookmarks, bookmark)
	return fs.writeStoreJSONFile(filePath, pageWithBookmarks, pageID)
}

func (fs *FileStore) DeleteBookmarkFromPage(pageID int, bookmarkToDelete Bookmark) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Read the existing page data
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrBookmarkNotFound
		}
		return err
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return err
	}

	updated, removed := fs.removeBookmarkFromSlice(pageWithBookmarks.Bookmarks, bookmarkToDelete)
	if !removed {
		return ErrBookmarkNotFound
	}
	pageWithBookmarks.Bookmarks = updated

	return fs.writeStoreJSONFile(filePath, pageWithBookmarks, pageID)
}

func (fs *FileStore) removeBookmarkFromSlice(bookmarks []Bookmark, toDelete Bookmark) ([]Bookmark, bool) {
	deleteKey := canonicalBookmarkURLKey(toDelete.URL)
	deleteName := strings.TrimSpace(toDelete.Name)
	result := make([]Bookmark, 0, len(bookmarks))
	removed := false
	for _, b := range bookmarks {
		if removed {
			result = append(result, b)
			continue
		}
		matched := false
		if deleteKey != "" {
			matched = canonicalBookmarkURLKey(b.URL) == deleteKey
		} else if deleteName != "" {
			matched = strings.TrimSpace(b.Name) == deleteName
		}
		if matched {
			removed = true
			continue
		}
		result = append(result, b)
	}
	return result, removed
}

func (fs *FileStore) GetAllBookmarks() []Bookmark {
	fs.mutex.RLock()
	if fs.readCache.allBookmarksOK {
		out := cloneBookmarks(fs.readCache.allBookmarks)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.allBookmarksOK {
		return cloneBookmarks(fs.readCache.allBookmarks)
	}

	fs.ensureDataDir()

	var allBookmarks []Bookmark

	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		fs.readCache.allBookmarks = []Bookmark{}
		fs.readCache.allBookmarksOK = true
		return []Bookmark{}
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

	fs.readCache.allBookmarks = cloneBookmarks(allBookmarks)
	fs.readCache.allBookmarksOK = true
	return cloneBookmarks(allBookmarks)
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

		wantKey := canonicalBookmarkURLKey(urlParam)
		if wantKey == "" {
			return false
		}
		for i := range pageWithBookmarks.Bookmarks {
			if canonicalBookmarkURLKey(pageWithBookmarks.Bookmarks[i].URL) == wantKey {
				return true
			}
		}
	}

	return false
}

func (fs *FileStore) GetFinders() []Finder {
	fs.mutex.RLock()
	if fs.readCache.findersOK {
		out := cloneFinders(fs.readCache.finders)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.findersOK {
		return cloneFinders(fs.readCache.finders)
	}

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/finders.json", fs.dataDir)
	data, err := os.ReadFile(filePath)
	if err != nil {
		fs.readCache.finders = []Finder{}
		fs.readCache.findersOK = true
		return []Finder{}
	}

	var finders []Finder
	if err := json.Unmarshal(data, &finders); err != nil {
		fs.readCache.finders = []Finder{}
		fs.readCache.findersOK = true
		return []Finder{}
	}

	fs.readCache.finders = cloneFinders(finders)
	fs.readCache.findersOK = true
	return cloneFinders(finders)
}

func (fs *FileStore) SaveFinders(finders []Finder) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Names arrive unvalidated: nothing trimmed or capped them, so a finder
	// could be stored with an empty or 500-character name.
	for i := range finders {
		finders[i].Name = clampEntityName(finders[i].Name)
	}

	filePath := fmt.Sprintf("%s/finders.json", fs.dataDir)
	return fs.writeStoreJSONFile(filePath, finders, 0)
}

// GetCategoriesByPage returns categories stored inside bookmarks-{pageID}.json if present
func (fs *FileStore) GetCategoriesByPage(pageID int) []Category {
	fs.mutex.RLock()
	if cached, ok := fs.readCache.categories[pageID]; ok {
		out := cloneCategories(cached)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if cached, ok := fs.readCache.categories[pageID]; ok {
		return cloneCategories(cached)
	}

	fs.ensureReadCacheMaps()
	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		fs.readCache.categories[pageID] = []Category{}
		return []Category{}
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		fs.readCache.categories[pageID] = []Category{}
		return []Category{}
	}

	var categories []Category
	if len(pageWithBookmarks.Categories) == 0 {
		if recovered := rebuildCategoriesFromBookmarkRefs(pageWithBookmarks.Bookmarks); len(recovered) > 0 {
			categories = recovered
		} else {
			categories = []Category{}
		}
	} else {
		categories = pageWithBookmarks.Categories
	}
	fs.readCache.categories[pageID] = cloneCategories(categories)
	return cloneCategories(categories)
}

// SaveCategoriesByPage saves categories inside bookmarks-{pageID}.json, creating the file if needed
// It also updates bookmarks to use the new category IDs when category names change
func (fs *FileStore) SaveCategoriesByPage(pageID int, categories []Category) error {
	for i := range categories {
		categories[i].Name = clampEntityName(categories[i].Name)
	}
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if !os.IsNotExist(err) {
			return err
		}
		pageWithBookmarks := PageWithBookmarks{
			Page: Page{
				ID:   pageID,
				Name: fmt.Sprintf("Page %d", pageID),
			},
			Categories: categories,
			Bookmarks:  []Bookmark{},
		}
		// New bookmarks-N.json file — see the same note in
		// saveBookmarksByPageLocked.
		return fs.writeStoreJSONFile(filePath, pageWithBookmarks, 0)
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return fmt.Errorf("decode bookmarks page %d: %w", pageID, err)
	}

	if len(categories) == 0 && bookmarksReferenceCategories(pageWithBookmarks.Bookmarks) {
		return ErrCategoriesStillReferenced
	}

	oldToNewCategoryMap := buildCategoryRemap(categories)

	// Update bookmarks to use new category IDs
	for i := range pageWithBookmarks.Bookmarks {
		oldCategoryID := pageWithBookmarks.Bookmarks[i].Category
		if newCategoryID, exists := oldToNewCategoryMap[oldCategoryID]; exists {
			pageWithBookmarks.Bookmarks[i].Category = newCategoryID
		}
	}

	pageWithBookmarks.Categories = categories
	return fs.writeStoreJSONFile(filePath, pageWithBookmarks, pageID)
}

// buildCategoryRemap maps old category IDs to the IDs they become.
//
// Built from originalId. Every known client sends it on every category (see
// dashboard-persistence.js, dashboard-render-core.js,
// dashboard-category-sort.js), so it is the only reliable signal for "this new
// entry replaces that old one". A positional fallback was tried here before and
// misfired: dropping a middle category shifts every later index by one, so
// category N's bookmarks would be silently reassigned to category N+1's new ID.
// If a category is genuinely unchanged (id kept as is) it needs no mapping at
// all — its bookmarks already point at the right ID — so the only remaining
// safe fallback is "same ID in and out".
//
// Shared with PreviewCategoriesByPage rather than duplicated there: a preview
// that computed the outcome its own way would eventually disagree with the save
// it is supposed to be predicting, which is the one thing a dry-run may not do.
func buildCategoryRemap(categories []Category) map[string]string {
	remap := make(map[string]string, len(categories))
	for _, newCat := range categories {
		if newCat.OriginalID != "" {
			remap[newCat.OriginalID] = newCat.ID
			continue
		}
		remap[newCat.ID] = newCat.ID
	}
	return remap
}

// CategoryRemapMove is one bookmark that a category save would move, named so
// the client can show which rows are affected rather than only how many.
type CategoryRemapMove struct {
	BookmarkName string `json:"bookmarkName"`
	URL          string `json:"url"`
	FromCategory string `json:"fromCategory"`
	ToCategory   string `json:"toCategory"`
}

// CategoryRemapPreview is what SaveCategoriesByPage would do, without doing it.
type CategoryRemapPreview struct {
	PageID int `json:"pageId"`
	// Moved lists bookmarks whose category id would change.
	Moved []CategoryRemapMove `json:"moved"`
	// Orphaned lists bookmarks whose category would survive the save pointing
	// at an id that no longer exists — the case that makes this preview worth
	// having, since the save reports nothing about it and the dashboard renders
	// the result identically to "uncategorized".
	Orphaned []CategoryRemapMove `json:"orphaned"`
	// MissingOriginalID names categories submitted without an originalId whose
	// id is not among the current ones. The remap can only treat those as new,
	// so if one was meant as a rename its bookmarks are left behind.
	MissingOriginalID []string `json:"missingOriginalId"`
	// Rejected is set when the save would fail outright rather than apply, with
	// Reason carrying the sentinel's name.
	Rejected bool   `json:"rejected"`
	Reason   string `json:"reason,omitempty"`
}

// PreviewCategoriesByPage reports what SaveCategoriesByPage would change.
//
// The remap is driven by originalId, which is fragile in a specific way: a
// client that omits it on a renamed category gets a silent no-op — the save
// succeeds, the category list updates, and the bookmarks are quietly left
// pointing at an id that no longer exists. Nothing in the response says so.
// This computes the same outcome through the same helper, so a caller can show
// the damage before committing to it.
func (fs *FileStore) PreviewCategoriesByPage(pageID int, categories []Category) (CategoryRemapPreview, error) {
	fs.mutex.RLock()
	defer fs.mutex.RUnlock()

	preview := CategoryRemapPreview{
		PageID:            pageID,
		Moved:             []CategoryRemapMove{},
		Orphaned:          []CategoryRemapMove{},
		MissingOriginalID: []string{},
	}

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			// A save here creates the page with these categories and no
			// bookmarks, so there is nothing to remap and nothing to warn about.
			return preview, nil
		}
		return preview, err
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return preview, fmt.Errorf("decode bookmarks page %d: %w", pageID, err)
	}

	// Mirrors the guard in SaveCategoriesByPage: a preview that promised a
	// clean apply for a save that will be refused would be worse than none.
	if len(categories) == 0 && bookmarksReferenceCategories(pageWithBookmarks.Bookmarks) {
		preview.Rejected = true
		preview.Reason = "categories_still_referenced"
		return preview, nil
	}

	remap := buildCategoryRemap(categories)

	currentIDs := make(map[string]struct{}, len(pageWithBookmarks.Categories))
	for _, category := range pageWithBookmarks.Categories {
		if id := strings.TrimSpace(category.ID); id != "" {
			currentIDs[id] = struct{}{}
		}
	}
	for _, category := range categories {
		if category.OriginalID != "" {
			continue
		}
		if _, known := currentIDs[category.ID]; !known {
			preview.MissingOriginalID = append(preview.MissingOriginalID, category.ID)
		}
	}

	survivingIDs := make(map[string]struct{}, len(categories))
	for _, category := range categories {
		if id := strings.TrimSpace(category.ID); id != "" {
			survivingIDs[id] = struct{}{}
		}
	}

	for _, bookmark := range pageWithBookmarks.Bookmarks {
		from := strings.TrimSpace(bookmark.Category)
		if from == "" {
			continue
		}
		to := from
		if mapped, exists := remap[from]; exists {
			to = mapped
		}
		move := CategoryRemapMove{
			BookmarkName: bookmark.Name,
			URL:          bookmark.URL,
			FromCategory: from,
			ToCategory:   to,
		}
		if to != from {
			preview.Moved = append(preview.Moved, move)
		}
		if _, survives := survivingIDs[to]; !survives {
			preview.Orphaned = append(preview.Orphaned, move)
		}
	}

	return preview, nil
}

func (fs *FileStore) GetPages() []Page {
	fs.mutex.RLock()
	if fs.readCache.pagesOK {
		out := clonePages(fs.readCache.pages)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.pagesOK {
		return clonePages(fs.readCache.pages)
	}

	pages := fs.getPages()
	fs.readCache.pages = clonePages(pages)
	fs.readCache.pagesOK = true
	return clonePages(pages)
}

func (fs *FileStore) getPages() []Page {
	fs.ensureDataDir()

	var pages []Page

	// Read all bookmarks files in data directory
	files, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return []Page{{ID: 1, Name: "main"}}
	}

	// First, collect all pages from bookmark files (filename id is authoritative)
	pageMap := make(map[int]Page)
	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "bookmarks-") || !strings.HasSuffix(file.Name(), ".json") {
			continue
		}

		fileID, ok := parseBookmarkPageIDFromFilename(file.Name())
		if !ok {
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

		pageMap[fileID] = normalizePageMeta(pageWithBookmarks.Page, fileID)
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
		// Save the default order (best effort during read path)
		_ = fs.savePageOrder(order)
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

	return finalizePagesList(pages, pageMap)
}

func parseBookmarkPageIDFromFilename(name string) (int, bool) {
	if !strings.HasPrefix(name, "bookmarks-") || !strings.HasSuffix(name, ".json") {
		return 0, false
	}
	idStr := strings.TrimSuffix(strings.TrimPrefix(name, "bookmarks-"), ".json")
	id, err := strconv.Atoi(idStr)
	if err != nil || id < 1 {
		return 0, false
	}
	return id, true
}

func defaultPageName(id int) string {
	if id == 1 {
		return "main"
	}
	return fmt.Sprintf("Page %d", id)
}

// Defaults for the Config → Bookmarks settings. Kept together so the two
// default blocks below and the clamps in SaveSettings cannot drift apart.
const (
	defaultConfigBookmarksSort       = "page"
	defaultConfigBookmarksPageSize   = 50
	defaultBookmarkDeleteConfirmFrom = 1
	defaultNewBookmarkCheckMode      = "off"
	defaultBookmarkStaleDays         = 90
	defaultBookmarkArchiveUrl        = "https://web.archive.org/web/*/{url}"
	defaultCategorySpreadResetScope  = "page"
)

// categorySpreadResetScopes are the reaches "turn spreading off" offers.
var categorySpreadResetScopes = map[string]bool{"page": true, "all": true}

// configBookmarksSortModes are the orders the Config bookmark list can open on.
var configBookmarksSortModes = map[string]bool{
	"page": true, "name": true, "url": true, "category": true,
	"recent": true, "lastOpened": true, "opens": true, "pinned": true,
}

// newBookmarkCheckModes mirrors the availability modes CheckMode understands.
var newBookmarkCheckModes = map[string]bool{"off": true, "periodic": true, "monitor": true}

// clampCategoryLayoutSettings keeps the spread settings inside what the
// controls offer, and drops entries that carry no switch.
//
// The map holds the switch for categories that have no stored Category record —
// uncategorized and the smart collections — keyed page id, then category id, the
// same shape CategorySortModes uses. Without the pruning below it would grow an
// entry per category the user ever touched, including the ones they turned back
// off.
func clampCategoryLayoutSettings(s *Settings) {
	if !categorySpreadResetScopes[s.CategorySpreadResetScope] {
		s.CategorySpreadResetScope = defaultCategorySpreadResetScope
	}
	if s.CategorySpreads == nil {
		return
	}
	for pageKey, spreads := range s.CategorySpreads {
		for categoryID, on := range spreads {
			if !on {
				delete(spreads, categoryID)
			}
		}
		if len(spreads) == 0 {
			delete(s.CategorySpreads, pageKey)
		}
	}
	if len(s.CategorySpreads) == 0 {
		s.CategorySpreads = nil
	}
}

// clampBookmarkSettings keeps the Config → Bookmarks settings inside the range
// their controls offer. The API is reachable without the browser, and a value
// outside the range would otherwise be stored and then silently ignored by the
// code that reads it — which is exactly the "said Saved, did nothing" shape
// these settings were added to avoid.
func clampBookmarkSettings(s *Settings) {
	if !configBookmarksSortModes[s.ConfigBookmarksSort] {
		s.ConfigBookmarksSort = defaultConfigBookmarksSort
	}
	if s.ConfigBookmarksPageSize < 10 {
		s.ConfigBookmarksPageSize = 10
	}
	if s.ConfigBookmarksPageSize > 500 {
		s.ConfigBookmarksPageSize = 500
	}
	if s.BookmarkDeleteConfirmFrom < 1 {
		s.BookmarkDeleteConfirmFrom = 1
	}
	if s.DefaultMonitorIntervalMin < minMonitorIntervalMinutes {
		s.DefaultMonitorIntervalMin = minMonitorIntervalMinutes
	}
	if s.DefaultMonitorIntervalMin > maxMonitorIntervalMinutes {
		s.DefaultMonitorIntervalMin = maxMonitorIntervalMinutes
	}
	if !newBookmarkCheckModes[s.NewBookmarkCheckMode] {
		s.NewBookmarkCheckMode = defaultNewBookmarkCheckMode
	}
	if s.BookmarkStaleDays < 7 {
		s.BookmarkStaleDays = 7
	}
	if s.BookmarkStaleDays > 365 {
		s.BookmarkStaleDays = 365
	}
	// 0 stays 0: it means "the built-in default", which is what an install that
	// never chose an interval has. Anything else is held between daily and
	// monthly — a backup less often than that is not a safety net, and more
	// often than daily fills the rotation within a day.
	if s.AutoBackupIntervalDays != 0 {
		if s.AutoBackupIntervalDays < 1 {
			s.AutoBackupIntervalDays = 1
		}
		if s.AutoBackupIntervalDays > 30 {
			s.AutoBackupIntervalDays = 30
		}
	}
	if s.RowTagsMax < 1 {
		s.RowTagsMax = 1
	}
	if s.RowTagsMax > 5 {
		s.RowTagsMax = 5
	}
	if s.BulkFaviconConfirmFrom < 0 {
		s.BulkFaviconConfirmFrom = 0
	}
	s.BookmarkArchiveUrl = strings.TrimSpace(s.BookmarkArchiveUrl)
	// Must be a template that can carry the address, and must not be a
	// javascript: or data: URL — this string is handed to window.open.
	if !strings.Contains(s.BookmarkArchiveUrl, "{url}") || !strings.HasPrefix(s.BookmarkArchiveUrl, "http") {
		s.BookmarkArchiveUrl = defaultBookmarkArchiveUrl
	}
}

// NameMaxLength caps a page, category, finder, theme or collection name.
// Mirrors DashboardConfig.NAME_MAX_LENGTH: the browser is where the limit is
// explained, this is where it is enforced, since the API is reachable without
// it (the extension, a script, a second client).
const NameMaxLength = 60

// clampEntityName trims a user-entered name and cuts it to NameMaxLength.
// Rune-wise via truncateRunes, so a name ending in a multi-byte character is
// not cut mid-character.
func clampEntityName(name string) string {
	return truncateRunes(strings.TrimSpace(name), NameMaxLength)
}

func normalizePageMeta(page Page, fileID int) Page {
	page.ID = fileID
	page.Name = clampEntityName(page.Name)
	if page.Name == "" {
		page.Name = defaultPageName(fileID)
	}
	return page
}

func finalizePagesList(pages []Page, pageMap map[int]Page) []Page {
	normalized := make([]Page, 0, len(pages))
	seen := make(map[int]bool)
	for _, page := range pages {
		if seen[page.ID] {
			continue
		}
		seen[page.ID] = true
		normalized = append(normalized, normalizePageMeta(page, page.ID))
	}

	hasMain := false
	for _, page := range normalized {
		if page.ID == 1 {
			hasMain = true
			break
		}
	}
	if !hasMain {
		if page, ok := pageMap[1]; ok {
			normalized = append([]Page{normalizePageMeta(page, 1)}, normalized...)
		} else {
			normalized = append([]Page{{ID: 1, Name: "main"}}, normalized...)
		}
	}

	if len(normalized) == 0 {
		return []Page{{ID: 1, Name: "main"}}
	}
	return normalized
}

func (fs *FileStore) GetPageOrder() []int {
	fs.mutex.RLock()
	if fs.readCache.pageOrderOK {
		out := clonePageOrder(fs.readCache.pageOrder)
		fs.mutex.RUnlock()
		return out
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.pageOrderOK {
		return clonePageOrder(fs.readCache.pageOrder)
	}

	order := fs.getPageOrder()
	fs.readCache.pageOrder = clonePageOrder(order)
	fs.readCache.pageOrderOK = true
	return clonePageOrder(order)
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

func (fs *FileStore) SavePageOrder(order []int) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	return fs.savePageOrder(order)
}

func (fs *FileStore) savePageOrder(order []int) error {
	fs.ensureDataDir()

	pageOrder := PageOrder{
		Order: order,
	}

	return fs.writeStoreJSONFile(fs.pageOrderFile, pageOrder, 0)
}

func (fs *FileStore) SavePage(page Page) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()
	// The page ID IS the file number; preserve bookmarks/categories already on disk.
	fileName := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, page.ID)

	var existing PageWithBookmarks
	if data, err := os.ReadFile(fileName); err == nil {
		if err := json.Unmarshal(data, &existing); err != nil {
			return fmt.Errorf("decode bookmarks page %d: %w", page.ID, err)
		}
	}

	existing.Page = page
	if existing.Bookmarks == nil {
		existing.Bookmarks = []Bookmark{}
	}
	if len(existing.Categories) == 0 && !bookmarksReferenceCategories(existing.Bookmarks) {
		existing.Categories = getDefaultNewPageCategories()
	}

	// May create bookmarks-N.json (new page) or rename an existing one — either
	// way GetPages() can change, so this is not single-page-scoped.
	return fs.writeStoreJSONFile(fileName, existing, 0)
}

func (fs *FileStore) removeFactoryResetUserAssets() {
	os.RemoveAll(fmt.Sprintf("%s/icons", fs.dataDir))
	for _, name := range []string{
		"preview-cache.json",
		"health-cache.json",
		"colors.json",
		"favicon.ico",
		"favicon.png",
		"favicon.jpg",
		"favicon.gif",
		"font.woff",
		"font.woff2",
		"font.ttf",
		"font.otf",
	} {
		os.Remove(fmt.Sprintf("%s/%s", fs.dataDir, name))
	}
}

func (fs *FileStore) resetAllDataLocked() error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	entries, err := os.ReadDir(fs.dataDir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), "bookmarks-") && strings.HasSuffix(entry.Name(), ".json") {
			os.Remove(fmt.Sprintf("%s/%s", fs.dataDir, entry.Name()))
		}
	}

	fs.removeFactoryResetUserAssets()

	writeFileAtomic(fmt.Sprintf("%s/finders.json", fs.dataDir), []byte("[]"), 0644)

	data, _ := json.MarshalIndent(PageOrder{Order: []int{1}}, "", "  ")
	writeFileAtomic(fs.pageOrderFile, data, 0644)

	os.Remove(fs.settingsFile)
	os.Remove(inboxFilePath(fs.dataDir))
	// A factory reset that left deleted bookmarks behind would hand the next
	// user the previous one's data through the trash.
	os.Remove(trashFilePath(fs.dataDir))

	fs.noteDataMutation(0)
	return nil
}

func (fs *FileStore) ResetAllData() error {
	if err := fs.resetAllDataLocked(); err != nil {
		return err
	}
	// initializeDefaultFiles runs migrations that acquire fs.mutex themselves.
	fs.initializeDefaultFiles()
	return nil
}

func (fs *FileStore) markDefaultBookmarkIconPrefetch() {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	fs.prefetchDefaultBookmarkIcons = true
}

func (fs *FileStore) TakeDefaultBookmarkIconPrefetch() bool {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if !fs.prefetchDefaultBookmarkIcons {
		return false
	}
	fs.prefetchDefaultBookmarkIcons = false
	return true
}

func (fs *FileStore) MergePrefetchBookmarkIcons(pageID int, updates []PrefetchIconUpdate) int {
	if len(updates) == 0 {
		return 0
	}

	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return 0
	}

	var pageWithBookmarks PageWithBookmarks
	if err := json.Unmarshal(data, &pageWithBookmarks); err != nil {
		return 0
	}
	bookmarks := pageWithBookmarks.Bookmarks
	if len(bookmarks) == 0 {
		return 0
	}

	applied := 0
	for _, update := range updates {
		safeIcon := sanitizeBookmarkIcon(update.Icon)
		if safeIcon == "" || update.Index < 0 || update.Index >= len(bookmarks) {
			continue
		}
		if canonicalBookmarkURLKey(bookmarks[update.Index].URL) != update.URLKey {
			continue
		}
		if !update.Overwrite && strings.TrimSpace(bookmarks[update.Index].Icon) != "" {
			continue
		}
		bookmarks[update.Index].Icon = safeIcon
		bookmarks[update.Index].PageID = pageID
		applied++
	}

	if applied == 0 {
		return 0
	}

	pageWithBookmarks.Bookmarks = bookmarks
	newData, err := json.MarshalIndent(pageWithBookmarks, "", "  ")
	if err != nil {
		return 0
	}
	if err := writeFileAtomic(filePath, newData, 0644); err != nil {
		return 0
	}
	fs.noteDataMutation(pageID)
	return applied
}

func (fs *FileStore) DeletePage(pageID int) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Delete bookmarks-{pageID}.json (file may not exist if the page had no bookmarks)
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, pageID)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return err
	}
	// Removing bookmarks-N.json changes what GetPages() reports — see the same
	// note in saveBookmarksByPageLocked.
	fs.noteDataMutation(0)
	return nil
}

// ErrPageExists is returned when restoring a page whose id is taken again.
var ErrPageExists = errors.New("page already exists")

// RestorePage writes bookmarks-N.json back from a trash snapshot, at the page's
// original id.
//
// Deliberately not SavePage: that one preserves whatever is already on disk and
// substitutes default categories for an empty list, both of which would corrupt
// a restore. This writes the snapshot verbatim.
//
// A page file that exists again is refused rather than overwritten — the id has
// been reused, and clobbering it would delete a live page to undo an old one.
func (fs *FileStore) RestorePage(snapshot TrashedPage) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()
	filePath := fmt.Sprintf("%s/bookmarks-%d.json", fs.dataDir, snapshot.Page.ID)
	if _, err := os.Stat(filePath); err == nil {
		return ErrPageExists
	} else if !os.IsNotExist(err) {
		return err
	}

	restored := PageWithBookmarks{
		Page:       snapshot.Page,
		Categories: snapshot.Categories,
		Bookmarks:  snapshot.Bookmarks,
	}
	if restored.Bookmarks == nil {
		restored.Bookmarks = []Bookmark{}
	}
	// A restore always creates a new bookmarks-N.json — not single-page-scoped.
	if err := fs.writeStoreJSONFile(filePath, restored, 0); err != nil {
		return err
	}

	// Put the tab back where it was rather than at the end.
	order := fs.getPageOrder()
	for _, id := range order {
		if id == snapshot.Page.ID {
			fs.noteDataMutation(0)
			return nil
		}
	}
	at := snapshot.OrderIndex
	if at < 0 || at > len(order) {
		at = len(order)
	}
	next := make([]int, 0, len(order)+1)
	next = append(next, order[:at]...)
	next = append(next, snapshot.Page.ID)
	next = append(next, order[at:]...)
	if err := fs.savePageOrder(next); err != nil {
		return err
	}
	fs.noteDataMutation(0)
	return nil
}

func (fs *FileStore) GetSettings() Settings {
	fs.mutex.RLock()
	if fs.readCache.settingsOK {
		settings := fs.readCache.settings
		fs.mutex.RUnlock()
		return settings
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.settingsOK {
		return fs.readCache.settings
	}

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.settingsFile)
	if err != nil {
		// Return default settings if file doesn't exist
		settings := Settings{
			CurrentPage:                    1,
			Theme:                          defaultThemeID,
			OpenInNewTab:                   true,
			AnalyticsOptIn:                 false,
			EnableSessionTips:              true,
			ShowShortcutTooltips:           false,
			ShowGridKeyLegend:              true,
			ShortcutOpenMode:               "instant",
			RememberScrollPosition:         true,
			DetectSoftNotFound:             true,
			ColumnsPerRow:                  3,
			FontSize:                       "m",
			ShowBackgroundDots:             true,
			ShowTitle:                      true,
			ShowDate:                       true,
			ShowTime:                       true,
			TimeFormat:                     "24h",
			DateFormat:                     "short-slash",
			ShowWeatherWithDate:            false,
			WeatherSource:                  "manual",
			WeatherLocation:                "",
			WeatherUnit:                    "celsius",
			WeatherRefreshMinutes:          30,
			ShowConfigButton:               true,
			ShowHealthDashboard:            true,
			ShowSearchButton:               true,
			ShowAddBookmarkButton:          true,
			ShowFindersButton:              true,
			ShowCommandsButton:             true,
			ShowRecentButton:               true,
			ShowSearchFlowBanner:           true,
			ShowCheatSheetButton:           true,
			ShowCollapseAllButton:          false,
			ShowSearchButtonText:           true,
			ShowFindersButtonText:          true,
			ShowCommandsButtonText:         true,
			ShowStatus:                     true,
			ColorizeStatus:                 true,
			MonitorEmphasis:                "problems",
			ShowPing:                       true,
			ShowStatusLoading:              false,
			SkipFastPing:                   false,
			StatusOfflineRetries:           3,
			StatusOfflineRetryDelayMs:      450,
			StatusRecheckIntervalMinutes:   5,
			GlobalShortcuts:                true,
			HyprMode:                       false,
			AnimationsEnabled:              true,
			EnableCustomTitle:              false,
			CustomTitle:                    "",
			ShowPageInTitle:                false,
			ShowPageNamesInTabs:            false,
			EnableCustomFavicon:            false,
			CustomFaviconPath:              "",
			EnableCustomFont:               false,
			CustomFontPath:                 "",
			Language:                       "en",
			InterleaveMode:                 false,
			ShowPageTabs:                   true,
			AlwaysCollapseCategories:       false,
			HideEmptyCategories:            true,
			EnableFuzzySuggestions:         false,
			FuzzySuggestionsStartWith:      false,
			KeepSearchOpenWhenEmpty:        false,
			ShowIcons:                      true,
			ShowLinkPreviewCards:           true,
			LinkPreviewMode:                "hover",
			ShowSiteNews:                   true,
			LinkPreviewHoverDelayMs:        250,
			ShowShortcuts:                  true,
			ShowPinIcon:                    false,
			ShowNoteIcon:                   true,
			IncludeFindersInSearch:         false,
			BackgroundOpacity:              1,
			FontWeight:                     "normal",
			FontPreset:                     "source-code-pro",
			AutoDarkMode:                   true,
			ShowSmartRecentCollection:      false,
			ShowSmartTodayCollection:       true,
			ShowSmartStaleCollection:       false,
			SmartTodayLimit:                8,
			SmartRecentLimit:               50,
			SmartStaleLimit:                50,
			CategoryItemLimit:              15,
			QuickStart:                     QuickStartState{BaselineBookmarks: -1, BaselineTagged: -1},
			SmartTodayWorkKeywords:         "calendar,mail,gmail,outlook,notion,docs,drive,github,gitlab,jira,slack,teams",
			SmartTodayEveningKeywords:      "youtube,spotify,netflix,reddit",
			SmartTodayWeekendKeywords:      "news,weather,maps",
			SmartTodayPageIds:              []int{},
			SmartRecentPageIds:             []int{},
			SmartStalePageIds:              []int{},
			SmartAddedPageIds:              []int{},
			SmartAddedLimit:                20,
			RowTagsMax:                     2,
			FaviconRefreshPolicy:           "on-save",
			ConfigBookmarksSort:            defaultConfigBookmarksSort,
			ConfigBookmarksPageSize:        defaultConfigBookmarksPageSize,
			BookmarkDeleteConfirmFrom:      defaultBookmarkDeleteConfirmFrom,
			DefaultMonitorIntervalMin:      defaultMonitorIntervalMinutes,
			NewBookmarkCheckMode:           defaultNewBookmarkCheckMode,
			BookmarkStaleDays:              defaultBookmarkStaleDays,
			BookmarkArchiveUrl:             defaultBookmarkArchiveUrl,
			LayoutPreset:                   "default",
			LayoutVersion:                  "classic",
			DensityMode:                    "compact",
			CategorySpacing:                "balanced",
			SideMargin:                     "balanced",
			PackedColumns:                  true,
			DefaultCategorySpread:          false,
			CategorySpreadResetScope:       defaultCategorySpreadResetScope,
			BackgroundType:                 "none",
			BackgroundGradient:             "",
			BackgroundImageUrl:             "",
			ThemeIconStyling:               defaultThemeIconStyling(),
			PasteUrlQuickAdd:               true,
			InboxEnabled:                   true,
			PasteDestination:               "ask",
			InboxDedupeUrls:                true,
			InboxMaxItems:                  500,
			InboxShowInPageTabs:            true,
			InboxDeleteAfterPromote:        true,
			AllowLocalBookmarks:            true,
			AutoBackupEnabled:              true,
			HealthAutoRecheckEnabled:       false,
			HealthAutoRecheckIntervalHours: defaultHealthAutoRecheckIntervalHours,
			// Set explicitly rather than left to the clamp, which would normalise
			// them on read anyway: a stored 0 / "" reads as a setting nobody
			// chose, and config compares against the documented default.
			ServerLogRetentionMode: serverLogModeTime,
			ServerLogMaxEntries:    serverLogDefaultMaxEntries,
			UpdateCheckEnabled:     true,
		}
		fs.readCache.settings = settings
		fs.readCache.settingsOK = true
		return settings
	}

	var settings Settings
	json.Unmarshal(data, &settings)

	var rawSettings map[string]json.RawMessage
	if err := json.Unmarshal(data, &rawSettings); err == nil {
		if _, ok := rawSettings["showCheatSheetButton"]; !ok {
			settings.ShowCheatSheetButton = true
		}
		// Absent for everyone until this setting existed, and the button it
		// controls was visible all that time. Defaulting to false would take it
		// away from every existing dashboard on upgrade — which is why a fresh
		// install starting without the button (see the constructors above) does
		// not change anything here: no key means an upgrade, not a new install.
		if _, ok := rawSettings["showCollapseAllButton"]; !ok {
			settings.ShowCollapseAllButton = true
		}
		if _, ok := rawSettings["colorizeStatus"]; !ok {
			settings.ColorizeStatus = true
		}
		if _, ok := rawSettings["showStatus"]; !ok {
			settings.ShowStatus = true
		}
		if _, ok := rawSettings["showPing"]; !ok {
			settings.ShowPing = true
		}
		if _, ok := rawSettings["showStatusLoading"]; !ok {
			settings.ShowStatusLoading = false
		}
		if _, ok := rawSettings["statusOfflineRetries"]; !ok || settings.StatusOfflineRetries < 1 || settings.StatusOfflineRetries > 10 {
			settings.StatusOfflineRetries = 3
		}
		if _, ok := rawSettings["statusOfflineRetryDelayMs"]; !ok || settings.StatusOfflineRetryDelayMs < 100 || settings.StatusOfflineRetryDelayMs > 3000 {
			settings.StatusOfflineRetryDelayMs = 450
		}
		if _, ok := rawSettings["statusRecheckIntervalMinutes"]; !ok || settings.StatusRecheckIntervalMinutes < 1 || settings.StatusRecheckIntervalMinutes > 60 {
			settings.StatusRecheckIntervalMinutes = 5
		}
		if _, ok := rawSettings["showShortcuts"]; !ok {
			settings.ShowShortcuts = true
		}
		// A settings file that predates the card carries neither key, and the
		// card is on by default now. One that carries the old boolean has an
		// answer already — including the false the v1.2 migration wrote, which
		// was a decision made for those installs and is not undone here.
		_, hadLegacy := rawSettings["showLinkPreviewCards"]
		_, hadMode := rawSettings["linkPreviewMode"]
		if !hadLegacy && !hadMode {
			settings.ShowLinkPreviewCards = true
		}
		if _, ok := rawSettings["linkPreviewHoverDelayMs"]; !ok {
			settings.LinkPreviewHoverDelayMs = 250
		}
		settings.LinkPreviewMode = normalizeLinkPreviewMode(settings.LinkPreviewMode, settings.ShowLinkPreviewCards)
		settings.ShowLinkPreviewCards = settings.LinkPreviewMode != "off"
		settings.LinkPreviewParts = normalizeLinkPreviewParts(settings.LinkPreviewParts)
		if _, ok := rawSettings["showSiteNews"]; !ok {
			settings.ShowSiteNews = true
		}
		if settings.LinkPreviewHoverDelayMs != 100 && settings.LinkPreviewHoverDelayMs != 150 && settings.LinkPreviewHoverDelayMs != 250 {
			settings.LinkPreviewHoverDelayMs = 250
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
		if _, ok := rawSettings["updateCheckEnabled"]; !ok {
			settings.UpdateCheckEnabled = true
		}
		if _, ok := rawSettings["showAddBookmarkButton"]; !ok {
			settings.ShowAddBookmarkButton = true
		}
		if _, ok := rawSettings["showFindersButton"]; !ok {
			settings.ShowFindersButton = true
		}
		if _, ok := rawSettings["showCommandsButton"]; !ok {
			settings.ShowCommandsButton = true
		}
		// Health is always available and can no longer be disabled. Force it on
		// regardless of any legacy stored value so users who previously turned it
		// off get it back.
		settings.ShowHealthDashboard = true
		if _, ok := rawSettings["showConfigButton"]; !ok {
			settings.ShowConfigButton = true
		}
		if _, ok := rawSettings["showIcons"]; !ok {
			settings.ShowIcons = true
		}
		if !settings.TagCloudDefaultMigrated {
			settings.ShowTagCloudButton = true
			settings.TagCloudDefaultMigrated = true
		}
		if !settings.ConfigButtonDefaultOnMigrated {
			settings.ShowConfigButton = true
			settings.ConfigButtonDefaultOnMigrated = true
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
		if _, ok := rawSettings["categoryItemLimit"]; !ok || settings.CategoryItemLimit < 0 {
			settings.CategoryItemLimit = 15
		}
		settings.RandomThemeMode = normalizeRandomThemeMode(settings.RandomThemeMode, settings.RandomThemeOnRefresh)
		settings.RandomThemeOnRefresh = settings.RandomThemeMode == "refresh" || settings.RandomThemeMode == "view"
		// Baselines default to -1 ("not captured yet"), not Go's zero value: 0
		// would read as a captured baseline of no bookmarks, and the seeded
		// examples would immediately tick the checklist's add/tag items.
		if _, ok := rawSettings["quickStart"]; !ok {
			settings.QuickStart.BaselineBookmarks = -1
			settings.QuickStart.BaselineTagged = -1
		} else if raw, ok := rawSettings["quickStart"]; ok {
			var qs map[string]json.RawMessage
			if json.Unmarshal(raw, &qs) == nil {
				if _, has := qs["baselineBookmarks"]; !has {
					settings.QuickStart.BaselineBookmarks = -1
				}
				if _, has := qs["baselineTagged"]; !has {
					settings.QuickStart.BaselineTagged = -1
				}
			}
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
		if _, ok := rawSettings["smartAddedPageIds"]; !ok || settings.SmartAddedPageIds == nil {
			settings.SmartAddedPageIds = []int{}
		}
		if _, ok := rawSettings["faviconRefreshPolicy"]; !ok || (settings.FaviconRefreshPolicy != "manual" && settings.FaviconRefreshPolicy != "on-save") {
			settings.FaviconRefreshPolicy = "on-save"
		}
		if _, ok := rawSettings["onboardingCompleted"]; !ok {
			settings.OnboardingCompleted = true
		}
		// Analytics is opt-in: an absent key stays false (Go's zero value), so
		// fresh installs measure nothing until the user says yes.
		//
		// Installs that predate the rename carry the setting under the old name,
		// and that stored value is honoured rather than dropped: `true` migrates
		// to opted-in, `false` stays off. Note this cannot distinguish a user who
		// ticked the box from one who simply never touched the old default-on
		// build -- both stored `true`. An explicit `false` is always preserved.
		if _, ok := rawSettings["analyticsOptIn"]; !ok {
			if raw, legacy := rawSettings["enableUsageAnalytics"]; legacy {
				var wasEnabled bool
				if json.Unmarshal(raw, &wasEnabled) == nil {
					settings.AnalyticsOptIn = wasEnabled
				}
			}
		}
		// Whoever ends up opted in has a working, measured install; the opt-in card
		// would only interrupt them, so treat that as the choice already being made.
		//
		// Everyone else gets asked, including users carrying the legacy
		// seenAnalyticsNotice flag: that card only announced analytics was on, and
		// its "Got it" acknowledged a statement rather than answering a question.
		// It is deliberately not read here.
		// The flag lives inside the nested quickStart object, so probe that rather
		// than the top level -- a top-level lookup never matches and would re-seed
		// the value on every load, wiping a decline the moment it is stored.
		storedChoice := false
		if raw, ok := rawSettings["quickStart"]; ok {
			var qs map[string]json.RawMessage
			if json.Unmarshal(raw, &qs) == nil {
				_, storedChoice = qs["analyticsChoiceMade"]
			}
		}
		if !storedChoice {
			settings.QuickStart.AnalyticsChoiceMade = settings.AnalyticsOptIn
		}
		// Session tips keep the default-on, opt-out contract below — they are a
		// local UI nicety, not data leaving the machine.
		if _, ok := rawSettings["enableSessionTips"]; !ok {
			settings.EnableSessionTips = true
		}
		// Off unless the file says otherwise. This used to fill an absent key
		// with true — the popovers were how the keys were discovered — and the
		// one-time migration above has since turned them off for everyone, so
		// filling in true here would put them straight back on any file written
		// before the key existed.
		if _, ok := rawSettings["packedColumns"]; !ok {
			settings.PackedColumns = true
		}
		// "glass" was removed; stored glass settings normalize to classic here.
		if _, ok := rawSettings["layoutVersion"]; !ok || (settings.LayoutVersion != "classic" && settings.LayoutVersion != "modern") {
			settings.LayoutVersion = "classic"
		}
		if _, ok := rawSettings["densityMode"]; !ok || (settings.DensityMode != "comfortable" && settings.DensityMode != "compact" && settings.DensityMode != "dense" && settings.DensityMode != "auto") {
			settings.DensityMode = "compact"
		}
		// Distinct from densityMode, which sizes bookmark rows: this is the gap
		// between category rows. "balanced" is a deliberate reduction from the
		// old fixed 3rem, which left a visible band of nothing on wide pages.
		if _, ok := rawSettings["categorySpacing"]; !ok || (settings.CategorySpacing != "snug" && settings.CategorySpacing != "balanced" && settings.CategorySpacing != "airy") {
			settings.CategorySpacing = "balanced"
		}
		// The left/right band beside the grid. "balanced" is the margin the
		// dashboard has always had, so an existing install sees no change.
		if _, ok := rawSettings["sideMargin"]; !ok || (settings.SideMargin != "snug" && settings.SideMargin != "balanced" && settings.SideMargin != "airy") {
			settings.SideMargin = "balanced"
		}
		if _, ok := rawSettings["monitorEmphasis"]; !ok || (settings.MonitorEmphasis != "problems" && settings.MonitorEmphasis != "always" && settings.MonitorEmphasis != "never") {
			settings.MonitorEmphasis = "problems"
		}
		if _, ok := rawSettings["launcherIconSize"]; !ok || (settings.LauncherIconSize != "small" && settings.LauncherIconSize != "normal" && settings.LauncherIconSize != "large") {
			settings.LauncherIconSize = "normal"
		}
		// The corner dock rather than the centred bar: it keeps the buttons out
		// of the bookmarks instead of floating over them. Only for a file that
		// does not name a position -- anyone who chose one has the key, and
		// this leaves their choice alone.
		if _, ok := rawSettings["buttonBarPosition"]; !ok || (settings.ButtonBarPosition != "bottom" && settings.ButtonBarPosition != "bottom-left" && settings.ButtonBarPosition != "bottom-right" && settings.ButtonBarPosition != "side-left" && settings.ButtonBarPosition != "side-right") {
			settings.ButtonBarPosition = "bottom-right"
		}
		if _, ok := rawSettings["showDockLayoutSelector"]; !ok {
			settings.ShowDockLayoutSelector = true
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
		if settings.EnableCustomFont && settings.CustomFontPath != "" {
			settings.FontPreset = "custom"
		} else if settings.FontPreset == "custom" && settings.CustomFontPath == "" {
			settings.FontPreset = "source-code-pro"
		} else if _, ok := rawSettings["fontPreset"]; !ok || !isValidFontPreset(settings.FontPreset) {
			settings.FontPreset = "source-code-pro"
		}
		settings.EnableCustomFont = settings.FontPreset == "custom" && settings.CustomFontPath != ""
		if _, ok := rawSettings["backgroundType"]; !ok {
			settings.BackgroundType = "none"
		}
		if _, ok := rawSettings["backgroundGradient"]; !ok {
			settings.BackgroundGradient = ""
		}
		if _, ok := rawSettings["backgroundImageUrl"]; !ok {
			settings.BackgroundImageUrl = ""
		}
		if _, ok := rawSettings["pasteUrlQuickAdd"]; !ok {
			settings.PasteUrlQuickAdd = true
		}
		if _, ok := rawSettings["inboxEnabled"]; !ok {
			settings.InboxEnabled = true
		}
		if settings.InboxEnabled {
			settings.PasteUrlQuickAdd = true
		}
		if !settings.InboxEnabled && normalizePasteDestination(settings.PasteDestination) == "inbox" {
			settings.PasteDestination = "ask"
		}
		if _, ok := rawSettings["pasteDestination"]; !ok {
			settings.PasteDestination = "ask"
		}
		settings.PasteDestination = normalizePasteDestination(settings.PasteDestination)
		// The mode decides; the old boolean follows it, so anything still reading
		// showLinkPreviewCards — the command palette toggle, the analytics flag —
		// cannot disagree with the setting the reader actually chose.
		settings.LinkPreviewMode = normalizeLinkPreviewMode(settings.LinkPreviewMode, settings.ShowLinkPreviewCards)
		settings.ShowLinkPreviewCards = settings.LinkPreviewMode != "off"
		settings.LinkPreviewParts = normalizeLinkPreviewParts(settings.LinkPreviewParts)
		if _, ok := rawSettings["inboxDedupeUrls"]; !ok {
			settings.InboxDedupeUrls = true
		}
		if _, ok := rawSettings["inboxMaxItems"]; !ok {
			settings.InboxMaxItems = 500
		}
		if _, ok := rawSettings["inboxShowInPageTabs"]; !ok {
			settings.InboxShowInPageTabs = true
		}
		if _, ok := rawSettings["inboxDeleteAfterPromote"]; !ok {
			settings.InboxDeleteAfterPromote = true
		}
		if _, ok := rawSettings["allowLocalBookmarks"]; !ok {
			settings.AllowLocalBookmarks = true
		}
		if _, ok := rawSettings["autoBackupEnabled"]; !ok {
			settings.AutoBackupEnabled = true
		}
	}

	// Set default language if empty
	if settings.Language == "" {
		settings.Language = "en"
	}
	settings.Theme = normalizeLegacyThemeID(settings.Theme)
	if !fs.isValidThemeIDFor(settings.Theme) {
		settings.Theme = defaultThemeID
	}
	settings.FontPreset = normalizeFontPreset(settings.FontPreset)
	settings.FontSize = normalizeFontSize(settings.FontSize)
	settings.HealthAutoRecheckIntervalHours = clampHealthAutoRecheckIntervalHours(settings.HealthAutoRecheckIntervalHours)
	// 0 stays 0 — it means "the built-in default" — and anything else is held
	// inside the range a bounded sweep can afford.
	if settings.HealthCheckTimeoutSeconds != 0 {
		if settings.HealthCheckTimeoutSeconds < 2 {
			settings.HealthCheckTimeoutSeconds = 2
		}
		if settings.HealthCheckTimeoutSeconds > 30 {
			settings.HealthCheckTimeoutSeconds = 30
		}
	}
	// Same shape: 0 means the built-in 30 days, anything else is held inside a
	// range where a renewal reminder is still a reminder.
	if settings.CertWarnDays != 0 {
		if settings.CertWarnDays < certWarnDaysMin {
			settings.CertWarnDays = certWarnDaysMin
		}
		if settings.CertWarnDays > certWarnDaysMax {
			settings.CertWarnDays = certWarnDaysMax
		}
	}
	settings.ServerLogRetentionHours = clampServerLogRetentionHours(settings.ServerLogRetentionHours)
	settings.ServerLogRetentionMode = clampServerLogRetentionMode(settings.ServerLogRetentionMode)
	settings.ServerLogMaxEntries = clampServerLogMaxEntries(settings.ServerLogMaxEntries)
	settings.MonitorNotifyRetries = clampMonitorNotifyRetries(settings.MonitorNotifyRetries)
	settings.MonitorNotifyPreset = normalizeMonitorNotifyPreset(settings.MonitorNotifyPreset)
	settings.MonitorNotifyTelegramChatID = normalizeMonitorNotifyCredential(settings.MonitorNotifyTelegramChatID)
	settings.MonitorNotifyPushoverToken = normalizeMonitorNotifyCredential(settings.MonitorNotifyPushoverToken)
	settings.MonitorNotifyPushoverUserKey = normalizeMonitorNotifyCredential(settings.MonitorNotifyPushoverUserKey)
	// Through the same normaliser as every other credential, so a pasted key
	// with a stray newline is the same key.
	settings.ArchiveSaveAccessKey = normalizeMonitorNotifyCredential(settings.ArchiveSaveAccessKey)
	settings.ArchiveSaveSecret = normalizeMonitorNotifyCredential(settings.ArchiveSaveSecret)
	settings.MaintenanceWindows = normalizeMaintenanceWindows(settings.MaintenanceWindows)
	settings.PushNotifySubject = normalizeVAPIDSubject(settings.PushNotifySubject)

	fs.readCache.settings = settings
	fs.readCache.settingsOK = true
	return settings
}

func (fs *FileStore) SaveSettings(settings Settings) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	// Preserve migration markers from the stored file so that importing
	// settings from another instance cannot suppress pending migrations.
	if raw, err := os.ReadFile(fs.settingsFile); err == nil {
		var stored Settings
		if json.Unmarshal(raw, &stored) == nil {
			settings.TagCloudDefaultMigrated = stored.TagCloudDefaultMigrated
			settings.LinkPreviewCardsOffMigrated = stored.LinkPreviewCardsOffMigrated
			settings.ShortcutTooltipsOffMigrated = stored.ShortcutTooltipsOffMigrated
			settings.ShortcutOpenModeInstantMigrated = stored.ShortcutOpenModeInstantMigrated
			settings.HideEmptyCategoriesMigrated = stored.HideEmptyCategoriesMigrated
			settings.ConfigButtonDefaultOnMigrated = stored.ConfigButtonDefaultOnMigrated
		}
	}

	settings.FontPreset = normalizeFontPreset(settings.FontPreset)
	settings.FontSize = normalizeFontSize(settings.FontSize)
	settings.PasteDestination = normalizePasteDestination(settings.PasteDestination)
	settings.RandomThemeMode = normalizeRandomThemeMode(settings.RandomThemeMode, settings.RandomThemeOnRefresh)
	settings.RandomThemeOnRefresh = settings.RandomThemeMode == "refresh" || settings.RandomThemeMode == "view"
	settings.Theme = normalizeLegacyThemeID(settings.Theme)
	if !fs.isValidThemeIDFor(settings.Theme) {
		settings.Theme = defaultThemeID
	}

	return fs.writeStoreJSONFile(fs.settingsFile, settings, 0)
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

		// ── Terminal Amber: classic phosphor-amber terminal aesthetic ──────────
		"terminal-amber-dark":  {Name: "Terminal Amber [dark]", TextPrimary: "#FFD080", TextSecondary: "#FFB830", TextTertiary: "#C88A00", BackgroundPrimary: "#0A0800", BackgroundSecondary: "#140F00", BackgroundDots: "#1F1600", BackgroundModal: "rgba(10, 8, 0, 0.90)", BorderPrimary: "#6B4C00", BorderSecondary: "#4A3500", AccentSuccess: "#FFB830", AccentWarning: "#FF8C00", AccentError: "#FF5555"},
		"terminal-amber-light": {Name: "Terminal Amber [light]", TextPrimary: "#5C3B00", TextSecondary: "#8B5E00", TextTertiary: "#A87A00", BackgroundPrimary: "#FFFCF0", BackgroundSecondary: "#FFF5D0", BackgroundDots: "#FFE8A0", BackgroundModal: "rgba(255, 252, 240, 0.92)", BorderPrimary: "#E8C860", BorderSecondary: "#DDB820", AccentSuccess: "#5C3B00", AccentWarning: "#B45309", AccentError: "#B91C1C"},

		// ── Dusk Horizon: muted indigo-navy atmospheric sky gradient ──────────
		"dusk-horizon-dark":  {Name: "Dusk Horizon [dark]", TextPrimary: "#E8EAF6", TextSecondary: "#B0BAD4", TextTertiary: "#7B8BA6", BackgroundPrimary: "#0D0F1A", BackgroundSecondary: "#141728", BackgroundDots: "#1E2440", BackgroundModal: "rgba(13, 15, 26, 0.88)", BorderPrimary: "#3D4878", BorderSecondary: "#272D55", AccentSuccess: "#7C9BF8", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"dusk-horizon-light": {Name: "Dusk Horizon [light]", TextPrimary: "#1A1F4E", TextSecondary: "#3A4580", TextTertiary: "#5A68A8", BackgroundPrimary: "#F5F6FF", BackgroundSecondary: "#EAEDFF", BackgroundDots: "#D8DCFF", BackgroundModal: "rgba(245, 246, 255, 0.92)", BorderPrimary: "#BCC4F0", BorderSecondary: "#9AA8E8", AccentSuccess: "#4158C8", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Moss & Stone: desaturated earthy olive-grey organic palette ───────
		"moss-stone-dark":  {Name: "Moss & Stone [dark]", TextPrimary: "#D4CFBC", TextSecondary: "#A8A48C", TextTertiary: "#756E58", BackgroundPrimary: "#131210", BackgroundSecondary: "#1E1C17", BackgroundDots: "#2A2820", BackgroundModal: "rgba(19, 18, 16, 0.88)", BorderPrimary: "#4A4535", BorderSecondary: "#36332A", AccentSuccess: "#8FAE7A", AccentWarning: "#C49A3C", AccentError: "#C46A50"},
		"moss-stone-light": {Name: "Moss & Stone [light]", TextPrimary: "#2C2A20", TextSecondary: "#5A5640", TextTertiary: "#7A7558", BackgroundPrimary: "#F7F5EE", BackgroundSecondary: "#EEEBE0", BackgroundDots: "#E0DDD0", BackgroundModal: "rgba(247, 245, 238, 0.92)", BorderPrimary: "#C8C3A8", BorderSecondary: "#B0AA90", AccentSuccess: "#4A7038", AccentWarning: "#9A6B1A", AccentError: "#923020"},

		// ── Candy Pop: vibrant bubblegum pink with electric cyan accents ──────
		"candy-pop-dark":  {Name: "Candy Pop [dark]", TextPrimary: "#FFE8F8", TextSecondary: "#FFB3E8", TextTertiary: "#FF6AC8", BackgroundPrimary: "#190C1F", BackgroundSecondary: "#240F2D", BackgroundDots: "#3A1A48", BackgroundModal: "rgba(25, 12, 31, 0.90)", BorderPrimary: "#CC2299", BorderSecondary: "#8B1566", AccentSuccess: "#00E8CC", AccentWarning: "#F59E0B", AccentError: "#FF3366"},
		"candy-pop-light": {Name: "Candy Pop [light]", TextPrimary: "#5C0044", TextSecondary: "#880066", TextTertiary: "#AA0088", BackgroundPrimary: "#FFF2FF", BackgroundSecondary: "#FFE4FF", BackgroundDots: "#FFD0FF", BackgroundModal: "rgba(255, 242, 255, 0.92)", BorderPrimary: "#EE88DD", BorderSecondary: "#DD66CC", AccentSuccess: "#0891B2", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Midnight Ink: near-pure black with icy silver-blue accents ────────
		"midnight-ink-dark":  {Name: "Midnight Ink [dark]", TextPrimary: "#F8FAFC", TextSecondary: "#B8C4D4", TextTertiary: "#6B7A8E", BackgroundPrimary: "#000204", BackgroundSecondary: "#070C12", BackgroundDots: "#0E1620", BackgroundModal: "rgba(0, 2, 4, 0.92)", BorderPrimary: "#1A2B3C", BorderSecondary: "#0F1D28", AccentSuccess: "#C8DCF4", AccentWarning: "#F0B050", AccentError: "#F07080"},
		"midnight-ink-light": {Name: "Midnight Ink [light]", TextPrimary: "#080C14", TextSecondary: "#1A2540", TextTertiary: "#3A4A5C", BackgroundPrimary: "#F8FAFD", BackgroundSecondary: "#EEF2F8", BackgroundDots: "#DDE4EF", BackgroundModal: "rgba(248, 250, 253, 0.92)", BorderPrimary: "#B8C8DC", BorderSecondary: "#8CA0B8", AccentSuccess: "#1E3A5F", AccentWarning: "#B45309", AccentError: "#B91C1C"},

		// ── Patina Verdigris: oxidized copper teal on dark bronze ─────────────
		"patina-verdigris-dark":  {Name: "Patina Verdigris [dark]", TextPrimary: "#C8E8DC", TextSecondary: "#8AD4BC", TextTertiary: "#6BBFA8", BackgroundPrimary: "#0E1210", BackgroundSecondary: "#162019", BackgroundDots: "#1E3028", BackgroundModal: "rgba(14, 18, 16, 0.88)", BorderPrimary: "#3D8B72", BorderSecondary: "#2A6050", AccentSuccess: "#5EEAD4", AccentWarning: "#EAB308", AccentError: "#F87171"},
		"patina-verdigris-light": {Name: "Patina Verdigris [light]", TextPrimary: "#1A3D32", TextSecondary: "#2D6B58", TextTertiary: "#4A8878", BackgroundPrimary: "#F6FAF8", BackgroundSecondary: "#E8F2EC", BackgroundDots: "#D4EAE0", BackgroundModal: "rgba(246, 250, 248, 0.92)", BorderPrimary: "#8FD4BC", BorderSecondary: "#6BBFA8", AccentSuccess: "#0D9488", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Rhubarb Tart: crimson stalks with celery-green accents ────────────
		"rhubarb-tart-dark":  {Name: "Rhubarb Tart [dark]", TextPrimary: "#FFD6E0", TextSecondary: "#FB7185", TextTertiary: "#F43F5E", BackgroundPrimary: "#1A0A10", BackgroundSecondary: "#281018", BackgroundDots: "#3A1824", BackgroundModal: "rgba(26, 10, 16, 0.88)", BorderPrimary: "#9F1239", BorderSecondary: "#7F1D2E", AccentSuccess: "#86EFAC", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"rhubarb-tart-light": {Name: "Rhubarb Tart [light]", TextPrimary: "#7A1028", TextSecondary: "#BE123C", TextTertiary: "#E11D48", BackgroundPrimary: "#FFF8FA", BackgroundSecondary: "#FFE8EE", BackgroundDots: "#FFD0DC", BackgroundModal: "rgba(255, 248, 250, 0.92)", BorderPrimary: "#FDA4AF", BorderSecondary: "#FB7185", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Bio Abyss: deep sea black with bioluminescent aqua-lime ───────────
		"bio-abyss-dark":  {Name: "Bio Abyss [dark]", TextPrimary: "#B8FFF4", TextSecondary: "#5EFFE8", TextTertiary: "#00FFD5", BackgroundPrimary: "#020608", BackgroundSecondary: "#061018", BackgroundDots: "#003830", BackgroundModal: "rgba(2, 6, 8, 0.90)", BorderPrimary: "#0E8070", BorderSecondary: "#065848", AccentSuccess: "#39FF14", AccentWarning: "#FBBF24", AccentError: "#FF6B8A"},
		"bio-abyss-light": {Name: "Bio Abyss [light]", TextPrimary: "#064E45", TextSecondary: "#0F766E", TextTertiary: "#14B8A6", BackgroundPrimary: "#F0FFFE", BackgroundSecondary: "#D8FAF5", BackgroundDots: "#CCFBF1", BackgroundModal: "rgba(240, 255, 254, 0.92)", BorderPrimary: "#5EEAD4", BorderSecondary: "#2DD4BF", AccentSuccess: "#059669", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Sumi Ink: warm washi paper and charcoal brush strokes ─────────────
		"sumi-ink-dark":  {Name: "Sumi Ink [dark]", TextPrimary: "#E8E0D4", TextSecondary: "#C8B8A8", TextTertiary: "#A89888", BackgroundPrimary: "#121010", BackgroundSecondary: "#1C1816", BackgroundDots: "#2A2420", BackgroundModal: "rgba(18, 16, 16, 0.88)", BorderPrimary: "#4A4038", BorderSecondary: "#363028", AccentSuccess: "#86EFAC", AccentWarning: "#EAB308", AccentError: "#C84040"},
		"sumi-ink-light": {Name: "Sumi Ink [light]", TextPrimary: "#2C2420", TextSecondary: "#4A4038", TextTertiary: "#6B5E54", BackgroundPrimary: "#FAF6EE", BackgroundSecondary: "#F0EAE0", BackgroundDots: "#E4DAD0", BackgroundModal: "rgba(250, 246, 238, 0.92)", BorderPrimary: "#D4C8B8", BorderSecondary: "#B8A898", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#991B1B"},

		// ── Denim Fade: worn indigo denim with pale stitch highlights ────────
		"denim-fade-dark":  {Name: "Denim Fade [dark]", TextPrimary: "#C8D4F0", TextSecondary: "#8898D0", TextTertiary: "#6888C8", BackgroundPrimary: "#0A0E18", BackgroundSecondary: "#121828", BackgroundDots: "#1A2440", BackgroundModal: "rgba(10, 14, 24, 0.88)", BorderPrimary: "#2E4A88", BorderSecondary: "#1E3468", AccentSuccess: "#93C5FD", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"denim-fade-light": {Name: "Denim Fade [light]", TextPrimary: "#1E3A6E", TextSecondary: "#3B5998", TextTertiary: "#4A6FA8", BackgroundPrimary: "#F4F7FC", BackgroundSecondary: "#E8EEF8", BackgroundDots: "#D4DFF0", BackgroundModal: "rgba(244, 247, 252, 0.92)", BorderPrimary: "#A8BEE8", BorderSecondary: "#7898D8", AccentSuccess: "#2563EB", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Pistachio Cream: soft yellow-green on warm cream ──────────────────
		"pistachio-cream-dark":  {Name: "Pistachio Cream [dark]", TextPrimary: "#E8F0C8", TextSecondary: "#C8E098", TextTertiary: "#B8D878", BackgroundPrimary: "#101408", BackgroundSecondary: "#1A2010", BackgroundDots: "#2A3010", BackgroundModal: "rgba(16, 20, 8, 0.88)", BorderPrimary: "#6B8030", BorderSecondary: "#4A5820", AccentSuccess: "#D4E878", AccentWarning: "#EAB308", AccentError: "#F87171"},
		"pistachio-cream-light": {Name: "Pistachio Cream [light]", TextPrimary: "#3D4A18", TextSecondary: "#6B7F2E", TextTertiary: "#849838", BackgroundPrimary: "#FEFFF5", BackgroundSecondary: "#F4F8E8", BackgroundDots: "#EEF6C8", BackgroundModal: "rgba(254, 255, 245, 0.92)", BorderPrimary: "#C8DC88", BorderSecondary: "#A8C868", AccentSuccess: "#65A30D", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Thunderhead: storm charcoal with violet lightning accents ─────────
		"thunderhead-dark":  {Name: "Thunderhead [dark]", TextPrimary: "#D8D8F0", TextSecondary: "#A8A8D8", TextTertiary: "#9898C8", BackgroundPrimary: "#0C0C14", BackgroundSecondary: "#141420", BackgroundDots: "#1E1E30", BackgroundModal: "rgba(12, 12, 20, 0.88)", BorderPrimary: "#4848A0", BorderSecondary: "#303068", AccentSuccess: "#B388FF", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"thunderhead-light": {Name: "Thunderhead [light]", TextPrimary: "#282840", TextSecondary: "#5858A0", TextTertiary: "#6868B0", BackgroundPrimary: "#F0F0F8", BackgroundSecondary: "#E4E4F0", BackgroundDots: "#D0D0E8", BackgroundModal: "rgba(240, 240, 248, 0.92)", BorderPrimary: "#A8A8E0", BorderSecondary: "#8888D0", AccentSuccess: "#7C3AED", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Desert Rose: dusty mauve and terracotta sand ──────────────────────
		"desert-rose-dark":  {Name: "Desert Rose [dark]", TextPrimary: "#F0D8D0", TextSecondary: "#D8A898", TextTertiary: "#C89890", BackgroundPrimary: "#1A1214", BackgroundSecondary: "#281A1E", BackgroundDots: "#3A2828", BackgroundModal: "rgba(26, 18, 20, 0.88)", BorderPrimary: "#8A5858", BorderSecondary: "#684040", AccentSuccess: "#E87878", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"desert-rose-light": {Name: "Desert Rose [light]", TextPrimary: "#5C3838", TextSecondary: "#9A6868", TextTertiary: "#B07878", BackgroundPrimary: "#FBF5F2", BackgroundSecondary: "#F0E4E0", BackgroundDots: "#F0DDD8", BackgroundModal: "rgba(251, 245, 242, 0.92)", BorderPrimary: "#D8A898", BorderSecondary: "#C89890", AccentSuccess: "#15803D", AccentWarning: "#B45309", AccentError: "#B45454"},

		// ── Library Mahogany: dark wood shelves and burgundy leather ────────────
		"library-mahogany-dark":  {Name: "Library Mahogany [dark]", TextPrimary: "#F0E0C8", TextSecondary: "#D8B888", TextTertiary: "#C8A878", BackgroundPrimary: "#120A08", BackgroundSecondary: "#1E1210", BackgroundDots: "#301E18", BackgroundModal: "rgba(18, 10, 8, 0.90)", BorderPrimary: "#6B3028", BorderSecondary: "#502018", AccentSuccess: "#D4AF37", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"library-mahogany-light": {Name: "Library Mahogany [light]", TextPrimary: "#3A2018", TextSecondary: "#6B4030", TextTertiary: "#885848", BackgroundPrimary: "#FAF4EC", BackgroundSecondary: "#F0E4D8", BackgroundDots: "#E8D4C0", BackgroundModal: "rgba(250, 244, 236, 0.92)", BorderPrimary: "#C8A090", BorderSecondary: "#B08878", AccentSuccess: "#92400E", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Wheat Field: golden straw under a slate-grey sky ──────────────────
		"wheat-field-dark":  {Name: "Wheat Field [dark]", TextPrimary: "#E8D8A8", TextSecondary: "#C8B878", TextTertiary: "#B8A060", BackgroundPrimary: "#141210", BackgroundSecondary: "#201E18", BackgroundDots: "#2A2410", BackgroundModal: "rgba(20, 18, 16, 0.88)", BorderPrimary: "#6A6030", BorderSecondary: "#504820", AccentSuccess: "#A8C848", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"wheat-field-light": {Name: "Wheat Field [light]", TextPrimary: "#4A4020", TextSecondary: "#7A6830", TextTertiary: "#988040", BackgroundPrimary: "#FDFAF0", BackgroundSecondary: "#F4EED8", BackgroundDots: "#F0E8C0", BackgroundModal: "rgba(253, 250, 240, 0.92)", BorderPrimary: "#D8C878", BorderSecondary: "#C8B060", AccentSuccess: "#6B7F2E", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Cerulean Skylark: bright open sky blue ────────────────────────────
		"cerulean-skylark-dark":  {Name: "Cerulean Skylark [dark]", TextPrimary: "#D0E8FF", TextSecondary: "#98C8F8", TextTertiary: "#78B8F0", BackgroundPrimary: "#081018", BackgroundSecondary: "#101828", BackgroundDots: "#182840", BackgroundModal: "rgba(8, 16, 24, 0.88)", BorderPrimary: "#2060A8", BorderSecondary: "#184880", AccentSuccess: "#38BDF8", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"cerulean-skylark-light": {Name: "Cerulean Skylark [light]", TextPrimary: "#0C4A8C", TextSecondary: "#2563EB", TextTertiary: "#3B82F6", BackgroundPrimary: "#F5FAFF", BackgroundSecondary: "#E8F2FF", BackgroundDots: "#D0E4FF", BackgroundModal: "rgba(245, 250, 255, 0.92)", BorderPrimary: "#93C5FD", BorderSecondary: "#60A5FA", AccentSuccess: "#0284C7", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Smoked Plum: muted aubergine smoke tones ──────────────────────────
		"smoked-plum-dark":  {Name: "Smoked Plum [dark]", TextPrimary: "#E0C8E0", TextSecondary: "#C0A0C8", TextTertiary: "#A878B0", BackgroundPrimary: "#100818", BackgroundSecondary: "#1A1020", BackgroundDots: "#281830", BackgroundModal: "rgba(16, 8, 24, 0.88)", BorderPrimary: "#582868", BorderSecondary: "#401848", AccentSuccess: "#D878C8", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"smoked-plum-light": {Name: "Smoked Plum [light]", TextPrimary: "#3A1848", TextSecondary: "#6B3080", TextTertiary: "#8848A0", BackgroundPrimary: "#FAF6FA", BackgroundSecondary: "#F0E8F0", BackgroundDots: "#E4D4E8", BackgroundModal: "rgba(250, 246, 250, 0.92)", BorderPrimary: "#C8A0D0", BorderSecondary: "#B088C0", AccentSuccess: "#9333EA", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Licorice Layer: black base with pastel allsorts accents ───────────
		"licorice-layer-dark":  {Name: "Licorice Layer [dark]", TextPrimary: "#F0F0F0", TextSecondary: "#D0D0D8", TextTertiary: "#C0C0C8", BackgroundPrimary: "#0A0A0C", BackgroundSecondary: "#141418", BackgroundDots: "#202028", BackgroundModal: "rgba(10, 10, 12, 0.90)", BorderPrimary: "#FFB830", BorderSecondary: "#FF88CC", AccentSuccess: "#88CCFF", AccentWarning: "#FFB830", AccentError: "#FF6688"},
		"licorice-layer-light": {Name: "Licorice Layer [light]", TextPrimary: "#181820", TextSecondary: "#484858", TextTertiary: "#686878", BackgroundPrimary: "#FAFAFA", BackgroundSecondary: "#F0F0F4", BackgroundDots: "#E4E4EC", BackgroundModal: "rgba(250, 250, 250, 0.92)", BorderPrimary: "#F59E0B", BorderSecondary: "#E879A8", AccentSuccess: "#0891B2", AccentWarning: "#D97706", AccentError: "#BE123C"},

		// ── Terracotta Studio: clay pottery on workshop grey ──────────────────
		"terracotta-studio-dark":  {Name: "Terracotta Studio [dark]", TextPrimary: "#F0D0C0", TextSecondary: "#D8A088", TextTertiary: "#C88870", BackgroundPrimary: "#141010", BackgroundSecondary: "#201816", BackgroundDots: "#302420", BackgroundModal: "rgba(20, 16, 16, 0.88)", BorderPrimary: "#A85840", BorderSecondary: "#804030", AccentSuccess: "#E87850", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"terracotta-studio-light": {Name: "Terracotta Studio [light]", TextPrimary: "#5C3020", TextSecondary: "#9A5840", TextTertiary: "#B86848", BackgroundPrimary: "#FBF7F4", BackgroundSecondary: "#F0E8E0", BackgroundDots: "#E8D8C8", BackgroundModal: "rgba(251, 247, 244, 0.92)", BorderPrimary: "#E8B8A0", BorderSecondary: "#D8A088", AccentSuccess: "#C2410C", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Frosted Juniper: icy blue-green juniper berry ─────────────────────
		"frosted-juniper-dark":  {Name: "Frosted Juniper [dark]", TextPrimary: "#C8E0E8", TextSecondary: "#98C0D0", TextTertiary: "#78A8B8", BackgroundPrimary: "#0A1014", BackgroundSecondary: "#101820", BackgroundDots: "#183028", BackgroundModal: "rgba(10, 16, 20, 0.88)", BorderPrimary: "#3A6878", BorderSecondary: "#284858", AccentSuccess: "#508878", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"frosted-juniper-light": {Name: "Frosted Juniper [light]", TextPrimary: "#1A4048", TextSecondary: "#3D6878", TextTertiary: "#508898", BackgroundPrimary: "#F5FAFA", BackgroundSecondary: "#E8F4F4", BackgroundDots: "#D8F0F0", BackgroundModal: "rgba(245, 250, 250, 0.92)", BorderPrimary: "#98C8D0", BorderSecondary: "#78B0C0", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Candlelit Study: warm tallow glow on dark oak ─────────────────────
		"candlelit-study-dark":  {Name: "Candlelit Study [dark]", TextPrimary: "#F0E0B8", TextSecondary: "#D8C088", TextTertiary: "#C8A860", BackgroundPrimary: "#100C08", BackgroundSecondary: "#1A1410", BackgroundDots: "#281E14", BackgroundModal: "rgba(16, 12, 8, 0.90)", BorderPrimary: "#584828", BorderSecondary: "#403818", AccentSuccess: "#F0C848", AccentWarning: "#F59E0B", AccentError: "#F87171"},
		"candlelit-study-light": {Name: "Candlelit Study [light]", TextPrimary: "#3A2818", TextSecondary: "#6B5030", TextTertiary: "#886838", BackgroundPrimary: "#FFF8F0", BackgroundSecondary: "#F8EED8", BackgroundDots: "#F0E0C0", BackgroundModal: "rgba(255, 248, 240, 0.92)", BorderPrimary: "#D8C098", BorderSecondary: "#C8A878", AccentSuccess: "#92400E", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Electric Orchid: neon magenta bloom on near-black ─────────────────
		"electric-orchid-dark":  {Name: "Electric Orchid [dark]", TextPrimary: "#FFD0FF", TextSecondary: "#FF90FF", TextTertiary: "#FF60FF", BackgroundPrimary: "#0C040C", BackgroundSecondary: "#180818", BackgroundDots: "#280C28", BackgroundModal: "rgba(12, 4, 12, 0.90)", BorderPrimary: "#CC00CC", BorderSecondary: "#990099", AccentSuccess: "#00FFFF", AccentWarning: "#FBBF24", AccentError: "#FF4488"},
		"electric-orchid-light": {Name: "Electric Orchid [light]", TextPrimary: "#600060", TextSecondary: "#A020A0", TextTertiary: "#C030C0", BackgroundPrimary: "#FDF5FF", BackgroundSecondary: "#F8E8FF", BackgroundDots: "#F0D0FF", BackgroundModal: "rgba(253, 245, 255, 0.92)", BorderPrimary: "#E880E8", BorderSecondary: "#D060D0", AccentSuccess: "#0891B2", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Sea Glass: frosted teal washed up on warm sand ────────────────────
		"sea-glass-dark":  {Name: "Sea Glass [dark]", TextPrimary: "#B8E0D0", TextSecondary: "#98D0B8", TextTertiary: "#78C0A8", BackgroundPrimary: "#101814", BackgroundSecondary: "#182420", BackgroundDots: "#284038", BackgroundModal: "rgba(16, 24, 20, 0.88)", BorderPrimary: "#4A8878", BorderSecondary: "#386858", AccentSuccess: "#A8D8C8", AccentWarning: "#F59E0B", AccentError: "#FB7185"},
		"sea-glass-light": {Name: "Sea Glass [light]", TextPrimary: "#285848", TextSecondary: "#4A8878", TextTertiary: "#68A898", BackgroundPrimary: "#FAF8F0", BackgroundSecondary: "#F0F0E8", BackgroundDots: "#E0F0E8", BackgroundModal: "rgba(250, 248, 240, 0.92)", BorderPrimary: "#A8D8C8", BorderSecondary: "#88C8B0", AccentSuccess: "#14B8A6", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Graphite Prism: neutral grey with subtle rainbow borders ──────────
		"graphite-prism-dark":  {Name: "Graphite Prism [dark]", TextPrimary: "#E0E0E8", TextSecondary: "#B8B8C8", TextTertiary: "#9898A8", BackgroundPrimary: "#101014", BackgroundSecondary: "#181820", BackgroundDots: "#242430", BackgroundModal: "rgba(16, 16, 20, 0.88)", BorderPrimary: "#FF6B8A", BorderSecondary: "#6B8AFF", AccentSuccess: "#78FFAA", AccentWarning: "#FFD060", AccentError: "#FF7080"},
		"graphite-prism-light": {Name: "Graphite Prism [light]", TextPrimary: "#282830", TextSecondary: "#585868", TextTertiary: "#787888", BackgroundPrimary: "#F8F8FA", BackgroundSecondary: "#EEEEF2", BackgroundDots: "#E0E0E8", BackgroundModal: "rgba(248, 248, 250, 0.92)", BorderPrimary: "#E879A8", BorderSecondary: "#7888E8", AccentSuccess: "#059669", AccentWarning: "#D97706", AccentError: "#BE123C"},

		// ── Midnight Firefly: deep navy garden with lime firefly glow ──────────
		"midnight-firefly-dark":  {Name: "Midnight Firefly [dark]", TextPrimary: "#C8D8C0", TextSecondary: "#A8C898", TextTertiary: "#88A878", BackgroundPrimary: "#060810", BackgroundSecondary: "#0C1018", BackgroundDots: "#101820", BackgroundModal: "rgba(6, 8, 16, 0.88)", BorderPrimary: "#3A5838", BorderSecondary: "#284028", AccentSuccess: "#C8FF40", AccentWarning: "#FBBF24", AccentError: "#FB7185"},
		"midnight-firefly-light": {Name: "Midnight Firefly [light]", TextPrimary: "#1A2818", TextSecondary: "#3A5838", TextTertiary: "#587858", BackgroundPrimary: "#F5F8F0", BackgroundSecondary: "#EAF0E0", BackgroundDots: "#E8F0D8", BackgroundModal: "rgba(245, 248, 240, 0.92)", BorderPrimary: "#A8C898", BorderSecondary: "#88B078", AccentSuccess: "#65A30D", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Blueprint: draughtsman's cyanotype, white rule on process blue ─────
		"blueprint-dark":  {Name: "Blueprint [dark]", TextPrimary: "#EAF2FF", TextSecondary: "#A8C4E8", TextTertiary: "#7A9CC8", BackgroundPrimary: "#0A1A38", BackgroundSecondary: "#0F2450", BackgroundDots: "#1A3A70", BackgroundModal: "rgba(10, 26, 56, 0.9)", BorderPrimary: "#4A7ABF", BorderSecondary: "#2A4E80", AccentSuccess: "#5EEAD4", AccentWarning: "#FDE047", AccentError: "#FF8FA3"},
		"blueprint-light": {Name: "Blueprint [light]", TextPrimary: "#0F2450", TextSecondary: "#1E4585", TextTertiary: "#3A6AAF", BackgroundPrimary: "#EEF4FC", BackgroundSecondary: "#DEE9F8", BackgroundDots: "#C4D8F0", BackgroundModal: "rgba(238, 244, 252, 0.93)", BorderPrimary: "#9EBEE4", BorderSecondary: "#6E9AD0", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Oxblood Leather: club chair burgundy over tobacco ──────────────────
		"oxblood-leather-dark":  {Name: "Oxblood Leather [dark]", TextPrimary: "#F0DCD4", TextSecondary: "#D0A898", TextTertiary: "#A87868", BackgroundPrimary: "#1A0C0A", BackgroundSecondary: "#281410", BackgroundDots: "#3A1E18", BackgroundModal: "rgba(26, 12, 10, 0.9)", BorderPrimary: "#6B2820", BorderSecondary: "#4A1C16", AccentSuccess: "#94BC7E", AccentWarning: "#D9A441", AccentError: "#E86A5C"},
		"oxblood-leather-light": {Name: "Oxblood Leather [light]", TextPrimary: "#3A1410", TextSecondary: "#6B2820", TextTertiary: "#8E4436", BackgroundPrimary: "#FDF6F2", BackgroundSecondary: "#F6E8E0", BackgroundDots: "#EBD4C8", BackgroundModal: "rgba(253, 246, 242, 0.93)", BorderPrimary: "#DDB8A6", BorderSecondary: "#C89680", AccentSuccess: "#4D7C0F", AccentWarning: "#A16207", AccentError: "#9F1239"},

		// ── Ultraviolet: blacklight poster, near-black with violet bloom ───────
		"ultraviolet-dark":  {Name: "Ultraviolet [dark]", TextPrimary: "#EDE4FF", TextSecondary: "#C4A8FF", TextTertiary: "#9070E0", BackgroundPrimary: "#08040F", BackgroundSecondary: "#120A20", BackgroundDots: "#241040", BackgroundModal: "rgba(8, 4, 15, 0.92)", BorderPrimary: "#7B2FF7", BorderSecondary: "#4B1C99", AccentSuccess: "#3DFFC0", AccentWarning: "#FFD24A", AccentError: "#FF4D8D"},
		"ultraviolet-light": {Name: "Ultraviolet [light]", TextPrimary: "#2A0F52", TextSecondary: "#4B1C99", TextTertiary: "#7B3FD0", BackgroundPrimary: "#FAF6FF", BackgroundSecondary: "#F2EAFF", BackgroundDots: "#E4D4FF", BackgroundModal: "rgba(250, 246, 255, 0.93)", BorderPrimary: "#D0B8F8", BorderSecondary: "#B090EE", AccentSuccess: "#0D9488", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Foundry Iron: hot steel on cold cast iron, industrial ──────────────
		"foundry-iron-dark":  {Name: "Foundry Iron [dark]", TextPrimary: "#E8E4E0", TextSecondary: "#B0A8A0", TextTertiary: "#807870", BackgroundPrimary: "#0E0E0D", BackgroundSecondary: "#191817", BackgroundDots: "#282624", BackgroundModal: "rgba(14, 14, 13, 0.9)", BorderPrimary: "#4A4440", BorderSecondary: "#332F2C", AccentSuccess: "#8FBF6F", AccentWarning: "#FF8C1A", AccentError: "#E04030"},
		"foundry-iron-light": {Name: "Foundry Iron [light]", TextPrimary: "#22201E", TextSecondary: "#4A4440", TextTertiary: "#6E6862", BackgroundPrimary: "#F7F6F4", BackgroundSecondary: "#EDEAE6", BackgroundDots: "#DDD8D2", BackgroundModal: "rgba(247, 246, 244, 0.93)", BorderPrimary: "#C8C2BA", BorderSecondary: "#A69E96", AccentSuccess: "#4D7C0F", AccentWarning: "#C2410C", AccentError: "#B91C1C"},

		// ── Peacock: iridescent teal-to-indigo with gold eye ───────────────────
		"peacock-dark":  {Name: "Peacock [dark]", TextPrimary: "#DFF6F4", TextSecondary: "#7FD8D0", TextTertiary: "#4FA8B8", BackgroundPrimary: "#04141A", BackgroundSecondary: "#08242E", BackgroundDots: "#0C3848", BackgroundModal: "rgba(4, 20, 26, 0.9)", BorderPrimary: "#127C8E", BorderSecondary: "#0B4E5C", AccentSuccess: "#2DD4BF", AccentWarning: "#E8B33C", AccentError: "#F0607A"},
		"peacock-light": {Name: "Peacock [light]", TextPrimary: "#06343E", TextSecondary: "#0B5A6C", TextTertiary: "#128298", BackgroundPrimary: "#F2FBFC", BackgroundSecondary: "#E2F5F6", BackgroundDots: "#C8EAEC", BackgroundModal: "rgba(242, 251, 252, 0.93)", BorderPrimary: "#A2DCE2", BorderSecondary: "#6EC2CC", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Bone China: warm off-white porcelain with cobalt hairline ──────────
		"bone-china-dark":  {Name: "Bone China [dark]", TextPrimary: "#F2EEE6", TextSecondary: "#CFC8BC", TextTertiary: "#9E968A", BackgroundPrimary: "#161512", BackgroundSecondary: "#201E1A", BackgroundDots: "#2C2924", BackgroundModal: "rgba(22, 21, 18, 0.9)", BorderPrimary: "#4E5A80", BorderSecondary: "#38404F", AccentSuccess: "#7FB88A", AccentWarning: "#DCA84E", AccentError: "#D9707A"},
		"bone-china-light": {Name: "Bone China [light]", TextPrimary: "#2A2620", TextSecondary: "#565046", TextTertiary: "#807868", BackgroundPrimary: "#FDFBF5", BackgroundSecondary: "#F6F2E8", BackgroundDots: "#E8E2D4", BackgroundModal: "rgba(253, 251, 245, 0.94)", BorderPrimary: "#8FA0C8", BorderSecondary: "#B8AE9C", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#B91C1C"},

		// ── Chartreuse Static: acid yellow-green on tuned-out grey ─────────────
		"chartreuse-static-dark":  {Name: "Chartreuse Static [dark]", TextPrimary: "#E8FFC0", TextSecondary: "#C4F060", TextTertiary: "#8CB040", BackgroundPrimary: "#101208", BackgroundSecondary: "#1A1E0E", BackgroundDots: "#283014", BackgroundModal: "rgba(16, 18, 8, 0.9)", BorderPrimary: "#5E7420", BorderSecondary: "#3E4C16", AccentSuccess: "#B4FF2E", AccentWarning: "#FFC400", AccentError: "#FF5C4D"},
		"chartreuse-static-light": {Name: "Chartreuse Static [light]", TextPrimary: "#242A0C", TextSecondary: "#48541A", TextTertiary: "#6E7E28", BackgroundPrimary: "#FAFCEE", BackgroundSecondary: "#F2F6DC", BackgroundDots: "#E2ECBC", BackgroundModal: "rgba(250, 252, 238, 0.93)", BorderPrimary: "#C4D480", BorderSecondary: "#A2B858", AccentSuccess: "#4D7C0F", AccentWarning: "#A16207", AccentError: "#B91C1C"},

		// ── Tidal Slate: wet stone and sea foam on a grey shore ────────────────
		"tidal-slate-dark":  {Name: "Tidal Slate [dark]", TextPrimary: "#DCE8E8", TextSecondary: "#A4BCBC", TextTertiary: "#748C8C", BackgroundPrimary: "#0D1414", BackgroundSecondary: "#16201F", BackgroundDots: "#20302E", BackgroundModal: "rgba(13, 20, 20, 0.9)", BorderPrimary: "#3E5654", BorderSecondary: "#2A3C3A", AccentSuccess: "#6ED8B0", AccentWarning: "#D8AC5C", AccentError: "#E0707E"},
		"tidal-slate-light": {Name: "Tidal Slate [light]", TextPrimary: "#1C2A2A", TextSecondary: "#3E5654", TextTertiary: "#5E7A78", BackgroundPrimary: "#F4F8F8", BackgroundSecondary: "#E8F0EF", BackgroundDots: "#D4E2E0", BackgroundModal: "rgba(244, 248, 248, 0.93)", BorderPrimary: "#B4C8C6", BorderSecondary: "#90A8A6", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Marigold Dusk: hot marigold against deepening indigo ───────────────
		"marigold-dusk-dark":  {Name: "Marigold Dusk [dark]", TextPrimary: "#FFE8C8", TextSecondary: "#FFC46A", TextTertiary: "#C08A54", BackgroundPrimary: "#0E0C1A", BackgroundSecondary: "#181428", BackgroundDots: "#241C3C", BackgroundModal: "rgba(14, 12, 26, 0.9)", BorderPrimary: "#6E4A28", BorderSecondary: "#3C3050", AccentSuccess: "#5ED8A0", AccentWarning: "#FFA824", AccentError: "#FF6A6A"},
		"marigold-dusk-light": {Name: "Marigold Dusk [light]", TextPrimary: "#2C2440", TextSecondary: "#8A5A1E", TextTertiary: "#A87A38", BackgroundPrimary: "#FFFAF0", BackgroundSecondary: "#FDF0DC", BackgroundDots: "#F4DEBC", BackgroundModal: "rgba(255, 250, 240, 0.93)", BorderPrimary: "#E8C68E", BorderSecondary: "#CCA46A", AccentSuccess: "#15803D", AccentWarning: "#C2410C", AccentError: "#B91C1C"},

		// ── Cold Cathode: pale mercury-vapour white on blue-black ──────────────
		"cold-cathode-dark":  {Name: "Cold Cathode [dark]", TextPrimary: "#F0FBFF", TextSecondary: "#B8DCEC", TextTertiary: "#7CA8BC", BackgroundPrimary: "#05090E", BackgroundSecondary: "#0B131C", BackgroundDots: "#12202C", BackgroundModal: "rgba(5, 9, 14, 0.92)", BorderPrimary: "#3C6478", BorderSecondary: "#24404E", AccentSuccess: "#7CFFE8", AccentWarning: "#FFE08A", AccentError: "#FF8A9E"},
		"cold-cathode-light": {Name: "Cold Cathode [light]", TextPrimary: "#0E1E28", TextSecondary: "#2E5266", TextTertiary: "#527A90", BackgroundPrimary: "#F6FCFF", BackgroundSecondary: "#E8F4FA", BackgroundDots: "#D2E6F0", BackgroundModal: "rgba(246, 252, 255, 0.93)", BorderPrimary: "#AECEDE", BorderSecondary: "#84AEC2", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#BE123C"},

		// ── Saffron Robe: monastic saffron and madder on undyed cloth ──────────
		"saffron-robe-dark":  {Name: "Saffron Robe [dark]", TextPrimary: "#FFEDD0", TextSecondary: "#F0B860", TextTertiary: "#B88440", BackgroundPrimary: "#160E06", BackgroundSecondary: "#22180C", BackgroundDots: "#342414", BackgroundModal: "rgba(22, 14, 6, 0.9)", BorderPrimary: "#8A4A1C", BorderSecondary: "#5A3212", AccentSuccess: "#9ECC70", AccentWarning: "#F59E0B", AccentError: "#E05A40"},
		"saffron-robe-light": {Name: "Saffron Robe [light]", TextPrimary: "#3A2008", TextSecondary: "#8A4A1C", TextTertiary: "#AE6C2E", BackgroundPrimary: "#FFF9EE", BackgroundSecondary: "#FCEED6", BackgroundDots: "#F2DCB4", BackgroundModal: "rgba(255, 249, 238, 0.93)", BorderPrimary: "#E4BC84", BorderSecondary: "#CC9A58", AccentSuccess: "#4D7C0F", AccentWarning: "#C2410C", AccentError: "#B91C1C"},

		// ── Static Noise: pure greyscale, no hue anywhere ──────────────────────
		"static-noise-dark":  {Name: "Static Noise [dark]", TextPrimary: "#FFFFFF", TextSecondary: "#B4B4B4", TextTertiary: "#787878", BackgroundPrimary: "#000000", BackgroundSecondary: "#0E0E0E", BackgroundDots: "#1E1E1E", BackgroundModal: "rgba(0, 0, 0, 0.92)", BorderPrimary: "#5A5A5A", BorderSecondary: "#323232", AccentSuccess: "#DCDCDC", AccentWarning: "#A0A0A0", AccentError: "#F0F0F0"},
		"static-noise-light": {Name: "Static Noise [light]", TextPrimary: "#000000", TextSecondary: "#4A4A4A", TextTertiary: "#7A7A7A", BackgroundPrimary: "#FFFFFF", BackgroundSecondary: "#F2F2F2", BackgroundDots: "#DCDCDC", BackgroundModal: "rgba(255, 255, 255, 0.94)", BorderPrimary: "#B4B4B4", BorderSecondary: "#8C8C8C", AccentSuccess: "#2A2A2A", AccentWarning: "#6A6A6A", AccentError: "#0A0A0A"},

		// ── Absinthe: cloudy anise green over smoked glass ─────────────────────
		"absinthe-dark":  {Name: "Absinthe [dark]", TextPrimary: "#E4F4D8", TextSecondary: "#B0D890", TextTertiary: "#7CA060", BackgroundPrimary: "#0C1008", BackgroundSecondary: "#141C10", BackgroundDots: "#1E2C18", BackgroundModal: "rgba(12, 16, 8, 0.9)", BorderPrimary: "#48682C", BorderSecondary: "#2E441C", AccentSuccess: "#96E04C", AccentWarning: "#E0C040", AccentError: "#E0705C"},
		"absinthe-light": {Name: "Absinthe [light]", TextPrimary: "#1E2C10", TextSecondary: "#3E5A20", TextTertiary: "#62803C", BackgroundPrimary: "#F8FCF0", BackgroundSecondary: "#EEF6E0", BackgroundDots: "#DCEAC4", BackgroundModal: "rgba(248, 252, 240, 0.93)", BorderPrimary: "#BCD498", BorderSecondary: "#9CBA70", AccentSuccess: "#4D7C0F", AccentWarning: "#A16207", AccentError: "#B91C1C"},

		// ── Tyrian: imperial purple with true gold, high ceremony ──────────────
		"tyrian-dark":  {Name: "Tyrian [dark]", TextPrimary: "#F6E8F2", TextSecondary: "#D8A8CC", TextTertiary: "#A87098", BackgroundPrimary: "#12060F", BackgroundSecondary: "#1E0C1A", BackgroundDots: "#2E1428", BackgroundModal: "rgba(18, 6, 15, 0.9)", BorderPrimary: "#7A1E5E", BorderSecondary: "#4E1240", AccentSuccess: "#5ECCA0", AccentWarning: "#E0B040", AccentError: "#F05A7E"},
		"tyrian-light": {Name: "Tyrian [light]", TextPrimary: "#380A2C", TextSecondary: "#661A50", TextTertiary: "#903274", BackgroundPrimary: "#FDF6FB", BackgroundSecondary: "#F8E8F4", BackgroundDots: "#EED2E6", BackgroundModal: "rgba(253, 246, 251, 0.93)", BorderPrimary: "#DCAECE", BorderSecondary: "#C286AE", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#9F1239"},

		// ── Harbour Fog: muted grey-blue with a buoy-orange marker ─────────────
		"harbour-fog-dark":  {Name: "Harbour Fog [dark]", TextPrimary: "#DEE6EC", TextSecondary: "#A8B8C4", TextTertiary: "#788894", BackgroundPrimary: "#101418", BackgroundSecondary: "#1A2026", BackgroundDots: "#242E36", BackgroundModal: "rgba(16, 20, 24, 0.9)", BorderPrimary: "#3E4E5A", BorderSecondary: "#2A3640", AccentSuccess: "#68C0A0", AccentWarning: "#FF8C42", AccentError: "#E4606E"},
		"harbour-fog-light": {Name: "Harbour Fog [light]", TextPrimary: "#1C242C", TextSecondary: "#3E4E5A", TextTertiary: "#647482", BackgroundPrimary: "#F5F7F9", BackgroundSecondary: "#E9EEF2", BackgroundDots: "#D6DEE6", BackgroundModal: "rgba(245, 247, 249, 0.93)", BorderPrimary: "#BCC8D2", BorderSecondary: "#98A8B6", AccentSuccess: "#0F766E", AccentWarning: "#C2410C", AccentError: "#BE123C"},

		// ── Ember Ash: cooling charcoal shot through with live embers ──────────
		"ember-ash-dark":  {Name: "Ember Ash [dark]", TextPrimary: "#F0E0D8", TextSecondary: "#C89888", TextTertiary: "#8E6458", BackgroundPrimary: "#0A0808", BackgroundSecondary: "#161010", BackgroundDots: "#281818", BackgroundModal: "rgba(10, 8, 8, 0.92)", BorderPrimary: "#7A2E1A", BorderSecondary: "#441A10", AccentSuccess: "#88C070", AccentWarning: "#FF7A18", AccentError: "#FF4530"},
		"ember-ash-light": {Name: "Ember Ash [light]", TextPrimary: "#2A1A16", TextSecondary: "#5A3228", TextTertiary: "#845444", BackgroundPrimary: "#FCF6F4", BackgroundSecondary: "#F4E8E2", BackgroundDots: "#E6D0C8", BackgroundModal: "rgba(252, 246, 244, 0.93)", BorderPrimary: "#D8B0A0", BorderSecondary: "#BE8C78", AccentSuccess: "#4D7C0F", AccentWarning: "#C2410C", AccentError: "#B91C1C"},

		// ── Iris Meadow: soft blue-violet petals over damp green ───────────────
		"iris-meadow-dark":  {Name: "Iris Meadow [dark]", TextPrimary: "#E8E4FA", TextSecondary: "#B4AEE8", TextTertiary: "#8A86B0", BackgroundPrimary: "#0C0E16", BackgroundSecondary: "#161A26", BackgroundDots: "#222840", BackgroundModal: "rgba(12, 14, 22, 0.9)", BorderPrimary: "#4A4E86", BorderSecondary: "#32365E", AccentSuccess: "#72C88E", AccentWarning: "#E4B84E", AccentError: "#E8708E"},
		"iris-meadow-light": {Name: "Iris Meadow [light]", TextPrimary: "#1E2038", TextSecondary: "#43467E", TextTertiary: "#6A6EA6", BackgroundPrimary: "#F8F8FE", BackgroundSecondary: "#EEEEFA", BackgroundDots: "#DCDCF2", BackgroundModal: "rgba(248, 248, 254, 0.93)", BorderPrimary: "#C0C0E8", BorderSecondary: "#9E9ED2", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Salt Flat: bleached white expanse with mineral pink ────────────────
		"salt-flat-dark":  {Name: "Salt Flat [dark]", TextPrimary: "#F4F0EE", TextSecondary: "#CCC0BC", TextTertiary: "#968884", BackgroundPrimary: "#14100E", BackgroundSecondary: "#1E1A18", BackgroundDots: "#2C2624", BackgroundModal: "rgba(20, 16, 14, 0.9)", BorderPrimary: "#6A5652", BorderSecondary: "#463A36", AccentSuccess: "#8CC8A8", AccentWarning: "#E0B478", AccentError: "#E88A94"},
		"salt-flat-light": {Name: "Salt Flat [light]", TextPrimary: "#2A2422", TextSecondary: "#564A46", TextTertiary: "#82726E", BackgroundPrimary: "#FEFCFB", BackgroundSecondary: "#F6F0EE", BackgroundDots: "#E8DCD8", BackgroundModal: "rgba(254, 252, 251, 0.94)", BorderPrimary: "#DCC8C4", BorderSecondary: "#C0A8A4", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Signal Flare: near-black with a single hot magenta signal ──────────
		"signal-flare-dark":  {Name: "Signal Flare [dark]", TextPrimary: "#F4E8F0", TextSecondary: "#C898B8", TextTertiary: "#8E6480", BackgroundPrimary: "#08070A", BackgroundSecondary: "#121016", BackgroundDots: "#201A26", BackgroundModal: "rgba(8, 7, 10, 0.92)", BorderPrimary: "#B4128C", BorderSecondary: "#6A0A54", AccentSuccess: "#3EE0B0", AccentWarning: "#FFB020", AccentError: "#FF2D8E"},
		"signal-flare-light": {Name: "Signal Flare [light]", TextPrimary: "#22101C", TextSecondary: "#6A0A54", TextTertiary: "#9E2A80", BackgroundPrimary: "#FEF7FC", BackgroundSecondary: "#F8EAF4", BackgroundDots: "#EED2E4", BackgroundModal: "rgba(254, 247, 252, 0.93)", BorderPrimary: "#E2A8CE", BorderSecondary: "#C87AAC", AccentSuccess: "#0F766E", AccentWarning: "#B45309", AccentError: "#C2185B"},

		// ── Olive Drab: field-jacket olive with khaki webbing ──────────────────
		"olive-drab-dark":  {Name: "Olive Drab [dark]", TextPrimary: "#E4E4D0", TextSecondary: "#B4B490", TextTertiary: "#848464", BackgroundPrimary: "#0E100A", BackgroundSecondary: "#181A12", BackgroundDots: "#24281A", BackgroundModal: "rgba(14, 16, 10, 0.9)", BorderPrimary: "#4A5030", BorderSecondary: "#323620", AccentSuccess: "#9CBC5C", AccentWarning: "#D4A032", AccentError: "#D46A50"},
		"olive-drab-light": {Name: "Olive Drab [light]", TextPrimary: "#242814", TextSecondary: "#4A5030", TextTertiary: "#70784C", BackgroundPrimary: "#FAFAF2", BackgroundSecondary: "#F0F0E2", BackgroundDots: "#DEDEC6", BackgroundModal: "rgba(250, 250, 242, 0.93)", BorderPrimary: "#C4C49C", BorderSecondary: "#A4A478", AccentSuccess: "#4D7C0F", AccentWarning: "#A16207", AccentError: "#B91C1C"},

		// ── Porcelain Blue: delft cobalt on glazed white, few midtones ─────────
		"porcelain-blue-dark":  {Name: "Porcelain Blue [dark]", TextPrimary: "#E8EEF8", TextSecondary: "#A8BEDC", TextTertiary: "#7088A8", BackgroundPrimary: "#0A0E16", BackgroundSecondary: "#141A26", BackgroundDots: "#1E2A3E", BackgroundModal: "rgba(10, 14, 22, 0.9)", BorderPrimary: "#2E5A96", BorderSecondary: "#1E3A62", AccentSuccess: "#6EC8C0", AccentWarning: "#D8B058", AccentError: "#DE6A82"},
		"porcelain-blue-light": {Name: "Porcelain Blue [light]", TextPrimary: "#12243E", TextSecondary: "#2E5A96", TextTertiary: "#5480B4", BackgroundPrimary: "#FCFDFF", BackgroundSecondary: "#EFF4FC", BackgroundDots: "#D8E4F4", BackgroundModal: "rgba(252, 253, 255, 0.94)", BorderPrimary: "#B4CCE8", BorderSecondary: "#8AAEDA", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#BE123C"},

		// ── Tarnished Brass: green-black patina under dull brass ───────────────
		"tarnished-brass-dark":  {Name: "Tarnished Brass [dark]", TextPrimary: "#EFE6C8", TextSecondary: "#C4B078", TextTertiary: "#8E8050", BackgroundPrimary: "#0E1210", BackgroundSecondary: "#161C18", BackgroundDots: "#202A24", BackgroundModal: "rgba(14, 18, 16, 0.9)", BorderPrimary: "#6A6234", BorderSecondary: "#3E4432", AccentSuccess: "#7EC49A", AccentWarning: "#C8A034", AccentError: "#D4685E"},
		"tarnished-brass-light": {Name: "Tarnished Brass [light]", TextPrimary: "#242A1E", TextSecondary: "#5A5432", TextTertiary: "#847A4C", BackgroundPrimary: "#FBFAF2", BackgroundSecondary: "#F2F0E0", BackgroundDots: "#E0DCC2", BackgroundModal: "rgba(251, 250, 242, 0.93)", BorderPrimary: "#CCC28E", BorderSecondary: "#AEA46C", AccentSuccess: "#15803D", AccentWarning: "#A16207", AccentError: "#B91C1C"},

		// ── Storm Petrel: seabird white and slate over deep ocean grey ─────────
		"storm-petrel-dark":  {Name: "Storm Petrel [dark]", TextPrimary: "#EAEEF0", TextSecondary: "#AEBAC0", TextTertiary: "#7A868C", BackgroundPrimary: "#0B0E10", BackgroundSecondary: "#141A1E", BackgroundDots: "#1E262C", BackgroundModal: "rgba(11, 14, 16, 0.9)", BorderPrimary: "#42525A", BorderSecondary: "#2A363C", AccentSuccess: "#64C4B4", AccentWarning: "#D8A44C", AccentError: "#DC6C7C"},
		"storm-petrel-light": {Name: "Storm Petrel [light]", TextPrimary: "#181E22", TextSecondary: "#42525A", TextTertiary: "#6A7A82", BackgroundPrimary: "#F7F9FA", BackgroundSecondary: "#EBEFF2", BackgroundDots: "#D8E0E4", BackgroundModal: "rgba(247, 249, 250, 0.93)", BorderPrimary: "#BECAD0", BorderSecondary: "#9AAAB2", AccentSuccess: "#0F766E", AccentWarning: "#A16207", AccentError: "#BE123C"},
	}
}

func isValidThemeID(themeID string) bool {
	if themeID == "dark" || themeID == "light" {
		return true
	}
	_, exists := getDefaultBuiltInThemes()[themeID]
	return exists
}

// isValidThemeIDFor reports whether themeID names a theme this store can
// render: the light/dark pair, a packaged theme, or one the user built.
//
// isValidThemeID alone only knows the packaged ones, so saving a custom theme
// was silently rewritten to the default and the choice never stuck. Reads
// colors.json directly rather than calling GetColors, which takes the same
// mutex the settings paths already hold.
func (fs *FileStore) isValidThemeIDFor(themeID string) bool {
	if isValidThemeID(themeID) {
		return true
	}
	if themeID == "" {
		return false
	}
	data, err := os.ReadFile(fs.colorsFile)
	if err != nil {
		return false
	}
	var colors ColorTheme
	if err := json.Unmarshal(data, &colors); err != nil {
		return false
	}
	_, exists := colors.Custom[themeID]
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
	if fs.readCache.colorsOK {
		colors := fs.readCache.colors
		fs.mutex.RUnlock()
		return colors
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.colorsOK {
		return fs.readCache.colors
	}

	fs.ensureDataDir()

	data, err := os.ReadFile(fs.colorsFile)
	if err != nil {
		colors := getDefaultColors()
		fs.readCache.colors = colors
		fs.readCache.colorsOK = true
		return colors
	}

	var colors ColorTheme
	if err := json.Unmarshal(data, &colors); err != nil {
		colors := getDefaultColors()
		fs.readCache.colors = colors
		fs.readCache.colorsOK = true
		return colors
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

	fs.readCache.colors = colors
	fs.readCache.colorsOK = true
	return colors
}

func (fs *FileStore) SaveColors(colors ColorTheme) error {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	if colors.BuiltIn == nil {
		colors.BuiltIn = make(map[string]ThemeColors)
	}
	for themeID, themeColors := range getDefaultBuiltInThemes() {
		if _, ok := colors.BuiltIn[themeID]; !ok {
			colors.BuiltIn[themeID] = themeColors
		}
	}
	if colors.Custom == nil {
		colors.Custom = map[string]ThemeColors{}
	}

	return fs.writeStoreJSONFile(fs.colorsFile, colors, 0)
}

type HealthSummary struct {
	TotalBookmarks int `json:"totalBookmarks"`
	HealthyCount   int `json:"healthyCount"`
	BrokenCount    int `json:"brokenCount"`
	// MonitorDownCount is monitored bookmarks that are unreachable right now,
	// counted apart from BrokenCount so the header can flag a live outage
	// distinctly from an ordinary dead link. A down monitor is not also in
	// BrokenCount — it is one or the other, never both, so totals stay honest.
	MonitorDownCount int `json:"monitorDownCount"`
	// ContentCount is bookmarks whose host answered but whose own expectation —
	// a required string, an expected status code — was not met. Counted apart
	// from BrokenCount and MonitorDownCount for the same reason those two are
	// kept apart: a bookmark is in exactly one of the three, so the tiles add up.
	ContentCount          int `json:"contentCount"`
	MonitoredCount        int `json:"monitoredCount"`
	DuplicateCount        int `json:"duplicateCount"`
	UncheckedCount        int `json:"uncheckedCount"`
	StaleCount            int `json:"staleCount"`
	MissingPreviewCount   int `json:"missingPreviewCount"`
	UnusedCount           int `json:"unusedCount"`
	ShortcutConflictCount int `json:"shortcutConflictCount"`
	// OrphanedCategoryCount is bookmarks whose Category id matches no category
	// on their own page — the category was deleted without moving them. They
	// still work and still open; they have just dropped out of the structure,
	// which is invisible on the dashboard because uncategorized and
	// orphaned-category rows land in the same place.
	OrphanedCategoryCount int `json:"orphanedCategoryCount"`
	PinnedCount           int `json:"pinnedCount"`
	// DriftCount is bookmarks currently flagged by rot detection — a redirect,
	// title, or content change since the watched baseline. Layered on top of
	// whatever other status a bookmark has, so it is not one of the three
	// mutually exclusive broken/content/monitorDown counts above.
	DriftCount int `json:"driftCount"`
}

type HealthReason struct {
	Code   string            `json:"code"`
	Params map[string]string `json:"params,omitempty"`
	Detail string            `json:"detail,omitempty"`
	// Penalty is the score this reason costs. Sent so the UI can explain a score
	// instead of restating the deductions in JS, where they would drift.
	Penalty int `json:"penalty,omitempty"`
}

type HealthIssue struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Shortcut    string `json:"shortcut,omitempty"`
	Category    string `json:"category,omitempty"`
	PageID      int    `json:"pageId"`
	PageName    string `json:"pageName,omitempty"`
	Index       int    `json:"index"`
	Pinned      bool   `json:"pinned"`
	CheckStatus bool   `json:"checkStatus"`
	OpenCount   int    `json:"openCount"`
	LastOpened  int64  `json:"lastOpened,omitempty"`
	LastChecked int64  `json:"lastChecked,omitempty"`
	LastError   string `json:"lastError,omitempty"`
	// BrokenSince is when this run of failures started, so the row can say how
	// long it has been down rather than only that it is.
	BrokenSince int64 `json:"brokenSince,omitempty"`
	// ArchiveDiedAt is when the web lost the page, which is a different fact
	// from when this install started seeing failures -- see the field of the
	// same name on Bookmark.
	ArchiveDiedAt int64 `json:"archiveDiedAt,omitempty"`
	/*
	 * FailureUncertain marks a failure that says nothing about whether the page
	 * still exists -- a bot check, a rate limit, a timeout.
	 *
	 * Derived per report rather than stored on the bookmark: it is a reading of
	 * LastError, and a second copy would be one more thing to keep in step. One
	 * rule decides it here, so the row, the archive backfill and anything
	 * counting rot cannot disagree about what a 403 means.
	 */
	FailureUncertain bool `json:"failureUncertain,omitempty"`
	/*
	 * LocalCopies is how many whole-page copies are stored here for this URL.
	 *
	 * Counted once for the whole report rather than asked per row: the health
	 * view renders in a loop, and a request per row to answer "is there a copy"
	 * would be a hundred round trips to draw one screen.
	 */
	LocalCopies int `json:"localCopies,omitempty"`
	// LocalCopyAt is when the newest of them was saved, so a row can say how
	// fresh the fallback is rather than only that one exists.
	LocalCopyAt  int64  `json:"localCopyAt,omitempty"`
	PreviewTitle string `json:"previewTitle,omitempty"`
	PreviewDesc  string `json:"previewDesc,omitempty"`
	PreviewImage string `json:"previewImage,omitempty"`
	Icon         string `json:"icon,omitempty"`
	// Status is the single worst thing about this bookmark, picked by priority.
	// It drives how the row is presented — colour band, sort rank, headline
	// reason — so it stays one value.
	Status string `json:"status"`
	// Flags is every condition that holds, not just the worst one. The summary
	// counters are tallied the same way, so a bookmark that is both a duplicate
	// and never opened is counted under Unused *and* appears when that filter is
	// picked. Matching filters on Status instead made the two disagree: the tile
	// counted it, the filter did not list it, and the tile became a dead end.
	Flags          []string       `json:"flags,omitempty"`
	Score          int            `json:"score"`
	Reasons        []string       `json:"reasons"`
	ReasonDetails  []HealthReason `json:"reasonDetails,omitempty"`
	DuplicateCount int            `json:"duplicateCount"`
	// Monitor reflects the uptime-monitor tier. MonitorStats is populated only for
	// monitored bookmarks that have history, keeping the report payload unchanged
	// for everyone who never turns monitoring on.
	Monitor bool `json:"monitor,omitempty"`
	// MonitorIntervalMinutes is the configured cadence, set whenever Monitor is
	// true regardless of whether any samples exist yet. Deliberately separate
	// from MonitorStats: that struct is derived from sample history and is nil
	// until the first check completes, but the interval is a setting, not a
	// measurement — a freshly-monitored or just-changed row must show the right
	// value immediately, not only once a check has run at the new cadence.
	MonitorIntervalMinutes int           `json:"monitorIntervalMinutes,omitempty"`
	MonitorStats           *MonitorStats `json:"monitorStats,omitempty"`
	// What this bookmark expects of a good response, so the row can show and
	// edit it. Omitted when unset, which is virtually every bookmark.
	ExpectText       string `json:"expectText,omitempty"`
	ExpectTextAbsent bool   `json:"expectTextAbsent,omitempty"`
	ExpectStatus     string `json:"expectStatus,omitempty"`
	// Rot signals: where the check lands after redirects, what the page is
	// titled, and roughly what it says, versus the baseline recorded when
	// watching began. Empty DriftNoticed means the page still looks like itself.
	WatchDrift   bool   `json:"watchDrift,omitempty"`
	DriftNoticed string `json:"driftNoticed,omitempty"`
	DriftReason  string `json:"driftReason,omitempty"`
	DriftSince   int64  `json:"driftSince,omitempty"`
	// NotifyMuted reports that this bookmark's alerts are silenced. The row
	// still shows its real status — muting withholds the message, not the
	// finding — so the view needs this to say so on the row.
	NotifyMuted bool `json:"notifyMuted,omitempty"`
	// CertHost is the hostname to look up in the report's certificates map — the
	// post-redirect host a check actually saw, which can differ from this
	// bookmark's own URL. Empty until a check has recorded one.
	CertHost string `json:"certHost,omitempty"`
}

type BookmarkHealthReport struct {
	GeneratedAt     int64            `json:"generatedAt"`
	Summary         HealthSummary    `json:"summary"`
	Issues          []HealthIssue    `json:"issues"`
	DuplicateGroups []DuplicateGroup `json:"duplicateGroups"`
	// Fleet is the collection-wide monitoring view — pooled uptime, the worst
	// monitors, every outage, and response times that moved. Nil when nothing is
	// monitored, so a report for an install that never enabled monitoring is the
	// same size it always was.
	Fleet *FleetStats `json:"fleet,omitempty"`
	// Trend is one point per day of collection health, oldest first. Read from
	// its own file rather than derived, since it is the only thing here that
	// describes a day other than today.
	Trend []HealthTrendPoint `json:"trend,omitempty"`
	// Certificates are the TLS expiries seen while checking, keyed by host and
	// carrying only those close enough to matter. Sent per host rather than per
	// issue because that is what a certificate belongs to — the rows look
	// themselves up by hostname.
	Certificates map[string]HostCertificate `json:"certificates,omitempty"`
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
	Name      string `json:"name"`
	Index     int    `json:"index"`
	PageID    int    `json:"pageId"`
	Category  string `json:"category,omitempty"`
	OpenCount int    `json:"openCount,omitempty"`
	Pinned    bool   `json:"pinned,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
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

// HostCertificate is the certificate expiry last seen for one host.
//
// Kept per host rather than per bookmark because that is what a certificate
// belongs to: ten bookmarks on one domain share one certificate, and storing it
// per bookmark would warn ten times about a single renewal.
type HostCertificate struct {
	Host      string `json:"host"`
	ExpiresAt int64  `json:"expiresAt"` // Unix ms; 0 means never seen over TLS
	SeenAt    int64  `json:"seenAt"`    // When this was last observed
	// NotifiedDays records the expiry thresholds already alerted on, so a
	// warning fires once per threshold per certificate rather than on every
	// check for days on end. Reset when the expiry moves — a renewal.
	NotifiedDays []int `json:"notifiedDays,omitempty"`
}

type HealthScanCacheFile struct {
	GeneratedAt int64 `json:"generatedAt"`
	// LastAutoRecheck is when the background recheck scheduler last completed a run
	// (Unix ms). Persisted so "is a recheck due?" survives restarts, mirroring how
	// auto-backup compares the newest backup's age rather than an in-process timer.
	LastAutoRecheck int64                      `json:"lastAutoRecheck,omitempty"`
	Cache           map[string]HealthScanCache `json:"cache"` // Keyed by canonical URL
	// Certificates seen while checking, keyed by host. Lives here rather than in
	// its own file because it is written by the same pass that writes the cache
	// and is worthless without it.
	Certificates map[string]HostCertificate `json:"certificates,omitempty"`
}

// HealthSample is one recorded reachability check for a monitored bookmark.
//
// The JSON keys are deliberately terse and the file is written compactly: this is
// the one file in the app that grows per check rather than per bookmark, so a few
// bytes per sample decide whether the history stays a few hundred KB or a few MB.
type HealthSample struct {
	T      int64 `json:"t"`           // Unix milliseconds
	Up     bool  `json:"u"`           // Reachable (HealthScanCache.Status == "online")
	PingMs int   `json:"p,omitempty"` // Response time; 0 when the request never completed
	Code   int   `json:"c,omitempty"` // HTTP status; 0 on a network-level failure
	// Alerted marks the failed sample that triggered a "down" webhook. It makes
	// "this outage has already alerted" a recorded fact rather than something
	// re-derived from a failure count, which manual re-checks and bulk retests
	// also append to. Set on at most one sample per outage, so it stays absent
	// from virtually every sample written.
	Alerted bool `json:"a,omitempty"`
	// Maint marks a sample taken inside a maintenance window. The check still
	// ran and the result is still recorded — the heartbeat should show what
	// actually happened — but uptime ratios skip it, so a nightly backup does not
	// read as a nightly outage.
	Maint bool `json:"m,omitempty"`
	// Fail is why a failed check failed, as a short class: dns, timeout,
	// refused, tls, redirect, content, http, or other. Empty on a sample that
	// succeeded.
	//
	// The engine has always worked this out — classifyPingError runs on every
	// failed check — and then dropped it, so a DNS outage and a refused
	// connection were both recorded as "Up: false, Code: 0" and reached the
	// incident list, the fleet timeline and the CSV export with no cause at all.
	// A class rather than the sentence: the sentence is for a human reading one
	// row, the class is what a list can group and a column can hold.
	Fail string `json:"e,omitempty"`
}

// HealthHistoryFile stores per-URL sample history for monitored bookmarks, kept
// separate from HealthScanCacheFile because it is rewritten on every monitor run
// and would otherwise make the (small, frequently read) health cache expensive.
type HealthHistoryFile struct {
	GeneratedAt int64 `json:"generatedAt"`
	// Samples maps canonical URL to samples in ascending time order.
	Samples map[string][]HealthSample `json:"samples"`
	// Days maps canonical URL to one summary per day, ascending, for the part
	// of the history whose individual checks have been dropped. Raw samples are
	// capped per URL — roughly a week on a five-minute monitor — so before this
	// the "30 days" figure was computed over whatever survived that cap. Folding
	// each day into a summary before dropping it costs a few bytes a day and
	// makes the long windows mean what they say.
	Days map[string][]HealthDay `json:"days,omitempty"`
}

// HealthDay is one URL's day, kept after its individual samples are gone.
//
// Keys are terse for the same reason HealthSample's are: this file is rewritten
// on every monitor run.
type HealthDay struct {
	D int64 `json:"d"`           // Start of the day, Unix milliseconds, UTC
	N int   `json:"n"`           // Checks counted (maintenance samples excluded, as in uptimeRatio)
	U int   `json:"u"`           // How many of them succeeded
	P int   `json:"p,omitempty"` // Mean response time in ms across the successful checks
}

// HealthTrendPoint is one day's summary of the whole collection.
//
// Keys are terse for the same reason HealthSample's are, though this file grows
// per day rather than per check, so it stays tiny either way: one point is a
// handful of integers and 90 of them are a few KB.
type HealthTrendPoint struct {
	T         int64 `json:"t"`           // Unix ms, the start of the day this describes
	Total     int   `json:"n"`           // Bookmarks in the collection
	Healthy   int   `json:"h"`           // Nothing wrong with them
	Broken    int   `json:"b,omitempty"` // Unreachable, excluding monitors
	MonDown   int   `json:"d,omitempty"` // Monitors unreachable right now
	Monitored int   `json:"m,omitempty"`
	Unchecked int   `json:"u,omitempty"`
	Stale     int   `json:"s,omitempty"`
	Unused    int   `json:"x,omitempty"`
	Duplicate int   `json:"p,omitempty"`
	// Untagged and Opens make this a record of the collection rather than only
	// of its health. Statistics could show every figure it has as a number and
	// none of them as a direction: "102 bookmarks" says nothing about whether
	// that is ten more than last week. These two are the ones that move on
	// their own — tagging is the tidying people actually do, and opens are what
	// the library is for — and both were already counted on every report build.
	Untagged int `json:"g,omitempty"`
	Opens    int `json:"o,omitempty"`
	// Score is the average health score across the collection, 0..100. Stored
	// alongside the counts because the header badge shows a percentage healthy
	// while the rows carry scores, and a trend of one cannot be derived from the
	// other.
	Score int `json:"c,omitempty"`
}

// HealthTrendFile is the collection's health over time: one point per day.
//
// Kept apart from the report cache because that is a disposable snapshot of
// right now, rebuilt every few minutes, while this is the only record of what
// yesterday looked like — losing it cannot be undone by rebuilding.
type HealthTrendFile struct {
	GeneratedAt int64 `json:"generatedAt"`
	// Points in ascending time order, at most one per day.
	Points []HealthTrendPoint `json:"points"`
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

// GetDataRevision fingerprints bookmark, category, finder, page, and settings files.
// Content hashes change when data changes; mtimes alone do not affect the revision.
func (fs *FileStore) GetDataRevision() string {
	fs.mutex.RLock()
	if fs.readCache.revisionOK {
		revision := fs.readCache.revision
		fs.mutex.RUnlock()
		return revision
	}
	fs.mutex.RUnlock()

	fs.mutex.Lock()
	defer fs.mutex.Unlock()
	if fs.readCache.revisionOK {
		return fs.readCache.revision
	}

	fs.ensureDataDir()

	paths := []string{
		fs.settingsFile,
		fs.colorsFile,
		fs.pageOrderFile,
		filepath.Join(fs.dataDir, "finders.json"),
		filepath.Join(fs.dataDir, "inbox.json"),
		filepath.Join(fs.dataDir, "trash.json"),
	}

	if entries, err := os.ReadDir(fs.dataDir); err == nil {
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, "bookmarks-") && strings.HasSuffix(name, ".json") {
				paths = append(paths, filepath.Join(fs.dataDir, name))
			}
		}
	}

	sort.Strings(paths)

	hash := sha256.New()
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			hash.Write([]byte(path + ":missing;"))
			continue
		}
		fileHash := sha256.Sum256(data)
		hash.Write([]byte(path + ":"))
		hash.Write(fileHash[:])
		hash.Write([]byte(";"))
	}

	sum := hash.Sum(nil)
	revision := hex.EncodeToString(sum[:8])
	fs.readCache.revision = revision
	fs.readCache.revisionOK = true
	return revision
}

// GetSettingsRevision is a fingerprint of the files that decide how the app
// looks and behaves, as opposed to what is in it.
//
// The whole-data revision already changes when settings.json does, and the
// client's poll only ever reloaded bookmarks, inbox and health on that change —
// so a second device kept showing stale chrome after every config change while
// paying for the poll that could have told it. A separate hash means the poll
// can tell "someone edited a bookmark" from "someone changed a setting" and do
// the right, more expensive thing only for the second.
func (fs *FileStore) GetSettingsRevision() string {
	fs.mutex.Lock()
	defer fs.mutex.Unlock()

	fs.ensureDataDir()

	hash := sha256.New()
	for _, path := range []string{fs.settingsFile, fs.colorsFile} {
		data, err := os.ReadFile(path)
		if err != nil {
			hash.Write([]byte(path + ":missing;"))
			continue
		}
		fileHash := sha256.Sum256(data)
		hash.Write([]byte(path + ":"))
		hash.Write(fileHash[:])
		hash.Write([]byte(";"))
	}
	sum := hash.Sum(nil)
	return hex.EncodeToString(sum[:8])
}
