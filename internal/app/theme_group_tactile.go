package app

/*
The Tactile group; see theme_groups.go.

The idea is that a row is a thing you could pick up: a strip of label tape, a
keycap, a rack unit. The palettes only have to be legible and give the surface
underneath a real material; the object itself is drawn in
static/css/theme-group-tactile.css.

Families: tactile-label-maker, tactile-keycap, tactile-rack-unit.
*/
func tactileGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Label Maker: laminated cartridge tape in white, yellow, blue, red and green with black print, on a dark bench or a pale one.
		"tactile-label-maker-dark":  {Name: "Label Maker [dark]", TextPrimary: "#FFFFFF", TextSecondary: "#CACBD2", TextTertiary: "#A5A7B1", BackgroundPrimary: "#1D1E22", BackgroundSecondary: "#26272C", BackgroundDots: "#2C2D33", BackgroundModal: "rgba(29, 30, 34, 0.94)", BorderPrimary: "#4A4C54", BorderSecondary: "#33353B", AccentPrimary: "#7FB2FF", AccentSuccess: "#5FE38C", AccentWarning: "#FFD21F", AccentError: "#FF7B6E", AccentInfo: "#8AB4FF", RadiusScale: 0.3, LabelTransform: "uppercase", LabelSpacing: "0.12em", LabelWeight: 700, Sheen: 0.2, Character: "carbon", Depth: "soft", Surface: "card", Backdrop: "labeltape"},
		"tactile-label-maker-light": {Name: "Label Maker [light]", TextPrimary: "#15161A", TextSecondary: "#43454D", TextTertiary: "#585A63", BackgroundPrimary: "#E9E7E1", BackgroundSecondary: "#F6F4EE", BackgroundDots: "#D9D6CD", BackgroundModal: "rgba(233, 231, 225, 0.94)", BorderPrimary: "#B9B6AC", BorderSecondary: "#D2CFC5", AccentPrimary: "#1F4FB0", AccentSuccess: "#166B35", AccentWarning: "#7A5200", AccentError: "#B3261E", AccentInfo: "#2A4FA8", RadiusScale: 0.3, LabelTransform: "uppercase", LabelSpacing: "0.12em", LabelWeight: 700, Sheen: 0.2, Character: "enamel", Depth: "soft", Surface: "card", Backdrop: "labeltape"},

		// Keycap: dark PBT keys on a black deck; beige retro keys by day.
		"tactile-keycap-dark":  {Name: "Keycap [dark]", TextPrimary: "#F1EFE9", TextSecondary: "#C9C7C0", TextTertiary: "#A4A29B", BackgroundPrimary: "#17181B", BackgroundSecondary: "#222428", BackgroundDots: "#2A2C31", BackgroundModal: "rgba(23, 24, 27, 0.94)", BorderPrimary: "#44474E", BorderSecondary: "#2F3237", AccentPrimary: "#7CC4FF", AccentSuccess: "#4CD27F", AccentWarning: "#F0B73A", AccentError: "#FF6B5F", AccentInfo: "#B0A0F0", RadiusScale: 0.9, LabelWeight: 600, Sheen: 0.35, Character: "enamel", Depth: "rich", Surface: "card", Backdrop: "keycapfield"},
		"tactile-keycap-light": {Name: "Keycap [light]", TextPrimary: "#2A2A2E", TextSecondary: "#4A4A50", TextTertiary: "#55555C", BackgroundPrimary: "#D9D6CF", BackgroundSecondary: "#ECE9E2", BackgroundDots: "#CCC8C0", BackgroundModal: "rgba(217, 214, 207, 0.94)", BorderPrimary: "#A9A59B", BorderSecondary: "#C4C0B7", AccentPrimary: "#2A2A2E", AccentSuccess: "#17653A", AccentWarning: "#704D00", AccentError: "#B3261E", AccentInfo: "#2F52A8", RadiusScale: 0.9, LabelWeight: 600, Sheen: 0.35, Character: "enamel", Depth: "rich", Surface: "card", Backdrop: "keycapfield"},

		// Rack Unit: black-anodised 19-inch plates with an amber trim; pale grey plates by day.
		"tactile-rack-unit-dark":  {Name: "Rack Unit [dark]", TextPrimary: "#D8DAE0", TextSecondary: "#AAAEBA", TextTertiary: "#8E93A2", BackgroundPrimary: "#101114", BackgroundSecondary: "#1A1B20", BackgroundDots: "#22242A", BackgroundModal: "rgba(16, 17, 20, 0.94)", BorderPrimary: "#43464F", BorderSecondary: "#2C2E35", AccentPrimary: "#FF9E2C", AccentSuccess: "#40E070", AccentWarning: "#FFD24A", AccentError: "#FF5A4F", AccentInfo: "#79B5FF", RadiusScale: 0.3, LabelTransform: "uppercase", LabelSpacing: "0.06em", LabelWeight: 600, Sheen: 0.3, Character: "brushed", GrainAngle: 90, GrainScale: 0.5, Depth: "soft", Surface: "card", Backdrop: "rackcables"},
		"tactile-rack-unit-light": {Name: "Rack Unit [light]", TextPrimary: "#14161B", TextSecondary: "#3B3F49", TextTertiary: "#4F5460", BackgroundPrimary: "#D5D8DE", BackgroundSecondary: "#E6E8EC", BackgroundDots: "#C6CAD2", BackgroundModal: "rgba(213, 216, 222, 0.94)", BorderPrimary: "#9EA3AF", BorderSecondary: "#BDC1CA", AccentPrimary: "#8A4300", AccentSuccess: "#166030", AccentWarning: "#7A5200", AccentError: "#B01E14", AccentInfo: "#1F4FA0", RadiusScale: 0.3, LabelTransform: "uppercase", LabelSpacing: "0.06em", LabelWeight: 600, Sheen: 0.3, Character: "brushed", GrainAngle: 90, GrainScale: 0.5, Depth: "soft", Surface: "card", Backdrop: "rackcables"},
	}
}
