package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
Media tiles: what a service with posters needs, written once.

Jellyfin was the first; Sonarr and Radarr were the second and third, and
copying its cache, its picture proxy and its route for each would have meant
three places to fix the same bug. A service now brings two functions -- one
that lists what to draw and one that fetches a picture -- and everything
between the browser and those functions lives here.

One answer per widget, on that widget's own TTL. The pictures it named are
kept with it: the proxy fetches only a picture the last answer offered, so it
can never be pointed at another path on the server, let alone another host. A
failure keeps the last good answer and says how old it is -- a tile that
empties every time the service restarts is worse than one that says it is
behind.
*/

const (
	// mediaRequestTimeout bounds one request to a service.
	mediaRequestTimeout = 10 * time.Second
	// mediaAnswerTimeout bounds one whole answer, every part together.
	mediaAnswerTimeout = 30 * time.Second
	// mediaPartialRetry is how long an answer with a part missing lives.
	mediaPartialRetry = 30 * time.Second
)

var (
	errMediaNotSetUp    = errors.New("not set up")
	errMediaNotAllowed  = errors.New("address not allowed")
	errMediaRefused     = errors.New("key refused")
	errMediaUnreachable = errors.New("unreachable")
	errMediaNoLibraries = errors.New("no libraries")
	errMediaNoEntities  = errors.New("no entities")
)

// mediaErrorCode is what the tile is told: a short code it can word, never
// the wrapped detail, which may name an internal address.
func mediaErrorCode(err error) string {
	for _, known := range []error{errMediaNotSetUp, errMediaNotAllowed, errMediaRefused, errMediaNoLibraries, errMediaNoEntities} {
		if errors.Is(err, known) {
			return known.Error()
		}
	}
	return errMediaUnreachable.Error()
}

// MediaItem is one film, episode, series, request or download as a tile draws
// it. Library and LibraryID name the group it belongs to: a Jellyfin library,
// or Upcoming and Queue for Sonarr and Radarr.
type MediaItem struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Subtitle       string   `json:"subtitle,omitempty"`
	Kind           string   `json:"kind"`
	Year           int      `json:"year,omitempty"`
	Genres         []string `json:"genres,omitempty"`
	RuntimeMinutes int      `json:"runtimeMinutes,omitempty"`
	Overview       string   `json:"overview,omitempty"`
	Library        string   `json:"library"`
	LibraryID      string   `json:"libraryId"`
	AddedAt        int64    `json:"addedAt"`
	Played         bool     `json:"played,omitempty"`
	// NewCount is how many episodes were grouped into this line.
	NewCount int    `json:"newCount,omitempty"`
	Poster   string `json:"poster,omitempty"`
	Backdrop string `json:"backdrop,omitempty"`
	OpenURL  string `json:"openUrl"`
	// Progress is how far a download is, 0..1. Set only for a queue line.
	Progress *float64 `json:"progress,omitempty"`
	// Left is the time a download still needs, as the service words it.
	Left string `json:"left,omitempty"`
	// When is the date something is expected, ms. Set only for a calendar.
	When int64 `json:"when,omitempty"`
	// Speed is how fast a download moves, bytes a second; Size its whole size
	// in bytes. The browser words both.
	Speed int64 `json:"speed,omitempty"`
	Size  int64 `json:"size,omitempty"`
	// Value is what an entity reads ("21.4 °C", "on"); Control what may be
	// done with it ("toggle", "run"); On its switch; Icon a glyph key.
	// Unavailable and Missing dim a line: Home Assistant cannot say, or the
	// entity is gone.
	Value       string `json:"value,omitempty"`
	Control     string `json:"control,omitempty"`
	On          bool   `json:"on,omitempty"`
	Icon        string `json:"icon,omitempty"`
	Unavailable bool   `json:"unavailable,omitempty"`
	Missing     bool   `json:"missing,omitempty"`
}

// MediaTotals is the line on top of a download tile: the speeds of the
// whole client and how many downloads each group holds, before rows cuts.
type MediaTotals struct {
	Down   int64 `json:"down"`
	Up     int64 `json:"up"`
	Active int   `json:"active"`
	Paused int   `json:"paused"`
	Done   int   `json:"done"`
}

// MediaGroup is one tab of a tile: a library, or a part of a service.
type MediaGroup struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	CollectionType string `json:"collectionType,omitempty"`
}

// MediaResult is what a tile draws.
type MediaResult struct {
	Items     []MediaItem  `json:"items"`
	Libraries []MediaGroup `json:"libraries"`
	FetchedAt int64        `json:"fetchedAt"`
	Error     string       `json:"error,omitempty"`
	// Stale says the items are the last good answer and Error is why there
	// is no newer one.
	Stale bool `json:"stale,omitempty"`
	// Partial says at least one part could not be read, so what is here is
	// not all of it; the next read tries again soon.
	Partial bool `json:"partial,omitempty"`
	// Totals is set by a download client only.
	Totals *MediaTotals `json:"totals,omitempty"`
	// Controls says this reader may switch things. Set per request, after
	// the shared cache: never stored with the answer.
	Controls bool `json:"controls,omitempty"`
}

