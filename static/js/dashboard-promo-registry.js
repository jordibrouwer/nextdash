/**
 * Central registry for dashboard discoverability promos.
 * Priority: lower number = shown earlier when replaying from Tours.
 * Module clearPromoSeen() is preferred; storageKey is a config-page fallback.
 */
(function initDashboardPromoRegistry(global) {
    const DISCOVERABILITY_PROMOS_PAUSED = false;

    /** Never auto-show these (Ctrl+V paste, preview cards, classic/modern/glass nudge). */
    const AUTO_PROMO_DISABLED = new Set([
        'pasteSpotlight',
        'layoutVersionNudge',
        'previewCardSpotlight',
        'previewCard',
    ]);

    function areDiscoverabilityPromosPaused() {
        return DISCOVERABILITY_PROMOS_PAUSED === true;
    }

    function isAutoPromoDisabled(id) {
        return AUTO_PROMO_DISABLED.has(id);
    }

    function dismissAllDiscoverabilityOverlays() {
        global.DashboardFeaturePromos?.dismissOpen?.();
        global.DashboardGridKeyboardPromo?.dismissPopover?.();
        global.DashboardSearchPromo?.dismissPopover?.();
        global.DashboardGJumpPromo?.dismissPopover?.();
        global.DashboardSmartCollectionPromo?.dismissPopover?.();
        document.querySelectorAll('.feature-spotlight').forEach((el) => {
            el.classList.remove('show');
            el.remove();
        });
        document.querySelectorAll('.dashboard-feature-promo, .dashboard-grid-kbd-promo, .dashboard-search-promo').forEach((el) => {
            el.remove();
        });
    }

    const ENTRIES = [
        { id: 'search', priority: 10, storageKeys: [
            'nextdash:dashboard-search-promo-search-v2',
            'nextdash:dashboard-search-promo-command-v1',
            'nextdash:dashboard-search-promo-finder-v1',
            'nextdash:dashboard-search-promo-filters-v1',
        ], clear: () => global.DashboardSearchPromo?.clearPromoSeen?.() },
        { id: 'gJump', priority: 20, storageKeys: ['nextdash:dashboard-g-jump-promo-confirmed-v1'], clear: () => global.DashboardGJumpPromo?.clearPromoSeen?.() },
        { id: 'gridKeyboard', priority: 25, storageKeys: ['nextdash:dashboard-grid-keyboard-promo-confirmed-v1'], clear: () => global.DashboardGridKeyboardPromo?.clearPromoSeen?.() },
        { id: 'smartCollection', priority: 30, storageKeys: ['nextdash:dashboard-smart-collection-promo-confirmed-v1'], clear: () => global.DashboardSmartCollectionPromo?.clearPromoSeen?.() },
        { id: 'feature', priority: 40, storageKeys: [
            'nextdash:dashboard-inline-edit-promo-confirmed-v1',
            'nextdash:dashboard-tag-cloud-promo-confirmed-v1',
            'nextdash:dashboard-tag-filter-bulk-promo-confirmed-v1',
            'nextdash:dashboard-recent-bookmarks-promo-confirmed-v1',
            'nextdash:dashboard-preview-card-promo-confirmed-v1',
            'nextdash:dashboard-quick-add-omnibox-promo-confirmed-v1',
            'nextdash:dashboard-date-popover-promo-confirmed-v1',
            'nextdash:dashboard-weather-geolocation-promo-confirmed-v1',
            'nextdash:dashboard-category-collapse-promo-confirmed-v1',
            'nextdash:dashboard-category-rename-promo-confirmed-v1',
            'nextdash:dashboard-quick-move-promo-confirmed-v1',
            'nextdash:dashboard-quick-delete-promo-confirmed-v1',
            'nextdash:dashboard-page-overview-promo-confirmed-v1',
            'nextdash:dashboard-cheatsheet-promo-confirmed-v1',
        ], clear: () => global.DashboardFeaturePromos?.clearPromoSeen?.() },
    ];

    function removeStorageKeys(keys) {
        (keys || []).forEach((key) => {
            try {
                localStorage.removeItem(key);
            } catch {
                // Ignore storage errors.
            }
        });
    }

    function clearEntry(entry) {
        entry.clear?.();
        removeStorageKeys(entry.storageKeys);
    }

    function clearAll({ replay = false } = {}) {
        [...ENTRIES].sort((a, b) => a.priority - b.priority).forEach(clearEntry);
        if (replay && global.dashboardInstance) {
            global.DashboardFeaturePromos?.tryShowDeferred?.();
        }
        return ENTRIES.length;
    }

    function clearById(id) {
        const entry = ENTRIES.find((item) => item.id === id);
        if (!entry) return false;
        clearEntry(entry);
        return true;
    }

    global.DashboardPromoRegistry = {
        entries: ENTRIES,
        areDiscoverabilityPromosPaused,
        isPaused: areDiscoverabilityPromosPaused,
        isAutoPromoDisabled,
        dismissAllDiscoverabilityOverlays,
        clearAll,
        clearById,
        listIds() {
            return ENTRIES.map((entry) => entry.id);
        },
    };
}(window));
