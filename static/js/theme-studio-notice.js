/**
 * One-time hint that the theme studio is a keypress away.
 *
 * Someone who is not happy with how the dashboard looks has little reason to
 * think the answer is one shortcut: colours, backdrop, the Surface tab (depth,
 * glow, corners) and the Layout tab (width, spacing, columns) all sit in one
 * panel docked beside the page, Shift+A opens it, and every change previews
 * live until Apply. The card names the key and the two tabs that are most
 * often what a reader wants, and opens the studio on request.
 *
 * Everyone is asked once. A fresh install is not greeted on its first day —
 * it is still finding its way around, and the setup cards come first — so for
 * those the card waits a day from the moment the settings file was written
 * (settings.firstRunAt). An install without that stamp, which includes every
 * install that predates it, is asked at the next quiet moment.
 */
(function initThemeStudioNotice(global) {
    'use strict';

    const PROMO_ID = 'theme-studio-hint-v1';
    const NEWCOMER_WAIT_MS = 24 * 60 * 60 * 1000;
    // After the side-rail and theme-browser cards, which are the same kind of
    // one-time ask; the corner queue decides the order, the delay only keeps
    // this one from racing them on load.
    const SHOW_DELAY_MS = 15000;

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

    /** A fresh install waits a day; an upgrade, or an install with no stamp, does not. */
    function oldEnough() {
        const settings = dash()?.settings;
        if (settings?.firstRunInstall !== true) return true;
        const at = Number(settings.firstRunAt) || 0;
        if (at <= 0) return true;
        return Date.now() - at >= NEWCOMER_WAIT_MS;
    }

    function openStudio(card) {
        const d = dash();
        markAnswered();
        card.close();
        if (!d?.config?.openThemeBrowser) {
            global.location.hash = 'config/appearance';
            return;
        }
        void Promise.resolve(d.config.openThemeBrowser()).catch(() => {
            global.location.hash = 'config/appearance';
        });
    }

    const card = global.NoticeCard.define({
        id: 'theme-studio-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.themeStudioNoticeTitle', 'Not happy with how it looks?'),
        body: () => t('dashboard.themeStudioNoticeBody',
            'Press Shift+A to open the theme studio. Besides the theme itself, Surface sets depth, glow and corners, and Layout sets width, spacing and columns. Everything previews on the page while you try it, and nothing is saved until you press Apply.'),
        dismissLabel: () => t('dashboard.themeStudioNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: () => !hasAnswered() && oldEnough(),
        onDismiss: markAnswered,
        actionAttr: 'data-ts-action',
        actions: [
            {
                name: 'open',
                label: () => t('dashboard.themeStudioNoticeOpen', 'Open the studio'),
                primary: true,
                onClick: openStudio,
            },
            {
                name: 'dismiss',
                label: () => t('dashboard.themeStudioNoticeNoThanks', 'No thanks'),
                onClick: (c) => { markAnswered(); c.close(); },
            },
        ],
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
        card.autoStart();
    }

    global.DashboardThemeStudioNotice = {
        render: card.renderSync,
        shouldShow: card.shouldShowSync,
        dismiss: () => { markAnswered(); card.close(); },
        open: () => openStudio(card),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
