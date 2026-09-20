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
        addButton(this.t('unsortedSelectOpen', 'Open'), '', () => this.openSelected());
        addButton(this.t('unsortedSelectExport', 'Export'), '', () => this.exportSelected());
        addButton(this.t('unsortedSelectSuggest', 'Suggest tags'), '', (btn) => {
            this.openSuggestPopover(btn);
        });
        addButton(this.t('unsortedSelectMove', 'Move to…'), '', (btn) => {
            this.openMovePopover(btn);
        });
        addButton(this.t('unsortedSelectToInbox', 'Back to the inbox'), '', () => {
            void this.sendToInbox();
        });
        addButton(this.t('unsortedSelectSnooze', 'Snooze'), '', (btn) => {
            this.openSnoozeMenu(btn);
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
    /**
     * Take a suggested tag on one row.
     *
     * The selection's own path, pointed at a single bookmark: the write is the
     * same read-modify-write of the kept page either way, and a second copy of
     * it is a second place for the two to disagree about what a tag list is.
     */
    async acceptSuggestion(bookmark, tag) {
        if (!bookmark || !tag) return false;
        return this.applyTagToSelection(tag, true, [bookmark]);
    }

    async applyTagToSelection(tag, add, rows = null) {
        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || DashboardUnsortedSelect.PAGE_ID;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const targets = Array.isArray(rows) && rows.length ? rows : this.selectedBookmarks();
        const wanted = new Set(targets.map((bookmark) => this.keyFor(bookmark)));
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
            // Before the redraw, not after: the chips are drawn from the
            // engine's last answer, which was computed while these rows still
            // lacked the tag this write just gave them.
            window.TagSuggestLive?.invalidate?.();
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


    /**
     * Open every ticked row in a new tab.
     *
     * The queue beside this one has had it since it was built, for the same
     * reason: reading is how a kept link is decided, and doing that one row at
     * a time means leaving the list and coming back for every one of them.
     */
    openSelected() {
        const targets = this.selectedBookmarks();
        if (!targets.length) return;
        window.nextdashTrack?.('unsorted:bulk-open', { count: targets.length });
        targets.forEach((bookmark) => {
            const href = this.dash.safeBookmarkOpenHref?.(bookmark.url) || bookmark.url;
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
        });
    }

    /**
     * The ticked rows as a CSV.
     *
     * The same columns Config → Bookmarks exports, so the two files open the
     * same way -- this list could only be exported by going there and filtering
     * back down to the rows already ticked here.
     */
    exportSelected() {
        const targets = this.selectedBookmarks();
        if (!targets.length) return;
        const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const header = ['Name', 'URL', 'Tags', 'Notes', 'Kept'].map(escape).join(',');
        const rows = targets.map((bookmark) => [
            escape(bookmark.name),
            escape(bookmark.url),
            escape(this._tagsOf(bookmark).join(', ')),
            escape(bookmark.note || ''),
            escape(bookmark.createdAt ? new Date(Number(bookmark.createdAt)).toISOString().slice(0, 10) : ''),
        ].join(','));
        // The byte order mark is what makes a spreadsheet read the accents.
        const csv = `\ufeff${[header, ...rows].join('\r\n')}`;
        const date = new Date().toISOString().slice(0, 10);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `nextdash-kept-${date}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        window.nextdashTrack?.('unsorted:export', { count: targets.length });
        this.dash.showNotification(
            this.t('unsortedExported', `Exported ${targets.length} bookmark(s)`, { count: targets.length }),
            'success', { duration: 3000 });
    }

    /**
     * What the engine would call the ticked rows, and what it would write.
     *
     * Shown before it is written, in the shape Move to… uses: a suggestion
     * applied to forty rows is not something to discover afterwards. Each line
     * is a tag and the number of ticked rows it covers, ticked on by default --
     * the reader came here to accept them -- and unticking one leaves those
     * rows alone.
     */
    openSuggestPopover(anchorEl) {
        const d = this.dash;
        const live = window.TagSuggestLive;
        const targets = this.selectedBookmarks();
        if (!targets.length || !anchorEl || !live) return;
        d._closeActionPopovers?.();

        // tag -> the ticked rows it is offered to.
        const byTag = new Map();
        targets.forEach((bookmark) => {
            live.forBookmark(d, bookmark).slice(0, 2).forEach((offer) => {
                const rows = byTag.get(offer.tag) || [];
                rows.push(bookmark);
                byTag.set(offer.tag, rows);
            });
        });
        if (!byTag.size) {
            d.showNotification(
                this.t('unsortedSuggestNone', 'Nothing to propose for these'), 'info', { duration: 3000 });
            return;
        }

        const pop = document.createElement('div');
        pop.className = 'move-popover unsorted-suggest-popover';
        pop.id = 'unsorted-suggest-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', this.t('unsortedSuggestTitle', 'Suggested tags'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('unsortedSuggestCount',
            `Suggested for ${targets.length}`, { count: targets.length });
        pop.appendChild(header);

        const list = document.createElement('div');
        list.className = 'unsorted-suggest-list';
        pop.appendChild(list);

        const close = () => {
            pop.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            if (d._unsortedMovePopoverClose === close) d._unsortedMovePopoverClose = null;
        };
        const onOutside = (event) => {
            if (pop.contains(event.target) || anchorEl.contains(event.target)) return;
            close();
        };
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
        };
        window.EscapeOwner?.registerOwner?.('unsorted-suggest-popover', {
            isOpen: () => pop.isConnected,
            handleEscape: close,
        });

        const chosen = new Map();
        [...byTag.entries()]
            .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
            .forEach(([tag, rows]) => {
                chosen.set(tag, rows);
                const line = document.createElement('label');
                line.className = 'move-popover-item unsorted-suggest-item';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.className = 'unsorted-suggest-check';
                box.checked = true;
                box.addEventListener('change', () => {
                    if (box.checked) chosen.set(tag, rows);
                    else chosen.delete(tag);
                });
                const name = document.createElement('span');
                name.className = 'unsorted-suggest-tag';
                name.textContent = `#${tag}`;
                const count = document.createElement('span');
                count.className = 'unsorted-suggest-rows';
                count.textContent = String(rows.length);
                line.append(box, name, count);
                list.appendChild(line);
            });

        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'unsorted-suggest-apply';
        apply.textContent = this.t('unsortedSuggestApply', 'Apply');
        apply.addEventListener('click', (event) => {
            event.preventDefault();
            const picked = [...chosen.entries()];
            close();
            void this.applySuggestions(picked);
        });
        pop.appendChild(apply);

        document.body.appendChild(pop);
        if (typeof d.bookmarkRows?._positionActionPopoverBeside === 'function') {
            d.bookmarkRows._positionActionPopoverBeside(pop, anchorEl);
        }
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
        document.addEventListener('keydown', onKey, true);
        d._unsortedMovePopoverClose = close;
    }

    /**
     * Write the accepted tags, one page read and one page write for all of
     * them rather than one per tag: the kept page is a single list, and a
     * write per tag would have each one racing the last.
     */
    async applySuggestions(picked) {
        const d = this.dash;
        if (!picked?.length || this._busy) return;
        const pageId = Number(d._unsortedPageId) || DashboardUnsortedSelect.PAGE_ID;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const wanted = new Map();
        picked.forEach(([tag, rows]) => {
            rows.forEach((bookmark) => {
                const key = this.keyFor(bookmark);
                const tags = wanted.get(key) || new Set();
                tags.add(tag);
                wanted.set(key, tags);
            });
        });
        window.nextdashTrack?.('unsorted:suggest-apply', { tags: picked.length });
        this._busy = true;
        this.sync();
        let touched = 0;
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`read HTTP ${res.status}`);
            const bookmarks = await res.json();
            if (!Array.isArray(bookmarks)) throw new Error('unexpected page shape');
            bookmarks.forEach((bookmark) => {
                const add = wanted.get(this.keyFor(bookmark));
                if (!add) return;
                const tags = this._tagsOf(bookmark);
                const next = [...tags];
                add.forEach((tag) => {
                    if (!next.includes(tag)) next.push(tag);
                });
                if (next.length === tags.length) return;
                bookmark.tags = next;
                touched += 1;
            });
            if (touched) {
                const save = await fetcher(`/api/bookmarks?page=${pageId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bookmarks),
                });
                if (!save.ok) throw new Error(`write HTTP ${save.status}`);
            }
            d.showNotification(
                this.t('unsortedSuggestDone', `Tagged ${touched} bookmark(s)`, { count: touched }),
                'success', { duration: 3000 });
        } catch {
            d.showNotification(this.t('unsortedBulkTagFailed', 'Could not change the tags'), 'error');
        } finally {
            this._busy = false;
            window.TagSuggestLive?.invalidate?.();
            this.clear();
            await d.loadAllBookmarks?.();
            await this.unsorted.loadAndRender();
        }
    }

    /**
     * File the whole selection: one page and one category for all of it.
     *
     * Filing is what a kept bookmark is waiting for, and doing it a row at a
     * time through Edit is the work grouping exists to save. Two steps rather
     * than one long list: the pages, then that page's categories -- a flat list
     * of every category on every page is unreadable past a handful of pages.
     */
    openMovePopover(anchorEl, rows = null) {
        const d = this.dash;
        const targets = Array.isArray(rows) && rows.length ? rows : this.selectedBookmarks();
        if (!targets.length || !anchorEl) return;
        d._closeActionPopovers?.();

        const pop = document.createElement('div');
        pop.className = 'move-popover unsorted-move-popover';
        pop.id = 'unsorted-move-popover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', this.t('unsortedMoveTitle', 'Move to…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('unsortedMoveCount',
            `Move ${targets.length} to…`, { count: targets.length });
        pop.appendChild(header);

        const list = document.createElement('div');
        list.className = 'unsorted-move-popover-list';
        pop.appendChild(list);

        const close = () => {
            pop.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            if (d._unsortedMovePopoverClose === close) d._unsortedMovePopoverClose = null;
        };
        const onOutside = (event) => {
            if (pop.contains(event.target) || anchorEl.contains(event.target)) return;
            close();
        };
        /*
         * Escape, like every other popover in the grid.
         *
         * Two parts. The listener below closes it, and the registration says
         * the picker is the layer on top -- the inbox binds its own Escape when
         * the view opens, before any menu exists, and would otherwise see the
         * key first and close the whole view with the picker left standing over
         * an empty page (shared/escape-owner.js says the rest).
         */
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
        };
        window.EscapeOwner?.registerOwner?.('unsorted-move-popover', {
            isOpen: () => pop.isConnected,
            handleEscape: close,
        });

        const item = (label, onClick) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'move-popover-item unsorted-move-item';
            row.textContent = label;
            row.addEventListener('click', (event) => {
                event.preventDefault();
                onClick();
            });
            list.appendChild(row);
            return row;
        };

        const showPages = () => {
            list.replaceChildren();
            (d.pages || []).forEach((page) => {
                item(d.pageNav?.pageLabel?.(page.id) || page.name || String(page.id),
                    () => { void showCategories(page); });
            });
        };

        const showCategories = async (page) => {
            list.replaceChildren();
            const back = item(`← ${d.pageNav?.pageLabel?.(page.id) || page.name || ''}`, showPages);
            back.classList.add('unsorted-move-back');
            const categories = await this.categoriesOnPage(page);
            // The picker can be closed while the categories are on their way.
            if (!pop.isConnected) return;
            categories.forEach((category) => {
                item(category.label, () => {
                    close();
                    void this.moveSelectionTo(page.id, category.id, targets);
                });
            });
            item(this.t('unsortedMoveNoCategory', 'No category'), () => {
                close();
                void this.moveSelectionTo(page.id, '', targets);
            });
        };

        showPages();
        document.body.appendChild(pop);
        // The same placement every row popover in the grid uses, so this one
        // is clamped to the window the way they are.
        if (typeof d.bookmarkRows?._positionActionPopoverBeside === 'function') {
            d.bookmarkRows._positionActionPopoverBeside(pop, anchorEl);
        }
        setTimeout(() => document.addEventListener('click', onOutside, true), 0);
        document.addEventListener('keydown', onKey, true);
        d._unsortedMovePopoverClose = close;
    }

    /**
     * The categories a page holds.
     *
     * The page on screen is already loaded, so it is read from what the
     * dashboard has. Every other page is asked for -- reading them off the
     * bookmarks that carry them showed an id where a name belongs, and left
     * out every category nobody has filed anything in yet, which on a page
     * made for the purpose is all of them. The bookmarks stay as the fallback
     * for a request that does not answer.
     */
    async categoriesOnPage(page) {
        const d = this.dash;
        const byId = new Map();
        if (String(d.currentPageId) === String(page.id)) {
            (d.categories || []).filter((c) => !c.isSmartCollection).forEach((c) => {
                if (c?.id) byId.set(String(c.id), String(c.name || c.id));
            });
        } else {
            try {
                const res = await fetch(`/api/categories?page=${encodeURIComponent(page.id)}`);
                if (res.ok) {
                    const list = await res.json();
                    (Array.isArray(list) ? list : []).forEach((category) => {
                        if (category?.isSmartCollection || !category?.id) return;
                        byId.set(String(category.id), String(category.name || category.id));
                    });
                }
            } catch { /* the bookmarks below are the fallback */ }
        }
        (d.allBookmarks || [])
            .filter((bookmark) => String(bookmark?.pageId) === String(page.id))
            .forEach((bookmark) => {
                const id = String(bookmark?.category || '').trim();
                if (id && !byId.has(id)) byId.set(id, id);
            });
        return [...byId.entries()]
            .map(([id, label]) => ({ id, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    /**
     * Add to the target, then delete from the kept page -- the same pair a
     * single move makes (_moveBookmarkToPage), row by row so a failure leaves
     * the rest of the selection where it was rather than half-filed.
     */
    async moveSelectionTo(pageId, category, rows = null) {
        const targets = Array.isArray(rows) && rows.length ? rows : this.selectedBookmarks();
        if (!targets.length || this._busy) return;
        const d = this.dash;
        const sourcePage = Number(d._unsortedPageId) || 999999;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json' };
        window.nextdashTrack?.('unsorted:bulk-move', { count: targets.length });

        await this._runOverEach(targets, {
            title: this.t('unsortedMoveProgress', 'Filing', {}),
            // Two writes to this server per row and no page fetch at all.
            intervalMs: 0,
            run: async (bookmark) => {
                const moved = { ...bookmark, pageId: Number(pageId), category: String(category || '') };
                delete moved.index;
                const add = await fetcher('/api/bookmarks/add', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ page: Number(pageId), bookmark: moved, allowDuplicate: true }),
                });
                if (!add.ok) return 'failed';
                const remove = await fetcher('/api/bookmarks', {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({ page: sourcePage, bookmark }),
                });
                return remove.ok ? 'ok' : 'failed';
            },
            done: (ok, failed) => (failed
                ? this.t('unsortedMoveDoneSome', `Filed ${ok}, ${failed} failed`, { ok, failed })
                : this.t('unsortedMoveDone', `Filed ${ok}`, { ok })),
        });
        this.clear();
        await d.loadAllBookmarks?.();
    }

    /**
     * The way back: a kept link returns to the queue it was kept out of.
     *
     * Keeping is a decision, and decisions are sometimes wrong -- a link kept
     * in a hurry is one that still needs thinking about, and the inbox is
     * where thinking about links happens. The bookmark is put back as an inbox
     * item carrying its note and its tags, then removed from the kept page.
     */
    /**
     * Park a kept link: back in the queue, asleep until a date.
     *
     * Kept had two ways out -- file it, or return it to a queue that will
     * offer it again tomorrow, where it will be kept again. A link worth
     * holding that cannot be placed yet needs the queue's own answer, and the
     * queue already has it: the same menu, the same presets, the same wake.
     */
    openSnoozeMenu(anchorEl) {
        const inbox = this.dash.inbox;
        const targets = this.selectedBookmarks();
        if (!targets.length || !anchorEl || !inbox?.openSnoozeMenu) return;
        // The inbox's menu, driven by its own presets: a second list of
        // durations is a second list to keep in step.
        inbox.openSnoozeMenu(null, anchorEl, null, {
            onApplied: null,
            onPicked: (until) => { void this.sendToInbox(targets, { snoozeUntil: until }); },
        });
    }

    async sendToInbox(rows = null, { snoozeUntil = 0 } = {}) {
        const targets = Array.isArray(rows) && rows.length ? rows : this.selectedBookmarks();
        if (!targets.length || this._busy) return;
        const d = this.dash;
        const sourcePage = Number(d._unsortedPageId) || 999999;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json' };
        window.nextdashTrack?.('unsorted:to-inbox', { count: targets.length });

        await this._runOverEach(targets, {
            title: this.t('unsortedToInboxProgress', 'Sending back'),
            // Local writes, like filing: nothing here asks another server.
            intervalMs: 0,
            run: async (bookmark) => {
                const added = await fetcher('/api/inbox', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        url: bookmark.url,
                        title: bookmark.name || '',
                        note: bookmark.note || '',
                        tags: Array.isArray(bookmark.tags) ? bookmark.tags : [],
                        source: 'unsorted',
                    }),
                });
                // A link already waiting in the queue is not a failure: the
                // reason this row can go is that the inbox has it.
                if (!added.ok && added.status !== 409) return 'failed';
                // Asleep, when that is what was asked for. The wake belongs to
                // the inbox item, so it is written the moment the item exists.
                if (snoozeUntil > Date.now()) {
                    const body = await added.json().catch(() => null);
                    const id = body?.item?.id || body?.id || '';
                    if (id) {
                        await fetcher('/api/inbox', {
                            method: 'PATCH',
                            headers,
                            body: JSON.stringify({ id, snoozedUntil: Number(snoozeUntil) }),
                        }).catch(() => {});
                    }
                }
                const removed = await fetcher('/api/bookmarks', {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({ page: sourcePage, bookmark }),
                });
                return removed.ok ? 'ok' : 'failed';
            },
            done: (ok, failed) => (failed
                ? this.t('unsortedToInboxDoneSome', `Sent back ${ok}, ${failed} failed`, { ok, failed })
                : this.t('unsortedToInboxDone', `Sent back ${ok}`, { ok })),
        });
        this.clear();
        await d.inbox?.loadAndRender?.({ refresh: true });
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
            /*
             * The way back, where the reader is looking.
             *
             * The server already files these under the trash, which is thirty
             * days of safety in a place nobody visits mid-triage. The toast is
             * the undo that is actually reachable: it puts the rows back on
             * the kept page and takes their trash entries with them, so the
             * same delete cannot be undone twice.
             */
            d.showNotification(
                this.t('unsortedDeleted', `Deleted ${deleted} bookmark(s)`, { count: deleted }),
                'success',
                {
                    duration: 8000,
                    undoCallback: () => this.restoreDeleted(targets),
                }
            );
        } catch {
            d.showNotification(this.t('unsortedDeleteFailed', 'Could not delete the bookmarks'), 'error');
        } finally {
            this._busy = false;
            this.sync();
        }
    }

    /** Put deleted kept bookmarks back, and drop the trash entries they made. */
    async restoreDeleted(targets) {
        const d = this.dash;
        const pageId = Number(d._unsortedPageId) || DashboardUnsortedSelect.PAGE_ID;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        let restored = 0;
        for (const bookmark of targets) {
            const row = { ...bookmark };
            delete row.index;
            try {
                const res = await fetcher('/api/bookmarks/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: pageId, bookmark: row, allowDuplicate: true }),
                });
                if (res.ok) restored += 1;
            } catch {
                // Reported below by the count; the trash still holds it.
            }
        }
        await this.dropRestoredTrashEntries(pageId, targets);
        await d.loadAllBookmarks?.();
        await this.unsorted.loadAndRender();
        d.showNotification(
            this.t('unsortedDeleteUndone', `Put ${restored} bookmark(s) back`, { count: restored }),
            restored ? 'success' : 'error', { duration: 3000 });
    }

    /**
     * Take the restored rows out of the trash.
     *
     * Without this the same delete could be undone a second time from Config →
     * Data & backups → Trash, which would put a duplicate on the kept page --
     * the entry there describes a bookmark that exists again.
     */
    async dropRestoredTrashEntries(pageId, targets) {
        try {
            const data = await window.DashboardTrash?.list?.();
            const items = data?.items || [];
            for (const bookmark of targets) {
                const hit = items.find((item) => item.kind !== 'category'
                    && Number(item.pageId) === Number(pageId)
                    && String(item.bookmark?.url || '') === String(bookmark?.url || ''));
                if (hit) await window.DashboardTrash.remove(hit.id);
            }
        } catch {
            // The restore itself already succeeded; a leftover entry is a
            // stale line in the trash, not a lost bookmark.
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
            // The overlay, not a toast every twentieth row: each request is
            // paced against the rate limit, so even a short sweep is seconds
            // of waiting and the icon sweep already answers that with a bar.
            progress: true,
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
    async _runOverEach(targets, {
        title, run, done, progress = false,
        // The gap between rows. It is there to keep the outbound fetches under
        // the sixty-a-minute ceiling; work that only writes to this server pays
        // nothing for going at full speed, and used to wait out the same second
        // and a bit per row as a sweep of other people's pages.
        intervalMs = DashboardUnsortedSelect.SWEEP_INTERVAL_MS,
    }) {
        const d = this.dash;
        this._busy = true;
        this.sync();
        let ok = 0;
        let failed = 0;
        /*
         * Stopping is the overlay's job, not a guess of ours: it blocks the
         * page, and a sweep over a few hundred rows is minutes long, so a
         * reader who started one by mistake needs a way out that is not a
         * reload. The round in flight finishes; nothing after it starts.
         */
        let stopped = false;
        const counted = (index) => this.t('unsortedSweepProgress',
            `${index} of ${targets.length}`, { done: index, total: targets.length });
        if (progress) {
            window.ProgressOverlay?.show(title, counted(0), {
                onCancel: () => { stopped = true; },
                cancelLabel: this.t('unsortedSweepStop', 'Stop'),
                cancellingLabel: this.t('unsortedSweepStopping', 'Stopping…'),
            });
            window.ProgressOverlay?.update(0, targets.length, counted(0));
        }
        const notify = (text, kind) => d.showNotification(text, kind, { duration: 2500 });
        if (!progress) notify(`${title} (0/${targets.length})`, 'info');
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        try {
            for (let i = 0; i < targets.length; i += 1) {
                if (stopped) break;
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
                    const waiting = this.t('unsortedBulkRateLimited',
                        `Rate limit reached — waiting ${result.retryAfter}s`,
                        { seconds: result.retryAfter });
                    if (progress) window.ProgressOverlay?.update(i, targets.length, waiting);
                    else notify(waiting, 'info');
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
                if (progress) {
                    window.ProgressOverlay?.update(i + 1, targets.length, counted(i + 1));
                } else if ((i + 1) % 20 === 0 && i + 1 < targets.length) {
                    // Every twenty rows rather than every row: a notification
                    // per request on a 200-row sweep is a flicker, not progress.
                    notify(`${title} (${i + 1}/${targets.length})`, 'info');
                }
                // Paced under the limit rather than up against it. Sixty a
                // minute is the budget, and the hover fetches and the preview
                // cards draw on the same one, so the sweep leaves room.
                if (intervalMs > 0 && i + 1 < targets.length) {
                    await wait(intervalMs);
                }
            }
        } finally {
            this._busy = false;
        }
        const summary = stopped
            ? this.t('unsortedSweepStopped',
                `Stopped after ${ok + failed} of ${targets.length}`,
                { done: ok + failed, total: targets.length })
            : done(ok, failed);
        // Stopped halfway is not finished: filling the bar to a hundred would
        // say the sweep completed. The toast below carries the count either way.
        if (progress) {
            if (stopped) window.ProgressOverlay?.hide();
            else window.ProgressOverlay?.finish(summary);
        }
        d.showNotification(summary,
            stopped ? 'info' : (failed && !ok ? 'error' : (failed ? 'warning' : 'success')));
        await this.unsorted.loadAndRender();
    }
}

window.DashboardUnsortedSelect = DashboardUnsortedSelect;
