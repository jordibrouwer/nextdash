/**
 * Lazy loader for the tag view, modelled on dashboard-docker-loader.js.
 *
 * The view (dashboard-tag-view.js) only matters once someone picks a tag;
 * this stub owns what the shell asks before that -- is the view open, open
 * it, follow a new hash -- and fetches the module on first use.
 */
class DashboardTagViewLoader {
    static VIEW = 'tags';

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
    }

    isActiveView() {
        return this.dash.activeView === DashboardTagViewLoader.VIEW;
    }

    get instance() {
        return this._module;
    }

    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;
        const load = window.LazyScript.loadScriptOnce;
        this._loadPromise = (async () => {
            if (typeof window.ListViewShell === 'undefined') {
                await load('js/shared/list-view-shell.js', 'listViewShell',
                    () => typeof window.ListViewShell !== 'undefined');
            }
            if (typeof window.DashboardTagView !== 'function') {
                await load('js/dashboard/dashboard-tag-view.js', 'dashboardTagViewModule',
                    () => typeof window.DashboardTagView === 'function');
            }
            this._module = new window.DashboardTagView(this.dash);
            this._module.setupKeys();
            return this._module;
        })().catch((err) => {
            this._loadPromise = null;
            throw err;
        });
        return this._loadPromise;
    }

    async openTagView(tags, options = {}) {
        await window.ViewStyles?.ensureViewStyles?.();
        const mod = await this.load();
        return mod.openTagView(tags, options);
    }

    /** Every bookmark, no tag picked: #tags, and Shift+T with no row in hand. */
    async openAllTags(options = {}) {
        return this.openTagView([], { ...options, all: true });
    }

    async updateTags(tags, options = {}) {
        const mod = await this.load();
        return mod.updateTags(tags, options);
    }

    /** Asked by renderDashboard while the view is open: a data change redraws it. */
    render() {
        this._module?.render();
    }

    closeTagView() {
        if (this._module) return this._module.closeTagView();
        if (!this.isActiveView()) return false;
        return this.dash.pageNav?.restoreBookmarksViewForPage?.(this.dash.currentPageId) ?? false;
    }

    /** Another view, or the grid, took the layout. */
    onLeave() {
        this._module?.onLeave();
    }
}

window.DashboardTagViewLoader = DashboardTagViewLoader;
window.createDashboardTagViewLoader = (dashboard) => new DashboardTagViewLoader(dashboard);
