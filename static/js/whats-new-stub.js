/**
 * Lightweight What's new bootstrap — token, search promo, dynamic loader.
 * Heavy modal logic lives in whats-new-modal.js (loaded on first open).
 *
 * Cache-bust tokens: keep NEXTDASH_WHATS_NEW_DATA_VERSION in sync with asset_versions.go (WhatsNewData).
 */
(function () {
    'use strict';

    const DASHBOARD_RELEASE = '2026.07-dashboard-release-v126';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const SEARCH_PROMO_START_KEY = 'nextdash:whats-new-search-promo-start';
    const SEARCH_PROMO_RELEASE_KEY = 'nextdash:whats-new-search-promo-release';
    const SEARCH_PROMO_MS = 7 * 24 * 60 * 60 * 1000;
    const MODAL_SCRIPT_URL = '/static/js/whats-new-modal.js?v=whats-new-25-visible-1';

    window.NEXTDASH_WHATS_NEW_RELEASE = DASHBOARD_RELEASE;
    window.NEXTDASH_WHATS_NEW_DATA_VERSION = 'whats-new-v168';

    let loadPromise = null;

    function isReleaseUnread() {
        try {
            return localStorage.getItem(STORAGE_KEY) !== DASHBOARD_RELEASE;
        } catch {
            return false;
        }
    }

    function getSearchPromoStart() {
        try {
            const storedRelease = localStorage.getItem(SEARCH_PROMO_RELEASE_KEY);
            if (storedRelease === DASHBOARD_RELEASE) {
                const start = Number(localStorage.getItem(SEARCH_PROMO_START_KEY) || 0);
                if (start > 0) return start;
            }
            const now = Date.now();
            localStorage.setItem(SEARCH_PROMO_START_KEY, String(now));
            localStorage.setItem(SEARCH_PROMO_RELEASE_KEY, DASHBOARD_RELEASE);
            return now;
        } catch {
            return Date.now();
        }
    }

    window.shouldShowWhatsNewInSearch = function shouldShowWhatsNewInSearch() {
        if (window.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (!isReleaseUnread()) return false;
        return Date.now() - getSearchPromoStart() < SEARCH_PROMO_MS;
    };

    window.ensureWhatsNewLoaded = function ensureWhatsNewLoaded() {
        if (window.__whatsNewModalReady && typeof window.__whatsNewOpen === 'function') {
            return Promise.resolve();
        }
        if (loadPromise) {
            return loadPromise;
        }
        loadPromise = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-whats-new-modal]');
            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => {
                    loadPromise = null;
                    reject(new Error('whats-new-modal failed to load'));
                }, { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = MODAL_SCRIPT_URL;
            script.async = true;
            script.dataset.whatsNewModal = 'true';
            script.onload = () => resolve();
            script.onerror = () => {
                loadPromise = null;
                reject(new Error('whats-new-modal failed to load'));
            };
            document.head.appendChild(script);
        });
        return loadPromise;
    };

    window.openWhatsNewModal = function openWhatsNewModal(options) {
        return window.ensureWhatsNewLoaded()
            .then(() => {
                if (typeof window.__whatsNewOpen !== 'function') {
                    throw new Error('whats-new-modal did not register');
                }
                return window.__whatsNewOpen(options || {});
            })
            .catch((error) => {
                const onAbort = options && typeof options.onAbort === 'function' ? options.onAbort : null;
                onAbort?.();
                console.error(error);
            });
    };
})();
