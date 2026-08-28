/**
 * Dashboard grid render, categories, reorder.
 */
class DashboardRenderCore {
    constructor(dashboard) {
        this.dash = dashboard;
    }

    shouldStackDashboardCategories() {
        return (
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(max-width: 767px)').matches
        );
    }


    getEffectiveColumnsPerRow() {
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
        // #dashboard-layout is shared with inbox, health and config, and the
        // className assignment below is a replace, not an add — running this
        // while one of those is on screen strips its layout class and re-roles
        // the container as a grid, scattering the view's children across
        // columns. Guarded here rather than only at the call sites so a new
        // caller cannot reintroduce the bug: every path that legitimately needs
        // the grid re-synced runs while the bookmarks view is up.
        if (typeof d.isBookmarksView === 'function' && !d.isBookmarksView()) {
            return null;
        }

        const configuredColCount = this.getNormalizedColumnsPerRow();
        d.settings.columnsPerRow = configuredColCount;
        const colCount = this.getEffectiveColumnsPerRow();
        const packed = this.shouldPackDashboardColumns();
        const packedClass = packed ? ' packed-columns' : '';

        // The masonry shape has to survive this assignment. className is a
        // replace, and every settings refresh runs through here — including the
        // one behind a window resize. Losing the class left the categories as
        // bare flex children of a row that no longer had columns in it: a dozen
        // categories squeezed side by side, each a few characters wide.
        const masonryClass = packed && grid.classList.contains('packed-masonry') ? ' packed-masonry' : '';
        grid.className = `dashboard-grid columns-${colCount} layout-${d.settings.layoutPreset || 'default'} density-${d.settings.densityMode || 'compact'}${packedClass}${masonryClass}`;
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
        if (!container || !columnBlocks.length) {
            return;
        }

        const colCount = gridLayout?.colCount ?? this.getEffectiveColumnsPerRow();
        const shouldPackColumns = gridLayout?.packed ?? this.shouldPackDashboardColumns();

        if (shouldPackColumns) {
            this._distributePackedColumns(container, columnBlocks, { animate, colCount });
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


    /**
     * Packed layout, in one of two shapes.
     *
     * Packed columns exists so categories of unequal height sit against each
     * other instead of every grid row growing to its tallest member. It does
     * that by filling a fixed set of columns round-robin — category 1 in column
     * 1, category 2 in column 2 — which is cheap, stable, and the reason a
     * category could never be wider than the column it sits in.
     *
     * So while nothing is wider than one column, that is exactly what happens:
     * the layout below is the one this mode has always had.
     *
     * A category set wider changes the problem. Breaking the row into bands was
     * tried and left a hole the height of the tallest column beside the wide
     * block. Instead the whole page switches to a grid: every category spans as
     * many short rows as it is tall and `grid-auto-flow: dense` fills what is
     * left, so a wide block takes its columns wherever it fits and the ones
     * after it carry on beside and beneath it.
     *
     * Two shapes, one switch, and one reader (below) that tells them apart by
     * what is actually in the DOM rather than by asking the settings again.
     */
    _distributePackedColumns(container, columnBlocks, { animate = false, colCount = 1 } = {}) {
        const spanOf = (el) => window.DashboardCategorySpan?.effectiveSpanFromElement(el) || 1;
        const anyWide = columnBlocks.some((el) => spanOf(el) > 1);

        const stagger = (el, i) => {
            if (!animate) {
                return;
            }
            el.style.setProperty('--stagger-index', String(i));
            const categoryEnterDelay = (i * ANIM.CATEGORY_STAGGER_STEP) + ANIM.CATEGORY_ENTER_BASE;
            setTimeout(() => el.classList.remove('animate-enter'), categoryEnterDelay);
        };

        container.classList.toggle('packed-masonry', anyWide);

        if (anyWide) {
            columnBlocks.forEach((el, i) => {
                stagger(el, i);
                container.appendChild(el);
            });
            // Heights can only be measured once the elements are in the
            // document, so the packing is a step after the layout, not part of
            // it. The observer keeps it true as categories grow and shrink.
            window.DashboardPackedMasonry?.observe(container);
            return;
        }

        window.DashboardPackedMasonry?.disconnect();
        const columns = Array.from({ length: colCount }, () => {
            const col = document.createElement('div');
            col.className = 'dashboard-column';
            return col;
        });
        columnBlocks.forEach((el, i) => {
            stagger(el, i);
            columns[i % colCount].appendChild(el);
        });
        columns.forEach((col) => container.appendChild(col));
    }

    /**
     * The rendered categories, in the order they are stored in.
     *
     * Keyed on what the DOM holds, not on the settings: columns mean the
     * round-robin layout and have to be read back round-robin, anything else is
     * already in order. That is what keeps the two shapes from drifting apart —
     * a reader that asked the settings could be told one thing while looking at
     * the other.
     *
     * It used to exist twice and the two disagreed: the incremental render read
     * packed columns round-robin (correctly), while the drag-and-drop sync read
     * them in plain document order — column by column. Since those are not each
     * other's inverse, every category drag in packed mode rewrote the order into
     * one that redistributed differently, and the arrangement scrambled.
     */
    readCategoryElementsInOrder(container) {
        if (!container) {
            return [];
        }
        const columns = Array.from(container.querySelectorAll(':scope > .dashboard-column'));
        if (!columns.length) {
            return Array.from(container.querySelectorAll(':scope > .category[data-category-id]'));
        }

        const perColumn = columns.map((col) => Array.from(col.querySelectorAll(':scope > .category[data-category-id]')));
        const rows = Math.max(...perColumn.map((items) => items.length), 0);
        const ordered = [];
        for (let row = 0; row < rows; row += 1) {
            perColumn.forEach((items) => {
                if (items[row]) {
                    ordered.push(items[row]);
                }
            });
        }
        return ordered;
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
            d.formatDashboardLabel('tagFilterGridLabel', {}, 'Filtered bookmarks')
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

        /*
         * Widgets are blocks like any other, so they go in this same list.
         *
         * Pushed before the categories rather than after, because the stored
         * order sorts everything at the end -- and what happens to a widget the
         * order does not name should be "it appears", not "it appears last for
         * ever". Anything not in the order keeps the position it is pushed in.
         */
        (d.widgets || []).forEach((widget) => {
            // Switched off: kept in the order and out of the grid, so turning it
            // back on returns it to the place the reader put it rather than to
            // the end.
            if (widget?.config?.enabled === false) return;
            columnBlocks.push({
                widget,
                category: {
                    id: widget.id,
                    name: widget.title || '',
                    isWidget: true,
                },
                bookmarks: [],
            });
        });

        d.categories.forEach((category) => {
            const id = String(category.id);
            const categoryBookmarks = this.sortBookmarks(groupedBookmarks[id] || [], category);
            // A category the user just made is empty by definition, so "hide empty
            // categories" would swallow it and the create would read as a no-op.
            // It stays visible until something is filed in it or the page is left.
            const justCreated = d.pinnedEmptyCategoryId != null
                && String(d.pinnedEmptyCategoryId) === id;
            if (d.settings.hideEmptyCategories && categoryBookmarks.length === 0 && !justCreated) {
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

        return this.applyBlockOrder(columnBlocks);
    }

    /*
     * One widget, as a block in the grid.
     *
     * Built with the same outer element and classes a category block uses, for
     * two reasons that are really one: the masonry layout measures blocks by
     * those classes, and DragReorder finds them by them. A widget that looked
     * different from the outside would need its own answer to both.
     *
     * The body is rendered by whatever handles that type, or left as a notice
     * when nothing does -- a block that draws nothing at all is a hole in the
     * grid with no way to select or remove it.
     */
    createWidgetElement(widget) {
        const d = this.dash;
        const block = document.createElement('div');
        // `.category` deliberately: the masonry layout measures blocks by that
        // class and DragReorder selects by it, so a widget that called itself
        // something else would need its own answer to both. The second class is
        // what the styling and the block builder tell them apart by.
        block.className = 'category dashboard-widget';
        // A rowgroup like the category block beside it: the header below is a
        // rowheader, and the grid around them expects the pair.
        block.setAttribute('role', 'rowgroup');
        block.dataset.categoryId = widget.id;
        block.dataset.widgetId = widget.id;
        block.dataset.widgetType = widget.type || '';

        /*
         * How wide this widget is drawn.
         *
         * Two at most: a widget is a summary, and one wide enough to need three
         * columns is a view that has not admitted it yet. The block already
         * carries the `category` class, so it reuses the span rule the grid has
         * for a wide category rather than growing a second way to be wide.
         *
         * A dashboard showing one column has nothing to spread into, so the
         * widget falls back to that one column rather than disappearing —
         * which is what a category does in the same situation, and the setting
         * lives on a screen nobody opens on the phone where it would bite.
         */
        const span = this.widgetColumnSpan(widget);
        block.classList.toggle('category--wide', span > 1);
        if (span > 1) {
            block.style.setProperty('--category-span', String(span));
        } else {
            block.style.removeProperty('--category-span');
        }

        /*
         * The header, built exactly as a category's is.
         *
         * Not approximately: an h2.category-title holding a
         * .category-title-label, whose "// " prefix is itself the drag handle --
         * that is what DragReorder's handleSelector grabs, and it is what makes
         * a widget feel like the blocks beside it rather than something bolted
         * on. A div with the right class name looked similar and inherited none
         * of the type, the spacing or the grab cursor.
         */
        const title = document.createElement('h2');
        title.className = 'category-title';

        const labelWrap = document.createElement('span');
        labelWrap.className = 'category-title-label';

        const prefix = document.createElement('span');
        prefix.className = 'category-reorder-handle';
        prefix.textContent = '// ';
        prefix.setAttribute('aria-hidden', 'true');
        // Dragging the handle must not do whatever clicking the header does.
        prefix.addEventListener('click', (e) => e.stopPropagation());
        prefix.addEventListener('mousedown', (e) => e.stopPropagation());
        labelWrap.appendChild(prefix);

        const name = document.createElement('span');
        name.className = 'category-title-name';
        const label = widget.title || this.widgetTypeLabel(widget.type);
        // Lower-cased like every other block title, so one heading in the grid
        // does not shout.
        name.textContent = String(label).toLowerCase();
        name.title = label;
        labelWrap.appendChild(name);

        title.appendChild(labelWrap);

        /*
         * Collapsing, on the same terms as a category.
         *
         * A widget is a summary, and a dashboard carrying several of them has
         * the same problem a dashboard of long categories has: the block you
         * want is below the fold because the ones above it are open. The state
         * lives in the same `collapsedCategories` map under the same page-scoped
         * key, because the block already calls itself a category to the grid and
         * to DragReorder -- a second store would be a second thing to prune when
         * a page is deleted, and staleCollapsedKeys already prunes this one.
         *
         * Widget ids are prefixed `w_`, so they cannot collide with a category
         * id in that map.
         */
        const collapsedKey = `${d.currentPageId}:${widget.id}`;
        const isCollapsed = d.collapsedCategories?.[collapsedKey] === true;
        block.setAttribute('data-collapsed', isCollapsed ? 'true' : 'false');

        const titleDomId = `widget-title-${String(widget.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        title.id = titleDomId;
        block.setAttribute('aria-labelledby', titleDomId);
        title.setAttribute('role', 'rowheader');
        title.tabIndex = 0;
        title.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');

        const trailingWrap = document.createElement('span');
        trailingWrap.className = 'category-title-trailing';
        const chevron = document.createElement('span');
        chevron.className = 'category-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        trailingWrap.appendChild(chevron);
        title.appendChild(trailingWrap);

        const setWidgetCollapsed = (collapsed) => {
            block.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
            title.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            if (!d.collapsedCategories || typeof d.collapsedCategories !== 'object') {
                d.collapsedCategories = {};
            }
            d.collapsedCategories[collapsedKey] = collapsed;
            d.saveCollapsedStates();
        };

        title.addEventListener('click', () => {
            setWidgetCollapsed(block.getAttribute('data-collapsed') !== 'true');
        });
        /*
         * The header's keys, the category's keys.
         *
         * Fold on Enter or Space, rename on F2, close on Delete, and the menu
         * on Shift+F10 or the Menu key -- the same keys a category header
         * answers to, because a reader who has learned them there has learned
         * them for every block on the page. Shift+W for the width is not here:
         * it is answered where the category's is, in keyboard-navigation.js,
         * which sees the key first and would otherwise swallow it.
         */
        title.addEventListener('keydown', (e) => {
            const menu = d.categoryMenu;
            // Nothing here acts while the header is being renamed: the input
            // sits inside this element, so every key typed into it bubbles out
            // to here -- and Delete would then close the widget mid-rename.
            if (e.target.closest('input, textarea')) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setWidgetCollapsed(block.getAttribute('data-collapsed') !== 'true');
                return;
            }
            if (e.key === 'F2' && !title.classList.contains('category-title--renaming')) {
                e.preventDefault();
                menu?.startWidgetRename?.(title, widget);
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                void menu?.closeWidget?.(widget);
                return;
            }
            if (e.key === 'F10' && e.shiftKey) {
                e.preventDefault();
                const box = title.getBoundingClientRect();
                menu?.showWidget?.(title, widget, { x: box.left + 8, y: box.bottom });
            }
        });
        // Renaming, by the two pointer gestures a category header answers to.
        // The long press blocks the click it ends with, so holding the header
        // renames instead of folding it.
        this._attachBlockTitleLongPress(title, () => d.categoryMenu?.startWidgetRename?.(title, widget));
        title.addEventListener('dblclick', (e) => {
            if (e.target.closest('.category-reorder-handle')) return;
            e.preventDefault();
            e.stopPropagation();
            d.categoryMenu?.startWidgetRename?.(title, widget);
        });

        block.appendChild(title);

        const body = document.createElement('div');
        body.className = 'dashboard-widget-body';
        /*
         * Presentation, deliberately.
         *
         * What a widget draws is figures and buttons, not rows of a grid, and
         * the keyboard stops inside it are those buttons themselves. Leaving the
         * subtree in the grid's structure would have a screen reader announce
         * them as cells of a table that does not exist -- the bookmark list
         * under a category does the same thing for the same reason.
         */
        body.setAttribute('role', 'presentation');
        const renderer = window.DashboardWidgets?.[widget.type];
        if (typeof renderer === 'function') {
            renderer(body, widget, d);
        } else {
            body.textContent = d.language?.t?.('dashboard.widgetUnknown') || 'This widget is not available.';
            body.classList.add('dashboard-widget-body--empty');
        }

        // Wrapped in the same .category-body a category uses, so the collapse
        // animation is the one already written rather than a second one that
        // would have to be kept in step with it. refreshWidgets still finds the
        // body by its own class and redraws into it.
        const bodyWrap = document.createElement('div');
        bodyWrap.className = 'category-body';
        bodyWrap.appendChild(body);
        block.appendChild(bodyWrap);
        d.categoryMenu?.bindWidget?.(block, widget);
        return block;
    }

    /*
     * Redraw the widgets of one type, in place.
     *
     * Called when the data behind a widget arrives -- the health report lands
     * after the first paint -- so it fills in rather than the whole grid being
     * rebuilt for one block. A full render here would also throw away the
     * DragReorder instances mid-drag.
     */
    /*
     * Forget what the widgets cached, so the next draw asks again.
     *
     * The tiles that fetch keep their answer on the dashboard object: sources
     * runs hourly, the trend is a day's granularity, and re-fetching per render
     * would be traffic for figures that cannot have changed. That is right
     * while nothing changes and wrong the moment someone adds or edits a widget
     * in config — the tile would redraw from the answer it had before the
     * settings existed, and read as though the change did nothing.
     *
     * Cleared by name rather than by a general "clear everything": each of
     * these belongs to one tile, and a tile that starts caching something else
     * has to say so here.
     */
    forgetWidgetCaches() {
        const d = this.dash;
        delete d._widgetSources;
        delete d._widgetFeeds;
        delete d._widgetTrend;
        delete d._widgetInbox;
        delete d._widgetTrash;
        delete d._widgetDuplicates;
        delete d._widgetBackups;
    }

    refreshWidgets(type) {
        const d = this.dash;
        /*
         * Where the keyboard was, before the rows it was on are replaced.
         *
         * The badge's report lands every few seconds on an install that
         * monitors anything, and each arrival redraws these bodies -- so a
         * reader sitting on a row inside a tile lost the cursor to a refresh
         * they never asked for, and the next arrow key started over at the top
         * of the grid. The row objects cannot survive the redraw; their place
         * in the tile can.
         */
        const cursor = d.keyboardNavigation?.captureWidgetCursor?.() || null;
        document.querySelectorAll(`.dashboard-widget[data-widget-type="${CSS.escape(String(type))}"]`)
            .forEach((block) => {
                const widget = (d.widgets || []).find((w) => w.id === block.dataset.widgetId);
                const body = block.querySelector('.dashboard-widget-body');
                const renderer = window.DashboardWidgets?.[type];
                if (!widget || !body || typeof renderer !== 'function') return;
                body.classList.remove('dashboard-widget-body--empty');
                renderer(body, widget, d);
            });
        if (cursor) d.keyboardNavigation?.restoreWidgetCursor?.(cursor);
    }

    /**
     * The columns this widget may occupy, bounded by what the grid has.
     *
     * Never more than two, and never more than the dashboard is showing: at one
     * column the answer is one, so the widget narrows instead of vanishing.
     */
    widgetColumnSpan(widget) {
        const asked = Number(widget?.config?.columns);
        if (!Number.isFinite(asked) || asked <= 1) return 1;
        const available = Number(this.getEffectiveColumnsPerRow?.()) || 1;
        return Math.max(1, Math.min(2, Math.trunc(asked), available));
    }

    /** A readable name for a type, for a widget with no title of its own. */
    widgetTypeLabel(type) {
        const d = this.dash;
        const key = `dashboard.widgetType.${type}`;
        const label = d.language?.t?.(key);
        return label && label !== key ? label : String(type || 'widget');
    }

    /*
     * Put the blocks in the order the reader arranged them.
     *
     * The stored order is a single list of ids -- categories and widgets
     * together -- because a widget that could only be ordered among widgets
     * could never sit between two categories, which is the whole point of it
     * being a block.
     *
     * Three things this must not do, each of which would be worse than an
     * unordered grid: lose a block the order does not mention, draw one twice,
     * or move the smart collections, which have no handle and belong at the top.
     */
    applyBlockOrder(blocks) {
        const order = this.dash.blockOrder;
        if (!Array.isArray(order) || order.length === 0) return blocks;

        // Smart collections and the virtual categories keep their position:
        // they are not the reader's to arrange.
        const fixed = blocks.filter((b) => b.category?.isSmartCollection || b.category?.isVirtualCategory);
        const movable = blocks.filter((b) => !b.category?.isSmartCollection && !b.category?.isVirtualCategory);

        const byId = new Map();
        movable.forEach((block) => byId.set(String(block.category?.id ?? ''), block));

        const sorted = [];
        order.forEach((id) => {
            const block = byId.get(String(id));
            if (!block) return;
            byId.delete(String(id));
            sorted.push(block);
        });
        // Whatever the order did not name keeps its own order, after the rest --
        // a category added since the last drag appears rather than vanishing.
        byId.forEach((block) => sorted.push(block));

        return [...fixed, ...sorted];
    }


    renderDashboard(options = {}) {
        const d = this.dash;
        this.pruneStaleCategoryViewState();
        const blockForInlineEdit = d.isInlineEditActive() && options.despiteModal !== true;
        if (d.activeView === 'inbox' && d.inbox?.isEnabled?.()) {
            d.data?.schedulePageBookmarksHealIfNeeded?.();
            if (blockForInlineEdit) {
                return;
            }
            d.inbox.render();
            return;
        }
        if (d.activeView === 'health' && d.health?.isEnabled?.()) {
            d.data?.schedulePageBookmarksHealIfNeeded?.();
            if (blockForInlineEdit) {
                return;
            }
            d.health.render();
            return;
        }
        if (d.activeView === 'config' && d.config?.isEnabled?.()) {
            if (blockForInlineEdit) {
                return;
            }
            d.config.render();
            return;
        }
        // A view whose feature is switched off falls back to bookmarks rather
        // than rendering nothing.
        if (d.activeView !== 'bookmarks') {
            d.setActiveView('bookmarks');
        }
        d.data?.schedulePageBookmarksHealIfNeeded?.();
        if (blockForInlineEdit) {
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
            // The incremental path rebuilds rows too, so the selection needs the
            // same repaint the full render gets below. This is the common route
            // — most mutations never reach the full rebuild.
            d.multiSelect?.prune();
            return;
        }
        const animate = options && options.animate === true;
        d._renderAnimationsEnabled = animate;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;
        container.classList.remove('inbox-layout', 'health-layout', 'config-layout');

        d._abortInlineEditForRender();
        window.DashboardSmartWhyPopover?.hide?.();

        if (d.hasActiveTagFilters()) {
            d._categoryListsCache = null;
            d.renderTagFilterDashboard(container, options);
            // After the render, not before: the indicator hides itself when the
            // grid's own banner is on screen, and that banner is built in there.
            d.updateTagFilterIndicator();
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
            block.widget
                ? this.createWidgetElement(block.widget)
                : this.createCategoryElement(block.category, block.bookmarks)
        ));

        const gridLayout = this.syncDashboardGridLayout();
        this._distributeDashboardColumnBlocks(container, columnBlocks, { animate, gridLayout });
        // After layout: the "+" goes in whichever header ends the grid, and that
        // depends on how the columns packed, not on the order of the blocks.
        d.categoryAdd?.placeTrigger(container);

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
        // A render replaces every row element, so the selection has to be
        // repainted onto the new nodes and any key that no longer matches a
        // bookmark dropped.
        d.multiSelect?.prune();
        
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
        // Measured, so it has to wait for the rows to be laid out.
        requestAnimationFrame(() => window.DashboardCategorySpan?.syncWideColumnTracks(container));
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

        // 'opened' was called 'recent', which Config used for createdAt under
        // the label "Recently added" — the same word meaning two things in two
        // surfaces of the same app. normalizeSortMode still accepts the old
        // value, so stored categories keep working.
        if (method === 'opened') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0))
            ];
        }

        // createdAt was written on every create path and read by nothing.
        if (method === 'added') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0))
            ];
        }

        if (method === 'opens') {
            return [
                ...pinned,
                ...regular.sort((a, b) => (b?.openCount || 0) - (a?.openCount || 0))
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
                    window.nextdashTrack?.('bookmark:reorder');
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

        const modeLabel = {
            opened: d.formatDashboardLabel('sortModeRecent', {}, 'Recent'),
            added: d.formatDashboardLabel('sortModeAdded', {}, 'Newest'),
            opens: d.formatDashboardLabel('sortModeOpens', {}, 'Most opened'),
        }[sortMode] || d.formatDashboardLabel('sortModeAZ', {}, 'A–Z');
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

        // Columns in the DOM, not the setting: packed switches to a plain grid
        // as soon as a category is wider than one column, and that shape wants
        // the single-container reorder the plain layout uses.
        const isPacked = grid.querySelector(':scope > .dashboard-column') !== null;
        const onReorder = () => {
            // Small delay so the DOM is fully settled after touch/mouse drag ends
            requestAnimationFrame(() => {
                this.syncCategoriesFromDom();
                // Round-robin is redistributed from the new order rather than
                // left as the drag dropped it: the drag moved one element
                // between columns, while the order it produced fills them in a
                // different arrangement entirely.
                if (isPacked) {
                    d.renderDashboard?.({ animate: false, forceFull: true });
                }
            });
        };

        if (isPacked) {
            // Multiple column containers: a document-level drag-over relay moves the
            // dragged category across columns; per-item dragover is delegated to it.
            //
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
        // Through the shared reader, not document order: in packed mode those
        // two are different, and document order is the wrong one.
        const els = this.readCategoryElementsInOrder(grid)
            .filter((el) => el.getAttribute('data-smart-collection') !== 'true');
        // Every block that moved, widgets included -- this is what blockOrder is
        // built from below.
        const blockIds = els.map((el) => el.getAttribute('data-category-id')).filter(Boolean);
        /*
         * Categories only, for the category array.
         *
         * A widget id landing in d.categories would be written back to
         * /api/categories as a category that does not exist, and the next load
         * would find a bookmark-less category with a w_ slug in it.
         */
        const newIds = els
            .filter((el) => !el.classList.contains('dashboard-widget'))
            .map((el) => el.getAttribute('data-category-id'))
            .filter(Boolean);

        if (!blockIds.length) return;

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
            // No categories moved -- a widget did. Save that and leave the
            // category array alone rather than returning and losing the drag.
            d.blockOrder = blockIds;
            this.scheduleBlockOrderSave();
            return;
        }

        d.categories = newCategories;
        d.blockOrder = this.mergeBlockOrderFromDom(blockIds);
        this.scheduleBlockOrderSave();
    }

    /*
     * The new order, with the blocks that are not on screen kept in place.
     *
     * The DOM is the right source for what moved -- it is where the drag
     * happened -- but it is not the whole list. A category with no bookmarks in
     * it is not rendered at all under "hide empty categories", and a smart
     * collection is rendered but is not the reader's to arrange. Writing the
     * DOM order as the complete order therefore did two wrong things at once:
     * it dropped the unrendered categories to the end, and every block after
     * them shifted -- which is why a widget dropped in second place came back
     * fourth.
     *
     * So the DOM decides the order of what it holds, and everything else keeps
     * its position relative to the block it used to follow.
     */
    mergeBlockOrderFromDom(domIds) {
        const previous = Array.isArray(this.dash.blockOrder) ? this.dash.blockOrder : [];
        if (!domIds.length) return previous;

        const onScreen = new Set(domIds);
        const merged = [];
        let cursor = 0;

        previous.forEach((id) => {
            if (onScreen.has(id)) {
                // Take the next one the DOM has, which is what the drag decided.
                if (cursor < domIds.length) merged.push(domIds[cursor++]);
                return;
            }
            // Not rendered -- an empty category, say. It keeps the slot it had
            // rather than being pushed to the end.
            merged.push(id);
        });

        // Anything the DOM holds that the previous order did not know about,
        // and anything left over: appended rather than lost.
        while (cursor < domIds.length) merged.push(domIds[cursor++]);

        const seen = new Set();
        return merged.filter((id) => {
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    }

    /*
     * Move one block one place, for the keyboard.
     *
     * Works on blockOrder rather than on the category array, so a keyboard move
     * and a drag write the same thing. Steps over the blocks the reader cannot
     * arrange -- a smart collection is drawn at the top whatever the order says,
     * so swapping with one would look like the key did nothing.
     */
    moveBlockInOrder(id, direction) {
        const d = this.dash;
        const order = [...(d.blockOrder || [])];
        const from = order.indexOf(String(id));
        if (from < 0) return false;
        const to = from + (direction < 0 ? -1 : 1);
        if (to < 0 || to >= order.length) return false;

        [order[from], order[to]] = [order[to], order[from]];
        d.blockOrder = order;
        this.scheduleBlockOrderSave();
        return true;
    }

    /*
     * Persist the block order, debounced like the category order beside it.     *
     * Its own timer rather than riding along with the category save: the two
     * write different files' worth of state through different routes, and a
     * failure in one should not swallow the other.
     */
    scheduleBlockOrderSave() {
        const d = this.dash;
        if (d._pendingBlockOrderSave) clearTimeout(d._pendingBlockOrderSave);
        d._pendingBlockOrderSave = setTimeout(() => {
            d._pendingBlockOrderSave = null;
            void this.saveBlockOrder(Number(d.currentPageId), [...(d.blockOrder || [])]);
        }, 1000);
    }

    /*
     * One widget changed on the dashboard: write it, and keep config in step.
     *
     * The dashboard can now rename a widget, set its width and close it from
     * the header, which used to be three trips through Config -> Widgets. All
     * three land here so there is one place that knows how a widget is written
     * from the grid.
     *
     * Only `widgets` goes on the wire, the way saveBlockOrder sends only
     * `order`: the handler keeps whichever half it is not given, so a drag
     * whose debounce is still running is not undone by this write and vice
     * versa.
     *
     * Returns false when nothing was saved, with the change already rolled back
     * -- a caller that has drawn the new state optimistically has to put the old
     * one back, and every one of them does.
     */
    async saveWidgetPatch(widgetId, patch) {
        const d = this.dash;
        const pageId = Number(d.currentPageId);
        const widgets = Array.isArray(d.widgets) ? d.widgets : [];
        const index = widgets.findIndex((w) => String(w?.id) === String(widgetId));
        if (!Number.isFinite(pageId) || index < 0) return false;

        const before = widgets[index];
        const next = { ...before };
        if ('title' in patch) next.title = String(patch.title ?? '');
        if (patch.config) {
            const config = { ...(before.config || {}), ...patch.config };
            // undefined means "back to the default", and the default is the key
            // being absent -- the same thing the config panel writes.
            Object.keys(patch.config).forEach((key) => {
                if (patch.config[key] === undefined) delete config[key];
            });
            next.config = config;
        }
        widgets[index] = next;
        d.widgets = widgets;

        try {
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = { 'Content-Type': 'application/json' };
            if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
            const res = await fetcher(`/api/pages/${pageId}/blocks`, {
                method: 'PUT', headers, body: JSON.stringify({ widgets }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
        } catch (_error) {
            widgets[index] = before;
            // Only when this is still the page being looked at. The reader can
            // change page while the write is in flight, and d.widgets is then
            // the new page's -- putting the old array back would hand one page
            // the other's blocks, which is worse than the failed edit.
            if (this.onSamePage(pageId)) d.widgets = widgets;
            d.showErrorNotification?.(d.formatDashboardLabel?.('widgetSaveFailed', {},
                'Could not save the widget.') || 'Could not save the widget.');
            return false;
        }

        // Same reason: blockOrder belongs to whichever page is loaded now, and
        // writing it under this page's id would cache an order from elsewhere.
        if (this.onSamePage(pageId)) {
            d.data?.updatePageDataCache?.(pageId, { blocks: { widgets, order: d.blockOrder || [] } });
        }
        this.forgetWidgetConfigCache();
        return true;
    }

    /*
     * Redraw the grid without moving the page under the reader.
     *
     * A widget changing width or leaving the page reflows every block after it,
     * so the draw has to be a full one -- and a full draw starts at the top of
     * the document with a scroll position of zero. The reader was looking at a
     * widget halfway down; putting the scroll back is what makes the change
     * happen where they are looking instead of sending them back up to find it.
     *
     * Focus is restored too, so Shift+W twice in a row acts on the same header
     * rather than on nothing the second time. Written by hand rather than
     * through scrollIntoView: the reader's offset is the thing to preserve, not
     * the block's position in the viewport.
     */
    redrawKeepingPlace(blockId) {
        const d = this.dash;
        const selector = blockId
            ? `#dashboard-layout .category[data-category-id="${CSS.escape(String(blockId))}"]`
            : null;
        const before = selector ? document.querySelector(selector) : null;
        const hadFocus = before ? document.activeElement?.closest?.(selector) != null : false;
        const scrollY = window.scrollY || 0;
        // Where the block sat in the viewport, which is the thing to keep. The
        // absolute offset alone is not enough: the blocks after this one reflow,
        // so the same offset can put a different part of the page under the
        // reader's eyes.
        const anchorTop = before ? before.getBoundingClientRect().top : null;

        d.renderDashboard?.({ animate: false, forceFull: true });

        // Returns whether it had to move anything, which is what tells the
        // caller the layout is still settling.
        const settle = () => {
            const el = selector ? document.querySelector(selector) : null;
            let moved = false;
            if (el && anchorTop !== null) {
                const drift = el.getBoundingClientRect().top - anchorTop;
                if (Math.abs(drift) > 1) {
                    window.scrollBy({ top: drift, behavior: 'instant' });
                    moved = true;
                }
            } else if (Math.abs((window.scrollY || 0) - scrollY) > 1) {
                // The block is gone -- it was just closed -- so the offset is
                // all there is to go on.
                window.scrollTo({ top: scrollY, behavior: 'instant' });
                moved = true;
            }
            if (hadFocus) {
                el?.querySelector('.category-title')?.focus({ preventScroll: true });
            }
            return moved;
        };

        /*
         * Once now, then every frame until the page stops moving.
         *
         * The grid is masonry and packed mode positions its blocks inside a
         * requestAnimationFrame, so right after the draw the document is a
         * different height than it will be a frame or two later -- and a browser
         * clamps the scroll to whatever fits in the meantime. Correcting only
         * once writes a position the page is about to outgrow, which is the jump
         * the reader sees. So the correction repeats while it still finds drift,
         * and stops as soon as it does not.
         *
         * Bounded, because a layout that never settles must not turn into a
         * scroll that never stops. In the test fixture the first pass is enough
         * on both the plain grid and in packed mode; the loop is here for the
         * pages where it is not, and costs a single measurement when it is.
         */
        settle();
        let attempts = 0;
        const again = () => {
            if (attempts >= 6 || !settle()) return;
            attempts += 1;
            requestAnimationFrame(again);
        };
        requestAnimationFrame(again);
    }

    /** Whether the dashboard still shows the page a write started on. */
    onSamePage(pageId) {
        return Number(this.dash.currentPageId) === Number(pageId);
    }

    /*
     * Drop what Config -> Widgets is holding, so it reloads.
     *
     * That panel skips its fetch while `_widgetLoadedFor` still names the page
     * it has -- which is what makes it fast, and what would otherwise show the
     * reader the rows as they were before this change. Opening config is the
     * moment the answer has to be right, and it cannot know a write happened
     * here.
     */
    forgetWidgetConfigCache() {
        const config = this.dash.config?.instance || this.dash.config;
        if (!config) return;
        config._widgetBlocks = null;
        config._widgetLoadedFor = null;
    }

    async saveBlockOrder(pageId, order) {
        if (!Number.isFinite(pageId) || !Array.isArray(order) || order.length === 0) return;
        try {
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const headers = { 'Content-Type': 'application/json' };
            if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
            // Only the order: the widgets themselves did not change, and sending
            // a stale copy of them would undo an edit made while this was
            // waiting out its debounce.
            await fetcher(`/api/pages/${pageId}/blocks`, {
                method: 'PUT', headers, body: JSON.stringify({ order }),
            });
        } catch {
            // The order on screen is what the reader arranged; a failed save
            // means the next load reverts it, which is visible and recoverable.
            // Interrupting a drag with an error is not.
        }
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
        this._attachBlockTitleLongPress(titleEl, () => this._startCategoryRename(titleEl, nameSpan, category));
    }

    /*
     * Hold the header to rename it, for a category and for a widget alike.
     *
     * The gesture is the whole of what is shared -- the timer, the movement
     * slop, the parts of the header that must not arm it, and the one-shot
     * click blocker that stops the press from also folding the block. What is
     * renamed is the caller's business.
     */
    _attachBlockTitleLongPress(titleEl, startRename) {
        const longMs = window.DashboardInlineEditLoader?.ROW_LONG_PRESS_MS
            ?? window.DashboardInlineEdit?.ROW_LONG_PRESS_MS ?? 500;
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
                startRename();
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
        // Uncategorized and orphan headers are synthesized views, not stored
        // categories (see the category-menu's identical guard) — renaming one
        // would fabricate a real category from a virtual one.
        if (category?.isVirtualCategory) return;

        this._startBlockRename(titleEl, nameSpan, {
            value: category.name,
            ariaKey: 'renameCategoryAria',
            ariaFallback: 'Rename category',
            // A category has to be called something: an empty name would leave a
            // header with nothing in it and a category nothing can name.
            allowEmpty: false,
            onCommit: async (newName) => {
                category.name = newName;
                // Orphan categories (bookmarks referencing a non-existent category ID) are not
                // in d.categories, so the save would skip them. Add the category first.
                if (!d.categories.some(c => String(c.id) === String(category.id))) {
                    d.categories.push({ id: category.id, name: newName });
                }
                await this.saveCategoryOrder();
            },
        });
    }

    /*
     * The inline rename on a block header, whatever kind of block it is.
     *
     * One editor rather than two: a category and a widget both put an input
     * where their name is, both commit on Enter and on blur, both put the old
     * text back on Escape, and both have to re-fit the title afterwards. What
     * differs is what the name is saved to, and whether an empty one is a name
     * at all -- a widget with no title falls back to its type, which is what the
     * placeholder in Config -> Widgets has always said.
     */
    _startBlockRename(titleEl, nameSpan, {
        value, ariaKey, ariaFallback, allowEmpty = false, displayFor = (name) => name, onCommit,
    }) {
        const d = this.dash;
        if (titleEl.querySelector('.category-rename-input')) return;

        const originalName = String(value ?? '');
        titleEl.classList.add('category-title--renaming');

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'category-rename-input';
        input.value = originalName;
        input.setAttribute('aria-label', d.formatDashboardLabel(ariaKey, {}, ariaFallback));
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
            const unchanged = newName === originalName || (!newName && !allowEmpty);
            if (unchanged) {
                nameSpan.textContent = String(displayFor(originalName)).toLowerCase();
                window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
                return;
            }
            // On screen before the write: the header is what the reader just
            // typed into, and a name that only appears once the server has
            // answered reads as a rename that did not take.
            nameSpan.textContent = String(displayFor(newName)).toLowerCase();
            await onCommit(newName);
            window.DashboardCategoryTitleFit?.fitCategoryTitle?.(titleEl);
        };

        const cancel = () => {
            if (done) return;
            done = true;
            titleEl.classList.remove('category-title--renaming');
            input.replaceWith(nameSpan);
            nameSpan.textContent = String(displayFor(originalName)).toLowerCase();
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
     * Drops remembered expand/collapse state for pages that no longer exist.
     *
     * Both stores are keyed "pageId:categoryId" and nothing ever removed an
     * entry, so every deleted page left its rows behind for good. Only page ids
     * are checked, never category ids: the categories of other pages are not
     * loaded here, and pruning on that would throw away live state.
     *
     * Runs once per session — this is housekeeping, not a hot path.
     */
    pruneStaleCategoryViewState() {
        const d = this.dash;
        if (d._prunedCategoryViewState) return;
        const pages = Array.isArray(d.pages) ? d.pages : [];
        if (!pages.length) return;
        d._prunedCategoryViewState = true;

        const known = new Set(pages.map((p) => String(p.id)));
        const isStale = (key) => {
            const sep = String(key).indexOf(':');
            if (sep < 0) return false; // legacy un-scoped key — leave alone
            return !known.has(String(key).slice(0, sep));
        };

        const overflow = this._loadExpandedOverflow();
        let overflowChanged = false;
        Object.keys(overflow).forEach((key) => {
            if (isStale(key)) { delete overflow[key]; overflowChanged = true; }
        });
        if (overflowChanged) this._saveExpandedOverflow();

        const collapsed = d.collapsedCategories;
        if (collapsed && typeof collapsed === 'object') {
            let collapsedChanged = false;
            Object.keys(collapsed).forEach((key) => {
                if (isStale(key)) { delete collapsed[key]; collapsedChanged = true; }
            });
            if (collapsedChanged) {
                try {
                    localStorage.setItem('collapsedCategories', JSON.stringify(collapsed));
                } catch {
                    // localStorage unavailable — in-memory prune still applies
                }
            }
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

        const configured = Number(d.settings.categoryItemLimit);
        if (!Number.isFinite(configured) || configured <= 0) return;

        const rows = Array.from(bookmarksList.querySelectorAll(':scope > .bookmark-link'));

        // The limit caps the height of a column, not the number of bookmarks in
        // a category — that is what it is for: keeping one big category from
        // towering over its neighbours. A spread category fills every column it
        // was given before it grows any taller, so it may show its limit once
        // per column. Cutting at the plain limit instead would make it half as
        // tall as its neighbours and hide bookmarks the space was made for.
        //
        // Computed from the category and the row count rather than read off the
        // element: while a category is being built its list is not attached yet.
        const span = window.DashboardCategorySpan?.effectiveCategorySpan(d, category, rows.length) || 1;
        const limit = configured * span;

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
            iconImage.decoding = 'async';
            iconImage.className = 'bookmark-icon';
            labelWrap.appendChild(iconImage);
            window.ThemeIconStyling.applyThemeIconStylingToElement(
                labelWrap,
                window.ThemeIconStyling.getThemeIconStylingEntry(d.settings)
            );
            labelWrap.appendChild(document.createTextNode(' '));
        } else {
            // In a span rather than a bare text node: the icon editor previews
            // what you type by writing into this element, and a text node
            // between two others is not something anything can address.
            const textIcon = document.createElement('span');
            // icon-themed-glyph is what lets favicon harmonisation reach a glyph:
            // the variant rules in theme.css are written for <img>, and an emoji
            // in a category header is the same kind of thing to the eye — leaving
            // it at full colour beside harmonised favicons is what looked wrong.
            textIcon.className = 'category-title-icon icon-themed-glyph';
            textIcon.textContent = `${categoryIcon || '▣'} `;
            window.ThemeIconStyling.applyThemeIconStylingToElement(
                textIcon,
                window.ThemeIconStyling.getThemeIconStylingEntry(d.settings)
            );
            labelWrap.appendChild(textIcon);
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
                    d.formatDashboardLabel('smartWhyAria', {}, 'Why am I seeing this collection?')
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
            // The rename input is a child of this header, so its keys bubble
            // out to here: without this, Delete while renaming deletes the
            // category the reader is in the middle of naming.
            if (e.target.closest('input, textarea')) {
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setCategoryCollapsed(categoryDiv.getAttribute('data-collapsed') !== 'true');
                return;
            }
            // Renaming was long-press, double-click or right-click only — three
            // pointer gestures and no key, in a keyboard-first app. F2 is the
            // rename key every file manager has taught.
            if (e.key === 'F2' && !titleElement.classList.contains('category-title--renaming')) {
                e.preventDefault();
                this._startCategoryRename(titleElement, nameSpan, category);
                return;
            }
            // Delete deletes, here as on a bookmark row — it used to open the
            // menu instead, which is the one place in the app where the key
            // meant "show me the options". The confirm and the undo are the
            // menu's, so nothing about the deletion itself is duplicated.
            if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                void d.categoryMenu?.runAction?.('delete', titleElement, category);
                return;
            }
            // Shift+F10 and the Menu key are what opens a context menu from the
            // keyboard everywhere else; the bookmark rows answer to them too,
            // through the browser's own contextmenu event.
            if (e.key === 'F10' && e.shiftKey) {
                e.preventDefault();
                const box = titleElement.getBoundingClientRect();
                d.categoryMenu?.show?.(titleElement, category, {
                    x: box.left + 8, y: box.bottom,
                });
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
        // Spread across columns — last, because it also puts the marker in the
        // header, and the header does not exist until here. Not for tag-filter
        // chunks: those are equal-width slices of one filtered list, not
        // categories the user arranged.
        if (!isTagFilterChunk) {
            window.DashboardCategorySpan?.applyCategorySpan(d, categoryDiv, category, bookmarks.length);
        }
        d.categoryMenu?.bindCategory(categoryDiv, category);
        return categoryDiv;
    }


    isUploadedCategoryIcon(iconValue) {
        return typeof iconValue === 'string' && /\.[a-z0-9]+$/i.test(iconValue);
    }

}

window.DashboardRenderCore = DashboardRenderCore;
