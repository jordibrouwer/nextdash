package app

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// v1.19.4 kept Jellyfin posters in data/jellyfin-images; that folder goes on
// the first new picture instead of lying there for ever.
func TestMediaImagesClearTheOldJellyfinFolder(t *testing.T) {
	h := newTestHandlers(t)
	old := filepath.Join(ResolveDataDir(), legacyJellyfinImageDirName)
	if err := os.MkdirAll(old, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(old, "jf-old"), jellyfinTestPNG, 0o644)
	legacyImagesGone = sync.Once{}

	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)
	poster := askJellyfinWidget(t, h, id).Items[0].Poster
	if rec := askJellyfinImage(h, poster); rec.Code != 200 {
		t.Fatalf("poster answered %d", rec.Code)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("the old folder is still there: %v", err)
	}
}

// Two services never share an answer, even for the same page and widget id.
func TestMediaCacheIsPerService(t *testing.T) {
	mediaForgetAll()
	h := newTestHandlers(t)
	spec := func(service string) mediaSpec {
		return mediaSpec{Service: service, Server: "http://x", CredentialID: "c", Fingerprint: "f", TTL: time.Minute}
	}
	fetch := func(title string) mediaFetch {
		return func(ctx context.Context, _ func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error) {
			return MediaResult{Items: []MediaItem{{ID: title, Title: title}}}, nil, nil
		}
	}
	a := h.mediaAnswer(context.Background(), 1, "w_000000000001", spec("sonarr"), fetch("from sonarr"), false)
	b := h.mediaAnswer(context.Background(), 1, "w_000000000001", spec("radarr"), fetch("from radarr"), false)
	if a.Items[0].Title != "from sonarr" || b.Items[0].Title != "from radarr" {
		t.Fatalf("answers crossed: %q / %q", a.Items[0].Title, b.Items[0].Title)
	}
}
