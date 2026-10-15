/**
 * The tag view: one tag's bookmarks, from every page, in a view of its own.
 *
 * It replaced the grid's tag-filter mode, which drew the matches into the
 * dashboard under a row of buttons. Here the tag gets the chrome the other
 * list views have (list-view-shell): a header with what the set adds up to,
 * a rail of related tags, pages and health, and a table. #tag/<tag> is its
 * address; Escape, the home icon and Back return to the page it came from.
 *
 * With no tag picked (#tags, Shift+T with no row in hand) it holds every
 * bookmark: the rail lists the tags in use and those without any, so tagging
 * starts here and a tag is one click away.
 *
 * d._tagFilters stays the list of active tags, so what reads it -- the
 * cloud's +N, hasActiveTagFilters -- keeps working; setTagFilters is the one
 * way in and opens or updates this view.
 */
(function () {
    'use strict';

    const VIEW = 'tags';
    const Model = () => window.TagViewModel;

    class DashboardTagView {
        constructor(dashboard) {
            this.dash = dashboard;
            this.tags = [];
            // Every bookmark rather than a tag's: #tags.
            this.all = false;
            this.returnPageId = null;
            this.shell = null;
            this._keyHandler = null;
            // What the rail and the search narrow the list to. A new set of
            // tags starts them over.
            this.filter = { page: null, health: null, untagged: false };
            this.query = '';
            this._relatedOpen = false;
            this.sort = { key: 'lastOpened', dir: null };
            this.focusIndex = -1;
            this.rows = [];
            // Ticked rows, by page, URL and name: an index would point at
            // another row after the next sort or filter.
            this.selected = new Set();
            this._anchorIndex = -1;
            this.drawer = null;
        }

        t(key, fallback) {
            const v = this.dash?.language?.t?.(key);
            return v && v !== key ? v : fallback;
        }

        isActiveView() {
            return this.dash.activeView === VIEW;
        }

        normalize(tags) {
            const d = this.dash;
            return d.normalizeTagFilters ? d.normalizeTagFilters(tags) : [...new Set((tags || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean))].sort();
        }

        pool() {
            return window.DashboardTagCloud?.getBookmarkPool?.() || this.dash.bookmarks || [];
        }

        /** The tags' bookmarks, before the rail and the search narrow them. */
        matches() {
            return this.all ? Model().everything(this.pool()) : Model().matches(this.pool(), this.tags);
        }

        setTags(tags) {
            const next = this.normalize(tags);
            if (next.join('\u0000') !== this.tags.join('\u0000')) {
                this.filter = { page: null, health: null, untagged: false };
                this.query = '';
                this._relatedOpen = false;
                this.selected = new Set();
                this.focusIndex = -1;
                this.drawer?.close?.({ silent: true });
            }
            this.tags = next;
            this.dash._tagFilters = [...this.tags];
            this.dash.tagFilter?._syncTagFilterDomAttributes?.();
            window.DashboardTagCloud?.setActiveTags?.(this.tags);
        }

        /** The address for the current tags; pushed when the view opens, replaced on a change. */
        writeHash({ push }) {
            const hash = Model().hashFor(this.all ? [] : this.tags);
            if (window.location.hash === hash) return;
            const url = `${window.location.pathname}${window.location.search}${hash}`;
            if (push && window.DashboardHistory?.pushLocation?.(url)) return;
            history.replaceState(history.state, '', url);
        }

        async openTagView(tags, { returnPageId = null, fromHash = false, all = false } = {}) {
            const d = this.dash;
            const next = all ? [] : this.normalize(tags);
            if (!next.length && !all) return false;
            if (this.isActiveView()) {
                if (all) return this.showAll({ fromHash });
                return this.updateTags(next, { fromHash });
            }
            if (d.isInlineEditActive?.() && !(await d.confirmInlineEditBeforeNavigation?.())) {
                return false;
            }
            d._abortInlineEditForRender?.();
            d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
            d.multiSelect?.clear?.();
            this.returnPageId = Number(returnPageId ?? d.currentPageId);
            d.setActiveView(VIEW);
            window.nextdashTrack?.('view:tags');
            // The header names the view, the page tabs keep the page it came from.
            d.pageNav?.setActivePageNavButton?.(d.currentPageId);
            d.pageNav?.updatePageTitle?.();
            d.updateDocumentTitle?.();
            this.all = all;
            this.setTags(next);
            if (!fromHash) this.writeHash({ push: true });
            this.render();
            window.scrollTo({ top: 0, behavior: 'instant' });
            // The view is where the reader is now; the keys start here.
            if (!window.DashboardTagCloud?.modalOpen) {
                document.getElementById('dashboard-layout')?.focus?.({ preventScroll: true });
            }
            // Startup skips other pages when nothing asks for them; the view
            // does. DashboardTagCloud redraws the open view when they land.
            window.DashboardTagCloud?.ensureEveryPageLoaded?.();
            void this.ensureHealth();
            return true;
        }

        updateTags(tags, { fromHash = false } = {}) {
            const next = this.normalize(tags);
            if (!next.length) {
                this.closeTagView();
                return false;
            }
            // A tag picked from every bookmark is a step in: Back returns to #tags.
            const fromAll = this.all;
            this.all = false;
            this.setTags(next);
            if (!fromHash) this.writeHash({ push: fromAll });
            this.render();
            return true;
        }

        /** From a tag back to every bookmark, while the view is open. */
        showAll({ fromHash = false } = {}) {
            if (this.all) return true;
            this.all = true;
            this.setTags([]);
            this.filter = { page: null, health: null, untagged: false };
            this.query = '';
            this.selected = new Set();
            this.focusIndex = -1;
            if (!fromHash) this.writeHash({ push: false });
            this.render();
            return true;
        }

        closeTagView() {
            const d = this.dash;
            if (!this.isActiveView()) return false;
            const back = this.returnPageId ?? d.currentPageId;
            this.onLeave();
            const restored = d.pageNav?.requestPageNavigation
                ? d.pageNav.requestPageNavigation(back)
                : d.pageNav?.restoreBookmarksViewForPage?.(back);
            d.keyboardNavigation?.scheduleUpdate?.();
            return restored;
        }

        /**
         * The view arrives: header first, then the rows one after another,
         * and then it holds still. Once per opening -- a redraw after a filter
         * or a keystroke is not an arrival.
         */
        /** Another view, or the grid, took the layout: the tags go with the view. */
        onLeave() {
            this.drawer?.destroy?.();
            this.drawer = null;
            this.selected = new Set();
            this.focusIndex = -1;
            this.shell?.destroy?.();
            this.shell = null;
            const container = document.getElementById('dashboard-layout');
            container?.classList.remove('tag-view-layout');
            this.tags = [];
            this.all = false;
            this.dash._tagFilters = [];
            this.dash.tagFilter?._syncTagFilterDomAttributes?.();
            window.DashboardTagCloud?.setActiveTags?.([]);
        }

        mountShell() {
            const container = document.getElementById('dashboard-layout');
            if (!container || typeof window.ListViewShell === 'undefined') return null;
            if (this.shell && container.contains(this.shell.root)) return this.shell;
            this.shell?.destroy?.();
            container.innerHTML = '';
            container.className = 'tag-view-layout';
            ['aria-colcount', 'aria-rowcount', 'role', 'aria-label', 'data-i18n-aria']
                .forEach((name) => container.removeAttribute(name));
            container.tabIndex = -1;
            this.shell = window.ListViewShell.mount(container, {
                id: 'tags',
                title: '',
                t: (key, fallback) => this.t(key, fallback),
            });
            this.shell.root.classList.add('tag-view');
            this.buildToolbar(this.shell.toolbar);
            if (!this.drawer && typeof window.ListViewDrawer === 'function') {
                this.drawer = new window.ListViewDrawer({
                    id: 'tag-view',
                    storageKey: 'nextdash:tag-view-drawer-sections',
                    defaultSections: ['details', 'tags', 'health'],
                    closeLabel: this.t('dashboard.tagViewPanelClose', 'Close'),
                    closeOnOutside: (target) => !target.closest?.('.tag-view-row'),
                });
                this.drawer.mount();
            }
            return this.shell;
        }

        render() {
            if (!this.isActiveView()) return;
            const shell = this.mountShell();
            if (!shell) return;
            const matches = this.matches();
            const shown = this.shown(matches);
            this.ensureSuggestionSources(matches);
            this.renderHeader(shell, matches, shown);
            this.renderRail(shell, matches);
            this.updateCount(shown.length, matches.length);
            if (!matches.length) {
                shell.body.replaceChildren(this.buildEmpty());
                return;
            }
            if (!shown.length) {
                shell.body.replaceChildren(this.buildNoMatch(), this.buildLegend());
                return;
            }
            this.rows = Model().sort(shown, this.sort.key, this.sort.dir);
            if (this.focusIndex >= this.rows.length) this.focusIndex = this.rows.length - 1;
            const table = this.el('div', 'tag-view-table');
            table.style.setProperty('--tag-view-rows', String(this.rows.length));
            table.setAttribute('role', 'grid');
            table.appendChild(this.buildColHead());
            this.rows.forEach((b, i) => table.appendChild(this.buildRow(b, i)));
            // A tick on a row the filters now hide is dropped: the bar acts on
            // what the reader can see.
            const visible = new Set(this.rows.map((b) => this.keyOf(b)));
            [...this.selected].forEach((key) => { if (!visible.has(key)) this.selected.delete(key); });
            shell.body.replaceChildren(this.buildSelectionBar(), table, this.buildLegend());
            this.fitRowTags(table);
        }

        /* ── Toolbar ─────────────────────────────────────────────────────── */

        static SORTS = [
            ['lastOpened', 'dashboard.tagViewSortLast', 'Last opened'],
            ['name', 'dashboard.tagViewSortName', 'Name'],
            ['opens', 'dashboard.tagViewSortOpens', 'Opens'],
            ['page', 'dashboard.tagViewSortPage', 'Page'],
        ];

        /** Built once per shell: the search box keeps its focus while the list redraws. */
        buildToolbar(host) {
            const search = this.el('input', 'tag-view-search');
            search.type = 'search';
            search.setAttribute('data-tag-view-search', '');
            search.placeholder = this.t('dashboard.tagViewSearch', 'Search in these bookmarks…');
            search.setAttribute('aria-label', search.placeholder);
            search.addEventListener('input', () => {
                this.query = search.value;
                this.focusIndex = -1;
                this.render();
            });
            search.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (search.value) {
                        search.value = '';
                        this.query = '';
                        this.render();
                    } else {
                        search.blur();
                    }
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    e.preventDefault();
                    search.blur();
                    this.moveFocus(this.focusIndex < 0 ? 0 : this.focusIndex);
                }
            });
            const count = this.el('span', 'tag-view-count');
            const sort = this.el('select', 'tag-view-sort');
            sort.setAttribute('data-tag-view-sort', '');
            sort.setAttribute('aria-label', this.t('dashboard.tagViewSortLabel', 'Sort'));
            DashboardTagView.SORTS.forEach(([key, labelKey, fallback]) => {
                const opt = this.el('option', '', this.t(labelKey, fallback));
                opt.value = key;
                sort.appendChild(opt);
            });
            sort.addEventListener('change', () => {
                this.sort = { key: sort.value, dir: null };
                this.render();
            });
            host.replaceChildren(search, count, sort);
            this.searchEl = search;
            this.countEl = count;
            this.sortEl = sort;
        }

        updateCount(shown, total) {
            if (this.countEl) {
                this.countEl.textContent = this.t('dashboard.tagViewCount', '{shown} of {total}')
                    .replace('{shown}', String(shown)).replace('{total}', String(total));
            }
            if (this.searchEl && this.searchEl.value !== this.query) this.searchEl.value = this.query;
            if (this.sortEl) this.sortEl.value = this.sort.key;
        }

        /* ── Table ───────────────────────────────────────────────────────── */

        static COLUMNS = [
            ['check', '', '', null],
            ['name', 'dashboard.tagViewColName', 'Name', 'name'],
            ['tags', 'dashboard.tagViewColTags', 'Other tags', null],
            ['page', 'dashboard.tagViewColPage', 'Page', 'page'],
            ['opens', 'dashboard.tagViewColOpens', 'Opens', 'opens'],
            ['last', 'dashboard.tagViewColLast', 'Last opened', 'lastOpened'],
            ['score', 'dashboard.tagViewColScore', 'Score', null],
        ];

        buildColHead() {
            const head = this.el('div', 'tag-view-colhead');
            head.setAttribute('role', 'row');
            DashboardTagView.COLUMNS.forEach(([key, labelKey, fallback, sortKey]) => {
                const cell = this.el(sortKey ? 'button' : 'span', `tag-view-col tag-view-col--${key}`);
                cell.setAttribute('role', 'columnheader');
                if (key === 'check') {
                    cell.appendChild(this.buildCheckAll());
                } else if (key === 'tags' && this.all) {
                    cell.appendChild(this.el('span', '', this.t('dashboard.tagViewColAllTags', 'Tags')));
                } else {
                    cell.appendChild(this.el('span', '', this.t(labelKey, fallback)));
                }
                if (sortKey) {
                    cell.type = 'button';
                    cell.setAttribute('data-sort', sortKey);
                    const on = this.sort.key === sortKey;
                    const dir = this.sort.dir || (sortKey === 'name' || sortKey === 'page' ? 'asc' : 'desc');
                    cell.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
                    if (on) cell.appendChild(this.el('span', 'tag-view-col-arrow', dir === 'asc' ? '↑' : '↓'));
                    cell.addEventListener('click', () => {
                        if (this.sort.key === sortKey) {
                            this.sort = { key: sortKey, dir: dir === 'asc' ? 'desc' : 'asc' };
                        } else {
                            this.sort = { key: sortKey, dir: null };
                        }
                        this.render();
                    });
                }
                head.appendChild(cell);
            });
            return head;
        }

        /** Everything the list shows, or nothing. */
        buildCheckAll() {
            const btn = this.el('button', 'tag-view-check-all');
            btn.type = 'button';
            const all = this.rows.length > 0 && this.rows.every((b) => this.selected.has(this.keyOf(b)));
            const some = !all && this.rows.some((b) => this.selected.has(this.keyOf(b)));
            btn.setAttribute('role', 'checkbox');
            btn.setAttribute('aria-checked', all ? 'true' : some ? 'mixed' : 'false');
            btn.setAttribute('aria-label', this.t('dashboard.tagViewSelectAll', 'Select all shown'));
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selected = all ? new Set() : new Set(this.rows.map((b) => this.keyOf(b)));
                this.render();
            });
            return btn;
        }

        buildRow(b, index) {
            const d = this.dash;
            const row = this.el('div', 'tag-view-row');
            row.setAttribute('role', 'row');
            row.dataset.index = String(index);
            row.style.setProperty('--row-index', String(Math.min(index, 14)));
            row.classList.toggle('is-focused', index === this.focusIndex);
            row.classList.toggle('is-selected', this.selected.has(this.keyOf(b)));

            const check = this.el('span', 'tag-view-cell tag-view-cell--check');
            check.appendChild(this.buildRowCheck(b, index));

            const nameCell = this.el('span', 'tag-view-cell tag-view-cell--name');
            const icon = this.buildRowIcon(b);
            const link = this.el('a', 'tag-view-open');
            link.href = d.safeBookmarkOpenHref?.(b.url) || '#';
            if (d.settings?.openInNewTab) {
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
            }
            link.appendChild(this.el('span', 'tag-view-name', b.name || b.url || ''));
            link.addEventListener('click', (e) => this.onRowLinkClick(e, b, index, link));
            let hostName = '';
            try { hostName = new URL(b.url).host; } catch { /* a URL that does not parse shows none */ }
            nameCell.append(icon, link, this.el('span', 'tag-view-host', hostName));

            const tagsCell = this.el('span', 'tag-view-cell tag-view-tags');
            (b.tags || []).map((t) => String(t || '').trim().toLowerCase()).filter((t) => t && !this.tags.includes(t))
                .forEach((tag) => {
                    const chip = this.el('button', 'tag-view-chip', tag);
                    chip.type = 'button';
                    chip.dataset.tag = tag;
                    chip.title = this.t('dashboard.tagViewRelatedHint', 'Click to switch, Shift+click to add');
                    chip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        void this.dash.setTagFilters(e.shiftKey ? [...this.tags, tag] : [tag]);
                    });
                    tagsCell.appendChild(chip);
                });
            // As the Bookmarks view and the inbox draw it (TagOfferRow): the
            // row's tags, `+n` for those that do not fit, the best offer, and
            // `+N` for the others; fitRowTags decides once the row has a width.
            if (tagsCell.childElementCount) tagsCell.appendChild(this.el('span', 'tag-view-chip tag-view-chip--more'));
            const offers = this.suggestionsFor(b, Infinity);
            const kit = window.TagOfferRow;
            if (offers.length && kit) {
                const esc = (v) => this.dash.escapeHtml?.(v) ?? String(v);
                const opts = { esc, t: (key, fallback) => this.t(key, fallback), data: 'tv' };
                tagsCell.insertAdjacentHTML('beforeend', kit.chipHtml(offers[0], { ...opts, className: 'tag-view-offer' })
                    + kit.moreHtml(offers.length, opts));
            }

            const pageId = Number(b.pageId ?? b.pageID) || Number(d.currentPageId);
            const page = this.el('span', 'tag-view-cell tag-view-page', this.pageName(pageId));
            const opens = this.el('span', 'tag-view-cell tag-view-opens', String(Number(b.openCount) || 0));
            const lastLabel = b.lastOpened
                ? (this.lastOpenedLabel(b.lastOpened))
                : this.t('dashboard.tagViewNever', 'never');
            const last = this.el('span', 'tag-view-cell tag-view-last', lastLabel);
            const scoreCell = this.el('span', 'tag-view-cell tag-view-score');
            const score = this.scoreOf(b);
            if (score !== null) {
                const badge = this.el('span', `tag-view-score-badge is-${score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad'}`, String(score));
                scoreCell.appendChild(badge);
            }
            row.append(check, nameCell, tagsCell, page, opens, last, scoreCell);
            row.addEventListener('click', (e) => this.onRowClick(e, index));
            row.addEventListener('contextmenu', (e) => this.openRowMenu(e, index));
            return row;
        }

        /**
         * The bookmark's favicon, as the grid draws it (dashboard-bookmark-rows.js):
         * its own file from /data/icons/, the letter when that will not load,
         * and for a bookmark without one the letter the icon sets may swap.
         */
        buildRowIcon(b) {
            const d = this.dash;
            const icon = this.el('span', 'tag-view-icon');
            icon.setAttribute('aria-hidden', 'true');
            const letter = () => String(b.name || b.url || '?').trim().charAt(0).toUpperCase() || '?';
            const styling = window.ThemeIconStyling?.getThemeIconStylingEntry?.(d.settings);
            const style = () => {
                if (styling?.enabled) window.ThemeIconStyling.applyThemeIconStylingToElement(icon, styling);
            };
            if (b.icon) {
                const img = document.createElement('img');
                img.className = 'tag-view-icon-img';
                img.src = /^(https?:|data:|\/)/i.test(String(b.icon)) ? b.icon : `/data/icons/${encodeURIComponent(b.icon)}`;
                img.alt = '';
                img.loading = 'lazy';
                img.decoding = 'async';
                img.draggable = false;
                img.addEventListener('error', () => {
                    img.replaceWith(this.el('span', 'tag-view-icon-letter', letter()));
                });
                icon.appendChild(img);
                style();
                return icon;
            }
            // Inside the box rather than the box itself: the icon sets replace
            // the element they are handed with their image.
            const mark = this.el('span', 'tag-view-icon-letter', letter());
            icon.appendChild(mark);
            if (b.url && window.IconSetAuto && b.iconMode !== 'letter') {
                mark.setAttribute('data-icon-auto-url', b.url);
                window.IconSetAuto.queue(mark);
                style();
            }
            return icon;
        }

        buildRowCheck(b, index) {
            const btn = this.el('button', 'tag-view-check');
            btn.type = 'button';
            const on = this.selected.has(this.keyOf(b));
            btn.setAttribute('role', 'checkbox');
            btn.setAttribute('aria-checked', String(on));
            btn.setAttribute('aria-label', this.t('dashboard.tagViewSelectRow', 'Select {name}').replace('{name}', b.name || b.url || ''));
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSelected(index);
            });
            return btn;
        }

        keyOf(b) {
            const pageId = Number(b?.pageId ?? b?.pageID) || Number(this.dash.currentPageId);
            return `${pageId}\u0000${String(b?.url || '').trim()}\u0000${String(b?.name || '').trim()}`;
        }

        toggleSelected(index) {
            const b = this.rows[index];
            if (!b) return;
            const key = this.keyOf(b);
            if (this.selected.has(key)) this.selected.delete(key);
            else this.selected.add(key);
            this._anchorIndex = index;
            this.focusIndex = index;
            this.render();
        }

        /** Shift+click: from the last ticked row to this one, all ticked. */
        selectRange(index) {
            const from = this._anchorIndex >= 0 ? this._anchorIndex : (this.focusIndex >= 0 ? this.focusIndex : index);
            const [a, z] = from <= index ? [from, index] : [index, from];
            for (let i = a; i <= z; i += 1) {
                if (this.rows[i]) this.selected.add(this.keyOf(this.rows[i]));
            }
            this._anchorIndex = index;
            this.focusIndex = index;
            this.render();
        }

        selectedBookmarks() {
            return this.rows.filter((b) => this.selected.has(this.keyOf(b)));
        }

        selectedRefs() {
            return this.selectedBookmarks()
                .map((b) => this.dash.resolveBookmarkReference?.(b))
                .filter(Boolean);
        }

        /* ── The dashboard's row actions ─────────────────────────────────── */

        /**
         * The Shift keys the dashboard grid answers on a bookmark row, by the
         * context menu action each one runs there. e.code, like the grid, so
         * the letter holds on any layout.
         */
        static ROW_KEYS = {
            KeyE: 'edit',
            KeyP: 'pin',
            KeyT: 'tags',
            KeyM: 'move',
            KeyD: 'delete',
            KeyC: 'check-mode',
            KeyR: 'health',
            KeyL: 'share',
            KeyJ: 'qr',
        };

        /**
         * What the menu and its popovers hang off: the row's name, not the
         * row. A row spans the table, so nothing fits beside it and the
         * popovers fell back to the window's corner.
         */
        rowElement(index) {
            const row = this.shell?.body.querySelectorAll('.tag-view-row')[index];
            return row?.querySelector('a.tag-view-open') || row || null;
        }

        /** The row's bookmark as the context menu wants it, or null. */
        rowRef(index) {
            const b = this.rows[index];
            return b ? this.dash.resolveBookmarkReference?.(b) || null : null;
        }

        /**
         * The dashboard's own right-click menu on a row, not a copy of it:
         * the module the grid loads, given the bookmark this row stands for.
         * Shift+right-click still gets the browser's menu, as in the grid.
         */
        openRowMenu(e, index) {
            const d = this.dash;
            if (e.shiftKey || d.uiHelpers?.isModalOpen?.()) return;
            const row = this.rowElement(index);
            const ref = this.rowRef(index);
            if (!row || !ref) return;
            e.preventDefault();
            e.stopPropagation();
            this.moveFocus(index);
            void d.contextMenu?.load?.()
                .then((menu) => menu.show(row, ref, menu.menuPointFor(e, row)))
                .catch(() => {});
        }

        /** One of the menu's actions on a row, for the keys that name them. */
        runRowAction(action, index = this.focusIndex) {
            const row = this.rowElement(index);
            const ref = this.rowRef(index);
            if (!row || !ref) return;
            void this.dash.contextMenu?.load?.()
                .then((menu) => menu.runAction(action, row, ref))
                .catch(() => {});
        }

        /* ── Tag suggestions ───────────────────────────────────────────── */

        /**
         * What is on offer for a row: the engine's answer, as the Tags popover
         * and the Tag suggestions tab give it, minus what the row already has.
         * Local only -- the catalogue in memory, your rules, your other tags
         * and pages already read. Find tags is what asks further.
         */
        suggestionsFor(b, limit = 3) {
            const live = window.TagSuggestLive;
            if (!b || typeof live?.forDashBookmark !== 'function') return [];
            const have = new Set((b.tags || []).map((tag) => String(tag || '').trim().toLowerCase()));
            const seen = new Set();
            return live.forDashBookmark(this.dash, b).filter((offer) => {
                const tag = String(offer?.tag || '').toLowerCase();
                if (!tag || have.has(tag) || seen.has(tag)) return false;
                seen.add(tag);
                return true;
            }).slice(0, limit);
        }

        /** The row's Tags cells fitted, and the offers in them wired (TagOfferRow). */
        fitRowTags(table) {
            const kit = window.TagOfferRow;
            if (!kit || !table) return;
            const refit = () => kit.fit([...table.querySelectorAll('.tag-view-row .tag-view-tags')],
                { tag: '.tag-view-chip', more: '.tag-view-chip--more' });
            refit();
            this._tagFitObserver?.disconnect();
            this._tagFitObserver = kit.observe(table, refit);
            table.addEventListener('click', (e) => {
                const add = e.target.closest('[data-tv-offer-add]');
                const refuse = e.target.closest('[data-tv-offer-refuse]');
                const more = e.target.closest('[data-tv-offers-more]');
                if (!add && !refuse && !more) return;
                e.preventDefault();
                e.stopPropagation();
                const b = this.rows[Number(e.target.closest('.tag-view-row')?.dataset.index)];
                const offers = b ? this.suggestionsFor(b, Infinity) : [];
                if (!offers.length) return;
                if (more) {
                    kit.openPopover(more, offers, {
                        t: (key, fallback) => this.t(key, fallback),
                        onAdd: (offer) => void this.addSuggestions([[b, [offer]]]),
                        onRefuse: (offer) => void this.refuseSuggestion(offer),
                    });
                } else if (add) {
                    void this.addSuggestions([[b, [offers[0]]]]);
                } else {
                    void this.refuseSuggestion(offers[0]);
                }
            }, true);
        }

        /**
         * The catalogue's answer for these sites and the words read from
         * their pages, fetched once per set of bookmarks. No online lookup:
         * opening a view is not a search the reader started.
         */
        ensureSuggestionSources(matches) {
            const live = window.TagSuggestLive;
            if (!live?.ensureCatalogue) return;
            // A quiet lookup (TagCatalogue.autoLookup) lands after the view is
            // drawn; the offers are redrawn when it does.
            if (!this._catalogueListening && window.TagCatalogue?.onChange) {
                this._catalogueListening = true;
                window.TagCatalogue.onChange(() => {
                    live.invalidate?.();
                    const typing = document.activeElement?.matches?.('input, textarea, [contenteditable="true"]');
                    if (this.isActiveView() && !typing) this.render();
                }, { wait: 250 });
            }
            const urls = matches.map((b) => b.url).filter(Boolean);
            const signature = urls.slice().sort().join('\n');
            if (this._suggestSignature === signature) return;
            this._suggestSignature = signature;
            void Promise.all([
                live.ensureCatalogue(urls, { lookup: false, overlay: false }),
                live.storedKeywords?.(),
            ]).then(() => {
                live.invalidate?.();
                if (this.isActiveView()) this.render();
            }).catch(() => {});
        }

        sourceOf(offer) {
            const kind = offer?.reason?.kind;
            if (kind === 'app') return String(offer.reason.app || '');
            if (kind === 'online') return this.t('dashboard.tagSourceOnline', 'Wikidata');
            if (kind === 'catalogue') return this.t('dashboard.tagSourceCatalogue', 'catalogue');
            if (kind === 'text') return this.t('dashboard.tagSourcePage', 'the page');
            if (kind === 'rule') return this.t('dashboard.tagSourceRule', 'your rule');
            return this.t('dashboard.tagSourceYours', 'your tags');
        }

        /** A suggestion in a row: click adds it, × turns it down for good. */
        buildOfferChip(b, offer) {
            const wrap = this.el('span', 'tag-view-offer');
            wrap.dataset.offer = offer.tag;
            const add = this.el('button', 'tag-view-chip tag-view-chip--offer');
            add.type = 'button';
            add.append(document.createTextNode(`+ ${offer.tag}`), this.el('span', 'tag-view-offer-source', this.sourceOf(offer)));
            add.title = this.t('dashboard.tagViewOfferAdd', 'Add #{tag}').replace('{tag}', offer.tag);
            add.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.addSuggestions([[b, [offer]]]);
            });
            const no = this.el('button', 'tag-view-offer-refuse', '×');
            no.type = 'button';
            no.setAttribute('aria-label', this.t('dashboard.tagViewOfferRefuse', 'Turn down #{tag}').replace('{tag}', offer.tag));
            no.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.refuseSuggestion(offer);
            });
            wrap.append(add, no);
            return wrap;
        }

        /** "5 tag suggestions · Add all", beside the stats; nothing when none. */
        buildOfferCount(shown) {
            const pairs = shown.map((b) => [b, this.suggestionsFor(b)]).filter(([, offers]) => offers.length);
            const line = this.el('span', 'tag-view-offer-count');
            const total = pairs.reduce((sum, [, offers]) => sum + offers.length, 0);
            const live = window.TagSuggestLive;
            const refused = live?.refusedCount?.(this.dash) || 0;
            if (!total && !refused) {
                line.hidden = true;
                return line;
            }
            if (total) {
                line.appendChild(this.el('strong', '', total === 1
                    ? this.t('dashboard.tagViewOffersOne', '1 tag suggestion')
                    : this.t('dashboard.tagViewOffersMany', '{n} tag suggestions').replace('{n}', String(total))));
                const all = this.el('button', 'tag-view-offer-all', this.t('dashboard.tagViewOffersAddAll', 'Add all'));
                all.type = 'button';
                all.setAttribute('data-tag-view-add-all', '');
                all.addEventListener('click', () => void this.addSuggestions(pairs));
                line.append(this.el('span', '', '·'), all);
            }
            // The way back to what was refused, where the refusing happens.
            if (refused && window.TagOfferRow?.refusedLink) {
                if (total) line.append(this.el('span', '', '·'));
                const link = window.TagOfferRow.refusedLink(refused, {
                    t: (key, fallback) => this.t(key, fallback),
                    data: 'tag-view',
                    onRefused: () => void live.openRefused(this.dash),
                });
                link.classList.add('tag-view-offer-all');
                line.append(link);
            }
            return line;
        }

        /** Shared with the Tag suggestions tab: one choice, remembered once. */
        applyNow() {
            return window.TagSuggestLive?.applyNow?.() === true;
        }

        setApplyNow(on) {
            window.TagSuggestLive?.setApplyNow?.(on);
        }

        openFindMenu(anchor) {
            const d = this.dash;
            d._closeActionPopovers?.();
            document.querySelector('.tag-view-manage-menu')?.remove();
            const list = (this.rows || []).slice();
            const n = String(list.length);
            const pop = this.el('div', 'move-popover tag-view-manage-menu tag-view-find-menu');
            pop.setAttribute('role', 'menu');
            const entry = (key, label, hint, run) => {
                const item = this.el('div', 'move-popover-item');
                item.setAttribute('role', 'menuitem');
                item.setAttribute('data-find', key);
                item.tabIndex = -1;
                const text = this.el('span', 'tag-view-find-label');
                text.appendChild(this.el('span', '', label));
                if (hint) text.appendChild(this.el('span', 'tag-view-find-hint', hint));
                item.appendChild(text);
                item.addEventListener('click', () => { close(); run(); });
                pop.appendChild(item);
                return item;
            };
            const items = [
                entry('lookup', this.t('dashboard.tagViewFindThese', 'Find tags for these {n}').replace('{n}', n),
                    this.t('dashboard.tagViewFindTheseHint', 'catalogue, then online'), () => void this.findTags(list)),
                entry('read', this.t('dashboard.tagViewReadThese', 'Read pages of these {n}').replace('{n}', n),
                    this.t('dashboard.tagViewReadTheseHint', 'slower: asks each site'), () => void this.readPages(list)),
            ];
            const toggle = this.el('label', 'move-popover-item tag-view-find-toggle');
            const box = this.el('input');
            box.type = 'checkbox';
            box.checked = this.applyNow();
            box.setAttribute('data-find', 'apply-now');
            box.addEventListener('change', () => this.setApplyNow(box.checked));
            toggle.append(box, this.el('span', '', this.t('dashboard.tagViewApplyNow', 'Add found tags right away')));
            pop.append(this.el('div', 'move-popover-divider'), toggle);
            const close = () => {
                pop.remove();
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('click', onOutside, true);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    close();
                    anchor.focus();
                }
            };
            const onOutside = (e) => {
                if (!pop.contains(e.target) && e.target !== anchor) close();
            };
            document.body.appendChild(pop);
            // Under the button, its right edge on the button's: beside it, a
            // menu this wide ran off the window, since the button sits in the
            // header's right-hand corner.
            const rect = anchor.getBoundingClientRect();
            const width = pop.offsetWidth || 260;
            const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(rect.bottom + 4)}px`;
            document.addEventListener('keydown', onKey, true);
            setTimeout(() => document.addEventListener('click', onOutside, true), 0);
            items[0]?.focus?.();
        }

        /**
         * The catalogue, then the sites it does not know online, on the
         * progress overlay -- the round the Bookmarks view runs, for these.
         */
        async findTags(list) {
            const catalogue = window.TagCatalogue;
            const targets = (list || []).filter((b) => b?.url);
            if (!targets.length || typeof catalogue?.lookupRound !== 'function') return;
            const round = await catalogue.lookupRound(targets.map((b) => b.url), {
                title: this.t('dashboard.tagViewFindTitle', 'Looking for tags…'),
            });
            if (round?.busy) {
                this.dash.showNotification?.(this.t('dashboard.tagViewFindBusy', 'A search is already running.'), 'info');
                return;
            }
            window.TagSuggestLive?.invalidate?.();
            await this.afterSearch(targets, round?.off
                ? this.t('dashboard.tagViewFindNoneOff', 'No tags found. Looking up online is off, so only the catalogue was asked.')
                : this.t('dashboard.tagViewFindNone', 'No new tags found for these bookmarks.'));
        }

        /**
         * Read each page for what it says it is about, four at a time. The
         * words are stored with the page's preview, so the suggestions they
         * lead to stay after a reload, and the Tag suggestions tab sees them.
         */
        async readPages(list) {
            const targets = (list || []).filter((b) => b?.url);
            if (!targets.length) return;
            const overlay = window.ProgressOverlay;
            const total = targets.length;
            let done = 0;
            let stopped = false;
            const status = () => this.t('dashboard.tagViewReadProgress', '{done} of {total}')
                .replace('{done}', String(done)).replace('{total}', String(total));
            const end = overlay?.begin
                ? overlay.begin(this.t('dashboard.tagViewReadTitle', 'Reading pages…'), status(), {
                    onCancel: () => { stopped = true; },
                    cancelLabel: this.t('dashboard.tagViewReadStop', 'Stop'),
                })
                : () => {};
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const queue = targets.slice();
            const worker = async () => {
                while (queue.length && !stopped) {
                    const b = queue.shift();
                    try {
                        await fetcher(`/api/bookmark-preview?refresh=1&url=${encodeURIComponent(b.url)}`);
                    } catch { /* a page that cannot be read adds nothing */ }
                    done += 1;
                    overlay?.update?.(done, total, status());
                }
            };
            try {
                await Promise.all([worker(), worker(), worker(), worker()]);
            } finally {
                end();
            }
            const live = window.TagSuggestLive;
            live?.forgetKeywords?.();
            await live?.storedKeywords?.();
            live?.invalidate?.();
            await this.afterSearch(targets, this.t('dashboard.tagViewReadNone', 'The pages do not say what they are about either.'));
        }

        /** Add what the round found, or show it in the rows to choose from. */
        async afterSearch(targets, noneMessage) {
            const pairs = targets.map((b) => [b, this.suggestionsFor(b)]).filter(([, offers]) => offers.length);
            this.render();
            this.refreshPanel();
            if (!pairs.length) {
                this.dash.showNotification?.(noneMessage, 'info', { duration: 6000 });
                return;
            }
            if (this.applyNow()) {
                await this.addSuggestions(pairs);
                return;
            }
            // Which ones: a round over several rows keeps the list to those
            // with an offer, as the Bookmarks view does.
            if (targets.length > 1 && !this.filter.offered) {
                this.filter.offered = true;
                this.render();
            }
            const count = pairs.length;
            this.dash.showNotification?.((count === 1
                ? this.t('dashboard.tagViewFoundOne', '1 bookmark has a tag suggestion.')
                : this.t('dashboard.tagViewFoundMany', '{n} bookmarks have a tag suggestion.').replace('{n}', String(count))), 'success', { duration: 6000 });
        }

        /**
         * Put the offered tags on, one write per page, and offer the undo.
         * The PATCH adds tags rather than replacing the list, so a row changed
         * elsewhere in the meantime keeps that change too.
         */
        async addSuggestions(pairs) {
            const d = this.dash;
            const byPage = new Map();
            pairs.forEach(([b, offers]) => {
                const tags = [...new Set(offers.map((offer) => String(offer.tag || '').toLowerCase()).filter(Boolean))];
                if (!b?.url || !tags.length) return;
                const pageId = Number(b.pageId ?? b.pageID) || Number(d.currentPageId);
                const updates = byPage.get(pageId) || [];
                updates.push({ url: b.url, addTags: tags });
                byPage.set(pageId, updates);
            });
            if (!byPage.size) return;
            const write = (undo) => Promise.all([...byPage].map(([pageId, updates]) => {
                const body = undo
                    ? updates.map(({ url, addTags }) => ({ url, removeTags: addTags }))
                    : updates;
                return nextDashFetch('/api/bookmarks', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', ...(undo ? { 'X-NextDash-Undo': '1' } : {}) },
                    body: JSON.stringify({ page: pageId, updates: body }),
                }).then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                });
            }));
            const settle = async () => {
                await this.reloadAfterRewrite();
                window.TagSuggestLive?.changed?.(d);
                this.render();
                this.refreshPanel();
            };
            try {
                await write(false);
            } catch {
                d.showNotification?.(this.t('dashboard.tagViewAddFailed', 'Could not add the tags.'), 'error');
                await settle();
                return;
            }
            await settle();
            const count = [...byPage.values()].reduce((sum, updates) => sum + updates.length, 0);
            d.showNotification?.((count === 1
                ? this.t('dashboard.tagViewAddedOne', '1 bookmark got a tag.')
                : this.t('dashboard.tagViewAddedMany', '{n} bookmarks got a tag.').replace('{n}', String(count))), 'success', {
                duration: 8000,
                undoCallback: async () => {
                    try {
                        await write(true);
                    } finally {
                        await settle();
                    }
                },
            });
        }

        /** Turned down here is turned down everywhere: the one refusal list. */
        async refuseSuggestion(offer) {
            const d = this.dash;
            const key = window.TagSuggestLive?.dismissKey?.(offer);
            if (!key || !d.settings) return;
            const before = Array.isArray(d.settings.dismissedTagSuggestions) ? d.settings.dismissedTagSuggestions : [];
            if (before.includes(key)) return;
            d.settings.dismissedTagSuggestions = [...before, key];
            await d.saveSettings?.();
            window.TagSuggestLive?.changed?.(d);
            this.render();
            this.refreshPanel();
            d.showNotification?.(this.t('dashboard.tagViewRefused', 'Suggestion turned down.'), 'success', {
                duration: 8000,
                undoCallback: async () => {
                    d.settings.dismissedTagSuggestions = before;
                    await d.saveSettings?.();
                    window.TagSuggestLive?.changed?.(d);
                    this.render();
                    this.refreshPanel();
                },
            });
        }

        /** The side panel draws once; after a tag change it is drawn again. */
        refreshPanel() {
            if (!this.drawer?.isOpen?.()) return;
            const index = (this.rows || []).findIndex((b) => this.keyOf(b) === this.drawer._key);
            if (index >= 0) this.openPanel(index);
        }

        onRowClick(e, index) {
            if (e.target.closest('a, button, input')) return;
            if (e.shiftKey) {
                this.selectRange(index);
                return;
            }
            if (e.altKey) {
                this.toggleSelected(index);
                return;
            }
            this.moveFocus(index);
        }

        /**
         * What a selection can do, over the table while anything is ticked.
         * Delete and Move are the every-page ones the tag filter already had:
         * each bookmark goes from, and stays on, its own page.
         */
        buildSelectionBar() {
            const d = this.dash;
            const bar = this.el('div', 'tag-view-selbar');
            const count = this.selected.size;
            if (!count) {
                bar.hidden = true;
                return bar;
            }
            bar.appendChild(this.el('span', 'tag-view-selbar-count',
                this.t('dashboard.tagViewSelected', '{n} selected').replace('{n}', String(count))));
            // `tag-view:bulk`: which action, and how many rows as a band.
            const track = (action, n = this.selected.size) => window.nextdashTrack?.('tag-view:bulk', { action, count: n });
            const button = (label, cls, run) => {
                const btn = this.el('button', `lvs-action ${cls}`.trim(), label);
                btn.type = 'button';
                btn.addEventListener('click', (e) => run(e, btn));
                bar.appendChild(btn);
                return btn;
            };
            button(this.t('dashboard.tagViewOpenSelected', 'Open'), '', () => {
                track('open');
                d.openBookmarksInNewTabs?.(this.selectedBookmarks());
            });
            button(this.t('dashboard.tagViewMoveSelected', 'Move to…'), '', (e, btn) => {
                const refs = this.selectedRefs();
                d.tagFilter?.showTagFilterBulkMovePopover?.(btn, {
                    refs,
                    onMoveToPage: async (id) => {
                        track('move-page', refs.length);
                        await d.tagFilter.bulkMoveTagFilterToPage(id, refs);
                        this.selected = new Set();
                        this.render();
                    },
                    onMoveToCategory: (id) => {
                        track('move-category', refs.length);
                        d.applyBookmarkCategoryMove?.(refs, id, { count: refs.length });
                        this.selected = new Set();
                    },
                });
            });
            button(this.t('dashboard.tagViewFindSelected', 'Find tags'), 'tag-view-selbar-find', () => {
                track('find-tags');
                void this.findTags(this.selectedBookmarks());
            });
            button(this.t('dashboard.tagViewDeleteSelected', 'Delete'), 'tag-view-selbar-danger', async () => {
                const refs = this.selectedRefs();
                await d.tagFilter?.bulkDeleteTagFilterBookmarks?.(refs);
                this.selected = new Set();
                this.render();
            });
            button(this.t('dashboard.tagViewClearSelection', 'Clear'), '', () => {
                this.selected = new Set();
                this.render();
            });
            return bar;
        }

        /* ── Side panel ──────────────────────────────────────────────────── */

        openPanel(index = this.focusIndex) {
            const b = this.rows[index];
            if (!b || !this.drawer) return;
            const d = this.dash;
            const pageId = Number(b.pageId ?? b.pageID) || Number(d.currentPageId);
            this.drawer.open(this.keyOf(b), {
                title: b.name || b.url || '',
                build: (panel, ctx) => {
                    const action = (label, run, primary = false) => {
                        const btn = this.el('button', `lvs-action${primary ? ' lvs-action--primary' : ''}`, label);
                        btn.type = 'button';
                        btn.addEventListener('click', run);
                        ctx.actions.appendChild(btn);
                    };
                    action(this.t('dashboard.tagViewPanelOpen', 'Open'), () => {
                        const href = d.safeBookmarkOpenHref?.(b.url);
                        if (href) window.open(href, d.settings?.openInNewTab ? '_blank' : '_self', 'noopener');
                    }, true);
                    action(this.t('dashboard.tagViewPanelEdit', 'Edit'), () => this.editBookmark(b));

                    const facts = (body, rows) => {
                        const dl = this.el('dl', 'tag-view-facts');
                        rows.filter(([, v]) => v !== '' && v != null).forEach(([k, v]) => {
                            dl.append(this.el('dt', '', k), this.el('dd', '', String(v)));
                        });
                        body.appendChild(dl);
                    };
                    const fmtDate = (ts) => (Number(ts) ? new Date(Number(ts)).toLocaleDateString() : '');
                    facts(ctx.section('details', this.t('dashboard.tagViewPanelDetails', 'Details')), [
                        [this.t('dashboard.tagViewPanelUrl', 'URL'), b.url || ''],
                        [this.t('dashboard.tagViewColPage', 'Page'), this.pageName(pageId)],
                        [this.t('dashboard.tagViewPanelAdded', 'Added'), fmtDate(b.createdAt)],
                        [this.t('dashboard.tagViewColOpens', 'Opens'), String(Number(b.openCount) || 0)],
                        [this.t('dashboard.tagViewColLast', 'Last opened'), b.lastOpened
                            ? (this.lastOpenedLabel(b.lastOpened))
                            : this.t('dashboard.tagViewNever', 'never')],
                    ]);

                    const tagsBody = ctx.section('tags', this.t('dashboard.tagViewPanelTags', 'Tags'));
                    const chips = this.el('div', 'tag-view-tags tag-view-panel-tags');
                    (b.tags || []).forEach((tag) => {
                        const t = String(tag || '').trim().toLowerCase();
                        if (!t) return;
                        const chip = this.el('button', `tag-view-chip${this.tags.includes(t) ? ' is-active' : ''}`, t);
                        chip.type = 'button';
                        chip.dataset.tag = t;
                        chip.addEventListener('click', (e) => {
                            void d.setTagFilters(e.shiftKey ? [...new Set([...this.tags, t])] : [t]);
                        });
                        chips.appendChild(chip);
                    });
                    this.suggestionsFor(b).forEach((offer) => chips.appendChild(this.buildOfferChip(b, offer)));
                    tagsBody.appendChild(chips);
                    // The same two searches as the header's, for this one.
                    const searches = this.el('div', 'tag-view-panel-find');
                    const search = (label, run) => {
                        const btn = this.el('button', 'lvs-action', label);
                        btn.type = 'button';
                        btn.addEventListener('click', run);
                        searches.appendChild(btn);
                    };
                    search(this.t('dashboard.tagViewFindOne', 'Find tags'), () => void this.findTags([b]));
                    search(this.t('dashboard.tagViewReadOne', 'Read page'), () => void this.readPages([b]));
                    tagsBody.appendChild(searches);

                    const issue = this.healthIssue(b);
                    const score = this.scoreOf(b);
                    facts(ctx.section('health', this.t('dashboard.tagViewPanelHealth', 'Health')), [
                        [this.t('dashboard.tagViewColScore', 'Score'), score === null ? this.t('dashboard.tagViewPanelUnchecked', 'not checked yet') : String(score)],
                        [this.t('dashboard.tagViewPanelStatus', 'Status'), issue?.status || ''],
                        [this.t('dashboard.tagViewPanelChecked', 'Last check'), issue?.lastChecked ? fmtDate(issue.lastChecked) : ''],
                    ]);
                },
            });
        }

        editBookmark(b) {
            this.dash.openBookmarkFormModal?.({ mode: 'edit', bookmark: b, source: 'tag-view' });
        }

        onRowLinkClick(e, b, index, link) {
            const rawHref = link.getAttribute('href');
            if (!rawHref || rawHref === '#') {
                e.preventDefault();
                return;
            }
            const newTab = link.target === '_blank' || e.metaKey || e.ctrlKey;
            this.focusIndex = index;
            this.dash.recordBookmarkOpened?.(b, undefined, 'tag-view', e.detail === 0 ? 'keyboard-enter' : 'mouse', { newTab });
        }

        moveFocus(index) {
            if (!this.rows?.length) return;
            this.focusIndex = Math.max(0, Math.min(this.rows.length - 1, index));
            const rows = [...(this.shell?.body.querySelectorAll('.tag-view-row') || [])];
            rows.forEach((row, i) => row.classList.toggle('is-focused', i === this.focusIndex));
            const row = rows[this.focusIndex];
            row?.scrollIntoView?.({ block: 'nearest' });
            row?.querySelector('a.tag-view-open')?.focus?.({ preventScroll: true });
        }

        openFocused() {
            const row = this.shell?.body.querySelectorAll('.tag-view-row')[this.focusIndex];
            row?.querySelector('a.tag-view-open')?.click();
        }

        buildNoMatch() {
            const box = this.el('div', 'tag-view-nomatch');
            box.appendChild(this.el('p', '', this.t('dashboard.tagViewNoMatch', 'No matches.')));
            const clear = this.el('button', 'lvs-action', this.t('dashboard.tagViewClearFilters', 'Clear filters'));
            clear.type = 'button';
            clear.addEventListener('click', () => {
                this.filter = { page: null, health: null };
                this.query = '';
                this.render();
            });
            box.appendChild(clear);
            return box;
        }

        static LEGEND = [
            ['↑ ↓', 'dashboard.tagViewKeyMove', 'move'],
            ['↵', 'dashboard.tagViewKeyOpen', 'open'],
            ['x', 'dashboard.tagViewKeySelect', 'select'],
            ['i', 'dashboard.tagViewKeyPanel', 'panel'],
            ['e', 'dashboard.tagViewKeyEdit', 'edit'],
            ['a', 'dashboard.tagViewKeyAddSuggested', 'add suggested'],
            ['/', 'dashboard.tagViewKeySearch', 'search'],
            ['esc', 'dashboard.tagViewKeyBack', 'back'],
        ];

        buildLegend() {
            const legend = this.el('div', 'tag-view-legend');
            legend.setAttribute('aria-hidden', 'true');
            DashboardTagView.LEGEND.forEach(([key, labelKey, fallback]) => {
                const item = this.el('span', 'tag-view-legend-item');
                item.append(this.el('kbd', '', key), this.el('span', '', this.t(labelKey, fallback)));
                legend.appendChild(item);
            });
            return legend;
        }

        /** What the list shows: the matches, narrowed by the rail and the search. */
        shown(matches) {
            const shown = Model().applyFilters(matches, {
                page: this.filter.page,
                health: this.filter.health,
                untagged: this.all && this.filter.untagged,
                query: this.query,
                isBroken: (b) => this.isBroken(b),
            });
            return this.filter.offered ? shown.filter((b) => this.suggestionsFor(b).length) : shown;
        }

        /* ── Rail ────────────────────────────────────────────────────────── */

        static RELATED_SHOWN = 12;

        renderRail(shell, matches) {
            let host = shell.rail.querySelector('.tag-view-rail');
            if (!host) {
                host = this.el('div', 'tag-view-rail');
                shell.rail.appendChild(host);
            }
            const groups = [];

            if (this.all) {
                const none = matches.filter((b) => !(Array.isArray(b.tags) && b.tags.some((t) => String(t || '').trim()))).length;
                const btn = this.railItem(this.t('dashboard.tagViewUntagged', 'Without tags'), none, { 'data-rail-untagged': '' });
                btn.classList.toggle('is-active', this.filter.untagged);
                btn.setAttribute('aria-pressed', String(this.filter.untagged));
                btn.addEventListener('click', () => {
                    this.filter.untagged = !this.filter.untagged;
                    this.focusIndex = -1;
                    this.render();
                });
                groups.push(this.railGroup(this.t('dashboard.tagViewAllGroup', 'Bookmarks'), [btn], 'untagged'));
            }

            const related = Model().related(matches, this.tags);
            if (related.length) {
                const max = related[0].count || 1;
                const limit = DashboardTagView.RELATED_SHOWN;
                const items = related.map(({ tag, count }, i) => {
                    const btn = this.railItem(tag, count, { 'data-rail-tag': tag });
                    const bar = this.el('span', 'tag-view-rail-bar');
                    const fill = this.el('i');
                    fill.style.width = `${Math.round((count / max) * 100)}%`;
                    bar.appendChild(fill);
                    btn.appendChild(bar);
                    btn.title = this.t('dashboard.tagViewRelatedHint', 'Click to switch, Shift+click to add');
                    btn.addEventListener('click', (e) => {
                        void this.dash.setTagFilters(e.shiftKey ? [...this.tags, tag] : [tag]);
                    });
                    if (i >= limit && !this._relatedOpen) btn.hidden = true;
                    return btn;
                });
                if (related.length > limit && !this._relatedOpen) {
                    const more = this.el('button', 'lvs-filter tag-view-rail-more',
                        this.t('dashboard.tagViewRelatedMore', '+{n} more').replace('{n}', String(related.length - limit)));
                    more.type = 'button';
                    more.setAttribute('data-rail-more', '');
                    more.addEventListener('click', () => {
                        this._relatedOpen = true;
                        this.render();
                    });
                    items.push(more);
                }
                groups.push(this.railGroup(this.all
                    ? this.t('dashboard.tagViewAllTags', 'Tags')
                    : this.t('dashboard.tagViewRelated', 'Related tags'), items, 'related'));
            }

            const pages = new Map();
            matches.forEach((b) => {
                const id = Number(b.pageId ?? b.pageID) || Number(this.dash.currentPageId);
                pages.set(id, (pages.get(id) || 0) + 1);
            });
            if (pages.size) {
                const order = (this.dash.pages || []).map((p) => Number(p.id));
                const items = [...pages].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([id, count]) => {
                    const btn = this.railItem(this.pageName(id) || String(id), count, { 'data-rail-page': String(id) });
                    btn.classList.toggle('is-active', this.filter.page === id);
                    btn.setAttribute('aria-pressed', String(this.filter.page === id));
                    btn.addEventListener('click', () => {
                        this.filter.page = this.filter.page === id ? null : id;
                        this.render();
                    });
                    return btn;
                });
                groups.push(this.railGroup(this.t('dashboard.tagViewPages', 'Pages'), items, 'pages'));
            }

            const broken = matches.filter((b) => this.isBroken(b)).length;
            const never = matches.filter((b) => !(Number(b.openCount) > 0)).length;
            const health = [
                ['broken', this.t('dashboard.tagViewHealthBroken', 'Broken'), broken],
                ['never', this.t('dashboard.tagViewHealthNever', 'Never opened'), never],
            ].map(([key, label, count]) => {
                const btn = this.railItem(label, count, { 'data-rail-health': key });
                btn.classList.toggle('is-active', this.filter.health === key);
                btn.setAttribute('aria-pressed', String(this.filter.health === key));
                if (key === 'broken' && count) btn.classList.add('lvs-tone-bad');
                btn.addEventListener('click', () => {
                    this.filter.health = this.filter.health === key ? null : key;
                    this.render();
                });
                return btn;
            });
            groups.push(this.railGroup(this.t('dashboard.tagViewHealth', 'Health'), health, 'health'));

            // Where a Find tags round leaves what it found: the rows with a
            // chip to take or turn down. Drawn while there is one, or while on.
            const offered = matches.filter((b) => this.suggestionsFor(b).length).length;
            if (offered || this.filter.offered) {
                const btn = this.railItem(this.t('dashboard.tagViewOffered', 'With a tag suggestion'), offered,
                    { 'data-rail-offered': '' });
                btn.classList.toggle('is-active', Boolean(this.filter.offered));
                btn.setAttribute('aria-pressed', String(Boolean(this.filter.offered)));
                btn.addEventListener('click', () => {
                    this.filter.offered = !this.filter.offered;
                    this.render();
                });
                groups.push(this.railGroup(this.t('dashboard.tagViewOfferedGroup', 'Tag suggestions'), [btn], 'offered'));
            }

            host.replaceChildren(...groups);
        }

        railItem(label, count, attrs) {
            const btn = this.el('button', 'lvs-filter tag-view-rail-item');
            btn.type = 'button';
            Object.entries(attrs).forEach(([k, v]) => btn.setAttribute(k, v));
            btn.append(this.el('span', 'lvs-filter-label', label), this.el('span', 'lvs-filter-count', String(count)));
            return btn;
        }

        railGroup(title, items, key) {
            const group = this.el('div', `lvs-group tag-view-rail-group tag-view-rail-group--${key}`);
            group.appendChild(this.el('div', 'lvs-group-title', title));
            const list = this.el('div', 'lvs-group-list');
            list.append(...items);
            group.appendChild(list);
            return group;
        }

        /* ── Health: the report Health keeps, joined by page and URL ──────── */

        async ensureHealth() {
            const d = this.dash;
            if (d.settings?.healthViewEnabled === false || this._healthLoading) return;
            this._healthLoading = (async () => {
                const health = await d.health?.load?.();
                if (!health) return;
                if (!this._healthListening) {
                    this._healthListening = true;
                    health.onReportLoaded?.(() => {
                        this.joinHealth(health);
                        if (this.isActiveView()) this.render();
                    });
                }
                await health.fetchReport?.();
                this.joinHealth(health);
                if (this.isActiveView()) this.render();
            })().catch(() => {
                this._healthLoading = null;
            });
        }

        joinHealth(health) {
            this._health = health;
            const byUrl = new Map();
            const byPageUrl = new Map();
            (health?.report?.issues || []).forEach((issue) => {
                const key = window.HealthFacts?.keyFor?.(issue.url);
                if (!key) return;
                if (!byUrl.has(key)) byUrl.set(key, issue);
                const pageId = Number(issue.pageId ?? issue.pageID);
                if (Number.isFinite(pageId)) {
                    const pageKey = `${pageId}\u0000${key}`;
                    if (!byPageUrl.has(pageKey)) byPageUrl.set(pageKey, issue);
                }
            });
            this._healthByUrl = byUrl;
            this._healthByPageUrl = byPageUrl;
        }

        healthIssue(b) {
            const key = window.HealthFacts?.keyFor?.(b?.url);
            if (!key) return null;
            const pageId = Number(b?.pageId ?? b?.pageID ?? this.dash.currentPageId);
            return this._healthByPageUrl?.get(`${pageId}\u0000${key}`) || this._healthByUrl?.get(key) || null;
        }

        /**
         * "5m ago", "yesterday". formatLastOpened hands its translator the
         * figures to fill in; without them the template came out as written.
         */
        lastOpenedLabel(ts) {
            const t = (key, fallback, params) => {
                const raw = this.t(key, fallback);
                if (!params) return raw;
                return Object.entries(params).reduce(
                    (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                    String(raw || '')
                );
            };
            return window.formatLastOpened?.(ts, { t })?.label || '';
        }

        pageName(pageId) {
            const page = (this.dash.pages || []).find((p) => Number(p.id) === Number(pageId));
            return page?.name || '';
        }

        el(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        /* ── Header ──────────────────────────────────────────────────────── */

        renderHeader(shell, matches, shown) {
            const crumb = shell.root.querySelector('.lvs-crumb');
            const from = this.pageName(this.returnPageId);
            if (crumb) {
                crumb.textContent = from
                    ? this.t('dashboard.tagViewCrumbFrom', 'Tag · from {page}').replace('{page}', from)
                    : this.t('dashboard.tagViewCrumb', 'Tag');
                if (this.all) {
                    crumb.textContent = from
                        ? this.t('dashboard.tagViewAllCrumbFrom', 'Tags · from {page}').replace('{page}', from)
                        : this.t('dashboard.tagViewAllCrumb', 'Tags');
                }
            }
            const title = shell.root.querySelector('.lvs-title');
            // Not while the reader is typing a tag to add: a redraw (the health
            // report landing, say) would take the field out from under them.
            const typing = title?.querySelector('.tag-view-add')?.contains(document.activeElement);
            if (title && !typing) title.replaceChildren(this.buildTitle());
            const description = shell.root.querySelector('.lvs-description');
            if (description) description.replaceChildren(this.buildStats(matches), this.buildOfferCount(shown));
            this.buildActions(shell.headerActions, shown);
        }

        buildTitle() {
            const wrap = this.el('span', 'tag-view-title-wrap');
            if (this.all) {
                wrap.appendChild(this.el('span', 'tag-view-title', this.t('dashboard.tagViewAllTitle', 'All bookmarks')));
            } else if (this.tags.length === 1) {
                wrap.appendChild(this.el('span', 'tag-view-title', `#${this.tags[0]}`));
            } else {
                this.tags.forEach((tag, i) => {
                    if (i > 0) wrap.appendChild(this.el('span', 'tag-view-or', this.t('dashboard.tagViewOr', 'or')));
                    const pill = this.el('span', 'tag-view-pill');
                    pill.appendChild(this.el('span', 'tag-view-pill-label', `#${tag}`));
                    const x = this.el('button', 'tag-view-pill-x', '×');
                    x.type = 'button';
                    x.setAttribute('aria-label', this.t('dashboard.tagViewRemoveTag', 'Remove {tag}').replace('{tag}', tag));
                    x.addEventListener('click', () => {
                        void this.dash.setTagFilters(this.tags.filter((t) => t !== tag));
                    });
                    pill.appendChild(x);
                    wrap.appendChild(pill);
                });
            }
            wrap.appendChild(this.buildAddTag());
            return wrap;
        }

        /**
         * "+ tag": another tag joins the view from here, so the reader does not
         * need the cloud for it. Suggestions are the tags in use, most used
         * first, without the ones already on; Enter adds the highlighted one.
         */
        buildAddTag() {
            const host = this.el('span', 'tag-view-add');
            const button = this.el('button', 'tag-view-add-btn', this.t('dashboard.tagViewAddTag', '+ tag'));
            button.type = 'button';
            button.setAttribute('data-tag-view-add', '');
            button.setAttribute('aria-label', this.t('dashboard.tagViewAddTagAria', 'Add another tag'));
            host.appendChild(button);
            button.addEventListener('click', () => this.openAddTag(host));
            return host;
        }

        openAddTag(host) {
            const input = this.el('input', 'tag-view-add-input');
            input.type = 'text';
            input.setAttribute('data-tag-view-add-input', '');
            input.setAttribute('aria-label', this.t('dashboard.tagViewAddTagAria', 'Add another tag'));
            input.setAttribute('autocomplete', 'off');
            input.placeholder = this.t('dashboard.tagViewAddTagPlaceholder', 'tag…');
            const list = this.el('div', 'tag-view-add-suggestions');
            list.setAttribute('role', 'listbox');
            host.replaceChildren(input, list);
            let options = [];
            let at = 0;
            const all = () => (window.TagCloudModel?.countTags?.(this.pool()) || [])
                .filter(({ tag }) => !this.tags.includes(tag));
            const paint = () => {
                const q = input.value.trim().toLowerCase();
                options = all().filter(({ tag }) => !q || tag.includes(q)).slice(0, 8);
                at = Math.min(at, Math.max(0, options.length - 1));
                list.replaceChildren(...options.map(({ tag, count }, i) => {
                    const opt = this.el('button', `tag-view-add-option${i === at ? ' is-active' : ''}`);
                    opt.type = 'button';
                    opt.setAttribute('role', 'option');
                    opt.dataset.tag = tag;
                    opt.append(this.el('span', 'tag-view-add-option-label', tag), this.el('span', 'tag-view-add-option-count', String(count)));
                    opt.addEventListener('mousedown', (e) => e.preventDefault());
                    opt.addEventListener('click', () => add(tag));
                    return opt;
                }));
            };
            const close = () => {
                host.replaceWith(this.buildAddTag());
            };
            const add = (tag) => {
                if (!tag) return;
                void this.dash.setTagFilters([...this.tags, tag]);
            };
            input.addEventListener('input', () => { at = 0; paint(); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (options.length) at = (at + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                    paint();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const typed = input.value.trim().toLowerCase();
                    const exact = all().find(({ tag }) => tag === typed);
                    add(exact ? exact.tag : options[at]?.tag);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
            });
            input.addEventListener('blur', () => setTimeout(() => {
                if (host.isConnected && !host.contains(document.activeElement)) close();
            }, 120));
            paint();
            input.focus();
        }

        buildStats(matches) {
            const s = Model().stats(matches, { scoreOf: (b) => this.scoreOf(b), isBroken: (b) => this.isBroken(b) });
            const line = this.el('span', 'tag-view-stats');
            const part = (label, value, cls = '') => {
                const span = this.el('span', `tag-view-stat ${cls}`.trim());
                const parts = label.split('{v}');
                span.append(document.createTextNode(parts[0] || ''));
                span.appendChild(this.el('strong', '', value));
                if (parts[1]) span.append(document.createTextNode(parts[1]));
                line.appendChild(span);
            };
            part(s.count === 1 ? this.t('dashboard.tagViewStatOne', '{v} bookmark') : this.t('dashboard.tagViewStatMany', '{v} bookmarks'), String(s.count));
            if (this.all) {
                const none = matches.filter((b) => !(Array.isArray(b.tags) && b.tags.some((t) => String(t || '').trim()))).length;
                if (none) part(this.t('dashboard.tagViewStatUntagged', '{v} without tags'), String(none));
            }
            if (s.pages > 1) part(this.t('dashboard.tagViewStatPages', 'on {v} pages'), String(s.pages));
            if (s.lastOpened) {
                const last = this.lastOpenedLabel(s.lastOpened);
                if (last) part(this.t('dashboard.tagViewStatLast', 'last opened {v}'), last);
            }
            if (s.mostOpened) part(this.t('dashboard.tagViewStatMost', 'most opened {v}'), s.mostOpened.name || s.mostOpened.url || '');
            if (s.health !== null) part(this.t('dashboard.tagViewStatHealth', 'health {v}'), String(s.health), 'tag-view-stat--health');
            if (s.broken) part(this.t('dashboard.tagViewStatBroken', '{v} broken'), String(s.broken), 'tag-view-stat--broken');
            return line;
        }

        /** The bookmark's health score, as the Bookmarks view shows it; null before the report. */
        scoreOf(b) {
            const score = Number(this.healthIssue(b)?.score);
            return Number.isFinite(score) ? score : null;
        }

        isBroken(b) {
            const issue = this.healthIssue(b);
            if (!issue || !this._health) return false;
            try {
                return Boolean(this._health.matchesFilter(issue, 'broken'));
            } catch {
                return false;
            }
        }

        buildActions(host, shown) {
            const d = this.dash;
            const plans = d.buildOpenTabsPlans?.(shown, { all: 'tagFilterOpenAll', first: 'tagFilterOpenFirst' }) || [];
            // Rebuilt only when what they say changes: a redraw for the health
            // report swapped the buttons out from under the pointer (and the
            // focus) for nothing.
            const signature = JSON.stringify([plans.map((p) => p.label), shown.length, this.tags]);
            this._shownForActions = shown;
            if (host.dataset.signature === signature && host.childElementCount) return;
            host.dataset.signature = signature;
            host.replaceChildren();
            plans.forEach((plan, i) => {
                const btn = this.el('button', `lvs-action${i === plans.length - 1 ? ' lvs-action--primary' : ''}`, plan.label);
                btn.type = 'button';
                // Read at the click: the list may have changed since these were drawn.
                btn.addEventListener('click', () => {
                    const now = d.buildOpenTabsPlans?.(this._shownForActions, { all: 'tagFilterOpenAll', first: 'tagFilterOpenFirst' }) || [];
                    const picked = (now[i] || now[now.length - 1])?.bookmarks || [];
                    window.nextdashTrack?.('tag-view:bulk', { action: 'open-shown', count: picked.length });
                    d.openBookmarksInNewTabs?.(picked);
                });
                host.appendChild(btn);
            });
            const copy = this.el('button', 'lvs-action', d.language?.t?.('dashboard.tagFilterCopyLinks') || 'Copy links');
            copy.type = 'button';
            copy.disabled = !shown.length;
            copy.addEventListener('click', () => {
                window.nextdashTrack?.('tag-view:bulk', { action: 'copy', count: this._shownForActions?.length || 0 });
                d.tagFilter?.copyTagFilterLinksToClipboard?.(this._shownForActions);
            });
            host.appendChild(copy);
            const find = this.el('button', 'lvs-action tag-view-find-btn', this.t('dashboard.tagViewFindTags', 'Find tags ▾'));
            find.type = 'button';
            find.disabled = !shown.length;
            find.setAttribute('data-tag-view-find', '');
            find.setAttribute('aria-haspopup', 'menu');
            find.addEventListener('click', () => this.openFindMenu(find));
            host.appendChild(find);
            if (this.tags.length === 1) {
                const manage = this.el('button', 'lvs-action tag-view-manage-btn', this.t('dashboard.tagViewManage', 'Manage tag ▾'));
                manage.type = 'button';
                manage.setAttribute('data-tag-view-manage', '');
                manage.setAttribute('aria-haspopup', 'menu');
                manage.addEventListener('click', () => this.openManageMenu(manage));
                host.appendChild(manage);
            }
        }

        openManageMenu(anchor) {
            const d = this.dash;
            d._closeActionPopovers?.();
            document.querySelector('.tag-view-manage-menu')?.remove();
            const pop = this.el('div', 'move-popover tag-view-manage-menu');
            pop.setAttribute('role', 'menu');
            const items = [
                ['rename', this.t('dashboard.tagViewRename', 'Rename tag…'), () => this.renameTag()],
                ['merge', this.t('dashboard.tagViewMerge', 'Merge into another tag…'), () => this.mergeTag()],
                ['remove', this.t('dashboard.tagViewRemoveAll', 'Remove from all bookmarks…'), () => this.removeTag()],
            ].map(([key, label, run]) => {
                const item = this.el('div', `move-popover-item${key === 'remove' ? ' is-danger' : ''}`);
                item.setAttribute('role', 'menuitem');
                item.setAttribute('data-manage', key);
                item.tabIndex = -1;
                item.appendChild(this.el('span', '', label));
                item.addEventListener('click', () => { close(); run(); });
                pop.appendChild(item);
                return item;
            });
            const close = () => {
                pop.remove();
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('click', onOutside, true);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    close();
                    anchor.focus();
                }
            };
            const onOutside = (e) => {
                if (!pop.contains(e.target) && e.target !== anchor) close();
            };
            document.body.appendChild(pop);
            d._positionActionPopoverBeside?.(pop, anchor);
            document.addEventListener('keydown', onKey, true);
            setTimeout(() => document.addEventListener('click', onOutside, true), 0);
            items[0]?.focus?.();
        }

        /** After a rename, merge or remove: the data, then the view, again. */
        async reloadAfterRewrite() {
            const d = this.dash;
            await d.loadAllBookmarks?.();
            await d.loadPageBookmarks?.(d.currentPageId, { forceFetch: true, skipRender: true });
        }

        askForTag({ title, html, confirmText, read }) {
            return new Promise((resolve) => {
                if (typeof window.AppModal?.show !== 'function') {
                    resolve(null);
                    return;
                }
                let value = null;
                window.AppModal.show({
                    title,
                    htmlMessage: html,
                    confirmText,
                    initialFocusSelector: '[data-tag-rename], [data-tag-merge]',
                    onConfirm: () => {
                        value = read();
                    },
                    onHide: () => resolve(value),
                });
            });
        }

        async renameTag() {
            const from = this.tags[0];
            const esc = (v) => this.dash.escapeHtml?.(v) ?? String(v);
            const to = await this.askForTag({
                title: this.t('dashboard.tagViewRenameTitle', 'Rename tag'),
                html: `<label class="tag-view-modal-field">${esc(this.t('dashboard.tagViewRenameLabel', 'New name'))}
                    <input type="text" data-tag-rename value="${esc(from)}" autocomplete="off"></label>`,
                confirmText: this.t('dashboard.tagViewRenameConfirm', 'Rename'),
                read: () => String(document.querySelector('#app-modal [data-tag-rename]')?.value || '').trim().toLowerCase(),
            });
            if (!to || to === from) return;
            await this.rewrite(from, to);
        }

        async mergeTag() {
            const from = this.tags[0];
            const esc = (v) => this.dash.escapeHtml?.(v) ?? String(v);
            const others = (window.TagCloudModel?.countTags?.(this.pool()) || []).filter(({ tag }) => tag !== from);
            if (!others.length) return;
            const options = others.map(({ tag, count }) => `<option value="${esc(tag)}">${esc(tag)} (${count})</option>`).join('');
            const to = await this.askForTag({
                title: this.t('dashboard.tagViewMergeTitle', 'Merge tag'),
                html: `<label class="tag-view-modal-field">${esc(this.t('dashboard.tagViewMergeLabel', 'Merge #{tag} into').replace('{tag}', from))}
                    <select data-tag-merge>${options}</select></label>`,
                confirmText: this.t('dashboard.tagViewMergeConfirm', 'Merge'),
                read: () => String(document.querySelector('#app-modal [data-tag-merge]')?.value || ''),
            });
            if (!to) return;
            await this.rewrite(from, to);
        }

        async removeTag() {
            const from = this.tags[0];
            const ok = await window.AppModal?.danger?.({
                title: this.t('dashboard.tagViewRemoveTitle', 'Remove tag'),
                message: this.t('dashboard.tagViewRemoveConfirm', 'Remove #{tag} from every bookmark that has it?').replace('{tag}', from),
                confirmText: this.t('dashboard.tagViewRemoveConfirmButton', 'Remove'),
            });
            if (!ok) return;
            await this.rewrite(from, null);
        }

        /** The shared rewrite; the view follows the tag where it went. */
        async rewrite(from, to) {
            const d = this.dash;
            await window.TagRewrite?.rewrite?.(d, from, to, {
                onDone: async ({ undone }) => {
                    await this.reloadAfterRewrite();
                    const next = undone ? from : to;
                    if (next) {
                        await d.setTagFilters([next]);
                        this.render();
                    } else if (this.isActiveView()) {
                        this.closeTagView();
                    } else {
                        d.renderDashboard?.({ animate: false });
                    }
                },
            });
        }

        buildEmpty() {
            const box = this.el('div', 'tag-view-empty');
            box.appendChild(this.el('p', '', this.t('dashboard.tagViewEmpty', 'No bookmarks have this tag any more.')));
            const name = this.pageName(this.returnPageId);
            const back = this.el('button', 'lvs-action', name
                ? this.t('dashboard.tagViewBackTo', 'Back to {page}').replace('{page}', name)
                : this.t('dashboard.tagViewBack', 'Back'));
            back.type = 'button';
            back.addEventListener('click', () => this.closeTagView());
            box.appendChild(back);
            return box;
        }

        /** Escape leaves the view when nothing above it wants the key. */
        setupKeys() {
            const d = this.dash;
            if (this._keyHandler) document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = (e) => {
                if (!this.isActiveView()) return;
                if (window.DashboardTagCloud?.modalOpen || d.isModalOpen?.() || d.searchComponent?.isActive?.()) return;
                // The row menu and the popovers it opens own their keys,
                // Escape first among them.
                if (document.querySelector('dialog[open], .tag-view-manage-menu, .move-popover, .bookmark-context-menu, #bookmark-check-mode-menu')) return;
                const active = document.activeElement;
                const tag = active?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
                const swallow = () => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                };
                // Ctrl/Cmd+C copies the row's URL, as on the dashboard, unless
                // there is text selected to copy instead.
                if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyC'
                    && this.focusIndex >= 0 && !String(window.getSelection?.() || '')) {
                    swallow();
                    this.runRowAction('copy-url');
                    return;
                }
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                const rowAction = e.shiftKey ? DashboardTagView.ROW_KEYS[e.code] : (e.key === 'Delete' ? 'delete' : null);
                if (rowAction && this.focusIndex >= 0) {
                    swallow();
                    this.runRowAction(rowAction);
                    return;
                }
                switch (e.key) {
                    case 'Escape':
                        swallow();
                        // One thing at a time: the panel, then the ticks, then the view.
                        if (this.drawer?.isOpen?.()) {
                            this.drawer.close();
                            return;
                        }
                        if (this.selected.size) {
                            this.selected = new Set();
                            this.render();
                            return;
                        }
                        this.closeTagView();
                        return;
                    case 'x':
                        if (this.focusIndex < 0) return;
                        swallow();
                        this.toggleSelected(this.focusIndex);
                        return;
                    case 'i':
                        if (this.focusIndex < 0) return;
                        swallow();
                        this.openPanel(this.focusIndex);
                        return;
                    case 'a': {
                        const b = this.rows[this.focusIndex];
                        const offers = b ? this.suggestionsFor(b) : [];
                        if (!offers.length) return;
                        swallow();
                        void this.addSuggestions([[b, offers]]);
                        return;
                    }
                    case 'e':
                        if (this.focusIndex < 0) return;
                        swallow();
                        this.editBookmark(this.rows[this.focusIndex]);
                        return;
                    case '/':
                        swallow();
                        this.searchEl?.focus();
                        return;
                    case 'ArrowDown':
                        swallow();
                        this.moveFocus(this.focusIndex + 1);
                        return;
                    case 'ArrowUp':
                        swallow();
                        this.moveFocus(this.focusIndex <= 0 ? 0 : this.focusIndex - 1);
                        return;
                    case 'g':
                        swallow();
                        this.moveFocus(0);
                        return;
                    case 'G':
                        swallow();
                        this.moveFocus((this.rows?.length || 1) - 1);
                        return;
                    case 'Enter':
                        if (this.focusIndex < 0) return;
                        if (active?.closest?.('button')) return;
                        swallow();
                        this.openFocused();
                        return;
                    default:
                }
            };
            document.addEventListener('keydown', this._keyHandler, true);
        }
    }

    window.DashboardTagView = DashboardTagView;
})();
