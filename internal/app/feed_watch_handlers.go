package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

/*
The routes behind "Watch feeds".

Reads are open, like /api/feeds. Writes take the write token and a small body.
Everything the dashboard shows about watches comes from watchListFor, so the
list and the answers to writes cannot drift apart.
*/

type watchFeedEntry struct {
	FeedURL         string `json:"feedUrl"`
	Title           string `json:"title,omitempty"`
	IntervalMinutes int    `json:"intervalMinutes"`
	CheckedAt       int64  `json:"checkedAt,omitempty"`
	Failures        int    `json:"failures,omitempty"`
	Retired         bool   `json:"retired,omitempty"`
	LastError       string `json:"lastError,omitempty"`
	LastStatus      int    `json:"lastStatus,omitempty"`
	MovedFrom       string `json:"movedFrom,omitempty"`
	MovedAt         int64  `json:"movedAt,omitempty"`
}

type watchEntry struct {
	NewCount int              `json:"newCount"`
	NewAt    int64            `json:"newAt,omitempty"`
	Newest   *FeedItem        `json:"newest"`
	Feeds    []watchFeedEntry `json:"feeds"`
}

// watchItemUnread is the one rule for what is unread. readAt is the newest
// open of any bookmark copy or "seen"; an item marked after that keeps its
// mark, otherwise it is unread when it was found after readAt.
func watchItemUnread(it FeedItem, readAt int64) bool {
	if it.MarkedAt > readAt {
		return !it.MarkedRead
	}
	return it.FoundAt > readAt
}

// watchNewItems are the items of one watch not yet read, by watchItemUnread.
func watchNewItems(w FeedWatch, readAt int64) []FeedItem {
	var out []FeedItem
	for _, it := range w.Items {
		if watchItemUnread(it, readAt) {
			out = append(out, it)
		}
	}
	return out
}

func newestItemFirst(items []FeedItem) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].FoundAt != items[j].FoundAt {
			return items[i].FoundAt > items[j].FoundAt
		}
		return items[i].PublishedAt > items[j].PublishedAt
	})
}

// watchReadAt is when the news of one bookmark key was last read: the newest
// open of any copy, or an explicit "seen".
func watchReadAt(file FeedWatchFile, bookmarks []Bookmark) map[string]int64 {
	read := map[string]int64{}
	for _, b := range bookmarks {
		key := canonicalBookmarkURLKey(b.URL)
		if b.LastOpened > read[key] {
			read[key] = b.LastOpened
		}
	}
	for key, at := range file.SeenAt {
		if at > read[key] {
			read[key] = at
		}
	}
	return read
}

func watchListFor(file FeedWatchFile, bookmarks []Bookmark) map[string]watchEntry {
	live := map[string]bool{}
	for _, b := range bookmarks {
		live[canonicalBookmarkURLKey(b.URL)] = true
	}
	read := watchReadAt(file, bookmarks)
	out := map[string]watchEntry{}
	for _, w := range file.Watches {
		if !live[w.BookmarkKey] {
			continue
		}
		entry := out[w.BookmarkKey]
		entry.Feeds = append(entry.Feeds, watchFeedEntry{
			FeedURL: w.FeedURL, Title: w.Title, IntervalMinutes: w.IntervalMinutes,
			CheckedAt: w.CheckedAt, Failures: w.Failures, Retired: w.Failures >= feedMaxFailures,
			LastError: w.LastError, LastStatus: w.LastStatus, MovedFrom: w.MovedFrom, MovedAt: w.MovedAt,
		})
		fresh := watchNewItems(w, read[w.BookmarkKey])
		entry.NewCount += len(fresh)
		if len(fresh) > 0 {
			newestItemFirst(fresh)
			if w.NewAt > entry.NewAt {
				entry.NewAt = w.NewAt
			}
			if entry.Newest == nil || fresh[0].FoundAt > entry.Newest.FoundAt ||
				(fresh[0].FoundAt == entry.Newest.FoundAt && fresh[0].PublishedAt > entry.Newest.PublishedAt) {
				first := fresh[0]
				first.ImageSource = ""
				entry.Newest = &first
			}
		}
		out[w.BookmarkKey] = entry
	}
	return out
}

func writeWatchJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeWatchError(w http.ResponseWriter, status int, code string, extra map[string]any) {
	body := map[string]any{"error": code}
	for k, v := range extra {
		body[k] = v
	}
	writeWatchJSON(w, status, body)
}

// liveWatches counts the watches whose bookmark still exists. A watch left
// behind by a deleted bookmark is not polled and does not count against the
// limit.
func liveWatches(file FeedWatchFile, bookmarks []Bookmark) int {
	live := map[string]bool{}
	for _, b := range bookmarks {
		live[canonicalBookmarkURLKey(b.URL)] = true
	}
	n := 0
	for _, w := range file.Watches {
		if live[w.BookmarkKey] {
			n++
		}
	}
	return n
}

