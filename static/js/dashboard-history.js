/**
 * Browser history for the dashboard's views.
 *
 * The app writes its URL constantly -- filters, sort order, the selected row --
 * and almost none of that is navigation. Only a view or page change is a place
 * you can go Back from, so this module is the one door through which a history
 * entry is added, and every other write stays a replaceState.
 */
(function (global) {
    'use strict';

    let restoring = 0;

    function currentLocation() {
        return `${global.location.pathname}${global.location.search}${global.location.hash}`;
    }

    /**
     * Add one history entry for `url`, unless we are restoring a previous one
     * (a popstate handler putting the view back must not record that as a new
     * place) or the URL is already where we are.
     */
    /*
     * Stamped into history.state on every entry this module creates.
     *
     * A bare `location.hash = '#1'` fires popstate exactly like a real Back --
     * same event, same null state -- so the event alone cannot tell a
     * navigation from an assignment. What separates them is the entry being
     * landed on: one this module pushed carries the stamp, an assignment's
     * does not.
     */
    const STAMP = 'nextdash-nav';

    function stamp(state) {
        return Object.assign({}, state || {}, { [STAMP]: (Number(state?.[STAMP]) || 0) + 1 });
    }

    /** True when the entry we just landed on is one this module created. */
    function isOwnEntry(state) {
        return Number((state || global.history.state)?.[STAMP]) > 0;
    }

    function pushLocation(url) {
        if (restoring > 0) return false;
        if (!url || url === currentLocation()) return false;
        try {
            /*
             * Stamp the entry being left as well as the one being created.
             * Back from the first pushed entry lands on the one the page was
             * loaded with, which this module never wrote -- unstamped, it
             * would read as somebody else's entry and the navigation would be
             * ignored. Stamping it here makes the whole run ours.
             */
            if (!isOwnEntry(global.history.state)) {
                global.history.replaceState(stamp(global.history.state), '', currentLocation());
            }
            global.history.pushState(stamp(global.history.state), '', url);
            return true;
        } catch {
            // history is unavailable in some embedded contexts
            return false;
        }
    }

    function isRestoring() {
        return restoring > 0;
    }

    /**
     * Run `fn` with pushes suppressed. Accepts a promise: every view opener is
     * async, and the URL is written at the end of it, so releasing the flag
     * synchronously would let the tail of a restore push an entry.
     */
    function runRestore(fn) {
        restoring += 1;
        let out;
        try {
            out = fn();
        } catch (err) {
            restoring -= 1;
            throw err;
        }
        if (out && typeof out.then === 'function') {
            return out.finally(() => { restoring -= 1; });
        }
        restoring -= 1;
        return Promise.resolve(out);
    }

    global.DashboardHistory = { pushLocation, isRestoring, runRestore, currentLocation, isOwnEntry };
})(window);
