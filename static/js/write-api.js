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
})(typeof window !== 'undefined' ? window : globalThis);
