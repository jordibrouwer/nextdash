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

    workbenchPanelMode() {
        if (this.bmSelected.size > 1) return 'bulk';
        return this.workbenchPanelKey() ? 'single' : 'empty';
    },

    workbenchPanelKey() {
        if (this._bmPendingFocus) {
            const key = this.bookmarkKeyAt(this._bmPendingFocus.pageId, this._bmPendingFocus.index);
            this._bmPendingFocus = null;
            if (key) this._bmKeyboardKey = key;
        }
        const key = this._bmKeyboardKey;
        return key && this.findBookmarkByKey(key) ? key : null;
    },

    renderWorkbenchPanelToggle() {
        const esc = (v) => this.dash.escapeHtml(v);
        const collapsed = this.bmPanelCollapsed();
        const label = collapsed ? this.t('config.bmDetails', 'Details') : this.t('config.bmHideDetails', 'Hide details');
        return `<button type="button" class="config-bm-panel-toggle" data-bm-panel-toggle
                        aria-expanded="${collapsed ? 'false' : 'true'}" title="${esc(label)} (i)">
                    <span class="config-bm-panel-toggle-label">${esc(label)}</span><span aria-hidden="true">${collapsed ? '‹' : '›'}</span>
                </button>`;
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        const mode = this.workbenchPanelMode();
        let body;
        if (mode === 'bulk') body = this.renderWorkbenchBulkPanel?.() || '';
        else if (mode === 'single') body = this.renderWorkbenchSinglePanel(this.workbenchPanelKey());
        else body = `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
        return `${this.renderWorkbenchPanelToggle()}<div class="config-bm-panel-body">${body}</div>`;
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

    renderWorkbenchSinglePanel(key) {
        const esc = (v) => this.dash.escapeHtml(v);
        const b = this.findBookmarkByKey(key);
        const facts = global.HealthFacts?.get?.(b.url) || null;
        const state = this.bookmarkHealthState(b);
        const fmt = (ts) => global.formatLastOpened?.(ts, { t: this.lastOpenedTranslator() }) || { label: '—' };
        const pageOptions = (this.dash.pages || []).map((p) =>
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
        return `
            <header class="config-bm-panel-head">
                <span class="config-bm-panel-icon">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                <span class="config-bm-panel-title">${esc(b.name || this.formatBookmarkUrlDisplay(b.url))}</span>
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="open">${esc(this.t('config.openBookmark', 'Open'))}</button>
            </header>
            <div class="config-bm-panel-fields">
                ${this.renderWorkbenchField('name', this.t('config.bookmarkNameLabel', 'Name'), input('name', b.name))}
                ${this.renderWorkbenchField('url', this.t('config.bmFieldUrl', 'URL'), input('url', b.url, 'spellcheck="false"'))}
                ${this.renderWorkbenchField('page', this.t('config.page', 'Page'), `<select class="config-select" data-bm-field="page">${pageOptions}</select>`)}
                ${this.renderWorkbenchField('category', this.t('config.category', 'Category'), `<select class="config-select" data-bm-field="category">${catOptions}</select>`)}
                ${this.renderWorkbenchField('tags', this.t('config.bmFieldTags', 'Tags'), input('tags', (b.tags || []).join(', ')))}
                ${this.renderWorkbenchField('shortcut', this.t('config.bmFieldShortcut', 'Shortcut'), input('shortcut', b.shortcut, 'maxlength="5"'))}
                ${this.renderWorkbenchField('note', this.t('config.bmFieldNote', 'Note'),
                    `<textarea class="config-text" rows="2" data-bm-field="note" data-original="${esc(b.note || '')}">${esc(b.note || '')}</textarea>`)}
                <label class="config-bm-field config-bm-field--inline" data-bm-field-wrap="pinned">
                    <input type="checkbox" data-bm-field="pinned"${b.pinned ? ' checked' : ''}>
                    <span class="config-bm-field-label">${esc(this.t('config.pinnedShort', 'Pinned'))}</span>
                    <span class="config-bm-field-status" role="status"></span>
                </label>
                ${this.renderWorkbenchField('checkMode', this.t('config.bmFieldChecking', 'Checking'), `<select class="config-select" data-bm-field="checkMode">${modeOptions}</select>`)}
            </div>
            <section class="config-bm-panel-facts">
                <h3>${esc(this.t('config.bmHealth', 'Health'))}</h3>
                <p><span class="config-bm-health-dot is-${esc(state)}"></span> ${esc(this.railHealthLabel(state))}</p>
                ${facts?.lastError ? `<p class="config-bm-panel-muted">${esc(facts.lastError)}</p>` : ''}
                ${facts?.uptime7d != null ? `<p class="config-bm-panel-muted">${esc(this.t('config.bmUptime7d', '{pct}% up this week').replace('{pct}', String(Math.round(facts.uptime7d * 100))))}</p>` : ''}
                <h3>${esc(this.t('config.bmUsage', 'Usage'))}</h3>
                <p class="config-bm-panel-muted">${esc(this.bookmarkUsageTooltip(b))}</p>
                <p class="config-bm-panel-muted">${esc(this.t('config.bookmarkStatLastOpened', 'Last opened'))}: ${esc(fmt(b.lastOpened).label)}</p>
            </section>
            <footer class="config-bm-panel-foot">
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="dashboard">${esc(this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}</button>
                <button type="button" class="config-btn config-btn--small" data-bm-panel-action="favicon">${esc(this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}</button>
                <button type="button" class="config-btn config-btn--small config-btn--danger" data-bm-panel-action="delete">${esc(this.t('config.delete', 'Delete'))}</button>
            </footer>`;
    },

    repaintWorkbenchPanel() {
        const panel = document.getElementById('config-bm-panel');
        if (!panel) return;
        // A save in flight owns the panel until it lands: repainting now would
        // take the field (and what was typed into it) away mid-write.
        if (this._bmPanelSaving) {
            this._bmPanelRepaintQueued = true;
            return;
        }
        const mode = this.workbenchPanelMode();
        const key = mode === 'single' ? this.workbenchPanelKey() : '';
        const sig = `${mode}|${key}|${mode === 'bulk' ? [...this.bmSelected].sort().join(',') : ''}|${(this.dash.allBookmarks || []).length}`;
        // Typing in the panel while the list repaints around it must not lose
        // the field; the same bookmark in the same mode is left alone.
        if (panel.dataset.bmPanelSig === sig && panel.contains(document.activeElement)) return;
        panel.innerHTML = this.renderWorkbenchPanel();
        panel.dataset.bmPanelSig = sig;
        panel.dataset.bmPanelMode = mode;
        panel.dataset.bmPanelKey = key || '';
        if (mode === 'bulk') this.toggleWorkbenchPanel(false, { remember: false });
    },

    /**
     * Fold or unfold the panel. Only the reader's own toggle (the button, `i`)
     * is remembered; `e` and a multi-row selection open it for now without
     * overwriting that choice.
     */
    toggleWorkbenchPanel(force, { remember = true } = {}) {
        const collapsed = typeof force === 'boolean' ? force : !this.bmPanelCollapsed();
        if (remember) {
            this._bmPanelTempOpen = false;
            try {
                global.localStorage?.setItem(PANEL_KEY, collapsed ? '1' : '0');
            } catch { /* private window: the choice lasts this visit */ }
        } else {
            this._bmPanelTempOpen = !collapsed;
        }
        const root = document.getElementById('config-bm-workbench');
        root?.classList.toggle('is-panel-collapsed', collapsed);
        const toggle = document.querySelector('#config-bm-panel [data-bm-panel-toggle]');
        if (toggle) toggle.outerHTML = this.renderWorkbenchPanelToggle();
    },

    focusWorkbenchPanel(key) {
        if (key) this._bmKeyboardKey = key;
        this.toggleWorkbenchPanel(false, { remember: false });
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

    async commitWorkbenchField(el) {
        const key = document.getElementById('config-bm-panel')?.dataset.bmPanelKey;
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
        let run;
        if (name === 'page') {
            if (String(el.value) === String(b.pageId)) return;
            this._bmPendingFocus = { pageId: String(el.value), index: -1 };
            run = this.bulkMove([b], { pageId: el.value, category: b.category || '' }).then(() => true, () => false);
        } else if (name === 'checkMode') {
            run = this.setBookmarkCheckMode(key, el.value).then(() => true, () => false);
        } else {
            const patch = this.workbenchFieldPatch(el);
            if (!patch) return;
            if (name === 'category' && el.value) await this.ensureCategoryOnPage(b.pageId, el.value);
            run = this.saveBookmarkFields(key, patch);
        }
        this.setWorkbenchFieldStatus(el, '', false);
        this._bmPanelSaving = run;
        const ok = await run;
        this._bmPanelSaving = null;
        if (!ok) {
            this._bmPendingFocus = null;
            this._bmKeyboardKey = key;
            this.setWorkbenchFieldStatus(el, this.t('config.bmNotSaved', 'Not saved — retry'), true);
            this._bmPanelRepaintQueued = false;
            return;
        }
        if (this._bmPanelRepaintQueued) {
            this._bmPanelRepaintQueued = false;
            document.getElementById('config-bm-panel').dataset.bmPanelSig = '';
            this.repaintWorkbenchPanel();
        }
    },

    bindWorkbenchPanel(panel) {
        if (!panel || panel.dataset.bmPanelWired === '1') return;
        panel.dataset.bmPanelWired = '1';
        panel.addEventListener('click', (e) => {
            if (e.target.closest('[data-bm-panel-toggle]')) {
                this.toggleWorkbenchPanel();
                return;
            }
            const action = e.target.closest('[data-bm-panel-action]')?.getAttribute('data-bm-panel-action');
            const key = panel.dataset.bmPanelKey;
            if (!action || !key) return;
            if (action === 'open') this.openBookmarkByKey(key);
            else if (action === 'delete') void this.deleteBookmarkByKey(key);
            else this.handleBookmarkMenuAction(action, key);
        });
        // Selects and the checkbox save on change; text on leaving the field.
        panel.addEventListener('change', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            if (el.tagName === 'SELECT' || el.type === 'checkbox') void this.commitWorkbenchField(el);
        });
        panel.addEventListener('focusout', (e) => {
            const el = e.target.closest('input[data-bm-field]:not([type="checkbox"]), textarea[data-bm-field]');
            if (!el || panel.dataset.bmPanelMode !== 'single') return;
            void this.commitWorkbenchField(el);
        });
        panel.addEventListener('keydown', (e) => {
            const el = e.target.closest('[data-bm-field]');
            if (!el) return;
            e.stopPropagation();
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

    bindWorkbench(container) {
        this.bindWorkbenchRail(container.querySelector('#config-bm-rail'));
        const panel = container.querySelector('#config-bm-panel');
        this.bindWorkbenchPanel(panel);
        if (panel) {
            panel.dataset.bmPanelSig = '';
            this.repaintWorkbenchPanel();
        }
    },

    workbenchGrouped() {
        return (this.bmSort ?? this.defaultBookmarksSort()) === 'page';
    },

    workbenchGroupKey(b) {
        return `${b.pageId}::${b.category || ''}`;
    },

    workbenchGroupLabel(b) {
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

    renderWorkbenchRow(item, ctx) {
        const esc = ctx.esc;
        const b = item.bookmark;
        const key = this.bookmarkKey(b);
        const ticked = this.bmSelected.has(key);
        const title = b.name || this.formatBookmarkUrlDisplay(b.url) || b.url;
        const domain = this.formatBookmarkUrlDisplay(b.url);
        const state = this.bookmarkHealthState(b);
        const tags = (b.tags || []).map((t) => String(t).trim()).filter(Boolean);
        const TAGS_SHOWN = 2;
        const tagChips = tags.slice(0, TAGS_SHOWN)
            .map((t) => `<span class="config-bm-tag">${esc(t)}</span>`).join('')
            + (tags.length > TAGS_SHOWN ? `<span class="config-bm-tag config-bm-tag--more">+${tags.length - TAGS_SHOWN}</span>` : '');
        const last = global.formatLastOpened?.(b.lastOpened, { t: this.lastOpenedTranslator() })
            || { label: '—', never: true };
        const crumb = ctx.grouped ? '' : `<span class="config-bm-crumb">${esc(this.workbenchGroupLabel(b))}</span>`;
        const classes = ['config-bm-row'];
        if (ticked) classes.push('is-checked');
        if (item.groupStart) classes.push('is-group-start');
        if (item.groupEnd) classes.push('is-group-end');
        const feed = global.BookmarkFeedRow;
        return `
            <div class="${classes.join(' ')}" data-bm-key="${esc(key)}" role="row" tabindex="-1"
                 aria-selected="${ticked ? 'true' : 'false'}" aria-posinset="${item.index + 1}" aria-setsize="${ctx.setSize}">
                <label class="config-bm-tick-cell" role="gridcell">
                    <input type="checkbox" class="config-bm-tick" data-bm-tick="${esc(key)}" ${ticked ? 'checked' : ''}
                           aria-label="${esc(this.t('config.selectBookmark', 'Select bookmark'))}">
                </label>
                <span class="config-bm-icon-cell" role="gridcell">${feed?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                <span class="config-bm-name" role="gridcell">
                    <span class="config-bm-health-dot is-${esc(state)}" title="${esc(this.railHealthLabel(state))}"></span>
                    <span class="config-bm-title">${esc(title)}</span>
                    <span class="config-bm-domain">${esc(domain)}</span>
                    ${b.pinned ? `<span class="config-bm-pin" aria-label="${esc(this.t('config.bookmarkPinnedAria', 'Pinned'))}">📌</span>` : ''}
                    ${ctx.isDuplicate(b) ? `<span class="config-bm-duplicate-badge">${esc(this.t('config.bookmarkDuplicateBadge', 'Duplicate'))}</span>` : ''}
                    ${crumb}
                </span>
                <span class="config-bm-tags" role="gridcell">${tagChips}</span>
                <span class="config-bm-key" role="gridcell">${b.shortcut
                    ? `<kbd>${esc(b.shortcut)}</kbd>`
                    : '<span class="config-bm-key--empty" aria-hidden="true">+</span>'}</span>
                <span class="config-bm-opens" role="gridcell" title="${esc(this.bookmarkUsageTooltip(b))}">${Number(b.openCount || 0)}</span>
                <span class="config-bm-last" role="gridcell">${esc(last.label)}</span>
            </div>`;
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
                     aria-label="${esc(this.t('config.bookmarks', 'Bookmarks'))}" data-bm-rows="${rowCount}">${win ? spacer(win.above) : ''}${body}${win ? spacer(win.below) : ''}${more}</div>`;
    },

    workbenchItemHeights() {
        const styles = getComputedStyle(document.getElementById('config-bm-workbench') || document.documentElement);
        const px = (name, fallback) => parseFloat(styles.getPropertyValue(name)) || fallback;
        return { rowHeight: px('--bm-row-h', 44), headHeight: px('--bm-head-h', 32) };
    },
    });

    global.DashboardConfigWorkbenchReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
