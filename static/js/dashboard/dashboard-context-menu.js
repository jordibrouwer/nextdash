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
        if (row?.classList?.contains('inbox-item')) {
            const id = row.getAttribute('data-inbox-id');
            const item = (d.inbox?.items || []).find((entry) => entry.id === id);
            const url = String(item?.url || row.getAttribute('data-bookmark-url') || '').trim();
            if (!url) return null;
            const name = String(
                item?.previewTitle || item?.title || item?.domain
                || row.getAttribute('data-inbox-share-name') || ''
            ).trim();
            return {
                bookmark: { name, url },
                index: -1,
                scope: 'inbox',
                pageId: 0,
                original: null,
            };
        }
        const rawIndex = row.getAttribute('data-bookmark-index');
        if (rawIndex !== null) {
            const index = Number(rawIndex);
            const bookmark = d.bookmarks?.[index];
            // `original` and `pageId` complete the shape resolveBookmarkReference()
            // returns. Callers that sync a mutation across collections write to
            // `original`, and it used to be missing here, so a keyboard-driven
            // change threw on a row that had a page-local index.
            if (bookmark) {
                return {
                    bookmark,
                    index,
                    scope: 'current',
                    pageId: Number(d.currentPageId),
                    original: { ...bookmark },
                };
            }
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
        const currentMode = bookmarkRef.scope === 'inbox'
            ? null
            : window.CheckMode?.meta(window.CheckMode.of(bookmark));
        const inboxActions = [
            { id: 'open-new-tab', label: this.t('dashboard.contextMenuOpenNewTab', 'Open in new tab'), icon: '↗' },
            { id: 'copy-url', label: this.t('dashboard.contextMenuCopyUrl', 'Copy URL'), icon: '⧉' },
            { id: 'share', label: this.shareActionLabel(), icon: '↪' },
        ];
        // Right-clicking a row that is part of a selection means "act on the
        // selection" — acting on the one row under the cursor would silently
        // ignore what the user had already ticked. The entries call the same
        // multiSelect methods Shift+Z and the toolbar use, so all three routes
        // share one implementation of what a bulk move or delete means.
        const multi = bookmarkRef.scope === 'current' ? d.multiSelect : null;
        const rowIsSelected = !!multi && multi.has(multi.keyForRow(row));
        const selectionActions = (multi && rowIsSelected && multi.count() > 1)
            ? [
                { id: 'multi-move', label: this.t('dashboard.contextMenuMoveSelected', 'Move {count} selected…', { count: multi.count() }), icon: '→' },
                { id: 'multi-open', label: this.t('dashboard.contextMenuOpenSelected', 'Open {count} selected', { count: multi.count() }), icon: '↗' },
                { id: 'multi-copy', label: this.t('dashboard.contextMenuCopySelected', 'Copy {count} links', { count: multi.count() }), icon: '⧉' },
                { id: 'multi-clear', label: this.t('dashboard.contextMenuClearSelection', 'Clear selection'), icon: '✕' },
                { id: 'multi-delete', label: this.t('dashboard.contextMenuDeleteSelected', 'Delete {count} selected', { count: multi.count() }), icon: '✕', danger: true },
            ]
            : [];

        // With no selection yet, the menu is where a mouse-only user discovers
        // that selecting is possible at all: the keyboard route is undiscoverable
        // by definition, and ticking the first row is the step that reveals the
        // toolbar and every action on it.
        const startSelectionActions = (multi && !multi.isActive())
            ? [
                { id: 'multi-start', label: this.t('dashboard.contextMenuSelect', 'Select'), icon: '☑' },
                { id: 'multi-start-category', label: this.t('dashboard.contextMenuSelectCategory', 'Select all in category'), icon: '☰' },
            ]
            : [];

        const singleActions = bookmarkRef.scope === 'inbox' ? inboxActions : [
            { id: 'open-new-tab', label: this.t('dashboard.contextMenuOpenNewTab', 'Open in new tab'), icon: '↗' },
            { id: 'copy-url', label: this.t('dashboard.contextMenuCopyUrl', 'Copy URL'), icon: '⧉' },
            { id: 'share', label: this.shareActionLabel(), icon: '↪' },
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
            // Offered for every bookmark, not only checked ones. The health
            // report covers the whole library — an unchecked bookmark has a row
            // there too (the `unchecked` filter and tile exist for exactly
            // that), and that row is where its checking gets turned on. Hiding
            // the entry made the destination unreachable from the one place
            // someone would look for it.
            { id: 'health', label: this.t('dashboard.healthOpenInHealth', 'Show in Health'), icon: '♥' },
            { id: 'delete', label: this.t('dashboard.contextMenuDelete', 'Delete'), icon: '✕', danger: true },
        ];

        // A selection replaces the single-row actions entirely rather than being
        // appended to them: a menu offering both would leave "Delete" and
        // "Delete 5 selected" side by side, pointing at different sets.
        // The selecting entries go before Delete, not after it: Delete opens the
        // menu's destructive zone (it is what the divider marks), and a harmless
        // "Select" sitting below that line reads as belonging to it.
        const deleteAt = singleActions.findIndex((action) => action.danger);
        const splitAt = deleteAt >= 0 ? deleteAt : singleActions.length;
        const actions = selectionActions.length
            ? selectionActions
            : [
                ...singleActions.slice(0, splitAt),
                ...startSelectionActions,
                ...singleActions.slice(splitAt),
            ];

        const items = [];
        actions.forEach((action) => {
            if (action.danger) {
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
            close();
            this.runAction(action, row, bookmarkRef, { parentPoint: point });
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
    showCheckModeMenu(row, bookmarkRef, options = {}) {
        const d = this.dash;
        const bookmark = bookmarkRef.bookmark;
        const bookmarkIndex = bookmarkRef.scope === 'current' ? bookmarkRef.index : -1;
        if (!window.CheckMode) return;
        // Where Escape should land. Opened from the parent menu it goes back
        // there, the way a native submenu does; opened straight from Shift+C
        // there is no parent to return to, so Escape just closes.
        const parentPoint = options.parentPoint || null;
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
            item.setAttribute('data-check-key', option.key);

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = isActive ? '✓' : '';
            item.appendChild(check);

            const text = document.createElement('span');
            text.className = 'check-mode-option-text';
            const label = document.createElement('span');
            label.className = 'check-mode-option-label';
            label.textContent = option.label;
            // The accelerator is printed rather than taught elsewhere, the way the
            // health view marks its row shortcuts.
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

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        // Anchored to the row for both routes. The parent menu follows the pointer
        // because that is where the gesture happened, but this one belongs to a
        // specific bookmark — and opening it beside that row keeps mouse and
        // keyboard showing it in the same place.
        this.positionAtPoint(pop, this.pointBelowRow(row));
        window.FocusTrapUtils?.syncDashboardInert?.();

        const previousFocus = document.activeElement;
        // Captured separately from the mutable cursor below: the deferred focus
        // call runs after `focusedIdx` may already have moved, and reading it
        // there landed on whichever item the DOM happened to focus first.
        const initialIdx = Math.max(0, items.findIndex((i) => i.getAttribute('aria-checked') === 'true'));
        let focusedIdx = initialIdx;
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

            // Apply the new mode to every in-memory copy, and drop the page cache
            // a later read would be served from. Without it the menu reopened on
            // the pre-change mode even though the write had succeeded. Shared with
            // the health view, which needs the same sync.
            window.CheckMode.assign(bookmark, mode);
            window.CheckMode.syncLocalCopies({
                pageId,
                url: bookmark.url,
                mode,
                bookmarkRef,
            });
            // syncLocalCopies has already patched d.bookmarks, so rendering from
            // memory is correct here — no re-fetch needed.
            d.renderDashboard?.({ incremental: false });
            d.updateHealthBadge?.();
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                close();
                // Step back out to the menu this was opened from, so Escape
                // walks the levels rather than dropping the whole stack. A
                // second Escape then closes the parent.
                if (parentPoint) {
                    this.show(row, bookmarkRef, parentPoint);
                }
                return;
            }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx + 1) % items.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus((focusedIdx - 1 + items.length) % items.length); return; }
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (items[focusedIdx]) void choose(items[focusedIdx]); return; }

            // Letter accelerators: o / p / m pick a mode outright. The letters come
            // from the mode names themselves and are shown on each row, so there is
            // nothing to memorise. Swallowed even when they match nothing, because
            // a bare letter would otherwise fall through to the shortcut search
            // and leave a menu open over it.
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const hit = items.find((el) => el.getAttribute('data-check-key') === e.key.toLowerCase());
                if (hit) void choose(hit);
                return;
            }
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
        requestAnimationFrame(() => setFocus(initialIdx));
    }

    /**
     * Whether this browser can actually open a share sheet.
     *
     * Not merely a question of HTTPS: desktop Chrome on macOS and Linux, and
     * Firefox everywhere, expose no navigator.share even on a secure origin. The
     * menus ask before labelling the entry, because an item promising a share
     * dialog that silently copies instead reads as broken.
     */
    canOpenShareSheet() {
        if (typeof navigator.share !== 'function') return false;
        // Presence is not permission. Safari on macOS exposes navigator.share
        // over plain HTTP — localhost included — and then rejects every call
        // with NotAllowedError, so feature detection alone promises a sheet the
        // browser will refuse. Once a call has been refused that way, this
        // browser is treated as unable to share until the page reloads.
        return DashboardContextMenu._shareRefused !== true;
    }

    /**
     * Remember a refusal so the menu stops offering something that cannot work.
     *
     * Static rather than per-instance: the health view and the right-click menu
     * ask the same question about the same browser, and a refusal in one is a
     * refusal in the other.
     */
    static markShareRefused() {
        DashboardContextMenu._shareRefused = true;
    }

    /**
     * The label for the share entry, naming what will actually happen — the
     * share sheet where there is one, a clipboard copy where there is not.
     */
    shareActionLabel() {
        return this.canOpenShareSheet()
            ? this.t('dashboard.contextMenuShare', 'Share…')
            : this.t('dashboard.contextMenuCopyNameUrl', 'Copy name + URL');
    }

    /**
     * Hand a bookmark to the system share sheet, or the clipboard when there
     * isn't one.
     *
     * navigator.share() only exists on a secure origin, and on desktop only
     * Safari and Chromium implement it — a self-hosted dashboard on plain HTTP
     * over a LAN has no share sheet at all. So the item is always shown and the
     * fallback copies "name — URL" instead. That is deliberately not the same
     * as Copy URL one row above: the title travels with the link, which is what
     * makes it worth pasting into a chat.
     *
     * @returns {Promise<'shared'|'cancelled'|'copied'|'none'>} what actually happened
     */
    async shareBookmark(bookmark, row) {
        const url = String(bookmark?.url || '').trim();
        if (!url) return 'none';
        const title = String(bookmark?.name || '').trim();

        if (navigator.share) {
            try {
                await navigator.share(title ? { title, text: title, url } : { url });
                return 'shared';
            } catch (err) {
                // AbortError is the user closing the sheet — a completed gesture,
                // not a failure, so it must not fall through to the clipboard and
                // announce a copy nobody asked for.
                if (err?.name === 'AbortError') return 'cancelled';
                // NotAllowedError means the browser will not open a sheet here at
                // all — Safari answers that way on plain HTTP, localhost included,
                // even though navigator.share exists. Recording it re-labels the
                // entry as the copy it actually performs, so the second attempt
                // no longer promises a dialog that never appears.
                if (err?.name === 'NotAllowedError') {
                    DashboardContextMenu.markShareRefused();
                }
                // Anything else (a share target that rejects, a transient
                // failure) still falls through to the clipboard.
            }
        }

        return this.copyShareText(title ? `${title} — ${url}` : url, row) ? 'copied' : 'none';
    }

    /**
     * Clipboard write for the share fallback, with its own toast.
     *
     * Deliberately not _copyUrlToClipboard(): that one says "URL copied", which
     * would be wrong for name + URL, and this needs to report success so the
     * caller can tell a copy from a no-op.
     */
    copyShareText(text, row) {
        const d = this.dash;
        const value = String(text || '').trim();
        if (!value) return false;

        const done = () => {
            if (row) {
                row.classList.remove('bookmark-copy-flash');
                void row.offsetWidth;
                row.classList.add('bookmark-copy-flash');
                row.addEventListener('animationend', () => row.classList.remove('bookmark-copy-flash'), { once: true });
            }
            // Name the reason when it is the origin, because that one is fixable:
            // the browser does have a share sheet and is withholding it over
            // plain HTTP. Without this the copy looks like the share silently
            // failing, which is how this was reported.
            // Three different situations, three honest messages. A refusal is not
            // the same as a missing feature, and neither is the same as an
            // insecure address — telling someone on localhost that they need
            // localhost is worse than saying nothing.
            const refused = DashboardContextMenu._shareRefused === true;
            const insecure = !refused && window.isSecureContext === false;
            const explained = refused || insecure;
            let message;
            if (refused) {
                message = this.t(
                    'dashboard.shareCopiedUnavailable',
                    'Copied — this browser will not open a share sheet here'
                );
            } else if (insecure) {
                message = this.t(
                    'dashboard.shareCopiedInsecure',
                    'Copied — sharing needs HTTPS or localhost'
                );
            } else {
                message = this.t('dashboard.shareCopied', 'Link copied to share');
            }
            d.showNotification?.(message, 'success', { duration: explained ? 4000 : 2000 });
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(value).then(done).catch(() => {
                if (this.execCopyFallback(value)) done();
            });
            return true;
        }
        if (this.execCopyFallback(value)) {
            done();
            return true;
        }
        return false;
    }

    /** Pre-Clipboard-API copy, kept for plain-HTTP LAN installs. */
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

    /** Anchor point just under a row, used by the row-anchored submenu. */
    pointBelowRow(row) {
        const rect = row?.getBoundingClientRect?.();
        if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        return { x: rect.left, y: rect.bottom + 4 };
    }

    /**
     * Open the check-mode menu for a row from the keyboard (Shift+C).
     *
     * Same menu the right-click route builds, and anchored the same way, so the
     * two routes are indistinguishable once the menu is open.
     */
    openCheckModeForRow(row) {
        if (!(row instanceof HTMLElement)) return false;
        const bookmarkRef = this.resolveRowBookmark(row);
        if (!bookmarkRef?.bookmark) return false;
        this.showCheckModeMenu(row, bookmarkRef);
        return true;
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

    /**
     * Open the Health view with this bookmark's row selected.
     *
     * The health key is `pageId:index` against the page's stored order, which
     * is what `scope: 'current'` already carries. A smart-collection or
     * cross-page row (`scope: 'remote'`) has no such index — its position in the
     * rendered list is not its position on its own page — so that one is
     * resolved from the server rather than guessed.
     */
    async revealInHealth(bookmarkRef) {
        const d = this.dash;
        const pageId = Number(bookmarkRef?.pageId);
        if (!Number.isFinite(pageId)) return;

        let index = bookmarkRef.scope === 'current' ? Number(bookmarkRef.index) : -1;
        if (!(index >= 0)) {
            const url = String(bookmarkRef.bookmark?.url || '').trim();
            try {
                const res = await fetch(`/api/bookmarks?page=${pageId}`);
                const list = res.ok ? await res.json() : null;
                index = Array.isArray(list)
                    ? list.findIndex((entry) => String(entry?.url || '').trim() === url)
                    : -1;
            } catch {
                index = -1;
            }
        }
        if (!(index >= 0)) return;

        await d.config?.openViewFromTile?.('health', null, `${pageId}:${index}`);
    }

    runAction(action, row, bookmarkRef, options = {}) {
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
            case 'share': {
                let shareTarget = bookmark;
                if (bookmarkRef.scope === 'inbox') {
                    const id = row.getAttribute('data-inbox-id');
                    const shareUrl = d.inbox?.buildItemShareUrl?.(id);
                    if (shareUrl) {
                        shareTarget = { name: bookmark.name, url: shareUrl };
                    }
                }
                void this.shareBookmark(shareTarget, row);
                break;
            }
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
                this.showCheckModeMenu(row, bookmarkRef, { parentPoint: options.parentPoint });
                break;
            case 'health':
                void this.revealInHealth(bookmarkRef);
                break;
            case 'delete':
                // Confirm popover rather than deleteBookmarkInline() — a menu click is
                // one gesture away from a destructive action, so it needs a second step.
                d.showDeletePopover?.(row, bookmark, bookmarkIndex);
                break;

            // The multi-select entries call the same methods the keyboard and
            // the toolbar call, so the mouse route cannot drift from them —
            // including the delete confirmation and the trash write inside
            // deleteSelected().
            case 'multi-start':
                d.multiSelect?.toggleRow(row);
                break;
            case 'multi-start-category':
                d.multiSelect?.selectCategory(row);
                break;
            case 'multi-move':
                // Anchored on the row that was right-clicked: the toolbar button
                // it normally hangs off is not what opened this menu.
                d.multiSelect?.openMovePopover(row);
                break;
            case 'multi-open':
                d.multiSelect?.openSelected();
                break;
            case 'multi-copy':
                d.multiSelect?.copySelectedLinks();
                break;
            case 'multi-clear':
                d.multiSelect?.clear();
                break;
            case 'multi-delete':
                void d.multiSelect?.deleteSelected();
                break;
            default:
                break;
        }
    }
}

window.DashboardContextMenu = DashboardContextMenu;
