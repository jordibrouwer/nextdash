/**
 * One-time announcement of spreading a category across columns.
 *
 * A category can now run across several grid columns instead of growing
 * downwards. Nothing on the dashboard advertises that, and the switch lives in
 * a right-click menu — so like the side rail before it, it is offered once, in
 * the corner, at the moment the reader is looking at the grid it changes.
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes from
 * NoticeCard; only the parts below are specific to this announcement. The
 * "Show me" button hands over to SpreadTutorial, which is the same
 * step-by-step modal the inbox and health views use to introduce themselves —
 * this feature has the same problem those do: it looks obvious once you have
 * seen it work, and impossible to guess before.
 */
(function initSpreadNotice(global) {
    'use strict';

    const PROMO_ID = 'category-spread-v1';
    const SHOW_DELAY_MS = 7000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    /** Records the answer; each user is asked once, ever. */
    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function showMe(card) {
        markAnswered();
        card.close();
        global.nextdashTrack?.('category-spread-notice:opened');
        // A beat, so the card's own teardown transition is not competing with
        // the modal opening over it.
        setTimeout(() => global.SpreadTutorial?.open?.(), 220);
    }

    const card = global.NoticeCard.define({
        id: 'spread-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.spreadNoticeTitle', 'Categories can span columns'),
        body: () => t('dashboard.spreadNoticeBody',
            'A long category no longer has to tower over its neighbours: let it spread and its bookmarks flow across two or three columns instead of down one. How many columns it takes is worked out for you.'),
        dismissLabel: () => t('dashboard.spreadNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => {
            if (hasAnswered()) return false;
            const d = dash();
            // Pointless to announce where it cannot be used: one column has
            // nothing to spread across. The items-per-category limit is not
            // checked — a reader on Unlimited still wants to know the feature
            // exists, and the walkthrough explains what to set.
            return (d?.renderCore?.getEffectiveColumnsPerRow?.() || 1) > 1;
        },
        onDismiss: markAnswered,
        actionAttr: 'data-spread-action',
        actions: [
            {
                name: 'show',
                label: () => t('dashboard.spreadNoticeShowMe', 'Show me how'),
                primary: true,
                onClick: showMe,
            },
            {
                // Dismissed without looking — a real answer, so it does not
                // come back.
                name: 'dismiss',
                label: () => t('dashboard.spreadNoticeNoThanks', 'Not now'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardSpreadNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        showMe: () => showMe(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
