/**
 * Right-click menu on a Config → Bookmarks row.
 *
 * The grid and the inbox have had one for a while; this list, the one place
 * built for working through bookmarks in bulk, answered with the browser's own
 * menu. Everything here already exists on the row, in the ⋯ menu, or as a
 * keyboard shortcut — like the grid's menu, this is a discoverable entry point
 * rather than new behaviour, so an action reachable two ways stays one
 * implementation.
 *
 * Formatting follows dashboard-context-menu.js exactly: the same `.move-popover`
 * surface, the same `move-popover-item` rows with an icon span, the same divider
 * before the destructive zone, and the same name hint at the top. A second look
 * for a second menu would read as a different app.
 *
 * What it adds beyond the grid's menu is the part only Config can do: filtering
 * the list to this bookmark's category, page or tag, and the maintenance actions
 * (refresh title, refresh favicon, archive) that live in the ⋯ menu.
 */
class DashboardConfigContextMenu {
    constructor(config) {
        this.config = config;
        this._cleanup = null;
    }

    get dash() {
        return this.config.dash;
    }

    /**
     * config.t() takes only (key, fallback) — a third argument is silently
     * dropped, which is why "Checking ({mode})…" and the "{count} selected"
     * entries rendered their placeholders verbatim. Interpolate here instead.
     */
    t(key, fallback, params) {
        const text = String(this.config.t(key, fallback));
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                text
            )
            : text;
    }

    /**
     * Delegated from the list root rather than bound per row.
     *
     * The list repaints on every filter, sort, tick and edit, and a per-row
     * listener would have to be rebound each time — the grid can bind per row
     * because its rows outlive a repaint; these do not.
     */
    bindList(root) {
        const listRoot = root?.querySelector?.('#config-bm-list') || root;
        if (!listRoot || listRoot.dataset.configBmContextBound === '1') return;
        listRoot.dataset.configBmContextBound = '1';
        listRoot.addEventListener('contextmenu', (e) => {
            const row = e.target.closest?.('.config-bm-row');
            if (row) this.handleContextMenu(e, row);
        });
    }

    handleContextMenu(e, row) {
        // Shift is the escape hatch to the browser's own menu, same as the grid.
        if (e.shiftKey) return;
        // Inside the open editor the native menu is what someone wants: copy and
        // paste into the URL and note fields has to keep working.
        if (e.target.closest('.config-bm-editor')) return;
        if (e.target.closest('input, textarea, select')) return;

        const key = row.getAttribute('data-bm-key');
        const bookmark = key ? this.config.findBookmarkByKey(key) : null;
        if (!bookmark) return;

        e.preventDefault();
        e.stopPropagation();
        this.show(key, bookmark, { x: e.clientX, y: e.clientY });
    }

    /** Whether a menu is on screen; the view's Escape handler asks before acting. */
    isOpen() {
        return typeof this._cleanup === 'function';
    }

    /**
     * What Escape means right now, called by the config view's own handler.
     *
     * From the check-mode submenu it goes back to the menu that opened it, at
     * the same point; from the menu itself it closes.
     */
    handleEscape() {
        const inSubmenu = !!document.getElementById('config-bm-check-mode-menu');
        const back = inSubmenu ? this._openedFor : null;
        this.close();
        if (back?.key && this._lastPoint) {
            this.show(back.key, back.bookmark, this._lastPoint);
        }
    }

    close() {
        if (this._cleanup) this._cleanup();
    }

    /**
     * "Checking (Monitor)…" — naming the mode saves opening the menu to read it,
     * the same way the grid's entry and the health row's menu label themselves.
     */
    checkModeLabel(bookmark) {
        const meta = window.CheckMode?.meta?.(window.CheckMode.of(bookmark));
        return meta
            ? this.t('dashboard.contextMenuCheckMode', 'Checking ({mode})…', { mode: meta.badge })
            : this.t('config.contextCheckMode', 'Checking…');
    }

    /** The entries, in order, for one row. */
    actionsFor(bookmark) {
        const c = this.config;
        const ticked = c.bmSelected?.size > 0;
        const tags = Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean) : [];
        const category = String(bookmark.category || '').trim();

        // A selection replaces the single-row actions entirely, the way the
        // grid's menu does: a menu offering both would put "Delete" and "Delete
        // 5 selected" side by side, pointing at different sets.
        if (ticked && c.bmSelected.size > 1) {
            const count = c.bmSelected.size;
            return [
                { id: 'bulk-move', label: this.t('config.contextMoveSelected', 'Move {count} selected…', { count }), icon: '→' },
                { id: 'bulk-tags', label: this.t('config.contextTagSelected', 'Tag {count} selected…', { count }), icon: '#' },
                { id: 'bulk-pin', label: this.t('config.contextPinSelected', 'Pin or unpin {count} selected', { count }), icon: '📌' },
                { id: 'bulk-status', label: this.t('config.contextStatusSelected', 'Checking for {count} selected…', { count }), icon: '◉' },
                { id: 'bulk-export', label: this.t('config.contextExportSelected', 'Export {count} as CSV', { count }), icon: '⤓' },
                { id: 'clear', label: this.t('config.contextClearSelection', 'Clear selection'), icon: '✕' },
                { id: 'bulk-delete', label: this.t('config.contextDeleteSelected', 'Delete {count} selected', { count }), icon: '✕', danger: true },
            ];
        }

        return [
            { id: 'open-new-tab', label: this.t('dashboard.contextMenuOpenNewTab', 'Open in new tab'), icon: '↗' },
            { id: 'copy-url', label: this.t('dashboard.contextMenuCopyUrl', 'Copy URL'), icon: '⧉' },
            { id: 'share', label: c.shareBookmarkActionLabel(), icon: '↪' },
            { id: 'edit', label: this.t('config.edit', 'Edit'), icon: '✎' },
            {
                id: 'pin',
                label: bookmark.pinned
                    ? this.t('dashboard.contextMenuUnpin', 'Unpin')
                    : this.t('dashboard.contextMenuPin', 'Pin'),
                icon: '📌',
            },
            { id: 'check-mode', label: this.checkModeLabel(bookmark), icon: '◉', submenu: true },
            // Where Config differs from the grid: this list is the one you
            // filter, so narrowing it to what the row belongs to is the action
            // the view is for. Offered only where there is something to filter
            // by — a bookmark with no tags has no tag to narrow to.
            ...(category
                ? [{ id: 'filter-category', label: this.t('config.contextFilterCategory', 'Show only this category'), icon: '⛃' }]
                : []),
            { id: 'filter-page', label: this.t('config.contextFilterPage', 'Show only this page'), icon: '⌗' },
            ...(tags.length
                ? [{ id: 'filter-tag', label: this.t('config.contextFilterTag', 'Show only tag “{tag}”', { tag: tags[0] }), icon: '#' }]
                : []),
            { id: 'dashboard', label: this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'), icon: '⊕' },
            { id: 'health', label: this.t('dashboard.healthOpenInHealth', 'Show in Health'), icon: '♥' },
            { id: 'title', label: this.t('dashboard.healthRefreshTitle', 'Refresh title'), icon: '↻' },
            { id: 'favicon', label: this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'), icon: '◫' },
            { id: 'archive', label: this.t('dashboard.healthArchive', 'Find in Web Archive'), icon: '🏛' },
            // With nothing ticked, the menu is where a mouse-only user finds out
            // that selecting rows is possible: the tick box is easy to miss and
            // the bulk toolbar only appears once one is on.
            ...(!ticked
                ? [{ id: 'select', label: this.t('dashboard.contextMenuSelect', 'Select'), icon: '☑' }]
                : []),
            { id: 'delete', label: this.t('dashboard.contextMenuDelete', 'Delete'), icon: '✕', danger: true },
        ];
    }

    show(key, bookmark, point) {
        this.close();
        this.config.closeBookmarkMenus?.();
        this._lastPoint = point;
        this._openedFor = { key, bookmark };

        const pop = document.createElement('div');
        pop.id = 'config-bm-context-menu';
        // bookmark-context-menu carries the rule that lifts .move-popover's
        // 20rem cap: that cap exists for the move/tag/delete popovers, which
        // list every page or tag you have and genuinely scroll. This is a fixed
        // action list meant to be read at a glance, and it is longer than the
        // grid's — without the class the last entries fell below a scrollbar
        // nobody could reach.
        pop.className = 'move-popover bookmark-context-menu config-bm-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', this.t('config.contextMenuTitle', 'Bookmark actions'));

        const nameHint = document.createElement('div');
        nameHint.className = 'move-popover-current-hint';
        nameHint.textContent = String(bookmark.name || bookmark.url || '').trim() || '—';
        pop.appendChild(nameHint);

        const items = [];
        this.actionsFor(bookmark).forEach((action) => {
            if (action.danger) {
                const divider = document.createElement('div');
                divider.className = 'move-popover-divider';
                pop.appendChild(divider);
            }
            const item = document.createElement('div');
            item.className = 'move-popover-item' + (action.danger ? ' is-danger' : '');
            item.setAttribute('role', 'menuitem');
            item.setAttribute('tabindex', '-1');
            item.setAttribute('data-action', action.id);
            item.addEventListener('mouseenter', () => this.setFocus(items, items.indexOf(item)));

            const icon = document.createElement('span');
            icon.className = 'move-popover-check';
            icon.textContent = action.icon;
            item.appendChild(icon);

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

            item.addEventListener('click', () => {
                this.close();
                void this.run(action.id, key, bookmark);
            });
            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this.position(pop, point);
        // Where it actually landed, which is not the click point once flipping
        // or clamping has moved it. The submenu opens here rather than at the
        // cursor: it is a shorter menu, so the same point would place it a few
        // hundred pixels lower and it would read as a second, unrelated popover.
        this._anchor = { x: parseFloat(pop.style.left) || point.x, y: parseFloat(pop.style.top) || point.y };
        // After the node is in the document: position reads offsetWidth.
        let index = 0;
        requestAnimationFrame(() => {
            this.setFocus(items, 0);
            requestAnimationFrame(() => { scrollArmed = true; });
        });

        const move = (delta) => {
            index = ((index + delta) % items.length + items.length) % items.length;
            this.setFocus(items, index);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                move(1);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                move(-1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                index = 0;
                this.setFocus(items, index);
            } else if (e.key === 'End') {
                e.preventDefault();
                index = items.length - 1;
                this.setFocus(items, index);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                items[index].click();
            }
        };
        // The mouseup of the very right-click that opened this menu still has to
        // land, and Chromium delivers it as `auxclick` — deferring by a tick is
        // not enough, because that tick elapses before the button comes up. So
        // the guard is the event itself: a non-left button is the tail of the
        // gesture that opened the menu, not a click somewhere else.
        const onOutside = (e) => {
            if (e.type === 'auxclick' || e.button > 0) return;
            if (!pop.contains(e.target)) this.close();
        };
        // Scroll closes rather than repositions: the menu is anchored to a point
        // in the viewport, and the row it belongs to would slide out from under
        // it. The list scrolls on its own, so this is not hypothetical.
        //
        // Armed only once the menu has settled. Focusing the first item scrolls
        // the row into view, which fires a capture-phase scroll on the way — so
        // arming immediately meant the menu closed itself on the frame it
        // opened, every time.
        let scrollArmed = false;
        const onScroll = () => {
            if (scrollArmed) this.close();
        };

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        // Deferred a tick: the contextmenu event that opened this menu is still
        // travelling, and binding now would let it close the menu immediately.
        let outsideBound = null;
        setTimeout(() => {
            outsideBound = onOutside;
            document.addEventListener('click', outsideBound);
            document.addEventListener('auxclick', outsideBound);
            document.addEventListener('contextmenu', outsideBound);
        }, 0);

        const row = document.querySelector(
            `#config-bm-list .config-bm-row[data-bm-key="${CSS.escape(key)}"]`
        );
        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            if (outsideBound) {
                document.removeEventListener('click', outsideBound);
                document.removeEventListener('auxclick', outsideBound);
                document.removeEventListener('contextmenu', outsideBound);
                outsideBound = null;
            }
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            pop.remove();
            // Self-nulling: a stale menu closing later must not clear a newer
            // menu's cleanup.
            if (this._cleanup === close) this._cleanup = null;
            // Focus goes back to the row, not to nothing: losing it to <body>
            // would drop the list's keyboard navigation on the floor.
            if (row?.isConnected) row.focus({ preventScroll: true });
        };
        this._cleanup = close;
    }

    /**
     * Move the highlight, the way the other menus in this family do: an
     * `is-focused` class plus roving tabindex, not a bare `.focus()` on a div
     * that carries no tabindex of its own.
     */
    setFocus(items, idx) {
        items.forEach((el, i) => {
            const on = i === idx;
            el.classList.toggle('is-focused', on);
            el.setAttribute('tabindex', on ? '0' : '-1');
            if (on) el.focus({ preventScroll: true });
        });
    }

    /**
     * The three availability modes, on the same surface and at the same point
     * as the menu that opened it.
     *
     * Escape walks back to the parent menu rather than closing outright, the
     * way a native submenu does — and the way the grid's does.
     */
    showCheckModeMenu(key, bookmark, point) {
        const parentPoint = point || this._lastPoint || { x: 40, y: 40 };
        this.close();
        if (!window.CheckMode?.options) return;
        const active = window.CheckMode.of(bookmark);

        const pop = document.createElement('div');
        pop.id = 'config-bm-check-mode-menu';
        pop.className = 'move-popover bookmark-context-menu bookmark-check-mode-menu config-bm-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', this.t('dashboard.healthCheckModeLabel', 'Availability checking'));

        const header = document.createElement('div');
        header.className = 'move-popover-header';
        header.textContent = this.t('dashboard.healthCheckModeLabel', 'Availability checking');
        pop.appendChild(header);

        const items = [];
        let initialIdx = 0;
        window.CheckMode.options().forEach((option) => {
            const isActive = option.mode === active;
            if (isActive) initialIdx = items.length;
            const item = document.createElement('div');
            item.className = 'move-popover-item' + (isActive ? ' is-current' : '');
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', isActive ? 'true' : 'false');
            item.setAttribute('data-check-mode', option.mode);
            item.setAttribute('data-check-key', option.key);
            item.setAttribute('tabindex', '-1');

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = isActive ? '✓' : '';
            item.appendChild(check);

            const text = document.createElement('span');
            text.className = 'check-mode-option-text';
            const label = document.createElement('span');
            label.className = 'check-mode-option-label';
            label.textContent = option.label;
            const kbd = document.createElement('kbd');
            kbd.className = 'check-mode-option-key';
            kbd.textContent = option.key;
            label.appendChild(kbd);
            const body = document.createElement('span');
            body.className = 'check-mode-option-body';
            body.textContent = option.body;
            text.appendChild(label);
            text.appendChild(body);
            item.appendChild(text);

            const choose = () => {
                this.close();
                void this.config.setBookmarkCheckMode(key, option.mode);
            };
            item.addEventListener('click', choose);
            item.addEventListener('mouseenter', () => this.setFocus(items, items.indexOf(item)));
            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this.placeAt(pop, parentPoint);

        let index = initialIdx;
        let scrollArmed = false;
        requestAnimationFrame(() => {
            this.setFocus(items, initialIdx);
            requestAnimationFrame(() => { scrollArmed = true; });
        });

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.handleEscape();
                return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                index = ((index + delta) % items.length + items.length) % items.length;
                this.setFocus(items, index);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                items[index]?.click();
                return;
            }
            // o / p / m, the same accelerators the grid's submenu takes. Every
            // bare letter is swallowed so a miss cannot reach the shortcut
            // search behind the menu.
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                items.find((el) => el.getAttribute('data-check-key') === e.key.toLowerCase())?.click();
            }
        };
        const onOutside = (e) => {
            if (e.type === 'auxclick' || e.button > 0) return;
            if (!pop.contains(e.target)) this.close();
        };
        const onScroll = () => { if (scrollArmed) this.close(); };

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        let outsideBound = null;
        setTimeout(() => {
            outsideBound = onOutside;
            document.addEventListener('click', outsideBound);
            document.addEventListener('auxclick', outsideBound);
            document.addEventListener('contextmenu', outsideBound);
        }, 0);

        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            if (outsideBound) {
                document.removeEventListener('click', outsideBound);
                document.removeEventListener('auxclick', outsideBound);
                document.removeEventListener('contextmenu', outsideBound);
                outsideBound = null;
            }
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            pop.remove();
            if (this._cleanup === close) this._cleanup = null;
        };
        this._cleanup = close;
    }

    /**
     * Put a popover's top-left corner at a point, clamped into the viewport.
     *
     * Unlike position(), no flipping: the point is already a resolved corner
     * rather than a cursor, so flipping around it would move the submenu away
     * from the menu it replaces — which is the whole thing being avoided.
     */
    placeAt(pop, point) {
        const margin = 8;
        const width = pop.offsetWidth || 220;
        const height = pop.offsetHeight || 220;
        const left = Math.max(margin, Math.min(point.x, window.innerWidth - width - margin));
        const top = Math.max(margin, Math.min(point.y, window.innerHeight - height - margin));
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    /**
     * Flip near an edge, then clamp — the grid's menu does both, and flipping
     * alone was not enough here: this menu is the taller of the two, so a
     * right-click low on the page flipped it upward and still ran it off the
     * top. Clamping second guarantees the whole list is on screen whenever the
     * viewport can hold it at all.
     */
    position(pop, point) {
        const margin = 8;
        // offsetWidth/offsetHeight, not getBoundingClientRect: the popover
        // animates in with a scale, so the rect mid-animation is not the size
        // it settles at — measuring that way put the menu 6px off the bottom
        // of a short window. The layout box ignores the transform.
        const width = pop.offsetWidth || 220;
        const height = pop.offsetHeight || 220;
        let left = point.x;
        let top = point.y;
        if (left + width + margin > window.innerWidth) left = point.x - width;
        if (top + height + margin > window.innerHeight) top = point.y - height;
        left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    async run(action, key, bookmark) {
        const c = this.config;
        switch (action) {
            case 'open-new-tab':
                c.openBookmarkByKey(key);
                break;
            case 'edit':
                await c.openBookmarkEditModal(key);
                break;
            // No per-row pin writer exists — the editor and the bulk bar are the
            // only two, and bulkPin already takes a list. One bookmark is a list
            // of one, so this reuses it rather than adding a third writer.
            case 'pin':
                await c.bulkPin([bookmark]);
                await c.refreshBookmarksAfterWrite();
                break;
            case 'check-mode':
                // Not toggleBookmarkMenu: that opens the row's own badge menu,
                // which is anchored to the badge — so choosing Checking made the
                // menu vanish and a second one appear somewhere else entirely.
                this.showCheckModeMenu(key, bookmark, this._anchor);
                break;
            case 'filter-category':
                c.filterBookmarksByCategory(bookmark);
                break;
            case 'filter-page':
                await c.filterBookmarksByPage(bookmark.pageId);
                break;
            case 'filter-tag':
                c.filterBookmarksByTag((bookmark.tags || []).filter(Boolean)[0]);
                break;
            // Ticking through the same set the checkbox writes, so the bulk bar
            // appears exactly as it would have.
            case 'select':
                c.bmSelected.add(key);
                c.repaintBookmarksList();
                break;
            // The bulk entries hand straight to the toolbar's own dispatcher, so
            // the menu cannot drift from what the buttons do.
            case 'bulk-move':
            case 'bulk-tags':
            case 'bulk-pin':
            case 'bulk-status':
            case 'bulk-export':
            case 'bulk-delete':
            case 'clear':
                await c.handleBulkAction(action.replace(/^bulk-/, ''));
                break;
            // Everything else is already a row-menu action, and goes through the
            // one dispatcher rather than a second copy of each call.
            default:
                c.handleBookmarkMenuAction(action, key);
                break;
        }
    }
}

window.DashboardConfigContextMenu = DashboardConfigContextMenu;
