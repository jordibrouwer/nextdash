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
 * It waits in the notifications bell (group Tips) until it is read.
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

    function openStudio() {
        const d = dash();
        markAnswered();
        if (!d?.config?.openThemeBrowser) {
            global.location.hash = 'config/appearance';
            return;
        }
        void Promise.resolve(d.config.openThemeBrowser()).catch(() => {
            global.location.hash = 'config/appearance';
        });
    }

    /*
     * A tip in the bell, not a corner card or a toast: it waits there until it
     * is read (the bell's "Mark read" or the button below), and then it is gone
     * for good. The day a fresh install waits is the only timing left.
     */
    const card = global.NoticeCard.define({
        id: 'theme-studio-notice',
        title: () => t('dashboard.themeStudioNoticeTitle', 'Not happy with how it looks?'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '\u{1F3A8}',
            no: 'forever',
            state: async () => (hasAnswered() || !oldEnough() ? null : {
                count: 1,
                text: t('dashboard.themeStudioNoticeToast', 'Not happy with how it looks? Press Shift+A to open the theme studio.'),
            }),
            actions: [
                {
                    label: () => t('dashboard.themeStudioNoticeOpen', 'Open the studio'),
                    primary: true,
                    marksRead: true,
                    onClick: () => openStudio(),
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    global.DashboardThemeStudioNotice = {
        shouldShow: () => !hasAnswered() && oldEnough(),
        dismiss: markAnswered,
        open: () => openStudio(),
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
