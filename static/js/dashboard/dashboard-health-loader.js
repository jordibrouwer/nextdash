/**
 * Lazy loader for the health module.
 *
 * dashboard-health.js is one of the largest scripts on the dashboard, and only
 * the Bookmarks view and a few actions need it -- parsing it on every load
 * costs every bookmark page for nothing. This stub stands in for it (d.health)
 * and fetches the real module on first use. The Health view it once opened is
 * gone; its addresses lead to the Bookmarks view (openHealthView).
 */
class DashboardHealthLoader {
    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
    }

    isEnabled() {
        return this.dash.settings?.healthViewEnabled !== false;
    }

    get instance() {
        return this._module;
    }

    /*
     * What the module needs, in the order it runs. Each entry states its own
     * readiness test, so the order no longer has to work around filenames
     * matching each other -- and a script the page already carries (two of
     * these ride in the dashboard bundle) is neither fetched nor preloaded.
     */
    static get DEPENDENCIES() {
        return [
            ['js/health-reason-utils.js', 'dashboardHealthReason',
                () => typeof window.HealthReasonUtils !== 'undefined'],
            ['js/shared/last-opened-format.js', 'dashboardLastOpened',
                () => typeof window.formatLastOpened === 'function'],
            // The chrome the view now renders into. Loaded before the module so
            // a first render can never find the shell missing and fall back to
            // nothing; the inbox loads it the same way.
            ['js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined'],
            ['js/dashboard/dashboard-health.js', 'dashboardHealthModule',
                () => typeof window.DashboardHealth === 'function'],
            // Loaded with the view rather than on the dashboard's critical path:
            // the bulk toolbar only exists once someone is looking at a list.
            ['js/dashboard/dashboard-health-multi-select.js', 'dashboardHealthMultiSelect',
                () => typeof window.DashboardHealthMultiSelect === 'function'],
            // Focus mode rides along for the same reason: it is an overlay on a
            // health list, so it cannot be wanted before one exists.
            ['js/dashboard/dashboard-health-focus.js', 'dashboardHealthFocus',
                () => typeof window.DashboardHealthFocus === 'function'],
        ];
    }

    async _loadDependencies() {
        const missing = DashboardHealthLoader.DEPENDENCIES.filter(([, , isReady]) => !isReady());
        // Fetched side by side, run in order. Only what is missing: a preload
        // nothing goes on to use is a wasted download and a console warning.
        window.LazyScript.preloadScripts?.(missing.map(([rel]) => rel));
        for (const [rel, datasetKey, isReady] of missing) {
            await window.LazyScript.loadScriptOnce(rel, datasetKey, isReady);
        }
    }

    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._loadDependencies().then(() => {
            if (typeof window.DashboardHealth !== 'function') {
                throw new Error('health module loaded without defining DashboardHealth');
            }
            this._module = new window.DashboardHealth(this.dash);
            return this._module;
        }).catch((err) => {
            this._loadPromise = null;
            throw err;
        });

        return this._loadPromise;
    }

    /**
     * The Health view is gone; its addresses and its key land in the Bookmarks
     * view, on the filter they asked for. #health alone was Health's Broken
     * list, so it stays that; #health/monitors is the monitored ones, and a
     * search (hv_q) comes along. Every way in -- the router, Shift+H, the
     * badge's links, the review notice -- came through here, so this is the
     * one place that needs to know.
     */
    static bookmarksHashFor(search, hash) {
        const params = new URLSearchParams(search || '');
        const path = String(hash || '').replace(/^#/, '');
        const known = window.DashboardConfig?.HEALTH_FILTER_KEYS
            || ['broken', 'content', 'duplicate', 'stale', 'unused', 'unchecked', 'monitored', 'certificates', 'healthy',
                'drift', 'missing-preview', 'shortcut-conflict', 'orphaned-category', 'ignored'];
        const filter = path === 'health/monitors' ? 'monitored' : ((params.get('hv_filter') || 'broken').toLowerCase());
        const out = new URLSearchParams();
        if (known.includes(filter)) out.set('health', filter);
        const query = (params.get('hv_q') || '').trim();
        // Not in the public demo: typed text stays out of the address there.
        if (query && !window.DemoLock?.on) out.set('q', query);
        const qs = out.toString();
        return `#bookmarks${qs ? `?${qs}` : ''}`;
    }

    async openHealthView() {
        const here = window.location;
        const target = this.isEnabled()
            ? DashboardHealthLoader.bookmarksHashFor(here.search, here.hash)
            : '#bookmarks';
        // The hv_* parameters were the Health view's. hv_refresh asked for a
        // fresh scan on arrival, and a saved link that says so still gets one;
        // the rest are carried over above or have no meaning left.
        const params = new URLSearchParams(here.search);
        const refresh = ['1', 'true'].includes(String(params.get('hv_refresh') || '').toLowerCase());
        [...params.keys()].filter((k) => k.startsWith('hv_')).forEach((k) => params.delete(k));
        const qs = params.toString();
        history.replaceState(history.state, '', `${here.pathname}${qs ? `?${qs}` : ''}${target}`);
        const opened = await this.dash?.config?.openLibraryView?.();
        if (refresh && this.isEnabled()) await this.load().then((health) => health?.loadAndRender?.({ refresh: true }));
        return opened;
    }

}

function createHealthLoader(dashboard) {
    const stub = new DashboardHealthLoader(dashboard);
    return new Proxy(stub, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            const mod = target.instance;
            if (mod) {
                const value = mod[prop];
                return typeof value === 'function' ? value.bind(mod) : value;
            }
            return (...args) => target.load().then((loaded) => {
                const value = loaded[prop];
                return typeof value === 'function' ? value.apply(loaded, args) : value;
            });
        },
        set(target, prop, value, receiver) {
            if (prop in target) return Reflect.set(target, prop, value, receiver);
            const mod = target.instance;
            if (mod) {
                mod[prop] = value;
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        },
    });
}

window.DashboardHealthLoader = DashboardHealthLoader;
window.createDashboardHealthLoader = createHealthLoader;
