/**
 * Health view — bookmark health as a dashboard view, modelled on DashboardInbox.
 */
class DashboardHealth {
    static VIEW = 'health';

    /** Worst first. Mirrors statusRank in health.js so both surfaces agree. */
    static STATUS_RANK = {
        broken: 0,
        duplicate: 1,
        'shortcut-conflict': 2,
        unchecked: 3,
        stale: 4,
        unused: 5,
        'missing-preview': 6,
        healthy: 7,
    };

    constructor(dashboard) {
        this.dash = dashboard;
        this.report = null;
        this.loading = false;
        this.filter = 'broken';
        this.sort = 'score';
        this.searchQuery = '';
        this.visibleLimit = 50;
        this.selectedKey = null;
        /** Deep-link target from `?hv_id=` — applied after the feed renders. */
        this.focusIssueKey = null;
        this.expandedScores = new Set();
        this._searchRenderTimer = null;
        this._searchFocusPending = false;
        this._loadPromise = null;
        this._loadPromiseRefresh = false;
        this._busyKeys = new Set();
        this._loadMoreObserver = null;
        this._outsideMenuHandler = null;
        this._monitorRefreshTimer = null;
        this._visibilityHandler = null;
        this._openBrokenRunning = false;
        this._mergeRunning = false;
    }

    isEnabled() {
        return this.dash.settings?.healthViewEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardHealth.VIEW;
    }

    /**
     * Report a health interaction. The existing calls in this file already use
     * the 'health:' prefix inline; this exists for the ones that carry props,
     * so filter/sort ids stay in one place. Both are fixed enums — the search
     * box is deliberately never reported, since a query is free text.
     */
    _trackAction(action, extra) {
        window.nextdashTrack?.('health:' + action, extra);
    }

