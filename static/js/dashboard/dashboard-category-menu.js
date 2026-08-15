/**
 * Right-click menu on a category header: rename and delete.
 *
 * Both were reachable before, but barely — rename only through a 500 ms
 * long-press nothing advertises, delete only by going to config. Now that adding
 * a category takes one gesture on the grid, the other two belonging elsewhere is
 * the odd part.
 *
 * Deliberately not part of the bookmark context menu's lazy bundle: that module
 * carries the whole bookmark editor with it, and renaming a header should not
 * fetch it. The popover markup mirrors that menu's (.move-popover) so both look
 * like one feature.
 */
class DashboardCategoryMenu {
    constructor(dashboard) {
        this.dash = dashboard;
        this._cleanup = null;
    }

    t(key, fallback, replacements = {}) {
        return this.dash.formatDashboardLabel(key, replacements, fallback);
    }

    close() {
        this._cleanup?.();
    }

    /**
     * Bind a header. Smart collections and the tag-filter chunks are skipped:
     * they are views over bookmarks, not stored categories, so there is nothing
     * to rename or delete.
     */
    bindCategory(categoryEl, category) {
        if (!(categoryEl instanceof HTMLElement) || categoryEl.dataset.categoryMenuBound === '1') {
            return;
        }
        if (category?.isSmartCollection || category?.tagFilterChunk || category?.isVirtualCategory) {
            return;
        }
        const titleEl = categoryEl.querySelector('.category-title');
        if (!titleEl) {
            return;
        }
        categoryEl.dataset.categoryMenuBound = '1';

        titleEl.addEventListener('contextmenu', (e) => {
            const d = this.dash;
            if (e.shiftKey) return; // escape hatch to the native menu
            if (d.uiHelpers?.isModalOpen?.()) return;
            // The long-press rename owns the header while its input is up.
            if (titleEl.querySelector('.category-rename-input')) return;
            e.preventDefault();
            e.stopPropagation();
            // The Menu key raises this event too, with no pointer behind it —
            // taken literally the menu landed in the corner of the window.
            const fromPointer = e.detail > 0 || e.clientX > 0 || e.clientY > 0;
            const box = titleEl.getBoundingClientRect();
            this.show(titleEl, category, fromPointer
                ? { x: e.clientX, y: e.clientY }
                : { x: box.left + 8, y: box.bottom });
        });
    }

    show(titleEl, category, point) {
        // `key` is the keyboard route to the same action, shown as a chip so the
        // menu teaches its own shortcuts. Untranslated, like every other key
        // hint in the app.
        const span = window.DashboardCategorySpan;
        const blockedReason = span?.spreadUnavailableReason(this.dash) || null;
        const canSpread = blockedReason === null;
        const isSpread = span?.isCategorySpread(this.dash, category) === true;
        const actions = [
            { id: 'rename', label: this.t('categoryMenuRename', 'Rename'), icon: '✎', key: 'F2' },
            {
                // A switch, not a size: how many columns a spread category
                // takes follows from the items-per-category limit and how many
                // bookmarks are in it, so there is nothing to choose.
                //
                // The label says what the click will do, the way Pin/Unpin does
                // one entry down in the bookmark menu — this list is verbs, and
                // a constant label with a tick beside it belongs to the radio
                // submenus instead. It is deliberately not marked `checked`:
                // paired with a label that already flips, a screen reader would
                // announce "spread across columns, ticked" for the entry that
                // undoes exactly that.
                id: 'spread',
                label: isSpread
                    ? this.t('categoryMenuUnspread', 'Back to one column')
                    : this.t('categoryMenuSpread', 'Spread across columns'),
                icon: '↔',
                key: 'Shift+W',
                detail: canSpread ? '' : this.spreadUnavailableText(blockedReason, true),
                disabled: !canSpread,
            },
            { id: 'add', label: this.t('categoryMenuAdd', 'Add category'), icon: '+', key: 'c' },
            { id: 'delete', label: this.t('categoryMenuDelete', 'Delete'), icon: '✕', danger: true, key: 'Delete' },
        ];

        this._openMenu({
            id: 'category-context-menu',
            ariaLabel: this.t('categoryMenuTitle', 'Category actions'),
            hint: String(category.name || category.id || '').trim() || '—',
            entries: actions,
            point,
            onPick: (action) => {
                if (action === 'spread') {
                    this.toggleSpread(category);
                    return;
                }
                void this.runAction(action, titleEl, category);
            },
        });
    }

