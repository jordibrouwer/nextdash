package app

// The Legible group; see theme_groups.go.
//
// Accessibility as a style: every palette clears AAA for the two text colours
// and AA for the accent and the status colours, and the stylesheet
// (theme-group-legible.css) supplies the touch targets, the thick focus ring
// and the shape-plus-word status. The surface is flat paper/ink underneath so
// nothing decorative competes with the text.

// legibleBase carries what every half shares: a matte, opaque, flat surface
// with no glow, no effects and a plain backdrop.
func legibleBase(name string, tc ThemeColors) ThemeColors {
	tc.Name = name
	tc.SurfaceAlpha = 1
	tc.SurfaceGlow = -1
	tc.SurfaceStep = 1.4
	tc.RadiusScale = 0.5
	tc.LabelTransform = "none"
	tc.LabelSpacing = "0.04em"
	tc.LabelWeight = 700
	tc.Character = "paper"
	tc.Depth = "flat"
	tc.Glow = "off"
	tc.Effects = "off"
	tc.Surface = "card"
	return tc
}

func legibleGroupThemes() map[string]ThemeColors {
	return map[string]ThemeColors{
		// Wayfinding signage: black on white by day, yellow on black by night.
		"legible-high-contrast-calm-dark": legibleBase("High Contrast Calm [dark]", ThemeColors{
			TextPrimary: "#FFFFFF", TextSecondary: "#E8E8E8", TextTertiary: "#CFCFCF",
			BackgroundPrimary: "#000000", BackgroundSecondary: "#121212", BackgroundDots: "#000000", BackgroundModal: "#121212",
			BorderPrimary: "#BDBDBD", BorderSecondary: "#8F8F8F",
			AccentPrimary: "#FFD400", AccentSuccess: "#5CD98A", AccentWarning: "#FFD24A", AccentError: "#FF8F8F",
			Backdrop: "softsquares",
		}),
		"legible-high-contrast-calm-light": legibleBase("High Contrast Calm [light]", ThemeColors{
			TextPrimary: "#000000", TextSecondary: "#1F1F1F", TextTertiary: "#3D3D3D",
			BackgroundPrimary: "#EDEDED", BackgroundSecondary: "#FFFFFF", BackgroundDots: "#EDEDED", BackgroundModal: "#FFFFFF",
			BorderPrimary: "#4D4D4D", BorderSecondary: "#6E6E6E",
			AccentPrimary: "#0A3F99", AccentSuccess: "#0A6B2A", AccentWarning: "#7A4A00", AccentError: "#B00020",
			Backdrop: "softsquares",
		}),
		// Amber on black, the colour low-vision readers tend to pick for
		// glare; the light half is the same ink turned dark on warm paper.
		"legible-low-vision-amber-dark": legibleBase("Low Vision Amber [dark]", ThemeColors{
			TextPrimary: "#FFC400", TextSecondary: "#F0B400", TextTertiary: "#D9A100",
			BackgroundPrimary: "#000000", BackgroundSecondary: "#140E00", BackgroundDots: "#000000", BackgroundModal: "#140E00",
			BorderPrimary: "#B88A00", BorderSecondary: "#8F6B00",
			AccentPrimary: "#FFFFFF", AccentSuccess: "#FFE27A", AccentWarning: "#FF9F1A", AccentError: "#FF8A66",
			Backdrop: "amberhorizon",
		}),
		"legible-low-vision-amber-light": legibleBase("Low Vision Amber [light]", ThemeColors{
			TextPrimary: "#3A2400", TextSecondary: "#553500", TextTertiary: "#6B4400",
			BackgroundPrimary: "#FFF8EA", BackgroundSecondary: "#FFEBC2", BackgroundDots: "#FFF8EA", BackgroundModal: "#FFEBC2",
			BorderPrimary: "#8A5A00", BorderSecondary: "#A87400",
			AccentPrimary: "#7A3E00", AccentSuccess: "#2E6B00", AccentWarning: "#8A4B00", AccentError: "#A12A00",
			Backdrop: "amberhorizon",
		}),
		// Blue and orange carry good and bad, never red and green, and the
		// stylesheet gives each state its own shape as well.
		"legible-colour-blind-safe-dark": legibleBase("Colour-blind Safe [dark]", ThemeColors{
			TextPrimary: "#F5F5F5", TextSecondary: "#D8DCE2", TextTertiary: "#BFC5CE",
			BackgroundPrimary: "#0E1116", BackgroundSecondary: "#1A1F27", BackgroundDots: "#0E1116", BackgroundModal: "#1A1F27",
			BorderPrimary: "#8A94A3", BorderSecondary: "#6C7685",
			AccentPrimary: "#6FB1FF", AccentSuccess: "#5AA9FF", AccentWarning: "#E8B100", AccentError: "#FF9A4D",
			Backdrop: "shapetiles",
		}),
		"legible-colour-blind-safe-light": legibleBase("Colour-blind Safe [light]", ThemeColors{
			TextPrimary: "#1A1A1A", TextSecondary: "#3A3A3A", TextTertiary: "#4D4D4D",
			BackgroundPrimary: "#FBF8F1", BackgroundSecondary: "#EFE8D8", BackgroundDots: "#FBF8F1", BackgroundModal: "#EFE8D8",
			BorderPrimary: "#6E6E6E", BorderSecondary: "#8A8A8A",
			AccentPrimary: "#005AB5", AccentSuccess: "#00508F", AccentWarning: "#8A5A00", AccentError: "#A84300",
			Backdrop: "shapetiles",
		}),
	}
}

func init() {
	themeDescriptions["legible-high-contrast-calm"] = "Airport signage: ruled strips under a bold band, yellow where you are"
	themeDescriptions["legible-low-vision-amber"] = "Amber ink on black for low glare, big rows, no motion"
	themeDescriptions["legible-colour-blind-safe"] = "Blue and orange for good and bad, each with its own shape and word"
}
