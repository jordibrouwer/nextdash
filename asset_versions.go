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
	GlassTokensCSS         string
	OverlaysGlassCSS       string
	MobileExperienceCSS    string
	MobileExperienceJS     string
	FeatureSpotlightCSS    string
	FeatureSpotlightJS     string
	LayoutModernNudgeJS    string
	LayoutBetaToastJS      string
	InboxIntroToastJS      string
	InboxIntroModalJS      string
	PreviewCardSpotlightJS string
	HealthBadgeJS          string
	AppNotificationJS      string
	SearchCommandsNewJS    string
	WhatsNewData           string
	DataRevision           string // dashboard data-revision / cross-tab sync bundles

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
	GlassTokensCSS:         "dashboard-d12-row-tokens-1",
	OverlaysGlassCSS:       "whats-new-config-parity-1",
	MobileExperienceCSS:    "phone-layout-6",
	MobileExperienceJS:     "general-split-shell-1",
	FeatureSpotlightCSS:    "c15-reduced-motion-1",
	FeatureSpotlightJS:     "paste-replay-v1",
	LayoutModernNudgeJS:    "layout-versions-2",
	LayoutBetaToastJS:      "layout-beta-toast-1",
	InboxIntroToastJS:      "inbox-intro-toast-3",
	InboxIntroModalJS:      "inbox-intro-modal-4",
	PreviewCardSpotlightJS: "preview-cards-v1",
	HealthBadgeJS:          "health-badge-count-only-1",
	AppNotificationJS:      "toast-grouped-1",
	SearchCommandsNewJS:    "search-commands-new-3-tags-above-fold",
	WhatsNewData:           "whats-new-v147",
	DataRevision:           "data-revision-4",

	AppNotificationCSS:       "app-notification-1",
	SearchCommandsNewCSS:     "search-commands-new-1",
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
