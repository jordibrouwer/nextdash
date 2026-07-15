/**
 * One-time toast: the Glass layout was removed and this device was switched to Classic.
 *
 * theme-loader.js sets window.__nextdashLayoutWasGlass before normalizing the
 * stored value away; without that flag the switch is invisible by the time the
 * page renders.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:layout-glass-removed-v1';
    const SHOW_DELAY_MS = 1200;
    const TOAST_DURATION_MS = 9000;
    // ~2 minutes of retries: this announces a change the user did not ask for,
    // so it waits out a what's-new modal instead of giving up like a tip would.
    const MAX_RETRY_ATTEMPTS = 200;
    const RETRY_DELAY_MS = 600;

    let scheduleTimer = null;
    let retryAttempts = 0;

    const FALLBACK = 'The Glass layout has been removed. Your layout is now set to Classic.';

    function wasGlass() {
        return window.__nextdashLayoutWasGlass === true;
    }

    function language() {
        return window.dashboardInstance?.language || window.configManager?.language || null;
    }

    function message() {
        const lang = language();
        const scope = document.getElementById('config-main') ? 'config' : 'dashboard';
        const key = `${scope}.layoutGlassRemovedToast`;
        const text = lang?.t?.(key);
        if (text && text !== key) {
            return text;
        }
        const altKey = scope === 'config' ? 'dashboard.layoutGlassRemovedToast' : 'config.layoutGlassRemovedToast';
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

    /**
     * Rewrites a device-specific glass setting to classic so the flag does not
     * reappear on the next load. Server-stored settings normalize in models.go.
     */
    function persistClassic() {
        try {
            if (localStorage.getItem('deviceSpecificSettings') !== 'true') return;
            const raw = localStorage.getItem('dashboardSettings');
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if ((parsed?.layoutVersion || '').toLowerCase().trim() !== 'glass') return;
            parsed.layoutVersion = 'classic';
            localStorage.setItem('dashboardSettings', JSON.stringify(parsed));
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
            window.dashboardInstance.showNotification(text, 'info', options);
            return true;
        }
        if (window.configManager?.ui?.showNotification) {
            window.configManager.ui.showNotification(text, 'info', options);
            return true;
        }
        if (window.AppNotification?.show) {
            window.AppNotification.show(text, 'info', options);
            return true;
        }
        return false;
    }

    function maybeShow() {
        if (!wasGlass()) return true;
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
        if (!wasGlass()) return;
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

    persistClassic();

    window.LayoutGlassRemovedToast = {
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
