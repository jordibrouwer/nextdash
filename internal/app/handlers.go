package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"html/template"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
)

type Handlers struct {
	store             Store
	files             assetFS
	pageTemplates     map[string]*template.Template
	pageTemplatesMu   sync.RWMutex
	previewCacheMu    sync.RWMutex
	previewCache      PreviewCacheFile
	previewLoaded     bool
	previewCacheDirty bool
	healthCacheMu     sync.RWMutex
	healthHistoryMu   sync.Mutex
	healthTrendMu     sync.Mutex
	healthReportMu    sync.RWMutex
	healthReport      BookmarkHealthReport
	healthReportAt    time.Time
	healthReportOK    bool
	// healthReportGen is the store's write count when this report was built.
	// A cached report whose generation no longer matches describes bookmarks
	// that have since changed, however recently it was built.
	healthReportGen       uint64
	healthReportBuildMu   sync.Mutex
	healthReportBuildCond *sync.Cond
	// Built once, whoever gets there first. NewHandlers sets it, and a Handlers
	// assembled by hand -- which several tests do -- would otherwise reach
	// loadBookmarkHealthReport with a nil Cond and race two goroutines into
	// building one each: a Wait on one and a Broadcast on the other never meet,
	// and the waiter never wakes.
	healthReportCondOnce sync.Once
	healthReportBuilding bool
	prefetchMu           sync.Mutex
	autoBackupMu         sync.Mutex
	ssrfAPILimiter       *slidingWindowLimiter
	statusPingLimiter    *slidingWindowLimiter
	updateCheckMu        sync.RWMutex
	updateCheckCache     updateCheckCacheEntry
}

const healthReportCacheTTL = 3 * time.Minute

const previewCacheTTLMs = int64(7 * 24 * 60 * 60 * 1000) // 7 days in ms

func normalizeShortcut(shortcut string) string {
	return strings.ToUpper(strings.TrimSpace(shortcut))
}

func respondStorePersistError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	http.Error(w, "Failed to save data", http.StatusInternalServerError)
	return false
}

func (h *Handlers) pageExists(pageID int) bool {
	for _, page := range h.store.GetPages() {
		if page.ID == pageID {
			return true
		}
	}
	return false
}

func respondBookmarkMutationError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, ErrBookmarkNotFound) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return false
	}
	if errors.Is(err, ErrBookmarkChanged) {
		http.Error(w, "Bookmark has changed; reload the health report", http.StatusConflict)
		return false
	}
	return respondStorePersistError(w, err)
}

func respondCategoriesSaveError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, ErrCategoriesStillReferenced) {
		http.Error(w, "Bookmarks on this page still reference a category; move or delete them first", http.StatusConflict)
		return false
	}
	return respondStorePersistError(w, err)
}

func isDefaultURLPort(scheme, port string) bool {
	switch scheme {
	case "https":
		return port == "443"
	case "http":
		return port == "80"
	default:
		return false
	}
}

func canonicalURLHost(u *url.URL, scheme string) string {
	hostname := strings.ToLower(u.Hostname())
	port := u.Port()
	if port == "" || isDefaultURLPort(scheme, port) {
		return hostname
	}
	if strings.Contains(hostname, ":") {
		return "[" + hostname + "]:" + port
	}
	return hostname + ":" + port
}

// canonicalBookmarkURLKey normalizes URLs so obvious duplicates (trailing slash, hash, case, default ports) match.
func canonicalBookmarkURLKey(raw string) string {
	s := strings.TrimSpace(raw)
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		fallback := strings.ToLower(s)
		if i := strings.Index(fallback, "#"); i >= 0 {
			fallback = fallback[:i]
		}
		return strings.TrimSuffix(fallback, "/")
	}
	u.Fragment = ""
	u.RawFragment = ""
	scheme := strings.ToLower(u.Scheme)
	host := canonicalURLHost(u, scheme)
	path := u.EscapedPath()
	if path == "/" {
		path = ""
	} else {
		path = strings.TrimSuffix(path, "/")
	}
	if u.RawQuery != "" {
		return scheme + "://" + host + path + "?" + u.RawQuery
	}
	return scheme + "://" + host + path
}

// findBookmarkByURL returns the first bookmark matching url's canonical key, so
// a one-off check (manual re-check, promote-from-inbox) can honor that
// bookmark's own expectations instead of always falling back to the default
// reachability rule. Zero value when the URL is not bookmarked yet.
func (h *Handlers) findBookmarkByURL(url string) (Bookmark, bool) {
	key := canonicalBookmarkURLKey(url)
	if key == "" {
		return Bookmark{}, false
	}
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if canonicalBookmarkURLKey(bm.URL) == key {
				return bm, true
			}
		}
	}
	return Bookmark{}, false
}

func findDuplicateShortcutInList(bookmarks []Bookmark) string {
	seen := make(map[string]struct{})
	for _, bookmark := range bookmarks {
		shortcut := normalizeShortcut(bookmark.Shortcut)
		if shortcut == "" {
			continue
		}
		if _, exists := seen[shortcut]; exists {
			return shortcut
		}
		seen[shortcut] = struct{}{}
	}
	return ""
}

func findShortcutConflictWithExisting(bookmarks []Bookmark, shortcut string) *Bookmark {
	normalized := normalizeShortcut(shortcut)
	if normalized == "" {
		return nil
	}
	for i := range bookmarks {
		if normalizeShortcut(bookmarks[i].Shortcut) == normalized {
			return &bookmarks[i]
		}
	}
	return nil
}

// pageTemplateFuncs are available to every page template. `asset` turns a
// static-relative path into a content-hashed URL, so templates never carry a
// hand-written cache-bust token.
var pageTemplateFuncs = template.FuncMap{
	"asset":      assetURL,
	"lazyAssets": lazyAssetMapJSON,
}

// pageTemplateFuncsFor adds the funcs that need the store. The theme block is
// generated from colors.json, so it cannot be a package-level function — and it
// is inlined rather than linked because /api/theme.css is served no-store: as a
// link it was an uncacheable blocking request before every first paint.
func (h *Handlers) pageTemplateFuncsFor() template.FuncMap {
	funcs := template.FuncMap{}
	for k, v := range pageTemplateFuncs {
		funcs[k] = v
	}
	funcs["themeCSS"] = func() template.CSS {
		return template.CSS(h.customThemeCSS())
	}
	return funcs
}

func (h *Handlers) parsePageTemplates(templateFiles ...string) (*template.Template, error) {
	key := strings.Join(templateFiles, "|")

	h.pageTemplatesMu.RLock()
	if h.pageTemplates != nil {
		if tmpl, ok := h.pageTemplates[key]; ok {
			h.pageTemplatesMu.RUnlock()
			return tmpl, nil
		}
	}
	h.pageTemplatesMu.RUnlock()

	var tmpl *template.Template
	var err error
	// A single template is read as source so the bundle markers can be folded
	// out before parsing — see applyAssetBundles. Anything else is parsed the
	// way it always was.
	if len(templateFiles) == 1 {
		source := readTemplateSource(h.files, templateFiles[0])
		if source != "" {
			name := path.Base(templateFiles[0])
			tmpl, err = template.New(name).Funcs(h.pageTemplateFuncsFor()).Parse(applyAssetBundles(h.files, source))
		}
	}
	if tmpl == nil && err == nil {
		if info, statErr := os.Stat("templates"); statErr == nil && info.IsDir() {
			diskFiles := make([]string, len(templateFiles))
			for i, name := range templateFiles {
				diskFiles[i] = filepath.FromSlash(name)
			}
			name := filepath.Base(diskFiles[0])
			tmpl, err = template.New(name).Funcs(h.pageTemplateFuncsFor()).ParseFiles(diskFiles...)
		} else {
			name := path.Base(templateFiles[0])
			tmpl, err = template.New(name).Funcs(h.pageTemplateFuncsFor()).ParseFS(h.files, templateFiles...)
		}
	}
	if err != nil {
		return nil, err
	}

	h.pageTemplatesMu.Lock()
	if h.pageTemplates == nil {
		h.pageTemplates = make(map[string]*template.Template)
	}
	if cached, ok := h.pageTemplates[key]; ok {
		h.pageTemplatesMu.Unlock()
		return cached, nil
	}
	h.pageTemplates[key] = tmpl
	h.pageTemplatesMu.Unlock()
	return tmpl, nil
}

func (h *Handlers) FlushCaches() {
	h.previewCacheMu.Lock()
	defer h.previewCacheMu.Unlock()
	_ = h.flushPreviewCacheLocked()
}

func NewHandlers(store Store, files assetFS) *Handlers {
	h := &Handlers{
		store:             store,
		files:             files,
		ssrfAPILimiter:    newSlidingWindowLimiter(ssrfAPIRequestsPerMinute(), time.Minute),
		statusPingLimiter: newSlidingWindowLimiter(statusPingRequestsPerMinute(), time.Minute),
	}
	h.ensureHealthReportCond()
	if store.TakeDefaultBookmarkIconPrefetch() {
		h.startDefaultBookmarkIconPrefetch()
	}
	// Existing inbox items predate icon storage; fetch their favicons once so the
	// inbox shows real site icons like the health view, not just link glyphs.
	h.backfillInboxIconsAsync()
	return h
}

func (h *Handlers) HealthPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	target := url.Values{}

	if filter := strings.TrimSpace(q.Get("filter")); filter != "" {
		target.Set("hv_filter", strings.ToLower(filter))
	}
	if search := strings.TrimSpace(q.Get("q")); search != "" {
		target.Set("hv_q", search)
	}
	if sort := strings.TrimSpace(q.Get("sort")); sort != "" {
		target.Set("hv_sort", sort)
	}
	if refresh := strings.TrimSpace(q.Get("refresh")); refresh == "1" || strings.EqualFold(refresh, "true") {
		target.Set("hv_refresh", "1")
	}
	if page := strings.TrimSpace(q.Get("page")); page != "" && !strings.EqualFold(page, "all") {
		target.Set("page", page)
	}
	// Legacy deep links used ?id=pageId:index before hv_id existed.
	if id := strings.TrimSpace(q.Get("id")); id != "" {
		target.Set("hv_id", id)
	}

	redirectURL := "/#health"
	if encoded := target.Encode(); encoded != "" {
		redirectURL = "/?" + encoded + "#health"
	}

	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (h *Handlers) GetBookmarkHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	refresh := r.URL.Query().Get("refresh")
	forceRefresh := refresh == "1" || refresh == "true"
	report := h.loadBookmarkHealthReport(forceRefresh)

	w.WriteHeader(http.StatusOK)
	// `view=facts` is the counts plus the bookmarks that have something to
	// report — what the health badge and the preview card actually read. The
	// full report is a row per bookmark and grows with the collection; only the
	// health view draws that.
	if r.URL.Query().Get("view") == "facts" {
		json.NewEncoder(w).Encode(buildHealthFactsReport(report))
		return
	}
	json.NewEncoder(w).Encode(report)
}

/*
healthReportFresh reports whether the cached report still describes the data.

Two conditions, and the second is the one that was missing. The three-minute
window bounds how long a report may be reused when nothing has happened; the
generation bounds it by whether anything has. Time alone meant that adding a
broken bookmark left the header badge and the health widget quoting figures
from before it existed, for up to three minutes -- and a dozen write paths each
had to remember to say so, which the one that adds a bookmark did not.

Called with healthReportMu held for reading.
*/
func (h *Handlers) healthReportFreshLocked() bool {
	if !h.healthReportOK || time.Since(h.healthReportAt) >= healthReportCacheTTL {
		return false
	}
	return h.healthReportGen == h.store.DataGeneration()
}

func (h *Handlers) ensureHealthReportCond() {
	h.healthReportCondOnce.Do(func() {
		h.healthReportBuildCond = sync.NewCond(&h.healthReportBuildMu)
	})
}

func (h *Handlers) loadBookmarkHealthReport(forceRefresh bool) BookmarkHealthReport {
	h.ensureHealthReportCond()
	if !forceRefresh {
		h.healthReportMu.RLock()
		if h.healthReportFreshLocked() {
			report := h.healthReport
			h.healthReportMu.RUnlock()
			return report
		}
		h.healthReportMu.RUnlock()
	}

	h.healthReportBuildMu.Lock()
	for h.healthReportBuilding {
		h.healthReportBuildCond.Wait()
		if !forceRefresh {
			h.healthReportMu.RLock()
			cached := h.healthReportFreshLocked()
			var report BookmarkHealthReport
			if cached {
				report = h.healthReport
			}
			h.healthReportMu.RUnlock()
			if cached {
				h.healthReportBuildMu.Unlock()
				return report
			}
		}
	}
	h.healthReportBuilding = true
	h.healthReportBuildMu.Unlock()

	report := h.buildBookmarkHealthReport()

	/*
		Read after the build, and it has to be.

		Reading is not free of writing here: walking the pages settles the page
		order file if it was not already settled, so a build bumps the store's
		count by itself. Stamped with the count from before, every report would
		be born stale and each request would rebuild the lot -- which is the
		opposite of what a cache is for, and measurably worse than the staleness
		this was meant to fix.

		What that costs is a write landing during a build: it is not in the
		report, and the stamp says it is, so it goes unseen until the three
		minutes are up. A build is milliseconds against a window of minutes, and
		the write paths that invalidate by hand still do. The alternative is no
		cache at all.
	*/
	generation := h.store.DataGeneration()

	h.healthReportMu.Lock()
	h.healthReport = report
	h.healthReportOK = true
	h.healthReportAt = time.Now()
	h.healthReportGen = generation
	h.healthReportMu.Unlock()

	h.healthReportBuildMu.Lock()
	h.healthReportBuilding = false
	h.healthReportBuildCond.Broadcast()
	h.healthReportBuildMu.Unlock()

	// After the waiters are released, not before: recording touches the disk and
	// holding the build flag across it would make every concurrent reader wait on
	// a write none of them need.
	h.recordHealthTrend(report)

	return report
}

func (h *Handlers) invalidateHealthReportCache() {
	h.healthReportMu.Lock()
	h.healthReportOK = false
	h.healthReportMu.Unlock()
	// The analytics counts are drawn from the same files and go stale for the
	// same reasons, so they ride along with the report rather than growing a
	// second set of call sites to keep in step.
	invalidateAnalyticsContentCache()
}

func healthReasonLegacyLabel(r HealthReason) string {
	switch r.Code {
	case "duplicate_url":
		if n := r.Params["count"]; n != "" {
			return fmt.Sprintf("Duplicate URL in %s bookmarks", n)
		}
	case "shortcut_conflict":
		if n := r.Params["count"]; n != "" {
			return fmt.Sprintf("Shortcut conflict with %s bookmarks", n)
		}
	case "orphaned_category":
		if c := r.Params["category"]; c != "" {
			return fmt.Sprintf("Category %q no longer exists", c)
		}
		return "Category no longer exists"
	case "status_never_run":
		return "Status check has never run"
	case "status_stale":
		return "Status check is stale"
	case "not_opened_30_days":
		return "Not opened in over 30 days"
	case "never_opened":
		return "Never opened"
	case "no_preview":
		return "No preview metadata yet"
	case "unreachable":
		return "Unreachable"
	case "last_error":
		if d := strings.TrimSpace(r.Detail); d != "" {
			return d
		}
	}
	if d := strings.TrimSpace(r.Detail); d != "" {
		return d
	}
	return r.Code
}

// Score deductions, worst first. A bookmark starts at 100 and each reason that
// applies subtracts its penalty. These are the single source of truth: the value
// travels to the client on each reason, so the score breakdown in the UI cannot
// drift from the arithmetic here.
const (
	healthPenaltyBroken           = 60
	healthPenaltyDuplicate        = 15
	healthPenaltyShortcutConflict = 15
	// Same weight as the other data-integrity faults: the bookmark still works,
	// but it has fallen out of the category structure the user organised it into.
	healthPenaltyOrphanedCategory = 15
	healthPenaltyNeverChecked     = 10
	// Usage is not a defect. A link you have never opened is not broken, and the
	// health view's own advice is to open it and see — an action that used to
	// improve the row's score by 10 and, under the default worst-first sort, drop
	// it hundreds of places down the list the user was working through. Both stay
	// as flags, tiles, filters and reasons; neither costs a point.
	healthPenaltyNotOpened30Days = 0
	healthPenaltyNeverOpened     = 0
	healthPenaltyStaleCheck      = 5
	healthPenaltyNoPreview       = 5
)

func appendHealthReason(details *[]HealthReason, legacy *[]string, reason HealthReason) {
	*details = append(*details, reason)
	*legacy = append(*legacy, healthReasonLegacyLabel(reason))
}

