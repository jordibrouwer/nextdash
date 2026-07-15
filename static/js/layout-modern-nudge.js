/**
 * One-time spotlight for classic-layout users to try modern (onboarding and :layoutversion).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:layout-modern-nudge-v1';
    const SESSION_REPLAY_KEY = 'nextdash:layout-nudge-replay-pending';
    const LEGACY_DEFER_KEY = 'nextdash:discoverability-deferred';

    const LAYOUT_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="3" width="8" height="8" rx="1.5"/>
        <rect x="13" y="3" width="8" height="5" rx="1.5"/>
        <rect x="13" y="10" width="8" height="11" rx="1.5"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5"/>
    </svg>`;

    function applyLayoutVersion(dashboard, version) {
        if (!window.LayoutVersionUtils || !dashboard?.settings) return;
        window.LayoutVersionUtils.applyLayoutVersion(dashboard.settings, version, {
            syncDashboard: true,
            saveDashboard: true,
        });
    }

    function shouldOffer(dashboard) {
        if (!dashboard) return false;
        if (dashboard.onboardingStartedInSession) return false;
        if (dashboard.settings?.onboardingCompleted !== true) return false;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        const version = window.LayoutVersionUtils
            ? window.LayoutVersionUtils.normalizeLayoutVersion(dashboard.settings?.layoutVersion)
            : 'classic';
        if (version !== 'classic') return false;
        try {
            if (window.DiscoverabilityState?.isStorageKeyConfirmed?.(STORAGE_KEY)) return false;
            if (localStorage.getItem(STORAGE_KEY)) return false;
        } catch { /* ignore */ }
        return true;
    }

    function create(dashboard, options = {}) {
        if (typeof window.FeatureSpotlight !== 'function') return null;
        return new window.FeatureSpotlight({
            language: dashboard.language,
            dashboard,
            storageKey: STORAGE_KEY,
            titleKey: 'layoutModernNudgeTitle',
            bodyKey: 'layoutModernNudgeBody',
            tryKey: 'layoutModernNudgeTry',
            closeKey: 'layoutModernNudgeClose',
            titleFallback: 'Try modern',
            bodyFallback: 'Classic and modern — same structure, different polish. Try modern below, use <code>:layoutversion toggle</code> on the dashboard, or switch anytime in <a class="button-hint-link" href="/config#general/layout">config → General → Layout</a>.',
            tryFallback: 'Try modern',
            closeFallback: 'Keep classic',
            iconSvg: LAYOUT_ICON_SVG,
            onTry: () => applyLayoutVersion(dashboard, 'modern'),
        });
    }

    function clearLegacySessionKeys() {
        try {
            sessionStorage.removeItem(LEGACY_DEFER_KEY);
        } catch { /* ignore */ }
    }

    const api = {
        STORAGE_KEY,
        SESSION_REPLAY_KEY,
        shouldOffer,
        create,
        clearLegacySessionKeys,
        reset() {
            window.DiscoverabilityState?.clearStorageKey?.(STORAGE_KEY);
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch { /* ignore */ }
        },
        queueReplay() {
            api.reset();
            try {
                sessionStorage.setItem(SESSION_REPLAY_KEY, '1');
            } catch { /* ignore */ }
        },
        consumeReplayPending() {
            try {
                const pending = sessionStorage.getItem(SESSION_REPLAY_KEY) === '1';
                sessionStorage.removeItem(SESSION_REPLAY_KEY);
                return pending;
            } catch {
                return false;
            }
        },
    };

    clearLegacySessionKeys();

    window.LayoutVersionNudge = api;
    window.LayoutModernNudge = api;
})();
