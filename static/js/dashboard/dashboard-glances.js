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
    const LOCAL_PATH = /^(history|insights|hosts)(\?|$)/;

    class DashboardGlances {
        static VIEW = 'glances';
        static BADGE_MS = 30000;
        /** The tile's own reads plus the alert log: cheap, and enough for the dots. */
        static BADGE_PATHS = ['quicklook', 'fs', 'sensors', 'alert'];
        static DASH = '–';
        /** The one-time tour's tip id, repeated from glances-tutorial.js so the page can skip fetching it once seen. Both must agree. */
        static TUTORIAL_TIP_ID = 'glancesTutorialV1';

        constructor(dashboard) {
            this.dash = dashboard;
            this.section = null;
            /** Plugin names from /pluginslist, or null when unknown (then every section shows). */
            this.plugins = null;
            /** The series nextDash has recorded: the graphs ask for these. */
            this.seriesNames = [];
            /** What the page held when it was left: drawn again at once on a quick return. */
            this._keep = null;
            this._warmAt = false;
            this._enterPending = false;
            this._feed = null;
            this._alertCount = 0;
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

        /** The real filesystems in an fs answer: rows that are objects, without tmpfs, /run, /sys and the like. */
        static realFilesystems(body) {
            const pseudoFs = ['tmpfs', 'devtmpfs', 'overlay', 'squashfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'devpts', 'ramfs'];
            const pseudoMounts = ['/snap', '/run', '/sys', '/proc', '/dev'];
            const str = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
            const rows = DashboardGlances.usable(body);
            if (!Array.isArray(rows)) return [];
            return rows.filter((r) => {
                if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
                if (pseudoFs.includes(str(r.fs_type).toLowerCase())) return false;
                const mount = str(r.mnt_point);
                return !pseudoMounts.some((prefix) => mount === prefix || mount.startsWith(`${prefix}/`));
            });
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

        /**
         * #glances, #glances/<section>, #glances/<section>?host=<id> -> its parts;
         * null for any other hash. `host` is null when the address names none.
         */
        static parseHash(hash) {
            const raw = String(hash || '').replace(/^#/, '');
            if (!(raw === 'glances' || raw.startsWith('glances/') || raw.startsWith('glances?'))) return null;
            let rest = raw.slice('glances'.length);
            let host = null;
            const qi = rest.indexOf('?');
            if (qi >= 0) {
                host = new URLSearchParams(rest.slice(qi + 1)).get('host');
                rest = rest.slice(0, qi);
            }
            let section = rest.startsWith('/') ? rest.slice(1) : '';
            try { section = decodeURIComponent(section); } catch { /* keep it raw */ }
            return { section: section || null, host: host && /^[a-z0-9-]{1,24}$/.test(host) ? host : null };
        }

        isActiveView() {
            return this.dash.activeView === DashboardGlances.VIEW;
        }

        /** The settings the page runs by: refresh, hidden parts, the yellow and red lines. */
        get status() {
            return this.dash.glancesStatus?.state || {};
        }

        /** Milliseconds between two reads of an open page. */
        /** How long a last answer stands in for a missing one: ten minutes, or three beats when they are far apart. */
        staleMs() {
            return Math.max(DashboardGlances.STALE_MS, 3 * this.refreshMs());
        }

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
            const host = this.dash.glancesStatus?.hostId;
            const first = this.dash.glancesStatus?.hosts?.[0]?.id;
            const suffix = host && host !== first ? `?host=${encodeURIComponent(host)}` : '';
            return `#glances/${encodeURIComponent(section || 'overview')}${suffix}`;
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
            // An address that names a host moves the page there.
            const Host = window.DashboardGlancesHost;
            let moved = false;
            if (route.host && Host && route.host !== Host.id) {
                Host.set(route.host);
                moved = this.isActiveView();
            }
            if (this.isActiveView() && this.shell && !moved && !options.reload) {
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
                // The heading and the tab name the view, not the page or view before it.
                d.pageNav?.updatePageTitle?.();
                d.pageNav?.updateDocumentTitle?.();
                // The 0 tab, like the Inbox one, marks the view you are in.
                d.pageNav?.setActivePageNavButton?.(d.currentPageId);
                window.nextdashTrack?.('view:glances');
            }
            const cameFromElsewhere = !DashboardGlances.parseHash(window.location.hash);
            this._stopTimers();
            this.sectionInstance?.destroy?.();
            this.sectionInstance = null;
            // Coming back to a page seen a moment ago starts from what it held; a new
            // host, a reload on purpose or an answer that is too old starts clean.
            const held = this._keep;
            this._keep = null;
            const warm = !options.reload && held && held.host === (window.DashboardGlancesHost?.id || '')
                && Date.now() - held.at < this.staleMs()
                && this.dash.glancesStatus?.configured && this.dash.glancesStatus.state.hostConfigured !== false
                ? held : null;
            this.plugins = warm ? warm.plugins : null;
            this._last = warm ? warm.last : new Map();
            this._feed = warm ? warm.feed : null;
            this._alertCount = warm ? warm.alertCount : 0;
            const seq = ++this._openSeq;
            this._prepareContainer();
            if (warm) {
                // At once, from what was read last; the host is asked again behind it.
                DashboardGlances.limits = this.status.thresholds || null;
                this.seriesNames = warm.seriesNames;
                this._warmAt = true;
                this.mountShell(route.section);
                this.openSection(route.section, { push: cameFromElsewhere, force: true });
                this._warmAt = false;
                this._bindVisibility();
                this._bindKeys();
                this.startBadges();
                void this._revalidate(seq);
                void this.maybeShowTutorial();
                return true;
            }

            // Whether Glances is set up, and the settings the page runs by.
            await this.dash.glancesStatus?.refresh?.();
            if (seq !== this._openSeq || !this.isActiveView()) return false;
            if (!this.dash.glancesStatus?.configured) {
                this.renderEmpty();
                return true;
            }
            // Glances is set up, but this host has no address yet: say so, and let the reader go to another.
            if (this.dash.glancesStatus.state.hostConfigured === false) {
                this.renderHostEmpty();
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
            // Not awaited: the page is already usable, and a slow script fetch must not hold up the navigation.
            void this.maybeShowTutorial();
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

        /** This host has no address: the way to give one, and the other hosts to look at instead. */
        renderHostEmpty() {
            const container = document.getElementById('dashboard-layout');
            if (!container) return;
            container.innerHTML = '';
            const box = document.createElement('div');
            box.className = 'glances-empty';
            box.setAttribute('data-glances-empty', 'host');
            const text = document.createElement('p');
            text.textContent = this.t('dashboard.glancesHostNoAddress', 'This host has no address yet. Add it in Config → Glances.');
            box.appendChild(text);
            const config = document.createElement('button');
            config.type = 'button';
            config.className = 'config-btn config-btn--primary';
            config.setAttribute('data-glances-open-config', '');
            config.textContent = this.t('dashboard.glancesOpenConfig', 'Set up Glances');
            config.addEventListener('click', () => { void this.dash.config?.openConfigView?.('glances'); });
            box.appendChild(config);
            const here = this.dash.glancesStatus.hostId;
            (this.dash.glancesStatus.hosts || []).filter((h) => h.id !== here && h.configured).forEach((host) => {
                const other = document.createElement('button');
                other.type = 'button';
                other.className = 'config-btn';
                other.setAttribute('data-glances-host-switch', host.id);
                other.textContent = this.t('dashboard.glancesHostLook', 'Look at {name}', { name: host.name });
                other.addEventListener('click', () => { void this.switchHost(host.id); });
                box.appendChild(other);
            });
            container.appendChild(box);
        }

        /** Sections the host runs, in menu order. Unknown plugins (no probe) leave all in. */
        availableSections() {
            return Sections.list()
                .filter((def) => !def.plugin || !this.plugins || this.plugins.has(def.plugin))
                .filter((def) => typeof def.visible !== 'function' || def.visible(this));
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
                summary: this._summary(this._feed || {}),
            });
            this.shell.toolbarRow.hidden = true;
            const Info = window.DashboardGlancesInfo;
            this.shell.headerActions?.append(...[this._buildTourButton(), Info?.helpButton(this), this._buildHostPick(), this._buildRecordPick(), this._buildConnectionSwitch()].filter(Boolean));
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

        /** The band's own button: the tour, seen or not. Where the Containers and Bookmarks views have theirs. */
        _buildTourButton() {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'lvs-action';
            button.setAttribute('data-glances-tour', '');
            button.title = this.t('dashboard.glancesTourHint', 'A tour of the Glances page');
            button.textContent = this.t('dashboard.inboxTour', 'Tour');
            button.addEventListener('click', () => { void this.openTour(); });
            return button;
        }

        /**
         * The tour's script, fetched on demand: a reader who has done the tour
         * never pays for it again.
         */
        async loadTutorial() {
            if (typeof window.GlancesTutorial !== 'undefined') return true;
            try {
                await window.LazyScript.loadScriptOnce('js/glances-tutorial.js', 'glancesTutorialModule',
                    () => typeof window.GlancesTutorial !== 'undefined');
                return true;
            } catch {
                // A tour that cannot be fetched is not worth an error toast.
                return false;
            }
        }

        /** First visit: the tour, once. Checked before the script is fetched at all. */
        async maybeShowTutorial() {
            if (window.DiscoverabilityState?.hasSeenTip?.(DashboardGlances.TUTORIAL_TIP_ID)) return;
            if (this.dash.settings?.enableSessionTips === false) return;
            if (!(await this.loadTutorial())) return;
            // The reader may have left while the script came in.
            if (!this.isActiveView()) return;
            window.GlancesTutorial?.maybeShow?.();
        }

        /** The Tour button, and Config's replay: seen or not. */
        async openTour() {
            if (!(await this.loadTutorial())) return;
            window.GlancesTutorial?.open?.();
        }

        /** The host menu: only when there is more than one to pick from. */
        _buildHostPick() {
            const hosts = this.dash.glancesStatus?.hosts || [];
            if (hosts.length < 2) return null;
            const label = document.createElement('label');
            label.className = 'glances-record glances-host-pick';
            const text = document.createElement('span');
            text.className = 'glances-record-label';
            text.textContent = this.t('dashboard.glancesHost', 'Host');
            const select = document.createElement('select');
            select.className = 'config-select glances-record-select';
            select.setAttribute('data-glances-host', '');
            hosts.forEach((host) => {
                const option = document.createElement('option');
                option.value = host.id;
                option.textContent = host.name;
                select.appendChild(option);
            });
            select.value = this.dash.glancesStatus.hostId;
            select.addEventListener('change', () => { void this.switchHost(select.value); });
            label.append(text, select);
            return label;
        }

        /** Look at another host: its record, its settings, its sections. */
        async switchHost(id, section = this.section) {
            const Host = window.DashboardGlancesHost;
            if (!Host) return;
            const first = this.dash.glancesStatus?.hosts?.[0]?.id;
            Host.set(id === first ? '' : id);
            this.detail?.close?.();
            this.seriesNames = [];
            await this.openGlancesView({ section, reload: true });
            this.writeHash();
        }

        /**
         * How often nextDash records the host, for the history: a choice on the page,
         * kept on the server. Longer asks the host less and fills the record more slowly.
         */
        _buildRecordPick() {
            const CHOICES = [
                [2, 'dashboard.glancesRecord2s', '2 seconds'],
                [5, 'dashboard.glancesRecord5s', '5 seconds'],
                [10, 'dashboard.glancesRecord10s', '10 seconds'],
                [30, 'dashboard.glancesRecord30s', '30 seconds'],
                [60, 'dashboard.glancesRecord60s', '1 minute'],
                [300, 'dashboard.glancesRecord5m', '5 minutes'],
                [900, 'dashboard.glancesRecord15m', '15 minutes'],
                [1800, 'dashboard.glancesRecord30m', '30 minutes'],
                [3600, 'dashboard.glancesRecord60m', '1 hour'],
            ];
            const label = document.createElement('label');
            label.className = 'glances-record';
            const text = document.createElement('span');
            text.className = 'glances-record-label';
            text.textContent = this.t('dashboard.glancesRecordEvery', 'Record every');
            const select = document.createElement('select');
            select.className = 'config-select glances-record-select';
            select.setAttribute('data-glances-record', '');
            CHOICES.forEach(([seconds, key, fallback]) => {
                const option = document.createElement('option');
                option.value = String(seconds);
                option.textContent = this.t(key, fallback);
                select.appendChild(option);
            });
            const paint = () => {
                const now = Number(this.dash.glancesStatus?.state?.recordEvery) || 30;
                select.value = String(CHOICES.some(([s]) => s === now) ? now : 30);
                const perHour = Math.round(3600 / Number(select.value));
                select.title = this.t('dashboard.glancesRecordHint',
                    '{n} readings an hour. Longer means less load on the host and a slower filling record; very long means short graphs stay empty.', { n: perHour });
            };
            paint();
            this._paintRecord = paint;
            select.addEventListener('change', async () => {
                const seconds = Number(select.value);
                select.disabled = true;
                try {
                    const res = await window.nextDashFetch(window.DashboardGlancesHost.url('/api/glances/config'), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ recordEvery: seconds }),
                    });
                    if (!res.ok) throw new Error(String(res.status));
                    await this.dash.glancesStatus?.refresh?.({ force: true });
                    if (this.dash.glancesStatus) this.dash.glancesStatus.state.recordEvery = seconds;
                } catch {
                    this.dash.showNotification?.(this.t('dashboard.glancesRecordFailed', 'Could not change how often the host is recorded'), 'error');
                } finally {
                    select.disabled = false;
                    paint();
                }
            });
            label.append(text, select);
            const keep = this._buildRetentionPick();
            const info = window.DashboardGlancesInfo?.button(this, 'record');
            // Outside the label, so pressing the info button does not open the menu.
            const wrap = document.createElement('span');
            wrap.className = 'glances-record-wrap';
            wrap.append(label);
            if (info) wrap.append(info);
            wrap.append(keep);
            return wrap;
        }

        /** How long the history is kept: 7, 30 or 90 days. */
        _buildRetentionPick() {
            const CHOICES = [
                [7, 'dashboard.glancesKeep7', '7 days'],
                [30, 'dashboard.glancesKeep30', '30 days'],
                [90, 'dashboard.glancesKeep90', '90 days'],
            ];
            const label = document.createElement('label');
            label.className = 'glances-record';
            const text = document.createElement('span');
            text.className = 'glances-record-label';
            text.textContent = this.t('dashboard.glancesKeepFor', 'Keep');
            const select = document.createElement('select');
            select.className = 'config-select glances-record-select';
            select.setAttribute('data-glances-retention', '');
            select.title = this.t('dashboard.glancesKeepHint', 'How long the history is kept. A longer time takes more room in the data folder. Shortening it removes the older part.');
            CHOICES.forEach(([days, key, fallback]) => {
                const option = document.createElement('option');
                option.value = String(days);
                option.textContent = this.t(key, fallback);
                select.appendChild(option);
            });
            const paint = () => {
                const now = Number(this.dash.glancesStatus?.state?.retentionDays) || 30;
                select.value = String(CHOICES.some(([d]) => d === now) ? now : 30);
            };
            paint();
            select.addEventListener('change', async () => {
                const days = Number(select.value);
                select.disabled = true;
                try {
                    const res = await window.nextDashFetch(window.DashboardGlancesHost.url('/api/glances/config'), {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ retentionDays: days }),
                    });
                    if (!res.ok) throw new Error(String(res.status));
                    if (this.dash.glancesStatus) this.dash.glancesStatus.state.retentionDays = days;
                    window.DashboardGlancesChart?.setKeep?.(days);
                    await this.dash.glancesStatus?.refresh?.({ force: true });
                } catch {
                    this.dash.showNotification?.(this.t('dashboard.glancesKeepFailed', 'Could not change how long the history is kept'), 'error');
                } finally {
                    select.disabled = false;
                    paint();
                }
            });
            label.append(text, select);
            return label;
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
                    const res = await window.nextDashFetch(window.DashboardGlancesHost.url('/api/glances/config'), {
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
            const info = window.DashboardGlancesInfo?.button(this, 'connection');
            if (info) {
                const wrap = document.createElement('span');
                wrap.className = 'glances-switch-wrap';
                wrap.append(label, info);
                return wrap;
            }
            return label;
        }

        _destroyShell() {
            window.DashboardGlancesInfo?.close();
            this._paintConnection = null;
            this._paintRecord = null;
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
            // Another section of the page rises in as the view did, once its first draw comes.
            this._enterPending = !force;
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
            // A page drawn from what was read before says so until the new read arrives.
            if (age !== null && age >= 10000 && this._warmAt) {
                const when = new Date(Date.now() - age).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                this._showStatus('cached', this.t('dashboard.glancesCachedFrom', 'Showing what was read at {time}. Updating…', { time: when }));
            }
            if (age === null || age >= this.refreshMs()) void this.refresh({ force: true });
            this.startPolling();
            return true;
        }

        /** The arrival animation of the view, for the first draw of a section the reader moved to. */
        _playEnter() {
            if (!this._enterPending) return;
            this._enterPending = false;
            this.dash.playViewEntrance?.(DashboardGlances.VIEW);
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
                if (!hit || now - hit.at >= this.staleMs()) return null;
                data[ep] = hit.body;
                oldest = Math.max(oldest, now - hit.at);
            }
            try {
                this.tipCard?.reset();
                this._playEnter();
                inst.render(this.hostEl, data);
                this.tipCard?.refresh();
            } catch (err) {
                console.error('Glances section failed to draw', err);
                return null;
            }
            return oldest;
        }

        /**
         * Behind a page drawn from the last read: the settings, which sections the
         * host has and what is recorded are asked again, and the page is rebuilt
         * only when the host no longer matches what was shown.
         */
        async _revalidate(seq) {
            await this.dash.glancesStatus?.refresh?.();
            if (seq !== this._openSeq || !this.isActiveView()) return;
            const status = this.dash.glancesStatus;
            if (!status?.configured || status.state.hostConfigured === false) {
                void this.openGlancesView({ reload: true });
                return;
            }
            DashboardGlances.limits = this.status.thresholds || null;
            const probe = await this.fetchPath('pluginslist');
            if (seq !== this._openSeq || !this.isActiveView()) return;
            const plugins = probe.kind === 'ok' && Array.isArray(probe.body) ? new Set(probe.body.map(String)) : null;
            const recorded = await this.fetchPath('history');
            if (seq !== this._openSeq || !this.isActiveView()) return;
            if (recorded.kind === 'ok' && Array.isArray(recorded.body?.names)) this.seriesNames = recorded.body.names.map(String);
            const before = this.plugins;
            const same = (!before && !plugins) || (before && plugins && before.size === plugins.size && [...before].every((p) => plugins.has(p)));
            if (same) return;
            this.plugins = plugins;
            const section = this.section;
            this.mountShell(section);
            this.openSection(section, { push: false, force: true });
        }

        /** Another view took the layout: every timer and listener goes with it. */
        onLeave() {
            if (this.shell && this._last) {
                this._keep = {
                    host: window.DashboardGlancesHost?.id || '', at: Date.now(),
                    plugins: this.plugins, seriesNames: this.seriesNames, last: this._last,
                    feed: this._feed, alertCount: this._alertCount,
                };
            }
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
                // The side panel is the innermost thing on screen: the first Escape
                // drops it and stays on the list, as the Containers view does.
                if (this.detail?.isOpen?.()) {
                    this.detail.close();
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
            const url = window.DashboardGlancesHost.url(`/api/glances/${path}`);
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
                if (prev && (now - prev.at < this.staleMs() || r.code === 'paused')) {
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
                this._playEnter();
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
            const LETTERS = { o: 'overview', p: 'processes', c: 'containers', d: 'disks', n: 'network', h: 'history', a: 'alerts', i: 'insights', m: 'hosts' };
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
            this._feed = feed;
            this._alertCount = Number(counts.alerts) || 0;
            shell.setSummary(this._summary(feed));
        }

        /**
         * The figures at the top of the rail, the way Health and the Containers view
         * give theirs: how the machine is right now, whatever section is open. From
         * the same cheap round of reads the menu's dots come from.
         */
        _summary(feed) {
            const G = DashboardGlances;
            const quick = G.usable(feed.quicklook);
            if (!quick) return [];
            const entries = [];
            const level = this.status.level;
            const words = { ok: ['dashboard.glancesHostStatusOk', 'Healthy', 'good'], warn: ['dashboard.glancesHostStatusWarn', 'Warning', 'warn'], bad: ['dashboard.glancesHostStatusBad', 'Critical', 'bad'] }[level];
            if (words) entries.push({ key: 'status', label: this.t('dashboard.glancesSummaryStatus', 'Status'), value: this.t(words[0], words[1]), tone: words[2] });
            const reading = (key, label, value, kind) => {
                const n = G.num(value);
                if (n === null) return;
                entries.push({ key, label, value: `${Math.round(n)}%`, tone: G.tone(n, kind) });
            };
            reading('cpu', this.t('dashboard.glancesChartCpu', 'Processor'), quick.cpu, 'cpu');
            reading('mem', this.t('dashboard.glancesChartMem', 'Memory'), quick.mem, 'mem');
            const disks = G.realFilesystems(feed.fs).map((r) => ({ pct: G.num(r.percent), mount: String(r.mnt_point || '') })).filter((r) => r.pct !== null);
            if (disks.length) {
                const fullest = disks.reduce((a, b) => (b.pct > a.pct ? b : a));
                reading('disk', this.t('dashboard.glancesHostsDisk', 'Fullest disk'), fullest.pct, 'disk');
            }
            const sensors = G.usable(feed.sensors);
            const temps = Array.isArray(sensors)
                ? sensors.filter((s) => String(s?.type || '').startsWith('temperature')).map((s) => G.num(s.value)).filter((n) => n !== null) : [];
            if (temps.length) {
                const hottest = Math.max(...temps);
                entries.push({ key: 'temp', label: this.t('dashboard.glancesSummaryTemp', 'Hottest sensor'), value: `${Math.round(hottest)} °C`, tone: G.tone(hottest, 'temp') });
            }
            const alerts = this._alertCount || 0;
            entries.push({ key: 'alerts', label: this.t('dashboard.glancesSectionAlerts', 'Alerts'), value: String(alerts), tone: alerts ? 'bad' : 'good' });
            return entries;
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
