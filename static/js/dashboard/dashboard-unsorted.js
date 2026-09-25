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

    /** Mirrors unsortedPageID in models.go; defined once in UnsortedPage. */
    static PAGE_ID = window.UnsortedPage?.PAGE_ID ?? 999999;

    /** What a preview answer puts on a bookmark, and what gets written back. */
    static PREVIEW_FIELDS = ['previewTitle', 'previewDesc', 'previewImage',
        'previewImageSource', 'previewSiteName', 'previewAuthor', 'previewPublishedAt',
        'previewEmbedHtml', 'previewContentLength', 'previewEnriched'];

    // NUL-prefixed so no real tag can share it, as with suggested's own.
    static UNTAGGED_GROUP = '\u0000untagged';

    static SORTS = ['added-desc', 'added-asc', 'name', 'site', 'opened', 'tag', 'checked'];
    static GROUPS = ['none', 'site', 'date', 'tag', 'suggested'];

    /** The one answer to "does this bookmark live on the unsorted page". */
    static isUnsortedBookmark(bookmark) {
        return window.UnsortedPage?.isUnsorted?.(bookmark) === true;
    }

    /** The same list with the kept bookmarks taken out. */
    static withoutUnsorted(list) {
        return window.UnsortedPage?.without?.(list) ?? list;
    }

    constructor(dashboard) {
        this.dash = dashboard;
        /** Everything /api/unsorted last returned, unfiltered and unsorted. */
        this._bookmarks = [];
        this.searchQuery = '';
        /** Narrowed to the kept links that last answered with an error. */
        this.brokenOnly = false;
        this.duplicatesOnly = false;
        /*
         * How this pile is read, remembered on the server like any other
         * setting: an empty value is the default, so an install that never
         * chose keeps the shape it always had.
         */
        const stored = dashboard?.settings || {};
        this.sort = DashboardUnsorted.SORTS.includes(stored.unsortedSort)
            ? stored.unsortedSort : 'added-desc';
        this.groupBy = DashboardUnsorted.GROUPS.includes(stored.unsortedGroup)
            ? stored.unsortedGroup : 'none';
        this._bodyHost = null;
        this._countEl = null;
        this._actionsEl = null;
        this.select = window.DashboardUnsortedSelect
            ? new window.DashboardUnsortedSelect(this)
            : null;
        /*
         * Follow the density toggle.
         *
         * The grid takes its density as a class when it is drawn, and the
         * toolbar's two buttons change the setting without redrawing anything
         * -- the queue's rows follow a body attribute, these do not. So the
         * buttons saved the choice and left the list in front of them as it
         * was. Once per instance: it outlives every trip to the tab and back.
         */
        window.addEventListener('nextdash:list-density', () => {
            if (this._stillShowing?.()) this.renderBody();
        });
        /** The one-at-a-time run over this list; `f`, like the health view's. */
        this.review = window.DashboardUnsortedReview
            ? new window.DashboardUnsortedReview(this)
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

    /**
     * Kept is a tab of the inbox, not a view of its own: what is on screen is
     * the inbox, and this list is what it is showing.
     */
    isActiveView() {
        const d = this.dash;
        return d.activeView === 'inbox' && d.inbox?.activeTab?.() === 'kept';
    }

    /**
     * The one way in, from everywhere that used to open a view of its own:
     * the inbox, on its kept tab.
     */
    async openUnsortedView() {
        if (!this.isEnabled()) return false;
        return Boolean(await this.dash.inbox?.openInboxView?.({ tab: 'kept' }));
    }

    /**
     * Where this list draws: the hosts the inbox's shell hands over.
     *
     * Called on every switch to the kept tab and cheap to repeat -- the toolbar
     * and the header buttons are built once and left alone, so a search typed
     * into the toolbar survives a trip to the other tab and back.
     */
    mountInto({ body, toolbar, actions }) {
        this._bodyHost = body || null;
        // The marker every rule for this list is keyed on. It sits on the body
        // host now rather than on #dashboard-layout, which belongs to the
        // inbox's shell.
        this._bodyHost?.classList.add('unsorted-view');
        if (toolbar && !toolbar.childElementCount) {
            toolbar.appendChild(this._buildToolbar());
        }
        if (actions && !actions.childElementCount) {
            actions.appendChild(this._buildHeadButtons());
            this._countEl = document.createElement('span');
            this._countEl.className = 'unsorted-view-count';
            actions.appendChild(this._countEl);
            this._actionsEl = actions;
        }
        this.syncHead();
    }

    async loadAndRender() {
        const d = this.dash;
        // The shipped catalogue, once per tab and shared with config's panel:
        // without it the chips would offer only what the rules and the
        // neighbours say, which on a fresh collection is nothing at all.
        if (!this._catalogueAsked) {
            this._catalogueAsked = true;
            void window.TagSuggestLive?.ensureCatalogue?.().then(() => {
                if (this._stillShowing()) this.renderBody();
            });
        }
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
        let answered = false;
        try {
            // no-store: this reload follows writes of its own -- a tag, a
            // promote, a sweep of icons -- and a revalidated copy from the
            // browser's cache would show the list as it was before them.
            const res = await fetch('/api/unsorted', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                bookmarks = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
                d._unsortedPageId = data?.page?.id;
                answered = true;
            }
        } catch (_error) {
            // Said below, not painted as an empty pile.
        }
        /*
         * A request that failed and a pile with nothing in it must not look
         * alike.
         *
         * Both used to end at render([]), so a 500 or a dropped connection
         * during the background poll replaced the whole kept list with "Nothing
         * kept yet." -- which is what someone sees after they have just filed
         * everything, and so reads as "it worked" rather than "ask again".
         * Nothing on screen said a request had failed.
         *
         * So keep what is drawn and say what happened. The next poll, or
         * arriving on the tab again, repaints it.
         */
        if (!answered) {
            d.showNotification(
                d.formatDashboardLabel('unsortedLoadFailed', {}, 'Could not load the kept links.'),
                'error',
            );
            return;
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
        if (!this._bodyHost?.isConnected || !this._stillShowing()) return;

        // A repaint triggered by an action on a row -- tagging it, deleting a
        // selection -- must leave the reader looking at the same place. Only a
        // repaint: arriving on the tab scrolls to the top like any other
        // navigation, which is what `drawnAlready` tells apart.
        const drawnAlready = this._bodyHost.childElementCount > 0;
        const offset = drawnAlready ? window.scrollY : 0;

        this._bookmarks = Array.isArray(bookmarks) ? bookmarks : [];
        this.renderBody();

        if (drawnAlready && offset > 0) {
            window.scrollTo({ top: offset, behavior: 'instant' });
        }
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

        /*
         * The way into the run that is not a keystroke.
         *
         * The queue's band carries its Triage button for the same reason: a
         * ritual nobody can see is a ritual nobody starts, and `f` in a legend
         * under two hundred rows is not seeing it. First in the row, because
         * it is the only button here that deals with the list rather than
         * fetching things for it.
         */
        const review = button('unsorted-view-review-btn',
            this.dash.formatDashboardLabel('unsortedReviewStart', {}, 'Work through'),
            () => { this.review?.open?.(); });
        review.classList.add('lvs-action--primary');
        const hint = document.createElement('kbd');
        hint.textContent = 'f';
        review.appendChild(hint);

        // The inbox's tour, in the same place the queue's band has it: most of
        // it is about this list, and the reader looking at this list is the
        // one it is for.
        const tour = button('unsorted-view-tour-btn inbox-tour-btn',
            this.dash.formatDashboardLabel('inboxTour', {}, 'Tour'),
            () => { void this.dash.inbox?.openTour?.(); });
        tour.title = this.dash.formatDashboardLabel('inboxTourHint', {},
            'A short tour of the inbox and the Kept tab');

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
            ['checked', d.formatDashboardLabel('unsortedSortChecked', {}, 'last checked')],
        ];
    }

    groupOptions() {
        const d = this.dash;
        return [
            ['none', d.formatDashboardLabel('unsortedGroupNone', {}, 'no grouping')],
            ['site', d.formatDashboardLabel('unsortedGroupSite', {}, 'group by site')],
            ['date', d.formatDashboardLabel('unsortedGroupDate', {}, 'group by age')],
            ['tag', d.formatDashboardLabel('unsortedGroupTag', {}, 'group by tag')],
            ['suggested', d.formatDashboardLabel('unsortedGroupSuggested', {}, 'group by suggested tag')],
        ];
    }

    /**
     * The three controls this list reads by, for the shell's own toolbar row.
     *
     * A plain wrapper rather than a `.lvs-toolbar` of its own: the row it goes
     * into is already one, and nesting a second drew two toolbars inside each
     * other with the selects escaping to the outer one.
     */
    _buildToolbar() {
        const d = this.dash;
        const toolbar = document.createElement('div');
        toolbar.className = 'unsorted-view-toolbar';
        const slot = document.createElement('div');
        slot.className = 'unsorted-view-toolbar-slot';

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
                this.rememberReading();
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
                this.rememberReading();
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

    /**
     * Keep the sort and the grouping, so the next visit reads the pile the way
     * this one left it -- on every browser, which is why they are settings
     * rather than something kept in this one.
     */
    rememberReading() {
        const d = this.dash;
        if (!d.settings) return;
        d.settings.unsortedSort = this.sort;
        d.settings.unsortedGroup = this.groupBy;
        void d.saveSettings?.();
    }

    /**
     * The tag this bookmark's address would be given by the reader's own tag
     * rules, whether or not it carries it yet.
     *
     * A rule is a host, or a host and its first path segment (TagRule in
     * models.go), so both spellings are tried, the longer one first: a rule for
     * `github.com/nextdash` is more specific than one for `github.com` and
     * should win.
     */
    _suggestedTag(bookmark) {
        // The engine first, so the group a row lands in is the tag its own
        // chip offers. The rule walk below stays as the answer for a browser
        // that has not loaded the adapter yet -- and it is what the engine
        // would say anyway, since a rule outranks every other source.
        const live = window.TagSuggestLive;
        if (live) {
            const top = live.topTag(this.dash, bookmark);
            if (top) return top;
        }
        const rules = this.dash.settings?.tagRules;
        if (!Array.isArray(rules) || !rules.length) return '';
        let host = '';
        let segment = '';
        try {
            const url = new URL(String(bookmark?.url || ''));
            host = url.hostname.replace(/^www\./i, '').toLowerCase();
            segment = url.pathname.split('/').filter(Boolean)[0] || '';
        } catch (_error) {
            return '';
        }
        if (!host) return '';
        const wanted = segment ? [`${host}/${segment.toLowerCase()}`, host] : [host];
        for (const pattern of wanted) {
            const hit = rules.find((rule) =>
                String(rule?.pattern || '').trim().toLowerCase() === pattern);
            if (hit) return String(hit.tag || '').trim().toLowerCase();
        }
        return '';
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
        // What the row shows or carries, not only its name and address: a
        // link kept for its note or tagged on the way in is found by that.
        const haystack = [
            bookmark?.name, bookmark?.url, bookmark?.note,
            bookmark?.previewTitle, bookmark?.previewDesc,
            ...this._tagsOf(bookmark),
        ].map((part) => String(part || '')).join('\u0000').toLowerCase();
        return haystack.includes(query);
    }

    /** True when the last check on this link came back with an error. */
    _isBroken(bookmark) {
        return Boolean(String(bookmark?.lastError || '').trim());
    }

    /** True when the same address is already filed on a page. */
    _isDuplicate(bookmark) {
        return Boolean(this._filedElsewhere(bookmark));
    }

    _brokenBookmarks() {
        return this._bookmarks.filter((bookmark) => this._isBroken(bookmark));
    }

    _visibleBookmarks() {
        const query = this.searchQuery.trim().toLowerCase();
        const list = this._bookmarks.filter((bookmark) => this._matchesQuery(bookmark, query)
            && (!this.brokenOnly || this._isBroken(bookmark))
            && (!this.duplicatesOnly || this._isDuplicate(bookmark)));
        return this._sortBookmarks(list);
    }

    /**
     * What the health report deliberately leaves out, said here instead.
     *
     * Health is about the library as it stands on the dashboard, and a kept
     * link has no category to be reported under -- but it is still checked, so
     * it can rot without anything saying so. This is that line: how many of
     * these answered with an error, and a button that narrows the list to
     * them, where they can be fixed or thrown away.
     */
    _buildBrokenNote() {
        const d = this.dash;
        const broken = this._brokenBookmarks().length;
        if (!broken) return null;
        const note = document.createElement('div');
        note.className = 'unsorted-broken-note';
        const text = document.createElement('span');
        text.className = 'unsorted-broken-count';
        text.textContent = d.formatDashboardLabel('unsortedBrokenCount',
            { count: broken }, `${broken} of these links do not answer`);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'unsorted-broken-btn';
        button.textContent = this.brokenOnly
            ? d.formatDashboardLabel('unsortedBrokenClear', {}, 'Show all again')
            : d.formatDashboardLabel('unsortedBrokenShow', {}, 'Show them');
        button.addEventListener('click', () => {
            this.brokenOnly = !this.brokenOnly;
            this.renderBody();
        });
        note.append(text, button);
        return note;
    }

    /**
     * The second copies, counted, with a way to see them and a way to clear
     * them. A kept link whose address is already filed is not waiting for a
     * decision -- it was made, somewhere else -- so this list is the one place
     * it can be cleared in bulk rather than found row by row.
     */
    _buildDupesNote() {
        const d = this.dash;
        const dupes = this._bookmarks.filter((bookmark) => this._isDuplicate(bookmark));
        if (!dupes.length) {
            this.duplicatesOnly = false;
            return null;
        }
        const note = document.createElement('div');
        note.className = 'unsorted-broken-note unsorted-dupes-note';
        const text = document.createElement('span');
        text.className = 'unsorted-broken-count';
        text.textContent = d.formatDashboardLabel('unsortedDupesCount',
            { count: dupes.length }, `${dupes.length} of these are already filed on a page`);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'unsorted-broken-btn unsorted-dupes-btn';
        button.textContent = this.duplicatesOnly
            ? d.formatDashboardLabel('unsortedBrokenClear', {}, 'Show all again')
            : d.formatDashboardLabel('unsortedBrokenShow', {}, 'Show them');
        button.addEventListener('click', () => {
            this.duplicatesOnly = !this.duplicatesOnly;
            this.renderBody();
        });
        note.append(text, button);
        if (this.duplicatesOnly) {
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.className = 'unsorted-broken-btn unsorted-dupes-clear';
            clear.textContent = d.formatDashboardLabel('unsortedDupesClear', {}, 'Remove the kept copies');
            clear.addEventListener('click', () => {
                const rows = this._visibleBookmarks();
                if (rows.length) void this.select?.deleteSelected({ rows });
            });
            note.appendChild(clear);
        }
        return note;
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
            case 'checked':
                /*
                 * What needs looking at first: the ones that answered with an
                 * error, then the ones never checked at all, then by how long
                 * ago the last check was. Sorting by the timestamp alone put
                 * the never-checked (0) and the broken in the same place for
                 * opposite reasons.
                 */
                sorted.sort((a, b) => {
                    const rank = (bookmark) => {
                        if (String(bookmark?.lastError || '').trim()) return 0;
                        if (!(Number(bookmark?.lastChecked) || 0)) return 1;
                        return 2;
                    };
                    return rank(a) - rank(b)
                        || (Number(a?.lastChecked) || 0) - (Number(b?.lastChecked) || 0)
                        || byName(a, b);
                });
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
                // other two. Untagged rows share a block, last: it is the pile
                // a tagging pass starts from, and tick-the-group plus Suggest
                // tags works on it like on any other.
                const tags = this._tagsOf(bookmark);
                if (!tags.length) {
                    push(DashboardUnsorted.UNTAGGED_GROUP, this.dash.formatDashboardLabel(
                        'unsortedGroupNoTag', {}, 'no tag'), bookmark);
                    return;
                }
                tags.forEach((tag) => push(tag, tag, bookmark));
                return;
            }
            if (this.groupBy === 'date') {
                const bucket = this._dateBucket(bookmark?.createdAt);
                push(bucket.key, bucket.label, bookmark);
                return;
            }
            if (this.groupBy === 'suggested') {
                /*
                 * The tag the reader's own rules would give this address, so a
                 * batch can be filed in one move. Unlike grouping by tag, rows
                 * no rule matches are kept -- in a group of their own, because
                 * "nothing suggests a home for these" is the answer this
                 * grouping exists to give, not a row to hide.
                 */
                const tag = this._suggestedTag(bookmark);
                push(tag || '\u0000none', tag || this.dash.formatDashboardLabel(
                    'unsortedGroupNoSuggestion', {}, 'no suggestion'), bookmark);
                return;
            }
            const host = this._hostOf(bookmark?.url);
            push(host, host || this.dash.formatDashboardLabel('unsortedGroupNoSite', {}, 'no site'), bookmark);
        });

        const built = [...groups.values()];
        if (order) {
            built.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
        } else {
            const last = (group) => (group.key === DashboardUnsorted.UNTAGGED_GROUP ? 1 : 0);
            built.sort((a, b) => last(a) - last(b)
                || b.bookmarks.length - a.bookmarks.length
                || a.label.localeCompare(b.label));
        }
        return built;
    }

    renderBody() {
        this._filedIndexSource = null;
        const d = this.dash;
        const host = this._bodyHost;
        if (!host || !this._stillShowing()) return;

        host.innerHTML = '';
        this.syncHead();
        const brokenNote = this._buildBrokenNote();
        if (brokenNote) host.appendChild(brokenNote);
        const dupesNote = this._buildDupesNote();
        if (dupesNote) host.appendChild(dupesNote);
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
            host.appendChild(this._buildEmptyState());
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
        host.appendChild(this._buildLegend());

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
            if (!res.ok) {
                /*
                 * A refusal that will read differently next time does not count
                 * as having asked.
                 *
                 * Only the catch used to clear this, so a 429 was permanent for
                 * the session: hovering enough rows trips the server's own
                 * 60/min gate, and every URL caught by it never loaded a
                 * preview again however often it was hovered. The server's
                 * limit is per minute, so the mark has to be per attempt.
                 *
                 * A 4xx that is about the address itself stays marked -- asking
                 * again on every hover would spend the same budget on an answer
                 * that is not going to change.
                 */
                if (res.status === 429 || res.status === 408 || res.status >= 500) {
                    this._previewAsked.delete(url);
                }
                return;
            }
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
        // Per row, not the page: a read-then-write of the whole list here put
        // back rows a move or delete had taken off in the second between.
        const updates = [...pending].map(([url, values]) => ({
            url,
            previewTitle: String(values.previewTitle || ''),
            previewDesc: String(values.previewDesc || ''),
            previewImage: String(values.previewImage || ''),
        }));
        try {
            await fetcher('/api/bookmarks', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: pageId, updates }),
            });
        } catch (_error) {
            // Left unsaved rather than retried: the fields are still in memory
            // for this session, and the next hover on a fresh load asks again.
        }
    }

    /**
     * The keys that work here, under the list.
     *
     * The inbox and the health view have carried one since they were built;
     * this list had the grid's arrows and no word about them, and the tick it
     * needs most -- x over a list of two hundred rows -- was unreachable
     * without knowing it existed.
     */
    _buildLegend() {
        const legend = document.createElement('p');
        legend.className = 'inbox-legend unsorted-legend';
        legend.setAttribute('aria-hidden', 'true');
        const keys = window.KeyboardViewLegends
            ? window.KeyboardViewLegends.toLegendPairs(
                window.KeyboardViewLegends.KEPT_VIEW,
                (key, fallback) => this.dash.formatDashboardLabel(key, {}, fallback))
            : [];
        legend.innerHTML = keys
            .map(([k, label]) => `<span><kbd>${this.dash.escapeHtml(k)}</kbd> ${this.dash.escapeHtml(label)}</span>`)
            .join('');
        return legend;
    }

    _buildEmptyState() {
        const d = this.dash;
        const query = this.searchQuery.trim();
        const empty = document.createElement('div');
        empty.className = 'empty-state empty-state--unsorted';
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
            this._addRowHints(row, bookmark);
            this._addSuggestChips(row, bookmark);
        });
        return block;
    }

    /**
     * The two facts that decide a kept link, said on the row.
     *
     * How long it has waited, because a kept link is a decision postponed and
     * the length of the postponement is the whole argument for ending it --
     * and it was readable only by switching the grouping to age. And whether
     * the collection already holds the address, because then filing is not a
     * move but a duplicate, and the row read exactly like one nobody had ever
     * seen.
     *
     * Beside the row, for the reason the suggestion chips are: a bookmark row
     * is a subgrid whose columns are spoken for.
     */
    _addRowHints(row, bookmark) {
        if (row.nextElementSibling?.classList.contains('unsorted-row-hints')) {
            row.nextElementSibling.remove();
        }
        const parts = [];
        /*
         * What it already carries, first: two tags and a count for the rest.
         *
         * They were only in the edit form, so a list grouped by anything but
         * tag gave no hint which rows were already described. Two because a
         * row of five chips is a row nobody reads; the count says there is
         * more, and its title says what.
         */
        const own = (Array.isArray(bookmark?.tags) ? bookmark.tags : [])
            .map((tag) => String(tag || '').trim())
            .filter(Boolean);
        own.slice(0, 2).forEach((tag) => {
            const chip = document.createElement('span');
            chip.className = 'unsorted-row-tag';
            chip.textContent = `#${tag}`;
            parts.push(chip);
        });
        if (own.length > 2) {
            const more = document.createElement('span');
            more.className = 'unsorted-row-tag-more';
            more.textContent = `+${own.length - 2}`;
            more.title = own.slice(2).map((tag) => `#${tag}`).join(' ');
            parts.push(more);
        }
        const age = this._ageLabel(bookmark);
        if (age) {
            const chip = document.createElement('span');
            chip.className = 'unsorted-row-age';
            chip.textContent = age;
            chip.title = this.dash.formatDashboardLabel('unsortedRowAge', { age },
                `Kept ${age} ago, still without a page`);
            parts.push(chip);
        }
        const destination = window.DestinationSuggest?.forBookmark?.(this.dash, bookmark);
        if (destination) {
            const label = destination.categoryLabel
                ? `${destination.pageLabel} / ${destination.categoryLabel}`
                : destination.pageLabel;
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'unsorted-row-destination';
            chip.textContent = this.dash.formatDashboardLabel('unsortedRowDestination', { place: label },
                `file on ${label}`);
            chip.title = this.dash.formatDashboardLabel('unsortedRowDestinationHint',
                { have: destination.have, place: label },
                `${destination.have} links from this site are filed on ${label}`);
            chip.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void this.select?.fileWhereNeighboursAre(bookmark, destination);
            });
            parts.push(chip);
        }
        const filedOn = this._filedElsewhere(bookmark);
        if (filedOn) {
            // A button, because the hint is also the way out: the copy here is
            // the spare, and one click clears it (with the toast's undo).
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'unsorted-row-filed';
            chip.textContent = this.dash.formatDashboardLabel('unsortedRowFiled', { page: filedOn },
                `already on ${filedOn}`);
            chip.title = this.dash.formatDashboardLabel('unsortedRowFiledRemove', { page: filedOn },
                `Already filed on ${filedOn} — click to remove this kept copy`);
            chip.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void this.select?.deleteSelected({ rows: [bookmark], confirmed: true });
            });
            parts.push(chip);
        }
        if (!parts.length) return;
        const wrap = document.createElement('span');
        wrap.className = 'unsorted-row-hints';
        parts.forEach((part) => wrap.appendChild(part));
        row.insertAdjacentElement('afterend', wrap);
    }

    /**
     * How long this has been waiting, in one or two characters, or nothing.
     *
     * Nothing under a week: a link kept this morning is not a decision anyone
     * is putting off, and a timestamp on every row is noise that makes the
     * rows that matter harder to see.
     */
    _ageLabel(bookmark) {
        const created = Number(bookmark?.createdAt) || 0;
        if (!created) return '';
        const days = Math.floor((Date.now() - created) / 86400000);
        if (days < 7) return '';
        if (days < 30) return this.dash.formatDashboardLabel(
            'unsortedAgeWeeks', { count: Math.floor(days / 7) }, `${Math.floor(days / 7)}w`);
        if (days < 365) return this.dash.formatDashboardLabel(
            'unsortedAgeMonths', { count: Math.floor(days / 30) }, `${Math.floor(days / 30)}mo`);
        return this.dash.formatDashboardLabel(
            'unsortedAgeYears', { count: Math.floor(days / 365) }, `${Math.floor(days / 365)}y`);
    }

    /**
     * Every filed bookmark by URL, built once per list of them rather than
     * searched once per row: a few hundred kept rows against a few thousand
     * filed ones was a full walk per row on every repaint. renderBody drops it,
     * so an edit made in place is seen on the next paint.
     */
    _filedIndex() {
        const all = this.dash.allBookmarks || [];
        if (this._filedIndexSource === all) {
            return this._filedIndexMap;
        }
        const map = new Map();
        all.forEach((entry) => {
            const key = String(entry?.url || '').trim().toLowerCase();
            if (key && !map.has(key)) map.set(key, entry);
        });
        this._filedIndexSource = all;
        this._filedIndexMap = map;
        return map;
    }

    /** The page already holding this address, if the collection has it filed. */
    _filedElsewhere(bookmark) {
        const url = String(bookmark?.url || '').trim().toLowerCase();
        if (!url) return '';
        const hit = this._filedIndex().get(url);
        if (!hit) return '';
        const page = (this.dash.pages || []).find(
            (entry) => String(entry.id) === String(hit.pageId));
        return this.dash.pageNav?.pageLabel?.(hit.pageId) || page?.name || String(hit.pageId || '');
    }

    /**
     * What this link would be called, offered on the row itself.
     *
     * The same engine Config → Bookmarks → Suggestions runs, through the one
     * adapter (shared/tag-suggest-live.js). A kept link is a link nobody has
     * filed yet, which is exactly the row a proposed tag is worth something
     * on -- and reaching it through config meant leaving the list to go and
     * tag, which is the trip this view exists to save.
     */
    _addSuggestChips(row, bookmark) {
        // Beside the row rather than inside it: a bookmark row is a subgrid
        // whose columns are already spoken for, so a child lands in the next
        // cell and draws over the name. A sibling spanning every column sits
        // under the row, where a footnote about it belongs.
        if (row.nextElementSibling?.classList.contains('tag-suggest-chips')) {
            row.nextElementSibling.remove();
        }
        const live = window.TagSuggestLive;
        if (!live) return;
        const offers = live.forBookmark(this.dash, bookmark).slice(0, 2);
        if (!offers.length) return;
        const wrap = document.createElement('span');
        wrap.className = 'tag-suggest-chips';
        const drawn = window.TagSuggestChips.render(wrap, offers, {
            limit: 2,
            t: (key, fallback, params) => this.dash.formatDashboardLabel(
                key.replace(/^dashboard\./, ''), params || {}, fallback),
            onAccept: (tag) => { void this.select?.acceptSuggestion(bookmark, tag); },
            onRefuse: (offer) => { void this.dismissSuggestion(offer); },
        });
        if (drawn) row.insertAdjacentElement('afterend', wrap);
    }

    /**
     * Turn one down, the way config does: against the pattern and the tag
     * rather than against the rows under it, so it does not come back the
     * moment one more link on that site arrives.
     */
    async dismissSuggestion(offer) {
        await window.TagSuggestChips?.refuse(this.dash, offer, {
            onUpdated: () => this.renderBody(),
        });
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
        const rows = group.bookmarks;

        /*
         * The group, as one thing to act on.
         *
         * Grouping is how a pile is read -- by site, by age, by tag -- and the
         * point of reading it that way is usually to do the same thing to a
         * whole group. The box ticks every row in it (and reads as mixed when
         * only some are), the name does the same, and a right-click offers
         * what the selection bar does, for this group.
         */
        const check = document.createElement('label');
        check.className = 'unsorted-group-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'unsorted-group-check-input';
        box.setAttribute('aria-label', this.dash.formatDashboardLabel('unsortedGroupSelect',
            { group: group.label }, `Select every link in ${group.label}`));
        box.addEventListener('change', () => this.select?.setMany(rows, box.checked));
        check.appendChild(box);
        title.appendChild(check);
        title.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.select?.openGroupMenu(title, rows, group.label, { x: event.clientX, y: event.clientY });
        });

        const prefix = document.createElement('span');
        prefix.className = 'category-title-prefix';
        prefix.textContent = '// ';
        prefix.setAttribute('aria-hidden', 'true');

        const name = document.createElement('span');
        name.className = 'category-title-name';
        name.textContent = group.label;
        name.setAttribute('role', 'button');
        name.tabIndex = 0;
        name.title = this.dash.formatDashboardLabel('unsortedGroupSelect',
            { group: group.label }, `Select every link in ${group.label}`);
        const toggle = () => this.select?.toggleGroup(rows);
        name.addEventListener('click', toggle);
        name.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle();
            }
        });

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
