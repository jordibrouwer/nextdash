// GitHub release update notice — enabled by default via Config → Behavior → Privacy.
//
// Polls /api/update-status (server-side GitHub check), marks the ★ button when a
// newer release exists, and puts a red row in the notifications bell (which
// shakes and rings). No toast and no web push: the bell is where it waits.
(function () {
    'use strict';

    const DISMISS_KEY = 'nextdash:dismissed-update-tag';

    function isLocked() {
        return !!document.querySelector('meta[name="nextdash-update-check-locked"]');
    }

    function isEnabled() {
        if (isLocked()) return false;
        const val = window.dashboardInstance?.settings?.updateCheckEnabled;
        return val !== false;
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

    /*
     * The bell row for a newer release. It reports the same status the ★
     * acts on, so a dismissed release or a switched-off check takes
     * the row away too. The release tag is the row's id: "No" holds until a
     * newer release than the one answered shows up.
     */
    let bellStatus = null;
    let bellHandle = null;

    function bellState() {
        const status = bellStatus;
        if (!isEnabled() || !status?.updateAvailable || !status.latest || isDismissed(status)) return null;
        return {
            count: 1,
            ids: [status.latest],
            text: translate('dashboard.updateAvailableToast', 'nextDash {latest} is available on GitHub.', { latest: status.latest }),
        };
    }

    function registerWithBell() {
        if (bellHandle || !window.NotificationBell) return;
        bellHandle = window.NotificationBell.register({
            id: 'update-notice',
            group: 'system',
            kind: 'urgent',
            icon: '\u2B06\uFE0F',
            no: 'state',
            state: bellState,
            actions: [
                {
                    name: 'release',
                    label: () => translate('dashboard.updateAvailableToastAction', 'View release'),
                    primary: true,
                    onClick: () => {
                        const url = bellStatus?.releaseUrl || 'https://github.com/jordibrouwer/nextdash/releases/latest';
                        window.open(url, '_blank', 'noopener,noreferrer');
                    },
                },
                {
                    name: 'whats-new',
                    label: () => translate('dashboard.whatsNewAria', "What's new"),
                    onClick: () => { window.openWhatsNewModal?.({ force: true }); },
                },
            ],
        });
        void bellHandle.refresh();
    }

    // This script loads before the bell's (which is deferred), so the row is
    // registered once the document has run its deferred scripts.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', registerWithBell, { once: true });
    } else {
        registerWithBell();
    }

    function applyBadge(status) {
        // Every path that changes what the ★ shows passes through here, so the
        // bell follows it from here too.
        bellStatus = status || null;
        void bellHandle?.refresh();
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
        return (window.nextDashFetchShared || fetch)(url, { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    /**
     * Why the check failed, from the server's errorCode. Most failures were
     * GitHub's hourly limit for the address, which "try again later" does not
     * explain: say when the next try goes out, and that a GitHub token lifts
     * the limit when none is set.
     */
    function describeUpdateCheckError(status) {
        const at = Number(status.retryAt) > 0
            ? new Date(Number(status.retryAt)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
        switch (status.errorCode) {
            case 'rate-limited': {
                const base = at
                    ? translate('config.updateCheckRateLimitedAt', 'GitHub’s hourly request limit for this address is used up. nextDash asks again at {time}.', { time: at })
                    : translate('config.updateCheckRateLimited', 'GitHub’s hourly request limit for this address is used up. nextDash asks again later.');
                return status.authenticated
                    ? base
                    : `${base} ${translate('config.updateCheckTokenHint', 'A GitHub token under Config → Containers raises the limit.')}`;
            }
            case 'local-limit':
                return translate('config.updateCheckLocalLimit', 'nextDash paused its outgoing requests for a moment. It asks GitHub again within a minute.');
            case 'unreachable':
                return translate('config.updateCheckUnreachable', 'Could not reach GitHub. Check that the server can reach api.github.com.');
            default:
                return status.error
                    ? translate('config.updateCheckFailedWith', 'GitHub did not answer as expected ({error}). Try again later.', { error: status.error })
                    : translate('config.updateCheckFailed', 'Could not reach GitHub. Try again later.');
        }
    }

    /**
     * Human-readable status for overview panel and what's-new modal bar.
     * @returns {{ tone: 'neutral'|'ok'|'warn'|'error'|'loading', message: string, releaseUrl?: string }}
     */
    window.nextdashDescribeUpdateStatus = function nextdashDescribeUpdateStatus(status, checking) {
        if (!isEnabled()) {
            return {
                tone: 'neutral',
                message: translate('config.updateCheckDisabledHint', 'Turn on “Check GitHub for new releases” under Config → Behavior → Privacy & sync.'),
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
                message: describeUpdateCheckError(status),
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
})();
