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
	DiscoverabilityJS:      "discoverability-state-1",
	GuidedFlowCSS:          "guided-flow-v5",
	GuidedFlowJS:           "guided-flow-v5",
	GlassTokensCSS:         "glass-row-selection-1",
	OverlaysGlassCSS:       "glass-phase6-1",
	MobileExperienceCSS:    "phone-layout-4",
	MobileExperienceJS:     "phone-layout-4",
	FeatureSpotlightCSS:    "layout-versions-1",
	FeatureSpotlightJS:     "paste-replay-v1",
	LayoutModernNudgeJS:    "layout-versions-2",
	PreviewCardSpotlightJS: "preview-cards-v1",
	HealthBadgeJS:          "health-badge-count-only-1",
	AppNotificationJS:      "toast-grouped-1",
	SearchCommandsNewJS:    "search-commands-new-2",
	WhatsNewData:           "whats-new-v122",
	DataRevision:           "data-revision-2",
}
