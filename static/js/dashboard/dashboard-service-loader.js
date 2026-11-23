/**
 * Lazy loader for the Service popover, modelled on dashboard-tag-view-loader.js.
 *
 * The page (dashboard-service.js) only matters once someone opens one; this
 * stub owns what the shell asks before that -- is it open, open it, close it on Back --
 * and fetches the module on first use.
 */
class DashboardServiceLoader {
    static VIEW = 'service';

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
    }

    /** True while the popover is up. */
    /**
     * Whether a bookmark is a "service" for the right-click menus: a container
     * runs behind it, a monitor watches it or a network check is set on it. A
     * news site is none of those and gets no entry. (The Bookmarks panel button
     * and :service stay open to every http(s) bookmark.)
     */
    static isService(dash, bookmark) {
        if (!bookmark || !/^https?:\/\//i.test(String(bookmark.url || ''))) return false;
        if (bookmark.monitor) return true;
        try { if (dash?.netBadges?.hasChecks?.(bookmark)) return true; } catch { /* not loaded */ }
        try {
            const index = window.DockerSearchIndex;
            if (index?.containersFor?.(bookmark, dash?.allBookmarks || [bookmark])?.length) return true;
        } catch { /* no index */ }
        return false;
    }

    /**
     * `l` on a row: the Service overview of the selected bookmark. Any http(s)
     * bookmark qualifies; nothing selected, or a bookmark without a web
     * address, does nothing.
     */
    openForSelection({ bookmark = null } = {}) {
        if (!bookmark || !/^https?:\/\//i.test(String(bookmark.url || ''))) return false;
        void this.openServiceView({ url: bookmark.url, page: bookmark.pageId ?? this.dash.currentPageId });
        return true;
    }

    static text(dash, key, fallback) {
        const raw = dash?.language?.t?.(`service.${key}`);
        return raw && raw !== `service.${key}` ? raw : fallback;
    }

    isActiveView() {
        return Boolean(this._module?.isActiveView());
    }

    get instance() {
        return this._module;
    }

    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;
        const load = window.LazyScript.loadScriptOnce;
        this._loadPromise = (async () => {
            if (typeof window.DashboardService !== 'function') {
                await load('js/dashboard/dashboard-service.js', 'dashboardServiceModule',
                    () => typeof window.DashboardService === 'function');
            }
            this._module = new window.DashboardService(this.dash);
            this._module.setupKeys();
            return this._module;
        })().catch((err) => {
            this._loadPromise = null;
            throw err;
        });
        return this._loadPromise;
    }

    /**
     * One service: { url, page } for a bookmark, { container } for a container
     * without one. A bookmark's container is found by the page itself.
     */
    async openServiceView(options = {}) {
        // The view stylesheet rides in the bundle nothing requests until a view
        // or popover like this one is opened. Awaited, so it does not paint unstyled.
        await window.ViewStyles?.ensureViewStyles?.();
        const mod = await this.load();
        return mod.openServiceView(options);
    }

    closeServiceView() {
        return this._module ? this._module.closeServiceView() : false;
    }

    /**
     * The shell's routeFromHash asks first. True: handled here -- either the
     * route that follows our own history step, or a hash that is not ours
     * while the popover is open (Back), which closes it in place.
     */
    handleRoute(hash) {
        const mod = this._module;
        if (!mod) return false;
        if (mod.consumeSwallow()) return true;
        if (mod.isActiveView() && !window.DashboardService.isServiceHash(hash)) {
            mod.closeFromRoute();
            return true;
        }
        return false;
    }
}

window.DashboardServiceLoader = DashboardServiceLoader;
window.createDashboardServiceLoader = (dashboard) => new DashboardServiceLoader(dashboard);
