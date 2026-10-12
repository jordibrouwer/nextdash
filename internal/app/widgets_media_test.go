package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
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

// A service that signs in for a cookie (qBittorrent) is signed in once, and
// again when the session has lapsed -- not reported as a refused key.
func TestMediaRequestSignsInAgain(t *testing.T) {
	h := newTestHandlers(t)
	var mu sync.Mutex
	logins, valid := 0, ""
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path == "/api/v2/auth/login" {
			if r.Header.Get("Referer") == "" || r.FormValue("password") != "secret" {
				_, _ = w.Write([]byte("Fails."))
				return
			}
			logins++
			valid = fmt.Sprintf("sid%d", logins)
			http.SetCookie(w, &http.Cookie{Name: "SID", Value: valid})
			_, _ = w.Write([]byte("Ok."))
			return
		}
		if c, err := r.Cookie("SID"); err != nil || c.Value != valid {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		_, _ = w.Write([]byte("[]"))
	}))
	defer fake.Close()
	credential := func(password string) HealthCredential {
		return HealthCredential{Session: &CredentialSession{LoginPath: "/api/v2/auth/login",
			UserField: "username", PassField: "password", User: "u", Password: password, Referer: true}}
	}
	ask := func(password string) error {
		resp, err := h.mediaRequest(context.Background(), fake.URL, credential(password), "/api/v2/torrents/info", nil, "application/json", nil)
		if resp != nil {
			resp.Body.Close()
		}
		return err
	}
	if err := ask("secret"); err != nil {
		t.Fatalf("first ask: %v", err)
	}
	mu.Lock()
	valid = "expired"
	mu.Unlock()
	if err := ask("secret"); err != nil {
		t.Fatalf("after the session lapsed: %v", err)
	}
	if logins != 2 {
		t.Errorf("signed in %d times, want 2", logins)
	}
	if err := ask("wrong"); !errors.Is(err, errMediaRefused) {
		t.Errorf("wrong password gave %v, want key refused", err)
	}
}
