package app

import "testing"

// The cap is one of a short list rather than a free number: how much disk to
// give a cache of decoration is a choice between a few sizes, not a dial. A
// stored value outside the list is a hand-edited settings file or a value from
// a version that offered something else, and falls back to the default rather
// than being honoured.
func TestNormalizePreviewImageCacheMB(t *testing.T) {
	cases := []struct {
		in   int
		want int
		why  string
	}{
		{50, 50, "an offered size"},
		{200, 200, "an offered size"},
		{500, 500, "an offered size"},
		{0, 200, "unset, which is every install before this release"},
		{-1, 200, "nonsense"},
		{123, 200, "not one of the offered sizes"},
		{5000, 200, "not one of the offered sizes"},
	}
	for _, c := range cases {
		if got := normalizePreviewImageCacheMB(c.in); got != c.want {
			t.Errorf("normalizePreviewImageCacheMB(%d) = %d, want %d (%s)", c.in, got, c.want, c.why)
		}
	}
}

func TestPreviewImageCapBytesReadsTheSetting(t *testing.T) {
	// Before NewStore: without it the store writes into the repository's own
	// data/ directory, which is the developer's real dashboard.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := &Handlers{store: NewStore()}

	// The default an install starts on.
	if got, want := h.previewImageCapBytes(), int64(200)<<20; got != want {
		t.Errorf("previewImageCapBytes() = %d, want the %d default", got, want)
	}

	settings := h.store.GetSettings()
	settings.PreviewImageCacheMB = 50
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("save settings: %v", err)
	}
	if got, want := h.previewImageCapBytes(), int64(50)<<20; got != want {
		t.Errorf("previewImageCapBytes() = %d, want %d after the setting changed", got, want)
	}
}
