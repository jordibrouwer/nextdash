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
})(typeof window !== 'undefined' ? window : globalThis);
