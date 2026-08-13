/**
 * Multi-select on the bookmark grid.
 *
 * The dashboard could already act on many bookmarks at once, but only through a
 * tag filter — bulk move and bulk delete lived in dashboard-tag-filter.js and
 * had no entry point unless the bookmarks happened to share a tag. Selecting
 * three arbitrary rows and moving them meant three separate Shift+M rounds.
 *
 * Selection is held as a Set of stable keys rather than DOM nodes or array
 * indices: the grid re-renders on nearly every mutation, and a full render
 * replaces every row element, so node references would go stale and indices
 * would silently point at a different bookmark after a move or delete.
 */
class DashboardMultiSelect {
    constructor(dashboard) {
        this.dash = dashboard;
        this.selected = new Set();
        // Anchor for Shift+↑/↓ range extension, as a key like the selection.
        this.anchorKey = null;
        this._toolbar = null;
    }

    /**
     * A stable identity for a row: page plus URL plus name.
     *
     * The URL alone is not enough — the same URL can legitimately appear twice
     * on a page, and keying on it would make both rows select together. Name is
     * what the row's own delete path already uses to disambiguate duplicates.
     */
    keyFor(bookmark, pageId) {
        if (!bookmark) {
            return '';
        }
        const page = Number(pageId ?? bookmark.pageId ?? this.dash.currentPageId ?? 0);
        const url = String(bookmark.url || '').trim();
        const name = String(bookmark.name || '').trim();
        return `${page}\u0000${url}\u0000${name}`;
    }

    keyForRow(row) {
        if (!row) {
            return '';
        }
        const bookmark = this.bookmarkForRow(row);
        return bookmark ? this.keyFor(bookmark) : '';
    }

    /**
     * Resolve a row element back to its bookmark.
     *
     * Mirrors keyboard-navigation's getSelectedBookmark: prefer the index the
     * renderer stamped, fall back to a URL match narrowed by the visible label
     * so duplicate URLs resolve to the row actually being acted on.
     */
    bookmarkForRow(row) {
        const d = this.dash;
        if (!row || !d) {
            return null;
        }
        const index = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
        if (Number.isFinite(index) && index >= 0 && (d.bookmarks || [])[index]) {
            return d.bookmarks[index];
        }
        const openLink = row.querySelector('a.bookmark-open');
        const url = row.dataset.bookmarkUrl || openLink?.href || '';
        if (!url) {
            return null;
        }
        const label = (row.querySelector('.bookmark-text')?.textContent || '').trim();
        const pick = (list) => {
            const hits = (list || []).filter((b) => b.url === url);
            if (hits.length <= 1) return hits[0] || null;
            return hits.find((b) => String(b.name || '').trim() === label) || hits[0];
        };
        return pick(d.bookmarks) || pick(d.allBookmarks) || null;
    }

    isActive() {
        return this.selected.size > 0;
    }

    has(key) {
        return this.selected.has(key);
    }

    count() {
        return this.selected.size;
    }

    /** Every currently visible row element, in grid order. */
    rows() {
        return Array.from(
            document.querySelectorAll('#dashboard-layout .bookmark-link[data-bookmark-index]')
        );
    }

    /**
     * Row keys in grid order, one entry per distinct bookmark.
     *
     * A bookmark shown in a smart collection is rendered twice — once in the
     * collection, once in its own category. Selection is keyed rather than
     * per-element, so both copies resolve to the same entry and light up
     * together; deduplicating here keeps the position walk in range and
     * select-all counting bookmarks rather than rows.
     */
    uniqueRowKeys() {
        const seen = new Set();
        this.rows().forEach((row) => {
            const key = this.keyForRow(row);
            if (key) {
                seen.add(key);
            }
        });
        return Array.from(seen);
    }

    toggleRow(row) {
        const key = this.keyForRow(row);
        if (!key) {
            return;
        }
        if (this.selected.has(key)) {
            this.selected.delete(key);
            if (this.anchorKey === key) {
                this.anchorKey = null;
            }
        } else {
            this.selected.add(key);
            this.anchorKey = key;
        }
        this.sync();
    }

    /**
     * Select every row between the anchor and the given row, inclusive.
     *
     * Without an anchor the range has no meaning, so this degrades to a plain
     * toggle rather than doing nothing.
     */
    selectRange(row) {
        const key = this.keyForRow(row);
        if (!key) {
            return;
        }
        const keys = this.uniqueRowKeys();
        const to = keys.indexOf(key);
        const from = this.anchorKey ? keys.indexOf(this.anchorKey) : -1;
        if (to < 0 || from < 0) {
            this.toggleRow(row);
            return;
        }
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        for (let i = lo; i <= hi; i += 1) {
            if (keys[i]) {
                this.selected.add(keys[i]);
            }
        }
        this.sync();
    }

