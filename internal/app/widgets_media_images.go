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
Media pictures, fetched by this server and kept on disk.

Named by service, server, item, kind and tag: a service gives a picture a new
tag when it changes, so a name never has to be invalidated -- a new picture is
a new name, and the browser may keep the old address for ever. Like the
preview pictures, these are decoration that comes back from the source, so
they stay out of every backup and are trimmed oldest-first, all services
together.
*/

const (
	mediaImageDirName  = "media-images"
	mediaImageCapBytes = 200 << 20
	mediaImageMaxBytes = 5 << 20
	// legacyJellyfinImageDirName is where v1.19.4 kept Jellyfin posters.
	legacyJellyfinImageDirName = "jellyfin-images"
)

func mediaImageRoot() string { return filepath.Join(ResolveDataDir(), mediaImageDirName) }

func mediaImageFileName(server string, ref mediaImageRef) string {
	sum := sha256.Sum256([]byte(server + "\x00" + ref.Item + "\x00" + ref.Kind + "\x00" + ref.Tag))
	return "m-" + hex.EncodeToString(sum[:])[:24]
}

// mediaImageFetch fetches one picture from a service. The credential is the
// one the widget's answer was made with.
type mediaImageFetch func(ctx context.Context, server string, credential HealthCredential, ref mediaImageRef) ([]byte, error)

// mediaImageFlights lets one fetch serve everyone asking for the same
// picture at once: a page of twelve posters opened in two tabs is twelve
// requests to the service, not twenty-four.
var mediaImageFlights = struct {
	sync.Mutex
	at map[string]*mediaImageFlight
}{at: map[string]*mediaImageFlight{}}

type mediaImageFlight struct {
	done chan struct{}
	data []byte
	err  error
}

func mediaImageOnce(key string, fetch func() ([]byte, error)) ([]byte, error) {
	mediaImageFlights.Lock()
	if flight, ok := mediaImageFlights.at[key]; ok {
		mediaImageFlights.Unlock()
		<-flight.done
		return flight.data, flight.err
	}
	flight := &mediaImageFlight{done: make(chan struct{})}
	mediaImageFlights.at[key] = flight
	mediaImageFlights.Unlock()

	flight.data, flight.err = fetch()
	close(flight.done)
	mediaImageFlights.Lock()
	delete(mediaImageFlights.at, key)
	mediaImageFlights.Unlock()
	return flight.data, flight.err
}

// readMediaImage reads a picture answer and refuses what is not one: too
// large, empty, or SVG, which can carry script.
func readMediaImage(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, mediaImageMaxBytes+1))
	if err != nil || len(data) == 0 || len(data) > mediaImageMaxBytes {
		return nil, errMediaUnreachable
	}
	if kind := detectImageType(data); !strings.HasPrefix(kind, "image/") || kind == "image/svg+xml" {
		return nil, errMediaUnreachable
	}
	return data, nil
}

// legacyImagesGone removes the v1.19.4 Jellyfin picture folder once. It is a
// cache, and the pictures come back under media-images on the next draw.
var legacyImagesGone sync.Once

func storeMediaImage(service, name string, data []byte) {
	legacyImagesGone.Do(func() {
		_ = os.RemoveAll(filepath.Join(ResolveDataDir(), legacyJellyfinImageDirName))
	})
	dir := filepath.Join(mediaImageRoot(), service)
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
	_, _ = evictImagesIn(dir, mediaImageCapBytes)
}

/*
serveMediaImage serves one picture a widget's last answer offered.

Anything else is a 404: an item, kind or tag the answer did not name, or a
widget that has not been read yet. That is what keeps this from being a proxy
into the service -- it can only ever fetch what the service itself just listed.
*/
func (h *Handlers) serveMediaImage(w http.ResponseWriter, r *http.Request, service string, fetch mediaImageFetch) {
	query := r.URL.Query()
	pageID, err := strconv.Atoi(strings.TrimSpace(query.Get("pageId")))
	ref := mediaImageRef{Item: query.Get("item"), Kind: query.Get("kind"), Tag: query.Get("tag")}
	if err != nil || (ref.Kind != "poster" && ref.Kind != "backdrop") || ref.Item == "" || ref.Tag == "" {
		http.Error(w, "Bad image request", http.StatusBadRequest)
		return
	}
	server, credentialID, ok := mediaAllowedImage(mediaCacheKey(service, pageID, query.Get("id")), ref)
	if !ok {
		http.NotFound(w, r)
		return
	}

	name := mediaImageFileName(server, ref)
	path := filepath.Join(mediaImageRoot(), service, name)
	data, err := os.ReadFile(path)
	if err != nil {
		data, err = mediaImageOnce(service+"/"+name, func() ([]byte, error) {
			credential, ok := lookupHealthCredential(credentialID)
			if !ok {
				return nil, errMediaNotSetUp
			}
			// Not the asker's context: the fetch is shared, and one tab
			// closing must not cancel the picture for the others.
			ctx, cancel := context.WithTimeout(context.Background(), mediaRequestTimeout)
			defer cancel()
			fetched, err := fetch(ctx, server, credential, ref)
			if err == nil {
				storeMediaImage(service, name, fetched)
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

// mediaPathEscape is url.PathEscape, named for the reader of a fetch function.
func mediaPathEscape(segment string) string { return url.PathEscape(segment) }
