package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPreviewMediaFetchDue(t *testing.T) {
	now := time.Now().UnixMilli()

	// A local path only counts when the file is really there: eviction and the
	// orphan sweep both delete files without touching the entries naming them.
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	if err := os.MkdirAll(previewImageDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(previewImageDir(), "pi-abc.png"), pngBytes(8), 0o644); err != nil {
		t.Fatal(err)
	}
	const present = "/data/preview-images/pi-abc.png"
	const evicted = "/data/preview-images/pi-gone.png"

	cases := []struct {
		name  string
		entry BookmarkPreview
		want  bool
	}{
		{
			// A 404 or a timeout a minute ago. Retrying on every hover would
			// hammer a dead host forever.
			name:  "tried a minute ago",
			entry: BookmarkPreview{ImageSource: "https://example.com/og.png", ImageFetchedAt: now - 60_000},
			want:  false,
		},
		{
			// Past the base week *and* the spread window, so it is due whatever
			// slot this source landed in.
			name:  "tried longer ago than the whole spread window",
			entry: BookmarkPreview{ImageSource: "https://example.com/og.png", ImageFetchedAt: now - previewCacheTTLMs - previewMediaTTLSpreadMs - 1},
			want:  true,
		},
		{
			name:  "never tried",
			entry: BookmarkPreview{ImageSource: "https://example.com/og.png"},
			want:  true,
		},
		{
			name:  "nothing to fetch",
			entry: BookmarkPreview{},
			want:  false,
		},
		{
			name: "already local",
			entry: BookmarkPreview{
				ImageSource: "https://example.com/og.png",
				Image:       present,
			},
			want: false,
		},
		{
			// The entry still names a picture, but eviction took the file. The
			// old check looked at the field alone and called this done, so the
			// image never came back.
			name: "named but evicted",
			entry: BookmarkPreview{
				ImageSource: "https://example.com/og.png",
				Image:       evicted,
			},
			want: true,
		},
		{
			// The image landed and the icon did not: still work to do.
			name: "image local, icon still missing",
			entry: BookmarkPreview{
				ImageSource: "https://example.com/og.png",
				Image:       present,
				IconSource:  "https://example.com/favicon.ico",
			},
			want: true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := previewMediaFetchDue(c.entry); got != c.want {
				t.Errorf("previewMediaFetchDue() = %v, want %v", got, c.want)
			}
		})
	}
}

// The job is what turns a remote address into a local path, and it must write
// the result back into the cache -- the card that asked has already been drawn
// without a picture, so the next hover is the only thing that can show it.
func TestRunPreviewMediaJobStoresLocallyAndUpdatesTheCache(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(pngBytes(32))
	}))
	defer server.Close()

	h := &Handlers{store: NewStore()}
	// httptest binds to loopback, which the SSRF gate refuses unless local
	// bookmarks are allowed.
	settings := h.store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	key := "https://example.com"
	h.runPreviewMediaJob(previewMediaJob{key: key, wantImage: true, wantIcon: true, entry: BookmarkPreview{
		URL: key,
		// A real entry always carries this: it is when the page was parsed, and
		// getPreviewCacheEntry treats a zero as long expired.
		FetchedAt:   time.Now().UnixMilli(),
		ImageSource: server.URL + "/og.png",
	}})

	entry, ok := h.getPreviewCacheEntry(key)
	if !ok {
		t.Fatal("the job wrote nothing back to the cache")
	}
	if !strings.HasPrefix(entry.Image, "/data/preview-images/") {
		t.Errorf("Image = %q, want a local path", entry.Image)
	}
	if entry.ImageSource != server.URL+"/og.png" {
		t.Errorf("ImageSource = %q, want it kept so the file can be fetched again", entry.ImageSource)
	}
	if entry.ImageFetchedAt == 0 {
		t.Error("ImageFetchedAt is unset, so the fetch would repeat on every hover")
	}
	if files, _ := previewImageCacheUsage(); files != 1 {
		t.Errorf("%d files stored, want 1", files)
	}
}

