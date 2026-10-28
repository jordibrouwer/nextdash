/**
 * "Updated from v1.19.0 to v1.22.0", said once in the corner.
 *
 * The What's new modal opens by itself on a new version, and closing it
 * forgets which version the reader came from. dashboard-promos.js records that
 * pair (window.__nextdashUpdatedFrom) before the modal marks the release seen;
 * this card names both versions after the notes are closed, with a way back
 * into them. Once per target version, and never on a new install.
 */
(function initUpdatedNotice(global) {
    'use strict';

    const PROMO_ID = 'updated-notice';
    const SHOW_DELAY_MS = 2500;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const d = dash();
        if (d?.formatDashboardLabel) return d.formatDashboardLabel(key, vars || {}, fallback);
        return fallback;
    }

    function info() {
        return global.__nextdashUpdatedFrom || null;
    }

    function promoKey() {
        const to = info()?.to;
        return to ? `updated-${to}` : '';
    }

    function hasAnswered() {
        const key = promoKey();
        return !key || global.DiscoverabilityState?.hasSeenSettingPromo?.(key) === true;
    }

    function markAnswered() {
        const key = promoKey();
        if (key) global.DiscoverabilityState?.markSettingPromoSeen?.(key);
    }

    function fill(text) {
        const v = info() || {};
        return String(text).replace('{from}', v.from || '').replace('{to}', v.to || '');
    }

    const card = global.NoticeCard.define({
        id: 'updated-notice',
        // A report of something that already happened, not an invitation: the
        // cards that ask something of the reader (the container question among
        // them) do not wait for it to be answered.
        essential: true,
        showDelayMs: SHOW_DELAY_MS,
        title: () => fill(t('dashboard.updatedNoticeTitle', 'Updated from {from} to {to}')),
        body: () => t('dashboard.updatedNoticeBody', 'See what is new in this version.'),
        dismissLabel: () => t('dashboard.updatedNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => {
            if (global.DemoLock?.on) return false;
            if (dash()?.settings?.enableUpdatedNotice === false) return false;
            if (!info() || hasAnswered()) return false;
            // After the notes, never on top of them.
            if (document.querySelector('.whats-new-modal')?.offsetParent) return false;
            return true;
        },
        onShown: () => global.nextdashTrack?.('updated-notice', { action: 'shown' }),
        onDismiss: () => {
            global.nextdashTrack?.('updated-notice', { action: 'dismiss' });
            markAnswered();
        },
        actionAttr: 'data-updated-notice-action',
        actions: [
            {
                name: 'open',
                label: () => t('dashboard.updatedNoticeOpen', "What's new"),
                primary: true,
                onClick: (c) => {
                    global.nextdashTrack?.('updated-notice', { action: 'open' });
                    markAnswered();
                    c.close();
                    global.openWhatsNewModal?.({ force: true });
                },
            },
        ],
    });

    // The modal's onClose calls this; the card's own timer is restarted so it
    // joins the corner queue just after the notes are gone.
    function scheduleAfterWhatsNew() {
        card.stop();
        card.autoStart();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardUpdatedNotice = {
        card,
        shouldShow: card.shouldShowSync,
        scheduleAfterWhatsNew,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
