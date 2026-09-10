package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
The scan round: read the pages that have no keywords yet, and remember what
they said they were about.

Why this exists. Tag suggestions work from three sources that need no network
at all -- a rule you wrote, the tags you already gave a site's other bookmarks,
and the shipped catalogue keyed on the host. The fourth source is for the
bookmarks none of those can reach: a page on a site the catalogue has never
heard of. The only thing that knows what such a page is about is the page.

Why it is a button rather than a schedule. This is one outbound request per
bookmark, to every site the reader has saved. That is a thing to ask for and
watch happen, not a thing to discover in a log -- so nothing here runs on a
timer, and the panel states the cost ("312 bookmarks have no keywords yet")
before the reader starts.

Why there is no job state on the server. The app already walks long work from
the browser with an offset and a total -- RefreshAllBookmarkPreviews and the
favicon prefetch both do -- and that shape answers every question a scan round
raises without inventing a second one: progress is the offset the caller
already holds, stopping is the caller not asking for the next slice, and a
round trip short enough to survive any proxy is a round trip that cannot be
half-finished when a browser is closed. A server-side job would need its own
state, its own lock, its own stop route, and its own answer for two tabs
starting a round at once.
*/

// tagScanBatchDefault is how many pages one round trip reads. Four at a time
// against eight-second timeouts makes a slice of twenty about as long as the
// preview refresh's own slice, which is the pacing the reader is used to.
const tagScanBatchDefault = 20

// tagScanParallel bounds how many hosts are contacted at once. The same four
// the rest of the app's outbound work uses: enough to keep a slow host from
// setting the pace, few enough not to look like a crawler.
const tagScanParallel = 4

type tagScanTarget struct {
	pageID int
	url    string
	key    string
}

/*
tagScanTargets is every bookmark whose page has not been read for keywords.

An entry that was fetched but yielded nothing counts as read: a page with no
keywords of its own does not become one by being asked twice, and retrying it
on every round would mean the round never shrinks. KeywordsAt is what says so,
rather than FetchedAt -- that one belongs to the preview card, which is fetched
for other reasons entirely and must not decide what this round has left to do.
*/
func (h *Handlers) tagScanTargets() []tagScanTarget {
	var targets []tagScanTarget
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			raw := strings.TrimSpace(bm.URL)
			if raw == "" {
				continue
			}
			key := canonicalBookmarkURLKey(raw)
			if key == "" {
				continue
			}
			if entry, ok := h.getPreviewCacheEntry(key); ok && entry.KeywordsAt > 0 {
				continue
			}
			targets = append(targets, tagScanTarget{pageID: page.ID, url: raw, key: key})
		}
	}
	return targets
}

/*
TagScanStatus answers what a round would cost, before one is started.

GET, no side effects, no fetching: the panel draws "312 bookmarks have no
keywords yet" from this, so the number of outbound requests is stated rather
than discovered.
*/
func (h *Handlers) TagScanStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	pending := len(h.tagScanTargets())
	json.NewEncoder(w).Encode(map[string]any{
		"pending": pending,
		"batch":   tagScanBatchDefault,
	})
}

/*
TagKeywords hands the browser what the scan round has read so far.

Keyed by the bookmark's own address rather than by the cache's canonical key,
because the address is what the page already holds -- the canonicalising lives
in Go and duplicating it in JavaScript would be a second implementation to keep
in step for no gain.

Only the entries that have words. A collection where nothing has been scanned
answers with an empty object rather than with several hundred empty arrays.
*/
func (h *Handlers) TagKeywords(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	byURL := map[string][]string{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			raw := strings.TrimSpace(bm.URL)
			if raw == "" {
				continue
			}
			if _, done := byURL[raw]; done {
				continue
			}
			key := canonicalBookmarkURLKey(raw)
			if key == "" {
				continue
			}
			if entry, ok := h.getPreviewCacheEntry(key); ok && len(entry.Keywords) > 0 {
				byURL[raw] = entry.Keywords
			}
		}
	}
	json.NewEncoder(w).Encode(map[string]any{"keywords": byURL})
}

