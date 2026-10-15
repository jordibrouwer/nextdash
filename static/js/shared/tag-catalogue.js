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
    // last said, and the catalogue's size against the collection.
    let unknownHosts = [];
    let stats = null;

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
                stats = data?.stats || null;
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
        /*
         * What the round is doing, a line at a time under the bar: what it
         * found, what it did not, and what it skipped because the reader once
         * turned it down. Only the latest few stay, so a long round does not
         * grow the overlay off the screen.
         */
        const lines = [];
        const draw = () => {
            // Only while the overlay is up: detail() creates the overlay when
            // there is none, and a round that finished inside the delay would
            // leave an empty one standing.
            const shown = document.getElementById('nextdash-progress-overlay');
            if (!shown || shown.hidden) return;
            overlay?.update?.(done, total, status());
            const box = overlay?.detail?.();
            if (!box) return;
            box.replaceChildren(...lines.map(([text, ok]) => {
                const line = document.createElement('div');
                line.className = ok ? 'tag-lookup-line is-found' : 'tag-lookup-line';
                line.textContent = text;
                return line;
            }));
        };
        const say = (text, ok) => {
            lines.push([text, ok]);
            if (lines.length > 6) lines.shift();
            draw();
        };
        /*
         * The overlay appears after its delay and clears what was written
         * under it before then -- and the catalogue's part of a round is often
         * done by that time. So the round keeps its own state and draws it
         * again once the overlay is up, rather than showing "0 of 101" until
         * the first answer from Wikidata.
         */
        const redraw = setTimeout(draw, (Number.isFinite(options.delay) ? options.delay : 300) + 30);
        let off = false;
        try {
            // First the catalogue, in one request: whatever it knows needs no
            // lookup, and what it does not know is all that goes to Wikidata.
            const subset = await askSubset(hosts);
            // What the catalogue knew is on screen at once, before the first
            // answer from Wikidata.
            if (subset?.added) changed();
            const unknown = new Set(subset?.unknown || hosts);
            const known = hosts.filter((host) => !unknown.has(host));
            if (known.length) {
                done += known.length;
                found += known.length;
                say(t('config.tagLookupFromCatalogue', '✓ {n} sites known to the catalogue')
                    .replace('{n}', String(known.length)), true);
                draw();
            }
            const ask = hosts.filter((host) => unknown.has(host));
            const refused = refusedSet();
            for (let i = 0; i < ask.length && !stopped && !off; i += LOOKUP_BATCH) {
                const batch = ask.slice(i, i + LOOKUP_BATCH);
                const data = await askLookup(batch);
                if (data?.enabled === false) {
                    off = true;
                    say(t('config.tagLookupOffLine', 'Looking up online is off; only the catalogue was used.'), false);
                    break;
                }
                if (!data) break;
                const results = data.results || {};
                const home = new Set(data.skipped || []);
                batch.forEach((host) => {
                    if (home.has(host)) {
                        say(t('config.tagLookupLocalLine', '· {host}: on your own network, not looked up').replace('{host}', host), false);
                        return;
                    }
                    const tags = results[host]?.tags || [];
                    const open = tags.filter((tag) => !refused.has(`${host}|${tag}`));
                    if (open.length) {
                        found += 1;
                        say(`✓ ${host} → ${open.map((tag) => `#${tag}`).join(' ')}`, true);
                    } else if (tags.length) {
                        say(t('config.tagLookupRefusedLine', '· {host}: turned down before, skipped').replace('{host}', host), false);
                    } else {
                        say(t('config.tagLookupNothingLine', '· {host}: nothing found').replace('{host}', host), false);
                    }
                });
                done += batch.length;
                draw();
                // The service was unreachable: stop rather than hammer it.
                if (data.pending) {
                    say(t('config.tagLookupUnreachable', 'Wikidata did not answer; try again later.'), false);
                    break;
                }
            }
        } finally {
            clearTimeout(redraw);
            end();
            lookupRunning = false;
        }
        return { asked: done, found, stopped, off };
    }

    function refusedSet() {
        return new Set((global.dashboardInstance?.settings?.dismissedTagSuggestions || [])
            .map((entry) => String(entry).trim().toLowerCase()));
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
    /**
     * Ask the server what the catalogue knows about these hosts and merge it
     * into the copy. Resolves to the answer ({ tags, unknown }) or null.
     */
    async function askSubset(hosts) {
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
        if (!Array.isArray(data?.tags)) return null;
        hosts.forEach((host) => asked.add(host));
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
        data.added = added;
        return data;
    }

    async function ensureHosts(urls, options = {}) {
        await load();
        const hosts = [...new Set((urls || []).map(hostOf).filter((host) => host && !asked.has(host)))];
        if (!hosts.length) return false;
        const data = await askSubset(hosts);
        if (!data) return false;
        let added = data.added;
        // A draft is waiting for its answer, so its own lookup is not queued
        // behind the collection's: asked now, and awaited.
        const fresh = (data.unknown || []).filter((host) => !lookedUp.has(host));
        if (fresh.length && !lookupOff && options.lookup !== false) {
            fresh.forEach((host) => lookedUp.add(host));
            const before = revision;
            // A caller that shows its own progress (the tag popover) passes
            // overlay: false; the overlay would cover it.
            const end = global.ProgressOverlay?.begin && options.overlay !== false
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

    /*
     * The quiet round for links that just arrived.
     *
     * Nobody asked for it, so it shows nothing: no overlay, no notice, and it
     * never writes a tag. What it finds lands in the same copy the button's
     * round fills, and changed() lets the open views offer it as chips.
     *
     * Bounded on every side. A host is tried once per thirty days (the
     * server's own cache keeps a miss for as long), a round takes at most
     * twenty, and a round already running -- the reader's own -- is never
     * pushed aside. What does not fit waits for the next trigger.
     */
    const AUTO_MAX_HOSTS = 20;
    const AUTO_DEBOUNCE_MS = 5000;
    const AUTO_PAUSE_MS = 10 * 60 * 1000;
    const AUTO_TRIED_KEY = 'nextdash.tagAuto.tried';
    const AUTO_TRIED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const autoQueue = new Set();
    let autoTimer = null;
    let autoRunning = false;
    let autoPausedUntil = 0;

    function autoTried() {
        try {
            const raw = JSON.parse(localStorage.getItem(AUTO_TRIED_KEY) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch {
            return {};
        }
    }

    function autoRemember(hosts) {
        const now = Date.now();
        const tried = autoTried();
        Object.keys(tried).forEach((host) => {
            if (now - Number(tried[host]) > AUTO_TRIED_TTL_MS) delete tried[host];
        });
        hosts.forEach((host) => { tried[host] = now; });
        try {
            localStorage.setItem(AUTO_TRIED_KEY, JSON.stringify(tried));
        } catch { /* storage refused: the session's own sets still hold */ }
    }

    async function autoFlush() {
        autoTimer = null;
        if (lookupOff || autoRunning || !autoQueue.size || Date.now() < autoPausedUntil) return;
        // The reader's own round comes first; look again when it is over.
        if (lookupRunning) {
            autoTimer = setTimeout(autoFlush, AUTO_DEBOUNCE_MS);
            return;
        }
        autoRunning = true;
        try {
            await load();
            const tried = autoTried();
            const now = Date.now();
            const hosts = [...autoQueue]
                .filter((host) => !lookedUp.has(host) && !(now - Number(tried[host]) < AUTO_TRIED_TTL_MS))
                .slice(0, AUTO_MAX_HOSTS);
            autoQueue.clear();
            if (!hosts.length) return;
            const subset = await askSubset(hosts);
            if (!subset) return;
            if (subset.added) changed();
            const fresh = (subset.unknown || []).filter((host) => !lookedUp.has(host));
            fresh.forEach((host) => lookedUp.add(host));
            if (fresh.length) {
                const data = await askLookup(fresh);
                if (!data) return;
                if (data.enabled === false) return;
                if (data.pending) {
                    autoPausedUntil = Date.now() + AUTO_PAUSE_MS;
                    // Not tried: Wikidata did not answer, so ask again later.
                    fresh.forEach((host) => lookedUp.delete(host));
                    autoRemember(hosts.filter((host) => !fresh.includes(host)));
                    return;
                }
            }
            autoRemember(hosts);
        } finally {
            autoRunning = false;
        }
    }

    /** Queue the addresses of new links; the round runs after a short pause. */
    function autoLookup(urls) {
        if (lookupOff) return;
        (urls || []).map(hostOf).filter(Boolean).forEach((host) => autoQueue.add(host));
        if (!autoQueue.size) return;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(autoFlush, AUTO_DEBOUNCE_MS);
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
    function onChange(listener, options = {}) {
        // A round answers in batches, and a view redrawn for each one is
        // redrawn again before the eye has read it: wait is the pause that
        // folds a burst of changes into one call.
        let timer = null;
        const wrapped = options.wait > 0
            ? () => {
                clearTimeout(timer);
                timer = setTimeout(listener, options.wait);
            }
            : listener;
        listeners.add(wrapped);
        return () => {
            clearTimeout(timer);
            listeners.delete(wrapped);
        };
    }

    /** The collection's sites the catalogue has nothing for. */
    function unknown() {
        return unknownHosts.slice();
    }

    /** { sites, subjects, yours, unknown } as the server last said, or null. */
    function catalogueStats() {
        return stats;
    }

    global.TagCatalogue = { load, now, ensureHosts, version, onChange, lookupRound, autoLookup, unknown, stats: catalogueStats };
})(window);
