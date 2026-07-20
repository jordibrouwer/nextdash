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

    t(key, fallback) {
        const val = this.dash.language?.t ? this.dash.language.t(key) : null;
        return (val && val !== key) ? val : fallback;
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

        const actions = [
            { id: 'open-new-tab', label: this.t('dashboard.contextMenuOpenNewTab', 'Open in new tab'), icon: '↗' },
            { id: 'copy-url', label: this.t('dashboard.contextMenuCopyUrl', 'Copy URL'), icon: '⧉' },
            { id: 'edit', label: this.t('dashboard.contextMenuEdit', 'Edit'), icon: '✎' },
            { id: 'tags', label: this.t('dashboard.contextMenuTags', 'Tags…'), icon: '#' },
            { id: 'move', label: this.t('dashboard.contextMenuMove', 'Move to…'), icon: '→' },
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
            close();
            this.runAction(action, row, bookmarkRef);
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

    runAction(action, row, bookmarkRef) {
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
