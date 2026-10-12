package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Jellyfin pictures, fetched by this server and kept on disk.

Named by server, item, kind and tag: Jellyfin gives a picture a new tag when it
changes, so a name never has to be invalidated -- a new picture is a new name,
and the browser may keep the old address for ever. Like the preview pictures,
these are decoration that comes back from the source, so they stay out of
every backup and are trimmed oldest-first.
*/

const (
	jellyfinImageDirName  = "jellyfin-images"
	jellyfinImageCapBytes = 200 << 20
	jellyfinImageMaxBytes = 5 << 20
)

func jellyfinImageDir() string { return filepath.Join(ResolveDataDir(), jellyfinImageDirName) }

func jellyfinImageFileName(server string, ref jellyfinImageRef) string {
	sum := sha256.Sum256([]byte(server + "\x00" + ref.Item + "\x00" + ref.Kind + "\x00" + ref.Tag))
	return "jf-" + hex.EncodeToString(sum[:])[:24]
}

// jellyfinImageFlights lets one fetch serve everyone asking for the same
// picture at once: a page of twelve posters opened in two tabs is twelve
// requests to Jellyfin, not twenty-four.
var jellyfinImageFlights = struct {
	sync.Mutex
	at map[string]*jellyfinImageFlight
}{at: map[string]*jellyfinImageFlight{}}

type jellyfinImageFlight struct {
	done chan struct{}
	data []byte
	err  error
}

func jellyfinImageOnce(key string, fetch func() ([]byte, error)) ([]byte, error) {
	jellyfinImageFlights.Lock()
	if flight, ok := jellyfinImageFlights.at[key]; ok {
		jellyfinImageFlights.Unlock()
		<-flight.done
		return flight.data, flight.err
	}
	flight := &jellyfinImageFlight{done: make(chan struct{})}
	jellyfinImageFlights.at[key] = flight
	jellyfinImageFlights.Unlock()

	flight.data, flight.err = fetch()
	close(flight.done)
	jellyfinImageFlights.Lock()
	delete(jellyfinImageFlights.at, key)
	jellyfinImageFlights.Unlock()
	return flight.data, flight.err
}

func (h *Handlers) fetchJellyfinImage(server, credentialID string, ref jellyfinImageRef) ([]byte, error) {
	credential, ok := lookupHealthCredential(credentialID)
	if !ok {
		return nil, errJellyfinNotSetUp
	}
	// Not the asker's context: the fetch is shared, and one tab closing must
	// not cancel the picture for the others.
	ctx, cancel := context.WithTimeout(context.Background(), jellyfinTimeout)
	defer cancel()
	path := "/Items/" + url.PathEscape(ref.Item) + "/Images/Primary"
	width := "300"
	if ref.Kind == "backdrop" {
		path = "/Items/" + url.PathEscape(ref.Item) + "/Images/Backdrop/0"
		width = "800"
	}
	query := url.Values{"maxWidth": {width}, "tag": {ref.Tag}, "quality": {"85"}}
	resp, err := h.jellyfinRequest(ctx, server, credential, path, query, "image/*")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, jellyfinImageMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > jellyfinImageMaxBytes {
		return nil, errJellyfinUnreachable
	}
	if kind := detectImageType(data); !strings.HasPrefix(kind, "image/") || kind == "image/svg+xml" {
		return nil, errJellyfinUnreachable
	}
	return data, nil
}

func storeJellyfinImage(name string, data []byte) {
	dir := jellyfinImageDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	tmp, err := os.CreateTemp(dir, ".tmp-")
	if err != nil {
		return
	}
	_, writeErr := tmp.Write(data)
	closeErr := tmp.Close()
	if writeErr != nil || closeErr != nil || os.Rename(tmp.Name(), filepath.Join(dir, name)) != nil {
		_ = os.Remove(tmp.Name())
		return
	}
	_, _ = evictImagesIn(dir, jellyfinImageCapBytes)
}

/*
JellyfinImageHandler serves one picture the widget's last answer offered.

Anything else is a 404: an item, kind or tag the answer did not name, or a
widget that has not been read yet. That is what keeps this from being a proxy
into Jellyfin -- it can only ever fetch what Jellyfin itself just listed.
*/
func (h *Handlers) JellyfinImageHandler(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	pageID, err := strconv.Atoi(strings.TrimSpace(query.Get("pageId")))
	ref := jellyfinImageRef{Item: query.Get("item"), Kind: query.Get("kind"), Tag: query.Get("tag")}
	if err != nil || (ref.Kind != "poster" && ref.Kind != "backdrop") || ref.Item == "" || ref.Tag == "" {
		http.Error(w, "Bad image request", http.StatusBadRequest)
		return
	}
	server, credentialID, ok := jellyfinAllowedImage(jellyfinCacheKey(pageID, query.Get("id")), ref)
	if !ok {
		http.NotFound(w, r)
		return
	}

	name := jellyfinImageFileName(server, ref)
	path := filepath.Join(jellyfinImageDir(), name)
	data, err := os.ReadFile(path)
	if err != nil {
		data, err = jellyfinImageOnce(name, func() ([]byte, error) {
			fetched, err := h.fetchJellyfinImage(server, credentialID, ref)
			if err == nil {
				storeJellyfinImage(name, fetched)
			}
			return fetched, err
		})
		if err != nil {
			http.NotFound(w, r)
			return
		}
	} else {
		// Touched, so eviction drops what nobody looks at rather than what
		// was fetched first.
		now := time.Now()
		_ = os.Chtimes(path, now, now)
	}
	w.Header().Set("Content-Type", detectImageType(data))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(data)
}
