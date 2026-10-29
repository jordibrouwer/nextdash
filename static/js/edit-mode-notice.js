/**
 * One-time hint that the dashboard can be edited in place.
 *
 * Renaming a category, changing its width or opening a widget's settings used
 * to mean a trip to Config. Edit mode keeps all of it on the dashboard: the
 * pencil in the action bar or Shift+M (with no bookmark selected) turns it on,
 * and a click on a block opens its panel. The card names the key and offers to
 * switch the mode on.
 *
 * Everyone is asked once. A fresh install waits a day from the moment the
 * settings file was written (settings.firstRunAt); an install without that
 * stamp is asked at the next quiet moment. Either way it comes no sooner than
 * three minutes after the latest corner card. Phones never see it: the mode is
 * for desktop layouts.
 */
(function initEditModeNotice(global) {
    'use strict';

    const PROMO_ID = 'edit-mode-hint-v1';
    const NEWCOMER_WAIT_MS = 24 * 60 * 60 * 1000;
    // After the theme studio hint, which is the same kind of one-time ask.
    const SHOW_DELAY_MS = 20000;
    // Never right behind another card: three minutes after the latest one.
    const GAP_AFTER_CARD_MS = 3 * 60 * 1000;

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

    function oldEnough() {
        const settings = dash()?.settings;
        if (settings?.firstRunInstall !== true) return true;
        const at = Number(settings.firstRunAt) || 0;
        if (at <= 0) return true;
        return Date.now() - at >= NEWCOMER_WAIT_MS;
    }

    function available() {
        const mode = dash()?.editMode;
        return Boolean(mode) && mode.isMobileLayout?.() !== true && mode.active !== true;
    }

    function tryIt(card) {
        markAnswered();
        card.close();
        dash()?.editMode?.enter?.();
    }

    const card = global.NoticeCard.define({
        id: 'edit-mode-notice',
        showDelayMs: SHOW_DELAY_MS,
        minGapAfterCardMs: GAP_AFTER_CARD_MS,
        title: () => t('dashboard.editModeNoticeTitle', 'Edit the dashboard right where it is'),
        body: () => t('dashboard.editModeNoticeBody',
            'Press Shift+M, with no bookmark selected, or click the pencil in the action bar. Then click a category, widget or page to rename it, change its width or view, or open a widget\'s settings in a panel beside the page. Esc leaves.'),
        dismissLabel: () => t('dashboard.editModeNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => !hasAnswered() && oldEnough() && available(),
        onDismiss: markAnswered,
        actionAttr: 'data-em-action',
        actions: [
            {
                name: 'open',
                label: () => t('dashboard.editModeNoticeOpen', 'Try edit mode'),
                primary: true,
                onClick: tryIt,
            },
            {
                name: 'dismiss',
                label: () => t('dashboard.editModeNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
        card.autoStart();
    }

    global.DashboardEditModeNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        open: () => tryIt(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
