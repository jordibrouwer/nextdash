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
                        <button type="button" class="config-structure-close" data-structure-close
                                aria-label="${esc(this.t('config.bmCloseDetails', 'Close'))}">×</button>
                    </div>
                    <div class="config-subtabs" role="tablist">${tabs}</div>
                    <div class="config-structure-body" data-pt-host>
                        <div id="config-pt-body" role="tabpanel" tabindex="0">${this.renderPtTab()}</div>
                    </div>
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
                if (show) this.showFromStructureModal(show);
            });
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
                this.ptTab = tab;
                this.repaintPtBody();
            }
            this.syncSubTabStrip('data-pt-tab', tab);
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
            return `${broken ? `<span class="config-structure-broken" data-structure-health>${esc(
                this.t('config.bmStructureBroken', '{n} broken').replace('{n}', String(broken)))}</span>` : ''}
                <button type="button" class="config-btn config-btn--small" data-structure-show
                        data-structure-page="${esc(pageId)}"${categoryId != null ? ` data-structure-category="${esc(categoryId)}"` : ''}>${esc(
                    this.t('config.bmStructureShow', 'Show'))}</button>`;
        },
    });

    global.DashboardBookmarksStructureModalReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
