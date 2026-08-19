package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// The help texts are a third of the translation file and nobody reads them until
// Config → Help is open.
//
// en.json is 570 KB, 167 KB over the wire, and every dashboard fetches all of it
// before it can draw a label. 182 KB of that is `config.help*` — the manual-length
// prose behind the Help tab — read only by dashboard-config.js, which is itself
// loaded lazily when config opens.
//
// So the file is served in scopes: `core` is everything except those keys, `help`
// is only those keys, and no scope at all is the whole file, which is what an
// older client or a direct fetch still gets.

const localeHelpPrefix = "help"

// localeHelpAlways are help-prefixed keys read outside the config module — the
// What's new modal prints the Ko-fi label — so they stay in the core scope
// whatever their name suggests.
var localeHelpAlways = map[string]bool{
	"helpSupportKofi": true,
}

// A cached narrowing, with what the file looked like when it was made. Splitting
// the JSON costs a parse and a marshal per language and scope, which is worth
// caching — but caching it for the life of the process meant an edit to a locale
// file was invisible until the server was restarted, which is exactly the
// feedback loop you want while writing those files.
type localeScopeEntry struct {
	data    []byte
	modTime time.Time
	size    int64
}

var (
	localeScopeMu    sync.RWMutex
	localeScopeCache = map[string]localeScopeEntry{}
)

// localeFileStamp is the modification time and size of the locale file on disk,
// or the zero value when it is served from the embedded copy — which cannot
// change under a running process, so a zero stamp caches forever by design.
func localeFileStamp(name string) (time.Time, int64) {
	info, err := os.Stat(filepath.Join("locales", filepath.Base(name)))
	if err != nil {
		return time.Time{}, 0
	}
	return info.ModTime(), info.Size()
}

// LocaleFile serves /locales/<lang>.json, optionally narrowed to a scope.
func (h *Handlers) LocaleFile(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/locales/")
	// Only plain <lang>.json — no traversal, no nesting.
	if name == "" || strings.ContainsAny(name, "/\\") || !strings.HasSuffix(name, ".json") {
		http.NotFound(w, r)
		return
	}
	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if scope != "core" && scope != "help" {
		scope = ""
	}

	data, err := localeScopedBytes(h.files, name, scope)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	// A binary serves these from its embedded copy, where they cannot change
	// under a running process: cache them for a day, as the client appends the
	// app version and a deploy busts it. A checkout serves them off disk, where
	// they change every time someone edits a translation — revalidating costs one
	// conditional request and saves an hour of wondering why the text is stale.
	if modTime, _ := localeFileStamp(name); modTime.IsZero() {
		w.Header().Set("Cache-Control", "public, max-age=86400")
	} else {
		etag := localeETag(name, scope)
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", etag)
		if r.Header.Get("If-None-Match") == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	_, _ = w.Write(data)
}

// localeETag identifies one narrowing of one file version, so a revalidating
// client gets a 304 rather than the bytes it already has.
func localeETag(name, scope string) string {
	modTime, size := localeFileStamp(name)
	return fmt.Sprintf(`W/"%s-%s-%d-%d"`, name, scope, modTime.UnixNano(), size)
}

func localeScopedBytes(files fs.FS, name, scope string) ([]byte, error) {
	key := name + "|" + scope
	modTime, size := localeFileStamp(name)
	localeScopeMu.RLock()
	if cached, ok := localeScopeCache[key]; ok && cached.modTime.Equal(modTime) && cached.size == size {
		localeScopeMu.RUnlock()
		return cached.data, nil
	}
	localeScopeMu.RUnlock()

	raw, err := readLocaleFile(files, name)
	if err != nil {
		return nil, err
	}
	out := raw
	if scope != "" {
		if narrowed, err := narrowLocale(raw, scope); err == nil {
			out = narrowed
		}
	}

	localeScopeMu.Lock()
	localeScopeCache[key] = localeScopeEntry{data: out, modTime: modTime, size: size}
	localeScopeMu.Unlock()
	return out, nil
}

func readLocaleFile(files fs.FS, name string) ([]byte, error) {
	if data, err := os.ReadFile(filepath.Join("locales", filepath.Base(name))); err == nil {
		return data, nil
	}
	if files == nil {
		return nil, fs.ErrNotExist
	}
	return fs.ReadFile(files, path.Join("locales", name))
}

// narrowLocale splits the `config` section on the help prefix. Every other
// section travels with `core`, because anything outside config is read while the
// dashboard is drawing itself.
func narrowLocale(raw []byte, scope string) ([]byte, error) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	configRaw, ok := doc["config"]
	if !ok {
		if scope == "help" {
			return []byte(`{"config":{}}`), nil
		}
		return raw, nil
	}
	var config map[string]json.RawMessage
	if err := json.Unmarshal(configRaw, &config); err != nil {
		return nil, err
	}

	kept := make(map[string]json.RawMessage, len(config))
	for k, v := range config {
		isHelp := strings.HasPrefix(k, localeHelpPrefix) && !localeHelpAlways[k]
		if (scope == "help") == isHelp {
			kept[k] = v
		}
	}
	if scope == "help" {
		return json.Marshal(map[string]any{"config": kept})
	}
	doc["config"], _ = json.Marshal(kept)
	return json.Marshal(doc)
}
