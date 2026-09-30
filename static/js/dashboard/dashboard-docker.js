/**
 * Docker view — the containers running on this machine, modelled on
 * DashboardHealth: the same shared shell, the same view-lifecycle shape, the
 * same escape handling. This file owns the shell: listing, search, filters,
 * sort, grouping and the update check. The detail drawer's own sections live
 * in dashboard-docker-drawer.js (a DockerDrawer instance); this file only
 * owns the drawer host, when it opens/closes and the #docker/<name> address.
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

    /*
     * The one-time tour's tip id, repeated from containers-tutorial.js so the
     * view can skip fetching the tour once it has been seen. Both must agree.
     */
    static TUTORIAL_TIP_ID = 'containersTutorialV1';

    /**
     * The Disk tab's address, #docker/~disk: "~" cannot start a container
     * name, so a container called "disk" keeps #docker/disk.
     */
    static DISK_ADDRESS = '~disk';

    /** Sorts on the stats sampler's reading: highest first, no reading last. */
    static USAGE_SORTS = new Set(['cpu', 'mem']);

    /** Container states that count as "stopped" for the filter and the sort. */
    static STOPPED_STATES = new Set(['exited', 'created', 'dead']);

    static SORT_RANK = { running: 0, paused: 1, restarting: 2 };

    constructor(dashboard) {
        this.dash = dashboard;
        this.status = null;
        this.containers = [];
        this.usageEnabled = false;
        this.tab = 'containers';     // or 'disk'
        this.disk = null;
        this.diskTotals = null;
        this.query = '';
        this.selected = null;
        this.drawerOpen = false;
        this.shell = null;
        this.drawerHost = null;
        this.drawer = null;
        this._pollTimer = null;
        this._checkedAt = null;
        this._escapeHandler = null;
        // Containers with an action in flight, name -> phase ("stop",
        // "pulling", ...). Kept here rather than on the row so a repaint
        // mid-action keeps showing it.
        this.busy = new Map();
        // Ticked rows, for the selection bar: by their box, x or Space,
        // Cmd/Ctrl/Shift-click. Kept apart from this.selected, which is the
        // keyboard cursor -- moving it must not change what is ticked.
        this.multi = new Set();
        this._multiAnchor = null;
        /** The selection bar, built once and updated in place (syncBulkBar). */
        this._bulkBar = null;
        /** True while the bar's action runs, so a second press cannot start another. */
        this.bulkRunning = false;
        this.actions = typeof window.DockerActions === 'function' ? new window.DockerActions(this) : null;
        this.menu = typeof window.DockerRowMenu === 'function' ? new window.DockerRowMenu(this) : null;
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
        this.sortDir = saved?.sortDir === 'desc' ? 'desc' : 'asc';
        // Older saves stored a boolean for "group by project".
        const group = saved?.group === true ? 'project' : saved?.group;
        this.group = DashboardDocker.GROUPS.includes(group) ? group : 'none';
        this.filter = saved?.filter || 'all';
    }

    persistViewState() {
        try {
            localStorage.setItem('nextdash.docker.view', JSON.stringify({
                sort: this.sort, sortDir: this.sortDir, group: this.group, filter: this.filter,
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
        let target = this.selected ? `#docker/${encodeURIComponent(this.selected)}` : '#docker';
        if (this.tab === 'disk') target = `#docker/${DashboardDocker.DISK_ADDRESS}`;
        if (window.location.hash === target) return;
        const next = `${window.location.pathname}${window.location.search}${target}`;
        history.replaceState(history.state, '', next);
    }

    async openDockerView({ select, section, filter } = {}) {
        const d = this.dash;
        if (d.activeView === DashboardDocker.VIEW) {
            if (select) this.selectContainer(select, { openDrawer: true, section });
            if (filter) this.applyFilter(filter);
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
        d.pageNav?.setActiveDockerTab?.();
        await this.loadAndRender();
        if (select) {
            this.selectContainer(select, { openDrawer: true, section });
        } else {
            this.restoreDockerHash();
        }
        // Applied after the render above rather than folded into it, the same
        // way a widget's link into Health sets its filter after the fact:
        // one path handles "arrived with a filter" whether the view was
        // already open or is only just mounting.
        if (filter) this.applyFilter(filter);
        this.startPolling();
        // Not awaited: the view is already usable, and a slow script fetch
        // must not hold up the navigation that asked for it.
        void this.maybeShowTutorial();
        return true;
    }

    /** The band's own button: the tour, seen or not. */
    buildHeaderActions(host) {
        if (!host) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lvs-action';
        button.setAttribute('data-docker-tour', '');
        button.title = this.t('dashboard.dockerTourHint', 'A tour of the Containers view');
        button.textContent = this.t('dashboard.inboxTour', 'Tour');
        button.addEventListener('click', () => { void this.openTour(); });
        // ℹ beside it, as the Bookmarks and Inbox views have: what the view
        // does, where the tour shows where things are.
        const help = document.createElement('button');
        help.type = 'button';
        help.className = 'lvs-action view-help-btn';
        help.setAttribute('data-docker-help', '');
        help.setAttribute('aria-haspopup', 'dialog');
        const label = this.t('dashboard.dockerHelpTitle', 'How the Containers view works');
        help.title = label;
        help.setAttribute('aria-label', label);
        help.textContent = 'ℹ';
        help.addEventListener('click', () => this.showExplainer());
        host.append(button, help);
    }

    /** "How this works", behind the ℹ in the header. */
    showExplainer() {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('docker:explainer');
        const esc = (v) => this.escape(v);
        const row = (key, title, body) => `<div class="view-explain-row"><h4>${esc(this.t(`dashboard.${key}Title`, title))}</h4><p>${esc(this.t(`dashboard.${key}`, body))}</p></div>`;
        window.AppModal.show({
            title: this.t('dashboard.dockerHelpTitle', 'How the Containers view works'),
            htmlMessage: `<div class="view-explain">
                ${row('dockerHelpList', 'The list', DashboardDocker.HELP.list)}
                ${row('dockerHelpActions', 'Acting on containers', DashboardDocker.HELP.actions)}
                ${row('dockerHelpPanel', 'The side panel', DashboardDocker.HELP.panel)}
                ${row('dockerHelpUpdates', 'Updates', DashboardDocker.HELP.updates)}
                ${row('dockerHelpDisk', 'Disk', DashboardDocker.HELP.disk)}
            </div>`,
            confirmText: this.t('dashboard.healthExplainClose', 'Got it'),
            showCancel: false,
            modalClass: 'view-explain-modal',
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
        });
    }

    /**
     * The tour's script, fetched on demand: a reader who has done the tour
     * never pays for it again.
     */
    async loadTutorial() {
        if (typeof window.ContainersTutorial !== 'undefined') return true;
        try {
            await window.LazyScript.loadScriptOnce('js/containers-tutorial.js', 'containersTutorialModule',
                () => typeof window.ContainersTutorial !== 'undefined');
            return true;
        } catch {
            // A tour that cannot be fetched is not worth an error toast.
            return false;
        }
    }

    /** First visit: the tour, once. Checked before the script is fetched at all. */
    async maybeShowTutorial() {
        if (window.DiscoverabilityState?.hasSeenTip?.(DashboardDocker.TUTORIAL_TIP_ID)) return;
        if (this.dash.settings?.enableSessionTips === false) return;
        if (!(await this.loadTutorial())) return;
        // The reader may have left while the script came in.
        if (this.dash.activeView !== DashboardDocker.VIEW) return;
        window.ContainersTutorial?.maybeShow?.();
    }

    async openTour() {
        if (!(await this.loadTutorial())) return;
        window.ContainersTutorial?.open?.();
    }

    /**
     * Another view took the layout. The drawer lives on <body>, so it would
     * stay on screen over that view unless it is taken down here; polling and
     * the row menu stop with it.
     */
    onLeave() {
        this.tab = 'containers';
        this.stopPolling();
        this.menu?.close();
        this.logsModal?.close({ restoreFocus: false });
        this._closeDrawerState();
        this._destroyShell();
        this.multi.clear();
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
            // The logs window owns the keyboard while it is open: its own
            // handler reads /, f, Enter and Escape.
            if (window.DockerLogsModal?.isOpen?.() || document.querySelector('dialog[open]')) return;
            // The row menu owns the keyboard while it is open; its own handler
            // closes it, and Escape must not also close the view underneath.
            if (document.getElementById('docker-row-menu')) return;
            const active = document.activeElement;
            const tag = active?.tagName;
            const isSearch = active?.matches?.('[data-docker-search]');
            const typing = tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable
                || (tag === 'INPUT' && active?.type !== 'checkbox');

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

            // Row navigation: ↑/↓ move the highlighted row, Enter opens its
            // drawer. Allowed from the search box too — like Health's rows —
            // so typing a filter and then arrowing into the results works.
            const menuOrModalOpen = window.DashboardTagCloud?.modalOpen || d.isModalOpen?.()
                || d.searchComponent?.isActive?.() || d.isInlineEditActive?.();
            // Focus already inside the drawer owns its own Enter/arrows (a
            // <summary> toggling, a reveal button, a link) — never hijacked here.
            const inDrawer = Boolean(active?.closest?.('[data-docker-drawer]'));
            const rowAncestor = active?.closest?.('.docker-row');
            // A row's own tick is not a control the arrows have to leave alone:
            // after ticking one with the mouse, ↓ still moves through the list.
            const onRowControl = Boolean(rowAncestor && active !== rowAncestor
                && active?.matches?.('a, button, input:not(.docker-tick-input), select'));
            const onHeading = Boolean(active?.matches?.('[data-docker-sort-head], [data-docker-stack-action]'));

            // Ticking rows, with the keys Bookmarks and Inbox use: x or Space
            // ticks the highlighted row, X or Shift+↑/↓ ticks the run from the
            // last one ticked, Ctrl/Cmd+A ticks everything the filter shows and
            // a second press clears it. Containers tab only, and never from a
            // field or a control: Space on a focused button (or on a row's own
            // tick) is that control's. From the drawer too, as s and r are.
            const onControl = Boolean(active?.matches?.('a[href], button, input, select, textarea, summary'));
            const canTick = this.tab === 'containers' && Boolean(this.status?.socket)
                && !menuOrModalOpen && !typing;
            if (canTick && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.checkAllVisible();
                return;
            }
            const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
            if (canTick && plain && !onControl && this.selected && (e.key === 'x' || e.key === ' ' || e.key === 'X')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.key === 'X') this.extendCheckedTo(this.selected);
                else this.toggleChecked(this.selected);
                return;
            }
            if (canTick && plain && e.shiftKey && !inDrawer && !onRowControl && !onHeading && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.extendCheckedByKey(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }

            if (!menuOrModalOpen && !inDrawer && !onRowControl && !onHeading && (typing ? isSearch : true)
                && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (isSearch) active.blur();
                if (e.key === 'Enter') {
                    if (this.selected) this.selectContainer(this.selected, { openDrawer: true });
                } else {
                    this.moveRowSelection(e.key === 'ArrowDown' ? 1 : -1);
                }
                return;
            }

            // The view's own letters: d flips Containers and Disk; l opens the
            // logs window and m mutes or unmutes the selected container. Never
            // while typing or with a modifier held.
            if (!typing && !menuOrModalOpen && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
                && (e.key === 'd' || e.key === 'l' || e.key === 'm')) {
                if (e.key === 'd') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    this.showTab(this.tab === 'disk' ? 'containers' : 'disk');
                    return;
                }
                const c = this.selected ? this.containers.find((x) => x.name === this.selected) : null;
                if (!c || this.tab !== 'containers') return;
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.key === 'l') {
                    this.openLogs(c);
                } else if (!c.self) {
                    void this.actions?.toggleMute(c, { via: 'key' }).then(() => this.drawerRefresh?.());
                }
                return;
            }

            // Row actions, on the selected container. Never while typing or
            // with a modifier held, so Cmd+R still reloads the page.
            // Backspace is the key a Mac calls delete, and many keyboards have
            // no Delete at all; both remove.
            const actionKey = { s: 'toggle-run', r: 'restart', p: 'toggle-pause', u: 'update', Delete: 'remove', Backspace: 'remove' }[e.key];
            const plainKey = actionKey && !typing && !menuOrModalOpen && !e.metaKey && !e.ctrlKey && !e.altKey;
            // With containers ticked, remove means the ticked ones, as Delete
            // does for a selection in the Bookmarks view.
            if (plainKey && actionKey === 'remove' && this.multi.size && this.status?.control === true) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.runBulkAction('remove');
                return;
            }
            if (plainKey && this.selected) {
                const c = this.containers.find((x) => x.name === this.selected);
                const action = this.resolveActionKey(actionKey, c);
                if (c && action === 'remove' && this.actions?.canRemove(c)) {
                    // A running one is stopped first, after asking.
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    void this.actions.removeOne(c, 'key');
                } else if (c && action && this.actions?.allowed(c).includes(action)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    void this.actions.run(action, c, { via: 'key' });
                }
                return;
            }

            if (e.key !== 'Escape') return;
            if (menuOrModalOpen) return;
            if (typing) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.multi.size) {
                this.clearChecked();
                return;
            }
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
            this.usageEnabled = Boolean(containersBody?.usageEnabled);
            this._checkedAt = updatesBody?.checkedAt || null;
        } else {
            this.containers = [];
            this.usageEnabled = false;
            this._checkedAt = null;
        }
        // A sort on CPU or RAM means nothing while the sampler is off.
        if (!this.usageEnabled && DashboardDocker.USAGE_SORTS.has(this.sort)) {
            this.sort = 'name';
            this.sortDir = 'asc';
        }
        this.mountShell();
        this.render();
        this.syncNavBadge();
    }

    /** Re-reads the container list only, for polling and the post-check refresh. */
    async refreshContainers() {
        if (!this.status?.socket) return;
        // Only the newest read is applied: a slow answer that arrives after a
        // later one would put an older list back.
        const seq = (this._listSeq || 0) + 1;
        this._listSeq = seq;
        this._listInflight = true;
        const body = await dockerFetchJSON('/api/docker/containers');
        if (seq !== this._listSeq) return;
        this._listInflight = false;
        // A read that failed -- a timeout, a restart, the daemon answering
        // "not available" -- keeps the list on screen rather than emptying it
        // (and closing the drawer of a container that is still there).
        if (!body || body.available === false || !Array.isArray(body.containers)) return;
        this.containers = body.containers;
        this.usageEnabled = Boolean(body.usageEnabled);
        this.render();
        this.syncNavBadge();
    }

    /** The header icon's count, from the list this view has just read. */
    syncNavBadge() {
        void this.dash.docker?.updateNavBadge?.(this.filterCount('updates'));
    }

    startPolling() {
        this.stopPolling();
        this._pollTimer = setInterval(() => {
            if (document.visibilityState !== 'visible' || !this.isActiveView()) return;
            // A read still on its way is not doubled by the next tick.
            if (this._listInflight) return;
            void this.refreshContainers();
        }, this.refreshMs());
    }

    /** Config -> Containers: 2, 5, 10 or 30 seconds, 5 when unset. */
    refreshMs() {
        const seconds = Number(this.dash.settings?.dockerRefreshSeconds);
        return ([2, 5, 10, 30].includes(seconds) ? seconds : 5) * 1000;
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
        // A check asks a registry per image and takes seconds; the overlay says
        // it is working, then what it found.
        const overlay = window.ProgressOverlay;
        overlay?.show?.(
            this.t('dashboard.dockerCheckingTitle', 'Checking for updates'),
            this.t('dashboard.dockerCheckingStatus', 'Asking the registries about {count} containers…',
                { count: this.containers.length }));
        try {
            const res = await window.nextDashFetch('/api/docker/updates/check', { method: 'POST' });
            if (!res.ok) throw new Error('check failed');
            const body = await res.json().catch(() => null);
            this._checkedAt = body?.checkedAt || Date.now();
            await this.refreshContainers();
            const found = this.containers.filter((c) => c.update?.status === 'available').length;
            overlay?.finish?.(found
                ? this.t('dashboard.dockerCheckFound', '{count} updates available', { count: found })
                : this.t('dashboard.dockerCheckNone', 'Everything is up to date'));
        } catch {
            overlay?.hide?.();
            window.AppNotification?.show?.(this.t('dashboard.dockerCheckFailed', 'Could not check for updates'), 'error');
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
            summary: this.shellSummary(),
        };
    }

    /**
     * The rail's figures, the way Health and Inbox fill the same space: what
     * runs, what is waiting for an update, what is not well.
     */
    shellSummary() {
        const list = this.containers || [];
        const running = list.filter((c) => c.state === 'running').length;
        const updates = list.filter((c) => c.update?.status === 'available').length;
        const unhealthy = list.filter((c) => c.health === 'unhealthy').length;
        return [
            { key: 'running', label: this.t('dashboard.dockerSummaryRunning', 'Running'),
                value: `${running} / ${list.length}`, tone: running === list.length ? 'good' : '' },
            { key: 'updates', label: this.t('dashboard.dockerSummaryUpdates', 'Updates'),
                value: String(updates), tone: updates ? 'warn' : '' },
            { key: 'unhealthy', label: this.t('dashboard.dockerSummaryUnhealthy', 'Unhealthy'),
                value: String(unhealthy), tone: unhealthy ? 'bad' : '' },
            ...(this.diskTotals && window.DockerDisk ? [
                { key: 'disk', label: this.t('dashboard.dockerSummaryDisk', 'Disk used'),
                    value: window.DockerDisk.formatBytes(this.diskTotals.images + this.diskTotals.volumes + this.diskTotals.buildCache) },
                { key: 'reclaimable', label: this.t('dashboard.dockerSummaryReclaimable', 'Reclaimable'),
                    value: window.DockerDisk.formatBytes(this.diskTotals.reclaimable) },
            ] : []),
        ];
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
        this.shell.toolbar.parentNode?.insertBefore(this.buildTabs(), this.shell.toolbar);
        this.buildToolbar(this.shell.toolbar);
        this.buildHeaderActions(this.shell.headerActions);
        // The side panel is the shared one (list-view-drawer.js): a host on
        // <body>, placed below the page header, fullscreen on a phone.
        this.drawer = new window.DockerDrawer(this);
        this.drawerHost = this.drawer.base.mount();
        this.drawerHost.classList.add('docker-drawer-host');
        return this.shell;
    }

    _destroyShell() {
        this.drawer?.close();
        this.drawer?.base.destroy();
        this.drawer = null;
        this.shell?.destroy?.();
        this.shell = null;
        this.drawerHost = null;
        // It lived inside the shell's root, and went with it.
        this._bulkBar = null;
    }

    applyFilter(key, via) {
        this.filter = key || 'all';
        this.persistViewState();
        void via; // tracked nowhere yet; kept for parity with the shell's callback shape
        this.render();
    }

    /* ── Tabs: Containers | Disk ───────────────────────────────────────── */

    buildTabs() {
        const bar = document.createElement('div');
        bar.className = 'docker-tabs';
        bar.setAttribute('role', 'tablist');
        [['containers', this.t('dashboard.dockerTabContainers', 'Containers')],
            ['disk', this.t('dashboard.dockerTabDisk', 'Disk')]].forEach(([key, label]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'docker-tab';
            b.setAttribute('role', 'tab');
            b.setAttribute('data-docker-tab', key);
            b.textContent = label;
            b.addEventListener('click', () => this.showTab(key));
            bar.appendChild(b);
        });
        this.tabsEl = bar;
        this.syncTabs();
        return bar;
    }

    syncTabs() {
        this.tabsEl?.querySelectorAll('[data-docker-tab]').forEach((b) => {
            b.setAttribute('aria-selected', String(b.getAttribute('data-docker-tab') === this.tab));
        });
    }

    showTab(tab) {
        const next = tab === 'disk' ? 'disk' : 'containers';
        if (next === 'disk') {
            if (typeof window.DockerDisk !== 'function') return;
            this.disk = this.disk || new window.DockerDisk(this);
            if (this.selected) {
                this.selected = null;
                this.drawer?.close();
                this.drawerOpen = false;
            }
        }
        this.tab = next;
        this.restoreDockerHash();
        this.render();
        if (next === 'disk') this.disk.ensureLoaded();
    }

    /** The Disk tab measured: its totals join the rail. */
    onDiskMeasured(totals) {
        this.diskTotals = totals;
        this.shell?.setSummary?.(this.shellSummary());
    }

    /* ── Toolbar ───────────────────────────────────────────────────────── */

    buildToolbar(host) {
        const searchLabel = this.escape(this.t('dashboard.dockerSearchPlaceholder', 'Search containers'));
        const sortOptions = [
            ['name', this.t('dashboard.dockerSortName', 'name')],
            ['status', this.t('dashboard.dockerSortStatus', 'status')],
            ['uptime', this.t('dashboard.dockerSortUptime', 'uptime')],
            ...(this.usageEnabled ? [
                ['cpu', this.t('dashboard.dockerSortCpu', 'CPU')],
                ['mem', this.t('dashboard.dockerSortMem', 'memory')],
            ] : []),
        ].map(([value, label]) => `<option value="${value}">${this.escape(label)}</option>`).join('');
        host.innerHTML = `
            <input type="search" data-docker-search value="${this.escape(this.query)}"
                   placeholder="${searchLabel}" autocomplete="off" spellcheck="false" aria-label="${searchLabel}">
            <select data-docker-sort aria-label="${this.escape(this.t('dashboard.dockerSortLabel', 'Sort containers'))}">${sortOptions}</select>
            <select data-docker-group aria-label="${this.escape(this.t('dashboard.dockerGroupLabel', 'Group containers'))}">
                <option value="none">${this.escape(this.t('dashboard.dockerGroupNone', 'no groups'))}</option>
                <option value="project">${this.escape(this.t('dashboard.dockerGroupByProject', 'by project'))}</option>
                <option value="status">${this.escape(this.t('dashboard.dockerGroupByStatus', 'by status'))}</option>
                <option value="network">${this.escape(this.t('dashboard.dockerGroupByNetwork', 'by network'))}</option>
                <option value="image">${this.escape(this.t('dashboard.dockerGroupByImage', 'by image'))}</option>
            </select>
            <button type="button" class="lvs-action" data-docker-check>${this.escape(this.t('dashboard.dockerCheckUpdates', 'Check for updates'))}</button>
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
            this.sortDir = DashboardDocker.defaultSortDir(this.sort);
            this.persistViewState();
            this.render();
        });

        host.querySelector('[data-docker-group]')?.addEventListener('change', (e) => {
            this.group = e.target.value || 'none';
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
        const groupSelect = host.querySelector('[data-docker-group]');
        if (groupSelect && groupSelect.value !== this.group) groupSelect.value = this.group;
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

    /**
     * A web UI address as the table links it: [IP] made this host, and a
     * label -- ":port" when it is on this host, else the host without www.
     */
    static webuiLink(raw, container) {
        const href = window.DockerSearchIndex.webuiHref(raw, container);
        if (!href) return null;
        let url;
        try {
            url = new URL(href);
        } catch {
            return null;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const local = url.hostname === window.DockerSearchIndex.hostAddress();
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        return { href, label: local ? `:${port}` : url.host.replace(/^www\./, '') };
    }

    /**
     * The first published TCP port, as a link, for a container with no web UI
     * address: the row menu's Web UI did this already. UDP is no web page.
     */
    static portLink(container) {
        const port = window.DockerSearchIndex.firstWebPort(container);
        if (!port) return null;
        const href = window.DockerSearchIndex.portHref(port.public);
        return href ? { href, label: `:${port.public}`, port: true } : null;
    }

    /* ── Filtering, sorting, grouping ──────────────────────────────────── */

    matchesFilter(c) {
        if (this.filter === 'running') return c.state === 'running';
        if (this.filter === 'stopped') return DashboardDocker.STOPPED_STATES.has(c.state);
        if (this.filter === 'updates') return c.update?.status === 'available';
        return true;
    }

    compareFn() {
        if (DashboardDocker.USAGE_SORTS.has(this.sort)) {
            // Turning the order round never moves a container without a
            // reading (stopped, or not sampled yet) above one that has it.
            const key = this.sort;
            const sign = this.sortDir === 'desc' ? -1 : 1;
            return (a, b) => {
                const va = a.usage?.[key];
                const vb = b.usage?.[key];
                if (va == null || vb == null) return (va == null) - (vb == null) || a.name.localeCompare(b.name);
                return sign * (va - vb) || a.name.localeCompare(b.name);
            };
        }
        const cmp = this.baseCompareFn();
        return this.sortDir === 'desc' ? (a, b) => cmp(b, a) : cmp;
    }

    /** The direction a sort starts in: usage highest first, the rest A to Z. */
    static defaultSortDir(key) {
        return DashboardDocker.USAGE_SORTS.has(key) ? 'desc' : 'asc';
    }

    /** An image without its registry host and a :latest tag, as a person
     *  reads it: lscr.io/linuxserver/sonarr:latest is linuxserver/sonarr. */
    static shortImage(image) {
        let s = String(image || '');
        const parts = s.split('/');
        if (parts.length > 1 && /[.:]|^localhost$/.test(parts[0])) s = parts.slice(1).join('/');
        return s.replace(/:latest$/, '');
    }

    /** The explainer's paragraphs, the English the locale files translate. */
    static HELP = {
        list: 'Every container on the Docker host, filtered from the rail and grouped by status or compose project. The glow is its state; an orange ↑ before the name means an update is waiting. CPU and RAM are the last reading, Size is what the container wrote, and the link opens its web UI.',
        actions: 'Its menu or a key starts, stops, restarts, pauses, updates or removes it: s, r, p, u and ⌫. Tick several with x to do the same to all of them at once. Acting needs NEXTDASH_DOCKER_CONTROL=1, and nextDash never stops its own container.',
        panel: 'Enter or a click opens a container: its health, updates, timeline, network, volumes and a web address of your own, with an hour of CPU and memory under Resources. l opens its logs window.',
        updates: 'Check for updates compares each image with what its registry offers and shows what changed. You can skip a version, hold a container, or roll the last update back while the old image is still on the host.',
        disk: 'd switches to Disk: what images, volumes and the build cache take up, and what nothing uses. It lists the host folders containers mount too. Every clean-up asks first, and a volume goes only one at a time.',
    };

    /** The groupings the list offers besides none. */
    static GROUPS = ['project', 'status', 'network', 'image'];

    /** How many published ports a row shows before "+N". */
    static PORTS_SHOWN = 3;

    static formatCpu(pct) {
        return Number.isFinite(pct) ? `${pct.toFixed(1)} %` : '—';
    }

    /** A container's writable layer, or — before it was first measured. */
    static formatSize(size) {
        return size ? window.NextDashBytes.formatBytes(size.rw) : '—';
    }

    /** "24 MiB written · 568 MiB with its image". */
    static sizeTitle(size, t) {
        return t('dashboard.dockerSizeTitle', '{written} written · {total} with its image', {
            written: window.NextDashBytes.formatBytes(size.rw),
            total: window.NextDashBytes.formatBytes(size.rootFs),
        });
    }

    static formatMem(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '—';
        const mib = bytes / (1024 * 1024);
        return mib < 1024 ? `${Math.round(mib)} MiB` : `${(mib / 1024).toFixed(1)} GiB`;
    }

    /**
     * A click on a sortable heading sorts by its column; a second click on the
     * same heading turns the order round. The toolbar select follows.
     */
    sortByHeading(key, headKey) {
        if (this.sort === key) {
            this.sortDir = this.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            this.sort = key;
            this.sortDir = DashboardDocker.defaultSortDir(key);
        }
        this.persistViewState();
        this.syncToolbar();
        this.render();
        // The table was rebuilt; keep the keyboard on the heading it used.
        this.shell?.body?.querySelector(`[data-docker-sort-head="${headKey}"]`)?.focus();
    }

    /** 'ascending', 'descending', or '' when the table is not sorted by this heading. */
    headingSortState(key) {
        if (this.sort !== key) return '';
        return this.sortDir === 'desc' ? 'descending' : 'ascending';
    }

    baseCompareFn() {
        if (this.sort === 'status') {
            return (a, b) => (DashboardDocker.SORT_RANK[a.state] ?? 3) - (DashboardDocker.SORT_RANK[b.state] ?? 3)
                || a.name.localeCompare(b.name);
        }
        if (this.sort === 'uptime') {
            // Longest up first, by when it last started (not when it was
            // created); a container that is not up has no uptime and goes last.
            const started = (c) => c.startedAt || Infinity;
            return (a, b) => started(a) - started(b) || a.name.localeCompare(b.name);
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
        this.shell.setSummary?.(this.shellSummary());
        this.shell.setCounts({
            all: this.filterCount('all'),
            running: this.filterCount('running'),
            stopped: this.filterCount('stopped'),
            updates: this.filterCount('updates'),
        });
        this.syncToolbar();
        this.syncBulkBar();

        const body = this.shell.body;
        body.replaceChildren();
        this.syncTabs();
        if (this.tabsEl) this.tabsEl.hidden = !this.status?.socket;
        if (!this.status?.socket) {
            body.appendChild(this.buildSetupCard());
            return;
        }
        // Disk: the same element each time, so a poll's render keeps its scroll
        // and what it has measured.
        this.shell.toolbar.hidden = this.tab === 'disk';
        if (this.tab === 'disk' && this.disk) {
            if (this.status.control === false) body.appendChild(this.buildReadOnlyLine());
            body.appendChild(this.disk.element());
            return;
        }
        // Config → Containers: the key legend above the list (where it always
        // stood), below it, or off -- the choices Bookmarks and Inbox offer.
        const legendAt = this.dash.settings?.dockerViewKeyLegend || 'above';
        const legend = legendAt === 'off' ? null : this.buildLegend({ control: this.status.control !== false });
        if (this.status.control === false) body.appendChild(this.buildReadOnlyLine());
        if (this.showsHostHint()) body.appendChild(this.buildHostHint());
        if (legend && legendAt !== 'below') body.appendChild(legend);
        body.appendChild(this.buildTable());
        if (legend && legendAt === 'below') {
            legend.classList.add('is-below');
            body.appendChild(legend);
        }
    }

    /** The row keys, as <kbd> chips; the keys stay untranslated, the labels do not. */
    /** Every key of the view; read-only leaves out the ones that act on Docker. */
    buildLegend({ control = true } = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'docker-legend';
        [
            ['↑ / ↓', this.t('dashboard.dockerLegendMove', 'move')],
            ['Enter', this.t('dashboard.dockerLegendOpen', 'details')],
            ['/', this.t('dashboard.dockerLegendSearch', 'search')],
            ['x', this.t('dashboard.dockerLegendSelect', 'select')],
            ...(control ? [
                ['s', this.t('dashboard.dockerLegendRun', 'start / stop')],
                ['r', this.t('dashboard.dockerLegendRestart', 'restart')],
                ['p', this.t('dashboard.dockerLegendPause', 'pause')],
                ['u', this.t('dashboard.dockerLegendUpdate', 'update')],
                ['⌫', this.t('dashboard.dockerLegendRemove', 'remove')],
            ] : []),
            ['l', this.t('dashboard.dockerLegendLogs', 'logs')],
            ['m', this.t('dashboard.dockerLegendMute', 'mute')],
            ['d', this.t('dashboard.dockerLegendDisk', 'disk')],
        ].forEach(([key, label]) => {
            const item = document.createElement('span');
            item.className = 'docker-legend-item';
            const kbd = document.createElement('kbd');
            kbd.textContent = key;
            const text = document.createElement('span');
            text.textContent = label;
            item.append(kbd, text);
            wrap.appendChild(item);
        });
        return wrap;
    }

    /* ── The selection bar ──────────────────────────────────────────────
     * The grid's and Inbox's bar (.multi-select-toolbar and its count and
     * buttons, dashboard-multi-select.css), where Inbox puts its own: under
     * the toolbar row, outside the body. Outside because a poll repaints the
     * body every few seconds, and a bar rebuilt with it would take the
     * keyboard off the button it was on -- so it is built once and updated
     * in place. */

    /** Ticked containers the list shows: what the bar's buttons act on. */
    checkedContainers() {
        return this.filteredSortedContainers().filter((c) => this.multi.has(c.name));
    }

    buildBulkBar() {
        const bar = document.createElement('div');
        bar.className = 'multi-select-toolbar docker-bulk';
        bar.setAttribute('data-docker-bulk', '');
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', this.t('dashboard.multiSelectToolbarAria', 'Selection actions'));
        const count = document.createElement('span');
        count.className = 'multi-select-count';
        count.setAttribute('data-docker-bulk-count', '');
        bar.appendChild(count);
        ['select-all', 'start', 'stop', 'restart', 'update', 'remove', 'mute', 'clear'].forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = action === 'remove' ? 'multi-select-btn danger' : 'multi-select-btn';
            btn.setAttribute('data-docker-bulk-action', action);
            if (['start', 'stop', 'restart', 'update', 'remove'].includes(action)) {
                btn.textContent = this.actions?.label(action) || action;
            }
            if (action === 'clear') {
                btn.textContent = this.t('dashboard.inboxSelectionClear', 'Clear selection');
            }
            btn.addEventListener('click', () => { void this.runBulkAction(action); });
            bar.appendChild(btn);
        });
        return bar;
    }

    /** Show, hide and relabel the bar for what is ticked now. */
    syncBulkBar() {
        const row = this.shell?.toolbarRow;
        if (!row) return;
        const picked = this.checkedContainers();
        let bar = this._bulkBar;
        if (this.tab !== 'containers' || !this.status?.socket || !picked.length) {
            if (bar) bar.hidden = true;
            return;
        }
        if (!bar || !bar.isConnected) {
            bar = this.buildBulkBar();
            row.after(bar);
            this._bulkBar = bar;
        }
        bar.hidden = false;
        bar.toggleAttribute('aria-busy', this.bulkRunning);
        bar.querySelector('[data-docker-bulk-count]').textContent = this.t(
            'dashboard.dockerBulkSelected', '{count} selected', { count: picked.length });
        const visible = this.filteredSortedContainers();
        const button = (action) => bar.querySelector(`[data-docker-bulk-action="${action}"]`);
        // The same toggle Ctrl/Cmd+A is, so the label says which way it goes.
        button('select-all').textContent = visible.every((c) => this.multi.has(c.name))
            ? this.t('dashboard.inboxDeselectAll', 'Deselect all')
            : this.t('dashboard.unsortedSelectAll', 'Select all');
        // Start, stop, restart, update and remove are Docker's, and only there while
        // control is on -- the gate the drawer's buttons and the row keys
        // answer to (allowed() is empty without it). Mute is a setting of
        // nextDash's own, so it stays in read-only.
        const control = this.status.control === true;
        ['start', 'stop', 'restart', 'update', 'remove'].forEach((action) => {
            const btn = button(action);
            btn.hidden = !control;
            // Remove takes running ones too, stopping them first.
            const can = action === 'remove'
                ? (c) => this.actions?.canRemove(c)
                : (c) => this.actions?.allowed(c).includes(action);
            btn.disabled = this.bulkRunning || !picked.some(can);
        });
        // Mute while any of them still sends notices, else unmute; the
        // container that is nextDash has no notices to mute.
        const mutable = picked.filter((c) => !c.self);
        const muting = mutable.some((c) => !this.actions?.isMuted(c));
        const mute = button('mute');
        mute.textContent = muting || !mutable.length
            ? this.t('dashboard.dockerMenuMute', 'Mute notifications')
            : this.t('dashboard.dockerMenuUnmute', 'Unmute notifications');
        mute.disabled = this.bulkRunning || !mutable.length;
        button('select-all').disabled = this.bulkRunning;
        button('clear').disabled = this.bulkRunning;
    }

    setBulkRunning(on) {
        this.bulkRunning = Boolean(on);
        this.syncBulkBar();
    }

    async runBulkAction(action) {
        if (this.bulkRunning) return;
        if (action === 'select-all') {
            this.checkAllVisible();
            return;
        }
        if (action === 'clear') {
            this.clearChecked();
            return;
        }
        const picked = this.checkedContainers();
        if (action === 'mute') {
            const mutable = picked.filter((c) => !c.self);
            const muting = mutable.some((c) => !this.actions?.isMuted(c));
            this.setBulkRunning(true);
            try {
                await this.actions?.setMuted(mutable, muting, { via: 'bulk' });
            } finally {
                this.setBulkRunning(false);
            }
            this.drawerRefresh?.();
            return;
        }
        await this.actions?.runBulk(action, picked, { via: 'bulk' });
    }

    /** s and p toggle: the same key starts a stopped container and stops a running one. */
    resolveActionKey(key, c) {
        if (!c) return null;
        if (key === 'toggle-run') return c.state === 'running' || c.state === 'paused' ? 'stop' : 'start';
        if (key === 'toggle-pause') return c.state === 'paused' ? 'unpause' : 'pause';
        return key;
    }

    setBusy(name, phase) {
        if (phase) this.busy.set(name, phase);
        else this.busy.delete(name);
        this.render();
    }

    /** After an action: the drawer shows the container as it now is, or closes if it is gone. */
    drawerRefresh() {
        if (!this.drawerOpen || !this.selected) return;
        const c = this.containers.find((x) => x.name === this.selected);
        if (!c) {
            this.closeDrawer();
            return;
        }
        this.drawer?.open(c);
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

    /*
     * Port links go to the host this page was opened on, unless Config →
     * Containers names the Docker host. Opened through a reverse proxy or any
     * name other than the server's own, dash.example.com:8080 goes nowhere,
     * and the page cannot tell which case it is in. So while the address is
     * not set, the view says where port links point, with the way to set it,
     * until it is set or the note is put away.
     */
    static HOST_HINT_KEY = 'nextdash.docker.hostHintDismissed';

    static hostAddressUnset(settings) {
        return !String(settings?.dockerHostAddress || '').trim();
    }

    showsHostHint() {
        if (!DashboardDocker.hostAddressUnset(this.dash.settings)) return false;
        try {
            if (localStorage.getItem(DashboardDocker.HOST_HINT_KEY) === '1') return false;
        } catch {
            // No storage: the note shows, and its Dismiss hides it for this visit.
            if (this._hostHintDismissed) return false;
        }
        // Only when a link in the table is built on that host.
        return this.containers.some((c) => !c.lanIP
            && (String(c.webui || '').includes('[IP]') || (!c.webui && DashboardDocker.portLink(c))));
    }

    buildHostHint() {
        const p = document.createElement('p');
        p.setAttribute('data-docker-host-hint', '');
        p.className = 'docker-readonly docker-host-hint';
        const text = document.createElement('span');
        text.textContent = this.t('dashboard.dockerHostHint',
            'Port links point at {host}. If your containers run on another address, set the Docker host address.',
            { host: window.location.hostname });
        const set = document.createElement('button');
        set.type = 'button';
        set.className = 'config-btn config-btn--small';
        set.setAttribute('data-docker-host-hint-set', '');
        set.textContent = this.t('dashboard.dockerHostHintSet', 'Set host address');
        set.addEventListener('click', () => { void this.openHostAddressSetting(); });
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'config-btn config-btn--small';
        dismiss.setAttribute('data-docker-host-hint-dismiss', '');
        dismiss.textContent = this.t('dashboard.dockerHostHintDismiss', 'Dismiss');
        dismiss.addEventListener('click', () => {
            this._hostHintDismissed = true;
            try {
                localStorage.setItem(DashboardDocker.HOST_HINT_KEY, '1');
            } catch {
                // Kept for this visit only.
            }
            p.remove();
        });
        p.append(text, set, dismiss);
        return p;
    }

    /** Config → Containers, with the host address field focused. */
    async openHostAddressSetting() {
        const config = this.dash.config;
        if (!config?.openConfigView) return;
        await config.openConfigView('containers');
        const entry = config.filterSettingsJumpEntries?.('host address')
            ?.find((e) => e.kind === 'field' && e.field === 'dockerHostAddress');
        if (entry) await config.activateSettingsJumpEntry(entry);
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
        // Column headings, in the order buildRow() lays the cells out; the
        // phone layout folds rows into two lines and hides them (CSS).
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        // Name and Status sort the table (the sort key each one sets is the
        // third entry). The shared sortable heading (list-view-shell.css, as
        // Bookmarks and Inbox draw theirs): the button carries the click, the
        // th data-lvs-sort for the drawn arrow and aria-sort for a reader.
        [
            ['name', this.t('dashboard.dockerColName', 'Name'), 'name'],
            ['image', this.t('dashboard.dockerFieldImage', 'Image')],
            ['state', this.t('dashboard.dockerColStatus', 'Status'), 'status'],
            ...(this.usageEnabled ? [
                ['cpu', this.t('dashboard.dockerColCpu', 'CPU'), 'cpu'],
                ['mem', this.t('dashboard.dockerColMem', 'RAM'), 'mem'],
            ] : []),
            ['size', this.t('dashboard.dockerColSize', 'Size')],
            ['webui', this.t('dashboard.dockerLinkWebUI', 'Web UI')],
            ['ports', this.t('dashboard.dockerColPorts', 'Ports')],
        ].forEach(([key, label, sortKey]) => {
            const th = document.createElement('th');
            th.scope = 'col';
            th.className = `docker-head docker-head--${key} lvs-colhead`;
            if (!sortKey) {
                th.textContent = label;
                headRow.appendChild(th);
                return;
            }
            const state = this.headingSortState(sortKey);
            if (state) {
                th.setAttribute('data-lvs-sort', state);
                th.setAttribute('aria-sort', state);
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lvs-colhead-sort';
            btn.setAttribute('data-docker-sort-head', key);
            btn.textContent = label;
            btn.addEventListener('click', () => this.sortByHeading(sortKey, key));
            th.appendChild(btn);
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        if (DashboardDocker.GROUPS.includes(this.group)) {
            this.appendGroupedRows(tbody, list, headRow.children.length);
        } else {
            list.forEach((c) => tbody.appendChild(this.buildRow(c)));
        }
        table.appendChild(tbody);
        return table;
    }

    /** The logs window for one container; one at a time. */
    openLogs(c) {
        if (typeof window.DockerLogsModal !== 'function') return;
        this.logsModal = this.logsModal || new window.DockerLogsModal(this);
        this.logsModal.open(c);
    }

    /** Which status group a container belongs in; an update outranks its state. */
    statusGroup(c) {
        if (c.update?.status === 'available') return 'updates';
        if (c.state === 'running') return 'running';
        if (c.state === 'paused') return 'paused';
        return 'stopped';
    }

    /**
     * Start, stop and restart for a compose project's group row: the bulk
     * path over the stack's rows as shown, so a filter narrows it the way it
     * narrows a selection. Update stays with the selection bar.
     */
    buildStackActions(stack) {
        const wrap = document.createElement('span');
        wrap.className = 'docker-stack-actions';
        ['start', 'stop', 'restart'].forEach((action) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'docker-action-btn';
            btn.setAttribute('data-docker-stack-action', action);
            btn.textContent = this.actions?.label(action) || action;
            btn.disabled = !stack.some((c) => this.actions?.allowed(c).includes(action));
            btn.addEventListener('click', async () => {
                await this.actions?.runBulk(action, stack, { via: 'row' });
            });
            wrap.appendChild(btn);
        });
        // Update takes only what has an update waiting: not a skipped or held
        // version, not an image no check has looked at. runBulk asks once,
        // naming them, and updates them one at a time.
        const waiting = stack.filter((c) => c.update?.status === 'available'
            && this.actions?.allowed(c).includes('update'));
        const update = document.createElement('button');
        update.type = 'button';
        update.className = 'docker-action-btn';
        update.setAttribute('data-docker-stack-action', 'update');
        update.textContent = `${this.actions?.label('update') || 'Update'} (${waiting.length})`;
        update.title = this.t('dashboard.dockerStackUpdateHint', 'Update the containers in this stack that have an update waiting');
        update.disabled = !waiting.length;
        update.addEventListener('click', async () => {
            await this.actions?.runBulk('update', waiting, { via: 'row' });
        });
        wrap.appendChild(update);
        return wrap;
    }

    /**
     * Grouped by compose project (project-less last) or by status (updates,
     * running, paused, stopped -- the order that needs attention first).
     */
    appendGroupedRows(tbody, list, columns) {
        const byStatus = this.group === 'status';
        const byProject = this.group === 'project';
        // What each grouping keys a container on; '' is the "none" band, last.
        const keyOf = {
            status: (c) => this.statusGroup(c),
            project: (c) => c.composeProject || '',
            network: (c) => c.network || '',
            image: (c) => DashboardDocker.shortImage(String(c.image || '').replace(/@sha256:.*$/, '')).replace(/:[^/:]+$/, ''),
        }[this.group];
        const groups = new Map();
        list.forEach((c) => {
            const key = keyOf(c);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(c);
        });
        let keys;
        if (byStatus) {
            keys = ['updates', 'running', 'paused', 'stopped'].filter((k) => groups.has(k));
        } else {
            keys = [...groups.keys()].filter((k) => k !== '').sort((a, b) => a.localeCompare(b));
            if (groups.has('')) keys.push('');
        }
        const statusLabels = {
            updates: this.t('dashboard.dockerFilterUpdates', 'Updates'),
            running: this.t('dashboard.dockerFilterRunning', 'Running'),
            paused: this.t('dashboard.dockerGroupPaused', 'Paused'),
            stopped: this.t('dashboard.dockerFilterStopped', 'Stopped'),
        };
        keys.forEach((key) => {
            const heading = document.createElement('tr');
            heading.className = 'docker-group-row';
            if (byStatus) heading.setAttribute('data-docker-group-status', key);
            else if (key && byProject) heading.setAttribute('data-docker-group-project', key);
            else if (key) heading.setAttribute(`data-docker-group-${this.group}`, key);
            const cell = document.createElement('td');
            // Across every column the heading row has, so a column added
            // later (Size was) cannot leave the band short of the right edge.
            cell.colSpan = columns || 1;
            const label = document.createElement('span');
            const none = {
                network: this.t('dashboard.dockerNoNetwork', 'No network'),
                image: this.t('dashboard.dockerNoImage', 'No image'),
            }[this.group] || this.t('dashboard.dockerNoProject', 'No project');
            label.textContent = byStatus ? statusLabels[key] : (key || none);
            cell.appendChild(label);
            const count = document.createElement('span');
            count.className = 'docker-group-count';
            count.setAttribute('data-docker-group-count', '');
            count.textContent = ` · ${groups.get(key).length}`;
            cell.appendChild(count);
            if (byProject && key && this.status.control) cell.appendChild(this.buildStackActions(groups.get(key)));
            heading.appendChild(cell);
            tbody.appendChild(heading);
            groups.get(key).forEach((c) => tbody.appendChild(this.buildRow(c)));
        });
    }

    /** A published port as a link to it on this host. */
    portLink(port, text) {
        const a = document.createElement('a');
        a.className = 'docker-port';
        a.href = window.DockerSearchIndex.portHref(port);
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = text || String(port);
        return a;
    }

    /**
     * The first three published ports, then "+N" for the rest in a popover,
     * so a container that publishes many keeps its row one line. A port
     * published for tcp and udp counts once here; the popover names both.
     */
    fillPorts(cell, c) {
        const published = (c.ports || []).filter((p) => p && p.public);
        const unique = [...new Set(published.map((p) => p.public))];
        unique.slice(0, DashboardDocker.PORTS_SHOWN).forEach((port) => cell.appendChild(this.portLink(port)));
        const rest = unique.length - DashboardDocker.PORTS_SHOWN;
        if (rest <= 0) return;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'docker-ports-more';
        more.setAttribute('data-docker-ports-more', '');
        more.setAttribute('aria-expanded', 'false');
        more.textContent = `+${rest}`;
        more.title = this.t('dashboard.dockerPortsAll', 'All {count} ports', { count: unique.length });
        const pop = document.createElement('div');
        pop.className = 'docker-ports-pop';
        pop.setAttribute('data-docker-ports-pop', '');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', more.title);
        pop.hidden = true;
        const seen = new Set();
        published.forEach((p) => {
            const key = `${p.public}/${p.type || 'tcp'}`;
            if (seen.has(key)) return;
            seen.add(key);
            const line = document.createElement('div');
            line.className = 'docker-ports-pop-line';
            const into = document.createElement('span');
            into.className = 'docker-ports-pop-private';
            into.textContent = `→ ${p.private}/${p.type || 'tcp'}`;
            line.append(this.portLink(p.public), into);
            pop.appendChild(line);
        });
        const close = () => {
            pop.hidden = true;
            more.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', outside, true);
            window.removeEventListener('keydown', onKey, true);
        };
        const outside = (e) => { if (!cell.contains(e.target)) close(); };
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            close();
            more.focus();
        };
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!pop.hidden) { close(); return; }
            pop.hidden = false;
            more.setAttribute('aria-expanded', 'true');
            document.addEventListener('pointerdown', outside, true);
            // On window, in capture: ahead of the view's own Escape, which
            // would otherwise leave the view along with the popover.
            window.addEventListener('keydown', onKey, true);
        });
        cell.append(more, pop);
    }

    buildRow(c) {
        const tr = document.createElement('tr');
        tr.className = 'docker-row';
        tr.setAttribute('data-docker-row', c.name);
        tr.setAttribute('data-state', c.state || '');
        // What the row's glow says, in the shared vocabulary (list-view-shell.css);
        // data-docker-* stay for the specs and the view's own rules.
        const group = this.statusGroup(c);
        tr.setAttribute('data-docker-status', group);
        tr.setAttribute('data-lvs-status', { updates: 'info', running: 'good', paused: 'warn', stopped: 'bad' }[group] || 'muted');
        if (c.self) {
            tr.setAttribute('data-docker-self', '');
            tr.setAttribute('data-lvs-self', '');
        }
        const checked = this.multi.has(c.name);
        tr.setAttribute('aria-selected', String(this.selected === c.name || checked));
        tr.classList.toggle('is-checked', checked);
        const busy = this.busy.get(c.name);
        if (busy) {
            tr.setAttribute('data-docker-busy', busy);
            tr.setAttribute('data-lvs-busy', '');
            tr.setAttribute('aria-busy', 'true');
        }
        tr.tabIndex = -1;

        const nameCell = document.createElement('td');
        nameCell.className = 'docker-cell docker-cell--name';
        nameCell.appendChild(this.buildTick(c, checked));
        // An update is an arrow ahead of the name, not a pill after it: the
        // names keep one left edge and the row one line.
        if (c.update?.status === 'available') {
            const badge = document.createElement('span');
            badge.setAttribute('data-docker-update-badge', '');
            badge.className = 'docker-update-mark';
            badge.textContent = '↑';
            const label = this.t('dashboard.dockerUpdateBadgeTitle', 'Update available');
            badge.title = label;
            badge.setAttribute('aria-label', label);
            nameCell.appendChild(badge);
        }
        const nameText = document.createElement('span');
        nameText.className = 'docker-name';
        nameText.textContent = c.name;
        nameText.title = c.name;
        nameCell.appendChild(nameText);
        if (c.update?.held) {
            const held = document.createElement('span');
            held.setAttribute('data-docker-held-badge', '');
            held.className = 'docker-badge docker-badge--held';
            held.textContent = this.t('dashboard.dockerHeldBadge', 'held');
            held.title = this.t('dashboard.dockerHeldHint', 'Updates are held for this image');
            nameCell.appendChild(held);
        }
        tr.appendChild(nameCell);

        const imageCell = document.createElement('td');
        imageCell.className = 'docker-cell docker-cell--image';
        imageCell.textContent = DashboardDocker.shortImage(c.image);
        if (c.image) imageCell.title = c.image;
        tr.appendChild(imageCell);

        const stateCell = document.createElement('td');
        stateCell.className = 'docker-cell docker-cell--state';
        stateCell.textContent = busy ? this.phaseText(busy) : (c.status || c.state || '');
        tr.appendChild(stateCell);

        // The stats sampler's last reading (every 30 s), when it is on.
        if (this.usageEnabled) {
            const cpuCell = document.createElement('td');
            cpuCell.className = 'docker-cell docker-cell--cpu docker-cell--num';
            cpuCell.textContent = DashboardDocker.formatCpu(c.usage?.cpu);
            const memCell = document.createElement('td');
            memCell.className = 'docker-cell docker-cell--mem docker-cell--num';
            memCell.textContent = DashboardDocker.formatMem(c.usage?.mem);
            tr.append(cpuCell, memCell);
        }

        // What the container wrote, measured in the background every half
        // hour (docker_sizes.go); with its image on hover, as `docker ps -s`.
        const sizeCell = document.createElement('td');
        sizeCell.className = 'docker-cell docker-cell--size docker-cell--num';
        sizeCell.textContent = DashboardDocker.formatSize(c.size);
        if (c.size) sizeCell.title = DashboardDocker.sizeTitle(c.size, (key, fallback, params) => this.t(key, fallback, params));
        tr.appendChild(sizeCell);

        /*
         * The web UI in a column of its own -- the address set in the drawer's
         * Custom section, else the template's, the one the drawer's button and
         * `:docker <name> open` go to. Its own column so a long host cannot
         * push the ports out of line: cut to the column's width, the whole
         * address on hover.
         */
        const webuiCell = document.createElement('td');
        webuiCell.className = 'docker-cell docker-cell--webui';
        const webui = DashboardDocker.webuiLink(c.webui, c) || DashboardDocker.portLink(c);
        if (webui) {
            const a = document.createElement('a');
            a.className = 'docker-port docker-webui';
            a.setAttribute('data-docker-webui', '');
            if (webui.port) a.setAttribute('data-docker-webui-port', '');
            a.href = webui.href;
            a.title = webui.href;
            // Your own address carries a dot, as the side panel tags it Custom.
            if (!webui.port && c.webuiCustom) {
                a.classList.add('is-custom');
                a.setAttribute('data-docker-webui-custom', '');
                a.title = `${webui.href} · ${this.t('dashboard.dockerSectionCustom', 'Custom')}`;
            }
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = webui.label;
            webuiCell.appendChild(a);
        }
        tr.appendChild(webuiCell);

        const portsCell = document.createElement('td');
        portsCell.className = 'docker-cell docker-cell--ports';
        this.fillPorts(portsCell, c);
        tr.appendChild(portsCell);

        // Phone-width second line (image + the web UI, else the first public
        // port); CSS hides it at desktop and shows it, in place of the
        // image/ports cells, below 768px.
        const line2 = document.createElement('div');
        line2.className = 'docker-row-line2';
        const firstPort = (c.ports || []).find((p) => p && p.public);
        line2.textContent = [c.image || '', webui ? webui.label : (firstPort ? String(firstPort.public) : '')]
            .filter(Boolean).join(' · ');
        tr.appendChild(line2);

        // Right-click opens the row's menu at the cursor, the way a bookmark
        // or health row answers the mouse. Shift keeps the browser's own menu.
        tr.addEventListener('contextmenu', (e) => {
            if (e.shiftKey || this.dash.isModalOpen?.()) return;
            e.preventDefault();
            e.stopPropagation();
            this.menu?.open(c, { x: e.clientX, y: e.clientY });
        });

        tr.addEventListener('click', (e) => {
            // A port link and the tick handle their own click.
            if (e.target.closest('a, .docker-tick, .docker-ports-more, .docker-ports-pop')) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey) {
                this.toggleMulti(c.name, { range: e.shiftKey });
                return;
            }
            if (this.multi.size) this.multi.clear();
            this._multiAnchor = c.name;
            this.selectContainer(c.name, { openDrawer: true });
        });
        return tr;
    }

    /**
     * The row's tick, inside the name cell rather than a column of its own,
     * the way Inbox's sits in its row's first line: out of sight until the
     * pointer, the focus or a live selection asks for it (docker-view.css).
     * Shift-click ticks the run from the last one ticked.
     */
    buildTick(c, checked) {
        const label = document.createElement('label');
        label.className = 'docker-tick';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'docker-tick-input';
        box.setAttribute('data-docker-tick', c.name);
        box.checked = checked;
        box.setAttribute('aria-label', this.t('dashboard.dockerSelectRow', 'Select {name}', { name: c.name }));
        // change carries no modifier state, so Shift is read on click.
        let shiftHeld = false;
        box.addEventListener('click', (e) => { shiftHeld = e.shiftKey; });
        box.addEventListener('change', () => {
            if (shiftHeld && this._multiAnchor && this._multiAnchor !== c.name) {
                this.extendCheckedTo(c.name);
            } else {
                this.setChecked(c.name, box.checked);
            }
            shiftHeld = false;
        });
        label.addEventListener('click', (e) => e.stopPropagation());
        label.appendChild(box);
        return label;
    }

    phaseText(phase) {
        const phases = {
            pulling: ['dockerPhasePulling', 'pulling…'],
            recreating: ['dockerPhaseRecreating', 'recreating…'],
        };
        const [key, fallback] = phases[phase] || ['dockerPhaseWorking', 'working…'];
        return this.t(`dashboard.${key}`, fallback);
    }

    /**
     * Cmd/Ctrl-click adds or drops one row; Shift-click takes the range from
     * the last plain click. The row already open in the drawer counts as the
     * first pick, so "click one, Cmd-click another" selects both.
     */
    toggleMulti(name, { range = false } = {}) {
        if (!this.multi.size && this.selected) this.multi.add(this.selected);
        if (range && this._multiAnchor) {
            this.extendCheckedTo(name);
            return;
        }
        this._multiAnchor = this._multiAnchor || name;
        this.setChecked(name, !this.multi.has(name));
    }

    /** Tick or untick one row, and make it the fixed end of the next range. */
    setChecked(name, on) {
        if (!name) return;
        if (on) this.multi.add(name);
        else this.multi.delete(name);
        this._multiAnchor = name;
        this.afterCheckChange();
    }

    toggleChecked(name) {
        this.setChecked(name, !this.multi.has(name));
    }

    /**
     * Tick every row from the last one ticked to `name`, in the order the
     * list shows. Without an anchor there is no range, so it ticks the one.
     */
    extendCheckedTo(name) {
        const rows = this.filteredSortedContainers().map((c) => c.name);
        const a = rows.indexOf(this._multiAnchor);
        const b = rows.indexOf(name);
        if (a < 0 || b < 0) {
            this.setChecked(name, true);
            return;
        }
        rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((n) => this.multi.add(n));
        this.afterCheckChange();
    }

    /**
     * Shift+↑/↓: the keyboard's Shift-click. The row it starts on is ticked
     * first, then everything up to the one it moves to; no wrap at either
     * end, so one keystroke at the top cannot tick the whole list.
     */
    extendCheckedByKey(delta) {
        if (this.selected && !this.multi.has(this._multiAnchor)) {
            this._multiAnchor = this.selected;
            this.multi.add(this.selected);
        }
        this.moveRowSelection(delta, { wrap: false });
        if (!this._multiAnchor) this._multiAnchor = this.selected;
        const anchor = this._multiAnchor;
        this.extendCheckedTo(this.selected);
        this._multiAnchor = anchor;
    }

    /**
     * Tick every row the filter shows, or clear them when they are all
     * ticked already -- so the same chord undoes itself. Only what is shown:
     * ticking rows nobody can see would arm the bar over a selection nobody
     * made.
     */
    checkAllVisible() {
        const visible = this.filteredSortedContainers();
        if (!visible.length) return;
        const all = visible.every((c) => this.multi.has(c.name));
        visible.forEach((c) => (all ? this.multi.delete(c.name) : this.multi.add(c.name)));
        this.afterCheckChange();
    }

    clearChecked() {
        if (!this.multi.size) return;
        this.multi.clear();
        this._multiAnchor = null;
        this.render();
    }

    afterCheckChange() {
        // Two or more picked is a selection to act on, not one container to
        // read: the drawer steps aside so the bulk bar is reachable.
        if (this.multi.size >= 2 && this.drawerOpen) {
            this.drawer?.close();
            this.drawerOpen = false;
        }
        this.render();
    }

    /* ── Selection and the drawer ─────────────────────────────────────────
     * dashboard-docker-drawer.js's DockerDrawer owns everything inside
     * [data-docker-drawer]; this view only owns the host, when it is open
     * (this.drawerOpen, kept in sync with drawer.isOpen()) and the
     * #docker/<name> address. */

    selectContainer(name, { openDrawer = true, section = null } = {}) {
        if (name === DashboardDocker.DISK_ADDRESS) {
            this.showTab('disk');
            return;
        }
        // A container asked for by name is on the Containers tab.
        if (name && this.tab !== 'containers') this.tab = 'containers';
        this.selected = name || null;
        this.restoreDockerHash();
        this.render();
        if (this.selected && openDrawer) {
            const c = this.containers.find((x) => x.name === this.selected) || { name: this.selected };
            this.drawer?.open(c);
            if (section) this.drawer?.openSection?.(section);
            // Logs asked for by name (the row menu, :docker <name> logs) open
            // the logs window over the drawer's Logs tab.
            if (section === 'logs') this.openLogs(c);
        } else if (!this.selected) {
            this.drawer?.close();
        }
        this.drawerOpen = Boolean(this.drawer?.isOpen());
    }

    closeDrawer() {
        this.drawer?.close();
        this.drawerOpen = false;
        this.selected = null;
        this.restoreDockerHash();
        this.render();
    }

    _closeDrawerState() {
        this.drawer?.close();
        this.selected = null;
        this.drawerOpen = false;
    }

    /** ↑/↓: moves the highlighted row and, if the drawer is already open,
     * what it shows — without this, arrowing past the open container would
     * leave the drawer pointed at a row that no longer looks selected. */
    moveRowSelection(delta, { wrap = true } = {}) {
        const rows = this.filteredSortedContainers();
        if (!rows.length) return;
        let idx = rows.findIndex((c) => c.name === this.selected);
        if (idx < 0) idx = delta > 0 ? 0 : rows.length - 1;
        else if (wrap) idx = (idx + delta + rows.length) % rows.length;
        else idx = Math.max(0, Math.min(rows.length - 1, idx + delta));
        this.selectContainer(rows[idx].name, { openDrawer: this.drawerOpen });
        this.focusRow(rows[idx].name);
    }

    focusRow(name) {
        this.shell?.body?.querySelector(`[data-docker-row="${CSS.escape(name)}"]`)?.focus({ preventScroll: false });
    }

    escape(text) {
        return this.dash.escapeHtml ? this.dash.escapeHtml(text) : String(text || '');
    }
}

window.DashboardDocker = DashboardDocker;
