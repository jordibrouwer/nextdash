/**
 * Right-click menu on a bookmark row.
 *
 * Every action here already exists elsewhere — this is a discoverable entry point, not new
 * behaviour. Open/copy are handled locally; edit, move, tags, and delete delegate to the
 * dashboard methods the toolbar and command palette already use.
 *
 * Reuses the `.move-popover` surface so theming comes from the shared theme variables
 * (`--background-secondary`, `--border-primary`, `--accent-primary`, `--accent-danger`)
 * with no menu-specific colours of its own.
 */
class DashboardContextMenu {
    constructor(dashboard) {
        this.dash = dashboard;
        this._cleanup = null;
    }

    t(key, fallback, params) {
        const val = this.dash.language?.t ? this.dash.language.t(key) : null;
        const text = (val && val !== key) ? val : fallback;
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : text;
    }

    /** Bound once per rendered row; rows are rebuilt often, so this stays cheap. */
    bindRow(row) {
        if (!(row instanceof HTMLElement) || row.dataset.contextMenuBound === '1') return;
        row.dataset.contextMenuBound = '1';
        row.addEventListener('contextmenu', (e) => this.handleContextMenu(e, row));
    }

    handleContextMenu(e, row) {
        const d = this.dash;
        // Let the browser's own menu through while editing, so copy/paste in the
        // inline editor keeps working.
        if (row.classList.contains('bookmark-inline-editing')) return;
        if (d.uiHelpers?.isModalOpen?.()) return;
        if (e.shiftKey) return; // escape hatch to the native menu

        const bookmarkRef = this.resolveRowBookmark(row);
        if (!bookmarkRef?.bookmark) return;

        e.preventDefault();
        e.stopPropagation();
        this.show(row, bookmarkRef, { x: e.clientX, y: e.clientY });
    }

    resolveRowBookmark(row) {
        const d = this.dash;
        const rawIndex = row.getAttribute('data-bookmark-index');
        if (rawIndex !== null) {
            const index = Number(rawIndex);
            const bookmark = d.bookmarks?.[index];
            if (bookmark) return { bookmark, index, scope: 'current' };
        }
        // Smart collections render rows without a page-local index; fall back to the URL.
        const url = row.getAttribute('data-bookmark-url');
        if (!url) return null;
        const bookmark = (d.bookmarks || []).find(b => b.url === url)
            || (d.allBookmarks || []).find(b => b.url === url);
        return bookmark ? d.resolveBookmarkReference(bookmark) : null;
    }

    close() {
        if (this._cleanup) this._cleanup();
    }

    show(row, bookmarkRef, point) {
        const d = this.dash;
        this.close();
        d._movePopoverCleanup?.();
        d._tagPopoverCleanup?.();
        d._deletePopoverCleanup?.();

        const bookmark = bookmarkRef.bookmark;
        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;

        const pop = document.createElement('div');
        pop.id = 'bookmark-context-menu';
        pop.className = 'move-popover bookmark-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', this.t('dashboard.contextMenuTitle', 'Bookmark actions'));

        const nameHint = document.createElement('div');
        nameHint.className = 'move-popover-current-hint';
        nameHint.textContent = String(bookmark.name || bookmark.url || '').trim() || '—';
        pop.appendChild(nameHint);

        // Naming the current mode saves opening the submenu just to read it, the
        // same way the health view's row menu labels itself.
        const currentMode = window.CheckMode?.meta(window.CheckMode.of(bookmark));
        const actions = [
            { id: 'open-new-tab', label: this.t('dashboard.contextMenuOpenNewTab', 'Open in new tab'), icon: '↗' },
            { id: 'copy-url', label: this.t('dashboard.contextMenuCopyUrl', 'Copy URL'), icon: '⧉' },
            { id: 'edit', label: this.t('dashboard.contextMenuEdit', 'Edit'), icon: '✎' },
            { id: 'tags', label: this.t('dashboard.contextMenuTags', 'Tags…'), icon: '#' },
            { id: 'move', label: this.t('dashboard.contextMenuMove', 'Move to…'), icon: '→' },
            ...(currentMode
                ? [{
                    id: 'check-mode',
                    label: this.t('dashboard.contextMenuCheckMode', 'Checking ({mode})…', { mode: currentMode.badge }),
                    icon: '◉',
                    submenu: true,
                }]
                : []),
            { id: 'delete', label: this.t('dashboard.contextMenuDelete', 'Delete'), icon: '✕', danger: true }
        ];

