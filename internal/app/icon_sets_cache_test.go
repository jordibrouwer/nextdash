package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestIconSetRouteRefusesWhatTheIndexDoesNotName(t *testing.T) {
	useIconSetsFixture(t)
	h := dataFileHandler(t.TempDir())
	for _, p := range []string{
		"/data/icon-sets/evil/sonarr.svg",
		"/data/icon-sets/dashboard-icons/../settings.json",
		"/data/icon-sets/dashboard-icons/not-in-index.svg",
		"/data/icon-sets/dashboard-icons/Sonarr.svg",
		"/data/icon-sets/dashboard-icons/sub/sonarr.svg",
		"/data/icon-sets/dashboard-icons",
		"/data/icon-sets/state.json",
		"/data/icon-sets/index-selfhst.json",
	} {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", p, rec.Code)
		}
	}
}

func TestIconSetRouteServesAKnownIcon(t *testing.T) {
	useIconSetsFixture(t)
	rec := httptest.NewRecorder()
	dataFileHandler(t.TempDir())(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/sonarr-dark.svg", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<svg") {
		t.Fatalf("%d", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=86400" {
		t.Errorf("Cache-Control %q", got)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Errorf("Content-Type %q", ct)
	}
}

// A file the cache does not have yet is fetched once, sanitised, and served
// from disk after that.
func TestIconSetRouteFetchesOnceAndSanitises(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dataDir)
	// The index comes from the fixture; the files from a stub CDN.
	mirror := filepath.Join(dataDir, iconSetsDirName)
	_ = os.MkdirAll(mirror, 0o755)
	for _, name := range []string{"index-dashboard-icons.json", "index-selfhst.json"} {
		b, _ := os.ReadFile(filepath.Join("testdata/icon-sets", name))
		_ = os.WriteFile(filepath.Join(mirror, name), b, 0o644)
	}
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.URL.Path == "/homarr-labs/dashboard-icons/svg/jellyseerr.svg" {
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>`))
			return
		}
		if r.URL.Path != "/homarr-labs/dashboard-icons/svg/jellyfin.svg" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect/></svg>`))
	}))
	defer srv.Close()
	old := iconSetsCDNBase
	iconSetsCDNBase = srv.URL + "/"
	t.Cleanup(func() { iconSetsCDNBase = old; resetIconSetsForTest() })
	resetIconSetsForTest()
	loadIconSetsFromDisk()

	h := dataFileHandler(dataDir)
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/jellyfin.svg", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: %d", i, rec.Code)
		}
		body := rec.Body.String()
		if strings.Contains(body, "script") || strings.Contains(body, "onload") {
			t.Fatalf("not sanitised: %s", body)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("fetched %d times, want once", hits.Load())
	}

	// A name the index does not know never leaves the server.
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/anything-at-all.svg", nil))
	if rec.Code != http.StatusNotFound || hits.Load() != 1 {
		t.Fatalf("unknown name: %d, %d fetches", rec.Code, hits.Load())
	}

	// A PNG in an SVG wrapper would be an empty square once sanitised.
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/jellyseerr.svg", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("wrapped PNG: got %d", rec.Code)
	}

	// A file upstream does not have is a 404, and nothing is written.
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/plex.svg", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("upstream 404: got %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(mirror, iconSetDashboard, "plex.svg")); err == nil {
		t.Fatal("a failed fetch left a file behind")
	}
	// And is not asked for again within the hour.
	before := hits.Load()
	rec = httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/data/icon-sets/dashboard-icons/plex.svg", nil))
	if rec.Code != http.StatusNotFound || hits.Load() != before {
		t.Fatalf("a miss went out again: %d, %d -> %d fetches", rec.Code, before, hits.Load())
	}
}

func TestAdoptIconSetFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	useIconSetsFixture(t)
	_ = os.MkdirAll(filepath.Join(dir, "icons"), 0o755)
	_ = os.WriteFile(filepath.Join(dir, "icons", "sonarr.svg"), []byte("<svg>someone else's</svg>"), 0o644)

	name, err := adoptIconSetFile(context.Background(), iconSetDashboard, "sonarr.svg")
	if err != nil || name != "sonarr-2.svg" {
		t.Fatalf("collision: %q %v", name, err)
	}
	again, err := adoptIconSetFile(context.Background(), iconSetDashboard, "sonarr.svg")
	if err != nil || again != "sonarr-2.svg" {
		t.Fatalf("same bytes must reuse the file, got %q %v", again, err)
	}
	dark, err := adoptIconSetFile(context.Background(), iconSetDashboard, "sonarr-dark.svg")
	if err != nil || dark != "sonarr-dark.svg" {
		t.Fatalf("free name: %q %v", dark, err)
	}
	if _, err := adoptIconSetFile(context.Background(), iconSetDashboard, "../../settings.json"); err == nil {
		t.Fatal("a path outside the index must be refused")
	}
}
