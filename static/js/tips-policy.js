/**
 * Rotating footer tips: on for 7 days after onboarding, then auto-off unless user re-enables.
 */
(function () {
    'use strict';

    const STORAGE_UNTIL = 'nextdash-tips-promo-until-v1';
    const PROMO_MS = 7 * 24 * 60 * 60 * 1000;

    function readUntil() {
        try {
            return Number(localStorage.getItem(STORAGE_UNTIL) || 0);
        } catch {
            return 0;
        }
    }

    function writeUntil(ts) {
        try {
            if (ts > 0) {
                localStorage.setItem(STORAGE_UNTIL, String(ts));
            } else {
                localStorage.removeItem(STORAGE_UNTIL);
            }
        } catch { /* ignore */ }
    }

    window.TipsPolicy = {
        startPromoPeriod() {
            writeUntil(Date.now() + PROMO_MS);
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

        shouldShowRotatingTips(settings) {
            if (!settings) return false;
            if (settings.showTips !== false) return true;
            return this.isPromoActive();
        }
    };
})();