func (h *Handlers) buildBookmarkHealthReport() BookmarkHealthReport {
	// The unsorted page is left out of the report entirely.
	//
	// Health is about the library as it stands on the dashboard: what is
	// broken, what is stale, what has no category. A bookmark kept from the
	// inbox has not been filed yet -- it has no category by definition, it is
	// never "unused" in the sense the report means, and it belongs to a page
	// nothing on the dashboard routes to. Counting them buried the real report
	// under rows nobody could act on from there.
	pages := make([]Page, 0)
	for _, page := range h.store.GetPages() {
		if page.ID == unsortedPageID {
			continue
		}
		pages = append(pages, page)
	}
	pageNames := make(map[int]string, len(pages))
	for _, page := range pages {
		pageNames[page.ID] = page.Name
	}

	type bookmarkEntry struct {
		bookmark Bookmark
		index    int
	}

	bookmarksByPage := make(map[int][]bookmarkEntry, len(pages))
	duplicateRefs := make(map[string][]BookmarkRef)
	duplicateCounts := make(map[string]int)
	shortcutCounts := make(map[string]int)
	// Valid category ids per page, read once per page rather than once per
	// bookmark. Bookmark.Category holds a category id, so a bookmark whose id is
	// absent here points at a category that was deleted out from under it —
	// deleting one category from a non-empty list is allowed and deliberately
	// leaves its bookmarks behind (see SaveCategoriesByPage), and the
	// rebuild-from-refs recovery only fires when the list is entirely empty, so
	// nothing heals these on read.
	categoryIDsByPage := make(map[int]map[string]struct{}, len(pages))

	// One read serves every monitored row; buildMonitorStats derives the rest.
	monitorHistory := h.readAllHealthHistory()
	monitorDays := h.readAllHealthDays()
	monitorNow := time.Now()
	// Gathered while walking the bookmarks so the collection-wide view is built
	// from the same samples, in the same pass.
	var fleetInputs []fleetMonitorInput

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		categories := h.store.GetCategoriesByPage(page.ID)
		validCategoryIDs := make(map[string]struct{}, len(categories))
		for _, category := range categories {
			if id := strings.TrimSpace(category.ID); id != "" {
				validCategoryIDs[id] = struct{}{}
			}
		}
		categoryIDsByPage[page.ID] = validCategoryIDs
		entries := make([]bookmarkEntry, 0, len(bookmarks))
		for idx, bm := range bookmarks {
			entry := bookmarkEntry{bookmark: bm, index: idx}
			entries = append(entries, entry)

			key := canonicalBookmarkURLKey(bm.URL)
			if key != "" {
				duplicateCounts[key]++
				duplicateRefs[key] = append(duplicateRefs[key], BookmarkRef{
					Name:      bm.Name,
					Index:     idx,
					PageID:    page.ID,
					Category:  bm.Category,
					OpenCount: bm.OpenCount,
					Pinned:    bm.Pinned,
					CreatedAt: bm.CreatedAt,
				})
			}

			shortcut := normalizeShortcut(bm.Shortcut)
			if shortcut != "" {
				shortcutCounts[shortcut]++
			}
		}
		bookmarksByPage[page.ID] = entries
	}

	report := BookmarkHealthReport{
		GeneratedAt: time.Now().UnixMilli(),
	}

	issueRank := func(status string) int {
		switch status {
		case "broken":
			return 0
		case "content":
			return 1
		case "duplicate":
			return 2
		case "shortcut-conflict":
			return 3
		case "orphaned-category":
			return 4
		case "unchecked":
			return 5
		case "stale":
			return 6
		case "unused":
			return 7
		case "missing-preview":
			return 7
		default:
			return 8
		}
	}

	missingPreview := func(bm Bookmark) bool {
		return strings.TrimSpace(bm.PreviewTitle) == "" && strings.TrimSpace(bm.PreviewDesc) == "" && strings.TrimSpace(bm.PreviewImage) == ""
	}

	// One directory read for the whole report: asking per row whether a copy
	// exists would be a round trip each to draw one screen.
	localCopies := localCopyIndex()

	for _, page := range pages {
		for _, entry := range bookmarksByPage[page.ID] {
			bm := entry.bookmark
			key := canonicalBookmarkURLKey(bm.URL)
			duplicateCount := duplicateCounts[key]
			isDuplicate := duplicateCount > 1
			isBroken := strings.TrimSpace(bm.LastError) != ""
			// Monitoring is the heavier form of the same thing, so it counts as
			// "checked" for scoring. Without this, switching a bookmark from
			// periodic to monitored would flag it as never-checked while it is in
			// fact being checked far more often.
			isChecked := bm.CheckStatus || bm.Monitor
			isUnchecked := isChecked && bm.LastChecked == 0
			// A monitor is stale relative to its own cadence, not the weekly bar a
			// once-a-day check is held to: a 5-minute monitor silent for a day is
			// already broken, while a weekly threshold would call it fine.
			staleAfter := 7 * 24 * time.Hour
			if bm.Monitor {
				if missed := time.Duration(clampMonitorIntervalMinutes(bm.MonitorIntervalMinutes)) * time.Minute * 3; missed < staleAfter {
					staleAfter = missed
				}
			}
			isStaleCheck := isChecked && bm.LastChecked > 0 && time.Since(time.UnixMilli(bm.LastChecked)) > staleAfter
			isUnused := bm.OpenCount == 0 && bm.LastOpened == 0
			isStale := bm.OpenCount > 0 && bm.LastOpened > 0 && time.Since(time.UnixMilli(bm.LastOpened)) > 30*24*time.Hour
			isMissingPreview := missingPreview(bm)
			shortcutKey := normalizeShortcut(bm.Shortcut)
			isShortcutConflict := shortcutKey != "" && shortcutCounts[shortcutKey] > 1
			// An empty category is "uncategorized", a legitimate state — only a
			// non-empty id that matches no category on the page is orphaned.
			categoryKey := strings.TrimSpace(bm.Category)
			isOrphanedCategory := false
			if categoryKey != "" {
				_, known := categoryIDsByPage[page.ID][categoryKey]
				isOrphanedCategory = !known
			}
			isDrifting := bm.Monitor && bm.WatchDrift && strings.TrimSpace(bm.DriftNoticed) != ""

			/*
			 * Conditions this bookmark has been told to stop reporting.
			 *
			 * Applied here, before the blocks below, rather than filtered out of
			 * the finished issue: status, flags, score and the summary counters
			 * are all built from these booleans in one pass, and that is what
			 * keeps a tile from disagreeing with the filter of the same name. A
			 * condition that is ignored has to be false everywhere at once, so
			 * this is the only place it can be turned off.
			 *
			 * What was hidden is kept, because the Ignored list has to be able
			 * to say what it is hiding and offer it back.
			 */
			ignores := healthIgnoreSet(bm.HealthIgnored, time.Now())
			hidden := make([]HealthIgnore, 0, len(ignores))
			suppress := func(flag string, holds bool) bool {
				if !holds {
					return false
				}
				entry, muted := ignores[flag]
				if !muted {
					return true
				}
				hidden = append(hidden, entry)
				return false
			}
			// Broken splits two ways before it is suppressed: a host that
			// answered with the wrong content is a different condition, and a
			// reader who ignored one has not ignored the other.
			if isBroken {
				if isContentFailure(strings.TrimSpace(bm.LastError)) {
					isBroken = suppress("content", true)
				} else {
					isBroken = suppress("broken", true)
				}
			}
			isDuplicate = suppress("duplicate", isDuplicate)
			isShortcutConflict = suppress("shortcut-conflict", isShortcutConflict)
			isOrphanedCategory = suppress("orphaned-category", isOrphanedCategory)
			// Never run and overdue share a flag, so they share the switch.
			if entry, muted := ignores["unchecked"]; muted && (isUnchecked || isStaleCheck) {
				hidden = append(hidden, entry)
				isUnchecked = false
				isStaleCheck = false
			}
			isStale = suppress("stale", isStale)
			isUnused = suppress("unused", isUnused)
			isMissingPreview = suppress("missing-preview", isMissingPreview)
			isDrifting = suppress("drift", isDrifting)
			sort.Slice(hidden, func(i, j int) bool { return hidden[i].Flag < hidden[j].Flag })

			status := "healthy"
			// Every condition that holds, in the same priority order as status.
			// status keeps only the first; flags keep them all, and the summary
			// counters below are incremented from the same conditions — so the
			// tiles and the filters can never disagree about a bookmark.
			flags := make([]string, 0, 4)
			reasons := make([]string, 0, 4)
			reasonDetails := make([]HealthReason, 0, 4)
			score := 100

			if isBroken {
				detail := strings.TrimSpace(bm.LastError)
				// A host that answered with the wrong content is a different
				// problem from one that did not answer, and showing both as
				// "broken" hides which of the two you are looking at.
				if isContentFailure(detail) {
					status = "content"
					flags = append(flags, "content")
					appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "content_mismatch", Detail: detail, Penalty: healthPenaltyBroken})
				} else {
					status = "broken"
					flags = append(flags, "broken")
					if detail != "" {
						appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "last_error", Detail: detail, Penalty: healthPenaltyBroken})
					} else {
						appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "unreachable", Penalty: healthPenaltyBroken})
					}
				}
				score -= healthPenaltyBroken
			}
			if isDuplicate {
				if status == "healthy" {
					status = "duplicate"
				}
				flags = append(flags, "duplicate")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{
					Code:    "duplicate_url",
					Params:  map[string]string{"count": strconv.Itoa(duplicateCount)},
					Penalty: healthPenaltyDuplicate,
				})
				score -= healthPenaltyDuplicate
			}
			if isShortcutConflict {
				if status == "healthy" {
					status = "shortcut-conflict"
				}
				flags = append(flags, "shortcut-conflict")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{
					Code:    "shortcut_conflict",
					Params:  map[string]string{"count": strconv.Itoa(shortcutCounts[shortcutKey])},
					Penalty: healthPenaltyShortcutConflict,
				})
				score -= healthPenaltyShortcutConflict
			}
			if isOrphanedCategory {
				if status == "healthy" {
					status = "orphaned-category"
				}
				flags = append(flags, "orphaned-category")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{
					Code:    "orphaned_category",
					Params:  map[string]string{"category": categoryKey},
					Penalty: healthPenaltyOrphanedCategory,
				})
				score -= healthPenaltyOrphanedCategory
			}
			// Never run and overdue are two ways of being "unchecked" and share the
			// status, so they share the flag too — matching UncheckedCount, which
			// is incremented for either.
			if isUnchecked {
				if status == "healthy" {
					status = "unchecked"
				}
				flags = append(flags, "unchecked")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "status_never_run", Penalty: healthPenaltyNeverChecked})
				score -= healthPenaltyNeverChecked
			} else if isStaleCheck {
				if status == "healthy" {
					status = "unchecked"
				}
				flags = append(flags, "unchecked")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "status_stale", Penalty: healthPenaltyStaleCheck})
				score -= healthPenaltyStaleCheck
			}
			// Status and flags still record it — the Stale and Unused tiles and
			// filters are how a tidy-up starts — but the score is left alone, so
			// opening the bookmark does not re-rank the list around it.
			if isStale {
				if status == "healthy" {
					status = "stale"
				}
				flags = append(flags, "stale")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "not_opened_30_days", Penalty: healthPenaltyNotOpened30Days})
			}
			if isUnused {
				if status == "healthy" {
					status = "unused"
				}
				flags = append(flags, "unused")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "never_opened", Penalty: healthPenaltyNeverOpened})
			}
			if isMissingPreview {
				if status == "healthy" {
					status = "missing-preview"
				}
				flags = append(flags, "missing-preview")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "no_preview", Penalty: healthPenaltyNoPreview})
				score -= healthPenaltyNoPreview
			}
			// Drift is a rot signal, not a hard failure: the bookmark still answers,
			// so it keeps whatever status it already has and pays no score penalty.
			// It only adds a flag, the same way "unused" layers onto "broken" — a
			// bookmark that is both must be findable under either filter.
			if isDrifting {
				flags = append(flags, "drift")
			}

			if score < 0 {
				score = 0
			}

			report.Summary.TotalBookmarks++
			if bm.Pinned {
				report.Summary.PinnedCount++
			}
			if bm.Monitor {
				report.Summary.MonitoredCount++
			}
			if isBroken {
				// A monitored bookmark that is down counts as a live outage, not
				// an ordinary broken link — kept out of BrokenCount so the two can
				// be told apart in the header and never double-counted. A content
				// failure is a third case: the host answered, so it is neither.
				switch {
				case isContentFailure(strings.TrimSpace(bm.LastError)):
					report.Summary.ContentCount++
				case bm.Monitor:
					report.Summary.MonitorDownCount++
				default:
					report.Summary.BrokenCount++
				}
			}
			if isDuplicate {
				report.Summary.DuplicateCount++
			}
			if isShortcutConflict {
				report.Summary.ShortcutConflictCount++
			}
			if isOrphanedCategory {
				report.Summary.OrphanedCategoryCount++
			}
			if isChecked && (isUnchecked || isStaleCheck) {
				report.Summary.UncheckedCount++
			}
			if isStale {
				report.Summary.StaleCount++
			}
			if isMissingPreview {
				report.Summary.MissingPreviewCount++
			}
			if isUnused {
				report.Summary.UnusedCount++
			}
			if isDrifting {
				report.Summary.DriftCount++
			}
			/*
			 * Healthy is a statement about the link, not about the tidiness of
			 * the row.
			 *
			 * It used to mean "no other condition held at all", so a link that
			 * answered perfectly was not healthy while it was also never opened,
			 * had no preview yet, sat in a renamed category or shared a URL with
			 * another row. On a fresh install that is every bookmark, which is
			 * why the health widget on a new dashboard read 0 broken, 0 down,
			 * 0 content and 0 healthy — four zeroes about eight working links.
			 *
			 * It is now the absence of the thing the three counters beside it
			 * report: nothing known to be wrong with the link. Those four are
			 * what the health widget and the statistics panel present together,
			 * and a reader takes the fourth as "and these are fine".
			 *
			 * Not "checked and answered" — a bookmark with checking switched off
			 * is not being claimed as broken either, and
			 * TestHealthyFlagIsExclusive has said since it was written that a
			 * quiet, unchecked, opened bookmark is healthy. Verified is a
			 * different question, and UncheckedCount is the counter that asks it.
			 *
			 * Housekeeping keeps its own counters — UnusedCount,
			 * MissingPreviewCount, StaleCount, DuplicateCount and the rest — so
			 * nothing stops being reported; it stops being reported as ill
			 * health. `status` is untouched, so the Health view still groups a
			 * never-opened bookmark under Unused. The flag moves with the
			 * counter, because a tile whose number cannot be found by the filter
			 * of the same name is the one thing this loop is built to prevent.
			 */
			/*
			 * A hidden failure is not a healthy link.
			 *
			 * Ignoring "stale" says the bookmark is allowed to sit unopened, and
			 * such a bookmark is still healthy — nothing about the link is
			 * wrong. Ignoring "broken" says nothing of the sort: it says do not
			 * tell me. Counting that as healthy would inflate the one figure the
			 * reader trusts, so it counts as neither, and the Ignored tile is
			 * where it is found.
			 */
			hidFailure := false
			for _, entry := range hidden {
				if entry.Flag == "broken" || entry.Flag == "content" {
					hidFailure = true
				}
			}
			isLinkHealthy := !isBroken && !hidFailure
			if isLinkHealthy {
				report.Summary.HealthyCount++
				flags = append(flags, "healthy")
			}
			if len(hidden) > 0 {
				report.Summary.IgnoredCount++
				// Status is the worst thing that holds; with everything that held
				// now hidden, the honest answer is that this row is being ignored
				// rather than that it is fine.
				if status == "healthy" {
					status = "ignored"
				}
			}

			var monitorStats *MonitorStats
			if bm.Monitor {
				if key := canonicalBookmarkURLKey(bm.URL); key != "" {
					samples := monitorHistory[key]
					monitorStats = buildMonitorStatsWithDays(samples, monitorDays[key], bm.MonitorIntervalMinutes, monitorNow)
					// Collected here rather than re-read later: this loop already
					// resolved the canonical key and the samples are in hand, so
					// the collection-wide view costs no extra history read.
					fleetInputs = append(fleetInputs, fleetMonitorInput{
						name:    bm.Name,
						url:     bm.URL,
						samples: samples,
					})
				}
			}

			report.Issues = append(report.Issues, HealthIssue{
				Name:                   bm.Name,
				URL:                    bm.URL,
				Shortcut:               bm.Shortcut,
				Category:               bm.Category,
				PageID:                 page.ID,
				PageName:               pageNames[page.ID],
				Index:                  entry.index,
				Pinned:                 bm.Pinned,
				CheckStatus:            bm.CheckStatus,
				OpenCount:              bm.OpenCount,
				LastOpened:             bm.LastOpened,
				LastChecked:            bm.LastChecked,
				LastError:              bm.LastError,
				IgnoredFlags:           hidden,
				BrokenSince:            bm.BrokenSince,
				ArchiveDiedAt:          bm.ArchiveDiedAt,
				FailureUncertain:       failureIsUncertain(bm.LastError),
				LocalCopies:            localCopies[localArchiveSlug(bm.URL)].Count,
				LocalCopyAt:            localCopies[localArchiveSlug(bm.URL)].Newest,
				PreviewTitle:           bm.PreviewTitle,
				PreviewDesc:            bm.PreviewDesc,
				PreviewImage:           bm.PreviewImage,
				Icon:                   bm.Icon,
				Status:                 status,
				Flags:                  flags,
				Score:                  score,
				Reasons:                reasons,
				ReasonDetails:          reasonDetails,
				DuplicateCount:         duplicateCount,
				Monitor:                bm.Monitor,
				MonitorIntervalMinutes: monitorIntervalMinutesFor(bm),
				MonitorStats:           monitorStats,
				// Only for monitored rows: the checks that read these belong to
				// the monitor, and sending them for every bookmark would grow the
				// report for fields nothing would render.
				ExpectText:       expectFieldsFor(bm).Text,
				ExpectTextAbsent: bm.Monitor && bm.ExpectTextAbsent,
				ExpectStatus:     expectFieldsFor(bm).Status,
				WatchDrift:       bm.Monitor && bm.WatchDrift,
				DriftNoticed:     driftFieldsFor(bm).noticed,
				DriftReason:      driftFieldsFor(bm).reason,
				DriftSince:       driftFieldsFor(bm).since,
				// Gated on Monitor like the fields above it: only monitored
				// bookmarks ever raise an alert, so a mute on any other row
				// would render a control that governs nothing.
				NotifyMuted: bm.Monitor && bm.NotifyMuted,
				CertHost:    bm.CertHost,
				// Not gated on Monitor, unlike the block above: these say how to
				// reach the service rather than what to expect back, and every
				// check uses them.
				CheckURL:         bm.CheckURL,
				CredentialID:     bm.CredentialID,
				AllowInsecureTLS: bm.AllowInsecureTLS,
			})
		}
	}

	for key, refs := range duplicateRefs {
		if len(refs) < 2 {
			continue
		}
		sortDuplicateRefsBestFirst(refs)
		report.DuplicateGroups = append(report.DuplicateGroups, DuplicateGroup{
			URL:       key,
			Bookmarks: refs,
		})
	}

	sort.Slice(report.DuplicateGroups, func(i, j int) bool {
		if len(report.DuplicateGroups[i].Bookmarks) == len(report.DuplicateGroups[j].Bookmarks) {
			return report.DuplicateGroups[i].URL < report.DuplicateGroups[j].URL
		}
		return len(report.DuplicateGroups[i].Bookmarks) > len(report.DuplicateGroups[j].Bookmarks)
	})

	sort.Slice(report.Issues, func(i, j int) bool {
		if report.Issues[i].Score == report.Issues[j].Score {
			rankI := issueRank(report.Issues[i].Status)
			rankJ := issueRank(report.Issues[j].Status)
			if rankI == rankJ {
				if report.Issues[i].PageID == report.Issues[j].PageID {
					return report.Issues[i].Name < report.Issues[j].Name
				}
				return report.Issues[i].PageID < report.Issues[j].PageID
			}
			return rankI < rankJ
		}
		return report.Issues[i].Score < report.Issues[j].Score
	})

	report.Fleet = buildFleetStats(fleetInputs, monitorNow)
	// Read rather than recorded here: recording happens after the build so it
	// cannot make a report wait on a disk write, which means today's point is one
	// build behind. That is the right trade — the trend describes days, and the
	// current day is already on screen as the live numbers.
	report.Trend = h.readHealthTrend()
	// Only the ones worth showing. A certificate with three months left is true
	// but not news, and sending every host would grow the report by an entry per
	// domain for something the UI would immediately filter out again.
	report.Certificates = expiringCertificatesWith(h.hostCertificates(), monitorNow, certThresholdsFor(h.store.GetSettings()))

	return report
}

func (h *Handlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	tmpl, err := h.parsePageTemplates("templates/dashboard.html")
	if err != nil {
		http.Error(w, "Template parsing error", http.StatusInternalServerError)
		return
	}

	settings := h.store.GetSettings()

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, h.htmlPageData(settings)); err != nil {
		http.Error(w, "Template execution error", http.StatusInternalServerError)
		return
	}

	// Serve the shell with a content-based ETag so browsers (Safari especially)
	// revalidate against a real validator and reliably pick up new ?v= asset URLs.
	writeHTMLShell(w, r, buf.Bytes())
}