// mediaImageRef names one picture the proxy may fetch.
type mediaImageRef struct {
	Item string
	Kind string // poster or backdrop
	Tag  string
}

// mediaSpec is what the cache needs to know about a widget's settings.
type mediaSpec struct {
	Service      string
	Server       string
	CredentialID string
	// Fingerprint changes whenever a setting changes what the service is
	// asked, so a cached answer never outlives the choice it answered.
	Fingerprint string
	TTL         time.Duration
}

// mediaFetch lists what one tile draws; imageURL turns a picture into a proxy
// address.
type mediaFetch func(ctx context.Context, imageURL func(mediaImageRef) string) (MediaResult, map[mediaImageRef]bool, error)

type mediaCacheEntry struct {
	fingerprint  string
	server       string
	credentialID string
	good         *MediaResult
	images       map[mediaImageRef]bool
	answer       MediaResult
	expires      time.Time
}

var mediaWidgetCache = struct {
	sync.Mutex
	at map[string]*mediaCacheEntry
}{at: map[string]*mediaCacheEntry{}}

// mediaCacheKey keeps two services apart even for the same widget id.
func mediaCacheKey(service string, pageID int, widgetID string) string {
	return service + ":" + strconv.Itoa(pageID) + ":" + widgetID
}

// mediaForget drops one tile's answer, so its next read asks the service.
func mediaForget(service string, pageID int, widgetID string) {
	mediaWidgetCache.Lock()
	delete(mediaWidgetCache.at, mediaCacheKey(service, pageID, widgetID))
	mediaWidgetCache.Unlock()
}

// mediaForgetAll empties the cache; tests use it between cases.
func mediaForgetAll() {
	mediaWidgetCache.Lock()
	mediaWidgetCache.at = map[string]*mediaCacheEntry{}
	mediaWidgetCache.Unlock()
}

// mediaExpireAll makes every entry due without losing its last good answer.
func mediaExpireAll() {
	mediaWidgetCache.Lock()
	for _, entry := range mediaWidgetCache.at {
		entry.expires = time.Time{}
	}
	mediaWidgetCache.Unlock()
}

func mediaAllowedImage(key string, ref mediaImageRef) (string, string, bool) {
	mediaWidgetCache.Lock()
	defer mediaWidgetCache.Unlock()
	entry := mediaWidgetCache.at[key]
	if entry == nil || !entry.images[ref] {
		return "", "", false
	}
	return entry.server, entry.credentialID, true
}

func mediaProxyURL(service string, pageID int, widgetID string, ref mediaImageRef) string {
	return "/api/widgets/" + service + "/image?" + url.Values{
		"pageId": {strconv.Itoa(pageID)}, "id": {widgetID},
		"item": {ref.Item}, "kind": {ref.Kind}, "tag": {ref.Tag},
	}.Encode()
}

func (h *Handlers) mediaAnswer(ctx context.Context, pageID int, widgetID string, spec mediaSpec, fetch mediaFetch, forced bool) MediaResult {
	key := mediaCacheKey(spec.Service, pageID, widgetID)
	now := time.Now()

	mediaWidgetCache.Lock()
	entry := mediaWidgetCache.at[key]
	if entry != nil && entry.fingerprint != spec.Fingerprint {
		entry = nil
	}
	if entry != nil && !forced && now.Before(entry.expires) {
		answer := entry.answer
		mediaWidgetCache.Unlock()
		return answer
	}
	mediaWidgetCache.Unlock()

	/*
	 * Not the asker's context: the answer is shared and cached, and a browser
	 * that reloads or closes the tab halfway must not leave the cache holding
	 * whatever had arrived by then. The parts have timeouts of their own.
	 */
	fetchCtx, stop := context.WithTimeout(context.WithoutCancel(ctx), mediaAnswerTimeout)
	defer stop()
	result, images, err := fetch(fetchCtx, func(ref mediaImageRef) string {
		return mediaProxyURL(spec.Service, pageID, widgetID, ref)
	})
	result.FetchedAt = now.UnixMilli()
	if result.Items == nil {
		result.Items = []MediaItem{}
	}
	if result.Libraries == nil {
		result.Libraries = []MediaGroup{}
	}

	next := &mediaCacheEntry{
		fingerprint: spec.Fingerprint, server: spec.Server, credentialID: spec.CredentialID,
		images: images, expires: now.Add(spec.TTL),
	}
	// A half answer is shown, but asked for again soon rather than kept for
	// the whole TTL: a part that failed once is usually back a minute later.
	if result.Partial && spec.TTL > mediaPartialRetry {
		next.expires = now.Add(mediaPartialRetry)
	}
	if err == nil {
		next.good = &result
		next.answer = result
	} else {
		logWarn(logComponentWidgets, "%s widget %s: %v", spec.Service, widgetID, err)
		next.answer = MediaResult{
			Items: []MediaItem{}, Libraries: result.Libraries,
			FetchedAt: result.FetchedAt, Error: mediaErrorCode(err),
		}
		if entry != nil && entry.good != nil {
			stale := *entry.good
			stale.Error = mediaErrorCode(err)
			stale.Stale = true
			next.good = entry.good
			next.images = entry.images
			next.answer = stale
		}
	}
	mediaWidgetCache.Lock()
	mediaWidgetCache.at[key] = next
	mediaWidgetCache.Unlock()
	return next.answer
}

