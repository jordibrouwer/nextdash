/**
 * Lazy loader for the config view.
 *
 * dashboard-config.js is by far the largest script the dashboard ships, and the
 * config view is a separate destination most sessions never open — loading it up
 * front cost every bookmark page a large parse for nothing. This stub owns the
 * small surface the shell touches before config is ever opened, and fetches the
 * real module on the first open.
 *
 * The shell keeps calling `dash.config.*` exactly as before; only the moment the
 * heavy script arrives changes. Anything here that must answer before the module
 * loads (isEnabled, the Escape handler, hash parsing) is deliberately duplicated
 * — see the notes on each — because the alternative is loading the module to ask.
 */
class DashboardConfigLoader {
    /**
     * Sections are mirrored from DashboardConfig so a deep link like
     * #config/appearance can be parsed before the module is loaded. Kept in sync
     * by dashboard-config-loader.spec.js, which fails if the two lists diverge.
     */
    static SECTIONS = [
        'overview',
        'pages-tags',
        'bookmarks',
        'appearance',
        'behavior',
        'data-backups',
        'stats',
        'help',
    ];

    static VIEW = 'config';

    /** Mirrors DashboardConfig.isGenericConfigHash for pre-load hash routing. */
    static isGenericConfigHash(hash) {
        return typeof hash === 'string' && hash.replace(/^#/, '') === 'config';
    }

    /** Mirrors DashboardConfig.sectionFromHash for pre-load hash routing. */
    static sectionFromHash(hash) {
        if (typeof hash !== 'string') return null;
        const raw = hash.replace(/^#/, '');
        if (raw === 'config') return 'overview';
        const match = raw.match(/^config\/([a-z-]+)(?:\/([a-z-]+))?$/);
        if (!match) return null;
        return DashboardConfigLoader.SECTIONS.includes(match[1]) ? match[1] : 'overview';
    }

    static CONFIG_LAST_KEY = 'nextdash:config-last-location-v1';

    /** Mirrors DashboardConfig.SUB_TAB_STATE for pre-load sub-tab replay. */
    static SUB_TAB_STATE = {
        behavior: 'behaviorTab',
        'pages-tags': 'ptTab',
        appearance: 'appearanceTab',
        stats: 'statsTab',
        'data-backups': 'dataTab',
        help: 'helpTab',
    };

    /** Mirrors DashboardConfig.loadLastConfigLocation for cold load on bare `#config`. */
    static loadLastConfigLocation() {
        try {
            const raw = localStorage.getItem(DashboardConfigLoader.CONFIG_LAST_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            const section = data?.section;
            if (!section || !DashboardConfigLoader.SECTIONS.includes(section)) return null;
            let subTab = data?.subTab ?? null;
            if (section === 'behavior' && (subTab === 'layout' || subTab === 'display')) {
                return { section: 'appearance', subTab };
            }
            return { section, subTab: subTab || null };
        } catch {
            return null;
        }
    }

    /**
     * View state that callers read or write through `dash.config` directly,
     * rather than through a method: the current section, and the per-section
     * sub-tab (analytics-notice.js does `config.behaviorTab = 'privacy'` then
     * opens Behavior). Writes that land before the module exists are buffered
     * and replayed onto it, so a deep link into a sub-tab keeps working; reads
     * pass straight through once it is there.
     */
    static PROXIED_STATE = [
        'section',
        'loading',
        'ptTab',
        'appearanceTab',
        'behaviorTab',
        'helpTab',
        'bookmarksTab',
        'dataTab',
        'statsTab',
    ];

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
        this._escapeHandler = null;
        this._pendingProps = {};

        // Buffer pre-load state assignments; once the module is in, read and
        // write straight through to it so both sides always agree.
        for (const prop of DashboardConfigLoader.PROXIED_STATE) {
            Object.defineProperty(this, prop, {
                get: () => (this._module ? this._module[prop] : this._pendingProps[prop]),
                set: (value) => {
                    if (this._module) {
                        this._module[prop] = value;
                    } else {
                        this._pendingProps[prop] = value;
                    }
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    /**
     * Config is never feature-gated (unlike health/inbox), so this can answer
     * without the module. Mirrors DashboardConfig.isEnabled.
     */
    isEnabled() {
        return true;
    }

    isActiveView() {
        return this.dash.activeView === DashboardConfigLoader.VIEW;
    }

    /** Delegates to the loaded module; config must be open so the module exists. */
    handleKeyboardNavigation(e) {
        return this._module?.handleKeyboardNavigation?.(e) ?? false;
    }

    /** The real DashboardConfig instance once loaded, else null. */
    get instance() {
        return this._module;
    }

    /**
     * Fetch and instantiate the real config module, once. Concurrent callers
     * share the same promise; a failed load clears it so a retry can succeed.
     */
    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;

        const src = (window.NEXTDASH_ASSETS && window.NEXTDASH_ASSETS['js/dashboard/dashboard-config.js'])
            || '/static/js/dashboard/dashboard-config.js';

        this._loadPromise = new Promise((resolve, reject) => {
            if (typeof window.DashboardConfig === 'function') {
                resolve();
                return;
            }
            const existing = document.querySelector('script[data-dashboard-config]');
            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('config module failed to load')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.dashboardConfig = 'true';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('config module failed to load'));
            document.head.appendChild(script);
        }).then(() => {
            if (typeof window.DashboardConfig !== 'function') {
                throw new Error('config module loaded without defining DashboardConfig');
            }
            this._module = new window.DashboardConfig(this.dash);
            // Replay sub-tab choices made before the module existed, so opening
            // straight into e.g. Behavior → Privacy still lands on Privacy.
            for (const [prop, value] of Object.entries(this._pendingProps)) {
                if (value !== undefined) this._module[prop] = value;
            }
            this._pendingProps = {};
            // The shell wired its Escape handler to this stub before the module
            // existed. Hand the key over so the module's own guards (modals,
            // inline edit, search) apply from here on, and drop ours.
            this._teardownEscapeShortcut();
            this._module.setupEscapeShortcut?.();
            return this._module;
        }).catch((err) => {
            // Let a later attempt retry rather than wedging config permanently.
            this._loadPromise = null;
            throw err;
        });

        return this._loadPromise;
    }

    async openConfigView(section) {
        let mod;
        try {
            mod = await this.load();
        } catch (err) {
            const msg = this.dash?.language?.t?.('config.loadFailed');
            const text = (typeof msg === 'string' && msg !== 'config.loadFailed')
                ? msg
                : 'Could not open settings. Check your connection and try again.';
            if (window.AppNotification?.showError) {
                window.AppNotification.showError(text);
            } else {
                this.dash?.showErrorNotification?.(text);
            }
            throw err;
        }
        return mod.openConfigView(section);
    }

    /**
     * Only ever called while config is the active view, which cannot happen
     * before openConfigView has loaded the module — so a missing module here
     * means nothing to render rather than something to wait for.
     */
    render(...args) {
        return this._module?.render?.(...args);
    }

    closeConfigView(...args) {
        return this._module?.closeConfigView?.(...args);
    }

    restoreConfigSectionFromHash(...args) {
        return this._module?.restoreConfigSectionFromHash?.(...args);
    }

    /**
     * Escape must close config even if the module somehow is not loaded yet.
     * In practice config cannot be the active view without the module, but the
     * handler is installed at startup and mirrors health/inbox, so it stays
     * cheap and self-contained rather than pulling in 400KB to bind a key.
     */
    setupEscapeShortcut() {
        this._teardownEscapeShortcut();
        this._escapeHandler = (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isActiveView()) return;
            if (!this._module) return;
            // Once loaded, the module installs its own handler with the full set
            // of guards; this one steps aside.
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

/**
 * Anything the stub does not implement itself is forwarded to the real module,
 * loading it first when necessary. Without this, every method reachable through
 * `dash.config` would need a hand-written passthrough here, and adding one to
 * DashboardConfig later would silently break it — the loader would return
 * undefined instead of the method.
 *
 * Forwarded methods necessarily return a Promise, since the module may still be
 * in flight. Callers that need a synchronous answer before the first open must
 * be handled explicitly on the stub above (isEnabled, sectionFromHash).
 */
function createConfigLoader(dashboard) {
    const stub = new DashboardConfigLoader(dashboard);
    return new Proxy(stub, {
        get(target, prop, receiver) {
            if (prop in target) return Reflect.get(target, prop, receiver);
            const mod = target.instance;
            if (mod) {
                const value = mod[prop];
                return typeof value === 'function' ? value.bind(mod) : value;
            }
            // Unknown property, module not loaded: expose it as a call that
            // loads first. A non-method read cannot be answered synchronously,
            // which is why state read before load lives in PROXIED_STATE.
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

window.DashboardConfigLoader = DashboardConfigLoader;
window.createDashboardConfigLoader = createConfigLoader;