    /** Select every row in the category containing the given row. */
    selectCategory(row) {
        const list = row?.closest('.bookmarks-list');
        if (!list) {
            return;
        }
        const rows = Array.from(list.querySelectorAll('.bookmark-link[data-bookmark-index]'));
        const keys = rows.map((r) => this.keyForRow(r)).filter(Boolean);
        // Selecting an already fully selected category clears it, so the same
        // keystroke undoes itself.
        const allSelected = keys.length > 0 && keys.every((k) => this.selected.has(k));
        keys.forEach((k) => {
            if (allSelected) {
                this.selected.delete(k);
            } else {
                this.selected.add(k);
            }
        });
        this.anchorKey = allSelected ? null : (keys[keys.length - 1] || null);
        this.sync();
    }

    selectAllVisible() {
        const keys = this.uniqueRowKeys();
        const allSelected = keys.length > 0 && keys.every((k) => this.selected.has(k));
        if (allSelected) {
            this.clear();
            return;
        }
        keys.forEach((k) => this.selected.add(k));
        this.anchorKey = keys[keys.length - 1] || null;
        this.sync();
    }

    clear() {
        if (!this.selected.size && !this._toolbar) {
            return;
        }
        this.selected.clear();
        this.anchorKey = null;
        this.sync();
    }

    /**
     * Resolve the selection to live bookmark references for a mutation.
     *
     * Keys are matched against the current arrays every time rather than cached,
     * because the selection outlives the renders between selecting and acting.
     */
    resolveRefs() {
        const d = this.dash;
        const refs = [];
        const seen = new Set();
        (d.bookmarks || []).forEach((bookmark, index) => {
            const key = this.keyFor(bookmark, d.currentPageId);
            if (!this.selected.has(key) || seen.has(key)) {
                return;
            }
            seen.add(key);
            refs.push({
                scope: 'current',
                index,
                pageId: Number(d.currentPageId),
                bookmark,
                original: { ...bookmark },
            });
        });
        return refs;
    }

    /** Paint selection state onto the grid and refresh the toolbar. */
    sync() {
        const rows = this.rows();
        rows.forEach((row) => {
            const key = this.keyForRow(row);
            const on = !!key && this.selected.has(key);
            row.classList.toggle('is-multi-selected', on);
            if (on) {
                row.setAttribute('data-multi-selected', 'true');
            } else {
                row.removeAttribute('data-multi-selected');
            }
        });
        document.body.classList.toggle('has-multi-selection', this.isActive());
        this.renderToolbar();
    }

    /**
     * Drop keys that no longer match any bookmark on the page.
     *
     * Called after a render so a deleted or moved-away bookmark does not keep a
     * phantom entry in the count.
     */
    prune() {
        if (!this.selected.size) {
            return;
        }
        const d = this.dash;
        const live = new Set((d.bookmarks || []).map((b) => this.keyFor(b, d.currentPageId)));
        let changed = false;
        this.selected.forEach((key) => {
            if (!live.has(key)) {
                this.selected.delete(key);
                changed = true;
            }
        });
        if (changed && this.anchorKey && !this.selected.has(this.anchorKey)) {
            this.anchorKey = null;
        }
        this.sync();
    }

    t(key, fallback) {
        const value = this.dash.language?.t ? this.dash.language.t(key) : null;
        return (value && value !== key) ? value : fallback;
    }

