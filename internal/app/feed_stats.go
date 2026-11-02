package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

/*
Statistics about watched feeds.

Counters only: per feed and per local day how many items it published, how
many turned read, how its polls went and how long it took to answer; per feed
a week of hours saying when it tends to publish; per day how many messages went
out about it. No title, text or item id is kept, so the file stays small and
says nothing about what was read.

The file is fed from three places: a poll round (runWatchPolls), every path
that turns an item read (flagWatchReads), and the announcements of a round
(pushWatchNews). A failed write is logged and forgotten: statistics never stop a
poll or a click.
*/

const (
	// feedStatsGoneKeep is how long the numbers of a stopped watch are kept.
	feedStatsGoneKeep = 90 * 24 * time.Hour
	// feedStatsWeeksKeep is how long the weekly rows that older days are rolled
	// into are kept.
	feedStatsWeeksKeep = 2 * 365 * 24 * time.Hour
	feedStatsDayLayout = "2006-01-02"
)

// feedStatsNow is the clock of the statistics; tests move it.
var feedStatsNow = time.Now

// writeFeedStatsFile is a variable so a test can make the disk fail.
var writeFeedStatsFile = func(file FeedStatsFile) error {
	return writeIndentJSONFile(feedStatsFilePath(), file)
}

var feedStatsMu sync.Mutex

// validFeedStatsKeepDays is the choice offered for keeping daily rows.
func validFeedStatsKeepDays(days int) bool {
	return days == 30 || days == 90 || days == 365
}

// FeedStatsDay is one feed's numbers on one local day.
type FeedStatsDay struct {
	Published int            `json:"published,omitempty"`
	Read      int            `json:"read,omitempty"`
	OK        int            `json:"ok,omitempty"`
	Failed    int            `json:"failed,omitempty"`
	Codes     map[string]int `json:"codes,omitempty"`
	MsSum     int64          `json:"msSum,omitempty"`
	MsCount   int            `json:"msCount,omitempty"`
	// Unread is the count left at the last poll of the day; nil before one.
	Unread *int `json:"unread,omitempty"`
}

// FeedStatsWeek is what older days are rolled into, keyed by the Monday of
// their ISO week.
type FeedStatsWeek struct {
	Published int `json:"published,omitempty"`
	Read      int `json:"read,omitempty"`
	OK        int `json:"ok,omitempty"`
	Failed    int `json:"failed,omitempty"`
}

// FeedStatsFeed is everything counted about one watch.
type FeedStatsFeed struct {
	Days  map[string]*FeedStatsDay  `json:"days,omitempty"`
	Weeks map[string]*FeedStatsWeek `json:"weeks,omitempty"`
	// Hours counts published items by weekday (Monday first) and hour, local
	// time. It is never pruned: it only ever says "when".
	Hours [7][24]int `json:"hours"`
	// GoneAt is when the watch was first found missing; its numbers go
	// feedStatsGoneKeep later.
	GoneAt int64 `json:"goneAt,omitempty"`
}

// FeedStatsGlobal is one day's numbers that belong to no single feed.
type FeedStatsGlobal struct {
	Rounds   int `json:"rounds,omitempty"`
	Push     int `json:"push,omitempty"`
	Webhooks int `json:"webhooks,omitempty"`
	Targets  int `json:"targets,omitempty"`
}

// FeedStatsFile is feed-stats.json. Feeds are keyed by feedStatsID.
type FeedStatsFile struct {
	// Since is when counting started; an item found before it is never
	// counted as read.
	Since    int64                       `json:"since"`
	PrunedOn string                      `json:"prunedOn,omitempty"`
	Feeds    map[string]*FeedStatsFeed   `json:"feeds"`
	Days     map[string]*FeedStatsGlobal `json:"days,omitempty"`
}

func feedStatsFilePath() string {
	return filepath.Join(ResolveDataDir(), "feed-stats.json")
}

func feedStatsID(bookmarkKey, feedURL string) string {
	return bookmarkKey + "|" + feedURL
}

