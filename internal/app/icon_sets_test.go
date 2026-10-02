package app

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// useIconSetsFixture points the index at testdata and loads it.
func useIconSetsFixture(t *testing.T) {
	t.Helper()
	// Absolute: a test that changes directory still finds it.
	dir, err := filepath.Abs("testdata/icon-sets")
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("NEXTDASH_ICON_SETS_FIXTURE", dir)
	resetIconSetsForTest()
	loadIconSetsFromDisk()
	t.Cleanup(resetIconSetsForTest)
}

func TestRefreshIconSetsConditionalAndStale(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	di, _ := os.ReadFile("testdata/icon-sets/index-dashboard-icons.json")
	sh, _ := os.ReadFile("testdata/icon-sets/index-selfhst.json")
	var conditional, fail atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() == 1 {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		if r.Header.Get("If-None-Match") == `"v1"` {
			conditional.Add(1)
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v1"`)
		if strings.HasSuffix(r.URL.Path, "metadata.json") {
			_, _ = w.Write(di)
		} else {
			_, _ = w.Write(sh)
		}
	}))
	defer srv.Close()
	old := iconSetsCDNBase
	iconSetsCDNBase = srv.URL + "/"
	t.Cleanup(func() { iconSetsCDNBase = old; resetIconSetsForTest() })
	resetIconSetsForTest()

	if err := refreshIconSets(context.Background()); err != nil {
		t.Fatal(err)
	}
	if currentIconSets().lookup("sonarr") == nil || currentIconSets().lookup("degoog") == nil {
		t.Fatal("both sets should be loaded")
	}
	if err := refreshIconSets(context.Background()); err != nil {
		t.Fatal(err)
	}
	if conditional.Load() != 2 {
		t.Fatalf("second refresh should be conditional for both sets, got %d", conditional.Load())
	}

	fail.Store(1)
	if err := refreshIconSets(context.Background()); err == nil {
		t.Fatal("a failing CDN should report an error")
	}
	if currentIconSets().lookup("sonarr") == nil {
		t.Fatal("a failed refresh dropped the index it had")
	}

	// A restart reads the mirrors back without going out.
	resetIconSetsForTest()
	loadIconSetsFromDisk()
	if currentIconSets().lookup("sonarr") == nil {
		t.Fatal("mirror not read back from disk")
	}
}

func TestRefreshIconSetsKeepsMirrorOnGarbage(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	var garbage atomic.Int32
	di, _ := os.ReadFile("testdata/icon-sets/index-dashboard-icons.json")
	sh, _ := os.ReadFile("testdata/icon-sets/index-selfhst.json")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if garbage.Load() == 1 {
			_, _ = w.Write([]byte("<html>maintenance</html>"))
			return
		}
		if strings.HasSuffix(r.URL.Path, "metadata.json") {
			_, _ = w.Write(di)
		} else {
			_, _ = w.Write(sh)
		}
	}))
	defer srv.Close()
	old := iconSetsCDNBase
	iconSetsCDNBase = srv.URL + "/"
	t.Cleanup(func() { iconSetsCDNBase = old; resetIconSetsForTest() })
	resetIconSetsForTest()
	if err := refreshIconSets(context.Background()); err != nil {
		t.Fatal(err)
	}
	garbage.Store(1)
	_ = refreshIconSets(context.Background())
	resetIconSetsForTest()
	loadIconSetsFromDisk()
	if currentIconSets().lookup("sonarr") == nil {
		t.Fatal("an unreadable answer overwrote the mirror")
	}
}

func TestIconSetsDue(t *testing.T) {
	t.Setenv("NEXTDASH_DATA_DIR", t.TempDir())
	resetIconSetsForTest()
	t.Cleanup(resetIconSetsForTest)
	now := time.Now()
	if !iconSetsDue(now) {
		t.Fatal("no mirrors: due")
	}
	iconSets.triedAt = now
	if iconSetsDue(now.Add(time.Minute)) {
		t.Fatal("inside the back-off: not due")
	}
	if !iconSetsDue(now.Add(iconSetsRetryAfter)) {
		t.Fatal("after the back-off: due again")
	}
}

func TestIconSetsDisabledByEnv(t *testing.T) {
	useIconSetsFixture(t)
	t.Setenv("DISABLE_ICON_SETS", "1")
	if currentIconSets() != nil {
		t.Fatal("disabled must give no index")
	}
}

func TestIconSetsFixtureMode(t *testing.T) {
	useIconSetsFixture(t)
	if currentIconSets().lookup("degoog") == nil {
		t.Fatal("fixture not loaded")
	}
	if err := refreshIconSets(context.Background()); err != nil {
		t.Fatal("fixture mode never goes out, so never fails")
	}
}

func TestBackupZipExcludesIconSets(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NEXTDASH_DATA_DIR", dir)
	sets := filepath.Join(dir, iconSetsDirName, iconSetDashboard)
	if err := os.MkdirAll(sets, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, iconSetsDirName, "index-selfhst.json"), []byte("[]"), 0o644)
	_ = os.WriteFile(filepath.Join(sets, "sonarr.svg"), []byte("<svg/>"), 0o644)

	h := &Handlers{store: NewStore()}
	data, err := h.buildBackupZip()
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range reader.File {
		if strings.HasPrefix(filepath.ToSlash(f.Name), iconSetsDirName+"/") {
			t.Fatalf("backup carries %s", f.Name)
		}
	}
}
