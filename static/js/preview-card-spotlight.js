/**
 * One-time spotlight to enable link preview cards (hover / [ on keyboard focus).
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'nextdash:feature-spotlight-preview-cards-v1';
    const SESSION_REPLAY_KEY = 'nextdash:preview-card-spotlight-replay-pending';

    const PREVIEW_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" ry="2"/>
        <rect x="6.5" y="8" width="7" height="4.5" rx="0.8"/>
        <line x1="6.5" y1="14.5" x2="17.5" y2="14.5"/>
        <line x1="6.5" y1="16.5" x2="14" y2="16.5"/>
    </svg>`;

    function isVisibleTourCard(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 8 && rect.height > 8;
    }

    function hasBlockingDiscoverabilityUi(dashboard) {
        if (document.querySelector('.feature-spotlight.show')) return true;
        if (dashboard?.searchComponent?.isActive?.()) return true;
        if (window.DashboardSearchPromo?.isPromoOpen?.()) return true;
        if (window.DashboardFeaturePromos?.isAnyOpen?.()) return true;
        if (window.DashboardGridKeyboardPromo?.isPromoOpen?.()) return true;
        if (window.DashboardSmartCollectionPromo?.isPromoOpen?.()) return true;
        if (document.querySelector('.onboarding-overlay, .feature-tour-overlay')) return true;
        return [...document.querySelectorAll('[class$="-tour-card"], .onboarding-card, .feature-tour-card')]
            .some(isVisibleTourCard);
    }

    function hasPendingPostOnboardingPrompts(dashboard) {
        if (!dashboard) return true;
        if (typeof dashboard.shouldShowWhatsNewPrompt === 'function' && dashboard.shouldShowWhatsNewPrompt()) {
            return true;
        }
        if (typeof dashboard.shouldShowLayoutNudgePrompt === 'function' && dashboard.shouldShowLayoutNudgePrompt()) {
            return true;
        }
        if (typeof dashboard.shouldShowPasteSpotlightPrompt === 'function' && dashboard.shouldShowPasteSpotlightPrompt()) {
            return true;
        }
        return false;
    }

    function enablePreviewCards(dashboard) {
        if (!dashboard?.settings) return;
        const commands = dashboard.searchComponent?.commandsComponent;
        if (commands && typeof commands.setPreviewCardsVisibility === 'function') {
            commands.setPreviewCardsVisibility(dashboard, true);
            return;
        }
        dashboard.settings.showLinkPreviewCards = true;
        if (typeof dashboard.setupDOM === 'function') {
            dashboard.setupDOM();
        }
        if (typeof dashboard.renderDashboard === 'function') {
            dashboard.renderDashboard();
        }
        if (typeof dashboard.saveSettings === 'function') {
            void dashboard.saveSettings();
        }
        if (typeof dashboard.showNotification === 'function') {
            dashboard.showNotification('Preview cards on.', 'success');
        }
    }

    function shouldOffer(dashboard) {
        if (!dashboard) return false;
        if (dashboard.onboardingStartedInSession) return false;
        if (dashboard.settings?.onboardingCompleted !== true) return false;
        if (dashboard.settings?.showLinkPreviewCards === true) return false;
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        try {
            if (localStorage.getItem(STORAGE_KEY)) return false;
        } catch { /* ignore */ }
        return true;
    }

    function canShowNow(dashboard) {
        if (!shouldOffer(dashboard)) return false;
        if (typeof dashboard.canShowPostOnboardingPrompts === 'function' && !dashboard.canShowPostOnboardingPrompts()) {
            return false;
        }
        if (hasPendingPostOnboardingPrompts(dashboard)) return false;
        if (hasBlockingDiscoverabilityUi(dashboard)) return false;
        return true;
    }

    function create(dashboard, options = {}) {
        if (typeof window.FeatureSpotlight !== 'function') return null;
        return new window.FeatureSpotlight({
            language: dashboard.language,
            dashboard,
            storageKey: STORAGE_KEY,
            titleKey: 'featureSpotlightPreviewCardsTitle',
            bodyKey: 'featureSpotlightPreviewCardsBody',
            tryKey: 'featureSpotlightPreviewCardsTry',
            closeKey: 'featureSpotlightPreviewCardsClose',
            titleFallback: 'Preview bookmarks at a glance',
            bodyFallback: 'Enable rich preview cards on hover or with <kbd>[</kbd> on a selected bookmark — title, description, image, tags, and usage stats.',
            tryFallback: 'Enable',
            closeFallback: 'Never mind',
            iconSvg: PREVIEW_ICON_SVG,
            onTry: () => enablePreviewCards(dashboard),
            onDismiss: typeof options.onDismiss === 'function' ? options.onDismiss : null,
        });
    }

    const api = {
        STORAGE_KEY,
        SESSION_REPLAY_KEY,
        shouldOffer,
        canShowNow,
        create,
        enablePreviewCards,
        reset() {
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

    window.PreviewCardSpotlight = api;
})();