func feedStatsDayOf(ms int64) string {
	return time.UnixMilli(ms).In(time.Local).Format(feedStatsDayLayout)
}

func readFeedStatsFile() FeedStatsFile {
	file := FeedStatsFile{}
	if data, err := os.ReadFile(feedStatsFilePath()); err == nil {
		_ = json.Unmarshal(data, &file)
	}
	if file.Feeds == nil {
		file.Feeds = map[string]*FeedStatsFeed{}
	}
	if file.Days == nil {
		file.Days = map[string]*FeedStatsGlobal{}
	}
	return file
}

func (f *FeedStatsFile) feed(id string) *FeedStatsFeed {
	feed := f.Feeds[id]
	if feed == nil {
		feed = &FeedStatsFeed{}
		f.Feeds[id] = feed
	}
	if feed.Days == nil {
		feed.Days = map[string]*FeedStatsDay{}
	}
	return feed
}

func (feed *FeedStatsFeed) day(day string) *FeedStatsDay {
	d := feed.Days[day]
	if d == nil {
		d = &FeedStatsDay{}
		feed.Days[day] = d
	}
	return d
}

func (f *FeedStatsFile) global(day string) *FeedStatsGlobal {
	d := f.Days[day]
	if d == nil {
		d = &FeedStatsGlobal{}
		f.Days[day] = d
	}
	return d
}

// feedStatsSettings says whether statistics are kept, and for how many days.
func (h *Handlers) feedStatsSettings() (bool, int) {
	s := h.store.GetSettings()
	keep := s.FeedStatsKeepDays
	if !validFeedStatsKeepDays(keep) {
		keep = 90
	}
	return s.FeedStatsEnabled, keep
}

// feedStatsSince is when counting started, and whether it is on. Before the
// file exists nothing found so far counts: since is now.
func (h *Handlers) feedStatsSince() (int64, bool) {
	on, _ := h.feedStatsSettings()
	if !on {
		return 0, false
	}
	feedStatsMu.Lock()
	since := readFeedStatsFile().Since
	feedStatsMu.Unlock()
	if since == 0 {
		since = feedStatsNow().UnixMilli()
	}
	return since, true
}

// recordFeedStats applies one change to the file when statistics are on. It
// never fails its caller: a write that does not work is logged.
func (h *Handlers) recordFeedStats(change func(f *FeedStatsFile, now time.Time)) {
	on, keep := h.feedStatsSettings()
	if !on {
		return
	}
	defer func() {
		if p := recover(); p != nil {
			logWarn(logComponentFeeds, "feed statistics were not recorded: %v", p)
		}
	}()
	now := feedStatsNow()
	feedStatsMu.Lock()
	defer feedStatsMu.Unlock()
	file := readFeedStatsFile()
	change(&file, now)
	if file.Since == 0 {
		file.Since = now.UnixMilli()
	}
	if today := now.Format(feedStatsDayLayout); file.PrunedOn != today {
		pruneFeedStats(&file, now, keep)
		file.PrunedOn = today
	}
	if err := writeFeedStatsFile(file); err != nil {
		logWarn(logComponentFeeds, "feed statistics could not be saved: %v", err)
	}
}

// pruneFeedStats rolls daily rows older than keepDays into weekly ones, drops
// weekly rows after two years, and forgets a stopped watch 90 days on.
func pruneFeedStats(f *FeedStatsFile, now time.Time, keepDays int) {
	cutoff := now.AddDate(0, 0, -keepDays).Format(feedStatsDayLayout)
	weeksCutoff := now.Add(-feedStatsWeeksKeep).Format(feedStatsDayLayout)
	for id, feed := range f.Feeds {
		if feed.GoneAt > 0 && now.Sub(time.UnixMilli(feed.GoneAt)) >= feedStatsGoneKeep {
			delete(f.Feeds, id)
			continue
		}
		for day, d := range feed.Days {
			if day >= cutoff {
				continue
			}
			delete(feed.Days, day)
			week := feedStatsWeekOf(day)
			if week == "" {
				continue
			}
			if feed.Weeks == nil {
				feed.Weeks = map[string]*FeedStatsWeek{}
			}
			w := feed.Weeks[week]
			if w == nil {
				w = &FeedStatsWeek{}
				feed.Weeks[week] = w
			}
			w.Published += d.Published
			w.Read += d.Read
			w.OK += d.OK
			w.Failed += d.Failed
		}
		for week := range feed.Weeks {
			if week < weeksCutoff {
				delete(feed.Weeks, week)
			}
		}
	}
	for day := range f.Days {
		if day < cutoff {
			delete(f.Days, day)
		}
	}
}

