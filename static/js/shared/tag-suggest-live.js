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
    // The words read from pages, once loaded (storedKeywords), by address.
    let keywordsByURL = null;
    let keywordsRevision = 0;

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
                title: bookmark.previewTitle || '',
                tags: tagsOf(bookmark),
            });
        });
        (dash?.unsortedBookmarks || []).forEach((bookmark) => {
            if (!bookmark?.url) return;
            items.push({
                key: bookmarkKey(bookmark),
                url: bookmark.url,
                name: bookmark.name || '',
                title: bookmark.previewTitle || '',
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
            global.TagCatalogue?.version?.() || 0,
            keywordsRevision,
        ].join(':');
    }

    /**
     * Fetch the shipped catalogue, sharing config's one copy and its promise.
     * Pass the addresses of links the server has not stored yet -- a draft in
     * an add form -- and their hosts are asked about as well, online too
     * unless options.lookup is false: a stored bookmark looked at in a panel
     * is not a search the reader started.
     */
    function ensureCatalogue(urls, options) {
        const load = global.TagCatalogue?.load;
        if (typeof load !== 'function') return Promise.resolve([]);
        const more = urls?.length && global.TagCatalogue?.ensureHosts
            ? global.TagCatalogue.ensureHosts(urls, options).then(load)
            : load();
        return more.then((catalogue) => {
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
                const keywords = keywordsByItemKey(dash);
                groups = global.TagSuggestions.suggest(itemsFor(dash), {
                    rules: dash?.settings?.tagRules || [],
                    catalogue: global.TagCatalogue?.now?.() || [],
                    dismissed: dash?.settings?.dismissedTagSuggestions || [],
                    ...(keywords ? { keywords } : {}),
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
                .catch(() => ({}))
                .then((words) => {
                    keywordsByURL = words;
                    keywordsRevision += 1;
                    return words;
                });
        }
        return keywordsPromise;
    }

    /*
     * The words read so far, by the engine's own keys, once something has
     * loaded them. Before that, none: the per-row answers are drawn without
     * a fetch, and the pages a reader had read show up as soon as anyone
     * asks for the words (the tag view does, when it opens).
     */
    function keywordsByItemKey(dash) {
        if (!keywordsByURL) return null;
        const byKey = {};
        (dash?.allBookmarks || []).forEach((bookmark, index) => {
            const words = keywordsByURL[String(bookmark?.url || '').trim()];
            if (words && words.length) byKey[keyFor('dash', index)] = words;
        });
        (dash?.unsortedBookmarks || []).forEach((bookmark) => {
            const words = keywordsByURL[String(bookmark?.url || '').trim()];
            if (words && words.length) byKey[bookmarkKey(bookmark)] = words;
        });
        return byKey;
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

    /*
     * Links that arrived since this browser first looked, handed to the quiet
     * lookup (TagCatalogue.autoLookup).
     *
     * The starting point is fixed the first time this runs: what was already
     * filed then is the reader's to search for with the button, not a backlog
     * to work through behind their back. Called wherever the collection or the
     * inbox has just been read; the lookup remembers which hosts it has tried.
     */
    const AUTO_SINCE_KEY = 'nextdash.tagAuto.since';

    function autoSince() {
        try {
            let since = Number(localStorage.getItem(AUTO_SINCE_KEY));
            if (!since) {
                since = Date.now();
                localStorage.setItem(AUTO_SINCE_KEY, String(since));
            }
            return since;
        } catch {
            return Infinity;
        }
    }

    function autoSearch(dash) {
        if (!global.TagCatalogue?.autoLookup || dash?.settings?.tagLookupOnline === false) return;
        const since = autoSince();
        const urls = [];
        (dash?.allBookmarks || []).concat(dash?.unsortedBookmarks || []).forEach((bookmark) => {
            if (bookmark?.url && Number(bookmark.createdAt) > since) urls.push(bookmark.url);
        });
        (dash?.inbox?.items || []).forEach((item) => {
            if (item?.url && Number(item.addedAt) > since) urls.push(item.url);
        });
        if (urls.length) global.TagCatalogue.autoLookup(urls);
    }

    /*
     * Whether Find tags puts what it finds on straight away, or leaves it in
     * the rows as offers to take or turn down.
     *
     * Offers unless asked: a round that tagged on its own said only how many
     * bookmarks it had changed, never which, and a wrong tag added unseen is
     * worse than one waiting to be looked at. One choice for the Bookmarks
     * view, the tag view, the inbox and the Tag suggestions tab.
     */
    // A setting (tagSearchApplyNow), so every browser gets the same answer;
    // with settings kept per device it stays in this one (DeviceSettingsMerge).
    function applyNow() {
        return global.dashboardInstance?.settings?.tagSearchApplyNow === true;
    }

    function setApplyNow(on) {
        const d = global.dashboardInstance;
        if (!d?.settings) return Promise.resolve();
        d.settings.tagSearchApplyNow = !!on;
        return Promise.resolve(d.saveSettings?.());
    }

    /**
     * What the offers are worked out from, as one string. A list that keeps
     * only the rows with an offer puts it in its memo: a round that lands
     * changes the catalogue's version, a refusal the dismissed list.
     */
    function stamp(dash) {
        return stampFor(dash);
    }

    /** How many site → tag refusals the collection holds. */
    function refusedCount(dash) {
        return (dash?.settings?.dismissedTagSuggestions || []).length;
    }

    /**
     * Config → Bookmarks → Tag suggestions, with Turned down open and in view:
     * where a refusal is seen and offered again, from any view that refuses.
     * The view first, the tab after -- d.config is a lazy stub until config
     * has loaded, the way TagSuggestionsNotice opens it.
     */
    async function openRefused(dash) {
        if (!dash?.config?.openConfigView) return;
        await dash.config.openConfigView('bookmarks');
        const config = dash.config.instance || dash.config;
        if (!config) return;
        config._tagSuggestionsRefusedOpen = true;
        config.bmTab = 'tag-suggestions';
        config.render?.();
        config.restoreConfigHash?.();
        const block = document.querySelector('[data-tag-suggestions-dismissed]');
        if (!block) return;
        block.open = true;
        block.scrollIntoView({ block: 'start' });
        block.querySelector('summary')?.focus?.({ preventScroll: true });
    }

    global.TagSuggestLive = {
        refusedCount,
        openRefused,
        applyNow,
        setApplyNow,
        stamp,
        autoSearch,
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
