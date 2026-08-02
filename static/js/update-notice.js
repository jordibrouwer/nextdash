// GitHub release update notice — enabled by default via Config → Behavior → Privacy.
//
// Polls /api/update-status (server-side GitHub check), marks the ★ button when a
// newer release exists, and shows an in-app toast while the tab is visible and
// focused. No web push — updates are surfaced only during active use.
(function () {
    'use strict';

    const DISMISS_KEY = 'nextdash:dismissed-update-tag';
    const TOAST_SHOWN_KEY = 'nextdash:update-toast-shown-tag';

    /** @type {object|null|undefined} */
    let pendingUpdateToast = null;

    function isLocked() {
        return !!document.querySelector('meta[name="nextdash-update-check-locked"]');
    }

    function isEnabled() {
        if (isLocked()) return false;
        const val = window.dashboardInstance?.settings?.updateCheckEnabled;
        return val !== false;
    }

    function isAppActivelyUsed() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    window.nextdashUpdateCheckEnabled = isEnabled;

    function translate(key, fallback, vars) {
        const lang = window.dashboardInstance?.language;
        let text = fallback != null ? fallback : key;
        if (lang && typeof lang.t === 'function') {
            const translated = lang.t(key);
            if (translated && translated !== key) {
                text = translated;
            }
        }
        if (vars && typeof vars === 'object') {
            Object.keys(vars).forEach((name) => {
                text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(vars[name]));
            });
        }
        return text;
    }

    function isDismissed(status) {
        if (!status?.latest) return false;
        try {
            return localStorage.getItem(DISMISS_KEY) === status.latest;
        } catch {
            return false;
        }
    }

    function rememberPendingUpdate(status) {
        if (status?.updateAvailable && status.latest && !isDismissed(status)) {
            pendingUpdateToast = status;
            return;
        }
        pendingUpdateToast = null;
    }

    function showUpdateToast(status) {
        if (!status?.updateAvailable || !status.latest || isDismissed(status)) return;
        try {
            if (localStorage.getItem(TOAST_SHOWN_KEY) === status.latest) return;
        } catch { /* no-op */ }

        try { localStorage.setItem(TOAST_SHOWN_KEY, status.latest); } catch { /* no-op */ }

        const message = translate(
            'dashboard.updateAvailableToast',
            'nextDash {latest} is available on GitHub.',
            { latest: status.latest }
        );
        const actionLabel = translate('dashboard.updateAvailableToastAction', 'View release');
        const dash = window.dashboardInstance;
        if (!dash?.showNotification) return;

        dash.showNotification(message, 'update', {
            duration: 9000,
            actionLabel,
            onAction: () => {
                const url = status.releaseUrl || 'https://github.com/jordibrouwer/nextdash/releases/latest';
                window.open(url, '_blank', 'noopener,noreferrer');
            },
        });
        pendingUpdateToast = null;
    }

    function maybeShowUpdateToast(status) {
        if (!status?.updateAvailable || !status.latest || isDismissed(status)) {
            rememberPendingUpdate(null);
            return;
        }
        rememberPendingUpdate(status);
        if (!isAppActivelyUsed()) return;
        showUpdateToast(status);
    }

    function tryShowPendingUpdateToast() {
        if (!pendingUpdateToast || !isAppActivelyUsed()) return;
        showUpdateToast(pendingUpdateToast);
    }

    function applyBadge(status) {
        const btn = document.getElementById('whats-new-btn');
        if (!btn) return;
        btn.classList.remove('has-update-available');
        btn.removeAttribute('data-update-tag');
        if (!isEnabled()) return;
        if (!status?.updateAvailable || isDismissed(status)) return;
        btn.classList.add('has-update-available');
        if (status.latest) btn.setAttribute('data-update-tag', status.latest);
    }

    function clearUpdateCheckUi() {
        pendingUpdateToast = null;
        if (window.dashboardInstance) {
            window.dashboardInstance.updateStatus = null;
        }
        if (window.dashboardInstance?.config) {
            window.dashboardInstance.config._updateStatus = null;
        }
        applyBadge(null);
        window.nextdashTeardownWhatsNewUpdateCheck?.();
        window.dashboardInstance?.config?.repaintOverview?.();
        window.dispatchEvent(new CustomEvent('nextdash:update-status', { detail: null }));
    }

    function fetchStatus(refresh) {
        if (!isEnabled()) return Promise.resolve(null);
        const url = '/api/update-status' + (refresh ? '?refresh=1' : '');
        return fetch(url, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    /**
     * Human-readable status for overview panel and what's-new modal bar.
     * @returns {{ tone: 'neutral'|'ok'|'warn'|'error'|'loading', message: string, releaseUrl?: string }}
     */
    window.nextdashDescribeUpdateStatus = function nextdashDescribeUpdateStatus(status, checking) {
        if (!isEnabled()) {
            return {
                tone: 'neutral',
                message: translate('config.updateCheckDisabledHint', 'Turn on “Check GitHub for new releases” under Config → Behavior → Privacy.'),
            };
        }
        if (checking) {
            return {
                tone: 'loading',
                message: translate('config.updateCheckChecking', 'Checking GitHub…'),
            };
        }
        if (!status) {
            return {
                tone: 'neutral',
                message: translate('config.updateCheckIdleHint', 'Press Check for updates to compare your version with GitHub.'),
            };
        }
        if (status.error) {
            return {
                tone: 'error',
                message: translate('config.updateCheckFailed', 'Could not reach GitHub. Try again later.'),
            };
        }
        if (status.updateAvailable && status.latest && !isDismissed(status)) {
            return {
                tone: 'warn',
                message: translate('config.overviewUpdateAvailableBody', 'You are running {current}. {latest} is available on GitHub.', {
                    current: status.current || '—',
                    latest: status.latest,
                }),
                releaseUrl: status.releaseUrl || '',
            };
        }
        if (status.current) {
            return {
                tone: 'ok',
                message: translate('config.updateCheckUpToDate', 'You’re on the latest release ({current}).', {
                    current: status.current,
                }),
            };
        }
        return {
            tone: 'neutral',
            message: translate('config.updateCheckIdleHint', 'Press Check for updates to compare your version with GitHub.'),
        };
    };

    window.nextdashDismissUpdateNotice = function nextdashDismissUpdateNotice(tag) {
        if (!tag) return;
        try { localStorage.setItem(DISMISS_KEY, tag); } catch (_) { /* no-op */ }
        applyBadge(window.dashboardInstance?.updateStatus || null);
        rememberPendingUpdate(null);
        window.dashboardInstance?.config?.repaintOverview?.();
        window.nextdashSyncWhatsNewUpdateBar?.();
    };

    window.nextdashRefreshUpdateStatus = function nextdashRefreshUpdateStatus(refresh) {
        if (!isEnabled()) {
            clearUpdateCheckUi();
            return Promise.resolve(null);
        }
        return fetchStatus(refresh).then(function (status) {
            if (window.dashboardInstance) {
                window.dashboardInstance.updateStatus = status;
            }
            if (window.dashboardInstance?.config) {
                window.dashboardInstance.config._updateStatus = status;
            }
            applyBadge(status);
            window.dispatchEvent(new CustomEvent('nextdash:update-status', { detail: status }));
            window.nextdashSyncWhatsNewUpdateBar?.();
            window.dashboardInstance?.config?.repaintOverview?.();
            if (refresh) {
                maybeShowUpdateToast(status);
            } else {
                rememberPendingUpdate(status);
                tryShowPendingUpdateToast();
            }
            return status;
        });
    };

    window.nextdashRunUpdateCheck = function nextdashRunUpdateCheck() {
        window.dispatchEvent(new CustomEvent('nextdash:update-check-start'));
        return window.nextdashRefreshUpdateStatus(true).finally(function () {
            window.dispatchEvent(new CustomEvent('nextdash:update-check-end'));
        });
    };

    window.addEventListener('nextdash:update-status', function (e) {
        applyBadge(e.detail || null);
    });

    document.addEventListener('visibilitychange', tryShowPendingUpdateToast);
    window.addEventListener('focus', tryShowPendingUpdateToast);
})();