// Config now redirects into the dashboard shell, where configuration lives as an
// in-app view (#config), the same way HealthPage redirects to /#health. A legacy
// ?section=<name> query maps onto the new hash so external links keep working;
// old fragment-based links like /config#bookmarks cannot survive a redirect
// (browsers drop the fragment), and are remapped client-side.
func (h *Handlers) Config(w http.ResponseWriter, r *http.Request) {
	redirectURL := "/#config"
	if section := strings.TrimSpace(r.URL.Query().Get("section")); section != "" {
		if mapped := mapLegacyConfigSection(section); mapped != "" {
			redirectURL = "/#config/" + mapped
		}
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// mapLegacyConfigSection maps an old config tab name onto one of the regrouped
// view sections (overview · structure · appearance · behavior · data-backups).
// Returns "" for the overview/unknown case so the caller falls back to /#config.
func mapLegacyConfigSection(section string) string {
	switch strings.ToLower(section) {
	case "pages", "categories", "finders":
		return "structure"
	// Tags moved to Bookmarks when Pages & tags became Structure: a tag is
	// something a bookmark carries, not part of a page's structure.
	case "tags":
		return "bookmarks/tags"
	case "appearance", "colors", "themes", "fonts", "layout":
		return "appearance"
	case "behavior", "settings", "keyboard", "language", "quickadd", "quick-add":
		return "behavior"
	case "backups", "backup", "data", "import", "export", "reset":
		return "data-backups"
	case "bookmarks", "stats", "overview":
		return ""
	default:
		return ""
	}
}

func (h *Handlers) setCORSHeaders(w http.ResponseWriter, r *http.Request) {
	applyCORSHeaders(w, r)
}

type htmlPageData struct {
	Settings
	ThemePoolCSV      string `json:"-"`
	CustomThemeIDsCSV string `json:"-"`
	ThemeColorMeta    string `json:"-"`
	WriteToken        string `json:"-"`
	AppVersion        string
	// ReleaseTag is the published version ("v2026.07.23.6"), reported with the
	// analytics settings snapshot so adoption can be read per release. Empty
	// when the What's new index cannot be read.
	ReleaseTag string

	/*
	 * The name of the page this request will land on, for the <title>.
	 *
	 * The template said "Dashboard" and dashboard-page-nav.js corrected it once
	 * the scripts had run -- so a new tab, a bookmark of the dashboard and the
	 * PWA all caught the generic name first, and whatever was bookmarked kept
	 * it. Rendering it here means the first paint already says what this is.
	 *
	 * The landing page, not necessarily the page shown: a deep link like /#3
	 * picks its page from the hash, which a server never sees. The script
	 * corrects that the way it always did; what changes is what is on screen
	 * until it does.
	 */
	LandingPageName string

	// Umami analytics (privacy-friendly, opt-out). Fixed id + host for the
	// project's shared instance. The template emits the tracker only when
	// AnalyticsContentJSON is the bucketable size of this install, as JSON on
	// the tracker's own script tag. Empty when analytics is off, which is also
	// when it is not counted at all.
	AnalyticsContentJSON string

	// AnalyticsEnabled is true — that is the user's setting AND the operator
	// not having switched telemetry off via DISABLE_TELEMETRY.
	AnalyticsWebsiteID string
	AnalyticsScriptSrc string
	AnalyticsEnabled   bool
	// TelemetryLockedOff mirrors DISABLE_TELEMETRY so config can render the
	// Privacy checkbox disabled and explain why it cannot be changed.
	TelemetryLockedOff bool
	// UpdateCheckLockedOff mirrors DISABLE_UPDATE_CHECK for the same reason.
	UpdateCheckLockedOff bool
}

// analyticsWebsiteID / analyticsScriptSrc are the project's shared Umami instance.
const (
	analyticsWebsiteID = "6088e50e-b155-4efc-bc19-c4754edbbab1"
	analyticsScriptSrc = "https://stats.nextdash.cc/script.js"
)

func (h *Handlers) htmlPageData(settings Settings) htmlPageData {
	colors := h.store.GetColors()
	themeID := normalizeLegacyThemeID(settings.Theme)
	/*
	 * The template writes data-depth and data-glow for the first paint, and
	 * with the settings on "follow" the stored value is not a word the
	 * stylesheet knows. Resolved here, into the same fields the template
	 * already reads, so the first paint is the theme's own surfaces rather
	 * than a flash of the default followed by a correction from a script.
	 */
	surfaces := resolveSurfaces(settings, themeID, themeColorsFor(themeID, colors))
	settings.ThemeDepth = surfaces.Depth
	settings.GlowStrength = surfaces.Glow
	settings.ThemeEffects = surfaces.Effects
	settings.ThemeBackdrop = surfaces.Backdrop
	return htmlPageData{
		Settings:             settings,
		ThemePoolCSV:         themePoolCSV(colors),
		CustomThemeIDsCSV:    customThemeIDsCSV(colors),
		ThemeColorMeta:       themeBackgroundPrimary(themeID, colors),
		WriteToken:           writeAccessToken(),
		AppVersion:           appVersionToken(),
		ReleaseTag:           releaseTag(),
		AnalyticsWebsiteID:   analyticsWebsiteID,
		AnalyticsScriptSrc:   analyticsScriptSrc,
		AnalyticsEnabled:     analyticsEnabled(settings),
		AnalyticsContentJSON: h.analyticsContentJSON(analyticsEnabled(settings)),
		TelemetryLockedOff:   telemetryDisabledByEnv(),
		UpdateCheckLockedOff: updateCheckDisabledByEnv(),
		LandingPageName:      h.landingPageName(),
	}
}

// landingPageName is the first page a plain request opens on: the same one
// dashboard-data.js takes, which is pages[0] once the hidden ones are out.
func (h *Handlers) landingPageName() string {
	for _, page := range h.store.GetPages() {
		if page.Hidden {
			continue
		}
		return strings.TrimSpace(page.Name)
	}
	return ""
}

func (h *Handlers) allowLocalBookmarks() bool {
	return h.store.GetSettings().AllowLocalBookmarks
}

func (h *Handlers) validateBookmarkURL(bookmarkURL string) error {
	return validateBookmarkURL(bookmarkURL, h.allowLocalBookmarks())
}

func (h *Handlers) GetBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	all := r.URL.Query().Get("all")
	var bookmarks []Bookmark

	if all == "true" {
		// Get bookmarks from all pages
		bookmarks = h.store.GetAllBookmarks()
	} else if pageIDStr != "" {
		pageID, err := strconv.Atoi(pageIDStr)
		if err != nil {
			http.Error(w, "Invalid page ID", http.StatusBadRequest)
			return
		}
		bookmarks = h.store.GetBookmarksByPage(pageID)
	} else {
		// Silently returning an empty array here used to mask a typo'd or
		// missing query param as "this page has zero bookmarks" — now it is
		// what it actually is, a malformed request.
		http.Error(w, "page or all is required", http.StatusBadRequest)
		return
	}

	writeJSONWithETag(w, r, bookmarks)
}

func (h *Handlers) GetDataRevision(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"revision": h.store.GetDataRevision(),
		// Settings and colours on their own, so a polling client can tell a
		// bookmark edit from a config change and only pay for the heavier
		// refresh when the second happened.
		"settingsRevision": h.store.GetSettingsRevision(),
	})
}

func (h *Handlers) SaveBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		http.Error(w, "Page ID is required", http.StatusBadRequest)
		return
	}

	var bookmarks []Bookmark
	if err := json.NewDecoder(r.Body).Decode(&bookmarks); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate each bookmark URL
	for _, bookmark := range bookmarks {
		if err := h.validateBookmarkURL(bookmark.URL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid bookmark URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	// Reject duplicate URLs within the submitted page payload.
	seenURLKeys := make(map[string]struct{}, len(bookmarks))
	for _, bookmark := range bookmarks {
		urlKey := canonicalBookmarkURLKey(bookmark.URL)
		if urlKey == "" {
			continue
		}
		if _, exists := seenURLKeys[urlKey]; exists {
			http.Error(w, "Duplicate bookmark URL in submitted bookmarks", http.StatusConflict)
			return
		}
		seenURLKeys[urlKey] = struct{}{}
	}

	// Validate shortcut uniqueness in payload first.
	if duplicateShortcut := findDuplicateShortcutInList(bookmarks); duplicateShortcut != "" {
		logBookmarkSaveFailed(pageID, "duplicate_shortcut_in_payload", r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{
			"error":    "duplicate_shortcut",
			"message":  "Duplicate shortcut in submitted bookmarks",
			"shortcut": duplicateShortcut,
		})
		return
	}

	// Validate shortcut uniqueness across all pages (exclude current page, since payload replaces it).
	allBookmarks := h.store.GetAllBookmarks()
	existingOtherPages := make([]Bookmark, 0, len(allBookmarks))
	for _, existing := range allBookmarks {
		if existing.PageID == pageID {
			continue
		}
		existingOtherPages = append(existingOtherPages, existing)
	}
	for _, bookmark := range bookmarks {
		shortcut := normalizeShortcut(bookmark.Shortcut)
		if shortcut == "" {
			continue
		}
		if conflict := findShortcutConflictWithExisting(existingOtherPages, shortcut); conflict != nil {
			logBookmarkSaveFailed(pageID, "duplicate_shortcut", r)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":    "duplicate_shortcut",
				"message":  "Shortcut already exists on another page",
				"shortcut": shortcut,
				"conflict": map[string]any{
					"name":   conflict.Name,
					"url":    conflict.URL,
					"pageId": conflict.PageID,
				},
			})
			return
		}
	}

	for i := range bookmarks {
		bookmarks[i].Tags = normalizeTags(bookmarks[i].Tags)
		bookmarks[i].Icon = sanitizeBookmarkIcon(bookmarks[i].Icon)
		trimBookmarkTextFields(&bookmarks[i])
	}

	beforeBookmarks := h.store.GetBookmarksByPage(pageID)
	// This request replaces the page, and the list it carries was built in a
	// browser that cannot see what the server has written since: opens, the
	// last check, the fetched preview. Without this, opening a bookmark and
	// then editing any bookmark on the page set the count back to zero.
	carryServerOwnedBookmarkFields(bookmarks, beforeBookmarks)
	if !respondStorePersistError(w, h.store.SaveBookmarksByPage(pageID, bookmarks)) {
		return
	}
	logBookmarkSaveDiff(pageID, beforeBookmarks, bookmarks, r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) AddBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Page     int      `json:"page"`
		Bookmark Bookmark `json:"bookmark"`
		// AllowDuplicate is the answer to the question the 409 asks: the client
		// showed where the URL already lives and the user said save it anyway.
		// Never honoured within a single page — see the check below.
		AllowDuplicate bool `json:"allowDuplicate"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate the bookmark URL
	if err := h.validateBookmarkURL(request.Bookmark.URL); err != nil {
		http.Error(w, fmt.Sprintf("Invalid bookmark URL: %v", err), http.StatusBadRequest)
		return
	}

	// Where else this URL already lives.
	//
	// Two things were wrong here at once. It looked only at the page being saved
	// to, so the same link filed on Work and then saved again from Personal went
	// straight in — and the duplicates report found it afterwards, which is
	// reporting instead of preventing. And it answered in plain text, where the
	// shortcut conflict twenty lines below answers with the conflicting
	// bookmark's name, URL and page; that detail is what lets the form say "you
	// saved this on Work, under Docs" with a button on it.
	//
	// Still a 409, and still a refusal when it is the same page: two identical
	// URLs on one page are a mistake every time. Across pages it is sometimes
	// meant — the same document filed with work and with reference — so there
	// the client asks, and comes back with allowDuplicate. samePage tells it
	// which of the two it is looking at.
	newKey := canonicalBookmarkURLKey(request.Bookmark.URL)
	if newKey != "" {
		if existing := findBookmarkByURLKey(h.store, newKey); existing != nil {
			samePage := existing.PageID == request.Page
			if samePage || !request.AllowDuplicate {
				logBookmarkSaveFailed(request.Page, "duplicate_url", r)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{
					"error":    "duplicate_url",
					"message":  "Bookmark URL already exists",
					"samePage": samePage,
					"conflict": map[string]any{
						"name":     existing.Name,
						"url":      existing.URL,
						"pageId":   existing.PageID,
						"pageName": pageNameForID(h.store, existing.PageID),
						// The name, not only the id: Category holds an id, and the
						// client cannot resolve one for a page it is not on.
						"category":     existing.Category,
						"categoryName": categoryNameForID(h.store, existing.PageID, existing.Category),
					},
				})
				return
			}
		}
	}

	shortcut := normalizeShortcut(request.Bookmark.Shortcut)
	if shortcut != "" {
		if conflict := findShortcutConflictWithExisting(h.store.GetAllBookmarks(), shortcut); conflict != nil {
			logBookmarkSaveFailed(request.Page, "duplicate_shortcut", r)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]any{
				"error":    "duplicate_shortcut",
				"message":  "Shortcut already exists",
				"shortcut": shortcut,
				"conflict": map[string]any{
					"name":   conflict.Name,
					"url":    conflict.URL,
					"pageId": conflict.PageID,
				},
			})
			return
		}
	}

	// Set CreatedAt timestamp if not already set
	if request.Bookmark.CreatedAt == 0 {
		request.Bookmark.CreatedAt = time.Now().UnixMilli()
	}

	request.Bookmark.Tags = normalizeTags(request.Bookmark.Tags)
	request.Bookmark.Icon = sanitizeBookmarkIcon(request.Bookmark.Icon)
	trimBookmarkTextFields(&request.Bookmark)

	if !respondStorePersistError(w, h.store.AddBookmarkToPage(request.Page, request.Bookmark)) {
		return
	}
	request.Bookmark.PageID = request.Page
	logBookmarkAdd(request.Bookmark, r)
	// Ask the archive to keep a copy, if that is switched on. In the background
	// and after the write: the bookmark is already saved, and a page captured
	// today is a page that outlives its own site.
	h.archiveNewBookmark(request.Bookmark.URL)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// trimBookmarkTextFields trims the free-text fields that were being stored
// verbatim while Tags/Icon were already normalized at the same call sites.
func trimBookmarkTextFields(b *Bookmark) {
	b.Name = strings.TrimSpace(b.Name)
	b.Category = strings.TrimSpace(b.Category)
	b.Note = strings.TrimSpace(b.Note)
}

// normalizeTags trims, lowercases, deduplicates, and removes empty tag values.
func normalizeTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, t := range tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if _, exists := seen[t]; exists {
			continue
		}
		seen[t] = struct{}{}
		result = append(result, t)
	}
	return result
}

// tagRulesMax bounds how many rules one install may keep. A reader with more
// than this is describing a taxonomy rather than correcting a few guesses.
const tagRulesMax = 100

// dismissedTagSuggestionsMax bounds the turned-down list. The shipped
// catalogue is 463 subjects, so a reader who refuses more than this has
// refused the whole idea.
const dismissedTagSuggestionsMax = 500

/*
sanitizeTagRules keeps the rules that could ever match, and drops the rest.

A pattern is a host, optionally with its first path segment -- never a whole
address. A rule carrying a scheme looks configured and matches nothing, since
what it is compared against is already reduced to host and segment.

The one-segment limit and the two normalisations below are not taste: they are
the exact shape patternsFor() in static/js/shared/tag-suggestions.js emits for a
URL, and a rule is only ever compared against that list. patternsFor stops at
the first path segment and strips a leading "www.", so "reddit.com/r/selfhosted"
and "www.github.com" and "github.com/" would all be stored as rules that can
never fire -- configured-looking and silently dead. Reject what cannot be
rescued, normalise what can.
*/
func sanitizeTagRules(rules []TagRule) []TagRule {
	clean := make([]TagRule, 0, len(rules))
	seen := map[string]struct{}{}
	for _, rule := range rules {
		if len(clean) >= tagRulesMax {
			break
		}
		pattern := strings.ToLower(strings.TrimSpace(rule.Pattern))
		tags := normalizeTags([]string{rule.Tag})
		if pattern == "" || len(tags) == 0 {
			continue
		}
		if strings.Contains(pattern, "://") || strings.ContainsAny(pattern, " ?#") {
			continue
		}
		pattern = strings.TrimPrefix(pattern, "www.")
		pattern = strings.TrimRight(pattern, "/")
		if pattern == "" || strings.Count(pattern, "/") > 1 {
			continue
		}
		key := pattern + "\x00" + tags[0]
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, TagRule{Pattern: pattern, Tag: tags[0]})
	}
	return clean
}

/*
sanitizeDismissedTagSuggestions narrows the proposals the reader turned down.

Each is "pattern|tag": the pattern the row matched and the tag it offered, the
pair that identifies a proposal across sessions -- the bookmarks under it come
and go, so a list of bookmark keys would stop matching the moment one is added.
Both halves are lowercased and the pattern is narrowed exactly the way a rule's
is, so a dismissal keeps matching what patternsFor() emits.

Bounded like the rules are. A reader who turns down more than this has a
catalogue problem rather than a settings problem, and an unbounded list in
settings is an unbounded write on every save.
*/
func sanitizeDismissedTagSuggestions(raw []string) []string {
	clean := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, entry := range raw {
		if len(clean) >= dismissedTagSuggestionsMax {
			break
		}
		parts := strings.SplitN(strings.ToLower(strings.TrimSpace(entry)), "|", 2)
		if len(parts) != 2 {
			continue
		}
		pattern := strings.TrimRight(strings.TrimPrefix(strings.TrimSpace(parts[0]), "www."), "/")
		tags := normalizeTags([]string{parts[1]})
		if pattern == "" || len(tags) == 0 {
			continue
		}
		if strings.Contains(pattern, "://") || strings.ContainsAny(pattern, " ?#") {
			continue
		}
		if strings.Count(pattern, "/") > 1 {
			continue
		}
		key := pattern + "|" + tags[0]
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		clean = append(clean, key)
	}
	return clean
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var result strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			result.WriteRune(r)
		} else if r == ' ' || r == '-' || r == '_' {
			result.WriteRune('-')
		}
	}
	return strings.Trim(result.String(), "-")
}

/*
resolveImportCategories decides which category each imported name belongs to.

Every importer funnels through here -- the browser file, the CSV, the extension
and every source on the register -- so this is the one place that decides what a
category name coming from outside becomes.

Two things it must get right, both learned from real collections:

A name that slugifies to nothing still needs a category. slugify keeps only
a-z0-9, so a folder called "📚" or "读书" or "Ünïcode" produced an empty id, and
the old code skipped it: no category was created and every bookmark in it landed
uncategorised, with the name it came with gone for good. The name is kept as the
display name and the id falls back to a generated one, because an id is a key
and a name is what the reader reads -- they were never required to match.

Two different names must not collapse into one category. Raindrop allows the
same collection name under different parents, and any two names differing only
in punctuation slugify identically. Those get a numbered id -- reading,
reading-2 -- so both survive as separate, editable categories rather than
merging silently.

An existing category is reused when its id matches and it is plainly the same
one, so importing "Development" into a page that already has Development adds to
it rather than making a second.
*/
func resolveImportCategories(existing []Category, rows []ImportedRow) (map[string]string, []Category) {
	byID := make(map[string]Category, len(existing))
	for _, c := range existing {
		byID[c.ID] = c
	}
	taken := make(map[string]struct{}, len(existing))
	for id := range byID {
		taken[id] = struct{}{}
	}

	nameToID := map[string]string{}
	var created []Category

	for _, row := range rows {
		name := strings.TrimSpace(row.Category)
		if name == "" {
			continue
		}
		if _, done := nameToID[name]; done {
			continue
		}

		base := slugify(name)
		if base == "" {
			// A name with nothing sluggable in it. "category" rather than a
			// hash: the reader sees the name, and the id only has to be stable
			// and unique.
			base = "category"
		}

		// Reuse an existing category when the id matches and the name agrees --
		// case and surrounding space are not a different category.
		if found, ok := byID[base]; ok && strings.EqualFold(strings.TrimSpace(found.Name), name) {
			nameToID[name] = base
			continue
		}

		id := base
		for n := 2; ; n++ {
			if _, clash := taken[id]; !clash {
				break
			}
			if found, ok := byID[id]; ok && strings.EqualFold(strings.TrimSpace(found.Name), name) {
				// A numbered id that is already this very category.
				break
			}
			id = fmt.Sprintf("%s-%d", base, n)
		}

		nameToID[name] = id
		if _, exists := byID[id]; !exists {
			created = append(created, Category{ID: id, Name: name})
		}
		taken[id] = struct{}{}
	}

	return nameToID, created
}

func (h *Handlers) ImportBrowserBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	// Tags, note and shortcut are part of the request because the CSV import
	// sends them and always has. They were not part of this struct, so
	// encoding/json dropped them on the floor: a spreadsheet round-trip lost
	// every tag and every note it was meant to carry -- which is the reason
	// MANUAL gives for using the CSV route over the browser file at all.
	var request struct {
		PageID    int           `json:"pageId"`
		Bookmarks []ImportedRow `json:"bookmarks"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if request.PageID <= 0 {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	h.importRows(w, r, request.PageID, request.Bookmarks)
}

// ImportedRow is one bookmark on its way in, from any importer.
//
// The JSON tags are the shape the browser has posted since the CSV import
// existed; the HTML importer fills the same struct from a parsed file, so both
// routes get the same category creation, the same de-duplication and the same
// normalisers rather than a second implementation of each.
type ImportedRow struct {
	Name     string   `json:"name"`
	URL      string   `json:"url"`
	Category string   `json:"category"`
	Shortcut string   `json:"shortcut"`
	Note     string   `json:"note"`
	Tags     []string `json:"tags"`
	// CreatedAt and UpdatedAt are milliseconds, and are only ever set by an
	// importer that read them from a file. A row without them is stamped by the
	// store, as a typed bookmark is.
	CreatedAt int64 `json:"createdAt,omitempty"`
	UpdatedAt int64 `json:"updatedAt,omitempty"`
}

