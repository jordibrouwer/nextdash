package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// Content-hashed asset URLs.
//
// The generator walks ./static and writes back into this directory, so it has
// to run from the repository root; go:generate would otherwise start it here.
//
//go:generate sh -c "cd ../.. && go run scripts/gen-asset-hashes.go"
//
// Cache-bust tokens used to be hand-written strings in asset_versions.go, one per
// file. That failed in two ways this replaces outright: two files sharing a token
// meant bumping one silently moved the other, and a file with no token at all was
// served with max-age=86400 — invisible for up to a day after a deploy, with
// write-api.js (write-token auth) the sharpest case.
//
// Here the token is derived from the file's bytes, so it is impossible to forget:
// change the file, the URL changes; don't, and it stays byte-identical and keeps
// its year-long immutable cache entry.

// assetHashes caches path -> short content hash. Static files do not change while
// the process runs in production (the image is immutable), so each file is hashed
// at most once. Dev mounts are handled by assetHashCacheEnabled below.
var (
	assetHashMu      sync.RWMutex
	assetHashes      = map[string]string{}
	assetHashSources assetSourceSet
)

// assetSourceSet is where asset bytes are read from: the on-disk tree when it
// exists (dev/Docker mounts), otherwise the embedded FS. This mirrors how main.go
// picks a file server for /static/ so hashes always describe what is actually served.
type assetSourceSet struct {
	embedded fs.FS
	// useDisk reads from the working directory rather than the embed, matching
	// main.go's "prefer on-disk files" behaviour.
	useDisk bool
}

// initAssetHashing records where static assets are read from. Called once at
// startup, before any template renders.
func initAssetHashing(embedded fs.FS) {
	assetHashMu.Lock()
	defer assetHashMu.Unlock()
	info, err := os.Stat("static")
	assetHashSources = assetSourceSet{
		embedded: embedded,
		useDisk:  err == nil && info.IsDir(),
	}
	assetHashes = map[string]string{}
	if assetHashCacheEnabled() {
		for rel, sum := range precomputedAssetHashes {
			assetHashes[rel] = sum
		}
	}
}

// staticAssetsMutable is true when ./static is bind-mounted for live edits
// (dev Docker). Hashes are recomputed on every read so ?v= tokens track changes.
func staticAssetsMutable() bool {
	return os.Getenv("NEXTDASH_STATIC_MUTABLE") == "1"
}

// assetHashCacheEnabled reports whether a computed hash may be memoised.
func assetHashCacheEnabled() bool {
	return !staticAssetsMutable()
}

// assetHash returns a short content hash for a /static-relative path such as
// "js/dashboard.js". An unreadable file yields "" so the caller can fall back to
// an unversioned URL rather than emitting a token that describes nothing.
func assetHash(rel string) string {
	rel = strings.TrimPrefix(strings.TrimPrefix(rel, "/"), "static/")

	if assetHashCacheEnabled() {
		if sum, ok := precomputedAssetHashes[rel]; ok {
			return sum
		}
		assetHashMu.RLock()
		cached, ok := assetHashes[rel]
		assetHashMu.RUnlock()
		if ok {
			return cached
		}
	}

	sum, err := hashAssetFile(rel)
	if err != nil {
		// Not fatal: a missing asset is a template/typo bug, and failing the whole
		// page render over it would turn a broken icon into a blank dashboard.
		log.Printf("asset hash: %s: %v", rel, err)
		sum = ""
	}

	if assetHashCacheEnabled() {
		assetHashMu.Lock()
		assetHashes[rel] = sum
		assetHashMu.Unlock()
	}
	return sum
}

func hashAssetFile(rel string) (string, error) {
	var (
		f   io.ReadCloser
		err error
	)
	if assetHashSources.useDisk {
		f, err = os.Open(filepath.Join("static", filepath.FromSlash(rel)))
	} else {
		f, err = assetHashSources.embedded.Open("static/" + rel)
	}
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)[:6]), nil
}

// assetURL renders a cache-busted URL for a static asset, e.g.
// assetURL("js/dashboard.js") -> "/static/js/dashboard.js?v=1a2b3c4d5e6f".
// Templates call this as {{asset "js/dashboard.js"}}.
func assetURL(rel string) string {
	clean := strings.TrimPrefix(strings.TrimPrefix(rel, "/"), "static/")
	path := "/static/" + clean
	sum := assetHash(clean)
	if sum == "" {
		return path
	}
	return path + "?v=" + url.QueryEscape(sum)
}

