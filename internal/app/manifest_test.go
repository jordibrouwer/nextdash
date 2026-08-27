package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

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

func TestWebAppManifestThemeColors(t *testing.T) {
	t.Parallel()

	h := &Handlers{store: NewStore()}
	settings := h.store.GetSettings()
	settings.Theme = "moss-stone-dark"
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	rec := httptest.NewRecorder()
	h.WebAppManifest(rec, httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var manifest webManifest
	if err := json.Unmarshal(rec.Body.Bytes(), &manifest); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}

	want := themeBackgroundPrimary("moss-stone-dark", h.store.GetColors())
	if manifest.BackgroundColor != want || manifest.ThemeColor != want {
		t.Fatalf("manifest colors = %q / %q, want both %q",
			manifest.BackgroundColor, manifest.ThemeColor, want)
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

// The share target is what puts nextDash in a phone's share sheet, and the
// shortcuts are the installed icon's long-press menu. Both are pure manifest,
// so the only thing that can break them is the manifest not carrying them.
func TestManifestCarriesShareTargetAndShortcuts(t *testing.T) {
	h, _ := healthTestStore(t, `{"id":1,"name":"Page 1","bookmarks":[]}`)

	rec := httptest.NewRecorder()
	h.WebAppManifest(rec, httptest.NewRequest(http.MethodGet, "/manifest.json", nil))

	var doc struct {
		ShareTarget struct {
			Action string `json:"action"`
			Method string `json:"method"`
			Params struct {
				Title string `json:"title"`
				Text  string `json:"text"`
				URL   string `json:"url"`
			} `json:"params"`
		} `json:"share_target"`
		Shortcuts []struct {
			Name string `json:"name"`
			URL  string `json:"url"`
		} `json:"shortcuts"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("manifest json: %v", err)
	}

	if doc.ShareTarget.Action != "/share" {
		t.Fatalf("share action = %q, want /share", doc.ShareTarget.Action)
	}
	// GET rather than POST: POST needs a service worker to catch the form, and
	// the handler only has to redirect.
	if doc.ShareTarget.Method != "GET" {
		t.Fatalf("share method = %q, want GET", doc.ShareTarget.Method)
	}
	// All three fields, because a share sheet fills them inconsistently and the
	// handler reads whichever one holds the address.
	if doc.ShareTarget.Params.Title == "" || doc.ShareTarget.Params.Text == "" || doc.ShareTarget.Params.URL == "" {
		t.Fatalf("share params = %+v, want all three named", doc.ShareTarget.Params)
	}
	if len(doc.Shortcuts) < 3 {
		t.Fatalf("shortcuts = %d, want the long-press menu", len(doc.Shortcuts))
	}
}
