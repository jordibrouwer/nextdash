package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// slowReadStore widens the window between reading the settings and writing
// them back, so two saves reliably overlap.
type slowReadStore struct{ Store }

func (s slowReadStore) GetSettings() Settings {
	settings := s.Store.GetSettings()
	time.Sleep(40 * time.Millisecond)
	return settings
}

// Two partial saves at once both land: each reads, merges and writes under
// one lock, so the second does not start from a snapshot without the first.
func TestOverlappingSettingsSavesBothLand(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	t.Chdir(t.TempDir())
	store := NewStore()
	h := NewHandlers(slowReadStore{store}, embeddedFiles)

	var wg sync.WaitGroup
	for _, body := range []string{`{"showCheatSheetButton":false}`, `{"bookmarkStaleDays":7}`} {
		wg.Add(1)
		go func(body string) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			h.SaveSettings(rec, httptest.NewRequest(http.MethodPost, "/api/settings", strings.NewReader(body)))
			if rec.Code != http.StatusOK {
				t.Errorf("save %s: %d %s", body, rec.Code, rec.Body.String())
			}
		}(body)
	}
	wg.Wait()

	got := store.GetSettings()
	if got.ShowCheatSheetButton || got.BookmarkStaleDays != 7 {
		t.Fatalf("one save was lost: cheat sheet button %v, stale days %d", got.ShowCheatSheetButton, got.BookmarkStaleDays)
	}
}
