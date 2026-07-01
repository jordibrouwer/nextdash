/**
 * Incremental dashboard grid updates — patch categories in place when structure matches.
 */
class DashboardRenderIncremental {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    get core() {
        return this.dash.renderCore;
    }

    tryRender(options = {}) {
        const d = this.dash;
        if (d.isInlineEditActive?.()) {
            return false;
        }
        if (options.incremental === 'settings') {
            return this.refreshSettingsDerivedDom();
        }
        if (!this.canAttemptDataPatch(options)) {
            return false;
        }
        return this.patchBookmarkData(options);
    }

    canAttemptDataPatch(options = {}) {
        const d = this.dash;
        if (options.animate === true || options.forceFull === true || options.incremental === false) {
            return false;
        }
        if (d.hasActiveTagFilters?.()) {
            return false;
        }
        const container = document.getElementById('dashboard-layout');
        if (!container || container.querySelector('.tag-filter-view')) {
            return false;
        }
        if (container.querySelector('.empty-state')) {
            return false;
        }
        if (!Array.isArray(d.bookmarks) || d.bookmarks.length === 0) {
            return false;
        }
        return !this.layoutSettingsChanged(container);
    }

    layoutSettingsChanged(container) {
        const d = this.dash;
        const colCount = this.core.getEffectiveColumnsPerRow();
        const packed = this.core.shouldPackDashboardColumns();
        const hasPacked = container.classList.contains('packed-columns');
        const colClass = [...container.classList].find((cls) => cls.startsWith('columns-'));
        const currentCols = colClass ? parseInt(colClass.replace('columns-', ''), 10) : null;
        const wantDensity = d.settings.densityMode || 'compact';
        const currentDensity = [...container.classList].find((cls) => cls.startsWith('density-'))?.replace('density-', '') || 'compact';
        return currentCols !== colCount
            || hasPacked !== packed
            || currentDensity !== wantDensity;
    }

