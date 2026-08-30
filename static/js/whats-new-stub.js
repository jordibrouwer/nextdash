/**
 * Lightweight What's new bootstrap — token, search promo, dynamic loader.
 * Heavy modal logic lives in whats-new-modal.js (loaded on first open).
 *
 * Lazily-loaded scripts get their cache-bust token from window.NEXTDASH_ASSETS,
 * which the server fills with content hashes. Never hand-write a ?v= here: a
 * stale token serves an old file for up to a year (see asset_hash.go).
 */
(function () {
    'use strict';

    /*
     * The two tokens do different jobs, and both move for v1.4.2.4.
     *
     * DASHBOARD_RELEASE is the one that reopens this window: an install whose
     * stored value differs sees the notes once on its next visit.
     *
     * v1.4.2.1, v1.4.2.2, v1.4.2.3 and v1.2.1 were each recorded with
     * `hideFromModal` while they shipped — a round of additions to one tile
     * should not reopen the notes in front of readers who had just been shown a
     * large release. Four of them accumulated, which is more than "one small
     * round": between them they hold the guided-tour replay, every theme's
     * backdrop, and the work in v1.4.2.4 itself. The flag is gone from all of
     * them, so the modal now shows what the changelog has said all along.
     *
     * NEXTDASH_WHATS_NEW_DATA_VERSION below is the `?v=` on every what's-new
     * file, and always has to move: without it a browser that already read the
     * index keeps its copy and never learns v1.4.2.4 exists at all.
     */
    const DASHBOARD_RELEASE = '2026.08-dashboard-release-v1.4.3';
    const STORAGE_KEY = 'nextdash:last-whats-new-dashboard-release';
    const SEARCH_PROMO_START_KEY = 'nextdash:whats-new-search-promo-start';
    const SEARCH_PROMO_RELEASE_KEY = 'nextdash:whats-new-search-promo-release';
    const SEARCH_PROMO_MS = 7 * 24 * 60 * 60 * 1000;
    const MODAL_SCRIPT_URL = (window.NEXTDASH_ASSETS && window.NEXTDASH_ASSETS['js/whats-new-modal.js'])
        || '/static/js/whats-new-modal.js';

    window.NEXTDASH_WHATS_NEW_RELEASE = DASHBOARD_RELEASE;
    window.NEXTDASH_WHATS_NEW_DATA_VERSION = 'whats-new-v266';

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
                // A script that already finished will never fire `load` again, so
                // waiting on the event would hang forever. Its own registration
                // is the reliable signal that it is ready.
                if (typeof window.__whatsNewOpen === 'function') {
                    resolve();
                    return;
                }
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
