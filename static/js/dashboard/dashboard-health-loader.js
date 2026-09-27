/**
 * Lazy loader for the health view.
 *
 * dashboard-health.js is one of the largest scripts on the dashboard and most
 * sessions never open the health view — parsing it on every load costs every
 * bookmark page for nothing. This stub owns the small surface the shell touches
 * before health is ever opened and fetches the real module on first use.
 */
class DashboardHealthLoader {
    static VIEW = 'health';

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
        this._escapeHandler = null;
    }

    isEnabled() {
        return this.dash.settings?.healthViewEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardHealthLoader.VIEW;
    }

    get instance() {
        return this._module;
    }

    async _loadDependencies() {
        const load = window.LazyScript.loadScriptOnce;
        // Each dependency states its own readiness test, so the order of these
        // calls no longer has to work around filenames matching each other.
        if (typeof window.HealthReasonUtils === 'undefined') {
            await load('js/health-reason-utils.js', 'dashboardHealthReason',
                () => typeof window.HealthReasonUtils !== 'undefined');
        }
        if (typeof window.formatLastOpened !== 'function') {
            await load('js/shared/last-opened-format.js', 'dashboardLastOpened',
                () => typeof window.formatLastOpened === 'function');
        }
        // The chrome the view now renders into. Loaded before the module so a
        // first render can never find the shell missing and fall back to
        // nothing; the inbox loads it the same way.
        if (typeof window.ListViewShell === 'undefined') {
            await load('js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined');
        }
        // What Health puts in the side panel. The panel itself
        // (list-view-drawer.js) is on every page already.
        if (typeof window.HealthDrawer !== 'function') {
            await load('js/dashboard/dashboard-health-drawer.js', 'dashboardHealthDrawer',
                () => typeof window.HealthDrawer === 'function');
        }
        if (typeof window.DashboardHealth !== 'function') {
            await load('js/dashboard/dashboard-health.js', 'dashboardHealthModule',
                () => typeof window.DashboardHealth === 'function');
        }
        // Loaded with the view rather than on the dashboard's critical path: the
        // bulk toolbar only exists once someone is looking at a health list.
        if (typeof window.DashboardHealthMultiSelect !== 'function') {
            await load('js/dashboard/dashboard-health-multi-select.js', 'dashboardHealthMultiSelect',
                () => typeof window.DashboardHealthMultiSelect === 'function');
        }
        // Focus mode rides along with the view for the same reason as the bulk
        // toolbar: it is an overlay on a health list, so it cannot be wanted
        // before one exists.
        if (typeof window.DashboardHealthFocus !== 'function') {
            await load('js/dashboard/dashboard-health-focus.js', 'dashboardHealthFocus',
                () => typeof window.DashboardHealthFocus === 'function');
        }
        // The one-time tutorial is only ever read from openHealthView(), so it
        // has no reason to cost anything on a session that never opens Health.
        if (typeof window.HealthTutorial === 'undefined') {
            await load('js/health-tutorial.js', 'healthTutorialModule',
                () => typeof window.HealthTutorial !== 'undefined');
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
            this._teardownEscapeShortcut();
            this._module.setupEscapeShortcut?.();
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
        const known = window.DashboardConfig?.HEALTH_FILTERS
            || ['broken', 'content', 'duplicate', 'stale', 'unused', 'unchecked', 'monitored', 'certificates', 'healthy'];
        const filter = path === 'health/monitors' ? 'monitored' : ((params.get('hv_filter') || 'broken').toLowerCase());
        const out = new URLSearchParams();
        if (known.includes(filter)) out.set('health', filter);
        const query = (params.get('hv_q') || '').trim();
        if (query) out.set('q', query);
        const qs = out.toString();
        return `#bookmarks${qs ? `?${qs}` : ''}`;
    }

    async openHealthView() {
        const here = window.location;
        const target = this.isEnabled()
            ? DashboardHealthLoader.bookmarksHashFor(here.search, here.hash)
            : '#bookmarks';
        // The hv_* parameters were the Health view's; nothing reads them now.
        const params = new URLSearchParams(here.search);
        [...params.keys()].filter((k) => k.startsWith('hv_')).forEach((k) => params.delete(k));
        const qs = params.toString();
        history.replaceState(history.state, '', `${here.pathname}${qs ? `?${qs}` : ''}${target}`);
        return this.dash?.config?.openLibraryView?.();
    }

    closeHealthView(...args) {
        return this._module?.closeHealthView?.(...args) ?? this.closeHealthViewWhileLoading();
    }

    closeHealthViewWhileLoading() {
        const d = this.dash;
        if (!this.isActiveView()) {
            return false;
        }
        this._teardownEscapeShortcut();
        const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
        if (restored) {
            d.keyboardNavigation?.scheduleUpdate?.();
        }
        return restored;
    }

    restoreViewIfNeeded(...args) {
        if (!this.isActiveView() || !this.isEnabled()) {
            return;
        }
        if (this._module) {
            return this._module.restoreViewIfNeeded(...args);
        }
        void this.load().then((mod) => mod.restoreViewIfNeeded(...args));
    }

    restoreHealthHash(...args) {
        return this._module?.restoreHealthHash?.(...args);
    }

    setupEscapeShortcut() {
        // Unlike the other two stubs, Escape during loading closes the half-open
        // view rather than falling through — the view is already on screen.
        window.LazyScript.bindStubEscape(this, (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.closeHealthViewWhileLoading();
        });
    }

    _teardownEscapeShortcut() {
        window.LazyScript.unbindStubEscape(this);
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
