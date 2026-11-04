/**
 * Optional write token for destructive API calls (NEXTDASH_WRITE_TOKEN).
 */
(function (global) {
    'use strict';

    function readWriteToken() {
        return document.querySelector('meta[name="nextdash-write-token"]')?.content?.trim() || '';
    }

    global.nextDashWriteHeaders = function nextDashWriteHeaders(extraHeaders) {
        const headers = { ...(extraHeaders || {}) };
        const token = readWriteToken();
        if (token) {
            headers['X-NextDash-Token'] = token;
        }
        return headers;
    };

    /*
     * Tags a save took off a bookmark come back as refusals the server just
     * recorded (internal/app/tag_refusals.go). They go into the settings this
     * tab holds at once: its next settings save sends the whole list, and an
     * older list would quietly put the refused tags back on offer.
     */
    function takeRefusedTags(response) {
        const read = (name) => String(response?.headers?.get?.(name) || '')
            .split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
        const refused = read('X-NextDash-Refused-Tags');
        // And the ones a save took back: a tag put on a bookmark again.
        const wanted = new Set(read('X-NextDash-Wanted-Tags'));
        const dash = global.dashboardInstance;
        if ((!refused.length && !wanted.size) || !dash?.settings) return;
        const list = Array.isArray(dash.settings.dismissedTagSuggestions) ? dash.settings.dismissedTagSuggestions : [];
        const next = list.filter((entry) => !wanted.has(entry))
            .concat(refused.filter((entry) => !list.includes(entry)));
        if (next.length === list.length && next.every((entry, i) => entry === list[i])) return;
        dash.settings.dismissedTagSuggestions = next;
        global.TagSuggestLive?.changed?.(dash);
    }

    /** fetch() with X-NextDash-Token merged when configured. */
    global.nextDashFetch = function nextDashFetch(url, init) {
        const options = { ...(init || {}) };
        options.headers = global.nextDashWriteHeaders(options.headers);
        return fetch(url, options).then((response) => {
            try {
                takeRefusedTags(response);
            } catch {
                // Bookkeeping only: the save itself already happened.
            }
            return response;
        });
    };

    /*
     * One request for the same GET asked twice at once.
     *
     * Start-up has several readers of the same few routes -- the update status,
     * the app discovery, the data revision -- each fetching for itself, so one
     * page load asked for the same answer two or three times, a round trip each.
     * Callers that arrive while the first is still on its way share it.
     *
     * Nothing is kept once it has answered: the next call asks the server again,
     * so a caller that has just changed something never reads an older answer
     * than the one it would have got. Each caller gets its own copy of the
     * response, as the body can be read once.
     */
    const inFlight = new Map();
    global.nextDashFetchShared = function nextDashFetchShared(url, init) {
        const options = init || {};
        const method = String(options.method || 'GET').toUpperCase();
        if (method !== 'GET' || options.signal || typeof fetch !== 'function') {
            return fetch(url, options);
        }
        const key = `${url}|${options.cache || ''}`;
        let pending = inFlight.get(key);
        if (!pending) {
            pending = fetch(url, options);
            inFlight.set(key, pending);
            const clear = () => { if (inFlight.get(key) === pending) inFlight.delete(key); };
            pending.then(clear, clear);
        }
        return pending.then((response) => response.clone());
    };
})(typeof window !== 'undefined' ? window : globalThis);
