package app

/*
The Stationery group; see theme_groups.go.

One bookmark per line, and the white between the lines is the only thing that
separates them -- no row boxes, no rules. Four families, each a different
desk: a ledger, a museum label, a typewritten page, a sheet of ink and a
sun. The categories sit on the page itself (Surface "open") because a card
around a list is exactly the box this group leaves out.

The drawing is theme-group-stationery.css. What is here is the palette and a
material underneath it, so the page still has a surface where the CSS does
not reach (the launcher layouts, modals, the config view).
*/
func stationeryGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Ledger: cream paper, brown ink, one oxblood stamp.
		"stationery-ledger-dark":  {Name: "Ledger [dark]", TextPrimary: "#EFE6D0", TextSecondary: "#CDBE9C", TextTertiary: "#A89874", BackgroundPrimary: "#1B1710", BackgroundSecondary: "#241F15", BackgroundDots: "#3A3223", BackgroundModal: "rgba(27, 23, 16, 0.94)", BorderPrimary: "#4A4030", BorderSecondary: "#2F281B", AccentPrimary: "#E08A6E", AccentSuccess: "#9CC07A", AccentWarning: "#E3B454", AccentError: "#F08A7C", Character: "paper", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "ruled"},
		"stationery-ledger-light": {Name: "Ledger [light]", TextPrimary: "#2B2418", TextSecondary: "#5E5034", TextTertiary: "#74643F", BackgroundPrimary: "#F6F0DF", BackgroundSecondary: "#FBF7EA", BackgroundDots: "#C9B98C", BackgroundModal: "rgba(246, 240, 223, 0.95)", BorderPrimary: "#D8CBA4", BorderSecondary: "#E6DBBA", AccentPrimary: "#8A2B1F", AccentSuccess: "#3F6B2E", AccentWarning: "#8F5F0C", AccentError: "#A8231B", Character: "paper", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "ruled"},

		// Swiss Poster (id kept as gallery): grotesque type, a grid, one cobalt accent.
		"stationery-gallery-dark":  {Name: "Swiss Poster [dark]", TextPrimary: "#F2F2EE", TextSecondary: "#BDBDB8", TextTertiary: "#93938E", BackgroundPrimary: "#0B0B0C", BackgroundSecondary: "#141416", BackgroundDots: "#26262A", BackgroundModal: "rgba(11, 11, 12, 0.94)", BorderPrimary: "#3A3A3F", BorderSecondary: "#1F1F23", AccentPrimary: "#7F97FF", AccentSuccess: "#6FD39A", AccentWarning: "#E8B04A", AccentError: "#FF6B7F", Character: "ink", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "gallerywall"},
		"stationery-gallery-light": {Name: "Swiss Poster [light]", TextPrimary: "#0A0A0A", TextSecondary: "#4A4A47", TextTertiary: "#66665F", BackgroundPrimary: "#F3F2EE", BackgroundSecondary: "#FBFAF7", BackgroundDots: "#D9D8D2", BackgroundModal: "rgba(243, 242, 238, 0.95)", BorderPrimary: "#CFCEC8", BorderSecondary: "#E4E3DD", AccentPrimary: "#1C3DF2", AccentSuccess: "#0B6B3A", AccentWarning: "#8A5A00", AccentError: "#C8102E", Character: "ink", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "gallerywall"},

		// Typewriter: monospace on warm paper, the reading line is the carriage.
		"stationery-typewriter-dark":  {Name: "Typewriter [dark]", TextPrimary: "#E2DCC8", TextSecondary: "#B7B099", TextTertiary: "#928C76", BackgroundPrimary: "#1C1B17", BackgroundSecondary: "#25241F", BackgroundDots: "#38362E", BackgroundModal: "rgba(28, 27, 23, 0.94)", BorderPrimary: "#46433A", BorderSecondary: "#2C2A24", AccentPrimary: "#E8B04A", AccentSuccess: "#9EC27A", AccentWarning: "#E8B04A", AccentError: "#F0745F", Character: "terminal", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "typesheet"},
		"stationery-typewriter-light": {Name: "Typewriter [light]", TextPrimary: "#26241C", TextSecondary: "#57533F", TextTertiary: "#6E6A53", BackgroundPrimary: "#F2EDDC", BackgroundSecondary: "#F8F4E6", BackgroundDots: "#CFC8AE", BackgroundModal: "rgba(242, 237, 220, 0.95)", BorderPrimary: "#D6CFB4", BorderSecondary: "#E5DFC8", AccentPrimary: "#8A5300", AccentSuccess: "#3F6B2A", AccentWarning: "#8A5300", AccentError: "#A93222", Character: "terminal", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "typesheet"},

		// Zen: sumi ink on dark, a red sun in the corner; washi by day.
		"stationery-zen-dark":  {Name: "Zen [dark]", TextPrimary: "#E3E0D6", TextSecondary: "#B2AFA5", TextTertiary: "#8E8B82", BackgroundPrimary: "#14161A", BackgroundSecondary: "#1B1E23", BackgroundDots: "#2B2E34", BackgroundModal: "rgba(20, 22, 26, 0.94)", BorderPrimary: "#363A41", BorderSecondary: "#23262C", AccentPrimary: "#E2705B", AccentSuccess: "#8FAE8B", AccentWarning: "#C9A25C", AccentError: "#E2705B", Character: "ink", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "zenwash"},
		"stationery-zen-light": {Name: "Zen [light]", TextPrimary: "#1F1D1A", TextSecondary: "#4F4C45", TextTertiary: "#6A665D", BackgroundPrimary: "#EFEADD", BackgroundSecondary: "#F6F2E7", BackgroundDots: "#D3CCBA", BackgroundModal: "rgba(239, 234, 221, 0.95)", BorderPrimary: "#D5CEBC", BorderSecondary: "#E4DECE", AccentPrimary: "#B02E1B", AccentSuccess: "#4C6E48", AccentWarning: "#8A6420", AccentError: "#B02E1B", Character: "ink", Depth: "flat", Glow: "off", Surface: "open", Backdrop: "zenwash"},
	}
}

func init() {
	// A line per family, written here and not in theme_description.go so the
	// group stays in its own files.
	themeDescriptions["stationery-ledger"] = "Cream paper in a bookkeeper's hand, dotted from name to key"
	themeDescriptions["stationery-gallery"] = "A Swiss poster grid: huge numerals, bold type, one blue ink"
	themeDescriptions["stationery-typewriter"] = "Typed lines with the heading in the margin and a carriage rule"
	themeDescriptions["stationery-zen"] = "Sumi ink on a quiet page, the headings standing, a red sun above"
}
