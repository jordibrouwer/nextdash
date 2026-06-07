package main

import "testing"

func TestManifestAppName(t *testing.T) {
	t.Parallel()

	if got := manifestAppName(Settings{}); got != "nextDash" {
		t.Fatalf("default name = %q, want nextDash", got)
	}

	custom := manifestAppName(Settings{
		EnableCustomTitle: true,
		CustomTitle:       "  My Dash  ",
	})
	if custom != "My Dash" {
		t.Fatalf("custom name = %q, want My Dash", custom)
	}
}

func TestManifestShortName(t *testing.T) {
	t.Parallel()

	if got := manifestShortName("short"); got != "short" {
		t.Fatalf("short name unchanged: %q", got)
	}

	long := manifestShortName("A very long dashboard title")
	if long != "A very long " {
		t.Fatalf("truncated short name = %q", long)
	}
}

func TestFaviconMimeFromPath(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"/icons/favicon.png":  "image/png",
		"/icons/logo.JPG":     "image/jpeg",
		"/static/favicon.ico": "image/x-icon",
	}
	for path, want := range cases {
		if got := faviconMimeFromPath(path); got != want {
			t.Fatalf("%s => %q, want %q", path, got, want)
		}
	}
}

func TestManifestThemeColors(t *testing.T) {
	t.Parallel()

	bg, theme := manifestThemeColors("light")
	if bg != "#f5f5f5" || theme != "#2563eb" {
		t.Fatalf("light theme = %q / %q", bg, theme)
	}

	bg, theme = manifestThemeColors("dark")
	if bg != "#121212" || theme != "#60a5fa" {
		t.Fatalf("dark theme = %q / %q", bg, theme)
	}
}

func TestManifestIconsCustomFavicon(t *testing.T) {
	t.Parallel()

	icons := manifestIcons(Settings{
		EnableCustomFavicon: true,
		CustomFaviconPath:   "/icons/app.png",
	})
	if len(icons) != 3 {
		t.Fatalf("expected 3 custom icons, got %d", len(icons))
	}
	if icons[0].Src != "/icons/app.png" || icons[0].Type != "image/png" {
		t.Fatalf("unexpected first icon: %+v", icons[0])
	}
}
