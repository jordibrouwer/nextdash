/**
 * The bell's row for Immich: background jobs that failed.
 *
 * It reads what the Immich status widget already fetched (the media tile keeps
 * each answer in `dashboardInstance._widgetMedia`), so it makes no request of
 * its own and says nothing when no status widget has been drawn in this tab.
 * A widget that was set not to show the jobs says nothing either: unknown is
 * not zero.
 *
 * A quiet row: failed jobs are a state of the library that stays until they are
 * cleared in Immich. "No" holds until more jobs fail.
 */
(function initImmichBellSource(global) {
    'use strict';

    let handle = null;

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

    /** Every Immich status answer this tab holds. */
    function answers() {
        const held = dash()?._widgetMedia || {};
        return Object.entries(held)
            .filter(([key]) => key.startsWith('immich-status:'))
            .filter(([, entry]) => entry?.result?.immich?.jobsRead)
            .map(([, entry]) => ({ immich: entry.result.immich, at: Number(entry.at) || 0 }));
    }

    async function state() {
        // Two status tiles for one server read the same jobs: the newest answer
        // of each server, not the sum. Not the largest either: a tile on a page
        // left behind keeps its old answer, and failures cleared since must not
        // stay in the bell on its word.
        const byServer = new Map();
        answers().forEach((answer) => {
            const known = byServer.get(answer.immich.openUrl);
            if (!known || answer.at > known.at) byServer.set(answer.immich.openUrl, answer);
        });
        const list = [...byServer.values()].map((answer) => answer.immich).filter((immich) => Number(immich.failed) > 0);
        if (!list.length) return null;
        const count = list.reduce((sum, immich) => sum + Number(immich.failed), 0);
        return {
            count,
            ids: list.flatMap((immich) => (immich.queues || []).filter((q) => q.failed > 0).map((q) => `${q.name}:${q.failed}`)),
            text: count === 1
                ? t('bell.immichFailedOne', 'An Immich job failed')
                : t('bell.immichFailedMany', '{count} Immich jobs failed', { count }),
            url: list[0].openUrl,
        };
    }

    function open(row) {
        const base = row?.entry?.url;
        if (base) global.open(`${base.replace(/\/$/, '')}/admin/queues`, '_blank', 'noopener,noreferrer');
    }

    function register() {
        if (handle || !global.NotificationBell) return;
        handle = global.NotificationBell.register({
            id: 'immich-failed', group: 'system', kind: 'quiet', icon: '\u{1F4F7}', no: 'state', state,
            actions: [{ label: () => t('bell.immichOpen', 'Open in Immich'), primary: true, onClick: open }],
        });
    }

    /** Ask the bell to look again, after the status widget drew a new answer. */
    function refresh() {
        void handle?.refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register, { once: true });
    } else {
        register();
    }

    global.ImmichBellSource = { refresh };
}(typeof window !== 'undefined' ? window : globalThis));