    /**
     * `key` is the full dotted key ('dashboard.healthOpen'). formatDashboardLabel
     * adds the 'dashboard.' prefix itself, so it gets the bare tail — passing the
     * full key there yields 'dashboard.dashboard.…' and renders the raw key.
     */
    t(key, fallback, params) {
        const d = this.dash;
        if (params && typeof d.formatDashboardLabel === 'function') {
            const bare = String(key).startsWith('dashboard.') ? String(key).slice('dashboard.'.length) : key;
            const text = d.formatDashboardLabel(bare, params, fallback);
            if (text && text !== bare && text !== key) {
                return text;
            }
            // No translation: interpolate the fallback here rather than return the key.
            return Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(fallback || '')
            );
        }
        const raw = d.language?.t?.(key);
        return raw && raw !== key ? raw : fallback;
    }

    escape(text) {
        return this.dash.escapeHtml ? this.dash.escapeHtml(text) : String(text || '');
    }

    reasonEntries(issue) {
        return window.HealthReasonUtils.getIssueReasonEntries(this.dash.language, issue);
    }

    scoreClass(score) {
        return window.HealthReasonUtils.scoreClass(score);
    }

    bandClass(score) {
        return `health-view-band-${this.scoreClass(score)}`;
    }

    /** Stable identity for a row across re-renders: page + index. */
    issueKey(issue) {
        return `${issue.pageId}:${issue.index}`;
    }

    /**
     * Resolve a stored icon to a loadable src. Icons are bare filenames served
     * from /data/icons/ (matching the dashboard rows in dashboard-bookmark-rows.js);
     * absolute URLs and root-relative paths are left as-is. Returns '' when there
     * is no icon. Without the /data/icons/ prefix a bare filename would be
     * requested from the site root, producing confusing 404s in the console.
     */
    resolveIssueIconSrc(icon) {
        const value = String(icon || '').trim();
        if (!value) {
            return '';
        }
        if (/^(https?:|data:|\/)/i.test(value)) {
            return value;
        }
        return `/data/icons/${encodeURIComponent(value)}`;
    }

    formatUrlDisplay(url) {
        try {
            const parsed = new URL(url);
            const path = parsed.pathname + parsed.search;
            const compact = parsed.host + (path && path !== '/' ? path : '');
            return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
        } catch {
            const raw = String(url || '');
            return raw.length > 72 ? `${raw.slice(0, 69)}…` : raw;
        }
    }

    /* ── Data ──────────────────────────────────────────────────────────── */

    /**
     * In-flight requests are shared rather than queued. Health actions each
     * refresh the report, and a burst of them (retest, then a re-check, then a
     * merge) would otherwise stack identical fetches — the pattern that made the
     * old page loop.
     *
     * A refresh request must not join a plain fetch: the server would answer
     * from cache and the caller would still see stale rows. Plain callers may
     * join an in-flight refresh — that result is at least as fresh.
     */
    fetchReport({ refresh = false } = {}) {
        if (this._loadPromise) {
            if (refresh && !this._loadPromiseRefresh) {
                return this._loadPromise.finally(() => this.fetchReport({ refresh: true }));
            }
            return this._loadPromise;
        }
        this._loadPromiseRefresh = refresh;
        const url = refresh ? '/api/bookmark-health?refresh=1' : '/api/bookmark-health';
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        this._loadPromise = fetcher(url)
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`health HTTP ${res.status}`);
                }
                return res.json();
            })
            .then((data) => {
                this.report = data || null;
                return this.report;
            })
            .finally(() => {
                this._loadPromise = null;
                this._loadPromiseRefresh = false;
            });
        return this._loadPromise;
    }

    async loadAndRender({ refresh = false } = {}) {
        this.loading = !this.report;
        if (this.loading) {
            this.render();
        }
        try {
            await this.fetchReport({ refresh });
        } catch {
            this.report = null;
        } finally {
            this.loading = false;
        }
        if (this.focusIssueKey) {
            this.prepareIssueFocus(this.focusIssueKey);
        }
        this.render();
    }

    async refreshBadge() {
        try {
            await this.fetchReport();
        } catch {
            return;
        }
        this.dash.updateHealthBadge?.();
    }

    brokenCount() {
        return Number(this.report?.summary?.brokenCount) || 0;
    }

    /** Share of bookmarks with no active issue (0–100). Shown in the header badge. */
    healthyPercent() {
        const summary = this.report?.summary || {};
        const total = Number(summary.totalBookmarks) || 0;
        const healthy = Number(summary.healthyCount) || 0;
        if (!total) {
            return 100;
        }
        return Math.round((healthy / total) * 100);
    }

    /** Mean row score — matches the 0–100 semantics used on each bookmark row. */
    averageHeaderScore() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        if (!issues.length) {
            return 100;
        }
        const total = issues.reduce((sum, issue) => sum + (Number(issue?.score) || 0), 0);
        return Math.round(total / issues.length);
    }

    duplicateGroups() {
        return Array.isArray(this.report?.duplicateGroups) ? this.report.duplicateGroups : [];
    }

    startLiveRefresh() {
        this.stopLiveRefresh();
        if (!this.isActiveView()) {
            return;
        }
        this._visibilityHandler = () => {
            if (document.visibilityState !== 'visible' || !this.isActiveView()) {
                return;
            }
            if (this.filter === 'monitored') {
                void this.loadAndRender({ refresh: true });
            }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
        if (this.filter === 'monitored') {
            this._monitorRefreshTimer = setInterval(() => {
                if (!this.isActiveView() || this.filter !== 'monitored') {
                    return;
                }
                if (document.visibilityState !== 'visible') {
                    return;
                }
                void this.loadAndRender({ refresh: true });
            }, 60000);
        }
    }

    stopLiveRefresh() {
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._monitorRefreshTimer) {
            clearInterval(this._monitorRefreshTimer);
            this._monitorRefreshTimer = null;
        }
    }

    /* ── View lifecycle ────────────────────────────────────────────────── */

    restoreHealthHash() {
        if (window.location.hash !== '#health') {
            history.replaceState(
                history.state,
                '',
                `${window.location.pathname}${window.location.search}#health`
            );
        }
    }

    restoreViewIfNeeded() {
        if (!this.isActiveView() || !this.isEnabled()) {
            return;
        }
        this.restoreHealthHash();
        this.dash.pageNav?.setActiveHealthTab?.();
        const container = document.getElementById('dashboard-layout');
        if (!container?.classList.contains('health-layout')) {
            void this.loadAndRender();
        }
    }

    async openHealthView() {
        const d = this.dash;
        if (!this.isEnabled()) {
            return false;
        }
        if (d.activeView === DashboardHealth.VIEW) {
            return true;
        }
        if (d.isInlineEditActive() && !(await d.confirmInlineEditBeforeNavigation())) {
            return false;
        }
        d._abortInlineEditForRender?.();
        d.keyboardNavigation?.clearSelection?.({ restoreFocus: false });
        d.inbox?.clearKeyboardSelection?.();
        this.clearKeyboardSelection();
        d.setActiveView(DashboardHealth.VIEW);
        window.nextdashTrack?.('view:health');
        d.pageNav?.setActiveHealthTab?.();
        d.pageNav?.updateDocumentTitle?.();
        const { refresh } = this.restoreViewState();
        await this.loadAndRender({ refresh });
        this.restoreHealthHash();
        this.syncUrlState();
        this.startLiveRefresh();
        return true;
    }

    closeHealthView() {
        const d = this.dash;
        if (d.activeView !== DashboardHealth.VIEW) {
            return false;
        }
        this.stopLiveRefresh();
        this.unbindOutsideMenuDismiss();
        this._teardownLoadMoreObserver();
        this.clearKeyboardSelection();
        this.focusIssueKey = null;
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
            if (e.key !== 'Escape') return;
            if (d.activeView !== DashboardHealth.VIEW) return;
            // An open menu takes Escape first: closing the whole view when the user
            // only meant to dismiss a menu loses their place in the list.
            const openMenu = document.querySelector('.health-view-menu:not([hidden])');
            if (openMenu) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.closeAllMenus();
                this.focusMenuOwner(openMenu);
                return;
            }
            if (window.DashboardTagCloud?.modalOpen) return;
            if (d.isModalOpen()) return;
            if (d.searchComponent?.isActive()) return;
            if (d.isInlineEditActive()) return;
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            this.closeHealthView();
        };
        document.addEventListener('keydown', this._escapeHandler, true);
    }

    /* ── Filtering ─────────────────────────────────────────────────────── */

    matchesFilter(issue, filter) {
        switch (filter) {
            case 'all':
                return true;
            case 'broken':
                return issue.status === 'broken';
            case 'duplicate':
                return (Number(issue.duplicateCount) || 0) > 1;
            case 'unchecked':
                return !issue.lastChecked;
            case 'monitored':
                return issue.monitor === true;
            // stale / unused / missing-preview / shortcut-conflict / healthy reach
            // this view through deep links and filter pills. Each maps to a single
            // issue.status, so match on that rather than falling through
            // to `return true`, which showed every issue under a filter that lit no
            // pill.
            case 'stale':
            case 'unused':
            case 'missing-preview':
            case 'shortcut-conflict':
            case 'healthy':
                return issue.status === filter;
            default:
                return true;
        }
    }

    matchesQuery(issue, query) {
        if (!query) return true;
        const haystack = [issue.name, issue.url, issue.pageName, issue.category]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return haystack.includes(query);
    }

    statusRank(issue) {
        return DashboardHealth.STATUS_RANK[issue?.status] ?? 99;
    }

    sortIssues(issues) {
        const sorted = [...issues];
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
        switch (this.sort) {
            case 'last-checked':
                return sorted.sort((a, b) => (a.lastChecked || 0) - (b.lastChecked || 0));
            case 'last-checked-desc':
                return sorted.sort((a, b) => (b.lastChecked || 0) - (a.lastChecked || 0));
            case 'status':
                return sorted.sort((a, b) => this.statusRank(a) - this.statusRank(b) || byName(a, b));
            case 'name':
                return sorted.sort(byName);
            case 'score':
            default:
                // Worst score first, then worst status, then name — a stable order
                // so a re-render never reshuffles rows under the cursor.
                return sorted.sort((a, b) => (a.score || 0) - (b.score || 0)
                    || this.statusRank(a) - this.statusRank(b)
                    || byName(a, b));
        }
    }

    getFilteredIssues() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        const query = String(this.searchQuery || '').trim().toLowerCase();
        return this.sortIssues(
            issues
                .filter((issue) => this.matchesFilter(issue, this.filter))
                .filter((issue) => this.matchesQuery(issue, query))
        );
    }

    filterCount(filter) {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        return issues.filter((issue) => this.matchesFilter(issue, filter)).length;
    }

    /**
     * Monitored bookmarks that are unreachable right now.
     *
     * downSince is the server's own record of an open outage (0 while up), so
     * this reports what monitoring currently sees rather than re-deriving it
     * from sample history — a row that recovered a minute ago must not still
     * count as down.
     *
     * A monitor awaiting its first check has no stats and is not counted: it is
     * unknown rather than failing, and turning the tile red for it would cry
     * wolf on every freshly-enabled monitor.
     */
    monitorsDownCount() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        return issues.filter((issue) => issue.monitor === true
            && Number(issue.monitorStats?.downSince) > 0).length;
    }

    /* ── Keyboard ──────────────────────────────────────────────────────── */

    getVisibleRows() {
        return Array.from(document.querySelectorAll('.health-view-feed .health-view-item'));
    }

    selectRowByKey(key) {
        const next = String(key || '').trim();
        if (!next) return;
        this.selectedKey = next;
        this.focusIssueKey = next;
        this.applyKeyboardSelection();
        this.syncUrlState();
    }

    moveKeyboardSelection(delta, rows) {
        const filtered = this.getFilteredIssues();
        if (!filtered.length) return;
        let index = this.selectedKey
            ? filtered.findIndex((issue) => this.issueKey(issue) === this.selectedKey)
            : -1;
        if (index < 0) {
            index = delta > 0 ? 0 : filtered.length - 1;
        } else {
            index += delta;
            if (index < 0) index = filtered.length - 1;
            else if (index >= filtered.length) index = 0;
        }
        const needed = index + 1;
        if (needed > this.visibleLimit) {
            this.selectedKey = this.issueKey(filtered[index]);
            this.focusIssueKey = this.selectedKey;
            this.visibleLimit = Math.min(filtered.length, needed + 5);
            this.render();
            return;
        }
        this.selectedKey = this.issueKey(filtered[index]);
        this.focusIssueKey = this.selectedKey;
        this.applyKeyboardSelection(rows);
        this.syncUrlState();
    }

    applyKeyboardSelection(rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getVisibleRows();
        list.forEach((row) => {
            const selected = row.dataset.healthKey === this.selectedKey;
            row.classList.toggle('keyboard-selected', selected);
            row.setAttribute('aria-selected', selected ? 'true' : 'false');
            if (selected) {
                row.scrollIntoView({
                    block: 'nearest',
                    behavior: document.body?.classList.contains('no-animations') ? 'instant' : 'smooth',
                });
            }
        });
    }

    clearKeyboardSelection() {
        this.selectedKey = null;
        this.unbindPointerNavigation();
        this.closeAllMenus();
        if (this._outsideMenuHandler) {
            document.removeEventListener('click', this._outsideMenuHandler, true);
            this._outsideMenuHandler = null;
        }
        document.querySelectorAll('.health-view-item.keyboard-selected').forEach((row) => {
            row.classList.remove('keyboard-selected');
            row.setAttribute('aria-selected', 'false');
        });
    }

    syncKeyboardSelectionAfterRender() {
        if (document.activeElement?.classList?.contains('health-view-search-input')) {
            return;
        }
        const rows = this.getVisibleRows();
        if (!this.selectedKey || !rows.some((row) => row.dataset.healthKey === this.selectedKey)) {
            this.selectedKey = null;
        }
        this.applyKeyboardSelection(rows);
    }

    selectedIssue() {
        if (!this.selectedKey) return null;
        return this.getFilteredIssues().find((issue) => this.issueKey(issue) === this.selectedKey) || null;
    }

    handleKeyboardNavigation(e) {
        const d = this.dash;
        if (!this.isActiveView() || !this.isEnabled()) return false;
        if (window.DashboardTagCloud?.modalOpen) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (d.isInlineEditActive?.()) return false;
        if (e.ctrlKey || e.altKey || e.metaKey) return false;

        const target = e.target;
        const tag = target?.tagName;
        const isSearch = target?.classList?.contains('health-view-search-input');
        const listNavKeys = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
            if (!isSearch || !listNavKeys.has(e.key)) {
                return false;
            }
        }

        // A key pressed while focus sits on a row control (the score button, an
        // action) belongs to that control — without this, Enter on the score
        // badge would also fire the row's open action.
        const onRowControl = Boolean(
            target?.closest?.('.health-view-item')
            && target?.matches?.('button, a, input, select')
        );

        // While a menu is open it owns the arrows: they walk its items, not the rows
        // hidden behind it. Escape is handled by the escape shortcut.
        const openMenu = document.querySelector('.health-view-menu:not([hidden])');
        if (openMenu) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            const items = Array.from(openMenu.querySelectorAll('.health-view-menu-item'));
            if (!items.length) return true;
            const current = items.indexOf(document.activeElement);
            const delta = e.key === 'ArrowDown' ? 1 : -1;
            const next = current < 0
                ? (delta > 0 ? 0 : items.length - 1)
                : (current + delta + items.length) % items.length;
            items[next].focus({ preventScroll: true });
            return true;
        }

        if ((e.key === 'R' || e.key === 'r' || e.key === '?') && !onRowControl && !isSearch) {
            e.preventDefault();
            e.stopImmediatePropagation();
            void this.refreshReportFromKeyboard();
            return true;
        }

        const rows = this.getVisibleRows();
        if (!rows.length) return false;

        if (e.key === 'ArrowDown' || e.key === 'j') {
            if (e.key === 'j' && onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isSearch) target.blur();
            this.moveKeyboardSelection(1, rows);
            return true;
        }
        if (e.key === 'ArrowUp' || e.key === 'k') {
            if (e.key === 'k' && onRowControl) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (isSearch) target.blur();
            this.moveKeyboardSelection(-1, rows);
            return true;
        }
        if (onRowControl) {
            return false;
        }
        if (e.key === 's' && this.selectedKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.toggleScorePanel(this.selectedKey);
            return true;
        }
        if (e.key === 'm' && this.selectedKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.toggleMenu(this.selectedKey, 'more');
            return true;
        }
        if (e.key === 'c' && this.selectedKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.toggleMenu(this.selectedKey, 'check');
            return true;
        }
        if (e.key === 'p' && this.selectedKey) {
            const issue = this.selectedIssue();
            if (issue) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.recheckIssue(issue);
            }
            return true;
        }
        if (e.key === 'i' && this.selectedKey) {
            const issue = this.selectedIssue();
            // Silently ignored on a row with nothing to enlarge, rather than
            // opening an empty modal.
            if (this.hasMonitorStats(issue)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.openMonitorStats(issue);
                return true;
            }
            return false;
        }
        if ((e.key === 'Enter' || e.key === ' ') && this.selectedKey) {
            const issue = this.selectedIssue();
            if (issue) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.openIssue(issue);
            }
            return true;
        }
        if (e.key === 'g' || e.key === 'Home') {
            e.preventDefault();
            e.stopImmediatePropagation();
            const filtered = this.getFilteredIssues();
            this.selectedKey = filtered[0] ? this.issueKey(filtered[0]) : null;
            if (isSearch) target.blur();
            this.applyKeyboardSelection(rows);
            return true;
        }
        if (e.key === 'G' || e.key === 'End') {
            e.preventDefault();
            e.stopImmediatePropagation();
            const filtered = this.getFilteredIssues();
            const lastIndex = filtered.length - 1;
            if (lastIndex >= 0 && lastIndex >= this.visibleLimit) {
                this.selectedKey = this.issueKey(filtered[lastIndex]);
                this.visibleLimit = filtered.length;
                this.render();
                return true;
            }
            this.selectedKey = lastIndex >= 0 ? this.issueKey(filtered[lastIndex]) : null;
            if (isSearch) target.blur();
            this.applyKeyboardSelection(rows);
            return true;
        }
        return false;
    }

    /** A click anywhere outside an open menu dismisses it. */
    bindOutsideMenuDismiss() {
        if (this._outsideMenuHandler) return;
        this._outsideMenuHandler = (e) => {
            if (!this.isActiveView()) return;
            if (!document.querySelector('.health-view-menu:not([hidden])')) return;
            // Both menu wrappers, or a click on an option would dismiss the menu
            // before the option's own handler ever ran.
            if (e.target.closest?.('.health-view-menu-wrap, .health-check-mode-wrap')) return;
            this.closeAllMenus();
        };
        document.addEventListener('click', this._outsideMenuHandler, true);
    }

    unbindOutsideMenuDismiss() {
        if (!this._outsideMenuHandler) {
            return;
        }
        document.removeEventListener('click', this._outsideMenuHandler, true);
        this._outsideMenuHandler = null;
    }

    bindPointerNavigation(container) {
        if (!container) return;
        if (this._pointerContainer === container && this._pointerHandler) return;
        if (this._pointerContainer && this._pointerHandler) {
            this._pointerContainer.removeEventListener('pointerover', this._pointerHandler, true);
        }
        this._pointerContainer = container;
        this._pointerHandler = (e) => {
            if (!this.isActiveView()) return;
            if (e.pointerType && e.pointerType !== 'mouse') return;
            const row = e.target.closest?.('.health-view-item');
            const key = row?.dataset?.healthKey;
            if (!key || key === this.selectedKey) return;
            this.selectRowByKey(key);
        };
        container.addEventListener('pointerover', this._pointerHandler, true);
    }

    unbindPointerNavigation() {
        if (this._pointerContainer && this._pointerHandler) {
            this._pointerContainer.removeEventListener('pointerover', this._pointerHandler, true);
        }
        this._pointerContainer = null;
        this._pointerHandler = null;
    }

    /* ── Score panel ───────────────────────────────────────────────────── */

    toggleScorePanel(key, force) {
        const next = typeof force === 'boolean' ? force : !this.expandedScores.has(key);
        if (next) {
            this.expandedScores.add(key);
        } else {
            this.expandedScores.delete(key);
        }
        this.syncScorePanel(key);
    }

    syncScorePanel(key) {
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
        if (!row) return;
        const panel = row.querySelector('.health-view-score-panel');
        const button = row.querySelector('.health-view-item-score');
        const expanded = this.expandedScores.has(key);
        if (panel) panel.hidden = !expanded;
        button?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    /* ── Actions ───────────────────────────────────────────────────────── */

    /**
     * "Last opened" for one row, always present so the meta line keeps a stable
     * shape rather than gaining and losing a field per row.
     *
     * Never-opened is called out rather than left blank: it is a finding in its
     * own right — the same thing the Stale filter and the score act on — and an
     * empty slot would read as missing data instead.
     */
    renderLastOpened(issue) {
        const { label, title, never } = window.formatLastOpened(issue?.lastOpened, {
            t: (key, fallback, params) => this.t(key, fallback, params),
        });
        const cls = never ? 'health-view-item-opened is-never' : 'health-view-item-opened';
        return `<span class="${cls}" data-health-opened title="${this.escape(title)}">${this.escape(label)}</span>`;
    }

    /**
     * Open the bookmark, and record that it happened.
     *
     * The recording is the point: without it a bookmark opened from here stayed
     * on openCount 0 forever, so Health went on calling a link you actually use
     * "never opened" — and the Stale filter and the score, which read exactly
     * that, went on believing it. The row was not merely showing a stale label;
     * the data behind it was never written.
     */
    openIssue(issue) {
        const url = String(issue?.url || '').trim();
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
        this.recordIssueOpened(issue);
    }

    /**
     * Persist the open and reflect it in the row straight away.
     *
     * Deliberately does not re-score or re-filter. The score, the Stale filter
     * and the sort order all read openCount and lastOpened, so recomputing them
     * here would let a row drop out of the list you are working through the
     * moment you opened it — the list shifting under your hands mid-task. The
     * timestamp is a fact and updates now; re-ranking waits for the next refresh,
     * which is a deliberate action rather than a side effect of a click.
     */
    recordIssueOpened(issue) {
        if (!issue) return;

        const pageId = Number(issue.pageId);
        const index = Number(issue.index);
        if (Number.isFinite(pageId) && Number.isFinite(index) && index >= 0) {
            // 'health' is a new value for the existing source enum, so Stats can
            // tell an open from here apart from one on the dashboard.
            void this.dash?.analytics?.trackBookmarkOpen?.(pageId, index, 'health');
        }

        issue.lastOpened = Date.now();
        issue.openCount = (Number(issue.openCount) || 0) + 1;
        this.refreshLastOpenedLabel(issue);
    }

    /**
     * Repaint just the one label, not the row: a full re-render would rebuild
     * the action buttons and the menus, dropping focus and closing anything the
     * user had open at the moment they clicked.
     */
    refreshLastOpenedLabel(issue) {
        const key = this.issueKey(issue);
        if (!key) return;
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
        const el = row?.querySelector('[data-health-opened]');
        if (!el) return;

        const { label, title, never } = window.formatLastOpened(issue.lastOpened, {
            t: (k, fallback, params) => this.t(k, fallback, params),
        });
        el.textContent = label;
        el.setAttribute('title', title);
        el.classList.toggle('is-never', never);
    }

    /**
     * Edit the bookmark in the shared bookmark modal, the same form Promote opens.
     *
     * This used to leave the view: it switched page, painted the bookmarks grid
     * and opened the dashboard's inline editor, so every edit cost a round trip
     * back to Health and threw away the filter, search and scroll position on the
     * way. The modal keeps Health underneath — closing it returns you to the row
     * you were on — and refreshes the report afterwards so the row reflects the
     * edit. Falls back to the old deep link when the modal isn't reachable.
     */
    async editIssueInline(issue) {
        this.closeAllMenus();
        const d = this.dash;
        const pageId = Number(issue?.pageId);
        if (!Number.isFinite(pageId)) {
            this.openIssueInConfig(issue);
            return;
        }

        const handler = d.searchComponent?.commandsComponent?.newCommandHandler;
        const bookmark = await this.findBookmarkForIssue(issue, pageId);
        if (handler && bookmark) {
            window.nextdashTrack?.('health:edit');
            handler.openModal({
                mode: 'edit',
                pageId,
                index: bookmark.index,
                bookmark: bookmark.record,
                // The report caches status, name and check mode, so it has to be
                // re-read for the row to agree with what was just saved.
                onSaved: async () => {
                    await this.loadAndRender({ refresh: true });
                    d.updateHealthBadge?.();
                },
            });
            return;
        }

        return this.editIssueViaDeepLink(issue, pageId);
    }

    /**
     * Look up the stored bookmark a health row points at.
     *
     * The row itself carries only what the report kept, so the real record is
     * read from the page. The report can be minutes old, which makes its index
     * the less reliable of the two keys — the URL decides, and the index is only
     * used when it still agrees with it.
     */
    async findBookmarkForIssue(issue, pageId) {
        try {
            const res = await fetch(`/api/bookmarks?page=${pageId}`);
            if (!res.ok) return null;
            const list = await res.json();
            if (!Array.isArray(list)) return null;

            const key = this.canonicalUrl(issue.url);
            let index = Number(issue.index);
            const atIndex = Number.isFinite(index) ? list[index] : null;
            if (!atIndex || this.canonicalUrl(atIndex.url) !== key) {
                index = list.findIndex((b) => this.canonicalUrl(b.url) === key);
            }
            if (index < 0 || !list[index]) return null;
            return { index, record: list[index] };
        } catch {
            return null;
        }
    }

    /** The pre-modal route: switch page and open the dashboard's inline editor. */
    async editIssueViaDeepLink(issue, pageId) {
        const d = this.dash;
        if (typeof d.pageNav?.requestPageNavigation === 'function'
            && typeof d.pageNav?.focusDashboardDeepLinkTarget === 'function') {
            const switched = await d.pageNav.requestPageNavigation(pageId);
            if (switched) {
                const link = {
                    pageId,
                    bookmarkIndex: Number.isFinite(Number(issue.index)) ? Number(issue.index) : null,
                    categoryId: issue.category || null,
                    url: issue.url || null,
                    edit: true,
                };
                // Paint the bookmarks grid after leaving health-layout, then open edit.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        d.pageNav.focusDashboardDeepLinkTarget(link);
                    });
                });
                return;
            }
        }

        if (typeof DashboardDeepLink?.buildDashboardDeepLink === 'function') {
            window.location.href = DashboardDeepLink.buildDashboardDeepLink({
                pageId,
                bookmarkIndex: issue.index,
                categoryId: issue.category || null,
                url: issue.url || null,
                edit: true,
            });
            return;
        }
        this.openIssueInConfig(issue);
    }

    openIssueInConfig(issue) {
        try {
            localStorage.setItem(
                'nextdash_health_open_bookmark',
                JSON.stringify({ pageId: issue.pageId, index: issue.index, url: issue.url })
            );
        } catch { /* config falls back to an unfocused list */ }
        window.location.href = '/config#bookmarks';
    }

    canonicalUrl(url) {
        const raw = String(url || '').trim();
        if (!raw) return '';
        return typeof BookmarkUrlUtils?.canonicalBookmarkURLKey === 'function'
            ? BookmarkUrlUtils.canonicalBookmarkURLKey(raw)
            : raw;
    }

    /**
     * Re-check one bookmark: the server pings on demand (/api/ping), the result is
     * cached for the next report, and the bookmark's own status is persisted.
     * /api/health/retest-all is not a single-bookmark endpoint — it ignores its
     * body and walks every page.
     *
     * Guarded per row: the ping is slow enough that a double press would
     * otherwise fire two requests and race their results.
     */
    async recheckIssue(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        const url = String(issue?.url || '').trim();
        if (!url) return;
        window.nextdashTrack?.('health:recheck');
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;

        const persist = async (status, errorDetail, pingMs, httpStatus) => {
            const cacheURL = this.canonicalUrl(url);
            if (cacheURL) {
                await fetcher('/api/health/cache-scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // The code rides along so a monitored bookmark records the same
                    // shape of sample the scheduler writes.
                    body: JSON.stringify({
                        url: cacheURL,
                        status,
                        pingMs: pingMs || 0,
                        error: errorDetail,
                        code: Number(httpStatus) || 0,
                    }),
                }).catch(() => { /* cache writes are best-effort */ });
            }
            if (Number.isFinite(issue.pageId) && Number.isFinite(issue.index)) {
                await fetcher('/api/health/update-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pageId: issue.pageId,
                        index: issue.index,
                        status,
                        error: status === 'online' ? '' : errorDetail,
                    }),
                });
            }
        };

        try {
            const res = await fetcher(`/api/ping?url=${encodeURIComponent(url)}`);
            if (!res.ok) {
                throw new Error(`ping HTTP ${res.status}`);
            }
            const result = await res.json();
            const status = result.status === 'online' ? 'online' : 'offline';
            const errorDetail = String(result.errorDetail || '').trim()
                || (status === 'online' ? '' : this.t('dashboard.healthPingFailed', 'ping failed'));
            await persist(status, errorDetail, result.ping, result.httpStatus);
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            d.showNotification(
                status === 'online'
                    ? this.t('dashboard.healthRecheckOnline', 'Reachable again')
                    : errorDetail,
                status === 'online' ? 'success' : 'info',
                { duration: 3000 }
            );
        } catch (error) {
            const failDetail = error?.message || this.t('dashboard.healthPingFailed', 'ping failed');
            await persist('offline', failDetail, 0).catch(() => { /* already failing */ });
            await this.loadAndRender({ refresh: true }).catch(() => { /* keep the stale view */ });
            d.showNotification(
                this.t('dashboard.healthRecheckFailed', 'Could not re-check this bookmark'),
                'error'
            );
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    syncRowBusy(key, busy) {
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
        row?.querySelectorAll('.health-view-action-btn, .health-view-menu-item').forEach((btn) => {
            btn.disabled = busy;
        });
    }

    /* ── More actions ──────────────────────────────────────────────────── */

    closeAllMenus() {
        document.querySelectorAll('.health-view-menu').forEach((menu) => {
            menu.hidden = true;
        });
        document.querySelectorAll('[aria-haspopup="menu"]').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    /**
     * The control a menu belongs to. Menus record their own opener rather than
     * assuming it is the ⋯ button, so the check-mode popover — which hangs off the
     * badge in the row meta — returns focus to the right place on Escape.
     */
    menuOwner(menu) {
        const owner = menu?.getAttribute('data-menu-owner');
        const key = menu?.getAttribute('data-menu-for');
        if (!owner || !key) return null;
        return document.querySelector(`[data-menu-toggle="${CSS.escape(key)}"][data-menu-kind="${CSS.escape(owner)}"]`);
    }

    focusMenuOwner(menu) {
        this.menuOwner(menu)?.focus({ preventScroll: true });
    }

    /**
     * Open or close one row menu. `kind` selects which of a row's menus is meant:
     * "more" for the ⋯ overflow, "check" for the check-mode popover.
     */
    toggleMenu(key, kind = 'more') {
        const menu = document.querySelector(
            `.health-view-menu[data-menu-for="${CSS.escape(key)}"][data-menu-owner="${CSS.escape(kind)}"]`
        );
        if (!menu) return;
        const btn = this.menuOwner(menu);
        if (!btn) return;
        const willOpen = menu.hidden;
        this.closeAllMenus();
        if (!willOpen) return;
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelector('.health-view-menu-item')?.focus({ preventScroll: true });
        // Flip above the row when there is no room below.
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            menu.classList.toggle('health-view-menu--up', rect.bottom > window.innerHeight - 8);
        });
    }

    /** Only a broken row can be repaired; the rest would just fail slowly. */
    isHealable(issue) {
        return issue?.status === 'broken' && Boolean(String(issue?.url || '').trim());
    }

    /** Leave the view and land on the bookmark in its own page. */
    openIssueInDashboard(issue) {
        const d = this.dash;
        this.closeAllMenus();
        const pageId = Number(issue?.pageId);
        if (!Number.isFinite(pageId)) return;
        // A deep link rather than a plain page switch: the row may be far down a
        // long page, and the bookmark grid can scroll and flash it into view.
        if (typeof DashboardDeepLink?.buildDashboardDeepLink === 'function') {
            window.location.href = DashboardDeepLink.buildDashboardDeepLink({
                pageId,
                bookmarkIndex: issue.index,
                categoryId: issue.category || null,
                url: issue.url || null,
            });
            return;
        }
        void d.pageNav?.requestPageNavigation?.(pageId);
    }

    openArchive(issue) {
        this.closeAllMenus();
        const url = String(issue?.url || '').trim();
        if (!url) return;
        window.open(`https://web.archive.org/web/*/${url}`, '_blank', 'noopener,noreferrer');
    }

    /**
     * Copy and share, delegated to the dashboard's right-click menu rather than
     * reimplemented here — the share sheet, its clipboard fallback and the rule
     * that a cancelled sheet copies nothing are one behaviour, and a second copy
     * of it would be a second thing to keep in step.
     *
     * No row is passed to the clipboard helper: its flash animation is styled for
     * `.bookmark-link`, which a health row is not, so it would do nothing here.
     * The toast is what confirms the copy either way.
     */
    /**
     * The share entry's label, from the same source the dashboard menu uses so
     * the two cannot describe the same action differently. Falls back to naming
     * the copy, which is what happens when no share sheet exists.
     */
    shareActionLabel() {
        const menu = this.dash.contextMenu;
        if (menu?.shareActionLabel) {
            return menu.shareActionLabel();
        }
        return typeof navigator.share === 'function'
            ? this.t('dashboard.contextMenuShare', 'Share…')
            : this.t('dashboard.contextMenuCopyNameUrl', 'Copy name + URL');
    }

    copyIssueUrl(issue) {
        this.closeAllMenus();
        const url = String(issue?.url || '').trim();
        if (!url) return;
        this.dash.searchComponent?.commandsComponent?._copyUrlToClipboard?.(url);
    }

    async shareIssue(issue) {
        const shareUrl = this.buildIssueShareUrl(issue);
        if (!shareUrl) return;
        const menu = this.dash.contextMenu;
        if (!menu?.shareBookmark) return;

        // navigator.share() must be reached while the click that triggered it is
        // still the browser's active user gesture. closeAllMenus() sets
        // hidden = true on the menu holding the focused button, and hiding the
        // focused element ends that gesture in Safari — the share sheet was then
        // refused and only the clipboard fallback ran. Every other action here
        // closes first because none of them is gesture-gated.
        //
        // Started before the menu closes and awaited after, so the sheet still
        // opens over a menu that is on its way out rather than a stuck one.
        const couldShare = menu.canOpenShareSheet?.();
        const shared = menu.shareBookmark({ name: issue?.name || '', url: shareUrl }, null);
        this.closeAllMenus();
        await shared;

        // A refusal is only discovered by attempting it, and the rows were built
        // while the entry still read "Share…". Repaint so the label matches what
        // the browser will actually do next time rather than repeating a promise
        // it has already broken.
        if (couldShare && menu.canOpenShareSheet?.() === false) {
            this.render();
        }
    }

    async refreshFavicon(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        this.closeAllMenus();
        const d = this.dash;
        const url = String(issue?.url || '').trim();
        const fetchIcon = window.BookmarkPreviewService?.fetchAndUploadFavicon;
        if (!url || typeof fetchIcon !== 'function') {
            d.showNotification(this.t('dashboard.healthFaviconFailed', 'Could not refresh the favicon'), 'error');
            return;
        }
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const iconPath = await fetchIcon(url);
            if (!iconPath) {
                d.showNotification(this.t('dashboard.healthFaviconNone', 'No favicon found for this URL'), 'info');
                return;
            }
            // Read-modify-write the whole page: /api/bookmarks has no per-bookmark
            // PATCH.
            const res = await fetch(`/api/bookmarks?page=${issue.pageId}`);
            if (!res.ok) throw new Error(`load HTTP ${res.status}`);
            const bookmarks = await res.json();
            if (!Array.isArray(bookmarks) || !bookmarks[issue.index]) {
                throw new Error('bookmark not found');
            }
            bookmarks[issue.index].icon = iconPath;
            const save = await fetcher(`/api/bookmarks?page=${issue.pageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bookmarks),
            });
            if (!save.ok) throw new Error(`save HTTP ${save.status}`);
            d.showNotification(this.t('dashboard.healthFaviconDone', 'Favicon updated'), 'success', { duration: 3000 });
            await this.loadAndRender({ refresh: true });
        } catch {
            d.showNotification(this.t('dashboard.healthFaviconFailed', 'Could not refresh the favicon'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    async detectRedirect(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:detect-redirect');
        this.closeAllMenus();
        const d = this.dash;
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetch(
                `/api/health/auto-heal-suggest?pageId=${encodeURIComponent(issue.pageId)}&index=${encodeURIComponent(issue.index)}&redirectOnly=1`
            );
            if (!res.ok) throw new Error(`suggest HTTP ${res.status}`);
            const suggestion = await res.json();
            const redirectUrl = String(suggestion?.redirectUrl || '').trim();
            if (!redirectUrl) {
                d.showNotification(this.t('dashboard.healthNoRedirect', 'No redirect found for this bookmark'), 'info');
                return;
            }
            const apply = await this.confirm(
                this.t('dashboard.healthRedirectTitle', 'Apply redirect?'),
                this.t('dashboard.healthRedirectBody', 'This bookmark redirects to:\n\n{url}', { url: redirectUrl })
            );
            if (!apply) return;

            const applied = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index, newUrl: redirectUrl, refreshTitle: false }),
            });
            if (!applied.ok) throw new Error(`apply HTTP ${applied.status}`);
            const body = await applied.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            // The server pings the replacement before storing it, so a fix that
            // still fails must not be reported as a success.
            const stillBroken = String(body?.lastError || '').trim();
            d.showNotification(
                stillBroken
                    ? this.t('dashboard.healthRedirectStillBroken', 'URL updated, but it still fails: {error}', { error: stillBroken })
                    : this.t('dashboard.healthRedirectDone', 'URL updated and reachable'),
                stillBroken ? 'info' : 'success',
                { duration: 4000 }
            );
        } catch {
            d.showNotification(this.t('dashboard.healthRedirectFailed', 'Could not detect a redirect'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    async refreshTitle(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:refresh-title');
        this.closeAllMenus();
        const d = this.dash;
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index, refreshTitle: true }),
            });
            if (!res.ok) throw new Error(`title HTTP ${res.status}`);
            await this.loadAndRender({ refresh: true });
            d.showNotification(this.t('dashboard.healthTitleDone', 'Title refreshed'), 'success', { duration: 3000 });
        } catch {
            d.showNotification(this.t('dashboard.healthTitleFailed', 'Could not refresh the title'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    async deleteIssue(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:delete');
        this.closeAllMenus();
        const d = this.dash;
        const name = issue.name || issue.url || 'bookmark';
        const confirmed = await this.confirm(
            this.t('dashboard.healthDelete', 'Delete bookmark'),
            this.t('dashboard.healthDeleteConfirm', 'Delete "{name}" from your dashboard?', { name }),
            { danger: true }
        );
        if (!confirmed) return;

        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/delete-bookmark', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index }),
            });
            if (!res.ok) throw new Error(`delete HTTP ${res.status}`);
            this.selectedKey = null;

            // Keep the dashboard grid in step with the delete rather than leaving
            // it to a page reload. The health view deletes through its own
            // endpoint and never touched the dashboard's in-memory arrays, so the
            // bookmark lingered on the grid — and in smart collections — until the
            // page was reloaded. Match on page + URL, drop the page cache
            // loadBookmarks() reads through, and re-render.
            d.removeBookmarkByUrl?.(issue.pageId, issue.url);
            d.data?.invalidatePageDataCache?.(Number(issue.pageId));
            void d.data?.fetchAndStoreDataRevision?.();
            d.renderDashboard?.({ incremental: false });

            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            d.showNotification(this.t('dashboard.healthDeleted', 'Bookmark deleted'), 'success', { duration: 3000 });
        } catch {
            d.showNotification(this.t('dashboard.healthDeleteFailed', 'Could not delete the bookmark'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /**
     * Switch one bookmark between off, periodic and monitor without leaving the
     * view. The old route was a deep link into the dashboard inline editor, which
     * threw away the filter, search, scroll position and keyboard selection —
     * expensive for what is a one-field change.
     *
     * The URL rides along with the index: the report can be a few minutes old, so
     * the server rejects the write (409) when the row no longer describes the
     * bookmark at that index, and the reload below picks up the real list.
     */
    async setCheckMode(issue, mode) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        if (!mode || mode === this.checkModeOf(issue)) {
            this.closeAllMenus();
            return;
        }
        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return;

        this.closeAllMenus();
        window.nextdashTrack?.('health:check-mode');
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const d = this.dash;

        try {
            // The write, the stale handling and the wording come from CheckMode,
            // shared with the dashboard right-click menu. Only the refresh below
            // is view-specific: a stale row and a changed row both need the report
            // re-fetched, which is what makes the list agree with the server again.
            const outcome = await window.CheckMode?.apply({
                pageId,
                index: issue.index,
                url,
                mode,
                name: issue.name || url,
            });
            if (outcome === 'failed') return;

            // Push the new mode into the dashboard's own copies before the
            // report reloads. The health report and the dashboard's bookmark
            // arrays are separate caches: refreshing the report alone left the
            // dashboard acting on the pre-change mode until a hard reload, so
            // returning to it and checking the bookmark used the old setting.
            if (outcome === 'changed') {
                window.CheckMode?.syncLocalCopies?.({ pageId, url, mode });
            }

            await this.loadAndRender({ refresh: true });
            if (outcome === 'changed') {
                // Repaint the rows so a status dot that depends on the mode is
                // correct the moment the view is closed, not on next render.
                d.renderDashboard?.({ incremental: false });
                d.updateHealthBadge?.();
            }
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /** AppModal.confirm when it exists, window.confirm as the fallback. */
    async confirm(title, message, { danger = false, confirmText = null } = {}) {
        if (typeof window.AppModal?.confirm === 'function') {
            return Boolean(await window.AppModal.confirm({
                title: title || '',
                message,
                confirmText: confirmText || (danger
                    ? this.t('dashboard.healthDeleteAction', 'Delete')
                    : this.t('dashboard.healthConfirmAction', 'Confirm')),
                cancelText: this.t('dashboard.healthCancel', 'Cancel'),
                confirmClass: danger ? 'danger' : '',
            }));
        }
        return window.confirm(message);
    }

    /* ── Feed paging (page scroll) ─────────────────────────────────────── */

    _resetFeedPaging() {
        this.visibleLimit = 50;
    }

    _teardownLoadMoreObserver() {
        this._loadMoreObserver?.disconnect?.();
        this._loadMoreObserver = null;
    }

    /**
     * Loads the next page of rows when the sentinel nears the viewport. Uses
     * the document scroll — no nested feed scrollbar.
     */
    _bindLoadMoreObserver(sentinel, filteredLength) {
        this._teardownLoadMoreObserver();
        if (!sentinel || this.visibleLimit >= filteredLength) return;

        if (typeof IntersectionObserver !== 'function') {
            return;
        }

        this._loadMoreObserver = new IntersectionObserver((entries) => {
            if (!this.isActiveView()) return;
            if (!entries.some((entry) => entry.isIntersecting)) return;
            const total = this.getFilteredIssues().length;
            if (this.visibleLimit >= total) {
                this._teardownLoadMoreObserver();
                return;
            }
            this.visibleLimit = Math.min(total, this.visibleLimit + 50);
            this.render();
        }, { root: null, rootMargin: '320px 0px' });
        this._loadMoreObserver.observe(sentinel);
    }

    _appendLoadMoreFallback(container, filteredLength) {
        if (this.visibleLimit >= filteredLength) return;
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'health-view-load-more-btn';
        const remaining = filteredLength - this.visibleLimit;
        more.textContent = this.t('dashboard.healthLoadMore', 'Show {count} more', { count: remaining });
        more.addEventListener('click', () => {
            this.visibleLimit = Math.min(filteredLength, this.visibleLimit + 50);
            this.render();
        });
        container.appendChild(more);
    }

    /* ── Render ────────────────────────────────────────────────────────── */

    scheduleSearchRender() {
        if (this._searchRenderTimer) {
            clearTimeout(this._searchRenderTimer);
        }
        this._searchRenderTimer = setTimeout(() => {
            this._searchRenderTimer = null;
            this.focusIssueKey = null;
            this.syncUrlState();
            this.render();
        }, 80);
    }

    /**
     * Adjust filter/search/limit so `key` will appear in the next render.
     * Returns false when the issue does not exist.
     */
    prepareIssueFocus(key) {
        const id = String(key || '').trim();
        if (!id || !/^\d+:\d+$/.test(id)) {
            return false;
        }
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        if (!issues.some((issue) => this.issueKey(issue) === id)) {
            return false;
        }

        this.searchQuery = '';
        let filtered = this.getFilteredIssues();
        let index = filtered.findIndex((issue) => this.issueKey(issue) === id);
        if (index < 0) {
            this.filter = 'all';
            filtered = this.getFilteredIssues();
            index = filtered.findIndex((issue) => this.issueKey(issue) === id);
        }
        if (index < 0) {
            return false;
        }
        if (index >= this.visibleLimit) {
            this.visibleLimit = Math.ceil((index + 1) / 50) * 50;
        }

        this.focusIssueKey = id;
        this.selectedKey = id;
        return true;
    }

    /** Scroll to and select a row after render — for `?hv_id=` deep links. */
    applyPendingIssueFocus() {
        const key = this.focusIssueKey;
        if (!key) {
            return;
        }
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
        if (!row) {
            return;
        }
        this.selectedKey = key;
        this.applyKeyboardSelection();
        this.highlightIssue(key);
        row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }

    highlightIssue(key) {
        const id = String(key || '').trim();
        if (!id) {
            return;
        }
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(id)}"]`);
        if (!row) {
            return;
        }
        row.classList.add('health-view-item--highlight');
        setTimeout(() => row.classList.remove('health-view-item--highlight'), 1800);
    }

    /**
     * Scroll to, select, and highlight one row. Adjusts filter/search so the row
     * is visible — used for `?hv_id=` deep links.
     */
    focusIssue(key, { updateUrl = true } = {}) {
        if (!this.prepareIssueFocus(key)) {
            return false;
        }
        if (updateUrl) {
            this.syncUrlState();
        }
        if (this.isActiveView()) {
            this.render();
        }
        return true;
    }

    /** A shareable dashboard URL that opens this row in the health view. */
    buildIssueShareUrl(issue) {
        const url = new URL(`${window.location.origin}${window.location.pathname}`);
        url.hash = 'health';
        url.searchParams.set('hv_id', this.issueKey(issue));
        if (this.filter !== 'broken') {
            url.searchParams.set('hv_filter', this.filter);
        }
        if (this.sort !== 'score') {
            url.searchParams.set('hv_sort', this.sort);
        }
        const query = String(this.searchQuery || '').trim();
        if (query) {
            url.searchParams.set('hv_q', query);
        }
        return url.toString();
    }

    finishRenderFocus(container, preserveSearch, searchCaret) {
        if (preserveSearch) {
            const input = container.querySelector('.health-view-search-input');
            if (input) {
                input.focus({ preventScroll: true });
                const caret = searchCaret ?? this.searchQuery.length;
                input.setSelectionRange(caret, caret);
            }
            return;
        }
        this.syncKeyboardSelectionAfterRender();
        this.applyPendingIssueFocus();
        container.tabIndex = -1;
        const active = document.activeElement;
        const focusInToolbar = active?.closest?.('.health-view-toolbar, .page-nav-btn');
        if (!active || active === document.body || focusInToolbar) {
            container.focus({ preventScroll: true });
        }
    }

    render() {
        const d = this.dash;
        const container = document.getElementById('dashboard-layout');
        if (!container) return;

        d._abortInlineEditForRender?.();
        d.updateTagFilterIndicator?.();

        const activeEl = document.activeElement;
        const preserveSearch = this._searchFocusPending
            || activeEl?.classList?.contains('health-view-search-input');
        const searchCaret = preserveSearch
            ? (activeEl?.classList?.contains('health-view-search-input') ? activeEl.selectionStart : this.searchQuery.length)
            : null;
        this._searchFocusPending = false;

        this._teardownLoadMoreObserver();
        container.innerHTML = '';
        container.className = 'health-layout';
        container.removeAttribute('aria-colcount');
        container.removeAttribute('aria-rowcount');
        container.removeAttribute('role');
        container.removeAttribute('aria-label');
        container.removeAttribute('data-i18n-aria');

        container.appendChild(this.renderHeader());

        if (this.loading) {
            container.appendChild(this.renderToolbar());
            const loading = document.createElement('p');
            loading.className = 'health-view-empty';
            loading.textContent = this.t('dashboard.healthLoading', 'Loading…');
            container.appendChild(loading);
            this.finishRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        if (!this.report) {
            container.appendChild(this.renderToolbar());
            const failed = document.createElement('div');
            failed.className = 'health-view-empty-state';
            failed.innerHTML = `
                <p class="health-view-empty-title">${this.escape(this.t('dashboard.healthLoadFailed', 'Unable to load the health report'))}</p>
                <p class="health-view-empty-hint">${this.escape(this.t('dashboard.healthLoadFailedHint', 'Check that the server is reachable and try again.'))}</p>
                <button type="button" class="health-view-retry-btn">${this.escape(this.t('dashboard.healthRetry', 'Retry'))}</button>
            `;
            failed.querySelector('.health-view-retry-btn')?.addEventListener('click', () => {
                void this.loadAndRender({ refresh: true });
            });
            container.appendChild(failed);
            this.finishRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        const filtered = this.getFilteredIssues();
        // Tiles ride above the toolbar, but only when there is a list to summarise.
        if (filtered.length) {
            container.appendChild(this.renderTiles());
        }
        container.appendChild(this.renderToolbar());

        if (!filtered.length) {
            container.appendChild(this.renderEmptyState());
            this.finishRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        const visible = filtered.slice(0, this.visibleLimit);
        const feed = document.createElement('div');
        feed.className = 'health-view-feed';
        feed.setAttribute('role', 'feed');
        feed.setAttribute('aria-label', this.t('dashboard.healthPageTitle', 'Health'));
        visible.forEach((issue) => feed.appendChild(this.createIssueElement(issue)));
        container.appendChild(feed);
        this.bindOutsideMenuDismiss();

        if (filtered.length > this.visibleLimit) {
            const sentinel = document.createElement('div');
            sentinel.className = 'health-view-load-sentinel';
            sentinel.setAttribute('aria-hidden', 'true');
            container.appendChild(sentinel);
            this._bindLoadMoreObserver(sentinel, filtered.length);
            if (!this._loadMoreObserver) {
                this._appendLoadMoreFallback(container, filtered.length);
            }
        }

        container.appendChild(this.renderLegend());
        this.bindPointerNavigation(container);
        this.syncUrlState();
        this.finishRenderFocus(container, preserveSearch, searchCaret);
        this.startLiveRefresh();
    }

    /** Lowercase filter label for breadcrumbs and the document title. */
    filterLabel(filter = this.filter) {
        const labels = {
            broken: this.t('dashboard.healthFilterBroken', 'Broken'),
            duplicate: this.t('dashboard.healthFilterDuplicates', 'Duplicates'),
            unchecked: this.t('dashboard.healthFilterUnchecked', 'Never checked'),
            monitored: this.t('dashboard.healthFilterMonitored', 'Monitored'),
            stale: this.t('dashboard.healthFilterStale', 'Stale'),
            unused: this.t('dashboard.healthFilterUnused', 'Unused'),
            'shortcut-conflict': this.t('dashboard.healthFilterShortcutConflict', 'Shortcut conflicts'),
            'missing-preview': this.t('dashboard.healthFilterMissingPreview', 'Missing preview'),
            healthy: this.t('dashboard.healthFilterHealthy', 'Healthy'),
            all: this.t('dashboard.healthFilterAll', 'All'),
        };
        return labels[filter] || String(filter || '');
    }

    /** Breadcrumb trail for the panel head — `health › filter`. */
    headerBreadcrumb() {
        const root = this.t('dashboard.healthPageTitle', 'Health').toLowerCase();
        if (this.filter === 'broken') {
            return root;
        }
        const label = this.filterLabel().toLowerCase();
        return label ? `${root} › ${label}` : root;
    }

    renderHeader() {
        const pct = this.healthyPercent();
        const broken = this.brokenCount();
        const pctLabel = this.t('dashboard.healthHeaderHealthyPct', '{pct}% healthy', { pct });
        const summary = this.report?.summary || {};
        const healthy = Number(summary.healthyCount) || 0;
        const total = Number(summary.totalBookmarks) || 0;
        const detail = total
            ? this.t('dashboard.healthHeaderHealthyDetail', '{count} of {total} healthy', { count: healthy, total })
            : pctLabel;
        const trail = this.headerBreadcrumb();
        const showTrail = trail.includes(' › ');

        const header = document.createElement('div');
        header.className = 'health-view-header';
        header.innerHTML = `
            <div class="health-view-header-text">
                <h2 class="health-view-title">${this.escape(this.t('dashboard.healthPageTitle', 'Health'))}</h2>
                <p class="health-view-head-breadcrumb"${showTrail ? '' : ' hidden'}>${this.escape(trail)}</p>
                <p class="health-view-subtitle">${this.escape(this.t('dashboard.healthPageSubtitle', 'Bookmarks that need attention'))}</p>
            </div>
            <div class="health-view-header-meta">
                <span class="health-view-score-badge ${this.bandClass(pct)}" title="${this.escape(detail)}" aria-label="${this.escape(pctLabel)}">${pct}%</span>
                ${broken > 0
                    ? `<span class="health-view-issue-count">${broken} ${this.escape(this.t('dashboard.healthBroken', 'broken'))}</span>`
                    : ''}
            </div>
        `;
        return header;
    }

    /**
     * KPI tiles above the list. Only rendered when there are rows to look at: on an
     * empty list they would be a wall of zeroes above a "nothing to fix" message.
     *
     * Out of the tab sequence (tabindex="-1") because each tile duplicates a filter
     * pill directly below it — the pills are the keyboard path, and having both would
     * cost several stops before the first row.
     */
    renderTiles() {
        const summary = this.report?.summary || {};
        const total = Number(summary.totalBookmarks) || 0;
        const healthy = Number(summary.healthyCount) || 0;

        // Monitored sits next to Healthy because it answers the same question —
        // is anything wrong right now — where Broken/Unchecked are backlogs to
        // work through. Its tone is live rather than fixed: red the moment a
        // monitor stops responding, green while they all answer.
        const monitored = this.filterCount('monitored');
        const monitorsDown = this.monitorsDownCount();

        const tiles = [
            { key: 'all', label: this.t('dashboard.healthTileTotal', 'Total'), value: total, tone: 'neutral' },
            { key: null, label: this.t('dashboard.healthTileHealthy', 'Healthy'), value: healthy, tone: 'good' },
            {
                key: 'monitored',
                label: this.t('dashboard.healthTileMonitored', 'Monitored'),
                value: monitored,
                // 'good' keeps a healthy set green; 'bad' turns the count red the
                // moment one goes down. A zero count stays neutral through the
                // existing --zero rule, so an install with no monitors is not
                // painted green as if it were passing something.
                tone: monitorsDown > 0 ? 'bad' : 'good',
                title: monitored > 0
                    ? (monitorsDown > 0
                        ? this.t('dashboard.healthTileMonitoredDown', '{count} of {total} not responding', { count: monitorsDown, total: monitored })
                        : this.t('dashboard.healthTileMonitoredUp', 'All {count} responding', { count: monitored }))
                    : '',
            },
            { key: 'broken', label: this.t('dashboard.healthTileBroken', 'Broken'), value: Number(summary.brokenCount) || 0, tone: 'bad' },
            { key: 'unchecked', label: this.t('dashboard.healthTileUnchecked', 'Unchecked'), value: Number(summary.uncheckedCount) || 0, tone: 'warn' },
            { key: 'stale', label: this.t('dashboard.healthTileStale', 'Stale'), value: Number(summary.staleCount) || 0, tone: 'warn' },
            { key: 'unused', label: this.t('dashboard.healthTileUnused', 'Unused'), value: Number(summary.unusedCount) || 0, tone: 'warn' },
        ];

        const wrap = document.createElement('div');
        wrap.className = 'health-view-tiles';
        wrap.innerHTML = tiles.map((tile) => {
            const active = tile.key && this.filter === tile.key ? ' is-active' : '';
            // Zero problems is good news: drop the severity colour so only a real
            // count is tinted red or orange.
            const zero = tile.value === 0 ? ' health-view-tile--zero' : '';
            // Named modifier so the monitored tile can style its live state
            // without the tone classes having to mean something different here.
            const named = tile.key === 'monitored' ? ' health-view-tile--monitored' : '';
            const cls = `health-view-tile health-view-tile--${tile.tone}${zero}${named}${active}`;
            if (!tile.key) {
                return `<article class="${cls}">
                    <span class="health-view-tile-label">${this.escape(tile.label)}</span>
                    <span class="health-view-tile-value">${this.escape(tile.value)}</span>
                </article>`;
            }
            const title = tile.title ? ` title="${this.escape(tile.title)}"` : '';
            return `<button type="button" class="${cls}" data-health-tile="${tile.key}" tabindex="-1"${title} aria-label="${this.escape(tile.label)}: ${this.escape(tile.value)}">
                <span class="health-view-tile-label">${this.escape(tile.label)}</span>
                <span class="health-view-tile-value">${this.escape(tile.value)}</span>
            </button>`;
        }).join('');

        wrap.querySelectorAll('[data-health-tile]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-health-tile') || 'broken';
                this.focusIssueKey = null;
                this._trackAction('filter', { filter: this.filter, via: 'tile' });
                this._resetFeedPaging();
                // Same as the filter pills: a tile is a filter choice, and one
                // that is forgotten on the way out is not really a choice.
                this.persistViewState();
                this.syncUrlState();
                this.render();
                this.dash.pageNav?.updatePageTitle?.();
                this.dash.pageNav?.updateDocumentTitle?.();
            });
        });
        return wrap;
    }

    /** Bookmarks with any form of availability checking on (periodic or monitor). */
    checkedCount() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        return issues.filter((i) => i?.monitor || i?.checkStatus).length;
    }

    /**
     * "Monitor these N" / "Periodic these N" for the current list. Only offered on
     * a narrowed list: on "All" it would mean the whole collection, which is the
     * one thing bulk enabling must not be able to do, so it is left out rather than
     * shown disabled — a greyed button invites the question of how to enable it.
     */
    renderBulkEnableButtons() {
        if (this.filter === 'all') return '';
        const monitorCount = this.bulkEnableTargets('monitor').length;
        const periodicCount = this.bulkEnableTargets('periodic').length;
        let html = '';
        if (monitorCount) {
            html += `<button type="button" class="health-view-bulk-monitor-btn" title="${this.escape(
                this.t('dashboard.healthBulkEnableHint', 'Set the {count} bookmark(s) in this list to Monitor', { count: monitorCount })
            )}">${this.escape(this.t('dashboard.healthBulkEnable', 'Monitor these {count}', { count: monitorCount }))}</button>`;
        }
        if (periodicCount) {
            html += `<button type="button" class="health-view-bulk-periodic-btn" title="${this.escape(
                this.t('dashboard.healthBulkEnablePeriodicHint', 'Set the {count} bookmark(s) in this list to Periodic', { count: periodicCount })
            )}">${this.escape(this.t('dashboard.healthBulkEnablePeriodic', 'Periodic these {count}', { count: periodicCount }))}</button>`;
        }
        return html;
    }

    renderOpenBrokenButton() {
        if (this.filter !== 'broken' || this.brokenCount() <= 0) {
            return '';
        }
        return `<button type="button" class="health-view-open-broken-btn" title="${this.escape(
            this.t('dashboard.openBrokenTitle', 'Open all broken bookmarks in new tabs')
        )}">${this.escape(this.t('dashboard.openBrokenLinks', 'Open broken links'))}</button>`;
    }

    renderMergeDuplicateButton() {
        if (this.filter !== 'duplicate' || !this.duplicateGroups().length) {
            return '';
        }
        return `<span class="health-view-menu-wrap"><button type="button" class="health-view-merge-duplicates-btn" title="${this.escape(
            this.t('dashboard.mergeDuplicateTitle', 'Merge selected duplicate group')
        )}">${this.escape(this.t('dashboard.mergeDuplicateGroup', 'Merge duplicate group'))}</button></span>`;
    }

    /**
     * Ask which duplicate URL group to merge when more than one exists.
     * Returns null when the user cancels.
     */
    chooseDuplicateGroup(anchor) {
        const groups = this.duplicateGroups().filter((group) => Array.isArray(group?.bookmarks) && group.bookmarks.length > 1);
        if (!groups.length) {
            return Promise.resolve(null);
        }
        if (groups.length === 1) {
            return Promise.resolve(groups[0]);
        }
        return new Promise((resolve) => {
            this.closeAllMenus();
            const menu = document.createElement('div');
            menu.className = 'health-view-menu health-view-merge-group-menu';
            menu.setAttribute('role', 'menu');
            menu.innerHTML = [
                `<p class="health-view-menu-label" role="presentation">${this.escape(
                    this.t('dashboard.selectDuplicateGroup', 'Select a duplicate group to merge')
                )}</p>`,
                ...groups.map((group, index) => {
                    const count = group.bookmarks.length;
                    const label = group.url || group.bookmarks[0]?.name || `#${index + 1}`;
                    return `<button type="button" class="health-view-menu-item" role="menuitem" data-merge-group="${index}">${this.escape(label)} (${count})</button>`;
                }),
            ].join('');
            const wrap = anchor?.closest?.('.health-view-menu-wrap') || anchor?.parentElement;
            if (!wrap) {
                resolve(null);
                return;
            }
            wrap.appendChild(menu);
            menu.hidden = false;
            const dismiss = () => {
                menu.remove();
                resolve(null);
            };
            const onDocClick = (e) => {
                if (menu.contains(e.target) || wrap.contains(e.target)) {
                    return;
                }
                document.removeEventListener('click', onDocClick, true);
                dismiss();
            };
            setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
            menu.querySelectorAll('[data-merge-group]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    document.removeEventListener('click', onDocClick, true);
                    const index = Number(btn.getAttribute('data-merge-group'));
                    menu.remove();
                    resolve(groups[index] || null);
                });
            });
            menu.querySelector('.health-view-menu-item')?.focus({ preventScroll: true });
        });
    }

    async openBrokenLinks(button) {
        if (this._openBrokenRunning) {
            return;
        }
        const totalBroken = this.brokenCount();
        if (!totalBroken) {
            return;
        }
        const batchLimit = 10;
        const maxLimit = 25;
        const openCount = Math.min(batchLimit, totalBroken);
        const ok = await this.confirm(
            this.t('dashboard.openBrokenTitle', 'Open all broken bookmarks in new tabs'),
            this.t(
                'dashboard.openBrokenConfirm',
                'Open {count} broken link(s) in new tabs? (max {max} at a time; {total} total broken.)',
                { count: openCount, max: maxLimit, total: totalBroken }
            ),
            { confirmText: this.t('dashboard.openBrokenConfirmBtn', 'Open links') }
        );
        if (!ok) {
            return;
        }

        this._openBrokenRunning = true;
        window.nextdashTrack?.('health:open-broken');
        if (button) {
            button.disabled = true;
        }
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/open-broken', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: batchLimit }),
            });
            if (!res.ok) {
                throw new Error(`open-broken HTTP ${res.status}`);
            }
            const body = await res.json().catch(() => ({}));
            const urls = Array.isArray(body?.urls) ? body.urls : [];
            urls.forEach((url) => {
                const target = String(url || '').trim();
                if (target) {
                    window.open(target, '_blank', 'noopener,noreferrer');
                }
            });
            const remaining = Math.max(0, Number(body?.totalBroken || totalBroken) - urls.length);
            const message = remaining > 0
                ? `${this.t('dashboard.openBrokenLinks', 'Open broken links')} ${this.t(
                    'dashboard.openBrokenRemaining',
                    '({remaining} more in health view.)',
                    { remaining }
                )}`
                : this.t('dashboard.openBrokenLinks', 'Open broken links');
            d.showNotification(message, 'success', { duration: 5000 });
        } catch {
            d.showNotification(this.t('dashboard.openBrokenFailed', 'Failed to open broken links'), 'error');
        } finally {
            this._openBrokenRunning = false;
            const live = document.querySelector('.health-view-open-broken-btn');
            if (live) {
                live.disabled = false;
            }
        }
    }

    async mergeDuplicateGroup(group) {
        if (this._mergeRunning || !group) {
            return;
        }
        const bookmarks = Array.isArray(group.bookmarks) ? group.bookmarks : [];
        if (bookmarks.length < 2) {
            return;
        }
        const keeper = bookmarks[0];
        const removeCount = bookmarks.length - 1;
        const pinnedSuffix = keeper.pinned ? ', pinned' : '';
        const ok = await this.confirm(
            this.t('dashboard.mergeDuplicateTitle', 'Merge selected duplicate group'),
            this.t(
                'dashboard.mergeConfirmBest',
                'Merge {count} bookmark(s) with the same URL?\n\nKeeps best: "{keep}" ({opens}x opened{pinned})\nRemoves: {remove} duplicate(s).',
                {
                    count: bookmarks.length,
                    keep: keeper.name || group.url || keeper.url || '',
                    opens: Number(keeper.openCount) || 0,
                    pinned: pinnedSuffix,
                    remove: removeCount,
                }
            ),
            {
                confirmText: this.t('dashboard.mergeConfirmBtn', 'Merge duplicates'),
            }
        );
        if (!ok) {
            return;
        }

        this._mergeRunning = true;
        window.nextdashTrack?.('health:merge-duplicates');
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const sourcePageIds = [];
            const sourceIndices = [];
            bookmarks.slice(1).forEach((ref) => {
                sourcePageIds.push(ref.pageId);
                sourceIndices.push(ref.index);
            });
            const res = await fetcher('/api/health/merge-duplicates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetPageId: keeper.pageId,
                    targetIndex: keeper.index,
                    sourcePageIds,
                    sourceIndices,
                }),
            });
            if (!res.ok) {
                throw new Error(`merge HTTP ${res.status}`);
            }
            const body = await res.json().catch(() => ({}));
            d.data?.invalidatePageDataCache?.();
            await d.loadBookmarks?.().catch?.(() => {});
            await this.loadAndRender({ refresh: true });
            d.renderDashboard?.({ incremental: false });
            d.updateHealthBadge?.();
            d.showNotification(
                this.t('dashboard.mergedDuplicates', 'Merged {count} duplicates', {
                    count: Number(body?.count) || removeCount,
                }),
                'success',
                { duration: 4000 }
            );
        } catch {
            d.showNotification(this.t('dashboard.mergeFailed', 'Failed to merge duplicates'), 'error');
        } finally {
            this._mergeRunning = false;
        }
    }

    async startMergeDuplicateFlow(button) {
        const groups = this.duplicateGroups().filter((group) => Array.isArray(group?.bookmarks) && group.bookmarks.length > 1);
        if (!groups.length) {
            this.dash.showNotification?.(
                this.t('dashboard.noDuplicateGroupsToMerge', 'No duplicate groups to merge.'),
                'info'
            );
            return;
        }
        const group = await this.chooseDuplicateGroup(button);
        if (group) {
            await this.mergeDuplicateGroup(group);
        }
    }

    /** Secondary filters appear once they have rows, or stay visible while active. */
    appendSecondaryFilterPills(filters) {
        const secondary = [
            ['stale', this.t('dashboard.healthFilterStale', 'Stale')],
            ['unused', this.t('dashboard.healthFilterUnused', 'Unused')],
            ['shortcut-conflict', this.t('dashboard.healthFilterShortcutConflict', 'Shortcut conflicts')],
            ['missing-preview', this.t('dashboard.healthFilterMissingPreview', 'Missing preview')],
            ['healthy', this.t('dashboard.healthFilterHealthy', 'Healthy')],
        ];
        for (const [key, label] of secondary) {
            const count = this.filterCount(key);
            if (count > 0 || this.filter === key) {
                filters.push([key, label]);
            }
        }
    }

    renderToolbar() {
        const checkedCount = this.checkedCount();
        const filters = [
            ['broken', this.t('dashboard.healthFilterBroken', 'Broken')],
            ['duplicate', this.t('dashboard.healthFilterDuplicates', 'Duplicates')],
            ['unchecked', this.t('dashboard.healthFilterUnchecked', 'Never checked')],
        ];
        // The monitor pill used to appear only once something was already
        // monitored, which made the feature invisible to exactly the people who
        // had not found it yet: you had to know it existed to see the way in.
        // It now shows as soon as there is anything that could be monitored, and
        // stays hidden on an empty report so a fresh install is not cluttered.
        const monitoredCount = this.filterCount('monitored');
        const hasBookmarks = (Array.isArray(this.report?.issues) ? this.report.issues.length : 0) > 0;
        if (monitoredCount > 0 || hasBookmarks || this.filter === 'monitored') {
            filters.push(['monitored', this.t('dashboard.healthFilterMonitored', 'Monitored')]);
        }
        this.appendSecondaryFilterPills(filters);
        filters.push(['all', this.t('dashboard.healthFilterAll', 'All')]);

        const toolbar = document.createElement('div');
        toolbar.className = 'health-view-toolbar';
        const pills = filters.map(([key, label]) => {
            const count = this.filterCount(key);
            return `<button type="button" class="health-view-filter-btn${this.filter === key ? ' is-active' : ''}" data-health-filter="${key}">
                ${this.escape(label)}<span class="health-view-filter-count">${count}</span>
            </button>`;
        }).join('');

        const sortOptions = [
            ['score', this.t('dashboard.healthSortScore', 'score')],
            ['status', this.t('dashboard.healthSortStatus', 'status')],
            ['last-checked', this.t('dashboard.healthSortCheckedAsc', 'last checked ↑')],
            ['last-checked-desc', this.t('dashboard.healthSortCheckedDesc', 'last checked ↓')],
            ['name', this.t('dashboard.healthSortName', 'name')],
        ].map(([value, label]) =>
            `<option value="${value}"${this.sort === value ? ' selected' : ''}>${this.escape(label)}</option>`
        ).join('');

        toolbar.innerHTML = `
            <div class="health-view-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.healthFilterLabel', 'Filter health issues'))}">${pills}</div>
            <input type="search" class="health-view-search-input" value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.healthSearchPlaceholder', 'Search bookmarks…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.healthSearchPlaceholder', 'Search bookmarks…'))}">
            <select class="health-view-sort-select" aria-label="${this.escape(this.t('dashboard.healthSortLabel', 'Sort bookmarks'))}">${sortOptions}</select>
            <button type="button" class="health-view-export-btn" title="${this.escape(this.t('dashboard.healthExportHint', 'Download the filtered list as CSV'))}">${this.escape(this.t('dashboard.healthExport', 'Export'))}</button>
            ${this.renderOpenBrokenButton()}
            ${this.renderMergeDuplicateButton()}
            <button type="button" class="health-view-retest-btn">${this.escape(this.t('dashboard.healthRetest', 'Retest all'))}</button>
            <button type="button" class="health-view-checkoff-btn"${checkedCount ? '' : ' disabled'} title="${this.escape(checkedCount
                ? this.t('dashboard.healthCheckOffHint', 'Turn off periodic checks and monitoring for all {count} bookmarks', { count: checkedCount })
                : this.t('dashboard.healthCheckOffNone', 'No bookmarks have checking enabled'))}">${this.escape(this.t('dashboard.healthCheckOff', 'Checking off'))}</button>
            ${this.renderBulkEnableButtons()}
        `;

        toolbar.querySelector('.health-view-export-btn')?.addEventListener('click', () => {
            this.exportFilteredCsv();
        });

        const openBrokenBtn = toolbar.querySelector('.health-view-open-broken-btn');
        openBrokenBtn?.addEventListener('click', () => {
            void this.openBrokenLinks(openBrokenBtn);
        });

        const mergeBtn = toolbar.querySelector('.health-view-merge-duplicates-btn');
        mergeBtn?.addEventListener('click', () => {
            void this.startMergeDuplicateFlow(mergeBtn);
        });

        const sortSelect = toolbar.querySelector('.health-view-sort-select');
        sortSelect?.addEventListener('change', (e) => {
            this.sort = e.target.value || 'score';
            this._trackAction('sort', { sort: this.sort });
            this._resetFeedPaging();
            this.persistViewState();
            this.syncUrlState();
            this.render();
            // Focus returns to the list, not the select: leaving it focused would
            // swallow every row shortcut afterwards (handleKeyboardNavigation
            // ignores keys typed into a SELECT), so j/k/m would go dead until the
            // user clicked away.
            document.getElementById('dashboard-layout')?.focus({ preventScroll: true });
        });

        toolbar.querySelectorAll('[data-health-filter]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-health-filter') || 'broken';
                this.focusIssueKey = null;
                this._trackAction('filter', { filter: this.filter, via: 'pill' });
                this._resetFeedPaging();
                this.persistViewState();
                this.syncUrlState();
                this.render();
                this.dash.pageNav?.updatePageTitle?.();
                this.dash.pageNav?.updateDocumentTitle?.();
            });
        });

        const searchInput = toolbar.querySelector('.health-view-search-input');
        searchInput?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this._resetFeedPaging();
            this._searchFocusPending = true;
            this.scheduleSearchRender();
        });
        searchInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                return;
            }
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            e.stopPropagation();
        });

        const retestBtn = toolbar.querySelector('.health-view-retest-btn');
        retestBtn?.addEventListener('click', () => {
            void this.retestAll(retestBtn);
        });

        const checkOffBtn = toolbar.querySelector('.health-view-checkoff-btn');
        checkOffBtn?.addEventListener('click', () => {
            void this.disableAllChecking(checkOffBtn);
        });

        const bulkMonitorBtn = toolbar.querySelector('.health-view-bulk-monitor-btn');
        bulkMonitorBtn?.addEventListener('click', () => {
            void this.enableCheckingForVisible('monitor', bulkMonitorBtn);
        });

        const bulkPeriodicBtn = toolbar.querySelector('.health-view-bulk-periodic-btn');
        bulkPeriodicBtn?.addEventListener('click', () => {
            void this.enableCheckingForVisible('periodic', bulkPeriodicBtn);
        });

        return toolbar;
    }

    /**
     * Turn availability checking off for every bookmark at once — the escape
     * hatch for a monitor batch that got noisy, without walking the list.
     *
     * Only "off" is offered in bulk: switching everything *on* would point the
     * scheduler at the whole collection, which is what the per-bookmark opt-in
     * exists to avoid. Confirmed first, since it silently clears a setting on
     * many bookmarks and the counts are the only way to see the blast radius.
     */
    /**
     * The rows a bulk enable would touch: the current filter and search, minus
     * the ones already in that mode. Deliberately the *visible* list — the blast
     * radius has to be the thing on screen, or the count in the button means
     * nothing.
     */
    bulkEnableTargets(mode) {
        if (this.filter === 'all') return [];
        return this.getFilteredIssues().filter((issue) => this.checkModeOf(issue) !== mode);
    }

    /**
     * Turn one mode on for everything currently listed.
     *
     * Bound to the filtered list rather than the whole collection, and refused
     * outright on the "All" filter: pointing the scheduler at every bookmark is
     * exactly what the per-bookmark opt-in prevents, and the server enforces the
     * same rule by only accepting an explicit target list. Confirmed first,
     * because the count is the only way to see how much this touches.
     */
    async enableCheckingForVisible(mode, button) {
        if (this._checkOffRunning) return;
        const targets = this.bulkEnableTargets(mode);
        if (!targets.length) return;

        const label = this.checkModeMeta(mode).label;
        const ok = await this.confirm(
            this.t('dashboard.healthBulkEnableTitle', 'Turn on checking for {count} bookmark(s)?', { count: targets.length }),
            mode === 'monitor'
                ? this.t(
                    'dashboard.healthBulkEnableMonitorConfirm',
                    'This sets {count} bookmark(s) in the current list to Monitor. Each one will be checked on its own interval and will record uptime history.',
                    { count: targets.length }
                )
                : this.t(
                    'dashboard.healthBulkEnablePeriodicConfirm',
                    'This sets {count} bookmark(s) in the current list to Periodic. Each one will be checked about once a day.',
                    { count: targets.length }
                )
        );
        if (!ok) return;

        this._checkOffRunning = true;
        window.nextdashTrack?.('health:check-on-bulk');
        if (button) {
            button.disabled = true;
        }
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/check-mode-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode,
                    targets: targets.map((issue) => ({
                        pageId: issue.pageId,
                        index: issue.index,
                        url: issue.url,
                    })),
                }),
            });
            if (!res.ok) throw new Error(`check-mode HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            // Drop the page cache first: loadBookmarks() is served from it, so
            // without this the dashboard keeps showing the pre-write flags.
            d.data?.invalidatePageDataCache?.();
            await d.loadBookmarks?.().catch?.(() => {});
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();

            const changed = Number(body?.changed) || 0;
            const skipped = Number(body?.skipped) || 0;
            // Say when part of the batch was stale rather than reporting a clean
            // success for a number the user can see is wrong.
            d.showNotification(
                skipped > 0
                    ? this.t('dashboard.healthBulkEnablePartial', '{count} bookmark(s) set to {mode}; {skipped} had changed and were skipped', { count: changed, mode: label, skipped })
                    : this.t('dashboard.healthBulkEnableDone', '{count} bookmark(s) set to {mode}', { count: changed, mode: label }),
                skipped > 0 ? 'warning' : 'success',
                { duration: 3500 }
            );
        } catch {
            d.showNotification(
                this.t('dashboard.healthCheckModeFailed', 'Could not change availability checking'),
                'error'
            );
        } finally {
            this._checkOffRunning = false;
        }
    }

    async disableAllChecking(button) {
        if (this._checkOffRunning) return;
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        const monitored = issues.filter((i) => i?.monitor).length;
        const periodic = issues.filter((i) => i?.checkStatus && !i?.monitor).length;
        const total = monitored + periodic;
        if (!total) return;

        const ok = await this.confirm(
            this.t('dashboard.healthCheckOffTitle', 'Turn off all checking?'),
            this.t(
                'dashboard.healthCheckOffConfirm',
                'This turns off checking for {total} bookmarks ({monitor} monitored, {periodic} periodic). Uptime history is kept, so turning monitoring back on later resumes where it left off.',
                { total, monitor: monitored, periodic }
            )
        );
        if (!ok) return;

        this._checkOffRunning = true;
        window.nextdashTrack?.('health:check-off-all');
        if (button) {
            button.disabled = true;
        }
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/check-mode-all', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'off' }),
            });
            if (!res.ok) throw new Error(`check-mode HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            // The dashboard's own copy would otherwise still show the old flags,
            // and loadBookmarks() reads through the page cache, so that has to go
            // first or the reload just returns the stale values again.
            d.data?.invalidatePageDataCache?.();
            await d.loadBookmarks?.().catch?.(() => {});
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            d.showNotification(
                this.t('dashboard.healthCheckOffDone', 'Checking turned off for {count} bookmarks', {
                    count: Number(body?.changed) || total,
                }),
                'success',
                { duration: 3500 }
            );
        } catch {
            d.showNotification(
                this.t('dashboard.healthCheckOffFailed', 'Could not turn off checking'),
                'error'
            );
        } finally {
            this._checkOffRunning = false;
            // The button belongs to the pre-refresh DOM; re-query rather than
            // touching the detached node.
            const live = document.querySelector('.health-view-checkoff-btn');
            if (live) live.disabled = this.checkedCount() === 0;
        }
    }

    /**
     * Retest every eligible bookmark. The button is disabled for the duration
     * rather than debounced: this can take minutes, and the disabled state is
     * the only honest signal that it is still running.
     */
    async retestAll(button) {
        if (this._retestRunning) return;
        this._retestRunning = true;
        window.nextdashTrack?.('health:retest-all');
        if (button) {
            button.disabled = true;
            button.textContent = this.t('dashboard.healthRetesting', 'Retesting…');
        }
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/retest-all?scope=all', { method: 'POST' });
            if (!res.ok) {
                throw new Error(`retest HTTP ${res.status}`);
            }
            const body = await res.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            const tested = Number(body?.tested) || 0;
            d.showNotification(
                tested > 0
                    ? this.t('dashboard.healthRetestDone', 'Re-checked {count} bookmarks', { count: tested })
                    : this.t('dashboard.healthRetestNothing', 'Nothing to re-check'),
                'success',
                { duration: 3500 }
            );
        } catch {
            d.showNotification(
                this.t('dashboard.healthRetestFailed', 'Could not re-check bookmarks'),
                'error'
            );
        } finally {
            this._retestRunning = false;
            // The button belongs to the pre-refresh DOM; re-query rather than
            // touching the detached node.
            const live = document.querySelector('.health-view-retest-btn');
            if (live) {
                live.disabled = false;
                live.textContent = this.t('dashboard.healthRetest', 'Retest all');
            }
        }
    }

    renderEmptyState() {
        const messages = {
            broken: [
                this.t('dashboard.healthEmptyBroken', 'No broken bookmarks'),
                this.t('dashboard.healthEmptyBrokenHint', 'Every checked link resolved. Nothing to fix here.'),
            ],
            duplicate: [
                this.t('dashboard.healthEmptyDuplicate', 'No duplicates'),
                this.t('dashboard.healthEmptyDuplicateHint', 'No URL appears on more than one bookmark.'),
            ],
            unchecked: [
                this.t('dashboard.healthEmptyUnchecked', 'Everything has been checked'),
                this.t('dashboard.healthEmptyUncheckedHint', 'No bookmark is waiting for its first status check.'),
            ],
            // The one empty state that teaches rather than reassures: the pill is
            // now visible before anything is monitored, so landing here is a
            // question ("what is this?") rather than a report of a clean bill.
            monitored: [
                this.t('dashboard.healthEmptyMonitored', 'Nothing is being monitored yet'),
                this.t(
                    'dashboard.healthEmptyMonitoredHint',
                    'Monitoring checks a bookmark on its own schedule and keeps 30 days of uptime history. Press c on any row — or use its ⋯ menu — and choose Monitor.'
                ),
            ],
            all: [
                this.t('dashboard.healthEmptyAll', 'No issues found'),
                this.t('dashboard.healthEmptyAllHint', 'Every bookmark scores full marks.'),
            ],
            stale: [
                this.t('dashboard.healthEmptyStale', 'No stale bookmarks'),
                this.t('dashboard.healthEmptyStaleHint', 'Nothing here has gone unopened for 30+ days.'),
            ],
            unused: [
                this.t('dashboard.healthEmptyUnused', 'No never-opened bookmarks'),
                this.t('dashboard.healthEmptyUnusedHint', 'Every bookmark has been opened at least once.'),
            ],
            'shortcut-conflict': [
                this.t('dashboard.healthEmptyShortcutConflict', 'No shortcut conflicts'),
                this.t('dashboard.healthEmptyShortcutConflictHint', 'No shortcut is shared by more than one bookmark.'),
            ],
            'missing-preview': [
                this.t('dashboard.healthEmptyMissingPreview', 'No missing previews'),
                this.t('dashboard.healthEmptyMissingPreviewHint', 'Every bookmark has preview metadata.'),
            ],
            healthy: [
                this.t('dashboard.healthEmptyHealthy', 'No fully healthy rows'),
                this.t('dashboard.healthEmptyHealthyHint', 'Nothing here is issue-free under the current filters.'),
            ],
        };
        const [title, hint] = messages[this.filter] || messages.all;
        const searching = String(this.searchQuery || '').trim().length > 0;

        const empty = document.createElement('div');
        empty.className = 'health-view-empty-state';
        empty.innerHTML = `
            <p class="health-view-empty-title">${this.escape(searching ? this.t('dashboard.healthNoMatches', 'No matching bookmarks') : title)}</p>
            <p class="health-view-empty-hint">${this.escape(searching ? this.t('dashboard.healthNoMatchesHint', 'Try another filter or search term') : hint)}</p>
        `;
        return empty;
    }

    /**
     * Keyboard cheatsheet under the list. `position` only tags the element for
     * styling; kept as a parameter so callers read explicitly as 'bottom'.
     */
    renderLegend(position = 'bottom') {
        const legend = document.createElement('p');
        legend.className = `health-view-legend health-view-legend--${position}`;
        legend.setAttribute('aria-hidden', 'true');
        const keys = [
            ['j / k', this.t('dashboard.healthKeyMove', 'move')],
            ['s', this.t('dashboard.healthKeyScore', 'score')],
            ['i', this.t('dashboard.healthKeyStats', 'statistics')],
            ['p', this.t('dashboard.healthKeyRecheck', 're-check')],
            ['R / ?', this.t('dashboard.healthKeyRefresh', 'refresh report')],
            ['c', this.t('dashboard.healthKeyCheckMode', 'checking')],
            ['m', this.t('dashboard.healthKeyMore', 'more actions')],
            ['Enter / Space', this.t('dashboard.healthKeyOpen', 'open')],
            ['g / G / Home / End', this.t('dashboard.healthKeyFirstLast', 'first / last')],
            ['Esc', this.t('dashboard.healthKeyClose', 'back to bookmarks')],
        ];
        legend.innerHTML = keys
            .map(([k, label]) => `<span><kbd>${this.escape(k)}</kbd> ${this.escape(label)}</span>`)
            .join('');
        return legend;
    }

    /* ── Uptime monitoring ─────────────────────────────────────────────── */

    /** Compact duration for "down since" and incident lengths: 2d 3h, 4h 12m, 45s. */
    formatDuration(ms) {
        const total = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
        const d = Math.floor(total / 86400);
        const h = Math.floor((total % 86400) / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = Math.floor(total % 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m`;
        return `${s}s`;
    }

    /** Uptime as a percentage, or null when the window holds no samples at all. */
    formatUptime(window) {
        if (!window || !window.samples) return null;
        const pct = window.ratio * 100;
        // Avoid showing a reassuring "100%" when a single failure is rounded away.
        const rounded = pct >= 99.95 && window.ratio < 1 ? 99.9 : pct;
        return `${rounded.toFixed(rounded >= 99.95 || rounded % 1 === 0 ? 0 : 1)}%`;
    }

    /**
     * The heartbeat bar. Each <span> is one time bucket, not one check, so rows
     * with different intervals stay visually comparable.
     */
    renderHeartbeat(stats) {
        const buckets = Array.isArray(stats?.heartbeat) ? stats.heartbeat : [];
        if (!buckets.length) return '';
        const bars = buckets.map((b) => {
            const title = b.state === 'unknown'
                ? this.t('dashboard.healthHeartbeatNoData', 'No data')
                : `${new Date(b.from).toLocaleString()} — ${b.avgMs ? `${b.avgMs}ms` : this.heartbeatStateLabel(b.state)}`;
            return `<span class="health-heartbeat-bar is-${this.escape(b.state)}" title="${this.escape(title)}"></span>`;
        }).join('');
        return `<div class="health-heartbeat" role="img" aria-label="${this.escape(this.t('dashboard.healthHeartbeatLabel', 'Uptime history'))}">${bars}</div>`;
    }

    /**
     * Response-time sparkline as inline SVG. Shares the heartbeat's buckets, so
     * the two graphics line up on the same time axis.
     *
     * The defaults are the row-sized graphic; the stats modal passes a larger box
     * and `detail: true` for axis labels and per-point tooltips. One function
     * rather than two so the gap handling below — which is the part that is easy
     * to get wrong — cannot drift between the two sizes.
     */
    renderSparkline(stats, { w = 60, h = 16, detail = false, className = 'health-sparkline' } = {}) {
        const buckets = Array.isArray(stats?.heartbeat) ? stats.heartbeat : [];
        const points = buckets.map((b) => (b.avgMs > 0 ? b.avgMs : null));
        const known = points.filter((p) => p !== null);
        if (known.length < 2) return '';

        const max = Math.max(...known);
        const min = Math.min(...known);
        const span = max - min || 1;
        const step = w / Math.max(1, points.length - 1);
        // Room for the axis labels, which are drawn inside the same viewBox. Wide
        // enough for a four-digit reading ("1250ms") at the 9px label size — 34
        // clipped the final character off three-digit values.
        const padRight = detail ? 52 : 0;
        const plotW = w - padRight;
        const plotStep = plotW / Math.max(1, points.length - 1);
        const stepX = detail ? plotStep : step;
        // The min and max labels sit on their own gridlines, so in detail mode the
        // plot is inset vertically to keep the top and bottom label from being cut
        // in half by the edge of the viewBox.
        const padY = detail ? 7 : 1;
        const plotH = h - padY * 2;

        // Gaps break the line rather than interpolating across them, so missing
        // data never looks like a measured value.
        const segments = [];
        const dots = [];
        let current = [];
        points.forEach((p, i) => {
            if (p === null) {
                if (current.length > 1) segments.push(current);
                current = [];
                return;
            }
            const x = (i * stepX).toFixed(1);
            const y = (h - padY - ((p - min) / span) * plotH).toFixed(1);
            current.push(`${x},${y}`);
            if (detail) {
                const when = buckets[i]?.from ? new Date(buckets[i].from).toLocaleString() : '';
                dots.push(`<circle class="health-sparkline-dot" data-point="${i}" cx="${x}" cy="${y}" r="3" fill="currentColor"><title>${this.escape(`${when} — ${p}ms`)}</title></circle>`);
            }
        });
        if (current.length > 1) segments.push(current);
        if (!segments.length) return '';

        const strokeWidth = detail ? 2 : 1.5;
        const paths = segments
            .map((pts) => `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`)
            .join('');

        // Min/max/average as gridlines, so the big chart reads as a measurement
        // rather than a shape. The row version stays label-free — there is no room.
        let axis = '';
        if (detail) {
            const avg = Math.round(known.reduce((sum, p) => sum + p, 0) / known.length);
            const yFor = (value) => (h - padY - ((value - min) / span) * plotH).toFixed(1);
            const lines = [[max, 'max'], [avg, 'avg'], [min, 'min']]
                .map(([value, kind]) => {
                    const y = yFor(value);
                    return `<line class="health-sparkline-grid is-${kind}" x1="0" y1="${y}" x2="${plotW}" y2="${y}" stroke="currentColor" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.28"/>`
                        + `<text class="health-sparkline-axis" x="${plotW + 4}" y="${y}" dy="0.32em" fill="currentColor" font-size="9">${this.escape(value)}ms</text>`;
                })
                .join('');
            axis = lines;
        }

        // Hit targets. The dots are a few pixels across and the readout has to be
        // reachable without pixel-hunting, so each measured bucket also gets a
        // full-height transparent column reaching halfway to its neighbours. They
        // are appended last, on top of the line, so the whole column is clickable.
        //
        // Roving tabindex: the chart is one tab stop, not one per measurement. Only
        // the first target starts reachable by Tab and the arrow keys move the stop
        // from there — tabbing through every point to reach Close would be worse
        // than no keyboard support at all.
        let hits = '';
        if (detail) {
            let first = true;
            hits = points.map((p, i) => {
                if (p === null) return '';
                const cx = i * stepX;
                const x0 = Math.max(0, cx - stepX / 2);
                const x1 = Math.min(plotW, cx + stepX / 2);
                const when = buckets[i]?.from ? new Date(buckets[i].from).toLocaleString() : '';
                const readLabel = this.t('dashboard.healthStatsPointLabel', '{when} — {ms}ms', { when, ms: p });
                const tab = first ? '0' : '-1';
                first = false;
                return `<rect class="health-sparkline-hit" data-point="${i}"`
                    + ` x="${x0.toFixed(1)}" y="0" width="${Math.max(0.1, x1 - x0).toFixed(1)}" height="${h}"`
                    + ` fill="transparent" tabindex="${tab}" role="button"`
                    + ` aria-label="${this.escape(readLabel)}"><title>${this.escape(readLabel)}</title></rect>`;
            }).join('');
        }

        const label = this.t('dashboard.healthSparklineLabel', 'Response time {min}–{max}ms', { min, max });
        return `<svg class="${this.escape(className)}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${this.escape(label)}">${axis}${paths}${dots.join('')}${hits}</svg>`;
    }

    /* ── View state persistence ────────────────────────────────────────── */

    static STATE_KEY = 'nextdash:health-view-state';
    static PERSISTED_FILTERS = new Set([
        'all', 'broken', 'duplicate', 'shortcut-conflict', 'unchecked',
        'stale', 'unused', 'missing-preview', 'healthy', 'monitored',
    ]);
    static PERSISTED_SORTS = new Set(['score', 'status', 'last-checked', 'last-checked-desc', 'name']);

    /**
     * Restore filter, sort, and search. URL first and stored state second.
     *
     * A link someone shared has to win over what this browser last did, or the
     * link does not describe what the recipient sees. Search is deliberately not
     * persisted — a stored query would silently hide most of the list on the next
     * visit, with only a small input to explain why.
     */
    restoreViewState() {
        let stateFromUrl = false;
        let refresh = false;
        try {
            const params = new URL(window.location.href).searchParams;
            const filter = (params.get('hv_filter') || '').toLowerCase();
            if (DashboardHealth.PERSISTED_FILTERS.has(filter)) {
                this.filter = filter;
                stateFromUrl = true;
            }
            const sort = (params.get('hv_sort') || '').toLowerCase();
            if (DashboardHealth.PERSISTED_SORTS.has(sort)) {
                this.sort = sort;
                stateFromUrl = true;
            }
            const query = params.get('hv_q');
            if (typeof query === 'string' && query.trim() !== '') {
                this.searchQuery = query.trim();
                stateFromUrl = true;
            }
            const issueKey = (params.get('hv_id') || '').trim();
            if (/^\d+:\d+$/.test(issueKey)) {
                this.focusIssueKey = issueKey;
                stateFromUrl = true;
            }
            const refreshRaw = (params.get('hv_refresh') || '').toLowerCase();
            if (refreshRaw === '1' || refreshRaw === 'true') {
                refresh = true;
            }
        } catch { /* a malformed URL just means no deep link */ }

        if (!stateFromUrl) {
            try {
                const stored = JSON.parse(localStorage.getItem(DashboardHealth.STATE_KEY) || '{}');
                if (DashboardHealth.PERSISTED_FILTERS.has(stored.filter)) this.filter = stored.filter;
                if (DashboardHealth.PERSISTED_SORTS.has(stored.sort)) this.sort = stored.sort;
            } catch { /* unreadable storage falls back to the defaults */ }
        }
        return { refresh };
    }

    /** Remember filter and sort for the next visit. Best-effort by design. */
    persistViewState() {
        try {
            localStorage.setItem(
                DashboardHealth.STATE_KEY,
                JSON.stringify({ filter: this.filter, sort: this.sort })
            );
        } catch { /* private mode / full quota: the view still works */ }
    }

    /**
     * Keep the address bar describing the current view so it can be copied and
     * shared. replaceState, not pushState: a filter click is not a navigation
     * step, and Back should leave the health view rather than walk its filter
     * history. hv_refresh is one-shot only — read on open, never written back.
     */
    syncUrlState() {
        if (!this.isActiveView()) return;
        try {
            const url = new URL(window.location.href);
            const params = url.searchParams;
            const setOrDelete = (key, value, isDefault) => {
                if (value && !isDefault) params.set(key, value);
                else params.delete(key);
            };
            setOrDelete('hv_filter', this.filter, this.filter === 'broken');
            setOrDelete('hv_sort', this.sort, this.sort === 'score');
            setOrDelete('hv_q', String(this.searchQuery || '').trim(), !String(this.searchQuery || '').trim());
            setOrDelete('hv_id', String(this.focusIssueKey || this.selectedKey || '').trim(), !String(this.focusIssueKey || this.selectedKey || '').trim());
            params.delete('hv_refresh');
            const query = params.toString();
            history.replaceState(history.state, '', `${url.pathname}${query ? `?${query}` : ''}#health`);
        } catch { /* history is unavailable in some embedded contexts */ }
    }

    /** Keyboard R / ?: reload the cached report, not a full retest-all run. */
    async refreshReportFromKeyboard() {
        window.nextdashTrack?.('health:refresh-report');
        await this.loadAndRender({ refresh: true });
        this.dash.updateHealthBadge?.();
    }

    /* ── Export ────────────────────────────────────────────────────────── */

    /**
     * One CSV field, RFC 4180 style.
     *
     * The leading-character guard is for spreadsheets, not for CSV: Excel and
     * Sheets treat a value starting with = + - @ as a formula, so a bookmark
     * titled "=cmd" would execute on open. Prefixing an apostrophe keeps it text.
     */
    csvField(value) {
        let text = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(text)) {
            text = `'${text}`;
        }
        return `"${text.replace(/"/g, '""')}"`;
    }

    /**
     * Download the rows currently on screen as CSV — the filter and search are
     * the point, so this exports what is visible rather than the whole report.
     *
     * Findings were previously readable only in the view itself: there was no way
     * to work through them beside a spreadsheet or hand someone the list.
     */
    exportFilteredCsv() {
        const issues = this.getFilteredIssues();
        if (!issues.length) {
            this.dash.showNotification?.(
                this.t('dashboard.healthExportEmpty', 'Nothing to export in this view.'),
                'info'
            );
            return;
        }

        const header = [
            this.t('dashboard.healthExportColName', 'Name'),
            this.t('dashboard.healthExportColUrl', 'URL'),
            this.t('dashboard.healthExportColStatus', 'Status'),
            this.t('dashboard.healthExportColScore', 'Score'),
            this.t('dashboard.healthExportColPage', 'Page'),
            this.t('dashboard.healthExportColCategory', 'Category'),
            this.t('dashboard.healthExportColChecked', 'Last checked'),
            this.t('dashboard.healthExportColIssues', 'Issues'),
        ];

        const rows = issues.map((issue) => [
            issue.name || issue.previewTitle || '',
            issue.url || '',
            issue.status || '',
            Number(issue.score ?? ''),
            issue.pageName || '',
            issue.category || '',
            issue.lastChecked ? new Date(issue.lastChecked).toISOString() : '',
            // The same wording the score panel shows, so the file and the screen
            // cannot disagree about why a row is listed.
            this.reasonEntries(issue).map((e) => e.label).join('; '),
        ]);

        // BOM so Excel reads UTF-8: without it, accented titles arrive mojibake.
        const csv = '﻿' + [header, ...rows]
            .map((row) => row.map((cell) => this.csvField(cell)).join(','))
            .join('\r\n');

        const stamp = new Date().toISOString().slice(0, 10);
        const name = `nextdash-health-${this.filter}-${stamp}.csv`;
        this.downloadFile(name, csv, 'text/csv;charset=utf-8');
        window.nextdashTrack?.('health:export', { rows: String(rows.length) });
    }

    downloadFile(filename, content, mime) {
        try {
            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoked on a later tick so the click has consumed the URL first.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) {
            console.error('health export failed', error);
            this.dash.showNotification?.(
                this.t('dashboard.healthExportFailed', 'Could not create the export file.'),
                'error'
            );
        }
    }

    /** The mode a row is in, as the three-state name the server also speaks. */
    checkModeOf(issue) {
        return window.CheckMode.of(issue);
    }

    /**
     * Label, hint and CSS modifier for each mode, from the shared definition so
     * this view and the dashboard context menu cannot drift apart in wording.
     * `label` here is the badge wording: a row badge has to say what is off,
     * where a menu option can simply read "Off".
     */
    checkModeMeta(mode) {
        const meta = window.CheckMode.meta(mode);
        return { ...meta, label: meta.badge };
    }

    /**
     * The check-mode badge, which doubles as the control that changes it. Making
     * the existing label the button costs no extra room in the row and puts the
     * control exactly where the eye already goes to ask "why has this row no
     * heartbeat?".
     *
     * An unchecked row shows a muted placeholder rather than a full badge: most
     * bookmarks are unchecked, and a solid "Not checked" pill on every one of them
     * would drown the rows that do carry a mode. CSS lifts it into view on hover
     * and keyboard selection.
     */
    renderCheckModeBadge(issue, key) {
        const mode = this.checkModeOf(issue);
        const meta = this.checkModeMeta(mode);
        const title = `${meta.hint} — ${this.t('dashboard.healthCheckModeChange', 'click to change')}`;
        return `<button type="button"
            class="health-check-mode ${meta.cls}"
            aria-haspopup="menu"
            aria-expanded="false"
            data-menu-toggle="${this.escape(key)}"
            data-menu-kind="check"
            title="${this.escape(title)}"
            aria-label="${this.escape(title)}"
        >${this.escape(meta.label)}<kbd>c</kbd></button>`;
    }

    /**
     * The check-mode popover: three named options rather than a control that
     * cycles. The modes are not interchangeable — periodic is cheap and answers
     * "is this link alive", monitor is the expensive tier that records uptime —
     * so each carries its one-line explanation instead of leaving the user to
     * guess what the next click will select.
     */
    renderCheckModeMenu(issue, key) {
        const active = this.checkModeOf(issue);
        // Same three options, same order and same sentences as the dashboard
        // right-click menu; only the markup around them differs.
        const options = window.CheckMode.options().map((o) => [o.mode, o.label, o.body]);
        const items = options.map(([mode, label, body]) => {
            const isActive = mode === active;
            return `<button type="button"
                class="health-view-menu-item health-check-option${isActive ? ' is-active' : ''}"
                role="menuitemradio"
                aria-checked="${isActive ? 'true' : 'false'}"
                data-check-mode="${mode}"
            >
                <span class="health-check-option-label">${this.escape(label)}</span>
                <span class="health-check-option-body">${this.escape(body)}</span>
            </button>`;
        }).join('');

        // A span, not a div: this popover lives inside the row's <p> meta line, and
        // a block-level child there would make the parser close the paragraph
        // early, stranding the menu outside the row it belongs to.
        return `<span class="health-view-menu health-check-menu" role="menu" hidden
            data-menu-for="${this.escape(key)}" data-menu-owner="check"
            aria-label="${this.escape(this.t('dashboard.healthCheckModeLabel', 'Availability checking'))}">${items}</span>`;
    }

    /** The monitor strip under the row meta: heartbeat, uptime, sparkline. */
    renderMonitorStrip(issue) {
        const stats = issue?.monitorStats;
        if (!issue?.monitor) return '';
        if (!stats) {
            // Monitored but never checked — say so, rather than showing 0%.
            // No expand button here: there are no statistics to enlarge yet.
            return `<div class="health-monitor-strip is-pending">
                <span class="health-monitor-pending">${this.escape(this.t('dashboard.healthMonitorPending', 'Monitoring — awaiting first check'))}</span>
            </div>`;
        }

        const uptime = this.formatUptime(stats.uptime24h);
        const uptimeLabel = uptime
            ? `<span class="health-monitor-uptime" title="${this.escape(this.t('dashboard.healthUptime24hTitle', 'Uptime over the last 24 hours'))}">${this.escape(uptime)}</span>`
            : '';
        const down = stats.downSince
            ? `<span class="health-monitor-down">${this.escape(this.t('dashboard.healthDownSince', 'Down for {duration}', { duration: this.formatDuration(Date.now() - stats.downSince) }))}</span>`
            : '';
        const ping = !stats.downSince && stats.lastPingMs > 0
            ? `<span class="health-monitor-ping">${this.escape(stats.lastPingMs)}ms</span>`
            : '';
        const expandLabel = this.t('dashboard.healthStatsExpand', 'Enlarge statistics');

        return `<div class="health-monitor-strip">
            ${this.renderHeartbeat(stats)}
            ${uptimeLabel}
            ${this.renderSparkline(stats)}
            ${ping}
            ${down}
            <button type="button" class="health-monitor-expand-btn" data-health-action="stats"
                aria-haspopup="dialog"
                title="${this.escape(expandLabel)}"
                aria-label="${this.escape(expandLabel)}"
            >⤢<kbd>i</kbd></button>
        </div>`;
    }

    /* ── Enlarged monitor statistics ───────────────────────────────────── */

    /** True when a row has monitoring data worth enlarging. */
    hasMonitorStats(issue) {
        return Boolean(issue?.monitor && issue?.monitorStats);
    }

    /**
     * The three uptime windows as tiles. A window with no samples reads "no data"
     * rather than 0%: a monitor enabled an hour ago has no 30-day history, and
     * showing that as total downtime would be a lie.
     */
    renderUptimeTiles(stats) {
        const windows = [
            [this.t('dashboard.healthStatsUptime24h', '24 hours'), stats?.uptime24h],
            [this.t('dashboard.healthStatsUptime7d', '7 days'), stats?.uptime7d],
            [this.t('dashboard.healthStatsUptime30d', '30 days'), stats?.uptime30d],
        ];
        const noData = this.t('dashboard.healthStatsNoData', 'no data');
        const tiles = windows.map(([label, win]) => {
            const value = this.formatUptime(win);
            const samples = Number(win?.samples) || 0;
            const cls = value ? '' : ' health-monitor-stat--empty';
            const sub = samples
                ? this.t('dashboard.healthStatsChecks', '{count} checks', { count: samples })
                : '';
            return `<div class="health-monitor-stat${cls}">
                <span class="health-monitor-stat-label">${this.escape(label)}</span>
                <span class="health-monitor-stat-value">${this.escape(value || noData)}</span>
                ${sub ? `<span class="health-monitor-stat-sub">${this.escape(sub)}</span>` : ''}
            </div>`;
        }).join('');
        return `<div class="health-monitor-stat-grid">${tiles}</div>`;
    }

    /** Interval, total checks and last sample — the facts behind the chart. */
    renderMonitorMeta(stats) {
        const parts = [];
        if (stats?.intervalMinutes) {
            parts.push(this.t('dashboard.healthStatsInterval', 'Every {mins} min', { mins: stats.intervalMinutes }));
        }
        if (Number(stats?.totalChecks) > 0) {
            parts.push(this.t('dashboard.healthStatsTotalChecks', '{count} checks recorded', { count: stats.totalChecks }));
        }
        if (stats?.lastSample) {
            parts.push(this.t('dashboard.healthStatsLastCheck', 'Last check {when}', {
                when: new Date(stats.lastSample).toLocaleString(),
            }));
        }
        if (!stats?.downSince && Number(stats?.lastPingMs) > 0) {
            parts.push(`${stats.lastPingMs}ms`);
        }
        if (!parts.length) return '';
        return `<p class="health-monitor-meta">${parts.map((p) => this.escape(p)).join(' · ')}</p>`;
    }

    /** The modal body. Built from the loaded report — no extra request. */
    buildMonitorStatsHtml(issue) {
        const stats = issue?.monitorStats || {};
        const down = stats.downSince
            ? `<p class="health-monitor-stats-down">${this.escape(
                this.t('dashboard.healthDownSince', 'Down for {duration}', {
                    duration: this.formatDuration(Date.now() - stats.downSince),
                })
            )}</p>`
            : '';

        const chart = this.renderSparkline(stats, {
            w: 620,
            h: 160,
            detail: true,
            className: 'health-sparkline health-sparkline--large',
        });
        // The readout sits under the chart rather than floating over it: a tooltip
        // that follows the pointer cannot be read on a touch screen and vanishes
        // the moment you look away from it.
        const chartBlock = chart
            ? `<div class="health-monitor-chart">${chart}</div>
               <div class="health-monitor-readout" data-health-readout aria-live="polite">
                   <span class="health-monitor-readout-hint">${this.escape(
                       this.t('dashboard.healthStatsPointHint', 'Select a point on the chart to read its response time.')
                   )}</span>
               </div>`
            : `<p class="health-monitor-chart-empty">${this.escape(
                this.t('dashboard.healthStatsNoChart', 'Not enough response-time data to draw a chart yet.')
            )}</p>`;

        const heartbeat = this.renderHeartbeat(stats);
        const incidents = this.renderIncidents(issue)
            || `<p class="health-view-score-intro">${this.escape(
                this.t('dashboard.healthStatsNoIncidents', 'No outages recorded.')
            )}</p>`;

        return `<div class="health-monitor-stats">
            ${down}
            <p class="health-monitor-stats-url">${this.escape(this.formatUrlDisplay(issue?.url))}</p>
            ${this.renderUptimeTiles(stats)}
            <p class="health-monitor-stats-heading">${this.escape(this.t('dashboard.healthStatsResponse', 'Response time'))}</p>
            ${chartBlock}
            ${heartbeat ? `<div class="health-monitor-stats-heartbeat">${heartbeat}</div>` : ''}
            ${this.renderMonitorMeta(stats)}
            <div class="health-monitor-stats-incidents">${incidents}</div>
        </div>`;
    }

    /**
     * Enlarge one row's monitoring statistics in a modal.
     *
     * Escape needs no special handling here: this view's own Escape handler bows
     * out while a modal is open (isModalOpen sees #app-modal.show), so Escape
     * closes the modal and leaves the list behind it untouched.
     */
    openMonitorStats(issue) {
        if (!this.hasMonitorStats(issue)) return;
        // The button can be reached from an open menu; leaving it open would strand
        // it behind the overlay.
        this.closeAllMenus();
        window.nextdashTrack?.('health:monitor-stats');

        const title = issue.name || issue.previewTitle || this.formatUrlDisplay(issue.url);
        if (typeof window.AppModal?.show !== 'function') return;
        window.AppModal.show({
            title,
            htmlMessage: this.buildMonitorStatsHtml(issue),
            confirmText: this.t('dashboard.healthStatsClose', 'Close'),
            showCancel: false,
            modalClass: 'health-monitor-stats-modal',
            modalMaxWidth: '44rem',
            // Focus returns to the row, not the toolbar, so j/k keep working where
            // the user left off.
            onHide: () => {
                this.applyKeyboardSelection();
            },
        });
        // show() is synchronous and has already written the body into #modal-text.
        this.bindMonitorChart(issue);
    }

    /**
     * Make the enlarged chart readable: clicking, hovering or tabbing to a point
     * writes its response time and measurement time into the readout under the
     * chart, and ←/→ walk the series from a selected point.
     *
     * Bound per open. The modal replaces #modal-text wholesale on the next show(),
     * so the listeners go with it and there is nothing to tear down.
     */
    bindMonitorChart(issue) {
        const modalText = document.getElementById('modal-text');
        const svg = modalText?.querySelector('.health-sparkline--large');
        const readout = modalText?.querySelector('[data-health-readout]');
        if (!svg || !readout) return;

        const buckets = Array.isArray(issue?.monitorStats?.heartbeat) ? issue.monitorStats.heartbeat : [];
        const hits = Array.from(svg.querySelectorAll('.health-sparkline-hit'));
        if (!hits.length) return;

        const select = (index, { focus = false } = {}) => {
            const bucket = buckets[index];
            if (!bucket) return;
            svg.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
            const hit = svg.querySelector(`.health-sparkline-hit[data-point="${index}"]`);
            const dot = svg.querySelector(`.health-sparkline-dot[data-point="${index}"]`);
            hit?.classList.add('is-selected');
            dot?.classList.add('is-selected');
            // Move the single tab stop to the selected point, so tabbing back into
            // the chart returns to where the user left it.
            if (hit) {
                hits.forEach((el) => el.setAttribute('tabindex', '-1'));
                hit.setAttribute('tabindex', '0');
            }
            if (focus && hit) hit.focus({ preventScroll: true });

            const ms = Number(bucket.avgMs) || 0;
            // from/to, not a single instant: a bucket folds every check in its
            // slice of time, so claiming one timestamp would overstate precision.
            const when = new Date(bucket.from).toLocaleString();
            const checks = (Number(bucket.up) || 0) + (Number(bucket.down) || 0);
            readout.innerHTML = `
                <span class="health-monitor-readout-value">${this.escape(`${ms}ms`)}</span>
                <span class="health-monitor-readout-when">${this.escape(when)}</span>
                ${checks ? `<span class="health-monitor-readout-checks">${this.escape(
                    this.t('dashboard.healthStatsChecks', '{count} checks', { count: checks })
                )}</span>` : ''}
                <span class="health-monitor-readout-state is-${this.escape(bucket.state)}">${this.escape(
                    this.heartbeatStateLabel(bucket.state)
                )}</span>`;
        };

        const indexOf = (el) => Number(el?.dataset?.point);
        const step = (from, dir) => {
            const order = hits.map(indexOf);
            const at = order.indexOf(from);
            // Walks measured points only — stepping onto a gap would blank the
            // readout with nothing to show.
            const next = order[at + dir];
            return next === undefined ? null : next;
        };

        // Only the hit columns carry pointer events (the dots are pointer-events:
        // none in CSS), so matching on them alone covers the whole plot.
        svg.addEventListener('click', (e) => {
            const hit = e.target.closest('.health-sparkline-hit');
            if (hit) select(indexOf(hit), { focus: true });
        });
        svg.addEventListener('mousemove', (e) => {
            const hit = e.target.closest('.health-sparkline-hit');
            if (hit) select(indexOf(hit));
        });
        svg.addEventListener('focusin', (e) => {
            const hit = e.target.closest('.health-sparkline-hit');
            if (hit) select(indexOf(hit));
        });
        svg.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            const current = indexOf(e.target.closest('.health-sparkline-hit'));
            if (Number.isNaN(current)) return;
            const next = step(current, e.key === 'ArrowRight' ? 1 : -1);
            if (next === null) return;
            // Escape and Tab stay the modal's; only the arrows are ours.
            e.preventDefault();
            e.stopPropagation();
            select(next, { focus: true });
        });

        // Open on the most recent measurement rather than an empty readout: it is
        // the value the user came to see, and it shows what the chart can do.
        const last = hits[hits.length - 1];
        if (last) select(indexOf(last));
    }

    /** Bucket state as a word, shared by the readout and the heartbeat tooltips. */
    heartbeatStateLabel(state) {
        const labels = {
            up: this.t('dashboard.healthStateUp', 'Up'),
            down: this.t('dashboard.healthStateDown', 'Down'),
            degraded: this.t('dashboard.healthStateDegraded', 'Degraded'),
            unknown: this.t('dashboard.healthHeartbeatNoData', 'No data'),
        };
        return labels[state] || state || '';
    }

    /** Incident history, shown inside the expandable score panel. */
    renderIncidents(issue) {
        const incidents = Array.isArray(issue?.monitorStats?.incidents) ? issue.monitorStats.incidents : [];
        if (!incidents.length) return '';
        const rows = incidents.map((inc) => {
            const when = new Date(inc.start).toLocaleString();
            // durationMs is the server's field name (HealthIncident.Duration);
            // reading `duration` gave every closed outage a length of "0s".
            const length = inc.ongoing
                ? this.t('dashboard.healthIncidentOngoing', 'ongoing — {duration}', { duration: this.formatDuration(Date.now() - inc.start) })
                : this.formatDuration(inc.durationMs ?? inc.duration);
            // Only HTTP-level failures carry a reason; a network-level outage has
            // no code to report, so the row stays as it was.
            const reason = inc.reason
                ? ` <span class="health-view-score-item-reason">${this.escape(window.HealthReasonUtils.translateReason(this.dash.language, inc.reason))}</span>`
                : '';
            return `<li class="health-view-score-item${inc.ongoing ? ' is-ongoing' : ''}">
                <span>${this.escape(when)}${reason}</span>
                <span class="health-view-score-item-cost">${this.escape(length)}</span>
            </li>`;
        }).join('');
        return `
            <p class="health-view-score-intro">${this.escape(this.t('dashboard.healthIncidentsTitle', 'Recent outages'))}</p>
            <ul class="health-view-score-list">${rows}</ul>`;
    }

    /**
     * One line in the expanded panel explaining what this row's check mode does —
     * and, for unmonitored rows, what turning Monitor on would add. This is where
     * "why no heartbeat here?" gets answered.
     */
    renderCheckModeNote(issue) {
        let text;
        if (issue?.monitor) {
            const mins = issue?.monitorStats?.intervalMinutes;
            text = mins
                ? this.t('dashboard.healthCheckNoteMonitor', 'Monitored every {mins} min — uptime, heartbeat and outages are recorded.', { mins })
                // Via CheckMode rather than the key directly: that module owns the
                // per-mode wording, so a reworded hint reaches every surface at once.
                : window.CheckMode.meta(window.CheckMode.MONITOR).hint;
        } else if (issue?.checkStatus) {
            text = this.t('dashboard.healthCheckNotePeriodic', 'Checked about once a day: breakage is caught, but no uptime history is kept. Switch to Monitor for a heartbeat and outage history.');
        } else {
            text = this.t('dashboard.healthCheckNoteOff', 'Availability checking is off for this bookmark, so it is never tested and cannot be flagged as broken.');
        }
        return `<p class="health-view-check-note">${this.escape(text)}</p>`;
    }

    renderScorePanel(issue) {
        const entries = this.reasonEntries(issue);
        // Outage history is worth showing even at a perfect score: a bookmark can
        // be flawless as a link and still have been unreachable last night.
        const incidents = this.renderIncidents(issue) + this.renderCheckModeNote(issue);
        if (!entries.length) {
            return `<p class="health-view-score-intro">${this.escape(this.t('dashboard.healthScorePerfect', 'No issues found — full score.'))}</p>${incidents}`;
        }
        const rows = entries.map((entry) => `
            <li class="health-view-score-item">
                <span>${this.escape(entry.label)}</span>
                ${entry.penalty > 0 ? `<span class="health-view-score-item-cost">−${this.escape(entry.penalty)}</span>` : ''}
            </li>`).join('');
        return `
            <p class="health-view-score-intro">${this.escape(this.t('dashboard.healthScoreIntro', 'Every bookmark starts at 100. This one loses:'))}</p>
            <ul class="health-view-score-list">${rows}</ul>
            <p class="health-view-score-total">
                <span>${this.escape(this.t('dashboard.healthScoreTotal', 'Score'))}</span>
                <span class="health-view-score-total-value">${this.escape(issue.score)}</span>
            </p>
            ${incidents}`;
    }

    /**
     * The overflow menu. Deliberately does NOT repeat Open, Re-check or Edit —
     * those are buttons on the row itself. Repair entries only appear for a broken
     * row; on a healthy one they would be actions that cannot help.
     */
    renderRowMenu(issue, key) {
        const items = [];
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="dashboard">${this.escape(this.t('dashboard.healthOpenInDashboard', 'Show on dashboard'))}</button>`);

        if (this.isHealable(issue)) {
            items.push(`<p class="health-view-menu-label" role="presentation">${this.escape(this.t('dashboard.healthMenuRepair', 'Repair'))}</p>`);
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="redirect">${this.escape(this.t('dashboard.healthDetectRedirect', 'Detect redirect'))}</button>`);
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="title">${this.escape(this.t('dashboard.healthRefreshTitle', 'Refresh title'))}</button>`);
        }
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="favicon">${this.escape(this.t('dashboard.healthRefreshFavicon', 'Refresh favicon'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="archive">${this.escape(this.t('dashboard.healthArchive', 'Find in Web Archive'))}</button>`);
        // Same two entries the dashboard's right-click menu carries, under the
        // same labels. A row here is a bookmark like any other, and having to go
        // back to the dashboard to copy or send one is the kind of detour this
        // menu exists to avoid.
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="copy-url">${this.escape(this.t('dashboard.contextMenuCopyUrl', 'Copy URL'))}</button>`);
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="share">${this.escape(this.shareActionLabel())}</button>`);
        // The discoverable route to the mode: the badge is faster, but nothing
        // announces that a badge is clickable, whereas this menu is where people
        // already look for row actions. No group label of its own — the item names
        // the mode it would change, and a heading per entry makes a short menu
        // read like a form.
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="checkmode">${this.escape(
            this.t('dashboard.healthMenuCheckMode', 'Change checking ({mode})', { mode: this.checkModeMeta(this.checkModeOf(issue)).label })
        )}</button>`);
        items.push(`<p class="health-view-menu-label health-view-menu-label--danger" role="presentation">${this.escape(this.t('dashboard.healthMenuRemove', 'Remove'))}</p>`);
        items.push(`<button type="button" class="health-view-menu-item health-view-menu-item--danger" role="menuitem" data-menu-action="delete">${this.escape(this.t('dashboard.healthDelete', 'Delete bookmark'))}</button>`);

        return `<div class="health-view-menu" role="menu" hidden data-menu-for="${this.escape(key)}" data-menu-owner="more" aria-label="${this.escape(this.t('dashboard.healthMore', 'More actions'))}">${items.join('')}</div>`;
    }

    createIssueElement(issue) {
        const key = this.issueKey(issue);
        const row = document.createElement('article');
        const broken = issue.status === 'broken';
        row.className = `health-view-item ${this.bandClass(issue.score)}`;
        if (broken) {
            row.classList.add('is-broken');
        } else if (this.scoreClass(issue.score) === 'warn') {
            row.classList.add('is-warn');
        }
        row.dataset.healthKey = key;
        row.tabIndex = -1;
        row.setAttribute('aria-selected', 'false');

        const title = issue.name || issue.previewTitle || this.formatUrlDisplay(issue.url);
        const domain = this.formatUrlDisplay(issue.url);
        const reasons = this.reasonEntries(issue);
        const primaryReason = reasons[0]?.label || '';
        const extraReasons = reasons.length > 1
            ? this.t('dashboard.healthMoreReasons', '+{count} more', { count: reasons.length - 1 })
            : '';
        const expanded = this.expandedScores.has(key);
        const iconSrc = this.resolveIssueIconSrc(issue.icon);
        const icon = iconSrc
            ? `<img class="health-view-item-icon-img" src="${this.escape(iconSrc)}" alt="" loading="lazy">`
            : '🔗';

        row.innerHTML = `
            <div class="health-view-item-icon" aria-hidden="true">${icon}</div>
            <div class="health-view-item-body">
                <div class="health-view-item-head">
                    <h3 class="health-view-item-title">${this.escape(title)}</h3>
                    <button type="button" class="health-view-item-score" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${this.escape(this.t('dashboard.healthScoreToggle', 'Score {score} — show breakdown', { score: issue.score }))}">
                        ${this.escape(issue.score)}<span class="health-view-item-score-caret" aria-hidden="true">▸</span>
                    </button>
                </div>
                <p class="health-view-item-meta">
                    <span>${this.escape(domain)}</span>
                    <span class="health-check-mode-wrap">
                        ${this.renderCheckModeBadge(issue, key)}
                        ${this.renderCheckModeMenu(issue, key)}
                    </span>
                    ${this.renderLastOpened(issue)}
                    ${primaryReason ? `<span class="health-view-item-reason">${this.escape(primaryReason)}</span>` : ''}
                    ${extraReasons ? `<span>${this.escape(extraReasons)}</span>` : ''}
                </p>
                ${this.renderMonitorStrip(issue)}
                <div class="health-view-score-panel" ${expanded ? '' : 'hidden'}>${this.renderScorePanel(issue)}</div>
                <div class="health-view-item-actions">
                    <div class="health-view-item-actions-inner">
                        <button type="button" class="health-view-action-btn" data-health-action="recheck">${this.escape(this.t('dashboard.healthRecheck', 'Re-check'))}<kbd>p</kbd></button>
                        <button type="button" class="health-view-action-btn" data-health-action="open">${this.escape(this.t('dashboard.healthOpen', 'Open'))}</button>
                        <button type="button" class="health-view-action-btn" data-health-action="edit">${this.escape(this.t('dashboard.healthEdit', 'Edit'))}</button>
                        <div class="health-view-menu-wrap">
                            <button type="button" class="health-view-action-btn health-view-more-btn" aria-haspopup="menu" aria-expanded="false" data-menu-toggle="${this.escape(key)}" data-menu-kind="more" aria-label="${this.escape(this.t('dashboard.healthMore', 'More actions'))}">${this.escape(this.t('dashboard.healthMore', 'More'))}<kbd>m</kbd></button>
                            ${this.renderRowMenu(issue, key)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        const iconImg = row.querySelector('.health-view-item-icon-img');
        iconImg?.addEventListener('error', () => {
            const slot = iconImg.parentElement;
            iconImg.remove();
            if (slot) slot.textContent = '🔗';
        }, { once: true });

        row.querySelector('.health-view-item-score')?.addEventListener('click', () => {
            this.selectRowByKey(key);
            this.toggleScorePanel(key);
        });
        row.querySelector('[data-health-action="recheck"]')?.addEventListener('click', () => {
            void this.recheckIssue(issue);
        });
        row.querySelector('[data-health-action="open"]')?.addEventListener('click', () => {
            this.openIssue(issue);
        });
        row.querySelector('[data-health-action="edit"]')?.addEventListener('click', () => {
            void this.editIssueInline(issue);
        });
        row.querySelector('[data-health-action="stats"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectRowByKey(key);
            this.openMonitorStats(issue);
        });
        row.querySelector('.health-view-more-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectRowByKey(key);
            this.toggleMenu(key, 'more');
        });
        row.querySelector('.health-check-mode')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectRowByKey(key);
            this.toggleMenu(key, 'check');
        });
        row.querySelectorAll('[data-check-mode]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.setCheckMode(issue, item.getAttribute('data-check-mode'));
            });
        });

        const menuActions = {
            dashboard: () => this.openIssueInDashboard(issue),
            redirect: () => void this.detectRedirect(issue),
            title: () => void this.refreshTitle(issue),
            favicon: () => void this.refreshFavicon(issue),
            archive: () => this.openArchive(issue),
            'copy-url': () => this.copyIssueUrl(issue),
            share: () => void this.shareIssue(issue),
            delete: () => void this.deleteIssue(issue),
            // Hand off to the popover rather than duplicating the three options
            // here, so there is one place that explains what the modes mean.
            checkmode: () => this.toggleMenu(key, 'check'),
        };
        row.querySelectorAll('[data-menu-action]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                menuActions[item.getAttribute('data-menu-action')]?.();
            });
        });

        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            this.selectRowByKey(key);
        });
        row.addEventListener('dblclick', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            this.openIssue(issue);
        });

        return row;
    }
}

window.DashboardHealth = DashboardHealth;
