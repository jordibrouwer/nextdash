/**
 * Rotating footer tips: on for 7 days after onboarding, then auto-off unless user re-enables.
 */
(function () {
    'use strict';

    const STORAGE_UNTIL = 'nextdash-tips-promo-until-v1';
    const STORAGE_TIPS_NOT_BEFORE = 'nextdash-tips-not-before-v1';
    const PROMO_MS = 7 * 24 * 60 * 60 * 1000;
    const ONBOARDING_TIPS_DELAY_MS = 60 * 1000;

    function readUntil() {
        const fromServer = window.DiscoverabilityState?.getTipsPromoUntil?.();
        if (fromServer > 0) {
            return fromServer;
        }
        try {
            return Number(localStorage.getItem(STORAGE_UNTIL) || 0);
        } catch {
            return 0;
        }
    }

    function writeUntil(ts) {
        window.DiscoverabilityState?.setTipsPromoUntil?.(ts);
        try {
            if (ts > 0) {
                localStorage.setItem(STORAGE_UNTIL, String(ts));
            } else {
                localStorage.removeItem(STORAGE_UNTIL);
            }
        } catch { /* ignore */ }
    }

    function readTipsNotBefore() {
        const fromServer = window.DiscoverabilityState?.getTipsNotBefore?.();
        if (fromServer > 0) {
            return fromServer;
        }
        try {
            return Number(localStorage.getItem(STORAGE_TIPS_NOT_BEFORE) || 0);
        } catch {
            return 0;
        }
    }

    function writeTipsNotBefore(ts) {
        window.DiscoverabilityState?.setTipsNotBefore?.(ts);
        try {
            if (ts > 0) {
                localStorage.setItem(STORAGE_TIPS_NOT_BEFORE, String(ts));
            } else {
                localStorage.removeItem(STORAGE_TIPS_NOT_BEFORE);
            }
        } catch { /* ignore */ }
    }

    window.TipsPolicy = {
        startPromoPeriod() {
            writeUntil(Date.now() + PROMO_MS);
        },

        /** Wait 1 minute after onboarding finish/skip before showing rotating tips. */
        markOnboardingEnded() {
            writeTipsNotBefore(Date.now() + ONBOARDING_TIPS_DELAY_MS);
        },

        getTipsStartDelayMs() {
            const notBefore = readTipsNotBefore();
            if (!notBefore) return 0;
            return Math.max(0, notBefore - Date.now());
        },

        clearTipsStartDelay() {
            writeTipsNotBefore(0);
        },

        clearPromoPeriod() {
            writeUntil(0);
        },

        isPromoActive() {
            const until = readUntil();
            return until > 0 && Date.now() < until;
        },

        async applyExpiry(dashboard) {
            const until = readUntil();
            if (!until || Date.now() < until) return false;
            writeUntil(0);
            if (!dashboard?.settings || dashboard.settings.showTips === false) return false;
            dashboard.settings.showTips = false;
            document.body.setAttribute('data-show-tips', 'false');
            if (typeof dashboard.saveSettings === 'function') {
                await dashboard.saveSettings();
            }
            return true;
        },

        /** User config wins; promo only applies when showTips was never set (undefined). */
        shouldShowRotatingTips(settings) {
            if (settings?.showTips === false) return false;
            if (settings?.showTips === true) return true;
            return this.isPromoActive();
        },

        onUserPreference(enabled) {
            if (enabled) {
                this.clearPromoPeriod();
            }
        },
    };
}());
