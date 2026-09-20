/**
 * Selection and bulk actions in the Unsorted view.
 *
 * The grid's own DashboardMultiSelect cannot serve here: it resolves a row
 * through data-bookmark-index against d.bookmarks, which holds the current
 * page, and every row in this view lives on the hidden unsorted page instead.
 * Health hit the same wall and answered it the same way — its own small
 * selection object over records that carry their own pageId and index.
 *
 * Selection is a Set of url+name keys rather than indices: the list re-sorts on
 * every keystroke in the search box, so an index means a different row a moment
 * later, while the key survives a re-render and a re-sort both.
 *
 * The gesture is the inbox's and health's: a checkbox on the row, quiet until
 * the row is hovered or ticked, and a bar of actions that appears above the
 * list once something is. No mode to switch on first -- three surfaces that
 * each ask for a different first move is three things to learn.
 *
 * Deleting goes to /api/health/delete-bookmarks, which is not a health concept
 * despite the address: it deletes by position, highest index first, and refuses
 * any row whose stored URL disagrees with the one the client believed was
 * there. That check is what makes deleting from a re-sorted list safe.
 */
class DashboardUnsortedSelect {
    /** Mirrors DashboardUnsorted.PAGE_ID, for the fallback when nothing fetched yet. */
    static PAGE_ID = 999999;

    /**
     * Gap between two requests in a sweep.
     *
     * The server allows sixty a minute (ssrfAPIRequestsPerMinute), so one every
     * 1.2s is fifty a minute -- under the ceiling, with room left for the hover
     * fetches and the preview cards that share the same budget.
     */
    static SWEEP_INTERVAL_MS = 1200;

    constructor(unsorted) {
        this.unsorted = unsorted;
        this.selected = new Set();
        this._toolbar = null;
        this._busy = false;
    }

    get dash() {
        return this.unsorted.dash;
    }

    t(key, fallback, vars) {
        return this.dash.formatDashboardLabel(key, vars || {}, fallback);
    }

    /** url + name, the same pairing the row's own delete path uses. */
    keyFor(bookmark) {
        if (!bookmark) return '';
        return `${String(bookmark.url || '').trim()}\u0000${String(bookmark.name || '').trim()}`;
    }

    isActive() {
        return this.selected.size > 0;
    }

    count() {
        return this.selected.size;
    }

    clear() {
        this.selected.clear();
        this.sync();
    }

    toggleKey(key) {
        if (!key) return;
        if (this.selected.has(key)) {
            this.selected.delete(key);
        } else {
            this.selected.add(key);
        }
        this.sync();
    }

    /**
     * Tick every row the search and the grouping currently show, or untick them
     * when they are all ticked already, so the button undoes itself.
     */
    toggleAllVisible() {
        const visible = this.unsorted._visibleBookmarks();
        if (!visible.length) return;
        const keys = visible.map((bookmark) => this.keyFor(bookmark));
        const on = !keys.every((key) => this.selected.has(key));
        keys.forEach((key) => {
            if (on) {
                this.selected.add(key);
            } else {
                this.selected.delete(key);
            }
        });
        this.sync();
    }

    /**
     * Drop keys nothing in the view answers to any more.
     *
     * A search that narrows the list does not prune — ticks made under one
     * query survive the next, the same rule health's selection follows — but a
     * delete or a move takes its rows out of _bookmarks entirely, and a key
     * left behind would keep counting rows that are gone.
     */
    prune() {
        if (!this.selected.size) return;
        const live = new Set(this.unsorted._bookmarks.map((bookmark) => this.keyFor(bookmark)));
        let changed = false;
        this.selected.forEach((key) => {
            if (!live.has(key)) {
                this.selected.delete(key);
                changed = true;
            }
        });
        if (changed) {
            this.sync();
        }
    }

    /** The selected bookmarks, in the order the view is showing them. */
    selectedBookmarks() {
        return this.unsorted._bookmarks.filter((bookmark) => this.selected.has(this.keyFor(bookmark)));
    }

    /**
     * What a bulk action runs over: the ticked rows, or everything the search
     * and grouping leave on screen when nothing is ticked. Acting on the whole
     * visible list is the common case on a first pass, where the point is to
     * fill in what a few hundred rows are missing rather than to pick any of
     * them out.
     */
    actionTargets() {
        return this.isActive() ? this.selectedBookmarks() : this.unsorted._visibleBookmarks();
    }

