package app

/*
The Living group; see theme_groups.go.

Three families whose palette is the starting point, not the whole picture:
static/js/theme-group-living.js reads something real (service health, the
clock, the weather the dashboard already fetched) and moves the page with it.
The colours here are what the page shows before that runs, and what it settles
on when there is nothing to read, so each one has to stand on its own.

Daydrift's runtime stops carry the same AA margin as these (the Playwright
spec walks the whole day), and every family states its text, semantic and
accent colours with enough contrast on both the page and the card.
*/
func livingGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Tidewatch: still teal while everything is up; the edge and the tint warm up when it is not.
		"living-tidewatch-dark":  {Name: "Tidewatch [dark]", TextPrimary: "#E6F2F2", TextSecondary: "#A8C8CB", TextTertiary: "#8FB4B8", BackgroundPrimary: "#0F2A33", BackgroundSecondary: "#16363F", BackgroundDots: "#1C434D", BackgroundModal: "rgba(15, 42, 51, 0.92)", BorderPrimary: "#2C5560", BorderSecondary: "#1E414A", AccentPrimary: "#5FD0C4", AccentSuccess: "#5FD39A", AccentWarning: "#F2C46A", AccentError: "#FF9A6B", SurfaceAlpha: 0.3, SurfaceBlur: 14, RadiusScale: 1.2, LabelWeight: 600, Character: "glass", Depth: "glass", Surface: "glass", Backdrop: "swells"},
		"living-tidewatch-light": {Name: "Tidewatch [light]", TextPrimary: "#0E2A30", TextSecondary: "#335860", TextTertiary: "#47686E", BackgroundPrimary: "#E6F4F3", BackgroundSecondary: "#F6FBFA", BackgroundDots: "#CFE6E4", BackgroundModal: "rgba(230, 244, 243, 0.93)", BorderPrimary: "#B5D3D1", BorderSecondary: "#CFE6E4", AccentPrimary: "#0B6B66", AccentSuccess: "#12704A", AccentWarning: "#8A5A00", AccentError: "#B3401A", SurfaceAlpha: 0.3, SurfaceBlur: 14, RadiusScale: 1.2, LabelWeight: 600, Character: "glass", Depth: "glass", Surface: "glass", Backdrop: "swells"},

		// Daydrift: the noon stop of a palette that walks from dawn to night by the clock.
		"living-daydrift-dark":  {Name: "Daydrift [dark]", TextPrimary: "#F3EEF2", TextSecondary: "#D3C9D6", TextTertiary: "#B5A9BC", BackgroundPrimary: "#0E2438", BackgroundSecondary: "#16334D", BackgroundDots: "#1C3F5E", BackgroundModal: "rgba(14, 36, 56, 0.92)", BorderPrimary: "#2C5578", BorderSecondary: "#1E405C", AccentPrimary: "#8CC8F2", AccentSuccess: "#5FD39A", AccentWarning: "#F0C060", AccentError: "#FF8F7A", SurfaceAlpha: 0.35, SurfaceBlur: 12, RadiusScale: 1.3, LabelWeight: 600, Character: "frost", Depth: "glass", Surface: "glass", Backdrop: "sundial"},
		"living-daydrift-light": {Name: "Daydrift [light]", TextPrimary: "#1A1626", TextSecondary: "#463F5C", TextTertiary: "#554E6E", BackgroundPrimary: "#D6ECFB", BackgroundSecondary: "#EEF7FD", BackgroundDots: "#C2DFF3", BackgroundModal: "rgba(214, 236, 251, 0.93)", BorderPrimary: "#A9CFEA", BorderSecondary: "#C2DFF3", AccentPrimary: "#135B93", AccentSuccess: "#145C38", AccentWarning: "#7E5200", AccentError: "#9C2A16", SurfaceAlpha: 0.35, SurfaceBlur: 12, RadiusScale: 1.3, LabelWeight: 600, Character: "frost", Depth: "glass", Surface: "glass", Backdrop: "sundial"},

		// Skywatch: open sky behind the page; the weather widget's last reading picks which one.
		"living-skywatch-dark":  {Name: "Skywatch [dark]", TextPrimary: "#EAF1FA", TextSecondary: "#B3C6DE", TextTertiary: "#94AACA", BackgroundPrimary: "#0F1B2E", BackgroundSecondary: "#182A44", BackgroundDots: "#20365A", BackgroundModal: "rgba(15, 27, 46, 0.92)", BorderPrimary: "#2F4A72", BorderSecondary: "#213859", AccentPrimary: "#7DC4FF", AccentSuccess: "#5FD39A", AccentWarning: "#F0C060", AccentError: "#FF8F7A", SurfaceAlpha: 0.3, SurfaceBlur: 16, RadiusScale: 1.3, LabelWeight: 600, Character: "frost", Depth: "glass", Surface: "glass", Backdrop: "cloudstrata"},
		"living-skywatch-light": {Name: "Skywatch [light]", TextPrimary: "#10243A", TextSecondary: "#3A5370", TextTertiary: "#4D6684", BackgroundPrimary: "#DCEBFA", BackgroundSecondary: "#F2F8FE", BackgroundDots: "#C6DCF2", BackgroundModal: "rgba(220, 235, 250, 0.93)", BorderPrimary: "#B2CCE8", BorderSecondary: "#C6DCF2", AccentPrimary: "#0F5FA8", AccentSuccess: "#1B6B45", AccentWarning: "#7E5200", AccentError: "#A8321C", SurfaceAlpha: 0.3, SurfaceBlur: 16, RadiusScale: 1.3, LabelWeight: 600, Character: "frost", Depth: "glass", Surface: "glass", Backdrop: "cloudstrata"},
	}
}
