/**
 * An invitation to turn on the daily image-update check.
 *
 * The check is off by default because it sends requests to the image
 * registries. Someone who has linked the Docker socket and keeps coming back to
 * the Containers view is the person it is for, so after the third visit the
 * notifications bell offers it once, as a tip that stays until it is read.
 * Nothing changes unless "Turn on (daily)" is pressed.
 */
(function initDockerUpdateNotice(global) {
    'use strict';

    const PROMO_ID = 'docker-update-offer-v1';
    const OPENS_KEY = 'nextdashDockerViewOpens';
    const MIN_OPENS = 3;

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
        return !hasAnswered();
    }

    async function turnOn() {
        const d = dash();
        if (!d) return;
        const before = d.settings.dockerUpdateInterval;
        d.settings.dockerUpdateInterval = '24h';
        try {
            if ((await d.saveSettings({ keys: ['dockerUpdateInterval'] })) === false) throw new Error('not saved');
        } catch {
            d.settings.dockerUpdateInterval = before;
            d.showNotification?.(t('dashboard.dockerUpdateNoticeFailed', 'Could not turn this on. Try again in Config.'), 'error');
            return;
        }
        track('enable');
        markAnswered();
    }

    // A tip in the bell, in every view: "Turn on (daily)" turns the check on
    // and reads the row, and "Mark read" lets it go without. Either way it does
    // not come back; the switch in Config is the way to change your mind.
    const card = global.NoticeCard.define({
        id: 'docker-update-notice',
        title: () => t('dashboard.dockerUpdateNoticeTitle', 'Check images for updates?'),
        bell: {
            kind: 'tip',
            group: 'tips',
            icon: '\u{1F433}',
            no: 'forever',
            state: async () => (eligible() ? {
                count: 1,
                text: t('dashboard.dockerUpdateNoticeToast', 'Check images for updates? Turn it on under Config → Containers → Updates. nextDash then asks the image registries once a day; nothing updates by itself.'),
            } : null),
            actions: [
                {
                    label: () => t('dashboard.dockerUpdateNoticeEnable', 'Turn on (daily)'),
                    primary: true,
                    marksRead: true,
                    onClick: () => { void turnOn(); },
                },
            ],
        },
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }

    /** Called once per Containers view open, after its status has loaded. */
    function onViewReady() {
        try {
            global.localStorage?.setItem(OPENS_KEY, String(opens() + 1));
        } catch {
            /* the card then simply never reaches its third visit */
        }
        void global.NotificationBell?.refreshAll?.();
    }

    global.DashboardDockerUpdateNotice = {
        card,
        onViewReady,
        shouldShow: eligible,
        PROMO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