// importRows writes a batch onto a page and answers with the tally.
func (h *Handlers) importRows(w http.ResponseWriter, r *http.Request, pageID int, rows []ImportedRow) {
	request := struct {
		PageID    int
		Bookmarks []ImportedRow
	}{PageID: pageID, Bookmarks: rows}

	for _, bm := range request.Bookmarks {
		if err := h.validateBookmarkURL(bm.URL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	existing := h.store.GetBookmarksByPage(request.PageID)
	existingURLs := make(map[string]struct{}, len(existing))
	for _, b := range existing {
		existingURLs[canonicalBookmarkURLKey(b.URL)] = struct{}{}
	}

	categories := h.store.GetCategoriesByPage(request.PageID)
	knownCatIDs := make(map[string]struct{}, len(categories))
	for _, c := range categories {
		knownCatIDs[c.ID] = struct{}{}
	}

	// Every distinct category name an import carries gets a real category on
	// the page, and the id it is written under.
	nameToID, newCategories := resolveImportCategories(categories, request.Bookmarks)
	if len(newCategories) > 0 {
		categories = append(categories, newCategories...)
		if !respondCategoriesSaveError(w, h.store.SaveCategoriesByPage(request.PageID, categories)) {
			return
		}
	}

	imported := 0
	skipped := 0
	for _, bm := range request.Bookmarks {
		key := canonicalBookmarkURLKey(bm.URL)
		if _, dup := existingURLs[key]; dup {
			skipped++
			continue
		}
		catID := nameToID[strings.TrimSpace(bm.Category)]
		if !respondStorePersistError(w, h.store.AddBookmarkToPage(request.PageID, Bookmark{
			Name:     bm.Name,
			URL:      bm.URL,
			Category: catID,
			PageID:   request.PageID,
			// Through the same normalisers every other write uses, so an
			// imported row cannot hold a shape a typed one could not.
			Shortcut: normalizeShortcut(bm.Shortcut),
			Note:     strings.TrimSpace(bm.Note),
			Tags:     normalizeTags(bm.Tags),
			// Only what a file actually carried. Zero leaves the store to stamp
			// it, so a bookmark with no ADD_DATE is dated on arrival rather than
			// in 1970.
			CreatedAt: bm.CreatedAt,
			UpdatedAt: bm.UpdatedAt,
		})) {
			return
		}
		existingURLs[key] = struct{}{}
		imported++
	}

	// Both the bookmarks and the categories the report reads have changed.
	h.invalidateHealthReportCache()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"imported": imported, "skipped": skipped})
	logBrowserImport(request.PageID, imported, skipped, r)
}