        const items = [];
        actions.forEach((action) => {
            if (action.id === 'delete') {
                const divider = document.createElement('div');
                divider.className = 'move-popover-divider';
                pop.appendChild(divider);
            }
            const item = document.createElement('div');
            item.className = 'move-popover-item' + (action.danger ? ' is-danger' : '');
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-action', action.id);

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = action.icon;
            item.appendChild(check);

            const label = document.createElement('span');
            label.textContent = action.label;
            item.appendChild(label);

            if (action.submenu) {
                item.setAttribute('aria-haspopup', 'menu');
                const caret = document.createElement('span');
                caret.className = 'move-popover-submenu-caret';
                caret.textContent = '▸';
                caret.setAttribute('aria-hidden', 'true');
                item.appendChild(caret);
            }

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this.positionAtPoint(pop, point);
        window.FocusTrapUtils?.syncDashboardInert?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = 0;
        const setFocus = (idx) => {
            d.bookmarkRows?._focusActionPopoverItem?.(items, idx);
            focusedIdx = idx;
        };

        let onOutside = null;
        const close = () => {
            if (pop.parentNode) pop.remove();
            document.removeEventListener('keydown', onKey, true);
            if (onOutside) {
                document.removeEventListener('click', onOutside);
                document.removeEventListener('contextmenu', onOutside);
                onOutside = null;
            }
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            if (this._cleanup === close) this._cleanup = null;
            d.bookmarkRows?._restoreActionPopoverFocus?.(previousFocus, row, bookmarkIndex);
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        this._cleanup = close;

        const confirm = (item) => {
            const action = item.getAttribute('data-action');
            // Capture the anchor before close() detaches the item: the submenu
            // opens beside the row it came from, not where the pointer ended up.
            const rect = item.getBoundingClientRect();
            close();
            this.runAction(action, row, bookmarkRef, { x: rect.right, y: rect.top });
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focusedIdx]) confirm(items[focusedIdx]); return; }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => confirm(item));
        });

        document.addEventListener('keydown', onKey, true);
        // Reposition is meaningless for a pointer-anchored menu, so scroll/resize just closes it.
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
            document.addEventListener('contextmenu', onOutside);
        }, 0);
        requestAnimationFrame(() => setFocus(0));
    }

    /**
     * The check-mode submenu: the same three named options the health view
     * offers, in this menu's own surface.
     *
     * Three explicit options rather than a control that cycles, because the modes
     * are not interchangeable — periodic is cheap and answers "is this alive",
     * monitor is the tier that records uptime — so each carries its sentence
     * instead of leaving the user to guess what the next click selects.
     */
    showCheckModeMenu(row, bookmarkRef, point) {
        const d = this.dash;
        const bookmark = bookmarkRef.bookmark;
        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;
        if (!window.CheckMode) return;
        this.close();

        const active = window.CheckMode.of(bookmark);

        const pop = document.createElement('div');
        pop.id = 'bookmark-check-mode-menu';
        pop.className = 'move-popover bookmark-context-menu bookmark-check-mode-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', this.t('dashboard.healthCheckModeLabel', 'Availability checking'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('dashboard.healthCheckModeLabel', 'Availability checking');
        pop.appendChild(header);

        const items = [];
        window.CheckMode.options().forEach((option) => {
            const isActive = option.mode === active;
            const item = document.createElement('div');
            item.className = 'move-popover-item' + (isActive ? ' is-current' : '');
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', isActive ? 'true' : 'false');
            item.setAttribute('data-check-mode', option.mode);

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = isActive ? '✓' : '';
            item.appendChild(check);

            const text = document.createElement('span');
            text.className = 'check-mode-option-text';
            const label = document.createElement('span');
            label.className = 'check-mode-option-label';
            label.textContent = option.label;
            const body = document.createElement('span');
            body.className = 'check-mode-option-body';
            body.textContent = option.body;
            text.appendChild(label);
            text.appendChild(body);
            item.appendChild(text);

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this.positionAtPoint(pop, point || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
        window.FocusTrapUtils?.syncDashboardInert?.();

        const previousFocus = document.activeElement;
        let focusedIdx = Math.max(0, items.findIndex((i) => i.getAttribute('aria-checked') === 'true'));
        const setFocus = (idx) => {
            d.bookmarkRows?._focusActionPopoverItem?.(items, idx);
            focusedIdx = idx;
        };

        let onOutside = null;
        const close = () => {
            if (pop.parentNode) pop.remove();
            document.removeEventListener('keydown', onKey, true);
            if (onOutside) {
                document.removeEventListener('click', onOutside);
                document.removeEventListener('contextmenu', onOutside);
                onOutside = null;
            }
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
            if (this._cleanup === close) this._cleanup = null;
            d.bookmarkRows?._restoreActionPopoverFocus?.(previousFocus, row, bookmarkIndex);
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        this._cleanup = close;

        const choose = async (item) => {
            const mode = item.getAttribute('data-check-mode');
            close();
            if (!mode || mode === active) return;
            window.nextdashTrack?.('bookmark:check-mode');

            const pageId = Number(bookmarkRef.pageId || d.currentPageId);
            const index = await this.resolveWriteIndex(bookmarkRef, pageId);
            if (index < 0) {
                d.showNotification?.(
                    this.t('dashboard.healthCheckModeFailed', 'Could not change availability checking'),
                    'error'
                );
                return;
            }

            const outcome = await window.CheckMode.apply({
                pageId,
                index,
                url: bookmark.url,
                mode,
                name: bookmark.name || bookmark.url,
            });
            if (outcome === 'failed') return;

            // Apply the new mode to every in-memory copy before reloading.
            //
            // The dashboard keeps a bookmark in more than one array: `bookmarks`
            // for the current page and `allBookmarks` for everything, and rows
            // from smart collections resolve through the latter. loadBookmarks()
            // refreshes only the first, so without this sync the menu reopened on
            // the pre-change mode even though the write had succeeded.
            window.CheckMode.assign(bookmark, mode);
            d.syncEditedBookmarkAcrossCollections?.(bookmarkRef, String(bookmark.url || '').trim());

            // `allBookmarks` needs its own pass. syncEditedBookmarkAcrossCollections
            // matches candidates on page id, and entries there carry none, so the
            // sync above silently skips them — which is what left a smart-collection
            // row showing the pre-change mode when the menu was reopened.
            const key = String(bookmark.url || '').trim();
            (d.allBookmarks || []).forEach((candidate) => {
                if (String(candidate?.url || '').trim() === key) {
                    window.CheckMode.assign(candidate, mode);
                }
            });

            // And drop the page cache, since loadBookmarks() reads through it and
            // would otherwise hand back the values from before the write.
            d.data?.invalidatePageDataCache?.(pageId);
            void d.data?.fetchAndStoreDataRevision?.();
            await d.loadBookmarks?.().catch?.(() => {});
            d.renderDashboard?.({ incremental: false });
            d.updateHealthBadge?.();
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focusedIdx]) void choose(items[focusedIdx]); return; }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => void choose(item));
        });

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
            document.addEventListener('contextmenu', onOutside);
        }, 0);
        // Opens on the active option, so Enter alone is a no-op rather than a
        // change the user did not ask for.
        requestAnimationFrame(() => setFocus(focusedIdx));
    }

    /**
     * The page-local index the check-mode endpoint needs.
     *
     * A row on the current page carries its index already. Smart-collection rows
     * do not — they can come from any page — so the source page is fetched and
     * the bookmark located there, the same route remote inline edits take.
     * Returns -1 when it cannot be placed, which is a refusal rather than a
     * guess: a wrong index would rewrite a different bookmark.
     */
    async resolveWriteIndex(bookmarkRef, pageId) {
        const d = this.dash;
        if (bookmarkRef.scope === 'current' && Number.isInteger(bookmarkRef.index) && bookmarkRef.index >= 0) {
            return bookmarkRef.index;
        }
        if (!Number.isFinite(pageId) || pageId <= 0) return -1;
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return -1;
            const sourceBookmarks = await res.json();
            const index = d.findBookmarkIndexByReference?.(sourceBookmarks, bookmarkRef);
            return Number.isInteger(index) && index >= 0 ? index : -1;
        } catch {
            return -1;
        }
    }

    /** Flip the menu back inside the viewport when opened near an edge. */
    positionAtPoint(pop, point) {
        const margin = 8;
        const popW = pop.offsetWidth || 220;
        const popH = pop.offsetHeight || 220;
        let left = point.x;
        let top = point.y;
        if (left + popW + margin > window.innerWidth) left = point.x - popW;
        if (top + popH + margin > window.innerHeight) top = point.y - popH;
        left = Math.max(margin, Math.min(left, window.innerWidth - popW - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - popH - margin));
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    runAction(action, row, bookmarkRef, point) {
        const d = this.dash;
        const bookmark = bookmarkRef.bookmark;
        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;
        window.nextdashTrack?.('bookmark:context-menu', { action });

        switch (action) {
            case 'open-new-tab':
                if (bookmark.url) {
                    window.open(bookmark.url, '_blank', 'noopener,noreferrer');
                    d.recordBookmarkOpened?.(bookmark, bookmarkIndex >= 0 ? bookmarkIndex : undefined, 'context-menu');
                }
                break;
            case 'copy-url':
                d.searchComponent?.commandsComponent?._copyUrlToClipboard?.(bookmark.url, row);
                break;
            case 'edit':
                d.openBookmarkInlineEditor?.(row, bookmarkRef);
                break;
            case 'tags':
                d.showTagPopover?.(row, bookmark, bookmarkIndex);
                break;
            case 'move':
                d.showMovePopover?.(row, bookmark, bookmarkIndex);
                break;
            case 'check-mode':
                this.showCheckModeMenu(row, bookmarkRef, point);
                break;
            case 'delete':
                // Confirm popover rather than deleteBookmarkInline() — a menu click is
                // one gesture away from a destructive action, so it needs a second step.
                d.showDeletePopover?.(row, bookmark, bookmarkIndex);
                break;
            default:
                break;
        }
    }
}

window.DashboardContextMenu = DashboardContextMenu;
