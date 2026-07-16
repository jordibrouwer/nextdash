package main

// pageAssetVersions holds cache-bust query tokens shared across dashboard, config, and health.
// Bump a value when the underlying static file changes; all three templates read from here.
type pageAssetVersions struct {
	ThemeCSS               string
	ThemeJS                string
	VisualSettingsJS       string
	SettingsSanitizeJS     string
	DiscoverabilityJS      string
	GuidedFlowCSS          string
	GuidedFlowJS           string
	MobileExperienceCSS    string
	MobileExperienceJS     string
	FeatureSpotlightCSS    string
	FeatureSpotlightJS     string
	LayoutModernNudgeJS    string
	LayoutBetaToastJS      string
	LayoutGlassRemovedJS   string
	LayoutVersionUtilsJS   string
	InboxIntroToastJS      string
	InboxIntroModalJS      string
	PreviewCardSpotlightJS string
	HealthBadgeJS          string
	AppNotificationJS      string
	SearchCommandsNewJS    string
	WhatsNewData           string
	DataRevision           string // dashboard data-revision / cross-tab sync bundles

	// Previously referenced without a cache-bust token, so static_cache.go served
	// them with max-age=86400 and a deploy stayed invisible for up to a day.
	// The head scripts are the sharp end: write-api.js carries write-token auth.
	WriteAPIJS               string
	FontPresetsJS            string
	DeviceSettingsMergeJS    string
	LayoutUtilsJS            string
	ConfigLanguageJS         string
	BookmarkURLUtilsJS       string
	BookmarkPreviewServiceJS string
	BookmarkFormPreviewJS    string
	SearchCommandsRemoveJS   string
	SearchCommandsColumnsJS  string
	SearchCommandsFontSizeJS string
	SearchCommandsThemeJS    string
	SearchCommandsNoteJS     string
	FuzzySearchJS            string
	HyprModeJS               string
	ConfigBookmarksTourJS    string
	SkeletonLoadingJS        string
	ShortcutFormatJS         string
	PWAInstallHintJS         string
	DashboardDeepLinkJS      string
	AnalyticsJS              string
	ModalJS                  string
	StatusJS                 string
	SelectJS                 string
	ReorderJS                string
	ConfigStorageJS          string
	ConfigDataJS             string
	ConfigBookmarkStoreJS    string
	ConfigFontJS             string
	ConfigToursRuntimeJS     string
	ConfigCommandPaletteJS   string
	ConfigSettingInfoJS      string
	PageLayoutSyncJS         string
	DashboardRenderCoreJS    string

	// dashboard.css and dashboard-bookmark-row.css/layout-modern.css each shared a
	// hand-written token with an unrelated file, so bumping one silently moved the other.
	DashboardCSS            string
	DashboardBookmarkRowCSS string
	LayoutModernCSS         string

	// Shared CSS previously served without a cache-bust token. Centralized here
	// so a single bump invalidates the file across dashboard/config/health.
	AppNotificationCSS       string
	SearchCommandsNewCSS     string
	BookmarkFormPreviewCSS   string
	SearchCommandsNoteCSS    string
	SelectCSS                string
	FontSizeCSS              string
	OnboardingCSS            string
	ConfigGeneralTourCSS     string
	EnhancedFeaturesCSS      string
	ModalCSS                 string
	ResponsiveCSS            string
	ConfigButtonsCSS         string
	OverlaysModernCSS        string
	SkeletonLoadingCSS       string
	ReorderCSS               string
	SearchCSS                string
	StatusCSS                string
	DashboardEnhancementsCSS string
	FontsCSS                 string
}

