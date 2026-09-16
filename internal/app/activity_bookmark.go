package app

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// bookmarkActivityName is what to call a bookmark in a sentence. A nameless
// one is not worth an empty pair of quotes, so it borrows its address —
// through activityURL, since this fallback is itself a sentence value and
// NEXTDASH_ACTIVITY_LOG_URLS must reach it the same as everywhere else.
func bookmarkActivityName(bm Bookmark) string {
	if name := strings.TrimSpace(bm.Name); name != "" {
		return name
	}
	if url := strings.TrimSpace(bm.URL); url != "" {
		return activityURL(url)
	}
	return "an unnamed bookmark"
}

// bookmarkActivitySnapshot is where NEXTDASH_ACTIVITY_LOG_URLS reaches every
// channel that logs a bookmark's address — mutate's add/update/delete and
// open's own record alike — through the one field every one of them builds
// from this function rather than reading bm.URL directly. The readable
// sentence a caller prints alongside this (added %q (%s), say) still carries
// the full URL: reducing that would mean rewriting every sentence, not one
// field, and the container log has always shown it.
func bookmarkActivitySnapshot(bm Bookmark) map[string]any {
	return map[string]any{
		"pageId": bm.PageID,
		"name":   strings.TrimSpace(bm.Name),
		"url":    activityUserText(strings.TrimSpace(bm.URL)),
	}
}

func bookmarkChangedFields(before, after Bookmark) []string {
	var changed []string
	if strings.TrimSpace(before.Name) != strings.TrimSpace(after.Name) {
		changed = append(changed, "name")
	}
	if canonicalBookmarkURLKey(before.URL) != canonicalBookmarkURLKey(after.URL) {
		changed = append(changed, "url")
	}
	if normalizeShortcut(before.Shortcut) != normalizeShortcut(after.Shortcut) {
		changed = append(changed, "shortcut")
	}
	if strings.TrimSpace(before.Category) != strings.TrimSpace(after.Category) {
		changed = append(changed, "category")
	}
	if strings.Join(normalizeTags(before.Tags), ",") != strings.Join(normalizeTags(after.Tags), ",") {
		changed = append(changed, "tags")
	}
	if before.Pinned != after.Pinned {
		changed = append(changed, "pinned")
	}
	if before.CheckStatus != after.CheckStatus {
		changed = append(changed, "checkStatus")
	}
	if strings.TrimSpace(before.Icon) != strings.TrimSpace(after.Icon) {
		changed = append(changed, "icon")
	}
	if strings.TrimSpace(before.Note) != strings.TrimSpace(after.Note) {
		changed = append(changed, "note")
	}
	return changed
}

func bookmarkContentFingerprint(bm Bookmark) string {
	return strings.Join([]string{
		strings.TrimSpace(bm.Name),
		canonicalBookmarkURLKey(bm.URL),
		normalizeShortcut(bm.Shortcut),
		strings.TrimSpace(bm.Category),
		strings.Join(normalizeTags(bm.Tags), ","),
		strconv.FormatBool(bm.Pinned),
		strconv.FormatBool(bm.CheckStatus),
		strings.TrimSpace(bm.Icon),
		strings.TrimSpace(bm.Note),
	}, "\x01")
}

func bookmarkOrderKeys(bookmarks []Bookmark) []string {
	keys := make([]string, 0, len(bookmarks))
	for _, bm := range bookmarks {
		keys = append(keys, canonicalBookmarkURLKey(bm.URL))
	}
	return keys
}

func isBookmarkReorderOnly(before, after []Bookmark) bool {
	if len(before) != len(after) || len(before) == 0 {
		return false
	}
	beforeByURL := make(map[string]Bookmark, len(before))
	for _, bm := range before {
		key := canonicalBookmarkURLKey(bm.URL)
		if key == "" {
			return false
		}
		beforeByURL[key] = bm
	}
	for _, bm := range after {
		key := canonicalBookmarkURLKey(bm.URL)
		old, ok := beforeByURL[key]
		if !ok || bookmarkContentFingerprint(old) != bookmarkContentFingerprint(bm) {
			return false
		}
	}
	beforeOrder := bookmarkOrderKeys(before)
	afterOrder := bookmarkOrderKeys(after)
	for i := range beforeOrder {
		if beforeOrder[i] != afterOrder[i] {
			return true
		}
	}
	return false
}

func logBookmarkAdd(bm Bookmark, r *http.Request) {
	emitWebhookEvent(webhookEventBookmarkAdded, bookmarkActivitySnapshot(bm))
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	logActivity(activityCategoryMutate, "bookmark.add", fields,
		fmt.Sprintf("added %q (%s)", bookmarkActivityName(bm), activityURL(bm.URL)))
}

