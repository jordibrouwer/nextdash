/**
 * Invites someone who keeps using the Inbox, but has never saved a page with
 * the browser extension, to try it.
 *
 * Asked only after the Inbox view has been opened a few times (a habit, not a
 * first look), and only while /api/inbox-stats says nothing ever arrived from
 * the extension. No extension detection: the lifetime stats are the evidence.
 */
(function initInboxExtensionNotice(global) {
    'use strict';

    const PROMO_ID = 'inbox-extension-notice-v1';
    const OPENS_KEY = 'nextdashInboxOpens';
    const MIN_OPENS = 3;
    // Same target as the "Get the browser extension" step in the start guide
    // (static/js/start-guide.js DOCS_URL, which is not exported).
    const EXTENSION_URL = 'http://www.nextdash.cc/docs/browser-extension-and-capture.html';

    let neverUsed = null; // cached for the session once /api/inbox-stats answers

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function track(action) {
        global.nextdashTrack?.('inbox-ext-cta', { action });
    }

    function opens() {
        try {
            return Number(global.localStorage?.getItem(OPENS_KEY)) || 0;
        } catch (_) {
            return 0;
        }
    }

    function onViewReady() {
        try {
            global.localStorage?.setItem(OPENS_KEY, String(opens() + 1));
        } catch (_) { /* storage unavailable: the card just never qualifies */ }
        void global.NotificationBell?.refreshAll?.();
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    async function extensionNeverUsed() {
        if (neverUsed !== null) return neverUsed;
        try {
            const res = await fetch('/api/inbox-stats');
            if (!res.ok) return false;
            const stats = await res.json();
            neverUsed = !(Number(stats?.bySource?.extension) > 0);
            return neverUsed;
        } catch (_) {
            return false;
        }
    }

    async function shouldShow() {
        const d = dash();
        if (!d) return false;
        if (d.settings?.enableInboxExtensionNotice === false) return false;
        if (d.settings?.inboxEnabled === false) return false;
        if (hasAnswered()) return false;
        if (opens() < MIN_OPENS) return false;
        return extensionNeverUsed();
    }

    // A tip in the bell, in every view; it stays until it is read, and then it
    // does not come back. The switch in Config turns the offer off altogether.
    const card = global.NoticeCard.define({
        id: 'inbox-extension-notice',
        title: () => t('dashboard.inboxExtensionNoticeTitle', 'Fill your Inbox from the browser'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '\u{1F4E5}',
            no: 'forever',
            state: async () => ((await shouldShow()) ? {
                count: 1,
                text: t('dashboard.inboxExtensionNoticeToast', 'Fill your Inbox from the browser: the extension saves the page you are on straight to it.'),
            } : null),
            actions: [
                {
                    label: () => t('dashboard.inboxExtensionNoticeGet', 'Get the extension'),
                    primary: true,
                    marksRead: true,
                    onClick: () => {
                        global.open(EXTENSION_URL, '_blank', 'noopener');
                        markAnswered();
                        track('get');
                    },
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardInboxExtensionNotice = { card, onViewReady, shouldShow, PROMO_ID };
}(typeof window !== 'undefined' ? window : globalThis));
