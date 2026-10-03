package app

import "strings"

/*
ThemeLook is a look a theme of the reader's own brings along: the answers the
look studio's Looks tab gives -- backdrop and its sliders, card glass, depth,
category headers, type and spacing -- stored with the colours instead of in
the settings. It is applied when the reader picks the theme, never followed
live, so it only ever writes the settings a built-in look writes.

Every part is optional and held to what its control offers, by the same
helpers the settings use, so a look from a file cannot ask for something the
page has no rule for. The JSON keys are the ones the studio's LOOKS entries
use (static/js/dashboard/dashboard-config-studio.js).
*/
type ThemeLook struct {
	Backdrop string          `json:"backdrop,omitempty"`
	Tuning   *BackdropTuning `json:"tuning,omitempty"`
	Glass    *ThemeLookGlass `json:"glass,omitempty"`
	Depth    string          `json:"depth,omitempty"`
	Heads    *ThemeLookHeads `json:"heads,omitempty"`
	Text     *ThemeLookText  `json:"text,omitempty"`
}

// ThemeLookGlass is the card glass: see ThemeSurfacePref for what each means.
type ThemeLookGlass struct {
	Alpha  *float64 `json:"alpha,omitempty"`
	Blur   *float64 `json:"blur,omitempty"`
	Border string   `json:"border,omitempty"`
}

// ThemeLookHeads is how the category headers are drawn.
type ThemeLookHeads struct {
	CategoryHeaderStyle      string `json:"categoryHeaderStyle,omitempty"`
	CategoryHeaderSize       string `json:"categoryHeaderSize,omitempty"`
	ShowCategoryIcon         *bool  `json:"showCategoryIcon,omitempty"`
	ShowCategoryCount        *bool  `json:"showCategoryCount,omitempty"`
	CategoryHeaderAccentLine *bool  `json:"categoryHeaderAccentLine,omitempty"`
}

// ThemeLookText is the type and the room around it.
type ThemeLookText struct {
	FontPreset      string `json:"fontPreset,omitempty"`
	DensityMode     string `json:"densityMode,omitempty"`
	CategorySpacing string `json:"categorySpacing,omitempty"`
}

// sanitizeThemeLook keeps the parts of a look this build can draw, and
// answers nil when nothing is left.
func sanitizeThemeLook(l *ThemeLook) *ThemeLook {
	if l == nil {
		return nil
	}
	out := &ThemeLook{}
	empty := true

	if backdrop := strings.ToLower(strings.TrimSpace(l.Backdrop)); backdrop == "off" || themeBackdropRecipeIndex(backdrop) >= 0 {
		out.Backdrop = backdrop
		empty = false
	}
	if l.Tuning != nil {
		tuning := normalizeBackdropTuning(*l.Tuning)
		out.Tuning = &tuning
		empty = false
	}
	if l.Glass != nil {
		alpha, blur, border := cleanGlass(ThemeSurfacePref{Alpha: l.Glass.Alpha, Blur: l.Glass.Blur, Border: l.Glass.Border})
		if alpha != nil || blur != nil || border != "" {
			out.Glass = &ThemeLookGlass{Alpha: alpha, Blur: blur, Border: border}
			empty = false
		}
	}
	if depth := keepWord(l.Depth, "flat", "soft", "rich", "vivid", "glass"); depth != "" {
		out.Depth = depth
		empty = false
	}
	if l.Heads != nil {
		heads := &ThemeLookHeads{
			ShowCategoryIcon:         l.Heads.ShowCategoryIcon,
			ShowCategoryCount:        l.Heads.ShowCategoryCount,
			CategoryHeaderAccentLine: l.Heads.CategoryHeaderAccentLine,
		}
		// normalizeCategoryHeaderStyle turns an unknown word into the theme's
		// own; here an unknown word is dropped, and "theme" is kept only when
		// it was asked for.
		style := strings.ToLower(strings.TrimSpace(l.Heads.CategoryHeaderStyle))
		if style != "" && normalizeCategoryHeaderStyle(style) == style {
			heads.CategoryHeaderStyle = style
		}
		heads.CategoryHeaderSize = keepWord(l.Heads.CategoryHeaderSize, "s", "m", "l")
		if heads.CategoryHeaderStyle != "" || heads.CategoryHeaderSize != "" || heads.ShowCategoryIcon != nil ||
			heads.ShowCategoryCount != nil || heads.CategoryHeaderAccentLine != nil {
			out.Heads = heads
			empty = false
		}
	}
	if l.Text != nil {
		text := &ThemeLookText{
			DensityMode:     keepWord(l.Text.DensityMode, "comfortable", "compact", "dense", "auto"),
			CategorySpacing: keepWord(l.Text.CategorySpacing, "snug", "balanced", "airy"),
		}
		if font := strings.TrimSpace(l.Text.FontPreset); font != "" && isValidFontPreset(font) {
			text.FontPreset = font
		}
		if text.FontPreset != "" || text.DensityMode != "" || text.CategorySpacing != "" {
			out.Text = text
			empty = false
		}
	}
	if empty {
		return nil
	}
	return out
}
