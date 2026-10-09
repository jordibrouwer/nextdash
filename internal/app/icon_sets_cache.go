package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

/*
The icon files themselves, fetched the first time a page asks for one.

/data/icon-sets/<set>/<file> serves from data/icon-sets/<set>/, and a file
that is not there yet is fetched from jsDelivr through the same guards as a
bookmark icon: 2 MiB at most, magic bytes that agree with the extension, SVG
sanitised. Only a file the index names is ever fetched, so the route cannot be
used to make the server request arbitrary paths.

The browser never sees the CDN; the page's CSP stays as it is.

A chosen icon is adopted: copied into data/icons/ under its own name, where it
is an ordinary bookmark icon -- in backups, offline, and no longer tied to the
set. The same name with different bytes gets -2, -3, ...; the same bytes reuse
the file that is there.
*/

var (
	errIconSetNotFound = errors.New("icon not in set")
	iconSetFilePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]*\.(svg|png)$`)
	iconSetFetchMu     sync.Mutex // guards iconSetFileLocks
	iconSetFileLocks   = map[string]*sync.Mutex{}
	iconAdoptMu        sync.Mutex
	// iconSetMisses remembers a file that could not be had, so a page that
	// shows it does not send the server to the CDN on every load.
	iconSetMisses sync.Map // "<set>/<file>" -> time.Time
)

const iconSetMissTTL = time.Hour

const iconSetFileMaxBytes = 2 << 20

func iconSetFileURL(set, file string) string { return "/data/icon-sets/" + set + "/" + file }

// variantFile is the file for "base", "light" or "dark", or "" when the
// entry's set has no such variant.
func (e *iconSetEntry) variantFile(v string) string {
	switch v {
	case "light":
		if e.Light == "" {
			return ""
		}
		return e.Light + e.Ext
	case "dark":
		if e.Dark == "" {
			return ""
		}
		return e.Dark + e.Ext
	case "base":
		return e.Name + e.Ext
	}
	return ""
}

func iconSetRepo(set string) string {
	for _, src := range iconSetSources {
		if src.set == set {
			return src.repo
		}
	}
	return ""
}

// ensureIconSetFile returns the cached file's path, fetching it first when
// it is not there yet.
func ensureIconSetFile(ctx context.Context, set, file string) (string, error) {
	repo := iconSetRepo(set)
	if repo == "" || !iconSetFilePattern.MatchString(file) || !currentIconSets().hasFile(set, file) {
		return "", errIconSetNotFound
	}
	path := filepath.Join(iconSetsDir(), set, file)
	info, statErr := os.Stat(path)
	// Fresh, or no way to refresh it: served as it is.
	if statErr == nil && (time.Since(info.ModTime()) < iconSetsTTL || iconSetsFixtureDir() != "") {
		return path, nil
	}
	if iconSetsFixtureDir() != "" {
		return "", errIconSetNotFound // a fixture never goes out
	}
	missKey := set + "/" + file
	if at, ok := iconSetMisses.Load(missKey); ok && time.Since(at.(time.Time)) < iconSetMissTTL {
		if statErr == nil {
			return path, nil // the old drawing beats none
		}
		return "", errIconSetNotFound
	}
	unlock := lockIconSetFile(missKey)
	defer unlock()
	if info, err := os.Stat(path); err == nil && time.Since(info.ModTime()) < iconSetsTTL {
		return path, nil // fetched while this one waited
	}
	stale := statErr == nil
	// The route is open to readers without the token (an <img> sends none),
	// so a walk over every name in the index could fill the disk. A cap on
	// what is cached keeps that to a few thousand icons.
	if !stale && iconSetCacheFull(set) {
		return "", errIconSetNotFound
	}
	if at, ok := iconSetMisses.Load(missKey); ok && time.Since(at.(time.Time)) < iconSetMissTTL {
		return "", errIconSetNotFound // missed while this one waited
	}
	// Not on the page's own context: a reload cancelled every queued fetch,
	// each was stored as a miss, and those icons showed letters for an hour.
	fetched, err := fetchIconSetFile(context.WithoutCancel(ctx), repo, path, file)
	if err != nil && !errors.Is(err, context.Canceled) {
		iconSetMisses.Store(missKey, time.Now())
	}
	// A cached file older than a week is asked again, so a redrawn icon or
	// a sanitiser fix arrives; failing that, the old one is still served.
	if err != nil && stale {
		return path, nil
	}
	return fetched, err
}

// iconSetCacheMax is how many files one set's cache may hold.
const iconSetCacheMax = 3000

func iconSetCacheFull(set string) bool {
	entries, err := os.ReadDir(filepath.Join(iconSetsDir(), set))
	return err == nil && len(entries) >= iconSetCacheMax
}

// lockIconSetFile serialises fetches of one file, so different files fetch
// side by side instead of waiting in one line.
func lockIconSetFile(key string) func() {
	iconSetFetchMu.Lock()
	mu := iconSetFileLocks[key]
	if mu == nil {
		mu = &sync.Mutex{}
		iconSetFileLocks[key] = mu
	}
	iconSetFetchMu.Unlock()
	mu.Lock()
	return mu.Unlock
}

func fetchIconSetFile(ctx context.Context, repo, path, file string) (string, error) {
	ext := filepath.Ext(file)
	data, err := fetchIconSetBytes(ctx, iconSetsCDNBase+repo+strings.TrimPrefix(ext, ".")+"/"+file)
	if err != nil {
		return "", err
	}
	if got, _ := iconExtensionFromContentType(detectImageType(data)); got != ext {
		return "", errIconSetNotFound
	}
	if ext == ".svg" {
		// A few upstream SVGs are a PNG in an SVG wrapper. The sanitiser
		// drops the embedded image, which leaves an empty square: no icon is
		// better than that, and the page draws the letter.
		if svgDataHrefPattern.Match(data) {
			return "", errIconSetNotFound
		}
		if data = sanitizeSVGContent(data); len(data) == 0 {
			return "", errIconSetNotFound
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return "", err
	}
	if err := writeFileAtomic(path, data, 0644); err != nil {
		return "", err
	}
	return path, nil
}

func fetchIconSetBytes(ctx context.Context, src string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nextDash-icon-fetcher/1.0")
	resp, err := iconSetsHTTPClient(8 * time.Second).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("icon fetch: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, iconSetFileMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > iconSetFileMaxBytes {
		return nil, errIconSetNotFound
	}
	return data, nil
}

// adoptIconSetFile copies a set icon into data/icons/ and returns the bare
// name a bookmark stores.
func adoptIconSetFile(ctx context.Context, set, file string) (string, error) {
	src, err := ensureIconSetFile(ctx, set, file)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	iconsDir := filepath.Join(ResolveDataDir(), "icons")
	if err := os.MkdirAll(iconsDir, 0755); err != nil {
		return "", err
	}
	ext := filepath.Ext(file)
	stem := strings.TrimSuffix(file, ext)
	// One adopt at a time: two at once (sonarr.svg from each set) both found
	// the name free, and one bookmark got the other set's drawing.
	iconAdoptMu.Lock()
	defer iconAdoptMu.Unlock()
	for n := 1; n < 100; n++ {
		name := stem + ext
		if n > 1 {
			name = fmt.Sprintf("%s-%d%s", stem, n, ext)
		}
		full := filepath.Join(iconsDir, name)
		existing, err := os.ReadFile(full)
		if errors.Is(err, os.ErrNotExist) {
			return name, writeFileAtomic(full, data, 0644)
		}
		if err == nil && bytes.Equal(existing, data) {
			return name, nil
		}
	}
	return "", errors.New("too many icons with this name")
}

// serveIconSetFile is the /data/icon-sets/ case of dataFileHandler.
func serveIconSetFile(w http.ResponseWriter, req *http.Request, rel string) {
	set, file, ok := strings.Cut(strings.TrimPrefix(rel, iconSetsDirName+"/"), "/")
	if !ok {
		http.NotFound(w, req)
		return
	}
	path, err := ensureIconSetFile(req.Context(), set, file)
	// An SVG the guards turn away -- upstream, a few are only a PNG in an SVG
	// wrapper, which the sanitiser would leave empty -- is served as the
	// set's PNG of the same icon. It was a 404 for every icon on the page
	// and a letter where the app's icon could have been.
	if err != nil && strings.HasSuffix(file, ".svg") {
		path, err = ensureIconSetFile(req.Context(), set, strings.TrimSuffix(file, ".svg")+".png")
	}
	if err != nil {
		http.NotFound(w, req)
		return
	}
	// Not content-addressed: upstream can redraw an icon under the same name.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, req, path)
}
