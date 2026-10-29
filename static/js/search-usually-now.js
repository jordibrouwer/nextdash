/**
 * Which bookmarks you usually open at this time of day.
 *
 * Pure, so the search panel can ask it and a test can too. An open counts when
 * it happened within an hour and a half of the time now (the window wraps
 * midnight), on the same kind of day (Monday to Friday, or the weekend), in the
 * last eight weeks. A bookmark needs three such opens to be called a habit.
 * The kind of day is that of the open itself, so a Tuesday 23:50 open counts at
 * Wednesday 00:30 and a Saturday one does not.
 */
(function (global) {
    'use strict';

    const MINUTES_PER_DAY = 24 * 60;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    function minutesOfDay(date) {
        return date.getHours() * 60 + date.getMinutes();
    }

    function isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    function distance(a, b) {
        const apart = Math.abs(a - b);
        return Math.min(apart, MINUTES_PER_DAY - apart);
    }

    function inWindow(openLog, now, { windowHours, weeks }) {
        const nowDate = new Date(now);
        const nowMinutes = minutesOfDay(nowDate);
        const weekend = isWeekend(nowDate);
        const since = now - weeks * WEEK_MS;
        let n = 0;
        for (const ts of openLog) {
            if (typeof ts !== 'number' || ts < since || ts > now) continue;
            const opened = new Date(ts);
            if (isWeekend(opened) !== weekend) continue;
            if (distance(minutesOfDay(opened), nowMinutes) <= windowHours * 60) n += 1;
        }
        return n;
    }

    /**
     * The bookmarks that qualify, best first: most opens in the window, then
     * most opens overall. The objects are returned as they came in.
     */
    function pick(bookmarks, now, options = {}) {
        const { windowHours = 1.5, weeks = 8, minOpens = 3, limit = 3 } = options;
        return (bookmarks || [])
            .map((bookmark) => ({
                bookmark,
                n: Array.isArray(bookmark?.openLog) ? inWindow(bookmark.openLog, now, { windowHours, weeks }) : 0,
            }))
            .filter((row) => row.n >= minOpens)
            .sort((a, b) => b.n - a.n || (b.bookmark.openCount || 0) - (a.bookmark.openCount || 0))
            .slice(0, limit)
            .map((row) => row.bookmark);
    }

    /**
     * What the group shows: the three best, or nothing. One or two habits are
     * guesses from thin data, and a group with a single row says more than it
     * knows.
     */
    function usuallyNow(bookmarks, now) {
        const best = pick(bookmarks, now);
        return best.length >= 3 ? best : [];
    }

    global.SearchUsuallyNow = { pick, usuallyNow };
})(typeof window !== 'undefined' ? window : globalThis);