    renderToolbar() {
        const container = document.getElementById('dashboard-layout');
        if (!container) {
            return;
        }
        const count = this.selected.size;
        if (!count) {
            this._toolbar?.remove();
            this._toolbar = null;
            return;
        }

        let bar = this._toolbar;
        if (!bar || !bar.isConnected) {
            bar = document.createElement('div');
            bar.className = 'multi-select-toolbar';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', this.t('dashboard.multiSelectToolbarAria', 'Selection actions'));
            container.prepend(bar);
            this._toolbar = bar;
        }

        bar.replaceChildren();

        const label = document.createElement('span');
        label.className = 'multi-select-count';
        label.textContent = this.t('dashboard.multiSelectCount', '{count} selected')
            .replace('{count}', String(count));
        bar.appendChild(label);

        const addButton = (text, className, onClick) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `multi-select-btn ${className}`.trim();
            btn.textContent = text;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick(btn);
            });
            bar.appendChild(btn);
            return btn;
        };

        // The popover's own close() restores focus to its anchor, but while it
        // is open #dashboard-layout (which this toolbar lives inside) is marked
        // inert for the focus trap, and that inert flag is cleared by an async
        // MutationObserver — so a focus-based reset here would race it and
        // frequently land on <body> instead of the button. Watching the popover
        // element's own removal from the DOM sidesteps that race entirely.
        const markExpandedUntilPopoverCloses = (btn, popoverId) => {
            // Some of these calls refuse silently (no selection left, nothing to
            // move to) and never create the popover at all — nothing to watch
            // for then, and marking expanded with no close to ever fire would
            // leave the flag stuck true.
            if (!document.getElementById(popoverId)) {
                return;
            }
            btn.setAttribute('aria-expanded', 'true');
            const observer = new MutationObserver(() => {
                if (!document.getElementById(popoverId)) {
                    observer.disconnect();
                    btn.setAttribute('aria-expanded', 'false');
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        };

        const moveBtn = addButton(this.t('dashboard.multiSelectMove', 'Move'), 'multi-select-move-btn', (btn) => {
            this.openMovePopover(btn);
            markExpandedUntilPopoverCloses(btn, 'move-popover');
        });
        moveBtn.setAttribute('aria-haspopup', 'true');
        moveBtn.setAttribute('aria-expanded', 'false');
        // Beside Move, which already carries the category choice in its popover.
        // Tags is the one field a cleanup wants to set in bulk that had no route
        // here at all — the row's own Shift+T popover is single-bookmark.
        const tagsBtn = addButton(this.t('dashboard.multiSelectTags', 'Tags'), 'multi-select-tags-btn', (btn) => {
            this.openTagsPopover(btn);
            markExpandedUntilPopoverCloses(btn, 'multi-select-tags-popover');
        });
        tagsBtn.setAttribute('aria-haspopup', 'true');
        tagsBtn.setAttribute('aria-expanded', 'false');
        addButton(this.t('dashboard.multiSelectOpen', 'Open'), '', () => {
            this.openSelected();
        });
        addButton(this.t('dashboard.multiSelectCopy', 'Copy links'), '', () => {
            this.copySelectedLinks();
        });
        addButton(this.t('dashboard.multiSelectDelete', 'Delete'), 'danger', () => {
            void this.deleteSelected();
        });
        addButton(this.t('dashboard.multiSelectClear', 'Clear'), '', () => {
            this.clear();
            this.dash.keyboardNavigation?.restoreKbdSelection?.();
        });
    }

    /**
     * Tag the whole selection from one popover.
     *
     * Modelled on the row's own tag popover rather than config's text field:
     * here the tags already exist and the question is which of them apply, so a
     * list you click beats typing names you have to spell correctly.
     *
     * A tag is shown in one of three states across the selection — on every
     * bookmark, on some, on none — because "add" and "remove" mean different
     * things for a mixed selection and the button has to say which it will do.
     */
    openTagsPopover(anchorEl) {
        const d = this.dash;
        const refs = this.resolveRefs();
        if (!refs.length || !anchorEl) {
            return;
        }
        d._closeActionPopovers?.();

        const known = new Set();
        (d.allBookmarks?.length ? d.allBookmarks : d.bookmarks || []).forEach((bm) => {
            (bm.tags || []).forEach((raw) => {
                const tag = String(raw || '').trim().toLowerCase();
                if (tag) known.add(tag);
            });
        });

        const pop = document.createElement('div');
        pop.id = 'multi-select-tags-popover';
        pop.className = 'move-popover tag-popover';
        pop.setAttribute('role', 'listbox');
        pop.setAttribute('aria-label', this.t('dashboard.multiSelectTagsTitle', 'Tag selection…'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('dashboard.multiSelectTagsTitle', 'Tag selection…');
        pop.appendChild(header);

        const close = () => {
            pop.remove();
            document.removeEventListener('click', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            if (d._multiSelectTagsCleanup === close) {
                d._multiSelectTagsCleanup = null;
            }
        };
        const onOutside = (e) => {
            if (!pop.contains(e.target) && e.target !== anchorEl) close();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        };

        if (!known.size) {
            const empty = document.createElement('div');
            empty.className = 'tag-popover-empty-hint';
            empty.textContent = this.t(
                'dashboard.multiSelectTagsEmpty',
                'No tags yet — add one from a bookmark first'
            );
            pop.appendChild(empty);
        }

        const total = refs.length;
        [...known].sort().forEach((tag) => {
            const on = refs.filter((ref) => (ref.bookmark.tags || [])
                .map((raw) => String(raw || '').trim().toLowerCase())
                .includes(tag)).length;

            // A div, not a button: every other popover item in the app is one,
            // and .move-popover-item styles only colour and spacing — a button
            // brings the browser's own background, border and font with it, which
            // is why these rows stood out against the theme.
            const item = document.createElement('div');
            item.className = 'move-popover-item';
            item.setAttribute('role', 'option');
            item.setAttribute('data-tag', tag);
            // All → removing, none → adding, some → adding to the rest. The
            // count says which, so nobody has to guess what the click does.
            const state = on === total ? 'all' : (on === 0 ? 'none' : 'some');
            item.classList.toggle('is-current', state === 'all');
            item.setAttribute('aria-selected', String(state === 'all'));

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = state === 'all' ? '✓' : (state === 'some' ? '–' : '');
            item.appendChild(check);

            const label = document.createElement('span');
            label.className = 'tag-popover-item-label';
            label.textContent = `#${tag}`;
            item.appendChild(label);

            // The reach reads as secondary metadata, the same slot the row
            // popover uses for its "n bookmarks" count.
            if (state === 'some') {
                const meta = document.createElement('span');
                meta.className = 'tag-popover-item-meta';
                meta.textContent = this.t('dashboard.multiSelectTagsPartial', 'on {count} of {total}')
                    .replace('{count}', String(on))
                    .replace('{total}', String(total));
                item.appendChild(meta);
            }

            item.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                close();
                void this.applyTagToSelection(tag, state === 'all' ? 'remove' : 'add');
            });
            pop.appendChild(item);
        });

        document.body.appendChild(pop);
        d._positionActionPopoverBeside?.(pop, anchorEl);
        // The shared helper centres the popover on its anchor, which is right for
        // a bookmark row but not here: the toolbar sits at the top-left, so a tall
        // tag list centred on a short button rides up over the bar it came from.
        // Align its top to the button and let it grow downward instead.
        const anchorRect = anchorEl.getBoundingClientRect();
        const pad = window.DashboardPromoPlacement?.VIEWPORT_PAD ?? 8;
        const maxTop = window.innerHeight - pop.offsetHeight - pad;
        pop.style.top = `${Math.round(Math.max(pad, Math.min(anchorRect.top, maxTop)))}px`;
        window.FocusTrapUtils?.syncDashboardInert?.();
        setTimeout(() => {
            document.addEventListener('click', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
        d._multiSelectTagsCleanup = close;
    }

    /**
     * Add or remove one tag across the selection in a single page write.
     *
     * Per-bookmark saves would be one request each and could leave the set half
     * tagged if one failed; the grid writes a whole page at a time anyway.
     */
    async applyTagToSelection(tag, mode) {
        const d = this.dash;
        const refs = this.resolveRefs();
        if (!refs.length || !tag) {
            return;
        }
        const previous = refs.map((ref) => [...(ref.bookmark.tags || [])]);

        d.ensureBookmarkMutationSnapshot?.();
        let changed = 0;
        refs.forEach((ref) => {
            const tags = (ref.bookmark.tags || [])
                .map((raw) => String(raw || '').trim().toLowerCase())
                .filter(Boolean);
            const has = tags.includes(tag);
            if (mode === 'remove' && has) {
                ref.bookmark.tags = tags.filter((t) => t !== tag);
                changed += 1;
            } else if (mode === 'add' && !has) {
                ref.bookmark.tags = [...tags, tag];
                changed += 1;
            }
        });
        if (!changed) {
            return;
        }

        d.renderDashboard?.({ incremental: false });
        const saved = await d.saveBookmarkOrder();
        if (!saved) {
            // Put the old tags back: the write is what makes this real, and a
            // grid showing tags the server rejected is worse than no change.
            refs.forEach((ref, i) => { ref.bookmark.tags = previous[i]; });
            d.pendingReorderSnapshot = null;
            d.renderDashboard?.({ incremental: false });
            return;
        }
        void d.data?.fetchAndStoreDataRevision?.();
        d.showGroupedNotification?.(
            'multi-select-tags',
            changed,
            (n) => (mode === 'remove'
                ? this.t('dashboard.multiSelectTagsRemoved', 'Removed “{tag}” from {count} bookmark(s)')
                : this.t('dashboard.multiSelectTagsAdded', 'Tagged {count} bookmark(s) “{tag}”'))
                .replace('{count}', String(n))
                .replace('{tag}', tag),
            'success'
        );
    }

    openMovePopover(anchorEl) {
        const d = this.dash;
        const refs = this.resolveRefs();
        if (!refs.length || !d.tagFilter?.showTagFilterBulkMovePopover) {
            return;
        }
        d.tagFilter.showTagFilterBulkMovePopover(anchorEl, {
            refs,
            onMoveToCategory: (categoryId) => {
                d.applyBookmarkCategoryMove(refs, categoryId, { count: refs.length });
                this.clear();
            },
            onMoveToPage: (pageId) => {
                void this.moveSelectedToPage(pageId, refs);
            },
        });
    }

    /**
     * Move the selection to another page.
     *
     * Delegates to the tag filter's page move, which already handles fetching
     * the target page, appending, saving both sides and rolling back on error.
     * It reads its own refs, so the selection is staged where it can see them.
     */
    async moveSelectedToPage(pageId, refs) {
        const d = this.dash;
        const resolved = refs || this.resolveRefs();
        if (!resolved.length || !d.tagFilter?.bulkMoveTagFilterToPage) {
            return;
        }
        const original = d.tagFilter.getTagFilterBookmarkRefs;
        d.tagFilter.getTagFilterBookmarkRefs = () => resolved;
        try {
            await d.tagFilter.bulkMoveTagFilterToPage(pageId);
        } finally {
            d.tagFilter.getTagFilterBookmarkRefs = original;
        }
        this.clear();
    }

    openSelected() {
        const d = this.dash;
        const bookmarks = this.resolveRefs().map((ref) => ref.bookmark).filter((b) => b?.url);
        if (!bookmarks.length) {
            return;
        }
        d.openBookmarksInNewTabs?.(bookmarks);
    }

    /**
     * Pre-Clipboard-API copy, kept for plain-HTTP LAN installs.
     * A local copy of dashboard-context-menu.js's execCopyFallback rather than
     * a cross-module call: that module is behind a lazy bundle loader on some
     * builds, and pulling the whole bookmark-editor bundle in just for this
     * would be the wrong tradeoff for a few lines with no shared state.
     */
    execCopyFallback(value) {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }

    copySelectedLinks() {
        const d = this.dash;
        const urls = this.resolveRefs()
            .map((ref) => String(ref.bookmark?.url || '').trim())
            .filter(Boolean);
        if (!urls.length) {
            return;
        }
        const text = urls.join('\n');
        const notify = () => {
            d.showNotification?.(
                this.t('dashboard.multiSelectCopied', '{count} link(s) copied')
                    .replace('{count}', String(urls.length)),
                'success'
            );
        };
        const failed = () => {
            d.showErrorNotification?.(
                this.t('dashboard.multiSelectCopyFailed', 'Could not copy links to clipboard.')
            );
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(notify).catch(() => {
                if (this.execCopyFallback(text)) notify();
                else failed();
            });
            return;
        }
        if (this.execCopyFallback(text)) {
            notify();
            return;
        }
        failed();
    }

    async deleteSelected() {
        const d = this.dash;
        const refs = this.resolveRefs();
        if (!refs.length) {
            return;
        }
        const count = refs.length;

        const message = this.t('dashboard.multiSelectDeleteConfirm', 'Delete {count} bookmark(s)?')
            .replace('{count}', String(count));
        let confirmed = false;
        if (window.AppModal?.danger) {
            confirmed = await window.AppModal.danger({
                title: this.t('dashboard.multiSelectDeleteTitle', 'Delete selected bookmarks'),
                message,
                confirmText: this.t('delete', 'Delete'),
                cancelText: this.t('dashboard.cancel', 'Cancel'),
            });
        } else {
            confirmed = window.confirm(message);
        }
        if (!confirmed) {
            return;
        }

        // Capture for the trash before the splices renumber everything.
        const trashed = refs.map((ref) => ({
            pageId: Number(ref.pageId ?? d.currentPageId),
            index: ref.index,
            bookmark: { ...ref.bookmark },
        }));

        d.ensureBookmarkMutationSnapshot();
        [...refs].sort((a, b) => b.index - a.index).forEach((ref) => {
            d.removeBookmarkFromAllBookmarks(ref);
            d.bookmarks.splice(ref.index, 1);
        });

        d._inlineEditGlobalCleanup?.();
        d.inlineEditingBookmarkIndex = null;
        this.clear();
        d.renderDashboard();

        const saved = await d.saveBookmarkOrder();
        if (!saved) {
            return;
        }
        await window.DashboardTrash?.record(trashed, 'dashboard-multi-select');
        d.showGroupedNotification?.(
            'multi-select-delete',
            count,
            (n) => this.t('dashboard.multiSelectDeleted', 'Deleted {count} bookmark(s)')
                .replace('{count}', String(n)),
            'success'
        );
    }
}

window.DashboardMultiSelect = DashboardMultiSelect;
