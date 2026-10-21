/**
 * Glances page (#glances, the 0 tab) -- one machine, read through the host set up in Config.
 *
 * A side menu with one section per screen, on the shared list-view shell the
 * Containers view uses. This file owns the shell, the address, the menu and
 * the polling; what a section shows lives in its own file, which registers on
 * window.DashboardGlancesSections (see the registry below for the contract).
 *
 * Every read goes through the server (/api/glances/<path>), which
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
        'not set up': ['dashboard.glancesErrNotSetUp', 'Glances has no server address yet. Add one in Config.'],
        'address not allowed': ['dashboard.glancesErrNotAllowed', 'That address is not allowed. Check the address in Config → Glances.'],
        'login refused': ['dashboard.glancesErrLogin', 'Glances refused that login. Check the login in Config → Glances.'],
        'key refused': ['dashboard.glancesErrLogin', 'Glances refused that login. Check the login in Config → Glances.'],
        'needs Glances 4': ['dashboard.glancesErrNeedsV4', 'This view needs Glances 4.'],
        unreachable: ['dashboard.glancesErrUnreachable', 'Glances does not answer at that address.'],
        paused: ['dashboard.glancesErrPaused', 'The connection is off. Switch it on to read the host again.'],
    };
    /** Paths nextDash answers from its own record: they work with the connection off. */
    const LOCAL_PATH = /^(history|insights)(\?|$)/;

    class DashboardGlances {
        static VIEW = 'glances';
        static BADGE_MS = 30000;
        /** The tile's own reads plus the alert log: cheap, and enough for the dots. */
        static BADGE_PATHS = ['quicklook', 'fs', 'sensors', 'alert'];
        static DASH = '–';

        constructor(dashboard) {
            this.dash = dashboard;
            this.section = null;
            /** Plugin names from /pluginslist, or null when unknown (then every section shows). */
            this.plugins = null;
            /** The series nextDash has recorded: the graphs ask for these. */
            this.seriesNames = [];
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
            this._keyHandler = null;
            this._hoverChart = null;
            this.tipCard = null;
            this.detail = null;
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

        /** The yellow and red lines from Config, set each time the page opens. */
        static limits = null;

        /**
         * How far over its line a reading is: '' fine, 'warn' or 'bad'. The lines
         * are the reader's, per kind (cpu, mem, swap, disk in percent; temp in
         * degrees), and 80/90 and 70/85 until the page has been told.
         */
        static tone(value, kind = 'disk') {
            if (value === null || value === undefined) return '';
            const defaults = { cpu: [80, 90], mem: [80, 90], swap: [80, 90], disk: [80, 90], temp: [70, 85] };
            const [dw, db] = defaults[kind] || [80, 90];
            const limits = DashboardGlances.limits || {};
            const warn = Number(limits[`${kind}Warn`]) || dw;
            const bad = Number(limits[`${kind}Bad`]) || db;
            if (value >= bad) return 'bad';
            if (value >= warn) return 'warn';
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

        /** #glances, #glances/<section> -> its parts; null for any other hash. Anything after a ? is ignored. */
        static parseHash(hash) {
            const raw = String(hash || '').replace(/^#/, '');
            if (!(raw === 'glances' || raw.startsWith('glances/') || raw.startsWith('glances?'))) return null;
            let rest = raw.slice('glances'.length);
            const qi = rest.indexOf('?');
            if (qi >= 0) rest = rest.slice(0, qi);
            let section = rest.startsWith('/') ? rest.slice(1) : '';
            try { section = decodeURIComponent(section); } catch { /* keep it raw */ }
            return { section: section || null };
        }

        isActiveView() {
            return this.dash.activeView === DashboardGlances.VIEW;
        }

        /** The settings the page runs by: refresh, hidden parts, the yellow and red lines. */
        get status() {
            return this.dash.glancesStatus?.state || {};
        }

        /** Milliseconds between two reads of an open page. */
        refreshMs() {
            const seconds = Number(this.status.refresh);
            return (Number.isFinite(seconds) && seconds >= 1 ? seconds : 2) * 1000;
        }

        /** A part of the Overview the reader left switched on. */
        blockShown(id) {
            return !(this.status.hiddenBlocks || []).includes(id);
        }

        /* ── Address ────────────────────────────────────────────────────── */

        hashFor(section) {
            return `#glances/${encodeURIComponent(section || 'overview')}`;
        }

        /**
         * Arriving from elsewhere is a place to go Back to (push); a section
         * switch rewrites the address in place, as the Containers view does.
         */
        writeHash({ push = false } = {}) {
            if (!this.isActiveView()) return;
            const target = this.hashFor(this.section);
            if (window.location.hash === target) return;
            const next = `${window.location.pathname}${window.location.search}${target}`;
            if (push && window.DashboardHistory?.pushLocation?.(next)) return;
            history.replaceState(history.state, '', next);
        }

        /* ── View lifecycle ─────────────────────────────────────────────── */

        /**
         * Open page 0, or -- when it is already open -- follow the address:
         * another section switches. Accepts { hash } or { section }.
         */
        async openGlancesView(options = {}) {
            const route = options.hash !== undefined
                ? (DashboardGlances.parseHash(options.hash) || {})
                : options;
            const d = this.dash;
            if (this.isActiveView() && this.shell) {
                if (route.section && route.section !== this.section) this.openSection(route.section);
                // A bare #glances typed over the open page gets its section back.
                else this.writeHash();
                return true;
            } else if (!this.isActiveView()) {
                if (d.isInlineEditActive?.() && !(await d.confirmInlineEditBeforeNavigation?.())) {
                    return false;
                }
                d._abortInlineEditForRender?.();
                d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
                d.inbox?.clearKeyboardSelection?.();
                d.setActiveView(DashboardGlances.VIEW);
                // The 0 tab, like the Inbox one, marks the view you are in.
                d.pageNav?.setActivePageNavButton?.(d.currentPageId);
                window.nextdashTrack?.('view:glances');
            }
            const cameFromElsewhere = !DashboardGlances.parseHash(window.location.hash);
            this._stopTimers();
            this.sectionInstance?.destroy?.();
            this.sectionInstance = null;
            this.plugins = null;
            this._last = new Map();
            const seq = ++this._openSeq;
            this._prepareContainer();

            // Whether Glances is set up, and the settings the page runs by.
            await this.dash.glancesStatus?.refresh?.();
            if (seq !== this._openSeq || !this.isActiveView()) return false;
            if (!this.dash.glancesStatus?.configured) {
                this.renderEmpty();
                return true;
            }
            DashboardGlances.limits = this.status.thresholds || null;

            // Which sections this host has: asked once per opening.
            const probe = await this.fetchPath('pluginslist');
            if (seq !== this._openSeq || !this.isActiveView()) return false;
            this.plugins = probe.kind === 'ok' && Array.isArray(probe.body) ? new Set(probe.body.map(String)) : null;
            // What has been recorded, so a graph can ask for its series from the first beat.
            const recorded = await this.fetchPath('history');
            if (seq !== this._openSeq || !this.isActiveView()) return false;
            this.seriesNames = recorded.kind === 'ok' && Array.isArray(recorded.body?.names) ? recorded.body.names.map(String) : [];

            this.mountShell(route.section);
            this.openSection(route.section, { push: cameFromElsewhere, force: true });
            this._bindVisibility();
            this._bindKeys();
            this.startBadges();
            return true;
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

        /** Not set up: say so, and give the way to set it up. */
        renderEmpty() {
            const container = document.getElementById('dashboard-layout');
            if (!container) return;
            container.innerHTML = '';
            const box = document.createElement('div');
            box.className = 'glances-empty';
            box.setAttribute('data-glances-empty', '');
            const text = document.createElement('p');
            text.textContent = this.t('dashboard.glancesNotSetUp', 'Glances is not set up yet. Add the address of a Glances host in Config.');
            box.appendChild(text);
            const link = document.createElement('button');
            link.type = 'button';
            link.className = 'config-btn config-btn--primary';
            link.setAttribute('data-glances-open-config', '');
            link.textContent = this.t('dashboard.glancesOpenConfig', 'Set up Glances');
            link.addEventListener('click', () => { void this.dash.config?.openConfigView?.('glances'); });
            box.appendChild(link);
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
            this.shell.headerActions?.appendChild(this._buildConnectionSwitch());
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
            this.bodyEl.append(this.statusEl, this.errorEl, this.hostEl, this.buildLegend());
            this.shell.body.appendChild(this.bodyEl);
            // The hover card follows what is under the pointer; the chart under it is the one , and . change.
            this.tipCard?.unbind();
            this.tipCard = typeof window.DashboardGlancesTip === 'function' ? new window.DashboardGlancesTip(this) : null;
            this.tipCard?.bind(this.bodyEl);
            // The side panel behind a process or a container.
            this.detail?.destroy();
            this.detail = typeof window.DashboardGlancesDetail === 'function' ? new window.DashboardGlancesDetail(this) : null;
            this.bodyEl.addEventListener('pointerover', (e) => {
                this._hoverChart = e.target?.closest?.('[data-glances-chart]')?.getAttribute('data-glances-chart') || null;
            });
            this.bodyEl.addEventListener('pointerleave', () => { this._hoverChart = null; });
            return this.shell;
        }

        /** The connection switch in the page's header; Config → Glances holds the same one. */
        _buildConnectionSwitch() {
            const label = document.createElement('label');
            label.className = 'glances-switch';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('role', 'switch');
            input.setAttribute('data-glances-connection', '');
            const track = document.createElement('span');
            track.className = 'glances-switch-track';
            track.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.className = 'glances-switch-text';
            label.append(input, track, text);
            const paint = () => {
                const on = this.dash.glancesStatus?.paused !== true;
                input.checked = on;
                text.textContent = on ? this.t('dashboard.glancesConnectionOn', 'Connected') : this.t('dashboard.glancesConnectionOff', 'Connection off');
                label.setAttribute('data-state', on ? 'on' : 'off');
            };
            paint();
            this._paintConnection = paint;
            input.addEventListener('change', async () => {
                const on = input.checked;
                input.disabled = true;
                try {
                    const res = await window.nextDashFetch('/api/glances/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ paused: !on }),
                    });
                    if (!res.ok) throw new Error(String(res.status));
                    await this.dash.glancesStatus?.refresh?.({ force: true });
                    if (this.dash.glancesStatus) this.dash.glancesStatus.state.paused = !on;
                    this._last = new Map(this._last || []);
                    void this.refresh({ force: true });
                } catch {
                    this.dash.showNotification?.(this.t('dashboard.glancesConnectionFailed', 'Could not switch the connection'), 'error');
                } finally {
                    input.disabled = false;
                    paint();
                }
            });
            return label;
        }

        _destroyShell() {
            this._paintConnection = null;
            this.detail?.destroy();
            this.detail = null;
            this.tipCard?.unbind();
            this.tipCard = null;
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
            // A section seen a moment ago is drawn from what it last read, at once;
            // the host is asked again only when that is older than one beat.
            const age = this._paintFromCache(this.sectionInstance);
            if (age === null || age >= this.refreshMs()) void this.refresh({ force: true });
            this.startPolling();
            return true;
        }

        /**
         * Draw a section from its last answers without a read. Returns how old
         * the oldest of them is, or null when any is missing or too old.
         */
        _paintFromCache(inst) {
            const last = this._last;
            if (!last || !inst) return null;
            const endpoints = (inst.endpoints?.() || []).map(String);
            if (!endpoints.length) return null;
            const now = Date.now();
            const data = {};
            let oldest = 0;
            for (const ep of endpoints) {
                const hit = last.get(this._stableKey(ep));
                if (!hit || now - hit.at >= DashboardGlances.STALE_MS) return null;
                data[ep] = hit.body;
                oldest = Math.max(oldest, now - hit.at);
            }
            try {
                this.tipCard?.reset();
                inst.render(this.hostEl, data);
                this.tipCard?.refresh();
            } catch (err) {
                console.error('Glances section failed to draw', err);
                return null;
            }
            return oldest;
        }

        /** Another view took the layout: every timer and listener goes with it. */
        onLeave() {
            this._openSeq += 1;
            this._stopTimers();
            this._unbindVisibility();
            this._unbindKeys();
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
            const url = `/api/glances/${path}`;
            try {
                const fetcher = auth && typeof window.nextDashFetch === 'function' ? window.nextDashFetch : fetch;
                const res = await fetcher(url, { cache: 'no-store' });
                if (res.status === 429) return { kind: 'limited' };
                if (res.status === 401 || res.status === 403) return { kind: 'denied' };
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
            // With the connection off nothing goes to the host; the record still answers.
            const off = this.dash.glancesStatus?.paused === true;
            const results = await Promise.all(endpoints.map((ep) => (off && !LOCAL_PATH.test(ep)
                ? Promise.resolve({ kind: 'error', code: 'paused' })
                : this.fetchPath(ep))));
            if (this._inflight === seq) this._inflight = 0;
            if (seq !== this._seq || inst !== this.sectionInstance || !this.isActiveView() || !this.hostEl) return;
            this.applyResults(inst, endpoints, results);
        }

        /*
         * What a beat that brought nothing shows: the last answer, not a blank.
         *
         * A host that misses one beat, or one path, must not turn the page into
         * a light that flashes between data and an empty screen. Every read that
         * answered is kept under its path (without the moving `since` of a
         * history query); a read that did not answer is replaced by that last
         * answer for up to ten minutes, and the page says so in one quiet line.
         * Only a path that has never answered, or has been silent that long, is
         * an error on screen.
         */
        static STALE_MS = 10 * 60 * 1000;

        _stableKey(path) {
            const text = String(path);
            const at = text.indexOf('?');
            if (at < 0) return text;
            const query = new URLSearchParams(text.slice(at + 1));
            query.delete('since');
            query.delete('until');
            const rest = query.toString();
            return rest ? `${text.slice(0, at)}?${rest}` : text.slice(0, at);
        }

        applyResults(inst, endpoints, results) {
            // Over the budget: what is on screen stays, and the next tick retries.
            if (results.some((r) => r.kind === 'limited')) {
                this._showStatus('limited', this.t('dashboard.glancesLimited', 'Too many requests, retrying'));
                return;
            }
            const now = Date.now();
            const last = this._last || (this._last = new Map());
            const data = {};
            let staleSince = 0;
            let missing = null;
            endpoints.forEach((ep, i) => {
                const r = results[i];
                const key = this._stableKey(ep);
                if (r.kind === 'ok' || r.kind === 'unavailable') {
                    last.set(key, { body: r.body, at: now });
                    data[ep] = r.body;
                    if (ep.startsWith('history') && Array.isArray(r.body?.names)) this.seriesNames = r.body.names.map(String);
                    return;
                }
                const prev = last.get(key);
                if (prev && (now - prev.at < DashboardGlances.STALE_MS || r.code === 'paused')) {
                    data[ep] = prev.body;
                    staleSince = staleSince ? Math.min(staleSince, prev.at) : prev.at;
                } else {
                    data[ep] = null;
                    if (i === 0) missing = r;
                }
            });
            // The section's first read has nothing to fall back on: say why.
            if (missing && (missing.kind === 'error' || missing.kind === 'failed')) {
                this._clearStatus();
                this._showError(missing.kind === 'error' ? missing.code : 'unreachable');
                return;
            }
            this._clearError();
            if (staleSince) {
                const when = new Date(staleSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const off = results.some((r) => r.kind === 'error' && r.code === 'paused');
                this._showStatus('stale', off
                    ? this.t('dashboard.glancesPausedStale', 'The connection is off. Showing the last data, from {time}.', { time: when })
                    : this.t('dashboard.glancesStale', 'No answer from Glances just now. Showing the last data, from {time}.', { time: when }));
            } else {
                this._clearStatus();
            }
            try {
                this.tipCard?.reset();
                inst.render(this.hostEl, data);
                this.tipCard?.refresh();
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

        /* ── The hover card, the keys and their legend ──────────────────── */

        /** Give an element a hover card: build() is called when it shows, and on every redraw while it is up. */
        tip(el, key, build) {
            if (el && this.tipCard) this.tipCard.attach(el, key, build);
            return el;
        }

        /** The keys of the page, as <kbd> chips: the keys stay as they are, the labels are translated. */
        buildLegend() {
            const wrap = document.createElement('div');
            wrap.className = 'glances-legend';
            wrap.setAttribute('data-glances-legend', '');
            [
                ['o p c d n h a', this.t('dashboard.glancesLegendSections', 'section')],
                ['[ / ]', this.t('dashboard.glancesLegendStep', 'previous / next')],
                [', / .', this.t('dashboard.glancesLegendRange', 'shorter / longer range')],
                ['r', this.t('dashboard.glancesLegendRefresh', 'read now')],
                ['/', this.t('dashboard.glancesLegendSearch', 'search processes')],
                ['Esc', this.t('dashboard.glancesLegendLeave', 'leave')],
            ].forEach(([key, label]) => {
                const item = document.createElement('span');
                item.className = 'glances-legend-key';
                const kbd = document.createElement('kbd');
                kbd.textContent = key;
                const text = document.createElement('span');
                text.textContent = label;
                item.append(kbd, text);
                wrap.appendChild(item);
            });
            return wrap;
        }

        /** Section letters, [ and ] to step, , and . for a graph's range, r to read now, / to search. */
        _bindKeys() {
            this._unbindKeys();
            const LETTERS = { o: 'overview', p: 'processes', c: 'containers', d: 'disks', n: 'network', h: 'history', a: 'alerts', i: 'insights' };
            this._keyHandler = (e) => {
                if (!this.isActiveView() || !this.shell) return;
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
                const d = this.dash;
                if (document.querySelector('dialog[open]') || d.isModalOpen?.() || d.searchComponent?.isActive?.()) return;
                const active = document.activeElement;
                const tag = active?.tagName;
                if (tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable
                    || (tag === 'INPUT' && active?.type !== 'checkbox')) return;
                if (d.keyboardNavigation?.isGChordActive?.()) return;

                const defs = this.availableSections();
                const step = (dir) => {
                    const at = defs.findIndex((def) => def.id === this.section);
                    const next = defs[(at + dir + defs.length) % defs.length];
                    if (next) this.openSection(next.id);
                };
                const key = e.key;
                if (LETTERS[key]) {
                    if (!defs.some((def) => def.id === LETTERS[key])) return;
                    this.openSection(LETTERS[key]);
                } else if (key === '[') {
                    step(-1);
                } else if (key === ']') {
                    step(1);
                } else if (key === ',' || key === '.') {
                    const Chart = window.DashboardGlancesChart;
                    const id = this._hoverChart || this.hostEl?.querySelector('[data-glances-chart]')?.getAttribute('data-glances-chart');
                    if (!id || !Chart?.stepRange) return;
                    if (!Chart.stepRange(id, key === '.' ? 1 : -1)) return;
                    void this.refresh({ force: true });
                } else if (key === 'r') {
                    void this.refresh({ force: true });
                } else if (key === '/') {
                    const field = this.hostEl?.querySelector('[data-glances-search]');
                    if (!field) return;
                    field.focus();
                } else {
                    return;
                }
                e.preventDefault();
                e.stopImmediatePropagation();
            };
            document.addEventListener('keydown', this._keyHandler, true);
        }

        _unbindKeys() {
            if (this._keyHandler) {
                document.removeEventListener('keydown', this._keyHandler, true);
                this._keyHandler = null;
            }
        }

        /* ── Timers ─────────────────────────────────────────────────────── */

        startPolling() {
            this.stopPolling();
            if (document.visibilityState === 'hidden') return;
            this._pollTimer = setInterval(() => {
                if (document.visibilityState === 'hidden' || !this.isActiveView()) return;
                void this.refresh();
            }, this.refreshMs());
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