// feedStatsWeekOf is the Monday of a day's ISO week, as a day.
func feedStatsWeekOf(day string) string {
	t, err := time.ParseInLocation(feedStatsDayLayout, day, time.Local)
	if err != nil {
		return ""
	}
	back := (int(t.Weekday()) + 6) % 7
	return t.AddDate(0, 0, -back).Format(feedStatsDayLayout)
}

// flagWatchReads finds the items that are read now and were not counted yet,
// marks them counted and returns how many per feed. Only items found since
// counting began count; an item marked unread and read again counts once.
func flagWatchReads(file *FeedWatchFile, read map[string]int64, since int64) map[string]int {
	out := map[string]int{}
	for i := range file.Watches {
		wt := &file.Watches[i]
		for j := range wt.Items {
			it := &wt.Items[j]
			if it.ReadCounted || it.FoundAt < since || watchItemUnread(*it, read[wt.BookmarkKey]) {
				continue
			}
			it.ReadCounted = true
			out[feedStatsID(wt.BookmarkKey, wt.FeedURL)]++
		}
	}
	return out
}

// carryReadCounted keeps what was counted on disk while a poll was out: the
// poll's copy of the items predates a read in between.
func carryReadCounted(next *FeedWatch, onDisk FeedWatch) {
	counted := map[string]bool{}
	for _, it := range onDisk.Items {
		if it.ReadCounted {
			counted[it.ID] = true
		}
	}
	for i := range next.Items {
		if counted[next.Items[i].ID] {
			next.Items[i].ReadCounted = true
		}
	}
}

// addFeedReads books reads counted by flagWatchReads on today.
func addFeedReads(f *FeedStatsFile, now time.Time, reads map[string]int) {
	today := now.Format(feedStatsDayLayout)
	for id, n := range reads {
		f.feed(id).day(today).Read += n
	}
}

// sweepWatchReads is the read side for a route that changed what is read:
// it flags and counts on file, and reports whether the file changed. The
// caller holds feedWatchMu and writes the file.
func (h *Handlers) sweepWatchReads(file *FeedWatchFile, bookmarks []Bookmark) bool {
	since, on := h.feedStatsSince()
	if !on {
		return false
	}
	reads := flagWatchReads(file, watchReadAt(*file, bookmarks), since)
	if len(reads) == 0 {
		return false
	}
	h.recordFeedStats(func(f *FeedStatsFile, now time.Time) { addFeedReads(f, now, reads) })
	return true
}

// feedPollResult is what one poll tells the statistics.
type feedPollResult struct {
	id    string
	ok    bool
	code  string
	ms    int64
	found []FeedItem
}

// recordFeedPolls books one round: every poll's outcome and answer time, the
// items it found by the day they were published, the reads the round noticed,
// the unread left per feed, and which watches are gone.
func (h *Handlers) recordFeedPolls(start time.Time, polls []feedPollResult, reads map[string]int, unread map[string]int) {
	h.recordFeedStats(func(f *FeedStatsFile, now time.Time) {
		if f.Since == 0 {
			f.Since = start.UnixMilli()
		}
		today := now.Format(feedStatsDayLayout)
		if len(polls) > 0 {
			f.global(today).Rounds++
		}
		for _, p := range polls {
			feed := f.feed(p.id)
			d := feed.day(today)
			if p.ok {
				d.OK++
				d.MsSum += p.ms
				d.MsCount++
			} else {
				d.Failed++
				if d.Codes == nil {
					d.Codes = map[string]int{}
				}
				code := p.code
				if code == "" {
					code = "unreachable"
				}
				d.Codes[code]++
			}
			for _, it := range p.found {
				feed.day(feedStatsDayOf(itemStamp(it))).Published++
				if it.PublishedAt > 0 {
					t := time.UnixMilli(it.PublishedAt).In(time.Local)
					feed.Hours[(int(t.Weekday())+6)%7][t.Hour()]++
				}
			}
		}
		addFeedReads(f, now, reads)
		for id, n := range unread {
			n := n
			f.feed(id).day(today).Unread = &n
		}
		if unread != nil {
			for id, feed := range f.Feeds {
				if _, live := unread[id]; live {
					feed.GoneAt = 0
				} else if feed.GoneAt == 0 {
					feed.GoneAt = now.UnixMilli()
				}
			}
		}
	})
}

