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
 *
 * Sites the catalogue does not know can be looked up online
 * (internal/app/tag_lookup.go, Wikidata, host name only, unless the reader
 * turned it off). What comes back is merged in as hosts written "~host":
 * the engine reads those as its own source, so a suggestion says where it
 * came from, and whoever draws suggestions hears about it through onChange().
 *
 * Nothing is looked up on its own when a page loads: a round is something
 * the reader starts (lookupRound), from the suggestions tab or the bookmarks
 * view, and watches on the progress overlay. The one exception is a link
 * being typed into an add form -- the reader is already waiting on that
 * one, so ensureHosts() asks for it straight away. Answers the server already
 * holds come back before the overlay's delay and never show it.
 */
(function (global) {
    'use strict';

    const LOOKUP_BATCH = 50;

    let catalogue = null;
    let pending = null;
    let revision = 0;
    // Hosts the server has already answered for, so a draft that is retyped
    // ten times asks once.
    const asked = new Set();
    // Hosts already sent to the online lookup, or waiting to be.
    const lookedUp = new Set();
    const listeners = new Set();
    let lookupRunning = false;
    let lookupOff = false;
    // The collection's hosts the catalogue has nothing for, as the server
    // last said.
    let unknownHosts = [];

    function t(key, fallback) {
        const lang = global.dashboardInstance?.language;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) return value;
        }
        return fallback;
    }

    function overlayTitle() {
        return t('config.tagLookupProgressTitle', 'Looking up sites online…');
    }

    function bySubject() {
        const map = new Map();
        (catalogue || []).forEach((entry) => map.set(entry.tag, entry));
        return map;
    }

    function changed() {
        revision += 1;
        listeners.forEach((listener) => {
            try {
                listener();
            } catch {
                // One reader that fails to redraw does not stop the others.
            }
        });
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
                unknownHosts = Array.isArray(data?.unknown) ? data.unknown : [];
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

    /**
     * Look up a set of sites online, in batches, on the progress overlay.
     *
     * urls: the addresses to look up -- every bookmark, the untagged ones,
     * or one -- or omitted for every site in the collection the catalogue
     * does not know. Sites the catalogue knows, and private addresses, are
     * skipped by the server. Resolves to { asked, found, stopped, off }:
     * found is how many sites came back with a subject.
     */
    async function lookupRound(urls, options = {}) {
        await load();
        if (lookupRunning) return { asked: 0, found: 0, busy: true };
        const hosts = urls
            ? [...new Set(urls.map(hostOf).filter(Boolean))]
            : unknownHosts.slice();
        if (!hosts.length) return { asked: 0, found: 0 };
        lookupRunning = true;
        let stopped = false;
        let done = 0;
        let found = 0;
        const total = hosts.length;
        const status = () => t('config.tagLookupProgressStatus', '{done} of {total} sites · {found} with a tag')
            .replace('{done}', String(done)).replace('{total}', String(total)).replace('{found}', String(found));
        const overlay = global.ProgressOverlay;
        const end = overlay?.begin
            ? overlay.begin(options.title || overlayTitle(), status(), {
                // Stopping costs the rest of this round only; what was found stays.
                onCancel: () => { stopped = true; },
                cancelLabel: t('config.tagLookupProgressStop', 'Stop'),
                delay: options.delay,
            })
            : () => {};
        let off = false;
        try {
            for (let i = 0; i < hosts.length && !stopped; i += LOOKUP_BATCH) {
                const batch = hosts.slice(i, i + LOOKUP_BATCH);
                const data = await askLookup(batch);
                if (data?.enabled === false) {
                    off = true;
                    break;
                }
                done += batch.length;
                found += countOffered(data?.results);
                overlay?.update?.(done, total, status());
                // The service was unreachable: stop rather than hammer it.
                if (!data || data.pending) break;
            }
        } finally {
            end();
            lookupRunning = false;
        }
        return { asked: done, found, stopped, off };
    }

    /*
     * How many sites came back with a tag the reader has not turned down.
     *
     * A refusal is stored as "site|tag" (dismissedTagSuggestions) and the
     * engine drops every proposal it names, so a site whose only finds were
     * refused before will propose nothing -- and the count says so rather
     * than promising a suggestion that never appears.
     */
    function countOffered(results) {
        const refused = new Set((global.dashboardInstance?.settings?.dismissedTagSuggestions || [])
            .map((entry) => String(entry).trim().toLowerCase()));
        return Object.entries(results || {}).filter(([host, found]) =>
            (found?.tags || []).some((tag) => !refused.has(`${host}|${tag}`))).length;
    }

    /** One request to the lookup; merges what it found and tells the listeners. */
    async function askLookup(hosts) {
        let data = null;
        try {
            const response = await fetch('/api/tags/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hosts }),
            });
            data = response.ok ? await response.json() : null;
        } catch {
            data = null;
        }
        if (!data) return null;
        if (data.enabled === false) {
            lookupOff = true;
            return data;
        }
        if (mergeLookups(data.results)) changed();
        return data;
    }

    /** Fold { host: { tags, about } } into the copy as "~host" entries. */
    function mergeLookups(results) {
        if (!catalogue || !results) return false;
        const known = bySubject();
        let added = false;
        Object.entries(results).forEach(([host, found]) => {
            (found?.tags || []).forEach((tag) => {
                let entry = known.get(tag);
                if (!entry) {
                    entry = { tag, aliases: [], hosts: [] };
                    catalogue.push(entry);
                    known.set(tag, entry);
                }
                entry.hosts = Array.isArray(entry.hosts) ? entry.hosts : [];
                const written = `~${host}`;
                if (entry.hosts.includes(written)) return;
                entry.hosts.push(written);
                if (found.about) {
                    entry.about = entry.about || {};
                    entry.about[host] = found.about;
                }
                added = true;
            });
        });
        return added;
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
        // A draft is waiting for its answer, so its own lookup is not queued
        // behind the collection's: asked now, and awaited.
        const fresh = (data.unknown || []).filter((host) => !lookedUp.has(host));
        if (fresh.length && !lookupOff) {
            fresh.forEach((host) => lookedUp.add(host));
            const before = revision;
            const end = global.ProgressOverlay?.begin
                ? global.ProgressOverlay.begin(overlayTitle(), fresh.join(', '))
                : () => {};
            try {
                await askLookup(fresh);
            } finally {
                end();
            }
            if (revision !== before) added = true;
        }
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

    /**
     * Be told when the copy grows after the first answer -- an online lookup
     * landing. Returns the way to stop listening.
     */
    function onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }

    /** The collection's sites the catalogue has nothing for. */
    function unknown() {
        return unknownHosts.slice();
    }

    global.TagCatalogue = { load, now, ensureHosts, version, onChange, lookupRound, unknown };
})(window);