    /**
     * Flip spreading for one category.
     *
     * Shared with Shift+W, which is why it is a method rather than a closure in
     * the menu above.
     */
    toggleSpread(category) {
        const d = this.dash;
        const span = window.DashboardCategorySpan;
        if (!span) {
            return false;
        }
        const blocked = span.spreadUnavailableReason(d);
        if (blocked) {
            d.showNotification?.(this.spreadUnavailableText(blocked, false), 'info');
            return false;
        }
        const next = span.toggleCategorySpread(d, category.id);
        window.nextdashTrack?.('category:spread', { on: next });
        span.refreshCategorySpreadUi(d, category.id);
        return next;
    }

    /**
     * Why spreading is out of reach, long or short.
     *
     * Short goes beside the menu entry, long into a toast — the same two
     * reasons either way, so they are written in one place.
     */
    spreadUnavailableText(reason, short) {
        if (reason === 'unlimited-items') {
            return short
                ? this.t('categorySpreadNeedsLimitShort', 'Needs an items-per-category limit')
                : this.t('categorySpreadNeedsLimit',
                    'Spreading needs a limit on items per category — that limit is what decides how many columns a category takes. Set one in Config → Appearance → Layout.');
        }
        return short
            ? this.t('categorySpreadUnavailableShort', 'One column per category here')
            : this.t('categorySpreadUnavailable',
                'There is only one column to work with — spreading needs at least two.');
    }

    _openMenu({ id, ariaLabel, hint, entries, point, onPick, focusIndex = 0 }) {
        const d = this.dash;
        this.close();

        const pop = document.createElement('div');
        pop.id = id;
        pop.className = 'move-popover bookmark-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', ariaLabel);

        if (hint) {
            const nameHint = document.createElement('div');
            nameHint.className = 'move-popover-current-hint';
            nameHint.textContent = hint;
            pop.appendChild(nameHint);
        }