func (h *Handlers) watchListResponse(file FeedWatchFile) map[string]any {
	bookmarks := h.store.GetAllBookmarks()
	return map[string]any{
		"limit":   feedWatchLimit,
		"total":   liveWatches(file, bookmarks),
		"watches": watchListFor(file, bookmarks),
	}
}

// GetFeedWatches lists every watched bookmark with its unread count.
func (h *Handlers) GetFeedWatches(w http.ResponseWriter, r *http.Request) {
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	writeWatchJSON(w, http.StatusOK, h.watchListResponse(file))
}

// GetFeedWatchItems lists every stored item, read ones too, newest first, each
// flagged unread or not and with where it came from. Without a key it spans
// every watched bookmark. The earlier entries (recent) carry no read state.
func (h *Handlers) GetFeedWatchItems(w http.ResponseWriter, r *http.Request) {
	want := canonicalBookmarkURLKey(r.URL.Query().Get("key"))
	if raw := r.URL.Query().Get("key"); raw != "" && want == "" {
		want = raw
	}
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	bookmarks := h.store.GetAllBookmarks()
	read := watchReadAt(file, bookmarks)
	first := map[string]Bookmark{}
	for _, b := range bookmarks {
		key := canonicalBookmarkURLKey(b.URL)
		if _, ok := first[key]; !ok {
			first[key] = b
		}
	}
	type outItem struct {
		BookmarkKey  string `json:"bookmarkKey"`
		BookmarkName string `json:"bookmarkName"`
		BookmarkURL  string `json:"bookmarkUrl"`
		FeedTitle    string `json:"feedTitle,omitempty"`
		FeedURL      string `json:"feedUrl"`
		Unread       bool   `json:"unread"`
		FeedItem
	}
	items := []outItem{}
	for _, wt := range file.Watches {
		b, ok := first[wt.BookmarkKey]
		if !ok || (want != "" && wt.BookmarkKey != want) {
			continue
		}
		for _, it := range wt.Items {
			unread := watchItemUnread(it, read[wt.BookmarkKey])
			it.ImageSource = "" // the client gets our copy, never the remote address
			items = append(items, outItem{wt.BookmarkKey, b.Name, b.URL, wt.Title, wt.FeedURL, unread, it})
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].FoundAt != items[j].FoundAt {
			return items[i].FoundAt > items[j].FoundAt
		}
		return items[i].PublishedAt > items[j].PublishedAt
	})

	// The feeds' other current entries, for the list beside an article: what
	// is not new, newest first. Never an entry already listed above.
	isNew := map[string]bool{}
	for _, it := range items {
		isNew[it.BookmarkKey+"|"+it.ID] = true
	}
	recent := []outItem{}
	for _, wt := range file.Watches {
		b, ok := first[wt.BookmarkKey]
		if !ok || (want != "" && wt.BookmarkKey != want) {
			continue
		}
		for _, it := range wt.Recent {
			if isNew[wt.BookmarkKey+"|"+it.ID] {
				continue
			}
			recent = append(recent, outItem{wt.BookmarkKey, b.Name, b.URL, wt.Title, wt.FeedURL, false, it})
		}
	}
	sort.SliceStable(recent, func(i, j int) bool { return recent[i].PublishedAt > recent[j].PublishedAt })
	writeWatchJSON(w, http.StatusOK, map[string]any{"items": items, "recent": recent})
}

// GetFeedWatchCandidates lists the feeds a bookmark's page advertises, plus
// the ones already watched for it, for the picker.
func (h *Handlers) GetFeedWatchCandidates(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	key := canonicalBookmarkURLKey(raw)
	if raw == "" || key == "" {
		writeWatchError(w, http.StatusBadRequest, "no-bookmark", nil)
		return
	}
	type candidate struct {
		URL             string `json:"url"`
		Title           string `json:"title,omitempty"`
		Watched         bool   `json:"watched"`
		IntervalMinutes int    `json:"intervalMinutes,omitempty"`
	}
	var out []candidate
	index := map[string]int{}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	found := h.discoverFeedsForURL(ctx, raw)
	if len(found) == 0 {
		// Nothing in the page head: a consent wall, or a site that never
		// advertised its feed. Try the usual addresses.
		found = h.probeCommonFeeds(ctx, raw)
	}
	for _, l := range found {
		index[l.URL] = len(out)
		out = append(out, candidate{URL: l.URL, Title: l.Title})
	}
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	for _, wt := range file.Watches {
		if wt.BookmarkKey != key {
			continue
		}
		if i, ok := index[wt.FeedURL]; ok {
			out[i].Watched, out[i].IntervalMinutes = true, wt.IntervalMinutes
			continue
		}
		out = append(out, candidate{URL: wt.FeedURL, Title: wt.Title, Watched: true, IntervalMinutes: wt.IntervalMinutes})
	}
	if out == nil {
		out = []candidate{}
	}
	writeWatchJSON(w, http.StatusOK, map[string]any{"feeds": out})
}

