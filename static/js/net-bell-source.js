/**
 * The bell's rows for network checks: one for checks that are down, one for
 * checks that came back within the last day.
 *
 * Both read the bulk answer of GET /api/net/checks (state of the newest sample
 * per check, and `recoveredAt` for a check whose last outage ended in the last
 * 24 hours), so nothing is stored in the browser and no request is made per
 * check. Disabled and muted checks are left out: muting a check is how a row is
 * answered for good, and the history is kept regardless.
 *
 * Like the outage row, these are `health` rows: they list what is going on and
 * never count on the bell. "ICMP blocked" is not a row at all; it is a status
 * in Config -> Monitoring -> Checks and in a ping check's own result.
 *
 * "No" holds until another check goes down (or recovers).
 */
(function initNetBellSource(global) {
    'use strict';

    const handles = [];
    let inflight = null;
    let inflightAt = 0;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const lang = dash()?.language;
        let text = fallback;
        if (lang?.t) {
            const value = lang.t(key);
            if (value && value !== key) text = value;
        }
        return vars
            ? Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), text)
            : text;
    }

    /** The bulk list, shared by the two rows of one refresh so it is asked for once. */
    function load() {
        if (inflight && Date.now() - inflightAt < 2000) return inflight;
        inflightAt = Date.now();
        inflight = global.fetch('/api/net/checks', { cache: 'no-store' })
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => (Array.isArray(body?.items) ? body.items : []))
            .catch(() => []);
        return inflight;
    }

    function enabled() {
        return dash()?.settings?.netToolsEnabled !== false;
    }

    function name(item) {
        return `${item.name || item.url} · ${item.label}`;
    }

    function target(item) {
        return { pageId: item.pageId, url: item.url, checkId: item.checkId };
    }

    function rowState(items, one, many, at) {
        if (!items.length) return null;
        return {
            count: items.length,
            ids: items.map((i) => i.checkId),
            text: items.length === 1
                ? t(one.key, one.fallback, { name: name(items[0]) })
                : t(many.key, many.fallback, { count: items.length }),
            at: at ? at(items) : undefined,
            targets: items.map(target),
        };
    }

    async function downState() {
        if (!enabled()) return null;
        const items = (await load()).filter((i) => i.enabled && !i.muted && i.state && i.state.ok === false);
        return rowState(items,
            { key: 'bell.netDownOne', fallback: '{name} is down' },
            { key: 'bell.netDownMany', fallback: '{count} network checks are down' },
            (list) => Math.min(...list.map((i) => i.state.at || Infinity)) || undefined);
    }

    async function recoveredState() {
        if (!enabled()) return null;
        const items = (await load()).filter((i) => i.enabled && !i.muted && i.state && i.state.ok === true && i.recoveredAt > 0);
        return rowState(items,
            { key: 'bell.netUpOne', fallback: '{name} is back up' },
            { key: 'bell.netUpMany', fallback: '{count} network checks are back up' },
            (list) => Math.max(...list.map((i) => i.recoveredAt)));
    }

    /** The bookmark's Health tab, where its checks are. */
    function openHealth(row) {
        const first = row?.entry?.targets?.[0];
        const d = dash();
        if (!first || !d?.config) return;
        void d.config.openLibraryOnBookmark(first.pageId, first.url, { tab: 'health', focusRow: true });
    }

    /** Mute the checks of a row: one GET and one PUT per bookmark, since a PUT replaces the whole list. */
    async function mute(row) {
        const targets = row?.entry?.targets || [];
        const byBookmark = new Map();
        targets.forEach((tg) => {
            const key = `${tg.pageId}\u0000${tg.url}`;
            if (!byBookmark.has(key)) byBookmark.set(key, { tg, ids: new Set() });
            byBookmark.get(key).ids.add(tg.checkId);
        });
        const api = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
        for (const { tg, ids } of byBookmark.values()) {
            try {
                const res = await global.fetch(`/api/net/checks?pageId=${encodeURIComponent(tg.pageId)}&url=${encodeURIComponent(tg.url)}`, { cache: 'no-store' });
                if (!res.ok) continue;
                const body = await res.json();
                const checks = (body.checks || []).map((c) => {
                    const { state, stats, display, ...stored } = c; // eslint-disable-line no-unused-vars
                    return ids.has(stored.id) ? { ...stored, muted: true } : stored;
                });
                await api('/api/net/checks', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pageId: tg.pageId, url: tg.url, checks }),
                });
            } catch (err) {
                console.warn('muting a network check failed', err);
            }
        }
        inflight = null;
        refresh();
    }

    function register() {
        if (handles.length || !global.NotificationBell) return;
        const actions = () => [
            { label: () => t('bell.netHealth', 'Health'), primary: true, onClick: openHealth },
            { label: () => t('bell.netMute', 'Mute'), onClick: (row) => { void mute(row); } },
        ];
        handles.push(global.NotificationBell.register({
            id: 'net-down', group: 'health', kind: 'health', icon: '\u{1F534}', no: 'state', state: downState, actions: actions(),
        }));
        handles.push(global.NotificationBell.register({
            id: 'net-up', group: 'health', kind: 'health', icon: '\u{1F7E2}', no: 'state', state: recoveredState, actions: actions(),
        }));
        refresh();
    }

    /** Ask the bell to look again, for instance after a check was changed or muted. */
    function refresh() {
        inflight = null;
        handles.forEach((h) => { void h.refresh(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register, { once: true });
    } else {
        register();
    }

    global.NetBellSource = { refresh };
}(typeof window !== 'undefined' ? window : globalThis));
