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
        return value ? value.replace('[IP]', container?.lanIP || hostAddress()) : '';
    }

    /** A published port on the Docker host. */
    function portHref(port) {
        return `http://${hostAddress()}:${port}`;
    }

    /** The last status fetched, without waiting: for the synchronous palette. */
    function statusNow() { return statusValue; }

    window.DockerSearchIndex = {
        status, statusNow, refresh, containers: () => (enabled() ? list : []), match, matches, invalidate, allowedActions, enabled,
        hostAddress, webuiHref, portHref,
    };
})();
