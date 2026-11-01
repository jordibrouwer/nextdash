package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"sync"
	"time"
)

var errFeedWatchNotAFeed = errors.New("that address did not answer with a feed")

// feedWatchFutureSlack is how far past now an entry's date may lie before it
// is taken for a mistake. Such an entry counts as published when it was found,
// so one wrong date cannot hide every later entry.
const feedWatchFutureSlack = 24 * time.Hour

// feedWatchRoundMu lets one poll round run at a time, the scheduler's and
// Check now alike. feedWatchMu stays for file access only.
var feedWatchRoundMu sync.Mutex

// onWatchNewsHook, when set (tests), sees every batch of news a round announces.
var onWatchNewsHook func([]watchNews)

// newestNonFuture is the newest date among items that is not beyond limit.
func newestNonFuture(items []FeedItem, limit int64) int64 {
	var newest int64
	for _, it := range items {
		if it.PublishedAt <= limit && it.PublishedAt > newest {
			newest = it.PublishedAt
		}
	}
	return newest
}

// clampFutureDates gives an entry dated beyond the slack the time it was found.
func clampFutureDates(items []FeedItem, now int64) {
	limit := now + feedWatchFutureSlack.Milliseconds()
	for i := range items {
		if items[i].PublishedAt > limit {
			items[i].PublishedAt = now
		}
	}
}

// failCode names why a fetch that did not give a feed failed.
func failCode(res feedFetch) string {
	switch {
	case errors.Is(res.Err, errFeedURLInvalid):
		return "refused"
	case res.Status == 0:
		var netErr net.Error
		if errors.Is(res.Err, context.DeadlineExceeded) || (errors.As(res.Err, &netErr) && netErr.Timeout()) {
			return "timeout"
		}
		return "unreachable"
	case res.Status >= 500 && res.Status < 600:
		return "http-5xx"
	case res.Status < 200 || res.Status >= 300:
		return fmt.Sprintf("http-%d", res.Status)
	}
	return "unreachable"
}

// watchNews is what one poll found for one watch.
type watchNews struct {
	BookmarkKey string
	FeedURL     string
	Items       []FeedItem
}

// baselineWatch reads the feed once and records what is already there as seen,
// so that watching starts from "nothing new".
func (h *Handlers) baselineWatch(ctx context.Context, w FeedWatch) (FeedWatch, error) {
	res := h.fetchFeed(ctx, w.FeedURL, "", "")
	if res.Err != nil || res.Status < 200 || res.Status >= 300 {
		return w, errFeedWatchNotAFeed
	}
	title, items, err := parseFeedItems(res.Body, res.Final)
	if err != nil {
		return w, errFeedWatchNotAFeed
	}
	now := time.Now().UnixMilli()
	clampFutureDates(items, now)
	w.Title = title
	w.ETag, w.LastModified = res.ETag, res.LastModified
	w.WatchedAt, w.CheckedAt, w.TriedAt = now, now, now
	w.Failures = 0
	w.LastError, w.LastStatus = "", 0
	w.Items = nil
	w.SeenIDs = nil
	for _, it := range items {
		if it.PublishedAt > w.NewestAt {
			w.NewestAt = it.PublishedAt
		}
		w.SeenIDs = append(w.SeenIDs, it.ID)
	}
	w.SeenIDs = dedupeStrings(w.SeenIDs, seenIDCap(len(items)))
	w.Recent = recentFromItems(items)
	return w, nil
}