func logBookmarkDelete(bm Bookmark, r *http.Request) {
	emitWebhookEvent(webhookEventBookmarkDeleted, bookmarkActivitySnapshot(bm))
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	logActivity(activityCategoryMutate, "bookmark.delete", fields,
		fmt.Sprintf("deleted %q (%s)", bookmarkActivityName(bm), activityURL(bm.URL)))
}

func logBookmarkRestore(item TrashedBookmark, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(item.Bookmark))
	fields["pageId"] = item.PageID
	logActivity(activityCategoryMutate, "bookmark.restore", fields,
		fmt.Sprintf("restored %q from the trash to page %d", bookmarkActivityName(item.Bookmark), item.PageID))
}

func logPageRestore(item TrashedBookmark, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["pageId"] = item.PageID
	if item.TrashedPage != nil {
		fields["count"] = len(item.TrashedPage.Bookmarks)
	}
	restoredCount := 0
	if item.TrashedPage != nil {
		restoredCount = len(item.TrashedPage.Bookmarks)
	}
	logActivity(activityCategoryMutate, "page.restore", fields,
		fmt.Sprintf("restored page %d from the trash with %d bookmarks", item.PageID, restoredCount))
}

func logCategoryRestore(item TrashedBookmark, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := activityFieldsFromRequest(r)
	fields["pageId"] = item.PageID
	if item.TrashedCategory != nil {
		fields["categoryId"] = item.TrashedCategory.Category.ID
	}
	logActivity(activityCategoryMutate, "category.restore", fields,
		fmt.Sprintf("restored a category on page %d from the trash", item.PageID))
}

func logBookmarkUpdate(bm Bookmark, changed []string, r *http.Request) {
	if len(changed) == 0 {
		return
	}
	emitWebhookEvent(webhookEventBookmarkUpdated,
		mergeActivityFields(bookmarkActivitySnapshot(bm), map[string]any{"changed": changed}))
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	fields["changed"] = changed
	logActivity(activityCategoryMutate, "bookmark.update", fields,
		fmt.Sprintf("changed %s of %q", strings.Join(changed, ", "), bookmarkActivityName(bm)))
}

func logBookmarkReorder(pageID int, count int, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"pageId": pageID,
		"count":  count,
	})
	logActivity(activityCategoryMutate, "bookmark.reorder", fields,
		fmt.Sprintf("reordered %d bookmarks on page %d", count, pageID))
}

func logBookmarkSaveFailed(pageID int, reason string, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"pageId": pageID,
		"reason": reason,
	})
	logActivity(activityCategoryMutate, "bookmark.save_failed", fields,
		fmt.Sprintf("could not save the bookmarks of page %d: %s", pageID, reason))
}

func logBookmarkSaveDiff(pageID int, before, after []Bookmark, r *http.Request) {
	// The diff is what feeds the webhooks too, so it is skipped only when
	// nothing at all is listening -- gating it on the activity log alone would
	// silently stop deliveries the moment someone turned that log off.
	if !activityEnabled(activityCategoryMutate) && !webhooksConfigured() {
		return
	}
	if isBookmarkReorderOnly(before, after) {
		logBookmarkReorder(pageID, len(after), r)
		return
	}

	beforeByURL := make(map[string]Bookmark, len(before))
	for _, bm := range before {
		key := canonicalBookmarkURLKey(bm.URL)
		if key != "" {
			beforeByURL[key] = bm
		}
	}
	afterByURL := make(map[string]Bookmark, len(after))
	for _, bm := range after {
		key := canonicalBookmarkURLKey(bm.URL)
		if key != "" {
			afterByURL[key] = bm
		}
	}

	for key, bm := range afterByURL {
		old, ok := beforeByURL[key]
		if !ok {
			logBookmarkAdd(bm, r)
			continue
		}
		if changed := bookmarkChangedFields(old, bm); len(changed) > 0 {
			logBookmarkUpdate(bm, changed, r)
		}
	}
	for key, bm := range beforeByURL {
		if _, ok := afterByURL[key]; !ok {
			logBookmarkDelete(bm, r)
		}
	}
}

func logCategoriesSave(pageID int, count int, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"pageId": pageID,
		"count":  count,
	})
	logActivity(activityCategoryMutate, "categories.save", fields,
		fmt.Sprintf("saved %d categories on page %d", count, pageID))
}

func logDataImport(source string, files, skipped int, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"source":  source,
		"files":   files,
		"skipped": skipped,
	})
	logActivity(activityCategoryMutate, "data.import", fields,
		fmt.Sprintf("imported %d files from %s, %d skipped", files, source, skipped))
}

func logDataReset(r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	logActivity(activityCategoryMutate, "data.reset", activityFieldsFromRequest(r),
		"reset all data to the starting state")
}

func logBookmarksDeletedAll(r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	logActivity(activityCategoryMutate, "bookmark.deleteAll", activityFieldsFromRequest(r),
		"deleted every bookmark")
}

