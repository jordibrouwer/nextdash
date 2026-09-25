/**
 * The tag suggestions of Config → Bookmarks, offered where a link is triaged.
 *
 * Config runs the engine over a panel the reader opens on purpose: whole
 * groups, with their evidence, applied in one click. The inbox and the kept
 * list need the same answers one row at a time -- what would this link be
 * tagged, if anything -- and reaching them through that panel means leaving
 * the queue to go and file, which is the opposite of what triage is.
 *
 * So this is the one adapter between the two: it feeds the pure engine
 * (shared/tag-suggestions.js) the collection as its evidence and hands back a
 * per-row answer. One copy, because two mappings of bookmarks-to-items are how
 * two surfaces start disagreeing about what a link should be called.
 */
(function (global) {
    'use strict';

    /** Kept and inbox rows are keyed apart: a URL can sit in both at once. */
    const KEPT = 'kept';
    const INBOX = 'inbox';

    let cache = null;
    let cacheStamp = '';

    function keyFor(scope, id) {
        return `${scope}:${id}`;
    }

    /** The key a kept or filed bookmark answers to inside the engine's result. */
    function bookmarkKey(bookmark, scope = KEPT) {
        return keyFor(scope, `${String(bookmark?.url || '')}|${String(bookmark?.name || '')}`);
    }

    /** The key an inbox item answers to. Its id, which the server owns. */
    function inboxKey(item) {
        return keyFor(INBOX, String(item?.id || ''));
    }

    function tagsOf(row) {
        return Array.isArray(row?.tags) ? row.tags : [];
    }

    /**
     * Everything the engine may reason from.
     *
     * The filed collection is in here as evidence, not as a target: the
     * agreement of thirty tagged bookmarks on a site is precisely what makes a
     * suggestion for the thirty-first worth showing, and a pool of only the
     * untagged rows would have nothing to agree about. Kept rows and inbox
     * items are both -- they support each other and they are what is asked
     * about.
     */
    function itemsFor(dash) {
        const items = [];
        (dash?.allBookmarks || []).forEach((bookmark, index) => {
            if (!bookmark?.url) return;
            items.push({
                key: keyFor('dash', index),
                url: bookmark.url,
                name: bookmark.name || '',
                tags: tagsOf(bookmark),
            });
        });
        (dash?.unsortedBookmarks || []).forEach((bookmark) => {
            if (!bookmark?.url) return;
            items.push({
                key: bookmarkKey(bookmark),
                url: bookmark.url,
                name: bookmark.name || '',
                tags: tagsOf(bookmark),
            });
        });
        (dash?.inbox?.items || []).forEach((item) => {
            if (!item?.url || !item?.id) return;
            items.push({
                key: inboxKey(item),
                url: item.url,
                name: item.previewTitle || item.title || '',
                tags: tagsOf(item),
            });
        });
        return items;
    }

    /**
     * What the answer depends on.
     *
     * Recomputed on a change rather than on a timer: the engine parses every
     * URL in the collection, and a list of a few thousand redrawn on every
     * keystroke in the search box would do that work for nothing. The counts
     * are enough -- every write that could change an answer goes through a
     * reload that changes one of them, and invalidate() covers the rest.
     */
    function stampFor(dash) {
        const settings = dash?.settings || {};
        return [
            (dash?.allBookmarks || []).length,
            (dash?.unsortedBookmarks || []).length,
            (dash?.inbox?.items || []).length,
            (settings.tagRules || []).length,
            (settings.dismissedTagSuggestions || []).length,
            (global.TagCatalogue?.now?.() || []).length,
        ].join(':');
    }

    /** Fetch the shipped catalogue, sharing config's one copy and its promise. */
    function ensureCatalogue() {
        const load = global.TagCatalogue?.load;
        if (typeof load !== 'function') return Promise.resolve([]);
        return load().then((catalogue) => {
            // A catalogue that arrives after the first answer was drawn makes
            // that answer stale: it was computed without the largest of the
            // four sources.
            invalidate();
            return catalogue;
        });
    }

    function invalidate() {
        cache = null;
        cacheStamp = '';
    }

    /**
     * key → the suggestions standing against it, best first.
     *
     * The engine answers in groups (a tag, the rows it covers); a row needs the
     * other direction, so the groups are turned inside out once and read many
     * times.
     */
    function byKey(dash) {
        const stamp = stampFor(dash);
        if (cache && cacheStamp === stamp) return cache;
        const index = new Map();
        if (global.TagSuggestions?.suggest) {
            let groups = [];
            try {
                groups = global.TagSuggestions.suggest(itemsFor(dash), {
                    rules: dash?.settings?.tagRules || [],
                    catalogue: global.TagCatalogue?.now?.() || [],
                    dismissed: dash?.settings?.dismissedTagSuggestions || [],
                });
            } catch {
                // A malformed rule or catalogue costs the suggestions and
                // nothing else: the row still draws.
                groups = [];
            }
            groups.forEach((group) => {
                (group.keys || []).forEach((key) => {
                    const list = index.get(key) || [];
                    list.push({ tag: group.tag, pattern: group.pattern, reason: group.reason });
                    index.set(key, list);
                });
            });
        }
        cache = index;
        cacheStamp = stamp;
        return cache;
    }

    /** The suggestions for one kept bookmark. */
    function forBookmark(dash, bookmark) {
        return byKey(dash).get(bookmarkKey(bookmark)) || [];
    }

    /** The suggestions for one inbox item. */
    function forInboxItem(dash, item) {
        return byKey(dash).get(inboxKey(item)) || [];
    }

    /** The first tag on offer, which is what a grouping reads. */
    function topTag(dash, bookmark) {
        return forBookmark(dash, bookmark)[0]?.tag || '';
    }

    /**
     * How a refusal is stored: "pattern|tag", the shape config writes and the
     * engine filters on, so turning one down here silences it there as well.
     */
    function dismissKey(suggestion) {
        return `${String(suggestion?.pattern || '')}|${String(suggestion?.tag || '')}`.toLowerCase();
    }

    const DRAFT = 'draft:form';
    let keywordsPromise = null;

    /** The words the scan round stored per address, loaded once and shared. */
    function storedKeywords() {
        if (!keywordsPromise) {
            keywordsPromise = fetch('/api/tags/keywords', { cache: 'no-cache' })
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => data?.keywords || {})
                .catch(() => ({}));
        }
        return keywordsPromise;
    }

    function forgetKeywords() {
        keywordsPromise = null;
    }

    /**
     * What a bookmark that does not exist yet would be offered.
     *
     * The collection goes in as evidence, as it does for every other row --
     * three filed bookmarks agreeing on a site is what the derived source
     * needs, and a draft alone can never reach minGroup. Uncached: the draft
     * changes with every keystroke in the tags field.
     */
    function forDraft(dash, draft) {
        const engine = global.TagSuggestions?.suggest;
        const url = String(draft?.url || '').trim();
        if (!engine || !url) return [];
        const tags = (Array.isArray(draft?.tags) ? draft.tags : [])
            .map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
        const items = itemsFor(dash).concat([{ key: DRAFT, url, name: '', tags }]);
        const keywords = Array.isArray(draft?.keywords) && draft.keywords.length
            ? { [DRAFT]: draft.keywords } : undefined;
        let groups = [];
        try {
            groups = engine(items, {
                rules: dash?.settings?.tagRules || [],
                catalogue: global.TagCatalogue?.now?.() || [],
                dismissed: dash?.settings?.dismissedTagSuggestions || [],
                ...(keywords ? { keywords } : {}),
            });
        } catch {
            groups = [];
        }
        return groups
            .filter((group) => (group.keys || []).includes(DRAFT) && !tags.includes(group.tag))
            .map((group) => ({ tag: group.tag, pattern: group.pattern, reason: group.reason }));
    }

    /** The offers standing against one filed bookmark on the dashboard. */
    function forDashBookmark(dash, bookmark) {
        const list = dash?.allBookmarks || [];
        let index = list.indexOf(bookmark);
        if (index < 0) {
            index = list.findIndex((b) => b && b.url === bookmark?.url && (b.name || '') === (bookmark?.name || ''));
        }
        if (index < 0) return [];
        return byKey(dash).get(keyFor('dash', index)) || [];
    }

    /**
     * Something that feeds the engine changed -- a tag accepted, one refused,
     * a page read for words. Everything that holds an answer drops it.
     */
    function changed(dash) {
        invalidate();
        forgetKeywords();
        dash?.config?.onTagEvidenceChanged?.();
    }

    global.TagSuggestLive = {
        ensureCatalogue,
        invalidate,
        byKey,
        forBookmark,
        forInboxItem,
        forDraft,
        forDashBookmark,
        storedKeywords,
        forgetKeywords,
        changed,
        topTag,
        dismissKey,
        bookmarkKey,
        inboxKey,
    };
}(window));
