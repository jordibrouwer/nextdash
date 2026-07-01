/**
 * Server-backed discoverability state (settings.discoverabilityState).
 * Replaces per-browser localStorage for promo/tour/what's-new progress.
 */
(function initDiscoverabilityState(global) {
    'use strict';

    const WHATS_NEW_LEGACY_KEY = 'nextdash:last-whats-new-dashboard-release';
    const TIPS_UNTIL_LEGACY_KEY = 'nextdash-tips-promo-until-v1';
    const TIPS_NOT_BEFORE_LEGACY_KEY = 'nextdash-tips-not-before-v1';

    /** @type {Record<string, string>} legacy localStorage key → canonical id */
    const LEGACY_KEY_TO_ID = {
        'nextdash:dashboard-search-promo-search-v2': 'search:search',
        'nextdash:dashboard-search-promo-command-v1': 'search:command',
        'nextdash:dashboard-search-promo-finder-v1': 'search:finder',
        'nextdash:dashboard-search-promo-filters-v1': 'search:filters',
        'nextdash:dashboard-g-jump-promo-confirmed-v1': 'promo:gJump',
        'nextdash:dashboard-grid-keyboard-promo-confirmed-v1': 'promo:gridKeyboard',
        'nextdash:dashboard-smart-collection-promo-confirmed-v1': 'promo:smartCollection',
        'nextdash:dashboard-inline-edit-promo-confirmed-v1': 'feature:inlineEdit',
        'nextdash:dashboard-tag-cloud-promo-confirmed-v1': 'feature:tagCloud',
        'nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1': 'feature:tagFilterBulk',
        'nextdash:dashboard-recent-bookmarks-promo-confirmed-v1': 'feature:recentBookmarks',
        'nextdash:dashboard-preview-card-promo-confirmed-v1': 'feature:previewCard',
        'nextdash:dashboard-quick-add-omnibox-promo-confirmed-v1': 'feature:quickAddOmnibox',
        'nextdash:dashboard-date-popover-promo-confirmed-v1': 'feature:datePopover',
        'nextdash:dashboard-weather-geolocation-promo-confirmed-v1': 'feature:weatherGeolocation',
        'nextdash:dashboard-category-collapse-promo-confirmed-v1': 'feature:categoryCollapse',
        'nextdash:dashboard-category-rename-promo-confirmed-v1': 'feature:categoryRename',
        'nextdash:dashboard-quick-move-promo-confirmed-v1': 'feature:quickMove',
        'nextdash:dashboard-quick-delete-promo-confirmed-v1': 'feature:quickDelete',
        'nextdash:dashboard-quick-tag-promo-confirmed-v1': 'feature:quickTag',
        'nextdash:dashboard-page-overview-promo-confirmed-v1': 'feature:pageOverview',
        'nextdash:dashboard-cheatsheet-promo-confirmed-v1': 'feature:cheatsheet',
        'nextdash:feature-spotlight-paste-v1': 'spotlight:paste',
        'nextdash:layout-modern-nudge-v1': 'spotlight:layoutNudge',
        'nextdash:feature-spotlight-preview-cards-v1': 'spotlight:previewCards',
    };

    const ID_TO_LEGACY_KEY = Object.fromEntries(
        Object.entries(LEGACY_KEY_TO_ID).map(([key, id]) => [id, key])
    );

    let state = {
        confirmed: {},
        lastWhatsNewRelease: '',
        tipsPromoUntil: 0,
        tipsNotBefore: 0,
    };
    let persistTimer = null;
    let migrateScheduled = false;

    function normalizeIncoming(raw) {
        if (!raw || typeof raw !== 'object') {
            return {
                confirmed: {},
                lastWhatsNewRelease: '',
                tipsPromoUntil: 0,
                tipsNotBefore: 0,
            };
        }
        const confirmed = {};
        if (raw.confirmed && typeof raw.confirmed === 'object') {
            Object.entries(raw.confirmed).forEach(([id, value]) => {
                if (value === true) {
                    confirmed[String(id)] = true;
                }
            });
        }
        return {
            confirmed,
            lastWhatsNewRelease: String(raw.lastWhatsNewRelease || '').trim(),
            tipsPromoUntil: Number(raw.tipsPromoUntil) || 0,
            tipsNotBefore: Number(raw.tipsNotBefore) || 0,
        };
    }

    function writeLegacyKey(legacyKey, seen) {
        if (!legacyKey) {
            return;
        }
        try {
            if (seen) {
                localStorage.setItem(legacyKey, '1');
            } else {
                localStorage.removeItem(legacyKey);
            }
        } catch {
            // Ignore storage errors.
        }
    }

    function syncLegacyKeysFromState() {
        Object.entries(state.confirmed).forEach(([id, seen]) => {
            if (seen === true) {
                writeLegacyKey(ID_TO_LEGACY_KEY[id], true);
            }
        });
        try {
            if (state.lastWhatsNewRelease) {
                localStorage.setItem(WHATS_NEW_LEGACY_KEY, state.lastWhatsNewRelease);
            }
            if (state.tipsPromoUntil > 0) {
                localStorage.setItem(TIPS_UNTIL_LEGACY_KEY, String(state.tipsPromoUntil));
            } else {
                localStorage.removeItem(TIPS_UNTIL_LEGACY_KEY);
            }
            if (state.tipsNotBefore > 0) {
                localStorage.setItem(TIPS_NOT_BEFORE_LEGACY_KEY, String(state.tipsNotBefore));
            } else {
                localStorage.removeItem(TIPS_NOT_BEFORE_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
    }

    function isConfirmed(id) {
        if (!id) {
            return false;
        }
        if (state.confirmed[id] === true) {
            return true;
        }
        const legacyKey = ID_TO_LEGACY_KEY[id];
        if (!legacyKey) {
            return false;
        }
        try {
            return localStorage.getItem(legacyKey) === '1';
        } catch {
            return false;
        }
    }

    function isStorageKeyConfirmed(legacyKey) {
        const id = LEGACY_KEY_TO_ID[legacyKey];
        if (id) {
            return isConfirmed(id);
        }
        try {
            return Boolean(localStorage.getItem(legacyKey));
        } catch {
            return false;
        }
    }

    function markConfirmed(id, options = {}) {
        if (!id) {
            return;
        }
        state.confirmed[id] = true;
        writeLegacyKey(ID_TO_LEGACY_KEY[id], true);
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function markStorageKeyConfirmed(legacyKey, options = {}) {
        const id = LEGACY_KEY_TO_ID[legacyKey];
        if (id) {
            markConfirmed(id, options);
            return;
        }
        try {
            localStorage.setItem(legacyKey, '1');
        } catch {
            // Ignore storage errors.
        }
    }

    function clearConfirmed(id, options = {}) {
        if (!id) {
            return;
        }
        delete state.confirmed[id];
        writeLegacyKey(ID_TO_LEGACY_KEY[id], false);
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function clearStorageKey(legacyKey, options = {}) {
        const id = LEGACY_KEY_TO_ID[legacyKey];
        if (id) {
            clearConfirmed(id, options);
            return;
        }
        try {
            localStorage.removeItem(legacyKey);
        } catch {
            // Ignore storage errors.
        }
    }

    function getLastWhatsNewRelease() {
        if (state.lastWhatsNewRelease) {
            return state.lastWhatsNewRelease;
        }
        try {
            return String(localStorage.getItem(WHATS_NEW_LEGACY_KEY) || '').trim();
        } catch {
            return '';
        }
    }

    function setLastWhatsNewRelease(releaseToken, options = {}) {
        state.lastWhatsNewRelease = String(releaseToken || '').trim();
        try {
            if (state.lastWhatsNewRelease) {
                localStorage.setItem(WHATS_NEW_LEGACY_KEY, state.lastWhatsNewRelease);
            } else {
                localStorage.removeItem(WHATS_NEW_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getTipsPromoUntil() {
        if (state.tipsPromoUntil > 0) {
            return state.tipsPromoUntil;
        }
        try {
            return Number(localStorage.getItem(TIPS_UNTIL_LEGACY_KEY) || 0);
        } catch {
            return 0;
        }
    }

    function setTipsPromoUntil(ts, options = {}) {
        state.tipsPromoUntil = Number(ts) > 0 ? Number(ts) : 0;
        try {
            if (state.tipsPromoUntil > 0) {
                localStorage.setItem(TIPS_UNTIL_LEGACY_KEY, String(state.tipsPromoUntil));
            } else {
                localStorage.removeItem(TIPS_UNTIL_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function getTipsNotBefore() {
        if (state.tipsNotBefore > 0) {
            return state.tipsNotBefore;
        }
        try {
            return Number(localStorage.getItem(TIPS_NOT_BEFORE_LEGACY_KEY) || 0);
        } catch {
            return 0;
        }
    }

    function setTipsNotBefore(ts, options = {}) {
        state.tipsNotBefore = Number(ts) > 0 ? Number(ts) : 0;
        try {
            if (state.tipsNotBefore > 0) {
                localStorage.setItem(TIPS_NOT_BEFORE_LEGACY_KEY, String(state.tipsNotBefore));
            } else {
                localStorage.removeItem(TIPS_NOT_BEFORE_LEGACY_KEY);
            }
        } catch {
            // Ignore storage errors.
        }
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    function exportState() {
        return {
            confirmed: { ...state.confirmed },
            lastWhatsNewRelease: state.lastWhatsNewRelease || undefined,
            tipsPromoUntil: state.tipsPromoUntil > 0 ? state.tipsPromoUntil : undefined,
            tipsNotBefore: state.tipsNotBefore > 0 ? state.tipsNotBefore : undefined,
        };
    }

    function applyToDashboardSettings() {
        const exported = exportState();
        if (global.dashboardInstance?.settings) {
            global.dashboardInstance.settings.discoverabilityState = exported;
        }
        if (global.configManager?.settingsData) {
            global.configManager.settingsData.discoverabilityState = exported;
        }
    }

    function migrateFromLocalStorageIfNeeded() {
        let dirty = false;

        Object.entries(LEGACY_KEY_TO_ID).forEach(([legacyKey, id]) => {
            if (state.confirmed[id] === true) {
                return;
            }
            try {
                if (localStorage.getItem(legacyKey) === '1') {
                    state.confirmed[id] = true;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        });

        if (!state.lastWhatsNewRelease) {
            try {
                const seen = String(localStorage.getItem(WHATS_NEW_LEGACY_KEY) || '').trim();
                if (seen) {
                    state.lastWhatsNewRelease = seen;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (!state.tipsPromoUntil) {
            try {
                const until = Number(localStorage.getItem(TIPS_UNTIL_LEGACY_KEY) || 0);
                if (until > 0) {
                    state.tipsPromoUntil = until;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (!state.tipsNotBefore) {
            try {
                const notBefore = Number(localStorage.getItem(TIPS_NOT_BEFORE_LEGACY_KEY) || 0);
                if (notBefore > 0) {
                    state.tipsNotBefore = notBefore;
                    dirty = true;
                }
            } catch {
                // Ignore storage errors.
            }
        }

        if (dirty) {
            applyToDashboardSettings();
            schedulePersist();
        } else {
            syncLegacyKeysFromState();
        }
    }

    function init(serverState) {
        state = normalizeIncoming(serverState);
        applyToDashboardSettings();
        syncLegacyKeysFromState();
        if (!migrateScheduled) {
            migrateScheduled = true;
            queueMicrotask(() => migrateFromLocalStorageIfNeeded());
        }
    }

    async function persistNow() {
        const payload = { discoverabilityState: exportState() };
        applyToDashboardSettings();

        const dash = global.dashboardInstance;
        if (dash && typeof dash.saveSettings === 'function') {
            await dash.saveSettings();
            return true;
        }

        const fetchFn = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : global.fetch;
        const response = await fetchFn('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return response.ok;
    }

    function schedulePersist() {
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
            persistTimer = null;
            void persistNow().catch(() => {
                // Non-blocking; user can save config manually.
            });
        }, 700);
    }

    function clearAllConfirmed(options = {}) {
        state.confirmed = {};
        Object.keys(LEGACY_KEY_TO_ID).forEach((legacyKey) => writeLegacyKey(legacyKey, false));
        applyToDashboardSettings();
        if (options.persist !== false) {
            schedulePersist();
        }
    }

    global.DiscoverabilityState = {
        init,
        exportState,
        isConfirmed,
        isStorageKeyConfirmed,
        markConfirmed,
        markStorageKeyConfirmed,
        clearConfirmed,
        clearStorageKey,
        clearAllConfirmed,
        getLastWhatsNewRelease,
        setLastWhatsNewRelease,
        getTipsPromoUntil,
        setTipsPromoUntil,
        getTipsNotBefore,
        setTipsNotBefore,
        schedulePersist,
        persistNow,
        LEGACY_KEY_TO_ID,
    };
}(typeof window !== 'undefined' ? window : globalThis));