    /** Paint the ticks and rebuild the bar. Called after every change. */
    sync() {
        const host = this.unsorted._bodyHost;
        if (host) {
            host.querySelectorAll('.bookmark-link[data-unsorted-key]').forEach((row) => {
                const on = this.selected.has(row.dataset.unsortedKey || '');
                row.classList.toggle('is-multi-selected', on);
                if (on) {
                    row.setAttribute('data-multi-selected', 'true');
                } else {
                    row.removeAttribute('data-multi-selected');
                }
                const box = row.querySelector('.unsorted-row-check-input');
                if (box) {
                    box.checked = on;
                }
            });
        }
        document.body.classList.toggle('has-multi-selection', this.isActive());
        this.renderToolbar();
        this.unsorted.syncHeaderActions?.();
    }

    /**
     * One delegated listener for every checkbox on the grid.
     *
     * Per row would be a few hundred listeners re-attached on every keystroke
     * in the search box, since the grid is rebuilt each time.
     */
    bindRows(host) {
        if (!host || host._unsortedSelectBound) return;
        host._unsortedSelectBound = true;
        host.addEventListener('change', (event) => {
            const box = event.target instanceof Element
                ? event.target.closest('.unsorted-row-check-input')
                : null;
            if (!box) return;
            const row = box.closest('.bookmark-link[data-unsorted-key]');
            if (!row) return;
            this.toggleKey(row.dataset.unsortedKey || '');
        });
        // The box sits inside the row, and the row opens the bookmark: without
        // this, ticking one opened the link behind it.
        host.addEventListener('click', (event) => {
            if (event.target instanceof Element
                && event.target.closest('.unsorted-row-check')) {
                event.stopPropagation();
            }
        });
    }

    /**
     * The row's tick box, shaped like the inbox's.
     *
     * Absolutely positioned rather than a fourth grid child: the row is a grid
     * with its lead, link and shortcut columns already declared, and a new
     * child would push the whole list sideways. So it sits over the lead icon,
     * which is exactly where the inbox puts its own.
     */
    ensureCheckbox(row, bookmark) {
        if (!row || row.querySelector('.unsorted-row-check')) return;
        const label = document.createElement('label');
        label.className = 'unsorted-row-check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'unsorted-row-check-input';
        box.checked = this.selected.has(this.keyFor(bookmark));
        box.setAttribute('aria-label', this.t(
            'unsortedSelectRow',
            `Select ${bookmark?.name || bookmark?.url || ''}`,
            { name: bookmark?.name || bookmark?.url || '' }
        ));
        label.appendChild(box);
        row.prepend(label);
    }

