package app

/*
The Riso group; see theme_groups.go.

A risograph prints one ink at a time on paper, so two colours never land in
exactly the same place and where they overlap they darken. The palettes are
therefore two inks and a stock: the light half is the print on paper, the dark
half the same two inks on dark stock. Neither half glows -- an ink is not a
light -- so every halo and sheen is off and the paper archetype carries the
surface. The misregistration itself is drawn in theme-group-riso.css.
*/

// risoInk is one family's palette in one half. The second ink only ever
// appears as an accent and in the CSS offset, so it is kept apart from the
// text colours, which have to clear AA on their own.
type risoInk struct {
	name                                   string
	tp, ts, tt                             string
	bg, bg2, dots, modal, border, border2  string
	accent, success, warning, danger, info string
	backdrop                               string
}

func risoTheme(p risoInk) ThemeColors {
	return ThemeColors{
		Name: p.name, TextPrimary: p.tp, TextSecondary: p.ts, TextTertiary: p.tt,
		BackgroundPrimary: p.bg, BackgroundSecondary: p.bg2, BackgroundDots: p.dots, BackgroundModal: p.modal,
		BorderPrimary: p.border, BorderSecondary: p.border2,
		AccentPrimary: p.accent, AccentSuccess: p.success, AccentWarning: p.warning, AccentError: p.danger, AccentInfo: p.info,
		// Flat and unlit: paper takes ink, it does not shine.
		Character: "paper", Depth: "flat", Glow: "off", Surface: "card", SurfaceGlow: -1,
		RadiusScale: 0.4, LabelTransform: "uppercase", LabelSpacing: "0.02em", LabelWeight: 800,
		Backdrop: p.backdrop,
	}
}

func risoGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Riso Pink-Blue: blue and fluorescent pink
		"riso-pink-blue-light": risoTheme(risoInk{
			name: "Riso Pink-Blue [light]", tp: "#1E2D86", ts: "#3B4A9C", tt: "#55609F",
			bg: "#F4EFE3", bg2: "#FBF8EF", dots: "#E6DFCD", modal: "rgba(244, 239, 227, 0.97)", border: "#2B4BB8", border2: "#B8BFE3",
			accent: "#2B4BB8", success: "#1E7A55", warning: "#8A5A00", danger: "#B3124F", info: "#2B4BB8", backdrop: "halftone"}),
		"riso-pink-blue-dark": risoTheme(risoInk{
			name: "Riso Pink-Blue [dark]", tp: "#F2EDE2", ts: "#C9CCE8", tt: "#A4AAD6",
			bg: "#11142E", bg2: "#1A1F45", dots: "#262C5C", modal: "rgba(17, 20, 46, 0.97)", border: "#6F86E6", border2: "#3A4590",
			accent: "#FF6FB0", success: "#5FD0A0", warning: "#F2C25A", danger: "#FF7A8E", info: "#8FA3F2", backdrop: "halftone"}),

		// Riso Green-Orange: deep green and a hot orange
		"riso-green-orange-light": risoTheme(risoInk{
			name: "Riso Green-Orange [light]", tp: "#0B4A33", ts: "#2F6650", tt: "#4D7561",
			bg: "#F3EFDF", bg2: "#FBF8EC", dots: "#E4DFC8", modal: "rgba(243, 239, 223, 0.97)", border: "#0B7A50", border2: "#B6CDBE",
			accent: "#0B7A50", success: "#0B7A50", warning: "#8F4A00", danger: "#B3261E", info: "#2B6A8A", backdrop: "stampfield"}),
		"riso-green-orange-dark": risoTheme(risoInk{
			name: "Riso Green-Orange [dark]", tp: "#EFEBD8", ts: "#BFD0C0", tt: "#9DB5A5",
			bg: "#0E1F18", bg2: "#162B22", dots: "#1F3A2E", modal: "rgba(14, 31, 24, 0.97)", border: "#3FA477", border2: "#2E5A46",
			accent: "#FF9A4A", success: "#4FD08F", warning: "#FFB94A", danger: "#FF7A6E", info: "#7FC4D8", backdrop: "stampfield"}),

		// Mimeograph: one purple ink, printed soft
		"riso-mimeograph-light": risoTheme(risoInk{
			name: "Mimeograph [light]", tp: "#3F1D73", ts: "#5B3A8C", tt: "#6E5496",
			bg: "#F1ECF6", bg2: "#FAF7FD", dots: "#E0D7EC", modal: "rgba(241, 236, 246, 0.97)", border: "#5B2A9A", border2: "#C9BBE0",
			accent: "#5B2A9A", success: "#1F6B4A", warning: "#85560A", danger: "#B01F4A", info: "#5B2A9A", backdrop: "inkspeckle"}),
		"riso-mimeograph-dark": risoTheme(risoInk{
			name: "Mimeograph [dark]", tp: "#EEE7F8", ts: "#C8B9E6", tt: "#A894D2",
			bg: "#17102B", bg2: "#211842", dots: "#2D2158", modal: "rgba(23, 16, 43, 0.97)", border: "#8C6CD0", border2: "#4A3A85",
			accent: "#B08CF0", success: "#5FCB9A", warning: "#E8B44F", danger: "#FF7C95", info: "#B08CF0", backdrop: "inkspeckle"}),
	}
}

func init() {
	themeDescriptions["riso-pink-blue"] = "Two inks pulled a hair out of register, blue over fluorescent pink"
	themeDescriptions["riso-green-orange"] = "Green and orange off a duplicator, dark where the layers overlap"
	themeDescriptions["riso-mimeograph"] = "One purple ink, printed soft and a little crooked"
}
