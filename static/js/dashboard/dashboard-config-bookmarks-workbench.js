/**
 * Config → Bookmarks → List as a workbench.
 *
 * Three parts with one job each: the rail narrows the list, the list shows
 * what is left, the panel shows — and edits — the bookmark in focus, or the
 * selection when there is one. Every filter, sort and write still lives on
 * DashboardConfig; this file draws and wires.
 *
 * Loaded after dashboard-config-bookmarks.js and the workbench model, by
 * ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const SECTIONS_KEY = 'nextdash.configBm.sections';
    // Edit only: Health carries the score, check mode and the expectations
    // form now, and open by default it ran the panel past the screen. It is
    // one click, or s, away; what the reader opens is remembered.
    const SECTIONS_DEFAULT = ['edit'];
    // The panel's tabs, in bar order; the reader's choice is kept across rows.
    const PANEL_TABS = ['details', 'health', 'usage'];
    const PANEL_TAB_KEY = 'nextdash.bm.panelTab';

    Object.assign(global.DashboardConfig.prototype, {

    renderBookmarksWorkbench() {
        const esc = (v) => this.dash.escapeHtml(v);
        const filtered = this.visibleBookmarks();
        const total = (this.dash.allBookmarks || []).length;
        const countLabel = this.renderBookmarkCountLabelSafe(filtered.length, total);
        // The list is the Bookmarks view's alone: full width, its panel the
        // side panel over the page (is-panel-collapsed and is-library say so
        // to the stylesheet).
        return `
            <div class="config-bm-workbench is-panel-collapsed is-library" id="config-bm-workbench">
                <aside class="config-bm-rail" id="config-bm-rail"
                       aria-label="${esc(this.t('config.bmFilters', 'Filters'))}">${this.renderWorkbenchRail()}</aside>
                <section class="config-bm-main" aria-label="${esc(this.t('config.sectionBookmarks', 'Bookmarks'))}">
                    <div class="config-bm-toolbar">
                        <label class="config-bm-search">
                            <input type="search" class="config-text" id="config-bm-search"
                                   placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}"
                                   value="${esc(this.bmQuery || '')}">
                            <kbd aria-hidden="true">/</kbd>
                        </label>
                        <span class="config-bm-count" id="config-bm-count">${esc(countLabel)}</span>
                        <span class="config-sr-only" id="config-bm-count-live" aria-live="polite" aria-atomic="true">${esc(countLabel)}</span>
                        <span id="config-bm-narrow-buttons" class="config-bm-narrow-buttons">${this.renderWorkbenchNarrowButtons()}</span>
                        <span class="config-bm-toolbar-spacer"></span>
                        ${this.renderEnableCheckingButton?.() || ''}
                        <label class="config-bm-group">
                            <span>${esc(this.t('config.groupLabel', 'Group'))}</span>
                            <select class="config-select" id="config-bm-group">${this.bookmarkGroupOptionsHtml()}</select>
                        </label>
                        <label class="config-bm-sort">
                            <span>${esc(this.t('config.sortLabel', 'Sort'))}</span>
                            <select class="config-select" id="config-bm-sort">${this.bookmarkSortOptionsHtml()}</select>
                        </label>
                        <button type="button" class="config-btn config-btn--primary config-btn--small" id="config-bm-add">${esc(this.t('config.addBookmark', 'Add bookmark'))}</button>
                    </div>
                    <div id="config-bm-list">${this.renderBookmarksListSafe()}</div>
                </section>
                <aside class="config-bm-panel" id="config-bm-panel" role="region"
                       aria-label="${esc(this.t('config.bmDetails', 'Details'))}">${this.renderWorkbenchPanel()}</aside>
                <div class="config-bm-scrim" data-bm-scrim hidden></div>
            </div>`;
    },

    renderWorkbenchRail() {
        // The search field lives in the toolbar now (renderBookmarksWorkbench),
        // above the list rather than above the filters — the rail is nothing
        // but filters, the way Health's is.
        return `<div id="config-bm-rail-facets">${this.renderWorkbenchFacets()}</div>`;
    },

    bookmarkFacetCounts() {
        const all = this.configBookmarkPool();
        const token = JSON.stringify([this._bmVisibleToken, all.length,
            this.isUnsortedBookmarkView(), global.HealthFacts?.updatedAt || 0, this._bmHealthGen || 0]);
        if (this._bmFacetSource === all && this._bmFacetToken === token && this._bmFacets) return this._bmFacets;
        const tests = this.bookmarkFilterTests();
        const cleanupKeys = Object.keys(global.DashboardConfig.CLEANUP_FILTERS);
        const dupes = this.ensureDuplicateUrlSet();
        const matchesView = (b, key) => {
            const fn = global.DashboardConfig.CLEANUP_FILTERS[key];
            return key === 'duplicate' ? fn(b, dupes, (url) => this.canonicalStatsUrlKey(url)) : fn(b);
        };
        const counts = global.BookmarkWorkbenchModel.facetCounts(all, {
            query: { keys: () => [], test: tests.query },
            view: { keys: (b) => ['', ...cleanupKeys.filter((k) => matchesView(b, k))], test: tests.cleanup },
            page: { keys: (b) => [String(b.pageId)], test: tests.page },
            category: {
                keys: (b) => (b.category ? [global.DashboardConfig.categoryFilterKey(b.pageId, b.category)] : []),
                test: tests.category,
            },
            tag: { keys: (b) => (b.tags || []).map((t) => String(t).trim().toLowerCase()), test: tests.tag },
            health: { keys: (b) => this.bmHealthKeys?.(b) || [], test: tests.health },
        });
        this._bmFacetSource = all;
        this._bmFacetToken = token;
        this._bmFacets = counts;
        return counts;
    },

    /**
     * What a view's number says.
     *
     * The facets are computed over whichever pool is on screen, so two of these
     * cannot come from there: Unsorted never counts itself, and while it is the
     * one showing, the other views describe a library this pool is not part of.
     * Those fall back to a pass over the filed bookmarks, which is the set they
     * are about.
     */
    railViewCount(key, counts) {
        const unsortedView = global.DashboardConfig.UNSORTED_VIEW;
        if (key === unsortedView) {
            return (this.dash.unsortedBookmarks || []).length;
        }
        if (!this.isUnsortedBookmarkView()) {
            return counts.view.get(key) || 0;
        }
        const filed = this.dash.allBookmarks || [];
        if (!key) return filed.length;
        const fn = global.DashboardConfig.CLEANUP_FILTERS[key];
        if (typeof fn !== 'function') return 0;
        const dupes = key === 'duplicate' ? this.ensureDuplicateUrlSet() : null;
        return filed.filter((b) => (key === 'duplicate'
            ? fn(b, dupes, (url) => this.canonicalStatsUrlKey(url))
            : fn(b))).length;
    },

    railCategoryLabel(pageId, categoryId) {
        const hit = this.knownCategories(pageId).find((c) =>
            c.id === categoryId || c.id === global.DashboardConfig.categoryFilterKey(pageId, categoryId));
        return hit?.label || categoryId;
    },

    renderWorkbenchFacets() {
        const esc = (v) => this.dash.escapeHtml(v);
        const counts = this.bookmarkFacetCounts();
        const tags = this.bookmarkTagFilters();
        const entry = (kind, value, label, n, on, extra = '', cls = '', hint = '') => `
            <button type="button" class="config-bm-rail-item${on ? ' is-on' : ''}${n ? '' : ' is-empty'}${cls ? ` ${cls}` : ''}"
                    data-bm-rail="${kind}" data-value="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}"
                    title="${esc(hint ? `${label} (${n}) — ${hint}` : `${label} (${n})`)}">
                ${extra}<span class="config-bm-rail-label">${esc(label)}</span>
                <span class="config-bm-rail-count">${n}</span>
            </button>`;
        // Pages and categories are managed in a modal over the list.
        const manage = (tab) => (typeof this.openStructureModal === 'function'
            ? `<button type="button" class="config-bm-rail-more" data-bm-manage="${tab}">${esc(this.t('config.bmManage', 'Manage'))}</button>`
            : '');
        const group = (title, body, more = '') => (body ? `
            <section class="config-bm-rail-group">
                <h3 class="config-bm-rail-title"><span>${esc(title)}</span>${more}</h3>
                ${body}
            </section>` : '');

        // Tokens: what is on, each removable.
        const tokens = [];
        const token = (key, label) => tokens.push(
            `<button type="button" class="config-bm-rail-token" data-bm-rail-clear="${esc(key)}" title="${esc(label)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
        if (this.bmCleanupFilter) token('cleanup', this.cleanupFilterLabel(this.bmCleanupFilter));
        if (this.bmPageFilter) token('page', this.pageLabel(this.bmPageFilter));
        if (this.bmCategoryFilter) {
            const { pageId, categoryId } = global.DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            token('category', this.railCategoryLabel(pageId || this.bmPageFilter, categoryId));
        }
        tags.forEach((t) => token(`tag:${t}`, `#${t}`));
        if (this.bmHealthFilter) token('health', this.bmHealthFilterLabel?.(this.bmHealthFilter) || this.bmHealthFilter);
        const tokenRow = tokens.length ? `
            <div class="config-bm-rail-tokens">${tokens.join('')}
                <button type="button" class="config-bm-rail-clear-all" data-bm-rail-clear="all">${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>
            </div>` : '';

        const VIEWS_SHOWN = 5;
        // Unsorted closes the cleanup views: it is not a question about the
        // filed library but a different pool, so it sits apart from the rest.
        // It is always drawn, never folded into "+N more".
        const unsortedView = global.DashboardConfig.UNSORTED_VIEW;
        const viewKeys = ['', ...Object.keys(global.DashboardConfig.CLEANUP_FILTERS), unsortedView];
        const viewsOpen = this._bmRailViewsOpen === true;
        const views = viewKeys
            .filter((k, i) => viewsOpen || i < VIEWS_SHOWN || k === unsortedView || k === this.bmCleanupFilter)
            .map((k) => {
                // Unsorted is not another question about the same library: it
                // swaps the pool. Marked so the row reads as the odd one out.
                const odd = k === unsortedView;
                const label = k ? this.cleanupFilterLabel(k) : this.t('config.bmViewAll', 'All');
                return entry('cleanup', k, label, this.railViewCount(k, counts),
                    (this.bmCleanupFilter || '') === k,
                    odd ? '<span class="config-bm-rail-mark" aria-hidden="true">✻</span>' : '',
                    odd ? 'is-unsorted' : '',
                    odd ? this.t('config.bmViewUnsortedHint',
                        'Bookmarks that are not filed yet. This view shows them alone; give one a page to move it to the dashboard.') : '');
            })
            .join('');
        // Unsorted is drawn either way, so it is not one of the ones hidden.
        const viewsHidden = viewKeys.length - VIEWS_SHOWN - 1;
        const viewsMore = viewsHidden > 0
            ? `<button type="button" class="config-bm-rail-more" data-bm-rail-more="views">${esc(viewsOpen
                ? this.t('config.bmShowFewer', 'fewer')
                : this.t('config.bmShowMore', '+{n} more').replace('{n}', String(viewsHidden)))}</button>`
            : '';

        const pages = (this.dash.pages || [])
            .map((p) => entry('page', String(p.id), p.name || String(p.id),
                counts.page.get(String(p.id)) || 0, String(this.bmPageFilter || '') === String(p.id)))
            .join('');

        const categories = [...counts.category.entries()]
            .filter(([key]) => {
                const { pageId } = global.DashboardConfig.parseCategoryFilter(key);
                return !this.bmPageFilter || String(pageId) === String(this.bmPageFilter);
            })
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => {
                const { pageId, categoryId } = global.DashboardConfig.parseCategoryFilter(key);
                const label = this.bmPageFilter
                    ? this.railCategoryLabel(pageId, categoryId)
                    : `${this.pageLabel(pageId)} › ${this.railCategoryLabel(pageId, categoryId)}`;
                return entry('category', key, label, n, this.bmCategoryFilter === key
                    || (this.bmCategoryFilter === categoryId && String(this.bmPageFilter) === String(pageId)));
            })
            .join('');

        const TAGS_SHOWN = 12;
        const tagsOpen = this._bmRailTagsOpen === true;
        const allTags = global.BookmarkWorkbenchModel.tagCounts(this.dash.allBookmarks || []).map(([t]) => t);
        const shownTags = allTags.filter((t, i) => tagsOpen || i < TAGS_SHOWN || tags.includes(t));
        const tagList = shownTags
            .map((t) => entry('tag', t, `#${t}`, counts.tag.get(t) || 0, tags.includes(t)))
            .join('');
        const tagsMore = allTags.length > TAGS_SHOWN
            ? `<button type="button" class="config-bm-rail-more" data-bm-rail-more="tags">${esc(tagsOpen
                ? this.t('config.bmShowFewer', 'fewer')
                : this.t('config.bmAllTags', 'all'))}</button>`
            : '';

        // Health's own filters, once its report has been joined in.
        const health = this._bmHealthByUrl
            ? global.DashboardConfig.HEALTH_FILTERS
                .map((k) => entry('health', k, this.bmHealthFilterLabel(k), counts.health.get(k) || 0,
                    this.bmHealthFilter === k, `<span class="config-bm-health-dot is-${k}" aria-hidden="true"></span>`))
                .join('')
            : '';

        return `
            ${this.renderBmHealthSummary?.() || ''}
            ${tokenRow}
            ${group(this.t('config.bmViews', 'Views'), views, viewsMore)}
            ${group(this.t('config.bmHealth', 'Health'), health)}
            ${group(this.t('config.bmPages', 'Pages'), pages, manage('pages'))}
            ${group(this.t('config.bmCategories', 'Categories'), categories, manage('categories'))}
            ${group(this.t('config.bmTags', 'Tags'), tagList, tagsMore)}`;
    },

    railHealthLabel(key) {
        return {
            healthy: this.t('config.bmHealthHealthy', 'Healthy'),
            broken: this.t('config.bmHealthBroken', 'Broken'),
            down: this.t('config.bmHealthDown', 'Monitor down'),
            unchecked: this.t('config.bmHealthUnchecked', 'Never checked'),
        }[key] || key;
    },

    repaintWorkbenchRail() {
        const host = document.getElementById('config-bm-rail-facets');
        if (host) host.innerHTML = this.renderWorkbenchFacets();
    },

    toggleRailFilter(kind, value) {
        if (kind === 'page') {
            this.bmPageFilter = String(this.bmPageFilter || '') === value ? '' : value;
            this.resetBookmarkVisibleLimit();
            void this.onBookmarksPageFilterChange();
            return;
        }
        if (kind === 'category') this.bmCategoryFilter = this.bmCategoryFilter === value ? '' : value;
        if (kind === 'cleanup') this.bmCleanupFilter = this.bmCleanupFilter === value ? '' : value;
        if (kind === 'health') this.bmHealthFilter = this.bmHealthFilter === value ? '' : value;
        if (kind === 'tag') {
            const current = this.bookmarkTagFilters();
            this.bmTagFilter = current.includes(value)
                ? current.filter((t) => t !== value)
                : [...current, value];
        }
        this.resetBookmarkVisibleLimit();
        this._bmDuplicateUrls = null;
        this.repaintBookmarksList();
        this.restoreConfigHash();
        this.updateConfigShellHead();
    },

    bindWorkbenchRail(rail) {
        if (!rail || rail.dataset.bmRailWired === '1') return;
        rail.dataset.bmRailWired = '1';
        rail.addEventListener('click', (e) => {
            const summary = e.target.closest('[data-bm-health-summary]');
            if (summary) {
                this.openBmHealthModal?.();
                return;
            }
            const more = e.target.closest('[data-bm-rail-more]');
            if (more) {
                const which = more.getAttribute('data-bm-rail-more');
                if (which === 'tags') this._bmRailTagsOpen = !this._bmRailTagsOpen;
                if (which === 'views') this._bmRailViewsOpen = !this._bmRailViewsOpen;
                this.repaintWorkbenchRail();
                return;
            }
            const manage = e.target.closest('[data-bm-manage]');
            if (manage) {
                this.openStructureModal(manage.getAttribute('data-bm-manage'));
                return;
            }
            const clear = e.target.closest('[data-bm-rail-clear]');
            if (clear) {
                this.clearBookmarkFilterChip(clear.getAttribute('data-bm-rail-clear'));
                return;
            }
            const item = e.target.closest('[data-bm-rail]');
            if (item) this.toggleRailFilter(item.getAttribute('data-bm-rail'), item.getAttribute('data-value') || '');
        });
        // The summary block is a plain div (it holds several rows, not one
        // control), so role="button" alone does not make Enter/Space act on
        // it the way a real <button> would -- that has to be wired by hand.
        rail.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (!e.target.closest('[data-bm-health-summary]')) return;
            e.preventDefault();
            this.openBmHealthModal?.();
        });
    },

    workbenchPanelMode() {
        if (this.bmSelected.size > 1) return 'bulk';
        return this.workbenchPanelKey() ? 'single' : 'empty';
    },

    /**
     * The bookmark the panel shows: the row under the cursor, or the one a
     * save just moved. A moved bookmark can land outside the drawn window or
     * the active filter, where the list drops its cursor; the panel is held
     * on it anyway until the reader picks another row or clears the cursor.
     */
    workbenchPanelKey() {
        if (this._bmPendingFocus) {
            const key = this.bookmarkKeyAt(this._bmPendingFocus.pageId, this._bmPendingFocus.index);
            this._bmPendingFocus = null;
            if (key) {
                this._bmKeyboardKey = key;
                this._bmPanelHoldKey = key;
            }
        }
        if (this._bmKeyboardKey && this._bmKeyboardKey !== this._bmPanelHoldKey) this._bmPanelHoldKey = null;
        const key = this._bmKeyboardKey || this._bmPanelHoldKey;
        return key && this.findBookmarkByKey(key) ? key : null;
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const mode = this.workbenchPanelMode();
        let body;
        if (mode === 'bulk') body = this.renderWorkbenchBulkPanel?.() || '';
        else if (mode === 'single') body = this.renderWorkbenchSinglePanel(this.workbenchPanelKey());
        else body = `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
        return `<div class="config-bm-panel-body">${body}</div>`;
    },

    renderWorkbenchField(name, label, control) {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <label class="config-bm-field" data-bm-field-wrap="${name}">
                <span class="config-bm-field-label">${esc(label)}</span>
                ${control}
                <span class="config-bm-field-status" role="status"></span>
            </label>`;
    },

    /** Check modes as select options; CheckMode names them, the panel only lists them. */
    workbenchCheckModeOptions() {
        const cm = global.CheckMode;
        if (!cm) return [];
        return [cm.OFF, cm.PERIODIC, cm.MONITOR].map((mode) => ({ mode, label: cm.meta(mode).label }));
    },

    /** Monitor cadences as select options, the choices the edit dialog offers. */
    workbenchIntervalOptions(selected, { mixed = false } = {}) {
        const esc = (v) => this.dash.escapeHtml(v);
        const cm = global.CheckMode;
        const head = mixed ? [`<option value=""${selected ? '' : ' selected'}>${esc(this.t('config.bmMixed', 'mixed'))}</option>`] : [];
        return head.concat((cm?.INTERVAL_CHOICES || []).map((m) =>
            `<option value="${m}"${Number(selected) === m ? ' selected' : ''}>${esc(cm.intervalLabel(m))}</option>`)).join('');
    },

    /**
     * One collapsible part of the panel, in the shared side panel's markup
     * (.lvs-drawer-section, list-view-shell.css), so Config's panel folds the
     * way Health's and the inbox's do. Which parts are open is remembered.
     */
    workbenchSection(name, label, body) {
        const esc = (v) => this.dash.escapeHtml(v);
        const open = this.workbenchOpenSections().has(name);
        return `<details class="lvs-drawer-section config-bm-panel-section" data-bm-section="${esc(name)}"${open ? ' open' : ''}>
                <summary>${esc(label)}</summary>
                <div class="lvs-drawer-section-body">${body}</div>
            </details>`;
    },

    workbenchOpenSections() {
        try {
            const raw = global.localStorage?.getItem(SECTIONS_KEY);
            const arr = raw ? JSON.parse(raw) : null;
            return new Set(Array.isArray(arr) ? arr : SECTIONS_DEFAULT);
        } catch {
            return new Set(SECTIONS_DEFAULT);
        }
    },

    renderWorkbenchSinglePanel(key) {
        const esc = (v) => this.dash.escapeHtml(v);
        const b = this.findBookmarkByKey(key);
        const facts = global.HealthFacts?.get?.(b.url) || null;
        const state = this.bookmarkHealthState(b);
        const fmt = (ts) => global.formatLastOpened?.(ts, { t: this.lastOpenedTranslator() }) || { label: '—' };
        /*
         * A kept bookmark's own page is not in d.pages -- it is hidden, and
         * nothing on the dashboard routes to it -- so without an entry of its
         * own the select would sit on a page this bookmark is not on, and the
         * first save would file it somewhere nobody chose. With it, staying put
         * is the default and picking a page is the deliberate act that moves it
         * onto the dashboard.
         */
        const isKept = global.UnsortedPage?.isUnsorted?.(b) === true;
        const keptOption = isKept
            ? `<option value="${esc(global.UnsortedPage.PAGE_ID)}" selected>${
                esc(this.t('config.bmViewUnsorted', 'Unsorted'))}</option>`
            : '';
        const pageOptions = keptOption + (this.dash.pages || []).map((p) =>
            `<option value="${esc(p.id)}"${String(p.id) === String(b.pageId) ? ' selected' : ''}>${esc(p.name || p.id)}</option>`).join('');
        const categories = this.knownCategories(b.pageId);
        const catOptions = [`<option value="">${esc(this.t('config.bmNoCategory', 'No category'))}</option>`]
            .concat(categories.map((c) => {
                const id = global.DashboardConfig.parseCategoryFilter(c.id).categoryId;
                return `<option value="${esc(id)}"${id === (b.category || '') ? ' selected' : ''}>${esc(c.label)}</option>`;
            })).join('');
        const mode = global.CheckMode?.of?.(b) || 'off';
        const modeOptions = this.workbenchCheckModeOptions().map((o) =>
            `<option value="${esc(o.mode)}"${o.mode === mode ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
        const input = (name, value, extra = '') =>
            `<input type="text" class="config-text" data-bm-field="${name}" value="${esc(value ?? '')}" data-original="${esc(value ?? '')}" ${extra}>`;
        const feed = global.BookmarkFeedRow;
        const issue = this.bmHealthIssue?.(b) || null;
        const score = issue && Number.isFinite(Number(issue.score)) ? Number(issue.score) : null;
        const scoreTone = score == null ? '' : (score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad');
        // Where it lives, page › category. The shortcut is not repeated here: the form and the list both show it.
        const where = b.category
            ? `${this.pageLabel(b.pageId)} › ${this.railCategoryLabel(b.pageId, b.category)}`
            : this.pageLabel(b.pageId);
        // A problem worth a look: the dot on the Health tab says so without opening it.
        const troubled = state === 'broken' || state === 'down' || (issue && issue.status === 'broken');
        const tab = this.workbenchPanelTab();
        // The digits reach the tabs only in the Bookmarks view (see
        // handleWorkbenchPanelTabKey), so only there do the tabs name them,
        // in their titles: chips inside the bar made it read as a keyboard.
        const tabButton = (name, label, n) => {
            const on = name === tab;
            return `<button type="button" class="config-bm-tab${on ? ' is-active' : ''}" role="tab"
                        aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? 0 : -1}" data-bm-tab-panel="${name}"${
                ` title="${esc(`${label} (${n})`)}"`}>${esc(label)}${
                name === 'health' && troubled ? `<span class="config-bm-tab-dot" aria-label="${esc(this.t('config.bmTabProblem', 'has a problem'))}"></span>` : ''
            }</button>`;
        };
        const pane = (name, body) => `<section class="config-bm-pane" role="tabpanel" data-bm-pane="${name}"${name === tab ? '' : ' hidden'}>${body}</section>`;
        // The form. In the Bookmarks view it is the Details tab's first
        // section; Config's narrow panel column shows it alone.
        const editForm = `<div class="config-bm-panel-section" data-bm-section="edit"><div class="config-bm-panel-fields">
                ${this.renderWorkbenchField('name', this.t('config.bookmarkNameLabel', 'Name'), input('name', b.name))}
                ${this.renderWorkbenchField('url', this.t('config.bmFieldUrl', 'URL'), input('url', b.url, 'spellcheck="false"'))}
                ${this.renderWorkbenchField('page', this.t('config.page', 'Page'), `<select class="config-select" data-bm-field="page">${pageOptions}</select>`)}
                ${this.renderWorkbenchField('category', this.t('config.category', 'Category'), `<select class="config-select" data-bm-field="category">${catOptions}</select>`)}
                ${this.renderWorkbenchField('tags', this.t('config.bmFieldTags', 'Tags'), input('tags', (b.tags || []).join(', ')))}
                <div class="tag-suggest-chips config-bm-tags-suggest" data-bm-suggest hidden></div>
                ${this.renderWorkbenchField('shortcut', this.t('config.bmFieldShortcut', 'Shortcut'), input('shortcut', b.shortcut, 'maxlength="5"'))}
                ${this.renderWorkbenchField('note', this.t('config.bmFieldNote', 'Note'),
                    `<textarea class="config-text" rows="2" data-bm-field="note" data-original="${esc(b.note || '')}">${esc(b.note || '')}</textarea>`)}
                <label class="config-bm-field config-bm-field--inline" data-bm-field-wrap="pinned">
                    <input type="checkbox" data-bm-field="pinned"${b.pinned ? ' checked' : ''}>
                    <span class="config-bm-field-label">${esc(this.t('config.pinnedShort', 'Pinned'))}</span>
                    <span class="config-bm-field-status" role="status"></span>
                </label>
                ${issue ? '' : `
                ${this.renderWorkbenchField('checkMode', this.t('config.bmFieldChecking', 'Checking'), `<select class="config-select" data-bm-field="checkMode">${modeOptions}</select>`)}
                <label class="config-bm-field" data-bm-field-wrap="monitorInterval"${mode === 'monitor' ? '' : ' hidden'}>
                    <span class="config-bm-field-label">${esc(this.t('config.bmFieldInterval', 'Interval'))}</span>
                    <select class="config-select" data-bm-field="monitorInterval">${this.workbenchIntervalOptions(global.CheckMode?.intervalOf?.(b))}</select>
                    <span class="config-bm-field-status" role="status"></span>
                </label>`}
            </div></div>`;
        return `
            <header class="config-bm-panel-head config-bm-panel-head--single">
                <div class="config-bm-panel-heading">
                    <span class="config-bm-panel-icon">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                    <span class="config-bm-panel-title" title="${esc(b.name || b.url || '')}">${esc(b.name || this.formatBookmarkUrlDisplay(b.url))}</span>
                    ${score == null ? '' : `<span class="config-bm-score" data-tone="${scoreTone}">${esc(String(score))}</span>`}
                    <span class="config-bm-more">
                        <button type="button" class="config-btn config-btn--small" data-bm-more-toggle aria-haspopup="menu" aria-expanded="false"
                                aria-label="${esc(this.t('config.bmMoreActions', 'More actions'))}">⋯</button>
                        <div class="config-bm-more-menu" role="menu" data-bm-more-menu hidden>
                            ${this.renderBmHealthActions?.(b, { skip: ['recheck'] }) || ''}
                            <button type="button" class="config-btn config-btn--small" data-bm-panel-action="dashboard">${esc(this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}</button>
                            <button type="button" class="config-btn config-btn--small" data-bm-panel-action="favicon">${esc(this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}</button>
                            <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-panel-action="delete">${esc(this.t('config.delete', 'Delete'))}</button>
                        </div>
                    </span>
                </div>
                ${/^https?:\/\//i.test(String(b.url || '')) ? `<a class="config-bm-panel-url" href="${esc(b.url)}" title="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(this.formatBookmarkUrlDisplay(b.url))}</a>` : ''}
                ${where ? `<p class="config-bm-panel-where" title="${esc(where)}">${esc(where)}</p>` : ''}
                <div class="config-bm-panel-actions">
                    <button type="button" class="config-btn config-btn--primary config-btn--small" data-bm-panel-action="open">${esc(this.t('config.openBookmark', 'Open'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bm-panel-action="edit-dialog"
                            title="${esc(this.t('config.bmEditDialogTitle', 'Open the full edit dialog (Shift+E)'))}">${esc(this.t('config.bmEditShort', 'Edit'))}</button>
                    ${issue ? `<button type="button" class="config-btn config-btn--small" data-bm-health-action="recheck"
                            title="${esc(this.t('config.bmRecheckTitle', 'Check this bookmark now (p)'))}">${esc(this.t('config.bmKeyRecheck', 're-check').replace(/^./, (c) => c.toUpperCase()))}</button>` : ''}
                </div>
            </header>
            <div class="config-bm-tabs" role="tablist" aria-label="${esc(this.t('config.bmDetails', 'Details'))}">
                ${tabButton('details', this.t('config.bmTabDetails', 'Details'), 1)}
                ${tabButton('health', this.t('config.bmHealth', 'Health'), 2)}
                ${tabButton('usage', this.t('config.bmUsage', 'Usage'), 3)}
            </div>
            ${pane('details', `
                ${this.renderBmDetailsSummary?.(b) || ''}
                <div class="config-bm-acc-list">
                ${this.workbenchAcc('details', 'edit', this.t('config.bmSectionEdit', 'Edit'), this.t('config.bmDetailsSavesAsYouGo', 'saves as you go'),
                    `${editForm}`, true)}
                ${this.workbenchAcc('details', 'address', this.t('config.bmDetailsAddress', 'Address'),
                    this.formatBookmarkUrlDisplay(b.url), this.renderBmDetailsAddress?.(b) || '')}
                ${this.workbenchAcc('details', 'preview', this.t('config.bmDetailsPreviewIcon', 'Preview & icon'),
                    String(b.previewTitle || '').trim() ? this.t('config.bmDetailsFetched', 'fetched') : this.t('config.bmDetailsNotFetched', 'not fetched'),
                    this.renderBmDetailsPreview?.(b) || '')}
                ${this.workbenchAcc('details', 'copies', this.t('config.bmDetailsCopies', 'Local copies'), '…', this.renderBmDetailsCopies?.(b) || '')}
                ${this.workbenchAcc('details', 'remove', this.t('config.bmDetailsRemove', 'Remove'), '',
                    `<div class="config-bm-details-buttons"><button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-panel-action="delete">${esc(this.t('config.bmDetailsDelete', 'Delete bookmark'))}</button></div>
                     <p class="config-bm-panel-muted">${esc(this.t('config.bmDetailsDeleteHint', 'It goes to the trash; undo is offered right after.'))}</p>`)}
                </div>`)}
            ${pane('health', this.renderBmHealthPane?.(b)
                ? `<div data-bm-section="health">${this.renderBmHealthPane(b)}</div>`
                : `
                <div data-bm-section="health"><div class="lvs-drawer-section-body">
                    <p class="config-bm-panel-fact"><span class="config-bm-health-dot is-${esc(state)}"></span> ${esc(this.railHealthLabel(state))}</p>
                    ${facts?.lastError ? `<p class="config-bm-panel-muted">${esc(facts.lastError)}</p>` : ''}
                    ${facts?.uptime7d != null ? `<p class="config-bm-panel-muted">${esc(this.t('config.bmUptime7d', '{pct}% up this week').replace('{pct}', String(Math.round(facts.uptime7d * 100))))}</p>` : ''}</div></div>`)}
            ${pane('usage', this.renderBmUsagePane?.(b) || `
                <p class="config-bm-panel-muted">${esc(this.bookmarkUsageTooltip(b))}</p>`)}`;
    },

    /**
     * One section of a tab's accordion, in the Health tab's markup: its head
     * says its answer, and which sections are open is remembered per tab.
     */
    workbenchAcc(group, name, label, answer, body, openByDefault = false) {
        const esc = (v) => this.dash.escapeHtml(v);
        let stored = null;
        try {
            stored = JSON.parse(global.localStorage?.getItem(`nextdash.bm.acc.${group}`) || 'null');
        } catch {
            stored = null;
        }
        const open = Array.isArray(stored) ? stored.includes(name) : openByDefault;
        return `<details class="config-bm-acc" data-bm-acc="${name}" data-bm-acc-group="${group}"${open ? ' open' : ''}>
                <summary><span>${esc(label)}</span><span class="config-bm-acc-answer">${esc(answer)}</span></summary>
                <div class="lvs-drawer-section-body">${body}</div>
            </details>`;
    },

    /* ── The panel's tabs ──────────────────────────────────────────────── */

    /** Which tab the panel shows; the reader's last choice, kept across rows. */
    workbenchPanelTab() {
        try {
            const tab = global.localStorage?.getItem(PANEL_TAB_KEY);
            return PANEL_TABS.includes(tab) ? tab : PANEL_TABS[0];
        } catch {
            return PANEL_TABS[0];
        }
    },

    /** Show one tab, in place: the panel is not redrawn, so nothing typed is lost. */
    setWorkbenchPanelTab(tab) {
        if (!PANEL_TABS.includes(tab)) return false;
        try {
            global.localStorage?.setItem(PANEL_TAB_KEY, tab);
        } catch {
            // Private window: the choice lasts until the panel is redrawn.
        }
        const panel = this._libPanel || document.getElementById('config-bm-panel');
        if (!panel) return false;
        panel.querySelectorAll('[data-bm-tab-panel]').forEach((btn) => {
            const on = btn.dataset.bmTabPanel === tab;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        });
        panel.querySelectorAll('[data-bm-pane]').forEach((pane) => {
            pane.hidden = pane.dataset.bmPane !== tab;
        });
        return true;
    },

    /** `[` / `]`: the next or previous tab. */
    stepWorkbenchPanelTab(delta) {
        const at = PANEL_TABS.indexOf(this.workbenchPanelTab());
        const next = PANEL_TABS[(at + delta + PANEL_TABS.length) % PANEL_TABS.length];
        return this.setWorkbenchPanelTab(next);
    },

    /**
     * The panel's keys, in the Bookmarks view while its side panel shows one
     * bookmark: 1 2 3 and [ ]. Anywhere else the digits keep their meaning
     * across the app -- a page of the dashboard -- and [ ] Config's sub-tabs.
     */
    handleWorkbenchPanelTabKey(e) {
        if (!this._libDrawer?.isOpen() || this.workbenchPanelMode() !== 'single') return false;
        if (e.ctrlKey || e.metaKey || e.altKey) return false;
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return false;
        let done = false;
        if (e.key >= '1' && e.key <= String(PANEL_TABS.length)) done = this.setWorkbenchPanelTab(PANEL_TABS[Number(e.key) - 1]);
        else if (e.key === '[' || e.key === ']') done = this.stepWorkbenchPanelTab(e.key === ']' ? 1 : -1);
        if (!done) return false;
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
    },

    /** Close the ⋯ menu, if it is open; true when there was one to close. */
    closeWorkbenchMoreMenu() {
        const panel = this._libPanel || document.getElementById('config-bm-panel');
        const menu = panel?.querySelector('[data-bm-more-menu]:not([hidden])');
        if (!menu) return false;
        menu.hidden = true;
        panel.querySelector('[data-bm-more-toggle]')?.setAttribute('aria-expanded', 'false');
        return true;
    },

    repaintWorkbenchPanel() {
        // In the Bookmarks view the panel lives in the side panel, which is
        // out of the document while closed; it is still the one to draw.
        const panel = this._libPanel || document.getElementById('config-bm-panel');
        if (!panel) return;
        // A save in flight owns the panel until it lands: repainting now would
        // take the field (and what was typed into it) away mid-write.
        if (this._bmPanelSaving) {
            this._bmPanelRepaintQueued = true;
            return;
        }
        const mode = this.workbenchPanelMode();
        const key = mode === 'single' ? this.workbenchPanelKey() : '';
        const sig = this.workbenchPanelSig(mode, key);
        // Typing in the panel while the list repaints around it must not lose
        // the field; the same bookmark in the same mode is left alone.
        if (panel.dataset.bmPanelSig === sig && panel.contains(document.activeElement)) {
            this.syncLibraryDrawer();
            return;
        }
        this.detachWorkbenchTagAutocomplete(panel);
        panel.innerHTML = this.renderWorkbenchPanel();
        this.attachWorkbenchTagAutocomplete(panel);
        panel.dataset.bmPanelSig = sig;
        panel.dataset.bmPanelMode = mode;
        panel.dataset.bmPanelKey = key || '';
        // After the key: the Health parts find their bookmark by it.
        this.bindBmHealthPanel?.(panel);
        void this.fillWorkbenchSuggestions(panel);
        if (mode === 'single') {
            const b = this.findBookmarkByKey(key);
            void this.fillBmDetailsCopies?.(panel, b);
            void this.fillBmDetailsPreview?.(panel, b);
        }
        if (mode === 'bulk') void this.fillWorkbenchBulkSuggestions(panel);
        this.syncWorkbenchToolbar();
        this.syncLibraryDrawer();
    },

    /* ── The Bookmarks view's panel ─────────────────────────────────────── */

    /*
     * In the Bookmarks view the panel works the way Containers' does: the
     * shared side panel (ListViewDrawer) over the right of the page, closed
     * until a row is clicked, with × and Escape to close it, fullscreen on a
     * phone. Moving the cursor with j/k leaves it as it is; a selection of
     * several rows always opens it, since that is where their form is.
     *
     * The panel element itself is the workbench's own #config-bm-panel,
     * moved into the side panel rather than rebuilt there, so everything
     * bound to it and every lookup by its id keep working.
     */
    libraryDrawer() {
        if (!this._libDrawer && typeof global.ListViewDrawer === 'function') {
            this._libDrawer = new global.ListViewDrawer({
                id: 'library',
                storageKey: 'nextdash.library.drawer',
                closeLabel: this.t('config.bmCloseDetails', 'Close'),
                onClose: () => this.onLibraryDrawerClosed(),
                // A press beside the panel closes it; one on a row, or on a
                // row's tick box, moves it there instead.
                closeOnOutside: (target) => !target.closest('#config-bm-list .config-bm-row'),
            });
        }
        return this._libDrawer || null;
    },

    /** Take the freshly drawn panel out of the layout; the side panel shows it. */
    adoptLibraryPanel(panel) {
        if (!panel) return;
        this._libPanel = panel;
        panel.remove();
    },

    /** Open or close the side panel to match the cursor, the selection and the reader's wish. */
    syncLibraryDrawer() {
        if (!this.isActiveView()) return;
        const drawer = this.libraryDrawer();
        const panel = this._libPanel;
        if (!drawer || !panel) return;
        const mode = this.workbenchPanelMode();
        const want = mode === 'bulk' || (mode === 'single' && this._libDrawerWanted);
        if (want) {
            if (!drawer.isOpen() || !drawer.panel?.contains(panel)) {
                drawer.open('library', {
                    build: (slab, ctx) => {
                        slab.classList.add('config-bm-drawer');
                        // The panel carries its own title; the side panel's
                        // heading would say it twice.
                        ctx.heading.hidden = true;
                        slab.appendChild(panel);
                    },
                });
            }
        } else if (drawer.isOpen()) {
            drawer.close({ silent: true });
        }
    },

    /** × on the side panel: closed until the next click; a selection is dropped with it. */
    onLibraryDrawerClosed() {
        this._libDrawerWanted = false;
        if (this.bmSelected.size > 1) {
            this.bmSelected.clear();
            this.afterSelectionChange();
        }
    },

    /** The first Escape in the view: close the side panel, if it is open. */
    closeLibraryDrawer() {
        const drawer = this._libDrawer;
        if (!drawer?.isOpen()) return false;
        drawer.close();
        return true;
    },

    /**
     * The engine's answer for the bookmark in the panel, under its tags.
     *
     * The same offers the edit form makes -- the collection as evidence, the
     * words stored for the address as the last source -- and taking one
     * saves it straight away, like every other field in the panel. Only the
     * single-bookmark panel has the host; a selection gets none.
     */
    async fillWorkbenchSuggestions(panel) {
        const host = panel?.querySelector('[data-bm-suggest]');
        const key = panel?.dataset.bmPanelKey;
        const b = key ? this.findBookmarkByKey(key) : null;
        const live = global.TagSuggestLive;
        const chips = global.TagSuggestChips;
        if (!host || !b || !live || !chips) return;
        await live.ensureCatalogue();
        const url = String(b.url || '').trim();
        const keywords = (await live.storedKeywords())[url] || [];
        // The panel may have moved on to another bookmark while this waited.
        if (!host.isConnected || panel.dataset.bmPanelKey !== key) return;
        const field = panel.querySelector('[data-bm-field="tags"]');
        const current = () => String(field?.value || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        const offers = live.forDraft(this.dash, { url, tags: current(), keywords });
        chips.render(host, offers, {
            limit: 3,
            label: this.t('config.tagSuggestLabel', 'suggested'),
            t: (k, fallback, params) => this.dash.formatDashboardLabel(k.replace(/^dashboard\./, ''), params || {}, fallback),
            onAccept: async (tag) => {
                if (!field) return;
                const tags = current();
                if (!tags.includes(tag)) tags.push(tag);
                field.value = tags.join(', ');
                await this.commitWorkbenchField(field, key);
                live.changed(this.dash);
                if (field.isConnected) field.focus({ preventScroll: true });
                void this.fillWorkbenchSuggestions(panel);
            },
            onRefuse: (offer) => {
                void chips.refuse(this.dash, offer, { onUpdated: () => { void this.fillWorkbenchSuggestions(panel); } });
            },
        });
    },

    /**
     * The engine's offers for a selection, pooled, the tags most of the
     * selected bookmarks share first -- the pooling the dashboard's
     * multi-select tag popover does (dashboard-multi-select.js).
     *
     * One engine run over the collection with the words the scan stored, the
     * run the Tag suggestions tab makes, rather than one per ticked bookmark:
     * the same answers the single-bookmark panel gives, at the cost of one
     * run whatever the size of the selection. Taking one writes it into the
     * bulk tags field rather than saving, so Apply stays the one step that
     * changes twenty bookmarks at once.
     */
    async fillWorkbenchBulkSuggestions(panel) {
        const host = panel?.querySelector('[data-bm-bulk-suggest]');
        const field = panel?.querySelector('[data-bm-bulk-field="tags"]');
        const live = global.TagSuggestLive;
        const chips = global.TagSuggestChips;
        const engine = global.TagSuggestions?.suggest;
        if (!host || !field || !live || !chips || !engine) return;
        await live.ensureCatalogue();
        const byUrl = await live.storedKeywords();
        if (!host.isConnected || panel.dataset.bmPanelMode !== 'bulk') return;
        const keywords = {};
        (this.dash.allBookmarks || []).forEach((b) => {
            const words = byUrl[String(b.url || '').trim()];
            if (words?.length) keywords[this.bookmarkKey(b)] = words;
        });
        let groups = [];
        try {
            groups = engine(this.tagSuggestionItems(), {
                rules: this.dash.settings?.tagRules || [],
                catalogue: global.TagCatalogue?.now?.() || [],
                dismissed: this.dash.settings?.dismissedTagSuggestions || [],
                keywords,
            });
        } catch {
            groups = [];
        }
        const typed = () => String(field.value || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
        const selected = this.bmSelected;
        const offeredTo = new Map();
        groups.forEach((group) => {
            const count = (group.keys || []).filter((key) => selected.has(key)).length;
            if (!count) return;
            const seen = offeredTo.get(group.tag);
            if (seen) seen.count += count;
            else offeredTo.set(group.tag, { offer: { tag: group.tag, pattern: group.pattern, reason: group.reason }, count });
        });
        const already = new Set(typed());
        const offers = [...offeredTo.entries()]
            .filter(([tag]) => !already.has(tag))
            .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
            .map(([, entry]) => entry.offer);
        chips.render(host, offers, {
            limit: 3,
            label: this.t('config.tagSuggestLabel', 'suggested'),
            t: (k, fallback, params) => this.dash.formatDashboardLabel(k.replace(/^dashboard\./, ''), params || {}, fallback),
            onAccept: (tag) => {
                const tags = typed();
                if (!tags.includes(tag)) tags.push(tag);
                field.value = tags.join(', ');
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.focus({ preventScroll: true });
                void this.fillWorkbenchBulkSuggestions(panel);
            },
            onRefuse: (offer) => {
                void chips.refuse(this.dash, offer, { onUpdated: () => { void this.fillWorkbenchBulkSuggestions(panel); } });
            },
        });
    },

    workbenchPanelSig(mode, key) {
        const bulk = mode === 'bulk' ? [...this.bmSelected].sort().join(',') + JSON.stringify(this._bmBulkDraft || {}) : '';
        return `${mode}|${key}|${bulk}|${(this.dash.allBookmarks || []).length}|${this._bmHealthGen || 0}`;
    },

    /**
     * Tag suggestions on the panel's tag fields, as the edit dialog has them.
     * The dropdown lives on document.body, so the old inputs are let go
     * before a repaint throws them away.
     */
    attachWorkbenchTagAutocomplete(panel) {
        const TA = global.TagAutocomplete;
        if (!TA) return;
        panel.querySelectorAll('[data-bm-field="tags"], [data-bm-bulk-field="tags"]').forEach((input) => {
            const pool = new Set();
            (this.dash.allBookmarks || []).forEach((b) =>
                (b.tags || []).forEach((t) => pool.add(String(t).toLowerCase())));
            TA.attach(input, () => {
                input.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).forEach((t) => pool.add(t));
                return [...pool];
            });
        });
    },

    detachWorkbenchTagAutocomplete(panel) {
        const TA = global.TagAutocomplete;
        if (!TA) return;
        panel.querySelectorAll('[data-bm-field="tags"], [data-bm-bulk-field="tags"]').forEach((input) => TA.detach(input));
    },

    /**
     * Fold or unfold the panel. Only the reader's own toggle (the button, `i`)
     * is remembered; `e` and a multi-row selection open it for now without
     * overwriting that choice.
     */
    /** `i`: the side panel, for the row under the cursor, opened or closed. */
    toggleWorkbenchPanel(force) {
        this._libDrawerWanted = typeof force === 'boolean' ? !force : !this._libDrawer?.isOpen();
        if (!this._libDrawerWanted) this.closeLibraryDrawer();
        else this.repaintWorkbenchPanel();
    },

    focusWorkbenchPanel(key) {
        if (key) this._bmKeyboardKey = key;
        this._libDrawerWanted = true;
        this.repaintWorkbenchPanel();
        const field = document.querySelector('#config-bm-panel [data-bm-field="name"], #config-bm-panel [data-bm-field]');
        field?.focus();
        field?.select?.();
    },

    /** Read a field into a patch for saveBookmarkFields, or null when nothing changed. */
    workbenchFieldPatch(el) {
        const name = el.getAttribute('data-bm-field');
        if (el.type === 'checkbox') return { [name]: el.checked };
        const value = el.value;
        if ((el.getAttribute('data-original') ?? null) === value) return null;
        if (name === 'tags') {
            return { tags: [...new Set(value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))] };
        }
        return { [name]: value };
    },

    setWorkbenchFieldStatus(el, message, isError) {
        const wrap = el.closest('.config-bm-field');
        if (!wrap) return;
        wrap.classList.toggle('is-error', Boolean(isError));
        const status = wrap.querySelector('.config-bm-field-status');
        if (status) status.textContent = message || '';
    },

    /**
     * Save one panel field. `key` is the bookmark the field belonged to when
     * it was left, which is not the panel's any more if a row click has
     * swapped the panel out in the meantime; the detached field still holds
     * what was typed.
     */
    async commitWorkbenchField(el, key = document.getElementById('config-bm-panel')?.dataset.bmPanelKey) {
        const name = el.getAttribute('data-bm-field');
        if (!key || !name) return;
        const b = this.findBookmarkByKey(key);
        if (!b) return;
        if (name === 'shortcut') {
            const owner = this.findShortcutOwner(el.value, key);
            if (owner) {
                this.setWorkbenchFieldStatus(el, this.t('config.bookmarkShortcutTaken', '“{key}” is already {name}')
                    .replace('{key}', String(el.value || '').trim().toUpperCase())
                    .replace('{name}', owner.name || owner.url || ''), true);
                return;
            }
        }
        const live = el.isConnected;
        let run;
        if (name === 'page') {
            if (String(el.value) === String(b.pageId)) return;
            this._bmPendingFocus = { pageId: String(el.value), index: -1 };
            run = this.bulkMove([b], { pageId: el.value, category: b.category || '', keepSelection: true })
                .then(() => true, () => false);
        } else if (name === 'checkMode') {
            run = this.setBookmarkCheckMode(key, el.value);
        } else if (name === 'monitorInterval') {
            run = this.setBookmarkCheckMode(key, 'monitor', Number(el.value));
        } else {
            const patch = this.workbenchFieldPatch(el);
            if (!patch) return;
            if (name === 'category' && el.value) {
                run = this.ensureCategoryOnPage(b.pageId, el.value)
                    .then(() => this.saveBookmarkFields(key, patch), () => false);
            } else {
                run = this.saveBookmarkFields(key, patch);
            }
        }
        this.setWorkbenchFieldStatus(el, '', false);
        this._bmPanelSaving = run;
        const ok = await run;
        this._bmPanelSaving = null;
        if (!ok) {
            if (live) {
                this._bmPendingFocus = null;
                this._bmKeyboardKey = key;
            }
            this.setWorkbenchFieldStatus(el, this.t('config.bmNotSaved', 'Not saved — retry'), true);
            this._bmPanelRepaintQueued = false;
            return;
        }
        // What was saved is what Escape goes back to from now on.
        if (el.hasAttribute('data-original')) el.setAttribute('data-original', el.value);
        if (this._bmPanelRepaintQueued) {
            this._bmPanelRepaintQueued = false;
            this.settleWorkbenchPanel(el);
        }
    },

    /**
     * Bring the panel up to date after a save.
     *
     * When the reader has already moved on to another text field the fields
     * stay where they are — a repaint would take the one being typed in — and
     * only the panel's bookmark and title follow. Otherwise the panel is
     * redrawn and focus goes back to the field that had it.
     */
    settleWorkbenchPanel(saved) {
        const panel = document.getElementById('config-bm-panel');
        if (!panel) return;
        const active = document.activeElement;
        const typing = active !== saved && panel.contains(active)
            && active.matches('input[data-bm-field]:not([type="checkbox"]), textarea[data-bm-field]');
        if (typing && panel.dataset.bmPanelMode === 'single' && this.workbenchPanelMode() === 'single') {
            const key = this.workbenchPanelKey();
            const b = this.findBookmarkByKey(key);
            panel.dataset.bmPanelKey = key;
            panel.dataset.bmPanelSig = this.workbenchPanelSig('single', key);
            const title = panel.querySelector('.config-bm-panel-title');
            if (title) title.textContent = b.name || this.formatBookmarkUrlDisplay(b.url);
            return;
        }
        const focused = panel.contains(active) ? active.getAttribute('data-bm-field') : null;
        panel.dataset.bmPanelSig = '';
        this.repaintWorkbenchPanel();
        if (focused) panel.querySelector(`[data-bm-field="${focused}"]`)?.focus();
    },

    bindWorkbenchPanel(panel) {
        if (!panel || panel.dataset.bmPanelWired === '1') return;
        panel.dataset.bmPanelWired = '1';
        // toggle does not bubble; captured here so every repaint's sections
        // report without a listener each.
        // The Details and Usage accordions remember what the reader opens.
        panel.addEventListener('toggle', (e) => {
            const acc = e.target.closest?.('[data-bm-acc-group]');
            if (!acc || acc !== e.target) return;
            const group = acc.getAttribute('data-bm-acc-group');
            const open = [...panel.querySelectorAll(`[data-bm-acc-group="${group}"][open]`)].map((d) => d.getAttribute('data-bm-acc'));
            try {
                global.localStorage?.setItem(`nextdash.bm.acc.${group}`, JSON.stringify(open));
            } catch {
                // Private window: the choice lasts until the next bookmark.
            }
        }, true);
        panel.addEventListener('toggle', (e) => {
            const section = e.target.closest?.('[data-bm-section]');
            if (!section || section !== e.target) return;
            const open = this.workbenchOpenSections();
            if (section.open) open.add(section.dataset.bmSection);
            else open.delete(section.dataset.bmSection);
            try {
                global.localStorage?.setItem(SECTIONS_KEY, JSON.stringify([...open]));
            } catch {
                // Storage unavailable: sections just stop remembering.
            }
        }, true);
        panel.addEventListener('click', (e) => {
            const usageShow = e.target.closest('[data-bm-usage-show]');
            if (usageShow) {
                // "Show the ones never opened": the rail's own view for them.
                const view = usageShow.getAttribute('data-bm-usage-show');
                if (this.bmCleanupFilter !== view) this.toggleRailFilter('cleanup', view);
                return;
            }
            const read = e.target.closest('[data-bm-copy-read]');
            if (read) {
                global.open(read.getAttribute('data-bm-copy-read'), '_blank', 'noopener,noreferrer');
                return;
            }
            if (e.target.closest('[data-bm-copy-save]')) {
                const b = this.findBookmarkByKey(panel.dataset.bmPanelKey);
                if (b) void this.saveBmLocalCopy?.(b);
                return;
            }
            if (e.target.closest('[data-bm-details-checking]')) {
                // Checking is set on the Health tab: take the reader there.
                this.setWorkbenchPanelTab('health');
                this.openBmHealthAcc?.('checking')?.querySelector('[data-check-mode]')?.focus();
                return;
            }
            const tabBtn = e.target.closest('[data-bm-tab-panel]');
            if (tabBtn) {
                this.setWorkbenchPanelTab(tabBtn.dataset.bmTabPanel);
                return;
            }
            const more = e.target.closest('[data-bm-more-toggle]');
            if (more) {
                const menu = panel.querySelector('[data-bm-more-menu]');
                if (menu) {
                    menu.hidden = !menu.hidden;
                    more.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
                }
                return;
            }
            // An item in the menu does its work (bound below or per button)
            // and takes the menu down with it; a press elsewhere does too.
            this.closeWorkbenchMoreMenu();
            // The address in the head is a real link and opens itself; the
            // open is counted like any other.
            if (e.target.closest('a.config-bm-panel-url') && panel.dataset.bmPanelKey) {
                this.recordBookmarkOpenByKey(panel.dataset.bmPanelKey);
                return;
            }
            const action = e.target.closest('[data-bm-panel-action]')?.getAttribute('data-bm-panel-action');
            const key = panel.dataset.bmPanelKey;
            if (!action || !key) return;
            if (action === 'open') this.openBookmarkByKey(key);
            else if (action === 'edit-dialog') void this.openBookmarkEditModal(key);
            else if (action === 'delete') void this.deleteBookmarkByKey(key);
            else this.handleBookmarkMenuAction(action, key);
        });
        // Selects and the checkbox save on change; text on leaving the field.
        panel.addEventListener('change', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            // The interval belongs to Monitor alone; shown as soon as it is picked.
            if (el.getAttribute('data-bm-field') === 'checkMode') {
                const wrap = panel.querySelector('[data-bm-field-wrap="monitorInterval"]');
                if (wrap) wrap.hidden = el.value !== 'monitor';
            }
            if (el.tagName === 'SELECT' || el.type === 'checkbox') void this.commitWorkbenchField(el);
        });
        panel.addEventListener('focusout', (e) => {
            const el = e.target.closest('input[data-bm-field]:not([type="checkbox"]), textarea[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            if (el._tagAutocomplete?._dropdown) {
                // Suggestions are still up: let them close first, and save only
                // if focus has not come back to the field in the meantime. The
                // key is taken now, while the panel still shows this bookmark.
                const key = panel.dataset.bmPanelKey;
                setTimeout(() => {
                    if (el.isConnected && document.activeElement === el) return;
                    void this.commitWorkbenchField(el, key);
                }, 150);
                return;
            }
            void this.commitWorkbenchField(el);
        });
        panel.addEventListener('keydown', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el) return;
            e.stopPropagation();
            // The suggestion dropdown already used this key.
            if (e.defaultPrevented) return;
            if (e.key === 'Enter' && el.tagName === 'INPUT') {
                e.preventDefault();
                el.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                if (el.hasAttribute('data-original')) el.value = el.getAttribute('data-original');
                this.setWorkbenchFieldStatus(el, '', false);
                // Back to the row, without a save: the value is the old one.
                el.removeAttribute('data-bm-field');
                el.blur();
                const row = [...document.querySelectorAll('#config-bm-list .config-bm-row')]
                    .find((r) => this.bookmarkRowKey(r) === panel.dataset.bmPanelKey);
                row?.focus({ preventScroll: true });
                document.getElementById('config-bm-panel').dataset.bmPanelSig = '';
                this.repaintWorkbenchPanel();
            }
        });
    },

    bulkDraft() {
        const sig = [...this.bmSelected].sort().join('\n');
        if (this._bmBulkDraftSig !== sig) {
            this._bmBulkDraftSig = sig;
            this._bmBulkDraft = {};
        }
        return this._bmBulkDraft;
    },

    renderWorkbenchBulkPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const M = global.BookmarkWorkbenchModel;
        const picked = this.bookmarksFromKeys([...this.bmSelected]);
        const n = picked.length;
        const draft = this.bulkDraft();
        const mixed = esc(this.t('config.bmMixed', 'mixed'));
        const field = (label, control, cls = '') => `
            <div class="config-bm-field ${cls}">
                <span class="config-bm-field-label">${esc(label)}</span>
                ${control}
            </div>`;

        const page = M.sharedValue(picked.map((b) => String(b.pageId)));
        const pageValue = draft.pageId ?? (page.mixed ? '' : page.value);
        // The unsorted page is not in d.pages, so a selection that is entirely
        // kept bookmarks had nothing to sit on and read as "mixed" -- which is
        // exactly what it is not. Listed only when that is where they are:
        // moving a filed bookmark *into* Unsorted is not what this panel is
        // for, and the category list below would have nothing to offer it.
        const unsortedPageId = String(global.UnsortedPage?.PAGE_ID ?? '');
        const keptOption = unsortedPageId && String(pageValue) === unsortedPageId
            ? `<option value="${esc(unsortedPageId)}" selected>${esc(this.t('config.bmViewUnsorted', 'Unsorted'))}</option>`
            : '';
        const pageOptions = [`<option value="">${mixed}</option>`, keptOption]
            .concat((this.dash.pages || []).map((p) =>
                `<option value="${esc(p.id)}"${String(p.id) === String(pageValue) ? ' selected' : ''}>${esc(p.name || p.id)}</option>`))
            .join('');

        const cat = M.sharedValue(picked.map((b) => b.category || ''));
        const catValue = draft.category ?? (cat.mixed ? null : cat.value);
        const catScope = draft.pageId ? [{ pageId: draft.pageId }] : picked;
        const known = this.bulkKnownCategories(catScope).map((c) => ({
            id: global.DashboardConfig.parseCategoryFilter(c.id).categoryId,
            label: c.label,
        }));
        // A chosen category stays listed after the target page changes: the
        // move carries it there even when that page has never used it.
        if (catValue && !known.some((c) => c.id === catValue)) {
            known.push({ id: catValue, label: this.railCategoryLabel(picked[0]?.pageId, catValue) });
        }
        const catOptions = [`<option value="__keep__"${catValue === null ? ' selected' : ''}>${mixed}</option>`,
            `<option value=""${catValue === '' ? ' selected' : ''}>${esc(this.t('config.bmNoCategory', 'No category'))}</option>`]
            .concat(known.map((c) =>
                `<option value="${esc(c.id)}"${c.id === catValue ? ' selected' : ''}>${esc(c.label)}</option>`))
            .join('');

        const tagCounts = M.tagCounts(picked)
            .map(([t, k]) => `<span class="config-bm-tag">${esc(t)} <span class="config-bm-rail-count">${k}</span></span>`)
            .join('');
        const tagsMode = draft.tags?.mode || 'add';
        const modeButtons = [
            ['add', this.t('config.bulkTagsAdd', 'Add')],
            ['replace', this.t('config.bulkTagsReplace', 'Replace')],
            ['remove', this.t('config.bulkTagsRemove', 'Remove')],
        ].map(([v, l]) => `<button type="button" data-bm-bulk-field="tagsMode" data-value="${v}"
                aria-pressed="${tagsMode === v ? 'true' : 'false'}">${esc(l)}</button>`).join('');

        const pinnedCount = picked.filter((b) => b.pinned === true).length;
        const pinSummary = pinnedCount === 0 || pinnedCount === n
            ? this.t(pinnedCount ? 'config.bmAllPinned' : 'config.bmNonePinned', pinnedCount ? 'all pinned' : 'none pinned')
            : this.t('config.bmSomePinned', '{k} of {n} pinned').replace('{k}', String(pinnedCount)).replace('{n}', String(n));

        const modeShared = M.sharedValue(picked.map((b) => global.CheckMode?.of?.(b) || 'off'));
        const modeValue = draft.checkMode ?? (modeShared.mixed ? '' : modeShared.value);
        const modeOptions = [`<option value="">${mixed}</option>`]
            .concat(this.workbenchCheckModeOptions().map((o) =>
                `<option value="${esc(o.mode)}"${o.mode === modeValue ? ' selected' : ''}>${esc(o.label)}</option>`))
            .join('');

        const intervalShared = M.sharedValue(picked.map((b) => global.CheckMode?.intervalOf?.(b)));
        const intervalValue = draft.monitorInterval ?? (intervalShared.mixed ? '' : intervalShared.value);
        const intervalField = modeValue === 'monitor'
            ? field(this.t('config.bmFieldInterval', 'Interval'),
                `<select class="config-select" data-bm-bulk-field="monitorInterval">${this.workbenchIntervalOptions(intervalValue, { mixed: intervalShared.mixed })}</select>`)
            : '';

        const hidden = this.hiddenSelectionCount();
        const states = picked.reduce((acc, b) => {
            const s = this.bookmarkHealthState(b);
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {});
        const health = global.DashboardConfig.HEALTH_STATES.filter((k) => states[k])
            .map((k) => `<span><span class="config-bm-health-dot is-${k}"></span> ${states[k]} ${esc(this.railHealthLabel(k).toLowerCase())}</span>`)
            .join(' · ');
        const dirty = Object.keys(draft).length > 0;
        const healthBulk = this.renderBmHealthBulkActions?.() || '';

        return `
            <header class="config-bm-panel-head">
                <span class="config-bm-panel-title">${esc(this.t('config.bmBulkTitle', '{n} bookmarks').replace('{n}', String(n)))}</span>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="clear">${esc(this.t('config.bulkClearSelection', 'Clear selection'))}</button>
            </header>
            ${hidden ? `<p class="config-bm-bulk-hidden">${esc(this.t('config.bmHiddenByFilter', '{n} hidden by the filter — still included').replace('{n}', String(hidden)))}
                <button type="button" class="config-bm-rail-more" data-bm-bulk-action="keep-visible">${esc(this.t('config.bulkKeepVisible', 'Select only these'))}</button></p>` : ''}
            <div class="config-bm-panel-fields">
                ${field(this.t('config.page', 'Page'), `<select class="config-select" data-bm-bulk-field="page">${pageOptions}</select>`)}
                ${field(this.t('config.category', 'Category'), `<select class="config-select" data-bm-bulk-field="category">${catOptions}</select>`)}
                ${field(this.t('config.bmFieldTags', 'Tags'), `
                    <div class="config-bm-bulk-tagcounts">${tagCounts || `<span class="config-bm-panel-muted">${esc(this.t('config.bmNoTags', 'no tags'))}</span>`}</div>
                    <div class="config-bm-segmented" role="group">${modeButtons}</div>
                    <input type="text" class="config-text" data-bm-bulk-field="tags"
                           value="${esc((draft.tags?.list || []).join(', '))}"
                           placeholder="${esc(this.t('config.detailTagsPlaceholder', 'work, dev, personal…'))}">
                    <div class="tag-suggest-chips config-bm-tags-suggest" data-bm-bulk-suggest hidden></div>`)}
                ${field(this.t('config.pinnedShort', 'Pinned'), `
                    <span class="config-bm-panel-muted">${esc(pinSummary)}</span>
                    <span class="config-bm-segmented" role="group">
                        <button type="button" data-bm-bulk-pin="true" aria-pressed="${draft.pinned === true}">${esc(this.t('config.bmPinAll', 'Pin all'))}</button>
                        <button type="button" data-bm-bulk-pin="false" aria-pressed="${draft.pinned === false}">${esc(this.t('config.bmUnpinAll', 'Unpin all'))}</button>
                    </span>`, 'config-bm-bulk-pinned')}
                ${field(this.t('config.bmFieldChecking', 'Checking'), `<select class="config-select" data-bm-bulk-field="checkMode">${modeOptions}</select>`)}
                ${intervalField}
            </div>
            ${health || healthBulk ? `<section class="config-bm-panel-facts"><h3>${esc(this.t('config.bmHealth', 'Health'))}</h3>${health ? `<p>${health}</p>` : ''}${healthBulk}</section>` : ''}
            <footer class="config-bm-panel-foot">
                <button type="button" class="config-btn config-btn--primary config-btn--small" data-bm-bulk-action="apply"${dirty ? '' : ' disabled'}>${esc(this.t('config.bmApplyTo', 'Apply to {n}').replace('{n}', String(n)))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="export">${esc(this.t('config.bulkExportCsv', 'Export CSV'))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="favicons"
                        title="${esc(this.t('config.bulkIconsHint', 'Ask each site for its icon, for the ticked rows that have none'))}">${
                    esc(this.t('config.bulkFetchIcons', 'Fetch icons ({k})')
                        .replace('{k}', String(this.bulkFetchTargets(picked, 'icons').length)))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-bulk-action="previews"
                        title="${esc(this.t('config.bulkPreviewsHint', 'Ask each page for its title, description and image, for the ticked rows that have none'))}">${
                    esc(this.t('config.bulkFetchPreviews', 'Fetch previews ({k})')
                        .replace('{k}', String(this.bulkFetchTargets(picked, 'previews').length)))}</button>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-bulk-action="delete">${esc(this.t('config.bmDeleteN', 'Delete {n}').replace('{n}', String(n)))}</button>
            </footer>`;
    },

    /** Record one bulk control into the draft; returns true when the panel must redraw. */
    readBulkControl(el) {
        const draft = this.bulkDraft();
        const name = el.getAttribute('data-bm-bulk-field');
        if (name === 'page') {
            if (el.value) draft.pageId = el.value; else delete draft.pageId;
            return true;
        }
        if (name === 'category') {
            if (el.value === '__keep__') delete draft.category; else draft.category = el.value;
            return false;
        }
        if (name === 'checkMode') {
            if (el.value) draft.checkMode = el.value;
            else {
                // Back to mixed: an interval picked for Monitor goes with it.
                delete draft.checkMode;
                delete draft.monitorInterval;
            }
            // Redrawn so the interval appears or goes with Monitor.
            return true;
        }
        if (name === 'monitorInterval') {
            if (el.value) draft.monitorInterval = Number(el.value); else delete draft.monitorInterval;
            return false;
        }
        if (name === 'tags' || name === 'tagsMode') {
            const mode = name === 'tagsMode' ? el.getAttribute('data-value') : (draft.tags?.mode || 'add');
            const input = el.closest('#config-bm-panel').querySelector('[data-bm-bulk-field="tags"]');
            const list = String(input?.value || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
            if (list.length || mode === 'replace') draft.tags = { mode, list }; else delete draft.tags;
            return name === 'tagsMode';
        }
        return false;
    },

    syncBulkApply() {
        const btn = document.querySelector('#config-bm-panel [data-bm-bulk-action="apply"]');
        if (btn) btn.disabled = Object.keys(this.bulkDraft()).length === 0;
    },

    redrawBulkPanel() {
        const panel = document.getElementById('config-bm-panel');
        if (!panel) return;
        const focused = document.activeElement?.getAttribute?.('data-bm-bulk-field');
        panel.dataset.bmPanelSig = '';
        this.repaintWorkbenchPanel();
        if (focused) panel.querySelector(`[data-bm-bulk-field="${focused}"]`)?.focus();
    },

    async applyWorkbenchBulk() {
        const keys = [...this.bmSelected];
        const picked = this.bookmarksFromKeys(keys);
        const draft = { ...this.bulkDraft() };
        if (!picked.length || !Object.keys(draft).length) return;
        const { pageId, monitorInterval, ...rest } = draft;
        const moving = pageId && picked.some((b) => String(b.pageId) !== String(pageId));
        // A category travels with the move when there is one; otherwise it is
        // an in-place edit like the rest.
        const inPlace = { ...rest };
        if (moving) delete inPlace.category;
        const assign = (b, mode) => {
            b.monitorIntervalMinutes = global.CheckMode.intervalOf?.(b)
                || Number(this.dash?.settings?.defaultMonitorIntervalMinutes) || 15;
            global.CheckMode.assign(b, mode, monitorInterval);
        };
        const M = global.BookmarkWorkbenchModel;
        const base = M.bulkMutation(inPlace, assign);
        // An interval on its own changes only the rows that are monitored.
        const intervalOnly = monitorInterval && !inPlace.checkMode;
        const mutate = intervalOnly
            ? (b) => {
                const next = base(b);
                return global.CheckMode.of(b) === 'monitor' ? M.bulkMutation({ checkMode: 'monitor' }, assign)(next) : next;
            }
            : base;
        try {
            if (Object.keys(inPlace).length || intervalOnly) {
                if (inPlace.category) {
                    for (const pid of new Set(picked.map((b) => String(b.pageId)))) {
                        await this.ensureCategoryOnPage(pid, inPlace.category);
                    }
                }
                const snapshots = await this.mutateSelected(picked, mutate);
                // No undo when a move follows: the snapshot is the source pages
                // before the move, and putting those back would leave the moved
                // copies on the target page as well. The move says it is done.
                if (!moving) {
                    this.notify(this.t('config.bmBulkDone', 'Bookmarks updated.'), 'success', {
                        undoCallback: this.bulkUndo(snapshots, 'config.bmBulkUndone', 'Changes put back.',
                            'config.bulkUndoFailed', 'Could not undo that.'),
                        duration: 8000,
                    });
                }
            }
            if (moving) {
                // In-place edits never change a key (page and URL stay), so the
                // same keys still find the same bookmarks after that refresh.
                // A category left on mixed stays each row's own; "No category"
                // ('') takes it away.
                await this.bulkMove(this.bookmarksFromKeys(keys), {
                    pageId,
                    category: 'category' in rest ? rest.category : null,
                });
            }
        } catch {
            this.notify(this.t('config.bulkActionError', 'Could not apply the bulk action.'), 'error');
            await this.refreshBookmarksAfterWrite();
        }
        this._bmBulkDraft = {};
        this.afterSelectionChange();
    },

    focusWorkbenchBulkField(name) {
        this._libDrawerWanted = true;
        this.redrawBulkPanel();
        this.syncLibraryDrawer();
        document.querySelector(`#config-bm-panel [data-bm-bulk-field="${name}"]`)?.focus();
    },

    bindWorkbenchBulk(panel) {
        if (!panel || panel.dataset.bmBulkWired === '1') return;
        panel.dataset.bmBulkWired = '1';
        panel.addEventListener('click', (e) => {
            if (panel.dataset.bmPanelMode !== 'bulk') return;
            const pin = e.target.closest('[data-bm-bulk-pin]');
            if (pin) {
                const draft = this.bulkDraft();
                const want = pin.getAttribute('data-bm-bulk-pin') === 'true';
                if (draft.pinned === want) delete draft.pinned; else draft.pinned = want;
                this.redrawBulkPanel();
                return;
            }
            const mode = e.target.closest('[data-bm-bulk-field="tagsMode"]');
            if (mode) {
                this.readBulkControl(mode);
                this.redrawBulkPanel();
                return;
            }
            const healthBulk = e.target.closest('[data-bm-health-bulk]');
            if (healthBulk) {
                void this.runBmHealthBulk(healthBulk.getAttribute('data-bm-health-bulk'));
                return;
            }
            const action = e.target.closest('[data-bm-bulk-action]')?.getAttribute('data-bm-bulk-action');
            if (!action) return;
            if (action === 'apply') void this.applyWorkbenchBulk();
            else void this.handleBulkAction(action).then(() => this.afterSelectionChange());
        });
        panel.addEventListener('change', (e) => {
            const el = e.target.closest('[data-bm-bulk-field]');
            if (!el || panel.dataset.bmPanelMode !== 'bulk') return;
            if (this.readBulkControl(el)) this.redrawBulkPanel();
            else this.syncBulkApply();
        });
        panel.addEventListener('input', (e) => {
            const el = e.target.closest('[data-bm-bulk-field="tags"]');
            if (!el || panel.dataset.bmPanelMode !== 'bulk') return;
            this.readBulkControl(el);
            this.syncBulkApply();
        });
        panel.addEventListener('keydown', (e) => {
            const control = e.target.closest('[data-bm-bulk-field]');
            if (control && e.key === 'Escape' && !e.defaultPrevented) {
                // Out of the control first; the next Escape does what it does
                // everywhere else (drawer, then selection).
                e.preventDefault();
                e.stopPropagation();
                control.blur();
                return;
            }
            const el = e.target.closest('[data-bm-bulk-field="tags"]');
            if (!el) return;
            e.stopPropagation();
            if (e.defaultPrevented) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.applyWorkbenchBulk();
            }
        });
    },

    /** The phone's filters sheet: the rail, over the list. */
    openWorkbenchOverlay() {
        const root = document.getElementById('config-bm-workbench');
        if (!root) return;
        this.closeWorkbenchOverlays();
        root.classList.add('is-sheet-open');
        const scrim = root.querySelector('[data-bm-scrim]');
        if (scrim) scrim.hidden = false;
        this._bmOverlayLock = global.ScrollLock?.acquire?.('bm-sheet') || null;
        this._bmOverlayKind = 'sheet';
    },

    /**
     * Leaving the view: everything it laid over the page goes, all at once --
     * the ⋯ menu, the side panel and the phone's filters sheet with its scroll
     * lock. closeWorkbenchOverlays closes one per Escape; this is not a key.
     */
    leaveLibraryView() {
        this.closeWorkbenchMoreMenu();
        this.closeLibraryDrawer();
        while (this.closeWorkbenchOverlays()) { /* until nothing is left */ }
    },

    closeWorkbenchOverlays() {
        if (this.closeWorkbenchMoreMenu()) return true;
        if (this.closeLibraryDrawer()) return true;
        const root = document.getElementById('config-bm-workbench');
        const wasOpen = Boolean(root?.classList.contains('is-sheet-open'));
        root?.classList.remove('is-sheet-open');
        const scrim = root?.querySelector('[data-bm-scrim]');
        if (scrim) scrim.hidden = true;
        if (this._bmOverlayLock) {
            global.ScrollLock?.release?.(this._bmOverlayLock);
            this._bmOverlayLock = null;
        }
        this._bmOverlayKind = null;
        if (wasOpen) this.syncWorkbenchToolbar();
        return wasOpen;
    },

    renderWorkbenchNarrowButtons() {
        const esc = (v) => this.dash.escapeHtml(v);
        const active = [this.bmQuery, this.bmPageFilter, this.bmCategoryFilter, this.bmCleanupFilter, this.bmHealthFilter]
            .filter((v) => String(v || '').trim()).length + this.bookmarkTagFilters().length;
        return `
            <button type="button" class="config-btn config-btn--small config-bm-narrow-only config-bm-phone-only" data-bm-open-sheet>${esc(
                this.t('config.bmFilters', 'Filters'))}${active ? ` (${active})` : ''}</button>`;
    },

    syncWorkbenchToolbar() {
        const host = document.getElementById('config-bm-narrow-buttons');
        if (host) host.innerHTML = this.renderWorkbenchNarrowButtons();
    },

    /**
     * Publish the section header's height on the workbench, under the name the
     * list-view shell uses (--lvs-header-height), so the sticky panel stops
     * below the sticky header instead of sliding under it. The header grows
     * and shrinks with its breadcrumb, so it is watched rather than read once.
     */
    trackWorkbenchHeaderHeight(workbench) {
        const head = document.querySelector('.config-view-head');
        this._bmHeadObserver?.disconnect?.();
        if (!workbench || !head || typeof ResizeObserver !== 'function') return;
        const publish = () => workbench.style.setProperty('--lvs-header-height', `${Math.round(head.offsetHeight)}px`);
        publish();
        this._bmHeadObserver = new ResizeObserver(publish);
        this._bmHeadObserver.observe(head);
    },

    bindWorkbench(container) {
        // A redraw of the section (a write elsewhere, a filter from the hash)
        // keeps an open sheet open: its scroll lock is still held, so the new
        // markup is put back in the state the old one was in. Leaving the list
        // is what closes it (closeWorkbenchOverlaysOffList).
        if (this._bmOverlayKind) {
            const root = container.querySelector('#config-bm-workbench');
            root?.classList.add('is-sheet-open');
            const scrim = root?.querySelector('[data-bm-scrim]');
            if (scrim) scrim.hidden = false;
        }
        this.trackWorkbenchHeaderHeight(container.querySelector('#config-bm-workbench'));
        this.startBmHealth?.();
        this.bindWorkbenchRail(container.querySelector('#config-bm-rail'));
        const panel = container.querySelector('#config-bm-panel');
        this.adoptLibraryPanel(panel);
        this.bindWorkbenchPanel(panel);
        this.bindWorkbenchBulk(panel);
        if (panel) {
            panel.dataset.bmPanelSig = '';
            this.repaintWorkbenchPanel();
        }
        const root = container.querySelector('#config-bm-workbench');
        if (root && root.dataset.bmOverlayWired !== '1') {
            root.dataset.bmOverlayWired = '1';
            root.addEventListener('click', (e) => {
                if (e.target.closest('[data-bm-enable-checking]')) this.openCheckingModal?.();
                else if (e.target.closest('[data-bm-scrim]')) this.closeWorkbenchOverlays();
                else if (e.target.closest('[data-bm-open-sheet]')) this.openWorkbenchOverlay();
            });
        }
    },

    /** Whether the list draws group headers at all -- bmActiveGroup() decides which shape. */
    workbenchGrouped() {
        return this.bmActiveGroup() !== '';
    },

    /**
     * The key workbenchItems() groups consecutive rows by.
     *
     * Must land on the same order computeVisibleBookmarks()'s bmGroupComparator
     * produces, or two runs of the same group that are not adjacent in the
     * sorted rows would draw as two separate headers.
     */
    workbenchGroupKey(b) {
        switch (this.bmActiveGroup()) {
            case 'url': return global.HealthFacts?.keyFor?.(b.url) || b.url;
            case 'page': return String(b.pageId);
            case 'category': return `${b.pageId}::${b.category || ''}`;
            case 'site': return this.bmGroupSiteKey(b);
            case 'status': return this.bookmarkHealthState(b);
            case 'tag': return this.bmGroupFirstTag(b);
            default: return '';
        }
    },

    /** The group header's own label -- what the active Group is, not where a bookmark is filed (see workbenchCrumbLabel). */
    workbenchGroupLabel(b) {
        switch (this.bmActiveGroup()) {
            case 'url': return b.url || '';
            case 'page': return this.pageLabel(b.pageId);
            case 'category': return this.workbenchCrumbLabel(b);
            case 'site': return this.bmGroupSiteKey(b) || b.url || '';
            case 'status': return this.railHealthLabel(this.bookmarkHealthState(b));
            case 'tag': {
                const tag = this.bmGroupFirstTag(b);
                return tag ? `#${tag}` : this.t('config.bmGroupNoTags', 'No tags');
            }
            default: return '';
        }
    },

    /**
     * Where a bookmark is filed, page › category -- shown as the row's crumb
     * (see ctx.showCrumb) whenever the group headers do not already say it:
     * page, category and Duplicates' URL groups make it redundant, but
     * grouping by site, status or tag still leaves "where does this actually
     * live" worth saying on the row, same as no grouping at all.
     */
    workbenchCrumbLabel(b) {
        const page = this.pageLabel(b.pageId);
        if (!b.category) return page;
        return `${page} › ${this.railCategoryLabel(b.pageId, b.category)}`;
    },

    workbenchItems() {
        const all = this.visibleBookmarks();
        const rows = all.slice(0, this.bookmarkVisibleLimit(all.length));
        const token = JSON.stringify([this._bmVisibleToken, rows.length]);
        if (this._bmItemsToken === token && this._bmItemsRows === all && this._bmItems) return this._bmItems;
        const items = global.BookmarkWorkbenchModel.buildItems(rows, {
            grouped: this.workbenchGrouped(),
            groupKey: (b) => this.workbenchGroupKey(b),
            groupLabel: (b) => this.workbenchGroupLabel(b),
        });
        this._bmItemsToken = token;
        this._bmItemsRows = all;
        this._bmItems = items;
        return items;
    },

    /**
     * The row's glow, the same mapping as Health's rows: broken red, a monitor
     * that is down amber, a monitored and healthy one in the accent, healthy
     * green, and nothing for a bookmark that is never checked.
     */
    workbenchRowStatus(b) {
        // Every row says where it stands. Health's own colour once its report
        // knows the bookmark (healthRowStatus: red, amber, the monitor's blue,
        // green); and a bookmark nothing checks is "off", its own grey, so
        // that never being checked cannot read as being fine. A problem the
        // report found anyway -- a broken page seen on a load -- still wins.
        const mode = global.CheckMode?.of?.(b) || 'off';
        const issue = this.bmHealthIssue?.(b);
        const health = this._bmHealthModule;
        if (issue && typeof health?.healthRowStatus === 'function') {
            const status = health.healthRowStatus(issue);
            if (status === 'bad' || status === 'warn' || status === 'info') return status;
            if (mode === 'monitor') return 'info';
            return mode === 'off' ? 'off' : status;
        }
        const state = this.bookmarkHealthState(b);
        if (state === 'broken') return 'bad';
        if (state === 'down') return 'warn';
        if (mode === 'off') return 'off';
        if (state === 'healthy') {
            return mode === 'monitor' || global.HealthFacts?.get?.(b?.url)?.monitor ? 'info' : 'good';
        }
        return 'muted';
    },

    renderWorkbenchRow(item, ctx) {
        const esc = ctx.esc;
        const b = item.bookmark;
        const key = this.bookmarkKey(b);
        const ticked = this.bmSelected.has(key);
        const title = b.name || this.formatBookmarkUrlDisplay(b.url) || b.url;
        const domain = this.formatBookmarkUrlDisplay(b.url);
        // The glow (list-view-shell.css) says what the dot before the title
        // used to, in the same colours Health's rows use.
        const status = this.workbenchRowStatus(b);
        const tags = (b.tags || []).map((t) => String(t).trim()).filter(Boolean);
        // Every tag, and a count for the ones that do not fit; fitWorkbenchTags
        // decides which, once the row has a width.
        const tagChips = tags.map((t) => `<span class="config-bm-tag">${esc(t)}</span>`).join('')
            + (tags.length ? '<span class="config-bm-tag config-bm-tag--more" hidden></span>' : '');
        const last = global.formatLastOpened?.(b.lastOpened, { t: this.lastOpenedTranslator() })
            || { label: '—', never: true };
        // Under a Health filter the reason earns the tags cell more than a
        // fact this filter already narrowed on. The score closes every row,
        // as it does in Health.
        const issue = this.bmHealthIssue?.(b) || null;
        const healthIssue = this.bmHealthFilter ? issue : null;
        const healthReason = healthIssue ? (this._bmHealthModule?.reasonEntries(healthIssue)[0]?.label || '') : '';
        const scoreTone = (score) => (score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad');
        const score = issue && Number.isFinite(Number(issue.score)) ? Number(issue.score) : null;
        const crumbLabel = ctx.showCrumb ? this.workbenchCrumbLabel(b) : '';
        const crumb = ctx.showCrumb ? `<span class="config-bm-crumb" title="${esc(crumbLabel)}">${esc(crumbLabel)}</span>` : '';
        const classes = ['config-bm-row'];
        if (ticked) classes.push('is-checked');
        if (item.groupStart) classes.push('is-group-start');
        if (item.groupEnd) classes.push('is-group-end');
        const feed = global.BookmarkFeedRow;
        return `
            <div class="${classes.join(' ')}" data-bm-key="${esc(key)}"${status ? ` data-lvs-status="${status}"` : ''} role="row" tabindex="-1"
                 aria-selected="${ticked ? 'true' : 'false'}" aria-posinset="${item.index + 1}" aria-setsize="${ctx.setSize}">
                <label class="config-bm-tick-cell" role="gridcell">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                </label>
                <span class="config-bm-icon-cell" role="gridcell">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                <span class="config-bm-name" role="gridcell">
                    <span class="config-bm-title">${esc(title)}</span>
                    <span class="config-bm-domain">${esc(domain)}</span>
                    ${ctx.isDuplicate(b) ? `<span class="config-bm-duplicate-badge">${esc(this.t('config.bookmarkDuplicateBadge', 'Duplicate'))}</span>` : ''}
                    ${crumb}
                </span>
                <span class="config-bm-tags" role="gridcell">${healthIssue
                    ? `<span class="config-bm-reason">${esc(healthReason)}</span>` : tagChips}</span>
                <span class="config-bm-extra config-bm-pinned" role="gridcell" title="${esc(this.t('config.pinnedShort', 'Pinned'))}">${b.pinned
                    ? `<span aria-label="${esc(this.t('config.bookmarkPinnedAria', 'Pinned'))}">${global.MenuIcons?.PIN || ''}</span>` : ''}</span>
                <span class="config-bm-extra config-bm-key" role="gridcell" title="${esc(this.t('config.bmFieldShortcut', 'Shortcut'))}">${b.shortcut ? `<kbd>${esc(b.shortcut)}</kbd>` : ''}</span>
                ${this.workbenchSparkCell(b)}
                <span class="config-bm-opens" role="gridcell" title="${esc(this.bookmarkUsageTooltip(b))}">${Number(b.openCount || 0)}</span>
                <span class="config-bm-last" role="gridcell">${esc(last.label)}</span>
                ${this.workbenchAddedCell(b)}
                <span class="config-bm-row-score" role="gridcell">${score == null ? ''
                    : `<span class="config-bm-score" data-tone="${scoreTone(score)}">${esc(String(score))}</span>`}</span>
            </div>`;
    },

    /**
     * The last 30 days of opens, two days to a bar, the newest on the right.
     * From the open log the server keeps (Bookmark.openLog); the Usage tab
     * draws the long view, this is the glance.
     */
    workbenchSparkCell(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const BARS = 15;
        const SPAN = 2 * 86400000;
        const now = Date.now();
        const counts = new Array(BARS).fill(0);
        const log = (Array.isArray(b.openLog) ? b.openLog : []).map(Number);
        // Opens are logged one by one only since the log existed; a bookmark
        // last opened before that still has that one open, and it is real.
        const lastOpened = Number(b.lastOpened || 0);
        if (lastOpened > 0 && !log.includes(lastOpened)) log.push(lastOpened);
        log.forEach((raw) => {
            const age = now - Number(raw);
            if (!(age >= 0) || age >= BARS * SPAN) return;
            counts[BARS - 1 - Math.floor(age / SPAN)] += 1;
        });
        const total = counts.reduce((a, n) => a + n, 0);
        const title = total
            ? this.t('config.bmSparkTitle', '{n} opens in the last 30 days').replace('{n}', String(total))
            : this.t('config.bmSparkNone', 'No opens in the last 30 days');
        const max = Math.max(1, ...counts);
        const w = 3;
        const gap = 1;
        const h = 14;
        const bars = counts.map((n, i) => {
            const bh = n ? Math.max(2, Math.round((n / max) * h)) : 1;
            return `<rect data-count="${n}" x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="0.5"${n ? '' : ' class="is-empty"'}></rect>`;
        }).join('');
        return `<span class="config-bm-spark" role="gridcell" title="${esc(title)}">
            <svg viewBox="0 0 ${BARS * (w + gap) - gap} ${h}" width="${BARS * (w + gap) - gap}" height="${h}" aria-hidden="true">${bars}</svg></span>`;
    },

    /** When it was added: day and month this year, month and year before. */
    workbenchAddedCell(b) {
        const esc = (v) => this.dash.escapeHtml(v);
        const at = Number(b.createdAt || 0);
        if (!(at > 0)) return '<span class="config-bm-added" role="gridcell">—</span>';
        const date = new Date(at);
        const thisYear = date.getFullYear() === new Date().getFullYear();
        const label = date.toLocaleDateString(undefined, thisYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' });
        const full = date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        return `<span class="config-bm-added" role="gridcell" title="${esc(this.t('config.bmAddedTitle', 'Added {date}').replace('{date}', full))}">${esc(label)}</span>`;
    },

    /**
     * Show as many whole tag chips per row as fit, then `+n` for the rest.
     *
     * Three passes over every row, so the layout is computed once: show all
     * chips (and a wide `+n` to measure), read every width, then hide.
     */
    fitWorkbenchTags(root) {
        const cells = [...(root || document).querySelectorAll('.config-bm-row .config-bm-tags')];
        if (!cells.length) return;
        cells.forEach((cell) => {
            cell.querySelectorAll('.config-bm-tag').forEach((chip) => { chip.hidden = false; });
            const more = cell.querySelector('.config-bm-tag--more');
            if (more) more.textContent = '+99';
        });
        const plans = cells.map((cell) => {
            const chips = [...cell.querySelectorAll('.config-bm-tag:not(.config-bm-tag--more)')];
            const more = cell.querySelector('.config-bm-tag--more');
            const gap = parseFloat(getComputedStyle(cell).columnGap) || 0;
            return {
                chips,
                more,
                gap,
                avail: cell.clientWidth,
                widths: chips.map((chip) => chip.getBoundingClientRect().width),
                moreWidth: more ? more.getBoundingClientRect().width : 0,
            };
        });
        plans.forEach(({ chips, more, gap, avail, widths, moreWidth }) => {
            if (!more) return;
            const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
            let keep = widths.length;
            if (total > avail + 1) {
                keep = 0;
                let used = moreWidth;
                while (keep < widths.length && used + widths[keep] + gap <= avail + 1) {
                    used += widths[keep] + gap;
                    keep += 1;
                }
            }
            const hiddenNames = [];
            chips.forEach((chip, i) => {
                chip.hidden = i >= keep;
                if (chip.hidden) hiddenNames.push(chip.textContent);
            });
            more.hidden = hiddenNames.length === 0;
            more.textContent = hiddenNames.length ? `+${hiddenNames.length}` : '';
            if (hiddenNames.length) more.title = hiddenNames.join(', ');
            else more.removeAttribute('title');
        });
        // Refit whenever the list changes width: a window resize, the panel
        // folding, or the first layout after the rows were put in.
        const host = document.getElementById('config-bm-list');
        if (host && this._bmTagFitHost !== host && global.ResizeObserver) {
            this._bmTagFitObserver?.disconnect();
            this._bmTagFitHost = host;
            let queued = false;
            let lastWidth = -1;
            this._bmTagFitObserver = new global.ResizeObserver(() => {
                if (queued || host.clientWidth === lastWidth) return;
                queued = true;
                global.requestAnimationFrame(() => {
                    queued = false;
                    lastWidth = host.clientWidth;
                    if (host.isConnected) this.fitWorkbenchTags(host);
                });
            });
            this._bmTagFitObserver.observe(host);
        }
    },

    renderWorkbenchGroupHead(item, esc) {
        return `
            <div class="config-bm-group-head" data-bm-group="${esc(item.key)}" role="row">
                <span class="config-bm-group-label" role="rowheader">${esc(item.label)}
                    <span class="config-bm-group-count">${item.count}</span></span>
                <button type="button" class="config-bm-group-select" data-bm-select-group="${esc(item.key)}">${esc(this.t('config.bmSelectGroup', 'select group'))}</button>
            </div>`;
    },

    /** The rows themselves, re-rendered on every search/filter/edit change. */
    renderBookmarksList() {
        const esc = (v) => this.dash.escapeHtml(v);
        this._bmDuplicateUrls = null;
        const dupes = this.ensureDuplicateUrlSet();
        if (!(this.dash.allBookmarks || []).length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const all = this.visibleBookmarks();
        if (!all.length) {
            return `
                <div class="config-panel-empty config-panel-empty--action">
                    <p>${esc(this.bookmarksEmptyReason())}</p>
                    ${this.bookmarksFiltersActive() ? `<button type="button" class="config-btn" data-bm-empty-clear>${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>` : ''}
                    <button type="button" class="config-btn config-btn--primary" data-bm-empty-add>${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                </div>`;
        }
        const items = this.workbenchItems();
        const rowCount = items.filter((i) => i.type === 'row').length;
        const ctx = {
            esc,
            grouped: this.workbenchGrouped(),
            // The crumb repeats what a page/category/URL group header already
            // says, so it only earns its place when the headers say something
            // else (site, status, tag) or there are none at all.
            showCrumb: !['page', 'category', 'url'].includes(this.bmActiveGroup()),
            setSize: all.length,
            isDuplicate: (b) => {
                const url = this.canonicalStatsUrlKey(b.url);
                return Boolean(url && dupes.has(url));
            },
        };
        const win = this.bookmarkRowWindow();
        const slice = win ? items.slice(win.start, win.end) : items;
        const body = slice.map((item) => (item.type === 'head'
            ? this.renderWorkbenchGroupHead(item, esc)
            : this.renderWorkbenchRow(item, ctx))).join('');
        const spacer = (px) => (px > 0 ? `<div class="config-bm-spacer" aria-hidden="true" style="height:${Math.round(px)}px"></div>` : '');
        const more = all.length > rowCount
            ? `<div class="config-bm-load-sentinel" data-bm-load-more hidden aria-hidden="true"></div>
               <p class="config-bm-load-hint">${esc(this.t('config.bookmarksLoadMoreHint', '{shown} of {total} shown — scroll for more')
                   .replace('{shown}', String(rowCount)).replace('{total}', String(all.length)))}</p>`
            : '';
        return `<div class="config-bm-feed${ctx.grouped ? ' is-grouped' : ''}" role="grid" aria-rowcount="${all.length}"
                     aria-label="${esc(this.t('config.sectionBookmarks', 'Bookmarks'))}" data-bm-rows="${rowCount}">${win ? spacer(win.above) : ''}${body}${win ? spacer(win.below) : ''}${more}</div>`;
    },

    workbenchItemHeights() {
        const styles = getComputedStyle(document.getElementById('config-bm-workbench') || document.documentElement);
        const px = (name, fallback) => parseFloat(styles.getPropertyValue(name)) || fallback;
        return { rowHeight: px('--bm-row-h', 44), headHeight: px('--bm-head-h', 32) };
    },
    });

    global.DashboardConfigWorkbenchReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