    renderToolbar() {
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        if (!this.isActive()) {
            this._toolbar?.remove();
            this._toolbar = null;
            return;
        }

        let bar = this._toolbar;
        const host = this.unsorted._bodyHost;
        if (!bar || !bar.isConnected) {
            bar = document.createElement('div');
            bar.className = 'multi-select-toolbar unsorted-select-toolbar';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', this.t('unsortedSelectToolbarAria', 'Selection actions'));
            // Above the list and inside the view, where health and the inbox
            // put theirs, rather than floating over the page.
            if (host?.isConnected) {
                host.parentElement.insertBefore(bar, host);
            } else {
                (container.parentElement || container).insertBefore(bar, container);
            }
            this._toolbar = bar;
        }

        bar.replaceChildren();

        const count = this.selected.size;
        const label = document.createElement('span');
        label.className = 'multi-select-count';
        label.textContent = this.t('unsortedSelectCount', `${count} selected`, { count });
        bar.appendChild(label);

        const addButton = (text, className, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `multi-select-btn ${className}`.trim();
            btn.textContent = text;
            btn.disabled = this._busy;
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick(btn);
            });
            bar.appendChild(btn);
            return btn;
        };

        addButton(this.t('unsortedSelectAll', 'Select all'), '', () => this.toggleAllVisible());
        addButton(this.t('unsortedFetchPreviews', 'Fetch previews'), '', () => {
            void this.fetchPreviews();
        });
        addButton(this.t('unsortedFetchIcons', 'Fetch icons'), '', () => {
            void this.fetchIcons();
        });
        addButton(this.t('unsortedSelectDelete', 'Delete'), 'danger', () => {
            void this.deleteSelected();
        });
        addButton(this.t('unsortedSelectClear', 'Clear'), '', () => this.clear());
    }

    /**
     * Tag the whole selection from the row menu.
     *
     * The single-row popover toggles one bookmark; twenty ticked rows meant
     * twenty trips through it. This is the grid's own three-state idea -- a tag
     * is on every selected bookmark, on some of them, or on none -- because
     * "add" and "remove" mean different things for a mixed selection and the
     * row has to say which one it will do.
     *
     * One write for the page, not one per bookmark. Every row here lives on the
     * same hidden page, and the store has no per-bookmark write: twenty saves
     * would be twenty read-modify-write cycles over the same list, each one
     * racing the last, and the loser's tag would vanish.
     */
    openTagsPopover(anchorEl) {
        const d = this.dash;
        const targets = this.selectedBookmarks();
        if (!targets.length || !anchorEl) return;

        const rows = d.bookmarkRows;
        d._closeActionPopovers?.();
        d._tagPopoverCleanup?.();

        const pop = document.createElement('div');
        pop.id = 'unsorted-tags-popover';
        pop.className = 'move-popover tag-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('tabindex', '-1');
        pop.setAttribute('aria-label', this.t('unsortedBulkTagsTitle', 'Tag selection…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('unsortedBulkTagsCount',
            `Tags · ${targets.length} selected`, { count: targets.length });
        pop.appendChild(header);

        const list = document.createElement('div');
        list.className = 'unsorted-tags-popover-list';
        pop.appendChild(list);

        let unbindOutside = null;
        let unbindPosition = null;
        let busy = false;

        const close = () => {
            pop.remove();
            unbindPosition?.();
            unbindPosition = null;
            unbindOutside?.();
            unbindOutside = null;
            document.removeEventListener('keydown', onKey, true);
            if (d._tagPopoverCleanup === close) {
                d._tagPopoverCleanup = null;
            }
            // The view refuses to repaint while a `.move-popover` is open --
            // this is one -- so the grid catches up the moment it closes.
            if (this.unsorted.isActiveView()) {
                void this.unsorted.loadAndRender();
            }
        };

        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        };

        const paint = () => {
            list.replaceChildren();
            const known = this.knownTags();
            if (!known.length) {
                const empty = document.createElement('div');
                empty.className = 'tag-popover-empty-hint';
                empty.textContent = this.t('unsortedBulkTagsEmpty',
                    'No tags yet. Add one to a single bookmark first.');
                list.appendChild(empty);
                return;
            }
            const sectionLabel = document.createElement('div');
            sectionLabel.className = 'move-popover-section-label';
            sectionLabel.textContent = this.t('unsortedBulkTagsSection', 'All tags');
            list.appendChild(sectionLabel);

            known.forEach((tag) => {
                const on = targets.filter((bookmark) => this._tagsOf(bookmark).includes(tag)).length;
                const all = on === targets.length;
                // A div with role="option", exactly as the single-row tag
                // popover builds its rows: the popover's styling hangs off
                // .move-popover-item, and a <button> brought the browser's own
                // grey chrome along with it.
                const item = document.createElement('div');
                item.className = `move-popover-item unsorted-tags-popover-item${all ? ' is-current' : ''}`;
                item.setAttribute('role', 'option');
                item.setAttribute('data-tag', tag);
                item.setAttribute('aria-selected', all ? 'true' : 'false');
                item.setAttribute('tabindex', '-1');

                const mark = document.createElement('span');
                mark.className = 'move-popover-check';
                // Three states, three marks: on all of them, on some, on none.
                mark.textContent = all ? '✓' : (on > 0 ? '–' : '');

                const label = document.createElement('span');
                label.className = 'tag-popover-item-label';
                label.textContent = `#${tag}`;

                const count = document.createElement('span');
                count.className = 'unsorted-tags-popover-count';
                count.textContent = `${on}/${targets.length}`;

                item.append(mark, label, count);
                if (!busy) {
                    item.addEventListener('click', () => {
                        void apply(tag, !all);
                    });
                }
                list.appendChild(item);
            });
        };

        const apply = async (tag, add) => {
            if (busy) return;
            busy = true;
            paint();
            const ok = await this.applyTagToSelection(tag, add);
            busy = false;
            if (!ok) {
                close();
                return;
            }
            paint();
        };

        paint();
        document.body.appendChild(pop);
        unbindPosition = rows?._attachActionPopoverPositioning?.(pop, anchorEl) || null;
        unbindOutside = rows?._bindActionPopoverOutsideClose?.(pop, close, { anchorEl }) || null;
        document.addEventListener('keydown', onKey, true);
        d._tagPopoverCleanup = close;
        pop.focus({ preventScroll: true });
    }

    /**
     * Every tag the library knows, so a bulk tag can reuse an existing name.
     *
     * The kept bookmarks included: they are split out of allBookmarks on load,
     * and without them this list could not offer the tags already used in this
     * very view.
     */
    knownTags() {
        const d = this.dash;
        const filed = (d.allBookmarks?.length ? d.allBookmarks : d.bookmarks) || [];
        const pool = [...filed, ...(d.unsortedBookmarks || [])];
        const tags = new Set();
        pool.forEach((bookmark) => this._tagsOf(bookmark).forEach((tag) => tags.add(tag)));
        return [...tags].sort();
    }

    _tagsOf(bookmark) {
        return this.unsorted._tagsOf(bookmark);
    }

    /**
     * Add or remove one tag across the selection, in a single page write.
     *
     * Matched by URL and name rather than by the index the view is holding: the
     * write reads the page fresh, and anything that changed it in between (a
     * promote, a delete from another tab) has already renumbered it.
     */
    async applyTagToSelection(tag, add) {
        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || DashboardUnsortedSelect.PAGE_ID;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const wanted = new Set(this.selectedBookmarks().map((bookmark) => this.keyFor(bookmark)));
        if (!wanted.size) return false;

        window.nextdashTrack?.('unsorted:bulk-tag', { count: wanted.size, add: !!add });
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`read HTTP ${res.status}`);
            const bookmarks = await res.json();
            if (!Array.isArray(bookmarks)) throw new Error('unexpected page shape');

            let touched = 0;
            bookmarks.forEach((bookmark) => {
                if (!wanted.has(this.keyFor(bookmark))) return;
                const tags = this._tagsOf(bookmark);
                const has = tags.includes(tag);
                if (add === has) return;
                bookmark.tags = add ? [...tags, tag] : tags.filter((entry) => entry !== tag);
                touched += 1;
            });
            if (!touched) return true;

            const save = await fetcher(`/api/bookmarks?page=${pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks),
            });
            if (!save.ok) throw new Error(`write HTTP ${save.status}`);

            // Written, so the copies this view is holding are stale. Patched in
            // place rather than refetched: loadAndRender bails while a popover
            // is open (this one is), and the popover's own three-state marks
            // read straight off these objects.
            const applied = new Set();
            bookmarks.forEach((bookmark) => {
                if (wanted.has(this.keyFor(bookmark))) {
                    applied.add(this.keyFor(bookmark));
                }
            });
            this.unsorted._bookmarks.forEach((bookmark) => {
                if (!applied.has(this.keyFor(bookmark))) return;
                const tags = this._tagsOf(bookmark);
                bookmark.tags = add
                    ? (tags.includes(tag) ? tags : [...tags, tag])
                    : tags.filter((entry) => entry !== tag);
            });

            void d.data?.fetchAndStoreDataRevision?.();
            await this.unsorted.loadAndRender();
            d.showNotification(
                add
                    ? this.t('unsortedBulkTagAdded', `Tagged ${touched} bookmark(s)`, { count: touched, tag })
                    : this.t('unsortedBulkTagRemoved', `Untagged ${touched} bookmark(s)`, { count: touched, tag }),
                'success',
                { duration: 3000 }
            );
            return true;
        } catch {
            d.showNotification(this.t('unsortedBulkTagFailed', 'Could not change the tags'), 'error');
            return false;
        }
    }

    async confirmDanger(title, message, confirmText) {
        if (window.AppModal && typeof window.AppModal.danger === 'function') {
            return window.AppModal.danger({
                title,
                message,
                confirmText,
                cancelText: this.t('cancel', 'Cancel'),
            });
        }
        return window.confirm(message);
    }

    async deleteSelected() {
        const targets = this.selectedBookmarks();
        if (!targets.length || this._busy) return;

        const count = targets.length;
        const confirmed = await this.confirmDanger(
            this.t('unsortedDeleteTitle', 'Delete unsorted bookmarks'),
            this.t('unsortedDeleteConfirm', `Delete ${count} bookmark(s)?`, { count }),
            this.dash.configLabel ? this.dash.configLabel('delete', 'Delete') : 'Delete'
        );
        if (!confirmed) return;

        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || 999999;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        window.nextdashTrack?.('unsorted:bulk-delete', { count });

        this._busy = true;
        try {
            const res = await fetcher('/api/health/delete-bookmarks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: targets.map((bookmark) => ({
                        pageId,
                        index: Number(bookmark.index),
                        url: bookmark.url,
                    })),
                }),
            });
            if (!res.ok) throw new Error(`bulk delete HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            const deleted = Number(body.deleted) || 0;
            const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;

            this.selected.clear();
            targets.forEach((bookmark) => d.removeBookmarkByUrl?.(pageId, bookmark.url));
            d.data?.invalidatePageDataCache?.(pageId);
            void d.data?.fetchAndStoreDataRevision?.();

            await this.unsorted.loadAndRender();

            if (skipped > 0) {
                d.showNotification(
                    this.t('unsortedDeletePartial',
                        `Deleted ${deleted}; ${skipped} had changed — reopen the view`,
                        { count: deleted, skipped }),
                    'warning'
                );
                return;
            }
            d.showNotification(
                this.t('unsortedDeleted', `Deleted ${deleted} bookmark(s)`, { count: deleted }),
                'success',
                { duration: 4000 }
            );
        } catch {
            d.showNotification(this.t('unsortedDeleteFailed', 'Could not delete the bookmarks'), 'error');
        } finally {
            this._busy = false;
            this.sync();
        }
    }

    /**
     * Ask each page what it says about itself, one at a time.
     *
     * Serial on purpose: every one of these is an outbound request to somebody
     * else's server, and the endpoint is behind the same SSRF rate limiter the
     * rest of the app's fetches are. A few hundred in parallel would trip it and
     * come back as a wall of failures.
     */
    /** What a preview sweep would actually ask for: the rows still without one. */
    previewTargets() {
        return this.actionTargets().filter((bookmark) => !this.unsorted._hasPreview(bookmark));
    }

    async fetchPreviews() {
        const targets = this.previewTargets();
        if (this._busy) return;
        if (!targets.length) {
            this.dash.showNotification(
                this.t('unsortedPreviewsAllPresent', 'Every one of these already has a preview'),
                'info', { duration: 3000 });
            return;
        }
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        window.nextdashTrack?.('unsorted:fetch-previews', { count: targets.length });

        await this._runOverEach(targets, {
            title: this.t('unsortedFetchPreviewsTitle', 'Fetching previews…'),
            run: async (bookmark) => {
                const url = String(bookmark?.url || '').trim();
                if (!url) return 'failed';
                // No refresh=1: these rows have no preview at all, so the
                // server's cached answer is exactly what is wanted, and forcing
                // a re-fetch would spend the rate limit on pages it already
                // knows.
                const res = await fetcher(`/api/bookmark-preview?url=${encodeURIComponent(url)}`);
                if (res.status === 429) {
                    return { rateLimited: true, retryAfter: Number(res.headers.get('Retry-After')) || 60 };
                }
                if (!res.ok) return 'failed';
                // Onto the record, not just into the server's cache: the row
                // has to carry its own preview, or the next load asks again.
                this.unsorted.applyPreview(bookmark, await res.json().catch(() => null));
                return 'ok';
            },
            done: (ok, failed) => this.t('unsortedFetchPreviewsDone',
                `Fetched ${ok} preview(s)${failed ? `, ${failed} failed` : ''}`, { count: ok, failed }),
        });
    }

    /**
     * Favicons for the rows that have none.
     *
     * The whole page rather than the selection: the icon fetch writes the page
     * back once per batch, and the endpoint already walks it missing-first, so
     * pointing it at the page is both fewer requests and less to go wrong than
     * assembling a per-row write of our own.
     */
    async fetchIcons() {
        if (this._busy) return;
        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || 999999;
        const prefetch = await this.unsorted.ensureFaviconPrefetch();
        if (!prefetch) {
            d.showNotification(this.t('unsortedFetchIconsFailed', 'Could not fetch the icons'), 'error');
            return;
        }
        window.nextdashTrack?.('unsorted:fetch-icons', {});
        this._busy = true;
        this.sync();
        const hadIcon = (bookmark) => !!String(bookmark?.icon || '').trim();
        const before = this.unsorted._bookmarks.filter(hadIcon).length;
        try {
            // Paced: a few hundred rows at four icons a batch runs into the
            // same sixty-a-minute ceiling the preview sweep does.
            await prefetch.run([pageId], {
                intervalMs: DashboardUnsortedSelect.SWEEP_INTERVAL_MS,
                // Eight at a time, the server's own cap: a few hundred rows at
                // four a request spends most of the run rate limited.
                limit: 8,
            });
            await this.unsorted.loadAndRender();
        } finally {
            this._busy = false;
            this.sync();
        }
        /*
         * Say what came back.
         *
         * The sweep can attempt every row and apply none -- a site that
         * answers without a favicon, a host that cannot be reached from here --
         * and the overlay closes the same way either way. Without a count the
         * only visible difference between "worked" and "reached nothing" is
         * that the rows still have no icon, which reads as the button being
         * broken.
         */
        const gained = this.unsorted._bookmarks.filter(hadIcon).length - before;
        if (gained > 0) {
            d.showNotification(
                this.t('unsortedFetchIconsDone', `Fetched ${gained} icon(s)`, { count: gained }),
                'success', { duration: 4000 });
            return;
        }
        d.showNotification(
            this.t('unsortedFetchIconsNone', 'No icons came back — the sites answered without one'),
            'warning');
    }

    /**
     * Walk a list, one call at a time, reporting progress in the notification
     * the run started with rather than one toast per row.
     */
    async _runOverEach(targets, { title, run, done }) {
        const d = this.dash;
        this._busy = true;
        this.sync();
        let ok = 0;
        let failed = 0;
        const notify = (text, kind) => d.showNotification(text, kind, { duration: 2500 });
        notify(`${title} (0/${targets.length})`, 'info');
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        try {
            for (let i = 0; i < targets.length; i += 1) {
                let result = 'failed';
                try {
                    result = await run(targets[i]);
                } catch {
                    result = 'failed';
                }
                /*
                 * The endpoint allows sixty a minute per client, and a sweep of
                 * two hundred rows walks straight into that: the first sixty
                 * answer, the rest come back 429 and the run reports them all
                 * as failures for no reason other than its own haste.
                 *
                 * So a refusal is not a failure. The server says how long to
                 * wait (Retry-After), the sweep waits that long and asks for
                 * the same row again. Once.
                 */
                if (result && result.rateLimited) {
                    notify(this.t('unsortedBulkRateLimited',
                        `Rate limit reached — waiting ${result.retryAfter}s`,
                        { seconds: result.retryAfter }), 'info');
                    await wait((result.retryAfter + 1) * 1000);
                    try {
                        result = await run(targets[i]);
                    } catch {
                        result = 'failed';
                    }
                    if (result && result.rateLimited) {
                        result = 'failed';
                    }
                }
                if (result === 'ok' || result === true) {
                    ok += 1;
                } else {
                    failed += 1;
                }
                // Every twenty rows rather than every row: a notification per
                // request on a 200-row sweep is a flicker, not progress.
                if ((i + 1) % 20 === 0 && i + 1 < targets.length) {
                    notify(`${title} (${i + 1}/${targets.length})`, 'info');
                }
                // Paced under the limit rather than up against it. Sixty a
                // minute is the budget, and the hover fetches and the preview
                // cards draw on the same one, so the sweep leaves room.
                if (i + 1 < targets.length) {
                    await wait(DashboardUnsortedSelect.SWEEP_INTERVAL_MS);
                }
            }
        } finally {
            this._busy = false;
        }
        d.showNotification(done(ok, failed), failed && !ok ? 'error' : (failed ? 'warning' : 'success'));
        await this.unsorted.loadAndRender();
    }
}

window.DashboardUnsortedSelect = DashboardUnsortedSelect;
