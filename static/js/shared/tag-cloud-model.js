/**
 * The tag cloud's arithmetic: which tags are big, in what order they stand,
 * and how many bookmarks a tag would add to a filter that is already on.
 *
 * No DOM here, so the dashboard cloud and the config tag cloud rank the same
 * tags the same way, and a node test can hold it to that.
 */
(function () {
    'use strict';

    const norm = (raw) => String(raw || '').trim().toLowerCase();
    const tagsOf = (bookmark) => (Array.isArray(bookmark?.tags)
        ? bookmark.tags.map(norm).filter(Boolean)
        : []);

    /** [{ tag, count }], most used first, ties by name. */
    function countTags(bookmarks) {
        const counts = new Map();
        for (const bookmark of Array.isArray(bookmarks) ? bookmarks : []) {
            for (const tag of tagsOf(bookmark)) {
                counts.set(tag, (counts.get(tag) || 0) + 1);
            }
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }));
    }

    /**
     * Three sizes by rank, not by count.
     *
     * Scaled linearly on the count, a library where the top tag has 34 and the
     * rest between 2 and 12 drew nearly every word the same size. By rank the
     * top eighth is large and the next third medium, whatever the counts are.
     *
     * Tags with the same count share a size: each is placed by the last rank
     * its count reaches, so a tie that straddles a line goes below it rather
     * than splitting "docs 2" large from "tutorial 2" medium. The most used
     * tags are large even when that rule would leave no tag large.
     */
    function rankClasses(ranked) {
        const n = ranked.length;
        const large = Math.max(1, Math.ceil(n * 0.12));
        const medium = Math.max(large, Math.ceil(n * 0.42));
        const lastRankOf = new Map();
        ranked.forEach(({ count }, i) => lastRankOf.set(count, i));
        const topCount = ranked[0]?.count;
        return new Map(ranked.map(({ tag, count }) => {
            const rank = lastRankOf.get(count);
            const size = count === topCount || rank < large ? 'L' : rank < medium ? 'M' : 'S';
            return [tag, size];
        }));
    }

    const CLASS_ORDER = { L: 0, M: 1, S: 2 };

    /** Large first, then medium, then small; alphabetical inside each, so a tag keeps its place. */
    function orderForDisplay(ranked, classes) {
        return ranked
            .map(({ tag }) => tag)
            .sort((a, b) => CLASS_ORDER[classes.get(a)] - CLASS_ORDER[classes.get(b)] || a.localeCompare(b));
    }

    /**
     * For each tag, how many bookmarks it would add to the filter.
     *
     * The filter is "any of", so a bookmark already carrying one of the
     * selected tags is in the result and adds nothing. Empty when nothing is
     * selected.
     */
    function plusCounts(bookmarks, selected) {
        const chosen = new Set((Array.isArray(selected) ? selected : []).map(norm).filter(Boolean));
        const out = new Map();
        if (!chosen.size) return out;
        for (const bookmark of Array.isArray(bookmarks) ? bookmarks : []) {
            const tags = tagsOf(bookmark);
            if (tags.some((tag) => chosen.has(tag))) continue;
            for (const tag of tags) {
                out.set(tag, (out.get(tag) || 0) + 1);
            }
        }
        return out;
    }

    /** Where the typed query sits in the tag, or -1. An empty query matches nothing. */
    function matchQuery(tag, query) {
        const q = norm(query);
        return q ? norm(tag).indexOf(q) : -1;
    }

    window.TagCloudModel = { countTags, rankClasses, orderForDisplay, plusCounts, matchQuery };
})();