// lazyLoadedAssets are scripts fetched by JS at runtime rather than by a tag in
// the template. They still need a content-hashed URL, so the server hands the
// client a map of them and the loaders read it instead of hard-coding a token.
var lazyLoadedAssets = []string{
	"js/whats-new-modal.js",
	"js/dashboard/dashboard-config.js",
	"js/dashboard/dashboard-config-context-menu.js",
	"js/dashboard/dashboard-config-stats.js",
	"js/dashboard/dashboard-config-bookmarks.js",
	"js/dashboard/dashboard-news-stream.js",
	"js/health-reason-utils.js",
	"js/shared/last-opened-format.js",
	"js/health-tutorial.js",
	"js/dashboard/dashboard-health.js",
	"js/dashboard/dashboard-health-multi-select.js",
	"js/dashboard/dashboard-health-focus.js",
	"js/dashboard/dashboard-inbox-triage.js",
	"js/dashboard/dashboard-inbox.js",
	"js/inbox-tutorial.js",
	"js/dashboard/dashboard-inline-edit.js",
	"js/dashboard/dashboard-context-menu.js",
}

// lazyAssetMapJSON renders lazyLoadedAssets as a JSON object of path -> hashed
// URL. It is emitted as a data attribute (see asset-map.js) rather than inline
// script text, so html/template's attribute escaping applies and the page needs
// no 'unsafe-inline' in its CSP.
func lazyAssetMapJSON() string {
	m := make(map[string]string, len(lazyLoadedAssets))
	for _, rel := range lazyLoadedAssets {
		m[rel] = assetURL(rel)
	}
	out, err := json.Marshal(m)
	if err != nil {
		return "{}"
	}
	return string(out)
}

// assetFingerprint is a single hash over every static asset the pages load. It
// replaces the hand-maintained sharedAssetVersions struct as the input to the
// app-version token, so a running page still detects that a deploy happened.
//
// The translations are part of it. ConfigLanguage appends this token to every
// /locales/ request precisely so a deploy makes the URL new, and its comment
// says the fingerprint changes whenever any asset does -- but it was CSS and JS
// only, so a release that changed nothing but wording served the old strings
// from the browser cache for a day: a new key came back empty, and text that
// had been rewritten stayed as it was.
func assetFingerprint() string {
	paths := hashedAssetPaths()
	h := sha256.New()
	for _, p := range paths {
		io.WriteString(h, p)
		io.WriteString(h, ":")
		io.WriteString(h, assetHash(p))
		io.WriteString(h, "\n")
	}
	for _, name := range localeFingerprintFiles() {
		io.WriteString(h, name)
		io.WriteString(h, ":")
		io.WriteString(h, localeFileHash(name))
		io.WriteString(h, "\n")
	}
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// localeFingerprintFiles lists the translation files, sorted, from wherever they
// are actually served -- the same disk-then-embed order LocaleFile uses.
func localeFingerprintFiles() []string {
	var names []string
	if entries, err := os.ReadDir("locales"); err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
				names = append(names, e.Name())
			}
		}
	}
	if len(names) == 0 && assetHashSources.embedded != nil {
		if entries, err := fs.ReadDir(assetHashSources.embedded, "locales"); err == nil {
			for _, e := range entries {
				if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
					names = append(names, e.Name())
				}
			}
		}
	}
	sort.Strings(names)
	return names
}

// localeFileHash is the content hash of one translation file, read the same way.
func localeFileHash(name string) string {
	data, err := os.ReadFile(filepath.Join("locales", filepath.Base(name)))
	if err != nil && assetHashSources.embedded != nil {
		data, err = fs.ReadFile(assetHashSources.embedded, path.Join("locales", name))
	}
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:6])
}

// hashedAssetPaths lists every css/js asset under static/, sorted so the
// fingerprint is stable across runs and filesystems.
func hashedAssetPaths() []string {
	var paths []string
	add := func(p string) {
		if strings.HasSuffix(p, ".css") || strings.HasSuffix(p, ".js") {
			paths = append(paths, p)
		}
	}

	if assetHashSources.useDisk {
		_ = filepath.WalkDir("static", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			rel, relErr := filepath.Rel("static", p)
			if relErr != nil {
				return nil
			}
			add(filepath.ToSlash(rel))
			return nil
		})
	} else if assetHashSources.embedded != nil {
		_ = fs.WalkDir(assetHashSources.embedded, "static", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			add(strings.TrimPrefix(p, "static/"))
			return nil
		})
	}

	sort.Strings(paths)
	return paths
}
