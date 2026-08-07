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
            this.show(titleEl, category, { x: e.clientX, y: e.clientY });
        });
    }

    show(titleEl, category, point) {
        const d = this.dash;
        this.close();

        const pop = document.createElement('div');
        pop.id = 'category-context-menu';
        pop.className = 'move-popover bookmark-context-menu';
        pop.setAttribute('role', 'menu');
        pop.setAttribute('aria-label', this.t('categoryMenuTitle', 'Category actions'));

        const nameHint = document.createElement('div');
        nameHint.className = 'move-popover-current-hint';
        nameHint.textContent = String(category.name || category.id || '').trim() || '—';
        pop.appendChild(nameHint);

        const actions = [
            { id: 'rename', label: this.t('categoryMenuRename', 'Rename'), icon: '✎' },
            { id: 'add', label: this.t('categoryMenuAdd', 'Add category'), icon: '+' },
            { id: 'delete', label: this.t('categoryMenuDelete', 'Delete'), icon: '✕', danger: true },
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

            pop.appendChild(item);
            items.push(item);
        });

        document.body.appendChild(pop);
        this._positionAtPoint(pop, point);
        window.FocusTrapUtils?.syncDashboardInert?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });

        const previousFocus = document.activeElement;
        let focusedIdx = 0;
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
            const action = item.getAttribute('data-action');
            close();
            void this.runAction(action, titleEl, category);
        };

        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
            if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx + 1); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); setFocus(focusedIdx - 1); return; }
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
        requestAnimationFrame(() => setFocus(0));
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
        }
    }
}

window.DashboardCategoryMenu = DashboardCategoryMenu;