// recordFeedNotify books the messages one round of news sent.
func (h *Handlers) recordFeedNotify(push, webhooks, targets int) {
	if push+webhooks+targets == 0 {
		return
	}
	h.recordFeedStats(func(f *FeedStatsFile, now time.Time) {
		d := f.global(now.Format(feedStatsDayLayout))
		d.Push += push
		d.Webhooks += webhooks
		d.Targets += targets
	})
}

// recordBookmarkOpenReads counts the news an open of a bookmark just read.
func (h *Handlers) recordBookmarkOpenReads(bookmarkURL string) {
	key := canonicalBookmarkURLKey(bookmarkURL)
	if key == "" {
		return
	}
	if _, on := h.feedStatsSince(); !on {
		return
	}
	bookmarks := h.store.GetAllBookmarks()
	feedWatchMu.Lock()
	defer feedWatchMu.Unlock()
	file := readFeedWatchFile()
	if watchIndexByKey(file.Watches, key) < 0 {
		return
	}
	if h.sweepWatchReads(&file, bookmarks) {
		if err := writeFeedWatchFile(file); err != nil {
			logWarn(logComponentFeeds, "watched feeds could not be saved: %v", err)
		}
	}
}

func watchIndexByKey(watches []FeedWatch, key string) int {
	for i, w := range watches {
		if w.BookmarkKey == key {
			return i
		}
	}
	return -1
}

/* ------------------------------------------------------------------
 * The routes
 * ------------------------------------------------------------------ */

type feedStatsDaily struct {
	Date      string `json:"date"`
	Published int    `json:"published"`
	Read      int    `json:"read"`
}

