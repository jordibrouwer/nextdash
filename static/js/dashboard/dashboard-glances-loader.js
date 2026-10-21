/**
 * Lazy loader for the Glances view, modelled on dashboard-docker-loader.js.
 *
 * The view only matters to someone with a Glances widget who opens it; every
 * other session should not pay to parse it. This stub owns the small surface
 * the shell touches before the view is ever opened and fetches the real
 * module, and its section files, on first use.
 */
class DashboardGlancesLoader {
    static VIEW = 'glances';

    /**
     * The section files, in the order they register. A new section is one
     * line here plus its file in lazyLoadedAssets; the menu is built from the
     * registry, so nothing else names it.
     */
    static SECTION_SCRIPTS = [
        ['js/dashboard/dashboard-glances-overview.js', 'dashboardGlancesOverview', 'overview'],
        ['js/dashboard/dashboard-glances-processes.js', 'dashboardGlancesProcesses', 'processes'],
        ['js/dashboard/dashboard-glances-containers.js', 'dashboardGlancesContainers', 'containers'],
        ['js/dashboard/dashboard-glances-disks.js', 'dashboardGlancesDisks', 'disks'],
        ['js/dashboard/dashboard-glances-network.js', 'dashboardGlancesNetwork', 'network'],
        ['js/dashboard/dashboard-glances-history.js', 'dashboardGlancesHistory', 'history'],
        ['js/dashboard/dashboard-glances-alerts.js', 'dashboardGlancesAlerts', 'alerts'],
    ];

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
        this._escapeHandler = null;
    }

    /** No setting switches the view off: a Glances widget is the way in. */
    isEnabled() {
        return true;
    }

    isActiveView() {
        return this.dash.activeView === DashboardGlancesLoader.VIEW;
    }

    get instance() {
        return this._module;
    }

    async _loadDependencies() {
        const load = window.LazyScript.loadScriptOnce;
        if (typeof window.ListViewShell === 'undefined') {
            await load('js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined');
        }
        // The view first: it owns the registry the section files register on.
        if (typeof window.DashboardGlances !== 'function') {
            await load('js/dashboard/dashboard-glances.js', 'dashboardGlancesModule',
                () => typeof window.DashboardGlances === 'function');
        }
        for (const [rel, key, id] of DashboardGlancesLoader.SECTION_SCRIPTS) {
            await load(rel, key, () => Boolean(window.DashboardGlancesSections?.get?.(id)));
        }
    }

    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._loadDependencies().then(() => {
            if (typeof window.DashboardGlances !== 'function') {
                throw new Error('glances module loaded without defining DashboardGlances');
            }
            this._module = new window.DashboardGlances(this.dash);
            this._teardownEscapeShortcut();
            this._module.setupEscapeShortcut?.();
            return this._module;
        }).catch((err) => {
            this._loadPromise = null;
            throw err;
        });

        return this._loadPromise;
    }

    async openGlancesView(...args) {
        await window.ViewStyles?.ensureViewStyles?.();
        let mod;
        try {
            mod = await this.load();
        } catch (err) {
            const msg = this.dash?.language?.t?.('dashboard.glancesLoadFailed');
            const text = (typeof msg === 'string' && msg !== 'dashboard.glancesLoadFailed')
                ? msg
                : 'Could not open the Glances view. Check your connection and try again.';
            if (window.AppNotification?.showError) {
                window.AppNotification.showError(text);
            } else {
                this.dash?.showErrorNotification?.(text);
            }
            throw err;
        }
        return mod.openGlancesView(...args);
    }

    closeGlancesView(...args) {
        return this._module?.closeGlancesView?.(...args) ?? this.closeGlancesViewWhileLoading();
    }

    closeGlancesViewWhileLoading() {
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

    /** Called by the dashboard when another view takes the layout. */
    onLeave() {
        this._module?.onLeave?.();
    }

    setupEscapeShortcut() {
        window.LazyScript.bindStubEscape(this, (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.closeGlancesViewWhileLoading();
        });
    }

    _teardownEscapeShortcut() {
        window.LazyScript.unbindStubEscape(this);
    }
}

function createGlancesLoader(dashboard) {
    const stub = new DashboardGlancesLoader(dashboard);
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

window.DashboardGlancesLoader = DashboardGlancesLoader;
window.createDashboardGlancesLoader = createGlancesLoader;
