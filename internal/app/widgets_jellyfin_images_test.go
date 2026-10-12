package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func askJellyfinImage(h *Handlers, address string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.JellyfinImageHandler(rec, httptest.NewRequest(http.MethodGet, address, nil))
	return rec
}

func TestJellyfinImageServesWhatTheAnswerOffered(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)
	poster := askJellyfinWidget(t, h, id).Items[0].Poster

	rec := askJellyfinImage(h, poster)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("status %d, type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Error("a tagged picture is not cached for good")
	}
	entries, _ := os.ReadDir(filepath.Join(ResolveDataDir(), mediaImageDirName, "jellyfin"))
	if len(entries) != 1 {
		t.Fatalf("%d files in the cache, want 1", len(entries))
	}

	hits := fake.imageHits
	askJellyfinImage(h, poster)
	if fake.imageHits != hits {
		t.Error("a cached picture was fetched again")
	}
}

func TestJellyfinImageRefusesAnythingElse(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	id := jellyfinTestWidget(t, h, fake, nil)
	askJellyfinWidget(t, h, id)

	for _, address := range []string{
		"/api/widgets/jellyfin/image?pageId=1&id=" + id + "&item=other&kind=poster&tag=pt1",
		"/api/widgets/jellyfin/image?pageId=1&id=" + id + "&item=m1&kind=poster&tag=wrong",
		"/api/widgets/jellyfin/image?pageId=1&id=" + id + "&item=m1&kind=logo&tag=pt1",
		"/api/widgets/jellyfin/image?pageId=1&id=w_other&item=m1&kind=poster&tag=pt1",
	} {
		if rec := askJellyfinImage(h, address); rec.Code != http.StatusNotFound && rec.Code != http.StatusBadRequest {
			t.Errorf("%s answered %d", address, rec.Code)
		}
	}
	if fake.imageHits != 0 {
		t.Error("a refused address still reached Jellyfin")
	}
}

func TestJellyfinImageFetchesOnceForManyAskers(t *testing.T) {
	h := newTestHandlers(t)
	fake := newFakeJellyfin(t)
	fake.imageWait = 80 * time.Millisecond
	id := jellyfinTestWidget(t, h, fake, nil)
	poster := askJellyfinWidget(t, h, id).Items[0].Poster

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); askJellyfinImage(h, poster) }()
	}
	wg.Wait()
	if fake.imageHits != 1 {
		t.Fatalf("Jellyfin was asked %d times for one picture", fake.imageHits)
	}
}

func TestEvictImagesInDropsTheOldestFirst(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	for i, name := range []string{"old", "mid", "new"} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, make([]byte, 100), 0o644); err != nil {
			t.Fatal(err)
		}
		at := now.Add(time.Duration(i-3) * time.Hour)
		_ = os.Chtimes(path, at, at)
	}
	if removed, err := evictImagesIn(dir, 150); err != nil || removed != 2 {
		t.Fatalf("removed %d, err %v", removed, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "new")); err != nil {
		t.Error("the newest file was evicted")
	}
}

func TestBackupLeavesJellyfinImagesOut(t *testing.T) {
	h := newTestHandlers(t)
	dir := filepath.Join(ResolveDataDir(), mediaImageDirName, "jellyfin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "jf-test.png"), jellyfinTestPNG, 0o644); err != nil {
		t.Fatal(err)
	}
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), mediaImageDirName+"/") {
		t.Error("cached Jellyfin pictures went into the backup")
	}
}