func (h *Handlers) DeleteBookmark(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	var request struct {
		Page     int      `json:"page"`
		Bookmark Bookmark `json:"bookmark"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if err := h.store.DeleteBookmarkFromPage(request.Page, request.Bookmark); err != nil {
		if errors.Is(err, ErrBookmarkNotFound) {
			http.Error(w, "Bookmark not found", http.StatusNotFound)
			return
		}
		if !respondStorePersistError(w, err) {
			return
		}
		return
	}

	logBookmarkDelete(request.Bookmark, r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetCategories(w http.ResponseWriter, r *http.Request) {
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		// No page param provided - return empty array
		// Categories are now per-page only, no global categories
		writeJSONWithETag(w, r, []Category{})
		return
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	if !h.pageExists(pageID) {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}

	categories := h.store.GetCategoriesByPage(pageID)
	writeJSONWithETag(w, r, categories)
}

func (h *Handlers) GetFinders(w http.ResponseWriter, r *http.Request) {
	writeJSONWithETag(w, r, h.store.GetFinders())
}

func (h *Handlers) SaveFinders(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var finders []Finder
	if err := json.NewDecoder(r.Body).Decode(&finders); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if !respondStorePersistError(w, h.store.SaveFinders(finders)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) SaveCategories(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageIDStr := r.URL.Query().Get("page")
	if pageIDStr == "" {
		http.Error(w, "Page ID is required", http.StatusBadRequest)
		return
	}

	var categories []Category
	if err := json.NewDecoder(r.Body).Decode(&categories); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}
	if !h.pageExists(pageID) {
		http.Error(w, "Page not found", http.StatusNotFound)
		return
	}

	// ?dryRun=1 answers with what the save would change and writes nothing.
	// Same handler, same payload, same validation as the real save — a separate
	// endpoint would be free to drift from the thing it is meant to predict.
	if dryRun := r.URL.Query().Get("dryRun"); dryRun == "1" || dryRun == "true" {
		preview, err := h.store.PreviewCategoriesByPage(pageID, categories)
		if err != nil {
			http.Error(w, "Failed to preview categories", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(preview)
		return
	}

	if !respondCategoriesSaveError(w, h.store.SaveCategoriesByPage(pageID, categories)) {
		return
	}
	// The report reads categories to find bookmarks orphaned by a deleted one,
	// so a category save now changes what it would say. Without this the
	// orphaned-category rows only appear once the cache TTL expires.
	h.invalidateHealthReportCache()
	logCategoriesSave(pageID, len(categories), r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetPages(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	all := h.store.GetPages()
	visible := make([]Page, 0, len(all))
	for _, p := range all {
		if p.Hidden {
			continue
		}
		visible = append(visible, p)
	}
	writeJSONWithETag(w, r, visible)
}

// GetUnsorted returns the reserved Unsorted page and its bookmarks, newest
// first. The page is created on first call (EnsureUnsortedPage), so this
// never 404s.
// unsortedBookmark is a bookmark plus the index it occupies on the unsorted
// page. The embedded struct has no JSON name of its own, so the bookmark's own
// fields stay where every existing reader expects them.
type unsortedBookmark struct {
	Bookmark
	Index int `json:"index"`
}

func (h *Handlers) GetUnsorted(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	page, err := h.store.EnsureUnsortedPage()
	if !respondStorePersistError(w, err) {
		return
	}
	bookmarks := h.store.GetBookmarksByPage(page.ID)
	// The position each bookmark holds on the page, captured before the sort
	// below reorders them. Deleting by index is the only safe bulk delete the
	// store offers (/api/health/delete-bookmarks), and a client that only ever
	// saw this list newest-first has no other way to know where a row sits.
	rows := make([]unsortedBookmark, len(bookmarks))
	for i, bookmark := range bookmarks {
		rows[i] = unsortedBookmark{Bookmark: bookmark, Index: i}
	}
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].CreatedAt > rows[j].CreatedAt
	})
	writeJSONWithETag(w, r, map[string]any{
		"page":      page,
		"bookmarks": rows,
	})
}

func (h *Handlers) SavePages(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var pages []Page
	if err := json.NewDecoder(r.Body).Decode(&pages); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	for _, page := range pages {
		if page.ID == unsortedPageID {
			http.Error(w, "That page id is reserved", http.StatusBadRequest)
			return
		}
	}

	// Extract page order (array of IDs)
	order := make([]int, len(pages))
	for i, page := range pages {
		order[i] = page.ID
	}

	// Save the order
	if !respondStorePersistError(w, h.store.SavePageOrder(order)) {
		return
	}

	// Save each page individually; bookmarks are preserved from disk (see SavePage).
	for _, page := range pages {
		page = normalizePageMeta(page, page.ID)
		if !respondStorePersistError(w, h.store.SavePage(page)) {
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) DeletePage(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	vars := mux.Vars(r)
	pageIDStr := vars["id"]

	pageID, err := strconv.Atoi(pageIDStr)
	if err != nil {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

	// Prevent deleting page 1 (main page)
	if pageID == 1 {
		http.Error(w, "Cannot delete the main page", http.StatusBadRequest)
		return
	}
	if pageID == unsortedPageID {
		http.Error(w, "Cannot delete the unsorted page", http.StatusBadRequest)
		return
	}

	// Trash the whole page before the file goes: DeletePage os.Removes
	// bookmarks-N.json outright, so without this everything on it is
	// unrecoverable the moment the request lands.
	//
	// One entry for the page, not one per bookmark. Restoring is then a single
	// action that brings the page, its categories and its bookmarks back
	// together — restoring 40 separate rows onto a page that no longer exists
	// would be no restore at all.
	//
	// This runs first on purpose: if the trash write fails the page survives and
	// the user can retry. The reverse order would trade the page for a failed
	// backup.
	deleted := Page{ID: pageID}
	orderIndex := 0
	for _, page := range h.store.GetPages() {
		if page.ID == pageID {
			deleted = page
			break
		}
	}
	for i, id := range h.store.GetPageOrder() {
		if id == pageID {
			orderIndex = i
			break
		}
	}
	if err := h.store.AddTrashedBookmarks([]TrashedBookmark{{
		Kind:     TrashKindPage,
		PageID:   pageID,
		PageName: deleted.Name,
		Source:   "page-delete",
		TrashedPage: &TrashedPage{
			Page:       deleted,
			Categories: h.store.GetCategoriesByPage(pageID),
			Bookmarks:  h.store.GetBookmarksByPage(pageID),
			OrderIndex: orderIndex,
		},
	}}); err != nil {
		respondStorePersistError(w, err)
		return
	}

	// Delete the page file
	if err := h.store.DeletePage(pageID); err != nil {
		http.Error(w, "Error deleting page", http.StatusInternalServerError)
		return
	}

	// Update the page order - remove the deleted page ID
	order := h.store.GetPageOrder()
	newOrder := make([]int, 0, len(order))
	for _, id := range order {
		if id != pageID {
			newOrder = append(newOrder, id)
		}
	}
	if !respondStorePersistError(w, h.store.SavePageOrder(newOrder)) {
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) ResetAllData(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Confirm bool `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !req.Confirm {
		http.Error(w, "Confirmation required", http.StatusBadRequest)
		return
	}

	if err := h.store.ResetAllData(); err != nil {
		http.Error(w, "Error resetting data", http.StatusInternalServerError)
		return
	}
	logDataReset(r)
	if h.store.TakeDefaultBookmarkIconPrefetch() {
		h.startDefaultBookmarkIconPrefetch()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// DeleteAllBookmarks empties every page's bookmarks while keeping pages,
// categories, and settings. No default bookmarks are recreated.
func (h *Handlers) DeleteAllBookmarks(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		Confirm bool `json:"confirm"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !req.Confirm {
		http.Error(w, "Confirmation required", http.StatusBadRequest)
		return
	}

	if err := h.store.DeleteAllBookmarks(); err != nil {
		http.Error(w, "Error deleting bookmarks", http.StatusInternalServerError)
		return
	}
	h.invalidateHealthReportCache()
	logBookmarksDeletedAll(r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings := h.store.GetSettings()
	// Report the effective value: with DISABLE_TELEMETRY set, analytics is off no
	// matter what is stored, and clients should render it that way. The stored
	// setting is left untouched so it returns when the operator lifts the switch.
	if telemetryDisabledByEnv() {
		settings.AnalyticsOptIn = false
	}
	if updateCheckDisabledByEnv() {
		settings.UpdateCheckEnabled = false
	}
	writeJSONWithETag(w, r, settings)
}

func mergeSettingsFromBody(stored Settings, body []byte) (Settings, error) {
	storedJSON, err := json.Marshal(stored)
	if err != nil {
		return Settings{}, err
	}
	var base map[string]json.RawMessage
	if err := json.Unmarshal(storedJSON, &base); err != nil {
		return Settings{}, err
	}
	var incoming map[string]json.RawMessage
	if err := json.Unmarshal(body, &incoming); err != nil {
		return Settings{}, err
	}
	for key, value := range incoming {
		base[key] = value
	}
	mergedJSON, err := json.Marshal(base)
	if err != nil {
		return Settings{}, err
	}
	var settings Settings
	if err := json.Unmarshal(mergedJSON, &settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (h *Handlers) SaveSettings(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	settings, err := mergeSettingsFromBody(h.store.GetSettings(), body)
	if err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// DISABLE_TELEMETRY is an operator kill switch, so it has to hold at the API
	// too — otherwise a client could simply POST the setting back to true. Keep
	// whatever is already stored rather than writing false: the switch suppresses
	// analytics while it is set, and the user's own preference must survive it so
	// it returns unchanged once the operator unsets it.
	if telemetryDisabledByEnv() {
		settings.AnalyticsOptIn = h.store.GetSettings().AnalyticsOptIn
	}
	if updateCheckDisabledByEnv() {
		settings.UpdateCheckEnabled = h.store.GetSettings().UpdateCheckEnabled
	}

	// Validate and sanitize collections.
	//
	// Anything dropped here is reported back rather than discarded in silence.
	// A collection with no name, or whose only rule has an empty value — which
	// is exactly the shape the "Add collection" button creates — used to vanish
	// while the response still said "success", so the row stayed on screen with
	// its rules until a reload took it away for good.
	seenIDs := make(map[string]struct{})
	sanitized := settings.Collections[:0]
	var droppedCollections []string
	for _, col := range settings.Collections {
		col.ID = strings.TrimSpace(col.ID)
		col.Name = clampEntityName(col.Name)
		if col.ID == "" || col.Name == "" {
			droppedCollections = append(droppedCollections, collectionLabel(col))
			continue
		}
		if _, dup := seenIDs[col.ID]; dup {
			droppedCollections = append(droppedCollections, collectionLabel(col))
			continue
		}
		seenIDs[col.ID] = struct{}{}
		validRules := col.Rules[:0]
		for _, rule := range col.Rules {
			rule.Value = strings.TrimSpace(rule.Value)
			// "untagged" and "pinned" are complete without one; the rest need a
			// value to compare against.
			if rule.Value != "" || valuelessRuleFields[rule.Field] {
				validRules = append(validRules, rule)
			}
		}
		if len(validRules) == 0 {
			droppedCollections = append(droppedCollections, collectionLabel(col))
			continue
		}
		col.Rules = validRules
		sanitized = append(sanitized, col)
	}
	settings.Collections = sanitized
	settings.TagRules = sanitizeTagRules(settings.TagRules)
	settings.DismissedTagSuggestions = sanitizeDismissedTagSuggestions(settings.DismissedTagSuggestions)
	settings.SavedSearches = normalizeSavedSearches(settings.SavedSearches)
	clampBookmarkSettings(&settings)
	clampCategoryLayoutSettings(&settings)
	settings.ServerLogRetentionHours = clampServerLogRetentionHours(settings.ServerLogRetentionHours)
	settings.ServerLogRetentionMode = clampServerLogRetentionMode(settings.ServerLogRetentionMode)
	settings.ServerLogMaxEntries = clampServerLogMaxEntries(settings.ServerLogMaxEntries)
	settings.MaintenanceWindows = normalizeMaintenanceWindows(settings.MaintenanceWindows)
	settings.MonitorNotifyTelegramChatID = normalizeMonitorNotifyCredential(settings.MonitorNotifyTelegramChatID)
	settings.MonitorNotifyPushoverToken = normalizeMonitorNotifyCredential(settings.MonitorNotifyPushoverToken)
	settings.MonitorNotifyPushoverUserKey = normalizeMonitorNotifyCredential(settings.MonitorNotifyPushoverUserKey)

	if !respondStorePersistError(w, h.store.SaveSettings(settings)) {
		return
	}
	// Apply straight away, so starting or stopping capture and changing the cap
	// take effect on the next poll rather than at the next restart.
	serverLog.SetRetention(
		settings.ServerLogRetentionMode,
		settings.ServerLogRetentionHours,
		settings.ServerLogMaxEntries,
	)
	serverLog.SetPaused(!settings.ServerLogEnabled)
	// The detail level and the channel list take effect on the next line
	// written, not at the next restart: someone turning Verbose on is usually
	// mid-investigation and wants the next thing that happens.
	applyLogSettings(settings)
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{"status": "success"}
	if len(droppedCollections) > 0 {
		response["droppedCollections"] = droppedCollections
	}
	// The clamps above can rewrite what was sent -- an archive URL without a
	// {url} placeholder becomes the default, a count outside its range is
	// pulled back in. Saying only "success" left the client showing a value the
	// server had refused, under a Saved indicator, until the next reload.
	// Handing the stored settings back lets it correct itself.
	response["settings"] = settings
	json.NewEncoder(w).Encode(response)
}

// normalizeSavedSearches trims, drops incomplete entries and caps the list at
// the same ten the search bar has always kept.
func normalizeSavedSearches(list []SavedSearch) []SavedSearch {
	out := make([]SavedSearch, 0, len(list))
	for _, entry := range list {
		entry.Name = clampEntityName(entry.Name)
		entry.Query = strings.TrimSpace(entry.Query)
		if entry.Name == "" || entry.Query == "" {
			continue
		}
		out = append(out, entry)
		if len(out) == 10 {
			break
		}
	}
	return out
}

// valuelessRuleFields are collection-rule fields that carry their question in
// the field name, so an empty value is not a half-filled rule.
var valuelessRuleFields = map[string]bool{"untagged": true, "pinned": true}

// collectionLabel names a collection for a message to the user, falling back to
// its id when the name is what went missing.
func collectionLabel(col Collection) string {
	if name := strings.TrimSpace(col.Name); name != "" {
		return name
	}
	if id := strings.TrimSpace(col.ID); id != "" {
		return id
	}
	return "(unnamed)"
}

// Colors keeps the old /colors bookmark working. It targets the view section
// directly: routing via /config would drop the fragment, since the redirect
// there reads only ?section= and would land on the overview instead.
func (h *Handlers) Colors(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/#config/appearance", http.StatusMovedPermanently)
}

func (h *Handlers) GetColors(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(colors)
}

/*
ThemeMeta answers with what the theme browser needs beyond colours: each
theme's archetype, its one-line description, and the surfaces it was drawn
for.

Separate from GetColors because three of the five fields are worked out rather
than stored, and because a caller that only wants to draw the browser should
not have to pull every palette to get them.
*/
func (h *Handlers) ThemeMeta(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()
	meta := make(map[string]themeMeta, len(colors.BuiltIn)+len(colors.Custom))
	for id, tc := range colors.BuiltIn {
		meta[id] = themeMetaFor(id, tc)
	}
	// A custom theme has no description written for it, and may well have no
	// archetype either; it still gets an entry, so the browser does not have
	// to treat it as a special case.
	for id, tc := range colors.Custom {
		meta[id] = themeMetaFor(id, tc)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"archetypes": themeArchetypeOrder,
		"themes":     meta,
	})
}

/*
ThemeDefaults answers with the values a built-in theme ships with.

The editor opens on these rather than on what is stored: the shipped values
are what the theme is, and a reader who has changed a colour at some point
should be looking at the difference rather than at their own edit presented as
the theme. Whether a stored copy differs is answered too, so the editor can
say so instead of quietly dropping it on the next save.

A custom theme has no shipped values, so it answers with what is stored and
says it is not a built-in.
*/
func (h *Handlers) ThemeDefaults(w http.ResponseWriter, r *http.Request) {
	themeID := normalizeLegacyThemeID(strings.TrimSpace(r.URL.Query().Get("id")))
	colors := h.store.GetColors()
	defaults, isBuiltIn := getDefaultBuiltInThemes()[themeID]

	stored, hasStored := colors.BuiltIn[themeID]
	if !hasStored {
		stored, hasStored = colors.Custom[themeID]
	}
	if !isBuiltIn {
		defaults = stored
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id":        themeID,
		"builtIn":   isBuiltIn,
		"defaults":  defaults,
		"stored":    stored,
		"hasStored": hasStored,
		// True when somebody has edited this theme: the editor opens on the
		// defaults either way, and uses this to say that an edit exists.
		"edited": isBuiltIn && hasStored && stored != defaults,
		"meta":   themeMetaFor(themeID, defaults),
	})
}

func (h *Handlers) SaveColors(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	var colors ColorTheme
	if err := json.NewDecoder(r.Body).Decode(&colors); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	colors = sanitizeColorTheme(colors)

	if !respondStorePersistError(w, h.store.SaveColors(colors)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func (h *Handlers) ResetColors(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}

	// Get current colors to preserve custom themes
	currentColors := h.store.GetColors()

	// Reset only light and dark themes to defaults, keep custom themes
	defaultColors := ColorTheme{
		Light:   getDefaultLightTheme(),
		Dark:    getDefaultDarkTheme(),
		BuiltIn: getDefaultBuiltInThemes(),
		Custom:  currentColors.Custom, // Preserve existing custom themes
	}

	if !respondStorePersistError(w, h.store.SaveColors(defaultColors)) {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(defaultColors)
}

func (h *Handlers) GetCustomThemesList(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()

	themesMap := make(map[string]string)
	for themeID, themeColors := range colors.BuiltIn {
		themesMap[themeID] = themeColors.Name
	}
	for themeID, themeColors := range colors.Custom {
		themesMap[themeID] = themeColors.Name
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(themesMap)
}

/*
themeSurfaceGlow answers how much of its own colour a theme bleeds around a
raised surface.

Declared wins. Unset does not mean none -- it means work it out, the same way
the backdrop is worked out, because 218 of the themes in the register predate
the field and hand-writing a number for each of them would be inventing 218
opinions. A theme that wants no glow at all says so with a negative number.

Derived from the theme's own palette, along two branches, because a glow is
not one effect. On a dark page it is light around a surface; on a light page
light around a surface is a smudge, and what reads instead is the accent
sitting in the shadow underneath. Both branches answer the same question --
how much accent -- and themeGlowMode says which geometry spends it.

  - how much colour the accent actually carries, in OKLCH chroma rather than
    HSL saturation. Saturation calls #58A6FF fully saturated because one
    channel touches 255, which ranks GitHub's blue above a neon green; chroma
    does not make that mistake.
  - how light the accent is. On a dark page a pale accent glows and a dark one
    would only be a shadow; on a light page it is the other way round, because
    a shadow is what is being tinted.
  - how dark the page is, on the dark branch only. The light branch has
    already answered that by being the light branch.

Both branches have a floor, so that a quiet palette still says something
rather than being flat by omission -- 132 of the 222 built-in themes derived
to exactly zero before it, 109 of them for no reason other than being light.
A theme that means silence still declares -1 and gets it.

The light branch is capped well under the dark one. On paper this is a tinted
shadow and it is meant to be felt and not seen.
*/
/*
What the glass depth step is worth on a theme that never mentioned it.

Both of these are read only under body[data-depth="glass"], and both used to
fall back to the value that means "not glass at all": fully solid, no blur.
Four of the 222 built-in themes declare an alpha and two declare a blur, so on
the other 218 the glass step was a setting that did nothing -- pick it, and the
dashboard was indistinguishable from rich. A depth step the reader chose should
do what it says whatever theme is underneath it.

So a theme that says nothing gets the step's own glass rather than none. A
theme with an opinion still wins, which is how Aurora Glass keeps its deeper
0.58 and Retro CRT Mk II its near-solid 0.9. And a theme that means solid on
purpose says so with a negative, the convention themeSurfaceGlow already uses
for a palette that means silence.

0.72 and 18px rather than something bolder: the tiers in theme-character.css
scale these down per reading need -- the page ground takes 70% of the alpha, an
overlay nearly all of it -- so this is the most translucent the page ever gets.
A step back from the 0.58 Aurora Glass sets for itself, because that theme was
drawn around being glass and these 218 were not.
*/
/*
The fourth semantic colour, when a theme has not named one.

--accent-info marks a kind rather than a verdict: a feature row against a post
in the news stream, a filter completion against a finder in the search list,
the note you are typing in. The stylesheet has asked for it in seven places
since long before a theme could answer, so all seven fell through to a
hard-coded #60A5FA -- one blue across a paper theme, a green terminal and 220
others, belonging to none of them.

Derived rather than added to 222 records by hand, and derived by hue rather
than by picking a colour: the tone comes from AccentPrimary, so the theme's
own weight and saturation carry over, and only the hue is chosen. It is the
hue furthest from the three accents that already mean something -- success,
warning and error -- because the whole job of this colour is to not be
mistaken for a verdict. On a green terminal whose primary and success are the
same green, that lands it well away from both; on a greyscale theme the
primary has no chroma to give, so info comes out grey too, which is the right
answer there.

Searched in five-degree steps rather than solved: the objective is the minimum
of three circular distances, which is not differentiable at the crossings, and
seventy-two candidates is nothing to walk.
*/
func themeAccentInfo(tc ThemeColors) string {
	if strings.TrimSpace(tc.AccentInfo) != "" {
		return strings.TrimSpace(tc.AccentInfo)
	}

	primary := tc.AccentPrimary
	if primary == "" {
		primary = tc.AccentSuccess
	}
	lightness, chroma, ok := hexOklch(primary)
	if !ok {
		// A palette that cannot be read gets the theme's own accent rather
		// than a blue from nowhere: wrong in the same direction as the rest
		// of a malformed theme, instead of wrong in a new one.
		return "var(--accent-primary)"
	}

	taken := []float64{}
	for _, c := range []string{tc.AccentSuccess, tc.AccentWarning, tc.AccentError} {
		if _, chr, good := hexOklch(c); !good || chr < 0.02 {
			continue
		}
		if hue, good := hexOklchHue(c); good {
			taken = append(taken, hue)
		}
	}

	hue := 0.0
	if h, good := hexOklchHue(primary); good {
		hue = h
	}
	if len(taken) > 0 {
		best, bestGap := hue, -1.0
		for candidate := 0.0; candidate < 360; candidate += 5 {
			gap := 360.0
			for _, other := range taken {
				d := math.Abs(candidate - other)
				if d > 180 {
					d = 360 - d
				}
				if d < gap {
					gap = d
				}
			}
			if gap > bestGap {
				best, bestGap = candidate, gap
			}
		}
		hue = best
	}

	return "oklch(" + formatFloat(math.Round(lightness*1000)/1000) +
		" " + formatFloat(math.Round(chroma*1000)/1000) +
		" " + formatFloat(math.Round(hue*10)/10) + ")"
}

/*
How far apart the rungs of the surface ladder sit.

Each rung mixes a few per cent of the text colour into the page: 3, 6 and 9,
scaled by the depth control. Those numbers were chosen against a mid-contrast
palette, and they are not worth the same everywhere. On a page and an ink that
sit far apart -- near-black under near-white -- three per cent is a visible
step. On a palette that keeps its ink close to its ground, three per cent of
almost nothing is nothing, and every card on those themes reads as flat
whatever the reader picked.

So the step is scaled by the room the palette actually has. Not by the depth,
which is the reader's choice and already multiplies this; by the theme's own
distance between page and ink, which is a property of the palette.

Bounded well inside doubling: this shifts a card against its page, and a step
large enough to be a colour of its own would fight the accent tint mixed in
beside it.
*/
func themeSurfaceStep(tc ThemeColors) string {
	if tc.SurfaceStep > 0 {
		return formatFloat(clampFloat(tc.SurfaceStep, 0.6, 1.8, 1))
	}

	page, _, okPage := hexOklch(tc.BackgroundPrimary)
	ink, _, okInk := hexOklch(tc.TextPrimary)
	if !okPage || !okInk {
		return "1"
	}

	// The room retro-crt-dark has: 0.828 in OKLCH lightness between its page
	// and its ink. It is the default theme and the one the 3/6/9 were drawn
	// against, so it is what "a step worth one" means -- and it comes out at
	// exactly 1, which a guessed constant did not. A first pass used 0.62 and
	// put the median theme at 0.84, flattening most of the collection to fix
	// the few.
	room := math.Abs(ink - page)
	step := 1.0
	if room > 0 {
		step = 0.828 / room
	}
	return formatFloat(math.Round(clampFloat(step, 0.6, 1.8, 1)*100) / 100)
}

func themeSurfaceAlpha(tc ThemeColors) string {
	if tc.SurfaceAlpha < 0 {
		return "1"
	}
	if tc.SurfaceAlpha > 0 {
		return formatFloat(clampFloat(tc.SurfaceAlpha, 0.3, 1, 1))
	}
	// The archetype scales what the palette earned rather than replacing it:
	// glass on a pale slate and glass on a near-black terminal are both glass,
	// and they are not equally transparent. See theme_archetype.go.
	return formatFloat(archetypeScaleAlpha(tc, derivedSurfaceAlpha(tc)))
}

/*
How much of the page a theme can afford to let through.

A flat number for all 218 would make the glass step work, and make every one
of them glass in the same way -- which is the opposite of what 111 hand-drawn
palettes are for. Two things about a palette decide this, and both are about
whether the text on the surface survives the page showing through it.

How light the page is. On a dark theme the ground behind a surface is close to
black, so what comes through barely moves the surface and pale text holds. On
a light theme the page is near-white and everything it touches lightens, which
is where translucency turns text grey -- so a light theme keeps more of itself.

How far the surface already stands from the page. A palette whose secondary
background is nearly its primary draws a surface you can only just make out;
letting more through costs it almost nothing and finally gives the step
something to show. One that steps well clear has a surface worth keeping, so
it keeps more of it.

Both read as slopes rather than as thresholds. Written as buckets first, and
182 of the 222 themes came out on the same number -- a flat default wearing a
formula.

The range runs 0.62 to 0.88. Below that the figures on a widget start
competing with whatever is behind them; above it the step stops being visible,
which is the bug this exists to fix.
*/
func derivedSurfaceAlpha(tc ThemeColors) float64 {
	alpha := 0.70

	pageLightness, _, okPage := hexOklch(tc.BackgroundPrimary)
	if okPage {
		// Read as a slope and not as two buckets. Thresholds put 182 of the
		// 222 themes on one number, which is a flat default wearing a formula:
		// the point of deriving this is that a pale slate and a near-black
		// terminal should not be glass in the same way.
		alpha += 0.12 * unitRange(pageLightness)
	}

	surfaceLightness, _, okSurface := hexOklch(tc.BackgroundSecondary)
	if okPage && okSurface {
		// Measured against 0.2, which is about as far as a palette ever steps
		// between its page and its raised surface; past that it is already a
		// different colour rather than a step.
		step := math.Abs(surfaceLightness - pageLightness)
		alpha += 0.10 * unitRange(step/0.2)
	}

	// Rounded to the hundredth the CSS will carry, so a derived value reads
	// like one a theme could have written by hand rather than like arithmetic.
	return math.Round(clampFloat(alpha, 0.62, 0.88, 0.72)*100) / 100
}

func themeSurfaceBlur(tc ThemeColors) string {
	if tc.SurfaceBlur < 0 {
		return "0"
	}
	if tc.SurfaceBlur > 0 {
		return formatFloat(clampFloat(tc.SurfaceBlur, 0, 32, 0))
	}
	// Blur follows translucency rather than being chosen beside it. The blur is
	// what keeps text readable over whatever shows through, so the surface that
	// lets the most through needs the most of it: 0.62 alpha earns 22px, 0.88
	// earns 12px, and everything between lands on the line -- a palette with
	// nothing to derive from sits in the middle at 18.
	// Against the alpha the archetype actually produced: the blur exists to
	// keep text readable over what shows through, so it has to follow the
	// transparency that is drawn and not the one before the archetype spoke.
	alpha := archetypeScaleAlpha(tc, derivedSurfaceAlpha(tc))
	blur := 22 - (alpha-0.62)*(10/0.26)
	return formatFloat(archetypeScaleBlur(tc, math.Round(clampFloat(blur, 12, 22, 18))))
}

func themeSurfaceGlow(tc ThemeColors) string {
	if tc.SurfaceGlow < 0 {
		return "0"
	}
	if tc.SurfaceGlow > 0 {
		return formatFloat(clampFloat(tc.SurfaceGlow, 0, 1, 0))
	}

	accent := tc.AccentPrimary
	if accent == "" {
		accent = tc.AccentSuccess
	}
	accentLightness, accentChroma, okAccent := hexOklch(accent)
	pageLightness, _, okPage := hexOklch(tc.BackgroundPrimary)
	if !okAccent || !okPage {
		return "0"
	}

	var glow float64
	if pageLightness < lightPageThreshold {
		chroma := unitRange((accentChroma - 0.08) / 0.12)
		light := unitRange((accentLightness - 0.45) / 0.30)
		ground := unitRange((lightPageThreshold - pageLightness) / 0.25)
		glow = clampFloat(chroma*light*ground*0.99, 0.15, 0.60, 0.15)
	} else {
		chroma := unitRange((accentChroma - 0.06) / 0.12)
		depth := unitRange((0.62 - accentLightness) / 0.30)
		glow = clampFloat(chroma*depth*0.70, 0.12, 0.35, 0.12)
	}
	return formatFloat(archetypeScaleGlow(tc, math.Round(glow*100)/100))
}

/*
lightPageThreshold is where a page stops being dark, in OKLCH lightness.

One constant for both questions a glow asks of the page -- how much, and which
shape -- so the branch themeSurfaceGlow takes and the word themeGlowMode
writes can never disagree about a theme.
*/
const lightPageThreshold = 0.45

/*
themeGlowLift says which of the two glow geometries a theme spends its glow
on: 1 is a halo around the surface, 0 a shadow tinted underneath it.

The stylesheet cannot work this out for itself -- CSS can mix a colour but it
cannot ask how light one is. It arrives as a number rather than as a word
because CSS cannot branch on what a variable says either: a word would have to
be matched somewhere, and there is nothing to match it against. A number the
lengths can be interpolated with needs no matching at all.

A page whose colour cannot be read is treated as dark, which is what the
themes that ship a malformed background look like anyway: the glow itself is
zero there, so the geometry is never spent.
*/
func themeGlowLift(tc ThemeColors) string {
	// An archetype may insist: neon is always a halo and velvet always a
	// shadow, on any page. Everything else leaves the question to the page.
	if lift := archetypeGlowLift(tc); lift >= 0 {
		return strconv.Itoa(lift)
	}
	pageLightness, _, ok := hexOklch(tc.BackgroundPrimary)
	if ok && pageLightness >= lightPageThreshold {
		return "0"
	}
	return "1"
}

// unitRange clamps to 0-1, which every one of the three factors above needs.
func unitRange(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

/*
hexOklch returns a hex colour's OKLCH lightness and chroma.

OKLab is worth the twenty lines here: it is the only space in this file where
"how much colour is this" and "how light is this" are separate questions with
honest answers. sRGB conflates them and HSL lies about both.
*/
func hexOklab(color string) (lightness, a, b float64, ok bool) {
	h := strings.TrimSpace(color)
	if !strings.HasPrefix(h, "#") {
		return 0, 0, 0, false
	}
	h = h[1:]
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return 0, 0, 0, false
	}
	linear := func(part string) (float64, bool) {
		v, err := strconv.ParseUint(part, 16, 16)
		if err != nil {
			return 0, false
		}
		c := float64(v) / 255
		if c <= 0.04045 {
			return c / 12.92, true
		}
		return math.Pow((c+0.055)/1.055, 2.4), true
	}
	r, okR := linear(h[0:2])
	g, okG := linear(h[2:4])
	blue, okB := linear(h[4:6])
	if !okR || !okG || !okB {
		return 0, 0, 0, false
	}
	l := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*blue)
	m := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*blue)
	s := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*blue)
	return 0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
		1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
		0.0259040371*l + 0.7827717662*m - 0.8086757660*s,
		true
}

/*
The same colour as lightness and chroma, which is what most callers want.

Kept as its own function rather than folded into hexOklab: three of the four
readers here care about how light and how colourful a colour is and not at all
about which colour it is, and a third return value they would each discard
reads as though the hue mattered to them.
*/
func hexOklch(color string) (lightness, chroma float64, ok bool) {
	l, a, b, good := hexOklab(color)
	if !good {
		return 0, 0, false
	}
	return l, math.Hypot(a, b), true
}

/*
And as a hue, in degrees.

Only meaningful once there is chroma to have a hue of: a neutral grey reports
whatever the rounding left in a and b, which is why every caller here checks
the chroma before it asks.
*/
func hexOklchHue(color string) (float64, bool) {
	_, a, b, ok := hexOklab(color)
	if !ok {
		return 0, false
	}
	deg := math.Atan2(b, a) * 180 / math.Pi
	if deg < 0 {
		deg += 360
	}
	return deg, true
}

/*
The character fields, rendered.

Everything here is a number or one of a fixed set of words -- nothing a theme
writes reaches CSS unchecked. That is deliberate and it is the whole reason
these are typed fields rather than a block of CSS a theme hands over: the
sanitising is a clamp, not a parser.

Each zero value renders as today's behaviour, so a theme that says nothing
about its character gets the character every theme has now.
*/

/*
clampFloat holds a number inside a range, answering with the fallback when the
field is unset.

Unset is zero, because that is what an absent JSON number decodes to and there
is no way to tell it from a written 0. That is fine for three of the four
fields, whose fallback is 0 anyway. For RadiusScale it means a theme cannot ask
for exactly square by writing 0 -- it writes 0.05, which is the bottom of the
range and lands every corner under half a pixel.
*/
func clampFloat(v, min, max, fallback float64) float64 {
	if math.IsNaN(v) || v <= 0 {
		return fallback
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// formatFloat writes a number the way CSS wants it: no trailing zeroes, no
// exponent, and always something -- never an empty string that would make the
// declaration around it invalid.
func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// themeLabelTransform is one of three words. Anything else is "none", which is
// what a theme that never mentioned it gets.
func themeLabelTransform(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "uppercase":
		return "uppercase"
	case "lowercase":
		return "lowercase"
	default:
		return "none"
	}
}

/*
themeLabelSpacing accepts a letter-spacing in em and nothing else.

em rather than px because the category title scales with the font-size setting
and its spacing has to scale with it. Bounded at a quarter em: past that the
title stops being a word and becomes a row of letters. "normal" is the CSS
default and what an unset field renders as.
*/
func themeLabelSpacing(value string) string {
	raw := strings.ToLower(strings.TrimSpace(value))
	if raw == "" || raw == "normal" {
		return "normal"
	}
	if !strings.HasSuffix(raw, "em") {
		return "normal"
	}
	number, err := strconv.ParseFloat(strings.TrimSuffix(raw, "em"), 64)
	if err != nil || math.IsNaN(number) {
		return "normal"
	}
	if number < -0.05 {
		number = -0.05
	}
	if number > 0.25 {
		number = 0.25
	}
	return formatFloat(number) + "em"
}

// themeLabelWeight keeps the category title inside the weights the packaged
// fonts actually carry. Outside 400-800 a browser rounds to the nearest one it
// has, which makes a theme's choice depend on which font the reader picked.
func themeLabelWeight(weight int) string {
	if weight < 400 || weight > 800 {
		return "700"
	}
	return strconv.Itoa(weight - weight%100)
}

/*
themeBackdropImage builds the backdrop a theme is drawn on.

Every theme gets one and no two are alike, without anybody having to draw two
hundred backgrounds: the shape is picked from the theme's own id and the colours
come from its own palette, mixed down to the point where they read as
atmosphere rather than decoration. A theme that is all greens gets a green
backdrop; one built around a magenta accent gets a magenta one. The same id
always lands on the same backdrop, so a theme does not change appearance
between releases -- except for one deliberate case, described next.

A "-light" and "-dark" pair are two colourings of one theme, not two themes,
and a reader switching Quick mode between them should see the same shape
change colour, not a different shape entirely. Hashing each variant's own id
independently broke that: the two ids differ, so they landed on different
recipes for 111 of the 224 built-in themes. Before hashing, a "-dark" id is
therefore normalised to its "-light" counterpart, so the pair always shares a
recipe. The light variant leads because it is the one already shipped for
every pair; stripping the suffix instead of substituting it would have hashed
the bare base name and moved both variants onto a third recipe, changing 222
themes instead of 111. An id with no such suffix -- the plain "light" and
"dark" defaults, and any custom theme -- is not part of a pair and keeps
hashing exactly as before.

The result is a CSS background-image list, referencing the custom properties
declared in the same block. It is composed here rather than declared in the
theme because sanitizeCSSColor (security.go) accepts only flat colours by
design, and widening that to arbitrary gradients would mean parsing untrusted
CSS. Generated on our side there is nothing to parse: every value below is a
number this function chose.

Nine recipes, in the order the hash reaches them. They differ in kind and not
only in angle -- blooms, sweeps, wireframes, rings, scanlines -- because eight
variations on one gradient would still read as one background.
*/
func themeBackdropImage(themeID string, tc ThemeColors) string {
	h := fnv32(themeBackdropHashID(themeID))
	recipe := pick23(h)
	if chosen := themeBackdropRecipeIndex(archetypeBackdrop(tc)); chosen >= 0 {
		recipe = chosen
	}
	pick := func(shift uint, span int) int {
		if span <= 0 {
			return 0
		}
		return int((h >> shift) % uint32(span))
	}

	accent := "var(--accent-primary)"
	second := "var(--accent-error)"
	if tc.AccentPrimary == "" {
		accent = "var(--accent-success)"
	}

	// Mixed against the page rather than transparent: over a light theme a
	// translucent accent turns milky, over a dark one it glows. Mixing with the
	// theme's own background keeps a backdrop the same weight either way.
	wash := func(color string, pct int) string {
		return "color-mix(in srgb, " + color + " " + strconv.Itoa(pct) + "%, var(--background-primary))"
	}
	veil := func(color string, pct int) string {
		return "color-mix(in srgb, " + color + " " + strconv.Itoa(pct) + "%, transparent)"
	}

	angle := 15 + pick(3, 150)
	x1, y1 := 4+pick(7, 34), pick(11, 22)
	x2, y2 := 62+pick(13, 34), pick(17, 26)
	base := "linear-gradient(" + strconv.Itoa(160+pick(19, 40)) + "deg, " +
		wash(accent, 6) + " 0%, var(--background-primary) 68%)"

	switch recipe {
	case 0: // twee zachte blooms, de vorm van de referentie
		return "radial-gradient(120% 88% at " + pct(x1) + " " + pct(y1) + ", " + veil(second, 26) + " 0%, transparent 56%), " +
			"radial-gradient(110% 80% at " + pct(x2) + " " + pct(y2) + ", " + veil(accent, 24) + " 0%, transparent 60%), " + base
	case 1: // brede sweep vanuit een hoek
		return "conic-gradient(from " + strconv.Itoa(angle) + "deg at " + pct(x1) + " -10%, " +
			veil(accent, 22) + " 0deg, transparent 140deg, " + veil(second, 16) + " 300deg, transparent 360deg), " + base
	case 2: // wireframe: twee sets dunne lijnen onder een hoek
		return "repeating-linear-gradient(" + strconv.Itoa(angle) + "deg, " + veil(accent, 12) + " 0 1px, transparent 1px " + strconv.Itoa(38+pick(2, 24)) + "px), " +
			"repeating-linear-gradient(" + strconv.Itoa(-angle/2) + "deg, " + veil(accent, 8) + " 0 1px, transparent 1px " + strconv.Itoa(46+pick(5, 28)) + "px), " + base
	case 3: // gloed van onderaf, vignet eromheen
		return "radial-gradient(150% 70% at 50% 108%, " + veil(accent, 26) + " 0%, transparent 62%), " +
			"radial-gradient(120% 120% at 50% 50%, transparent 42%, " + veil(second, 12) + " 100%), " + base
	case 4: // diagonale band
		return "linear-gradient(" + strconv.Itoa(angle) + "deg, transparent 0%, " + veil(accent, 20) + " " + pct(28+pick(2, 20)) + ", transparent " + pct(64+pick(5, 18)) + "), " + base
	case 5: // concentrische ringen
		return "repeating-radial-gradient(circle at " + pct(x1) + " " + pct(y1) + ", " +
			veil(accent, 9) + " 0 1px, transparent 1px " + strconv.Itoa(52+pick(2, 40)) + "px), " + base
	case 6: // scanlijnen met een bloom bovenin
		return "repeating-linear-gradient(0deg, " + veil(accent, 10) + " 0 1px, transparent 1px 3px), " +
			"radial-gradient(120% 96% at 50% 0%, " + veil(accent, 18) + " 0%, transparent 66%), " + base
	case 7: // kruisarcering
		return "repeating-linear-gradient(45deg, " + veil(accent, 8) + " 0 1px, transparent 1px " + strconv.Itoa(14+pick(2, 12)) + "px), " +
			"repeating-linear-gradient(-45deg, " + veil(second, 6) + " 0 1px, transparent 1px " + strconv.Itoa(16+pick(5, 14)) + "px), " + base
	default: // horizon: een lichte band met een donkere grond
		return "linear-gradient(" + strconv.Itoa(178+pick(2, 6)) + "deg, " + veil(accent, 16) + " 0%, transparent " + pct(34+pick(5, 16)) + "), " +
			"radial-gradient(140% 60% at " + pct(x2) + " 100%, " + veil(second, 18) + " 0%, transparent 58%), " + base
	}
}

// themeBackdropRecipes names the nine recipes above, in their switch order, so
// a theme can pick one instead of taking the one its id hashes to.
var themeBackdropRecipes = []string{
	"blooms", "sweep", "wireframe", "glow", "band", "rings", "scanlines", "crosshatch", "horizon",
}

// themeBackdropRecipeIndex is the recipe a name stands for, or -1.
func themeBackdropRecipeIndex(name string) int {
	name = strings.ToLower(strings.TrimSpace(name))
	for i, known := range themeBackdropRecipes {
		if name == known {
			return i
		}
	}
	return -1
}

// pick23 is the recipe an id hashes to: the same bits pick() reads for it.
func pick23(h uint32) int {
	return int((h >> 23) % uint32(len(themeBackdropRecipes)))
}

// themeBackdropHashID maps a "-dark" theme id onto its "-light" counterpart so
// themeBackdropImage hashes both to the same recipe. Anything else -- an id
// with no such suffix, including the plain "light" and "dark" defaults and
// every custom theme -- passes through unchanged.
func themeBackdropHashID(themeID string) string {
	const darkSuffix = "-dark"
	if strings.HasSuffix(themeID, darkSuffix) {
		return strings.TrimSuffix(themeID, darkSuffix) + "-light"
	}
	return themeID
}

// pct renders an integer as a CSS percentage, which the recipes above need in
// enough places to be worth a name.
func pct(v int) string {
	return strconv.Itoa(v) + "%"
}

// fnv32 is FNV-1a. Any stable hash would do; what matters is that a theme id
// always reaches the same recipe, on every install and every release.
func fnv32(s string) uint32 {
	const (
		offset = 2166136261
		prime  = 16777619
	)
	hash := uint32(offset)
	for i := 0; i < len(s); i++ {
		hash ^= uint32(s[i])
		hash *= prime
	}
	return hash
}

/*
themeInkDirection says which way the derived ink in theme-ink.css moves away
from the surface it sits on: up in a dark theme, down in a light one.

Computed from the relative luminance of background-primary rather than read off
the theme id, because a theme somebody made themselves has no "-dark" or
"-light" in its name and still needs the right answer. A colour this cannot
parse -- a named colour, an rgb() or hsl(), anything sanitizeCSSColor lets
through that is not hex -- falls back to +1, which is the direction the default
theme wants and the one nearly every theme in the register wants.
*/
func themeInkDirection(background string) string {
	if lum, okColor := hexLuminance(background); okColor && lum > 0.42 {
		return "-1"
	}
	return "1"
}

// hexLuminance returns the WCAG relative luminance of a #rgb or #rrggbb colour.
func hexLuminance(color string) (float64, bool) {
	h := strings.TrimSpace(color)
	if !strings.HasPrefix(h, "#") {
		return 0, false
	}
	h = h[1:]
	if len(h) == 3 {
		h = string([]byte{h[0], h[0], h[1], h[1], h[2], h[2]})
	}
	if len(h) != 6 {
		return 0, false
	}
	channel := func(part string) (float64, bool) {
		v, err := strconv.ParseUint(part, 16, 16)
		if err != nil {
			return 0, false
		}
		c := float64(v) / 255
		if c <= 0.04045 {
			return c / 12.92, true
		}
		return math.Pow((c+0.055)/1.055, 2.4), true
	}
	r, okR := channel(h[0:2])
	g, okG := channel(h[2:4])
	b, okB := channel(h[4:6])
	if !okR || !okG || !okB {
		return 0, false
	}
	return 0.2126*r + 0.7152*g + 0.0722*b, true
}

func renderThemeCSSBlock(selector string, tc ThemeColors) string {
	s := sanitizeThemeColors(tc)
	/*
	 * The theme's own colour, or the success colour when it has none.
	 *
	 * Resolved here rather than at the call site so every path that renders a
	 * theme — built-in, custom, light, dark — gets the same answer, and so a
	 * theme file written before AccentPrimary existed keeps the accent it has
	 * always had instead of losing it.
	 */
	accentPrimary := s.AccentPrimary
	if accentPrimary == "" {
		accentPrimary = s.AccentSuccess
	}
	// Resolved here rather than inline below so the archetype is consulted
	// once per theme and the block stays a list of tokens.
	labelTransform, labelSpacing, labelWeight := archetypeLabel(tc)
	grainAngle, grainScale := archetypeGrain(tc)
	return `html[data-theme="` + selector + `"] {
    --text-primary: ` + s.TextPrimary + `;
    --text-secondary: ` + s.TextSecondary + `;
    --text-tertiary: ` + s.TextTertiary + `;
    --background-primary: ` + s.BackgroundPrimary + `;
    --background-secondary: ` + s.BackgroundSecondary + `;
    --background-dots: ` + s.BackgroundDots + `;
    --background-modal: ` + s.BackgroundModal + `;
    --border-primary: ` + s.BorderPrimary + `;
    --border-secondary: ` + s.BorderSecondary + `;
    --accent-success: ` + s.AccentSuccess + `;
    --accent-primary: ` + accentPrimary + `;
    --accent-warning: ` + s.AccentWarning + `;
    --accent-error: ` + s.AccentError + `;
    --accent-info: ` + themeAccentInfo(tc) + `;
    --ink-dir: ` + themeInkDirection(s.BackgroundPrimary) + `;
    --theme-backdrop: ` + themeBackdropImage(selector, s) + `;
    --theme-surface-alpha: ` + themeSurfaceAlpha(tc) + `;
    --theme-surface-blur: ` + themeSurfaceBlur(tc) + `px;
    --theme-surface-glow: ` + themeSurfaceGlow(tc) + `;
    --theme-surface-step: ` + themeSurfaceStep(tc) + `;
    --theme-glow-lift: ` + themeGlowLift(tc) + `;
    --theme-radius-scale: ` + formatFloat(archetypeRadius(tc)) + `;
    --theme-sheen: ` + formatFloat(archetypeSheen(tc)) + `;
    --theme-grain-angle: ` + formatFloat(grainAngle) + `deg;
    --theme-grain-scale: ` + formatFloat(grainScale) + `;
    --theme-label-transform: ` + themeLabelTransform(labelTransform) + `;
    --theme-label-spacing: ` + themeLabelSpacing(labelSpacing) + `;
    --theme-label-weight: ` + themeLabelWeight(labelWeight) + `;
}
`
}

func (h *Handlers) CustomThemeCSS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write([]byte(h.customThemeCSS()))
}

// customThemeCSS is the same stylesheet the endpoint serves. Split out so the
// page can carry it inline — it is generated per install and served no-store,
// so as a link it was one uncacheable blocking request before every first paint.
// The endpoint stays: switching a theme reloads it, and it is the one path that
// must not depend on a page render.
func (h *Handlers) customThemeCSS() string {
	colors := h.store.GetColors()

	// Built with a Builder: this renders ~150 theme blocks and the += version
	// reallocated and copied the whole (76 KB) string on every one of them, on
	// every dashboard load.
	var b strings.Builder
	b.Grow(96 << 10)
	b.WriteString("/* Custom Theme Variables - Loaded from colors.json */\n\n")
	b.WriteString("/* Light Theme Variables */\n")
	b.WriteString(renderThemeCSSBlock("light", colors.Light))
	b.WriteString("\n")
	b.WriteString("/* Dark Theme Variables */\n")
	b.WriteString(renderThemeCSSBlock("dark", colors.Dark))
	b.WriteString("\n")

	// Add custom themes CSS
	for themeID, themeColors := range colors.Custom {
		safeID := sanitizeCSSIdent(themeID)
		if safeID == "" {
			continue
		}
		b.WriteString("/* Custom Theme: ")
		b.WriteString(safeID)
		b.WriteString(" */\n")
		b.WriteString(renderThemeCSSBlock(safeID, themeColors))
		b.WriteString("\n")
	}

	// Add built-in themes CSS
	builtInThemeIDs := make([]string, 0, len(colors.BuiltIn))
	for themeID := range colors.BuiltIn {
		builtInThemeIDs = append(builtInThemeIDs, themeID)
	}
	sort.Strings(builtInThemeIDs)
	for _, themeID := range builtInThemeIDs {
		safeID := sanitizeCSSIdent(themeID)
		if safeID == "" {
			continue
		}
		b.WriteString("/* Built-in Theme: ")
		b.WriteString(safeID)
		b.WriteString(" */\n")
		b.WriteString(renderThemeCSSBlock(safeID, colors.BuiltIn[themeID]))
		b.WriteString("\n")
	}

	return b.String()
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func findURLDuplicateGroups(pages []Page, getBookmarks func(pageID int) []Bookmark) []DuplicateGroup {
	duplicates := make(map[string][]BookmarkRef)
	for _, page := range pages {
		bookmarks := getBookmarks(page.ID)
		for idx, bm := range bookmarks {
			key := canonicalBookmarkURLKey(bm.URL)
			if key == "" {
				continue
			}
			duplicates[key] = append(duplicates[key], BookmarkRef{
				Name:     bm.Name,
				Index:    idx,
				PageID:   page.ID,
				Category: bm.Category,
			})
		}
	}

	var duplicateGroups []DuplicateGroup
	for url, refs := range duplicates {
		if len(refs) > 1 {
			duplicateGroups = append(duplicateGroups, DuplicateGroup{
				URL:       url,
				Bookmarks: refs,
			})
		}
	}
	return duplicateGroups
}

// Duplicate detection endpoint
func (h *Handlers) CheckDuplicates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	warning := DuplicateWarning{
		DuplicateURLs: findURLDuplicateGroups(h.store.GetPages(), h.store.GetBookmarksByPage),
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(warning)
}

func (h *Handlers) outboundHTTPClient(timeout time.Duration, maxRedirects int) *http.Client {
	return newOutboundHTTPClient(h.allowLocalBookmarks(), timeout, maxRedirects)
}

func (h *Handlers) requireSSRFAPIRateLimit(w http.ResponseWriter, r *http.Request) bool {
	if h.ssrfAPILimiter == nil || h.ssrfAPILimiter.allow(clientIP(r)) {
		return true
	}
	logRateLimitHit(r, r.URL.Path)
	w.Header().Set("Retry-After", "60")
	http.Error(w, "Too many requests", http.StatusTooManyRequests)
	return false
}

func (h *Handlers) requireStatusPingRateLimit(w http.ResponseWriter, r *http.Request) bool {
	if h.statusPingLimiter == nil || h.statusPingLimiter.allow(clientIP(r)) {
		return true
	}
	logRateLimitHit(r, r.URL.Path)
	w.Header().Set("Retry-After", "60")
	http.Error(w, "Too many requests", http.StatusTooManyRequests)
	return false
}

func (h *Handlers) fetchBookmarkPreview(ctx context.Context, rawURL string, cache *PreviewCacheFile, useCache bool) BookmarkPreview {
	if ctx == nil {
		ctx = context.Background()
	}
	rawURL = strings.TrimSpace(rawURL)
	if err := validateHTTPURL(rawURL, h.allowLocalBookmarks()); err != nil {
		return BookmarkPreview{URL: rawURL, FetchedAt: time.Now().UnixMilli()}
	}
	cacheKey := canonicalBookmarkURLKey(rawURL)
	if useCache && cache != nil {
		if entry, ok := cache.Cache[cacheKey]; ok {
			if time.Now().UnixMilli()-entry.FetchedAt < previewCacheTTLMs {
				// Queued here too, not only on a miss: an entry whose file was
				// evicted, cleared or never restored from a backup still knows
				// where it came from, and this is where it heals.
				h.queuePreviewMediaFetch(cacheKey, entry)
				return entry
			}
		}
	}

	preview := BookmarkPreview{
		URL:       rawURL,
		Domain:    extractDomain(rawURL),
		FetchedAt: time.Now().UnixMilli(),
	}

	client := h.outboundHTTPClient(8*time.Second, 5)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return preview
	}
	req.Header.Set("User-Agent", "nextDash PreviewBot/1.0")

	resp, err := client.Do(req)
	if err != nil || resp == nil {
		return preview
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// An error page still has a <title> and og: tags — parsing it would
		// cache a plausible-looking preview for a link that is actually
		// dead, masking exactly the breakage the health checker exists to
		// surface.
		return preview
	}

	if resp.Request != nil && resp.Request.URL != nil {
		preview.URL = resp.Request.URL.String()
		preview.Domain = extractDomain(preview.URL)
	}

	/*
	 * Read to </head> rather than to a fixed byte count. Metadata lives in the
	 * head, and where that ends varies by three orders of magnitude across real
	 * pages -- see readDocumentHead. A further previewBodySample is taken for
	 * ContentLength, which measures prose rather than tags.
	 */
	headBytes, overRead, err := readDocumentHeadAndRest(resp.Body, previewMaxHead)
	if err != nil {
		return preview
	}
	bodySample, _ := io.ReadAll(io.LimitReader(resp.Body, previewBodySample))

	htmlBody := string(headBytes)
	preview.Title = h.extractTitleFromHTML(htmlBody)
	if preview.Title == "" {
		preview.Title = h.extractMetaFromHTML(htmlBody, "property", "og:title")
	}
	preview.Description = h.extractMetaFromHTML(htmlBody, "name", "description")
	if preview.Description == "" {
		preview.Description = h.extractMetaFromHTML(htmlBody, "property", "og:description")
	}
	// Into the *Source fields, not Image and Icon: those hold a local path once
	// the media has been fetched, and never the remote address. Handing the
	// remote one to the card would have it load the third party directly, which
	// is what caching these is meant to stop.
	preview.ImageSource = h.extractMetaFromHTML(htmlBody, "property", "og:image")
	if preview.ImageSource != "" {
		preview.ImageSource = h.resolveRelativeURL(preview.URL, preview.ImageSource)
	}
	preview.IconSource = h.extractIconFromHTML(htmlBody)
	if preview.IconSource != "" {
		preview.IconSource = h.resolveRelativeURL(preview.URL, preview.IconSource)
	}

	/*
	 * Carry the pictures we already have across a re-parse.
	 *
	 * A preview expires after a week and is parsed again, and a fresh struct
	 * has no media fields -- so every expiry re-downloaded the image whether or
	 * not the page still points at the same one. Refreshing the whole
	 * collection once then lined every bookmark up to reach out again on the
	 * same day, a week later.
	 *
	 * Only when the address is unchanged: a page that now advertises a
	 * different og:image gets that one, immediately.
	 */
	if cache != nil {
		if previous, ok := cache.Cache[cacheKey]; ok {
			if previous.ImageSource == preview.ImageSource {
				preview.Image = previous.Image
				preview.ImageFetchedAt = previous.ImageFetchedAt
			}
			if previous.IconSource == preview.IconSource {
				preview.Icon = previous.Icon
				if preview.ImageFetchedAt == 0 {
					preview.ImageFetchedAt = previous.ImageFetchedAt
				}
			}
		}
	}

	// The page's own feed, if it advertises one. Recorded even when feed polling
	// is switched off: reading it out of a <head> that has already been fetched
	// costs nothing, and it means turning Fresh on later does not have to
	// re-fetch every page before it can say anything.
	if feedURL := extractFeedFromHTML(htmlBody); feedURL != "" {
		recordDiscoveredFeed(rawURL, h.resolveRelativeURL(preview.URL, feedURL))
	}

	/*
	 * What else the page says about itself.
	 *
	 * All of it read from the document already in hand: no extra request, no
	 * extra host contacted. The publisher's own name rather than its domain,
	 * a byline and a date where the page states them, and the length of the
	 * readable text -- which is not for display but is the second soft-404
	 * signal, the one that sees pages that lost their article without saying so.
	 */
	preview.SiteName = extractSiteName(htmlBody, preview.Title)
	preview.Author = extractAuthor(htmlBody)
	preview.PublishedAt = extractPublishedAt(htmlBody)
	preview.ContentLength = readableTextLength(string(bodySample))
	/*
	 * The head for the meta tags, the start of the body for the h1.
	 *
	 * overRead is what the chunked head read had already taken off the wire
	 * past </head> -- usually the first stretch of the body, which is where an
	 * h1 lives. bodySample starts after that, so the two together are the
	 * page's opening. ContentLength deliberately still measures bodySample
	 * alone: it is the soft-404 signal, and widening what it counts would
	 * change a threshold that has nothing to do with keywords.
	 */
	preview.Keywords = extractKeywords(htmlBody, string(overRead)+string(bodySample))
	preview.KeywordsAt = preview.FetchedAt

	/*
	 * oEmbed, when the page advertises it.
	 *
	 * One more request, and only for the pages that offer one -- which is the
	 * providers with a player worth showing. Discovered from the document
	 * rather than matched against a bundled provider list; see preview_oembed.go.
	 */
	if endpoint := discoverOEmbedURL(htmlBody, preview.URL); endpoint != "" {
		if data, ok := h.fetchOEmbed(ctx, endpoint); ok {
			applyOEmbed(&preview, data)
		}
	}

	if cache != nil {
		if cache.Cache == nil {
			cache.Cache = make(map[string]BookmarkPreview)
		}
		cache.Cache[cacheKey] = preview
	}
	// After the cache is written, so the worker's own write lands on top of this
	// entry rather than being overwritten by it.
	h.queuePreviewMediaFetch(cacheKey, preview)
	return preview
}

func bookmarkHasPreviewMetadata(bm Bookmark) bool {
	return strings.TrimSpace(bm.PreviewTitle) != "" ||
		strings.TrimSpace(bm.PreviewDesc) != "" ||
		strings.TrimSpace(bm.PreviewImage) != ""
}

func applyPreviewToBookmark(bm *Bookmark, preview BookmarkPreview) {
	bm.PreviewTitle = strings.TrimSpace(preview.Title)
	bm.PreviewDesc = strings.TrimSpace(preview.Description)
	// No image: the preview cache owns cached media, and a bookmark holding its
	// own copy of the address is how the card ended up loading the third party
	// directly. This runs while the media fetch is still queued anyway, so
	// there would be no local path to write here even if it did.
	bm.PreviewImage = ""
}

// stripBookmarkPreviewImages clears the image every bookmark used to carry.
//
// The value was the remote address, and the card's shortcut path builds its
// picture from the bookmark without asking the server -- so these kept loading
// the third party after the cache was in place. Returns how many were cleared.
func stripBookmarkPreviewImages(bookmarks []Bookmark) int {
	stripped := 0
	for i := range bookmarks {
		if bookmarks[i].PreviewImage == "" {
			continue
		}
		bookmarks[i].PreviewImage = ""
		stripped++
	}
	return stripped
}

func clearBookmarkPreviewFields(bm *Bookmark) {
	bm.PreviewTitle = ""
	bm.PreviewDesc = ""
	bm.PreviewImage = ""
}

// Get bookmark preview metadata
func (h *Handlers) GetBookmarkPreview(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	if !h.requireSSRFAPIRateLimit(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "URL required"})
		return
	}
	if err := validateHTTPURL(rawURL, h.allowLocalBookmarks()); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	cacheKey := canonicalBookmarkURLKey(rawURL)
	forceRefresh := strings.EqualFold(r.URL.Query().Get("refresh"), "1") ||
		strings.EqualFold(r.URL.Query().Get("refresh"), "true")
	if !forceRefresh {
		if cached, ok := h.getPreviewCacheEntry(cacheKey); ok {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(cached)
			return
		}
	}

	localCache := &PreviewCacheFile{Cache: make(map[string]BookmarkPreview)}
	preview := h.fetchBookmarkPreview(r.Context(), rawURL, localCache, false)
	_ = h.mergePreviewCacheUpdates(localCache.Cache)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(preview)
}

// ClearAllBookmarkPreviews removes stored preview metadata from every bookmark and empties the server cache.
func (h *Handlers) ClearAllBookmarkPreviews(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	cleared := 0
	for _, page := range h.store.GetPages() {
		pageCleared := 0
		err := h.store.MutateBookmarksOnPage(page.ID, func(bookmarks []Bookmark) ([]Bookmark, error) {
			for i := range bookmarks {
				if !bookmarkHasPreviewMetadata(bookmarks[i]) {
					continue
				}
				clearBookmarkPreviewFields(&bookmarks[i])
				pageCleared++
			}
			return bookmarks, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			if !respondBookmarkMutationError(w, err) {
				return
			}
		}
		cleared += pageCleared
	}

	if !respondStorePersistError(w, h.replacePreviewCache(PreviewCacheFile{Cache: map[string]BookmarkPreview{}})) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "completed",
		"cleared": cleared,
	})
}

// RefreshAllBookmarkPreviews re-fetches preview metadata for every bookmark with a URL.
func (h *Handlers) RefreshAllBookmarkPreviews(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
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

	/*
	 * Refreshed in batches, because this is one page fetch per bookmark.
	 *
	 * It used to do the whole collection inside a single request: measured
	 * against eight seeded bookmarks that was 1.3 seconds, so a real collection
	 * of five hundred is well over a minute with nothing moving on screen and a
	 * proxy free to time the request out halfway through. Neither the browser
	 * nor the reader had any way to know how far it had got.
	 *
	 * With an offset and a total the caller can walk the collection and draw a
	 * real bar -- "120 of 500" -- the same shape the favicon prefetch already
	 * uses, and each round trip is short enough to survive any proxy.
	 *
	 * No offset means the old behaviour: the whole collection at once, which is
	 * what the extension and any existing script still expect.
	 */
	type previewTarget struct {
		pageID int
		url    string
	}
	var targets []previewTarget
	for _, page := range h.store.GetPages() {
		for _, bm := range h.store.GetBookmarksByPage(page.ID) {
			if strings.TrimSpace(bm.URL) == "" {
				continue
			}
			targets = append(targets, previewTarget{pageID: page.ID, url: strings.TrimSpace(bm.URL)})
		}
	}

	total := len(targets)
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			offset = parsed
		}
	}
	limit := total
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := targets[offset:end]

	cache := PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	refreshed := 0
	skipped := total - len(targets)

	// Grouped by page so each page is written once rather than per bookmark.
	byPage := map[int]map[string]BookmarkPreview{}
	for _, target := range slice {
		preview := h.fetchBookmarkPreview(r.Context(), target.url, &cache, false)
		key := canonicalBookmarkURLKey(target.url)
		if key == "" {
			skipped++
			continue
		}
		if byPage[target.pageID] == nil {
			byPage[target.pageID] = map[string]BookmarkPreview{}
		}
		byPage[target.pageID][key] = preview
		refreshed++
	}

	for pageID, previewByKey := range byPage {
		err := h.store.MutateBookmarksOnPage(pageID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				key := canonicalBookmarkURLKey(current[i].URL)
				if key == "" {
					continue
				}
				if preview, ok := previewByKey[key]; ok {
					applyPreviewToBookmark(&current[i], preview)
				}
			}
			return current, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			if !respondBookmarkMutationError(w, err) {
				return
			}
		}
	}

	if !respondStorePersistError(w, h.mergePreviewCacheUpdates(cache.Cache)) {
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":    "completed",
		"total":     total,
		"offset":    offset,
		"next":      end,
		"done":      end >= total,
		"refreshed": refreshed,
		"skipped":   skipped,
	})
}

func extractDomain(url string) string {
	if strings.HasPrefix(url, "http://") {
		url = url[7:]
	} else if strings.HasPrefix(url, "https://") {
		url = url[8:]
	}

	if idx := strings.Index(url, "/"); idx != -1 {
		url = url[:idx]
	}

	return url
}

func (h *Handlers) extractTitleFromHTML(htmlBody string) string {
	lower := strings.ToLower(htmlBody)
	titleOpen := strings.Index(lower, "<title")
	if titleOpen < 0 {
		return ""
	}
	startRel := strings.Index(lower[titleOpen:], ">")
	if startRel < 0 {
		return ""
	}
	contentStart := titleOpen + startRel + 1
	endRel := strings.Index(lower[contentStart:], "</title>")
	if endRel < 0 {
		return ""
	}
	// Text in the source, so escaped like any other: "Q&amp;A" is "Q&A" on
	// the page. The meta values below were already decoded; the title was not,
	// and every reader printed the entity as written.
	title := strings.TrimSpace(html.UnescapeString(htmlBody[contentStart : contentStart+endRel]))
	if title == "" {
		return ""
	}
	return strings.Join(strings.Fields(title), " ")
}

func (h *Handlers) extractMetaFromHTML(htmlBody, attrName, attrValue string) string {
	lower := strings.ToLower(htmlBody)
	attrMatch := strings.ToLower(attrName) + "=\"" + strings.ToLower(attrValue) + "\""
	idx := strings.Index(lower, attrMatch)
	if idx < 0 {
		attrMatch = strings.ToLower(attrName) + "='" + strings.ToLower(attrValue) + "'"
		idx = strings.Index(lower, attrMatch)
	}
	if idx < 0 {
		return ""
	}

	tagStart := strings.LastIndex(lower[:idx], "<meta")
	if tagStart < 0 {
		return ""
	}
	tagEndRel := strings.Index(lower[idx:], ">")
	if tagEndRel < 0 {
		return ""
	}
	tag := htmlBody[tagStart : idx+tagEndRel]
	tagLower := strings.ToLower(tag)

	contentPos := strings.Index(tagLower, "content=")
	if contentPos < 0 {
		return ""
	}
	value := h.extractQuotedAttribute(tag[contentPos+8:])
	// An attribute's value is escaped in the source, so a page whose title
	// contains an apostrophe arrives as "GitHub&#39;s" — and the card, which
	// sets text rather than markup, would print the entity as written.
	value = html.UnescapeString(value)
	return strings.TrimSpace(strings.Join(strings.Fields(value), " "))
}

func (h *Handlers) extractIconFromHTML(htmlBody string) string {
	lower := strings.ToLower(htmlBody)
	start := 0
	for {
		linkIdx := strings.Index(lower[start:], "<link")
		if linkIdx < 0 {
			return ""
		}
		linkIdx += start
		endIdxRel := strings.Index(lower[linkIdx:], ">")
		if endIdxRel < 0 {
			return ""
		}
		tag := htmlBody[linkIdx : linkIdx+endIdxRel+1]
		tagLower := strings.ToLower(tag)
		if strings.Contains(tagLower, "rel=\"icon\"") ||
			strings.Contains(tagLower, "rel='icon'") ||
			strings.Contains(tagLower, "rel=\"shortcut icon\"") ||
			strings.Contains(tagLower, "rel='shortcut icon'") {
			hrefPos := strings.Index(tagLower, "href=")
			if hrefPos >= 0 {
				return strings.TrimSpace(h.extractQuotedAttribute(tag[hrefPos+5:]))
			}
		}
		start = linkIdx + endIdxRel + 1
	}
}

func (h *Handlers) extractQuotedAttribute(text string) string {
	if text == "" {
		return ""
	}
	quote := text[0]
	if quote == '"' || quote == '\'' {
		end := strings.IndexByte(text[1:], quote)
		if end >= 0 {
			return text[1 : 1+end]
		}
		return ""
	}
	// Unquoted attribute value fallback.
	end := strings.IndexAny(text, " \t\r\n>")
	if end < 0 {
		return text
	}
	return text[:end]
}

func (h *Handlers) resolveRelativeURL(baseURL, raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err == nil && u.IsAbs() {
		return raw
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return raw
	}
	rel, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	return base.ResolveReference(rel).String()
}

// Track bookmark opens for analytics
func (h *Handlers) TrackBookmarkOpen(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	w.Header().Set("Content-Type", "application/json")

	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	pageID, ok := parseIntFromAny(raw["pageId"])
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	index, ok := parseIntFromAny(raw["index"])
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	existing := h.store.GetBookmarksByPage(pageID)
	var bookmark Bookmark
	if index >= 0 && index < len(existing) {
		bookmark = existing[index]
	}

	if err := h.store.TrackBookmarkOpen(pageID, index); err != nil {
		if !respondBookmarkMutationError(w, err) {
			return
		}
	}

	// Cached JS in an open tab, or the browser extension, may still be
	// posting the old {pageId, index} shape, so these two are read loosely
	// and left absent rather than rejecting a request that lacks them.
	// logBookmarkOpen drops anything outside its allowlists.
	source, _ := raw["source"].(string)
	method, _ := raw["method"].(string)
	sessionID, _ := raw["sessionId"].(string)
	logBookmarkOpen(pageID, index, bookmark, source, method, sessionID, raw, r)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// trackOK decodes the body into a loose map and answers the two-line reply
// every one of these five endpoints gives — {"status":"ok"} on success, a
// bare 400 on a body that is not JSON at all. Every field inside is optional
// from here down: the corresponding log function is where each one is
// actually validated, and it drops rather than rejects.
func trackOK(w http.ResponseWriter, r *http.Request) (map[string]interface{}, bool) {
	w.Header().Set("Content-Type", "application/json")
	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return nil, false
	}
	return raw, true
}

func trackRespondOK(w http.ResponseWriter) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// TrackSearch records that a search was issued, how many results it found,
// and whether it ended in an open — the single best signal for a bookmark
// that should exist and does not.
func (h *Handlers) TrackSearch(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	raw, ok := trackOK(w, r)
	if !ok {
		return
	}
	query, _ := raw["query"].(string)
	resultCount, _ := parseIntFromAny(raw["resultCount"])
	opened, _ := raw["opened"].(bool)
	sessionID, _ := raw["sessionId"].(string)
	logSearchActivity(query, resultCount, opened, sessionID, r)
	trackRespondOK(w)
}

// TrackKeys records which keyboard shortcuts fired, aggregated by the client
// over an interval rather than one line per press.
func (h *Handlers) TrackKeys(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	raw, ok := trackOK(w, r)
	if !ok {
		return
	}
	counts := map[string]int{}
	if keys, ok := raw["keys"].(map[string]interface{}); ok {
		for key, value := range keys {
			if n, ok := parseIntFromAny(value); ok {
				counts[key] = n
			}
		}
	}
	sessionID, _ := raw["sessionId"].(string)
	logKeyActivity(counts, sessionID, r)
	trackRespondOK(w)
}

// TrackNav records a page switch, a category folding open or closed, or a
// layout change — whether the shape of the dashboard matches what people
// actually use.
func (h *Handlers) TrackNav(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	raw, ok := trackOK(w, r)
	if !ok {
		return
	}
	action, _ := raw["action"].(string)
	detail, _ := raw["detail"].(string)
	sessionID, _ := raw["sessionId"].(string)
	logNavActivity(action, detail, sessionID, r)
	trackRespondOK(w)
}

// TrackSession records that a dashboard tab loaded and which page it landed
// on, so later opens and searches from the same tab can be related to it.
func (h *Handlers) TrackSession(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	raw, ok := trackOK(w, r)
	if !ok {
		return
	}
	pageID, _ := parseIntFromAny(raw["pageId"])
	sessionID, _ := raw["sessionId"].(string)
	logSessionActivity(pageID, sessionID, r)
	trackRespondOK(w)
}

// TrackClientError records a JS error the page caught about itself — a
// widget broken only in one browser is invisible on the server otherwise.
func (h *Handlers) TrackClientError(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	raw, ok := trackOK(w, r)
	if !ok {
		return
	}
	message, _ := raw["message"].(string)
	stack, _ := raw["stack"].(string)
	script, _ := raw["script"].(string)
	sessionID, _ := raw["sessionId"].(string)
	logClientErrorActivity(message, stack, script, sessionID, r)
	trackRespondOK(w)
}

func parseIntFromAny(value interface{}) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case string:
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

// CacheScanResult persists a single ping result for later retrieval
func (h *Handlers) CacheScanResult(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		URL    string `json:"url"`
		Status string `json:"status"`
		PingMs int    `json:"pingMs"`
		Error  string `json:"error"`
		Code   int    `json:"code"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	key := canonicalBookmarkURLKey(req.URL)
	if key == "" {
		http.Error(w, "Invalid URL", http.StatusBadRequest)
		return
	}
	if !respondStorePersistError(w, h.mergeHealthCacheUpdates(map[string]HealthScanCache{
		key: {
			URL:         key,
			Status:      req.Status,
			PingMs:      req.PingMs,
			LastScanned: time.Now().UnixMilli(),
			Error:       req.Error,
		},
	})) {
		return
	}
	// A monitored bookmark also records the sample, so an on-demand check shows up
	// in the uptime, heartbeat and outage view straight away rather than waiting
	// for the next scheduled run.
	h.recordManualHealthSample(key, req.Status == "online", req.PingMs, req.Code, req.Error)
	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "cached"})
}

// UpdateBookmarkHealthStatus writes ping outcome back to bookmark health fields.
func (h *Handlers) UpdateBookmarkHealthStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID int    `json:"pageId"`
		Index  int    `json:"index"`
		URL    string `json:"url"`
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}
	if canonicalBookmarkURLKey(strings.TrimSpace(req.URL)) == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	err := h.mutateHealthBookmark(req.PageID, req.Index, req.URL, func(bookmark *Bookmark) error {
		detail := ""
		if strings.TrimSpace(req.Status) != "online" {
			detail = strings.TrimSpace(req.Error)
			if detail == "" {
				detail = "Unreachable"
			}
		}
		setBookmarkCheckResult(bookmark, time.Now().UnixMilli(), detail)
		return nil
	})
	if !respondBookmarkMutationError(w, err) {
		return
	}
	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}

