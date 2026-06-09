/**
 * One-time spotlight for classic-layout users to try modern or glass (same discoverability path as onboarding and :layoutversion).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:layout-modern-nudge-v1';

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
            secondaryTryKey: 'layoutModernNudgeTryGlass',
            closeKey: 'layoutModernNudgeClose',
            titleFallback: 'Try modern or glass',
            bodyFallback: 'Classic, modern, or glass — same structure, different polish. Try a version below, use <code>:layoutversion toggle</code> on the dashboard, or switch anytime in <a class="button-hint-link" href="/config#general/layout">config → General → Layout</a>.',
            tryFallback: 'Try modern',
            secondaryTryFallback: 'Try glass',
            closeFallback: 'Keep classic',
            iconSvg: LAYOUT_ICON_SVG,
            onTry: () => applyLayoutVersion(dashboard, 'modern'),
            onSecondaryTry: () => applyLayoutVersion(dashboard, 'glass'),
            queueMeta: options.queueMeta ?? null,
            onQueueDefer: options.onQueueDefer ?? null,
        });
    }

    const api = {
        STORAGE_KEY,
        shouldOffer,
        create,
        reset() {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch { /* ignore */ }
        },
    };

    window.LayoutVersionNudge = api;
    window.LayoutModernNudge = api;
})();
