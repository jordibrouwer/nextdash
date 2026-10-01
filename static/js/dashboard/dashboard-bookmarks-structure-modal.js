/**
 * Pages and categories, managed from the Bookmarks view.
 *
 * A modal over the list rather than a trip to Config → Structure, built from
 * Structure's own editors (renderPagesEditor, renderCategoriesEditor and
 * their binders): the same rows, the same saves, the same confirmations. The
 * editors find their body by #config-pt-body and rebind inside the nearest
 * [data-pt-host] (repaintPtBody), which is what lets them work here as well
 * as in Structure. Each row gains what matters from the list's side: how
 * many are broken, and a Show that filters the list to it.
 *
 * Its own overlay rather than AppModal: the editors confirm a delete or a
 * duplicate through AppModal and #config-confirm-modal, which must open over
 * this, not instead of it.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const TABS = ['pages', 'categories'];

    Object.assign(global.DashboardConfig.prototype, {
        isStructureModalOpen() {
            return Boolean(this._structureOverlay?.isConnected);
        },

        openStructureModal(tab = 'pages') {
            const which = TABS.includes(tab) ? tab : 'pages';
            if (this.isStructureModalOpen()) {
                this.switchStructureModalTab(which);
                return;
            }
            const esc = (v) => this.dash.escapeHtml(v);
            this._structurePrevTab = this.ptTab;
            this._structureModal = true;
            this.ptTab = which;
            this.clearListKeyboardSelection?.();

            const tabs = TABS.map((name) => {
                const on = name === which;
                return `<button type="button" class="config-subtab${on ? ' is-active' : ''}" role="tab" aria-selected="${on}"
                            tabindex="${on ? 0 : -1}" aria-controls="config-pt-body" data-pt-tab="${name}">${esc(this.ptTabLabel(name))}</button>`;
            }).join('');
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay config-structure-overlay show';
            overlay.setAttribute('data-structure-modal', '');
            overlay.innerHTML = `
                <div class="modal config-structure-modal" role="dialog" aria-modal="true" aria-labelledby="config-structure-title">
                    <div class="modal-header config-structure-head">
                        <span class="modal-title" id="config-structure-title">${esc(this.t('config.bmStructureTitle', 'Pages and categories'))}</span>
                        <div class="config-subtabs config-structure-tabs" role="tablist">${tabs}</div>
                        <button type="button" class="config-structure-close" data-structure-close
                                aria-label="${esc(this.t('config.bmCloseDetails', 'Close'))}">×</button>
                    </div>
                    <div class="config-structure-body" data-pt-host>
                        <div id="config-pt-body" role="tabpanel" tabindex="0">${this.renderPtTab()}</div>
                    </div>
                    <div class="config-structure-foot" data-structure-foot>${this.renderStructureFoot()}</div>
                </div>`;
            document.body.appendChild(overlay);
            this._structureOverlay = overlay;
            this.bindPtTabControls(overlay.querySelector('[data-pt-host]'));

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.closest('[data-structure-close]')) {
                    void this.closeStructureModal();
                    return;
                }
                const tabBtn = e.target.closest('[data-pt-tab]');
                if (tabBtn) {
                    this.switchStructureModalTab(tabBtn.getAttribute('data-pt-tab'));
                    return;
                }
                const show = e.target.closest('[data-structure-show]');
                if (show) {
                    this.showFromStructureModal(show);
                    return;
                }
                if (e.target.closest('[data-structure-remove-empty]')) {
                    void this.removeEmptyPages();
                    return;
                }
                const more = e.target.closest('[data-structure-more]');
                if (more) {
                    this.openStructureRowMenu(more);
                    return;
                }
                const proxied = e.target.closest('[data-structure-proxy]');
                if (proxied) {
                    const row = proxied.closest('[data-page-row], [data-cat-row]');
                    const target = row?.querySelector(proxied.getAttribute('data-proxy-selector'));
                    this.closeStructureRowMenu();
                    target?.click();
                    return;
                }
                const action = e.target.closest('[data-structure-action]');
                if (action) {
                    this.runStructureMenuAction(action.getAttribute('data-structure-action'));
                    return;
                }
                if (e.target.closest('[data-structure-confirm]')) {
                    void this.confirmStructureMenu();
                    return;
                }
                if (!e.target.closest('[data-structure-menu]')) this.closeStructureRowMenu();
            });
            this.bindStructureDrag(overlay);
            // Escape closes it -- unless a confirmation it opened is up, which
            // takes the key first and leaves this where it was.
            this._structureKeys = (e) => {
                if (e.key !== 'Escape' || !this.isStructureModalOpen()) return;
                if (document.getElementById('config-confirm-modal') || document.getElementById('app-modal')?.classList.contains('show')) return;
                const field = e.target?.closest?.('input, textarea, select');
                if (field && overlay.contains(field)) {
                    field.blur();
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.closeStructureModal();
            };
            document.addEventListener('keydown', this._structureKeys, true);
            requestAnimationFrame(() => overlay.querySelector('[data-pt-tab].is-active')?.focus());
        },

        switchStructureModalTab(tab) {
            if (!TABS.includes(tab)) return;
            if (tab !== this.ptTab) {
                this.clearListKeyboardSelection?.();
                this.closeStructureRowMenu();
                this.ptTab = tab;
                this.repaintPtBody();
            }
            this.syncSubTabStrip('data-pt-tab', tab);
            this.repaintStructureFoot();
        },

        /** The modal's foot: on Pages, the way to clear out the empty ones. */
        renderStructureFoot() {
            if (this.ptTab !== 'pages') return '';
            const empty = this.emptyPages();
            if (!empty.length) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            return `<span>${esc(this.t('config.bmStructureEmptyPages', 'Empty pages: {n}').replace('{n}', String(empty.length)))}</span>
                <button type="button" class="config-btn config-btn--small" data-structure-remove-empty>${esc(
                    this.t('config.bmStructureRemoveEmpty', 'Remove all empty pages'))}</button>`;
        },

        repaintStructureFoot() {
            const foot = this._structureOverlay?.querySelector('[data-structure-foot]');
            if (foot) foot.innerHTML = this.renderStructureFoot();
        },

        /** Pages with no bookmarks on them, the first page excepted: it cannot go. */
        emptyPages() {
            const counts = this.pageBookmarkCounts();
            return (this.dash.pages || []).filter((p) => Number(p.id) !== 1 && !(counts.get(String(p.id)) || 0));
        },

        async removeEmptyPages() {
            const empty = this.emptyPages();
            if (!empty.length) return;
            const names = empty.map((p) => p.name || p.id).join(', ');
            const ok = await this.confirmAction(this.t('config.bmStructureRemoveEmptyConfirm',
                'Remove {n} pages with no bookmarks on them? {names}').replace('{n}', String(empty.length)).replace('{names}', names),
            { confirmLabel: this.t('config.bmStructureRemoveEmpty', 'Remove all empty pages') });
            if (!ok) return;
            let removed = 0;
            for (const p of empty) {
                try {
                    const res = await this.writeFetch(`/api/pages/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    this.dash.pages = (this.dash.pages || []).filter((x) => Number(x.id) !== Number(p.id));
                    removed += 1;
                } catch {
                    // One that failed stays; the count below says how many went.
                }
            }
            this.dash.pageNav?.renderPageNavigation?.();
            this.repaintPtBody();
            this.repaintStructureFoot();
            // The server keeps each deleted page in the trash.
            await this.refreshTrashIfVisible?.();
            this.notify(this.t('config.bmStructureRemovedEmpty', 'Removed {n} empty pages. They are in the trash.')
                .replace('{n}', String(removed)), removed === empty.length ? 'success' : 'error');
        },

        /* ── A row's ⋯ menu ─────────────────────────────────────────────── */

        /** The drag handle at the start of a row; only in the modal. */
        renderStructureGrip() {
            if (!this._structureModal) return '';
            return `<span class="config-structure-grip" data-structure-grip draggable="true"
                        title="${this.dash.escapeHtml(this.t('config.bmStructureDrag', 'Drag to reorder'))}" aria-hidden="true">⋮⋮</span>`;
        },

        openStructureRowMenu(button) {
            this.closeStructureRowMenu();
            const row = button.closest('[data-page-row], [data-cat-row]');
            if (!row) return;
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const isPage = row.hasAttribute('data-page-row');
            const item = (action, label) => `<button type="button" role="menuitem" data-structure-action="${action}">${esc(label)}</button>`;
            const menu = document.createElement('div');
            menu.className = 'config-structure-menu';
            menu.setAttribute('data-structure-menu', '');
            menu.setAttribute('role', 'menu');
            // The row's own buttons, which the modal keeps out of sight to fit
            // two columns on one screen: offered here, and pressed for real,
            // so their confirmations and undo are the editor's own.
            const proxy = (name, selector, label) => {
                const btn = row.querySelector(selector);
                if (!btn || btn.disabled) return '';
                return `<button type="button" role="menuitem" data-structure-proxy="${name}" data-proxy-selector="${esc(selector)}"${
                    name === 'delete' ? ' class="is-danger"' : ''}>${esc(label)}</button>`;
            };
            const spreadOn = row.querySelector('[data-cat-spread]')?.getAttribute('aria-pressed') === 'true';
            menu.innerHTML = isPage
                ? proxy('show', '[data-structure-show]', t('bmStructureShowBookmarks', 'Show its bookmarks'))
                    + item('open-dashboard', t('bmStructureOpenDashboard', 'Open on the dashboard'))
                    + item('move-all', t('bmStructureMoveAll', 'Move all bookmarks to…'))
                    + proxy('duplicate', '[data-page-duplicate]', t('pageDuplicate', 'Duplicate'))
                    + proxy('delete', '[data-page-delete]', t('bmStructureDeletePage', 'Delete page…'))
                : proxy('show', '[data-structure-show]', t('bmStructureShowBookmarks', 'Show its bookmarks'))
                    + proxy('spread', '[data-cat-spread]', spreadOn
                        ? t('bmStructureSpreadOff', 'Stop spreading across columns')
                        : t('categorySpreadLabel', 'Spread across columns'))
                    + item('move-page', t('bmStructureMoveToPage', 'Move to page…'))
                    + item('merge', t('bmStructureMergeInto', 'Merge into…'))
                    + proxy('duplicate', '[data-cat-duplicate]', t('pageDuplicate', 'Duplicate'))
                    + proxy('delete', '[data-cat-delete]', t('bmStructureDeleteCategory', 'Delete category…'));
            this._structureMenuFor = isPage
                ? { kind: 'page', pageId: row.getAttribute('data-page-row') }
                : { kind: 'category', pageId: this._catPageId, categoryId: row.getAttribute('data-cat-id') };
            button.closest('.config-crud-row-actions')?.appendChild(menu);
            button.setAttribute('aria-expanded', 'true');
            menu.querySelector('button')?.focus();
        },

        closeStructureRowMenu() {
            this._structureOverlay?.querySelectorAll('[data-structure-menu]').forEach((m) => m.remove());
            this._structureOverlay?.querySelectorAll('[data-structure-more][aria-expanded="true"]')
                .forEach((b) => b.setAttribute('aria-expanded', 'false'));
        },

        /** An action that needs a target asks for it in the menu itself. */
        runStructureMenuAction(action) {
            const target = this._structureMenuFor;
            const menu = this._structureOverlay?.querySelector('[data-structure-menu]');
            if (!target || !menu) return;
            if (action === 'open-dashboard') {
                const pageId = Number(target.pageId);
                void this.closeStructureModal().then(() => this.dash.requestPageNavigation?.(pageId));
                return;
            }
            const esc = (v) => this.dash.escapeHtml(v);
            let options = [];
            if (action === 'move-all' || action === 'move-page') {
                const from = String(target.pageId);
                options = (this.dash.pages || []).filter((p) => String(p.id) !== from).map((p) => [String(p.id), p.name || String(p.id)]);
            } else if (action === 'merge') {
                options = (this._categories || []).filter((c) => String(c.id) !== String(target.categoryId)).map((c) => [String(c.id), c.name || String(c.id)]);
            }
            target.action = action;
            menu.innerHTML = options.length
                ? `<select class="config-select" data-structure-target>${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
                    <button type="button" class="config-btn config-btn--primary config-btn--small" data-structure-confirm>${esc(
                        this.t(action === 'merge' ? 'config.bmStructureMerge' : 'config.bmStructureMove', action === 'merge' ? 'Merge' : 'Move'))}</button>`
                : `<p class="config-panel-note">${esc(this.t('config.bmStructureNoTarget', 'There is nowhere else to put it.'))}</p>`;
            menu.querySelector('select')?.focus();
        },

        async confirmStructureMenu() {
            const target = this._structureMenuFor;
            const value = this._structureOverlay?.querySelector('[data-structure-target]')?.value;
            this.closeStructureRowMenu();
            if (!target || !value) return;
            if (target.action === 'move-all') await this.moveAllBookmarksOfPage(target.pageId, value);
            else if (target.action === 'move-page') await this.moveCategoryToPage(target.pageId, target.categoryId, value);
            else if (target.action === 'merge') await this.mergeCategoryInto(target.pageId, target.categoryId, value);
            this.repaintPtBody();
            this.repaintStructureFoot();
        },

        bookmarksOfStructure(pageId, categoryId = null) {
            return (this.dash.allBookmarks || []).filter((b) => String(b.pageId) === String(pageId)
                && (categoryId == null || String(b.category || '') === String(categoryId)));
        },

        async moveAllBookmarksOfPage(pageId, toPageId) {
            const picked = this.bookmarksOfStructure(pageId);
            if (!picked.length) return;
            await this.bulkMove(picked, { pageId: toPageId });
            await this.dash.loadAllBookmarks?.();
        },

        /**
         * A category and its bookmarks, to another page: the category is made
         * there under its own name (a new id when that page already uses this
         * one for something else), the bookmarks follow, and the category
         * leaves the page it was on.
         */
        async moveCategoryToPage(pageId, categoryId, toPageId) {
            const source = (this._categories || []).find((c) => String(c.id) === String(categoryId));
            if (!source) return;
            let id = String(categoryId);
            try {
                const res = await fetch(`/api/categories?page=${encodeURIComponent(toPageId)}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const list = await res.json();
                const clash = list.find((c) => String(c.id) === id);
                if (clash && global.DashboardConfig.nameKey(clash.name) !== global.DashboardConfig.nameKey(source.name)) id = `${id}-${Date.now().toString(36)}`;
                if (!list.some((c) => String(c.id) === id)) {
                    const save = await this.writeFetch(`/api/categories?page=${encodeURIComponent(toPageId)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([...list, { ...source, id }]),
                    });
                    if (!save.ok) throw new Error(`HTTP ${save.status}`);
                }
                this.invalidateBookmarkCategoriesCache?.(toPageId);
            } catch {
                this.notify(this.t('config.categoriesSaveError', 'Could not save categories.'), 'error');
                return;
            }
            const picked = this.bookmarksOfStructure(pageId, categoryId);
            // The category goes only when every bookmark went with it: a row the
            // target refused (already there) or a failed move stayed behind
            // pointing at a category that no longer existed.
            const result = picked.length ? await this.bulkMove(picked, { pageId: toPageId, category: id }) : { skipped: [] };
            if (!result || result.skipped.length) {
                await this.dash.loadAllBookmarks?.();
                return;
            }
            this._categories = (this._categories || []).filter((c) => String(c.id) !== String(categoryId));
            await this.saveCategories(pageId);
            await this.dash.loadAllBookmarks?.();
        },

        /** A category's bookmarks into another on the same page, and the first one gone. */
        async mergeCategoryInto(pageId, categoryId, intoId) {
            const from = (this._categories || []).find((c) => String(c.id) === String(categoryId));
            const into = (this._categories || []).find((c) => String(c.id) === String(intoId));
            if (!from || !into) return;
            const picked = this.bookmarksOfStructure(pageId, categoryId);
            const ok = await this.confirmAction(this.t('config.bmStructureMergeConfirm',
                'Move the {n} bookmarks of “{from}” into “{into}”, and remove “{from}”?')
                .replace('{n}', String(picked.length)).replaceAll('{from}', String(from.name || from.id)).replace('{into}', String(into.name || into.id)),
            { confirmLabel: this.t('config.bmStructureMerge', 'Merge') });
            if (!ok) return;
            if (picked.length) {
                const undo = await this.mutateSelected(picked, (b) => ({ ...b, category: String(intoId) }));
                // A page that refused keeps its rows in this category, so it stays.
                if (undo?.failed) {
                    await this.dash.loadAllBookmarks?.();
                    return;
                }
            }
            this._categories = (this._categories || []).filter((c) => String(c.id) !== String(categoryId));
            await this.saveCategories(pageId);
            await this.dash.loadAllBookmarks?.();
        },

        /* ── Drag to reorder ────────────────────────────────────────────── */

        /**
         * Rows move by their grip. Pages reorder the page list; categories and
         * the widgets between them reorder the page's blockOrder, the one list
         * the dashboard draws from -- the same write the ↑ ↓ buttons make.
         */
        bindStructureDrag(overlay) {
            let dragged = null;
            const rowOf = (el) => el?.closest?.('[data-page-row], [data-cat-row], [data-block-row]');
            overlay.addEventListener('dragstart', (e) => {
                const grip = e.target.closest?.('[data-structure-grip]');
                if (!grip) return;
                dragged = rowOf(grip);
                if (!dragged) return;
                dragged.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', 'row');
            });
            overlay.addEventListener('dragover', (e) => {
                const row = rowOf(e.target);
                if (!dragged || !row || row === dragged) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            overlay.addEventListener('dragend', () => {
                dragged?.classList.remove('is-dragging');
                dragged = null;
            });
            overlay.addEventListener('drop', (e) => {
                const row = rowOf(e.target);
                const source = dragged;
                dragged?.classList.remove('is-dragging');
                dragged = null;
                if (!source || !row || row === source) return;
                e.preventDefault();
                const box = row.getBoundingClientRect();
                const after = e.clientY > box.top + box.height / 2;
                if (source.hasAttribute('data-page-row')) {
                    this.reorderPages(source.getAttribute('data-page-row'), row.getAttribute('data-page-row'), after);
                } else {
                    const id = (el) => el.getAttribute('data-cat-id') || el.getAttribute('data-block-row');
                    void this.reorderCategoryBlocks(id(source), id(row), after);
                }
            });
        },

        reorderPages(id, targetId, after) {
            const pages = this.dash.pages || [];
            const from = pages.findIndex((p) => String(p.id) === String(id));
            if (from < 0 || !targetId) return;
            const [moved] = pages.splice(from, 1);
            let to = pages.findIndex((p) => String(p.id) === String(targetId));
            if (to < 0) {
                pages.splice(from, 0, moved);
                return;
            }
            if (after) to += 1;
            pages.splice(to, 0, moved);
            void this.savePages();
            this.repaintPtBody();
        },

        async reorderCategoryBlocks(id, targetId, after) {
            const order = [...(this._catBlockOrder || [])].map(String);
            const from = order.indexOf(String(id));
            if (from < 0 || !targetId) return;
            order.splice(from, 1);
            let to = order.indexOf(String(targetId));
            if (to < 0) return;
            if (after) to += 1;
            order.splice(to, 0, String(id));
            this._catBlockOrder = order;
            this.repaintPtBody();
            try {
                const res = await this.writeFetch(`/api/pages/${this._catPageId}/blocks`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order }),
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
            } catch {
                this.notify(this.t('config.categoriesOrderError', 'Could not save the order.'), 'error');
                return;
            }
            await this.refreshDashboardBlocks?.();
        },

        /** Show: the list, filtered to that page or category, and the modal out of the way. */
        showFromStructureModal(button) {
            const pageId = button.getAttribute('data-structure-page');
            const categoryId = button.getAttribute('data-structure-category');
            void this.closeStructureModal().then(() => {
                if (categoryId) {
                    const key = global.DashboardConfig.categoryFilterKey(pageId, categoryId);
                    if (this.bmCategoryFilter !== key) this.toggleRailFilter('category', key);
                } else if (pageId && String(this.bmPageFilter || '') !== String(pageId)) {
                    this.toggleRailFilter('page', String(pageId));
                }
            });
        },

        /**
         * Close, and bring the list up to what was changed in there: a deleted
         * page took its bookmarks, a renamed category is a new label in the rail.
         */
        async closeStructureModal() {
            const overlay = this._structureOverlay;
            if (!overlay) return;
            document.removeEventListener('keydown', this._structureKeys, true);
            this._structureKeys = null;
            this._structureOverlay = null;
            this._structureModal = false;
            overlay.remove();
            this.ptTab = this._structurePrevTab || this.ptTab;
            await this.dash.loadAllBookmarks?.();
            // Renamed, added or removed categories: fetched again, not remembered.
            this._bmCategoriesCache?.clear?.();
            void this.prefetchAllBookmarkCategories?.();
            this.invalidateVisibleBookmarks?.();
            if (this.isActiveView() && this.section === 'bookmarks') this.render();
        },

        /**
         * What a row adds in the modal: its broken count and Show. Empty in
         * Structure, where a Show that leaves the section would be a surprise.
         */
        renderStructureRowExtras({ pageId, categoryId = null }) {
            if (!this._structureModal) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const issues = this._bmHealthModule?.report?.issues || [];
            const broken = issues.filter((issue) => issue.status === 'broken'
                && String(issue.pageId) === String(pageId)
                && (categoryId == null || String(issue.category || '') === String(categoryId))).length;
            const more = `<button type="button" class="config-btn config-btn--small" data-structure-more aria-haspopup="menu" aria-expanded="false"
                        aria-label="${esc(this.t('config.bmMoreActions', 'More actions'))}">⋯</button>`;
            return `${more}${broken ? `<span class="config-structure-broken" data-structure-health>${esc(
                this.t('config.bmStructureBroken', '{n} broken').replace('{n}', String(broken)))}</span>` : ''}
                <button type="button" class="config-btn config-btn--small" data-structure-show
                        data-structure-page="${esc(pageId)}"${categoryId != null ? ` data-structure-category="${esc(categoryId)}"` : ''}>${esc(
                    this.t('config.bmStructureShow', 'Show'))}</button>`;
        },
    });

    global.DashboardBookmarksStructureModalReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
