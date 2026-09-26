/**
 * Lazy loader for the Docker view, modelled on dashboard-health-loader.js.
 *
 * dashboard-docker.js only matters to someone who runs nextDash next to
 * Docker and opens the view; every other session should not pay to parse it.
 * This stub owns the small surface the shell touches before Docker is ever
 * opened and fetches the real module on first use.
 */
class DashboardDockerLoader {
    static VIEW = 'docker';

    constructor(dashboard) {
        this.dash = dashboard;
        this._module = null;
        this._loadPromise = null;
        this._escapeHandler = null;
    }

    /** Config -> Containers can switch the view off; absent means on. */
    isEnabled() {
        return this.dash.settings?.dockerViewEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardDockerLoader.VIEW;
    }

    get instance() {
        return this._module;
    }

    async _loadDependencies() {
        const load = window.LazyScript.loadScriptOnce;
        // The chrome the view renders into, loaded before the module so a
        // first render can never find the shell missing — the health and
        // inbox loaders load it the same way. In practice it is already on
        // the page via its own <script> tag, so this is usually a no-op.
        if (typeof window.ListViewShell === 'undefined') {
            await load('js/shared/list-view-shell.js', 'listViewShell',
                () => typeof window.ListViewShell !== 'undefined');
        }
        // The actions before the view, whose constructor builds them.
        if (typeof window.DockerActions !== 'function') {
            await load('js/dashboard/dashboard-docker-actions.js', 'dashboardDockerActions',
                () => typeof window.DockerActions === 'function');
        }
        // The drawer's sections, loaded before the view module so mountShell()
        // never constructs a DockerDrawer before the class exists.
        if (typeof window.DockerDrawer !== 'function') {
            await load('js/dashboard/dashboard-docker-drawer.js', 'dashboardDockerDrawer',
                () => typeof window.DockerDrawer === 'function');
        }
        if (typeof window.DashboardDocker !== 'function') {
            await load('js/dashboard/dashboard-docker.js', 'dashboardDockerModule',
                () => typeof window.DashboardDocker === 'function');
        }
    }

    load() {
        if (this._module) return Promise.resolve(this._module);
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = this._loadDependencies().then(() => {
            if (typeof window.DashboardDocker !== 'function') {
                throw new Error('docker module loaded without defining DashboardDocker');
            }
            this._module = new window.DashboardDocker(this.dash);
            this._teardownEscapeShortcut();
            this._module.setupEscapeShortcut?.();
            return this._module;
        }).catch((err) => {
            this._loadPromise = null;
            throw err;
        });

        return this._loadPromise;
    }

    async openDockerView(...args) {
        // Switched off in Config: the address leads home rather than to a
        // view the reader asked not to have.
        if (!this.isEnabled()) {
            this.dash.pageNav?.restoreBookmarksViewForPage?.(this.dash.currentPageId);
            return false;
        }
        // The view stylesheet rides in the bundle nothing requests until a view
        // is actually opened. Awaited, so the view does not paint unstyled.
        await window.ViewStyles?.ensureViewStyles?.();
        let mod;
        try {
            mod = await this.load();
        } catch (err) {
            const msg = this.dash?.language?.t?.('dashboard.dockerLoadFailed');
            const text = (typeof msg === 'string' && msg !== 'dashboard.dockerLoadFailed')
                ? msg
                : 'Could not open the Docker view. Check your connection and try again.';
            if (window.AppNotification?.showError) {
                window.AppNotification.showError(text);
            } else {
                this.dash?.showErrorNotification?.(text);
            }
            throw err;
        }
        return mod.openDockerView(...args);
    }

    closeDockerView(...args) {
        return this._module?.closeDockerView?.(...args) ?? this.closeDockerViewWhileLoading();
    }

    closeDockerViewWhileLoading() {
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

    restoreDockerHash(...args) {
        return this._module?.restoreDockerHash?.(...args);
    }

    /** The header icon shows it is the open view, the way health's does. */
    syncNavActiveState() {
        const anchor = document.querySelector('#page-nav-docker-host .docker-link-anchor');
        if (!anchor) return;
        const active = this.isActiveView();
        anchor.classList.toggle('active', active);
        if (active) anchor.setAttribute('aria-current', 'page');
        else anchor.removeAttribute('aria-current');
    }

    /**
     * One action from outside the view -- the :docker palette. The module is
     * loaded for its dialogs and requests, but the view is not opened: the
     * reader stays where they are and sees the result as a notice.
     */
    async runAction(action, name) {
        const mod = await this.load();
        if (!mod.status) mod.status = await window.DockerSearchIndex?.status?.();
        const fresh = await window.DockerSearchIndex?.refresh?.();
        if (!mod.isActiveView() && Array.isArray(fresh)) mod.containers = fresh;
        const container = mod.containers.find((c) => c.name === name);
        if (!container || !mod.actions) return false;
        return mod.actions.run(action, container);
    }

    selectContainer(...args) {
        if (this._module) return this._module.selectContainer?.(...args);
        return this.load().then((mod) => mod.selectContainer?.(...args));
    }

    setupEscapeShortcut() {
        // Unlike the module's own handler, Escape during loading closes the
        // half-open view rather than falling through — the view is already on
        // screen by the time a script can still be loading.
        window.LazyScript.bindStubEscape(this, (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.closeDockerViewWhileLoading();
        });
    }

    _teardownEscapeShortcut() {
        window.LazyScript.unbindStubEscape(this);
    }

    /**
     * The header/nav icon that opens the view. Docker is the rare destination
     * that may not exist for a given install, so it renders itself only once
     * the status is known — nothing lights up on a machine with no socket.
     */
    async renderNavButton() {
        const host = document.getElementById('page-nav-docker-host');
        if (!host) return;
        host.innerHTML = '';
        if (!this.isEnabled()) return;
        const status = await window.DockerSearchIndex?.status?.();
        if (!status?.socket || !this.isEnabled()) return;

        const raw = this.dash?.language?.t?.('dashboard.dockerView');
        const label = raw && raw !== 'dashboard.dockerView' ? raw : 'Containers';

        const anchor = document.createElement('a');
        anchor.href = '/#docker';
        anchor.className = 'docker-link-anchor';
        anchor.setAttribute('aria-label', label);
        anchor.title = label;
        anchor.setAttribute('data-i18n-aria', 'dashboard.dockerView');
        anchor.setAttribute('data-i18n-tooltip', 'dashboard.dockerView');

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.setAttribute('class', 'docker-link-icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '18');
        svg.setAttribute('height', '18');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        // A shipping crate: the same reading Docker's own mark uses, simplified
        // to two paths so it holds up at 18px next to the other header icons.
        const box = document.createElementNS(svgNS, 'path');
        box.setAttribute('d', 'M3 7.5 12 4l9 3.5-9 3.5-9-3.5Z');
        const body = document.createElementNS(svgNS, 'path');
        body.setAttribute('d', 'M3 7.5v9L12 20l9-3.5v-9M12 11v9');
        svg.append(box, body);
        anchor.appendChild(svg);

        anchor.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                return;
            }
            e.preventDefault();
            void this.openDockerView();
        });

        host.appendChild(anchor);
    }
}

function createDockerLoader(dashboard) {
    const stub = new DashboardDockerLoader(dashboard);
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

window.DashboardDockerLoader = DashboardDockerLoader;
window.createDashboardDockerLoader = createDockerLoader;
