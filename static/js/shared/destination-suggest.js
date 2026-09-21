/**
 * Where a link belongs, read off where its neighbours already are.
 *
 * The tag suggestions answer "what is this about"; this answers the only
 * question a kept link actually poses: which page, which category. The
 * evidence is the collection itself -- twelve links from one site all filed
 * under Dev → Docs say what the thirteenth should do -- so there is nothing to
 * configure and nothing to download.
 *
 * Pure enough to test on its own: a pool of filed bookmarks in, a destination
 * out. What it does not do is decide; the caller offers the answer and the
 * reader accepts it.
 */
(function (global) {
    'use strict';

    /**
     * How many filed neighbours have to agree before this is worth offering.
     *
     * Two is a coincidence often enough: a pair of links dropped in the first
     * category that came to mind is not a habit, and a wrong destination
     * offered on that evidence costs more than no offer at all -- the reader
     * has to undo a move rather than make one.
     */
    const MIN_AGREEING = 3;

    /** What share of the site's filed links must sit in the same place. */
    const MIN_SHARE = 0.6;

    function hostOf(url) {
        try {
            const parsed = new URL(String(url || ''));
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return parsed.hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    /**
     * The page and category this address's neighbours agree on, or null.
     *
     * Counted over the filed collection only: a kept bookmark has no page and
     * no category by definition, so letting the kept list vote would be the
     * unsorted page voting for itself.
     */
    function suggest(bookmarks, url) {
        const host = hostOf(url);
        if (!host) return null;
        const counts = new Map();
        let total = 0;
        (bookmarks || []).forEach((bookmark) => {
            if (hostOf(bookmark?.url) !== host) return;
            const pageId = Number(bookmark?.pageId);
            if (!Number.isFinite(pageId) || pageId <= 0) return;
            total += 1;
            const key = `${pageId}::${String(bookmark?.category || '')}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        if (!total) return null;
        let best = null;
        counts.forEach((have, key) => {
            if (!best || have > best.have) best = { key, have };
        });
        if (!best || best.have < MIN_AGREEING) return null;
        if (best.have / total < MIN_SHARE) return null;
        const [pageId, category] = best.key.split('::');
        return {
            pageId: Number(pageId),
            category,
            have: best.have,
            of: total,
        };
    }

    /**
     * The same answer, with the names a reader recognises, for a dashboard.
     *
     * The page's own label rather than its id, and the category's name rather
     * than the id the bookmarks carry -- Bookmark.Category is always an id
     * (models.go), which reads as gibberish on a chip.
     */
    function forBookmark(dash, bookmark) {
        const found = suggest(dash?.allBookmarks || [], bookmark?.url);
        if (!found) return null;
        const page = (dash?.pages || []).find((entry) => String(entry.id) === String(found.pageId));
        const pageLabel = dash?.pageNav?.pageLabel?.(found.pageId) || page?.name || String(found.pageId);
        let categoryLabel = found.category;
        if (found.category && String(dash?.currentPageId) === String(found.pageId)) {
            const hit = (dash?.categories || []).find(
                (entry) => String(entry.id) === String(found.category));
            if (hit?.name) categoryLabel = hit.name;
        }
        return { ...found, pageLabel, categoryLabel };
    }

    global.DestinationSuggest = { suggest, forBookmark, MIN_AGREEING, MIN_SHARE };
}(window));
