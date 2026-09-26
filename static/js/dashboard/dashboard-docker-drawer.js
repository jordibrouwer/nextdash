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
const DOCKER_SECTION_KEYS = ['overview', 'network', 'volumes', 'resources', 'env', 'logs', 'changes'];

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
        this._buildSkeleton(typeof container === 'string' ? { name } : container);
        void this._loadDetail(name);
    }

    /** Opens one section on arrival, as :docker <name> logs asks. */
    openSection(key) {
        this.base.openSection(key);
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
        this.base.open(summary.name, {
            title: summary.name,
            onSectionToggle: (key, open) => this._onSectionToggle(key, open),
            build: (panel, ctx) => {
                // The Containers specs and styles still address these.
                panel.setAttribute('data-docker-drawer', '');
                panel.classList.add('docker-drawer');
                this._fillHeader(ctx, summary);
                DOCKER_SECTION_KEYS.forEach((key) => {
                    const titleKey = `dockerSection${key.charAt(0).toUpperCase()}${key.slice(1)}`;
                    const body = ctx.section(key, this.t(titleKey, key));
                    body.parentElement.setAttribute('data-docker-section', key);
                    body.classList.add('docker-section-body');
                    els.sections[key] = body;
                });
            },
        });
        this._els = els;
        this._wireOverviewNetworkVolumesEnv(els);
        this._wireResources(els);
        this._wireLogs(els);
        this._wireChanges(els);
        // Sections restored open fire their toggle before _els exists; run
        // their loads now that it does.
        DOCKER_SECTION_KEYS.forEach((key) => {
            if (els.sections[key]?.parentElement?.open) this._onSectionToggle(key, true);
        });
    }

    _fillHeader(ctx, summary) {
        const pill = document.createElement('span');
        pill.className = 'docker-drawer-pill';
        pill.setAttribute('data-docker-state', '');
        pill.textContent = summary.status || summary.state || '';
        ctx.heading.appendChild(pill);

        if (summary.health) {
            const health = document.createElement('span');
            health.className = 'docker-drawer-health';
            health.setAttribute('data-docker-health', '');
            health.textContent = summary.health;
            ctx.heading.appendChild(health);
        }

        // The actions the container's current state allows; DockerActions
        // decides which, so the drawer and the row keys never disagree.
        ctx.actions.setAttribute('data-docker-drawer-actions', '');
        ctx.actions.classList.add('docker-drawer-actions');
        this.view.actions?.renderButtons(ctx.actions, summary);
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
        this._renderVolumes(els.sections.volumes, detail);
        this._renderEnv(els.sections.env, detail);

        const pill = this.base.panel?.querySelector('[data-docker-state]');
        if (pill && detail) pill.textContent = detail.status || detail.state || '';
        const health = this.base.panel?.querySelector('[data-docker-health]');
        if (health && detail?.health) health.textContent = detail.health;
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
            reveal.className = 'docker-env-reveal';
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

        body.append(cpu, mem);
        els.cpuEl = cpuVal;
        els.memEl = memVal;
    }

    _startResourcePolling() {
        this._stopResourcePolling();
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
        const data = await dockerDrawerFetchJSON(`/api/docker/containers/${encodeURIComponent(name)}/stats`);
        if (name !== this._name || !this._els) return;
        if (this._els.cpuEl) this._els.cpuEl.textContent = dockerFormatCpu(data?.cpuPercent);
        if (this._els.memEl) {
            this._els.memEl.textContent = `${dockerFormatBytes(data?.memoryUsed)} / ${dockerFormatBytes(data?.memoryLimit)}`;
        }
    }

    /* ── Logs ──────────────────────────────────────────────────────────── */

    _wireLogs(els) {
        const body = els.sections.logs;
        body.replaceChildren();

        const refresh = document.createElement('button');
        refresh.type = 'button';
        refresh.setAttribute('data-docker-logs-refresh', '');
        refresh.className = 'docker-logs-refresh';
        refresh.textContent = this.t('dockerLogsRefresh', 'Refresh');
        refresh.addEventListener('click', () => void this._loadLogs());
        body.appendChild(refresh);

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
            if (link.kind === 'webui') href = href.replace('[IP]', location.hostname);
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
