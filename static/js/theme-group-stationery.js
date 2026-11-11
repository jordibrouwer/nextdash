/*
 * The stationery theme group, runtime part; see internal/app/theme_groups.go.
 *
 * Only the Swiss Poster family (stationery-gallery-*) needs any: its huge
 * category numerals have to run 01, 02, 03 across the whole page. CSS counters
 * cannot do that, because the masonry columns are separate containers and a
 * counter does not reach from one to the next, so each column started again at
 * 01. This numbers the categories in document order and writes the number on
 * the category as data-st-n, which the CSS draws.
 *
 * It runs only while such a theme is on. It watches the grid for categories
 * added, moved or removed (and for one being hidden or shown), renumbers on the
 * next frame, and takes every number off again when the theme changes.
 */
(function () {
    'use strict';

    var ACTIVE = /^stationery-gallery-/;
    var SELECTOR = '#dashboard-layout .category:not([data-view="tiles"])';
    var gridObserver = null;
    var queued = 0;

    function active() {
        return ACTIVE.test(document.documentElement.getAttribute('data-theme') || '');
    }

    // A hidden category (collapsed page filter, a hidden widget) takes no number,
    // so the ones that are shown never skip.
    function shown(el) {
        return !el.hidden && el.getClientRects().length > 0;
    }

    function number() {
        queued = 0;
        var n = 0;
        document.querySelectorAll(SELECTOR).forEach(function (el) {
            if (!shown(el)) {
                el.removeAttribute('data-st-n');
                return;
            }
            n += 1;
            var text = (n < 10 ? '0' : '') + n;
            if (el.getAttribute('data-st-n') !== text) el.setAttribute('data-st-n', text);
        });
    }

    function schedule() {
        if (!queued) queued = requestAnimationFrame(number);
    }

    function clear() {
        if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
        if (queued) { cancelAnimationFrame(queued); queued = 0; }
        document.querySelectorAll('[data-st-n]').forEach(function (el) { el.removeAttribute('data-st-n'); });
    }

    function start() {
        var grid = document.getElementById('dashboard-layout');
        if (!grid || gridObserver) return;
        gridObserver = new MutationObserver(schedule);
        gridObserver.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-collapsed', 'data-view'] });
        schedule();
    }

    function sync() {
        if (active()) start(); else clear();
    }

    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
})();
