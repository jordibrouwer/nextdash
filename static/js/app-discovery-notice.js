/**
 * "Sonarr added to Media management": the notice after app discovery put a new
 * container on the dashboard by itself.
 *
 * The server keeps every direct add until a browser acknowledges it, so the
 * notice comes wherever the dashboard is opened next. Undo takes the bookmark
 * back (to the trash) and ignores the container from then on; Move opens the
 * bookmark form to put it elsewhere. Closing the card, or either answer,
 * acknowledges it.
 */
(function initAppDiscoveryNotice(global) {
    'use strict';

    const CHECK_EVERY_MS = 5 * 60 * 1000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, params) {
        const lang = dash()?.language;
        let text = fallback;
        if (lang?.t) {
            const full = `discovery.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), String(text))
            : text;
    }

    function api() {
        return typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
    }

    function post(path, body) {
        return api()(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
        });
    }

    // The adds on the card, as the server listed them.
    let adds = [];
    // The adds the page has already been reloaded for.
    let shownKey = '';

    /** The page, and the links between containers and bookmarks, made current. */
    async function refreshDashboard() {
        const d = dash();
        if (!d) return;
        try {
            const res = await fetch('/api/settings', { cache: 'no-store' });
            if (res.ok && d.settings) {
                const fresh = await res.json();
                d.settings.dockerBookmarkLinks = fresh?.dockerBookmarkLinks || {};
                d.settings.discoveryIgnored = fresh?.discoveryIgnored || [];
            }
        } catch { /* the links catch up on the next load */ }
        await d.data?.loadAllBookmarks?.();
        await d.loadPageBookmarks?.(d.currentPageId, { forceFetch: true, skipInlineEditConfirm: true });
        void d.data?.fetchAndStoreDataRevision?.();
    }

    async function pendingAdds() {
        const d = dash();
        if (!d?.settings || d.settings.discoverApps === false) return [];
        try {
            const res = await fetch('/api/discovery', { cache: 'no-store' });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.recentAdds) ? data.recentAdds : [];
        } catch {
            return [];
        }
    }

    function acknowledge(list) {
        const names = list.map((a) => a.name);
        if (!names.length) return Promise.resolve();
        return post('/api/discovery/ack', { names }).catch(() => {});
    }

    function title() {
        if (adds.length === 1) {
            const a = adds[0];
            return t('notice.addedOne', '{name} added to {category}', { name: a.name, category: a.category || t('kind.apps', 'Apps') });
        }
        return t('notice.addedMany', '{count} apps added', { count: adds.length });
    }

    function body() {
        if (adds.length === 1) {
            return t('notice.bodyOne', 'A new container with a web page. It is on the dashboard now, with a status check.');
        }
        const list = adds.map((a) => (a.category ? `${a.name} (${a.category})` : a.name)).join(', ');
        return t('notice.bodyMany', '{list}. Each is on the dashboard now, with a status check.', { list });
    }

    async function undo(card) {
        const list = adds.slice();
        let failed = false;
        for (const a of list) {
            try {
                const res = await post('/api/discovery/undo', { name: a.name });
                if (!res.ok) failed = true;
            } catch {
                failed = true;
            }
        }
        if (failed) {
            card.showError(t('notice.undoFailed', 'Could not take it back'));
            return;
        }
        global.nextdashTrack?.('discovery:undo', { count: list.length });
        adds = [];
        card.close();
        await refreshDashboard();
    }

    function move(card) {
        const d = dash();
        const first = adds[0];
        const list = adds.slice();
        adds = [];
        card.close();
        void acknowledge(list);
        if (!first || !d) return;
        const bookmark = (d.allBookmarks || []).find((b) => `${b.pageId}::${b.url}` === first.key);
        if (!bookmark) return;
        global.nextdashTrack?.('discovery:move');
        d.openBookmarkFormModal?.({ mode: 'edit', bookmark, pageId: bookmark.pageId, source: 'discovery' });
    }

    const card = global.NoticeCard.define({
        id: 'app-discovery-notice',
        showDelayMs: 1500,
        // The Undo for something already done: shown during the quick start
        // and on a phone too.
        essential: true,
        title,
        body,
        dismissLabel: () => t('notice.close', 'Close'),
        actionAttr: 'data-app-discovery-action',
        canShow: async () => {
            const list = await pendingAdds();
            if (!list.length) return false;
            adds = list;
            const key = list.map((a) => a.key).join('|');
            if (key !== shownKey) {
                shownKey = key;
                // The new tiles are on the server already; bring them on
                // screen before the notice names them.
                await refreshDashboard();
            }
            return true;
        },
        onDismiss: () => {
            const list = adds.slice();
            adds = [];
            void acknowledge(list);
        },
        actions: [
            { name: 'undo', label: () => (adds.length > 1 ? t('notice.undoAll', 'Undo all') : t('notice.undo', 'Undo')), primary: true, onClick: (c) => void undo(c) },
            { name: 'move', label: () => t('notice.move', 'Move'), onClick: (c) => move(c) },
            {
                name: 'done',
                label: () => t('notice.done', 'Done'),
                onClick: (c) => {
                    const list = adds.slice();
                    adds = [];
                    c.close();
                    void acknowledge(list);
                },
            },
        ],
    });

    function check() {
        if (document.visibilityState === 'hidden' || card.element) return;
        void card.render();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
    });
    setInterval(check, CHECK_EVERY_MS);

    global.AppDiscoveryNotice = { render: card.render, close: card.close, check };
}(typeof window !== 'undefined' ? window : globalThis));