// pollWatch asks a watched feed whether it has anything new.
//
// An entry is new when its id has not been seen and it is either undated or
// newer than the newest entry seen. An old entry republished with a fresh
// date keeps its id, so it is not news twice.
func (h *Handlers) pollWatch(ctx context.Context, w FeedWatch, now time.Time) (FeedWatch, []FeedItem) {
	ms := now.UnixMilli()
	w.TriedAt = ms
	res := h.fetchFeed(ctx, w.FeedURL, w.ETag, w.LastModified)
	if res.Status == 0 {
		w.Failures++
		w.LastError, w.LastStatus = failCode(res), 0
		if errors.Is(res.Err, errFeedURLInvalid) {
			w.Failures = feedMaxFailures
		} else {
			logFeedFailure(w.FeedURL, w.Failures, "it could not be reached")
		}
		return w, nil
	}
	w.CheckedAt = ms
	if res.Status == http.StatusNotModified {
		w.Failures = 0
		w.LastError, w.LastStatus = "", 0
		h.followMove(&w, res, ms)
		return w, nil
	}
	if res.Status < 200 || res.Status >= 300 || res.Err != nil {
		w.Failures++
		w.LastError, w.LastStatus = failCode(res), res.Status
		if res.Status >= 200 && res.Status < 300 {
			w.LastError = "unreachable"
		}
		logFeedFailure(w.FeedURL, w.Failures, "it did not answer usefully")
		return w, nil
	}
	_, items, err := parseFeedItems(res.Body, res.Final)
	if err != nil {
		w.Failures++
		w.LastError, w.LastStatus = "not-a-feed", res.Status
		logFeedFailure(w.FeedURL, w.Failures, "what came back is not a feed nextDash can read")
		return w, nil
	}
	h.followMove(&w, res, ms)
	if limit := ms + feedWatchFutureSlack.Milliseconds(); w.NewestAt > limit {
		w.NewestAt = newestNonFuture(items, limit)
	}
	clampFutureDates(items, ms)

	seen := make(map[string]bool, len(w.SeenIDs))
	for _, id := range w.SeenIDs {
		seen[id] = true
	}
	var found []FeedItem
	for _, it := range items {
		if seen[it.ID] {
			continue
		}
		if it.PublishedAt > 0 && it.PublishedAt < w.NewestAt {
			continue
		}
		it.Summary = sanitizeFeedHTML(it.Summary, feedWatchSummaryRunes)
		it.FoundAt = ms
		found = append(found, it)
	}
	if len(found) > feedWatchMaxItems {
		found = found[:feedWatchMaxItems]
	}

	ids := make([]string, 0, feedWatchSeenIDs)
	for _, it := range items {
		ids = append(ids, it.ID)
		if it.PublishedAt > w.NewestAt {
			w.NewestAt = it.PublishedAt
		}
	}
	for _, id := range w.SeenIDs {
		ids = append(ids, id)
	}
	w.SeenIDs = dedupeStrings(ids, seenIDCap(len(items)))

	w.Failures = 0
	w.LastError, w.LastStatus = "", 0
	w.Recent = recentFromItems(items)
	w.ETag, w.LastModified = res.ETag, res.LastModified
	if len(found) > 0 {
		w.Items = append(append([]FeedItem{}, found...), w.Items...)
		if len(w.Items) > feedWatchMaxItems {
			w.Items = w.Items[:feedWatchMaxItems]
		}
		w.NewAt = ms
	}
	return w, found
}

// followMove adopts the address a feed has moved to for good: every hop was a
// 301 or 308 and the new address is one nextDash may fetch. A temporary
// redirect never changes the stored address.
func (h *Handlers) followMove(w *FeedWatch, res feedFetch, ms int64) {
	if !res.Permanent || res.Final == "" || res.Final == w.FeedURL {
		return
	}
	if err := validateHTTPURL(res.Final, h.allowLocalBookmarks()); err != nil {
		return
	}
	w.MovedFrom, w.MovedAt = w.FeedURL, ms
	w.FeedURL = res.Final
}

// recentFromItems keeps the feed's newest entries as light copies: the text cut
// short and no picture, so they cost a few hundred bytes each.
func recentFromItems(items []FeedItem) []FeedItem {
	n := len(items)
	if n > feedWatchRecent {
		n = feedWatchRecent
	}
	out := make([]FeedItem, 0, n)
	for _, it := range items[:n] {
		out = append(out, FeedItem{
			ID: it.ID, Title: it.Title, Link: it.Link, PublishedAt: it.PublishedAt,
			Summary: sanitizeFeedHTML(it.Summary, feedWatchRecentSummaryRunes),
		})
	}
	return out
}

// seenIDCap is how many ids to remember: at least feedWatchSeenIDs, and every
// entry the feed holds right now. An undated entry is told apart by its id
// alone, so forgetting one the feed still lists would announce it again.
func seenIDCap(inFeed int) int {
	if inFeed > feedWatchSeenIDs {
		return inFeed
	}
	return feedWatchSeenIDs
}

func dedupeStrings(in []string, max int) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) == max {
			break
		}
	}
	return out
}

// watchDue reports whether a watch should be asked now. A watch that failed
// feedMaxFailures times in a row is retried once a day, like a Fresh feed.
func watchDue(w FeedWatch, now time.Time) bool {
	if w.Failures >= feedMaxFailures && now.Sub(time.UnixMilli(w.TriedAt)) < feedRetiredRetry {
		return false
	}
	last := w.CheckedAt
	if w.TriedAt > last {
		last = w.TriedAt
	}
	if last <= 0 {
		return true
	}
	minutes := w.IntervalMinutes
	if !validFeedWatchInterval(minutes) {
		minutes = 60
	}
	return now.Sub(time.UnixMilli(last)) >= time.Duration(minutes)*time.Minute
}

// pollWatches polls every due watch whose bookmark still exists. force skips
// the interval (Check now) but not the retirement of a dead feed. One round runs
// at a time: a second caller waits for the first.
func (h *Handlers) pollWatches(ctx context.Context, force bool) (int, []watchNews) {
	if demoMode() {
		return 0, nil
	}
	feedWatchRoundMu.Lock()
	defer feedWatchRoundMu.Unlock()
	live := map[string]bool{}
	for _, b := range h.store.GetAllBookmarks() {
		if key := canonicalBookmarkURLKey(b.URL); key != "" {
			live[key] = true
		}
	}
	now := time.Now()
	feedWatchMu.Lock()
	var targets []FeedWatch
	for _, w := range readFeedWatchFile().Watches {
		if !live[w.BookmarkKey] {
			continue
		}
		if force {
			if w.Failures >= feedMaxFailures && now.Sub(time.UnixMilli(w.TriedAt)) < feedRetiredRetry {
				continue
			}
		} else if !watchDue(w, now) {
			continue
		}
		targets = append(targets, w)
	}
	feedWatchMu.Unlock()
	return h.runWatchPolls(ctx, targets)
}