// retestAllMaxBookmarks caps a single retest run. Each ping costs up to 3s and they
// run sequentially, so an uncapped run over a large collection would hold the request
// open for minutes. Callers see skippedOverLimit and can run again.
const retestAllMaxBookmarks = 250

// RetestAll runs ping checks on bookmarks marked with checkStatus=true. With
// scope=all it also tests bookmarks that have checkStatus off but a recorded
// error, so a row flagged broken can be cleared from the health page — those
// rows are otherwise unreachable, since the page exposes no checkStatus toggle.
func (h *Handlers) RetestAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
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

	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	includeFlagged := strings.EqualFold(scope, "all")

	result, err := h.runHealthRetest(r.Context(), includeFlagged, activitySourceFromRequest(r))
	if err != nil {
		if errors.Is(err, errHealthRetestPersist) {
			// A persistence failure has already been mapped for the client by the
			// callee's respond* helpers in older paths; here we just report 500.
			http.Error(w, "Failed to persist retest results", http.StatusInternalServerError)
			return
		}
		http.Error(w, "Failed to re-check bookmarks", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "completed",
		"count":            len(result.Results),
		"results":          result.Results,
		"skipped":          result.Skipped,
		"skippedOverLimit": result.SkippedOverLimit,
		"tested":           result.Tested,
		"scope":            map[bool]string{true: "all", false: "checked"}[includeFlagged],
	})
}

