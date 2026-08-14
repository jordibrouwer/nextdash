package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
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
	store                 Store
	files                 embed.FS
	pageTemplates         map[string]*template.Template
	pageTemplatesMu       sync.RWMutex
	previewCacheMu        sync.RWMutex
	previewCache          PreviewCacheFile
	previewLoaded         bool
	previewCacheDirty     bool
	healthCacheMu         sync.RWMutex
	healthHistoryMu       sync.Mutex
	healthTrendMu         sync.Mutex
	healthReportMu        sync.RWMutex
	healthReport          BookmarkHealthReport
	healthReportAt        time.Time
	healthReportOK        bool
	healthReportBuildMu   sync.Mutex
	healthReportBuildCond *sync.Cond
	healthReportBuilding  bool
	prefetchMu            sync.Mutex
	autoBackupMu          sync.Mutex
	ssrfAPILimiter        *slidingWindowLimiter
	statusPingLimiter     *slidingWindowLimiter
	updateCheckMu         sync.RWMutex
	updateCheckCache      updateCheckCacheEntry
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
	if info, statErr := os.Stat("templates"); statErr == nil && info.IsDir() {
		diskFiles := make([]string, len(templateFiles))
		for i, name := range templateFiles {
			diskFiles[i] = filepath.FromSlash(name)
		}
		name := filepath.Base(diskFiles[0])
		tmpl, err = template.New(name).Funcs(pageTemplateFuncs).ParseFiles(diskFiles...)
	} else {
		name := path.Base(templateFiles[0])
		tmpl, err = template.New(name).Funcs(pageTemplateFuncs).ParseFS(h.files, templateFiles...)
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

func NewHandlers(store Store, files embed.FS) *Handlers {
	h := &Handlers{
		store:             store,
		files:             files,
		ssrfAPILimiter:    newSlidingWindowLimiter(ssrfAPIRequestsPerMinute(), time.Minute),
		statusPingLimiter: newSlidingWindowLimiter(statusPingRequestsPerMinute(), time.Minute),
	}
	h.healthReportBuildCond = sync.NewCond(&h.healthReportBuildMu)
	h.startPreviewCacheFlushLoop()
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
	json.NewEncoder(w).Encode(report)
}

func (h *Handlers) loadBookmarkHealthReport(forceRefresh bool) BookmarkHealthReport {
	if h.healthReportBuildCond == nil {
		h.healthReportBuildCond = sync.NewCond(&h.healthReportBuildMu)
	}
	if !forceRefresh {
		h.healthReportMu.RLock()
		if h.healthReportOK && time.Since(h.healthReportAt) < healthReportCacheTTL {
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
			cached := h.healthReportOK && time.Since(h.healthReportAt) < healthReportCacheTTL
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

	h.healthReportMu.Lock()
	h.healthReport = report
	h.healthReportOK = true
	h.healthReportAt = time.Now()
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
	healthPenaltyNotOpened30Days  = 10
	healthPenaltyNeverOpened      = 10
	healthPenaltyStaleCheck       = 5
	healthPenaltyNoPreview        = 5
)

func appendHealthReason(details *[]HealthReason, legacy *[]string, reason HealthReason) {
	*details = append(*details, reason)
	*legacy = append(*legacy, healthReasonLegacyLabel(reason))
}

func (h *Handlers) buildBookmarkHealthReport() BookmarkHealthReport {
	pages := h.store.GetPages()
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
			if isStale {
				if status == "healthy" {
					status = "stale"
				}
				flags = append(flags, "stale")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "not_opened_30_days", Penalty: healthPenaltyNotOpened30Days})
				score -= healthPenaltyNotOpened30Days
			}
			if isUnused {
				if status == "healthy" {
					status = "unused"
				}
				flags = append(flags, "unused")
				appendHealthReason(&reasonDetails, &reasons, HealthReason{Code: "never_opened", Penalty: healthPenaltyNeverOpened})
				score -= healthPenaltyNeverOpened
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
			if status == "healthy" {
				report.Summary.HealthyCount++
				// Healthy is the absence of every flag above, not a condition of
				// its own, so it is only added when nothing else was.
				flags = append(flags, "healthy")
			}

			var monitorStats *MonitorStats
			if bm.Monitor {
				if key := canonicalBookmarkURLKey(bm.URL); key != "" {
					samples := monitorHistory[key]
					monitorStats = buildMonitorStats(samples, bm.MonitorIntervalMinutes, monitorNow)
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
	report.Certificates = expiringCertificates(h.hostCertificates(), monitorNow)

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
// view sections (overview · pages-tags · appearance · behavior · data-backups).
// Returns "" for the overview/unknown case so the caller falls back to /#config.
func mapLegacyConfigSection(section string) string {
	switch strings.ToLower(section) {
	case "pages", "categories", "tags", "finders":
		return "pages-tags"
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

	// Umami analytics (privacy-friendly, opt-out). Fixed id + host for the
	// project's shared instance. The template emits the tracker only when
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
		TelemetryLockedOff:   telemetryDisabledByEnv(),
		UpdateCheckLockedOff: updateCheckDisabledByEnv(),
	}
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

	existingBookmarks := h.store.GetBookmarksByPage(request.Page)
	newKey := canonicalBookmarkURLKey(request.Bookmark.URL)
	for _, existingBookmark := range existingBookmarks {
		if canonicalBookmarkURLKey(existingBookmark.URL) == newKey {
			http.Error(w, "Duplicate bookmark URL", http.StatusConflict)
			return
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

func (h *Handlers) ImportBrowserBookmarks(w http.ResponseWriter, r *http.Request) {
	h.setCORSHeaders(w, r)
	if r.Method == "OPTIONS" {
		return
	}
	if !h.requireWriteAccess(w, r) {
		return
	}

	var request struct {
		PageID    int `json:"pageId"`
		Bookmarks []struct {
			Name     string `json:"name"`
			URL      string `json:"url"`
			Category string `json:"category"`
		} `json:"bookmarks"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if request.PageID <= 0 {
		http.Error(w, "Invalid page ID", http.StatusBadRequest)
		return
	}

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

	newCatNames := make(map[string]string)
	var newCatOrder []string
	for _, bm := range request.Bookmarks {
		if bm.Category == "" {
			continue
		}
		id := slugify(bm.Category)
		if id == "" {
			continue
		}
		if _, exists := knownCatIDs[id]; !exists {
			if _, already := newCatNames[bm.Category]; !already {
				newCatNames[bm.Category] = id
				newCatOrder = append(newCatOrder, bm.Category)
				knownCatIDs[id] = struct{}{}
			}
		}
	}
	if len(newCatOrder) > 0 {
		for _, name := range newCatOrder {
			categories = append(categories, Category{ID: newCatNames[name], Name: name})
		}
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
		catID := ""
		if bm.Category != "" {
			catID = slugify(bm.Category)
		}
		if !respondStorePersistError(w, h.store.AddBookmarkToPage(request.PageID, Bookmark{
			Name:     bm.Name,
			URL:      bm.URL,
			Category: catID,
			PageID:   request.PageID,
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
	writeJSONWithETag(w, r, h.store.GetPages())
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
			if rule.Value != "" {
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
	settings.SavedSearches = normalizeSavedSearches(settings.SavedSearches)
	clampBookmarkSettings(&settings)
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
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{"status": "success"}
	if len(droppedCollections) > 0 {
		response["droppedCollections"] = droppedCollections
	}
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

func renderThemeCSSBlock(selector string, tc ThemeColors) string {
	s := sanitizeThemeColors(tc)
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
    --accent-primary: ` + s.AccentSuccess + `;
    --accent-warning: ` + s.AccentWarning + `;
    --accent-error: ` + s.AccentError + `;
}
`
}

func (h *Handlers) CustomThemeCSS(w http.ResponseWriter, r *http.Request) {
	colors := h.store.GetColors()

	w.Header().Set("Content-Type", "text/css")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	css := "/* Custom Theme Variables - Loaded from colors.json */\n\n"
	css += "/* Light Theme Variables */\n" + renderThemeCSSBlock("light", colors.Light) + "\n"
	css += "/* Dark Theme Variables */\n" + renderThemeCSSBlock("dark", colors.Dark) + "\n"

	// Add custom themes CSS
	for themeID, themeColors := range colors.Custom {
		safeID := sanitizeCSSIdent(themeID)
		if safeID == "" {
			continue
		}
		css += "/* Custom Theme: " + safeID + " */\n" + renderThemeCSSBlock(safeID, themeColors) + "\n"
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
		css += "/* Built-in Theme: " + safeID + " */\n" + renderThemeCSSBlock(safeID, colors.BuiltIn[themeID]) + "\n"
	}

	w.Write([]byte(css))
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

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	if err != nil {
		return preview
	}

	htmlBody := string(bodyBytes)
	preview.Title = h.extractTitleFromHTML(htmlBody)
	if preview.Title == "" {
		preview.Title = h.extractMetaFromHTML(htmlBody, "property", "og:title")
	}
	preview.Description = h.extractMetaFromHTML(htmlBody, "name", "description")
	if preview.Description == "" {
		preview.Description = h.extractMetaFromHTML(htmlBody, "property", "og:description")
	}
	preview.Image = h.extractMetaFromHTML(htmlBody, "property", "og:image")
	if preview.Image != "" {
		preview.Image = h.resolveRelativeURL(preview.URL, preview.Image)
	}
	preview.Icon = h.extractIconFromHTML(htmlBody)
	if preview.Icon != "" {
		preview.Icon = h.resolveRelativeURL(preview.URL, preview.Icon)
	}

	if cache != nil {
		if cache.Cache == nil {
			cache.Cache = make(map[string]BookmarkPreview)
		}
		cache.Cache[cacheKey] = preview
	}
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
	bm.PreviewImage = strings.TrimSpace(preview.Image)
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

	cache := PreviewCacheFile{Cache: map[string]BookmarkPreview{}}
	refreshed := 0
	skipped := 0

	for _, page := range h.store.GetPages() {
		bookmarks := h.store.GetBookmarksByPage(page.ID)
		previewByKey := make(map[string]BookmarkPreview)
		for _, bm := range bookmarks {
			rawURL := strings.TrimSpace(bm.URL)
			if rawURL == "" {
				skipped++
				continue
			}
			preview := h.fetchBookmarkPreview(r.Context(), rawURL, &cache, false)
			key := canonicalBookmarkURLKey(rawURL)
			if key != "" {
				previewByKey[key] = preview
			}
			refreshed++
		}

		if len(previewByKey) == 0 {
			continue
		}

		err := h.store.MutateBookmarksOnPage(page.ID, func(current []Bookmark) ([]Bookmark, error) {
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
	title := strings.TrimSpace(htmlBody[contentStart : contentStart+endRel])
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

	logBookmarkOpen(pageID, index, bookmark, r)
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
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
	h.recordManualHealthSample(key, req.Status == "online", req.PingMs, req.Code)
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

	err := h.store.MutateBookmarkAt(req.PageID, req.Index, func(bookmark *Bookmark) error {
		bookmark.LastChecked = time.Now().UnixMilli()
		if strings.TrimSpace(req.Status) == "online" {
			bookmark.LastError = ""
		} else {
			errMsg := strings.TrimSpace(req.Error)
			if errMsg == "" {
				errMsg = "Unreachable"
			}
			bookmark.LastError = errMsg
		}
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

			result := h.pingURLExpecting(ctx, bm.URL, expectationFor(bm))
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
				current[i].LastChecked = update.lastChecked
				current[i].LastError = update.lastError
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
		log.Printf("health history: failed to record retest samples: %v", err)
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
	for i := 0; i < len(req.SourcePageIDs); i++ {
		pageID := req.SourcePageIDs[i]
		index := req.SourceIndices[i]
		if pageID == req.TargetPageID && index == req.TargetIndex {
			continue
		}
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
		deletes = append(deletes, mergeDeleteRef{pageID: pageID, index: index})
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
		PageID int `json:"pageId"`
		Index  int `json:"index"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.PageID <= 0 || req.Index < 0 {
		http.Error(w, "Invalid bookmark reference", http.StatusBadRequest)
		return
	}

	existing := h.store.GetBookmarksByPage(req.PageID)
	var deleted Bookmark
	if req.Index < len(existing) {
		deleted = existing[req.Index]
	}

	if !respondBookmarkMutationError(w, h.store.DeleteBookmarkAt(req.PageID, req.Index)) {
		return
	}
	h.invalidateHealthReportCache()
	if deleted.URL != "" || deleted.Name != "" {
		deleted.PageID = req.PageID
		logBookmarkDelete(deleted, r)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]any{"status": "deleted"})
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
		PageID         int    `json:"pageId"`
		Index          int    `json:"index"`
		NewURL         string `json:"newUrl"`
		RefreshTitle   bool   `json:"refreshTitle"`
		OneClick       bool   `json:"oneClick"`
		SuggestedTitle string `json:"suggestedTitle"`
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

	bookmarks := h.store.GetBookmarksByPage(req.PageID)
	if req.Index >= len(bookmarks) {
		http.Error(w, "Bookmark index out of range", http.StatusNotFound)
		return
	}
	sourceBookmark := bookmarks[req.Index]

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
		verified = h.pingURLExpecting(r.Context(), updatedURL, expectationFor(sourceBookmark))
	}

	err := h.store.MutateBookmarkAt(req.PageID, req.Index, func(bookmark *Bookmark) error {
		if updatedURL != "" && updatedURL != strings.TrimSpace(bookmark.URL) {
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
			bookmark.LastChecked = time.Now().UnixMilli()
			if verified.Status == "online" {
				bookmark.LastError = ""
			} else {
				// The fix landed but the target still fails: keep the row red and say why,
				// rather than reporting healthy on an unverified URL.
				detail := strings.TrimSpace(verified.ErrorDetail)
				if detail == "" {
					detail = "Unreachable"
				}
				bookmark.LastError = detail
			}
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
