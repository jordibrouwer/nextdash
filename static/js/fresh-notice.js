/**
 * One-time offer of Fresh, in the corner of the dashboard.
 *
 * Fresh is off by default and its switch sits four panels down a tab called
 * Status & health, between the certificate warnings and the downtime alerts —
 * which is the right home for it and the wrong place to meet it. Nothing on the
 * grid suggests that some of these rows could tell you they have moved.
 *
 * So it is offered once, in the corner, the same way the side rail and the
 * spread-across-columns switch are. The card does not turn anything on: it
 * hands over to FreshTutorial, which explains what the count means, what it
 * costs, and what it deliberately is not — and ends on the switch. A feature
 * whose whole promise is "we will tell you what is new" has been sold badly
 * often enough that switching it on unasked would be the wrong first move.
 *
 * The card itself (markup, transition, corner etiquette, retry loop) comes from
 * NoticeCard; only the parts below are specific to this announcement.
 */
(function initFreshNotice(global) {
    'use strict';

    const PROMO_ID = 'fresh-feeds-v1';
    // Ahead of the side rail (7s) and spreading (7s), behind the analytics ask
    // (3.5s) which is a question rather than an offer. The queue serves cards in
    // the order they join it, and joining is what this delay decides — so on an
    // install that has never answered any of them, this is what puts the new
    // feature in front of the announcements from earlier releases.
    const SHOW_DELAY_MS = 6000;
    /**
     * Only an all-but-empty page is skipped.
     *
     * This was eight, on the reasoning that a fresh install's starter set is
     * seven and Fresh is about pages you chose to keep. Two things were wrong
     * with that. `dashboardInstance.bookmarks` is the page you are looking at,
     * not the collection, so on a dashboard split across pages the count is
     * whichever page you happen to be on. And a clean install sits at exactly
     * seven, one under the line — so the reader most likely to want a tour of
     * a feature they have never heard of is the one who never got the offer.
     */
    const MIN_BOOKMARKS = 3;

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

    /** What is on the page in front of the reader, however it is drawn. */
    function bookmarkCount() {
        const d = dash();
        const onPage = Array.isArray(d?.bookmarks) ? d.bookmarks.length : 0;
        if (onPage) return onPage;
        // The grid is the fallback: it is what the reader can see, and it is
        // present on every layout.
        return document.querySelectorAll('.bookmark-item, .bookmark-row').length;
    }

    function showMe(card) {
        markAnswered();
        card.close();
        global.nextdashTrack?.('fresh-notice:opened');
        // A beat, so the card's own teardown transition is not competing with
        // the modal opening over it.
        setTimeout(() => global.FreshTutorial?.open?.(), 220);
    }

    const card = global.NoticeCard.define({
        id: 'fresh-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.freshNoticeTitle', 'Some of these pages have moved on'),
        body: () => t('dashboard.freshNoticeBody',
            'A blog, a changelog, a status page — nextDash can put a small count on the ones that have published something since you last opened them, and gather them in a Fresh collection. No articles are stored; it is a count, not a reader.'),
        dismissLabel: () => t('dashboard.freshNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => {
            if (hasAnswered()) return false;
            const d = dash();
            // Nothing to offer someone who already has it on, and nothing to
            // say on a page with almost nothing on it.
            if (d?.settings?.feedsEnabled === true) return false;
            return bookmarkCount() >= MIN_BOOKMARKS;
        },
        onDismiss: markAnswered,
        actionAttr: 'data-fresh-action',
        actions: [
            {
                name: 'show',
                label: () => t('dashboard.freshNoticeShowMe', 'Show me how'),
                primary: true,
                onClick: showMe,
            },
            {
                // Dismissed without looking — a real answer, so it does not
                // come back.
                name: 'dismiss',
                label: () => t('dashboard.freshNoticeNoThanks', 'Not now'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardFreshNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        showMe: () => showMe(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
