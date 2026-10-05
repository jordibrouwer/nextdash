/**
 * One-time pointer to the feature overview on nextdash.cc.
 *
 * nextDash does far more than its first screen shows: the inbox, health checks,
 * containers, widgets, the command bar. Most of it is a key or
 * a menu away, and someone who has settled in with a page of bookmarks has no
 * reason to go looking. The site keeps one page that walks through all of it
 * (nextdash.cc/features/), so the card does not try to describe the product --
 * it points there.
 *
 * Asked once someone has made the dashboard their own (a handful of
 * bookmarks), not on day one: a list of everything else is noise before the
 * first thing works. It opens in a new tab and the answer is kept, so it never
 * comes back unless Config → its row says Show again.
 *
 * The card itself comes from NoticeCard; only the parts below are its own.
 */
(function initFeaturesNotice(global) {
    'use strict';

    const PROMO_ID = 'features-overview-v1';
    const FEATURES_URL = 'https://nextdash.cc/features/';
    // After the other one-time cards: the corner holds one, and an invitation to
    // read about everything waits behind the ones about a single thing.
    const SHOW_DELAY_MS = 15000;
    const MIN_BOOKMARKS = 8;

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

    function bookmarkCount() {
        const d = dash();
        const all = Array.isArray(d?.allBookmarks) ? d.allBookmarks.length : 0;
        const onPage = Array.isArray(d?.bookmarks) ? d.bookmarks.length : 0;
        return Math.max(all, onPage);
    }

    function openFeatures(card) {
        markAnswered();
        card.close();
        global.open(FEATURES_URL, '_blank', 'noopener');
    }

    const card = global.NoticeCard.define({
        id: 'features-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.featuresNoticeTitle', 'There is more to nextDash than this page'),
        body: () => t('dashboard.featuresNoticeBody',
            'The inbox, health checks, containers, widgets and the command bar — the feature overview on nextdash.cc walks through all of it. It opens in a new tab.'),
        dismissLabel: () => t('dashboard.featuresNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => !hasAnswered() && bookmarkCount() >= MIN_BOOKMARKS,
        onDismiss: markAnswered,
        actionAttr: 'data-features-action',
        actions: [
            {
                name: 'open',
                label: () => t('dashboard.featuresNoticeOpen', 'See all features'),
                primary: true,
                onClick: openFeatures,
            },
            {
                // Waved away without looking -- a real answer, so it does not come back.
                name: 'dismiss',
                label: () => t('dashboard.featuresNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardFeaturesNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        PROMO_ID,
        FEATURES_URL,
    };
}(typeof window !== 'undefined' ? window : globalThis));
