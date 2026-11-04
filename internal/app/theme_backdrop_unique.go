package app

/*
The recipes below belong to one theme pair each. Where the shared recipes are a motif a theme
might also have, these are drawn for a single theme's name and palette: milky absinthe, the
seams of a ship's deck, the orbits of a galaxy. Each is drawn with the theme's own colours on
the deeper ground, like every other recipe, and none of them is in a pool.
*/

// themeBackdropLouche is absinthe turning cloudy: opal clouds and thin drips that hang from the
// top edge and fade out before they reach the bottom.
func themeBackdropLouche(k backdropKit) []backdropLayer {
	v := k.veil
	return []backdropLayer{
		{image: k.blob(30, 18, 70, 56, k.cool, 50)},
		{image: k.blob(78, 40, 60, 50, k.accent, 46)},
		{image: k.blob(46, 92, 90, 38, k.warm, 30)},
		{image: "linear-gradient(180deg, transparent 0, " + v(k.ground, 96) + " 78%)"},
		{image: "repeating-linear-gradient(90deg, " + v(k.accent, 36) + " 0 3px, transparent 3px " + k.px(23) + ")"},
		{image: "repeating-linear-gradient(90deg, " + v(k.warm, 26) + " 0 2px, transparent 2px " + k.px(37) + ")"},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropPlanking is the deck of a ship: horizontal seams, butt joints on two pitches that
// never line up, and a rivet where a plank is fixed.
func themeBackdropPlanking(k backdropKit) []backdropLayer {
	v := k.veil
	return []backdropLayer{
		{image: "radial-gradient(circle at 50% 50%, " + v(k.accent, 60) + " 0 2.5px, transparent 3.5px)", size: k.px(96) + " " + k.px(48)},
		{image: "linear-gradient(90deg, " + v(k.cool, 60) + " 0 1px, transparent 1px)", size: k.px(197) + " 100%"},
		{image: "linear-gradient(90deg, " + v(k.accent, 52) + " 0 1px, transparent 1px)", size: k.px(131) + " 100%"},
		{image: "repeating-linear-gradient(0deg, " + v(k.accent, 26) + " 0 1px, transparent 1px " + k.px(48) + ")"},
		{image: k.blob(80, 12, 50, 40, k.warm, 34)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropOrbits is a galaxy seen edge-on: flat elliptical orbits round a bright core, with
// a planet on three of them.
func themeBackdropOrbits(k backdropKit) []backdropLayer {
	v := k.veil
	planet := func(x, y int, c string, p int) backdropLayer {
		return backdropLayer{image: "radial-gradient(circle " + k.px(10) + " at " + pct(x) + " " + pct(y) + ", " + v("#fff", p) + " 0, " + v(c, p) + " 24%, " + v(c, p/4) + " 60%, transparent 100%)"}
	}
	return []backdropLayer{
		planet(30, 62, k.cool, 70),
		planet(88, 90, k.second, 62),
		planet(58, 70, k.accent, 66),
		{image: "repeating-radial-gradient(ellipse " + k.px(560) + " " + k.px(210) + " at 72% 80%, " + v(k.accent, 40) + " 0 0.4%, transparent 0.4% 9%)"},
		{image: "repeating-radial-gradient(ellipse " + k.px(380) + " " + k.px(130) + " at 72% 80%, " + v(k.cool, 24) + " 0 0.5%, transparent 0.5% 14%)"},
		{image: k.blob(72, 80, 34, 28, k.warm, 70)},
		{image: k.blob(10, 12, 40, 36, k.second, 30)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropFloes is ice that has split: three sheets with hard edges, each with a bright
// line along the cut.
func themeBackdropFloes(k backdropKit) []backdropLayer {
	v := k.veil
	return []backdropLayer{
		{image: "linear-gradient(118deg, transparent 0 14%, " + v(k.accent, 32) + " 14% 38%, " + v(k.cool, 62) + " 38% 38.5%, transparent 38.5% 100%)"},
		{image: "linear-gradient(62deg, transparent 0 55%, " + v(k.cool, 26) + " 55% 82%, " + v(k.accent, 56) + " 82% 82.5%, transparent 82.5% 100%)"},
		{image: "linear-gradient(160deg, transparent 0 42%, " + v(k.warm, 18) + " 42% 66%, " + v(k.cool, 44) + " 66% 66.4%, transparent 66.4% 100%)"},
		{image: k.blob(24, 78, 50, 40, k.cool, 40)},
		{image: k.blob(86, 20, 40, 40, k.accent, 36)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropCurtains is an aurora drawn as it is seen: vertical folds of light, brightest
// along the top and gone before the bottom.
func themeBackdropCurtains(k backdropKit) []backdropLayer {
	v := k.veil
	fold := func(pitch int, c string, p int) backdropLayer {
		return backdropLayer{image: "repeating-linear-gradient(90deg, transparent 0, " + v(c, p) + " " + k.px(pitch*2/5) + ", transparent " + k.px(pitch*3/4) + ", transparent " + k.px(pitch) + ")"}
	}
	return []backdropLayer{
		{image: "linear-gradient(180deg, transparent 0, " + v(k.ground, 96) + " 70%)"},
		fold(53, k.cool, 24),
		fold(71, k.accent, 22),
		fold(89, k.second, 18),
		{image: k.blob(50, -6, 90, 40, k.cool, 52)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropPanda is a bamboo grove on paper: stalks that grow from the bottom edge to
// different heights, each with its nodes, thickest along the bottom.
// Stalks are tapered blades, one tile as tall as the window, so each grows once and does not repeat.
func themeBackdropPanda(k backdropKit) []backdropLayer {
	v := k.veil
	ink := "black"
	if k.dark {
		ink = "white"
	}
	stalk := func(pitch, x, rx, ry int, c string, p int, nodes ...int) []backdropLayer {
		size := k.px(pitch) + " 100%"
		out := []backdropLayer{{
			image: "radial-gradient(ellipse " + k.px(rx) + " " + pct(ry) + " at " + k.px(x) + " 100%, " + v(c, p) + " 0 92%, transparent 100%)",
			size:  size,
		}}
		for _, at := range nodes {
			out = append(out, backdropLayer{
				image: "radial-gradient(ellipse " + k.px(rx+4) + " " + k.px(2) + " at " + k.px(x) + " " + pct(at) + ", " + v(ink, 62) + " 0 70%, transparent 100%)",
				size:  size,
			})
		}
		return out
	}
	// The page is calmer the higher it goes: the stalks fade into the paper above the middle, so
	// text over them stays readable, and the bottom edge is full.
	// The sheet the grove stands on is the theme's own paper: faint ruled lines and the red margin
	// line, over the stalks' fade so they carry all the way up the page.
	out := []backdropLayer{
		{image: "linear-gradient(90deg, transparent " + k.px(70) + ", " + v(k.second, 46) + " " + k.px(70) + " " + k.px(72) + ", transparent " + k.px(72) + ")"},
		{image: "repeating-linear-gradient(180deg, transparent 0 " + k.px(31) + ", " + v(ink, 11) + " " + k.px(31) + " " + k.px(32) + ")"},
		{image: "linear-gradient(180deg, " + v(k.ground, 94) + " 0, " + v(k.ground, 80) + " 30%, " + v(k.ground, 40) + " 52%, transparent 74%)"},
	}
	out = append(out, stalk(97, 30, 6, 100, k.accent, 56, 93, 82, 71, 60, 49, 38, 27, 16)...)
	out = append(out, stalk(131, 80, 7, 88, k.warm, 40, 91, 80, 69, 58, 47, 36, 25)...)
	out = append(out, stalk(73, 40, 4, 74, k.accent, 42, 92, 81, 70, 59, 48, 37)...)
	out = append(out, stalk(173, 120, 8, 96, ink, 34, 94, 83, 72, 61, 50, 39, 28, 17)...)
	out = append(out, stalk(59, 22, 3, 58, k.warm, 34, 90, 78, 66, 54, 42)...)
	out = append(out, stalk(113, 70, 5, 82, k.accent, 46, 93, 82, 71, 60, 49, 38, 27)...)
	out = append(out, stalk(89, 55, 4, 66, ink, 28, 91, 79, 67, 55, 43)...)
	out = append(out, stalk(47, 16, 3, 44, k.accent, 52, 90, 76, 62)...)
	out = append(out, stalk(67, 48, 4, 36, k.warm, 44, 88, 72)...)
	out = append(out, stalk(79, 30, 5, 48, k.accent, 48, 91, 77, 63)...)
	out = append(out, stalk(103, 90, 6, 40, ink, 30, 90, 74)...)
	out = append(out, stalk(37, 12, 3, 30, k.cool, 50, 86)...)
	out = append(out, stalk(53, 36, 4, 52, k.accent, 44, 92, 78, 64)...)
	out = append(out, backdropLayer{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"})
	return out
}

// themeBackdropPlankton is the deep sea lit from within: soft orbs with a white core, in the four
// colours of the theme, on pitches that share no factor.
func themeBackdropPlankton(k backdropKit) []backdropLayer {
	v := k.veil
	orb := func(w, h, x, y, r int, c string, p int) backdropLayer {
		return backdropLayer{
			image: "radial-gradient(circle at " + k.px(x) + " " + k.px(y) + ", " + v("#fff", p) + " 0, " + v(c, p) + " " + k.px(r/4+1) + ", " + v(c, p/3) + " " + k.px(r) + ", transparent " + k.px(r*2) + ")",
			size:  k.px(w) + " " + k.px(h),
		}
	}
	return []backdropLayer{
		orb(167, 149, 40, 36, 12, k.cool, 58),
		orb(211, 193, 130, 120, 16, k.accent, 54),
		orb(113, 127, 30, 90, 8, k.warm, 56),
		orb(251, 233, 190, 40, 20, k.second, 44),
		{image: k.blob(50, 112, 100, 40, k.accent, 44)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropCompass is construction geometry: circles struck from two corners, and the two
// axes through each centre.
func themeBackdropCompass(k backdropKit) []backdropLayer {
	v := k.veil
	hair := func(axis string, at int, c string, p int) backdropLayer {
		return backdropLayer{image: "linear-gradient(" + axis + ", transparent calc(" + pct(at) + " - 0.5px), " + v(c, p) + " calc(" + pct(at) + " - 0.5px) calc(" + pct(at) + " + 0.5px), transparent calc(" + pct(at) + " + 0.5px))"}
	}
	return []backdropLayer{
		hair("90deg", 12, k.accent, 50),
		hair("0deg", 12, k.accent, 50),
		hair("90deg", 88, k.cool, 44),
		hair("0deg", 88, k.cool, 44),
		{image: "repeating-radial-gradient(circle at 12% 88%, " + v(k.accent, 42) + " 0 1px, transparent 1px " + k.px(44) + ")"},
		{image: "repeating-radial-gradient(circle at 88% 12%, " + v(k.cool, 36) + " 0 1px, transparent 1px " + k.px(61) + ")"},
		{image: k.blob(12, 88, 40, 40, k.accent, 30)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropCraquelure is the fine crazing of an old glaze: three sets of hairlines on pitches
// that do not repeat, over a pearl sheen.
func themeBackdropCraquelure(k backdropKit) []backdropLayer {
	return []backdropLayer{
		{image: k.line(k.accent, 26, 17, 97)},
		{image: k.line(k.second, 20, 74, 131)},
		{image: k.line(k.warm, 22, 131, 173)},
		{image: k.blob(26, 26, 60, 60, k.cool, 34)},
		{image: k.blob(80, 80, 50, 50, k.warm, 30)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}

// themeBackdropRibbons is the northern lights as bands that sweep the sky: three arcs from three
// centres below the page, each fading on both sides.
func themeBackdropRibbons(k backdropKit) []backdropLayer {
	v := k.veil
	ribbon := func(cx, cy, rx, ry int, c string, p int) backdropLayer {
		return backdropLayer{image: "radial-gradient(ellipse " + pct(rx) + " " + pct(ry) + " at " + pct(cx) + " " + pct(cy) + ", transparent 0 52%, " + v(c, p/3) + " 60%, " + v(c, p) + " 67%, " + v(c, p/3) + " 74%, transparent 84% 100%)"}
	}
	return []backdropLayer{
		ribbon(15, 132, 100, 90, k.cool, 58),
		ribbon(86, 140, 110, 100, k.accent, 54),
		ribbon(50, 122, 140, 80, k.second, 44),
		{image: k.blob(50, -8, 90, 40, k.cool, 40)},
		{image: "linear-gradient(" + k.ground + ", " + k.ground + ")"},
	}
}
