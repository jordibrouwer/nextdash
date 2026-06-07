/**
 * One-time spotlight prompting classic-layout users to try the modern layout.
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

    function create(dashboard) {
        if (typeof window.FeatureSpotlight !== 'function') return null;
        return new window.FeatureSpotlight({
            language: dashboard.language,
            dashboard,
            storageKey: STORAGE_KEY,
            titleKey: 'layoutModernNudgeTitle',
            bodyKey: 'layoutModernNudgeBody',
            tryKey: 'layoutModernNudgeTry',
            closeKey: 'layoutModernNudgeClose',
            titleFallback: 'Try the modern layout',
            bodyFallback: 'A refreshed look with the same structure — switch anytime in <a class="button-hint-link" href="/config#general/layout">config → General → Layout</a>.',
            tryFallback: 'Try modern',
            closeFallback: 'Keep classic',
            iconSvg: LAYOUT_ICON_SVG,
            onTry: () => {
                if (!window.LayoutVersionUtils) return;
                window.LayoutVersionUtils.applyLayoutVersion(dashboard.settings, 'modern', {
                    syncDashboard: true,
                    saveDashboard: true,
                });
            },
        });
    }

    window.LayoutModernNudge = {
        STORAGE_KEY,
        shouldOffer,
        create,
        reset() {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch { /* ignore */ }
        },
    };
})();
