/**
 * Publishes window.NEXTDASH_ASSETS: content-hashed URLs for the scripts that are
 * fetched at runtime rather than by a tag in the template (the config view, the
 * what's-new modal).
 *
 * The map arrives on this script's own data-nextdash-assets attribute. It cannot
 * be an inline <script>: the CSP is script-src 'self' with no 'unsafe-inline',
 * so an inline block would simply not run. Loaders read from here instead of
 * hard-coding a ?v= token, which would pin them to a stale file for a year.
 */
(function () {
    'use strict';

    var el = document.currentScript
        || document.querySelector('script[data-nextdash-assets]');

    var parsed = {};
    var raw = el && el.getAttribute('data-nextdash-assets');
    if (raw) {
        try {
            parsed = JSON.parse(raw) || {};
        } catch (err) {
            // A broken map must not take the page down with it; loaders fall
            // back to an unversioned URL, which still serves the right file.
            console.warn('nextDash: could not parse asset map', err);
        }
    }

    window.NEXTDASH_ASSETS = parsed;
}());
