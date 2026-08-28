package app

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// bookmarkActivityName is what to call a bookmark in a sentence. A nameless
// one is not worth an empty pair of quotes, so it borrows its address.
func bookmarkActivityName(bm Bookmark) string {
	if name := strings.TrimSpace(bm.Name); name != "" {
		return name
	}
	if url := strings.TrimSpace(bm.URL); url != "" {
		return url
	}
	return "an unnamed bookmark"
}

func bookmarkActivitySnapshot(bm Bookmark) map[string]any {
	return map[string]any{
		"pageId": bm.PageID,
		"name":   strings.TrimSpace(bm.Name),
		"url":    strings.TrimSpace(bm.URL),
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
		fmt.Sprintf("added %q (%s)", bookmarkActivityName(bm), bm.URL))
}

func logBookmarkDelete(bm Bookmark, r *http.Request) {
	emitWebhookEvent(webhookEventBookmarkDeleted, bookmarkActivitySnapshot(bm))
	if !activityEnabled(activityCategoryMutate) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	logActivity(activityCategoryMutate, "bookmark.delete", fields,
		fmt.Sprintf("deleted %q (%s)", bookmarkActivityName(bm), bm.URL))
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

func logBookmarkOpen(pageID, index int, bm Bookmark, r *http.Request) {
	if !activityEnabled(activityCategoryOpen) {
		return
	}
	fields := mergeActivityFields(activityFieldsFromRequest(r), bookmarkActivitySnapshot(bm))
	fields["index"] = index
	fields["pageId"] = pageID
	logActivity(activityCategoryOpen, "bookmark.open", fields,
		fmt.Sprintf("opened %q (%s)", bookmarkActivityName(bm), bm.URL))
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