// runWatchPolls polls the given watches, merges the answers onto what is on
// disk and announces the news. The caller holds feedWatchRoundMu.
func (h *Handlers) runWatchPolls(ctx context.Context, targets []FeedWatch) (int, []watchNews) {
	type polledWatch struct {
		from string // the address it was polled at; it may have moved since
		w    FeedWatch
	}
	polled := make([]polledWatch, 0, len(targets))
	imagesStored := false
	var news []watchNews
	for _, w := range targets {
		if ctx.Err() != nil {
			break
		}
		next, found := h.pollWatch(ctx, w, time.Now())
		if len(found) > 0 {
			found = h.storeWatchImages(found)
			applyWatchImages(next.Items, found)
			imagesStored = true
		}
		polled = append(polled, polledWatch{from: w.FeedURL, w: next})
		if len(found) > 0 {
			news = append(news, watchNews{BookmarkKey: w.BookmarkKey, FeedURL: next.FeedURL, Items: found})
		}
	}

	if imagesStored {
		_, _ = evictPreviewImages(h.previewImageCapBytes())
	}

	feedWatchMu.Lock()
	file := readFeedWatchFile()
	dropped := map[int]bool{}
	// Watches that stayed put go first, so a moved one that lands on one of
	// them merges into its fresh state.
	for _, moved := range []bool{false, true} {
		for _, p := range polled {
			if (p.w.FeedURL != p.from) != moved {
				continue
			}
			for i := range file.Watches {
				// Merged onto what is on disk now: a watch stopped mid-round stays
				// stopped, and one re-saved with another interval keeps it.
				if dropped[i] || file.Watches[i].BookmarkKey != p.w.BookmarkKey || file.Watches[i].FeedURL != p.from {
					continue
				}
				p.w.IntervalMinutes = file.Watches[i].IntervalMinutes
				if p.w.FeedURL != p.from {
					// It moved. When the same bookmark already watches the new
					// address, that watch stays and takes over what this one had seen.
					if j := watchIndex(file.Watches, p.w.BookmarkKey, p.w.FeedURL); j >= 0 && j != i {
						union := append(append([]string{}, file.Watches[j].SeenIDs...), p.w.SeenIDs...)
						file.Watches[j].SeenIDs = dedupeStrings(union, seenIDCap(len(union)))
						dropped[i] = true
						continue
					}
				}
				file.Watches[i] = p.w
			}
		}
	}
	if len(dropped) > 0 {
		kept := file.Watches[:0:0]
		for i, w := range file.Watches {
			if !dropped[i] {
				kept = append(kept, w)
			}
		}
		file.Watches = kept
	}
	if len(polled) > 0 {
		_ = writeFeedWatchFile(file)
	}
	feedWatchMu.Unlock()

	sort.SliceStable(news, func(i, j int) bool { return news[i].Items[0].PublishedAt > news[j].Items[0].PublishedAt })
	if len(news) > 0 {
		h.onWatchNews(ctx, news)
	}
	return len(polled), news
}

func watchIndex(watches []FeedWatch, key, feedURL string) int {
	for i, w := range watches {
		if w.BookmarkKey == key && w.FeedURL == feedURL {
			return i
		}
	}
	return -1
}

// onWatchNews is where a round's news is announced beyond the dashboard.
func (h *Handlers) onWatchNews(ctx context.Context, news []watchNews) {
	if onWatchNewsHook != nil {
		onWatchNewsHook(news)
	}
	h.pushWatchNews(ctx, news)
}

// maybePollWatches runs on the feed scheduler's tick. It does not wait for
// Fresh: ticking a feed to watch is the opt-in to ask that server.
func (h *Handlers) maybePollWatches() {
	if demoMode() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	h.pollWatches(ctx, false)
}

// storeWatchImages copies each item's picture into the preview-image cache, so
// the browser fetches it from nextDash and not from the feed's host. A picture
// that is refused (an SVG, a private address, too large) leaves Image empty:
// the card simply has none.
func (h *Handlers) storeWatchImages(items []FeedItem) []FeedItem {
	out := make([]FeedItem, len(items))
	copy(out, items)
	for i := range out {
		out[i].Image = ""
		if out[i].ImageSource == "" {
			continue
		}
		if name, err := downloadPreviewImage(out[i].ImageSource, h.allowLocalBookmarks()); err == nil && name != "" {
			out[i].Image = "/data/" + previewImageDirName + "/" + name
		}
	}
	return out
}

// applyWatchImages copies the stored pictures onto the persisted items.
func applyWatchImages(items []FeedItem, withImages []FeedItem) {
	byID := make(map[string]string, len(withImages))
	for _, it := range withImages {
		byID[it.ID] = it.Image
	}
	for i := range items {
		if img, ok := byID[items[i].ID]; ok {
			items[i].Image = img
		}
	}
}
