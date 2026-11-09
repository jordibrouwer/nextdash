/**
 * "Sonarr added to Media management": the notice after app discovery put a new
 * container on the dashboard by itself.
 *
 * The server keeps every direct add until a browser acknowledges it, so the
 * notice comes wherever the dashboard is opened next. It is a row in the
 * notifications bell, not a card in the corner: the new tile is already on the
 * page, and the row waits there with its answers. Undo takes the bookmark back
 * (to the trash) and ignores the container from then on; Move opens the
 * bookmark form to put it elsewhere; Done puts the row away. Any of the three
 * acknowledges the adds.
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
            const res = await (window.nextDashFetchShared || fetch)('/api/discovery', { cache: 'no-store' });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.recentAdds) ? data.recentAdds : [];
        } catch {
            return [];
        }
    }

    /** The bell asks the server again, so an answered row goes at once. */
    function refreshBell() {
        void global.NotificationBell?.refreshAll?.();
    }

    function acknowledge(list) {
        const names = list.map((a) => a.name);
        if (!names.length) return Promise.resolve();
        return post('/api/discovery/ack', { names }).catch(() => {}).then(refreshBell);
    }

    /**
     * The bell row: the adds nobody has acknowledged yet, or null. The ids are
     * the adds' bookmark keys, so "No" holds until another app is added.
     */
    async function bellState() {
        const list = await pendingAdds();
        if (!list.length) return null;
        // The row's buttons act on the adds the card knows about.
        adds = list;
        const key = list.map((a) => a.key).join('|');
        if (key !== shownKey) {
            // The new tiles are on the server already; bring them on screen
            // before the row names them. A failed refresh is tried again on
            // the next check.
            try {
                await refreshDashboard();
                shownKey = key;
            } catch { /* the row still comes */ }
        }
        return { count: list.length, ids: list.map((a) => a.key), text: title() };
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

    let undoing = false;

    async function undo(card) {
        if (undoing) return;
        undoing = true;
        try {
            const list = adds.slice();
            const done = [];
            let failed = false;
            for (const a of list) {
                try {
                    const res = await post('/api/discovery/undo', { name: a.name });
                    // 404: taken back already, by an earlier click or another tab.
                    if (res.ok || res.status === 404) done.push(a);
                    else failed = true;
                } catch {
                    failed = true;
                }
            }
            if (failed) {
                // A second Undo only tries what is still on a page.
                adds = adds.filter((a) => !done.includes(a));
                // No card to put it on: a bell row has none, so it is a toast.
                const message = t('notice.undoFailed', 'Could not take it back');
                if (card.element) card.showError(message);
                else dash()?.showNotification?.(message, 'error');
                return;
            }
            global.nextdashTrack?.('discovery:undo', { count: list.length });
            adds = [];
            card.close();
            await refreshDashboard().catch(() => {});
            refreshBell();
        } finally {
            undoing = false;
        }
    }

    async function move(card) {
        const d = dash();
        const first = adds[0];
        if (!first || !d) return;
        const find = () => (d.allBookmarks || []).find((b) => `${b.pageId}::${b.url}` === first.key);
        let bookmark = find();
        if (!bookmark) {
            await Promise.resolve(d.data?.loadAllBookmarks?.()).catch(() => {});
            bookmark = find();
        }
        // Not found: the notice stays, so the adds are not acknowledged unseen.
        if (!bookmark) return;
        const list = adds.slice();
        adds = [];
        card.close();
        void acknowledge(list);
        global.nextdashTrack?.('discovery:move');
        d.openBookmarkFormModal?.({ mode: 'edit', bookmark, pageId: bookmark.pageId, source: 'discovery' });
    }

    const undoLabel = () => (adds.length > 1 ? t('notice.undoAll', 'Undo all') : t('notice.undo', 'Undo'));

    function done(c) {
        const list = adds.slice();
        adds = [];
        c.close();
        void acknowledge(list);
    }

    const card = global.NoticeCard.define({
        id: 'app-discovery-notice',
        // Quiet: no card in the corner and no toast. The bell lists the adds
        // for as long as they are unacknowledged, and its row carries Undo,
        // Move and Done, so it works during the quick start and on a phone too.
        bell: {
            kind: 'quiet',
            group: 'system',
            icon: '\u2795',
            no: 'state',
            state: bellState,
            // Written out here, not taken from the card's: the label of the
            // first one depends on how many adds there are now, so the bell asks
            // for it each time it draws the row.
            actions: [
                // Not primary: a coloured answer puts the row aside once pressed,
                // and a failed Undo has to leave it there to try again.
                { label: undoLabel, onClick: () => void undo(card) },
                { label: () => t('notice.move', 'Move'), onClick: () => void move(card) },
                { label: () => t('notice.done', 'Done'), onClick: () => done(card) },
            ],
        },
        title,
        body,
        dismissLabel: () => t('notice.close', 'Close'),
        actionAttr: 'data-app-discovery-action',
        canShow: async () => (await pendingAdds()).length > 0,
        onDismiss: () => {
            const list = adds.slice();
            adds = [];
            void acknowledge(list);
        },
        actions: [
            { name: 'undo', label: undoLabel, primary: true, onClick: (c) => void undo(c) },
            { name: 'move', label: () => t('notice.move', 'Move'), onClick: (c) => void move(c) },
            { name: 'done', label: () => t('notice.done', 'Done'), onClick: (c) => done(c) },
        ],
    });

    // The question about new apps (asking first): once per load, in the middle
    // of the screen, when its turn comes (AppDiscoveryCard waits for it).
    let askedThisLoad = false;
    let asking = false;

    async function checkPending() {
        const d = dash();
        if (askedThisLoad || asking || !d?.settings || d.settings.discoverApps === false) return;
        // Taken before the fetch: the start timer and a visibility check can
        // both get this far, and only one of them may ask.
        asking = true;
        try {
            const res = await (window.nextDashFetchShared || fetch)('/api/discovery', { cache: 'no-store', fresh: true });
            const data = res.ok ? await res.json() : null;
            if (!data?.enabled || !data.cardDone || !(data.pending || []).length) {
                asking = false;
                return;
            }
            await global.LazyScript.loadScriptOnce('js/app-discovery-card.js', 'appDiscoveryCardScript',
                () => typeof global.AppDiscoveryCard === 'function');
            const question = new global.AppDiscoveryCard(d, { mode: 'ask', onDone: (result) => {
                asking = false;
                if (result !== 'none') askedThisLoad = true;
            } });
            question.show(data);
        } catch {
            asking = false;
        }
    }

    function check() {
        if (document.visibilityState === 'hidden') return;
        refreshBell();
        void checkPending();
    }

    const start = () => {
        card.autoStart();
        setTimeout(() => { void checkPending(); }, 2000);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
    });
    setInterval(check, CHECK_EVERY_MS);

    global.AppDiscoveryNotice = { render: card.render, close: card.close, check };
}(typeof window !== 'undefined' ? window : globalThis));
