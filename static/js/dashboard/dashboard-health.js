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
        this.expandedScores = new Set();
        this._searchRenderTimer = null;
        this._searchFocusPending = false;
        this._loadPromise = null;
        this._busyKeys = new Set();
    }

    isEnabled() {
        return this.dash.settings?.healthViewEnabled !== false;
    }

    isActiveView() {
        return this.dash.activeView === DashboardHealth.VIEW;
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
     */
    fetchReport({ refresh = false } = {}) {
        if (this._loadPromise) {
            return this._loadPromise;
        }
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

    consumeLegacyEntryParams() {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        const filters = new Set(['all', 'broken', 'duplicate', 'shortcut-conflict', 'unchecked', 'stale', 'unused', 'missing-preview', 'healthy']);
        const sorts = new Set(['score', 'status', 'last-checked', 'last-checked-desc', 'name']);
        let refresh = false;
        let consumed = false;

        const filter = (params.get('hv_filter') || '').toLowerCase();
        if (filter && filters.has(filter)) {
            this.filter = filter;
            consumed = true;
        }

        const query = params.get('hv_q');
        if (typeof query === 'string' && query.trim() !== '') {
            this.searchQuery = query.trim();
            consumed = true;
        }

        const sort = (params.get('hv_sort') || '').toLowerCase();
        if (sort && sorts.has(sort)) {
            this.sort = sort;
            consumed = true;
        }

        const refreshRaw = (params.get('hv_refresh') || '').toLowerCase();
        if (refreshRaw === '1' || refreshRaw === 'true') {
            refresh = true;
            consumed = true;
        }

        if (consumed) {
            params.delete('hv_filter');
            params.delete('hv_q');
            params.delete('hv_sort');
            params.delete('hv_refresh');
            const nextQuery = params.toString();
            const nextUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}#health`;
            history.replaceState(history.state, '', nextUrl);
        }

        return { refresh };
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
        d.activeView = DashboardHealth.VIEW;
        d.pageNav?.setActiveHealthTab?.();
        d.pageNav?.updateDocumentTitle?.();
        const legacyEntry = this.consumeLegacyEntryParams();
        await this.loadAndRender({ refresh: legacyEntry.refresh });
        this.restoreHealthHash();
        return true;
    }

    closeHealthView() {
        const d = this.dash;
        if (d.activeView !== DashboardHealth.VIEW) {
            return false;
        }
        this.clearKeyboardSelection();
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
                const key = openMenu.getAttribute('data-menu-for');
                this.closeAllMenus();
                document.querySelector(`.health-view-more-btn[data-menu-toggle="${CSS.escape(key)}"]`)
                    ?.focus({ preventScroll: true });
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
            // stale / unused / missing-preview / shortcut-conflict / healthy reach
            // this view only through deep links (consumeLegacyEntryParams). Each maps
            // to a single issue.status, so match on that rather than falling through
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

    /* ── Keyboard ──────────────────────────────────────────────────────── */

    getVisibleRows() {
        return Array.from(document.querySelectorAll('.health-view-feed .health-view-item'));
    }

    selectRowByKey(key) {
        const next = String(key || '').trim();
        if (!next) return;
        this.selectedKey = next;
        this.applyKeyboardSelection();
    }

    moveKeyboardSelection(delta, rows) {
        const list = Array.isArray(rows) && rows.length ? rows : this.getVisibleRows();
        if (!list.length) return;
        let index = this.selectedKey
            ? list.findIndex((row) => row.dataset.healthKey === this.selectedKey)
            : -1;
        if (index < 0) {
            index = delta > 0 ? 0 : list.length - 1;
        } else {
            index += delta;
            if (index < 0) index = list.length - 1;
            else if (index >= list.length) index = 0;
        }
        this.selectedKey = list[index]?.dataset?.healthKey || null;
        this.applyKeyboardSelection(list);
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
            this.toggleMenu(this.selectedKey);
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
        if ((e.key === 'Enter' || e.key === ' ') && this.selectedKey) {
            const issue = this.selectedIssue();
            if (issue) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.openIssue(issue);
            }
            return true;
        }
        if (e.key === 'g') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedKey = rows[0]?.dataset?.healthKey || null;
            this.applyKeyboardSelection(rows);
            return true;
        }
        if (e.key === 'G') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.selectedKey = rows[rows.length - 1]?.dataset?.healthKey || null;
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
            if (e.target.closest?.('.health-view-menu-wrap')) return;
            this.closeAllMenus();
        };
        document.addEventListener('click', this._outsideMenuHandler, true);
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

    openIssue(issue) {
        const url = String(issue?.url || '').trim();
        if (!url) return;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Edit the bookmark in place: leave the health view, deep-link to the row on its
     * own page, and open the dashboard's inline editor there (?edit=1). Falls back to
     * the config bookmarks list when the deep-link helper isn't available.
     */
    editIssueInline(issue) {
        this.closeAllMenus();
        const pageId = Number(issue?.pageId);
        if (Number.isFinite(pageId) && typeof DashboardDeepLink?.buildDashboardDeepLink === 'function') {
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
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;

        const persist = async (status, errorDetail, pingMs) => {
            const cacheURL = this.canonicalUrl(url);
            if (cacheURL) {
                await fetcher('/api/health/cache-scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: cacheURL, status, pingMs: pingMs || 0, error: errorDetail }),
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
            await persist(status, errorDetail, result.ping);
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
        document.querySelectorAll('.health-view-more-btn').forEach((btn) => {
            btn.setAttribute('aria-expanded', 'false');
        });
    }

    toggleMenu(key) {
        const menu = document.querySelector(`.health-view-menu[data-menu-for="${CSS.escape(key)}"]`);
        const btn = document.querySelector(`.health-view-more-btn[data-menu-toggle="${CSS.escape(key)}"]`);
        if (!menu || !btn) return;
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

    /** AppModal.confirm when it exists, window.confirm as the fallback. */
    async confirm(title, message, { danger = false } = {}) {
        if (typeof window.AppModal?.confirm === 'function') {
            return Boolean(await window.AppModal.confirm({
                title: title || '',
                message,
                confirmText: danger
                    ? this.t('dashboard.healthDeleteAction', 'Delete')
                    : this.t('dashboard.healthConfirmAction', 'Confirm'),
                cancelText: this.t('dashboard.healthCancel', 'Cancel'),
                confirmClass: danger ? 'danger' : '',
            }));
        }
        return window.confirm(message);
    }

    /* ── Render ────────────────────────────────────────────────────────── */

    scheduleSearchRender() {
        if (this._searchRenderTimer) {
            clearTimeout(this._searchRenderTimer);
        }
        this._searchRenderTimer = setTimeout(() => {
            this._searchRenderTimer = null;
            this.render();
        }, 80);
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

        container.innerHTML = '';
        container.className = 'health-layout';
        container.removeAttribute('aria-colcount');
        container.removeAttribute('aria-rowcount');
        container.setAttribute('role', 'feed');
        container.setAttribute('aria-label', this.t('dashboard.healthPageTitle', 'Health'));
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
            `;
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
        visible.forEach((issue) => feed.appendChild(this.createIssueElement(issue)));
        container.appendChild(feed);
        this.bindOutsideMenuDismiss();

        if (filtered.length > this.visibleLimit) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'health-view-load-more-btn';
            const remaining = filtered.length - this.visibleLimit;
            more.textContent = this.t('dashboard.healthLoadMore', 'Show {count} more', { count: remaining });
            more.addEventListener('click', () => {
                this.visibleLimit += 50;
                this.render();
            });
            container.appendChild(more);
        }

        container.appendChild(this.renderLegend());
        this.bindPointerNavigation(container);
        this.finishRenderFocus(container, preserveSearch, searchCaret);
    }

    renderHeader() {
        const summary = this.report?.summary || {};
        const total = Number(summary.totalBookmarks) || 0;
        const healthy = Number(summary.healthyCount) || 0;
        const score = total > 0 ? Math.round((healthy / total) * 100) : 100;
        const broken = this.brokenCount();

        const header = document.createElement('div');
        header.className = 'health-view-header';
        header.innerHTML = `
            <div class="health-view-header-text">
                <h2 class="health-view-title">${this.escape(this.t('dashboard.healthPageTitle', 'Health'))}</h2>
                <p class="health-view-subtitle">${this.escape(this.t('dashboard.healthPageSubtitle', 'Bookmarks that need attention'))}</p>
            </div>
            <div class="health-view-header-meta">
                <span class="health-view-score-badge ${this.bandClass(score)}">${score}</span>
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

        const tiles = [
            { key: 'all', label: this.t('dashboard.healthTileTotal', 'Total'), value: total, tone: 'neutral' },
            { key: null, label: this.t('dashboard.healthTileHealthy', 'Healthy'), value: healthy, tone: 'good' },
            { key: 'broken', label: this.t('dashboard.healthTileBroken', 'Broken'), value: Number(summary.brokenCount) || 0, tone: 'bad' },
            { key: 'duplicate', label: this.t('dashboard.healthTileDuplicates', 'Duplicates'), value: Number(summary.duplicateCount) || 0, tone: 'warn' },
            { key: 'unchecked', label: this.t('dashboard.healthTileUnchecked', 'Unchecked'), value: Number(summary.uncheckedCount) || 0, tone: 'warn' },
        ];

        const wrap = document.createElement('div');
        wrap.className = 'health-view-tiles';
        wrap.innerHTML = tiles.map((tile) => {
            const active = tile.key && this.filter === tile.key ? ' is-active' : '';
            // Zero problems is good news: drop the severity colour so only a real
            // count is tinted red or orange.
            const zero = tile.value === 0 ? ' health-view-tile--zero' : '';
            const cls = `health-view-tile health-view-tile--${tile.tone}${zero}${active}`;
            if (!tile.key) {
                return `<article class="${cls}">
                    <span class="health-view-tile-label">${this.escape(tile.label)}</span>
                    <span class="health-view-tile-value">${this.escape(tile.value)}</span>
                </article>`;
            }
            return `<button type="button" class="${cls}" data-health-tile="${tile.key}" tabindex="-1" aria-label="${this.escape(tile.label)}: ${this.escape(tile.value)}">
                <span class="health-view-tile-label">${this.escape(tile.label)}</span>
                <span class="health-view-tile-value">${this.escape(tile.value)}</span>
            </button>`;
        }).join('');

        wrap.querySelectorAll('[data-health-tile]').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.filter = btn.getAttribute('data-health-tile') || 'broken';
                this.visibleLimit = 50;
                this.render();
            });
        });
        return wrap;
    }

    renderToolbar() {
        const filters = [
            ['broken', this.t('dashboard.healthFilterBroken', 'Broken')],
            ['duplicate', this.t('dashboard.healthFilterDuplicates', 'Duplicates')],
            ['unchecked', this.t('dashboard.healthFilterUnchecked', 'Never checked')],
            ['all', this.t('dashboard.healthFilterAll', 'All')],
        ];

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
            <button type="button" class="health-view-retest-btn">${this.escape(this.t('dashboard.healthRetest', 'Retest all'))}</button>
        `;

        const sortSelect = toolbar.querySelector('.health-view-sort-select');
        sortSelect?.addEventListener('change', (e) => {
            this.sort = e.target.value || 'score';
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
                this.visibleLimit = 50;
                this.render();
            });
        });

        const searchInput = toolbar.querySelector('.health-view-search-input');
        searchInput?.addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.visibleLimit = 50;
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

        return toolbar;
    }

    /**
     * Retest every eligible bookmark. The button is disabled for the duration
     * rather than debounced: this can take minutes, and the disabled state is
     * the only honest signal that it is still running.
     */
    async retestAll(button) {
        if (this._retestRunning) return;
        this._retestRunning = true;
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
            all: [
                this.t('dashboard.healthEmptyAll', 'No issues found'),
                this.t('dashboard.healthEmptyAllHint', 'Every bookmark scores full marks.'),
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
        const keys = [
            ['j / k', this.t('dashboard.healthKeyMove', 'move')],
            ['s', this.t('dashboard.healthKeyScore', 'score')],
            ['p', this.t('dashboard.healthKeyRecheck', 're-check')],
            ['m', this.t('dashboard.healthKeyMore', 'more actions')],
            ['Enter', this.t('dashboard.healthKeyOpen', 'open')],
            ['g / G', this.t('dashboard.healthKeyFirstLast', 'first / last')],
            ['Esc', this.t('dashboard.healthKeyClose', 'back to bookmarks')],
        ];
        legend.innerHTML = keys
            .map(([k, label]) => `<span><kbd>${this.escape(k)}</kbd> ${this.escape(label)}</span>`)
            .join('');
        return legend;
    }

    renderScorePanel(issue) {
        const entries = this.reasonEntries(issue);
        if (!entries.length) {
            return `<p class="health-view-score-intro">${this.escape(this.t('dashboard.healthScorePerfect', 'No issues found — full score.'))}</p>`;
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
            </p>`;
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
        items.push(`<p class="health-view-menu-label health-view-menu-label--danger" role="presentation">${this.escape(this.t('dashboard.healthMenuRemove', 'Remove'))}</p>`);
        items.push(`<button type="button" class="health-view-menu-item health-view-menu-item--danger" role="menuitem" data-menu-action="delete">${this.escape(this.t('dashboard.healthDelete', 'Delete bookmark'))}</button>`);

        return `<div class="health-view-menu" role="menu" hidden data-menu-for="${this.escape(key)}" aria-label="${this.escape(this.t('dashboard.healthMore', 'More actions'))}">${items.join('')}</div>`;
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
        const icon = issue.icon
            ? `<img src="${this.escape(issue.icon)}" alt="" loading="lazy">`
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
                    ${primaryReason ? `<span class="health-view-item-reason">${this.escape(primaryReason)}</span>` : ''}
                    ${extraReasons ? `<span>${this.escape(extraReasons)}</span>` : ''}
                </p>
                <div class="health-view-score-panel" ${expanded ? '' : 'hidden'}>${this.renderScorePanel(issue)}</div>
                <div class="health-view-item-actions">
                    <div class="health-view-item-actions-inner">
                        <button type="button" class="health-view-action-btn" data-health-action="recheck">${this.escape(this.t('dashboard.healthRecheck', 'Re-check'))}<kbd>p</kbd></button>
                        <button type="button" class="health-view-action-btn" data-health-action="open">${this.escape(this.t('dashboard.healthOpen', 'Open'))}</button>
                        <button type="button" class="health-view-action-btn" data-health-action="edit">${this.escape(this.t('dashboard.healthEdit', 'Edit'))}</button>
                        <div class="health-view-menu-wrap">
                            <button type="button" class="health-view-action-btn health-view-more-btn" aria-haspopup="menu" aria-expanded="false" data-menu-toggle="${this.escape(key)}" aria-label="${this.escape(this.t('dashboard.healthMore', 'More actions'))}">${this.escape(this.t('dashboard.healthMore', 'More'))}<kbd>m</kbd></button>
                            ${this.renderRowMenu(issue, key)}
                        </div>
                    </div>
                </div>
            </div>
        `;

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
            this.editIssueInline(issue);
        });
        row.querySelector('.health-view-more-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectRowByKey(key);
            this.toggleMenu(key);
        });

        const menuActions = {
            dashboard: () => this.openIssueInDashboard(issue),
            redirect: () => void this.detectRedirect(issue),
            title: () => void this.refreshTitle(issue),
            favicon: () => void this.refreshFavicon(issue),
            archive: () => this.openArchive(issue),
            delete: () => void this.deleteIssue(issue),
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
