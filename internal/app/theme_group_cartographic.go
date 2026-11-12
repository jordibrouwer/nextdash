package app

/*
The Cartographic group: the page is a map. Atlas is a parchment sheet with
grid references, Nautical a sea chart, Subway a transit diagram. The palettes
are ordinary; the drawing lives in static/css/theme-group-cartographic.css,
keyed on html[data-theme^="cartographic-"]. See theme_groups.go.

Every text colour clears WCAG AA on both page and surface (the test checks it),
because a map style that cannot be read is only a picture of one.
*/
func cartographicGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Atlas: ink on parchment, a red pin per place. Paper underneath, so the
		// surface is matte and square-cornered like a printed sheet.
		"cartographic-atlas-dark":  {Name: "Atlas [dark]", TextPrimary: "#EFE6CF", TextSecondary: "#CDBF9C", TextTertiary: "#ADA07C", BackgroundPrimary: "#1F1A12", BackgroundSecondary: "#2A2318", BackgroundDots: "#3A3020", BackgroundModal: "rgba(31, 26, 18, 0.94)", BorderPrimary: "#5E4F32", BorderSecondary: "#3F3522", AccentPrimary: "#E27C63", AccentSuccess: "#82C486", AccentWarning: "#E3B65A", AccentError: "#EC8470", Character: "paper", Depth: "soft", Surface: "card", Backdrop: "topo"},
		"cartographic-atlas-light": {Name: "Atlas [light]", TextPrimary: "#3A3020", TextSecondary: "#5E4F30", TextTertiary: "#6F5F3C", BackgroundPrimary: "#EFE6CF", BackgroundSecondary: "#F7F0DE", BackgroundDots: "#DCCFAA", BackgroundModal: "rgba(239, 230, 207, 0.95)", BorderPrimary: "#BCAA7E", BorderSecondary: "#D5C8A4", AccentPrimary: "#A2392B", AccentSuccess: "#2F6B3C", AccentWarning: "#835A08", AccentError: "#A2392B", Character: "paper", Depth: "soft", Surface: "card", Backdrop: "topo"},

		// Nautical: a sea chart, ink and soundings on pale paper or a navy night chart.
		"cartographic-nautical-dark":  {Name: "Nautical [dark]", TextPrimary: "#E2EEF9", TextSecondary: "#B4CBE3", TextTertiary: "#8FB0D1", BackgroundPrimary: "#06203B", BackgroundSecondary: "#0A2C4E", BackgroundDots: "#123D66", BackgroundModal: "rgba(6, 32, 59, 0.95)", BorderPrimary: "#9CC4EA", BorderSecondary: "#2A5C8C", AccentPrimary: "#F2A6D2", AccentSuccess: "#6FE0B0", AccentWarning: "#F0C060", AccentError: "#FF8478", Character: "enamel", Depth: "soft", Surface: "card", Backdrop: "oceanblue"},
		"cartographic-nautical-light": {Name: "Nautical [light]", TextPrimary: "#1E1A2E", TextSecondary: "#493C5A", TextTertiary: "#5E5070", BackgroundPrimary: "#E9E6D4", BackgroundSecondary: "#F6F3E4", BackgroundDots: "#CFDDE0", BackgroundModal: "rgba(233, 230, 212, 0.96)", BorderPrimary: "#6B2C5C", BorderSecondary: "#B79BB0", AccentPrimary: "#8A1F5C", AccentSuccess: "#1B6B4A", AccentWarning: "#7A5200", AccentError: "#A8232B", Character: "paper", Depth: "soft", Surface: "card", Backdrop: "oceanblue"},

		// Subway Map: signage -- flat, high contrast, a line per category.
		"cartographic-subway-dark":  {Name: "Subway Map [dark]", TextPrimary: "#F2F2EE", TextSecondary: "#C2C6CD", TextTertiary: "#9EA4AD", BackgroundPrimary: "#14161A", BackgroundSecondary: "#1E2127", BackgroundDots: "#2A2E35", BackgroundModal: "rgba(20, 22, 26, 0.94)", BorderPrimary: "#3F444D", BorderSecondary: "#2C3037", AccentPrimary: "#FF6A5F", AccentSuccess: "#4CCB74", AccentWarning: "#F2B33D", AccentError: "#FF7468", Character: "enamel", Depth: "flat", Surface: "card", Backdrop: "metrolines"},
		"cartographic-subway-light": {Name: "Subway Map [light]", TextPrimary: "#1B1B1B", TextSecondary: "#464646", TextTertiary: "#666666", BackgroundPrimary: "#F7F7F2", BackgroundSecondary: "#FFFFFF", BackgroundDots: "#E2E2DA", BackgroundModal: "rgba(247, 247, 242, 0.95)", BorderPrimary: "#C4C4BA", BorderSecondary: "#DEDED5", AccentPrimary: "#C8190F", AccentSuccess: "#1E7A38", AccentWarning: "#845900", AccentError: "#C8190F", Character: "enamel", Depth: "flat", Surface: "card", Backdrop: "metrolines"},
	}
}

func init() {
	// Under about seventy characters, no colour names, no superlatives.
	themeDescriptions["cartographic-atlas"] = "A parchment sheet of grid squares, every place a pin on a leader line"
	themeDescriptions["cartographic-nautical"] = "A chart sheet with a compass rose, soundings and depth contours"
	themeDescriptions["cartographic-subway"] = "A transit diagram: one coloured line per category, a station per stop"
}
