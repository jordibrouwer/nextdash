package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
One answer per widget, on that widget's own TTL.

The images it named are kept with it: the proxy fetches only a picture the
last answer offered, so it can never be pointed at another path on the
server, let alone another host. A failure keeps the last good answer and says
how old it is -- a tile that empties every time Jellyfin restarts is worse
than one that says it is behind.
*/
const (
	// jellyfinAnswerTimeout bounds one whole answer, every library together.
	jellyfinAnswerTimeout = 30 * time.Second
	// jellyfinPartialRetry is how long an answer with a library missing lives.
	jellyfinPartialRetry = 30 * time.Second
)

type jellyfinCacheEntry struct {
	fingerprint  string
	server       string
	credentialID string
	good         *JellyfinWidgetResult
	images       map[jellyfinImageRef]bool
	answer       JellyfinWidgetResult
	expires      time.Time
}

var jellyfinWidgetCache = struct {
	sync.Mutex
	at map[string]*jellyfinCacheEntry
}{at: map[string]*jellyfinCacheEntry{}}

func jellyfinCacheKey(pageID int, widgetID string) string {
	return strconv.Itoa(pageID) + ":" + widgetID
}

// jellyfinForgetAll empties the cache; tests use it between cases.
func jellyfinForgetAll() {
	jellyfinWidgetCache.Lock()
	jellyfinWidgetCache.at = map[string]*jellyfinCacheEntry{}
	jellyfinWidgetCache.Unlock()
}

// jellyfinExpireAll makes every entry due without losing its last good answer.
func jellyfinExpireAll() {
	jellyfinWidgetCache.Lock()
	for _, entry := range jellyfinWidgetCache.at {
		entry.expires = time.Time{}
	}
	jellyfinWidgetCache.Unlock()
}

func jellyfinAllowedImage(key string, ref jellyfinImageRef) (string, string, bool) {
	jellyfinWidgetCache.Lock()
	defer jellyfinWidgetCache.Unlock()
	entry := jellyfinWidgetCache.at[key]
	if entry == nil || !entry.images[ref] {
		return "", "", false
	}
	return entry.server, entry.credentialID, true
}

func jellyfinProxyURL(pageID int, widgetID string, ref jellyfinImageRef) string {
	return "/api/widgets/jellyfin/image?" + url.Values{
		"pageId": {strconv.Itoa(pageID)}, "id": {widgetID},
		"item": {ref.Item}, "kind": {ref.Kind}, "tag": {ref.Tag},
	}.Encode()
}

func (h *Handlers) jellyfinAnswer(ctx context.Context, pageID int, widget Widget, forced bool) JellyfinWidgetResult {
	spec := jellyfinSpecFrom(widget.Config)
	key := jellyfinCacheKey(pageID, widget.ID)
	now := time.Now()

	jellyfinWidgetCache.Lock()
	entry := jellyfinWidgetCache.at[key]
	if entry != nil && entry.fingerprint != spec.fingerprint() {
		entry = nil
	}
	if entry != nil && !forced && now.Before(entry.expires) {
		answer := entry.answer
		jellyfinWidgetCache.Unlock()
		return answer
	}
	jellyfinWidgetCache.Unlock()

	/*
	 * Not the asker's context: the answer is shared and cached, and a browser
	 * that reloads or closes the tab halfway must not leave the cache holding
	 * whatever had arrived by then. The libraries have timeouts of their own.
	 */
	fetchCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), jellyfinAnswerTimeout)
	defer stop()
	result, images, err := h.fetchJellyfinLatest(fetchCtx, spec, func(ref jellyfinImageRef) string {
		return jellyfinProxyURL(pageID, widget.ID, ref)
	})
	result.FetchedAt = now.UnixMilli()

	next := &jellyfinCacheEntry{
		fingerprint: spec.fingerprint(), server: spec.Server, credentialID: spec.CredentialID,
		images: images, expires: now.Add(spec.TTL),
	}
	// A half answer is shown, but asked for again soon rather than kept for
	// the whole TTL: a library that failed once is usually back a minute later.
	if result.Partial && spec.TTL > jellyfinPartialRetry {
		next.expires = now.Add(jellyfinPartialRetry)
	}
	if err == nil {
		next.good = &result
		next.answer = result
	} else {
		logWarn(logComponentWidgets, "Jellyfin widget %s: %v", widget.ID, err)
		next.answer = JellyfinWidgetResult{
			Items: []JellyfinItem{}, Libraries: result.Libraries,
			FetchedAt: result.FetchedAt, Error: jellyfinErrorCode(err),
		}
		if entry != nil && entry.good != nil {
			stale := *entry.good
			stale.Error = jellyfinErrorCode(err)
			stale.Stale = true
			next.good = entry.good
			next.images = entry.images
			next.answer = stale
		}
	}
	jellyfinWidgetCache.Lock()
	jellyfinWidgetCache.at[key] = next
	jellyfinWidgetCache.Unlock()
	return next.answer
}

/*
JellyfinWidgetHandler answers what one Jellyfin tile should draw.

Read by widget id, like the RSS tile: the address, the user and the key are
the server's to know, and a tokenless reader of the page never gets them.
*/
func (h *Handlers) JellyfinWidgetHandler(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	widgetID := strings.TrimSpace(r.URL.Query().Get("id"))
	if widgetID == "" {
		http.Error(w, "Missing widget id", http.StatusBadRequest)
		return
	}
	widgets, _ := h.store.GetPageBlocks(pageID)
	var found *Widget
	for i := range widgets {
		if widgets[i].ID == widgetID && widgets[i].Type == WidgetTypeJellyfin {
			found = &widgets[i]
			break
		}
	}
	if found == nil {
		http.Error(w, "No such widget", http.StatusNotFound)
		return
	}
	forced := r.URL.Query().Get("refresh") == "1"
	if forced && !h.requireWriteAccess(w, r) {
		return
	}
	_ = json.NewEncoder(w).Encode(h.jellyfinAnswer(r.Context(), pageID, *found, forced))
}
