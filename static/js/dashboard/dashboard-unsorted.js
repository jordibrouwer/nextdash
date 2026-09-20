/**
 * The full Unsorted view: every bookmark kept from the inbox without a
 * dashboard category.
 *
 * The rows and the columns are the dashboard's own -- createCategoryElement
 * builds a block, and the blocks are handed out over the configured number of
 * columns the same way a page's categories are. What this view adds on top is
 * a toolbar: a search box, a sort order and a grouping, all of which act on the
 * array already fetched rather than asking the server again.
 *
 * Toolbar state lives on the instance, not in settings: it is how you are
 * reading the pile right now, not how you want to read it forever, and the
 * instance outlives every trip to a page and back.
 */
class DashboardUnsorted {
    static VIEW = 'unsorted';
    static DEFAULT_CHUNK_SIZE = 15;

    /**
     * The page every kept bookmark sits on, mirroring unsortedPageID in
     * models.go. It is deliberately far outside the range ordinary pages reach,
     * and it is not in d.pages, so nothing on the dashboard routes to it.
     */
    static PAGE_ID = 999999;

    /** What a preview answer puts on a bookmark, and what gets written back. */
    static PREVIEW_FIELDS = ['previewTitle', 'previewDesc', 'previewImage',
        'previewImageSource', 'previewSiteName', 'previewAuthor', 'previewPublishedAt',
        'previewEmbedHtml', 'previewContentLength', 'previewEnriched'];

    static SORTS = ['added-desc', 'added-asc', 'name', 'site', 'opened', 'tag'];
    static GROUPS = ['none', 'site', 'date', 'tag'];

    /**
     * The one answer to "does this bookmark live on the unsorted page".
     *
     * Both spellings of the field, because the two exist in the tree: the store
     * writes `pageId`, and a few older record shapes carry `pageID`. Normalized
     * here rather than at the callers, so a second definition cannot drift away
     * from this one.
     */
    static isUnsortedBookmark(bookmark) {
        const pageId = Number(bookmark?.pageId ?? bookmark?.pageID);
        return Number.isFinite(pageId) && pageId === DashboardUnsorted.PAGE_ID;
    }

    /**
     * Every dashboard surface that reads across pages has to drop these.
     *
     * Kept for the surfaces that build a pool of their own from a list that
     * may still hold them — the split in loadAllBookmarks keeps them out of
     * d.allBookmarks, and this keeps any other pool honest besides. They are
     * filed by being given a category, and not before.
     */
    static withoutUnsorted(list) {
        if (!Array.isArray(list)) return list;
        return list.filter((bookmark) => !DashboardUnsorted.isUnsortedBookmark(bookmark));
    }

    constructor(dashboard) {
        this.dash = dashboard;
        /** Everything /api/unsorted last returned, unfiltered and unsorted. */
        this._bookmarks = [];
        this.searchQuery = '';
        this.sort = 'added-desc';
        this.groupBy = 'none';
        this._bodyHost = null;
        this._countEl = null;
        this._actionsEl = null;
        this.select = window.DashboardUnsortedSelect
            ? new window.DashboardUnsortedSelect(this)
            : null;
    }

    /**
     * ConfigFaviconPrefetch is already on the page for the import flow (see
     * dashboard.html) -- one instance is kept here so a second run reuses its
     * in-flight guard rather than starting a parallel sweep of the same page.
     */
    async ensureFaviconPrefetch() {
        if (this._faviconPrefetch) return this._faviconPrefetch;
        if (typeof window.ConfigFaviconPrefetch !== 'function') return null;
        this._faviconPrefetch = new window.ConfigFaviconPrefetch(
            (key) => this.dash.language?.t?.(key)
        );
        return this._faviconPrefetch;
    }

    isEnabled() {
        return this.dash.settings?.unsortedEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardUnsorted.VIEW;
    }

    /**
     * Put #unsorted in the address bar, the way health writes #health.
     *
     * Without it the hash stays on whatever page tab was last open, so a
     * refresh restored that page (or the inbox) instead of this view -- the
     * view was reachable but never survived a reload.
     */
    restoreUnsortedHash() {
        if (window.location.hash === '#unsorted') return;
        const next = `${window.location.pathname}${window.location.search}#unsorted`;
        if (!window.DashboardHistory?.pushLocation?.(next)) {
            history.replaceState(history.state, '', next);
        }
    }

