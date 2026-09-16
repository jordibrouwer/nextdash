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

    const PANEL_KEY = 'nextdash.bmPanelCollapsed';

    Object.assign(global.DashboardConfig.prototype, {

    bmPanelCollapsed() {
        if (this._bmPanelTempOpen) return false;
        try {
            return global.localStorage?.getItem(PANEL_KEY) === '1';
        } catch {
            return false;
        }
    },

    renderBookmarksWorkbench() {
        const esc = (v) => this.dash.escapeHtml(v);
        const filtered = this.visibleBookmarks();
        const total = (this.dash.allBookmarks || []).length;
        const countLabel = this.renderBookmarkCountLabelSafe(filtered.length, total);
        const collapsed = this.bmPanelCollapsed();
        return `
            <div class="config-bm-workbench${collapsed ? ' is-panel-collapsed' : ''}" id="config-bm-workbench">
                <aside class="config-bm-rail" id="config-bm-rail"
                       aria-label="${esc(this.t('config.bmFilters', 'Filters'))}">${this.renderWorkbenchRail()}</aside>
                <section class="config-bm-main" aria-label="${esc(this.t('config.sectionBookmarks', 'Bookmarks'))}">
                    <div class="config-bm-toolbar">
                        <span class="config-bm-count" id="config-bm-count">${esc(countLabel)}</span>
                        <span class="config-sr-only" id="config-bm-count-live" aria-live="polite" aria-atomic="true">${esc(countLabel)}</span>
                        <span class="config-bm-toolbar-spacer"></span>
                        <label class="config-bm-sort">
                            <span>${esc(this.t('config.sortLabel', 'Sort'))}</span>
                            <select class="config-select" id="config-bm-sort">${this.bookmarkSortOptionsHtml()}</select>
                        </label>
                        <button type="button" class="config-btn config-btn--primary config-btn--small" id="config-bm-add">${esc(this.t('config.addBookmark', 'Add bookmark'))}</button>
                    </div>
                    ${this.renderLegacyBookmarkControls()}
                    <div id="config-bm-list">${this.renderBookmarksListSafe()}</div>
                </section>
                <aside class="config-bm-panel" id="config-bm-panel" role="region"
                       aria-label="${esc(this.t('config.bmDetails', 'Details'))}">${this.renderWorkbenchPanel()}</aside>
            </div>`;
    },

    renderWorkbenchRail() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `
            <div class="config-bm-rail-search">
                <input type="search" class="config-text" id="config-bm-search"
                       placeholder="${esc(this.t('config.searchBookmarks', 'Search bookmarks…'))}"
                       value="${esc(this.bmQuery || '')}">
                <kbd aria-hidden="true">/</kbd>
            </div>
            <div id="config-bm-rail-facets">${this.renderWorkbenchFacets()}</div>`;
    },

    bookmarkFacetCounts() {
        const all = this.dash.allBookmarks || [];
        const token = JSON.stringify([this._bmVisibleToken, all.length, global.HealthFacts?.updatedAt || 0]);
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
            health: { keys: (b) => [this.bookmarkHealthState(b)], test: tests.health },
        });
        this._bmFacetSource = all;
        this._bmFacetToken = token;
        this._bmFacets = counts;
        return counts;
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
        const entry = (kind, value, label, n, on, extra = '') => `
            <button type="button" class="config-bm-rail-item${on ? ' is-on' : ''}${n ? '' : ' is-empty'}"
                    data-bm-rail="${kind}" data-value="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}">
                ${extra}<span class="config-bm-rail-label">${esc(label)}</span>
                <span class="config-bm-rail-count">${n}</span>
            </button>`;
        const group = (title, body, more = '') => (body ? `
            <section class="config-bm-rail-group">
                <h3 class="config-bm-rail-title"><span>${esc(title)}</span>${more}</h3>
                ${body}
            </section>` : '');

        // Tokens: what is on, each removable.
        const tokens = [];
        const token = (key, label) => tokens.push(
            `<button type="button" class="config-bm-rail-token" data-bm-rail-clear="${esc(key)}">${esc(label)}<span aria-hidden="true">×</span></button>`);
        if (this.bmCleanupFilter) token('cleanup', this.cleanupFilterLabel(this.bmCleanupFilter));
        if (this.bmPageFilter) token('page', this.pageLabel(this.bmPageFilter));
        if (this.bmCategoryFilter) {
            const { pageId, categoryId } = global.DashboardConfig.parseCategoryFilter(this.bmCategoryFilter);
            token('category', this.railCategoryLabel(pageId || this.bmPageFilter, categoryId));
        }
        tags.forEach((t) => token(`tag:${t}`, `#${t}`));
        if (this.bmHealthFilter) token('health', this.railHealthLabel(this.bmHealthFilter));
        const tokenRow = tokens.length ? `
            <div class="config-bm-rail-tokens">${tokens.join('')}
                <button type="button" class="config-bm-rail-clear-all" data-bm-rail-clear="all">${esc(this.t('config.clearBookmarkFilters', 'Clear filters'))}</button>
            </div>` : '';

        const VIEWS_SHOWN = 5;
        const viewKeys = ['', ...Object.keys(global.DashboardConfig.CLEANUP_FILTERS)];
        const viewsOpen = this._bmRailViewsOpen === true;
        const views = viewKeys
            .filter((k, i) => viewsOpen || i < VIEWS_SHOWN || k === this.bmCleanupFilter)
            .map((k) => entry('cleanup', k,
                k ? this.cleanupFilterLabel(k) : this.t('config.bmViewAll', 'All'),
                counts.view.get(k) || 0, (this.bmCleanupFilter || '') === k))
            .join('');
        const viewsMore = viewKeys.length > VIEWS_SHOWN
            ? `<button type="button" class="config-bm-rail-more" data-bm-rail-more="views">${esc(viewsOpen
                ? this.t('config.bmShowFewer', 'fewer')
                : this.t('config.bmShowMore', '+{n} more').replace('{n}', String(viewKeys.length - VIEWS_SHOWN)))}</button>`
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

        const anyChecked = (this.dash.allBookmarks || []).some((b) => b.checkStatus === true);
        const health = anyChecked
            ? global.DashboardConfig.HEALTH_FILTERS
                .map((k) => entry('health', k, this.railHealthLabel(k), counts.health.get(k) || 0,
                    this.bmHealthFilter === k, `<span class="config-bm-health-dot is-${k}" aria-hidden="true"></span>`))
                .join('')
            : '';

        return `
            ${tokenRow}
            ${group(this.t('config.bmViews', 'Views'), views, viewsMore)}
            ${group(this.t('config.bmPages', 'Pages'), pages)}
            ${group(this.t('config.bmCategories', 'Categories'), categories)}
            ${group(this.t('config.bmTags', 'Tags'), tagList, tagsMore)}
            ${group(this.t('config.bmHealth', 'Health'), health)}`;
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
            const more = e.target.closest('[data-bm-rail-more]');
            if (more) {
                const which = more.getAttribute('data-bm-rail-more');
                if (which === 'tags') this._bmRailTagsOpen = !this._bmRailTagsOpen;
                if (which === 'views') this._bmRailViewsOpen = !this._bmRailViewsOpen;
                this.repaintWorkbenchRail();
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
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
    },

    bindWorkbench(container) {
        this.bindWorkbenchRail(container.querySelector('#config-bm-rail'));
    },
    });

    global.DashboardConfigWorkbenchReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
