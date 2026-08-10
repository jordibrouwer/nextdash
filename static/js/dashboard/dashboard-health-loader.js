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

    async openHealthView(...args) {
        if (!this.isEnabled()) {
            return false;
        }
        let mod;
        try {
            mod = await this.load();
        } catch (err) {
            const msg = this.dash?.language?.t?.('dashboard.healthLoadFailed');
            const text = (typeof msg === 'string' && msg !== 'dashboard.healthLoadFailed')
                ? msg
                : 'Could not open health view. Check your connection and try again.';
            if (window.AppNotification?.showError) {
                window.AppNotification.showError(text);
            } else {
                this.dash?.showErrorNotification?.(text);
            }
            throw err;
        }
        return mod.openHealthView(...args);
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
