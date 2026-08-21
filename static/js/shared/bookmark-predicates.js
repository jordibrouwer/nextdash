/**
 * One answer to "which bookmarks", for every part of the app that asks.
 *
 * The question was implemented twice. The search bar had `status:untagged` and
 * the config list had a cleanup filter called *Without tags*; both meant the
 * same thing and neither knew about the other, so they could disagree — over
 * whitespace-only tags, over a note that is a single space, over what "checked"
 * counts as — and any fix landed on one of them. The statistics panel counted
 * a third way.
 *
 * These are the predicates that need nothing but the bookmark itself. The ones
 * that need the world — duplicates need every URL, reachability needs the
 * monitor, a feed needs Fresh — stay with their caller, because a shared
 * registry that has to be handed three collaborators is a second problem rather
 * than a solution.
 *
 * `ctx` carries the few numbers a caller can legitimately differ on: the stale
 * threshold is a setting, and "recently" is seven days here and could be a
 * setting later.
 */
(function (global) {
    'use strict';

    const DAY = 86400000;

    /** Tags, trimmed: a tag of spaces is not a tag, wherever it is counted. */
    function tagCount(bookmark) {
        const tags = Array.isArray(bookmark?.tags) ? bookmark.tags : [];
        return tags.filter((tag) => String(tag).trim()).length;
    }

    function hasNote(bookmark) {
        return Boolean(String(bookmark?.note || '').trim());
    }

    function opens(bookmark) {
        return Number(bookmark?.openCount || 0) || 0;
    }

    const PREDICATES = {
        untagged: (b) => tagCount(b) === 0,
        tagged: (b) => tagCount(b) > 0,
        noted: (b) => hasNote(b),
        unnoted: (b) => !hasNote(b),
        pinned: (b) => b?.pinned === true,
        unpinned: (b) => b?.pinned !== true,
        checked: (b) => b?.checkStatus === true,
        unchecked: (b) => b?.checkStatus !== true,
        // Never opened is opens *and* a timestamp: an import can carry a count
        // with no date, and a restored bookmark the other way round.
        never: (b) => !opens(b) && !Number(b?.lastOpened || 0),
        once: (b) => opens(b) === 1,
        insecure: (b) => /^http:\/\//i.test(String(b?.url || '')),
        noicon: (b) => !String(b?.icon || '').trim(),
        /** Added or edited recently; `days` is the caller's idea of recent. */
        changed: (b, ctx = {}) => {
            const at = Number(b?.updatedAt || 0) || Number(b?.createdAt || 0);
            const days = Number(ctx.recentDays) || 7;
            return at > 0 && Date.now() - at <= days * DAY;
        },
        /** Not opened in a while; `staleDays` is a setting, so it is required. */
        stale: (b, ctx = {}) => {
            const days = Number(ctx.staleDays) || 90;
            const last = Number(b?.lastOpened || 0);
            return !last || Date.now() - last > days * DAY;
        },
    };

    global.BookmarkPredicates = {
        has: (name) => typeof PREDICATES[name] === 'function',
        match: (name, bookmark, ctx) => (
            typeof PREDICATES[name] === 'function' ? PREDICATES[name](bookmark, ctx || {}) : true
        ),
        names: () => Object.keys(PREDICATES),
    };
}(typeof window !== 'undefined' ? window : globalThis));
