/**
 * Glances view (#glances) -- one machine, read through one Glances widget.
 *
 * A side menu with one section per screen, on the shared list-view shell the
 * Containers view uses. This file owns the shell, the address, the menu and
 * the polling; what a section shows lives in its own file, which registers on
 * window.DashboardGlancesSections (see the registry below for the contract).
 *
 * Every read goes through the server (/api/glances/<widgetId>/<path>), which
 * holds the address and the login; Glances itself is never asked from here.
 */
(function () {
    'use strict';

    /*
     * The section registry.
     *
     * A section file calls register() once, at load:
     *
     *   window.DashboardGlancesSections.register({
     *       id: 'disks',                   // the address: #glances/disks
     *       label: 'Disks',                // fallback for labelKey
     *       labelKey: 'dashboard.glancesSectionDisks',
     *       order: 40,                     // menu position, low first
     *       plugin: 'fs',                  // left out when /pluginslist lacks it
     *       Section: GlancesDisks,         // new Section(view) per opening
     *       badge(feed, view) { ... },     // optional, see refreshBadges()
     *   });
     *
     * A Section instance answers endpoints() -> string[] (paths under the
     * widget, query allowed: 'processlist?sort=cpu') and render(container,
     * data), where data maps each of those strings to the parsed answer, to
     * {available:false} when the host does not run that plugin, or to null when
     * the read failed. A section that builds a path from a server string (a
     * container name, a disk) must encodeURIComponent that segment itself. render() is called on every refresh with the same
     * container, so a section may build once and update in place. destroy() is
     * optional and runs when the section is closed.
     */
    const registry = new Map();
    const Sections = {
        register(def) {
            if (!def || typeof def.id !== 'string' || !def.id || typeof def.Section !== 'function') {
                throw new Error('DashboardGlancesSections.register needs an id and a Section class');
            }
            const order = Number(def.order);
            registry.set(def.id, { ...def, order: Number.isFinite(order) ? order : 999 });
        },
        get(id) {
            return registry.get(id) || null;
        },
        list() {
            return [...registry.values()].sort((a, b) => a.order - b.order);
        },
    };

    /** The words for each {"error":code} answer. */
    const ERRORS = {
        'not set up': ['dashboard.glancesErrNotSetUp', 'This Glances widget has no server address yet. Add one in its settings.'],
        'address not allowed': ['dashboard.glancesErrNotAllowed', 'That address is not allowed. Check the server address in the widget settings.'],
        'login refused': ['dashboard.glancesErrLogin', 'Glances refused that login. Check the credential in the widget settings.'],
        'key refused': ['dashboard.glancesErrLogin', 'Glances refused that login. Check the credential in the widget settings.'],
        'needs Glances 4': ['dashboard.glancesErrNeedsV4', 'This view needs Glances 4.'],
        unreachable: ['dashboard.glancesErrUnreachable', 'Glances does not answer at that address.'],
    };

    class DashboardGlances {
        static VIEW = 'glances';
        static REFRESH_MS = 5000;
        static BADGE_MS = 30000;
        /** The tile's own reads plus the alert log: cheap, and enough for the dots. */
        static BADGE_PATHS = ['quicklook', 'fs', 'sensors', 'alert'];
        static DASH = '–';

        constructor(dashboard) {
            this.dash = dashboard;
            this.widgetId = null;
            this.pageId = null;
            this.section = null;
            /** Plugin names from /pluginslist, or null when unknown (then every section shows). */
            this.plugins = null;
            this.shell = null;
            this.sectionInstance = null;
            this.bodyEl = null;
            this.hostEl = null;
            this.statusEl = null;
            this.errorEl = null;
            this._pollTimer = null;
            this._badgeTimer = null;
            this._seq = 0;
            this._inflight = 0;
            this._openSeq = 0;
            this._escapeHandler = null;
            this._visibilityHandler = null;
        }

        /* ── Helpers sections share ─────────────────────────────────────── */

        t(key, fallback, params) {
            const d = this.dash;
            if (params && typeof d.formatDashboardLabel === 'function') {
                const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
                const text = d.formatDashboardLabel(bare, params, fallback);
                if (text && text !== bare && text !== key) {
                    return text;
                }
            }
            const raw = d.language?.t?.(key);
            const base = raw && raw !== key ? raw : fallback;
            if (!params) return base;
            return Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(base || '')
            );
        }

        /** The answer when it carries data: not null, not "not available", not an error. */
        static usable(value) {
            if (value === null || value === undefined) return null;
            if (typeof value === 'object' && !Array.isArray(value)
                && (value.available === false || typeof value.error === 'string')) {
                return null;
            }
            return value;
        }

        static isUnavailable(value) {
            return Boolean(value && typeof value === 'object' && !Array.isArray(value) && value.available === false);
        }

        /** A reading, or null. Never 0 for something that was not sent. */
        static num(value) {
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            if (typeof value === 'string' && value.trim() !== '') {
                const n = Number(value);
                return Number.isFinite(n) ? n : null;
            }
            return null;
        }

        /** accent, warn at 80, bad at 90 -- the tile's thresholds. */
        static tone(pct, warn = 80, bad = 90) {
            if (pct === null) return '';
            if (pct >= bad) return 'bad';
            if (pct >= warn) return 'warn';
            return '';
        }

        static formatBytes(bytes) {
            const n0 = DashboardGlances.num(bytes);
            if (n0 === null) return DashboardGlances.DASH;
            const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
            let n = n0;
            let unit = 0;
            while (n >= 1024 && unit < units.length - 1) {
                n /= 1024;
                unit += 1;
            }
            return unit === 0 ? `${Math.round(n)} B` : `${n.toFixed(1)} ${units[unit]}`;
        }

        /** #glances, #glances/<section>, #glances?w=..&p=.. -> its parts; null for any other hash. */
        static parseHash(hash) {
            const raw = String(hash || '').replace(/^#/, '');
            if (!(raw === 'glances' || raw.startsWith('glances/') || raw.startsWith('glances?'))) return null;
            let rest = raw.slice('glances'.length);
            let query = '';
            const qi = rest.indexOf('?');
            if (qi >= 0) {
                query = rest.slice(qi + 1);
                rest = rest.slice(0, qi);
            }
            let section = rest.startsWith('/') ? rest.slice(1) : '';
            try { section = decodeURIComponent(section); } catch { /* keep it raw */ }
            const params = new URLSearchParams(query);
            return { section: section || null, widgetId: params.get('w') || null, pageId: params.get('p') || null };
        }

        isActiveView() {
            return this.dash.activeView === DashboardGlances.VIEW;
        }

        /* ── Address ────────────────────────────────────────────────────── */

        hashFor(section) {
            const w = encodeURIComponent(this.widgetId || '');
            const p = encodeURIComponent(this.pageId ?? '');
            return `#glances/${encodeURIComponent(section || 'overview')}?w=${w}&p=${p}`;
        }

        /**
         * Arriving from elsewhere is a place to go Back to (push); a section
         * switch rewrites the address in place, as the Containers view does.
         */
        writeHash({ push = false } = {}) {
            if (!this.isActiveView() || !this.widgetId) return;
            const target = this.hashFor(this.section);
            if (window.location.hash === target) return;
            const next = `${window.location.pathname}${window.location.search}${target}`;
            if (push && window.DashboardHistory?.pushLocation?.(next)) return;
            history.replaceState(history.state, '', next);
        }

        /* ── View lifecycle ─────────────────────────────────────────────── */

        /**
         * Open the view, or -- when it is already open -- follow the address:
         * another widget reopens, another section switches.
         * Accepts { hash } or { section, widgetId, pageId }.
         */
        async openGlancesView(options = {}) {
            const route = options.hash !== undefined
                ? (DashboardGlances.parseHash(options.hash) || {})
                : options;
            const d = this.dash;
            if (this.isActiveView() && this.shell) {
                const sameWidget = !route.widgetId
                    || (route.widgetId === this.widgetId && String(route.pageId ?? '') === String(this.pageId ?? ''));
                if (sameWidget) {
                    if (route.section && route.section !== this.section) this.openSection(route.section);
                    // A bare #glances typed over the open view gets its w and p back.
                    else this.writeHash();
                    return true;
                }
            } else if (!this.isActiveView()) {
                if (d.isInlineEditActive?.() && !(await d.confirmInlineEditBeforeNavigation?.())) {
                    return false;
                }
                d._abortInlineEditForRender?.();
                d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
                d.inbox?.clearKeyboardSelection?.();
                d.setActiveView(DashboardGlances.VIEW);
                window.nextdashTrack?.('view:glances');
            }
            const cameFromElsewhere = !DashboardGlances.parseHash(window.location.hash);
            this._stopTimers();
            this.sectionInstance?.destroy?.();
            this.sectionInstance = null;
            this.plugins = null;
            this.widgetId = route.widgetId || null;
            this.pageId = route.pageId ?? null;
            const seq = ++this._openSeq;
            this._prepareContainer();

            if (!this.widgetId) {
                const found = await this.findWidget();
                if (seq !== this._openSeq || !this.isActiveView()) return false;
                if (!found) {
                    this.renderEmpty();
                    return true;
                }
                this.widgetId = found.widgetId;
                this.pageId = found.pageId;
            }

            // Which sections this host has: asked once per opening.
            const probe = await this.fetchPath('pluginslist');
            if (seq !== this._openSeq || !this.isActiveView()) return false;
            if (probe.kind === 'gone') {
                await this.handleGone();
                return true;
            }
            this.plugins = probe.kind === 'ok' && Array.isArray(probe.body) ? new Set(probe.body.map(String)) : null;

            this.mountShell(route.section);
            this.openSection(route.section, { push: cameFromElsewhere, force: true });
            this._bindVisibility();
            this.startBadges();
            return true;
        }

        /**
         * The first Glances widget, page by page from the first: the address
         * did not name one (a bare #glances).
         */
        async findWidget() {
            const d = this.dash;
            const pages = Array.isArray(d.pages) ? d.pages : [];
            for (const page of pages) {
                let widgets = null;
                if (d._blocksPageId != null && Number(d._blocksPageId) === Number(page.id) && Array.isArray(d.widgets)) {
                    widgets = d.widgets;
                } else {
                    try {
                        const res = await fetch(`/api/pages/${encodeURIComponent(page.id)}/blocks`, { cache: 'no-store' });
                        const body = res.ok ? await res.json() : null;
                        widgets = Array.isArray(body?.widgets) ? body.widgets : [];
                    } catch {
                        widgets = [];
                    }
                }
                const hit = widgets.find((w) => w?.type === 'glances' && w.id);
                if (hit) return { widgetId: String(hit.id), pageId: String(page.id) };
            }
            return null;
        }

        /** The layout is ours from the first moment, so a background page load leaves it alone. */
        _prepareContainer() {
            const container = document.getElementById('dashboard-layout');
            if (!container) return null;
            this._destroyShell();
            container.innerHTML = '';
            container.className = 'glances-layout';
            ['aria-colcount', 'aria-rowcount', 'role', 'aria-label', 'data-i18n-aria']
                .forEach((name) => container.removeAttribute(name));
            container.tabIndex = -1;
            const wait = document.createElement('p');
            wait.className = 'glances-wait';
            wait.textContent = this.t('dashboard.glancesLoading', 'Loading…');
            container.appendChild(wait);
            return container;
        }

        /**
         * The server does not know this widget (404: deleted, or on another
         * page; 400: no page in the address). That is "no widget", not an
         * unreachable Glances: take the first one there is, or say to add one.
         */
        async handleGone() {
            if (this._goneBusy) return;
            this._goneBusy = true;
            const stale = { widgetId: this.widgetId, pageId: String(this.pageId ?? '') };
            const section = this.section;
            this._stopTimers();
            this._unbindVisibility();
            this.sectionInstance?.destroy?.();
            this.sectionInstance = null;
            const seq = ++this._openSeq;
            try {
                const found = await this.findWidget();
                if (seq !== this._openSeq || !this.isActiveView()) return;
                this._destroyShell();
                if (found && !(found.widgetId === stale.widgetId && found.pageId === stale.pageId)) {
                    this._goneBusy = false;
                    await this.openGlancesView({ section, widgetId: found.widgetId, pageId: found.pageId });
                    return;
                }
                this.widgetId = null;
                this.renderEmpty();
            } finally {
                this._goneBusy = false;
            }
        }

        renderEmpty() {
            const container = document.getElementById('dashboard-layout');
            if (!container) return;
            container.innerHTML = '';
            const box = document.createElement('div');
            box.className = 'glances-empty';
            box.setAttribute('data-glances-empty', '');
            const text = document.createElement('p');
            text.textContent = this.t('dashboard.glancesNoWidget', 'Add a Glances widget to a page first.');
            box.appendChild(text);
            const d = this.dash;
            const pages = Array.isArray(d.pages) ? d.pages : [];
            const index = Math.max(0, pages.findIndex((p) => Number(p.id) === Number(d.currentPageId)));
            const page = pages[index];
            if (page) {
                const link = document.createElement('a');
                link.href = `#${index + 1}`;
                link.className = 'glances-empty-link';
                link.textContent = this.t('dashboard.glancesBackToPage', 'Back to {page}', { page: page.name || String(index + 1) });
                box.appendChild(link);
            }
            container.appendChild(box);
        }

        /** Sections the host runs, in menu order. Unknown plugins (no probe) leave all in. */
        availableSections() {
            return Sections.list().filter((def) => !def.plugin || !this.plugins || this.plugins.has(def.plugin));
        }

        sectionLabel(def) {
            return def.labelKey ? this.t(def.labelKey, def.label || def.id) : (def.label || def.id);
        }

        mountShell(active) {
            const container = document.getElementById('dashboard-layout');
            if (!container || typeof window.ListViewShell === 'undefined') return null;
            this._destroyShell();
            container.innerHTML = '';
            container.className = 'glances-layout';
            const defs = this.availableSections();
            const first = defs.find((def) => def.id === active) || defs[0];
            this.shell = window.ListViewShell.mount(container, {
                id: 'glances',
                title: this.t('dashboard.glancesView', 'Glances'),
                description: this.t('dashboard.glancesViewDescription', 'One machine, as Glances sees it'),
                t: (key, fallback) => this.t(key, fallback),
                activeFilter: first?.id,
                filterClass: 'glances-menu-item',
                filters: defs.map((def) => ({
                    key: def.id,
                    label: this.sectionLabel(def),
                    count: '',
                    dataAttrs: { 'data-glances-section': def.id },
                })),
                onFilter: (key) => this.openSection(key),
                summary: [],
            });
            this.shell.toolbarRow.hidden = true;
            this.bodyEl = document.createElement('div');
            this.bodyEl.className = 'glances-section';
            this.bodyEl.setAttribute('data-glances-body', '');
            this.statusEl = document.createElement('p');
            this.statusEl.className = 'glances-status';
            this.statusEl.setAttribute('role', 'status');
            this.statusEl.hidden = true;
            this.errorEl = document.createElement('p');
            this.errorEl.className = 'glances-error';
            this.errorEl.setAttribute('role', 'alert');
            this.errorEl.hidden = true;
            this.hostEl = document.createElement('div');
            this.hostEl.className = 'glances-section-host';
            this.bodyEl.append(this.statusEl, this.errorEl, this.hostEl);
            this.shell.body.appendChild(this.bodyEl);
            return this.shell;
        }

        _destroyShell() {
            this.shell?.destroy?.();
            this.shell = null;
            this.bodyEl = null;
            this.hostEl = null;
            this.statusEl = null;
            this.errorEl = null;
        }

        /** Show one section: its own instance, its own reads, the address. */
        openSection(name, { push = false, force = false } = {}) {
            if (!this.shell || !this.isActiveView()) return false;
            const defs = this.availableSections();
            const def = defs.find((entry) => entry.id === name) || defs[0];
            if (!def) {
                // The host runs none of the plugins a section needs.
                this.stopPolling();
                this.hostEl.replaceChildren(Object.assign(document.createElement('p'), {
                    className: 'glances-proc-message',
                    textContent: this.t('dashboard.glancesNotAvailable', 'Not available on this host.'),
                }));
                return false;
            }
            if (!force && def.id === this.section && this.sectionInstance) return true;
            this.sectionInstance?.destroy?.();
            this.section = def.id;
            this.shell.setActive(def.id);
            this.bodyEl.setAttribute('data-glances-open', def.id);
            this.hostEl.replaceChildren();
            this._clearStatus();
            this._clearError();
            this.sectionInstance = new def.Section(this);
            this.writeHash({ push });
            window.nextdashTrack?.('glances:section', { section: def.id });
            this.stopPolling();
            void this.refresh({ force: true });
            this.startPolling();
            return true;
        }

        /** Another view took the layout: every timer and listener goes with it. */
        onLeave() {
            this._openSeq += 1;
            this._stopTimers();
            this._unbindVisibility();
            this.sectionInstance?.destroy?.();
            this.sectionInstance = null;
            this._destroyShell();
            this.section = null;
            this.plugins = null;
        }

        closeGlancesView() {
            const d = this.dash;
            if (d.activeView !== DashboardGlances.VIEW) return false;
            this.onLeave();
            const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
            if (restored) d.keyboardNavigation?.scheduleUpdate?.();
            return restored;
        }

        setupEscapeShortcut() {
            const d = this.dash;
            if (this._escapeHandler) {
                document.removeEventListener('keydown', this._escapeHandler, true);
            }
            this._escapeHandler = (e) => {
                if (e.key !== 'Escape' || d.activeView !== DashboardGlances.VIEW) return;
                if (document.querySelector('dialog[open]') || d.isModalOpen?.()
                    || d.searchComponent?.isActive?.()) return;
                const active = document.activeElement;
                const tag = active?.tagName;
                const typing = tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable
                    || (tag === 'INPUT' && active?.type !== 'checkbox');
                e.preventDefault();
                e.stopImmediatePropagation();
                // In a field, the first Escape only leaves the field.
                if (typing) {
                    active.blur();
                    return;
                }
                this.closeGlancesView();
            };
            document.addEventListener('keydown', this._escapeHandler, true);
        }

        /* ── Reads ──────────────────────────────────────────────────────── */

        /**
         * One path under the widget. Never throws; answers
         * { kind: 'ok'|'unavailable'|'error'|'limited'|'denied'|'failed', body?, code? }.
         * `auth` sends the write token (nextDashFetch), for a path behind it:
         * one process's command line. A refusal then answers 'denied'.
         */
        async fetchPath(path, { auth = false } = {}) {
            const sep = String(path).includes('?') ? '&' : '?';
            const url = `/api/glances/${encodeURIComponent(this.widgetId || '')}/${path}${sep}pageId=${encodeURIComponent(this.pageId ?? '')}`;
            try {
                const fetcher = auth && typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                const res = await fetcher(url, { cache: 'no-store' });
                if (res.status === 429) return { kind: 'limited' };
                if (res.status === 401 || res.status === 403) return { kind: 'denied' };
                // No such widget on that page, or no page at all.
                if (res.status === 404 || res.status === 400) return { kind: 'gone' };
                if (!res.ok) return { kind: 'failed' };
                const body = await res.json();
                if (body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string') {
                    return { kind: 'error', code: body.error };
                }
                if (DashboardGlances.isUnavailable(body)) return { kind: 'unavailable', body };
                return { kind: 'ok', body };
            } catch {
                return { kind: 'failed' };
            }
        }

        /**
         * Read the open section's endpoints and hand them to it. `force` is a
         * section switch or a new sort/search: it overtakes a read in flight,
         * whose answer is then dropped.
         */
        async refresh({ force = false } = {}) {
            const inst = this.sectionInstance;
            if (!inst || !this.isActiveView() || document.visibilityState === 'hidden') return;
            if (this._inflight && !force) return;
            const seq = ++this._seq;
            this._inflight = seq;
            const endpoints = (inst.endpoints?.() || []).map(String);
            const results = await Promise.all(endpoints.map((ep) => this.fetchPath(ep)));
            if (this._inflight === seq) this._inflight = 0;
            if (seq !== this._seq || inst !== this.sectionInstance || !this.isActiveView() || !this.hostEl) return;
            this.applyResults(inst, endpoints, results);
        }

        applyResults(inst, endpoints, results) {
            // Over the budget: what is on screen stays, and the next tick retries.
            if (results.some((r) => r.kind === 'limited')) {
                this._showStatus('limited', this.t('dashboard.glancesLimited', 'Too many requests, retrying'));
                return;
            }
            this._clearStatus();
            if (results.some((r) => r.kind === 'gone')) {
                void this.handleGone();
                return;
            }
            const first = results[0];
            if (first && (first.kind === 'error' || first.kind === 'failed')) {
                this._showError(first.kind === 'error' ? first.code : 'unreachable');
                return;
            }
            this._clearError();
            const data = {};
            endpoints.forEach((ep, i) => {
                const r = results[i];
                data[ep] = r.kind === 'ok' || r.kind === 'unavailable' ? r.body : null;
            });
            try {
                inst.render(this.hostEl, data);
            } catch (err) {
                console.error('Glances section failed to draw', err);
            }
        }

        /** Words for a fetchPath() answer that brought no data, for a section's own reads. */
        failureText(res) {
            if (res?.kind === 'limited') return this.t('dashboard.glancesLimited', 'Too many requests, retrying');
            const [key, fallback] = (res?.kind === 'error' && ERRORS[res.code]) || ERRORS.unreachable;
            return this.t(key, fallback);
        }

        _showStatus(kind, text) {
            if (!this.statusEl) return;
            this.statusEl.setAttribute('data-glances-status', kind);
            this.statusEl.textContent = text;
            this.statusEl.hidden = false;
        }

        _clearStatus() {
            if (!this.statusEl) return;
            this.statusEl.hidden = true;
            this.statusEl.removeAttribute('data-glances-status');
            this.statusEl.textContent = '';
        }

        _showError(code) {
            if (!this.errorEl || !this.hostEl) return;
            const [key, fallback] = ERRORS[code] || ERRORS.unreachable;
            this.errorEl.setAttribute('data-glances-error', ERRORS[code] ? code : 'unreachable');
            this.errorEl.textContent = this.t(key, fallback);
            this.errorEl.hidden = false;
            this.hostEl.hidden = true;
        }

        _clearError() {
            if (!this.errorEl || !this.hostEl) return;
            this.errorEl.hidden = true;
            this.errorEl.removeAttribute('data-glances-error');
            this.errorEl.textContent = '';
            this.hostEl.hidden = false;
        }

        /* ── Timers ─────────────────────────────────────────────────────── */

        startPolling() {
            this.stopPolling();
            if (document.visibilityState === 'hidden') return;
            this._pollTimer = setInterval(() => {
                if (document.visibilityState === 'hidden' || !this.isActiveView()) return;
                void this.refresh();
            }, DashboardGlances.REFRESH_MS);
        }

        stopPolling() {
            if (this._pollTimer) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
        }

        startBadges() {
            this.stopBadges();
            if (document.visibilityState === 'hidden') return;
            void this.refreshBadges();
            this._badgeTimer = setInterval(() => {
                if (document.visibilityState === 'hidden' || !this.isActiveView()) return;
                void this.refreshBadges();
            }, DashboardGlances.BADGE_MS);
        }

        stopBadges() {
            if (this._badgeTimer) {
                clearInterval(this._badgeTimer);
                this._badgeTimer = null;
            }
        }

        _stopTimers() {
            this.stopPolling();
            this.stopBadges();
        }

        /**
         * The menu's counts and warning dots. One cheap round of the tile's
         * reads plus /alert, handed to every section that has a badge():
         * feed = { quicklook, fs, sensors, alert }, each the answer or null.
         * badge() answers { count?, warn?, tone? }: count goes beside the
         * label (Alerts), warn puts the dot on it, tone 'bad' turns the dot
         * from the warning colour to the error colour.
         */
        async refreshBadges() {
            if (!this.shell || !this.isActiveView()) return;
            const defs = this.availableSections().filter((def) => typeof def.badge === 'function');
            if (!defs.length) return;
            const paths = DashboardGlances.BADGE_PATHS.filter((p) => !this.plugins || this.plugins.has(p));
            const shell = this.shell;
            const results = await Promise.all(paths.map((p) => this.fetchPath(p)));
            if (shell !== this.shell || !this.isActiveView()) return;
            const feed = { quicklook: null, fs: null, sensors: null, alert: null };
            paths.forEach((p, i) => {
                feed[p] = results[i].kind === 'ok' ? results[i].body : null;
            });
            const counts = {};
            defs.forEach((def) => {
                let mark = null;
                try {
                    mark = def.badge(feed, this) || null;
                } catch {
                    mark = null;
                }
                const n = DashboardGlances.num(mark?.count);
                counts[def.id] = n !== null && n > 0 ? String(n) : '';
                const btn = shell.rail.querySelector(`[data-glances-section="${CSS.escape(def.id)}"]`);
                if (!btn) return;
                const warn = Boolean(mark?.warn);
                btn.classList.toggle('has-warn', warn);
                if (warn) btn.setAttribute('data-glances-warn', mark?.tone === 'bad' ? 'bad' : 'warn');
                else btn.removeAttribute('data-glances-warn');
                if (warn) btn.title = this.t('dashboard.glancesWarnDot', 'Something here is in warning');
                else btn.removeAttribute('title');
            });
            shell.setCounts(counts);
        }

        /** Hidden tab: nothing runs. Back in view: one read at once, then the timers. */
        _bindVisibility() {
            this._unbindVisibility();
            this._visibilityHandler = () => {
                if (!this.isActiveView()) return;
                if (document.visibilityState === 'hidden') {
                    this._stopTimers();
                    return;
                }
                void this.refresh({ force: true });
                this.startPolling();
                this.startBadges();
            };
            document.addEventListener('visibilitychange', this._visibilityHandler);
        }

        _unbindVisibility() {
            if (this._visibilityHandler) {
                document.removeEventListener('visibilitychange', this._visibilityHandler);
                this._visibilityHandler = null;
            }
        }
    }

    window.DashboardGlancesSections = Sections;
    window.DashboardGlances = DashboardGlances;
}());
