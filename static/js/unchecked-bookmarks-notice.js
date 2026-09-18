/**
 * The corner card that offers to switch periodic checking on for bookmarks
 * that currently have none.
 *
 * /api/health/check-mode-all deliberately refuses to turn checking *on*
 * without an explicit target list -- enabling it collection-wide by default
 * is exactly what the per-bookmark opt-in exists to prevent (see
 * health_check_mode.go). This card supplies that list itself: it counts from
 * the bookmarks already in memory (no round trip to decide whether to show),
 * and only fetches each affected page's fresh bookmark order at the moment
 * someone actually accepts, so the write is never built from a stale index.
 */
(function (global) {
    'use strict';

    if (!global.NoticeCard?.define || !global.CheckMode) return;

    // Below this, the card is not worth asking: a reader with a handful of
    // unchecked bookmarks would see an offer they wave away before reading,
    // same reasoning as MIN_TO_OFFER in tag-suggestions-notice.js.
    const MIN_TO_OFFER = 20;

    // At most once a month. Unlike the daily/30-day snooze pair in
    // tag-suggestions-notice, this card has only one cadence: there is no
    // "not today" distinct from "not this month" here, since the underlying
    // count does not change fast enough to make a shorter wait meaningful.
    const SHOW_DELAY_MS = 7000;
    const REASK_MS = 30 * 24 * 60 * 60 * 1000;

    const LAST_SHOWN_KEY = 'uncheckedBookmarksNoticeLastShownAt';
    const DECLINE_COUNT_KEY = 'uncheckedBookmarksNoticeDeclineCount';
    const FOREVER_KEY = 'uncheckedBookmarksNoticeDismissedForever';

    let lastCount = 0;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const language = dash()?.language;
        let text = fallback;
        if (language && typeof language.t === 'function') {
            const value = language.t(key);
            if (value && value !== key) text = value;
        }
        if (!vars) return text;
        return Object.entries(vars).reduce(
            (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value)),
            text,
        );
    }

    function read(key) {
        try {
            return global.localStorage?.getItem(key);
        } catch (err) {
            return null;
        }
    }

    function write(key, value) {
        try {
            global.localStorage?.setItem(key, value);
        } catch (err) {
            // Not worth failing the card over.
        }
    }

    function isDismissedForever() {
        return read(FOREVER_KEY) === '1';
    }

    function dismissForever() {
        write(FOREVER_KEY, '1');
    }

    function declineCount() {
        return Number(read(DECLINE_COUNT_KEY)) || 0;
    }

    function recordDecline() {
        write(DECLINE_COUNT_KEY, String(declineCount() + 1));
    }

    function wasShownRecently() {
        const last = Number(read(LAST_SHOWN_KEY));
        return Number.isFinite(last) && last > 0 && (Date.now() - last) < REASK_MS;
    }

    function markShownNow() {
        write(LAST_SHOWN_KEY, String(Date.now()));
    }

    /** The bookmarks with no checking at all -- CheckMode.of() is the same
     * three-state read the health view and the context menu use, so this
     * agrees with what a reader would see if they looked at any one row. */
    function uncheckedBookmarks() {
        const d = dash();
        if (!Array.isArray(d?.allBookmarks)) return [];
        return d.allBookmarks.filter((bm) => global.CheckMode.of(bm) === global.CheckMode.OFF);
    }

    /**
     * Turns the in-memory bookmarks into {pageId, index, url} targets,
     * fetching each affected page's own current order first. The in-memory
     * copy can be stale (another tab, a background refresh); the write goes
     * out with an index that matches what is on disk right now, not with
     * whatever position the bookmark happened to hold when the count ran.
     */
    async function buildTargets(bookmarks) {
        const byPage = new Map();
        bookmarks.forEach((bm) => {
            const pageId = Number(bm.pageId);
            if (!Number.isFinite(pageId) || pageId <= 0) return;
            if (!byPage.has(pageId)) byPage.set(pageId, new Set());
            byPage.get(pageId).add(String(bm.url || '').trim());
        });

        const targets = [];
        for (const [pageId, urls] of byPage) {
            let current = [];
            try {
                const res = await fetch(`/api/bookmarks?page=${encodeURIComponent(pageId)}`);
                if (res.ok) current = await res.json();
            } catch (err) {
                continue; // This page's bookmarks are skipped rather than failing the whole batch.
            }
            current.forEach((bm, index) => {
                if (urls.has(String(bm.url || '').trim())) {
                    targets.push({ pageId, index, url: bm.url });
                }
            });
        }
        return targets;
    }

    async function acceptAndApply(handle) {
        const bookmarks = uncheckedBookmarks();
        const targets = await buildTargets(bookmarks);
        if (!targets.length) {
            handle.close();
            return;
        }
        const d = dash();
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/check-mode-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: global.CheckMode.PERIODIC, targets }),
            });
            if (!res.ok) throw new Error(`check-mode-all HTTP ${res.status}`);
            d?.showNotification?.(
                t('dashboard.uncheckedBookmarksNoticeDone', '{count} bookmarks are now checked periodically', { count: targets.length }),
                'success',
            );
            // Refreshes d.allBookmarks (among other caches) for every touched
            // page in one call -- the same path a bookmark edit uses, not a
            // bespoke cache poke.
            const pageIds = [...new Set(targets.map((tgt) => tgt.pageId))];
            await d?.data?.refreshAfterBookmarkMutation?.({ pageIds });
        } catch (err) {
            console.error('Failed to bulk-apply periodic checking:', err);
            handle.showError(t('dashboard.uncheckedBookmarksNoticeFailed', 'Could not update those bookmarks'));
            return;
        }
        handle.close();
    }

    const acceptAction = {
        name: 'accept',
        primary: true,
        label: () => t('dashboard.uncheckedBookmarksNoticeAccept', 'Add {count} as periodic', { count: lastCount }),
        onClick: (handle) => { void acceptAndApply(handle); },
    };
    const declineAction = {
        name: 'decline',
        label: () => t('dashboard.uncheckedBookmarksNoticeDecline', 'No thanks'),
        onClick: (handle) => { recordDecline(); handle.close(); },
    };
    const stopAction = {
        name: 'stop',
        quiet: true,
        label: () => t('dashboard.uncheckedBookmarksNoticeStop', "Don't ask again"),
        onClick: (handle) => { dismissForever(); handle.close(); },
    };

    const spec = {
        id: 'unchecked-bookmarks-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.uncheckedBookmarksNoticeTitle', '{count} bookmarks are not checked', { count: lastCount }),
        body: () => t('dashboard.uncheckedBookmarksNoticeBody',
            'nextDash can watch them for you and flag it here if one goes down.'),
        dismissLabel: () => t('dashboard.uncheckedBookmarksNoticeDecline', 'No thanks'),
        dismissName: 'decline',
        canShow: () => {
            if (isDismissedForever()) return false;
            if (wasShownRecently()) return false;
            const count = uncheckedBookmarks().length;
            if (count < MIN_TO_OFFER) return false;
            lastCount = count;
            // The × and "No thanks" carry the same name, so the dismiss
            // handler above already calls recordDecline() via onDismiss --
            // this list only decides whether "stop" is offered yet.
            spec.actions = declineCount() >= 1
                ? [acceptAction, declineAction, stopAction]
                : [acceptAction, declineAction];
            return true;
        },
        onDismiss: recordDecline,
        onShown: markShownNow,
        actions: [acceptAction, declineAction],
    };

    const card = global.NoticeCard.define(spec);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.UncheckedBookmarksNotice = {
        ...card,
        MIN_TO_OFFER,
        uncheckedBookmarks,
    };
}(typeof window !== 'undefined' ? window : globalThis));
