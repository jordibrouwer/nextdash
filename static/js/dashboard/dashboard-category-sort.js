/**
 * Per-category bookmark sort modes (order / az / recent).
 */
(function () {
    const VALID_MODES = new Set(['order', 'az', 'recent']);

    function normalizeSortMode(mode) {
        const value = String(mode || 'order').toLowerCase();
        if (value === 'custom' || value === 'manual') {
            return 'order';
        }
        if (value === 'a-z' || value === 'alphabetical' || value === 'name') {
            return 'az';
        }
        if (value === 'recently' || value === 'recently-used' || value === 'rec') {
            return 'recent';
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
        if (category.sortMode != null && String(category.sortMode).trim() !== '') {
            return normalizeSortMode(category.sortMode);
        }
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

    function migrateLegacySortAllPages(dash) {
        if (!dash?.settings || dash.settings.categorySortModesMigrated) {
            return Promise.resolve();
        }
        if (migrateLegacySortAllPages._inFlight) {
            return migrateLegacySortAllPages._inFlight;
        }

        const fetchFn = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const legacy = normalizeSortMode(dash.settings.sortMethod || 'order');
        const pages = Array.isArray(dash.pages) ? dash.pages : [];

        migrateLegacySortAllPages._inFlight = (async () => {
            for (const page of pages) {
                const pageId = Number(page.id);
                if (!Number.isFinite(pageId)) {
                    continue;
                }
                try {
                    const res = await fetchFn(`/api/categories?page=${pageId}`);
                    if (!res.ok) {
                        continue;
                    }
                    const categories = await res.json();
                    let changed = false;
                    const updated = (categories || []).map((cat) => {
                        if (!cat.sortMode) {
                            changed = true;
                            return { ...cat, sortMode: legacy };
                        }
                        return cat;
                    });
                    if (!changed) {
                        continue;
                    }
                    const payload = updated.map((cat) => ({ ...cat, originalId: cat.id }));
                    const saveRes = await fetchFn(`/api/categories?page=${pageId}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    if (!saveRes.ok) {
                        continue;
                    }
                    dash.data?.updatePageDataCache?.(pageId, { categories: updated });
                    if (Number(dash.currentPageId) === pageId) {
                        dash.categories = dash.data?.clonePageCategories?.(updated) ?? updated;
                    }
                } catch {
                    // Best-effort per page; continue with remaining pages.
                }
            }

            delete dash.settings.sortMethod;
            delete dash.settings._sortMigratedPageIds;
            dash.settings.categorySortModesMigrated = true;
            await dash.saveSettings?.();
        })();

        return migrateLegacySortAllPages._inFlight.finally(() => {
            migrateLegacySortAllPages._inFlight = null;
        });
    }

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    function resolveCategoryDisplayName(dash, categoryId) {
        const id = String(categoryId ?? '');
        const fromDom = document.querySelector(
            `.category[data-category-id="${CSS.escape(id)}"]:not([data-smart-collection="true"]) .category-title-name`
        );
        if (fromDom) {
            const labelText = fromDom.title || fromDom.textContent;
            if (labelText) {
                return String(labelText).trim();
            }
        }

        const persisted = (dash?.categories || []).find((cat) => String(cat.id) === id);
        if (persisted?.name) {
            return persisted.name;
        }

        if (id === '') {
            const raw = dash?.language?.t?.('dashboard.uncategorized');
            return raw && raw !== 'dashboard.uncategorized' ? raw : 'Uncategorized';
        }

        const orphanBase = dash?.language?.t?.('dashboard.unknownCategory');
        const base = orphanBase && orphanBase !== 'dashboard.unknownCategory'
            ? orphanBase
            : 'Unknown category';
        return `${base} (${id})`;
    }

    function sortGroupAriaLabel(dash, category) {
        const categoryName = String(category?.name || resolveCategoryDisplayName(dash, category?.id ?? '')).trim();
        const groupLabel = label(dash, 'dashboard.categorySortGroupAria', 'Bookmark sort');
        if (!categoryName) {
            return groupLabel;
        }
        const withCategory = label(dash, 'dashboard.categorySortGroupForAria', 'Bookmark sort for {category}');
        return withCategory.includes('{category}')
            ? withCategory.replace('{category}', categoryName)
            : `${groupLabel} — ${categoryName}`;
    }

    function createSortControls(dash, category, renderCore) {
        const sortMode = getCategorySortMode(dash, category);
        const categoryName = String(category?.name || resolveCategoryDisplayName(dash, category?.id ?? '')).trim();
        const controls = document.createElement('span');
        controls.className = 'category-sort-controls';
        controls.setAttribute('data-sort-mode', sortMode);
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', sortGroupAriaLabel(dash, category));

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
            const modeLabel = label(dash, aria, mode === 'az' ? 'Sort A to Z' : 'Sort by recently used');
            btn.setAttribute(
                'aria-label',
                categoryName ? `${modeLabel} (${categoryName})` : modeLabel
            );
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const next = setCategorySortMode(dash, category.id || '', mode, { toggle: true });
                const categoryEl = controls.closest('.category[data-category-id]');
                if (categoryEl) {
                    updateCategorySortUi(dash, categoryEl, { ...category, sortMode: next });
                }
                renderCore?.renderDashboard?.({ animate: false });
            });
            controls.appendChild(btn);
        });

        controls.addEventListener('keydown', (e) => {
            const buttons = [...controls.querySelectorAll('.category-sort-btn')];
            const index = buttons.indexOf(document.activeElement);
            if (index < 0) {
                return;
            }
            if (e.key === 'ArrowRight' && index < buttons.length - 1) {
                e.preventDefault();
                e.stopPropagation();
                buttons[index + 1].focus();
            } else if (e.key === 'ArrowLeft' && index > 0) {
                e.preventDefault();
                e.stopPropagation();
                buttons[index - 1].focus();
            }
        });

        return controls;
    }

    function ensureCategorySortControls(dash, categoryEl, category, renderCore) {
        if (!categoryEl || !category || category.isSmartCollection === true || category.tagFilterChunk === true) {
            return;
        }
        if (!categoryEl.querySelector('.category-sort-controls')) {
            const titleEl = categoryEl.querySelector('.category-title');
            if (!titleEl || !renderCore) {
                return;
            }
            const chevron = titleEl.querySelector('.category-chevron');
            const controls = createSortControls(dash, category, renderCore);
            if (chevron) {
                titleEl.insertBefore(controls, chevron);
            } else {
                titleEl.appendChild(controls);
            }
        }
        updateCategorySortUi(dash, categoryEl, category);
    }

    function updateCategorySortUi(dash, categoryEl, category) {
        if (!categoryEl || !category || category.isSmartCollection === true || category.tagFilterChunk === true) {
            return;
        }
        const sortMode = getCategorySortMode(dash, category);
        categoryEl.setAttribute('data-bookmark-sort', sortMode);
        const list = categoryEl.querySelector('.bookmarks-list[data-category-id]');
        if (list) {
            list.classList.toggle('bookmarks-list--sort-active', sortMode !== 'order');
        }
        const controls = categoryEl.querySelector('.category-sort-controls');
        if (controls) {
            controls.setAttribute('data-sort-mode', sortMode);
        }
        categoryEl.querySelectorAll('.category-sort-btn[data-sort-mode]').forEach((btn) => {
            const mode = btn.getAttribute('data-sort-mode');
            const active = mode === sortMode;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function refreshAllCategorySortUi(dash, root = document) {
        if (!dash) {
            return;
        }
        const scope = root?.querySelectorAll
            ? root
            : document;
        scope.querySelectorAll('.category[data-category-id]:not([data-smart-collection="true"])').forEach((categoryEl) => {
            const categoryId = String(categoryEl.getAttribute('data-category-id') ?? '');
            const persisted = (dash.categories || []).find((cat) => String(cat.id) === categoryId);
            const category = persisted || { id: categoryId };
            updateCategorySortUi(dash, categoryEl, category);
        });
    }

    window.DashboardCategorySort = {
        normalizeSortMode,
        getCategorySortMode,
        setCategorySortMode,
        resolveFocusedCategoryId,
        resolveCategoryDisplayName,
        migrateLegacySortAllPages,
        createSortControls,
        ensureCategorySortControls,
        updateCategorySortUi,
        refreshAllCategorySortUi,
    };
})();