// The client's own account of how an open reached the server: which surface
// showed the link (activityOpenSources) and which gesture triggered it
// (activityOpenMethods). Both are what the page claims, not anything the
// server observed, so a value outside these sets is dropped rather than
// logged — free text here is free text a page could put anything in.
var activityOpenSources = map[string]bool{
	"dashboard":    true,
	"search":       true,
	"recent":       true,
	"config":       true,
	"context-menu": true,
	"health":       true,
	"shortcut":     true,
}

var activityOpenMethods = map[string]bool{
	"mouse":             true,
	"mouse-middle":      true,
	"mouse-modifier":    true,
	"keyboard-enter":    true,
	"keyboard-shortcut": true,
	"touch":             true,
	"unknown":           true,
}

// Bounds for the "full" open-detail extras. Every one of these is what the
// page claims about itself, not anything the server watched happen, so a
// value of the right type but an absurd size is treated the same as one of
// the wrong type: dropped rather than trusted onto the disk.
const (
	activityOpenDetailMaxRank          = 10000
	activityOpenDetailMaxQueryLength   = 500
	activityOpenDetailMaxRowIndex      = 100000
	activityOpenDetailMaxMsSinceRender = 24 * 60 * 60 * 1000
	activityOpenDetailMaxCategoryLen   = 64
)

// sanitizeOpenDetailExtras keeps only the "full"-level fields that are both
// the right type and inside a sane range, so a page that sends a negative
// rank, a category the length of an essay, or a string where a number was
// asked for ends up with that one field missing rather than corrupting the
// line it would have landed in.
func sanitizeOpenDetailExtras(raw map[string]any) map[string]any {
	out := map[string]any{}
	if v, ok := parseIntFromAny(raw["resultRank"]); ok && v >= 0 && v <= activityOpenDetailMaxRank {
		out["resultRank"] = v
	}
	if v, ok := parseIntFromAny(raw["queryLength"]); ok && v >= 0 && v <= activityOpenDetailMaxQueryLength {
		out["queryLength"] = v
	}
	if v, ok := raw["newTab"].(bool); ok {
		out["newTab"] = v
	}
	if v, ok := raw["category"].(string); ok {
		if v = strings.TrimSpace(v); v != "" && len(v) <= activityOpenDetailMaxCategoryLen {
			out["category"] = v
		}
	}
	if v, ok := parseIntFromAny(raw["rowIndex"]); ok && v >= 0 && v <= activityOpenDetailMaxRowIndex {
		out["rowIndex"] = v
	}
	if v, ok := parseIntFromAny(raw["msSinceRender"]); ok && v >= 0 && v <= activityOpenDetailMaxMsSinceRender {
		out["msSinceRender"] = v
	}
	return out
}

func logBookmarkOpen(pageID, index int, bm Bookmark, source, method, sessionID string, extra map[string]any, r *http.Request) {
	if !activityEnabled(activityCategoryOpen) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	fields["index"] = index
	fields["pageId"] = pageID
	// The session channel is what turns this id on at all — an open cannot
	// relate itself to a page load or a search that never opened without one
	// — but the field is attached here regardless of the open-detail level,
	// since it identifies the tab rather than describing how this one open
	// happened.
	if sid := validActivitySessionID(sessionID); sid != "" {
		fields["sessionId"] = sid
	}
	// "off" is the pre-Phase-1 shape: pageId/index and nothing else client-
	// claimed, for a reader who turned the extra detail back down rather than
	// merely never turning it up.
	level := activityOpenDetailLevel()
	if level != "off" {
		// Logged as "openSource", not "source": activityFieldsFromRequest already
		// puts the request's own transport under "source" (dashboard, extension or
		// api), which today is the only way to tell a browser-extension open apart
		// from one made on the page itself. The value here answers a different
		// question — which surface of the dashboard the reader was looking at —
		// and reusing "source" for it would silently overwrite the first answer.
		if activityOpenSources[source] {
			fields["openSource"] = source
		}
		if activityOpenMethods[method] {
			fields["method"] = method
		}
	}
	if level == "full" {
		for key, value := range sanitizeOpenDetailExtras(extra) {
			fields[key] = value
		}
	}
	logActivity(activityCategoryOpen, "bookmark.open", fields,
		fmt.Sprintf("opened %q (%s)", bookmarkActivityName(bm), activityURL(bm.URL)))
}

func logBrowserImport(pageID, imported, skipped int, r *http.Request) {
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), map[string]any{
		"pageId":   pageID,
		"imported": imported,
		"skipped":  skipped,
	})
	logActivity(activityCategoryMutate, "bookmark.import_browser", fields,
		fmt.Sprintf("imported %d bookmarks from a browser file to page %d, %d skipped", imported, pageID, skipped))
}
