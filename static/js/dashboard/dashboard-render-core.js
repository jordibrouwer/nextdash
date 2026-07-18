/**
 * Dashboard grid render, categories, reorder.
 */
class DashboardRenderCore {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    shouldStackDashboardCategories() {
        const d = this.dash;
        return (
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(max-width: 767px)').matches
        );
    }


    getEffectiveColumnsPerRow() {
        const d = this.dash;
        if (this.shouldStackDashboardCategories()) {
            return 1;
        }
        return this.getNormalizedColumnsPerRow();
    }


    shouldPackDashboardColumns() {
        const d = this.dash;
        if (this.shouldStackDashboardCategories()) {
            return false;
        }
        return (
            d.settings.packedColumns === true &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(min-width: 768px)').matches
        );
    }


    getNormalizedColumnsPerRow() {
        const d = this.dash;
        const parsed = parseInt(String(d.settings.columnsPerRow), 10);
        return Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 3));
    }


    syncDashboardGridLayout() {
        const d = this.dash;
        const grid = document.getElementById('dashboard-layout');
        if (!grid) {
            return null;
        }

        const configuredColCount = this.getNormalizedColumnsPerRow();
        d.settings.columnsPerRow = configuredColCount;
        const colCount = this.getEffectiveColumnsPerRow();
        const packed = this.shouldPackDashboardColumns();
        const packedClass = packed ? ' packed-columns' : '';

        grid.className = `dashboard-grid columns-${colCount} layout-${d.settings.layoutPreset || 'default'} density-${d.settings.densityMode || 'compact'}${packedClass}`;
        grid.setAttribute('role', 'grid');
        grid.setAttribute(
            'aria-label',
            d.language?.t('dashboard.bookmarksGridLabel') || 'Bookmarks'
        );
        grid.style.setProperty('--packed-columns', String(colCount));
        document.body.setAttribute(
            'data-dashboard-stack-categories',
            this.shouldStackDashboardCategories() ? 'true' : 'false'
        );
        const colMin = 'var(--dashboard-column-min, 250px)';
        const colMax = 'var(--dashboard-column-max, 300px)';
        grid.style.setProperty(
            '--dashboard-grid-max-width',
            `calc(${colCount} * ${colMax} + ${Math.max(0, colCount - 1)} * var(--gap, 1.5rem))`
        );

        if (packed) {
            grid.style.removeProperty('grid-template-columns');
        } else if (colCount === 1) {
            grid.style.gridTemplateColumns = 'minmax(0, 1fr)';
        } else {
            grid.style.gridTemplateColumns = `repeat(${colCount}, minmax(${colMin}, ${colMax}))`;
        }

        return { grid, colCount, packed };
    }


    _distributeDashboardColumnBlocks(container, columnBlocks, { animate = false, gridLayout = null } = {}) {
        const d = this.dash;
        if (!container || !columnBlocks.length) {
            return;
        }

        const colCount = gridLayout?.colCount ?? this.getEffectiveColumnsPerRow();
        const shouldPackColumns = gridLayout?.packed ?? this.shouldPackDashboardColumns();

        if (shouldPackColumns) {
            const columns = Array.from({ length: colCount }, () => {
                const col = document.createElement('div');
                col.className = 'dashboard-column';
                return col;
            });
            columnBlocks.forEach((el, i) => {
                if (animate) {
                    el.style.setProperty('--stagger-index', String(i));
                    const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                    setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
                }
                columns[i % colCount].appendChild(el);
            });
            columns.forEach((c) => container.appendChild(c));
            return;
        }

        columnBlocks.forEach((el, i) => {
            if (animate) {
                el.style.setProperty('--stagger-index', String(i));
                const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
                setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
            }
            container.appendChild(el);
        });
    }


    _copyDashboardGridLayoutToElement(target, sourceGrid) {
        const d = this.dash;
        if (!target || !sourceGrid) {
            return;
        }
        const layoutClasses = [...sourceGrid.classList].filter((cls) =>
            cls === 'dashboard-grid'
            || cls === 'packed-columns'
            || cls.startsWith('columns-')
            || cls.startsWith('density-')
        );
        target.className = `tag-filter-view-body ${layoutClasses.join(' ')} layout-default`.trim();
        target.setAttribute('role', 'grid');
        target.setAttribute(
            'aria-label',
            d.language?.t('dashboard.tagFilterGridLabel') || 'Filtered bookmarks'
        );
    }

    /**
     * Tag filter: one equal-width dashboard column per chunk (10 bookmarks), not round-robin.
     */

    /**
     * Planned category/smart-collection blocks for the main grid (no DOM).
     * @returns {{ category: object, bookmarks: object[] }[]}
     */
    buildCategoryColumnBlocks() {
        const d = this.dash;
        const groupedBookmarks = this.groupBookmarksByCategory();
        const columnBlocks = [];

        const smartCollections = d.getSmartCollections(d.getSmartCollectionSourceBookmarks());
        smartCollections.forEach((collection) => {
            if (!Array.isArray(collection.bookmarks) || collection.bookmarks.length === 0) {
                return;
            }
            const collectionBookmarks = d._sortSmartCollectionBookmarks(collection);
            columnBlocks.push({
                category: {
                    id: collection.id,
                    name: collection.name,
                    icon: collection.icon,
                    isSmartCollection: true,
                    customCollection: collection.customCollection || null,
                },
                bookmarks: collectionBookmarks,
            });
        });

        d.categories.forEach((category) => {
            const id = String(category.id);
            const categoryBookmarks = this.sortBookmarks(groupedBookmarks[id] || [], category);
            if (d.settings.hideEmptyCategories && categoryBookmarks.length === 0) {
                return;
            }
            columnBlocks.push({ category, bookmarks: categoryBookmarks });
        });

        const uncategorizedBookmarks = groupedBookmarks[''] || [];
        if (uncategorizedBookmarks.length > 0) {
            const _unc = d.language.t('dashboard.uncategorized');
            const uncategorizedCategory = {
                id: '',
                name: _unc !== 'dashboard.uncategorized' ? _unc : 'Uncategorized',
                isVirtualCategory: true,
            };
            columnBlocks.push({
                category: uncategorizedCategory,
                bookmarks: this.sortBookmarks(uncategorizedBookmarks, uncategorizedCategory),
            });
        }

        const knownCategoryIds = new Set(d.categories.map((c) => String(c.id)));
        const orphanLabelBase = (() => {
            const raw = d.language.t('dashboard.unknownCategory');
            return raw && raw !== 'dashboard.unknownCategory' ? raw : 'Unknown category';
        })();
        Object.keys(groupedBookmarks).forEach((key) => {
            const id = String(key);
            if (id === '' || knownCategoryIds.has(id)) {
                return;
            }
            const orphanBookmarks = groupedBookmarks[id];
            if (!Array.isArray(orphanBookmarks) || orphanBookmarks.length === 0) {
                return;
            }
            columnBlocks.push({
                category: {
                    id,
                    name: `${orphanLabelBase} (${id})`,
                    icon: '⚠',
                    isVirtualCategory: true,
                },
                bookmarks: this.sortBookmarks(orphanBookmarks, { id }),
            });
        });

        return columnBlocks;
    }


    renderDashboard(options = {}) {
        const d = this.dash;
        if (d.activeView === 'inbox' && d.inbox?.isEnabled?.()) {
            d.data?.schedulePageBookmarksHealIfNeeded?.();
            if (d.isInlineEditActive()) {
                return;
            }
            d.inbox.render();
            return;
        }
        if (d.activeView === 'health' && d.health?.isEnabled?.()) {
            d.data?.schedulePageBookmarksHealIfNeeded?.();
            if (d.isInlineEditActive()) {
                return;
            }
            d.health.render();
            return;
        }
        // A view whose feature is switched off falls back to bookmarks rather
        // than rendering nothing.
        if (d.activeView !== 'bookmarks') {
            d.activeView = 'bookmarks';
        }
        d.data?.schedulePageBookmarksHealIfNeeded?.();
        if (d.isInlineEditActive()) {
            if (options.incremental === 'status') {
                d.statusMonitor?.refreshAllStatuses?.();
            }
            return;
        }
        if (options.incremental === 'status') {
            d.statusMonitor?.refreshAllStatuses?.();
            return;
        }
        if (
            options.incremental !== false
            && options.animate !== true
            && d.renderIncremental?.tryRender?.(options)
        ) {
            return;
        }
        const animate = options && options.animate === true;
        d._renderAnimationsEnabled = animate;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;
        container.classList.remove('inbox-layout', 'health-layout');

        d._abortInlineEditForRender();
        window.DashboardSmartWhyPopover?.hide?.();

        if (d.hasActiveTagFilters()) {
            d._categoryListsCache = null;
            d.renderTagFilterDashboard(container, options);
            return;
        }

        d.updateTagFilterIndicator();

        // Clear container
        container.innerHTML = '';
        d._categoryListsCache = null;
        container.classList.remove('page-transition', 'tag-filter-layout', 'tag-filter-view');

        if (!Array.isArray(d.bookmarks) || d.bookmarks.length === 0) {
            const hasBookmarksOnOtherPages = Array.isArray(d.allBookmarks) && d.allBookmarks.length > 0;
            const currentPage = d.pages.find(p => p.id === d.currentPageId);
            const pageName = currentPage ? d.escapeHtml(currentPage.name) : '';

            const addLabel = d.buildEmptyStateAddLabel();
            const addHint = d.buildEmptyStateAddHint();
            const showKeyboardActions = d.shouldShowEmptyStateKeyboardActions();
            const emptyPageText = d.language?.t('dashboard.emptyPage') || 'This page is empty';
            const searchLabel = d.language?.t('dashboard.searchLabel') || 'Search';
            const commandNewLabel = d.language?.t('dashboard.emptyStateCommandNew') || 'Add via command';
            const commandTagLabel = d.language?.t('dashboard.emptyStateCommandTag') || 'Browse by tag';
            const esc = (value) => d.escapeHtml(value);
            const searchActionHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-search" type="button"><kbd>&gt;</kbd> ${esc(searchLabel)}</button>`
                : `<button class="empty-state-action-btn" id="empty-state-search" type="button">${esc(searchLabel)}</button>`;
            const commandNewHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-command-new" type="button"><kbd>:new</kbd> ${esc(commandNewLabel)}</button>`
                : '';
            const commandTagHtml = showKeyboardActions
                ? `<button class="empty-state-action-btn" id="empty-state-command-tag" type="button"><kbd>:tag</kbd> ${esc(commandTagLabel)}</button>`
                : '';

            if (hasBookmarksOnOtherPages) {
                container.innerHTML = `
                    <div class="empty-state empty-state--page">
                        <div class="empty-state-label">// ${pageName}</div>
                        <div class="empty-state-text" data-i18n="dashboard.emptyPage">${esc(emptyPageText)}</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn empty-state-action-btn--primary" id="empty-state-new-bookmark" type="button">${esc(addLabel)}</button>
                            ${searchActionHtml}
                            ${commandNewHtml}
                            ${commandTagHtml}
                        </div>
                        <p class="empty-state-hint">${esc(addHint)}</p>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark')?.addEventListener('click', () => {
                    d.openEmptyStateAdd();
                });
                container.querySelector('#empty-state-search')?.addEventListener('click', () => {
                    d.searchComponent?.openSearchInterface();
                });
                container.querySelector('#empty-state-command-new')?.addEventListener('click', () => {
                    d.openEmptyStateCommand(':new');
                });
                container.querySelector('#empty-state-command-tag')?.addEventListener('click', () => {
                    d.openEmptyStateCommand(':tag');
                });
            } else {
                const freshText = d.language?.t('dashboard.emptyFresh') || 'No bookmarks yet';
                const searchFreshHtml = showKeyboardActions
                    ? `<button class="empty-state-action-btn" id="empty-state-search-fresh" type="button"><kbd>&gt;</kbd> ${esc(searchLabel)}</button>`
                    : `<button class="empty-state-action-btn" id="empty-state-search-fresh" type="button">${esc(searchLabel)}</button>`;
                container.innerHTML = `
                    <div class="empty-state empty-state--fresh">
                        <div class="empty-state-text" data-i18n="dashboard.emptyFresh">${esc(freshText)}</div>
                        <div class="empty-state-actions">
                            <button class="empty-state-action-btn empty-state-action-btn--primary" id="empty-state-new-bookmark-fresh" type="button">${esc(addLabel)}</button>
                            ${searchFreshHtml}
                        </div>
                        <p class="empty-state-hint">${esc(addHint)}</p>
                        <div class="empty-state-links">
                            <button class="empty-state-link" id="empty-state-add-modal-fresh" type="button" data-i18n="dashboard.emptyStateAddBookmark">${esc(d.language?.t('dashboard.emptyStateAddBookmark') || 'Add a bookmark')}</button>
                            <a class="empty-state-link" href="/config#bookmarks" data-i18n="dashboard.emptyStateManageBookmarks">${esc(d.language?.t('dashboard.emptyStateManageBookmarks') || 'Manage bookmarks in config')}</a>
                            <a class="empty-state-link" href="/config#backups" data-i18n="config.importDescription">${esc(d.language?.t('config.importDescription') || 'Import your data')}</a>
                        </div>
                    </div>
                `;
                container.querySelector('#empty-state-new-bookmark-fresh')?.addEventListener('click', () => {
                    d.openEmptyStateAdd();
                });
                container.querySelector('#empty-state-add-modal-fresh')?.addEventListener('click', () => {
                    d.openEmptyStateAdd();
                });
                container.querySelector('#empty-state-search-fresh')?.addEventListener('click', () => {
                    d.searchComponent?.openSearchInterface();
                });
            }
            if (d.language && typeof d.language.applyTranslations === 'function') {
                d.language.applyTranslations();
            }
            d.updateSearchComponent();
            return;
        }

        const columnBlocks = this.buildCategoryColumnBlocks().map((block) => (
            this.createCategoryElement(block.category, block.bookmarks)
        ));

        const gridLayout = this.syncDashboardGridLayout();
        this._distributeDashboardColumnBlocks(container, columnBlocks, { animate, gridLayout });

        if (animate) {
            requestAnimationFrame(() => {
                container.classList.add('page-transition');
                setTimeout(() => container.classList.remove('page-transition'), ANIM.PAGE_TRANSITION);
            });
        }

        // Enable realtime drag-and-drop sorting within each category
        this.initializeCategoryReorder();
        window.DashboardCategorySort?.refreshAllCategorySortUi?.(d, container);
        this.initializeDashboardCategoryReorder();

        d.updateSearchComponent();
        d.syncBookmarkGridA11y();
        d.keyboardNavigation?.scheduleUpdate?.();
        
        // Initialize or update status monitoring after rendering
        if (d.statusMonitor) {
            // Check if this is the first time initializing or just updating bookmarks
            if (d.statusMonitorInitialized) {
                // Just update bookmarks without clearing cache
                d.statusMonitor.updateBookmarks(d.bookmarks);
            } else {
                // First time initialization
                d.statusMonitor.init(d.bookmarks);
                d.statusMonitorInitialized = true;
            }
        }

        window.DashboardCategoryTitleFit?.ensureResizeObserver?.();
        window.DashboardCategoryTitleFit?.scheduleFitAllCategoryTitles?.(container);
    }


    groupBookmarksByCategory() {
        const d = this.dash;
        const grouped = {};
        
        d.bookmarks.forEach(bookmark => {
            const categoryId = String(bookmark.category ?? '').trim();
            if (!grouped[categoryId]) {
                grouped[categoryId] = [];
            }
            grouped[categoryId].push(bookmark);
        });

        // Bookmarks are kept in the order they appear in the JSON file
        // No sorting applied - respects the order from data/bookmarks-X.json

        return grouped;
    }


    sortBookmarks(bookmarks, categoryContext) {
        const d = this.dash;
        const sorted = [...(Array.isArray(bookmarks) ? bookmarks : [])];
        const category = typeof categoryContext === 'object' && categoryContext !== null
            ? categoryContext
            : (categoryContext != null ? { id: categoryContext } : null);
        const method = window.DashboardCategorySort?.getCategorySortMode(d, category) || 'order';
        const pinned = sorted
            .filter((bookmark) => Boolean(bookmark?.pinned))
            .sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' }));
        const regular = sorted.filter((bookmark) => !bookmark?.pinned);

        if (method === 'az') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (a?.name || '').localeCompare(b?.name || '', undefined, { sensitivity: 'base' }))
            ];
        }

        if (method === 'recent') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0))
            ];
        }

        if (method === 'custom') {
            return [...pinned, ...regular];
        }

        return [...pinned, ...regular];
    }


    // Collapse or expand every category on the current page at once.
    // Smart toggle: if any category is open, collapse all; otherwise expand all.
    // Pass `collapse` (true/false) to force a direction.
    toggleAllCategoriesCollapsed(collapse) {
        const d = this.dash;
        const grid = document.getElementById('dashboard-layout');
        if (!grid) return;
        const cats = Array.from(grid.querySelectorAll('.category[data-category-id]'));
        if (cats.length === 0) return;

        const target = typeof collapse === 'boolean'
            ? collapse
            : cats.some((el) => el.getAttribute('data-collapsed') !== 'true'); // any open → collapse

        cats.forEach((el) => {
            const id = el.getAttribute('data-category-id') || '';
            const isSmart = el.getAttribute('data-smart-collection') === 'true';
            const key = isSmart ? `smart:${id}` : `${d.currentPageId}:${id}`;
            el.setAttribute('data-collapsed', target ? 'true' : 'false');
            const title = el.querySelector('.category-title');
            if (title) title.setAttribute('aria-expanded', target ? 'false' : 'true');
            d.collapsedCategories[key] = target;
        });
        d.saveCollapsedStates();
    }

    initializeCategoryReorder() {
        const d = this.dash;
        this.destroyCategoryReorderInstances();

        if (typeof DragReorder === 'undefined') {
            return;
        }

        const categoryLists = this._getCategoryLists();
        categoryLists.forEach((listElement) => {
            if (listElement.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const categoryId = listElement.getAttribute('data-category-id') || '';
            const sortMode = window.DashboardCategorySort?.getCategorySortMode(d, { id: categoryId }) || 'order';
            if (sortMode !== 'order') {
                // Manual drag is disabled while A–Z / Recent sorting owns the order —
                // a dragged row would just be re-sorted away. Explain why instead of
                // doing nothing: hint on hover and a one-off toast on a drag attempt.
                this.attachSortLockedDragHint(listElement, sortMode);
                return;
            }

            const reorderInstance = new DragReorder({
                container: listElement,
                itemSelector: '.bookmark-link',
                /* Whole row is the drag handle so a bookmark can be grabbed anywhere.
                   The row's <a> has draggable=false (see createBookmarkRow) so the
                   browser's native link-drag can't hijack the reorder. The 500 ms
                   long-press editor still works: HTML5 drag only starts once the
                   pointer moves, and any move >8 px cancels the long-press timer. */
                handleSelector: null,
                longPressMs: 0,
                delegateItemDragOver: true,
                onReorder: () => {
                    this.syncBookmarksFromDom();
                }
            });

            d.categoryReorderInstances.push(reorderInstance);
        });
        this.ensureBookmarkDragOverRelay();
    }

    /**
     * Categories sorted A–Z / Recent can't be reordered by hand (the sort would undo
     * it). Rows there aren't draggable, so a drag looks like "nothing happens". Mark
     * the list so CSS shows a not-allowed cursor + hover tooltip, and show a single
     * toast the first time the user tries to drag a row in it.
     */
    attachSortLockedDragHint(listElement, sortMode) {
        const d = this.dash;
        if (!listElement || listElement._sortLockedHintBound) {
            return;
        }
        listElement._sortLockedHintBound = true;

        const modeLabel = sortMode === 'recent'
            ? d.formatDashboardLabel('sortModeRecent', {}, 'Recent')
            : d.formatDashboardLabel('sortModeAZ', {}, 'A–Z');
        const hint = d.formatDashboardLabel(
            'reorderSortLockedHint',
            { mode: modeLabel },
            `Sorted by ${modeLabel} — switch this category to manual order to drag bookmarks.`
        );
        listElement.setAttribute('title', hint);

        const showHintToast = () => {
            const now = Date.now();
            if (d._sortLockedToastAt && now - d._sortLockedToastAt < 4000) {
                return;
            }
            d._sortLockedToastAt = now;
            d.showNotification?.(hint, 'info');
        };

        // Only a genuine drag gesture (press + move past a small threshold) gets the
        // toast — a plain click that opens the bookmark must stay silent. The rows
        // aren't draggable here, so we detect the intent from raw pointer events.
        let startX = 0;
        let startY = 0;
        let armed = false;
        listElement.addEventListener('pointerdown', (e) => {
            if (e.button !== undefined && e.button !== 0) {
                return;
            }
            if (e.target?.closest?.('.category-sort-controls, .bookmark-inline-form')) {
                return;
            }
            armed = Boolean(e.target?.closest?.('.bookmark-link.reorder-item'));
            startX = e.clientX;
            startY = e.clientY;
        });
        listElement.addEventListener('pointermove', (e) => {
            if (!armed) {
                return;
            }
            if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
                armed = false;
                showHintToast();
            }
        });
        const disarm = () => { armed = false; };
        listElement.addEventListener('pointerup', disarm);
        listElement.addEventListener('pointercancel', disarm);
        listElement.addEventListener('pointerleave', disarm);
    }

    /**
     * HTML5 dragover does not bubble from bookmark rows across category headers / column gaps.
     * Single document-level relay uses elementFromPoint so drops into other columns work.
     */

    ensureBookmarkDragOverRelay() {
        const d = this.dash;
        if (d._bookmarkDragRelayHandler) {
            return;
        }
        // Only the placeholder moves during the drag; the dragged row is pulled out
        // of layout (display:none) so inserting it never changes a column's height.
        // Moving the real row live caused a feedback loop: the height change shifted
        // the layout under a still cursor, elementFromPoint then hit a different row,
        // and the row ping-ponged between columns — the flicker. The row is dropped
        // into the placeholder's slot at dragend (commitBookmarkDragPlaceholder).
        d._bookmarkDragRelayHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged || !e.dataTransfer) {
                return;
            }
            if (!dragged.classList || !dragged.classList.contains('bookmark-link')) {
                return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            if (!window.__dragReorderState.placeholder) {
                const ph = document.createElement('div');
                ph.className = 'bookmark-drop-placeholder';
                ph.setAttribute('aria-hidden', 'true');
                window.__dragReorderState.placeholder = ph;
            }
            const placeholder = window.__dragReorderState.placeholder;

            // Take the dragged row out of the flow so hit-testing is stable. Its
            // display is restored when the drop is committed.
            if (dragged.style.display !== 'none') {
                dragged.style.display = 'none';
            }

            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) {
                return;
            }
            const targetList = el.closest('.bookmarks-list[data-category-id]');
            if (!targetList || targetList.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const targetItem = el.closest('.bookmark-link.reorder-item');

            if (targetItem && targetItem !== dragged) {
                // Insert the placeholder before or after the hovered row depending on
                // which half of it the cursor is over.
                const rect = targetItem.getBoundingClientRect();
                const after = e.clientY > rect.top + rect.height / 2;
                const ref = after ? targetItem.nextSibling : targetItem;
                if (placeholder.parentNode !== targetItem.parentNode || placeholder.nextSibling !== ref) {
                    targetItem.parentNode.insertBefore(placeholder, ref);
                }
            } else if (!targetItem && placeholder.parentNode !== targetList) {
                // Empty area of a list: park the placeholder at the end.
                targetList.appendChild(placeholder);
            }
        };
        document.addEventListener('dragover', d._bookmarkDragRelayHandler, { capture: true, passive: false });

        // At drop, move the hidden dragged row into the placeholder's slot and show
        // it again, before reorder.js's dragend removes the placeholder and reads the
        // DOM order for the sync. Capture phase runs ahead of the row's own dragend.
        d._bookmarkDragCommitHandler = () => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            const placeholder = window.__dragReorderState && window.__dragReorderState.placeholder;
            if (dragged && dragged.classList && dragged.classList.contains('bookmark-link')) {
                if (placeholder && placeholder.parentNode) {
                    placeholder.parentNode.insertBefore(dragged, placeholder);
                }
                dragged.style.display = '';
            }
        };
        document.addEventListener('dragend', d._bookmarkDragCommitHandler, { capture: true });
        document.addEventListener('drop', d._bookmarkDragCommitHandler, { capture: true });
    }


    initializeDashboardCategoryReorder() {
        const d = this.dash;
        this.destroyDashboardCategoryReorderInstances();
        if (typeof DragReorder === 'undefined') return;

        const grid = document.getElementById('dashboard-layout');
        if (!grid) return;

        const isPacked = grid.classList.contains('packed-columns');
        const onReorder = () => {
            // Small delay so the DOM is fully settled after touch/mouse drag ends
            requestAnimationFrame(() => this.syncCategoriesFromDom());
        };

        if (isPacked) {
            // Multiple column containers: a document-level drag-over relay moves the
            // dragged category across columns; per-item dragover is delegated to it.
            this.ensureCategoryDragOverRelay();
            grid.querySelectorAll('.dashboard-column').forEach((col) => {
                d.dashboardCategoryReorderInstances.push(new DragReorder({
                    container: col,
                    itemSelector: '.category:not([data-smart-collection="true"])',
                    itemClass: 'category-reorder-item',
                    handleSelector: '.category-reorder-handle',
                    longPressMs: 0,
                    delegateItemDragOver: true,
                    touchContainerSelector: '.dashboard-column',
                    onReorder
                }));
            });
        } else {
            d.dashboardCategoryReorderInstances.push(new DragReorder({
                container: grid,
                itemSelector: '.category:not([data-smart-collection="true"])',
                itemClass: 'category-reorder-item',
                handleSelector: '.category-reorder-handle',
                longPressMs: 0,
                delegateItemDragOver: false,
                touchContainerSelector: '#dashboard-layout',
                onReorder
            }));
        }
    }


    ensureCategoryDragOverRelay() {
        const d = this.dash;
        if (d._categoryDragRelayHandler) return;

        // Accept the drop and immediately sync+save — DOM is correct at this moment.
        d._categoryDropHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged || !dragged.classList.contains('category')) return;
            e.preventDefault();
            this.syncCategoriesFromDom();
        };
        document.addEventListener('drop', d._categoryDropHandler, { capture: true });

        d._categoryDragRelayHandler = (e) => {
            const dragged = window.__dragReorderState && window.__dragReorderState.selected;
            if (!dragged) return;
            if (!dragged.classList || !dragged.classList.contains('category')) return;
            if (!e.dataTransfer) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el) return;
            const targetColumn = el.closest('.dashboard-column');
            if (!targetColumn) return;
            const targetItem = el.closest('.category.category-reorder-item');
            if (!window.__dragReorderState.placeholder) {
                const ph = document.createElement('div');
                ph.className = 'bookmark-drop-placeholder';
                ph.setAttribute('aria-hidden', 'true');
                window.__dragReorderState.placeholder = ph;
            }
            const placeholder = window.__dragReorderState.placeholder;
            if (targetItem && targetItem !== dragged) {
                targetItem.parentNode.insertBefore(placeholder, targetItem);
                if (dragged.parentNode === targetItem.parentNode) {
                    const isBefore = !!(dragged.compareDocumentPosition(targetItem) & Node.DOCUMENT_POSITION_FOLLOWING);
                    targetItem.parentNode.insertBefore(dragged, isBefore ? targetItem : targetItem.nextSibling);
                } else {
                    targetItem.parentNode.insertBefore(dragged, targetItem.nextSibling);
                }
            } else if (!targetItem && dragged.parentNode !== targetColumn) {
                targetColumn.appendChild(dragged);
                targetColumn.appendChild(placeholder);
            }
        };
        document.addEventListener('dragover', d._categoryDragRelayHandler, { capture: true, passive: false });
    }


    destroyCategoryReorderInstances() {
        const d = this.dash;
        if (d._bookmarkDragRelayHandler) {
            document.removeEventListener('dragover', d._bookmarkDragRelayHandler, { capture: true, passive: false });
            d._bookmarkDragRelayHandler = null;
        }
        if (d._bookmarkDragCommitHandler) {
            document.removeEventListener('dragend', d._bookmarkDragCommitHandler, { capture: true });
            document.removeEventListener('drop', d._bookmarkDragCommitHandler, { capture: true });
            d._bookmarkDragCommitHandler = null;
        }
        if (!Array.isArray(d.categoryReorderInstances)) {
            d.categoryReorderInstances = [];
            return;
        }

        d.categoryReorderInstances.forEach((instance) => {
            if (instance && typeof instance.destroy === 'function') {
                instance.destroy();
            }
        });
        d.categoryReorderInstances = [];
    }


    destroyDashboardCategoryReorderInstances() {
        const d = this.dash;
        if (d._categoryDragRelayHandler) {
            document.removeEventListener('dragover', d._categoryDragRelayHandler, { capture: true, passive: false });
            d._categoryDragRelayHandler = null;
        }
        if (d._categoryDropHandler) {
            document.removeEventListener('drop', d._categoryDropHandler, { capture: true });
            d._categoryDropHandler = null;
        }
        (d.dashboardCategoryReorderInstances || []).forEach((i) => {
            if (i && typeof i.destroy === 'function') i.destroy();
        });
        d.dashboardCategoryReorderInstances = [];
    }


    _getCategoryLists() {
        const d = this.dash;
        if (!d._categoryListsCache) {
            d._categoryListsCache = Array.from(document.querySelectorAll('.bookmarks-list[data-category-id]'));
        }
        return d._categoryListsCache;
    }


    syncBookmarksFromDom() {
        const d = this.dash;
        const previousBookmarks = d.bookmarks.map((bookmark) => ({ ...bookmark }));
        const nextBookmarks = [];
        const movedElements = [];
        let bookmarkCursor = 0;

        const categoryLists = this._getCategoryLists();
        categoryLists.forEach((listElement) => {
            if (listElement.getAttribute('data-smart-collection') === 'true') {
                return;
            }
            const categoryId = listElement.getAttribute('data-category-id') || '';
            const listBookmarks = listElement.querySelectorAll('.bookmark-link[data-bookmark-index]');

            listBookmarks.forEach((bookmarkElement) => {
                const oldBookmarkIndex = parseInt(bookmarkElement.getAttribute('data-bookmark-index'), 10);
                if (Number.isNaN(oldBookmarkIndex) || !previousBookmarks[oldBookmarkIndex]) {
                    return;
                }

                const bookmark = previousBookmarks[oldBookmarkIndex];
                const movedAcrossCategories = (bookmark.category || '') !== categoryId;
                nextBookmarks.push({ ...bookmark, category: categoryId });
                bookmarkElement.setAttribute('data-bookmark-index', String(bookmarkCursor));
                bookmarkElement.setAttribute('data-category-id', categoryId);
                if (movedAcrossCategories) {
                    movedElements.push(bookmarkElement);
                }
                bookmarkCursor += 1;
            });
        });

        if (nextBookmarks.length === 0 || nextBookmarks.length !== previousBookmarks.length) {
            this.renderDashboard();
            return;
        }

        if (!d.pendingReorderSnapshot) {
            d.pendingReorderSnapshot = previousBookmarks.map((bookmark) => ({ ...bookmark }));
        }

        d.bookmarks = nextBookmarks;
        movedElements.forEach((element) => {
            element.classList.add('bookmark-move-in');
            setTimeout(() => element.classList.remove('bookmark-move-in'), ANIM.BOOKMARK_MOVE_IN);
        });
        d.updateSearchComponent();
        if (d.statusMonitor) {
            d.statusMonitor.updateBookmarks(d.bookmarks);
        }
        this.scheduleBookmarkOrderSave();
    }


    syncCategoriesFromDom() {
        const d = this.dash;
        const grid = document.getElementById('dashboard-layout');
        if (!grid) return;
        const els = grid.querySelectorAll('.category[data-category-id]:not([data-smart-collection="true"])');
        const newIds = Array.from(els).map((el) => el.getAttribute('data-category-id')).filter(Boolean);

        if (!newIds.length) return;

        const byId = new Map(d.categories.map((c) => [String(c.id), c]));
        const renderedSet = new Set(newIds);

        // Categories not rendered (empty) — preserve them appended after rendered ones
        const unrendered = d.categories.filter((c) => !renderedSet.has(String(c.id)));
        const newCategories = [
            ...newIds.map((id) => byId.get(id)).filter(Boolean),
            ...unrendered
        ];

        // Orphan/virtual categories in the DOM are not persisted objects — never write an
        // empty payload that would wipe categories still referenced by bookmarks.
        if (newIds.length > 0 && newCategories.length === 0) {
            return;
        }
        if (newCategories.length === 0 && Array.isArray(d.categories) && d.categories.length > 0) {
            return;
        }

        d.categories = newCategories;
        this.scheduleCategoryOrderSave();
    }


    scheduleCategoryOrderSave() {
        const d = this.dash;
        if (d._pendingCategorySave) clearTimeout(d._pendingCategorySave);
        d._pendingCategorySave = setTimeout(() => {
            d._pendingCategorySave = null;
            const pageId = Number(d.currentPageId);
            const payload = (d.categories || []).map((category) => ({ ...category }));
            void this.saveCategoryOrder({ pageId, payload });
        }, 1000);
    }


    async saveCategoryOrder(options = {}) {
        const d = this.dash;
        const pageId = Number(options.pageId ?? d.currentPageId);
        if (!Number.isFinite(pageId)) {
            return;
        }

        const sourceCategories = Array.isArray(options.payload) ? options.payload : d.categories;
        const payload = (sourceCategories || []).map((category) => ({ ...category, originalId: category.id }));

        if (payload.length === 0 && Array.isArray(d.bookmarks)) {
            const bookmarksStillReferenceCategories = d.bookmarks.some(
                (bookmark) => String(bookmark?.category || '').trim() !== ''
            );
            if (bookmarksStillReferenceCategories) {
                return;
            }
        }

        const saveTask = (async () => {
            try {
                const res = await dashFetch(`/api/categories?page=${pageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error('Save failed');
                d.data?.updatePageDataCache?.(pageId, { categories: payload });
            } catch (err) {
                d.showErrorNotification(`${err.message || 'Failed to save category order.'} Please try again.`);
                throw err;
            }
        })();

        d._categoryOrderSaveInFlight = saveTask;
        try {
            await saveTask;
        } catch (_err) {
            // Notification shown in saveTask.
        } finally {
            if (d._categoryOrderSaveInFlight === saveTask) {
                d._categoryOrderSaveInFlight = null;
            }
        }
    }


    _attachCategoryTitleLongPress(titleEl, nameSpan, category) {
        const longMs = window.DashboardInlineEdit?.ROW_LONG_PRESS_MS ?? 500;
        const slop = 8;
        let timer = null;
        let startX = 0;
        let startY = 0;
        let activePointerId = null;

        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            titleEl.classList.remove('category-title-longpress-armed');
            activePointerId = null;
        };

        const isExcludedTarget = (target) => Boolean(
            target?.closest?.('.category-sort-controls, .smart-collection-why-btn, .category-rename-input, .category-reorder-handle')
        );

        const onPointerDown = (e) => {
            if (e.button !== undefined && e.button !== 0) {
                return;
            }
            if (isExcludedTarget(e.target)) {
                return;
            }
            if (titleEl.classList.contains('category-title--renaming')) {
                return;
            }
            clearTimer();
            startX = e.clientX;
            startY = e.clientY;
            activePointerId = e.pointerId;
            titleEl.classList.add('category-title-longpress-armed');
            timer = setTimeout(() => {
                timer = null;
                titleEl.classList.remove('category-title-longpress-armed');
                activePointerId = null;
                if (titleEl.classList.contains('category-title--renaming')) {
                    return;
                }
                this._startCategoryRename(titleEl, nameSpan, category);
                const blockClick = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                };
                titleEl.addEventListener('click', blockClick, { capture: true, once: true });
            }, longMs);
        };

        const onPointerMove = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            if (!timer) {
                return;
            }
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > slop || dy > slop) {
                clearTimer();
            }
        };

        const onPointerEnd = (e) => {
            if (activePointerId !== null && e.pointerId !== activePointerId) {
                return;
            }
            clearTimer();
        };

        titleEl.addEventListener('pointerdown', onPointerDown);
        titleEl.addEventListener('pointermove', onPointerMove);
        titleEl.addEventListener('pointerup', onPointerEnd);
        titleEl.addEventListener('pointerleave', onPointerEnd);
        titleEl.addEventListener('pointercancel', onPointerEnd);
        titleEl.addEventListener('lostpointercapture', onPointerEnd);
    }


    _startCategoryRename(titleEl, nameSpan, category) {
        const d = this.dash;
        if (titleEl.querySelector('.category-rename-input')) return;

        const originalName = category.name;
        titleEl.classList.add('category-title--renaming');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-rename-input';
        input.value = originalName;
        input.setAttribute('aria-label', d.formatDashboardLabel('renameCategoryAria', {}, 'Rename category'));
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        let done = false;

        const commit = async () => {
            if (done) return;
            done = true;
            titleEl.classList.remove('category-title--renaming');
            const newName = input.value.trim();
            input.replaceWith(nameSpan);
            if (!newName || newName === originalName) {
                nameSpan.textContent = originalName.toLowerCase();
                window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
                return;
            }
            category.name = newName;
            nameSpan.textContent = newName.toLowerCase();
            // Orphan categories (bookmarks referencing a non-existent category ID) are not
            // in d.categories, so the save would skip them. Add the category first.
            if (!d.categories.some(c => String(c.id) === String(category.id))) {
                d.categories.push({ id: category.id, name: newName });
            }
            await this.saveCategoryOrder();
            window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
        };

        const cancel = () => {
            if (done) return;
            done = true;
            titleEl.classList.remove('category-title--renaming');
            input.replaceWith(nameSpan);
            nameSpan.textContent = originalName.toLowerCase();
            window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('blur', commit);
    }


    scheduleBookmarkOrderSave(options = {}) {
        const d = this.dash;
        if (d.pendingReorderSave) {
            clearTimeout(d.pendingReorderSave);
            d.pendingReorderSave = null;
        }

        const successMessage = typeof options.successMessage === 'string' && options.successMessage.trim()
            ? options.successMessage.trim()
            : d.formatDashboardLabel('bookmarkOrderSaved', {}, 'Bookmark order saved.');

        d.pendingReorderSave = setTimeout(() => {
            d.pendingReorderSave = null;
            void d.saveBookmarkOrder({
                successMessage,
                showReorderSavedToast: true
            });
        }, 1000);
    }


    async flushPendingBookmarkSave(options = {}) {
        const d = this.dash;
        if (d.pendingReorderSave) {
            clearTimeout(d.pendingReorderSave);
            d.pendingReorderSave = null;
        }
        if (d.pendingReorderSnapshot) {
            await d.saveBookmarkOrder({
                successMessage: options.successMessage,
                showReorderSavedToast: options.showReorderSavedToast ?? false
            });
            return;
        }
        if (d._bookmarkOrderSaveInFlight) {
            await d._bookmarkOrderSaveInFlight;
        }
    }


    async flushPendingCategorySave() {
        const d = this.dash;
        if (d._pendingCategorySave) {
            clearTimeout(d._pendingCategorySave);
            d._pendingCategorySave = null;
            const pageId = Number(d.currentPageId);
            const payload = (d.categories || []).map((category) => ({ ...category }));
            await this.saveCategoryOrder({ pageId, payload });
            return;
        }
        if (d._categoryOrderSaveInFlight) {
            await d._categoryOrderSaveInFlight;
        }
    }


    undoPendingReorder() {
        const d = this.dash;
        if (!d.pendingReorderSnapshot) {
            return;
        }

        if (d.pendingReorderSave) {
            clearTimeout(d.pendingReorderSave);
            d.pendingReorderSave = null;
        }

        d.bookmarks = [...d.pendingReorderSnapshot];
        d.pendingReorderSnapshot = null;
        this.renderDashboard();
    }


    // Page+category-scoped key for remembering which capped categories the user
    // expanded, mirroring how collapsedCategories keys are scoped.
    _overflowKey(category) {
        const d = this.dash;
        return `${d.currentPageId}:${category.id ?? ''}`;
    }

    _loadExpandedOverflow() {
        const d = this.dash;
        if (d._expandedOverflowCategories) return d._expandedOverflowCategories;
        let parsed = {};
        try {
            const raw = localStorage.getItem('expandedOverflowCategories');
            if (raw) parsed = JSON.parse(raw) || {};
        } catch { parsed = {}; }
        d._expandedOverflowCategories = (parsed && typeof parsed === 'object') ? parsed : {};
        return d._expandedOverflowCategories;
    }

    _saveExpandedOverflow() {
        const d = this.dash;
        try {
            localStorage.setItem('expandedOverflowCategories', JSON.stringify(d._expandedOverflowCategories || {}));
        } catch {
            // localStorage unavailable — state kept in memory only
        }
    }

    /**
     * Cap a category's bookmark list at settings.categoryItemLimit, hiding the
     * overflow rows behind a "show more / show less" toggle. Idempotent: safe to
     * call repeatedly on the same list (the incremental render path re-runs it
     * after patching rows), because it clears any prior marks/button first.
     */
    applyCategoryItemLimit(bookmarksList, category) {
        const d = this.dash;
        if (!bookmarksList) return;

        // Clear previous state so re-runs start clean.
        bookmarksList.querySelectorAll('.bookmark-link.is-overflow-hidden').forEach((row) => {
            row.classList.remove('is-overflow-hidden');
        });
        const existingBtn = bookmarksList.parentElement?.querySelector(':scope > .category-show-more');
        if (existingBtn) existingBtn.remove();
        const staleBtn = bookmarksList.querySelector(':scope > .category-show-more');
        if (staleBtn) staleBtn.remove();

        const limit = Number(d.settings.categoryItemLimit);
        if (!Number.isFinite(limit) || limit <= 0) return;

        const rows = Array.from(bookmarksList.querySelectorAll(':scope > .bookmark-link'));
        if (rows.length <= limit) return;

        const overflowStore = this._loadExpandedOverflow();
        const key = this._overflowKey(category);
        const expanded = overflowStore[key] === true;

        const hiddenCount = rows.length - limit;

        const applyVisibility = () => {
            rows.forEach((row, i) => {
                row.classList.toggle('is-overflow-hidden', !expandedRef.value && i >= limit);
            });
        };
        const expandedRef = { value: expanded };
        applyVisibility();

        const t = (k, fb) => { const v = d.language?.t?.(k); return (v && v !== k) ? v : (fb ?? k); };
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'category-show-more';
        const syncBtnLabel = () => {
            btn.textContent = expandedRef.value
                ? t('dashboard.categoryShowLess', 'show less')
                : t('dashboard.categoryShowMore', '+ {n} more').replace('{n}', String(hiddenCount));
            btn.setAttribute('aria-expanded', expandedRef.value ? 'true' : 'false');
        };
        syncBtnLabel();
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            expandedRef.value = !expandedRef.value;
            const store = this._loadExpandedOverflow();
            if (expandedRef.value) {
                store[key] = true;
            } else {
                delete store[key];
            }
            this._saveExpandedOverflow();
            applyVisibility();
            syncBtnLabel();
        });
        bookmarksList.appendChild(btn);
    }


    createCategoryElement(category, bookmarks) {
        const d = this.dash;
        const animate = d._renderAnimationsEnabled === true;
        const categoryDiv = document.createElement('div');
        const isTagFilterChunk = category.tagFilterChunk === true;
        categoryDiv.className = isTagFilterChunk ? 'category tag-filter-chunk' : 'category';
        if (animate) {
            categoryDiv.classList.add('animate-enter');
        }
        categoryDiv.setAttribute('data-category-id', category.id || '');
        categoryDiv.setAttribute('role', 'rowgroup');
        const isSmartCollection = category.isSmartCollection === true;
        const initialSortMode = window.DashboardCategorySort?.getCategorySortMode(d, category) || 'order';
        if (!isSmartCollection) {
            categoryDiv.setAttribute('data-bookmark-sort', initialSortMode);
        }
        if (isSmartCollection) {
            categoryDiv.setAttribute('data-smart-collection', 'true');
        }
        if (isTagFilterChunk) {
            categoryDiv.setAttribute('data-tag-filter-chunk', 'true');
        }
        const collapsedKey = isSmartCollection
            ? `smart:${category.id}`
            : `${d.currentPageId}:${category.id}`;
        let isCollapsed;
        if (isTagFilterChunk) {
            isCollapsed = false;
        } else if (d.settings.alwaysCollapseCategories) {
            isCollapsed = true;
        } else if (collapsedKey in d.collapsedCategories) {
            isCollapsed = d.collapsedCategories[collapsedKey];
        } else if (!isSmartCollection && category.id in d.collapsedCategories) {
            // Migrate legacy bare-key entry to page-scoped key on first render
            isCollapsed = d.collapsedCategories[category.id];
            d.collapsedCategories[collapsedKey] = isCollapsed;
            delete d.collapsedCategories[category.id];
            d.saveCollapsedStates();
        } else {
            isCollapsed = false;
        }
        categoryDiv.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');

        if (!isTagFilterChunk) {
        // Category title
        const titleElement = document.createElement('h2');
        titleElement.className = isSmartCollection ? 'category-title smart-collection-title' : 'category-title';
        const titleDomId = `category-title-${String(category.id || 'uncategorized').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        titleElement.id = titleDomId;
        categoryDiv.setAttribute('aria-labelledby', titleDomId);
        titleElement.setAttribute('role', 'rowheader');
        titleElement.tabIndex = 0;
        titleElement.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        const categoryIcon = (category.icon || '').trim();
        titleElement.innerHTML = '';

        const labelWrap = document.createElement('span');
        labelWrap.className = 'category-title-label';

        // The "//" prefix. For real categories it doubles as the drag-reorder handle
        // (DragReorder makes it draggable and grabs it via handleSelector); smart
        // collections keep a plain "//" that is not draggable.
        const prefixSpan = document.createElement('span');
        prefixSpan.textContent = '// ';
        prefixSpan.setAttribute('aria-hidden', 'true');
        if (!isSmartCollection) {
            prefixSpan.className = 'category-reorder-handle';
            // Dragging the handle must not toggle collapse or start a rename.
            prefixSpan.addEventListener('click', (e) => e.stopPropagation());
            prefixSpan.addEventListener('mousedown', (e) => e.stopPropagation());
            prefixSpan.addEventListener('dblclick', (e) => e.stopPropagation());
        } else {
            prefixSpan.className = 'category-title-prefix';
        }
        labelWrap.appendChild(prefixSpan);

        const trailingWrap = document.createElement('span');
        trailingWrap.className = 'category-title-trailing';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'category-title-name';
        nameSpan.textContent = category.name.toLowerCase();
        nameSpan.title = category.name;

        if (this.isUploadedCategoryIcon(categoryIcon)) {
            const iconImage = document.createElement('img');
            iconImage.src = `/data/icons/${encodeURIComponent(categoryIcon)}`;
            iconImage.alt = '';
            iconImage.loading = 'lazy';
            iconImage.className = 'bookmark-icon';
            labelWrap.appendChild(iconImage);
            try {
                const currentTheme = document.documentElement.getAttribute('data-theme') || d.settings.theme || 'default';
                const entry = (d.settings.themeIconStyling && d.settings.themeIconStyling[currentTheme]) || { enabled: false };
                if (entry.enabled) {
                    iconImage.classList.add('icon-themed', `icon-themed--${entry.style || 'muted'}`);
                    iconImage.style.setProperty('--icon-theme-intensity', String(entry.intensity || 0.5));
                }
            } catch (e) {
                // ignore
            }
            labelWrap.appendChild(document.createTextNode(' '));
        } else {
            const textIcon = categoryIcon || '▣';
            labelWrap.appendChild(document.createTextNode(`${textIcon} `));
        }
        labelWrap.appendChild(nameSpan);

        if (!isSmartCollection && window.DashboardCategorySort?.createSortControls) {
            trailingWrap.appendChild(window.DashboardCategorySort.createSortControls(d, category, this));
        }

        const chevron = document.createElement('span');
        chevron.className = 'category-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        trailingWrap.appendChild(chevron);

        if (isSmartCollection) {
            const whyHint = d.getSmartCollectionWhyHint(category.id, category);
            if (whyHint) {
                const whyBtn = document.createElement('button');
                whyBtn.type = 'button';
                whyBtn.className = 'smart-collection-why-btn';
                whyBtn.textContent = 'ℹ';
                whyBtn.setAttribute(
                    'aria-label',
                    d.language?.t?.('dashboard.smartWhyAria') || 'Why am I seeing this collection?'
                );
                window.DashboardSmartWhyPopover?.attach?.(whyBtn, whyHint);
                whyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
                trailingWrap.appendChild(whyBtn);
            }
        }

        titleElement.appendChild(labelWrap);
        titleElement.appendChild(trailingWrap);

        const setCategoryCollapsed = (collapsed) => {
            categoryDiv.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
            titleElement.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            d.collapsedCategories[collapsedKey] = collapsed;
            d.saveCollapsedStates();
        };

        titleElement.addEventListener('click', (e) => {
            if (e.target.closest('.category-sort-controls')) {
                return;
            }
            setCategoryCollapsed(categoryDiv.getAttribute('data-collapsed') !== 'true');
        });
        titleElement.addEventListener('keydown', (e) => {
            if (e.target.closest('.category-sort-controls')) {
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCategoryCollapsed(categoryDiv.getAttribute('data-collapsed') !== 'true');
                if (!titleElement.classList.contains('category-title--renaming')) {
                }
            }
        });

        if (!isSmartCollection) {
            this._attachCategoryTitleLongPress(titleElement, nameSpan, category);
            titleElement.addEventListener('dblclick', (e) => {
                if (e.target.closest('.category-sort-controls, .smart-collection-why-btn')) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                this._startCategoryRename(titleElement, nameSpan, category);
            });
        }

        categoryDiv.appendChild(titleElement);
        }

        // Bookmarks list
        const bookmarksList = document.createElement('div');
        bookmarksList.className = 'bookmarks-list';
        const categorySortMode = window.DashboardCategorySort?.getCategorySortMode(d, category) || 'order';
        if (!isSmartCollection && categorySortMode !== 'order') {
            bookmarksList.classList.add('bookmarks-list--sort-active');
        }
        bookmarksList.setAttribute('data-category-id', category.id || '');
        bookmarksList.setAttribute('data-bookmarks-list', 'true');
        bookmarksList.setAttribute('role', 'presentation');
        if (d.settings.showStatus && d.settings.showPing) {
            bookmarksList.setAttribute('data-show-ping', 'true');
        }
        if (isSmartCollection) {
            bookmarksList.setAttribute('data-smart-collection', 'true');
        }

        bookmarks.forEach((bookmark, index) => {
            const bookmarkElement = d.createBookmarkElement(bookmark, category.id || '', true);
            if (animate) {
                bookmarkElement.classList.add('animate-enter');
                bookmarkElement.style.setProperty('--item-index', String(index));
                const bookmarkEnterDelay = (index * ANIM.BOOKMARK_STAGGER_STEP) + ANIM.BOOKMARK_ENTER_BASE;
                setTimeout(() => bookmarkElement.classList.remove('animate-enter'), bookmarkEnterDelay);
            }
            bookmarksList.appendChild(bookmarkElement);
        });

        // Cap long categories: hide rows past the limit behind a "show more" toggle
        // so one big category doesn't tower over the others. Smart collections have
        // their own limits and tag-filter chunks are already split, so skip both.
        if (!isSmartCollection && !isTagFilterChunk) {
            this.applyCategoryItemLimit(bookmarksList, category);
        }

        if (bookmarks.length === 0) {
            const t = (key, fallback) => { const v = d.language?.t?.(key); return (v && v !== key) ? v : (fallback ?? key); };
            if (isSmartCollection) {
                const emptyMessages = {
                    '__smart_today__':     t('dashboard.smartEmptyToday',    'No bookmarks scheduled for today'),
                    '__smart_recent__':    t('dashboard.smartEmptyRecent',   'No bookmarks opened recently'),
                    '__smart_stale__':     t('dashboard.smartEmptyStale',    'No stale bookmarks'),
                    '__smart_most_used__': t('dashboard.smartEmptyMostUsed', 'No bookmarks opened yet'),
                };
                const msg = emptyMessages[category.id] || t('dashboard.smartEmptyGeneric', 'No bookmarks');
                const emptyEl = document.createElement('div');
                emptyEl.className = 'smart-collection-empty';
                emptyEl.textContent = msg;
                bookmarksList.appendChild(emptyEl);
            } else if (!isTagFilterChunk) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'empty-state--category';
                const textSpan = document.createElement('span');
                textSpan.className = 'empty-state--category-text';
                textSpan.textContent = t('dashboard.emptyCategoryText', 'no bookmarks');
                const addBtn = document.createElement('button');
                addBtn.type = 'button';
                addBtn.className = 'empty-state--category-btn';
                addBtn.textContent = t('dashboard.emptyStateAddAction', '+ bookmark');
                emptyEl.appendChild(textSpan);
                emptyEl.appendChild(addBtn);
                addBtn.addEventListener('click', () => {
                    window.dashboardInstance?.quickAddWidget?.open();
                });
                bookmarksList.appendChild(emptyEl);
            }
        }

        const categoryBody = document.createElement('div');
        categoryBody.className = 'category-body';
        categoryBody.appendChild(bookmarksList);
        categoryDiv.appendChild(categoryBody);
        return categoryDiv;
    }


    isUploadedCategoryIcon(iconValue) {
        const d = this.dash;
        return typeof iconValue === 'string' && /\.[a-z0-9]+$/i.test(iconValue);
    }

}

window.DashboardRenderCore = DashboardRenderCore;
