/**
 * Docker view — the containers running on this machine, modelled on
 * DashboardHealth: the same shared shell, the same view-lifecycle shape, the
 * same escape handling. This is the Task 10/11 shell: listing, search,
 * filters, sort, grouping and the update check. The detail drawer here is a
 * minimal placeholder; a later task replaces it with dashboard-docker-drawer.js
 * without changing how it is opened (selectContainer) or addressed
 * (#docker/<name>).
 */

/** fetch() that never throws and answers null on anything but a 2xx JSON body. */
async function dockerFetchJSON(url, init) {
    try {
        const res = await fetch(url, init);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

class DashboardDocker {
    static VIEW = 'docker';

    /** Container states that count as "stopped" for the filter and the sort. */
    static STOPPED_STATES = new Set(['exited', 'created', 'dead']);

    static SORT_RANK = { running: 0, paused: 1, restarting: 2 };

    constructor(dashboard) {
        this.dash = dashboard;
        this.status = null;
        this.containers = [];
        this.query = '';
        this.selected = null;
        this.drawerOpen = false;
        this.shell = null;
        this.drawerHost = null;
        this._pollTimer = null;
        this._checkedAt = null;
        this._escapeHandler = null;
        this.restoreViewState();
    }

    /* ── Small helpers, mirroring DashboardHealth's ──────────────────────── */

    t(key, fallback, params) {
        const d = this.dash;
        if (params && typeof d.formatDashboardLabel === 'function') {
            const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
            const text = d.formatDashboardLabel(bare, params, fallback);
            if (text && text !== bare && text !== key) {
                return text;
            }
            return Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(fallback || '')
            );
        }
        const raw = d.language?.t?.(key);
        return raw && raw !== key ? raw : fallback;
    }

    isActiveView() {
        return this.dash.activeView === DashboardDocker.VIEW;
    }

    /* ── View state persistence ───────────────────────────────────────────── */

    restoreViewState() {
        let saved = null;
        try {
            const raw = localStorage.getItem('nextdash.docker.view');
            saved = raw ? JSON.parse(raw) : null;
        } catch {
            saved = null;
        }
        this.sort = saved?.sort || 'name';
        this.group = Boolean(saved?.group);
        this.filter = saved?.filter || 'all';
    }

    persistViewState() {
        try {
            localStorage.setItem('nextdash.docker.view', JSON.stringify({
                sort: this.sort, group: this.group, filter: this.filter,
            }));
        } catch {
            // Storage unavailable or full — the view still works this session.
        }
    }

    /* ── View lifecycle ────────────────────────────────────────────────── */

    /**
     * Make the address bar say #docker (or #docker/<name> while a container is
     * selected). Always a replaceState: unlike Health's #health, there is no
     * sub-navigation inside this view worth a Back stop of its own yet.
     */
    restoreDockerHash() {
        const target = this.selected ? `#docker/${encodeURIComponent(this.selected)}` : '#docker';
        if (window.location.hash === target) return;
        const next = `${window.location.pathname}${window.location.search}${target}`;
        history.replaceState(history.state, '', next);
    }

    async openDockerView({ select } = {}) {
        const d = this.dash;
        if (d.activeView === DashboardDocker.VIEW) {
            if (select) this.selectContainer(select, { openDrawer: true });
            return true;
        }
        if (d.isInlineEditActive?.() && !(await d.confirmInlineEditBeforeNavigation?.())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.inbox?.clearKeyboardSelection?.();
        d.setActiveView(DashboardDocker.VIEW);
        window.nextdashTrack?.('view:docker');
        d.pageNav?.updateDocumentTitle?.();
        await this.loadAndRender();
        if (select) {
            this.selectContainer(select, { openDrawer: true });
        } else {
            this.restoreDockerHash();
        }
        this.startPolling();
        return true;
    }

    closeDockerView() {
        const d = this.dash;
        if (d.activeView !== DashboardDocker.VIEW) {
            return false;
        }
        this.stopPolling();
        this._closeDrawerState();
        this._destroyShell();
        const restored = d.pageNav?.restoreBookmarksViewForPage?.(d.currentPageId) ?? false;
        if (restored) {
            d.keyboardNavigation?.scheduleUpdate?.();
        }
        return restored;
    }

    setupEscapeShortcut() {
        const d = this.dash;
        if (this._escapeHandler) {
            document.removeEventListener('keydown', this._escapeHandler, true);
        }
        this._escapeHandler = (e) => {
            if (d.activeView !== DashboardDocker.VIEW) return;
            const tag = document.activeElement?.tagName;
            const typing = tag === 'TEXTAREA' || document.activeElement?.isContentEditable
                || (tag === 'INPUT' && document.activeElement?.type !== 'checkbox');

            // The slash shortcut behaves the same way Config's bookmark search
            // does: it only fires when nothing is already capturing text input.
            if (e.key === '/' && !typing) {
                const search = this.shell?.toolbar?.querySelector('[data-docker-search]');
                if (search) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    search.focus();
                }
                return;
            }
            if (e.key !== 'Escape') return;
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen?.()) return;
            if (d.searchComponent?.isActive?.()) return;
            if (d.isInlineEditActive?.()) return;
            if (typing) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            // The drawer is the innermost thing on screen: the first Escape
            // drops it and leaves the list, the same order Health uses for its
            // own overlays.
            if (this.drawerOpen) {
                this.closeDrawer();
                return;
            }
            this.closeDockerView();
        };
        document.addEventListener('keydown', this._escapeHandler, true);
    }

    /* ── Data ──────────────────────────────────────────────────────────── */

    async loadAndRender() {
        this.status = await dockerFetchJSON('/api/docker/status')
            || { socket: false, control: false, reason: 'unreachable' };
        if (this.status.socket) {
            const [containersBody, updatesBody] = await Promise.all([
                dockerFetchJSON('/api/docker/containers'),
                dockerFetchJSON('/api/docker/updates'),
            ]);
            this.containers = Array.isArray(containersBody?.containers) ? containersBody.containers : [];
            this._checkedAt = updatesBody?.checkedAt || null;
        } else {
            this.containers = [];
            this._checkedAt = null;
        }
        this.mountShell();
        this.render();
    }

    /** Re-reads the container list only, for polling and the post-check refresh. */
    async refreshContainers() {
        if (!this.status?.socket) return;
        const body = await dockerFetchJSON('/api/docker/containers');
        this.containers = Array.isArray(body?.containers) ? body.containers : [];
        this.render();
    }

    startPolling() {
        this.stopPolling();
        this._pollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible' || !this.isActiveView()) return;
            void this.refreshContainers();
        }, 5000);
    }

    stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    async checkForUpdates() {
        const btn = this.shell?.toolbar?.querySelector('[data-docker-check]');
        if (btn) {
            btn.disabled = true;
            btn.setAttribute('aria-busy', 'true');
        }
        try {
            const res = await window.nextDashFetch('/api/docker/updates/check', { method: 'POST' });
            if (!res.ok) throw new Error('check failed');
            const body = await res.json().catch(() => null);
            this._checkedAt = body?.checkedAt || Date.now();
            await this.refreshContainers();
        } catch {
            window.AppNotification?.showError?.(this.t('dashboard.dockerCheckFailed', 'Could not check for updates'));
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.removeAttribute('aria-busy');
            }
            this.syncToolbar();
        }
    }

    /* ── Shell ─────────────────────────────────────────────────────────── */

    filterRows() {
        return [
            { key: 'all', label: this.t('dashboard.dockerFilterAll', 'All') },
            { key: 'running', label: this.t('dashboard.dockerFilterRunning', 'Running') },
            { key: 'stopped', label: this.t('dashboard.dockerFilterStopped', 'Stopped') },
            { key: 'updates', label: this.t('dashboard.dockerFilterUpdates', 'Updates') },
        ];
    }

    filterCount(key) {
        const list = this.containers;
        if (key === 'all') return list.length;
        if (key === 'running') return list.filter((c) => c.state === 'running').length;
        if (key === 'stopped') return list.filter((c) => DashboardDocker.STOPPED_STATES.has(c.state)).length;
        if (key === 'updates') return list.filter((c) => c.update?.status === 'available').length;
        return 0;
    }

    shellConfig() {
        return {
            id: 'docker',
            title: this.t('dashboard.dockerView', 'Containers'),
            description: this.t('dashboard.dockerViewDescription', 'What runs on this machine'),
            t: (key, fallback) => this.t(key, fallback),
            activeFilter: this.filter,
            filterClass: 'docker-view-filter-btn',
            filterCountClass: 'docker-view-filter-count',
            filters: this.filterRows().map((row) => ({
                key: row.key,
                label: row.label,
                count: this.filterCount(row.key),
                dataAttrs: { 'data-docker-filter': row.key },
            })),
            onFilter: (key, via) => this.applyFilter(key, via),
        };
    }

    /** Mounts the shell once; later renders reuse it and repaint only the body. */
    mountShell() {
        const container = document.getElementById('dashboard-layout');
        if (!container || typeof window.ListViewShell === 'undefined') return null;
        if (this.shell && container.contains(this.shell.root)) return this.shell;
        this._destroyShell();
        container.innerHTML = '';
        container.className = 'docker-layout';
        ['aria-colcount', 'aria-rowcount', 'role', 'aria-label', 'data-i18n-aria']
            .forEach((name) => container.removeAttribute(name));
        container.tabIndex = -1;
        this.shell = window.ListViewShell.mount(container, this.shellConfig());
        this.buildToolbar(this.shell.toolbar);
        // The drawer is a sibling of the shell's own root, not a child of the
        // body it repaints — a table redraw must never carry the drawer away.
        this.drawerHost = document.createElement('div');
        this.drawerHost.className = 'docker-drawer-host';
        this.drawerHost.hidden = true;
        container.appendChild(this.drawerHost);
        return this.shell;
    }

    _destroyShell() {
        this.shell?.destroy?.();
        this.shell = null;
        this.drawerHost = null;
    }

    applyFilter(key, via) {
        this.filter = key || 'all';
        this.persistViewState();
        void via; // tracked nowhere yet; kept for parity with the shell's callback shape
        this.render();
    }

    /* ── Toolbar ───────────────────────────────────────────────────────── */

    buildToolbar(host) {
        const searchLabel = this.escape(this.t('dashboard.dockerSearchPlaceholder', 'Search containers'));
        const sortOptions = [
            ['name', this.t('dashboard.dockerSortName', 'name')],
            ['status', this.t('dashboard.dockerSortStatus', 'status')],
            ['uptime', this.t('dashboard.dockerSortUptime', 'uptime')],
        ].map(([value, label]) => `<option value="${value}">${this.escape(label)}</option>`).join('');
        host.innerHTML = `
            <input type="search" data-docker-search value="${this.escape(this.query)}"
                   placeholder="${searchLabel}" autocomplete="off" spellcheck="false" aria-label="${searchLabel}">
            <select data-docker-sort aria-label="${this.escape(this.t('dashboard.dockerSortLabel', 'Sort containers'))}">${sortOptions}</select>
            <label class="docker-view-group-label">
                <input type="checkbox" data-docker-group>
                <span>${this.escape(this.t('dashboard.dockerGroupByProject', 'Group by project'))}</span>
            </label>
            <button type="button" data-docker-check>${this.escape(this.t('dashboard.dockerCheckUpdates', 'Check for updates'))}</button>
            <span data-docker-checked-at class="docker-checked-at"></span>
        `;
        this.bindToolbar(host);
        this.syncToolbar();
    }

    bindToolbar(host) {
        const search = host.querySelector('[data-docker-search]');
        search?.addEventListener('input', (e) => {
            this.query = e.target.value;
            this.render();
        });
        search?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            e.stopPropagation();
        });

        host.querySelector('[data-docker-sort]')?.addEventListener('change', (e) => {
            this.sort = e.target.value || 'name';
            this.persistViewState();
            this.render();
        });

        host.querySelector('[data-docker-group]')?.addEventListener('change', (e) => {
            this.group = Boolean(e.target.checked);
            this.persistViewState();
            this.render();
        });

        host.querySelector('[data-docker-check]')?.addEventListener('click', () => {
            void this.checkForUpdates();
        });
    }

    /** What the toolbar says about the current view, without rebuilding it. */
    syncToolbar() {
        const host = this.shell?.toolbar;
        if (!host) return;
        const search = host.querySelector('[data-docker-search]');
        if (search && search.value !== this.query) search.value = this.query;
        const sortSelect = host.querySelector('[data-docker-sort]');
        if (sortSelect && sortSelect.value !== this.sort) sortSelect.value = this.sort;
        const groupBox = host.querySelector('[data-docker-group]');
        if (groupBox) groupBox.checked = this.group;
        const checkedAt = host.querySelector('[data-docker-checked-at]');
        if (checkedAt) checkedAt.textContent = this.checkedAtText();
    }

    checkedAtText() {
        if (!this._checkedAt) return '';
        const diff = Date.now() - Number(this._checkedAt);
        if (diff < 0 || diff < 60_000) return this.t('dashboard.dockerCheckedJustNow', 'just now');
        if (diff < 3_600_000) {
            return this.t('dashboard.dockerCheckedMinutes', '{count} min ago', { count: Math.floor(diff / 60_000) });
        }
        return this.t('dashboard.dockerCheckedHours', '{count} h ago', { count: Math.floor(diff / 3_600_000) });
    }

    /* ── Filtering, sorting, grouping ──────────────────────────────────── */

    matchesFilter(c) {
        if (this.filter === 'running') return c.state === 'running';
        if (this.filter === 'stopped') return DashboardDocker.STOPPED_STATES.has(c.state);
        if (this.filter === 'updates') return c.update?.status === 'available';
        return true;
    }

    compareFn() {
        if (this.sort === 'status') {
            return (a, b) => (DashboardDocker.SORT_RANK[a.state] ?? 3) - (DashboardDocker.SORT_RANK[b.state] ?? 3)
                || a.name.localeCompare(b.name);
        }
        if (this.sort === 'uptime') {
            return (a, b) => (a.created || 0) - (b.created || 0);
        }
        return (a, b) => a.name.localeCompare(b.name);
    }

    filteredSortedContainers() {
        const q = String(this.query || '').trim().toLowerCase();
        const matches = window.DockerSearchIndex?.matches;
        return this.containers
            .filter((c) => this.matchesFilter(c) && (typeof matches === 'function' ? matches(c, q) : true))
            .slice()
            .sort(this.compareFn());
    }

    /* ── Rendering (DOM only — container data never goes through innerHTML) ── */

    render() {
        if (!this.shell) return;
        this.shell.setActive(this.filter);
        this.shell.setCounts({
            all: this.filterCount('all'),
            running: this.filterCount('running'),
            stopped: this.filterCount('stopped'),
            updates: this.filterCount('updates'),
        });
        this.syncToolbar();

        const body = this.shell.body;
        body.replaceChildren();
        if (!this.status?.socket) {
            body.appendChild(this.buildSetupCard());
            return;
        }
        if (this.status.control === false) {
            body.appendChild(this.buildReadOnlyLine());
        }
        body.appendChild(this.buildTable());
        this.renderDrawer();
    }

    buildSetupCard() {
        const wrap = document.createElement('div');
        wrap.setAttribute('data-docker-setup', '');
        wrap.className = 'docker-setup';
        const title = document.createElement('h3');
        title.className = 'docker-setup-title';
        title.textContent = this.t('dashboard.dockerSetupTitle', 'Connect nextDash to Docker');
        wrap.appendChild(title);

        const denied = this.status?.reason === 'docker-socket-denied';
        const hint = document.createElement('p');
        hint.textContent = denied
            ? this.t('dashboard.dockerSetupDenied', 'nextDash can see the socket but may not open it.')
            : this.t('dashboard.dockerSetupHint', 'Mount the Docker socket and set NEXTDASH_DOCKER_SOCKET to read containers.');
        wrap.appendChild(hint);

        if (!denied) {
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.textContent = 'volumes:\n'
                + '  - /var/run/docker.sock:/var/run/docker.sock:ro\n'
                + 'environment:\n'
                + '  - NEXTDASH_DOCKER_SOCKET=/var/run/docker.sock';
            pre.appendChild(code);
            wrap.appendChild(pre);
        }
        return wrap;
    }

    buildReadOnlyLine() {
        const p = document.createElement('p');
        p.setAttribute('data-docker-readonly', '');
        p.className = 'docker-readonly';
        p.textContent = this.t('dashboard.dockerReadOnly', 'Read-only — set NEXTDASH_DOCKER_CONTROL=1 to manage containers.');
        return p;
    }

    buildTable() {
        const list = this.filteredSortedContainers();
        const table = document.createElement('table');
        table.className = 'docker-table';
        const tbody = document.createElement('tbody');
        if (this.group) {
            this.appendGroupedRows(tbody, list);
        } else {
            list.forEach((c) => tbody.appendChild(this.buildRow(c)));
        }
        table.appendChild(tbody);
        return table;
    }

    /** Grouped by compose project; the project-less group sorts last. */
    appendGroupedRows(tbody, list) {
        const groups = new Map();
        list.forEach((c) => {
            const key = c.composeProject || '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(c);
        });
        const keys = [...groups.keys()].filter((k) => k !== '').sort((a, b) => a.localeCompare(b));
        if (groups.has('')) keys.push('');
        keys.forEach((key) => {
            const heading = document.createElement('tr');
            heading.className = 'docker-group-row';
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.textContent = key || this.t('dashboard.dockerNoProject', 'No project');
            heading.appendChild(cell);
            tbody.appendChild(heading);
            groups.get(key).forEach((c) => tbody.appendChild(this.buildRow(c)));
        });
    }

    buildRow(c) {
        const tr = document.createElement('tr');
        tr.className = 'docker-row';
        tr.setAttribute('data-docker-row', c.name);
        tr.setAttribute('aria-selected', String(this.selected === c.name));
        tr.tabIndex = -1;

        const nameCell = document.createElement('td');
        nameCell.className = 'docker-cell docker-cell--name';
        const nameText = document.createElement('span');
        nameText.className = 'docker-name';
        nameText.textContent = c.name;
        nameCell.appendChild(nameText);
        if (c.update?.status === 'available') {
            const badge = document.createElement('span');
            badge.setAttribute('data-docker-update-badge', '');
            badge.className = 'docker-badge';
            badge.textContent = this.t('dashboard.dockerUpdateBadge', 'update');
            nameCell.appendChild(badge);
        }
        tr.appendChild(nameCell);

        const imageCell = document.createElement('td');
        imageCell.className = 'docker-cell docker-cell--image';
        imageCell.textContent = c.image || '';
        tr.appendChild(imageCell);

        const stateCell = document.createElement('td');
        stateCell.className = 'docker-cell docker-cell--state';
        stateCell.textContent = c.status || c.state || '';
        tr.appendChild(stateCell);

        const portsCell = document.createElement('td');
        portsCell.className = 'docker-cell docker-cell--ports';
        (c.ports || []).filter((p) => p && p.public).forEach((p) => {
            const a = document.createElement('a');
            a.className = 'docker-port';
            a.href = `http://${window.location.hostname}:${p.public}`;
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = String(p.public);
            portsCell.appendChild(a);
        });
        tr.appendChild(portsCell);

        tr.addEventListener('click', (e) => {
            if (e.target.closest('a')) return; // a port link handles its own click
            this.selectContainer(c.name, { openDrawer: true });
        });
        return tr;
    }

    /* ── Selection and the (minimal) drawer ───────────────────────────────
     * A later task swaps renderDrawer()'s body for dashboard-docker-drawer.js's
     * sections; selectContainer(), the [data-docker-drawer] host and the
     * #docker/<name> address all stay exactly as they are here. */

    selectContainer(name, { openDrawer = true } = {}) {
        this.selected = name || null;
        this.drawerOpen = Boolean(openDrawer && this.selected);
        this.restoreDockerHash();
        this.render();
    }

    closeDrawer() {
        this._closeDrawerState();
        this.restoreDockerHash();
        this.render();
    }

    _closeDrawerState() {
        this.selected = null;
        this.drawerOpen = false;
        if (this.drawerHost) {
            this.drawerHost.hidden = true;
            this.drawerHost.replaceChildren();
        }
    }

    renderDrawer() {
        if (!this.drawerHost) return;
        if (!this.drawerOpen || !this.selected) {
            this.drawerHost.hidden = true;
            this.drawerHost.replaceChildren();
            return;
        }
        const c = this.containers.find((x) => x.name === this.selected);
        this.drawerHost.hidden = false;
        this.drawerHost.replaceChildren();

        const panel = document.createElement('div');
        panel.setAttribute('data-docker-drawer', '');
        panel.className = 'docker-drawer';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', this.selected);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'docker-drawer-close';
        closeBtn.setAttribute('aria-label', this.t('dashboard.dockerDrawerClose', 'Close'));
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => this.closeDrawer());
        panel.appendChild(closeBtn);

        const title = document.createElement('h3');
        title.className = 'docker-drawer-title';
        title.textContent = this.selected;
        panel.appendChild(title);

        if (c) {
            const image = document.createElement('p');
            image.className = 'docker-drawer-image';
            image.textContent = c.image || '';
            panel.appendChild(image);

            const status = document.createElement('p');
            status.className = 'docker-drawer-status';
            status.textContent = c.status || c.state || '';
            panel.appendChild(status);
        }

        this.drawerHost.appendChild(panel);
    }

    escape(text) {
        return this.dash.escapeHtml ? this.dash.escapeHtml(text) : String(text || '');
    }
}

window.DashboardDocker = DashboardDocker;
