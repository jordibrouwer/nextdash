/**
 * The shipped catalogue of subjects, fetched once per page load.
 *
 * Two things read it -- the review panel in Config → Bookmarks and the corner
 * card that offers a round of review -- and each used to fetch it for itself.
 * The file is 177 KB, the largest the app ships, so a reader who saw the card
 * and then opened the panel paid for it twice.
 *
 * Versioned by the app fingerprint rather than asked for with `no-cache`, the
 * same route overview-features.json takes: the asset hasher covers .js and
 * .css only, and this is data. A revalidation request on every visit for a
 * file that changes once a release is a round trip bought for nothing.
 */
(function (global) {
    'use strict';

    let catalogue = null;
    let pending = null;

    function url() {
        const version = document.querySelector('meta[name="nextdash-app-version"]')?.content || '';
        return version
            ? `/static/data/tag-patterns.json?v=${encodeURIComponent(version)}`
            : '/static/data/tag-patterns.json';
    }

    /**
     * The subjects, as a promise. Resolves to [] when the file is missing or
     * malformed: that costs the catalogue's own proposals and nothing else,
     * since the rules and the reader's own tags need no file at all.
     */
    function load() {
        if (catalogue) return Promise.resolve(catalogue);
        if (pending) return pending;
        pending = fetch(url())
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                catalogue = Array.isArray(data?.tags) ? data.tags : [];
                return catalogue;
            })
            .catch(() => {
                console.warn('nextDash: the tag catalogue could not be read; '
                    + 'suggestions fall back to your own tags and rules');
                catalogue = [];
                return catalogue;
            });
        return pending;
    }

    /** What has already landed, for a caller that draws synchronously. */
    function now() {
        return catalogue || [];
    }

    global.TagCatalogue = { load, now };
})(window);
