/**
 * Page 0: the side panel behind a process or a container.
 *
 * The same panel the Containers view, Inbox and Bookmarks open beside their
 * rows (ListViewDrawer for the slab, SidePanelLayout for the head, tabs and
 * accordion), with what Glances knows about the thing, its recorded history
 * (processor, memory and, for a container, network, each at a range of its
 * own) and the actions that make sense for it: open the container in the
 * Containers view when nextDash manages that Docker host, copy a name or a
 * process id, read a command line (behind the write token).
 *
 * Every value reaches the page through textContent or a node built by hand.
 */
(function () {
    'use strict';

    const GROUP = 'glances';
    const SECTIONS_KEY = 'nextdash.glances.sections';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }


    /**
     * Which container of the Containers view is this Glances container?
     *
     * The server answers it (/api/glances/docker-link): whether the Glances host
     * and the Docker host are one machine (Config → Glances: Auto, Yes or No) and,
     * when they are, which container is which, by id before name. Nothing links
     * across two machines.
     */
    const Link = {
        answer: null,
        at: 0,
        loading: null,
        stale() {
            return Date.now() - this.at > 30000;
        },
        load() {
            if (this.loading) return this.loading;
            this.loading = fetch('/api/glances/docker-link', { credentials: 'same-origin' })
                .then((r) => (r.ok ? r.json() : null))
                .then((body) => { this.answer = body && typeof body === 'object' ? body : null; })
                .catch(() => { this.answer = null; })
                .finally(() => { this.at = Date.now(); this.loading = null; });
            return this.loading;
        },
        /** The link is of the Docker host: only that one's containers are the Containers view's. */
        same() {
            if (!this.answer || !this.answer.same) return false;
            const status = window.dashboardInstance?.glancesStatus;
            const here = status?.hostId;
            return !this.answer.hostId || !here || this.answer.hostId === here;
        },
        /** { container: { name, id }, by } for a Glances container row, or null. */
        find(row) {
            if (!this.same()) return null;
            const name = String(row?.name || '');
            const match = (this.answer.matches || []).find((m) => m.glances === name);
            return match ? { container: { name: match.docker, id: match.dockerId }, by: match.by } : null;
        },
    };

    class GlancesDetail {
        constructor(view) {
            this.view = view;
            this.item = null;
            this._timer = null;
            this._seq = 0;
            this.base = new window.ListViewDrawer({
                id: 'glances',
                storageKey: SECTIONS_KEY,
                defaultSections: ['details'],
                closeLabel: view.t('dashboard.glancesDrawerClose', 'Close'),
                onClose: () => this._closed(),
                // A press on another row moves the panel there; any other press beside it closes it.
                closeOnOutside: (target) => !target.closest('.glances-row-link'),
            });
        }

        t(key, fallback, params) {
            return this.view.t(key, fallback, params);
        }

        isOpen() {
            return this.base.isOpen();
        }

        close() {
            this.base.close({ silent: true });
            this._closed();
        }

        _closed() {
            clearInterval(this._timer);
            this._timer = null;
            this.item = null;
            this._seq += 1;
        }

        destroy() {
            this._closed();
            this.base.destroy();
        }

        /** The name the recorded series are filed under. */
        _name(kind, row) {
            return String(row?.name ?? '');
        }

        _seriesFor(kind, name) {
            return kind === 'container'
                ? [`ct:${name}:cpu`, `ct:${name}:mem`, `ct:${name}:rx`, `ct:${name}:tx`]
                : [`proc:${name}:cpu`, `proc:${name}:mem`];
        }

        open(kind, row) {
            if (!row || typeof row !== 'object') return;
            const name = this._name(kind, row);
            this.item = { kind, row, name };
            const L = window.SidePanelLayout;
            const view = this.view;
            const esc = (v) => view.dash.escapeHtml(String(v ?? ''));
            const G = window.DashboardGlances;
            const Tip = window.DashboardGlancesTip;
            const spec = window.DashboardGlancesSpecs?.[kind] || [];

            const isContainer = kind === 'container';
            const running = isContainer && /^(running|healthy|unhealthy|starting)$/i.test(String(row.status || ''));
            const state = isContainer ? String(row.status || '') : String(row.status || '');
            const tone = isContainer ? (running ? 'good' : 'bad') : 'muted';
            const where = isContainer
                ? [Array.isArray(row.image) ? row.image.join(', ') : row.image, row.uptime].filter(Boolean).join(' · ')
                : [`PID ${row.pid}`, row.username, G.num(row.num_threads) !== null ? `${row.num_threads} ${this.t('dashboard.glancesTipThreads', 'Threads').toLowerCase()}` : ''].filter(Boolean).join(' · ');
            const dockerOn = Boolean(view.dash.docker?.isEnabled?.());
            const link = isContainer && dockerOn ? Link.find(row) : null;
            this.item.link = link;
            if (isContainer && dockerOn && Link.stale()) {
                const before = link?.container.name;
                void Link.load().then(() => {
                    if (this.isOpen() && this.item?.name === name && Link.find(row)?.container.name !== before) this.open(kind, this.item.row);
                });
            }
            const actions = [];
            if (link) actions.push({ action: 'open-docker', label: this.t('dashboard.glancesActOpenDocker', 'Open in Containers'), primary: true });
            if (!isContainer) actions.push({ action: 'cmdline', label: this.t('dashboard.glancesActCmdline', 'Show command line'), primary: true });
            L.moreLabel = this.t('dashboard.glancesMoreActions', 'More actions');
            const more = [
                { action: 'copy-name', label: this.t('dashboard.glancesActCopyName', 'Copy name') },
                ...(!isContainer ? [{ action: 'copy-pid', label: this.t('dashboard.glancesActCopyPid', 'Copy PID') }] : []),
                { action: 'show-in-list', label: isContainer ? this.t('dashboard.glancesActShowContainers', 'Show in the Glances containers list') : this.t('dashboard.glancesActShowProcesses', 'Search in Processes') },
            ];
            const head = L.head(esc, {
                icon: `<span class="glances-drawer-icon" aria-hidden="true">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`,
                title: name || G.DASH, badge: state ? { text: state, tone } : null, more, where, actions,
            });
            const tabs = [
                { name: 'overview', label: this.t('dashboard.glancesTabOverview', 'Overview') },
                { name: 'history', label: this.t('dashboard.glancesTabHistory', 'History') },
            ];
            const body = (key) => `<div class="glances-drawer-body" data-glances-drawer-body="${key}"></div>`;
            const chips = [
                G.num(row.cpu_percent) !== null ? `CPU ${G.num(row.cpu_percent).toFixed(1)}%` : '',
                isContainer && G.num(row.memory_usage) !== null ? `${this.t('dashboard.glancesTipMemory', 'Memory')} ${G.formatBytes(row.memory_usage)}` : '',
                !isContainer && G.num(row.memory_percent) !== null ? `${this.t('dashboard.glancesTipMemory', 'Memory')} ${G.num(row.memory_percent).toFixed(1)}%` : '',
                link ? this.t(link.by === 'port' ? 'dashboard.glancesLinkedPort' : 'dashboard.glancesLinkedName', link.by === 'port' ? 'Containers: {name} (same port)' : 'Containers: {name}', { name: link.container.name }) : '',
            ].filter(Boolean).map((text) => L.chip(esc, text)).join('');
            const layout = `${head}${L.tabs(esc, GROUP, tabs)}
                ${L.pane(esc, GROUP, tabs, 'overview', `${L.viz(`<div class="config-bm-details-chips">${chips}</div>`)}${L.accList([
                    L.acc(esc, GROUP, 'details', this.t('dashboard.glancesDrawerDetails', 'Details'), '', body('details'), true),
                    ...(!isContainer ? [L.acc(esc, GROUP, 'command', this.t('dashboard.glancesDrawerCommand', 'Command line'), '', body('command'))] : []),
                ])}`)}
                ${L.pane(esc, GROUP, tabs, 'history', body('history'))}`;

            this.base.open(`${kind}:${name}`, {
                title: name,
                build: (panel, ctx) => {
                    panel.setAttribute('data-glances-drawer', kind);
                    panel.classList.add('glances-drawer', 'config-bm-drawer');
                    ctx.heading.hidden = true;
                    panel.insertAdjacentHTML('beforeend', layout);
                    L.bind(panel, {
                        group: GROUP,
                        onAction: (action) => this._act(action),
                        onTab: (tab) => { if (tab === 'history') void this._loadHistory(); },
                    });
                },
            });
            const panel = this.base.panel;
            const details = panel?.querySelector('[data-glances-drawer-body="details"]');
            if (details) details.replaceChildren(Tip.describe(view, '', row, spec));
            // The history tab, when that is the one on show, and a refresh while the panel stays open.
            if (L.activeTab(GROUP, tabs) === 'history') void this._loadHistory();
            clearInterval(this._timer);
            this._timer = setInterval(() => {
                if (document.visibilityState !== 'hidden' && this.isOpen()
                    && panel?.querySelector('[data-slp-pane="history"]:not([hidden])')) void this._loadHistory();
            }, Math.max(5000, view.refreshMs()));
            if (!isContainer && L.activeTab(GROUP, tabs) !== 'history') { /* the command line is read on request */ }
        }

        /**
         * The side panel for one incident: the graphs around that moment, the
         * recorded containers and processes beside them, and the restarts the
         * Containers view knows of. Opened by a click on the incident's band in a
         * graph, or on its row in Insights.
         */
        openIncident(incident) {
            if (!incident || typeof incident !== 'object') return;
            const L = window.SidePanelLayout;
            const view = this.view;
            const esc = (v) => view.dash.escapeHtml(String(v ?? ''));
            const labels = {
                down: ['dashboard.glancesInsKindDown', 'Host not answering'],
                cpu: ['dashboard.glancesInsKindCpu', 'Processor'],
                mem: ['dashboard.glancesInsKindMem', 'Memory'],
                swap: ['dashboard.glancesInsKindSwap', 'Swap'],
                disk: ['dashboard.glancesInsKindDisk', 'Disk'],
                temp: ['dashboard.glancesInsKindTemp', 'Temperature'],
            };
            const what = labels[incident.kind] ? this.t(labels[incident.kind][0], labels[incident.kind][1]) : String(incident.kind);
            const key = `incident:${incident.kind}:${incident.subject || ''}:${incident.start}`;
            const ongoing = !incident.end;
            const when = (ms) => new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const lasted = Math.max(0, (incident.end || Date.now()) - incident.start);
            const minutes = Math.max(1, Math.round(lasted / 60000));
            const length = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
            const where = [when(incident.start), ongoing ? this.t('dashboard.glancesInsOngoing', 'ongoing') : length,
                incident.kind !== 'down' && incident.peak !== undefined ? `${this.t('dashboard.glancesInsPeak', 'Peak')} ${Math.round(incident.peak)}` : '']
                .filter(Boolean).join(' · ');
            this.item = { kind: 'incident', incident, name: key };
            L.moreLabel = this.t('dashboard.glancesMoreActions', 'More actions');
            const head = L.head(esc, {
                icon: '<span class="glances-drawer-icon" aria-hidden="true">!</span>',
                title: `${what}${incident.subject ? ` · ${incident.subject}` : ''}`,
                badge: { text: ongoing ? this.t('dashboard.glancesInsOngoing', 'ongoing') : this.t('dashboard.glancesIncidentEnded', 'ended'), tone: ongoing ? 'bad' : 'muted' },
                more: [], where, actions: [],
            });
            this.base.open(key, {
                title: what,
                build: (panel, ctx) => {
                    panel.setAttribute('data-glances-drawer', 'incident');
                    panel.classList.add('glances-drawer', 'config-bm-drawer');
                    ctx.heading.hidden = true;
                    panel.insertAdjacentHTML('beforeend', `${head}<div class="glances-drawer-body" data-glances-drawer-body="incident"></div>`);
                    L.bind(panel, { group: GROUP, onAction: () => {} });
                },
            });
            clearInterval(this._timer);
            void this._loadIncident();
            if (ongoing) {
                this._timer = setInterval(() => {
                    if (document.visibilityState !== 'hidden' && this.isOpen()) void this._loadIncident();
                }, Math.max(5000, view.refreshMs()));
            }
        }

        async _loadIncident() {
            const item = this.item;
            const host = this.base.panel?.querySelector('[data-glances-drawer-body="incident"]');
            if (!item || item.kind !== 'incident' || !host) return;
            const Chart = window.DashboardGlancesChart;
            const incident = item.incident;
            const seq = ++this._seq;
            const now = Date.now();
            const end = incident.end || now;
            // Room before and after, in proportion to the incident, between ten minutes and three hours.
            const pad = Math.min(3 * 3600000, Math.max(600000, end - incident.start));
            const from = incident.start - pad;
            const to = Math.min(now, end + pad);
            if (!this.view.seriesNames.length) {
                const names = await this.view.fetchPath('history');
                if (names.kind === 'ok' && Array.isArray(names.body?.names)) this.view.seriesNames = names.body.names.map(String);
            }
            const all = this.view.seriesNames;
            const first = { cpu: ['cpu', 'load'], mem: ['memory', 'memparts'], swap: ['memory', 'memparts'], disk: ['disks', 'diskio'], temp: ['temps', 'cpu'], down: ['cpu', 'memory'] }[incident.kind] || [];
            const ids = [...new Set([...first, 'cpu', 'memory', 'network'])];
            const groups = ids.map((id) => Chart.group(id)).filter((g) => g && Chart.namesFor(g, all).length);
            // The recorded containers and processes, whose lines can show what was busy.
            const tracked = all.filter((n) => /^(ct|proc):.+:cpu$/.test(n));
            const containers = tracked.filter((n) => n.startsWith('ct:')).map((n) => n.slice(3, -4)).slice(0, 15);
            const asks = groups.map((g) => ({
                def: g,
                path: `history?series=${Chart.namesFor(g, all).map(encodeURIComponent).join(',')}&since=${from}&until=${to}${containers.length ? `&restarts=${containers.map(encodeURIComponent).join(',')}` : ''}`,
            }));
            if (tracked.length) {
                asks.push({
                    def: {
                        id: 'incident-consumers', label: ['dashboard.glancesIncidentConsumers', 'Recorded containers and processes (CPU)'], percent: false,
                        unit: '%', match: (n) => /^(ct|proc):.+:cpu$/.test(n), name: (n) => n.replace(/:cpu$/, '').replace(/^ct:/, '').replace(/^proc:/, ''),
                    },
                    path: `history?series=${tracked.map(encodeURIComponent).join(',')}&since=${from}&until=${to}`,
                });
            }
            const results = await Promise.all(asks.map(async (a) => {
                const res = await this.view.fetchPath(a.path);
                return { def: a.def, answer: res.kind === 'ok' ? res.body : null };
            }));
            if (seq !== this._seq || this.item !== item || !this.base.panel) return;
            // An incident that was going on when the panel opened may have ended since: the record knows.
            if (!incident.end) {
                const now = results.flatMap(({ answer }) => (answer && Array.isArray(answer.incidents) ? answer.incidents : []))
                    .find((i) => i.kind === incident.kind && (i.subject || '') === (incident.subject || '') && i.start === incident.start);
                if (now && now.end) {
                    this.openIncident(now);
                    return;
                }
            }
            const figures = results.map(({ def, answer }) => Chart.panel(this.view, def, answer, { fixed: { from, to } }));
            const note = el('p', 'glances-note', this.t('dashboard.glancesIncidentNote',
                'The recording from before to after the incident. The red band is the incident itself; a dashed line is a moment a container started again.'));
            Chart.keepFocus(host, () => host.replaceChildren(note, ...figures));
        }

        /** Live numbers: the section hands the row of the latest beat, so the panel follows. */
        update(kind, rows) {
            if (!this.item || this.item.kind !== kind || !Array.isArray(rows)) return;
            const key = kind === 'container' ? 'name' : 'pid';
            const fresh = rows.find((r) => r && String(r[key]) === String(this.item.row[key]));
            if (!fresh) return;
            this.item.row = fresh;
            const spec = window.DashboardGlancesSpecs?.[kind] || [];
            const details = this.base.panel?.querySelector('[data-glances-drawer-body="details"]');
            if (details && window.DashboardGlancesTip?.describe) details.replaceChildren(window.DashboardGlancesTip.describe(this.view, '', fresh, spec));
        }

        async _act(action) {
            const item = this.item;
            if (!item) return;
            const d = this.view.dash;
            const copy = async (text) => {
                try {
                    await navigator.clipboard.writeText(String(text));
                    d.showNotification?.(this.t('dashboard.glancesCopied', 'Copied'), 'success', { duration: 1500 });
                } catch {
                    d.showNotification?.(this.t('dashboard.glancesCopyFailed', 'Could not copy'), 'error');
                }
            };
            if (action === 'copy-name') void copy(item.name);
            else if (action === 'copy-pid') void copy(item.row.pid);
            else if (action === 'open-docker') {
                this.close();
                window.location.hash = `#docker/${encodeURIComponent(item.link?.container.name || item.name)}`;
            } else if (action === 'show-in-list') {
                this.close();
                this.view.openSection(item.kind === 'container' ? 'containers' : 'processes');
                const field = this.view.hostEl?.querySelector('[data-glances-search]');
                if (field) {
                    field.value = item.name;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                }
            } else if (action === 'cmdline') {
                await this._loadCommand();
            }
        }

        /** The command line is asked for, with the write token: it can hold a secret. */
        async _loadCommand() {
            const item = this.item;
            const panel = this.base.panel;
            const body = panel?.querySelector('[data-glances-drawer-body="command"]');
            if (!item || !body) return;
            panel.querySelector('[data-slp-acc="command"]')?.setAttribute('open', '');
            body.replaceChildren(el('p', 'glances-note', this.t('dashboard.glancesLoading', 'Loading…')));
            const res = await this.view.fetchPath(`processes/${encodeURIComponent(item.row.pid)}`, { auth: true });
            if (this.item !== item) return;
            if (res.kind === 'ok' && Array.isArray(res.body?.cmdline)) {
                const code = el('code', 'glances-proc-cmdline', res.body.cmdline.join(' '));
                code.setAttribute('data-glances-cmdline', '');
                body.replaceChildren(code);
            } else if (res.kind === 'denied') {
                body.replaceChildren(el('p', 'glances-note', this.t('dashboard.glancesProcNeedsWrite', 'Needs write access to show the command line.')));
            } else if (res.kind === 'unavailable') {
                body.replaceChildren(el('p', 'glances-note', this.t('dashboard.glancesProcGone', 'That process has ended.')));
            } else {
                body.replaceChildren(el('p', 'glances-note', this.view.failureText(res)));
            }
        }

        /** The recorded history of this one thing, a graph per kind of reading, each with its own range. */
        async _loadHistory() {
            const item = this.item;
            const panel = this.base.panel;
            const host = panel?.querySelector('[data-glances-drawer-body="history"]');
            if (!item || !host) return;
            const Chart = window.DashboardGlancesChart;
            const seq = ++this._seq;
            // History of one process or container is recorded only when asked for: reading it every beat costs the host.
            const key = `${item.kind === 'container' ? 'ct' : 'proc'}:${item.name}`;
            const state = await this._trackedState();
            if (seq !== this._seq || this.item !== item || !this.base.panel) return;
            if (!state.list.includes(key)) {
                host.replaceChildren(this._trackPrompt(key, state));
                return;
            }
            const kinds = item.kind === 'container'
                ? [
                    { id: 'detail-cpu', label: ['dashboard.glancesChartCpu', 'Processor'], suffix: 'cpu', percent: true },
                    { id: 'detail-mem', label: ['dashboard.glancesChartMem', 'Memory'], suffix: 'mem', bytes: true },
                    { id: 'detail-net', label: ['dashboard.glancesChartNetwork', 'Network'], suffixes: ['rx', 'tx'], rate: true },
                ]
                : [
                    { id: 'detail-cpu', label: ['dashboard.glancesChartCpu', 'Processor'], suffix: 'cpu', percent: true },
                    { id: 'detail-mem', label: ['dashboard.glancesChartMem', 'Memory'], suffix: 'mem', percent: true },
                ];
            const prefix = item.kind === 'container' ? 'ct' : 'proc';
            const results = await Promise.all(kinds.map(async (k) => {
                const names = (k.suffixes || [k.suffix]).map((s) => `${prefix}:${item.name}:${s}`);
                const since = Chart.sinceFor(`${k.id}`);
                const restarts = item.kind === 'container' ? `&restarts=${encodeURIComponent(item.name)}` : '';
                const res = await this.view.fetchPath(`history?series=${names.map(encodeURIComponent).join(',')}&since=${since}${restarts}`);
                return { k, names, answer: res.kind === 'ok' ? res.body : null };
            }));
            if (seq !== this._seq || this.item !== item || !this.base.panel) return;
            const figures = results.map(({ k, answer }) => {
                const def = {
                    id: k.id, label: k.label, percent: Boolean(k.percent), rate: Boolean(k.rate), unit: k.bytes ? '' : undefined,
                    match: (n) => n.startsWith(`${prefix}:${item.name}:`),
                    name: (n) => n.slice(`${prefix}:${item.name}:`.length).replace('rx', '↓').replace('tx', '↑'),
                };
                if (k.bytes) def.bytes = true;
                return Chart.panel(this.view, def, answer, { onRange: () => { void this._loadHistory(); } });
            });
            const note = el('p', 'glances-note', item.kind === 'container'
                ? this.t('dashboard.glancesDrawerHistoryContainer', 'Recorded by nextDash every few seconds since you switched it on; a gap is a moment the container did not answer.')
                : this.t('dashboard.glancesDrawerHistoryProcess', 'Every process with this name together, recorded since you switched it on.'));
            const stop = el('button', 'config-btn glances-track-btn', this.t('dashboard.glancesTrackStop', 'Stop recording history'));
            stop.type = 'button';
            stop.setAttribute('data-glances-track', 'off');
            stop.addEventListener('click', () => { void this._setTracked(key, false); });
            Chart.keepFocus(host, () => host.replaceChildren(...figures, note, stop));
        }

        /** Which things have their history recorded: Config's list, behind the write token. */
        async _trackedState() {
            const res = await this.view.fetchPath('config', { auth: true }).catch(() => null);
            return this._readTracked(res);
        }

        _readTracked(res) {
            if (res && res.kind === 'ok' && Array.isArray(res.body?.trackedHistory ?? [])) {
                return { list: res.body.trackedHistory || [], denied: false };
            }
            return { list: [], denied: !res || res.kind === 'denied' };
        }

        _trackPrompt(key, state) {
            const box = el('div', 'glances-track');
            // A drawn line that stops: the history this item does not have yet.
            box.insertAdjacentHTML('beforeend', `<svg class="glances-track-art" viewBox="0 0 120 44" aria-hidden="true" focusable="false">
                <path class="glances-track-art-line" d="M4,34 L22,28 L40,31 L58,18 L76,22"/>
                <path class="glances-track-art-ghost" d="M76,22 L94,12 L116,16"/>
            </svg>`);
            box.appendChild(el('h4', 'glances-track-title', this.t('dashboard.glancesTrackEmptyTitle', 'No history recorded yet')));
            box.appendChild(el('p', 'glances-track-text', this.item?.kind === 'container'
                ? this.t('dashboard.glancesTrackEmptyContainer', 'nextDash can record this container\'s processor, memory and network from now on, and show them here over time.')
                : this.t('dashboard.glancesTrackEmptyProcess', 'nextDash can record this process\'s processor and memory from now on, and show them here over time.')));
            if (state.denied) {
                box.appendChild(el('p', 'glances-track-note', this.t('dashboard.glancesTrackNeedsWrite', 'Needs write access to switch on.')));
                return box;
            }
            const on = el('button', 'config-btn config-btn--primary glances-track-btn', this.t('dashboard.glancesTrackStart', 'Record history'));
            on.type = 'button';
            on.setAttribute('data-glances-track', 'on');
            on.addEventListener('click', () => { void this._setTracked(key, true); });
            box.appendChild(on);
            box.appendChild(el('p', 'glances-track-note', this.t('dashboard.glancesTrackNote',
                'Switched on per item: reading it every few seconds costs the host some processor. Up to fifteen at a time.')));
            return box;
        }

        async _setTracked(key, on) {
            const item = this.item;
            const state = await this._trackedState();
            const list = state.list.filter((k) => k !== key);
            if (on) list.push(key);
            const res = await window.nextDashFetch(window.DashboardGlancesHost.url('/api/glances/config'), {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackedHistory: list }),
            }).catch(() => null);
            if (!res || !res.ok) {
                const full = res && res.status === 400;
                this.view.dash.showNotification?.(full
                    ? this.t('dashboard.glancesTrackFull', 'Too many items are recorded (at most 15). Stop recording another one first.')
                    : this.t('dashboard.glancesTrackFailed', 'Could not change the recording'), 'error');
                return;
            }
            if (this.item === item) void this._loadHistory();
        }
    }

    GlancesDetail.link = Link;
    window.DashboardGlancesDetail = GlancesDetail;
}());