type feedStatsRow struct {
	BookmarkKey string `json:"bookmarkKey"`
	FeedURL     string `json:"feedUrl"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Published   int    `json:"published"`
	Read        int    `json:"read"`
	ReadPct     int    `json:"readPct"`
	LastItemAt  int64  `json:"lastItemAt,omitempty"`
	State       string `json:"state"`
	Unread      int    `json:"unread"`
	// HourTotal is how many items the feed's hour matrix holds.
	HourTotal int `json:"hourTotal"`
}

type feedStatsHealthRow struct {
	BookmarkKey string         `json:"bookmarkKey"`
	FeedURL     string         `json:"feedUrl"`
	Name        string         `json:"name"`
	Title       string         `json:"title,omitempty"`
	Codes       map[string]int `json:"codes"`
	Failed      int            `json:"failed"`
	OK          int            `json:"ok"`
	AvgMs       int64          `json:"avgMs"`
	State       string         `json:"state"`
}

func readPct(read, published int) int {
	if published <= 0 {
		return 0
	}
	pct := (read*100 + published/2) / published
	if pct > 100 {
		pct = 100
	}
	return pct
}

// feedStatsState is the dot beside a feed: paused, bad (polls no longer
// work), warn (a failure this week), muted, ok.
func feedStatsState(w FeedWatch, failedWeek int) string {
	switch {
	case w.Paused:
		return "paused"
	case w.Failures >= feedMaxFailures:
		return "bad"
	case w.Failures > 0 || failedWeek > 0:
		return "warn"
	case w.Muted:
		return "muted"
	}
	return "ok"
}

func feedStatsDays(now time.Time, n int) []string {
	out := make([]string, 0, n)
	for i := n - 1; i >= 0; i-- {
		out = append(out, now.AddDate(0, 0, -i).Format(feedStatsDayLayout))
	}
	return out
}

// GetFeedStats answers Config → Stats → Watch feeds, worked out on the server:
// the figures of the last 7 days, items per day over the chosen period, each
// feed, how the polls went this week, and when one feed publishes.
func (h *Handlers) GetFeedStats(w http.ResponseWriter, r *http.Request) {
	days := 30
	switch r.URL.Query().Get("days") {
	case "7":
		days = 7
	case "14":
		days = 14
	case "90":
		days = 90
	}
	enabled, keep := h.feedStatsSettings()
	feedStatsMu.Lock()
	stats := readFeedStatsFile()
	feedStatsMu.Unlock()
	feedWatchMu.Lock()
	watches := readFeedWatchFile()
	feedWatchMu.Unlock()
	bookmarks := h.store.GetAllBookmarks()
	now := feedStatsNow()

	names := map[string]string{}
	for _, b := range bookmarks {
		if key := canonicalBookmarkURLKey(b.URL); key != "" {
			if _, ok := names[key]; !ok {
				names[key] = b.Name
			}
		}
	}
	readAt := watchReadAt(watches, bookmarks)
	period := feedStatsDays(now, days)
	week := feedStatsDays(now, 7)
	sum := func(id string, dates []string, pick func(*FeedStatsDay) int) int {
		feed := stats.Feeds[id]
		if feed == nil {
			return 0
		}
		n := 0
		for _, d := range dates {
			if row := feed.Days[d]; row != nil {
				n += pick(row)
			}
		}
		return n
	}
	pub := func(d *FeedStatsDay) int { return d.Published }
	rd := func(d *FeedStatsDay) int { return d.Read }
	fail := func(d *FeedStatsDay) int { return d.Failed }

	daily := make([]feedStatsDaily, 0, days)
	for _, d := range period {
		row := feedStatsDaily{Date: d}
		for _, feed := range stats.Feeds {
			if v := feed.Days[d]; v != nil {
				row.Published += v.Published
				row.Read += v.Read
			}
		}
		daily = append(daily, row)
	}

	type weeklyRow struct {
		Week      string `json:"week"`
		Published int    `json:"published"`
		Read      int    `json:"read"`
	}
	weeklyBy := map[string]*weeklyRow{}
	firstWeek := feedStatsWeekOf(period[0])
	for _, feed := range stats.Feeds {
		for wk, v := range feed.Weeks {
			if wk < firstWeek {
				continue
			}
			row := weeklyBy[wk]
			if row == nil {
				row = &weeklyRow{Week: wk}
				weeklyBy[wk] = row
			}
			row.Published += v.Published
			row.Read += v.Read
		}
	}
	weekly := make([]weeklyRow, 0, len(weeklyBy))
	for _, row := range weeklyBy {
		weekly = append(weekly, *row)
	}
	sort.Slice(weekly, func(i, j int) bool { return weekly[i].Week < weekly[j].Week })

	live := map[string]bool{}
	for _, b := range bookmarks {
		live[canonicalBookmarkURLKey(b.URL)] = true
	}
	feeds := []feedStatsRow{}
	health := []feedStatsHealthRow{}
	var weekPub, weekRead, weekFailed, unreadNow int
	busiest := map[string]any{"name": "", "published": 0}
	busiestN := -1
	for _, wt := range watches.Watches {
		if !live[wt.BookmarkKey] {
			continue
		}
		id := feedStatsID(wt.BookmarkKey, wt.FeedURL)
		name := names[wt.BookmarkKey]
		if name == "" {
			name = hostOf(wt.BookmarkKey)
		}
		failedWeek := sum(id, week, fail)
		state := feedStatsState(wt, failedWeek)
		unread := len(watchNewItems(wt, readAt[wt.BookmarkKey]))
		unreadNow += unread
		p, rr := sum(id, period, pub), sum(id, period, rd)
		row := feedStatsRow{
			BookmarkKey: wt.BookmarkKey, FeedURL: wt.FeedURL, Name: name, Title: wt.Title,
			Published: p, Read: rr, ReadPct: readPct(rr, p), State: state, Unread: unread,
		}
		for _, list := range [][]FeedItem{wt.Items, wt.Recent} {
			for _, it := range list {
				if at := itemStamp(it); at > row.LastItemAt {
					row.LastItemAt = at
				}
			}
		}
		if feed := stats.Feeds[id]; feed != nil {
			for _, day := range feed.Hours {
				for _, n := range day {
					row.HourTotal += n
				}
			}
		}
		feeds = append(feeds, row)

		wp := sum(id, week, pub)
		weekPub += wp
		weekRead += sum(id, week, rd)
		weekFailed += failedWeek
		if wp > busiestN {
			busiestN = wp
			busiest = map[string]any{"name": name, "title": wt.Title, "bookmarkKey": wt.BookmarkKey, "feedUrl": wt.FeedURL, "published": wp}
		}

		hr := feedStatsHealthRow{BookmarkKey: wt.BookmarkKey, FeedURL: wt.FeedURL, Name: name, Title: wt.Title,
			Codes: map[string]int{}, Failed: failedWeek, State: state}
		var msSum int64
		var msN int
		if feed := stats.Feeds[id]; feed != nil {
			for _, d := range week {
				v := feed.Days[d]
				if v == nil {
					continue
				}
				hr.OK += v.OK
				msSum += v.MsSum
				msN += v.MsCount
				for code, n := range v.Codes {
					hr.Codes[code] += n
				}
			}
		}
		if msN > 0 {
			hr.AvgMs = msSum / int64(msN)
		}
		health = append(health, hr)
	}
	if busiestN <= 0 {
		busiest = map[string]any{"name": "", "published": 0}
	}
	var push, hooks, targets int
	for _, d := range week {
		if g := stats.Days[d]; g != nil {
			push += g.Push
			hooks += g.Webhooks
			targets += g.Targets
		}
	}

	// The hour matrix of the feed asked for, else of the one with the most.
	want := r.URL.Query().Get("feed")
	hourID, hourLabel, hourTotal := "", "", -1
	for _, row := range feeds {
		id := feedStatsID(row.BookmarkKey, row.FeedURL)
		if (want != "" && id == want) || (want == "" && row.HourTotal > hourTotal) {
			hourID, hourTotal = id, row.HourTotal
			hourLabel = row.Name
			if want != "" {
				break
			}
		}
	}
	matrix := [7][24]int{}
	if feed := stats.Feeds[hourID]; feed != nil {
		matrix = feed.Hours
	}
	if hourTotal < 0 {
		hourTotal = 0
	}

	writeWatchJSON(w, http.StatusOK, map[string]any{
		"enabled":  enabled,
		"keepDays": keep,
		"since":    stats.Since,
		"days":     days,
		"totals": map[string]any{
			"feeds": len(feeds), "published": weekPub, "read": weekRead, "readPct": readPct(weekRead, weekPub),
			"unreadNow": unreadNow, "failed": weekFailed, "busiest": busiest,
		},
		"daily":  daily,
		"weekly": weekly,
		"feeds":  feeds,
		"health": map[string]any{"byFeed": health, "push": push, "webhooks": hooks, "targets": targets},
		"hours":  map[string]any{"feed": hourID, "feedLabel": hourLabel, "total": hourTotal, "matrix": matrix},
	})
}

// ResetFeedStats forgets every number and starts counting again from now.
func (h *Handlers) ResetFeedStats(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<10)
	feedStatsMu.Lock()
	err := writeFeedStatsFile(FeedStatsFile{Since: feedStatsNow().UnixMilli(), Feeds: map[string]*FeedStatsFeed{}})
	feedStatsMu.Unlock()
	if err != nil {
		logWarn(logComponentFeeds, "feed statistics could not be reset: %v", err)
		http.Error(w, "could not reset", http.StatusInternalServerError)
		return
	}
	writeWatchJSON(w, http.StatusOK, map[string]any{"reset": true})
}
