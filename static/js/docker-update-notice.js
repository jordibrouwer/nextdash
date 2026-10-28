/**
 * An invitation to turn on the daily image-update check.
 *
 * The check is off by default because it sends requests to the image
 * registries. Someone who has linked the Docker socket and keeps coming back to
 * the Containers view is the person it is for, so after the third visit the
 * Containers view offers it once, in the corner the app uses for invitations.
 * Nothing changes unless "Turn on (daily)" is pressed.
 */
(function initDockerUpdateNotice(global) {
    'use strict';

    const PROMO_ID = 'docker-update-offer-v1';
    const OPENS_KEY = 'nextdashDockerViewOpens';
    const SNOOZE_KEY = 'nextdashDockerUpdateOfferSnoozeUntil';
    const MIN_OPENS = 3;
    const SNOOZE_DAYS = 30;
    const SHOW_DELAY_MS = 2500;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback) {
        const lang = dash()?.language;
        if (!lang?.t) return fallback;
        const value = lang.t(key);
        return value && value !== key ? value : fallback;
    }

    function track(action) {
        global.nextdashTrack?.('docker-update-offer', { action });
    }

    function opens() {
        try {
            const n = Number(global.localStorage?.getItem(OPENS_KEY));
            return Number.isFinite(n) && n > 0 ? n : 0;
        } catch {
            return 0;
        }
    }

    function isSnoozed() {
        try {
            const until = Number(global.localStorage?.getItem(SNOOZE_KEY));
            return Number.isFinite(until) && until > Date.now();
        } catch {
            return false;
        }
    }

    function snooze() {
        try {
            global.localStorage?.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
        } catch {
            /* asking again is the smaller failure */
        }
    }

    function hasAnswered() {
        return global.DiscoverabilityState?.hasSeenSettingPromo?.(PROMO_ID) === true;
    }

    function markAnswered() {
        global.DiscoverabilityState?.markSettingPromoSeen?.(PROMO_ID);
    }

    function eligible() {
        const d = dash();
        if (!d) return false;
        const s = d.settings || {};
        if (s.enableDockerUpdateNotice === false) return false;
        if (s.dockerViewEnabled === false) return false;
        if (s.dockerUpdateInterval !== 'off') return false;
        if (d.docker?.isEnabled?.() === false) return false;
        // The loader keeps the view module, which holds the status it read.
        const status = d.docker?._module?.status ?? d.docker?.status;
        if (status?.socket !== true) return false;
        if (opens() < MIN_OPENS) return false;
        return !hasAnswered() && !isSnoozed();
    }

    async function turnOn(handle) {
        const d = dash();
        if (!d) return;
        const before = d.settings.dockerUpdateInterval;
        d.settings.dockerUpdateInterval = '24h';
        try {
            if ((await d.saveSettings()) === false) throw new Error('not saved');
        } catch {
            d.settings.dockerUpdateInterval = before;
            handle.showError(t('dashboard.dockerUpdateNoticeFailed', 'Could not turn this on. Try again in Config.'));
            return;
        }
        track('enable');
        markAnswered();
        handle.close();
    }

    const card = global.NoticeCard.define({
        id: 'docker-update-notice',
        view: 'docker',
        showDelayMs: SHOW_DELAY_MS,
        title: () => t('dashboard.dockerUpdateNoticeTitle', 'Check images for updates?'),
        body: () => t('dashboard.dockerUpdateNoticeBody',
            'nextDash can ask the image registries once a day whether your containers have a newer image. This sends requests to those registries. Nothing updates by itself.'),
        dismissLabel: () => t('dashboard.dockerUpdateNoticeDismiss', 'Dismiss'),
        dismissName: 'dismiss',
        canShow: eligible,
        onShown: () => track('shown'),
        onDismiss: () => { snooze(); track('dismiss'); },
        actionAttr: 'data-du-action',
        actions: [
            {
                name: 'enable',
                label: () => t('dashboard.dockerUpdateNoticeEnable', 'Turn on (daily)'),
                primary: true,
                onClick: (handle) => { void turnOn(handle); },
            },
            {
                name: 'later',
                label: () => t('dashboard.dockerUpdateNoticeLater', 'Not now'),
                onClick: (handle) => { snooze(); track('later'); handle.close(); },
            },
            {
                name: 'never',
                label: () => t('dashboard.dockerUpdateNoticeNever', 'Never'),
                quiet: true,
                onClick: (handle) => { markAnswered(); track('never'); handle.close(); },
            },
        ],
    });

    /** Called once per Containers view open, after its status has loaded. */
    function onViewReady() {
        try {
            global.localStorage?.setItem(OPENS_KEY, String(opens() + 1));
        } catch {
            /* the card then simply never reaches its third visit */
        }
        card.stop();
        card.autoStart();
    }

    global.DashboardDockerUpdateNotice = {
        card,
        onViewReady,
        shouldShow: card.shouldShow,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
