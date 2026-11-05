/**
 * "Updated from v1.19.0 to v1.22.0", as a row in the notifications bell.
 *
 * The What's new modal opens by itself on a new version, and closing it
 * forgets which version the reader came from. dashboard-promos.js records that
 * pair (window.__nextdashUpdatedFrom) before the modal marks the release seen;
 * this row names both versions, with a way back into the notes. It used to be a
 * toast in the corner; it now waits quietly in the bell until it is read, so the
 * pair is also kept in this browser (PENDING_KEY) to outlive a reload. Once per
 * target version, and never on a new install.
 */
(function initUpdatedNotice(global) {
    'use strict';

    const PROMO_ID = 'updated-notice';
    // The pair captured on the load that saw the update, until it is answered.
    const PENDING_KEY = 'nextdashUpdatedFromPending';

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const d = dash();
        if (d?.formatDashboardLabel) return d.formatDashboardLabel(key, vars || {}, fallback);
        return fallback;
    }

    function readPending() {
        try {
            const v = JSON.parse(global.localStorage?.getItem(PENDING_KEY) || 'null');
            return v && v.from && v.to ? v : null;
        } catch (_) { return null; }
    }

    /** The captured pair, from this load or kept from the load that saw it. */
    function info() {
        const now = global.__nextdashUpdatedFrom || null;
        if (now) {
            try { global.localStorage?.setItem(PENDING_KEY, JSON.stringify({ from: now.from, to: now.to })); } catch (_) { /* private mode */ }
            return now;
        }
        return readPending();
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
        try { global.localStorage?.removeItem(PENDING_KEY); } catch (_) { /* private mode */ }
    }

    function fill(text) {
        const v = info() || {};
        return String(text).replace('{from}', v.from || '').replace('{to}', v.to || '');
    }

    /** Whether there is an update to report. */
    function eligible() {
        if (global.DemoLock?.on) return false;
        if (dash()?.settings?.enableUpdatedNotice === false) return false;
        return !!info() && !hasAnswered();
    }

    function title() {
        return fill(t('dashboard.updatedNoticeTitle', 'Updated from {from} to {to}'));
    }

    /** The bell row: one per target version, until it is read or answered "No". */
    async function bellState() {
        if (!eligible()) return null;
        return { count: 1, ids: [info().to], text: title() };
    }

    function openNotes() {
        global.nextdashTrack?.('updated-notice', { action: 'open' });
        markAnswered();
        global.openWhatsNewModal?.({ force: true });
    }

    const card = global.NoticeCard.define({
        id: 'updated-notice',
        title,
        body: () => t('dashboard.updatedNoticeBody', 'See what is new in this version.'),
        canShow: eligible,
        // A report of something that already happened: it waits in the bell
        // instead of interrupting, and "No" there counts as having seen it.
        bell: {
            kind: 'quiet',
            group: 'system',
            icon: '\u2728',
            no: 'state',
            state: bellState,
            onNo: () => {
                global.nextdashTrack?.('updated-notice', { action: 'dismiss' });
                markAnswered();
            },
            actions: [
                {
                    label: () => t('dashboard.updatedNoticeOpen', "What's new"),
                    primary: true,
                    marksRead: true,
                    onClick: openNotes,
                },
            ],
        },
    });

    // The modal's onClose calls this: the pair is known by now, so the bell
    // looks again and the row is there when the notes are closed.
    function scheduleAfterWhatsNew() {
        void global.NotificationBell?.refreshAll?.();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardUpdatedNotice = {
        card,
        shouldShow: eligible,
        bellState,
        scheduleAfterWhatsNew,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