var sharedAssetVersions = pageAssetVersions{
	ThemeCSS:               "bg-dots-layer-2",
	ThemeJS:                "theme-color-meta-1",
	VisualSettingsJS:       "theme-sync-1",
	SettingsSanitizeJS:     "settings-sanitize-1",
	DiscoverabilityJS:      "discoverability-state-4",
	GuidedFlowCSS:          "guided-flow-v5",
	GuidedFlowJS:           "guided-flow-v5",
	MobileExperienceCSS:    "phone-layout-6",
	MobileExperienceJS:     "general-split-shell-1",
	FeatureSpotlightCSS:    "c15-reduced-motion-1",
	FeatureSpotlightJS:     "paste-replay-v1",
	LayoutModernNudgeJS:    "layout-versions-2",
	LayoutBetaToastJS:      "layout-beta-toast-3-outwait-modal",
	LayoutGlassRemovedJS:   "layout-glass-removed-2",
	LayoutVersionUtilsJS:   "glass-removed-1",
	InboxIntroToastJS:      "inbox-intro-toast-4-outwait-modal",
	InboxIntroModalJS:      "inbox-intro-modal-4",
	PreviewCardSpotlightJS: "preview-cards-v1",
	HealthBadgeJS:          "health-badge-count-only-1",
	AppNotificationJS:      "toast-grouped-1",
	SearchCommandsNewJS:    "search-commands-new-5-inline-create",
	WhatsNewData:           "whats-new-v161",
	DataRevision:           "data-revision-8-promo-starvation",

	WriteAPIJS:               "write-api-1",
	FontPresetsJS:            "font-presets-1",
	DeviceSettingsMergeJS:    "device-settings-merge-1",
	LayoutUtilsJS:            "layout-utils-1",
	ConfigLanguageJS:         "config-language-1",
	BookmarkURLUtilsJS:       "bookmark-url-utils-1",
	BookmarkPreviewServiceJS: "bookmark-preview-service-1",
	BookmarkFormPreviewJS:    "bookmark-form-preview-1",
	SearchCommandsRemoveJS:   "search-commands-remove-1",
	SearchCommandsColumnsJS:  "search-commands-columns-1",
	SearchCommandsFontSizeJS: "search-commands-fontsize-1",
	SearchCommandsThemeJS:    "search-commands-theme-1",
	SearchCommandsNoteJS:     "search-commands-note-1",
	FuzzySearchJS:            "fuzzy-search-1",
	HyprModeJS:               "hypr-mode-1",
	ConfigBookmarksTourJS:    "config-bookmarks-tour-1",
	SkeletonLoadingJS:        "skeleton-loading-1",
	ShortcutFormatJS:         "shortcut-format-1",
	PWAInstallHintJS:         "pwa-install-hint-1",
	DashboardDeepLinkJS:      "dashboard-deep-link-edit-2",
	AnalyticsJS:              "analytics-1",
	ModalJS:                  "modal-focus-aria-1",
	StatusJS:                 "status-1",
	SelectJS:                 "select-js-1",
	ReorderJS:                "reorder-js-1",
	ConfigStorageJS:          "config-storage-1",
	ConfigDataJS:             "config-data-1",
	ConfigBookmarkStoreJS:    "config-bookmark-store-1",
	ConfigFontJS:             "config-font-1",
	ConfigToursRuntimeJS:     "config-tours-runtime-1",
	ConfigCommandPaletteJS:   "config-command-palette-1",
	ConfigSettingInfoJS:      "config-setting-info-1",
	PageLayoutSyncJS:         "page-layout-sync-1",
	DashboardRenderCoreJS:    "sort-locked-drag-hint-1",

	DashboardCSS:            "sort-locked-drag-hint-1",
	DashboardBookmarkRowCSS: "dashboard-d12-row-tokens-1",
	LayoutModernCSS:         "dashboard-d12-row-tokens-1",

	AppNotificationCSS:       "app-notification-1",
	SearchCommandsNewCSS:     "search-commands-new-3-inline-create",
	BookmarkFormPreviewCSS:   "bookmark-form-preview-1",
	SearchCommandsNoteCSS:    "search-commands-note-1",
	SelectCSS:                "select-1",
	FontSizeCSS:              "font-size-1",
	OnboardingCSS:            "onboarding-1",
	ConfigGeneralTourCSS:     "general-tour-v4",
	EnhancedFeaturesCSS:      "enhanced-features-1",
	ModalCSS:                 "page-overview-modal-1",
	ResponsiveCSS:            "config-shell-align-1",
	ConfigButtonsCSS:         "config-buttons-1",
	OverlaysModernCSS:        "whats-new-config-parity-1",
	SkeletonLoadingCSS:       "load-faster-1",
	ReorderCSS:               "reorder-1",
	SearchCSS:                "dashboard-whats-new-fab-1",
	StatusCSS:                "dashboard-chrome-c3-1",
	DashboardEnhancementsCSS: "page-overview-modal-1",
	FontsCSS:                 "self-hosted-scp-1",
}
