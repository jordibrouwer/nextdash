package app

/*
The Instrument group: the data is in the row.

Three instrument faces, each in a dark and a light half. What they share is
drawn at runtime (static/js/theme-group-instrument.js) -- a sparkline of the
health history on every row that has one, a thin ping bar, and an up/total
count with a segmented meter on every category head. The palettes here only
have to be legible and to wear a material that suits a screen full of
readouts: terminal for the HUD, neon for the phosphor, carbon for the dive
computer's moulded case.
*/
func instrumentGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Cockpit: HUD green on black, brackets on the corners of every category
		"instrument-cockpit-dark":  {Name: "Cockpit [dark]", TextPrimary: "#B6FFC9", TextSecondary: "#86D69C", TextTertiary: "#69B97F", BackgroundPrimary: "#04100A", BackgroundSecondary: "#0A1C12", BackgroundDots: "#12301F", BackgroundModal: "rgba(4, 16, 10, 0.92)", BorderPrimary: "#1E5A35", BorderSecondary: "#123A22", AccentPrimary: "#39FF7A", AccentSuccess: "#39FF7A", AccentWarning: "#FFD23F", AccentError: "#FF6464", SurfaceAlpha: 0.9, SurfaceGlow: 0.6, RadiusScale: 0.05, LabelTransform: "uppercase", LabelSpacing: "0.16em", LabelWeight: 700, Character: "terminal", Depth: "soft", Backdrop: "hudhorizon"},
		"instrument-cockpit-light": {Name: "Cockpit [light]", TextPrimary: "#082412", TextSecondary: "#24583A", TextTertiary: "#3F6E52", BackgroundPrimary: "#EDF7EF", BackgroundSecondary: "#DDEEE1", BackgroundDots: "#C6E0CD", BackgroundModal: "rgba(237, 247, 239, 0.93)", BorderPrimary: "#9DC7AC", BorderSecondary: "#C2DEC9", AccentPrimary: "#0C7A35", AccentSuccess: "#0C7A35", AccentWarning: "#7A5C00", AccentError: "#B02A2A", SurfaceAlpha: 0.9, SurfaceGlow: 0.3, RadiusScale: 0.05, LabelTransform: "uppercase", LabelSpacing: "0.16em", LabelWeight: 700, Character: "terminal", Depth: "soft", Backdrop: "hudhorizon"},

		// Oscilloscope: phosphor on a graticule, the trace glowing
		"instrument-oscilloscope-dark":  {Name: "Oscilloscope [dark]", TextPrimary: "#D4EECB", TextSecondary: "#A3C79A", TextTertiary: "#86AB7E", BackgroundPrimary: "#090D09", BackgroundSecondary: "#111811", BackgroundDots: "#1B281B", BackgroundModal: "rgba(9, 13, 9, 0.92)", BorderPrimary: "#2F4A2B", BorderSecondary: "#1E3020", AccentPrimary: "#9CFF57", AccentSuccess: "#9CFF57", AccentWarning: "#FFD23F", AccentError: "#FF6A4D", SurfaceAlpha: 0.85, SurfaceGlow: 0.9, RadiusScale: 0.15, LabelTransform: "uppercase", LabelSpacing: "0.12em", LabelWeight: 600, Character: "neon", Depth: "soft", Backdrop: "cellgrid"},
		"instrument-oscilloscope-light": {Name: "Oscilloscope [light]", TextPrimary: "#16260F", TextSecondary: "#3F5A35", TextTertiary: "#566F4C", BackgroundPrimary: "#F2F6EA", BackgroundSecondary: "#E3EBD6", BackgroundDots: "#CFDCBC", BackgroundModal: "rgba(242, 246, 234, 0.93)", BorderPrimary: "#AEC29A", BorderSecondary: "#CCDABC", AccentPrimary: "#366A08", AccentSuccess: "#366A08", AccentWarning: "#7A5C00", AccentError: "#B03A22", SurfaceAlpha: 0.9, SurfaceGlow: 0.3, RadiusScale: 0.15, LabelTransform: "uppercase", LabelSpacing: "0.12em", LabelWeight: 600, Character: "neon", Depth: "soft", Backdrop: "cellgrid"},

		// Dive Computer: amber digits on deep water, a segmented meter per category
		"instrument-dive-computer-dark":  {Name: "Dive Computer [dark]", TextPrimary: "#FFE9B0", TextSecondary: "#E0C27A", TextTertiary: "#BE9F5C", BackgroundPrimary: "#07203A", BackgroundSecondary: "#0D2E52", BackgroundDots: "#143F6C", BackgroundModal: "rgba(7, 32, 58, 0.92)", BorderPrimary: "#2A5F92", BorderSecondary: "#1A4470", AccentPrimary: "#FFB62E", AccentSuccess: "#7BE0A8", AccentWarning: "#FFB62E", AccentError: "#FF7B6B", SurfaceAlpha: 0.7, SurfaceGlow: 0.5, RadiusScale: 0.9, LabelWeight: 700, Character: "carbon", Depth: "rich", Backdrop: "decocurve"},
		"instrument-dive-computer-light": {Name: "Dive Computer [light]", TextPrimary: "#0A2540", TextSecondary: "#32506E", TextTertiary: "#4D677F", BackgroundPrimary: "#EAF2F8", BackgroundSecondary: "#DAE7F1", BackgroundDots: "#C3D6E6", BackgroundModal: "rgba(234, 242, 248, 0.93)", BorderPrimary: "#A6C0D6", BorderSecondary: "#C6D8E6", AccentPrimary: "#8A5200", AccentSuccess: "#0E7048", AccentWarning: "#7A5200", AccentError: "#B02E2E", SurfaceAlpha: 0.8, SurfaceGlow: 0.2, RadiusScale: 0.9, LabelWeight: 700, Character: "carbon", Depth: "rich", Backdrop: "decocurve"},
	}
}

// One line per family, for the theme browser (see theme_description.go).
func init() {
	themeDescriptions["instrument-cockpit"] = "Head-up green on black, every category cornered in brackets"
	themeDescriptions["instrument-oscilloscope"] = "Phosphor on a graticule, each trace drawn in light"
	themeDescriptions["instrument-dive-computer"] = "Amber digits on deep water, depth read off a segmented meter"
}
