/**
 * A tip in the bell for people who follow feeds: the news used to open on
 * Shift+N and opens on Shift+W now, Shift+N being the bell.
 *
 * Only shown while at least one feed is watched, since the key means nothing
 * otherwise. It waits in the bell until it is read (the bell's "Mark read" or
 * the button below), and then it is gone for good.
 */
(function initNewsMovedNotice(global) {
    'use strict';

    const PROMO_ID = 'news-moved-shift-w-v1';

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

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function feedsWatched() {
        return (dash()?.feedWatch?.byKey?.size || 0) > 0;
    }

    function openNews() {
        markAnswered();
        void global.FeedWatchNews?.open?.({ source: 'button' });
    }

    const card = global.NoticeCard.define({
        id: 'news-moved-notice',
        title: () => t('dashboard.newsMovedNoticeTitle', 'The news has a new key'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '\u{1F4F0}',
            no: 'forever',
            state: async () => (hasAnswered() || !feedsWatched() ? null : {
                count: 1,
                text: t('dashboard.newsMovedNoticeText', 'The news of your feeds moved to Shift+W. Shift+N opens this bell.'),
            }),
            onRead: () => markAnswered(),
            actions: [
                {
                    label: () => t('dashboard.newsMovedNoticeOpen', 'Open the news'),
                    primary: true,
                    marksRead: true,
                    onClick: () => openNews(),
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardNewsMovedNotice = { shouldShow: () => !hasAnswered() && feedsWatched(), dismiss: markAnswered, PROMO_ID };
}(typeof window !== 'undefined' ? window : globalThis));
