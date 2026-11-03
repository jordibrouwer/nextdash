/**
 * Tag colours: a palette name per tag, painted as a data attribute.
 *
 * The attribute, not an inline colour: the stylesheet turns each name into a
 * tint that reads on whatever theme is showing (static/css/tag-colors.css), and
 * a tag with no colour is simply left as it was. The map is the setting
 * `tagColors`, keyed by the tag in lower case.
 */
(function (global) {
    'use strict';

    const PALETTE = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];

    function map() {
        return global.dashboardInstance?.settings?.tagColors || {};
    }

    /** The palette name for a tag, or ''. */
    function get(tag) {
        const name = map()[String(tag || '').trim().toLowerCase()];
        return PALETTE.includes(name) ? name : '';
    }

    /** Paints one element for a tag; clears the attribute when the tag has no colour. */
    function paint(el, tag) {
        if (!el) return el;
        const name = get(tag);
        if (name) el.setAttribute('data-tag-color', name);
        else el.removeAttribute('data-tag-color');
        return el;
    }

    global.TagColors = { PALETTE, get, paint };
}(typeof window !== 'undefined' ? window : globalThis));