/*
TagKeywordsClear forgets every word the scan round read.

Only the words. The preview cache holds the title, the description, the
picture and the soft-404 signals for the same pages, all of it fetched for
other features and none of it this feature's to throw away -- so the entries
stay and the Keywords field is emptied.

What it costs to undo is a scan round, which is the same thing it cost to
have. That is why this is offered rather than guarded: nothing here is
irreplaceable, and a reader who tried the feature and wants their disk back
should not have to clear the whole preview cache to get it.
*/
func (h *Handlers) TagKeywordsClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	updates := map[string]BookmarkPreview{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			key := canonicalBookmarkURLKey(strings.TrimSpace(bm.URL))
			if key == "" {
				continue
			}
			if _, done := updates[key]; done {
				continue
			}
			entry, ok := h.getPreviewCacheEntry(key)
			if !ok || len(entry.Keywords) == 0 {
				continue
			}
			entry.Keywords = nil
			// And askable again: the round picks its targets by KeywordsAt, so
			// leaving it set would forget the words and refuse to read them
			// back.
			entry.KeywordsAt = 0
			updates[key] = entry
		}
	}

	cleared := len(updates)
	if !respondStorePersistError(w, h.mergePreviewCacheUpdates(updates)) {
		return
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "ok", "cleared": cleared})
}

/*
TagScanReset makes every page askable again, without forgetting a word.

For the reader who has scanned the lot and wants it done over: a site was
redesigned, or the catalogue grew and what a page says is worth weighing
again. Only the stamp is cleared, so the words that are there stay until they
are replaced -- the panel keeps proposing from what it has while the round
runs, rather than emptying itself first and filling back up.
*/
func (h *Handlers) TagScanReset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	updates := map[string]BookmarkPreview{}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			key := canonicalBookmarkURLKey(strings.TrimSpace(bm.URL))
			if key == "" {
				continue
			}
			if _, done := updates[key]; done {
				continue
			}
			entry, ok := h.getPreviewCacheEntry(key)
			if !ok || entry.KeywordsAt == 0 {
				continue
			}
			entry.KeywordsAt = 0
			updates[key] = entry
		}
	}

	reset := len(updates)
	if !respondStorePersistError(w, h.mergePreviewCacheUpdates(updates)) {
		return
	}
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "ok", "reset": reset})
}

/*
TagScan reads one slice of the pages that have no keywords yet.

The caller walks the collection: it asks for offset 0, gets back how many
remain in total and how many this slice read, and asks again from where it
stopped -- or does not, which is what stopping means here.

A page that cannot be read is a skip rather than a failure. A dead host, a
refused address, a timeout: none of them says anything about the bookmark
except that its page is not available now, and a round that stopped on the
first one would never get past a collection's first dead link. They are counted
and reported, and not retried inside the same round.
*/
func (h *Handlers) TagScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	targets := h.tagScanTargets()
	total := len(targets)

	limit := tagScanBatchDefault
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	if limit > total {
		limit = total
	}
	slice := targets[:limit]

	/*
	 * Fetched in parallel, written once.
	 *
	 * Each worker owns its own cache map rather than sharing one behind a
	 * mutex: fetchBookmarkPreview writes into the map it is handed, and four
	 * goroutines writing one map is a data race however carefully the
	 * surrounding code is read.
	 */
	type result struct {
		key     string
		preview BookmarkPreview
		ok      bool
	}
	results := make([]result, len(slice))
	var wg sync.WaitGroup
	gate := make(chan struct{}, tagScanParallel)
	for i, target := range slice {
		wg.Add(1)
		go func(i int, target tagScanTarget) {
			defer wg.Done()
			gate <- struct{}{}
			defer func() { <-gate }()
			cache := PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
			preview := h.fetchBookmarkPreview(r.Context(), target.url, &cache, false)
			/*
			 * Stamped even when the page could not be read.
			 *
			 * A refused address or a dead host returns before the extraction
			 * runs, so the stamp it would have set is missing -- and an
			 * unstamped page is one this round offers again on the next pass,
			 * forever. Asked is asked.
			 */
			if preview.KeywordsAt == 0 {
				preview.KeywordsAt = time.Now().UnixMilli()
			}
			results[i] = result{
				key:     target.key,
				preview: preview,
				// A preview with nothing on it at all is a page that could not
				// be read. It is still stored: FetchedAt is what keeps the
				// round from offering it again on the next pass.
				ok: preview.Title != "" || len(preview.Keywords) > 0,
			}
		}(i, target)
	}
	wg.Wait()

	updates := map[string]BookmarkPreview{}
	read, failed, found := 0, 0, 0
	for _, res := range results {
		if res.key == "" {
			continue
		}
		updates[res.key] = res.preview
		if res.ok {
			read++
		} else {
			failed++
		}
		if len(res.preview.Keywords) > 0 {
			found++
		}
	}

	if !respondStorePersistError(w, h.mergePreviewCacheUpdates(updates)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":    "ok",
		"total":     total,
		"read":      read,
		"failed":    failed,
		"found":     found,
		"pending":   total - len(slice),
		"fetchedAt": time.Now().UnixMilli(),
	})
}