type watchRequest struct {
	BookmarkURL string `json:"bookmarkUrl"`
	// FeedURL names one feed, for the routes that act on a single watch.
	FeedURL string `json:"feedUrl"`
	// All, on the seen route, marks every watched bookmark's news read.
	All   bool `json:"all"`
	Feeds []struct {
		FeedURL         string `json:"feedUrl"`
		IntervalMinutes int    `json:"intervalMinutes"`
	} `json:"feeds"`
}

func decodeWatchRequest(w http.ResponseWriter, r *http.Request) (watchRequest, bool) {
	var body watchRequest
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return body, false
	}
	return body, true
}

func (h *Handlers) bookmarkHasKey(key string) bool {
	if key == "" {
		return false
	}
	for _, b := range h.store.GetAllBookmarks() {
		if canonicalBookmarkURLKey(b.URL) == key {
			return true
		}
	}
	return false
}

// WatchFeeds sets the whole set of feeds watched for one bookmark: new ones
// get a baseline, kept ones only change interval, absent ones are removed.
func (h *Handlers) WatchFeeds(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := decodeWatchRequest(w, r)
	if !ok {
		return
	}
	for _, f := range body.Feeds {
		if !validFeedWatchInterval(f.IntervalMinutes) {
			writeWatchError(w, http.StatusBadRequest, "bad-interval", nil)
			return
		}
	}
	key := canonicalBookmarkURLKey(body.BookmarkURL)
	if !h.bookmarkHasKey(key) {
		writeWatchError(w, http.StatusBadRequest, "no-bookmark", nil)
		return
	}

	feedWatchMu.Lock()
	existing := readFeedWatchFile()
	feedWatchMu.Unlock()
	have := map[string]bool{}
	for _, wt := range existing.Watches {
		if wt.BookmarkKey == key {
			have[wt.FeedURL] = true
		}
	}
	others := liveWatches(existing, h.store.GetAllBookmarks())
	for range have {
		others--
	}
	seenReq := map[string]bool{}
	var wanted []struct {
		FeedURL         string `json:"feedUrl"`
		IntervalMinutes int    `json:"intervalMinutes"`
	}
	for _, f := range body.Feeds {
		f.FeedURL = strings.TrimSpace(f.FeedURL)
		if f.FeedURL == "" || seenReq[f.FeedURL] {
			continue
		}
		seenReq[f.FeedURL] = true
		wanted = append(wanted, f)
	}
	if others+len(wanted) > feedWatchLimit {
		writeWatchError(w, http.StatusConflict, "limit", map[string]any{"limit": feedWatchLimit})
		return
	}

	// New feeds are read before anything is saved: one that is not a feed
	// refuses the whole request and leaves the file as it was.
	baselined := map[string]FeedWatch{}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	for _, f := range wanted {
		if have[f.FeedURL] {
			continue
		}
		wt, err := h.baselineWatch(ctx, FeedWatch{BookmarkKey: key, FeedURL: f.FeedURL, IntervalMinutes: f.IntervalMinutes})
		if err != nil {
			writeWatchError(w, http.StatusUnprocessableEntity, "not-a-feed", map[string]any{"feedUrl": f.FeedURL})
			return
		}
		baselined[f.FeedURL] = wt
	}

	feedWatchMu.Lock()
	file := readFeedWatchFile()
	kept := make([]FeedWatch, 0, len(file.Watches)+len(wanted))
	interval := map[string]int{}
	for _, f := range wanted {
		interval[f.FeedURL] = f.IntervalMinutes
	}
	for _, wt := range file.Watches {
		if wt.BookmarkKey != key {
			kept = append(kept, wt)
			continue
		}
		if minutes, ok := interval[wt.FeedURL]; ok {
			wt.IntervalMinutes = minutes
			kept = append(kept, wt)
		}
	}
	for _, f := range wanted {
		// A save from another tab may have stored this feed while it was read.
		if wt, ok := baselined[f.FeedURL]; ok && watchIndex(kept, key, f.FeedURL) < 0 {
			kept = append(kept, wt)
		}
	}
	file.Watches = dropDuplicateWatches(kept)
	err := writeFeedWatchFile(file)
	feedWatchMu.Unlock()
	if err != nil {
		http.Error(w, "could not save", http.StatusInternalServerError)
		return
	}
	writeWatchJSON(w, http.StatusOK, map[string]any{"watch": watchListFor(file, h.store.GetAllBookmarks())[key]})
}

