/**
 * The notifications bell's rules.
 *
 * Pure, kept apart from the bell so they can be tested without a browser:
 * a row's current state and what was stored for it go in, whether it shows
 * and whether it is unread comes out.
 *
 *   - "Worse": the count rose by at least the threshold, or an id appeared
 *     that was not there before.
 *   - Read: a row stays read until it gets worse than when it was read.
 *   - No: a row answered "No" stays hidden until it gets worse (by its own
 *     threshold, when it has one). "No, forever" hides it for good.
 *   - A tip that was read is gone, until it reports a new id (a daily tip).
 *   - Badge: red counts unread urgent rows, grey counts unread quiet rows and
 *     tips. Health rows never count.
 */
(function (global) {
    'use strict';

    const GROUP_ORDER = ['health', 'news', 'cleanup', 'system', 'privacy', 'tips'];

    /** True when `next` is worse than `prev`; a missing `prev` always is. */
    function isWorse(prev, next, threshold = 1) {
        if (!prev) return true;
        if (next.count >= prev.count + threshold) return true;
        const before = new Set(prev.ids || []);
        return (next.ids || []).some((id) => !before.has(id));
    }

    function rowStatus(entry, stored) {
        const s = stored || {};
        const no = s.no;
        let visible = true;
        if (no) {
            if (no.forever) {
                visible = false;
            } else {
                const threshold = (entry.no && entry.no.threshold) || 1;
                visible = isWorse(no, entry, threshold);
            }
        }
        // A read tip is gone, unless it comes back as a new one (new ids): a
        // tip offered again each day carries the day as its id.
        if (visible && entry.kind === 'tip' && s.read && !isWorse(s.read, entry)) visible = false;
        const unread = !s.read || isWorse(s.read, entry);
        return { visible, unread };
    }

    function badge(rows) {
        let red = 0;
        let grey = 0;
        for (const r of rows) {
            if (!r.visible || !r.unread) continue;
            if (r.kind === 'urgent') red++;
            else if (r.kind === 'quiet' || r.kind === 'tip') grey++;
        }
        return { red, grey };
    }

    global.NotificationBellModel = { isWorse, rowStatus, badge, GROUP_ORDER };
})(window);