// errHealthRetestPersist wraps a failure to persist retest results, so callers can
// distinguish it from other errors when shaping their response.
var errHealthRetestPersist = errors.New("failed to persist health retest results")

// healthRetestResult holds the counts and per-bookmark outcomes of one retest run.
type healthRetestResult struct {
	Results          []map[string]interface{}
	Tested           int
	OnlineCount      int
	OfflineCount     int
	Skipped          int
	SkippedOverLimit int
}

// runHealthRetest pings the eligible bookmarks once and persists their status,
// shared by the RetestAll handler and the background recheck scheduler. When
// includeFlagged is true it also revisits bookmarks with checkStatus off but a
// stored error, so a broken row can be cleared. activitySource labels the batch in
// the activity log.
func (h *Handlers) runHealthRetest(ctx context.Context, includeFlagged bool, activitySource string) (healthRetestResult, error) {
	pages := h.store.GetPages()
	var res healthRetestResult
	healthUpdates := make(map[string]HealthScanCache)
	historyUpdates := make(map[string][]HealthSample)
	driftResults := make(map[string]PingResult)

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		type retestUpdate struct {
			lastError   string
			lastChecked int64
		}
		updatesByKey := make(map[string]retestUpdate)

		for _, bm := range bookmarks {
			// A bookmark with checkStatus off but a stored LastError is rendered broken
			// and scored -60, yet the default run never revisits it. Monitored
			// bookmarks are eligible too: "Retest all" should mean all, not "all
			// except the ones you watch most closely".
			eligible := bm.CheckStatus || bm.Monitor || (includeFlagged && strings.TrimSpace(bm.LastError) != "")
			if !eligible {
				res.Skipped++
				continue
			}
			if res.Tested >= retestAllMaxBookmarks {
				res.SkippedOverLimit++
				continue
			}

			result := h.pingURLExpecting(ctx, bm.URL, expectationFor(bm).withSoftNotFound(softNotFoundEnabled(h.store.GetSettings())))
			res.Tested++
			if result.Status == "online" {
				res.OnlineCount++
			} else {
				res.OfflineCount++
			}
			errMsg := ""
			if result.Status != "online" {
				errMsg = result.ErrorDetail
				if errMsg == "" {
					errMsg = "Unreachable"
				}
			}
			lastChecked := time.Now().UnixMilli()

			key := canonicalBookmarkURLKey(bm.URL)
			if key != "" {
				updatesByKey[key] = retestUpdate{
					lastError:   errMsg,
					lastChecked: lastChecked,
				}
				driftResults[key] = result
				healthUpdates[key] = HealthScanCache{
					URL:         key,
					Status:      result.Status,
					PingMs:      result.PingMs,
					LastScanned: lastChecked,
					Error:       errMsg,
				}
				// A monitored bookmark also records the sample, so a retest feeds
				// the uptime and heartbeat view instead of only the scan cache.
				// Collected here and written once at the end: one history write per
				// run rather than one per bookmark.
				if bm.Monitor {
					historyUpdates[key] = append(historyUpdates[key], HealthSample{
						T:      lastChecked,
						Up:     result.Status == "online",
						PingMs: result.PingMs,
						Code:   result.HTTPStatus,
						Fail:   failureClass(result.ErrorDetail),
					})
				}
			}

			res.Results = append(res.Results, map[string]interface{}{
				"name":   bm.Name,
				"url":    bm.URL,
				"status": result.Status,
				"pingMs": result.PingMs,
				"error":  errMsg,
			})
		}

		if len(updatesByKey) == 0 {
			continue
		}

		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
			for i := range current {
				// No CheckStatus filter here: updatesByKey only holds bookmarks this run
				// actually pinged, and re-filtering would discard the includeFlagged results.
				key := canonicalBookmarkURLKey(current[i].URL)
				if key == "" {
					continue
				}
				update, ok := updatesByKey[key]
				if !ok {
					continue
				}
				setBookmarkCheckResult(&current[i], update.lastChecked, update.lastError)
				result := driftResults[key]
				if result.CertHost != "" {
					current[i].CertHost = result.CertHost
				}
				applyDriftResult(&current[i], result, update.lastChecked)
			}
			return current, nil
		})
		if err != nil {
			if errors.Is(err, ErrBookmarkNotFound) {
				continue
			}
			return res, err
		}
	}

	if err := h.mergeHealthCacheUpdates(healthUpdates); err != nil {
		return res, fmt.Errorf("%w: %v", errHealthRetestPersist, err)
	}
	// Best-effort: losing a sample costs a gap in the heartbeat, which is not
	// worth failing a retest that already pinged everything successfully.
	if err := h.appendHealthSamples(historyUpdates); err != nil {
		logWarn(logComponentHealth, "the results of this re-check could not be added to the history (%v); the graph will show a gap", err)
	}

	// Certificates come out of the same handshakes this retest already made.
	// Until now recordMonitorCertificates was called from exactly one place —
	// the monitor sweep — so an install using periodic checks, which is the
	// default, never saw a certificate warning at all.
	certResults := make([]PingResult, 0, len(driftResults))
	for _, result := range driftResults {
		if result.CertExpiry > 0 && result.CertHost != "" {
			certResults = append(certResults, result)
		}
	}
	if len(certResults) > 0 {
		h.recordMonitorCertificates(certResults)
	}

	h.invalidateHealthReportCache()
	logBookmarkStatusBatch(res.Tested, res.OnlineCount, res.OfflineCount, activitySource)
	return res, nil
}

