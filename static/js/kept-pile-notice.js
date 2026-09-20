/**
 * The kept list, when it has stopped being a waiting room.
 *
 * Keeping is the cheap half of a decision: the link leaves the queue, nothing
 * has to be chosen, and the list grows. The queue has a badge and a ceiling to
 * stop that happening to it; this list deliberately has neither, because
 * throwing away what somebody kept is the one thing it must never do on its
 * own.
 *
 * So it says something instead, once, in the corner the other one-time notices
 * use, and only when there is something to say: a real pile, most of it old
 * enough that nobody is coming back for it this week. The card does not file,
 * delete or change a setting — it opens the list, where every tool for the job
 * already is.
 */
(function initKeptPileNotice(global) {
    'use strict';

    const PROMO_ID = 'kept-pile-v1';
    // Last in the corner's queue: an announcement about a feature is worth
    // interrupting a new reader for, a pile of their own links is not.
    const SHOW_DELAY_MS = 9000;

    /**
     * What counts as a pile, and what counts as old.
     *
     * Ten because below that the list is one screen and the reader can see it
     * is a list; thirty days because a kept link is a decision postponed and a
     * month is when postponed turns into forgotten. Both are deliberately
     * generous: a card that arrives while somebody is still triaging is a card
     * that gets dismissed unread.
     */
    const MIN_STALE = 10;
    const STALE_AFTER_DAYS = 30;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, vars) {
        const d = dash();
        if (d?.formatDashboardLabel) return d.formatDashboardLabel(key, vars || {}, fallback);
        return fallback;
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    /** Kept links older than the line, which is what the card is about. */
    function staleCount() {
        const cutoff = Date.now() - STALE_AFTER_DAYS * 86400000;
        return (dash()?.unsortedBookmarks || []).filter((bookmark) => {
            const created = Number(bookmark?.createdAt) || 0;
            return created > 0 && created < cutoff;
        }).length;
    }

    function openKept(card) {
        global.nextdashTrack?.('kept-pile-notice:opened');
        markAnswered();
        card.close();
        void dash()?.inbox?.openInboxView?.({ tab: 'kept' });
    }

    const card = global.NoticeCard.define({
        id: 'kept-pile',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('keptPileNoticeTitle', 'Kept links are piling up'),
        body: () => t('keptPileNoticeBody',
            `${staleCount()} of the links you kept have been waiting over a month for a page. The kept list can file a batch at once — group them by site or by suggested tag, tick a group, and move it.`,
            { count: staleCount(), days: STALE_AFTER_DAYS }),
        dismissLabel: () => t('keptPileNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => {
            if (hasAnswered()) return false;
            const d = dash();
            // Nothing to say where keeping is switched off, and nothing to say
            // about a list somebody is plainly working through.
            if (d?.settings?.unsortedEnabled === false) return false;
            return staleCount() >= MIN_STALE;
        },
        onDismiss: markAnswered,
        actionAttr: 'data-kept-pile-action',
        actions: [
            {
                name: 'open',
                label: () => t('keptPileNoticeOpen', 'Open the kept list'),
                primary: true,
                onClick: openKept,
            },
            {
                name: 'dismiss',
                label: () => t('keptPileNoticeLater', 'Not now'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardKeptPileNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        staleCount,
        PROMO_ID,
        MIN_STALE,
        STALE_AFTER_DAYS,
    };
}(typeof window !== 'undefined' ? window : globalThis));
