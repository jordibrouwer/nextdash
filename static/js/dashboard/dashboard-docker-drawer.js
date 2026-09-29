/**
 * Docker detail drawer — the sections behind a container row: overview,
 * network, volumes, resources, environment, logs and what's changed.
 *
 * The panel is the shared ListViewDrawer; this fills it with a container's
 * sections. dashboard-docker.js owns the hash (#docker/<name>) and the
 * selectContainer()/closeDrawer() entry points. Every value reaches the page through textContent or a DOM
 * node built by hand — release bodies are markdown with no sanitizer in this
 * repo, so nothing here ever touches innerHTML with data from the server.
 */

const DOCKER_SECTIONS_KEY = 'nextdash.docker.sections';
const DOCKER_SECTIONS_DEFAULT = ['overview'];
const DOCKER_SECTION_KEYS = ['overview', 'health', 'updates', 'timeline', 'network', 'custom', 'volumes', 'resources', 'env', 'logs', 'changes'];

/** fetch() that never throws and answers null on anything but a 2xx JSON body. */
async function dockerDrawerFetchJSON(url, init) {
    try {
        const res = await fetch(url, init);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/** Same, but through nextDashFetch: env values and logs sit behind the write token. */
async function dockerDrawerFetchJSONAuth(url) {
    try {
        const res = await window.nextDashFetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

function dockerFormatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const mib = bytes / (1024 * 1024);
    if (mib < 1024) return `${mib.toFixed(1)} MiB`;
    return `${(mib / 1024).toFixed(1)} GiB`;
}

function dockerFormatCpu(pct) {
    return Number.isFinite(pct) ? `${pct.toFixed(1)} %` : '—';
}

function dockerFormatDate(value) {
    if (!value) return '';
    const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
    if (!Number.isFinite(ms)) return String(value);
    return new Date(ms).toLocaleString();
}

const DOCKER_LINK_KEYS = { source: 'dockerLinkSource', registry: 'dockerLinkRegistry', webui: 'dockerLinkWebUI' };

/**
 * Renders a release body (markdown, untrusted) as plain text with bare
 * https:// URLs turned into real links. Headings and list markers stay as
 * literal characters — there is no markdown renderer here on purpose.
 */
function renderReleaseText(body) {
    const wrap = document.createElement('div');
    wrap.className = 'docker-release-body';
    const urlRe = /https:\/\/[^\s<>()"']+/g;
    String(body || '').split('\n').forEach((line) => {
        const p = document.createElement('div');
        p.className = 'docker-release-line';
        let last = 0;
        for (const m of line.matchAll(urlRe)) {
            p.append(document.createTextNode(line.slice(last, m.index)));
            const a = document.createElement('a');
            a.href = m[0];
            a.textContent = m[0];
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            p.append(a);
            last = m.index + m[0].length;
        }
        p.append(document.createTextNode(line.slice(last)));
        wrap.append(p);
    });
    return wrap;
}

class DockerDrawer {
    constructor(view) {
        this.view = view;
        this._name = null;
        this._detail = null;
        this._statsTimer = null;
        this._logsLoaded = false;
        this._changesLoaded = false;
        this._healthLoaded = false;
        this._els = null;
        // The panel itself -- host, placement, phone fullscreen, ScrollLock and
        // remembered sections -- is the shared one (list-view-drawer.js); this
        // class fills it with a container's sections.
        this.base = new window.ListViewDrawer({
            id: 'docker',
            storageKey: DOCKER_SECTIONS_KEY,
            defaultSections: DOCKER_SECTIONS_DEFAULT,
            closeLabel: this.t('dockerDrawerClose', 'Close'),
            onClose: () => this._onBaseClosed(),
            // As in Bookmarks and Inbox: a press beside the panel closes it, a
            // press on another row moves it there, unless Config keeps it open.
            closeOnOutside: (target) => this.view.dash?.settings?.dockerViewCloseOutside !== false
                && !target.closest('.docker-row'),
        });
    }

    t(key, fallback, params) {
        return this.view.t(`dashboard.${key}`, fallback, params);
    }

    isOpen() {
        return this.base.isOpen();
    }

    /** Config -> Containers: how many lines the Logs section asks for. */
    logLines() {
        const n = Number(this.view.dash?.settings?.dockerLogLines);
        return [100, 200, 500, 1000].includes(n) ? n : 200;
    }

    /** container: a row summary ({name, state, health, …}) or a bare name string. */
    open(container) {
        const name = typeof container === 'string' ? container : container?.name;
        if (!name) return;
        this._stopResourcePolling();
        this._name = name;
        this._detail = null;
        this._logsLoaded = false;
        this._changesLoaded = false;
        this._healthLoaded = false;
        this._timelineLoaded = false;
        this._buildSkeleton(typeof container === 'string' ? { name } : container);
        void this._loadDetail(name);
    }

    /** Opens one section on arrival, as :docker <name> logs asks: a tab, or a part of Overview. */
    openSection(key) {
        const panel = this.base.panel;
        if (!panel) return;
        const tab = panel.querySelector(`[data-slp-tab="${CSS.escape(key)}"]`);
        if (tab) {
            tab.click();
            return;
        }
        panel.querySelector('[data-slp-tab="overview"]')?.click();
        const acc = panel.querySelector(`[data-slp-acc="${CSS.escape(key)}"]`);
        if (acc) {
            acc.open = true;
            acc.scrollIntoView?.({ block: 'nearest' });
        }
    }

    close() {
        this._stopResourcePolling();
        this._name = null;
        this._detail = null;
        this._els = null;
        // Silent: the view closing the drawer already knows it did.
        this.base.close({ silent: true });
    }

    /** The panel's own close button: the view drops its selection as well. */
    _onBaseClosed() {
        this._stopResourcePolling();
        this._name = null;
        this._detail = null;
        this._els = null;
        this.view.closeDrawer();
    }

    refresh() {
        if (!this.isOpen() || !this._name) return;
        void this._loadDetail(this._name);
    }

    /* ── Building the panel ───────────────────────────────────────────── */

    _buildSkeleton(summary) {
        const els = { sections: {} };
        this._summary = summary;
        this.base.open(summary.name, {
            title: summary.name,
            build: (panel, ctx) => {
                // The Containers specs and styles still address these.
                panel.setAttribute('data-docker-drawer', '');
                panel.classList.add('docker-drawer', 'config-bm-drawer');
                // The layout carries its own name, as in the Bookmarks view.
                ctx.heading.hidden = true;
                panel.insertAdjacentHTML('beforeend', this._layout(summary));
                this._fillActions(panel, summary);
                panel.querySelectorAll('[data-docker-body]').forEach((body) => {
                    els.sections[body.getAttribute('data-docker-body')] = body;
                });
                window.SidePanelLayout.bind(panel, {
                    group: 'docker',
                    onAction: (action) => this._act(action),
                    onTab: (name) => this._onTab(name),
                });
            },
        });
        this._els = els;
        this._wireOverviewNetworkVolumesEnv(els);
        this._wireResources(els);
        this._wireLogs(els);
        this._wireChanges(els);
        this._wireHealth(els, summary);
        this._wireTimeline(els);
        // The tab on show loads what it needs now, as a click on it would.
        this._onTab(window.SidePanelLayout.activeTab('docker', this._tabs()));
    }

    _tabs() {
        return [
            { name: 'overview', label: this.t('dockerSectionOverview', 'Overview') },
            { name: 'resources', label: this.t('dockerSectionResources', 'Resources') },
            { name: 'logs', label: this.t('dockerSectionLogs', 'Logs') },
            { name: 'changes', label: this.t('dockerSectionChanges', 'Changes') },
        ];
    }

    /** The Bookmarks side panel's layout (shared/side-panel-layout.js). */
    _layout(summary) {
        const L = window.SidePanelLayout;
        const esc = (v) => this.view.escape ? this.view.escape(v) : String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        const state = String(summary.state || '');
        const tone = state === 'running' ? 'good' : (state === 'paused' || state === 'restarting' ? 'warn' : (state ? 'bad' : 'muted'));
        const ports = (summary.ports || []).filter((p) => p && p.public)
            .map((p) => `${p.public} → ${p.private}`).slice(0, 2).join(', ');
        const where = [summary.status, ports, summary.health].filter(Boolean).join(' · ');
        const webui = window.DockerSearchIndex.webuiHref(summary.webui, summary);
        L.moreLabel = this.t('dockerMoreActions', 'More actions');
        const head = L.head(esc, {
            icon: `<span class="docker-drawer-icon" aria-hidden="true">${esc(String(summary.name || '?').charAt(0).toUpperCase())}</span>`,
            title: summary.name,
            badge: { text: summary.state || '', tone },
            more: [
                ...(summary.self ? [] : [{ action: 'mute', label: this._muteLabel(summary) }]),
                { action: 'copy-name', label: this.t('dockerCopyName', 'Copy name') },
            ],
            where,
            actions: webui ? [{ action: 'webui', label: this.t('dockerLinkWebUI', 'Open web UI'), primary: true }] : [],
        });
        // The reference as the container was made from it, tag included.
        const image = String(summary.image || '');
        const chips = [
            image ? L.chip(esc, image) : '',
            summary.update?.status === 'available' ? L.chip(esc, this.t('dockerUpdateAvailable', 'update available'), 'is-tag') : '',
            summary.composeProject ? L.chip(esc, summary.composeProject) : '',
        ].join('');
        const summaryBlock = L.viz(`<div class="config-bm-details-chips">${chips}</div>`);
        const body = (key) => `<div class="docker-section-body" data-docker-body="${key}"></div>`;
        const acc = (key, label, open = false) => L.acc(esc, 'docker', key, label, '', body(key), open)
            .replace('<details ', `<details data-docker-section="${key}" `);
        const tabs = this._tabs();
        const pane = (name, html) => L.pane(esc, 'docker', tabs, name, html)
            .replace('<section ', `<section data-docker-section="${name}" `);
        return `${head}${L.tabs(esc, 'docker', tabs)}
            ${pane('overview', `${summaryBlock}${L.accList([
                acc('overview', this.t('dockerSectionDetails', 'Details'), true),
                acc('health', this.t('dockerSectionHealth', 'Health')),
                acc('updates', this.t('dockerSectionUpdates', 'Updates')),
                acc('timeline', this.t('dockerSectionTimeline', 'Timeline')),
                acc('network', this.t('dockerSectionNetwork', 'Network')),
                acc('custom', this.t('dockerSectionCustom', 'Custom')),
                acc('volumes', this.t('dockerSectionVolumes', 'Volumes')),
                acc('env', this.t('dockerSectionEnv', 'Environment')),
            ])}`)}
            ${pane('resources', body('resources'))}
            ${pane('logs', body('logs'))}
            ${pane('changes', body('changes'))}`;
    }

    /**
     * The container's actions, DockerActions' own buttons: Restart and Update
     * beside Open web UI, the rest under ⋯. Moved, not copied, so each keeps
     * the handler DockerActions gave it.
     */
    _fillActions(panel, summary) {
        const head = panel.querySelector('.config-bm-panel-head');
        let row = head?.querySelector('.config-bm-panel-actions');
        if (head && !row) {
            row = document.createElement('div');
            row.className = 'config-bm-panel-actions';
            head.appendChild(row);
        }
        const menu = head?.querySelector('[data-slp-more-menu]');
        if (!row || !menu) return;
        row.setAttribute('data-docker-drawer-actions', '');
        row.classList.add('docker-drawer-actions');
        const scratch = document.createElement('div');
        this.view.actions?.renderButtons(scratch, summary);
        [...scratch.children].forEach((el) => {
            const action = el.getAttribute('data-docker-action');
            if (el.tagName === 'BUTTON') {
                el.classList.add('config-btn', 'config-btn--small');
                if (el.classList.contains('docker-action-btn--primary')) el.classList.add('config-btn--primary');
                if (el.classList.contains('docker-action-btn--danger')) el.classList.add('config-btn--danger');
            }
            if (!action || action === 'restart' || action === 'update') row.appendChild(el);
            else menu.insertBefore(el, menu.firstChild);
        });
        menu.setAttribute('data-docker-drawer-more', '');
        panel.querySelector('.slp-badge')?.setAttribute('data-docker-state', '');
    }

    _muteLabel(summary) {
        return this.view.actions?.isMuted(summary)
            ? this.t('dockerMenuUnmute', 'Unmute notifications')
            : this.t('dockerMenuMute', 'Mute notifications');
    }

    async _toggleMute() {
        const summary = this._summary || {};
        if (!(await this.view.actions?.toggleMute(summary))) return;
        const item = this.base.panel?.querySelector('[data-slp-action="mute"]');
        if (item) item.textContent = this._muteLabel(summary);
        if (this._detail) this._renderOverview(this._els?.sections.overview, this._detail);
    }

    _act(action) {
        const summary = this._summary || {};
        if (action === 'mute') {
            void this._toggleMute();
            return;
        }
        if (action === 'webui') {
            const href = window.DockerSearchIndex.webuiHref(summary.webui, summary);
            if (href) window.open(href, '_blank', 'noopener,noreferrer');
        } else if (action === 'copy-name') {
            void navigator.clipboard?.writeText?.(String(summary.name || ''));
            this.view.dash?.showNotification?.(this.t('dockerNameCopied', 'Name copied'), 'success', { duration: 2000 });
        }
    }

    /** A tab shown: what it holds loads now; Resources polls only while on show. */
    _onTab(name) {
        this._onSectionToggle('resources', name === 'resources');
        if (name === 'logs' || name === 'changes') this._onSectionToggle(name, true);
    }

    _onSectionToggle(key, open) {
        if (!this._els) return;
        if (key === 'logs' && open && !this._logsLoaded) {
            this._logsLoaded = true;
            void this._loadLogs();
        }
        if (key === 'changes' && open && !this._changesLoaded) {
            this._changesLoaded = true;
            void this._loadChanges();
        }
        if (key === 'resources') {
            if (open && this.isOpen()) this._startResourcePolling();
            else this._stopResourcePolling();
        }
    }

    /* ── Overview / network / volumes / env — filled from the detail body ── */

    _wireOverviewNetworkVolumesEnv() {
        // Nothing to wire ahead of data; _renderDetail() fills these bodies once
        // the detail response lands.
    }

    async _loadDetail(name) {
        const data = await dockerDrawerFetchJSON(`/api/docker/containers/${encodeURIComponent(name)}`);
        if (name !== this._name || !this._els) return;
        this._detail = data;
        this._renderDetail(data);
    }

    _renderDetail(detail) {
        const els = this._els;
        if (!els) return;
        this._renderOverview(els.sections.overview, detail);
        this._renderNetwork(els.sections.network, detail);
        this._renderCustom(els.sections.custom, detail);
        this._renderVolumes(els.sections.volumes, detail);
        this._renderEnv(els.sections.env, detail);
        this._showHealth(Boolean(detail?.health));
        this._renderUpdates(els.sections.updates, detail);

        const pill = this.base.panel?.querySelector('[data-docker-state]');
        if (pill && detail?.state) pill.textContent = detail.state;

    }

    _fieldRow(body, labelKey, labelFallback, value) {
        if (!value) return;
        const row = document.createElement('div');
        row.className = 'docker-field-row';
        const label = document.createElement('span');
        label.className = 'docker-field-label';
        label.textContent = this.t(labelKey, labelFallback);
        const val = document.createElement('span');
        val.className = 'docker-field-value';
        val.textContent = value;
        row.append(label, val);
        body.appendChild(row);
    }

    _renderOverview(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        this._fieldRow(body, 'dockerFieldImage', 'Image', detail.image);
        this._fieldRow(body, 'dockerFieldVersion', 'Version', detail.version);
        this._fieldRow(body, 'dockerFieldCreated', 'Created', dockerFormatDate(detail.created));
        this._fieldRow(body, 'dockerFieldRestart', 'Restart policy', detail.restartPolicy);
        this._fieldRow(body, 'dockerFieldProject', 'Project', detail.composeProject);
        this._fieldRow(body, 'dockerFieldHealth', 'Health', detail.health);
        if (!detail.self) {
            const settings = this.view.dash?.settings || {};
            const state = settings.dockerNotify === false
                ? this.t('dockerNotifyOff', 'off')
                : (this.view.actions?.isMuted(detail) ? this.t('dockerNotifyMuted', 'muted') : this.t('dockerNotifyOn', 'on'));
            this._fieldRow(body, 'dockerFieldNotifications', 'Notifications', state);
            body.lastElementChild?.querySelector('.docker-field-value')?.setAttribute('data-docker-notify-state', '');
        }
        if (detail.source) {
            const link = document.createElement('a');
            link.href = detail.source;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('data-docker-link', 'source');
            link.className = 'docker-overview-link';
            link.textContent = this.t('dockerLinkSource', 'Source');
            body.appendChild(link);
        }
    }

    _renderNetwork(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        (detail.ports || []).filter((p) => p && p.public).forEach((p) => {
            const row = document.createElement('div');
            row.className = 'docker-network-row';
            row.textContent = `${p.private}${p.type ? `/${p.type}` : ''} → ${p.public}`;
            body.appendChild(row);
        });
        (detail.networks || []).forEach((n) => {
            const row = document.createElement('div');
            row.className = 'docker-network-row';
            row.textContent = `${n.name}: ${n.ip || ''}`;
            body.appendChild(row);
        });
    }

    /*
     * Custom: a web address of the reader's own, in place of the template's.
     *
     * Kept in settings by container name, and applied by the server to webui,
     * so the drawer's button, the palette's open and the widget all follow it
     * without knowing it exists. Empty is the default.
     */
    _renderCustom(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        const custom = String(detail.webuiCustom || '');
        const fallback = String(detail.webuiDefault || '');

        const label = document.createElement('label');
        label.className = 'docker-field-label';
        label.textContent = this.t('dockerWebUILabel', 'Web UI address');
        const input = document.createElement('input');
        input.type = 'url';
        input.className = 'config-text docker-webui-input';
        input.setAttribute('data-docker-webui-input', '');
        input.value = custom;
        input.placeholder = fallback || 'https://';
        input.spellcheck = false;
        label.appendChild(input);

        const hint = document.createElement('p');
        hint.className = 'docker-webui-hint';
        hint.textContent = fallback
            ? this.t('dockerWebUIHintDefault', 'Empty uses the default: {address}', { address: fallback })
            : this.t('dockerWebUIHintNone', 'This container names no web UI of its own. [IP] stands for this server.');

        const error = document.createElement('p');
        error.className = 'docker-webui-error';
        error.setAttribute('data-docker-webui-error', '');
        error.hidden = true;
        error.textContent = this.t('dockerWebUIInvalid', 'Enter a web address starting with http:// or https://.');
        input.addEventListener('input', () => { error.hidden = true; });

        const row = document.createElement('div');
        row.className = 'docker-webui-actions';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'config-btn config-btn--small config-btn--primary';
        save.setAttribute('data-docker-webui-save', '');
        save.textContent = this.t('dockerWebUISave', 'Save');
        save.addEventListener('click', () => {
            const value = input.value.trim();
            if (value && !DockerDrawer.isWebAddress(value)) {
                error.hidden = false;
                input.focus();
                return;
            }
            void this._saveWebUI(value);
        });
        row.appendChild(save);
        if (custom) {
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'config-btn config-btn--small';
            reset.setAttribute('data-docker-webui-reset', '');
            reset.textContent = this.t('dockerWebUIReset', 'Back to the default');
            reset.addEventListener('click', () => void this._saveWebUI(''));
            row.appendChild(reset);
        }
        body.append(label, hint, error, row);
    }

    /** The same rule the server keeps: http or https, with [IP] allowed for the host. */
    static isWebAddress(value) {
        try {
            const parsed = new URL(String(value).replace('[IP]', 'host'));
            return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.host);
        } catch {
            return false;
        }
    }

    async _saveWebUI(value) {
        const name = this._name;
        const d = this.view.dash;
        if (!name || !d) return;
        const all = { ...(d.settings?.dockerWebUIs || {}) };
        if (value) all[name] = value;
        else delete all[name];
        const before = d.settings.dockerWebUIs;
        d.settings.dockerWebUIs = all;
        try {
            await d.saveSettings();
        } catch {
            d.settings.dockerWebUIs = before;
            d.showNotification?.(this.t('dockerWebUISaveFailed', 'Could not save the address.'), 'error');
            return;
        }
        d.showNotification?.(value
            ? this.t('dockerWebUISaved', 'Web UI address saved')
            : this.t('dockerWebUICleared', 'Back to the default address'), 'success', { duration: 2000 });
        // The list and the drawer read webui from the server, which now
        // answers with the new address; the drawer is rebuilt from that row
        // so its Open web UI button appears, goes or points anew.
        await this.view.loadAndRender?.();
        if (name !== this._name) return;
        const fresh = (this.view.containers || []).find((c) => c.name === name);
        if (fresh) this.open(fresh);
        else await this._loadDetail(name);
    }

    _renderVolumes(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        (detail.mounts || []).forEach((m) => {
            const row = document.createElement('div');
            row.className = 'docker-volume-row';
            const path = document.createElement('span');
            path.textContent = `${m.source} → ${m.destination}`;
            row.appendChild(path);
            if (m.readOnly) {
                const ro = document.createElement('span');
                ro.className = 'docker-volume-readonly';
                ro.textContent = `(${this.t('dockerFieldReadOnly', 'Read-only')})`;
                row.appendChild(ro);
            }
            body.appendChild(row);
        });
    }

    _renderEnv(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        (detail.envNames || []).forEach((name) => {
            const row = document.createElement('div');
            row.className = 'docker-env-row';
            const label = document.createElement('code');
            label.className = 'docker-env-name';
            label.textContent = name;
            row.appendChild(label);

            const reveal = document.createElement('button');
            reveal.type = 'button';
            reveal.setAttribute('data-docker-env-reveal', name);
            reveal.className = 'config-btn config-btn--small docker-env-reveal';
            reveal.textContent = this.t('dockerEnvReveal', 'Show value');
            reveal.addEventListener('click', () => this._revealEnv(name, row, reveal));
            row.appendChild(reveal);

            body.appendChild(row);
        });
    }

    async _revealEnv(name, row, button) {
        button.disabled = true;
        const containerName = this._name;
        const data = await dockerDrawerFetchJSONAuth(
            `/api/docker/containers/${encodeURIComponent(containerName)}/env/${encodeURIComponent(name)}`
        );
        if (containerName !== this._name || !row.isConnected) return;
        const value = document.createElement('code');
        value.setAttribute('data-docker-env-value', '');
        value.className = 'docker-env-value';
        value.textContent = data?.value ?? '';
        button.replaceWith(value);
    }

    /* ── Resources ─────────────────────────────────────────────────────── */

    _wireResources(els) {
        const body = els.sections.resources;
        body.replaceChildren();
        const cpu = document.createElement('div');
        cpu.className = 'docker-resource-row';
        const cpuLabel = document.createElement('span');
        cpuLabel.textContent = 'CPU';
        const cpuVal = document.createElement('span');
        cpuVal.setAttribute('data-docker-cpu', '');
        cpuVal.textContent = '—';
        cpu.append(cpuLabel, cpuVal);

        const mem = document.createElement('div');
        mem.className = 'docker-resource-row';
        const memLabel = document.createElement('span');
        memLabel.textContent = 'Memory';
        const memVal = document.createElement('span');
        memVal.setAttribute('data-docker-mem', '');
        memVal.textContent = '—';
        mem.append(memLabel, memVal);

        // The last hour, under the figures: filled by _renderCharts once the
        // first answer with history lands.
        const charts = document.createElement('div');
        charts.className = 'docker-charts';
        charts.setAttribute('data-docker-charts', '');

        body.append(cpu, mem, charts);
        els.cpuEl = cpuVal;
        els.memEl = memVal;
        els.chartsEl = charts;
    }

    _startResourcePolling() {
        this._stopResourcePolling();
        this._statsBeat = 0;
        this._history = null;
        const tick = () => void this._loadStats();
        tick();
        this._statsTimer = setInterval(tick, 2000);
    }

    _stopResourcePolling() {
        if (this._statsTimer) {
            clearInterval(this._statsTimer);
            this._statsTimer = null;
        }
    }

    async _loadStats() {
        const name = this._name;
        if (!name) return;
        /*
         * The hour moves once every thirty seconds on the server, so it is
         * asked for on the first beat and every fifteenth after -- the beats
         * between only need the figures, which also become the chart's "now".
         */
        this._statsBeat = (this._statsBeat || 0) + 1;
        const withHistory = this._statsBeat % 15 === 1 || this._history?.name !== name;
        const query = withHistory ? '?history=1' : '';
        const data = await dockerDrawerFetchJSON(`/api/docker/containers/${encodeURIComponent(name)}/stats${query}`);
        if (name !== this._name || !this._els) return;
        if (this._els.cpuEl) this._els.cpuEl.textContent = dockerFormatCpu(data?.cpuPercent);
        if (this._els.memEl) {
            this._els.memEl.textContent = `${dockerFormatBytes(data?.memoryUsed)} / ${dockerFormatBytes(data?.memoryLimit)}`;
        }
        if (withHistory && data) {
            this._history = { name, enabled: data.historyEnabled !== false, points: Array.isArray(data.history) ? data.history : [] };
        }
        if (this._history?.name === name && data) this._renderCharts(data);
    }

    /* Two charts of the last hour: the sampler's points, then the figure now. */
    _renderCharts(now) {
        const host = this._els?.chartsEl;
        if (!host) return;
        host.replaceChildren();
        const { enabled, points } = this._history;
        const note = (text) => {
            const p = document.createElement('p');
            p.className = 'docker-chart-note';
            p.setAttribute('data-docker-chart-note', '');
            p.textContent = text;
            host.appendChild(p);
        };
        if (!enabled) {
            note(this.t('dockerChartsOff', 'History is off — switch it on in Config → Containers.'));
            return;
        }
        const nowMs = Date.now();
        const series = points.concat([{ t: nowMs, cpu: Number(now.cpuPercent) || 0, mem: Number(now.memoryUsed) || 0 }]);
        if (points.length < 2) {
            note(this.t('dockerChartsCollecting', 'Collecting — the chart fills in over the next minutes.'));
            return;
        }
        host.append(
            this._chart('cpu', this.t('dockerChartCpu', 'CPU · last hour'), series, (p) => p.cpu,
                (v) => dockerFormatCpu(v), nowMs),
            this._chart('mem', this.t('dockerChartMemory', 'Memory · last hour'), series, (p) => p.mem,
                (v) => dockerFormatBytes(v), nowMs),
        );
    }

    _chart(key, title, series, valueOf, format, nowMs) {
        const W = 300;
        const H = 56;
        const start = nowMs - 3_600_000;
        const values = series.map(valueOf);
        const peak = Math.max(...values, 0);
        const top = peak > 0 ? peak * 1.15 : 1;
        const xy = series.map((p) => {
            const x = Math.max(0, Math.min(W, ((p.t - start) / 3_600_000) * W));
            const y = H - (valueOf(p) / top) * (H - 2);
            return [x.toFixed(1), y.toFixed(1)];
        });
        const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
        const area = `${line} L${xy[xy.length - 1][0]} ${H} L${xy[0][0]} ${H} Z`;

        const wrap = document.createElement('figure');
        wrap.className = 'docker-chart';
        wrap.setAttribute('data-docker-chart', key);
        const head = document.createElement('figcaption');
        head.className = 'docker-chart-head';
        const name = document.createElement('span');
        name.textContent = title;
        const top_ = document.createElement('span');
        top_.className = 'docker-chart-peak';
        top_.textContent = this.t('dockerChartPeak', 'peak {value}', { value: format(peak) });
        head.append(name, top_);

        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('class', 'docker-chart-svg');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${title}, ${top_.textContent}`);
        const fill = document.createElementNS(ns, 'path');
        fill.setAttribute('class', 'docker-chart-area');
        fill.setAttribute('d', area);
        const stroke = document.createElementNS(ns, 'path');
        stroke.setAttribute('class', 'docker-chart-line');
        stroke.setAttribute('d', line);
        stroke.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.append(fill, stroke);

        const axis = document.createElement('div');
        axis.className = 'docker-chart-axis';
        const from = document.createElement('span');
        from.textContent = this.t('dockerChartFrom', '−60 min');
        const to = document.createElement('span');
        to.textContent = this.t('dockerChartNow', 'now');
        axis.append(from, to);

        wrap.append(head, svg, axis);
        return wrap;
    }

    /* ── Logs ──────────────────────────────────────────────────────────── */

    _wireLogs(els) {
        const body = els.sections.logs;
        body.replaceChildren();

        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.setAttribute('data-docker-logs-refresh', '');
        refresh.className = 'config-btn config-btn--small docker-logs-refresh';
        refresh.textContent = this.t('dockerLogsRefresh', 'Refresh');
        refresh.addEventListener('click', () => void this._loadLogs());
        body.appendChild(refresh);

        // The quick look stays here; reading, following and searching happen in
        // the logs window.
        const open = document.createElement('button');
        open.type = 'button';
        open.setAttribute('data-docker-logs-open', '');
        open.className = 'config-btn config-btn--small docker-logs-refresh';
        open.textContent = this.t('dockerLogsOpen', 'Open logs window');
        open.addEventListener('click', () => this.view.openLogs?.(this._summary || this._name));
        body.appendChild(open);

        const pre = document.createElement('pre');
        pre.setAttribute('data-docker-logs', '');
        pre.className = 'docker-logs';
        body.appendChild(pre);

        els.logsEl = pre;
    }

    async _loadLogs() {
        const name = this._name;
        if (!name) return;
        const data = await dockerDrawerFetchJSONAuth(`/api/docker/containers/${encodeURIComponent(name)}/logs?tail=${this.logLines()}`);
        if (name !== this._name || !this._els?.logsEl) return;
        this._els.logsEl.textContent = Array.isArray(data?.lines) ? data.lines.join('\n') : '';
    }

    /* ── Updates ───────────────────────────────────────────────────────── */

    /*
     * Where the container's image stands, the reader's say over it (skip the
     * version on offer, hold updates), what updates did, and a way back from
     * the last one while its previous image is still on the host.
     */
    _renderUpdates(body, detail) {
        if (!body || !detail) return;
        body.replaceChildren();
        const u = detail.update || {};
        const control = this.view.status?.control === true && !detail.self;
        const actions = this.view.actions;

        const status = document.createElement('p');
        status.className = 'docker-updates-status';
        status.setAttribute('data-docker-updates-status', '');
        const texts = {
            available: this.t('dockerUpdatesAvailable', 'A newer image is available.'),
            skipped: this.t('dockerUpdatesSkipped', 'A newer image is available; this version is skipped.'),
            held: this.t('dockerUpdatesHeld', 'A newer image is available; updates are held.'),
            current: this.t('dockerUpdatesCurrent', 'Up to date.'),
        };
        let text = texts[u.status] || this.t('dockerUpdatesUnknown', 'Not known — no check has compared this image yet.');
        if (u.held && u.status !== 'held') text += ` ${this.t('dockerUpdatesHeldNote', 'Updates are held.')}`;
        status.textContent = text;
        body.appendChild(status);

        const summary = this._summary?.name === detail.name ? { ...this._summary, ...detail } : detail;
        const button = (choice, label, primary = false) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `config-btn config-btn--small${primary ? ' config-btn--primary' : ''}`;
            b.setAttribute('data-docker-update-choice', choice);
            b.textContent = label;
            b.addEventListener('click', () => void actions?.choose(summary, choice));
            return b;
        };
        if (control) {
            const row = document.createElement('div');
            row.className = 'docker-updates-actions';
            if (u.status === 'available') row.appendChild(button('skip', this.t('dockerUpdateSkip', 'Skip this version')));
            if (u.skippedDigest) row.appendChild(button('unskip', this.t('dockerUpdateUnskip', 'Undo skip')));
            row.appendChild(u.held
                ? button('unhold', this.t('dockerUpdateUnhold', 'Resume updates'))
                : button('hold', this.t('dockerUpdateHold', 'Hold updates')));
            if (detail.rollback) {
                const target = detail.rollback.toVersion || String(detail.rollback.toImageId || '').replace(/^sha256:/, '').slice(0, 12);
                const back = document.createElement('button');
                back.type = 'button';
                back.className = 'config-btn config-btn--small';
                back.setAttribute('data-docker-rollback', '');
                back.textContent = this.t('dockerRollbackTo', 'Roll back to {version}', { version: target });
                back.title = this.t('dockerRollbackHint', 'Undo the update of {date}', { date: dockerFormatDate(detail.rollback.at / 1000) });
                back.addEventListener('click', () => void actions?.rollback(summary, detail.rollback));
                row.appendChild(back);
            }
            body.appendChild(row);
        }

        const history = Array.isArray(detail.updateHistory) ? detail.updateHistory : [];
        const heading = document.createElement('p');
        heading.className = 'docker-field-label';
        heading.textContent = this.t('dockerUpdateHistory', 'History');
        body.appendChild(heading);
        if (!history.length) {
            const none = document.createElement('p');
            none.className = 'docker-changes-empty';
            none.textContent = this.t('dockerUpdateHistoryNone', 'No updates from here yet.');
            body.appendChild(none);
            return;
        }
        const short = (id) => String(id || '').replace(/^sha256:/, '').slice(0, 12);
        const list = document.createElement('ul');
        list.className = 'docker-update-history';
        list.setAttribute('data-docker-update-history', '');
        history.forEach((e) => {
            const li = document.createElement('li');
            li.setAttribute('data-kind', e.kind);
            const what = document.createElement('span');
            what.className = 'docker-update-history-what';
            const verb = e.kind === 'rollback'
                ? this.t('dockerUpdateHistoryRolledBack', 'Rolled back')
                : this.t('dockerUpdateHistoryUpdated', 'Updated');
            what.textContent = `${verb} ${e.fromVersion || short(e.fromImageId)} → ${e.toVersion || short(e.toImageId)}`;
            const when = document.createElement('span');
            when.className = 'docker-health-when';
            when.textContent = dockerFormatDate(e.at / 1000);
            li.append(what, when);
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    /* ── Timeline ──────────────────────────────────────────────────────── */

    /*
     * What happened to the container, newest first: starts and stops,
     * crashes with their exit code, health changes, pauses, and the updates
     * and rollbacks. Recorded by the server from Docker's events; asked for
     * when the part is opened.
     */
    _wireTimeline(els) {
        const acc = els.sections.timeline?.closest('[data-slp-acc]');
        if (!acc) return;
        const load = () => {
            if (this._timelineLoaded || !acc.open) return;
            this._timelineLoaded = true;
            void this._loadTimeline();
        };
        acc.addEventListener('toggle', load);
        load();
    }

    async _loadTimeline() {
        const name = this._name;
        if (!name) return;
        const data = await dockerDrawerFetchJSON(`/api/docker/containers/${encodeURIComponent(name)}/timeline`);
        if (name !== this._name || !this._els?.sections.timeline) return;
        this._renderTimeline(this._els.sections.timeline, data);
    }

    _renderTimeline(body, data) {
        body.replaceChildren();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        if (!entries.length) {
            const none = document.createElement('p');
            none.className = 'docker-changes-empty';
            none.textContent = data
                ? this.t('dockerTimelineNone', 'Nothing recorded yet. nextDash writes down what happens from now on.')
                : this.t('dockerTimelineFailed', 'The timeline could not be read.');
            body.appendChild(none);
            return;
        }
        const words = {
            start: [this.t('dockerTimelineStart', 'Started'), 'good'],
            stop: [this.t('dockerTimelineStop', 'Stopped'), 'muted'],
            exit: [this.t('dockerTimelineExit', 'Exited on its own'), 'muted'],
            crash: [this.t('dockerTimelineCrash', 'Crashed'), 'bad'],
            'restart-loop': [this.t('dockerTimelineLoop', 'Kept restarting'), 'bad'],
            unhealthy: [this.t('dockerTimelineUnhealthy', 'Turned unhealthy'), 'bad'],
            healthy: [this.t('dockerTimelineHealthy', 'Healthy again'), 'good'],
            pause: [this.t('dockerTimelinePause', 'Paused'), 'warn'],
            unpause: [this.t('dockerTimelineUnpause', 'Resumed'), 'good'],
            update: [this.t('dockerTimelineUpdate', 'Updated'), 'accent'],
            rollback: [this.t('dockerTimelineRollback', 'Rolled back'), 'warn'],
        };
        const list = document.createElement('ol');
        list.className = 'docker-timeline';
        entries.forEach((e) => {
            const [label, tone] = words[e.kind] || [e.kind, 'muted'];
            const li = document.createElement('li');
            li.className = 'docker-timeline-entry';
            li.setAttribute('data-docker-timeline-entry', '');
            li.setAttribute('data-kind', e.kind);
            li.setAttribute('data-tone', tone);
            const dot = document.createElement('span');
            dot.className = 'docker-timeline-dot';
            dot.setAttribute('aria-hidden', 'true');
            const what = document.createElement('span');
            what.className = 'docker-timeline-what';
            what.textContent = e.detail ? `${label} — ${e.detail}` : label;
            const when = document.createElement('time');
            when.className = 'docker-health-when';
            when.dateTime = new Date(e.at).toISOString();
            when.textContent = dockerFormatDate(e.at / 1000);
            li.append(dot, what, when);
            list.appendChild(li);
        });
        body.appendChild(list);
    }

    /* ── Health ────────────────────────────────────────────────────────── */

    /*
     * The healthcheck's last checks, newest first. Only a container with a
     * healthcheck has the part at all; the checks load when it is opened
     * (behind the write token, as logs are: a check's output is a command's).
     */
    _wireHealth(els, summary) {
        const acc = els.sections.health?.closest('[data-slp-acc]');
        if (!acc) return;
        els.healthAcc = acc;
        acc.addEventListener('toggle', () => {
            if (acc.open) this._maybeLoadHealth();
        });
        this._showHealth(Boolean(summary?.health));
    }

    _showHealth(has) {
        const acc = this._els?.healthAcc;
        if (!acc) return;
        acc.hidden = !has;
        if (has && acc.open) this._maybeLoadHealth();
    }

    _maybeLoadHealth() {
        if (this._healthLoaded || this._els?.healthAcc?.hidden) return;
        this._healthLoaded = true;
        void this._loadHealth();
    }

    async _loadHealth() {
        const name = this._name;
        if (!name) return;
        const data = await dockerDrawerFetchJSONAuth(`/api/docker/containers/${encodeURIComponent(name)}/health`);
        if (name !== this._name || !this._els?.sections.health) return;
        this._renderHealth(this._els.sections.health, data);
    }

    _renderHealth(body, data) {
        body.replaceChildren();
        if (!data) {
            const msg = document.createElement('p');
            msg.className = 'docker-changes-empty';
            msg.textContent = this.t('dockerHealthUnavailable', 'The checks could not be read.');
            body.appendChild(msg);
            return;
        }
        this._fieldRow(body, 'dockerFieldHealth', 'Health', data.status);
        if (data.failingStreak > 0) {
            this._fieldRow(body, 'dockerHealthFailingLabel', 'Failing',
                this.t('dockerHealthFailing', '{count} in a row', { count: data.failingStreak }));
        }
        if (data.command) {
            const cmd = document.createElement('code');
            cmd.className = 'docker-health-command';
            cmd.setAttribute('data-docker-health-command', '');
            cmd.textContent = data.command;
            body.appendChild(cmd);
        }
        const checks = Array.isArray(data.checks) ? data.checks : [];
        if (!checks.length) {
            const msg = document.createElement('p');
            msg.className = 'docker-changes-empty';
            msg.textContent = this.t('dockerHealthNoChecks', 'No checks have run yet.');
            body.appendChild(msg);
            return;
        }
        const list = document.createElement('ol');
        list.className = 'docker-health-checks';
        checks.forEach((check) => {
            const ok = check.exitCode === 0;
            const item = document.createElement('li');
            item.className = 'docker-health-check';
            item.setAttribute('data-docker-health-check', ok ? 'pass' : 'fail');
            const head = document.createElement('div');
            head.className = 'docker-health-check-head';
            const mark = document.createElement('span');
            mark.className = 'docker-health-mark';
            mark.textContent = ok ? '✓' : `✗ ${this.t('dockerHealthExit', 'exit {code}', { code: check.exitCode })}`;
            const when = document.createElement('span');
            when.className = 'docker-health-when';
            when.textContent = dockerFormatDate(check.start);
            head.append(mark, when);
            item.appendChild(head);
            if (check.output) {
                const out = document.createElement('pre');
                out.className = 'docker-health-output';
                out.textContent = check.output;
                item.appendChild(out);
            }
            list.appendChild(item);
        });
        body.appendChild(list);
    }

    /* ── Changes ───────────────────────────────────────────────────────── */

    _wireChanges(els) {
        const body = els.sections.changes;
        body.replaceChildren();
        const list = document.createElement('div');
        list.setAttribute('data-docker-changes', '');
        list.className = 'docker-changes';
        body.appendChild(list);
        els.changesEl = list;
    }

    async _loadChanges() {
        const name = this._name;
        if (!name) return;
        const data = await dockerDrawerFetchJSON(`/api/docker/containers/${encodeURIComponent(name)}/changelog`);
        if (name !== this._name || !this._els?.changesEl) return;
        this._renderChanges(this._els.changesEl, data);
    }

    _renderChanges(list, data) {
        list.replaceChildren();
        const releases = Array.isArray(data?.releases) ? data.releases : [];

        if (!releases.length) {
            const msg = document.createElement('p');
            msg.className = 'docker-changes-empty';
            msg.textContent = data?.reason === 'rate-limited'
                ? this.t('dockerChangesRateLimited', 'GitHub is limiting requests right now; try again later.')
                : this.t('dockerNoChanges', 'No release notes found — the links below go to the project.');
            list.appendChild(msg);
        }

        releases.forEach((rel) => {
            const item = document.createElement('div');
            item.className = 'docker-release';

            const heading = document.createElement('div');
            heading.className = 'docker-release-heading';
            heading.textContent = rel.name || rel.tag || '';
            item.appendChild(heading);

            if (rel.published) {
                const meta = document.createElement('div');
                meta.className = 'docker-release-meta';
                meta.textContent = dockerFormatDate(rel.published);
                item.appendChild(meta);
            }

            item.appendChild(renderReleaseText(rel.body));
            list.appendChild(item);
        });

        const links = document.createElement('div');
        links.className = 'docker-changes-links';
        (Array.isArray(data?.links) ? data.links : []).forEach((link) => {
            const a = document.createElement('a');
            let href = link.url || '';
            if (link.kind === 'webui') href = window.DockerSearchIndex.webuiHref(href, this._summary);
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('data-docker-link', link.kind);
            a.className = 'docker-changes-link';
            const labelKey = DOCKER_LINK_KEYS[link.kind] || 'dockerLinkSource';
            a.textContent = this.t(labelKey, link.kind);
            links.appendChild(a);
        });
        list.appendChild(links);
    }
}

window.DockerDrawer = DockerDrawer;
