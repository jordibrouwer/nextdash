/**
 * One-time info toast: introduce Inbox and the 0 shortcut for existing users.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:inbox-intro-toast-v1';
    const SHOW_DELAY_MS = 1400;
    const TOAST_DURATION_MS = 10000;
    const MAX_RETRY_ATTEMPTS = 40;
    const RETRY_DELAY_MS = 600;

    let scheduleTimer = null;
    let retryAttempts = 0;

    const FALLBACK_MESSAGE = 'New: Inbox — save links to read later. Press 0 anytime to open it.';
    const FALLBACK_ACTION = 'Open Inbox';

    function language() {
        return window.dashboardInstance?.language || null;
    }

    function translate(key, fallback) {
        const lang = language();
        const text = lang?.t?.(key);
        if (text && text !== key) {
            return text;
        }
        return fallback;
    }

    function message() {
        return translate('dashboard.inboxIntroToast', FALLBACK_MESSAGE);
    }

    function actionLabel() {
        return translate('dashboard.inboxIntroToastAction', FALLBACK_ACTION);
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

    function isInboxEnabled() {
        const dash = window.dashboardInstance;
        return dash?.settings?.inboxEnabled !== false;
    }

    function canShowOnDashboard() {
        const dash = window.dashboardInstance;
        if (!dash) return false;
        if (!isInboxEnabled()) return false;
        if (dash.onboardingStartedInSession) return false;
        if (dash.settings?.onboardingCompleted !== true) return false;
        if (document.body.classList.contains('bookmark-inline-edit-active')) return false;
        if (typeof dash.isModalOpen === 'function' && dash.isModalOpen()) return false;
        return true;
    }

    function openInbox() {
        void window.dashboardInstance?.inbox?.openInboxView?.();
    }

    function notify(text, options) {
        if (window.dashboardInstance?.showNotification) {
            window.dashboardInstance.showNotification(text, 'info', options);
            return true;
        }
        if (window.AppNotification?.show) {
            window.AppNotification.show(text, 'info', options);
            return true;
        }
        return false;
    }

    function maybeShow() {
        if (hasShown()) return true;
        if (!document.getElementById('dashboard-layout')) return false;
        if (!canShowOnDashboard()) return false;

        if (!notify(message(), {
            duration: TOAST_DURATION_MS,
            actionLabel: actionLabel(),
            onAction: openInbox,
        })) {
            return false;
        }

        markShown();
        return true;
    }

    function scheduleShow(options = {}) {
        if (hasShown()) return;
        if (!document.getElementById('dashboard-layout')) return;

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

    window.InboxIntroToast = {
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
            return true;
        },
        /** Dev helper: clear seen-state and show the toast again. */
        replay(options = {}) {
            this.reset();
            this.scheduleShow({ delay: 0, resetAttempts: true, ...options });
            return true;
        },
    };
})();
