/**
 * Lazy loader for the inbox view.
 *
 * dashboard-inbox.js is large and users who disable the inbox never need it.
 * When inboxEnabled is false the module is not fetched at all; when enabled it
 * loads during dashboard bootstrap so unread badges still work.
 */
class DashboardInboxLoader {
    static VIEW = 'inbox';

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
        this._escapeHandler = null;
        this._bootstrapPromise = null;
    }

    isEnabled() {
        return this.dash.settings?.inboxEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardInboxLoader.VIEW;
    }

    get instance() {
        return this._module;
    }

    _assetURL(rel) {
        return (window.NEXTDASH_ASSETS && window.NEXTDASH_ASSETS[rel])
            || `/static/${rel}`;
    }

    _loadScript(rel, datasetKey) {
        const src = this._assetURL(rel);
        return new Promise((resolve, reject) => {
            const selector = `script[data-${datasetKey}]`;
            const existing = document.querySelector(selector);
            const ready = () => {
                if (rel.includes('dashboard-inbox-triage.js')) {
                    return typeof DashboardInboxTriage === 'function';
                }
                if (rel.includes('dashboard-inbox.js')) {
                    return typeof DashboardInbox === 'function';
                }
                return false;
            };
            if (ready()) {
                resolve();
                return;
            }
            if (existing) {
                if (ready()) {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`${rel} failed to load`)), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset[datasetKey] = 'true';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`${rel} failed to load`));
            document.head.appendChild(script);
        });
    }

    async _loadDependencies() {
        if (typeof DashboardInboxTriage === 'undefined') {
            await this._loadScript('js/dashboard/dashboard-inbox-triage.js', 'dashboardInboxTriage');
        }
        if (typeof DashboardInbox === 'undefined') {
            await this._loadScript('js/dashboard/dashboard-inbox.js', 'dashboardInboxModule');
        }
    }

    load() {
        if (!this.isEnabled()) {
            return Promise.resolve(null);
        }
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._loadDependencies().then(() => {
            if (typeof DashboardInbox !== 'function') {
                throw new Error('inbox module loaded without defining DashboardInbox');
            }
            this._module = new DashboardInbox(this.dash);
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
     * Called after settings are known. Loads the inbox module when enabled so
     * unread counts and paste-to-inbox keep working without opening the view.
     */
    bootstrap() {
        if (!this.isEnabled()) {
            return Promise.resolve(null);
        }
        if (this._bootstrapPromise) return this._bootstrapPromise;
        this._bootstrapPromise = this.load()
            .then((mod) => mod?.loadItems?.() ?? null)
            .catch(() => null)
            .finally(() => {
                this._bootstrapPromise = null;
            });
        return this._bootstrapPromise;
    }

    async openInboxView(...args) {
        if (!this.isEnabled()) {
            return false;
        }
        let mod;
        try {
            mod = await this.load();
        } catch (err) {
            const msg = this.dash?.language?.t?.('dashboard.inboxLoadFailed');
            const text = (typeof msg === 'string' && msg !== 'dashboard.inboxLoadFailed')
                ? msg
                : 'Could not open inbox. Check your connection and try again.';
            if (window.AppNotification?.showError) {
                window.AppNotification.showError(text);
            } else {
                this.dash?.showErrorNotification?.(text);
            }
            throw err;
        }
        if (!mod) return false;
        return mod.openInboxView(...args);
    }

    closeInboxView(...args) {
        return this._module?.closeInboxView?.(...args);
    }

    restoreViewIfNeeded(...args) {
        if (!this.isActiveView() || !this.isEnabled()) {
            return;
        }
        if (this._module) {
            return this._module.restoreViewIfNeeded(...args);
        }
        void this.load().then((mod) => mod?.restoreViewIfNeeded?.(...args));
    }

    restoreInboxHash(...args) {
        return this._module?.restoreInboxHash?.(...args);
    }

    /** Unread badge reads this before the view opens; safe default is zero. */
    unreadCount() {
        return this._module?.unreadCount?.() || 0;
    }

    setupEscapeShortcut() {
        this._teardownEscapeShortcut();
        this._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isActiveView()) return;
            if (!this._module) return;
            this._module.setupEscapeShortcut?.();
            this._teardownEscapeShortcut();
        };
        document.addEventListener('keydown', this._escapeHandler, true);
    }

    _teardownEscapeShortcut() {
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler, true);
            this._escapeHandler = null;
        }
    }
}

function createInboxLoader(dashboard) {
    const stub = new DashboardInboxLoader(dashboard);
    return new Proxy(stub, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            const mod = target.instance;
            if (mod) {
                const value = mod[prop];
                return typeof value === 'function' ? value.bind(mod) : value;
            }
            if (!target.isEnabled()) {
                return typeof prop === 'string' && prop.startsWith('load') ? () => Promise.resolve([]) : undefined;
            }
            return (...args) => target.load().then((loaded) => {
                if (!loaded) return undefined;
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

window.DashboardInboxLoader = DashboardInboxLoader;
window.createDashboardInboxLoader = createInboxLoader;
