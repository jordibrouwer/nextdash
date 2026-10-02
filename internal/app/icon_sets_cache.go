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
	iconSetFetchMu     sync.Mutex
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
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if iconSetsFixtureDir() != "" {
		return "", errIconSetNotFound // a fixture never goes out
	}
	missKey := set + "/" + file
	if at, ok := iconSetMisses.Load(missKey); ok && time.Since(at.(time.Time)) < iconSetMissTTL {
		return "", errIconSetNotFound
	}
	iconSetFetchMu.Lock()
	defer iconSetFetchMu.Unlock()
	if _, err := os.Stat(path); err == nil {
		return path, nil // fetched while this one waited
	}
	path, err := fetchIconSetFile(ctx, repo, path, file)
	if err != nil {
		iconSetMisses.Store(missKey, time.Now())
	}
	return path, err
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
	if err != nil {
		http.NotFound(w, req)
		return
	}
	// Not content-addressed: upstream can redraw an icon under the same name.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	http.ServeFile(w, req, path)
}
