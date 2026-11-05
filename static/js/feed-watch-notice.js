/**
 * The bell's Watch feeds row: news from the feeds the reader follows.
 *
 * One row, whatever arrives. Each time the server's answer changes the same
 * row is updated (its count and its text), never a second one added, so a day
 * of new posts is one line that grows, not a stack. It reads what the purple
 * count on the bookmark rows reads (DashboardFeedWatch.byKey), so the two
 * agree, and so does expiry: news past the age chosen in Config leaves the
 * server's count and the row follows.
 *
 * A muted feed never calls out, so it is left out here too. "Mark read" holds
 * until news arrives that the row did not list (new ids), as for any tip.
 */
(function initFeedWatchNotice(global) {
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

    /** { count, ids, text } while unread, unmuted news is waiting, else null. */
    function state() {
        const watch = dash()?.feedWatch;
        if (!watch) return null;
        let count = 0;
        const ids = [];
        const sites = [];
        watch.byKey.forEach((entry, key) => {
            const n = Number(entry.newCount) || 0;
            if (n <= 0 || entry.muted === true) return;
            count += n;
            sites.push(key);
            (entry.newItems || []).forEach((item) => ids.push(`${key}:${item.id}`));
        });
        if (!count) return null;
        const text = sites.length === 1
            ? t('bell.feedWatchOne', '{count} new from a watched feed', { count })
            : t('bell.feedWatchMany', '{count} new from {sites} watched feeds', { count, sites: sites.length });
        return { count, ids, text };
    }

    function register() {
        if (handle || !global.NotificationBell) return;
        handle = global.NotificationBell.register({
            id: 'feed-watch',
            group: 'news',
            kind: 'tip',
            icon: '\u{1F4F0}',
            no: 'forever',
            state,
            actions: [
                {
                    label: () => t('bell.feedWatchRead', 'Read'),
                    primary: true,
                    marksRead: true,
                    onClick: () => { void global.FeedWatchNews?.open(); },
                },
            ],
        });
        void handle.refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', register, { once: true });
    } else {
        register();
    }
    document.addEventListener('feedwatch:changed', () => { void handle?.refresh(); });

    global.DashboardFeedWatchNotice = { state };
}(typeof window !== 'undefined' ? window : globalThis));
