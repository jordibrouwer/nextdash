/**
 * How long news stays "open for you".
 *
 * Pure, so the rules can be tested without a browser. `stored` is what the
 * device kept from the last evaluation; the result's `stored` is what to keep
 * next. The window starts when the tab is visible -- news found while the tab
 * sat in the background has not been seen yet -- and newer news starts it again.
 */
(function (global) {
    'use strict';

    /**
     * @param {{newestNewAt: number, startedAt: number}|null} stored
     * @param {{newestNewAt: number, now: number, visible: boolean, windowMs: number}} input
     * @returns {{phase: 'none'|'pending'|'open'|'closed', stored: object|null, remainingMs: number}}
     */
    function next(stored, input) {
        const newest = Number(input.newestNewAt) || 0;
        const now = Number(input.now) || 0;
        const windowMs = Number(input.windowMs) || 30 * 60 * 1000;
        if (!(newest > 0)) return { phase: 'none', stored: null, remainingMs: 0 };

        // Only news newer than anything the window has seen restarts it. When
        // the newest drops -- the reader opened the site that had it, and an
        // older one is now the newest -- the window carries on as it was.
        const seen = stored ? Number(stored.newestNewAt) || 0 : 0;
        const restarts = !stored || newest > seen;
        let startedAt = restarts ? 0 : Number(stored.startedAt) || 0;
        if (!startedAt && input.visible) startedAt = now;
        const kept = { newestNewAt: Math.max(newest, restarts ? 0 : seen), startedAt };
        if (!startedAt) return { phase: 'pending', stored: kept, remainingMs: windowMs };

        const elapsed = now - startedAt;
        if (elapsed < windowMs) return { phase: 'open', stored: kept, remainingMs: windowMs - elapsed };
        return { phase: 'closed', stored: kept, remainingMs: 0 };
    }

    global.FeedWatchWindow = { next };
})(window);
