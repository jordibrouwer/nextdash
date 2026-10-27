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
    const SNOOZE_KEY = 'nextdashInboxExtensionSnoozeUntil';
    const MIN_OPENS = 3;
    const SNOOZE_DAYS = 14;
    // Same target as the "Get the browser extension" step in the start guide
    // (static/js/start-guide.js DOCS_URL, which is not exported).
    const EXTENSION_URL = 'https://nextdash.cc/docs/';

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
    }

    function isSnoozed() {
        try {
            return Date.now() < (Number(global.localStorage?.getItem(SNOOZE_KEY)) || 0);
        } catch (_) {
            return false;
        }
    }

    function snooze() {
        try {
            global.localStorage?.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000));
        } catch (_) { /* nothing to do */ }
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
        if (hasAnswered() || isSnoozed()) return false;
        if (opens() < MIN_OPENS) return false;
        return extensionNeverUsed();
    }

    const card = global.NoticeCard.define({
        id: 'inbox-extension-notice',
        view: 'inbox',
        actionAttr: 'data-inbox-ext-action',
        dismissName: 'dismiss',
        showDelayMs: 4000,
        title: () => t('dashboard.inboxExtensionNoticeTitle', 'Fill your Inbox from the browser'),
        body: () => t('dashboard.inboxExtensionNoticeBody',
            'The browser extension saves the page you are on straight to your Inbox, so you can sort it later.'),
        dismissLabel: () => t('dashboard.inboxExtensionNoticeLater', 'Not now'),
        canShow: shouldShow,
        onShown: () => track('shown'),
        onDismiss: () => { snooze(); track('dismiss'); },
        actions: [
            {
                name: 'get',
                primary: true,
                label: () => t('dashboard.inboxExtensionNoticeGet', 'Get the extension'),
                onClick: (handle) => {
                    global.open(EXTENSION_URL, '_blank', 'noopener');
                    markAnswered();
                    track('get');
                    handle.close();
                },
            },
            {
                name: 'later',
                label: () => t('dashboard.inboxExtensionNoticeLater', 'Not now'),
                onClick: (handle) => { snooze(); track('later'); handle.close(); },
            },
            {
                name: 'never',
                quiet: true,
                label: () => t('dashboard.inboxExtensionNoticeNever', "Don't show again"),
                onClick: (handle) => { markAnswered(); track('never'); handle.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardInboxExtensionNotice = { card, onViewReady, shouldShow, PROMO_ID };
}(typeof window !== 'undefined' ? window : globalThis));
