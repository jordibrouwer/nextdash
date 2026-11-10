/**
 * A tip in the notifications bell about the network tests (v1.28).
 *
 * Every install gets it, new or old: the Tests tab of a bookmark's side panel
 * can test the bookmark's own host (a port, a ping, DNS records, a certificate,
 * an HTTP answer, a value in a JSON answer), once or on a schedule. The row is a
 * tip, so it sits in the Tips group and stays until it is read. "Open Tests"
 * opens the Tests tab of a bookmark that already has a check, or the Bookmarks
 * view when none has, and reads the row. It is left out while the network
 * checks are switched off in Config → Monitoring → Checks, when tips are off
 * and in the demo.
 */
(function initNetTestsNotice(global) {
    'use strict';

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function eligible() {
        const d = dash();
        if (!d) return false;
        // Switching the tips off in Config takes the row away, like every other tip; the
        // demo runs no test, so it has nothing to point at.
        if (d.settings?.enableSessionTips === false || global.DemoLock?.on) return false;
        return d.settings?.netToolsEnabled !== false;
    }

    /** A bookmark that has a check, else nothing: the Bookmarks view opens on its own. */
    async function firstChecked() {
        try {
            const res = await global.fetch('/api/net/checks', { cache: 'no-store' });
            if (!res.ok) return null;
            const body = await res.json();
            const item = Array.isArray(body?.items) ? body.items[0] : null;
            return item && item.url ? item : null;
        } catch {
            return null;
        }
    }

    async function openTests() {
        const d = dash();
        if (!d?.config) return;
        const item = await firstChecked();
        if (item) {
            await d.config.openLibraryOnBookmark(item.pageId, item.url, { tab: 'tests', focusRow: true });
            return;
        }
        await d.config.openLibraryView();
    }

    const card = global.NoticeCard.define({
        id: 'net-tests-notice',
        title: () => t('bell.netTipTitle', 'Test your services from nextDash'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '\u{1F4E1}',
            no: 'forever',
            state: async () => (eligible() ? {
                count: 1,
                text: t('bell.netTipText', 'New: network tests. A bookmark’s Tests tab checks a port, a ping, DNS records, a certificate, an HTTP answer or a value in a JSON answer. Run one test now, or schedule it with a history and alerts.'),
            } : null),
            actions: [
                {
                    label: () => t('bell.netTipOpen', 'Open Tests'),
                    primary: true,
                    marksRead: true,
                    onClick: () => { void openTests(); },
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardNetTestsNotice = { card, shouldShow: eligible };
}(typeof window !== 'undefined' ? window : globalThis));