// OpenBroken returns broken bookmark URLs for client-side opening.
// Optional JSON body: { "limit": N } (default 10, max 25).
func (h *Handlers) OpenBroken(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	const defaultLimit = 10
	const maxLimit = 25
	limit := defaultLimit

	var req struct {
		Limit int `json:"limit"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Limit > 0 {
			limit = req.Limit
			if limit > maxLimit {
				limit = maxLimit
			}
		}
	}

	pages := h.store.GetPages()
	var brokenURLs []string

	for _, page := range pages {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		for _, bm := range bookmarks {
			if strings.TrimSpace(bm.LastError) != "" {
				brokenURLs = append(brokenURLs, bm.URL)
			}
		}
	}

	totalBroken := len(brokenURLs)
	if limit > 0 && len(brokenURLs) > limit {
		brokenURLs = brokenURLs[:limit]
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"count":       len(brokenURLs),
		"totalBroken": totalBroken,
		"limit":       limit,
		"urls":        brokenURLs,
	})
}

// MergeDuplicates consolidates duplicate bookmarks into a single target
func (h *Handlers) MergeDuplicates(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var req struct {
		TargetPageID  int   `json:"targetPageId"`
		TargetIndex   int   `json:"targetIndex"`
		SourcePageIDs []int `json:"sourcePageIds"`
		SourceIndices []int `json:"sourceIndices"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if len(req.SourcePageIDs) != len(req.SourceIndices) {
		http.Error(w, "sourcePageIds and sourceIndices length mismatch", http.StatusBadRequest)
		return
	}
	if req.TargetPageID <= 0 {
		http.Error(w, "Invalid target page ID", http.StatusBadRequest)
		return
	}

	targetBookmarks := h.store.GetBookmarksByPage(req.TargetPageID)
	if req.TargetIndex < 0 || req.TargetIndex >= len(targetBookmarks) {
		http.Error(w, "Invalid target index", http.StatusBadRequest)
		return
	}

	keeper := targetBookmarks[req.TargetIndex]
	keeperKey := canonicalBookmarkURLKey(keeper.URL)
	if keeperKey == "" {
		http.Error(w, "Invalid target bookmark URL", http.StatusBadRequest)
		return
	}

	sources := make([]Bookmark, 0, len(req.SourcePageIDs))
	deletes := make([]mergeDeleteRef, 0, len(req.SourcePageIDs))
	// Every ref below is validated against the pre-merge snapshot, so the same
	// (page, index) pair listed twice would pass twice and then be deleted twice
	// from a slice that has already shifted -- taking an innocent neighbour with
	// it, and double-counting the source's open count into the keeper.
	seenSources := make(map[mergeDeleteRef]bool, len(req.SourcePageIDs))
	for i := 0; i < len(req.SourcePageIDs); i++ {
		pageID := req.SourcePageIDs[i]
		index := req.SourceIndices[i]
		if pageID == req.TargetPageID && index == req.TargetIndex {
			continue
		}
		ref := mergeDeleteRef{pageID: pageID, index: index}
		if seenSources[ref] {
			continue
		}
		seenSources[ref] = true
		bookmarks := h.store.GetBookmarksByPage(pageID)
		if index < 0 || index >= len(bookmarks) {
			http.Error(w, "Invalid source index", http.StatusBadRequest)
			return
		}
		src := bookmarks[index]
		if canonicalBookmarkURLKey(src.URL) != keeperKey {
			http.Error(w, "Source URL does not match target", http.StatusBadRequest)
			return
		}
		sources = append(sources, src)
		deletes = append(deletes, ref)
	}

	merged := keeper
	mergeBookmarkMetadata(&merged, sources)

	involvedPages := map[int]struct{}{req.TargetPageID: {}}
	for _, del := range deletes {
		involvedPages[del.pageID] = struct{}{}
	}
	pageSnapshots := make(map[int][]Bookmark, len(involvedPages))
	for pageID := range involvedPages {
		existing := h.store.GetBookmarksByPage(pageID)
		pageSnapshots[pageID] = append([]Bookmark(nil), existing...)
	}

	sort.Slice(deletes, func(i, j int) bool {
		if deletes[i].pageID != deletes[j].pageID {
			return deletes[i].pageID < deletes[j].pageID
		}
		return deletes[i].index > deletes[j].index
	})

	targetIndex := req.TargetIndex
	mergedCount := 0
	for _, del := range deletes {
		bookmarks := pageSnapshots[del.pageID]
		if del.index < 0 || del.index >= len(bookmarks) {
			http.Error(w, "Invalid source index", http.StatusBadRequest)
			return
		}
		if del.pageID == req.TargetPageID && del.index < targetIndex {
			targetIndex--
		}
		pageSnapshots[del.pageID] = append(bookmarks[:del.index], bookmarks[del.index+1:]...)
		mergedCount++
	}

	targetBookmarks = pageSnapshots[req.TargetPageID]
	if targetIndex < 0 || targetIndex >= len(targetBookmarks) {
		http.Error(w, "Target bookmark missing after merge", http.StatusInternalServerError)
		return
	}
	targetBookmarks[targetIndex] = merged
	pageSnapshots[req.TargetPageID] = targetBookmarks

	if !respondStorePersistError(w, h.store.SaveBookmarkPageUpdates(pageSnapshots)) {
		return
	}
	h.invalidateHealthReportCache()

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "merged",
		"count":  mergedCount,
	})
}

// DeleteHealthBookmark removes one bookmark by page/index from health view.
func (h *Handlers) DeleteHealthBookmark(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID int    `json:"pageId"`
		Index  int    `json:"index"`
		URL    string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}
	// The URL the row showed, required: this used to delete whatever sat at
	// the index, and a report read minutes ago can name a neighbour there.
	if canonicalBookmarkURLKey(strings.TrimSpace(req.URL)) == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}

	// The bulk path, with one item: the same URL check under the lock, and the
	// same trash entry, so a single delete is as recoverable as a batch.
	removed, skipped := h.deleteHealthBookmarksOnPage(req.PageID, []healthBulkDeleteItem{
		{PageID: req.PageID, Index: req.Index, URL: req.URL},
	})
	if len(removed) == 0 {
		if len(skipped) > 0 && skipped[0].Reason == healthBulkSkipWriteFailed {
			http.Error(w, "Failed to save data", http.StatusInternalServerError)
			return
		}
		http.Error(w, "Bookmark has changed; reload the health report", http.StatusConflict)
		return
	}
	pageName := ""
	for _, page := range h.store.GetPages() {
		if page.ID == req.PageID {
			pageName = page.Name
			break
		}
	}
	entry := removed[0]
	entry.PageName = pageName
	entry.Source = "health"
	_ = h.store.AddTrashedBookmarks([]TrashedBookmark{entry})
	h.invalidateHealthReportCache()
	deleted := entry.Bookmark
	deleted.PageID = req.PageID
	logBookmarkDelete(deleted, r)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{
		"status":   "deleted",
		"trashIds": []string{entry.ID},
	})
}

// AutoHealSuggest returns healing suggestions for a broken bookmark.
func (h *Handlers) AutoHealSuggest(w http.ResponseWriter, r *http.Request) {
	if !h.requireWriteAccess(w, r) {
		return
	}
	pageID, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageId")))
	if err != nil || pageID <= 0 {
		http.Error(w, "Invalid pageId", http.StatusBadRequest)
		return
	}
	index, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("index")))
	if err != nil || index < 0 {
		http.Error(w, "Invalid index", http.StatusBadRequest)
		return
	}

	bookmarks := h.store.GetBookmarksByPage(pageID)
	if index >= len(bookmarks) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return
	}
	bookmark := bookmarks[index]
	currentURL := strings.TrimSpace(bookmark.URL)
	if currentURL == "" {
		http.Error(w, "Bookmark URL missing", http.StatusBadRequest)
		return
	}

	redirectOnlyRaw := strings.TrimSpace(r.URL.Query().Get("redirectOnly"))
	redirectOnly := redirectOnlyRaw == "1" || strings.EqualFold(redirectOnlyRaw, "true")

	redirectURL := h.detectRedirectURLCtx(r.Context(), currentURL, redirectOnly)
	suggestedTitle := ""
	if !redirectOnly {
		titleURL := currentURL
		if redirectURL != "" {
			titleURL = redirectURL
		}
		suggestedTitle = h.fetchPageTitleSafeCtx(r.Context(), titleURL)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"pageId":         pageID,
		"index":          index,
		"currentUrl":     currentURL,
		"redirectUrl":    redirectURL,
		"archiveUrl":     "https://web.archive.org/web/*/" + currentURL,
		"suggestedTitle": suggestedTitle,
	})
}

// AutoHealApply applies a one-click URL/title fix for a bookmark.
func (h *Handlers) AutoHealApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var req struct {
		PageID       int    `json:"pageId"`
		Index        int    `json:"index"`
		URL          string `json:"url"`
		NewURL       string `json:"newUrl"`
		RefreshTitle bool   `json:"refreshTitle"`
		OneClick     bool   `json:"oneClick"`
		// KeepOriginalInNote writes the address being replaced into the note.
		// Used when the replacement is an archived copy: the capture is a
		// reading of the page, not the page, and the original is what a later
		// attempt to find it again starts from.
		KeepOriginalInNote bool   `json:"keepOriginalInNote"`
		SuggestedTitle     string `json:"suggestedTitle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}

	updatedURL := strings.TrimSpace(req.NewURL)
	if updatedURL != "" {
		if err := h.validateBookmarkURL(updatedURL); err != nil {
			http.Error(w, fmt.Sprintf("Invalid fix URL: %v", err), http.StatusBadRequest)
			return
		}
	}

	refreshTitle := req.RefreshTitle || req.OneClick
	appliedURL := false
	appliedTitle := false
	var result Bookmark

	if canonicalBookmarkURLKey(strings.TrimSpace(req.URL)) == "" {
		http.Error(w, "url is required", http.StatusBadRequest)
		return
	}
	bookmarks := h.store.GetBookmarksByPage(req.PageID)
	at := locateBookmark(bookmarks, req.Index, req.URL)
	if at < 0 {
		http.Error(w, "Bookmark has changed; reload the health report", http.StatusConflict)
		return
	}
	sourceBookmark := bookmarks[at]
	// What the fix replaces, handed back so the client can offer an undo.
	previous := map[string]any{
		"url":          sourceBookmark.URL,
		"name":         sourceBookmark.Name,
		"note":         sourceBookmark.Note,
		"previewTitle": sourceBookmark.PreviewTitle,
	}

	// Outbound HTTP must not run inside MutateBookmarkAt — it holds the store write lock
	// and would freeze dashboard/config/health for the full redirect/title fetch duration.
	if req.OneClick && updatedURL == "" {
		updatedURL = strings.TrimSpace(h.detectRedirectURLCtx(r.Context(), strings.TrimSpace(sourceBookmark.URL), false))
	}
	resolvedTitle := strings.TrimSpace(req.SuggestedTitle)
	if refreshTitle && resolvedTitle == "" {
		targetURL := updatedURL
		if targetURL == "" {
			targetURL = strings.TrimSpace(sourceBookmark.URL)
		}
		resolvedTitle = strings.TrimSpace(h.fetchPageTitleSafeCtx(r.Context(), targetURL))
	}

	// Verify the replacement before storing it: clearing LastError on the strength
	// of "the URL changed" reports healthy for a URL nobody has reached yet. Runs
	// outside MutateBookmarkAt because that holds the store write lock.
	verified := PingResult{}
	if updatedURL != "" && updatedURL != strings.TrimSpace(sourceBookmark.URL) {
		verified = h.pingURLExpecting(r.Context(), updatedURL, expectationFor(sourceBookmark).withSoftNotFound(softNotFoundEnabled(h.store.GetSettings())))
	}

	err := h.mutateHealthBookmark(req.PageID, at, req.URL, func(bookmark *Bookmark) error {
		if updatedURL != "" && updatedURL != strings.TrimSpace(bookmark.URL) {
			if req.KeepOriginalInNote {
				appendBookmarkNote(bookmark, "Was: "+strings.TrimSpace(bookmark.URL))
			}
			bookmark.URL = updatedURL
			appliedURL = true
		}

		if refreshTitle && resolvedTitle != "" {
			bookmark.PreviewTitle = resolvedTitle
			// Keep user-defined names unless empty; fallback to fetched title.
			if strings.TrimSpace(bookmark.Name) == "" || appliedURL {
				bookmark.Name = resolvedTitle
			}
			appliedTitle = true
		}

		if appliedURL {
			detail := ""
			if verified.Status != "online" {
				// The fix landed but the target still fails: keep the row red and say why,
				// rather than reporting healthy on an unverified URL.
				detail = strings.TrimSpace(verified.ErrorDetail)
				if detail == "" {
					detail = "Unreachable"
				}
			}
			setBookmarkCheckResult(bookmark, time.Now().UnixMilli(), detail)
			// The URL just changed under this bookmark: whatever drift baseline was
			// recorded belonged to the old page, so it must not be judged against it.
			bookmark.DriftURL = ""
			bookmark.DriftTitle = ""
			bookmark.DriftFingerprint = ""
			bookmark.DriftNoticed = ""
			bookmark.DriftSince = 0
			bookmark.DriftReason = ""
			if verified.CertHost != "" {
				bookmark.CertHost = verified.CertHost
			}
			applyDriftResult(bookmark, verified, bookmark.LastChecked)
		}

		result = *bookmark
		return nil
	})
	if !respondBookmarkMutationError(w, err) {
		return
	}
	h.invalidateHealthReportCache()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":         "ok",
		"appliedUrl":     appliedURL,
		"appliedTitle":   appliedTitle,
		"url":            result.URL,
		"title":          result.PreviewTitle,
		"verifiedOnline": appliedURL && verified.Status == "online",
		"verifyError":    strings.TrimSpace(result.LastError),
		"previous":       previous,
	})
}

func (h *Handlers) detectRedirectURLCtx(ctx context.Context, urlStr string, quickOnly bool) string {
	urlStr = strings.TrimSpace(urlStr)
	if ctx.Err() != nil {
		return ""
	}
	allowLocal := h.allowLocalBookmarks()
	if err := validateHTTPURLCtx(ctx, urlStr, allowLocal); err != nil {
		return ""
	}

	overallTimeout := 12 * time.Second
	if quickOnly {
		overallTimeout = 8 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, overallTimeout)
	defer cancel()

	noFollowTimeout := 6 * time.Second
	if quickOnly {
		noFollowTimeout = 7 * time.Second
	}
	noFollow := &http.Client{
		Timeout:   noFollowTimeout,
		Transport: newSSRFSafeTransport(allowLocal, 2*time.Second),
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err == nil {
		if resp, doErr := noFollow.Do(req); resp != nil {
			if doErr == nil {
				if redirect := redirectLocationFromResponseCtx(ctx, urlStr, resp, allowLocal); redirect != "" {
					drainAndCloseResponse(resp)
					return redirect
				}
			}
			drainAndCloseResponse(resp)
		}
	}

	if quickOnly {
		return ""
	}

	followClient := h.outboundHTTPClient(7*time.Second, 5)
	req2, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return ""
	}
	resp2, err := followClient.Do(req2)
	if err != nil || resp2 == nil {
		if resp2 != nil {
			drainAndCloseResponse(resp2)
		}
		return ""
	}
	defer drainAndCloseResponse(resp2)
	if resp2.Request != nil && resp2.Request.URL != nil {
		finalURL := strings.TrimSpace(resp2.Request.URL.String())
		if finalURL != "" && finalURL != urlStr {
			if err := validateHTTPURLCtx(ctx, finalURL, allowLocal); err == nil {
				return finalURL
			}
		}
	}
	return ""
}

func (h *Handlers) fetchPageTitleSafeCtx(ctx context.Context, urlStr string) string {
	urlStr = strings.TrimSpace(urlStr)
	if ctx.Err() != nil {
		return ""
	}
	if urlStr == "" {
		return ""
	}
	if err := validateHTTPURLCtx(ctx, urlStr, h.allowLocalBookmarks()); err != nil {
		return ""
	}

	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	client := h.outboundHTTPClient(8*time.Second, 5)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "nextDash AutoHealer/1.0")

	resp, err := client.Do(req)
	if err != nil || resp == nil {
		if resp != nil {
			drainAndCloseResponse(resp)
		}
		return ""
	}
	defer drainAndCloseResponse(resp)

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return ""
	}
	html := string(body)
	lower := strings.ToLower(html)
	titleOpen := strings.Index(lower, "<title")
	if titleOpen < 0 {
		return ""
	}
	titleStart := strings.Index(lower[titleOpen:], ">")
	if titleStart < 0 {
		return ""
	}
	titleStart = titleOpen + titleStart + 1
	titleEndRel := strings.Index(lower[titleStart:], "</title>")
	if titleEndRel < 0 {
		return ""
	}
	title := strings.TrimSpace(html[titleStart : titleStart+titleEndRel])
	if title == "" {
		return ""
	}
	return strings.Join(strings.Fields(title), " ")
}

// findBookmarkByURLKey returns the first bookmark anywhere holding this
// canonical URL. GetAllBookmarks fills PageID in and is read-cached, which the
// page-by-page scan this replaced was not.
func findBookmarkByURLKey(store Store, key string) *Bookmark {
	if key == "" {
		return nil
	}
	for _, bookmark := range store.GetAllBookmarks() {
		if canonicalBookmarkURLKey(bookmark.URL) == key {
			found := bookmark
			return &found
		}
	}
	return nil
}

// categoryNameForID is the category's name on that page, or "" when the
// bookmark has no category or the category has since been removed.
func categoryNameForID(store Store, pageID int, categoryID string) string {
	if strings.TrimSpace(categoryID) == "" {
		return ""
	}
	for _, category := range store.GetCategoriesByPage(pageID) {
		if category.ID == categoryID {
			return category.Name
		}
	}
	return ""
}

// pageNameForID is the page's name, or "" when it has gone. The client prints it
// beside the category, so an id would be no use to it.
func pageNameForID(store Store, pageID int) string {
	for _, page := range store.GetPages() {
		if page.ID == pageID {
			return page.Name
		}
	}
	return ""
}
