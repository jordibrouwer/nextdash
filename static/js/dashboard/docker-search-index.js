'use strict';
/**
 * What search, the palette and the nav button need to know about Docker,
 * without loading the view: whether there is a socket, and the container names.
 *
 * Search is synchronous, so it reads a cache this fills in the background when
 * the search panel opens. Thirty seconds is long enough that typing never waits
 * and short enough that a stopped container stops showing as running.
 */
(function () {
    const TTL = 30_000;
    let statusAt = 0, statusValue = null, statusPromise = null;
    let listAt = 0, list = [], listPromise = null;

    async function status() {
        if (statusValue && Date.now() - statusAt < TTL) return statusValue;
        if (statusPromise) return statusPromise;
        statusPromise = fetch('/api/docker/status').then((r) => r.ok ? r.json() : null).catch(() => null)
            .then((value) => {
                statusValue = value || { socket: false, control: false, reason: 'unreachable' };
                statusAt = Date.now();
                statusPromise = null;
                return statusValue;
            });
        return statusPromise;
    }

    async function refresh() {
        const st = await status();
        if (!st.socket) { list = []; return list; }
        if (Date.now() - listAt < TTL) return list;
        if (listPromise) return listPromise;
        listPromise = fetch('/api/docker/containers').then((r) => r.ok ? r.json() : null).catch(() => null)
            .then((body) => {
                list = Array.isArray(body?.containers) ? body.containers : [];
                listAt = Date.now();
                listPromise = null;
                return list;
            });
        return listPromise;
    }

    /**
     * Whether `container` answers `q` (already trimmed and lowercased). Shared
     * between the cached match() below and the open view's own search, so a
     * container findable from the palette is never findable-but-different in
     * the view's toolbar.
     */
    function matches(container, q) {
        if (!q) return true;
        if (String(container.name || '').toLowerCase().includes(q)) return true;
        if (String(container.image || '').toLowerCase().includes(q)) return true;
        if (String(container.composeProject || '').toLowerCase().includes(q)) return true;
        return (container.ports || []).some((p) => String(p.public || p.private) === q);
    }

    /** Config -> Containers can switch the view off; search follows it. */
    function enabled() {
        return window.dashboardInstance?.settings?.dockerViewEnabled !== false;
    }

    function match(query, limit = 5) {
        const q = String(query || '').trim().toLowerCase();
        if (!q || !enabled()) return [];
        const hits = list.filter((c) => matches(c, q));
        const rank = (c) => (c.name.toLowerCase().startsWith(q) ? 0 : 1) + (c.state === 'running' ? 0 : 2);
        return hits.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
    }

    function invalidate() { statusAt = 0; listAt = 0; }

    /**
     * What can be done to a container right now. The one place this is
     * decided, so the drawer, the row keys and the :docker palette agree. The
     * own container and a read-only install offer nothing; update is offered
     * whether or not a check has run, since a check that never ran should not
     * hide a working button.
     */
    function allowedActions(container, control) {
        if (!control || !container || container.self) return [];
        switch (container.state) {
            case 'running': return ['stop', 'restart', 'pause', 'update'];
            case 'paused': return ['unpause', 'stop'];
            case 'restarting': return ['stop'];
            default: return ['start', 'update', 'remove'];
        }
    }

    /**
     * The host a port or [IP] links to: Config -> Containers' host address,
     * else the host the dashboard was opened on. The one place this is
     * decided, so the table, drawer, row menu and palette open the same address.
     */
    function hostAddress() {
        let set = String(window.dashboardInstance?.settings?.dockerHostAddress || '').trim();
        // The server keeps a bare host only; until the page reloads the copy
        // here is what was typed, so hold it to the same rule.
        if (/^[0-9a-f:]+$/i.test(set) && set.includes(':')) set = `[${set}]`;
        const bare = /^[A-Za-z0-9.-]+$/.test(set) || /^\[[0-9a-fA-F:.]+\]$/.test(set);
        return (bare && set) || window.location.hostname;
    }

    /**
     * A web UI address with [IP] filled in: the container's own LAN address
     * when it has one (macvlan, Unraid's br0), else the host above.
     */
    function webuiHref(raw, container) {
        const value = String(raw || '').trim();
        const href = value ? value.replace('[IP]', container?.lanIP || hostAddress()) : '';
        // A web UI is a web page. The address comes from a label an image can
        // set, so anything else (javascript:, data:) is no link at all.
        return /^https?:\/\//i.test(href) ? href : '';
    }

    /** A published port on the Docker host. */
    function portHref(port) {
        return `http://${hostAddress()}:${port}`;
    }

    /**
     * The first published port a web UI could be on: TCP, and reachable from
     * another machine -- a port bound to 127.0.0.1 or ::1 only answers on the
     * Docker host itself.
     */
    function firstWebPort(container) {
        return (container?.ports || []).find((p) => p && p.public && p.type !== 'udp'
            && p.ip !== '127.0.0.1' && p.ip !== '::1') || null;
    }

    /* ── A container's bookmark ─────────────────────────────────────── */

    /** "Sonarr-4K", "sonarr_4k" and "sonarr 4k" are one name. */
    function looseName(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    /*
     * Parsed once per address. The answer depends on the string alone, so a
     * cached one cannot go stale; matching asks for the same addresses over
     * and over, and `new URL` was most of what opening Bookmarks cost.
     */
    const parsedCache = new Map();

    function parsedUrl(raw) {
        const key = String(raw || '').trim();
        if (parsedCache.has(key)) return parsedCache.get(key);
        let out = null;
        try {
            const u = new URL(key);
            if (u.protocol === 'http:' || u.protocol === 'https:') {
                out = { host: u.hostname.toLowerCase().replace(/^\[|\]$/g, ''), port: u.port || (u.protocol === 'https:' ? '443' : '80') };
            }
        } catch {
            out = null;
        }
        if (parsedCache.size > 5000) parsedCache.clear();
        parsedCache.set(key, out);
        return out;
    }

    function bookmarkKey(b) {
        return `${b.pageId}::${String(b.url || '').trim()}`;
    }

    /** One bookmark per address: the same link on two pages is one candidate. */
    function oneAddress(list) {
        const byUrl = new Map();
        list.forEach((b) => { if (!byUrl.has(String(b.url).trim())) byUrl.set(String(b.url).trim(), b); });
        return [...byUrl.values()];
    }

    /**
     * The bookmark of a container's web UI, and why: set by hand in its side
     * panel ("manual"), else the same port on this server ("port"), else a
     * subdomain named after it ("subdomain", as a reverse proxy gives), else a
     * bookmark titled after it ("title"). The first step that finds exactly
     * one address wins; two at one step is no guess at all.
     */
    function bookmarkFor(container, bookmarks, links) {
        if (!container) return null;
        const all = (bookmarks || []).filter((b) => b && b.url);
        const manual = (links || window.dashboardInstance?.settings?.dockerBookmarkLinks || {})[container.name];
        if (manual === '-') return null;
        if (manual) {
            const hit = all.find((b) => bookmarkKey(b) === manual);
            if (hit) return { bookmark: hit, via: 'manual' };
        }
        // This server under any name it goes by here, and the container's
        // own LAN address when it has one.
        const hosts = new Set([hostAddress(), window.location.hostname, container.lanIP, 'localhost', '127.0.0.1']
            .filter(Boolean).map((h) => String(h).toLowerCase().replace(/^\[|\]$/g, '')));
        const ports = new Set();
        const web = parsedUrl(webuiHref(container.webui, container));
        if (web) {
            hosts.add(web.host);
            ports.add(web.port);
        }
        (container.ports || []).forEach((p) => { if (p?.public && p.type !== 'udp') ports.add(String(p.public)); });
        const name = looseName(container.name);
        const steps = [
            ['port', (u) => ports.has(u.port) && hosts.has(u.host)],
            ['subdomain', (u) => name && u.host.includes('.') && looseName(u.host.split('.')[0]) === name],
            ['title', (u, b) => name && looseName(b.name) === name],
        ];
        for (const [via, test] of steps) {
            const hits = oneAddress(all.filter((b) => {
                const u = parsedUrl(b.url);
                return u && test(u, b);
            }));
            if (hits.length === 1) return { bookmark: hits[0], via };
            if (hits.length > 1) return null;
        }
        return null;
    }

    /*
     * Every container's bookmark, worked out once and kept while nothing it
     * depends on has changed: the container list, the bookmarks (their pages,
     * addresses and names, read afresh each time, since an edit changes the
     * objects in place), the links set by hand and the host address.
     *
     * Asked once per row, containersFor used to run bookmarkFor for every
     * container on every row -- rows x containers x bookmarks.
     */
    let byUrl = null, byUrlKey = null, byUrlList = null;

    function containersByUrl(bookmarks) {
        const all = bookmarks || [];
        const links = window.dashboardInstance?.settings?.dockerBookmarkLinks || {};
        let key = `${hostAddress()}|${window.location.hostname}|${JSON.stringify(links)}|${all.length}`;
        for (const b of all) key += `|${b?.pageId}\u0001${b?.url}\u0001${b?.name}`;
        if (byUrl && byUrlList === list && byUrlKey === key) return byUrl;
        byUrl = new Map();
        list.forEach((c) => {
            const url = String(bookmarkFor(c, all)?.bookmark?.url || '').trim();
            if (!url) return;
            if (!byUrl.has(url)) byUrl.set(url, []);
            byUrl.get(url).push(c);
        });
        byUrlList = list;
        byUrlKey = key;
        return byUrl;
    }

    /** The containers whose bookmark is this one, from the cached list. */
    function containersFor(bookmark, bookmarks) {
        if (!bookmark?.url) return [];
        return [...(containersByUrl(bookmarks).get(String(bookmark.url).trim()) || [])];
    }

    /**
     * What the bookmark's checks last said: 'good', 'bad' (broken, or a
     * monitor that finds it down) or 'off' (not checked). Health's own facts,
     * without loading the Bookmarks view.
     */
    function bookmarkHealth(bookmark) {
        if (!bookmark) return 'off';
        const checked = window.CheckMode?.of ? window.CheckMode.of(bookmark) !== 'off' : bookmark.checkStatus === true;
        if (!checked) return 'off';
        const facts = window.HealthFacts?.get?.(bookmark.url);
        if (facts && (facts.brokenSince > 0 || facts.downSince > 0)) return 'bad';
        return 'good';
    }

    /** The last status fetched, without waiting: for the synchronous palette. */
    function statusNow() { return statusValue; }

    window.DockerSearchIndex = {
        status, statusNow, refresh, containers: () => (enabled() ? list : []), match, matches, invalidate, allowedActions, enabled,
        hostAddress, webuiHref, portHref, firstWebPort, bookmarkFor, containersFor, bookmarkHealth, bookmarkKey,
    };
})();