// A source that cannot be fetched still stamps the attempt. Without that, every
// hover on a bookmark whose og:image 404s would queue another download.
func TestRunPreviewMediaJobStampsAFailedFetch(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	h := &Handlers{store: NewStore()}
	settings := h.store.GetSettings()
	settings.AllowLocalBookmarks = true
	if err := h.store.SaveSettings(settings); err != nil {
		t.Fatalf("save settings: %v", err)
	}

	key := "https://example.com"
	h.runPreviewMediaJob(previewMediaJob{key: key, wantImage: true, wantIcon: true, entry: BookmarkPreview{
		URL:         key,
		FetchedAt:   time.Now().UnixMilli(),
		ImageSource: server.URL + "/gone.png",
	}})

	entry, ok := h.getPreviewCacheEntry(key)
	if !ok {
		t.Fatal("the job wrote nothing back to the cache")
	}
	if entry.Image != "" {
		t.Errorf("Image = %q, want it still empty", entry.Image)
	}
	if entry.ImageFetchedAt == 0 {
		t.Fatal("a failed fetch was not stamped, so it would retry forever")
	}
	if previewMediaFetchDue(entry) {
		t.Error("a just-failed fetch is due again immediately")
	}
}

// A flat week meant a herd: everything cached in one go expires in one go, and
// a week later the whole collection reaches out inside the same window.
func TestPreviewMediaTTLIsSpreadPerSource(t *testing.T) {
	const window = previewCacheTTLMs + previewMediaTTLSpreadMs

	a := previewMediaTTLMs("https://example.com/og.png")
	b := previewMediaTTLMs("https://other.example/og.png")

	if a == b {
		t.Errorf("two sources share a TTL (%d), so they still expire together", a)
	}
	// Stable across calls, so a restart does not move a picture to a new slot.
	if a != previewMediaTTLMs("https://example.com/og.png") {
		t.Error("the same source got two different TTLs")
	}
	for _, got := range []int64{a, b} {
		if got < previewCacheTTLMs || got >= window {
			t.Errorf("TTL %d falls outside [%d, %d)", got, previewCacheTTLMs, window)
		}
	}
	// Nothing to spread on falls back to the flat week rather than to zero.
	if previewMediaTTLMs("") != previewCacheTTLMs {
		t.Error("an empty source did not fall back to the base TTL")
	}
}

// Turning the card off has to turn the fetching off with it. The rows still ask
// the server for their tooltip text when cards are off, so without this the
// pictures were fetched and stored for a card that never opens.
func TestPreviewMediaWantedFollowsWhatTheReaderAskedFor(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	h := &Handlers{store: NewStore()}

	set := func(mutate func(*Settings)) {
		s := h.store.GetSettings()
		mutate(&s)
		if err := h.store.SaveSettings(s); err != nil {
			t.Fatalf("save settings: %v", err)
		}
	}

	set(func(s *Settings) {
		s.LinkPreviewMode = "hover"
		s.ShowLinkPreviewCards = true
		s.LinkPreviewParts = nil
	})
	if image, icon := h.previewMediaWanted(); !image || !icon {
		t.Errorf("with the card on and no checklist: image=%v icon=%v, want both", image, icon)
	}

	// Off means off: nothing is drawn, so nothing is worth fetching.
	set(func(s *Settings) { s.LinkPreviewMode = "off"; s.ShowLinkPreviewCards = false })
	if image, icon := h.previewMediaWanted(); image || icon {
		t.Errorf("with the card off: image=%v icon=%v, want neither", image, icon)
	}

	// The checklist is the finer control. Unticking Image stops the pictures;
	// the site icon sits in the card's header rather than in the rows.
	set(func(s *Settings) {
		s.LinkPreviewMode = "hover"
		s.ShowLinkPreviewCards = true
		s.LinkPreviewParts = []string{"description", "note"}
	})
	if image, icon := h.previewMediaWanted(); image || !icon {
		t.Errorf("with Image unticked: image=%v icon=%v, want image off and icon on", image, icon)
	}

	set(func(s *Settings) { s.LinkPreviewParts = []string{"image", "description"} })
	if image, _ := h.previewMediaWanted(); !image {
		t.Error("Image is ticked, so pictures are wanted")
	}
}