        const items = [];
        entries.forEach((action) => {
            if (action.danger) {
                const divider = document.createElement('div');
                divider.className = 'move-popover-divider';
                pop.appendChild(divider);
            }
            const item = document.createElement('div');
            item.className = 'move-popover-item'
                + (action.danger ? ' is-danger' : '')
                + (action.disabled ? ' is-disabled' : '');
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-action', action.id);
            if (action.checked) {
                item.setAttribute('aria-checked', 'true');
            }
            if (action.disabled) {
                item.setAttribute('aria-disabled', 'true');
            }

            const check = document.createElement('span');
            check.className = 'move-popover-check';
            check.textContent = action.icon || '';
            item.appendChild(check);

            const label = document.createElement('span');
            label.textContent = action.label;
            item.appendChild(label);

            if (action.detail) {
                const detail = document.createElement('span');
                detail.className = 'move-popover-item-detail';
                detail.textContent = action.detail;
                item.appendChild(detail);
            }

            if (action.submenu) {
                const caret = document.createElement('span');
                caret.className = 'move-popover-submenu-caret';
                caret.textContent = '›';
                caret.setAttribute('aria-hidden', 'true');
                item.appendChild(caret);
            }

            if (action.key) {
                const kbd = document.createElement('kbd');
                kbd.className = 'move-popover-item-key';
                kbd.textContent = action.key;
                // The chip is a label, not a second thing to read out: the item
                // already says what it does. aria-keyshortcuts is how the key
                // reaches a screen reader instead.
                kbd.setAttribute('aria-hidden', 'true');
                item.setAttribute('aria-keyshortcuts',
                    window.ShortcutFormat?.ariaKeys?.(action.key) || action.key);
                item.appendChild(kbd);
            }

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this._positionAtPoint(pop, point);
        window.FocusTrapUtils?.syncDashboardInert?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = focusIndex;
        const setFocus = (idx) => {
            focusedIdx = ((idx % items.length) + items.length) % items.length;
            items.forEach((el, i) => {
                el.classList.toggle('is-focused', i === focusedIdx);
                if (i === focusedIdx) {
                    el.setAttribute('tabindex', '0');
                    el.focus({ preventScroll: true });
                } else {
                    el.setAttribute('tabindex', '-1');
                }
            });
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
            if (previousFocus && typeof previousFocus.focus === 'function') {
                previousFocus.focus({ preventScroll: true });
            }
            window.FocusTrapUtils?.syncDashboardInert?.();
        };
        this._cleanup = close;

        const confirm = (item) => {
            if (item.getAttribute('aria-disabled') === 'true') {
                return;
            }
            const action = item.getAttribute('data-action');
            close();
            onPick(action);
        };

        const hasSubmenu = (item) => item.querySelector('.move-popover-submenu-caret') !== null;

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx - 1); return; }
            // ArrowRight opens a submenu, the convention in every native menu.
            if (e.key === 'ArrowRight' && items[focusedIdx] && hasSubmenu(items[focusedIdx])) {
                e.preventDefault();
                e.stopImmediatePropagation();
                confirm(items[focusedIdx]);
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (items[focusedIdx]) confirm(items[focusedIdx]);
            }
        };

        items.forEach((item, idx) => {
            item.addEventListener('mouseenter', () => setFocus(idx));
            item.addEventListener('click', () => confirm(item));
        });

        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        setTimeout(() => {
            onOutside = (e) => { if (!pop.contains(e.target)) close(); };
            document.addEventListener('click', onOutside);
            document.addEventListener('contextmenu', onOutside);
        }, 0);
        requestAnimationFrame(() => setFocus(focusIndex));
    }

    _positionAtPoint(pop, point) {
        const margin = 8;
        const rect = pop.getBoundingClientRect();
        let left = point.x;
        let top = point.y;
        if (left + rect.width + margin > window.innerWidth) {
            left = Math.max(margin, window.innerWidth - rect.width - margin);
        }
        if (top + rect.height + margin > window.innerHeight) {
            top = Math.max(margin, window.innerHeight - rect.height - margin);
        }
        pop.style.left = `${Math.max(margin, left)}px`;
        pop.style.top = `${Math.max(margin, top)}px`;
    }

    /**
     * Drop the trash entry for a category the undo has just put back, so it does
     * not sit in the trash shadowing a live category.
     *
     * Best-effort: a stale entry is untidy, a failed undo is not.
     */
    async _dropCategoryTrashEntry(pageId, categoryId) {
        try {
            const data = await window.DashboardTrash?.list?.();
            const hit = (data?.items || []).find((item) => item.kind === 'category'
                && Number(item.pageId) === Number(pageId)
                && String(item.trashedCategory?.category?.id || '') === String(categoryId));
            if (hit) {
                await window.DashboardTrash.remove(hit.id);
            }
        } catch (_error) {
            /* leave it; the restore itself already succeeded */
        }
    }

    async runAction(action, titleEl, category) {
        const d = this.dash;
        window.nextdashTrack?.('category:context-menu', { action });

        if (action === 'add') {
            d.categoryAdd?.open();
            return;
        }

        if (action === 'rename') {
            // Reuse the long-press editor rather than a second rename surface, so
            // both routes commit through the same code.
            const nameSpan = titleEl.querySelector('.category-title-name');
            if (nameSpan) {
                d.renderCore?._startCategoryRename?.(titleEl, nameSpan, category);
            }
            return;
        }

        if (action === 'delete') {
            const pageId = d.currentPageId;
            const name = String(category.name || category.id || '');
            const count = d.structureCreate.countBookmarksInCategory(category.id);
            // The bookmarks survive but lose their category and reappear under
            // "unknown category" — invisible from here, so it goes in the prompt.
            const message = count > 0
                ? this.t(
                    'categoryDeleteWithBookmarks',
                    'Delete “{name}”? Its {n} bookmarks are kept but lose their category.',
                    { name, n: count },
                )
                : this.t('categoryDeleteConfirm', 'Delete “{name}”?', { name });
            const ok = typeof window.AppModal?.danger === 'function'
                ? await window.AppModal.danger({
                    title: this.t('categoryMenuDelete', 'Delete'),
                    message,
                    confirmText: this.t('categoryMenuDelete', 'Delete'),
                })
                : window.confirm(message);
            if (!ok) {
                return;
            }
            const result = await d.structureCreate.deleteCategory(pageId, category.id);
            if (result.error) {
                d.showErrorNotification?.(result.error);
                return;
            }
            await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });

            // Deleting from a right-click menu is one slip away from a misclick,
            // so the confirm is not the only safety net.
            d.showNotification?.(
                this.t('categoryDeleted', 'Category deleted.'),
                'success',
                {
                    duration: 8000,
                    undoCallback: async () => {
                        const undone = await d.structureCreate.restoreCategories(pageId, result.before);
                        if (undone.error) {
                            d.showErrorNotification?.(undone.error);
                            return;
                        }
                        await d.loadPageBookmarks(pageId, { skipInlineEditConfirm: true });
                        // Restored through the categories endpoint, so its trash
                        // entry now shadows a live category. Dropping it goes
                        // straight through the trash module, which config does
                        // not need to be loaded for.
                        await this._dropCategoryTrashEntry(pageId, category.id);
                        await d.config?.instance?.refreshTrashIfVisible?.();
                        d.showNotification?.(
                            this.t('categoryDeleteUndone', 'Category restored.'),
                            'success',
                        );
                    },
                },
            );
        }
    }
}

window.DashboardCategoryMenu = DashboardCategoryMenu;
