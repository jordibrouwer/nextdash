/**
 * Bookmarks → Unsorted, when it has stopped being a waiting room.
 *
 * Keeping is the cheap half of a decision: the link leaves the queue, nothing
 * has to be chosen, and the list grows. The queue has a badge and a ceiling to
 * stop that happening to it; this list deliberately has neither, because
 * throwing away what somebody kept is the one thing it must never do on its
 * own.
 *
 * So it says something instead, as a quiet row in the notifications bell, and
 * only when there is something to say: a real pile of old links, old enough
 * that nobody is coming back for it this week. The row does not file, delete
 * or change a setting — it opens the list, where every tool for the job
 * already is.
 */
(function initKeptPileNotice(global) {
    'use strict';

    const PROMO_ID = 'kept-pile-v1';

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

    /** Kept links older than the line, which is what the card is about. */
    function staleCount() {
        const cutoff = Date.now() - STALE_AFTER_DAYS * 86400000;
        return (dash()?.unsortedBookmarks || []).filter((bookmark) => {
            const created = Number(bookmark?.createdAt) || 0;
            return created > 0 && created < cutoff;
        }).length;
    }

    /**
     * Opening the list is not an answer: the row stays until the pile shrinks
     * or the bell is told "No". (An answer given under the old corner card is
     * still honoured by hasAnswered().)
     */
    function openKept() {
        global.nextdashTrack?.('kept-pile-notice:opened');
        void dash()?.openUnsortedBookmarks?.();
    }

    /** The bell row: how many kept links are old, or null when there is no pile. */
    async function bellState() {
        if (hasAnswered()) return null;
        // Nothing to say where keeping is switched off.
        if (dash()?.settings?.unsortedEnabled === false) return null;
        const count = staleCount();
        if (count < MIN_STALE) return null;
        return {
            count,
            text: t('keptPileBellText', '{count} kept links waiting over a month', { count }),
        };
    }

    // A quiet row in the bell, not a corner card: a pile of kept links is worth
    // knowing about, not worth interrupting for. "No" hides it until the pile
    // has grown by twenty.
    const card = global.NoticeCard.define({
        id: 'kept-pile',
        title: () => t('keptPileNoticeTitle', 'Kept links are piling up'),
        bell: {
            kind: 'quiet',
            group: 'cleanup',
            icon: '\u{1F5C2}',
            no: { threshold: 20 },
            state: bellState,
            actions: [
                {
                    label: () => t('keptPileNoticeOpen', 'Open Unsorted'),
                    primary: true,
                    onClick: openKept,
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardKeptPileNotice = {
        state: bellState,
        staleCount,
        PROMO_ID,
        MIN_STALE,
        STALE_AFTER_DAYS,
    };
}(typeof window !== 'undefined' ? window : globalThis));
