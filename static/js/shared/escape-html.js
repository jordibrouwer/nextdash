/*
 * One HTML escaper for the whole dashboard.
 *
 * There were a dozen copies of this function, and they had drifted: most
 * escaped five characters, three escaped four and left the apostrophe alone.
 * That difference is invisible until a value lands inside a single-quoted
 * attribute, at which point one copy is safe and another is not -- and which
 * copy a file happened to define was down to when it was written.
 *
 * Loaded from the document head rather than with the deferred bundle: every
 * caller uses it while rendering, long after load, so a plain synchronous
 * script guarantees it is there for the lazily fetched modules too.
 */
(function (global) {
    'use strict';

    const REPLACEMENTS = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    };

    /**
     * Escapes the five characters that change meaning in markup, so a value is
     * safe both as element text and inside a quoted attribute.
     *
     * null and undefined become the empty string rather than the words "null"
     * and "undefined": every call site here is rendering a value that may
     * legitimately be absent.
     */
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => REPLACEMENTS[ch]);
    }

    global.NextDashHtml = { escapeHtml };
})(window);
