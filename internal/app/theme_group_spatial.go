package app

// The Spatial group; see theme_groups.go. Depth and pointer-driven motion:
// the palettes here are ordinary, the movement is theme-group-spatial.js.
//
// Each family is drawn structurally in theme-group-spatial.css (cut paper,
// slide mounts, orbit rings) so the still picture has an identity; the pointer
// only moves those layers. None is glass: the Character underneath is a flat,
// opaque one that the CSS then dresses.
func spatialGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Diorama: sheets of card cut and stacked at different depths
		"spatial-diorama-dark":  {Name: "Diorama [dark]", TextPrimary: "#F3EBDD", TextSecondary: "#CDBFA8", TextTertiary: "#B8A98F", BackgroundPrimary: "#1F1912", BackgroundSecondary: "#3A2E21", BackgroundDots: "#3A2F22", BackgroundModal: "rgba(31, 25, 18, 0.93)", BorderPrimary: "#4A3D2B", BorderSecondary: "#33291D", AccentPrimary: "#E08A6A", AccentSuccess: "#7DBE8A", AccentWarning: "#E3B04F", AccentError: "#F0806A", RadiusScale: 0.05, LabelWeight: 700, Character: "paper", Depth: "soft", Surface: "card", Backdrop: "papercuts"},
		"spatial-diorama-light": {Name: "Diorama [light]", TextPrimary: "#2B2A28", TextSecondary: "#4F4A40", TextTertiary: "#625B4F", BackgroundPrimary: "#E8DFD0", BackgroundSecondary: "#FBF6EA", BackgroundDots: "#D9CFBD", BackgroundModal: "rgba(232, 223, 208, 0.94)", BorderPrimary: "#CBBFA8", BorderSecondary: "#DDD3C0", AccentPrimary: "#8E3222", AccentSuccess: "#265C32", AccentWarning: "#7A5600", AccentError: "#8E3222", RadiusScale: 0.05, LabelWeight: 700, Character: "paper", Depth: "soft", Surface: "card", Backdrop: "papercuts"},

		// Lightbox: the lamp is under your cursor
		"spatial-lightbox-dark":  {Name: "Lightbox [dark]", TextPrimary: "#ECECF2", TextSecondary: "#B4B4C4", TextTertiary: "#8E8EA2", BackgroundPrimary: "#14141A", BackgroundSecondary: "#1A1A22", BackgroundDots: "#26263A", BackgroundModal: "rgba(20, 20, 26, 0.93)", BorderPrimary: "#33334A", BorderSecondary: "#22222F", AccentPrimary: "#8FB4FF", AccentSuccess: "#6AD59A", AccentWarning: "#F2C46A", AccentError: "#FF7A7A", RadiusScale: 0.05, LabelWeight: 600, Character: "carbon", Depth: "soft", Surface: "card", Backdrop: "filmstrip"},
		"spatial-lightbox-light": {Name: "Lightbox [light]", TextPrimary: "#17171F", TextSecondary: "#444455", TextTertiary: "#5E5E70", BackgroundPrimary: "#ECECF3", BackgroundSecondary: "#FFFFFF", BackgroundDots: "#DCDCE6", BackgroundModal: "rgba(236, 236, 243, 0.94)", BorderPrimary: "#CACAD8", BorderSecondary: "#DEDEE8", AccentPrimary: "#2B5CC8", AccentSuccess: "#1B6B44", AccentWarning: "#7A5200", AccentError: "#B02A2A", RadiusScale: 0.05, LabelWeight: 600, Character: "carbon", Depth: "soft", Surface: "card", Backdrop: "filmstrip"},

		// Orbit: the whole page leans toward you, categories at different Z
		"spatial-orbit-dark":  {Name: "Orbit [dark]", TextPrimary: "#F0EAFF", TextSecondary: "#C4B8E4", TextTertiary: "#9A8CC0", BackgroundPrimary: "#070412", BackgroundSecondary: "#0C0720", BackgroundDots: "#332058", BackgroundModal: "rgba(7, 4, 18, 0.94)", BorderPrimary: "#4A3478", BorderSecondary: "#2E1F52", AccentPrimary: "#C79BFF", AccentSuccess: "#7BE0B0", AccentWarning: "#FFD27A", AccentError: "#FF7AA8", RadiusScale: 0.15, LabelWeight: 600, Character: "ink", Depth: "soft", Surface: "card", Backdrop: "stars"},
		"spatial-orbit-light": {Name: "Orbit [light]", TextPrimary: "#1F1538", TextSecondary: "#4A3F6E", TextTertiary: "#62578A", BackgroundPrimary: "#EFE8FA", BackgroundSecondary: "#FAF7FF", BackgroundDots: "#DDD2F0", BackgroundModal: "rgba(239, 232, 250, 0.94)", BorderPrimary: "#CDBFE8", BorderSecondary: "#E0D6F2", AccentPrimary: "#6A35C2", AccentSuccess: "#17704F", AccentWarning: "#7A5200", AccentError: "#B3285C", RadiusScale: 0.15, LabelWeight: 600, Character: "ink", Depth: "soft", Surface: "card", Backdrop: "stars"},
	}
}
