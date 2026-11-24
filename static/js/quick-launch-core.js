/**
 * Quick launch, the parts that need no page: which bookmarks the panel holds,
 * and when a moving mouse has drawn enough circles.
 *
 * Kept apart from quick-launch.js so both can be called on their own in a test.
 */
(function (global) {
    'use strict';

    const FULL_TURN = Math.PI * 2;
    /** A step shorter than this is a tremor, not a movement. */
    const MIN_STEP = 8;
    /** Turning only counts inside this window, in milliseconds. */
    const WINDOW_MS = 1600;
    /** A circle narrower than this is a wobble; wider than this is a sweep across the screen. */
    const MIN_SIZE = 50;
    const MAX_SIZE = 420;
    /** How much of the movement has to turn the same way: a shake or a line fails this. */
    const MIN_CONSISTENCY = 0.7;
    /** A turn sharper than this (115 degrees) is a reversal: a shake, not a circle. It forgets what came before. */
    const MAX_TURN = 2;

    const hasUrl = (bookmark) => Boolean(bookmark && /^https?:/i.test(String(bookmark.url || '').trim()));
    const opens = (bookmark) => Number(bookmark?.openCount) || 0;
    const lastOpened = (bookmark) => Number(bookmark?.lastOpened) || 0;

    /**
     * The tiles, in order.
     *
     * `bookmarks` come in the order the dashboard wants them to win: the page on
     * screen first, then the rest. A bookmark whose address is already in the
     * list is skipped, so the same link on two pages is one tile.
     *
     * `added` are the addresses put in by hand. They come first, in the order
     * they were added, whatever the source and whether or not they are hidden.
     *
     * source "pinned": the pinned ones. "top": the most opened, pinned or not.
     * "mix" (the default): pinned first, then the most opened that are not
     * pinned, up to `count`.
     *
     * Returns [{ bookmark, group }] with group "added", "pinned" or "top".
     */
    function buildList(bookmarks, options) {
        const source = options?.source === 'pinned' || options?.source === 'top' ? options.source : 'mix';
        const count = Math.max(1, Math.min(8, Math.floor(Number(options?.count)) || 8));
        const hidden = new Set((options?.hidden || []).map((url) => String(url).trim()));
        const addedUrls = (options?.added || []).map((url) => String(url).trim()).filter(Boolean);
        const addedSet = new Set(addedUrls);

        const seen = new Set();
        const pool = [];
        const added = new Map();
        (Array.isArray(bookmarks) ? bookmarks : []).forEach((bookmark) => {
            if (!hasUrl(bookmark)) return;
            const url = String(bookmark.url).trim();
            if (seen.has(url)) return;
            seen.add(url);
            if (addedSet.has(url)) {
                added.set(url, bookmark);
                return;
            }
            if (hidden.has(url)) return;
            pool.push(bookmark);
        });
        const first = addedUrls.filter((url) => added.has(url))
            .map((url) => ({ bookmark: added.get(url), group: 'added' }))
            .slice(0, count);
        const room = count - first.length;
        if (room <= 0) return first;

        const mostOpened = (list) => list
            .map((bookmark, order) => ({ bookmark, order }))
            .filter((entry) => opens(entry.bookmark) > 0)
            .sort((a, b) => opens(b.bookmark) - opens(a.bookmark)
                || lastOpened(b.bookmark) - lastOpened(a.bookmark)
                || a.order - b.order)
            .map((entry) => entry.bookmark);

        const pinned = pool.filter((bookmark) => bookmark.pinned === true);
        if (source === 'pinned') {
            return first.concat(pinned.slice(0, room).map((bookmark) => ({ bookmark, group: 'pinned' })));
        }
        if (source === 'top') {
            return first.concat(mostOpened(pool).slice(0, room).map((bookmark) => ({
                bookmark,
                group: bookmark.pinned === true ? 'pinned' : 'top',
            })));
        }
        const head = pinned.slice(0, room).map((bookmark) => ({ bookmark, group: 'pinned' }));
        const rest = mostOpened(pool.filter((bookmark) => bookmark.pinned !== true))
            .slice(0, room - head.length)
            .map((bookmark) => ({ bookmark, group: 'top' }));
        return first.concat(head, rest);
    }

    /**
     * Counts the turning of a pointer.
     *
     * feed(x, y, t) takes each pointer position and answers how far along the
     * gesture is, 0 to 1. At 1 the caller opens the panel and calls reset().
     * Turning is the change of direction between one step and the next, summed
     * over the last 1.6 seconds, so clockwise and anticlockwise both count and
     * a pause forgets what came before it.
     */
    function createRecognizer(initial) {
        let turns = Number(initial?.turns) || 1.5;
        let points = [];
        let previousDirection = null;
        let last = null;

        function reset() {
            points = [];
            previousDirection = null;
            last = null;
        }

        function setTurns(next) {
            const value = Number(next);
            if (value >= 1 && value <= 3) turns = value;
        }

        function feed(x, y, now) {
            if (last && Math.hypot(x - last.x, y - last.y) < MIN_STEP) {
                // A pause forgets: a tremor must not keep old turning alive.
                points = points.filter((point) => now - point.t < WINDOW_MS);
                return progress();
            }
            if (last) {
                const direction = Math.atan2(y - last.y, x - last.x);
                if (previousDirection !== null) {
                    let delta = direction - previousDirection;
                    while (delta > Math.PI) delta -= FULL_TURN;
                    while (delta <= -Math.PI) delta += FULL_TURN;
                    if (Math.abs(delta) > MAX_TURN) points = [];
                    else points.push({ t: now, delta, x, y });
                }
                previousDirection = direction;
            }
            last = { x, y };
            points = points.filter((point) => now - point.t < WINDOW_MS);
            return progress();
        }

        function progress() {
            if (points.length === 0) return 0;
            let sum = 0;
            let absolute = 0;
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            points.forEach((point) => {
                sum += point.delta;
                absolute += Math.abs(point.delta);
                minX = Math.min(minX, point.x);
                maxX = Math.max(maxX, point.x);
                minY = Math.min(minY, point.y);
                maxY = Math.max(maxY, point.y);
            });
            const size = Math.max(maxX - minX, maxY - minY);
            if (!(absolute > 0) || Math.abs(sum) / absolute < MIN_CONSISTENCY || size < MIN_SIZE || size > MAX_SIZE) {
                return 0;
            }
            return Math.min(1, Math.abs(sum) / (turns * FULL_TURN));
        }

        return { feed, reset, setTurns, progress };
    }

    global.QuickLaunchCore = { buildList, createRecognizer };
}(window));