/*
serveMediaWidget answers what one media tile should draw.

Read by widget id, like the RSS tile: the address and the key are the
server's to know, and a tokenless reader of the page never gets them.
*/
func (h *Handlers) serveMediaWidget(w http.ResponseWriter, r *http.Request, widgetType WidgetType,
	answer func(ctx context.Context, pageID int, widget Widget, forced bool) MediaResult) {
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
		if widgets[i].ID == widgetID && widgets[i].Type == widgetType {
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
	_ = json.NewEncoder(w).Encode(answer(r.Context(), pageID, *found, forced))
}

// mediaRequest makes one GET to a service: the address checked against the
// local-network setting, the stored credential applied, a refusal named.
func (h *Handlers) mediaRequest(ctx context.Context, server string, credential HealthCredential, path string, query url.Values, accept string, decorate func(*http.Request)) (*http.Response, error) {
	return h.mediaSend(ctx, http.MethodGet, server, credential, path, query, nil, accept, decorate)
}

// mediaPost sends a JSON body under the same rules as mediaRequest: Home
// Assistant's templates and its switches.
func (h *Handlers) mediaPost(ctx context.Context, server string, credential HealthCredential, path string, body any) (*http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return h.mediaSend(ctx, http.MethodPost, server, credential, path, nil, raw, "application/json", func(req *http.Request) {
		req.Header.Set("Content-Type", "application/json")
	})
}

func (h *Handlers) mediaSend(ctx context.Context, method, server string, credential HealthCredential, path string, query url.Values, body []byte, accept string, decorate func(*http.Request)) (*http.Response, error) {
	address := server + path
	if len(query) > 0 {
		address += "?" + query.Encode()
	}
	if err := validateHTTPURL(address, h.allowLocalBookmarks()); err != nil {
		return nil, errMediaNotAllowed
	}
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, address, reader)
	if err != nil {
		return nil, errMediaNotAllowed
	}
	req.Header.Set("Accept", accept)
	req.Header.Set("User-Agent", "nextDash Widget/1.0")
	applyHealthCredential(req, credential)
	if decorate != nil {
		decorate(req)
	}
	// A service that signs in for a cookie (qBittorrent): the cached session,
	// or a fresh one; a lapsed session is signed in again once below.
	sessionKey, sent := "", ""
	if credential.Session != nil {
		sessionKey = credentialSessionKey(req.URL.Host, credential.Session)
		cookie, ok := cachedCredentialSession(sessionKey)
		if !ok {
			if cookie, err = h.freshCredentialSession(ctx, req.URL, credential.Session, sessionKey, ""); err != nil {
				return nil, fmt.Errorf("%w: sign-in: %v", errMediaRefused, err)
			}
		}
		sent = cookie
		req.Header.Set(sessionHeaderName(credential.Session), cookie)
	}
	client := h.outboundHTTPClient(mediaRequestTimeout, 3)
	// A key stored for this host does not follow a redirect to another.
	client.CheckRedirect = credentialRedirectCheck(credential, client.CheckRedirect)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errMediaUnreachable, err)
	}
	if sessionKey != "" && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
		drainAndCloseResponse(resp)
		fresh, err := h.freshCredentialSession(ctx, req.URL, credential.Session, sessionKey, sent)
		if err != nil {
			return nil, fmt.Errorf("%w: sign-in: %v", errMediaRefused, err)
		}
		retry := req.Clone(ctx)
		if body != nil {
			retry.Body = io.NopCloser(bytes.NewReader(body))
		}
		retry.Header.Set(sessionHeaderName(credential.Session), fresh)
		if resp, err = client.Do(retry); err != nil {
			return nil, fmt.Errorf("%w: %v", errMediaUnreachable, err)
		}
	}
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		resp.Body.Close()
		return nil, fmt.Errorf("%w: HTTP %d from %s", errMediaRefused, resp.StatusCode, path)
	case resp.StatusCode != http.StatusOK:
		resp.Body.Close()
		return nil, fmt.Errorf("%w: HTTP %d", errMediaUnreachable, resp.StatusCode)
	}
	return resp, nil
}
