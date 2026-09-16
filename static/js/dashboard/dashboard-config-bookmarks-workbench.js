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
                <section class="config-bm-main" aria-label="${esc(this.t('config.bookmarks', 'Bookmarks'))}">
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
            </div>`;
    },

    renderWorkbenchPanel() {
        const esc = (v) => this.dash.escapeHtml(v);
        return `<p class="config-bm-panel-empty">${esc(this.t('config.bmPanelEmpty', 'Select a bookmark to see it here.'))}</p>`;
    },

    bindWorkbench() {},
    });

    global.DashboardConfigWorkbenchReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
