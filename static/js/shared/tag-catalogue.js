/**
 * The shipped catalogue of subjects, fetched once per page load.
 *
 * Several things read it -- the review panel in Config → Bookmarks, the corner
 * card that offers a round of review, and the chips on the inbox and the add
 * forms -- and this holds the one copy they share.
 *
 * The catalogue lives in the server (internal/app/tag_catalogue.go) and is too
 * large to send whole, so what arrives is every subject but only the hosts the
 * collection sits on. A link that is not stored yet -- the one being typed
 * into an add form -- is asked about separately through ensureHosts(), and the
 * answer is merged into the same copy.
 */
(function (global) {
    'use strict';

    let catalogue = null;
    let pending = null;
    let revision = 0;
    // Hosts the server has already answered for, so a draft that is retyped
    // ten times asks once.
    const asked = new Set();

    function bySubject() {
        const map = new Map();
        (catalogue || []).forEach((entry) => map.set(entry.tag, entry));
        return map;
    }

    /**
     * The subjects, as a promise. Resolves to [] when the answer is missing or
     * malformed: that costs the catalogue's own proposals and nothing else,
     * since the rules and the reader's own tags need no catalogue at all.
     */
    function load() {
        if (catalogue) return Promise.resolve(catalogue);
        if (pending) return pending;
        pending = fetch('/api/tags/catalogue', { cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
                catalogue = Array.isArray(data?.tags) ? data.tags : [];
                revision += 1;
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

    function hostOf(url) {
        try {
            const parsed = new URL(String(url || ''));
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return parsed.hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    /**
     * Make sure the catalogue knows about these addresses, for links the
     * server has not stored. Resolves to true when anything new arrived.
     */
    async function ensureHosts(urls) {
        await load();
        const hosts = [...new Set((urls || []).map(hostOf).filter((host) => host && !asked.has(host)))];
        if (!hosts.length) return false;
        hosts.forEach((host) => asked.add(host));
        let data = null;
        try {
            const response = await fetch('/api/tags/catalogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hosts }),
            });
            data = response.ok ? await response.json() : null;
        } catch {
            data = null;
        }
        if (!Array.isArray(data?.tags)) {
            hosts.forEach((host) => asked.delete(host));
            return false;
        }
        const known = bySubject();
        let added = false;
        data.tags.forEach((entry) => {
            if (!Array.isArray(entry?.hosts) || !entry.hosts.length) return;
            const mine = known.get(entry.tag);
            if (!mine) {
                catalogue.push(entry);
                added = true;
                return;
            }
            mine.hosts = Array.isArray(mine.hosts) ? mine.hosts : [];
            entry.hosts.forEach((host) => {
                if (!mine.hosts.includes(host)) {
                    mine.hosts.push(host);
                    added = true;
                }
            });
        });
        if (added) revision += 1;
        return added;
    }

    /** What has already landed, for a caller that draws synchronously. */
    function now() {
        return catalogue || [];
    }

    /** Changes whenever the copy does, for callers that cache an answer. */
    function version() {
        return revision;
    }

    global.TagCatalogue = { load, now, ensureHosts, version };
})(window);
