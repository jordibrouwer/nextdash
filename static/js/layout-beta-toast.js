/**
 * One-time success toast: modern/glass layouts are early beta — prefer Classic.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:layout-beta-toast-v1';
    const SHOW_DELAY_MS = 1200;
    const TOAST_DURATION_MS = 9000;
    const MAX_RETRY_ATTEMPTS = 40;
    const RETRY_DELAY_MS = 600;

    let scheduleTimer = null;
    let retryAttempts = 0;

    const FALLBACK = 'Glass and modern layouts are still in early beta. Use Classic as layout for the best experience.';

    function language() {
        return window.dashboardInstance?.language || window.configManager?.language || null;
    }

    function message() {
        const lang = language();
        const scope = document.getElementById('config-main') ? 'config' : 'dashboard';
        const key = `${scope}.layoutBetaToast`;
        const text = lang?.t?.(key);
        if (text && text !== key) {
            return text;
        }
        const altKey = scope === 'config' ? 'dashboard.layoutBetaToast' : 'config.layoutBetaToast';
        const alt = lang?.t?.(altKey);
        if (alt && alt !== altKey) {
            return alt;
        }
        return FALLBACK;
    }

    function hasShown() {
        try {
            if (window.DiscoverabilityState?.isStorageKeyConfirmed?.(STORAGE_KEY)) {
                return true;
            }
            return localStorage.getItem(STORAGE_KEY) === '1';
        } catch {
            return true;
        }
    }

    function markShown() {
        window.DiscoverabilityState?.markStorageKeyConfirmed?.(STORAGE_KEY);
        try {
            localStorage.setItem(STORAGE_KEY, '1');
        } catch { /* ignore */ }
    }

    function canShowOnDashboard() {
        const dash = window.dashboardInstance;
        if (!dash) return false;
        if (dash.onboardingStartedInSession) return false;
        if (dash.settings?.onboardingCompleted !== true) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
        return true;
    }

    function notify(text, options) {
        if (window.dashboardInstance?.showNotification) {
            window.dashboardInstance.showNotification(text, 'success', options);
            return true;
        }
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification(text, 'success', options);
            return true;
        }
        if (window.AppNotification?.show) {
            window.AppNotification.show(text, 'success', options);
            return true;
        }
        return false;
    }

    function maybeShow() {
        if (hasShown()) return true;

        if (document.getElementById('dashboard-layout') && !canShowOnDashboard()) {
            return false;
        }

        if (!notify(message(), { duration: TOAST_DURATION_MS })) {
            return false;
        }

        markShown();
        return true;
    }

    function scheduleShow(options = {}) {
        if (hasShown()) return;

        if (scheduleTimer) {
            clearTimeout(scheduleTimer);
        }

        if (options.resetAttempts === true) {
            retryAttempts = 0;
        }

        const delay = Number.isFinite(options.delay) ? options.delay : SHOW_DELAY_MS;
        scheduleTimer = setTimeout(() => {
            scheduleTimer = null;
            if (maybeShow()) {
                retryAttempts = 0;
                return;
            }
            if (hasShown()) return;

            retryAttempts += 1;
            if (retryAttempts < MAX_RETRY_ATTEMPTS) {
                scheduleShow({ delay: RETRY_DELAY_MS });
            } else {
                retryAttempts = 0;
            }
        }, delay);
    }

    window.LayoutBetaToast = {
        STORAGE_KEY,
        hasShown,
        markShown,
        maybeShow,
        scheduleShow,
        reset() {
            window.DiscoverabilityState?.clearStorageKey?.(STORAGE_KEY);
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch { /* ignore */ }
        },
    };
})();
