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

    /** fetch() with X-NextDash-Token merged when configured. */
    global.nextDashFetch = function nextDashFetch(url, init) {
        const options = { ...(init || {}) };
        options.headers = global.nextDashWriteHeaders(options.headers);
        return fetch(url, options);
    };
})(typeof window !== 'undefined' ? window : globalThis);
