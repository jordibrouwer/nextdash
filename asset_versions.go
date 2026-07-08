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
}

var sharedAssetVersions = pageAssetVersions{
	ThemeCSS:               "bg-dots-layer-2",
	ThemeJS:                "theme-sync-1",
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
	SearchCommandsNewJS:    "search-commands-new-2",
	WhatsNewData:           "whats-new-v132",
	DataRevision:           "data-revision-4",
}
