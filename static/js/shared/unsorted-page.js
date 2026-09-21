/**
 * What the hidden "Unsorted" page is, for everything that is not the view.
 *
 * The view itself is large and loads with the inbox, on demand. But the
 * question "does this bookmark live on the kept page" is asked the moment the
 * dashboard loads its bookmarks -- the split in loadAllBookmarks depends on it
 * -- and by surfaces that never open the view at all: the tag cloud, the smart
 * collections, search, the config workbench. So the answer lives here, in a
 * file small enough to ride along with the page, and the view builds on it.
 */
(function (global) {
    'use strict';

    /**
     * Mirrors unsortedPageID in models.go. Far outside the range ordinary pages
     * reach, and never in d.pages, so nothing on the dashboard routes to it.
     */
    const PAGE_ID = 999999;

    /**
     * Both spellings of the field, because the two exist in the tree: the store
     * writes `pageId`, and a few older record shapes carry `pageID`. Normalized
     * here rather than at the callers, so a second definition cannot drift away
     * from this one.
     */
    function isUnsorted(bookmark) {
        const pageId = Number(bookmark?.pageId ?? bookmark?.pageID);
        return Number.isFinite(pageId) && pageId === PAGE_ID;
    }

    /** The same list with the kept bookmarks taken out. */
    function without(list) {
        if (!Array.isArray(list)) return list;
        return list.filter((bookmark) => !isUnsorted(bookmark));
    }

    global.UnsortedPage = { PAGE_ID, isUnsorted, without };
}(typeof window !== 'undefined' ? window : globalThis));
