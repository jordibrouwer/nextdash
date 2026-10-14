/**
 * The tag view's arithmetic: which bookmarks carry the tags, what else they
 * are tagged with, what they add up to, and how the rail, the search and the
 * sort narrow and order them. No DOM, so a node test holds it.
 */
(function () {
    'use strict';

    const norm = (raw) => String(raw || '').trim().toLowerCase();
    const tagsOf = (b) => (Array.isArray(b?.tags) ? b.tags.map(norm).filter(Boolean) : []);
    const pageOf = (b) => Number(b?.pageId ?? b?.pageID) || 0;
    const host = (url) => {
        try { return new URL(url).host; } catch { return ''; }
    };

    /** Bookmarks with any of the tags; the first copy of a url|name wins, as in the tag filter. */
    function matches(pool, tags) {
        const want = new Set((tags || []).map(norm).filter(Boolean));
        const seen = new Set();
        const out = [];
        for (const b of pool || []) {
            if (!tagsOf(b).some((t) => want.has(t))) continue;
            const key = `${String(b.url || '').trim()}|${String(b.name || '').trim()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(b);
        }
        return out;
    }

    /** The other tags on these bookmarks, most shared first. */
    function related(list, tags) {
        const skip = new Set((tags || []).map(norm));
        const counts = new Map();
        for (const b of list || []) {
            for (const t of tagsOf(b)) {
                if (!skip.has(t)) counts.set(t, (counts.get(t) || 0) + 1);
            }
        }
        return [...counts]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([tag, count]) => ({ tag, count }));
    }

    /** What the set adds up to, for the header line. */
    function stats(list, { scoreOf = () => null, isBroken = () => false } = {}) {
        const items = list || [];
        const scores = items.map(scoreOf).filter((s) => s !== null && s !== undefined && Number.isFinite(Number(s))).map(Number);
        let last = null;
        let most = null;
        for (const b of items) {
            const opened = Number(b.lastOpened) || 0;
            if (opened && (last === null || opened > last)) last = opened;
            if (Number(b.openCount) > 0 && (!most || Number(b.openCount) > Number(most.openCount))) most = b;
        }
        return {
            count: items.length,
            pages: new Set(items.map(pageOf)).size,
            lastOpened: last,
            mostOpened: most,
            health: scores.length ? Math.round(scores.reduce((a, s) => a + s, 0) / scores.length) : null,
            broken: items.filter(isBroken).length,
        };
    }

    /** The rail's page and health filters and the search box, together. */
    function applyFilters(list, { page = null, health = null, query = '', isBroken = () => false } = {}) {
        const q = norm(query);
        return (list || []).filter((b) => {
            if (page !== null && page !== undefined && pageOf(b) !== Number(page)) return false;
            if (health === 'broken' && !isBroken(b)) return false;
            if (health === 'never' && Number(b.openCount) > 0) return false;
            if (q && !`${b.name || ''} ${b.url || ''} ${host(b.url)}`.toLowerCase().includes(q)) return false;
            return true;
        });
    }

    const KEYS = {
        lastOpened: (b) => Number(b.lastOpened) || 0,
        name: (b) => String(b.name || b.url || '').toLowerCase(),
        opens: (b) => Number(b.openCount) || 0,
        page: (b) => pageOf(b),
    };

    /** Name and page read A–Z first; the figures read biggest first. Stable. */
    function sort(list, key = 'lastOpened', dir = null) {
        const get = KEYS[key] || KEYS.lastOpened;
        const direction = dir || (key === 'name' || key === 'page' ? 'asc' : 'desc');
        const sign = direction === 'asc' ? 1 : -1;
        return (list || [])
            .map((b, i) => [b, i])
            .sort(([a, ia], [c, ic]) => {
                const x = get(a);
                const y = get(c);
                return (x < y ? -1 : x > y ? 1 : 0) * sign || ia - ic;
            })
            .map(([b]) => b);
    }

    /** `#tag/a+b`: each tag encoded, so a `+` inside one cannot split it. */
    const hashFor = (tags) => `#tag/${(tags || []).map((t) => encodeURIComponent(norm(t))).join('+')}`;

    function tagsFromHash(hash) {
        const raw = String(hash || '').replace(/^#?tag\//, '');
        return raw.split('+')
            .map((part) => {
                try { return norm(decodeURIComponent(part)); } catch { return norm(part); }
            })
            .filter(Boolean);
    }

    window.TagViewModel = { matches, related, stats, applyFilters, sort, hashFor, tagsFromHash };
})();
