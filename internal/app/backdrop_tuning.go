package app

import (
	"encoding/json"
	"math"
)

/*
BackdropTuning is how the reader has turned the knobs on the backdrop.

Strength, Scale and Seed belong to the backdrop a theme draws itself
(themeBackdropImage): how loud it is, how large its shapes are, and which roll
of the same recipe is on screen. Blur, Brightness, Saturate and Tint belong to
the reader's own background image, which is drawn over the backdrop and which
the recipe's own numbers cannot reach.

Zero is not "unset" here. A Strength of 0 is a real answer -- the shapes are
there and invisible -- so the defaults are filled in by defaultBackdropTuning
and by the missing-key pass in GetSettings, and a stored 0 is kept.
*/
type BackdropTuning struct {
	Strength   float64 `json:"strength"`
	Scale      float64 `json:"scale"`
	Seed       int     `json:"seed"`
	Blur       float64 `json:"blur"`
	Brightness float64 `json:"brightness"`
	Saturate   float64 `json:"saturate"`
	Tint       float64 `json:"tint"`
}

// The ranges the sliders offer. A hand-edited settings file is held to them so
// a value in the stylesheet is always one the page was designed for.
const (
	backdropStrengthMax   = 2
	backdropScaleMin      = 0.5
	backdropScaleMax      = 2
	backdropSeedMax       = 40
	backdropBlurMax       = 20
	backdropBrightnessMin = 0.3
	backdropBrightnessMax = 1.4
	backdropSaturateMax   = 2
	backdropTintMax       = 0.9
)

// defaultBackdropTuning is the backdrop as it was drawn before it could be
// tuned: full strength, natural size, the id's own roll, nothing done to a
// background image.
func defaultBackdropTuning() BackdropTuning {
	return BackdropTuning{Strength: 1, Scale: 1, Seed: 0, Blur: 0, Brightness: 1, Saturate: 1, Tint: 0}
}

// normalizeBackdropTuning clamps every field to its slider and rounds it to
// the step the slider offers, so the file and the config view agree on what is
// stored. A number that is not one (NaN, infinity) falls back to the default.
func normalizeBackdropTuning(t BackdropTuning) BackdropTuning {
	def := defaultBackdropTuning()
	clamp := func(v, lo, hi, fallback float64) float64 {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fallback
		}
		return math.Round(math.Min(hi, math.Max(lo, v))*100) / 100
	}
	t.Strength = clamp(t.Strength, 0, backdropStrengthMax, def.Strength)
	t.Scale = clamp(t.Scale, backdropScaleMin, backdropScaleMax, def.Scale)
	t.Blur = clamp(t.Blur, 0, backdropBlurMax, def.Blur)
	t.Brightness = clamp(t.Brightness, backdropBrightnessMin, backdropBrightnessMax, def.Brightness)
	t.Saturate = clamp(t.Saturate, 0, backdropSaturateMax, def.Saturate)
	t.Tint = clamp(t.Tint, 0, backdropTintMax, def.Tint)
	if t.Seed < 0 {
		t.Seed = 0
	}
	if t.Seed > backdropSeedMax {
		t.Seed = backdropSeedMax
	}
	return t
}

// fillMissingBackdropTuning gives every field the stored object lacks its
// default. raw is the "backdropTuning" value from the settings file, or nil
// when the file has none. Json decoding leaves an absent number at 0, which
// for Strength, Scale, Brightness and Saturate is not the default and for
// Strength and Saturate is a legitimate answer, so "absent" has to be read
// from the file and not from the value.
func fillMissingBackdropTuning(t *BackdropTuning, raw json.RawMessage) {
	def := defaultBackdropTuning()
	var keys map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &keys) != nil {
		*t = def
		return
	}
	if _, ok := keys["strength"]; !ok {
		t.Strength = def.Strength
	}
	if _, ok := keys["scale"]; !ok {
		t.Scale = def.Scale
	}
	if _, ok := keys["brightness"]; !ok {
		t.Brightness = def.Brightness
	}
	if _, ok := keys["saturate"]; !ok {
		t.Saturate = def.Saturate
	}
}