    /**
     * Called when the tab comes back to the foreground, alongside inbox's and
     * health's: a view that owns the whole container has to prove it is still
     * the thing on screen.
     */
    restoreViewIfNeeded() {
        if (!this.isActiveView() || !this.isEnabled()) {
            return;
        }
        this.restoreUnsortedHash();
        this.dash.pageNav?.setActiveUnsortedTab?.();
        const container = document.getElementById('dashboard-layout');
        if (!container?.classList.contains('unsorted-view')) {
            void this.loadAndRender();
        }
    }

    async openUnsortedView() {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        if (d.activeView === DashboardUnsorted.VIEW) {
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        // The header band below is .lvs chrome, and list-view-shell.css rides in
        // the view stylesheet bundle that only the three lazy view loaders ask
        // for. Nothing else on this path requests it, so an unsorted view opened
        // first in a session drew the band unstyled.
        await window.ViewStyles?.ensureViewStyles?.();
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.setActiveView(DashboardUnsorted.VIEW);
        // The header name and the document title still read 'inbox' (or the page
        // name) otherwise -- this view arrives from the header icon, not from a
        // page tab, so nothing else re-titles it. Same call health makes.
        d.pageNav?.setActiveUnsortedTab?.();
        window.nextdashTrack?.('view:unsorted');
        this.restoreUnsortedHash();
        await this.loadAndRender();
        return true;
    }

    async loadAndRender() {
        const d = this.dash;
        // The row's context menu resolves a cross-page row by URL against
        // d.bookmarks/d.allBookmarks (dashboard-context-menu.js's
        // resolveRowBookmark) -- the same fallback the tag-filter view relies
        // on, and the same call it makes before rendering, so a bookmark kept
        // moments ago is findable rather than silently failing to resolve.
        await d.loadAllBookmarks?.();
        // renderBody() below is a full innerHTML wipe of the grid, not an
        // incremental patch -- rebuilding while a row's context menu or Move
        // to... popover is open detaches the row that popover is anchored to
        // (getBoundingClientRect then reads 0x0, and
        // _positionActionPopoverBeside gives up rather than guess, leaving the
        // popover wherever the browser default puts it, usually the top-left
        // corner). A background poll (refreshIfDataRevisionChanged,
        // repaintBookmarkMutationSurfaces) can fire at any moment, so this is
        // gated here rather than at each caller -- the same reason those two
        // callers already skip while inline edit is active.
        if (document.querySelector('#bookmark-context-menu, .move-popover')) {
            return;
        }
        let bookmarks = [];
        try {
            // no-store: this reload follows writes of its own -- a tag, a
            // promote, a sweep of icons -- and a revalidated copy from the
            // browser's cache would show the list as it was before them.
            const res = await fetch('/api/unsorted', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
                d._unsortedPageId = data?.page?.id;
            }
        } catch (_error) {
            // Falls through to the empty-state render below.
        }
        this.render(bookmarks);
    }

    /**
     * Never paint over the view that replaced this one.
     *
     * loadAndRender awaits two round trips, and a click on the inbox tab lands
     * in the middle of them often enough: the inbox mounted its shell, then
     * this resolved and wiped the container to rebuild a grid nobody was
     * looking at any more -- activeView said 'inbox' while the layout said
     * unsorted. Health guards its own render the same way.
     */
    _stillShowing() {
        return this.isActiveView();
    }

    /**
     * Rows per chunk when nothing is grouped, from the same setting that caps a
     * category's list: settings.categoryItemLimit. Unlimited (0) has no meaning
     * for a view that is one long undifferentiated list, so it falls back to the
     * setting's own default rather than rendering a single column thousands of
     * rows tall.
     */
    chunkSize() {
        const configured = Number(this.dash.settings?.categoryItemLimit);
        if (!Number.isFinite(configured) || configured < 1) {
            return DashboardUnsorted.DEFAULT_CHUNK_SIZE;
        }
        return Math.floor(configured);
    }

    render(bookmarks) {
        const container = document.getElementById('dashboard-layout');
        if (!container || !this._stillShowing()) return;

        // A repaint triggered by an action on a row -- tagging it, deleting a
        // selection -- must leave the reader looking at the same place. Only a
        // repaint: arriving in the view scrolls to the top like any other
        // navigation, which is what `wasShowing` tells apart.
        const wasShowing = this._bodyHost?.isConnected && container.contains(this._bodyHost);
        const offset = wasShowing ? window.scrollY : 0;

        this._bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
        this._ensureChrome(container);
        this.renderBody();

        if (wasShowing && offset > 0) {
            window.scrollTo({ top: offset, behavior: 'instant' });
        }
    }

    /**
     * Build the view's frame once and leave it alone afterwards.
     *
     * A background refresh can land while someone is mid-word in the search box
     * (loadAndRender runs on a data-revision poll), and rebuilding the toolbar
     * under a caret loses both the caret and the keystroke arriving next. So
     * the chrome is rebuilt only when it is actually missing -- on the first
     * render, and after another view has wiped the container.
     */
    _ensureChrome(container) {
        const d = this.dash;

        // syncDashboardGridLayout() is the usual way the grid gets its
        // columns-N/density/packed classes, but it returns early off the
        // bookmarks view -- which this is. So the container keeps whatever the
        // last page render left on it (layout-masonry, packed-masonry,
        // reorder-container) and the column widths below never apply. Set the
        // shape here instead of borrowing a stale one.
        const colCount = d.renderCore.getEffectiveColumnsPerRow();
        const packed = d.renderCore.shouldPackDashboardColumns();
        const density = d.settings?.densityMode || 'compact';
        container.className = `dashboard-grid columns-${colCount} layout-default density-${density}`
            + `${packed ? ' packed-columns' : ''} unsorted-view`;
        container.setAttribute('role', 'grid');

        if (this._bodyHost?.isConnected && container.contains(this._bodyHost)) {
            return;
        }

        container.innerHTML = '';
        container.appendChild(this._buildHead());
        container.appendChild(this._buildToolbar());
        this._bodyHost = document.createElement('div');
        this._bodyHost.className = 'unsorted-view-main';
        container.appendChild(this._bodyHost);
    }

    /**
     * The same header band health, inbox and config wear: name of the view and
     * one line saying what is in it. Built here rather than through
     * ListViewShell.mount -- the shell's value is the rail of filters and
     * summary figures beside the list, and this view has neither, so mounting
     * it would put an empty 200px 'Filter' rail next to the grid.
     */
    _buildHead() {
        const d = this.dash;
        const head = document.createElement('div');
        head.className = 'lvs-header unsorted-view-head';

        const text = document.createElement('div');
        text.className = 'lvs-header-text';

        const title = document.createElement('h2');
        title.className = 'lvs-title';
        title.textContent = d.pageNav?.unsortedPageLabel?.() || 'Unsorted';

        const description = document.createElement('p');
        description.className = 'lvs-description';
        description.textContent = d.formatDashboardLabel(
            'unsortedPageSubtitle', {}, 'Bookmarks kept from the inbox, not filed on a page');

        text.append(title, description);

        const actions = document.createElement('div');
        actions.className = 'lvs-header-actions';
        this._actionsEl = actions;

        this._countEl = document.createElement('span');
        this._countEl.className = 'unsorted-view-count';
        actions.append(this._buildHeadButtons(), this._countEl);

        head.append(text, actions);
        this.syncHead();
        return head;
    }

    /**
     * The two fetches.
     *
     * Each reads the selection when there is one and the whole visible list
     * when there is not, so the button says which it is about to do rather than
     * leaving that to be discovered afterwards. Selecting itself has no button:
     * the rows carry their own tick boxes, as the inbox's and health's do.
     */
    _buildHeadButtons() {
        const wrap = document.createElement('div');
        wrap.className = 'unsorted-view-actions';
        if (!this.select) return wrap;

        const button = (className, text, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `lvs-header-btn unsorted-view-btn ${className}`.trim();
            btn.textContent = text;
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                onClick(btn);
            });
            wrap.appendChild(btn);
            return btn;
        };

