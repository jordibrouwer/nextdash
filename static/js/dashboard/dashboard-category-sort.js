/**
 * Per-category bookmark sort modes (order / az / opened / added / opens).
 *
 * `opened` was called `recent` and sorted on lastOpened, while Config →
 * Bookmarks used the same word for createdAt and labelled it "Recently added".
 * The old value is still accepted so stored categories keep working.
 */
(function () {
    const VALID_MODES = new Set(['order', 'az', 'opened', 'added', 'opens']);

    function normalizeSortMode(mode) {
        const value = String(mode || 'order').toLowerCase();
        if (value === 'custom' || value === 'manual') {
            return 'order';
        }
        if (value === 'a-z' || value === 'alphabetical' || value === 'name') {
            return 'az';
        }
        if (value === 'recent' || value === 'recently' || value === 'recently-used' || value === 'rec') {
            return 'opened';
        }
        if (value === 'created' || value === 'newest') {
            return 'added';
        }
        if (value === 'most-used' || value === 'opencount') {
            return 'opens';
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
                mode: 'opened',
                short: label(dash, 'dashboard.categorySortRecentShort', 'Rec'),
                aria: 'dashboard.categorySortRecentAria',
            },
            {
                mode: 'added',
                short: label(dash, 'dashboard.categorySortAddedShort', 'New'),
                aria: 'dashboard.categorySortAddedAria',
            },
            {
                mode: 'opens',
                short: label(dash, 'dashboard.categorySortOpensShort', 'Top'),
                aria: 'dashboard.categorySortOpensAria',
            },
        ];

        // One button, not four. Four sort buttons on every category header —
        // and the header is repeated per category — took more width than the
        // bookmark names beside them. The active mode stays visible because it
        // is the one thing worth knowing at a glance; the rest move behind a ⋯.
        //
        // In manual order, which is the default, even that button is dropped:
        // there is no sort to report, so the header shows nothing but the ⋯.
        const active = modes.find((m) => m.mode === sortMode) || null;

        if (active) {
            const current = document.createElement('button');
            current.type = 'button';
            current.className = 'category-sort-btn is-active';
            current.textContent = active.short;
            current.setAttribute('data-sort-mode', active.mode);
            current.setAttribute('aria-pressed', 'true');
            const activeLabel = label(dash, active.aria, active.mode);
            current.setAttribute('aria-label',
                categoryName ? `${activeLabel} (${categoryName})` : activeLabel);
            // Clicking the active mode turns it off, back to manual order —
            // the same toggle the four buttons had.
            current.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                applyMode(active.mode);
            });
            controls.appendChild(current);
        }

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'category-sort-menu-btn';
        menuBtn.textContent = '⋯';
        menuBtn.setAttribute('aria-haspopup', 'menu');
        menuBtn.setAttribute('aria-expanded', 'false');
        const menuLabel = label(dash, 'dashboard.categorySortMenuAria', 'Sort this category');
        menuBtn.setAttribute('aria-label',
            categoryName ? `${menuLabel} (${categoryName})` : menuLabel);
        controls.appendChild(menuBtn);

        function applyMode(mode) {
            const next = setCategorySortMode(dash, category.id || '', mode, { toggle: true });
            const categoryEl = controls.closest('.category[data-category-id]');
            if (categoryEl) {
                updateCategorySortUi(dash, categoryEl, { ...category, sortMode: next });
            }
            renderCore?.renderDashboard?.({ animate: false });
        }

        function closeMenu() {
            controls.querySelector('.category-sort-menu')?.remove();
            menuBtn.setAttribute('aria-expanded', 'false');
            document.removeEventListener('click', onOutside, true);
        }

        function onOutside(e) {
            if (!controls.contains(e.target)) closeMenu();
        }

        menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (controls.querySelector('.category-sort-menu')) {
                closeMenu();
                return;
            }
            // Close any other category's menu first: two open at once reads as
            // a bug, and the outside-click handler only knows about its own.
            document.querySelectorAll('.category-sort-menu').forEach((m) => m.remove());
            document.querySelectorAll('.category-sort-menu-btn[aria-expanded="true"]')
                .forEach((b) => b.setAttribute('aria-expanded', 'false'));

            const menu = document.createElement('div');
            menu.className = 'category-sort-menu';
            menu.setAttribute('role', 'menu');

            const entries = [
                { mode: 'order', short: label(dash, 'dashboard.categorySortManualShort', 'Manual'),
                  aria: 'dashboard.categorySortManualAria' },
                ...modes,
            ];
            entries.forEach(({ mode, short, aria }) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'category-sort-menu-item';
                item.setAttribute('role', 'menuitemradio');
                item.setAttribute('data-sort-mode', mode);
                const on = sortMode === mode || (mode === 'order' && !active);
                item.setAttribute('aria-checked', on ? 'true' : 'false');
                if (on) item.classList.add('is-active');
                item.textContent = short;
                const itemLabel = label(dash, aria, mode);
                item.setAttribute('aria-label',
                    categoryName ? `${itemLabel} (${categoryName})` : itemLabel);
                item.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    closeMenu();
                    // 'order' is the absence of a sort, so it is set rather than
                    // toggled — clicking it twice must not turn a sort back on.
                    if (mode === 'order') {
                        const next = setCategorySortMode(dash, category.id || '', 'order', { toggle: false });
                        const categoryEl = controls.closest('.category[data-category-id]');
                        if (categoryEl) {
                            updateCategorySortUi(dash, categoryEl, { ...category, sortMode: next });
                        }
                        renderCore?.renderDashboard?.({ animate: false });
                        return;
                    }
                    applyMode(mode);
                });
                menu.appendChild(item);
            });

            controls.appendChild(menu);
            menuBtn.setAttribute('aria-expanded', 'true');
            menu.querySelector('.category-sort-menu-item.is-active, .category-sort-menu-item')?.focus();
            document.addEventListener('click', onOutside, true);
        });

        controls.addEventListener('keydown', (e) => {
            const menu = controls.querySelector('.category-sort-menu');
            if (e.key === 'Escape' && menu) {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
                menuBtn.focus();
                return;
            }
            const items = menu
                ? [...menu.querySelectorAll('.category-sort-menu-item')]
                : [...controls.querySelectorAll('.category-sort-btn, .category-sort-menu-btn')];
            const index = items.indexOf(document.activeElement);
            if (index < 0) {
                return;
            }
            const forward = menu ? 'ArrowDown' : 'ArrowRight';
            const back = menu ? 'ArrowUp' : 'ArrowLeft';
            if (e.key === forward && index < items.length - 1) {
                e.preventDefault();
                e.stopPropagation();
                items[index + 1].focus();
            } else if (e.key === back && index > 0) {
                e.preventDefault();
                e.stopPropagation();
                items[index - 1].focus();
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
            // The strip is one button plus a ⋯, and which button that is
            // depends on the mode — so switching sort changes the markup, not
            // just a class on a button that is always there. Rebuild it.
            const rebuilt = createSortControls(dash, { ...category, sortMode }, dash.renderCore);
            controls.replaceWith(rebuilt);
        }
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