// UnwatchFeeds stops every watch of one bookmark and forgets its items.
func (h *Handlers) UnwatchFeeds(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := decodeWatchRequest(w, r)
	if !ok {
		return
	}
	key := canonicalBookmarkURLKey(body.BookmarkURL)
	feedWatchMu.Lock()
	defer feedWatchMu.Unlock()
	file := readFeedWatchFile()
	kept := file.Watches[:0:0]
	removed := 0
	for _, wt := range file.Watches {
		if wt.BookmarkKey == key {
			removed++
			continue
		}
		kept = append(kept, wt)
	}
	file.Watches = kept
	delete(file.SeenAt, key)
	if removed > 0 {
		_ = writeFeedWatchFile(file)
	}
	writeWatchJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

// MarkFeedWatchSeen marks the news of one bookmark as read.
func (h *Handlers) MarkFeedWatchSeen(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := decodeWatchRequest(w, r)
	if !ok {
		return
	}
	key := canonicalBookmarkURLKey(body.BookmarkURL)
	if key == "" && !body.All {
		writeWatchError(w, http.StatusBadRequest, "no-bookmark", nil)
		return
	}
	bookmarks := h.store.GetAllBookmarks()
	feedWatchMu.Lock()
	defer feedWatchMu.Unlock()
	file := readFeedWatchFile()
	if file.SeenAt == nil {
		file.SeenAt = map[string]int64{}
	}
	now := time.Now().UnixMilli()
	if body.All {
		for _, b := range bookmarks {
			file.SeenAt[canonicalBookmarkURLKey(b.URL)] = now
		}
	} else {
		file.SeenAt[key] = now
	}
	_ = writeFeedWatchFile(file)
	writeWatchJSON(w, http.StatusOK, map[string]any{})
}

// MarkFeedWatchRead marks single items of one feed read or unread.
func (h *Handlers) MarkFeedWatchRead(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var body struct {
		BookmarkURL string   `json:"bookmarkUrl"`
		FeedURL     string   `json:"feedUrl"`
		IDs         []string `json:"ids"`
		Read        bool     `json:"read"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	key := canonicalBookmarkURLKey(body.BookmarkURL)
	if key == "" {
		writeWatchError(w, http.StatusBadRequest, "no-bookmark", nil)
		return
	}
	ids := make(map[string]bool, len(body.IDs))
	for _, id := range body.IDs {
		ids[id] = true
	}
	feedWatchMu.Lock()
	defer feedWatchMu.Unlock()
	file := readFeedWatchFile()
	now := time.Now().UnixMilli()
	changed := false
	for i := range file.Watches {
		wt := &file.Watches[i]
		if wt.BookmarkKey != key || wt.FeedURL != body.FeedURL {
			continue
		}
		for j := range wt.Items {
			if ids[wt.Items[j].ID] {
				wt.Items[j].MarkedRead = body.Read
				wt.Items[j].MarkedAt = now
				changed = true
			}
		}
	}
	if changed {
		_ = writeFeedWatchFile(file)
	}
	writeWatchJSON(w, http.StatusOK, map[string]any{"watch": watchListFor(file, h.store.GetAllBookmarks())[key]})
}

// PollFeedWatchesNow checks every watch regardless of its interval.
func (h *Handlers) PollFeedWatchesNow(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	polled, news := h.pollWatches(ctx, true)
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	writeWatchJSON(w, http.StatusOK, map[string]any{
		"polled":  polled,
		"fresh":   len(news),
		"watches": watchListFor(file, h.store.GetAllBookmarks()),
	})
}

// RetryFeedWatch gives one paused feed another chance now: its failures are
// forgotten and it is asked once, inside the same round lock as every poll.
func (h *Handlers) RetryFeedWatch(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, ok := decodeWatchRequest(w, r)
	if !ok {
		return
	}
	key := canonicalBookmarkURLKey(body.BookmarkURL)
	if !h.bookmarkHasKey(key) {
		writeWatchError(w, http.StatusBadRequest, "no-bookmark", nil)
		return
	}
	feedURL := strings.TrimSpace(body.FeedURL)

	feedWatchRoundMu.Lock()
	defer feedWatchRoundMu.Unlock()
	feedWatchMu.Lock()
	var target *FeedWatch
	for _, wt := range readFeedWatchFile().Watches {
		if wt.BookmarkKey == key && wt.FeedURL == feedURL {
			wt.Failures, wt.TriedAt = 0, 0
			target = &wt
			break
		}
	}
	feedWatchMu.Unlock()
	if target == nil {
		writeWatchError(w, http.StatusNotFound, "not-watched", nil)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	h.runWatchPolls(ctx, []FeedWatch{*target})
	feedWatchMu.Lock()
	file := readFeedWatchFile()
	feedWatchMu.Unlock()
	writeWatchJSON(w, http.StatusOK, map[string]any{"watch": watchListFor(file, h.store.GetAllBookmarks())[key]})
}