    refreshSettingsDerivedDom() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container || container.querySelector('.empty-state') || d.hasActiveTagFilters?.()) {
            return false;
        }

        this.core.syncDashboardGridLayout();
        document.querySelectorAll('#dashboard-layout .bookmarks-list[data-category-id]').forEach((list) => {
            const showPing = d.settings.showStatus && d.settings.showPing;
            if (showPing) {
                list.setAttribute('data-show-ping', 'true');
            } else {
                list.removeAttribute('data-show-ping');
            }
        });

        const blocks = this.core.buildCategoryColumnBlocks();
        const byCategoryId = new Map(blocks.map((block) => [String(block.category.id ?? ''), block]));

        container.querySelectorAll('.category[data-category-id]').forEach((categoryEl) => {
            const categoryId = String(categoryEl.getAttribute('data-category-id') ?? '');
            const block = byCategoryId.get(categoryId);
            if (!block) {
                return;
            }
            this.updateCategoryTitle(categoryEl, block.category);
            this.patchCategoryBookmarks(categoryEl, block.category, block.bookmarks, { forceRowRefresh: true });
        });

        this.finishIncrementalRefresh();
        return true;
    }

    patchBookmarkData() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) {
            return false;
        }

        const desiredBlocks = this.core.buildCategoryColumnBlocks();
        const existingCategories = this.getExistingCategories(container);
        if (!this.categoryStructureMatches(desiredBlocks, existingCategories)) {
            return false;
        }

        const focusedUrl = this.getFocusedBookmarkUrl();
        this.core.syncDashboardGridLayout();

        desiredBlocks.forEach((block, index) => {
            const categoryEl = existingCategories[index];
            if (!categoryEl) {
                return;
            }
            this.updateCategoryTitle(categoryEl, block.category);
            this.patchCategoryBookmarks(categoryEl, block.category, block.bookmarks);
        });

        this.restoreFocusedBookmark(focusedUrl);
        this.finishIncrementalRefresh();
        return true;
    }

    getExistingCategories(container) {
        if (this.core.shouldPackDashboardColumns()) {
            const columns = Array.from(container.querySelectorAll(':scope > .dashboard-column'));
            if (!columns.length) {
                return [];
            }
            const maxRows = Math.max(...columns.map((col) => col.querySelectorAll('.category[data-category-id]').length), 0);
            const ordered = [];
            for (let row = 0; row < maxRows; row += 1) {
                for (let col = 0; col < columns.length; col += 1) {
                    const categoryEl = columns[col].querySelectorAll('.category[data-category-id]')[row];
                    if (categoryEl) {
                        ordered.push(categoryEl);
                    }
                }
            }
            return ordered;
        }
        return Array.from(container.querySelectorAll(':scope > .category[data-category-id]'));
    }

    categoryStructureMatches(desiredBlocks, existingCategories) {
        if (desiredBlocks.length !== existingCategories.length) {
            return false;
        }
        return desiredBlocks.every((block, index) => {
            const el = existingCategories[index];
            const wantId = String(block.category.id ?? '');
            const haveId = String(el.getAttribute('data-category-id') ?? '');
            const wantSmart = block.category.isSmartCollection === true;
            const haveSmart = el.getAttribute('data-smart-collection') === 'true';
            return wantId === haveId && wantSmart === haveSmart;
        });
    }

    updateCategoryTitle(categoryEl, category) {
        const d = this.dash;
        if (category.isSmartCollection || category.tagFilterChunk) {
            return;
        }
        const nameSpan = categoryEl.querySelector('.category-title-name');
        if (!nameSpan || !category.name) {
            return;
        }
        const nextName = String(category.name).toLowerCase();
        if (nameSpan.textContent !== nextName) {
            nameSpan.textContent = nextName;
            nameSpan.title = category.name;
        }
        window.DashboardCategorySort?.ensureCategorySortControls?.(d, categoryEl, category, d.renderCore);
        const titleEl = categoryEl.querySelector('.category-title');
        if (titleEl) {
            window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
        }
    }

    patchCategoryBookmarks(categoryEl, category, bookmarks, options = {}) {
        const d = this.dash;
        const list = categoryEl.querySelector('.bookmarks-list[data-category-id]');
        if (!list) {
            return;
        }

        const isSmartCollection = category.isSmartCollection === true;
        const showPing = d.settings.showStatus && d.settings.showPing;
        if (showPing) {
            list.setAttribute('data-show-ping', 'true');
        } else {
            list.removeAttribute('data-show-ping');
        }

        const desiredUrls = bookmarks.map((bookmark) => this.normalizeUrl(bookmark?.url));
        const rowByUrl = new Map();
        list.querySelectorAll('.bookmark-link[data-bookmark-url]').forEach((row) => {
            const url = this.normalizeUrl(row.getAttribute('data-bookmark-url'));
            if (url) {
                rowByUrl.set(url, row);
            }
        });

        const usedRows = new Set();
        const fragment = document.createDocumentFragment();

        bookmarks.forEach((bookmark, index) => {
            const pageIndex = Array.isArray(d.bookmarks) ? d.bookmarks.indexOf(bookmark) : -1;
            const urlKey = this.normalizeUrl(bookmark?.url);
            let row = urlKey ? rowByUrl.get(urlKey) : null;
            if (!row && pageIndex >= 0) {
                row = list.querySelector(`.bookmark-link[data-bookmark-index="${pageIndex}"]`);
            }
            const fingerprint = d.bookmarkRows.bookmarkRenderFingerprint(bookmark);

            if (row) {
                usedRows.add(row);
                if (row.classList.contains('bookmark-inline-editing') || row.querySelector('.bookmark-inline-form')) {
                    d.populateBookmarkRowView(row, bookmark, category.id || '', !isSmartCollection);
                    row.setAttribute('data-bookmark-index', String(index));
                    fragment.appendChild(row);
                    return;
                }
                const needsRefresh = options.forceRowRefresh
                    || row.getAttribute('data-render-fp') !== fingerprint
                    || String(row.getAttribute('data-category-id') ?? '') !== String(category.id ?? '');
                if (needsRefresh) {
                    d.populateBookmarkRowView(row, bookmark, category.id || '', !isSmartCollection);
                }
                row.setAttribute('data-bookmark-index', String(index));
                fragment.appendChild(row);
                return;
            }

            row = d.createBookmarkElement(bookmark, category.id || '', !isSmartCollection);
            row.setAttribute('data-bookmark-index', String(index));
            fragment.appendChild(row);
        });

        list.querySelectorAll('.bookmark-link[data-bookmark-url]').forEach((row) => {
            if (!usedRows.has(row) && !fragment.contains(row)) {
                row.remove();
            }
        });
        list.querySelectorAll('.smart-collection-empty, .empty-state--category').forEach((el) => el.remove());
        list.appendChild(fragment);

        if (bookmarks.length === 0 && !isSmartCollection) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'empty-state--category';
            const textSpan = document.createElement('span');
            textSpan.className = 'empty-state--category-text';
            const t = (key, fallback) => {
                const v = d.language?.t?.(key);
                return v && v !== key ? v : fallback;
            };
            textSpan.textContent = t('dashboard.emptyCategoryText', 'no bookmarks');
            emptyEl.appendChild(textSpan);
            list.appendChild(emptyEl);
        }
    }

    normalizeUrl(url) {
        return String(url || '').trim().toLowerCase();
    }

    getFocusedBookmarkUrl() {
        const active = document.activeElement;
        const row = active?.closest?.('.bookmark-link[data-bookmark-url]');
        if (!row) {
            const selected = document.querySelector('#dashboard-layout .bookmark-link.keyboard-selected[data-bookmark-url]');
            return selected ? this.normalizeUrl(selected.getAttribute('data-bookmark-url')) : '';
        }
        return this.normalizeUrl(row.getAttribute('data-bookmark-url'));
    }

    restoreFocusedBookmark(urlKey) {
        if (!urlKey) {
            return;
        }
        const row = [...document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-url]')]
            .find((el) => this.normalizeUrl(el.getAttribute('data-bookmark-url')) === urlKey);
        if (!row) {
            return;
        }
        row.classList.add('keyboard-selected');
        row.setAttribute('aria-current', 'true');
        const openLink = row.querySelector('a.bookmark-open');
        if (openLink) {
            openLink.tabIndex = 0;
            if (document.activeElement === document.body || document.activeElement === document.getElementById('dashboard-layout')) {
                openLink.focus({ preventScroll: true });
            }
        }
        const grid = document.getElementById('bookmark-grid') || document.getElementById('dashboard-layout');
        const cellId = openLink?.id;
        if (grid && cellId) {
            grid.setAttribute('aria-activedescendant', cellId);
        }
    }

    finishIncrementalRefresh() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        d._categoryListsCache = null;
        d._renderAnimationsEnabled = false;
        this.core.initializeCategoryReorder();
        window.DashboardCategorySort?.refreshAllCategorySortUi?.(d, container);
        window.DashboardCategoryTitleFit?.scheduleFitAllCategoryTitles?.(container);
        d.updateSearchComponent?.();
        d.syncBookmarkGridA11y?.();
        d.keyboardNavigation?.scheduleUpdate?.();
        if (d.statusMonitor) {
            if (d.statusMonitorInitialized) {
                d.statusMonitor.updateBookmarks(d.bookmarks);
            } else {
                d.statusMonitor.init(d.bookmarks);
                d.statusMonitorInitialized = true;
            }
        }
    }
}

window.DashboardRenderIncremental = DashboardRenderIncremental;
