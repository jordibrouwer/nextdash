/**
 * The bookmarks workbench, minus the page.
 *
 * Everything here is arithmetic over plain bookmark objects: which health
 * state a row is in, how many rows each filter would leave, where the group
 * headers go, which slice of a long list to draw, and what a bulk edit does to
 * one bookmark. Kept apart from the renderers so it can be tested without a
 * browser, and so the renderers stay about markup.
 */
(function (global) {
    'use strict';

    function healthState(bookmark, facts) {
        if (bookmark?.checkStatus !== true) return 'unchecked';
        if (facts?.monitor && Number(facts.downSince) > 0) return 'down';
        if (Number(facts?.brokenSince) > 0) return 'broken';
        return 'healthy';
    }

    function facetCounts(list, facets) {
        const names = Object.keys(facets);
        const out = {};
        names.forEach((n) => { out[n] = new Map(); });
        (list || []).forEach((b) => {
            const pass = names.map((n) => Boolean(facets[n].test(b)));
            const failing = pass.filter((p) => !p).length;
            names.forEach((n, i) => {
                // Counted when every other facet passes: either nothing fails,
                // or the only failure is this facet's own filter.
                if (failing > 1 || (failing === 1 && pass[i])) return;
                const seen = new Set();
                (facets[n].keys(b) || []).forEach((k) => {
                    const key = String(k);
                    if (!key.trim() || seen.has(key)) return;
                    seen.add(key);
                    out[n].set(key, (out[n].get(key) || 0) + 1);
                });
            });
        });
        return out;
    }

    function buildItems(rows, opts = {}) {
        const items = [];
        const list = rows || [];
        if (!opts.grouped) {
            list.forEach((bookmark, index) => items.push({
                type: 'row', bookmark, index,
                groupStart: index === 0,
                groupEnd: index === list.length - 1,
            }));
            return items;
        }
        let i = 0;
        while (i < list.length) {
            const key = String(opts.groupKey(list[i]));
            let j = i;
            while (j < list.length && String(opts.groupKey(list[j])) === key) j += 1;
            items.push({ type: 'head', key, label: String(opts.groupLabel(list[i])), count: j - i });
            for (let k = i; k < j; k += 1) {
                items.push({ type: 'row', bookmark: list[k], index: k, groupStart: k === i, groupEnd: k === j - 1 });
            }
            i = j;
        }
        return items;
    }

    function itemOffset(items, itemIndex, rowHeight, headHeight) {
        let px = 0;
        const end = Math.min(itemIndex, items.length);
        for (let i = 0; i < end; i += 1) px += items[i].type === 'head' ? headHeight : rowHeight;
        return px;
    }

    function itemWindow(items, opts) {
        const { scrollTop, viewport, rowHeight, headHeight } = opts;
        const overscan = opts.overscan ?? 20;
        const minItems = opts.minItems ?? 120;
        if (!items || items.length <= minItems) return null;
        const top = Math.max(0, scrollTop);
        let px = 0;
        let first = items.length - 1;
        for (let i = 0; i < items.length; i += 1) {
            const h = items[i].type === 'head' ? headHeight : rowHeight;
            if (px + h > top) { first = i; break; }
            px += h;
        }
        let last = first;
        let seen = 0;
        while (last < items.length && seen < viewport) {
            seen += items[last].type === 'head' ? headHeight : rowHeight;
            last += 1;
        }
        const start = Math.max(0, first - overscan);
        const end = Math.min(items.length, last + overscan);
        if (start === 0 && end >= items.length) return null;
        const above = itemOffset(items, start, rowHeight, headHeight);
        const total = itemOffset(items, items.length, rowHeight, headHeight);
        const below = total - itemOffset(items, end, rowHeight, headHeight);
        return { start, end, above, below };
    }

    function sharedValue(values) {
        const list = values || [];
        if (!list.length) return { mixed: false, value: null };
        const first = list[0];
        const same = list.every((v) => v === first);
        return same ? { mixed: false, value: first } : { mixed: true, value: null };
    }

    function tagCounts(bookmarks) {
        const counts = new Map();
        (bookmarks || []).forEach((b) => {
            new Set((b.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))
                .forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
        });
        return [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
    }

    function bulkMutation(changes, assignCheckMode) {
        const c = changes || {};
        return (bookmark) => {
            const next = { ...bookmark };
            if (typeof c.category === 'string') next.category = c.category;
            if (c.tags && Array.isArray(c.tags.list)) {
                const wanted = c.tags.list.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
                const current = (Array.isArray(next.tags) ? next.tags : []).map((t) => String(t).toLowerCase());
                if (c.tags.mode === 'replace') next.tags = [...new Set(wanted)];
                else if (c.tags.mode === 'remove') next.tags = current.filter((t) => !wanted.includes(t));
                else next.tags = [...new Set([...current, ...wanted])];
            }
            if (typeof c.pinned === 'boolean') next.pinned = c.pinned;
            if (typeof c.checkMode === 'string' && typeof assignCheckMode === 'function') {
                assignCheckMode(next, c.checkMode);
            }
            return next;
        };
    }

    function rangeKeys(keys, anchor, focus) {
        const a = keys.indexOf(anchor);
        const f = keys.indexOf(focus);
        if (f < 0) return [];
        if (a < 0) return [focus];
        const [from, to] = a <= f ? [a, f] : [f, a];
        return keys.slice(from, to + 1);
    }

    global.BookmarkWorkbenchModel = {
        healthState, facetCounts, buildItems, itemWindow, itemOffset,
        sharedValue, tagCounts, bulkMutation, rangeKeys,
    };
}(typeof window !== 'undefined' ? window : globalThis));