        this._previewsBtn = button('unsorted-view-previews-btn',
            this.dash.formatDashboardLabel('unsortedFetchPreviews', {}, 'Fetch previews'),
            () => { void this.select.fetchPreviews(); });

        this._iconsBtn = button('unsorted-view-icons-btn',
            this.dash.formatDashboardLabel('unsortedFetchIcons', {}, 'Fetch icons'),
            () => { void this.select.fetchIcons(); });

        return wrap;
    }

    /** Keep the header buttons saying what they will act on. */
    syncHeaderActions() {
        if (!this.select) return;
        // The rows it would actually ask about: ones that already have a
        // preview are skipped, so a count including them would promise work the
        // button is not going to do.
        const targets = this.select.previewTargets().length;
        if (this._previewsBtn) {
            this._previewsBtn.textContent = this.dash.formatDashboardLabel(
                'unsortedFetchPreviewsCount', { count: targets }, `Fetch previews (${targets})`);
        }
    }

    /**
     * The count reads "12 of 218" while a search narrows the list and a bare
     * total otherwise -- a lone "12" over a filtered grid says nothing about
     * how much is being held back.
     */
    syncHead() {
        if (!this._countEl) return;
        const total = this._bookmarks.length;
        const shown = this._visibleBookmarks().length;
        this._countEl.textContent = shown === total
            ? String(total)
            : this.dash.formatDashboardLabel(
                'unsortedCountFiltered', { shown, total }, `${shown} of ${total}`);
    }

    sortOptions() {
        const d = this.dash;
        return [
            ['added-desc', d.formatDashboardLabel('unsortedSortAddedDesc', {}, 'newest first')],
            ['added-asc', d.formatDashboardLabel('unsortedSortAddedAsc', {}, 'oldest first')],
            ['name', d.formatDashboardLabel('unsortedSortName', {}, 'name')],
            ['site', d.formatDashboardLabel('unsortedSortSite', {}, 'site')],
            ['opened', d.formatDashboardLabel('unsortedSortOpened', {}, 'most opened')],
            ['tag', d.formatDashboardLabel('unsortedSortTag', {}, 'tag')],
        ];
    }

    groupOptions() {
        const d = this.dash;
        return [
            ['none', d.formatDashboardLabel('unsortedGroupNone', {}, 'no grouping')],
            ['site', d.formatDashboardLabel('unsortedGroupSite', {}, 'group by site')],
            ['date', d.formatDashboardLabel('unsortedGroupDate', {}, 'group by date added')],
            ['tag', d.formatDashboardLabel('unsortedGroupTag', {}, 'group by tag')],
        ];
    }

    /** Health's toolbar row, with this view's three controls in it. */
    _buildToolbar() {
        const d = this.dash;
        const toolbar = document.createElement('div');
        toolbar.className = 'lvs-toolbar unsorted-view-toolbar';
        const slot = document.createElement('div');
        slot.className = 'lvs-toolbar-slot';

        const searchLabel = d.formatDashboardLabel(
            'unsortedSearchPlaceholder', {}, 'Search unsorted bookmarks…');
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'unsorted-view-search-input';
        search.value = this.searchQuery;
        search.placeholder = searchLabel;
        search.autocomplete = 'off';
        search.spellcheck = false;
        search.setAttribute('aria-label', searchLabel);
        search.addEventListener('input', (event) => {
            this.searchQuery = event.target.value;
            this.renderBody();
        });
        // The dashboard's own keyboard layer opens its search overlay on a bare
        // letter and moves the row cursor on the arrows. Typing in this box is
        // typing in this box.
        search.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.key === 'Escape' && this.searchQuery) {
                event.preventDefault();
                this.searchQuery = '';
                event.target.value = '';
                this.renderBody();
            }
            event.stopPropagation();
        });

        const sort = this._buildSelect(
            'unsorted-view-sort-select',
            d.formatDashboardLabel('unsortedSortLabel', {}, 'Sort bookmarks'),
            this.sortOptions(),
            this.sort,
            (value) => {
                this.sort = DashboardUnsorted.SORTS.includes(value) ? value : 'added-desc';
                this.renderBody();
            }
        );

        const group = this._buildSelect(
            'unsorted-view-group-select',
            d.formatDashboardLabel('unsortedGroupLabel', {}, 'Group bookmarks'),
            this.groupOptions(),
            this.groupBy,
            (value) => {
                this.groupBy = DashboardUnsorted.GROUPS.includes(value) ? value : 'none';
                this.renderBody();
            }
        );

        slot.appendChild(search);
        toolbar.append(slot, sort, group);
        return toolbar;
    }

    _buildSelect(className, label, options, current, onChange) {
        const select = document.createElement('select');
        select.className = className;
        select.setAttribute('aria-label', label);
        options.forEach(([value, text]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.appendChild(option);
        });
        select.value = current;
        select.addEventListener('change', (event) => onChange(event.target.value));
        return select;
    }

    /** A bookmark's tags, trimmed, lowercased and in a stable order. */
    _tagsOf(bookmark) {
        return (bookmark?.tags || [])
            .map((raw) => String(raw || '').trim().toLowerCase())
            .filter(Boolean)
            .sort();
    }

    /** Hostname without www., lowercased. '' for anything unparseable. */
    _hostOf(url) {
        try {
            return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
        } catch (_error) {
            return '';
        }
    }

    /**
     * The search reads name and URL together rather than name alone: half of
     * what lands in Unsorted is named after the page it came from and the other
     * half is still a bare URL, so a query that only reads one of the two
     * misses whichever kind you are not looking at.
     */
    _matchesQuery(bookmark, query) {
        if (!query) return true;
        const haystack = `${bookmark?.name || ''}\u0000${bookmark?.url || ''}`.toLowerCase();
        return haystack.includes(query);
    }

    _visibleBookmarks() {
        const query = this.searchQuery.trim().toLowerCase();
        const list = this._bookmarks.filter((bookmark) => this._matchesQuery(bookmark, query));
        return this._sortBookmarks(list);
    }

    _sortBookmarks(list) {
        const byName = (a, b) => String(a?.name || '').localeCompare(String(b?.name || ''),
            undefined, { sensitivity: 'base' });
        const added = (bookmark) => Number(bookmark?.createdAt) || 0;
        const sorted = [...list];
        switch (this.sort) {
            case 'added-asc':
                sorted.sort((a, b) => added(a) - added(b));
                break;
            case 'name':
                sorted.sort(byName);
                break;
            case 'site':
                sorted.sort((a, b) => this._hostOf(a?.url).localeCompare(this._hostOf(b?.url))
                    || byName(a, b));
                break;
            case 'tag':
                // Untagged last rather than first: sorting by tag is a way of
                // reading the tagged ones together, and a run of blanks at the
                // top buries them.
                sorted.sort((a, b) => {
                    const left = this._tagsOf(a)[0] || '';
                    const right = this._tagsOf(b)[0] || '';
                    if (!left !== !right) return left ? -1 : 1;
                    return left.localeCompare(right) || byName(a, b);
                });
                break;
            case 'opened':
                sorted.sort((a, b) => (Number(b?.openCount) || 0) - (Number(a?.openCount) || 0)
                    || (Number(b?.lastOpened) || 0) - (Number(a?.lastOpened) || 0)
                    || byName(a, b));
                break;
            default:
                sorted.sort((a, b) => added(b) - added(a));
        }
        return sorted;
    }

    /**
     * Relative buckets rather than calendar dates: what you want to know about
     * a pile you are working through is how long something has been sitting in
     * it, and 'older' is the bucket that answers that.
     */
    _dateBucket(createdAt) {
        const d = this.dash;
        const stamp = Number(createdAt) || 0;
        const day = 86400000;
        const startOfToday = new Date().setHours(0, 0, 0, 0);
        if (stamp >= startOfToday) {
            return { key: 'today', label: d.formatDashboardLabel('unsortedBucketToday', {}, 'today') };
        }
        if (stamp >= startOfToday - 6 * day) {
            return { key: 'week', label: d.formatDashboardLabel('unsortedBucketWeek', {}, 'this week') };
        }
        if (stamp >= startOfToday - 29 * day) {
            return { key: 'month', label: d.formatDashboardLabel('unsortedBucketMonth', {}, 'this month') };
        }
        return { key: 'older', label: d.formatDashboardLabel('unsortedBucketOlder', {}, 'older') };
    }

    /**
     * Groups, in the order they should read.
     *
     * By site the biggest group leads: the reason to group by site at all is to
     * find the twelve things saved off one domain, and that group is no use at
     * the bottom. By date the order is fixed -- today, this week, this month,
     * older -- because a date bucket's meaning is its position.
     */
    _groupBookmarks(list) {
        const groups = new Map();
        const order = this.groupBy === 'date' ? ['today', 'week', 'month', 'older'] : null;
        const push = (key, label, bookmark) => {
            if (!groups.has(key)) {
                groups.set(key, { key, label, bookmarks: [] });
            }
            groups.get(key).bookmarks.push(bookmark);
        };

        list.forEach((bookmark) => {
            if (this.groupBy === 'tag') {
                // One block per tag, and a bookmark carrying three of them
                // appears under all three: that is what grouping by tag means,
                // and picking one tag to file it under would hide it from the
                // other two. An untagged row belongs to no group and is left
                // out entirely rather than pooled into a "no tag" block nobody
                // grouped by tag to read.
                this._tagsOf(bookmark).forEach((tag) => push(tag, tag, bookmark));
                return;
            }
            if (this.groupBy === 'date') {
                const bucket = this._dateBucket(bookmark?.createdAt);
                push(bucket.key, bucket.label, bookmark);
                return;
            }
            const host = this._hostOf(bookmark?.url);
            push(host, host || this.dash.formatDashboardLabel('unsortedGroupNoSite', {}, 'no site'), bookmark);
        });

        const built = [...groups.values()];
        if (order) {
            built.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        } else {
            built.sort((a, b) => b.bookmarks.length - a.bookmarks.length
                || a.label.localeCompare(b.label));
        }
        return built;
    }

    renderBody() {
        const d = this.dash;
        const host = this._bodyHost;
        if (!host || !this._stillShowing()) return;

        host.innerHTML = '';
        this.syncHead();
        // Before the empty-list path returns, not after the grid is built: the
        // Select all button has to go quiet over a list with nothing in it, and
        // that is exactly the render that used to skip this call.
        this.syncHeaderActions();

        const visible = this._visibleBookmarks();
        if (!visible.length) {
            host.appendChild(this._buildEmptyState());
            return;
        }

        const blocks = this._buildBlocks(visible);
        if (!blocks.length) {
            this.syncHeaderActions();
            // Grouping by tag over rows that carry none: the list is not empty,
            // but nothing in it belongs to a group, and an empty grid with no
            // word about why reads as a bug.
            host.appendChild(this._buildEmptyState({ noTags: this.groupBy === 'tag' }));
            return;
        }

        const colCount = d.renderCore.getEffectiveColumnsPerRow();
        const packed = d.renderCore.shouldPackDashboardColumns();
        const density = d.settings?.densityMode || 'compact';

        const body = document.createElement('div');
        body.className = `tag-filter-view-body dashboard-grid columns-${colCount} density-${density}`
            + `${packed ? ' packed-columns' : ''} layout-default`;
        body.setAttribute('role', 'grid');
        body.setAttribute('aria-label', d.formatDashboardLabel('unsortedGridLabel', {}, 'Unsorted bookmarks'));
        body.style.setProperty('--packed-columns', String(colCount));
        body.style.setProperty(
            '--dashboard-grid-max-width',
            `calc(${colCount} * var(--dashboard-column-max, 300px)`
            + ` + ${Math.max(0, colCount - 1)} * var(--gap, 1.5rem))`
        );

        this._distributeChunks(body, blocks, { colCount, packed });
        host.appendChild(body);

        this.select?.bindRows(host);
        this._bindPreviewHover(host);
        this.select?.prune();
        this.select?.sync();
        this.syncHeaderActions();
    }

    /**
     * Fetch a row's preview the first time the pointer rests on it.
     *
     * A kept bookmark arrives with nothing but a URL, so the card that opens
     * over it had only the name to show. The card's own loader fills that in,
     * but only when cards are on and set to hover, and it keeps the answer in
     * memory -- come back tomorrow and every row is thin again.
     *
     * So this view asks for its own, once per URL, and writes the answer to the
     * unsorted page. Rows that already carry a preview are skipped: the point
     * is to fill the gaps, not to re-ask the whole list.
     *
     * One delegated listener, because the grid is rebuilt on every keystroke in
     * the search box.
     */
    _bindPreviewHover(host) {
        if (!host || host._unsortedPreviewBound) return;
        host._unsortedPreviewBound = true;

        host.addEventListener('mouseover', (event) => {
            const row = event.target instanceof Element
                ? event.target.closest('.bookmark-link[data-unsorted-key]')
                : null;
            if (!row || !host.contains(row)) return;
            const bookmark = this._bookmarks.find(
                (entry) => this.select?.keyFor(entry) === row.dataset.unsortedKey);
            if (!bookmark) return;
            this._schedulePreviewFetch(bookmark);
        });
        host.addEventListener('mouseout', () => {
            clearTimeout(this._previewHoverTimer);
        });
    }

    /** True when the record already carries what a card would draw. */
    _hasPreview(bookmark) {
        return bookmark?.previewEnriched === true
            || !!String(bookmark?.previewTitle || '').trim()
            || !!String(bookmark?.previewDesc || '').trim();
    }

    /**
     * The same rest-before-asking the preview card uses: crossing a column on
     * the way somewhere else must not fire a request per row it passes over.
     *
     * Waits longer than the card does, and for a reason. With hover cards on,
     * the card's own loader is already asking for this URL, and it writes the
     * answer onto the same bookmark object -- so by the time this fires there
     * is usually nothing to fetch and only something to save. Asking anyway
     * would be two requests to somebody else's server for one hover.
     */
    _schedulePreviewFetch(bookmark) {
        if (this._hasPreview(bookmark)) return;
        // Not while a sweep is running: both draw on the same sixty-a-minute
        // budget, and the sweep is already pacing itself against it.
        if (this.select?._busy) return;
        const url = String(bookmark?.url || '').trim();
        if (!url) return;
        this._previewAsked = this._previewAsked || new Set();
        if (this._previewAsked.has(url)) return;

        clearTimeout(this._previewHoverTimer);
        const hoverDelay = Number(this.dash.settings?.linkPreviewHoverDelayMs) || 250;
        const cardWillAsk = this.dash.preview?.cardsEnabled?.() === true
            && this.dash.preview?.previewMode?.() === 'hover';
        this._previewHoverTimer = setTimeout(() => {
            if (this._hasPreview(bookmark)) {
                // The card got there first; all that is left is to keep it.
                this._previewAsked.add(url);
                this._queuePreviewSave(url);
                return;
            }
            void this._fetchPreviewFor(bookmark);
        }, cardWillAsk ? hoverDelay + 600 : hoverDelay);
    }

    async _fetchPreviewFor(bookmark) {
        const url = String(bookmark?.url || '').trim();
        if (!url || this._previewAsked.has(url)) return;
        // Marked before the request, not after: a second hover while this one
        // is still in flight would otherwise ask again.
        this._previewAsked.add(url);
        try {
            const res = await fetch(`/api/bookmark-preview?url=${encodeURIComponent(url)}`);
            if (!res.ok) return;
            this.applyPreview(bookmark, await res.json());
        } catch (_error) {
            // A page that will not answer is not worth a message here: the row
            // still opens, and the next visit may go better.
            this._previewAsked.delete(url);
        }
    }

    /**
     * Put a preview answer on the record and keep it.
     *
     * Both routes end here -- the hover and the Fetch previews sweep -- so the
     * fields are written in one place and the save is queued the same way. The
     * server caches its own answer, but that cache is not the bookmark: without
     * this the row came back thin on the next load and the button offered to
     * fetch it all over again.
     */
    applyPreview(bookmark, preview) {
        if (!bookmark || !preview) return;
        bookmark.previewTitle = preview.title || bookmark.previewTitle || '';
        bookmark.previewDesc = preview.description || bookmark.previewDesc || '';
        bookmark.previewImage = preview.image || '';
        bookmark.previewImageSource = preview.imageSource || '';
        bookmark.previewSiteName = preview.siteName || '';
        bookmark.previewAuthor = preview.author || '';
        bookmark.previewPublishedAt = Number(preview.publishedAt || 0) || 0;
        bookmark.previewEmbedHtml = preview.embedHtml || '';
        bookmark.previewContentLength = Number(preview.contentLength || 0) || 0;
        bookmark.previewEnriched = true;
        this._queuePreviewSave(String(bookmark.url || '').trim());
    }

    /**
     * Write what the hovers collected, once.
     *
     * The store has no per-bookmark write, so this is a read-modify-write over
     * the whole unsorted page -- coalesced, because walking a column fills a
     * dozen rows in a few seconds and a dozen writes of the same list would
     * race each other.
     */
    _queuePreviewSave(url) {
        const bookmark = this._bookmarks.find(
            (entry) => String(entry?.url || '').trim() === url);
        if (!bookmark) return;
        // The values, not a promise to look them up later: a background refresh
        // landing between here and the flush replaces _bookmarks with records
        // straight from the store, which do not carry what was just fetched --
        // the write would then save the fields back over themselves as blanks.
        this._previewSaveQueue = this._previewSaveQueue || new Map();
        this._previewSaveQueue.set(url, Object.fromEntries(
            DashboardUnsorted.PREVIEW_FIELDS.map((field) => [field, bookmark[field]])));
        clearTimeout(this._previewSaveTimer);
        this._previewSaveTimer = setTimeout(() => {
            void this._flushPreviewSave();
        }, 1500);
    }

    async _flushPreviewSave() {
        const pending = this._previewSaveQueue;
        if (!pending?.size) return;
        this._previewSaveQueue = new Map();
        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || DashboardUnsorted.PAGE_ID;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`, { cache: 'no-store' });
            if (!res.ok) return;
            const stored = await res.json();
            if (!Array.isArray(stored)) return;
            let touched = 0;
            stored.forEach((entry) => {
                const url = String(entry?.url || '').trim();
                const values = pending.get(url);
                if (!values) return;
                Object.assign(entry, values);
                touched += 1;
            });
            if (!touched) return;
            await fetcher(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(stored),
            });
        } catch (_error) {
            // Left unsaved rather than retried: the fields are still in memory
            // for this session, and the next hover on a fresh load asks again.
        }
    }

    _buildEmptyState({ noTags = false } = {}) {
        const d = this.dash;
        const query = this.searchQuery.trim();
        const empty = document.createElement('div');
        empty.className = 'empty-state empty-state--unsorted';
        if (noTags) {
            empty.textContent = d.formatDashboardLabel(
                'unsortedNoTags', {}, 'Nothing here carries a tag yet.');
            return empty;
        }
        empty.textContent = query
            ? d.formatDashboardLabel('unsortedSearchEmpty', { query }, `Nothing matches “${query}”.`)
            : d.formatDashboardLabel('unsortedEmpty', {}, 'Nothing kept yet.');
        return empty;
    }

    /**
     * Give every row in a block the key its bookmark answers to, so a click in
     * select mode can find it again after the grid has been rebuilt by a
     * keystroke in the search box.
     */
    _stampKeys(block, bookmarks) {
        if (!this.select) return block;
        const rows = block.querySelectorAll('.bookmark-link');
        bookmarks.forEach((bookmark, i) => {
            const row = rows[i];
            if (!row) return;
            row.dataset.unsortedKey = this.select.keyFor(bookmark);
            this.select.ensureCheckbox(row, bookmark);
        });
        return block;
    }

    _buildBlocks(visible) {
        const d = this.dash;
        if (this.groupBy === 'none') {
            const chunkSize = this.chunkSize();
            const blocks = [];
            for (let offset = 0; offset < visible.length; offset += chunkSize) {
                const chunk = visible.slice(offset, offset + chunkSize);
                const chunkIndex = Math.floor(offset / chunkSize);
                blocks.push(this._stampKeys(
                    d.createCategoryElement(
                        { id: `__unsorted_chunk_${chunkIndex}`, name: '', tagFilterChunk: true },
                        chunk
                    ),
                    chunk
                ));
            }
            return blocks;
        }

        return this._groupBookmarks(visible).map((group, index) => {
            const block = this._stampKeys(
                d.createCategoryElement(
                    { id: `__unsorted_group_${index}`, name: '', tagFilterChunk: true },
                    group.bookmarks
                ),
                group.bookmarks
            );
            block.classList.add('unsorted-group');
            block.setAttribute('data-unsorted-group', group.key || '');
            block.prepend(this._buildGroupTitle(group));
            return block;
        });
    }

    /**
     * A group's heading, shaped like a category title but inert.
     *
     * createCategoryElement's own title carries collapse state, inline rename
     * and the drag-reorder handle, all of which write against a real category
     * on a real page. These groups are neither -- they are recomputed from the
     * sort on every keystroke -- so they take the look without the machinery.
     */
    _buildGroupTitle(group) {
        const title = document.createElement('div');
        title.className = 'category-title unsorted-group-title';

        const prefix = document.createElement('span');
        prefix.className = 'category-title-prefix';
        prefix.textContent = '// ';
        prefix.setAttribute('aria-hidden', 'true');

        const name = document.createElement('span');
        name.className = 'category-title-name';
        name.textContent = group.label;

        const count = document.createElement('span');
        count.className = 'unsorted-group-count';
        count.textContent = String(group.bookmarks.length);

        title.append(prefix, name, count);
        return title;
    }

    /**
     * Blocks read left to right and wrap onto a new band underneath, the way
     * the page grid reads -- not one block per column, which is what the tag
     * filter does and what left 250 unsorted bookmarks as 25 columns squeezed
     * off the side of the screen.
     *
     * Packed mode gets that from round-robin into colCount columns (block 0 in
     * column 0, block 1 in column 1, block 4 back under block 0). Ungrouped,
     * the bands line up exactly, every chunk being chunkSize rows tall; grouped
     * they do not, because a group is as tall as the site or the day is big --
     * the same unevenness a page of categories has. Unpacked mode is a plain
     * grid, which already flows row-wise.
     */
    _distributeChunks(body, chunkBlocks, { colCount, packed }) {
        if (!packed) {
            body.style.gridTemplateColumns = colCount === 1
                ? 'minmax(0, 1fr)'
                : `repeat(${colCount}, minmax(var(--dashboard-column-min, 250px), var(--dashboard-column-max, 300px)))`;
            chunkBlocks.forEach((el) => body.appendChild(el));
            return;
        }

        const columns = Array.from({ length: colCount }, () => {
            const col = document.createElement('div');
            col.className = 'dashboard-column tag-filter-dashboard-column';
            return col;
        });
        chunkBlocks.forEach((el, i) => columns[i % colCount].appendChild(el));
        columns.forEach((col) => {
            if (col.children.length) {
                body.appendChild(col);
            }
        });
    }
}

window.DashboardUnsorted = DashboardUnsorted;
