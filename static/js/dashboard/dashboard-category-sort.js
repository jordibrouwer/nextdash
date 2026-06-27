/**
 * Per-category bookmark sort modes (order / az / recent).
 */
(function () {
    const VALID_MODES = new Set(['order', 'az', 'recent']);

    function normalizeSortMode(mode) {
        const value = String(mode || 'order').toLowerCase();
        if (value === 'custom') {
            return 'order';
        }
        return VALID_MODES.has(value) ? value : 'order';
    }

    function isPersistedCategory(dash, categoryId) {
        const id = String(categoryId ?? '');
        return (dash.categories || []).some((cat) => String(cat.id) === id);
    }

    function getCategorySortMode(dash, category) {
        if (!dash || !category || category.isSmartCollection === true || category.tagFilterChunk === true) {
            return 'order';
        }
        const id = String(category.id ?? '');
        if (isPersistedCategory(dash, id)) {
            const match = (dash.categories || []).find((cat) => String(cat.id) === id);
            return normalizeSortMode(match?.sortMode || 'order');
        }
        const pageKey = String(dash.currentPageId);
        const fromMap = dash.settings?.categorySortModes?.[pageKey]?.[id];
        return normalizeSortMode(fromMap || 'order');
    }

    function ensurePageSortMap(dash, pageId) {
        if (!dash.settings.categorySortModes) {
            dash.settings.categorySortModes = {};
        }
        const pageKey = String(pageId);
        if (!dash.settings.categorySortModes[pageKey]) {
            dash.settings.categorySortModes[pageKey] = {};
        }
        return dash.settings.categorySortModes[pageKey];
    }

    function setCategorySortMode(dash, categoryId, mode, options = {}) {
        const normalized = normalizeSortMode(mode);
        const id = String(categoryId ?? '');
        const current = getCategorySortMode(dash, { id });
        const next = options.toggle && current === normalized ? 'order' : normalized;

        if (isPersistedCategory(dash, id)) {
            const cat = (dash.categories || []).find((entry) => String(entry.id) === id);
            if (cat) {
                cat.sortMode = next;
            }
            dash.renderCore?.scheduleCategoryOrderSave?.();
            return next;
        }

        const pageMap = ensurePageSortMap(dash, dash.currentPageId);
        pageMap[id] = next;
        dash.saveSettings?.();
        return next;
    }

    function resolveFocusedCategoryId(dash) {
        const kn = dash?.keyboardNavigation;
        if (kn && Number.isFinite(kn.currentIndex) && kn.currentIndex >= 0) {
            const el = kn.navigableElements?.[kn.currentIndex];
            const fromNav = el?.closest?.('.category[data-category-id]:not([data-smart-collection="true"])');
            if (fromNav) {
                return fromNav.getAttribute('data-category-id') || '';
            }
        }

        const active = document.activeElement;
        const fromActive = active?.closest?.('.category[data-category-id]:not([data-smart-collection="true"])');
        if (fromActive) {
            return fromActive.getAttribute('data-category-id') || '';
        }

        const first = document.querySelector('.category[data-category-id]:not([data-smart-collection="true"])');
        return first?.getAttribute('data-category-id') || '';
    }

    function migrateLegacySortForPage(dash, pageId) {
        if (!dash?.settings || dash.settings.categorySortModesMigrated) {
            return;
        }

        const legacy = normalizeSortMode(dash.settings.sortMethod || 'order');
        let categoriesChanged = false;

        (dash.categories || []).forEach((cat) => {
            if (!cat.sortMode) {
                cat.sortMode = legacy;
                categoriesChanged = true;
            }
        });

        if (!Array.isArray(dash.settings._sortMigratedPageIds)) {
            dash.settings._sortMigratedPageIds = [];
        }
        const pid = Number(pageId);
        if (!dash.settings._sortMigratedPageIds.includes(pid)) {
            dash.settings._sortMigratedPageIds.push(pid);
        }

        if (categoriesChanged) {
            dash.renderCore?.saveCategoryOrder?.({
                pageId: pid,
                payload: (dash.categories || []).map((cat) => ({ ...cat })),
            });
        }

        const allPagesMigrated = (dash.pages || []).every((page) => (
            dash.settings._sortMigratedPageIds.includes(Number(page.id))
        ));
        if (allPagesMigrated) {
            delete dash.settings.sortMethod;
            dash.settings.categorySortModesMigrated = true;
            delete dash.settings._sortMigratedPageIds;
            dash.saveSettings?.();
        }
    }

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function createSortControls(dash, category, renderCore) {
        const sortMode = getCategorySortMode(dash, category);
        const controls = document.createElement('span');
        controls.className = 'category-sort-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute(
            'aria-label',
            label(dash, 'dashboard.categorySortGroupAria', 'Bookmark sort')
        );

        const modes = [
            { mode: 'az', short: 'A–Z', aria: 'dashboard.categorySortAZAria' },
            {
                mode: 'recent',
                short: label(dash, 'dashboard.categorySortRecentShort', 'Rec'),
                aria: 'dashboard.categorySortRecentAria',
            },
        ];

        modes.forEach(({ mode, short, aria }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'category-sort-btn';
            btn.textContent = short;
            btn.setAttribute('data-sort-mode', mode);
            btn.setAttribute('aria-pressed', sortMode === mode ? 'true' : 'false');
            if (sortMode === mode) {
                btn.classList.add('is-active');
            }
            btn.setAttribute(
                'aria-label',
                label(dash, aria, mode === 'az' ? 'Sort A to Z' : 'Sort by recently used')
            );
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                setCategorySortMode(dash, category.id || '', mode, { toggle: true });
                renderCore?.renderDashboard?.({ animate: false });
            });
            controls.appendChild(btn);
        });

        return controls;
    }

    function updateCategorySortUi(dash, categoryEl, category) {
        if (!categoryEl || !category || category.isSmartCollection === true || category.tagFilterChunk === true) {
            return;
        }
        const sortMode = getCategorySortMode(dash, category);
        const list = categoryEl.querySelector('.bookmarks-list[data-category-id]');
        if (list) {
            list.classList.toggle('bookmarks-list--sort-active', sortMode !== 'order');
        }
        categoryEl.querySelectorAll('.category-sort-btn[data-sort-mode]').forEach((btn) => {
            const mode = btn.getAttribute('data-sort-mode');
            const active = mode === sortMode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    window.DashboardCategorySort = {
        normalizeSortMode,
        getCategorySortMode,
        setCategorySortMode,
        resolveFocusedCategoryId,
        migrateLegacySortForPage,
        createSortControls,
        updateCategorySortUi,
    };
})();
