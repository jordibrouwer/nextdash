/**
 * Health view — bookmark health as a dashboard view, modelled on DashboardInbox.
 */
class DashboardHealth {
    static VIEW = 'health';

    /** Worst first. Mirrors statusRank in health.js so both surfaces agree. */
    static STATUS_RANK = {
        broken: 0,
        // The host answered but not the way this bookmark expects — less urgent
        // than unreachable, still a live failure. Mirrors issueRank in
        // handlers.go so the list and the report agree on the order.
        content: 1,
        duplicate: 2,
        'shortcut-conflict': 3,
        // A bookmark pointing at a category that no longer exists. Grouped with
        // the other data-integrity faults rather than the network ones: it still
        // opens, it has just fallen out of the structure.
        'orphaned-category': 4,
        unchecked: 5,
        stale: 6,
        unused: 7,
        'missing-preview': 8,
        healthy: 9,
        // Last, because it is not a condition but the absence of reporting: a
        // row whose every problem is muted has nothing left to rank it by.
        ignored: 10,
    };

    /**
     * Worst first, for grouping the Monitored filter under the Status sort.
     * Unlike STATUS_RANK this is about live monitor health, not the report's
     * link-hygiene status: a monitored bookmark that is down right now matters
     * more than one that merely drifted, which in turn matters more than a
     * certificate quietly approaching expiry.
     */
    static MONITOR_GROUP_RANK = { down: 0, drift: 1, cert: 2, healthy: 3 };

    /*
     * The conditions a row can be told to stop reporting.
     *
     * Mirrors knownHealthFlags in models.go, which validates what this sends.
     * "healthy" is not one: it is the absence of a problem, and nothing is
     * served by hiding it.
     */
    static IGNORABLE_FLAGS = new Set([
        'broken', 'content', 'duplicate', 'shortcut-conflict', 'orphaned-category',
        'unchecked', 'stale', 'unused', 'missing-preview', 'drift',
    ]);

    /** How long z snoozes for. Long enough to be a season, short enough to come back. */
    static SNOOZE_DAYS = 30;

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
        /**
         * Whether hovering may take the selection.
         *
         * Disarmed whenever a row is focused by name — "Show in Health", a
         * `?hv_id=` link — because the list then draws under a cursor that has
         * not moved, and the browser reports that as a hover.
         */
        this._pointerSelectArmed = true;
        this.expandedScores = new Set();
        // Rows whose expectations panel is open, keyed the same way as
        // expandedScores so both survive a re-render identically.
        this.expandedExpect = new Set();
        /** Collapses the fleet panel's worst/slower/incidents lists, leaving just
         *  the three uptime tiles — a long "All monitors" block otherwise pushes
         *  the row list off screen on a collection with a lot of history. */
        this.fleetDetailsCollapsed = false;
        /**
         * Rows you have acted on that no longer match the active filter, keyed
         * by row with the position they held when you acted. They are put back
         * at that position and shown as handled instead of vanishing: a list you
         * are working through should not close the gap behind you.
         *
         * Dropped whenever the list is asked a different question — another
         * filter, sort or search — or reloaded on purpose.
         */
        this._handledAnchors = new Map();
        /** Group the list by site instead of by status; see groupFilteredIssues. */
        this.groupByHost = false;
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
        // Lazily built: the class ships in its own file and may not have loaded
        // yet when the view is constructed.
        this._multiSelect = null;
        this._focus = null;
    }

    /** Selection across rows, for the bulk toolbar. */
    get multiSelect() {
        if (!this._multiSelect && typeof window.DashboardHealthMultiSelect === 'function') {
            this._multiSelect = new window.DashboardHealthMultiSelect(this);
        }
        return this._multiSelect;
    }

    /** One-at-a-time overlay for working through the filtered list. */
    get focus() {
        if (!this._focus && typeof window.DashboardHealthFocus === 'function') {
            this._focus = new window.DashboardHealthFocus(this);
        }
        return this._focus;
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

    /**
     * What this row has been told not to report, as the server hid it.
     *
     * A report cached before ignores existed carries none, which reads as an
     * empty list rather than an error — the same fallback the flags have.
     */
    ignoredFlagsOf(issue) {
        const entries = Array.isArray(issue?.ignoredFlags) ? issue.ignoredFlags : [];
        return entries.filter((entry) => entry && typeof entry.flag === 'string');
    }

    /**
     * The condition an ignore key acts on for this row.
     *
     * On a filter it is that filter: you narrowed to Stale and are saying "not
     * this one". On All or Ignored there is no such answer, so it falls back to
     * the row's own status — the worst thing that holds, which is what the row
     * is showing you. Filters that are not conditions (all, monitored,
     * certificates, ignored) never answer.
     */
    ignoreTargetFlag(issue) {
        const fromFilter = DashboardHealth.IGNORABLE_FLAGS.has(this.filter) ? this.filter : '';
        if (fromFilter) return fromFilter;
        const status = String(issue?.status || '');
        return DashboardHealth.IGNORABLE_FLAGS.has(status) ? status : '';
    }

    /**
     * What this row is not reporting, said on the row itself.
     *
     * Without it an ignore is invisible from everywhere except the Ignored
     * list, and a toggle with no visible state is a toggle nobody trusts. A
     * snooze says when it comes back, because "hidden" and "hidden until March"
     * are different promises.
     */
    renderIgnoredBadge(issue) {
        const ignored = this.ignoredFlagsOf(issue);
        if (!ignored.length) return '';
        const names = ignored.map((entry) => this.flagLabel(entry.flag)).join(', ');
        const soonest = ignored
            .map((entry) => Number(entry.until) || 0)
            .filter((until) => until > 0)
            .sort((a, b) => a - b)[0] || 0;
        const title = soonest
            ? this.t('dashboard.healthIgnoredUntil', 'Not reported until {date}',
                { date: new Date(soonest).toLocaleDateString() })
            : this.t('dashboard.healthIgnoredHint', 'Not reported for this bookmark');
        return `<span class="health-view-ignored-badge" title="${this.escape(title)}">${this.escape(
            this.t('dashboard.healthIgnoredBadge', 'ignored: {flags}', { flags: names })
        )}</span>`;
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
        /*
         * A bookmark pointed at the Web Archive shows the page it is a copy of.
         *
         * "Use the last archived copy" rewrites the address to
         * web.archive.org/web/20160926060646/https://github.com/, which is
         * correct and unreadable: the row filled with a wayback timestamp and
         * the real site buried in the middle, looking like two URLs run
         * together. The original is the part that identifies the bookmark, so
         * that is what is shown, with a marker saying where it now points.
         */
        const archived = this.archivedOriginalUrl(url);
        if (archived) {
            return `${this.formatUrlDisplay(archived)} ${this.t('dashboard.healthArchivedMarker', '(archived copy)')}`;
        }
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

    /**
     * The page a wayback URL is a capture of, or "" when it is not one.
     *
     * The shape is /web/<timestamp>/<original>, where the original keeps its own
     * scheme -- so the second "https://" in the string is the start of the real
     * address rather than a mistake.
     */
    archivedOriginalUrl(url) {
        const raw = String(url || '');
        const match = raw.match(/^https?:\/\/web\.archive\.org\/web\/[^/]*\/(https?:\/\/.+)$/i);
        return match ? match[1] : '';
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
                // The dashboard's preview cards read health facts from the
                // badge's index; a report fetched here is fresher, so it
                // replaces what the badge left — otherwise a refresh in this
                // view would leave the cards quoting the older figures.
                window.HealthFacts?.remember?.(this.report);
                return this.report;
            })
            .finally(() => {
                this._loadPromise = null;
                this._loadPromiseRefresh = false;
            });
        return this._loadPromise;
    }

    /**
     * Come back to the row that was acted on.
     *
     * Every row action reloads the report, and a render rebuilds the whole list
     * — so the view returned to the top and the reader had to find their place
     * again after doing nothing but act on the row in front of them. Measured on
     * a list scrolled to 727px: it came back at 299.
     *
     * The view already knows how to land on a row (applyPendingIssueFocus, for
     * ?hv_id= deep links); it just was not told which one. Setting it here, at
     * the start of an action, is what makes every action keep its place rather
     * than each one remembering separately.
     */
    keepPlaceAt(issue) {
        const key = issue && this.issueKey(issue);
        if (key) this.focusIssueKey = key;
        // The offset, not just the row: landing the row back on screen is not
        // the same as leaving the reader where they were. Measured on a list
        // scrolled to 727px, the row-only version came back at 299 — in view,
        // but half a screen from where the eye had been.
        this._keepScrollY = window.scrollY || 0;
    }

    async loadAndRender({ refresh = false } = {}) {
        this.loading = !this.report;
        if (this.loading) {
            this.render();
        }
        try {
            /*
             * The credential names ride along with the report rather than being
             * fetched when a panel opens: syncExpectPanel is synchronous and
             * called from a dozen places, and the names are two dozen bytes of
             * labels — cheaper to have than to wait for.
             */
            await Promise.all([this.fetchReport({ refresh }), this.loadHealthCredentials()]);
        } catch {
            if (this.report) {
                this.dash.showNotification?.(
                    this.t('dashboard.healthLoadFailed', 'Unable to load the health report'),
                    'error'
                );
            }
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

    /**
     * Reload the list without moving the reader.
     *
     * The Monitored filter reloads itself on a timer and on returning to the
     * tab. Nobody asked for either, so neither may take the reader's place
     * away: rebuilding the list from nothing lands the page at the top, and a
     * reader partway down a long list was moved while looking at it. Every row
     * action already goes through keepPlaceAt(); these two refreshes are the
     * ones that arrive on their own, which is exactly why they must be quiet.
     *
     * The offset only, without an anchor row: there is no row being acted on
     * here, and pinning one would fight a reader who has scrolled since.
     */
    async refreshKeepingPlace() {
        this._keepScrollY = window.scrollY || 0;
        await this.loadAndRender({ refresh: true });
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
                void this.refreshKeepingPlace();
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
                void this.refreshKeepingPlace();
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

    /**
     * Make the address bar say #health. The moment the URL is final is the
     * moment worth remembering: a push here is what lets Back leave the view,
     * while the filters that follow through syncUrlState stay replaceState.
     */
    restoreHealthHash() {
        if (window.location.hash === '#health') return;
        const next = `${window.location.pathname}${window.location.search}#health`;
        if (!window.DashboardHistory?.pushLocation?.(next)) {
            history.replaceState(history.state, '', next);
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
        window.HealthTutorial?.maybeShow?.();
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
        this.clearHandledRows();
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
            // Focus mode takes Escape before anything else, for the same reason
            // an open menu does below: it is the innermost thing on screen, and
            // closing the whole view instead would throw away the queue the
            // user was working through. This handler is registered when the
            // view loads, ahead of focus mode's own capture listener, so
            // without this the overlay would never see the key at all.
            if (this._focus?.isActive()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._focus.close();
                return;
            }
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
            // An open selection takes Escape before the view does: closing Health
            // outright would lose the list the user was working through, and
            // clearing ticks is the smaller, more likely intent. Checked ahead of
            // the text-field guard below, because ticking a row leaves focus on
            // its checkbox — an INPUT, which that guard would bail out on. A real
            // text field still wins, so Escape in the search box behaves as before.
            const typing = document.activeElement?.tagName === 'TEXTAREA'
                || document.activeElement?.isContentEditable
                || (document.activeElement?.tagName === 'INPUT'
                    && document.activeElement?.type !== 'checkbox');
            if (!typing && this._multiSelect?.isActive()) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this._multiSelect.clear();
                return;
            }
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

    /**
     * Does this issue belong under `filter`?
     *
     * Matched against issue.flags — every condition that holds — rather than
     * issue.status, which carries only the worst one. The tiles count the same
     * way the server does, so matching on status made them disagree: a bookmark
     * that was both a duplicate and never opened was counted by the Unused tile
     * but hidden by the Unused filter, leaving the tile a dead end that opened an
     * empty list.
     *
     * `monitored` is not a health condition and stays on its own field. `all`
     * matches everything.
     */
    matchesFilter(issue, filter) {
        if (filter === 'all') return true;
        if (filter === 'monitored') return issue.monitor === true;
        // Certificates are stored per host rather than per bookmark, so this one
        // is answered from the report's certificate map instead of from the
        // row's own flags -- certFor() already does that lookup for the badge.
        if (filter === 'certificates') return Boolean(this.certFor(issue));
        // Ignored is answered from what the report hid rather than from flags:
        // the whole point is that those conditions are no longer in flags.
        if (filter === 'ignored') return this.ignoredFlagsOf(issue).length > 0;

        const flags = Array.isArray(issue?.flags) ? issue.flags : null;
        if (flags) return flags.includes(filter);

        // Fallback for a report cached before flags existed. Only the worst
        // condition is known there, which is the old behaviour — better than
        // matching nothing at all.
        if (filter === 'duplicate') return (Number(issue.duplicateCount) || 0) > 1;
        if (filter === 'unchecked') return !issue.lastChecked;
        return issue.status === filter;
    }

    matchesQuery(issue, query) {
        if (!query) return true;
        const reasonText = this.reasonEntries(issue).map((entry) => entry.label).join(' ');
        const haystack = [issue.name, issue.url, issue.pageName, issue.category, reasonText]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return haystack.includes(query);
    }

    statusRank(issue) {
        return DashboardHealth.STATUS_RANK[issue?.status] ?? 99;
    }

    /**
     * The tiebreak for the score sort, with the two usage statuses folded into
     * healthy.
     *
     * Opening a bookmark is what this view asks you to do, and it turns "unused"
     * into "healthy" (or into whatever milder flag was behind it). Scores no
     * longer move on an open — the usage penalties are zero — so without this
     * fold the row would still travel the length of an equal-score band the
     * moment you acted on it. Under the Status sort the true rank is kept: there
     * the order *is* the status you asked to sort by.
     */
    stableStatusRank(issue) {
        const rank = DashboardHealth.STATUS_RANK;
        const flags = Array.isArray(issue?.flags) ? issue.flags : null;
        if (flags) {
            // Read from the flags rather than the status, because status is only
            // the worst condition: opening a never-opened row that also has no
            // preview turns "unused" into "missing-preview", a *different* rank,
            // and the row would travel again. The flags are the same set either
            // way, minus the usage one that just went.
            const ranks = flags
                .filter((flag) => flag !== 'unused' && flag !== 'stale')
                .map((flag) => rank[flag])
                .filter((value) => typeof value === 'number');
            return ranks.length ? Math.min(...ranks) : rank.healthy;
        }
        // A report cached before flags existed carries status only.
        const status = issue?.status;
        if (status === 'unused' || status === 'stale') {
            return rank.healthy;
        }
        return this.statusRank(issue);
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
                // so a re-render never reshuffles rows under the cursor. Every
                // part of the key is something acting on the row cannot change:
                // the score ignores usage, the rank folds the usage statuses, and
                // a name is a name.
                return sorted.sort((a, b) => (a.score || 0) - (b.score || 0)
                    || this.stableStatusRank(a) - this.stableStatusRank(b)
                    || byName(a, b));
        }
    }

    getFilteredIssues() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        const query = String(this.searchQuery || '').trim().toLowerCase();
        return this.withHandledRows(this.sortIssues(
            issues
                .filter((issue) => this.matchesFilter(issue, this.filter))
                .filter((issue) => this.matchesQuery(issue, query))
        ), issues);
    }

    /** True while a row is being kept in a list it no longer belongs to. */
    isHandledRow(key) {
        return this._handledAnchors.has(key);
    }

    /**
     * Puts the rows you acted on back where they were.
     *
     * Re-checking a broken link, or opening one the Unused filter selected, is a
     * success — and it took the row out of the filter, closing the gap and
     * moving everything below it up by one, mid-task. Each such row is put back
     * at the position it held, marked handled, and stays until the list is asked
     * a different question or reloaded on purpose.
     */
    withHandledRows(list, allIssues) {
        if (!this._handledAnchors.size) return list;
        const present = new Set(list.map((issue) => this.issueKey(issue)));
        const byKey = new Map(allIssues.map((issue) => [this.issueKey(issue), issue]));
        const out = [...list];
        // Ascending, so an earlier insertion does not push a later anchor off
        // the position it was recorded at.
        [...this._handledAnchors.entries()]
            .sort((a, b) => a[1] - b[1])
            .forEach(([key, index]) => {
                if (present.has(key)) return;
                const issue = byKey.get(key);
                if (!issue) return;
                out.splice(Math.min(index, out.length), 0, issue);
            });
        return out;
    }

    /**
     * Remember where a row sat, in case acting on it takes it out of the filter.
     * Recorded for every action rather than only the ones that do: whether an
     * open or a re-check removes the row depends on the filter and on what the
     * server makes of it, neither of which is known here.
     */
    markRowHandled(issue) {
        const key = this.issueKey(issue);
        if (!key || this._handledAnchors.has(key)) return;
        const index = this.getFilteredIssues().findIndex((row) => this.issueKey(row) === key);
        if (index < 0) return;
        this._handledAnchors.set(key, index);
    }

    /** Drop the anchors — the list is about to answer a different question. */
    clearHandledRows() {
        if (!this._handledAnchors.size) return;
        this._handledAnchors.clear();
    }

    /**
     * Splits an already-filtered-and-sorted page of issues into sections,
     * mirroring how DashboardInbox groups by date.
     *
     * Two groupings, both only under the Status sort — every other sort
     * (score, name, last-checked) has its own ordering that a heading would
     * visually chop into pieces, the same reason Inbox's isGroupedSort()
     * guard exists:
     *
     * - The All filter groups by link-hygiene status (broken, duplicate, …).
     *   Every other filter is already one status or a small related set,
     *   where a heading would add nothing.
     * - The Monitored filter groups by live monitor health (down, drift,
     *   cert warning, healthy) instead — link-hygiene status barely applies
     *   to a monitored row (it is almost always "healthy" in that sense even
     *   while its monitor is down), so reusing STATUS_RANK there would put
     *   nearly everything in one bucket.
     *
     * Call this on the page already sliced to visibleLimit, not on the full
     * filtered array: grouping is a presentation step over what is about to
     * render, so paging math (_bindLoadMoreObserver, prepareIssueFocus) keeps
     * working on the flat array exactly as before.
     */
    groupFilteredIssues(issues) {
        // One host taking everything behind it down produces a screen of rows
        // that look like a screen of problems. Grouped by site they read as what
        // they are — one outage, ten bookmarks — and the group heading carries
        // the count so the scale is visible without counting rows. Works under
        // every filter and sort, because "which site is this" does not depend on
        // either.
        if (this.groupByHost) {
            const buckets = new Map();
            issues.forEach((issue) => {
                const host = this.formatUrlDisplay(issue?.url) || this.t('dashboard.healthNoHost', 'no address');
                if (!buckets.has(host)) buckets.set(host, []);
                buckets.get(host).push(issue);
            });
            return [...buckets.entries()]
                // Worst first, like everything else here: the site with the most
                // rows behind it is the one worth looking at.
                .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
                .map(([host, items]) => ({
                    key: `host:${host}`,
                    label: items.length > 1
                        ? this.t('dashboard.healthHostGroup', '{host} — {count} bookmarks', { host, count: items.length })
                        : host,
                    items,
                }));
        }
        if (this.sort !== 'status' || (this.filter !== 'all' && this.filter !== 'monitored')) {
            return issues.length ? [{ key: 'flat', label: '', items: issues }] : [];
        }
        const order = this.filter === 'monitored'
            ? Object.keys(DashboardHealth.MONITOR_GROUP_RANK)
            : Object.keys(DashboardHealth.STATUS_RANK);
        const classify = this.filter === 'monitored'
            ? (issue) => this.monitorGroupFor(issue)
            : (issue) => (order.includes(issue?.status) ? issue.status : 'healthy');
        const buckets = new Map(order.map((key) => [key, []]));
        issues.forEach((issue) => {
            buckets.get(classify(issue))?.push(issue);
        });
        return order
            .map((key) => ({ key, label: this.filterLabel(key) || key, items: buckets.get(key) || [] }))
            .filter((group) => group.items.length > 0);
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
        // A render replaces every row element, so the ticks have to be painted
        // back on from the key set — the DOM is not where the selection lives.
        if (this._multiSelect?.isActive()) {
            this._multiSelect.prune();
            this._multiSelect.syncRows();
            this._multiSelect.syncToolbar();
        }
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
        // Focus mode captures its own keys at the document, ahead of this
        // handler. Bailing out here as well keeps the list from acting on the
        // same press if that capture is ever bypassed.
        if (this._focus?.isActive()) return false;
        if (window.DashboardTagCloud?.modalOpen) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (d.isInlineEditActive?.()) return false;
        // Checked before the modifier guard below, which exists so browser and OS
        // chords fall through — Ctrl/Cmd+A is the one chord this view claims.
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A')) {
            const target = e.target;
            const tag = target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return false;
            e.preventDefault();
            e.stopImmediatePropagation();
            this.multiSelect?.selectAllVisible();
            return true;
        }
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
        // x ticks the row under the cursor and moves on, so a run of rows is
        // x-x-x — the same key and the same advance as the dashboard grid.
        if (e.key === 'x' && this.selectedKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.multiSelect?.toggle(this.selectedKey);
            this.moveKeyboardSelection(1, rows);
            return true;
        }
        /*
         * n ignores the condition you are looking at, z snoozes it for a month.
         *
         * Both are toggles: pressed on a row that already ignores that
         * condition, they give it back. One letter each way is what makes this
         * usable on a filtered list — narrow to Stale, walk down, press n on the
         * ones that are allowed to be old.
         */
        if ((e.key === 'n' || e.key === 'z') && this.selectedKey) {
            const issue = this.selectedIssue();
            if (issue) {
                e.preventDefault();
                e.stopImmediatePropagation();
                void this.toggleIgnore(issue, { snooze: e.key === 'z' });
                return true;
            }
        }
        // X takes everything the current filter shows — the whole broken list in
        // one key, which is the case this view exists for.
        if (e.key === 'X') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.multiSelect?.selectAllVisible();
            return true;
        }
        if (e.key === 's' && this.selectedKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.toggleScorePanel(this.selectedKey);
            return true;
        }
        // f opens focus mode on the row under the cursor. Deliberately not
        // gated on selectedKey: opening it from a cold list should start at the
        // top rather than do nothing.
        if (e.key === 'f') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.focus?.open();
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
            this.syncUrlState();
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
            this.syncUrlState();
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
            // A row arriving under a cursor that never moved is not a hover.
            // "Show in Health" leaves the pointer wherever the menu item was,
            // and the list then draws under it — the browser fires pointerover
            // for that, and the row you asked for lost its selection to
            // whichever row happened to land there.
            if (!this._pointerSelectArmed) return;
            const row = e.target.closest?.('.health-view-item');
            const key = row?.dataset?.healthKey;
            if (!key || key === this.selectedKey) return;
            this.selectRowByKey(key);
        };
        // Only a real movement arms it; pointerover alone never does.
        this._pointerMoveHandler = () => { this._pointerSelectArmed = true; };
        container.addEventListener('pointerover', this._pointerHandler, true);
        container.addEventListener('pointermove', this._pointerMoveHandler, true);
    }

    unbindPointerNavigation() {
        if (this._pointerContainer && this._pointerHandler) {
            this._pointerContainer.removeEventListener('pointerover', this._pointerHandler, true);
        }
        if (this._pointerContainer && this._pointerMoveHandler) {
            this._pointerContainer.removeEventListener('pointermove', this._pointerMoveHandler, true);
        }
        this._pointerContainer = null;
        this._pointerHandler = null;
        this._pointerMoveHandler = null;
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

    /* ── Expectations panel ────────────────────────────────────────────── */

    /**
     * What "healthy" means for one bookmark, in the row's own width.
     *
     * These controls lived in the check-mode popover until they outgrew it: a
     * keyword, status codes, two checkboxes and a Save button do not fit in a
     * 192px menu, and five of them ended up below a scrollbar — Save among
     * them, so it was possible to fill the form in and never see the way to
     * store it. Opening in the row instead gives the fields the full width and
     * puts every control on screen at once.
     *
     * Mirrors toggleScorePanel deliberately: same expand-in-place shape, same
     * Set-of-keys bookkeeping, so the row has one way of showing more rather
     * than two that behave differently.
     */
    toggleExpectPanel(key, force) {
        const next = typeof force === 'boolean' ? force : !this.expandedExpect.has(key);
        if (next) {
            this.expandedExpect.add(key);
        } else {
            this.expandedExpect.delete(key);
        }
        this.syncExpectPanel(key);
        if (next) {
            // The keyword is the field people come here for, so focus lands
            // there rather than on the panel itself.
            const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
            row?.querySelector('[data-expect-text]')?.focus({ preventScroll: true });
        }
    }

    syncExpectPanel(key) {
        const row = document.querySelector(`.health-view-item[data-health-key="${CSS.escape(key)}"]`);
        if (!row) return;
        const panel = row.querySelector('.health-view-expect-panel');
        const expanded = this.expandedExpect.has(key);
        if (panel) {
            // Built on open rather than rendered hidden into every row. A form
            // per monitored row costs real DOM for something almost never
            // looked at, and its labels would sit in the row's text content —
            // enough to make "the muted bookmark" match every monitored row
            // that merely *offers* the mute checkbox.
            if (expanded && !panel.firstElementChild) {
                const issue = this.getFilteredIssues().find((i) => this.issueKey(i) === key)
                    || (this.report?.issues || []).find((i) => this.issueKey(i) === key);
                if (issue) {
                    panel.innerHTML = this.renderExpectPanel(issue);
                    this.bindExpectPanel(row, issue, key);
                }
            }
            panel.hidden = !expanded;
        }
        row.querySelector('[data-expect-open]')?.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    /**
     * Wire the panel's controls. Separate from the row's own binding because
     * the panel is built on first open, so this runs then rather than at
     * render time.
     *
     * The panel sits in the row rather than in a popover, so none of the
     * stopPropagation the old menu form needed applies — nothing closes
     * underneath it. Only keydown is held back, to keep Enter and the list's
     * single-letter shortcuts out of each other's way while a field has focus.
     */
    bindExpectPanel(row, issue, key) {
        const panel = row.querySelector('.health-view-expect-panel');
        if (!panel || panel.dataset.bound === '1') return;
        panel.dataset.bound = '1';

        const close = () => {
            this.toggleExpectPanel(key, false);
            row.querySelector('.health-check-mode')?.focus({ preventScroll: true });
        };

        panel.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                void this.saveExpectations(issue, panel);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
            }
        });
        panel.querySelector('[data-expect-save]')?.addEventListener('click', () => {
            void this.saveExpectations(issue, panel);
        });
        panel.querySelector('[data-expect-cancel]')?.addEventListener('click', close);
    }

    /**
     * The panel body. Empty for a row that is not monitored: the checks that
     * read these fields belong to the monitor, so offering them elsewhere would
     * be a control that governs nothing.
     */
    renderExpectPanel(issue) {
        const esc = (v) => this.escape(v);
        const monitored = this.checkModeOf(issue) === window.CheckMode.MONITOR;
        /*
         * Reaching the service comes first, and is not gated on monitoring.
         *
         * Everything below it says what a good answer looks like, which only
         * means something on a monitored bookmark. These three say how to get
         * an answer at all — and "Retest all" and a manual re-check run on
         * unmonitored bookmarks too, where a service behind a key answers 401
         * just the same.
         */
        return `
            <div class="health-expect-form" role="group"
                 aria-label="${esc(this.t('dashboard.healthExpectLabel', 'Expected response'))}">

                <div class="health-expect-field">
                    <label class="health-expect-label" for="check-url-${esc(issue.pageId)}-${esc(issue.index)}">${esc(
                        this.t('dashboard.healthCheckUrlLabel', 'Address to check instead'))}</label>
                    <input type="url" id="check-url-${esc(issue.pageId)}-${esc(issue.index)}"
                        class="health-expect-input" data-check-url maxlength="2000"
                        placeholder="${esc(this.t('dashboard.healthCheckUrlPlaceholder', 'https://service.example/ping'))}"
                        value="${esc(issue.checkUrl || '')}">
                    <span class="health-expect-note">${esc(this.t(
                        'dashboard.healthCheckUrlNote',
                        'The bookmark still opens its own address. Useful when a service has a status endpoint but its front page needs a login.'
                    ))}</span>
                </div>

                <div class="health-expect-field">
                    <label class="health-expect-label" for="credential-${esc(issue.pageId)}-${esc(issue.index)}">${esc(
                        this.t('dashboard.healthCredentialLabel', 'Sign in with'))}</label>
                    <select id="credential-${esc(issue.pageId)}-${esc(issue.index)}"
                        class="health-expect-input" data-credential-id>
                        <option value="">${esc(this.t('dashboard.healthCredentialNone', 'Nothing — check anonymously'))}</option>
                        ${this.renderCredentialOptions(issue.credentialId)}
                    </select>
                    <span class="health-expect-note">${esc(this.t(
                        'dashboard.healthCredentialNote',
                        'Keys and passwords are kept in their own file, outside your backups. Manage them under Config → Health.'
                    ))}</span>
                </div>

                <div class="health-expect-toggles">
                    <label class="health-expect-check">
                        <input type="checkbox" data-allow-insecure ${issue.allowInsecureTls ? 'checked' : ''}>
                        <span>${esc(this.t('dashboard.healthAllowInsecure',
                            'Accept a certificate this machine does not trust'))}</span>
                    </label>
                </div>

                ${monitored ? this.renderExpectFields(issue) : ''}

                <div class="health-expect-actions">
                    <button type="button" class="health-expect-save" data-expect-save>${esc(
                        this.t('dashboard.healthExpectSave', 'Save'))}</button>
                    <button type="button" class="health-expect-cancel" data-expect-cancel>${esc(
                        this.t('dashboard.healthExpectCancel', 'Cancel'))}</button>
                </div>
            </div>`;
    }

    /**
     * The names of the stored credentials, fetched once per view.
     *
     * Names only: the values live in their own file and no route hands them
     * back, so this can be cached without holding a secret in the page.
     */
    async loadHealthCredentials() {
        if (this.dash.healthCredentials) return this.dash.healthCredentials;
        try {
            const res = await fetch('/api/health/credentials');
            if (!res.ok) return {};
            const data = await res.json();
            this.dash.healthCredentials = data?.credentials || {};
        } catch (_error) {
            this.dash.healthCredentials = {};
        }
        return this.dash.healthCredentials;
    }

    /** The names of the stored credentials — never their values. */
    renderCredentialOptions(selected) {
        const esc = (v) => this.escape(v);
        const list = this.dash.healthCredentials || {};
        return Object.keys(list).sort().map((id) => `
            <option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(list[id] || id)}</option>
        `).join('');
    }

    /** What a good answer looks like — only meaningful on a monitored bookmark. */
    renderExpectFields(issue) {
        const esc = (v) => this.escape(v);
        return `
                <p class="health-expect-intro">${esc(this.t(
                    'dashboard.healthExpectIntro',
                    'A reachability check only asks whether the host answered. These say what a good answer looks like for this page.'
                ))}</p>

                <div class="health-expect-field">
                    <label class="health-expect-label" for="expect-text-${esc(issue.pageId)}-${esc(issue.index)}">${esc(
                        this.t('dashboard.healthExpectTextLabel', 'Text the page must contain'))}</label>
                    <input type="text" id="expect-text-${esc(issue.pageId)}-${esc(issue.index)}"
                        class="health-expect-input" data-expect-text maxlength="200"
                        placeholder="${esc(this.t('dashboard.healthExpectTextPlaceholder', 'Page must contain…'))}"
                        value="${esc(issue.expectText || '')}">
                    <label class="health-expect-check">
                        <input type="checkbox" data-expect-absent ${issue.expectTextAbsent ? 'checked' : ''}>
                        <span>${esc(this.t('dashboard.healthExpectAbsent', 'Fail if present instead'))}</span>
                    </label>
                </div>

                <div class="health-expect-field">
                    <label class="health-expect-label" for="expect-status-${esc(issue.pageId)}-${esc(issue.index)}">${esc(
                        this.t('dashboard.healthExpectStatusLabel', 'Status codes that count as healthy'))}</label>
                    <input type="text" id="expect-status-${esc(issue.pageId)}-${esc(issue.index)}"
                        class="health-expect-input" data-expect-status maxlength="40"
                        placeholder="${esc(this.t('dashboard.healthExpectStatusPlaceholder', 'Status codes, e.g. 200,301'))}"
                        value="${esc(issue.expectStatus || '')}">
                    <span class="health-expect-note">${esc(this.t(
                        'dashboard.healthExpectStatusNote',
                        'Empty means anything under 500 counts as reachable.'
                    ))}</span>
                </div>

                <div class="health-expect-toggles">
                    <label class="health-expect-check">
                        <input type="checkbox" data-watch-drift ${issue.watchDrift ? 'checked' : ''}>
                        <span>${esc(this.t('dashboard.healthWatchDrift', 'Watch for redirects, retitling and rewrites'))}</span>
                    </label>
                    <label class="health-expect-check">
                        <input type="checkbox" data-notify-muted ${issue.notifyMuted ? 'checked' : ''}>
                        <span>${esc(this.t('dashboard.healthNotifyMuted', 'Do not alert me about this bookmark'))}</span>
                    </label>
                </div>

        `;
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
     * How long this bookmark has been failing, for the rows that are.
     *
     * A monitor has carried "down for 3h 12m" for a while, read from its own
     * outage record. Every other checked bookmark had nothing: one that died
     * four months ago looked exactly like one that broke this morning, which is
     * the difference between "fix this" and "this is gone". brokenSince is kept
     * on the bookmark now, so the row can say it whichever mode it is in.
     */
    renderBrokenSince(issue) {
        const since = Number(issue?.brokenSince) || 0;
        if (!since || !String(issue?.lastError || '').trim()) return '';
        /*
         * A failure that only describes the request gets a softer sentence.
         *
         * "failing for 40 days" beside a 403 reads as a dead link, and it is
         * how a dashboard of working bookmarks comes to look half dead --
         * after which the reader stops believing any of the warnings, and the
         * real 404s go unnoticed with them. The row still shows the failure and
         * the code; what it stops claiming is that the page is rotting.
         */
        if (issue?.failureUncertain) {
            const blockedLabel = this.t('dashboard.healthBlockedFor',
                'not answering us for {duration}', { duration: this.formatDuration(Date.now() - since) });
            const blockedTitle = this.t('dashboard.healthBlockedTitle',
                'The site refused or could not answer our checks since {date}. It may load fine in a browser.',
                { date: new Date(since).toLocaleString() });
            return `<span class="health-view-item-broken-since" title="${this.escape(blockedTitle)}">${this.escape(blockedLabel)}</span>`;
        }
        // A monitor already says it, in its own strip and with its own record.
        if (Number(issue?.monitorStats?.downSince) > 0) return '';
        const label = this.t('dashboard.healthBrokenFor', 'failing for {duration}', {
            duration: this.formatDuration(Date.now() - since),
        });
        const title = this.t('dashboard.healthBrokenSinceTitle', 'First failed on {date}', {
            date: new Date(since).toLocaleString(),
        });
        return `<span class="health-view-item-broken-since" title="${this.escape(title)}">${this.escape(label)}</span>`
            + this.renderArchiveDied(issue)
            + this.renderLocalCopies(issue);
    }

    /*
     * Whether there is a copy of this page on this disk, and how old it is.
     *
     * On a failing row this is the most useful thing the view can say: the link
     * is gone and the content is not. Without it a reader has to remember
     * whether they ever saved this one, and the answer is a menu click away in
     * a menu they have no reason to open.
     *
     * The count comes with the report, not from a request per row.
     */
    renderLocalCopies(issue) {
        const count = Number(issue?.localCopies) || 0;
        if (!count) return '';

        const at = Number(issue?.localCopyAt) || 0;
        const when = at
            ? new Date(at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
            : '';
        const label = count === 1
            ? this.t('dashboard.healthLocalCopyOne', 'copy saved here')
            : this.t('dashboard.healthLocalCopyMany', '{n} copies saved here', { n: String(count) });
        const title = when
            ? this.t('dashboard.healthLocalCopyTitle', 'Newest copy on this disk: {date}. Open it from this row\u2019s menu.', { date: when })
            : this.t('dashboard.healthLocalCopies', 'Copies on this disk');

        // A statement of fact about what is recoverable, so it reads as the
        // reassurance it is rather than as another warning on a failing row.
        return ` <span class="health-view-item-local-copy" title="${this.escape(title)}">${this.escape(label)}</span>`;
    }

    /*
     * When the web lost the page, beside how long it has been failing here.
     *
     * These are different facts and the difference matters: a bookmark added
     * last week to a page that died in 2019 reads "failing for 6 days", which is
     * true about this install and says nothing about the page. The archive knows
     * the page has been gone for six years, which is what turns "I should look
     * into this" into "this is not coming back".
     *
     * Read off the issue, never fetched: the row is rendered in a loop.
     */
    renderArchiveDied(issue) {
        const diedAt = Number(issue?.archiveDiedAt) || 0;
        if (!diedAt) return '';
        // A failure that says nothing about the page says nothing about when it
        // died either: "gone from the web since 2019" beside a bot check is
        // confidently wrong about a page that opens fine in a browser.
        if (issue?.failureUncertain) return '';
        // A death the archive dates to after we started seeing failures is the
        // archive catching up with us, not new information.
        const since = Number(issue?.brokenSince) || 0;
        if (since && diedAt >= since) return '';

        const when = new Date(diedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
        const label = this.t('dashboard.healthArchiveGoneSince', 'gone from the web since {date}', { date: when });
        const title = this.t('dashboard.healthArchiveGoneSinceTitle',
            'The Web Archive last captured a working copy before {date}', { date: when });
        return ` <span class="health-view-item-gone-since" title="${this.escape(title)}">${this.escape(label)}</span>`;
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

        this.markRowHandled(issue);
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

    /**
     * Open Config → Behavior → Status & health.
     *
     * The subtab is set before the section opens, because Behavior's tab strip
     * has no switch-to method of its own — it reads `behaviorTab` as it
     * renders, which is the same order handleOverviewGo uses to reach this
     * exact tab. Setting it afterwards would render General first and then
     * jump, or not move at all when Config was already open.
     *
     * Falls back to a plain navigation when the config module has not loaded
     * yet, so the link works on a cold view rather than doing nothing.
     */
    async openStatusHealthSettings() {
        window.nextdashTrack?.('health:open-settings');
        const config = this.dash.config;
        if (typeof config?.openConfigView !== 'function') {
            window.location.href = '/config#behavior';
            return;
        }
        const opened = await config.openConfigView('behavior');
        if (!opened) return;
        // The loader proxies openConfigView, so the real module — and its
        // behaviorTab field — may only exist once that call has resolved.
        const mod = config.instance || config;
        if (mod && mod.behaviorTab !== 'status') {
            mod.behaviorTab = 'status';
            mod.render?.();
        }
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
    /**
     * @param {object} issue
     * @param {{silent?: boolean}} [options] `silent` suppresses the per-row toast
     *   and the re-render, so a bulk run reports once at the end instead of
     *   stacking one toast and one full reload per bookmark.
     */
    /*
     * Tell the report to stop -- or start again -- reporting one condition.
     *
     * One endpoint for a row and for a selection, because the health view sends
     * a single target from the row menu and the whole selection from the bulk
     * bar, and two routes would be two things to keep in step.
     *
     * The toast carries the way back. Ignoring is by definition the act of
     * making something invisible, which is exactly when a misclick goes
     * unnoticed, so every one of these can be undone from where it happened.
     */
    async writeIgnores(targets, { add = [], remove = [], clear = false, untilMs = 0 } = {}) {
        const list = (Array.isArray(targets) ? targets : [targets])
            .filter(Boolean)
            .map((issue) => ({ pageId: issue.pageId, index: issue.index, url: issue.url }));
        if (!list.length) return null;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const headers = { 'Content-Type': 'application/json' };
        if (typeof nextDashWriteHeaders === 'function') Object.assign(headers, nextDashWriteHeaders());
        try {
            const res = await fetcher('/api/health/ignore', {
                method: 'POST',
                headers,
                body: JSON.stringify({ targets: list, add, remove, clear, untilMs }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            return body;
        } catch {
            this.dash.showNotification(
                this.t('dashboard.healthIgnoreFailed', 'Could not change what this bookmark reports.'),
                'error');
            return null;
        }
    }

    /** The label for one condition, as the filter pills name it. */
    flagLabel(flag) {
        const labels = {
            broken: this.t('dashboard.healthFilterBroken', 'Broken'),
            content: this.t('dashboard.healthFilterContent', 'Content'),
            duplicate: this.t('dashboard.healthFilterDuplicates', 'Duplicates'),
            'shortcut-conflict': this.t('dashboard.healthFilterShortcutConflict', 'Shortcut conflicts'),
            'orphaned-category': this.t('dashboard.healthFilterOrphanedCategory', 'Missing category'),
            unchecked: this.t('dashboard.healthFilterUnchecked', 'Unchecked'),
            stale: this.t('dashboard.healthFilterStale', 'Stale'),
            unused: this.t('dashboard.healthFilterUnused', 'Unused'),
            'missing-preview': this.t('dashboard.healthFilterMissingPreview', 'Missing preview'),
            drift: this.t('dashboard.healthFilterDrift', 'Drift'),
        };
        return labels[flag] || flag;
    }

    /**
     * Ignore or un-ignore one condition on one row, from the key or the menu.
     *
     * A toggle rather than two actions: if the row already ignores what this
     * would ignore, the same gesture takes it back. That is what makes one
     * letter enough for both directions.
     */
    async toggleIgnore(issue, { snooze = false } = {}) {
        if (!issue) return;
        this.keepPlaceAt(issue);
        const already = this.ignoredFlagsOf(issue);
        /*
         * On the Ignored list the gesture means one thing: give it back.
         *
         * Not "ignore whatever this row still shows" — a row can be hiding one
         * condition and reporting another, and on the list of things you have
         * silenced the only sensible reading of the key is undo.
         */
        const onIgnoredList = this.filter === 'ignored';
        const fromFilter = onIgnoredList ? '' : this.ignoreTargetFlag(issue);
        if (!fromFilter && already.length) {
            const body = await this.writeIgnores(issue, { clear: true });
            if (body) {
                this.dash.showNotification(
                    this.t('dashboard.healthIgnoreCleared', 'Reporting this bookmark again.'), 'success');
            }
            return;
        }
        if (!fromFilter) {
            this.dash.showNotification(
                this.t('dashboard.healthIgnoreNothing', 'Nothing to ignore on this row.'), 'info');
            return;
        }
        const isIgnored = already.some((entry) => entry.flag === fromFilter);
        if (isIgnored) {
            const body = await this.writeIgnores(issue, { remove: [fromFilter] });
            if (body) {
                this.dash.showNotification(
                    this.t('dashboard.healthIgnoreRemoved', 'Reporting “{flag}” again.',
                        { flag: this.flagLabel(fromFilter) }), 'success');
            }
            return;
        }
        const untilMs = snooze
            ? Date.now() + DashboardHealth.SNOOZE_DAYS * 24 * 60 * 60 * 1000
            : 0;
        const body = await this.writeIgnores(issue, { add: [fromFilter], untilMs });
        if (!body) return;
        const message = snooze
            ? this.t('dashboard.healthIgnoreSnoozed', '“{flag}” hidden for {days} days.',
                { flag: this.flagLabel(fromFilter), days: DashboardHealth.SNOOZE_DAYS })
            : this.t('dashboard.healthIgnoreAdded', '“{flag}” hidden for this bookmark.',
                { flag: this.flagLabel(fromFilter) });
        this.dash.showNotification(message, 'success', {
            duration: 8000,
            undoCallback: async () => {
                await this.writeIgnores(issue, { remove: [fromFilter] });
            },
        });
    }

    async recheckIssue(issue, { silent = false } = {}) {
        this.keepPlaceAt(issue);
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        const url = String(issue?.url || '').trim();
        if (!url) return;
        window.nextdashTrack?.('health:recheck');
        // Before the round trip: a re-check that succeeds takes the row out of
        // Broken, and the position it is holding right now is where it belongs
        // until you leave this list.
        if (!silent) {
            this.markRowHandled(issue);
        }
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
            if (silent) {
                return;
            }
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
            if (silent) {
                return;
            }
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
        // Drop a placement frame that has not run yet, so it cannot write the old
        // cursor position back onto a menu that is being closed right now.
        if (this._menuPlacementFrame) {
            cancelAnimationFrame(this._menuPlacementFrame);
            this._menuPlacementFrame = 0;
        }
        if (this._menuPlacementSettle) {
            clearTimeout(this._menuPlacementSettle);
            this._menuPlacementSettle = 0;
        }
        document.querySelectorAll('.health-view-menu').forEach((menu) => {
            menu.hidden = true;
            // Drop any placement written onto the menu, so the next open lands
            // where its own path puts it rather than where the last one left
            // it. Two paths write inline coordinates: a right-click, which sets
            // left and top and marks itself --at-cursor, and the button path's
            // clamp for a menu that fits neither above nor below, which sets top
            // and bottom and carries no class. Clearing was conditional on the
            // class, so the clamped one survived into the next open.
            menu.classList.remove('health-view-menu--at-cursor');
            menu.classList.remove('health-view-menu--up');
            menu.style.left = '';
            menu.style.top = '';
            menu.style.bottom = '';
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
     *
     * `at` opens the menu at a cursor position instead of under its button — the
     * right-click path. The menu still lives inside the row's wrap and is still
     * the same element the ⋯ button opens, so every action, the Escape handling
     * and the outside-click dismiss keep working untouched; only where it lands
     * differs.
     */
    toggleMenu(key, kind = 'more', { at = null } = {}) {
        const menu = document.querySelector(
            `.health-view-menu[data-menu-for="${CSS.escape(key)}"][data-menu-owner="${CSS.escape(kind)}"]`
        );
        if (!menu) return;
        const btn = this.menuOwner(menu);
        if (!btn) return;
        // Re-opening at a new cursor position counts as opening, not toggling:
        // right-clicking a second row while the first row's menu is up should
        // move the menu there rather than dismiss it.
        const willOpen = menu.hidden || Boolean(at);
        this.closeAllMenus();
        if (!willOpen) return;
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelector('.health-view-menu-item')?.focus({ preventScroll: true });

        if (at) {
            this.positionMenuAtPoint(menu, at);
            return;
        }
        // Flip above the row when there is no room below, and when neither side
        // has room, clamp to the viewport instead of picking the lesser overflow.
        //
        // `--up` anchors with `bottom: 100%`, so nothing stops a menu taller
        // than the space above it from running off the top edge — ten items on
        // a row near the middle of a short window fits neither way, and the
        // first entry was cut off. The right-click path never had this:
        // positionMenuAtPoint clamps to the margin whichever way it goes.
        requestAnimationFrame(() => {
            const margin = 8;
            const rect = menu.getBoundingClientRect();
            const anchor = (menu.closest('.health-view-menu-wrap') || btn).getBoundingClientRect();
            const roomBelow = window.innerHeight - anchor.bottom - margin;
            const roomAbove = anchor.top - margin;

            if (rect.height <= roomBelow) {
                menu.classList.remove('health-view-menu--up');
                menu.style.top = '';
                menu.style.bottom = '';
                return;
            }
            if (rect.height <= roomAbove) {
                menu.classList.add('health-view-menu--up');
                menu.style.top = '';
                menu.style.bottom = '';
                return;
            }
            // Neither side fits: sit against the top margin, in the menu's own
            // coordinate space, so the whole list stays on screen.
            menu.classList.remove('health-view-menu--up');
            menu.style.bottom = 'auto';
            menu.style.top = `${margin - anchor.top}px`;
        });
    }

    /**
     * Place an open menu at a viewport point, clamped so it never hangs off an
     * edge. Offsets are measured against the wrap because the menu is positioned
     * within it — reading the wrap's box converts the cursor's viewport point
     * into the menu's own coordinate space.
     *
     * The `--up` class is cleared rather than reused: it flips the menu with
     * `bottom`, which would fight the explicit `top` set here.
     */
    positionMenuAtPoint(menu, { x, y }) {
        const wrap = menu.closest('.health-view-menu-wrap');
        const row = menu.closest('.health-view-item');
        if (!wrap || !row) return;
        menu.classList.remove('health-view-menu--up');
        menu.classList.add('health-view-menu--at-cursor');

        // Anchor to the row, not to the wrap. The wrap sits inside the actions
        // bar, which expands over 0.14s when the row becomes selected, so its box
        // keeps moving for several frames after the click — placement measured
        // against it lands wherever the animation happened to be. The row's own
        // box is stable, so the cursor is stored as an offset from it and
        // converted back at write time.
        const rowBox = row.getBoundingClientRect();
        const offsetX = x - rowBox.left;
        const offsetY = y - rowBox.top;

        const place = () => {
            // The menu can be closed between scheduling and running — Escape, or
            // another right-click. Writing placement onto a closed menu would
            // undo the teardown closeAllMenus() just did, and the ⋯ button would
            // then open it at the stale cursor position.
            if (menu.hidden || !menu.classList.contains('health-view-menu--at-cursor')) return;
            const rect = menu.getBoundingClientRect();
            const base = wrap.getBoundingClientRect();
            const nowRow = row.getBoundingClientRect();
            const margin = 8;
            const wantLeft = nowRow.left + offsetX;
            const wantTop = nowRow.top + offsetY;
            const left = Math.max(margin, Math.min(wantLeft, window.innerWidth - rect.width - margin));
            // Above the cursor when there is no room below, matching what the
            // button path does with `--up`. A menu taller than the space above is
            // then clamped to the top edge rather than flipped again — this list
            // grows with the row's repair options and can outgrow a short window.
            const flipUp = wantTop + rect.height + margin > window.innerHeight;
            const top = Math.max(
                margin,
                Math.min(flipUp ? wantTop - rect.height : wantTop, window.innerHeight - rect.height - margin),
            );
            menu.style.left = `${left - base.left}px`;
            menu.style.top = `${top - base.top}px`;
        };

        // Placed once the menu has a size, then again when the actions bar has
        // finished expanding — the wrap it is positioned within moves during that
        // transition, and only the second pass can read where it finally sits.
        this._menuPlacementFrame = requestAnimationFrame(() => {
            this._menuPlacementFrame = 0;
            place();
            const actions = row.querySelector('.health-view-item-actions');
            if (!actions) return;
            actions.addEventListener('transitionend', place, { once: true });
            // A guard for the case where no transition runs at all — reduced
            // motion, or a row that was already expanded — since `transitionend`
            // would then never fire and the listener would leak.
            this._menuPlacementSettle = setTimeout(() => {
                actions.removeEventListener('transitionend', place);
                place();
            }, 200);
        });
    }

    /** Only a broken row can be repaired; the rest would just fail slowly. */
    isHealable(issue) {
        return issue?.status === 'broken' && Boolean(String(issue?.url || '').trim());
    }

    /**
     * Whether reaching for an archived copy makes sense on this row.
     *
     * Wider than isHealable: a page that has drifted into something else, or one
     * nothing has checked yet, is a fair reason to want what the web remembers.
     * A link answering normally is not.
     */
    canRecoverFromArchive(issue) {
        if (!String(issue?.url || '').trim()) return false;
        const flags = Array.isArray(issue?.flags) ? issue.flags : [];
        const conditions = ['broken', 'content', 'drift', 'unchecked'];
        return conditions.some((flag) => flags.includes(flag) || issue?.status === flag);
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
     * The last capture that worked, and the choice to keep it.
     *
     * "Find in Web Archive" opens a calendar of captures and leaves the reading
     * to you — fine for browsing, no use to a bookmark that is gone. This asks
     * the archive for the closest capture, says when it was taken, and offers to
     * make it the bookmark's URL. What was a dead end becomes a decision.
     */
    /*
     * Save a copy of this page on this disk.
     *
     * The Web Archive answers "did somebody keep a copy"; this answers "keep
     * one". They are needed at different moments: by the time a link is dead it
     * is too late to capture it, and the pages most worth keeping are often the
     * ones nobody else archived.
     *
     * A capture fetches every asset on the page and takes seconds, so the row is
     * marked busy for the duration rather than looking frozen.
     */
    async captureLocalCopy(issue) {
        this.keepPlaceAt(issue);
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        const url = String(issue?.url || '').trim();
        if (!url) return;
        this.closeAllMenus();

        const d = this.dash;
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        /*
         * The overlay, because this is genuinely slow: monolith fetches every
         * asset on the page -- go.dev took eleven seconds -- and a busy row on
         * its own reads as the app having frozen. The same overlay config shows
         * for an import, for the same reason.
         */
        window.ProgressOverlay?.show(
            this.t('dashboard.healthLocalCopySaving', 'Saving a copy…'),
            this.t('dashboard.healthLocalCopySavingStatus', 'Fetching the page and everything on it')
        );
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher(`/api/archives/capture?url=${encodeURIComponent(url)}`, { method: 'POST' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                window.ProgressOverlay?.hide();
                // 412 is monolith not being installed, which is a setup step
                // rather than a failure of this page.
                const message = res.status === 412
                    ? this.t('dashboard.healthLocalCopyMissing', 'monolith is not installed — see Config → Data & backups → Sources.')
                    : (body.error || this.t('dashboard.healthLocalCopyError', 'Could not save a copy of that page.'));
                d.showNotification(message, 'error');
                return;
            }
            /*
             * A page that builds itself in the browser is stored as a shell.
             *
             * The file is real and weighs megabytes, and it opens blank: its
             * scripts cannot run from an archive, and allowed they would want
             * the network the archive exists to do without. Saying so now is
             * the difference between a copy you chose to keep and a copy you
             * find empty a year from now.
             */
            const blank = body?.noReadableText === true;
            const message = blank
                ? this.t('dashboard.healthLocalCopyBlank',
                    'Copy saved, but it opens blank: this page builds itself with JavaScript, so only the shell could be stored.')
                : this.t('dashboard.healthLocalCopySaved', 'Saved a copy of this page.');
            window.ProgressOverlay?.finish(
                this.t('dashboard.healthLocalCopySaved', 'Saved a copy of this page.'));
            d.showNotification(message, blank ? 'info' : 'success', blank ? { duration: 9000 } : undefined);
            // The row can now say a copy exists, which it reads off the report.
            await this.loadAndRender({ refresh: true });
        } catch {
            window.ProgressOverlay?.hide();
            d.showNotification(this.t('dashboard.healthLocalCopyError', 'Could not save a copy of that page.'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /** What has been kept for this page, with a way to open each one. */
    async showLocalCopies(issue) {
        const url = String(issue?.url || '').trim();
        if (!url) return;
        this.closeAllMenus();
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;

        let captures = [];
        try {
            const res = await fetcher(`/api/archives?url=${encodeURIComponent(url)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            captures = body.captures || [];
        } catch {
            d.showNotification(this.t('dashboard.healthLocalCopyError', 'Could not save a copy of that page.'), 'error');
            return;
        }

        if (!captures.length) {
            d.showNotification(
                this.t('dashboard.healthLocalCopiesNone', 'No copies of this page are stored here yet.'),
                'info'
            );
            return;
        }

        // Newest first, and opening one is the point -- so the newest is offered
        // directly rather than behind a list of one.
        const newest = captures[0];
        const when = newest.at ? new Date(newest.at).toLocaleString() : '';
        const open = await this.confirm(
            this.t('dashboard.healthLocalCopiesTitle', 'Copies on this disk'),
            this.t('dashboard.healthLocalCopiesBody',
                '{n} stored for this page. The newest is from {date}.\n\nOpen it?',
                { n: String(captures.length), date: when })
        );
        if (open) {
            window.open(newest.url, '_blank', 'noopener,noreferrer');
        }
    }

    async recoverFromArchive(issue) {
        this.keepPlaceAt(issue);
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:archive-recover');
        this.closeAllMenus();
        const d = this.dash;
        const url = String(issue?.url || '').trim();
        if (!url) return;

        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetch(`/api/health/archive-snapshot?url=${encodeURIComponent(url)}`);
            if (!res.ok) throw new Error(`archive HTTP ${res.status}`);
            let snapshot = await res.json();
            let snapshotUrl = String(snapshot?.url || '').trim();
            let source = this.t('dashboard.healthArchiveSourceWayback', 'the Web Archive');

            /*
             * The second archive, when the first has nothing.
             *
             * These two disagree by design: the Web Archive honours a
             * robots.txt that turns it away and drops what a site later
             * withdraws, while archive.today captures on request and keeps what
             * it captured. So "no copy" from one is not "no copy" -- and for a
             * link that died behind a paywall or a takedown it is usually the
             * second one that has it. Asked only on the way to an empty answer,
             * so a page the first archive holds costs no extra request.
             */
            if (!snapshot?.available || !snapshotUrl) {
                const second = await fetch(`/api/health/archive-today?url=${encodeURIComponent(url)}`);
                if (second.ok) {
                    const other = await second.json();
                    const otherUrl = String(other?.url || '').trim();
                    if (other?.available && otherUrl) {
                        snapshot = other;
                        snapshotUrl = otherUrl;
                        source = this.t('dashboard.healthArchiveSourceToday', 'archive.today');
                    }
                }
            }

            if (!snapshot?.available || !snapshotUrl) {
                d.showNotification(
                    this.t('dashboard.healthArchiveNone', 'Neither archive has a copy of this page'),
                    'info'
                );
                return;
            }

            const taken = Number(snapshot.timestamp) || 0;
            const when = taken
                ? new Date(taken).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
                : this.t('dashboard.healthArchiveUnknownDate', 'an unknown date');
            const keep = await this.confirm(
                this.t('dashboard.healthArchiveFoundTitle', 'Use the archived copy?'),
                this.t(
                    'dashboard.healthArchiveFoundBody',
                    '{source} has a copy from {date}. Point this bookmark at it?\n\n{url}\n\nThe original address is kept in the note, so nothing is lost.',
                    { date: when, url: snapshotUrl, source }
                )
            );
            // Not keeping it is still an answer, and the capture is worth seeing.
            if (!keep) {
                window.open(snapshotUrl, '_blank', 'noopener,noreferrer');
                return;
            }

            const applied = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: issue.pageId,
                    index: issue.index,
                    newUrl: snapshotUrl,
                    refreshTitle: false,
                    keepOriginalInNote: true,
                }),
            });
            if (!applied.ok) throw new Error(`apply HTTP ${applied.status}`);
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            d.showNotification(
                this.t('dashboard.healthArchiveApplied', 'Now pointing at the copy {source} took on {date}',
                    { date: when, source }),
                'success',
                { duration: 4000 }
            );
        } catch {
            d.showNotification(this.t('dashboard.healthArchiveFailed', 'Could not reach either archive'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
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
        this.keepPlaceAt(issue);
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
        this.keepPlaceAt(issue);
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
        this.keepPlaceAt(issue);
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
            // page was reloaded. Match on page + URL, drop the page cache a later
            // read would be served from, and re-render.
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
    /**
     * @param {object} issue
     * @param {string} mode
     * @param {{silent?: boolean}} [options] `silent` skips the report reload and
     *   the grid repaint so a bulk run does both once at the end.
     * @returns {Promise<string|undefined>} the CheckMode outcome — 'changed',
     *   'stale', 'failed' — so a bulk caller can count what did not apply.
     */
    async setCheckMode(issue, mode, { silent = false } = {}) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return undefined;
        if (!mode || mode === this.checkModeOf(issue)) {
            this.closeAllMenus();
            return 'unchanged';
        }
        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return undefined;

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
            if (outcome === 'failed') return outcome;

            // Push the new mode into the dashboard's own copies before the
            // report reloads. The health report and the dashboard's bookmark
            // arrays are separate caches: refreshing the report alone left the
            // dashboard acting on the pre-change mode until a hard reload, so
            // returning to it and checking the bookmark used the old setting.
            if (outcome === 'changed') {
                window.CheckMode?.syncLocalCopies?.({ pageId, url, mode });
            }

            if (silent) {
                return outcome;
            }
            await this.loadAndRender({ refresh: true });
            if (outcome === 'changed') {
                // Repaint the rows so a status dot that depends on the mode is
                // correct the moment the view is closed, not on next render.
                d.renderDashboard?.({ incremental: false });
                d.updateHealthBadge?.();
            }
            return outcome;
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /**
     * Change how often a monitored bookmark is checked.
     *
     * Reuses the check-mode write with the mode the row is already in, so this is
     * a cadence change rather than a re-enable: the server keeps the monitor on
     * and only rewrites the interval. Picking the current value is a no-op — the
     * menu closes without a request, matching what choosing the active mode does.
     */
    async setMonitorInterval(issue, minutes) {
        const interval = Number(minutes);
        if (!Number.isFinite(interval) || interval <= 0) return undefined;
        if (!issue?.monitor) return undefined;
        if (window.CheckMode?.intervalOf?.(issue) === interval) {
            this.closeAllMenus();
            return 'unchanged';
        }

        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return undefined;
        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return undefined;

        this.closeAllMenus();
        window.nextdashTrack?.('health:monitor-interval');
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);

        try {
            const outcome = await window.CheckMode?.apply({
                pageId,
                index: issue.index,
                url,
                mode: window.CheckMode.MONITOR,
                name: issue.name || url,
                intervalMinutes: interval,
            });
            if (outcome === 'failed') return outcome;
            if (outcome === 'changed') {
                window.CheckMode?.syncLocalCopies?.({ pageId, url, mode: window.CheckMode.MONITOR, intervalMinutes: interval });
            }
            // The heartbeat is bucketed from the interval, so the strip is drawn
            // against a different time axis after this — the report has to be
            // re-read rather than the row repainted from what is already loaded.
            await this.loadAndRender({ refresh: true });
            return outcome;
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /**
     * Store what this bookmark expects of a good response.
     *
     * Sent as all fields at once, so clearing one is an empty box rather than a
     * separate action. The report is re-read afterwards because the server
     * clears a content failure when the last expectation goes, and turning
     * drift watching off clears its baseline too — the row's status changes,
     * not just its settings.
     */
    async saveExpectations(issue, wrap) {
        if (!issue || !wrap) return undefined;
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return undefined;

        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return undefined;

        const text = String(wrap.querySelector('[data-expect-text]')?.value || '').trim();
        const absent = Boolean(wrap.querySelector('[data-expect-absent]')?.checked);
        const status = String(wrap.querySelector('[data-expect-status]')?.value || '').trim();
        const watchDrift = Boolean(wrap.querySelector('[data-watch-drift]')?.checked);
        const notifyMuted = Boolean(wrap.querySelector('[data-notify-muted]')?.checked);
        // Reachability: present whether or not the bookmark is monitored, so
        // these are read unconditionally rather than from the monitored block.
        const checkUrl = String(wrap.querySelector('[data-check-url]')?.value || '').trim();
        const credentialId = String(wrap.querySelector('[data-credential-id]')?.value || '').trim();
        const allowInsecureTls = Boolean(wrap.querySelector('[data-allow-insecure]')?.checked);

        this.closeAllMenus();
        window.nextdashTrack?.('health:expectations');
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);

        try {
            const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await fetcher('/api/health/expectations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId, index: issue.index, url,
                    expectText: text, expectTextAbsent: absent, expectStatus: status,
                    watchDrift, notifyMuted,
                    checkUrl, credentialId, allowInsecureTls,
                }),
            });
            if (res.status === 409) {
                this.dash.showNotification?.(this.t('dashboard.healthCheckModeStale',
                    'This bookmark changed — the list has been refreshed. Try again.'), 'warning');
                await this.loadAndRender({ refresh: true });
                return 'stale';
            }
            if (!res.ok) throw new Error(`expectations HTTP ${res.status}`);
            const saved = await res.json();
            // Quote what was stored rather than what was typed: the server drops
            // status codes it cannot parse, so "999" comes back as an empty field
            // and the message should not claim otherwise.
            this.dash.showNotification?.(saved.expectText || saved.expectStatus || saved.watchDrift
                ? this.t('dashboard.healthExpectSaved', 'Expectations saved.')
                : this.t('dashboard.healthExpectCleared', 'Expectations cleared.'), 'success');
            // Closed before the re-render rather than after, so the panel does
            // not flash back open for a frame on its way out. A failed save
            // deliberately leaves it open — the values are still in the fields
            // and closing would throw away what was typed.
            this.expandedExpect.delete(key);
            await this.loadAndRender({ refresh: true });
            return 'changed';
        } catch {
            this.dash.showNotification?.(this.t('dashboard.healthExpectFailed', 'Could not save what to expect.'), 'error');
            return 'failed';
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
        // Every caller is a change of question — another filter, sort, tile or
        // search — and a row held open in the previous list has no place in the
        // next one.
        this.clearHandledRows();
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
        // The row was asked for by name, so hovering has to be earned again:
        // the list is about to draw under a cursor that has not moved.
        this._pointerSelectArmed = false;
        return true;
    }

    /**
     * Put the page back where it was before a row action.
     *
     * Once, and only when something asked for it: a filter change or a search
     * is a new list, and arriving at the top of one is right. The correction
     * repeats for a couple of frames because the list is rebuilt from nothing —
     * the document is briefly shorter than the offset being restored, and a
     * browser clamps a scroll it cannot honour yet.
     */
    restoreKeptPlace() {
        const target = this._keepScrollY;
        if (typeof target !== 'number') {
            return;
        }
        this._keepScrollY = null;
        const settle = (attempt) => {
            if (Math.abs((window.scrollY || 0) - target) > 1) {
                window.scrollTo({ top: target, behavior: 'instant' });
            }
            if (attempt < 3) {
                requestAnimationFrame(() => settle(attempt + 1));
            }
        };
        settle(0);
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
        row.classList.add('health-view-item--highlight', 'feed-row--highlight');
        setTimeout(() => row.classList.remove('health-view-item--highlight', 'feed-row--highlight'), 1800);
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
        this.restoreKeptPlace();
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
        /*
         * Painting is only ever right while this view is the one on screen.
         *
         * Health's slow work -- a re-check of an unreachable host, an archive
         * lookup -- runs for seconds, and loadAndRender() renders when it
         * lands. Since render() starts by emptying the container, a report
         * arriving after the reader had gone back to their bookmarks wiped the
         * grid and put the health list in its place, while the URL and the
         * highlighted page tab still said bookmarks.
         *
         * Guarded here rather than at the twenty call sites: every one of them
         * is a candidate for the same race, and the ones that matter most are
         * the slowest, which are the easiest to overlook.
         */
        if (!this.isActiveView()) return;

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
        // Tiles summarise the full report even when the active filter hides every row.
        if (this.report?.issues?.length) {
            container.appendChild(this.renderTiles());
        }
        container.appendChild(this.renderToolbar());

        // What the active filter selects, in a sentence. Above the fleet panel so
        // the reading order stays "what am I looking at" before "how is it doing".
        const note = this.renderFilterNote();
        if (note) container.appendChild(note);

        // The collection-wide panel sits under the toolbar on Monitored: that
        // filter is the one place where "how is everything doing" is the question
        // being asked, and on Broken it would push the actual work off screen.
        const fleet = this.renderFleetPanel();
        if (fleet) container.appendChild(fleet);

        if (!filtered.length) {
            container.appendChild(this.renderEmptyState());
            this.finishRenderFocus(container, preserveSearch, searchCaret);
            return;
        }

        const visible = filtered.slice(0, this.visibleLimit);
        const feed = document.createElement('div');
        feed.className = 'feed-list health-view-feed';
        feed.setAttribute('role', 'feed');
        feed.setAttribute('aria-label', this.t('dashboard.healthPageTitle', 'Health'));
        const groups = this.groupFilteredIssues(visible);
        groups.forEach((group) => {
            const section = document.createElement('section');
            section.className = 'health-view-status-group';
            // A flat run (the common case) has no heading; an empty <h3> would
            // leave its margin behind as a gap above the first row.
            section.innerHTML = group.label
                ? `<h3 class="health-view-status-group-title">${this.escape(group.label)}<span class="health-view-status-group-count">${group.items.length}</span></h3>`
                : '';
            const list = document.createElement('div');
            list.className = 'health-view-status-group-items';
            group.items.forEach((issue) => list.appendChild(this.createIssueElement(issue)));
            section.appendChild(list);
            feed.appendChild(section);
        });
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
            content: this.t('dashboard.healthFilterContent', 'Content'),
            duplicate: this.t('dashboard.healthFilterDuplicates', 'Duplicates'),
            unchecked: this.t('dashboard.healthFilterUnchecked', 'Unchecked'),
            monitored: this.t('dashboard.healthFilterMonitored', 'Monitored'),
            stale: this.t('dashboard.healthFilterStale', 'Stale'),
            unused: this.t('dashboard.healthFilterUnused', 'Unused'),
            'shortcut-conflict': this.t('dashboard.healthFilterShortcutConflict', 'Shortcut conflicts'),
            'orphaned-category': this.t('dashboard.healthFilterOrphanedCategory', 'Missing category'),
            'missing-preview': this.t('dashboard.healthFilterMissingPreview', 'Missing preview'),
            certificates: this.t('dashboard.healthFilterCertificates', 'Certificates'),
            healthy: this.t('dashboard.healthFilterHealthy', 'Healthy'),
            all: this.t('dashboard.healthFilterAll', 'All'),
            // Monitor-group headings, distinct from the link-hygiene labels
            // above: "down" here means the monitor is failing right now, not
            // the report's "broken" status. Drift reuses healthFilterDrift —
            // same concept, no need for a second translated string.
            down: this.t('dashboard.healthGroupDown', 'Down'),
            drift: this.t('dashboard.healthFilterDrift', 'Drift'),
            cert: this.t('dashboard.healthGroupCert', 'Certificate warning'),
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

    /**
     * How old the report is.
     *
     * Every number in this view is a snapshot, and the report is cached for
     * minutes: "12 broken" reads as live until you learn it is not. Under a
     * minute is shown as "just now" rather than "0m", which looks like a stuck
     * clock. Hidden entirely when the report carries no timestamp.
     */
    renderReportAge() {
        const generated = Number(this.report?.generatedAt) || 0;
        if (!generated) return '';
        const age = Date.now() - generated;
        // A clock that disagrees with the server can make the report look like it
        // came from the future; treat that as fresh rather than printing a
        // negative age.
        const label = age < 60_000
            ? this.t('dashboard.healthReportJustNow', 'updated just now')
            : this.t('dashboard.healthReportAge', 'updated {age} ago', { age: this.formatDuration(age) });
        return `<span class="health-view-report-age">${this.escape(label)}</span>`;
    }

    /* ── Explaining the view ───────────────────────────────────────────── */

    /**
     * One sentence saying what the active filter selects.
     *
     * The pills are one or two words by necessity — a row of them has no space
     * for more — and several of them ("Stale", "Unused", "Never checked") sound
     * like each other until you know the rule behind them. The tiles carry this
     * as a tooltip, which is useless on a touch screen and invisible to anyone
     * who did not think to hover; this puts the same fact on screen for whichever
     * filter is actually in use.
     */
    filterExplanation(filter = this.filter) {
        const notes = {
            broken: this.t('dashboard.healthNoteBroken', 'These did not respond when they were last checked. Re-check one to test it again now, or open it to see for yourself.'),
            duplicate: this.t('dashboard.healthNoteDuplicate', 'Two or more bookmarks point at the same address. Merging keeps one row and folds the other\'s tags and notes into it.'),
            unchecked: this.t('dashboard.healthNoteUnchecked', 'Checking is switched on for these, but no check has run recently — so their status is unknown rather than bad.'),
            monitored: this.t('dashboard.healthNoteMonitored', 'These are checked by the server on their own interval, which is what builds the uptime history and the panel below.'),
            stale: this.t('dashboard.healthNoteStale', 'You have opened these before, but not in the last 30 days. Nothing is wrong with them — they are candidates for tidying up.'),
            unused: this.t('dashboard.healthNoteUnused', 'These have never been opened since they were added. Often worth keeping, sometimes worth deleting, but always worth a look.'),
            'shortcut-conflict': this.t('dashboard.healthNoteShortcutConflict', 'More than one bookmark claims the same keyboard shortcut, so pressing it is a coin toss between them.'),
            'orphaned-category': this.t('dashboard.healthNoteOrphanedCategory', 'These point at a category that no longer exists on their page, usually because it was deleted without moving them first. They still work, but on the dashboard they sit with the uncategorized ones — edit a row to file it somewhere that exists.'),
            'missing-preview': this.t('dashboard.healthNoteMissingPreview', 'No title, description or image has been fetched yet, so these rows have little to show beyond their address.'),
            certificates: this.t('dashboard.healthNoteCertificates', 'These sit on a host whose TLS certificate expires soon. The count above is hosts; this list is the bookmarks on them.'),
            healthy: this.t('dashboard.healthNoteHealthy', 'Nothing is wrong with these: reachable if they are checked, opened recently enough, and not clashing with anything.'),
            /*
             * No note for All.
             *
             * The others name a rule the pill has no room for -- what makes a
             * bookmark stale, why one counts as unused. "Every bookmark,
             * whatever its state" names what an unfiltered list is, to someone
             * already looking at one, and cost a line above every row to do it.
             * The sorting tip it carried lives on the sort control itself.
             */
        };
        return notes[filter] || '';
    }

    /**
     * The explanation line under the toolbar.
     *
     * The trend chart used to sit beside it, which cost a row of its own before
     * the list — worst on a narrow screen, where the two stack and the chart
     * takes the full width. It lives in the tile row now, as a sparkline in the
     * space the tiles already occupy, and opens full size when asked. The view is
     * a work queue; the direction of travel is a glance, not a panel.
     */
    renderFilterNote() {
        const text = this.filterExplanation();
        if (!text) return null;

        const row = document.createElement('div');
        row.className = 'health-view-note-row';
        const note = document.createElement('p');
        // Shared class styles it; the view-specific one stays as this view's hook.
        note.className = 'view-filter-note health-view-filter-note';
        note.textContent = text;
        row.appendChild(note);
        return row;
    }

    /**
     * The trend as a tile: current reading, and the shape of the last 90 days.
     *
     * Deliberately not a filter — there is no "trend" state a bookmark can be in
     * — so it is a button that opens the full chart rather than one that changes
     * the list. Returns '' when there is not enough history to draw, in which
     * case the tile row simply has one fewer cell.
     */
    renderTrendTile() {
        const points = this.trendPoints();
        if (points.length < 3) return '';
        const series = this.activeTrendSeries();
        const values = points.map((p) => this.trendPercent(p, series));
        const known = values.filter((v) => v !== null);
        if (known.length < 3) return '';

        const w = 64;
        const h = 20;
        const max = series.mode === 'count' ? Math.max(1, ...known) : 100;
        const step = w / Math.max(1, values.length - 1);
        // Same treatment as the full chart: a gap in the record breaks the line
        // rather than being drawn through.
        const segments = [];
        let current = [];
        values.forEach((v, i) => {
            if (v === null) {
                if (current.length > 1) segments.push(current);
                current = [];
                return;
            }
            current.push(`${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`);
        });
        if (current.length > 1) segments.push(current);
        if (!segments.length) return '';
        const paths = segments.map((pts) =>
            `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`
        ).join('');

        const last = [...values].reverse().find((v) => v !== null);
        const value = series.mode === 'count' ? String(last) : `${last}%`;
        const label = this.t('dashboard.healthTileTrend', 'Trend');
        const hint = this.t('dashboard.healthTileTrendHint', '{days} days of history — open the full chart', { days: points.length });

        return `<button type="button" class="health-view-tile health-view-tile--neutral health-view-tile--trend"
                    data-health-trend-open tabindex="-1"
                    title="${this.escape(hint)}"
                    aria-label="${this.escape(`${label}: ${value} — ${hint}`)}">
                <span class="health-view-tile-label">${this.escape(label)}</span>
                <span class="health-view-tile-value">${this.escape(value)}</span>
                <svg class="health-view-tile-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>
            </button>`;
    }

    /**
     * The full chart, on request.
     *
     * Same markup the note row used to hold, including the series picker and the
     * per-day readout — it is the chart, just somewhere that costs no height
     * until it is wanted.
     */
    showTrendChart() {
        if (typeof window.AppModal?.show !== 'function') return;
        const chart = this.renderTrendChart();
        if (!chart) return;
        window.nextdashTrack?.('health:trend-open');

        window.AppModal.show({
            title: this.t('dashboard.healthTrendModalTitle', 'How the collection is doing'),
            htmlMessage: `<div class="health-trend-modal-body">${chart}</div>`,
            confirmText: this.t('dashboard.healthExplainClose', 'Got it'),
            showCancel: false,
            modalClass: 'view-explain-modal health-trend-modal',
            modalMaxWidth: 'min(48rem, calc(100vw - 2.5rem))',
        });
        // The modal owns its DOM, so the chart is wired after it exists; the
        // series buttons redraw in place exactly as they did in the note row.
        requestAnimationFrame(() => {
            const holder = document.querySelector('.health-trend-modal .health-trend-modal-body');
            if (!holder) return;
            holder.querySelector('[data-health-trend-help]')?.addEventListener('click', () => {
                this.showTrendExplainer();
            });
            this.bindTrendChart(holder);
        });
    }

    /**
     * "How this works", behind the ℹ in the toolbar.
     *
     * Covers what the numbers mean rather than which key does what — the legend
     * under the list already handles the keyboard. The availability modes are
     * deliberately not repeated here: CheckMode.showExplainer already owns that
     * wording for the config panel and the add-bookmark form, so this links to it
     * instead of growing a third copy that could drift.
     */
    showHealthExplainer() {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('health:explainer');

        const esc = (v) => this.escape(v);
        const section = (title, body) => `<div class="view-explain-row health-explain-row">
            <h4>${esc(title)}</h4><p>${esc(body)}</p>
        </div>`;

        const html = `<div class="health-explain">
            ${section(
                this.t('dashboard.healthExplainScoreTitle', 'The score'),
                this.t('dashboard.healthExplainScore', 'Every bookmark starts at 100 and loses points for each thing wrong with it — unreachable, never opened, a duplicate address, a clashing shortcut. Click the badge on a row, or press s, to see exactly what it was charged for.')
            )}
            ${section(
                this.t('dashboard.healthExplainTilesTitle', 'Tiles and filters'),
                this.t('dashboard.healthExplainTiles', 'A bookmark can be several things at once, so one that is both a duplicate and never opened is counted by both tiles and appears under either filter. The row itself shows only its worst problem, which is what decides its colour and its place in the list.')
            )}
            ${section(
                this.t('dashboard.healthExplainFreshTitle', 'How current these numbers are'),
                this.t('dashboard.healthExplainFresh', 'The report is built on the server and cached for a few minutes, so the header says how old it is. Retest all rebuilds it and re-tests everything that opted in to checking.')
            )}
            ${section(
                this.t('dashboard.healthExplainUptimeTitle', 'Uptime and response times'),
                this.t('dashboard.healthExplainUptime', 'Only monitored bookmarks keep history. A percentage is followed by the number of checks behind it, because 100% from three checks is a much weaker claim than 100% from three hundred. A window with no checks at all reads "no data" rather than 0%.')
            )}
            ${section(
                this.t('dashboard.healthExplainFleetTitle', 'All monitors together'),
                this.t('dashboard.healthExplainFleet', 'On the Monitored filter, the panel above the list pools every monitor. Its uptime counts individual checks rather than averaging each monitor\'s percentage, so a monitor with three recorded checks cannot outweigh one with three thousand.')
            )}
            ${section(
                this.t('dashboard.healthExplainTrendTitle', 'The trend line'),
                this.t('dashboard.healthExplainTrend', 'One point is recorded per day that you open this view, kept for 90 days. The line is drawn on a fixed 0–100 scale so a collection sitting between 91% and 93% looks as flat as it is, and days you did not visit leave a gap rather than a straight line through them.')
            )}
        </div>`;

        window.AppModal.show({
            title: this.t('dashboard.healthExplainTitle', 'How the health view works'),
            htmlMessage: html,
            confirmText: this.t('dashboard.healthExplainClose', 'Got it'),
            // Informational only: a Cancel button would suggest the explanation
            // could be declined.
            showCancel: false,
            modalClass: 'view-explain-modal health-explain-modal',
            // One column of prose: 34rem keeps lines inside the range the eye
            // tracks comfortably, where 38rem ran them long.
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
        });
    }

    /**
     * What has rotted, as one page you can read in a minute.
     *
     * The view is a work queue: it tells you what to fix now. This is the other
     * question — what has been happening to the collection — and it is the one
     * you ask once a month. Everything here is already in the report; what was
     * missing was somewhere it added up.
     */
    showRotReport() {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('health:rot-report');
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        const esc = (v) => this.escape(v);
        const now = Date.now();
        const day = 24 * 3600_000;

        const gone = issues.filter((i) => /does not exist/i.test(String(i.lastError || '')));
        const moved = issues.filter((i) => String(i.driftNoticed || '').trim());
        const broken = issues.filter((i) => String(i.lastError || '').trim());
        const longBroken = broken
            .filter((i) => Number(i.brokenSince) > 0 && now - Number(i.brokenSince) > 30 * day)
            .sort((a, b) => Number(a.brokenSince) - Number(b.brokenSince));
        const brokenAndUnused = broken.filter((i) => !Number(i.lastOpened) && !Number(i.openCount));
        const newlyBroken = broken.filter((i) => Number(i.brokenSince) > 0 && now - Number(i.brokenSince) <= 7 * day);

        const rows = (list) => list.slice(0, 6).map((i) => {
            const since = Number(i.brokenSince) > 0
                ? ` — ${this.t('dashboard.healthBrokenFor', 'failing for {duration}', { duration: this.formatDuration(now - Number(i.brokenSince)) })}`
                : '';
            return `<li>${esc(i.name || this.formatUrlDisplay(i.url))}<span class="health-rot-row-meta">${esc(this.formatUrlDisplay(i.url))}${esc(since)}</span></li>`;
        }).join('');

        const section = (title, count, list, blank) => {
            if (!count) {
                return `<div class="view-explain-row health-explain-row"><h4>${esc(title)}</h4><p>${esc(blank)}</p></div>`;
            }
            const more = list.length > 6
                ? `<p class="health-rot-more">${esc(this.t('dashboard.healthRotMore', '…and {count} more', { count: list.length - 6 }))}</p>`
                : '';
            return `<div class="view-explain-row health-explain-row">
                <h4>${esc(title)} <span class="health-rot-count">${esc(count)}</span></h4>
                <ul class="health-rot-list">${rows(list)}</ul>${more}
            </div>`;
        };

        const html = `<div class="health-explain health-rot-report">
            ${section(
                this.t('dashboard.healthRotGone', 'Gone without saying so'),
                gone.length, gone,
                this.t('dashboard.healthRotGoneNone', 'Nothing is answering 200 with a "page not found". This is only judged on monitored bookmarks, and only while the setting is on.')
            )}
            ${section(
                this.t('dashboard.healthRotMoved', 'Moved or rewritten'),
                moved.length, moved,
                this.t('dashboard.healthRotMovedNone', 'No watched page has drifted from the version you saved.')
            )}
            ${section(
                this.t('dashboard.healthRotLong', 'Failing for over a month'),
                longBroken.length, longBroken,
                this.t('dashboard.healthRotLongNone', 'Nothing has been failing for longer than a month.')
            )}
            ${section(
                this.t('dashboard.healthRotUnused', 'Broken and never opened'),
                brokenAndUnused.length, brokenAndUnused,
                this.t('dashboard.healthRotUnusedNone', 'Every broken bookmark is one you have actually used.')
            )}
            ${section(
                this.t('dashboard.healthRotNew', 'Broke this week'),
                newlyBroken.length, newlyBroken,
                this.t('dashboard.healthRotNewNone', 'Nothing new broke in the last seven days.')
            )}
        </div>`;

        window.AppModal.show({
            title: this.t('dashboard.healthRotTitle', 'What has rotted'),
            htmlMessage: html,
            confirmText: this.t('dashboard.healthExplainClose', 'Got it'),
            showCancel: false,
            modalClass: 'view-explain-modal health-explain-modal health-rot-modal',
            modalMaxWidth: 'min(38rem, calc(100vw - 2.5rem))',
        });
    }

    /* ── Collection-wide monitoring ────────────────────────────────────── */

    /**
     * Pooled uptime, the worst monitors, outages and response shifts.
     *
     * Only on the Monitored filter: everywhere else the list is about bookmarks
     * to fix, and a panel about uptime would push that work below the fold. Also
     * only once the server sends stats, which it does not until something is both
     * monitored and has samples.
     */
    renderFleetPanel() {
        if (this.filter !== 'monitored') return null;
        const fleet = this.report?.fleet;
        if (!fleet || !Number(fleet.monitors)) return null;

        const panel = document.createElement('section');
        panel.className = 'health-fleet';
        panel.setAttribute('aria-label', this.t('dashboard.healthFleetLabel', 'All monitors'));

        const windows = [
            [this.t('dashboard.healthStatsUptime24h', '24 hours'), fleet.uptime24h],
            [this.t('dashboard.healthStatsUptime7d', '7 days'), fleet.uptime7d],
            [this.t('dashboard.healthStatsUptime30d', '30 days'), fleet.uptime30d],
        ];
        const noData = this.t('dashboard.healthStatsNoData', 'no data');
        const tiles = windows.map(([label, win]) => {
            const value = this.formatUptime(win);
            const samples = Number(win?.samples) || 0;
            return `<div class="health-monitor-stat${value ? '' : ' health-monitor-stat--empty'}">
                <span class="health-monitor-stat-label">${this.escape(label)}</span>
                <span class="health-monitor-stat-value">${this.escape(value || noData)}</span>
                ${samples ? `<span class="health-monitor-stat-sub">${this.escape(
                    this.t('dashboard.healthStatsChecks', '{count} checks', { count: samples })
                )}</span>` : ''}
            </div>`;
        }).join('');

        const down = Number(fleet.downNow) || 0;
        const headline = down > 0
            ? this.t('dashboard.healthFleetDown', '{down} of {count} not responding', { down, count: fleet.monitors })
            : this.t('dashboard.healthFleetUp', 'All {count} responding', { count: fleet.monitors });
        const avg = Number(fleet.avgResponseMs) || 0;

        const collapsed = this.fleetDetailsCollapsed;
        const details = [this.renderFleetWorst(fleet), this.renderFleetSlower(fleet), this.renderFleetIncidents(fleet)].join('');
        // No detail sections at all (a young collection with no incidents yet) —
        // nothing to collapse, so the toggle would open onto an empty panel.
        const hasDetails = details.trim() !== '';

        panel.innerHTML = `
            <div class="health-fleet-head">
                <h3 class="health-fleet-title">${this.escape(this.t('dashboard.healthFleetTitle', 'All monitors'))}</h3>
                <span class="health-fleet-headline${down > 0 ? ' is-down' : ''}">${this.escape(headline)}</span>
                ${avg ? `<span class="health-fleet-avg">${this.escape(
                    this.t('dashboard.healthFleetAvgResponse', '{ms}ms average', { ms: avg })
                )}</span>` : ''}
                ${hasDetails ? `<button type="button" class="health-fleet-collapse-btn" aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="health-fleet-details" title="${this.escape(
                    collapsed
                        ? this.t('dashboard.healthFleetExpand', 'Show least-available monitors and outages')
                        : this.t('dashboard.healthFleetCollapse', 'Hide least-available monitors and outages, keep just the uptime tiles')
                )}">${this.escape(collapsed
                    ? this.t('dashboard.healthFleetShowDetails', 'Show details')
                    : this.t('dashboard.healthFleetHideDetails', 'Hide details'))}</button>` : ''}
            </div>
            <div class="health-monitor-stat-grid">${tiles}</div>
            ${hasDetails ? `<div id="health-fleet-details" class="health-fleet-details"${collapsed ? ' hidden' : ''}>${details}</div>` : ''}
        `;
        panel.querySelector('.health-fleet-collapse-btn')?.addEventListener('click', () => {
            this.fleetDetailsCollapsed = !this.fleetDetailsCollapsed;
            this.persistViewState();
            const btn = panel.querySelector('.health-fleet-collapse-btn');
            const detailsEl = panel.querySelector('.health-fleet-details');
            if (detailsEl) detailsEl.hidden = this.fleetDetailsCollapsed;
            if (btn) {
                btn.setAttribute('aria-expanded', this.fleetDetailsCollapsed ? 'false' : 'true');
                btn.title = this.fleetDetailsCollapsed
                    ? this.t('dashboard.healthFleetExpand', 'Show least-available monitors and outages')
                    : this.t('dashboard.healthFleetCollapse', 'Hide least-available monitors and outages, keep just the uptime tiles');
                btn.textContent = this.fleetDetailsCollapsed
                    ? this.t('dashboard.healthFleetShowDetails', 'Show details')
                    : this.t('dashboard.healthFleetHideDetails', 'Hide details');
            }
        });
        return panel;
    }

    /** The least-available monitors. Absent when every monitor is at 100%. */
    renderFleetWorst(fleet) {
        const rows = Array.isArray(fleet?.worst) ? fleet.worst : [];
        if (!rows.length) return '';
        const items = rows.map((m) => {
            const pct = this.formatUptime({ ratio: m.ratio, samples: m.samples }) || '—';
            const ping = Number(m.avgMs) > 0 ? `<span class="health-fleet-row-ping">${this.escape(`${m.avgMs}ms`)}</span>` : '';
            return `<li class="health-fleet-row${m.down ? ' is-down' : ''}">
                <span class="health-fleet-row-name" title="${this.escape(m.url || '')}">${this.escape(m.name || this.formatUrlDisplay(m.url))}</span>
                <span class="health-fleet-row-value">${this.escape(pct)}</span>
                ${ping}
                ${m.down ? `<span class="health-fleet-row-tag">${this.escape(this.t('dashboard.healthFleetDownNow', 'down'))}</span>` : ''}
            </li>`;
        }).join('');
        return `<div class="health-fleet-block">
            <p class="health-fleet-heading">${this.escape(this.t('dashboard.healthFleetWorst', 'Least available (7 days)'))}</p>
            <ul class="health-fleet-list">${items}</ul>
        </div>`;
    }

    /** Monitors measurably slower than the week before. */
    renderFleetSlower(fleet) {
        const rows = Array.isArray(fleet?.slower) ? fleet.slower : [];
        if (!rows.length) return '';
        const items = rows.map((m) => `<li class="health-fleet-row">
            <span class="health-fleet-row-name" title="${this.escape(m.url || '')}">${this.escape(m.name || this.formatUrlDisplay(m.url))}</span>
            <span class="health-fleet-row-value is-worse">${this.escape(
                this.t('dashboard.healthFleetSlowerBy', '+{pct}%', { pct: m.changePct })
            )}</span>
            <span class="health-fleet-row-ping">${this.escape(
                this.t('dashboard.healthFleetSlowerDetail', '{recent}ms vs {baseline}ms', { recent: m.recentMs, baseline: m.baselineMs })
            )}</span>
        </li>`).join('');
        return `<div class="health-fleet-block">
            <p class="health-fleet-heading">${this.escape(this.t('dashboard.healthFleetSlower', 'Slower than last week'))}</p>
            <ul class="health-fleet-list">${items}</ul>
        </div>`;
    }

    /** Every recorded outage across the collection, newest first. */
    renderFleetIncidents(fleet) {
        const rows = Array.isArray(fleet?.incidents) ? fleet.incidents : [];
        if (!rows.length) {
            return `<div class="health-fleet-block">
                <p class="health-fleet-heading">${this.escape(this.t('dashboard.healthFleetIncidents', 'Outages'))}</p>
                <p class="health-view-score-intro">${this.escape(this.t('dashboard.healthStatsNoIncidents', 'No outages recorded.'))}</p>
            </div>`;
        }
        const items = rows.map((inc) => {
            const when = inc.start ? new Date(inc.start).toLocaleString() : '';
            const duration = inc.ongoing
                ? this.t('dashboard.healthFleetOngoing', 'ongoing')
                : this.formatDuration(inc.durationMs);
            return `<li class="health-fleet-row${inc.ongoing ? ' is-down' : ''}">
                <span class="health-fleet-row-name" title="${this.escape(inc.url || '')}">${this.escape(inc.name || this.formatUrlDisplay(inc.url))}</span>
                <span class="health-fleet-row-when">${this.escape(when)}</span>
                <span class="health-fleet-row-value">${this.escape(duration)}</span>
                ${inc.reason ? `<span class="health-fleet-row-tag">${this.escape(inc.reason)}</span>` : ''}
            </li>`;
        }).join('');

        // Say when the list is capped, so 25 outages is not read as the month's total.
        const total = Number(fleet.totalIncidents) || rows.length;
        const more = total > rows.length
            ? `<p class="health-fleet-more">${this.escape(
                this.t('dashboard.healthFleetIncidentsMore', 'Showing {shown} of {total}', { shown: rows.length, total })
            )}</p>`
            : '';

        return `<div class="health-fleet-block">
            <p class="health-fleet-heading">${this.escape(this.t('dashboard.healthFleetIncidents', 'Outages'))}</p>
            <ul class="health-fleet-list health-fleet-list--incidents">${items}</ul>
            ${more}
        </div>`;
    }

    /* ── Collection trend ──────────────────────────────────────────────── */

    /** Recorded days, oldest first. Empty until the first report was recorded. */
    trendPoints() {
        return Array.isArray(this.report?.trend) ? this.report.trend : [];
    }

    /**
     * The series the trend chart can draw.
     *
     * HealthTrendPoint has stored nine counters a day for ninety days —
     * broken, monitors down, monitored, unchecked, stale, unused, duplicate and
     * the average score, alongside healthy and total — and the chart read two of
     * them. The other eight were written on every report build and shown
     * nowhere. Nothing on the server changes for this.
     *
     * `percent` series share the fixed 0–100 axis that makes a two-point move
     * legible; counts get their own axis, scaled to what the window holds.
     */
    static TREND_SERIES = [
        { id: 'healthy', key: 'h', mode: 'percent', labelKey: 'healthTrendSeriesHealthy', fallback: 'Healthy %' },
        { id: 'score', key: 'c', mode: 'percent', labelKey: 'healthTrendSeriesScore', fallback: 'Score' },
        { id: 'broken', key: 'b', mode: 'count', labelKey: 'healthTrendSeriesBroken', fallback: 'Broken' },
        { id: 'down', key: 'd', mode: 'count', labelKey: 'healthTrendSeriesDown', fallback: 'Monitors down' },
        { id: 'stale', key: 's', mode: 'count', labelKey: 'healthTrendSeriesStale', fallback: 'Stale' },
        { id: 'unchecked', key: 'u', mode: 'count', labelKey: 'healthTrendSeriesUnchecked', fallback: 'Unchecked' },
    ];

    /** The series on screen, defaulting to the one the chart always drew. */
    activeTrendSeries() {
        const id = this.trendSeriesId || 'healthy';
        return DashboardHealth.TREND_SERIES.find((s) => s.id === id)
            || DashboardHealth.TREND_SERIES[0];
    }

    /** A day's value for the active series, or null for a day with nothing in it. */
    trendPercent(point, series = this.activeTrendSeries()) {
        const total = Number(point?.n) || 0;
        if (!total) return null;
        if (series.mode === 'count') {
            return Number(point?.[series.key]) || 0;
        }
        if (series.key === 'c') {
            // Score is already a 0–100 average, not a share of the total.
            const score = Number(point?.c);
            return Number.isFinite(score) && score > 0 ? Math.round(score) : null;
        }
        return Math.round(((Number(point?.[series.key]) || 0) / total) * 100);
    }

    /**
     * Change against the oldest recorded day, shown beside the healthy badge.
     *
     * Compared against the start of the window rather than yesterday: a one-day
     * delta on a collection that is checked daily is mostly noise, while "up 12
     * points this month" is the thing worth knowing. Hidden entirely with fewer
     * than two days recorded — a trend needs something to trend from.
     */
    /** The trend arrow's plain-language label, shared by the badge's aria-label
     *  and the header meta block's popover, so the wording never drifts. */
    trendDeltaLabel() {
        const points = this.trendPoints();
        if (points.length < 2) return '';
        const first = this.trendPercent(points[0]);
        const last = this.trendPercent(points[points.length - 1]);
        if (first === null || last === null) return '';

        const delta = last - first;
        const days = points.length;
        // Zero is worth saying: "unchanged over 30 days" is a real answer, and
        // hiding it would make the badge appear only when something moved.
        return delta === 0
            ? this.t('dashboard.healthTrendFlat', 'unchanged over {days} days', { days })
            : (delta > 0
                ? this.t('dashboard.healthTrendUp', 'up {points} points over {days} days', { points: delta, days })
                : this.t('dashboard.healthTrendDown', 'down {points} points over {days} days', { points: Math.abs(delta), days }));
    }

    renderTrendDelta() {
        const points = this.trendPoints();
        if (points.length < 2) return '';
        const first = this.trendPercent(points[0]);
        const last = this.trendPercent(points[points.length - 1]);
        if (first === null || last === null) return '';

        const delta = last - first;
        const dir = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
        const arrow = delta > 0 ? '▲' : (delta < 0 ? '▼' : '–');
        const label = this.trendDeltaLabel();

        // A button rather than a span: this is where the eye already reads the
        // direction of travel, so it is the natural second way into the chart —
        // and the one that works when the tile row is scrolled off.
        return `<button type="button" class="health-view-trend-delta is-${dir}" data-health-trend-open
                    title="${this.escape(this.t('dashboard.healthTrendOpenHint', 'Show the trend chart'))}"
                    aria-label="${this.escape(label)}">`
            + `<span aria-hidden="true">${arrow}${delta === 0 ? '' : Math.abs(delta)}</span></button>`;
    }

    /**
     * The collection's healthy share over time, as a sparkline under the header.
     *
     * Reuses nothing from renderSparkline: that one plots response times from
     * heartbeat buckets on a fixed axis, where this is a percentage on a 0–100
     * axis with gaps for days the app was not opened. Sharing them would mean a
     * function with two unrelated modes.
     */
    renderTrendChart() {
        const points = this.trendPoints();
        if (points.length < 3) return '';

        const series = this.activeTrendSeries();
        const values = points.map((p) => this.trendPercent(p, series));
        if (values.filter((v) => v !== null).length < 3) return '';

        // A percentage has a fixed 0–100 axis so a two-point move looks like a
        // two-point move; a count has no natural ceiling, so it takes the
        // window's own maximum with a little headroom.
        const maxValue = series.mode === 'count'
            ? Math.max(1, ...values.filter((v) => v !== null)) * 1.1
            : 100;

        // Sized for the note row rather than the button row it used to sit in.
        // The taller box is what makes a two-point move legible on a fixed
        // 0–100 axis; at 34px high the line was a flat smear.
        const w = 240;
        const h = 96;
        const padY = 8;
        const plotH = h - padY * 2;
        const step = w / Math.max(1, values.length - 1);

        // Fixed 0–100 axis rather than min/max scaling: a collection that moved
        // between 91% and 93% should look flat, not like a cliff.
        const yFor = (v) => (h - padY - (v / maxValue) * plotH).toFixed(1);

        // Days with no recorded point break the line instead of interpolating,
        // matching how the response sparkline treats missing buckets.
        const segments = [];
        let current = [];
        values.forEach((v, i) => {
            if (v === null) {
                if (current.length > 1) segments.push(current);
                current = [];
                return;
            }
            current.push(`${(i * step).toFixed(1)},${yFor(v)}`);
        });
        if (current.length > 1) segments.push(current);
        if (!segments.length) return '';

        const paths = segments.map((pts) =>
            `<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`
        ).join('');

        const first = values.find((v) => v !== null);
        const last = [...values].reverse().find((v) => v !== null);
        const label = this.t('dashboard.healthTrendChartLabel',
            'Healthy bookmarks over the last {days} days, from {first}% to {last}%',
            { days: points.length, first, last });

        // Just the ceiling and the midpoint. At this height the quarter lines
        // crowded the plot, and these two are the ones that carry meaning: where
        // 100% sits, and which half of the range the line is in.
        const grid = [maxValue / 2, maxValue].map((v) => {
            const y = yFor(v);
            const top = v === maxValue;
            return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="currentColor"
                          stroke-width="0.5" ${top ? 'stroke-dasharray="3 3"' : ''}
                          opacity="${top ? 0.45 : 0.2}"/>`;
        }).join('');

        // The last reading, marked: the eye should land on where the collection
        // stands now, not on the middle of the line.
        const lastIndex = values.reduce((acc, v, i) => (v === null ? acc : i), -1);
        const endDot = lastIndex >= 0
            ? `<circle cx="${(lastIndex * step).toFixed(1)}" cy="${yFor(values[lastIndex])}" r="2.5"
                       fill="currentColor"/>`
            : '';

        const caption = this.t('dashboard.healthTrendCaption', '{days} days', { days: points.length });
        const helpLabel = this.t('dashboard.healthTrendHelpHint', 'What this chart shows');

        // One hit zone per day, laid over the plot. Percentage widths rather
        // than SVG geometry: the chart stretches with preserveAspectRatio="none",
        // so anything positioned inside the viewBox would drift away from what
        // the pointer is actually over.
        const zoneW = 100 / values.length;
        const zones = values.map((v, i) => {
            const point = points[i];
            const day = this.trendPointLabel(point);
            const readout = v === null
                ? this.t('dashboard.healthTrendNoData', 'no reading')
                : (series.mode === 'count' ? String(v) : `${v}%`);
            return `<button type="button" class="health-view-trend-zone"
                        style="left:${(i * zoneW).toFixed(3)}%;width:${zoneW.toFixed(3)}%"
                        data-trend-day="${this.escape(day)}"
                        data-trend-value="${this.escape(readout)}"
                        data-trend-empty="${v === null ? 'true' : 'false'}"
                        tabindex="-1" aria-hidden="true"></button>`;
        }).join('');

        return `<div class="health-view-trend">
            <div class="health-view-trend-head">
                <span class="health-view-trend-title">${this.escape(
                    this.t(`dashboard.${series.labelKey}`, series.fallback)
                )}</span>
                <span class="health-view-trend-series">${DashboardHealth.TREND_SERIES.map((entry) => `
                    <button type="button" class="health-view-trend-series-btn${entry.id === series.id ? ' is-active' : ''}"
                            data-trend-series="${this.escape(entry.id)}"
                            aria-pressed="${entry.id === series.id ? 'true' : 'false'}">${this.escape(
                                this.t(`dashboard.${entry.labelKey}`, entry.fallback)
                            )}</button>`).join('')}</span>
                <button type="button" class="view-help-btn health-view-trend-help" data-health-trend-help
                        aria-haspopup="dialog"
                        title="${this.escape(helpLabel)}"
                        aria-label="${this.escape(helpLabel)}">ℹ</button>
            </div>
            <div class="health-view-trend-plot">
                <!-- Outside the SVG: preserveAspectRatio="none" would stretch
                     the type along with the plot. -->
                <span class="health-view-trend-axis health-view-trend-axis--max">${this.escape(
                    series.mode === 'count' ? String(Math.round(maxValue)) : '100%'
                )}</span>
                <span class="health-view-trend-axis health-view-trend-axis--mid">${this.escape(
                    series.mode === 'count' ? String(Math.round(maxValue / 2)) : '50%'
                )}</span>
                <span class="health-view-trend-axis health-view-trend-axis--min">${this.escape(
                    series.mode === 'count' ? '0' : '0%'
                )}</span>
                <svg class="health-view-trend-chart" viewBox="0 0 ${w} ${h}"
                     preserveAspectRatio="none"
                     role="img" aria-label="${this.escape(label)}">
                    ${grid}
                    ${paths}
                    ${endDot}
                </svg>
                <div class="health-view-trend-zones">${zones}</div>
                <span class="health-view-trend-tip" hidden></span>
            </div>
            <div class="health-view-trend-xaxis" aria-hidden="true">
                <span>${this.escape(this.trendPointLabel(points[0]))}</span>
                <span>${this.escape(this.trendPointLabel(points[Math.floor((points.length - 1) / 2)]))}</span>
                <span>${this.escape(this.trendPointLabel(points[points.length - 1]))}</span>
            </div>
            <div class="health-view-trend-foot">
                <span class="health-view-trend-caption">${this.escape(caption)}</span>
                <span class="health-view-trend-now">${this.escape(
                    series.mode === 'count'
                        ? this.t('dashboard.healthTrendNowCount', 'now {value}', { value: last })
                        : this.t('dashboard.healthTrendNow', 'now {value}%', { value: last })
                )}</span>
            </div>
        </div>`;
    }

    /** A trend point's day, as short as the tooltip has room for. */
    trendPointLabel(point) {
        // HealthTrendPoint.t is Unix ms at the start of the day it describes.
        const ms = Number(point?.t) || 0;
        if (!ms) return '';
        const date = new Date(ms);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return date.toLocaleDateString(this.dashboard?.language?.current || undefined,
                { month: 'short', day: 'numeric' });
        } catch {
            return date.toISOString().slice(0, 10);
        }
    }

    /**
     * Hover readout for the trend chart.
     *
     * The zones are plain buttons rather than SVG hit areas so the pointer maths
     * stays in CSS percentages — see the comment where they are built.
     */
    bindTrendChart(root) {
        // Switching series redraws the chart in place: the note row it sits in
        // is rebuilt by the caller, and re-rendering the whole view would scroll
        // the list back to the top for a chart change.
        root.querySelectorAll('[data-trend-series]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-trend-series');
                if (!id || id === this.trendSeriesId) return;
                this.trendSeriesId = id;
                window.nextdashTrack?.('health:trend-series', { series: id });
                const holder = root;
                holder.innerHTML = this.renderTrendChart();
                holder.querySelector('[data-health-trend-help]')?.addEventListener('click', () => {
                    this.showTrendExplainer();
                });
                this.bindTrendChart(holder);
            });
        });

        const plot = root.querySelector('.health-view-trend-plot');
        if (!plot) return;
        const tip = plot.querySelector('.health-view-trend-tip');
        if (!tip) return;

        const show = (zone) => {
            const day = zone.dataset.trendDay || '';
            const value = zone.dataset.trendValue || '';
            tip.textContent = day ? `${day} · ${value}` : value;
            tip.hidden = false;
            // Clamped so the readout never hangs off either edge of the plot.
            const left = zone.offsetLeft + zone.offsetWidth / 2;
            const half = tip.offsetWidth / 2;
            const max = plot.clientWidth - half;
            tip.style.left = `${Math.min(Math.max(left, half), Math.max(half, max))}px`;
            plot.classList.add('is-probing');
            zone.classList.add('is-active');
        };
        const hide = () => {
            tip.hidden = true;
            plot.classList.remove('is-probing');
            plot.querySelectorAll('.health-view-trend-zone.is-active')
                .forEach((z) => z.classList.remove('is-active'));
        };

        plot.querySelectorAll('.health-view-trend-zone').forEach((zone) => {
            zone.addEventListener('mouseenter', () => show(zone));
            zone.addEventListener('focus', () => show(zone));
        });
        plot.addEventListener('mouseleave', hide);
        plot.addEventListener('blur', hide, true);
    }

    /**
     * What the trend line is actually plotting, behind the ℹ beside it.
     *
     * Kept separate from showHealthExplainer: that one covers the whole view,
     * and the questions this chart raises — why the axis is fixed, why a line
     * has gaps, what a day even is here — are specific enough that folding them
     * in would bury them.
     */
    showTrendExplainer() {
        if (typeof window.AppModal?.show !== 'function') return;
        window.nextdashTrack?.('health:trend-explainer');

        const points = this.trendPoints();
        const paras = [
            this.t('dashboard.healthTrendHelpWhat',
                'The share of your bookmarks that counted as healthy on each day, going back {days} days.',
                { days: points.length }),
            this.t('dashboard.healthTrendHelpAxis',
                'The axis is fixed at 0–100%, so the line only moves when the number really moves. A collection sitting between 91% and 93% looks flat here, which is the honest picture — scaling to the range would turn that into a cliff.'),
            this.t('dashboard.healthTrendHelpGaps',
                'A reading is recorded when the health report runs, so days you did not open nextDash leave a gap and the line breaks rather than guessing across it.'),
            this.t('dashboard.healthTrendHelpHealthy',
                'Healthy means reachable if checking is on, opened recently enough, and not clashing with another bookmark — the same rule the Healthy tile counts.'),
        ];

        window.AppModal.show({
            title: this.t('dashboard.healthTrendTitle', 'Healthy over time'),
            htmlMessage: paras.map((p) => `<p>${this.escape(p)}</p>`).join(''),
            confirmText: this.t('common.close', 'close'),
            showCancel: false,
            modalClass: 'health-trend-explainer-modal',
        });
    }

    /**
     * The way from a symptom to the setting behind it.
     *
     * This is the screen where you conclude that checks run too rarely, that the
     * alert threshold is wrong, or that a nightly backup needs a maintenance
     * window — and every one of those lives in Config → Behavior → Status &
     * health, which the view otherwise only ever named in prose. Rendered
     * beside the header rather than inside the trend row, because the trend
     * only draws once there are three days of history and a link to the
     * settings has no business appearing and disappearing with it.
     */
    renderSettingsLink() {
        const label = this.t('dashboard.healthSettingsLink', 'settings');
        const hint = this.t(
            'dashboard.healthSettingsLinkHint',
            'Check interval, alert threshold, maintenance windows and downtime alerts'
        );
        return `<button type="button" class="health-view-settings-link"
            title="${this.escape(hint)}"
            aria-label="${this.escape(hint)}">${this.escape(label)}</button>`;
    }

    /** Plain-language explanation for the title block's hover popover. */
    headerTitleHint() {
        return this.t(
            'dashboard.healthHeaderTitleHint',
            'This view lists bookmarks that need attention: broken links, content that no longer matches what was expected, and monitors that are down. The path above shows the active filter.'
        );
    }

    /**
     * Plain-language explanation for the stats block's hover popover, folding
     * together what used to be four separate native title tooltips (percentage,
     * trend arrow, broken count, report age) into one sentence — hovering
     * anywhere over the block now explains the whole thing at once instead of
     * requiring four separate, precisely-aimed hovers.
     */
    headerMetaHint() {
        const summary = this.report?.summary || {};
        const healthy = Number(summary.healthyCount) || 0;
        const total = Number(summary.totalBookmarks) || 0;
        const pct = this.healthyPercent();
        const broken = this.brokenCount();

        const parts = [
            total
                ? this.t('dashboard.healthHeaderHealthyDetail', '{count} of {total} healthy', { count: healthy, total })
                : this.t('dashboard.healthHeaderHealthyPct', '{pct}% healthy', { pct }),
        ];

        const trendLabel = this.trendDeltaLabel();
        if (trendLabel) parts.push(trendLabel);

        if (broken > 0) {
            parts.push(broken === 1
                ? this.t('dashboard.healthBrokenOne', '1 broken')
                : this.t('dashboard.healthBrokenCount', '{count} broken', { count: broken }));
        }

        parts.push(this.t(
            'dashboard.healthReportAgeTitle',
            'When this report was generated. Use Retest all to refresh it.'
        ));

        return parts.join(' — ');
    }

    renderHeader() {
        const pct = this.healthyPercent();
        const broken = this.brokenCount();
        const pctLabel = this.t('dashboard.healthHeaderHealthyPct', '{pct}% healthy', { pct });
        const trail = this.headerBreadcrumb();
        const showTrail = trail.includes(' › ');

        const header = document.createElement('div');
        header.className = 'health-view-header';
        header.innerHTML = `
            <div class="health-view-header-text" tabindex="0" role="group" aria-label="${this.escape(this.headerTitleHint())}">
                <div class="health-view-title-row">
                    <h2 class="health-view-title">${this.escape(this.t('dashboard.healthPageTitle', 'Health'))}</h2>
                    <p class="health-view-head-breadcrumb"${showTrail ? '' : ' hidden'}>${this.escape(trail)}</p>
                </div>
            </div>
            <div class="health-view-header-second-row">
                <p class="health-view-subtitle">${this.escape(this.t('dashboard.healthPageSubtitle', 'Bookmarks that need attention'))}</p>
                <div class="health-view-header-meta" tabindex="0" role="group" aria-label="${this.escape(this.headerMetaHint())}">
                    <span class="health-view-score-badge ${this.bandClass(pct)}" aria-label="${this.escape(pctLabel)}">${pct}%</span>
                    ${this.renderTrendDelta()}
                    ${broken > 0
                        ? `<span class="health-view-issue-count">${this.escape(
                            broken === 1
                                ? this.t('dashboard.healthBrokenOne', '1 broken')
                                : this.t('dashboard.healthBrokenCount', '{count} broken', { count: broken })
                        )}</span>`
                        : ''}
                    ${this.renderReportAge()}
                </div>
            </div>
        `;
        window.DashboardSmartWhyPopover?.attach?.(header.querySelector('.health-view-header-text'), this.headerTitleHint());
        window.DashboardSmartWhyPopover?.attach?.(header.querySelector('.health-view-header-meta'), this.headerMetaHint());
        header.querySelector('[data-health-trend-open]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showTrendChart();
        });
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
            { key: 'healthy', label: this.t('dashboard.healthTileHealthy', 'Healthy'), value: healthy, tone: 'good' },
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
                // Read out and hovered, not printed. It used to render under the
                // count so the fact needed no mouse, but the sentence is four
                // times the width of every other tile's label and pushed the
                // whole row sideways to hold it. The count turning red already
                // says something is down here, the title and the aria-label say
                // how many, and the fleet panel below prints it in full.
                sub: monitorsDown > 0
                    ? this.t('dashboard.healthTileMonitoredDown', '{count} of {total} not responding', { count: monitorsDown, total: monitored })
                    : '',
                subVisible: false,
            },
            // Each tile says what its number means. The labels are one word by
            // necessity — seven of them share a row — and "Stale" next to "Unused"
            // does not tell you which is about opening and which is about checking.
            {
                key: 'broken',
                label: this.t('dashboard.healthTileBroken', 'Broken'),
                // What the Broken filter selects, which is every row carrying the
                // broken flag — a monitored bookmark that is down carries it too.
                // The report keeps the two apart in its own counters so the
                // header can tell a live outage from a dead link, and the tile
                // used to show only the second: a single monitor down read as
                // "Broken 0" beside a pill saying "Broken 1", and with zero
                // tiles now hidden the tile vanished entirely while the filter
                // still had a row in it. The split stays visible in the
                // Monitored tile, which names it in full. Read from the filter
                // itself rather than added up from two counters: then it cannot
                // drift from what clicking the tile shows.
                value: this.filterCount('broken'),
                tone: 'bad',
                title: monitorsDown > 0
                    ? this.t('dashboard.healthTileBrokenHintMonitors',
                        'Did not respond when last checked — {count} of them monitored', { count: monitorsDown })
                    : this.t('dashboard.healthTileBrokenHint', 'Did not respond when last checked'),
            },
            {
                key: 'content',
                label: this.t('dashboard.healthTileContent', 'Content'),
                value: Number(summary.contentCount) || 0,
                tone: 'bad',
                title: this.t('dashboard.healthTileContentHint', 'The site answered, but not the way this bookmark expects'),
            },
            {
                key: 'unchecked',
                label: this.t('dashboard.healthTileUnchecked', 'Unchecked'),
                value: Number(summary.uncheckedCount) || 0,
                tone: 'warn',
                title: this.t('dashboard.healthTileUncheckedHint', 'Checking is on, but no check has run recently'),
            },
            {
                key: 'stale',
                label: this.t('dashboard.healthTileStale', 'Stale'),
                value: Number(summary.staleCount) || 0,
                tone: 'warn',
                title: this.t('dashboard.healthTileStaleHint', 'Not opened in over 30 days'),
            },
            {
                key: 'unused',
                label: this.t('dashboard.healthTileUnused', 'Unused'),
                value: Number(summary.unusedCount) || 0,
                tone: 'warn',
                title: this.t('dashboard.healthTileUnusedHint', 'Never opened since it was added'),
            },
        ];

        // Drift only ever holds bookmarks that opted into watching for it, so a
        // zero here is the normal state for most installs — shown only when
        // there is something to say, the same rule the certificates tile below
        // follows.
        const driftCount = Number(summary.driftCount) || 0;
        if (driftCount > 0) {
            tiles.push({
                key: 'drift',
                label: this.t('dashboard.healthTileDrift', 'Drift'),
                value: driftCount,
                tone: 'warn',
                title: this.t('dashboard.healthTileDriftHint', 'The page no longer looks like what was saved — redirect, title, or content changed'),
            });
        }

        // Certificates count hosts, not bookmarks, which is why this tile had no
        // key and did nothing when clicked -- indistinguishable from the six
        // beside it that do. The rows are reachable after all: certFor() maps a
        // row to its host's certificate for the badge, so the filter asks the
        // same question. The count stays the number of hosts, and the list it
        // opens is the bookmarks on them, which is what someone clicking a
        // warning is looking for.
        const certCount = this.certWarningCount();
        if (certCount > 0) {
            tiles.push({
                key: 'certificates',
                label: this.t('dashboard.healthTileCerts', 'Certificates'),
                value: certCount,
                tone: 'warn',
                title: this.t('dashboard.healthTileCertsHint', 'Hosts whose TLS certificate expires soon — the affected rows are badged'),
            });
        }

        const wrap = document.createElement('div');
        wrap.className = 'health-view-tiles';
        // The trend closes the row: it is the only cell that is not a count of
        // something, and reading it last matches how the row is used — the
        // numbers are the work, the line is the context.
        const trendTile = this.renderTrendTile();
        // A problem you do not have is not worth a cell. Drift and Certificates
        // have worked this way from the start; the rest kept showing a zero,
        // which spent a quarter of the row on "nothing here" and made the row
        // wide enough to scroll. Total, Healthy and Monitored always stay: they
        // describe the collection rather than a backlog, and a zero in them is
        // itself the answer.
        const alwaysShown = new Set(['all', 'healthy', 'monitored']);
        const shown = tiles.filter((tile) => alwaysShown.has(tile.key) || tile.value > 0);
        wrap.innerHTML = shown.map((tile) => {
            const active = tile.key && this.filter === tile.key ? ' is-active' : '';
            // Zero problems is good news: drop the severity colour so only a real
            // count is tinted red or orange.
            const zero = tile.value === 0 ? ' health-view-tile--zero' : '';
            // Named modifier so the monitored tile can style its live state
            // without the tone classes having to mean something different here.
            const named = tile.key === 'monitored' ? ' health-view-tile--monitored' : '';
            const cls = `health-view-tile health-view-tile--${tile.tone}${zero}${named}${active}`;
            const title = tile.title ? ` title="${this.escape(tile.title)}"` : '';
            const body = `<span class="health-view-tile-label">${this.escape(tile.label)}</span>`
                + `<span class="health-view-tile-value">${this.escape(tile.value)}</span>`
                + (tile.sub && tile.subVisible !== false
                    ? `<span class="health-view-tile-sub">${this.escape(tile.sub)}</span>` : '');
            // aria-label replaces title for assistive tech rather than supplementing
            // it, so the sub line's fact has to be folded in here too or a
            // screen-reader user would miss exactly what a sighted user now sees.
            const ariaLabel = tile.sub
                ? `${tile.label}: ${tile.value} — ${tile.sub}`
                : `${tile.label}: ${tile.value}`;
            // Keyless tiles report something the list cannot be filtered by, so
            // they render as plain text rather than a button that would look
            // clickable and then do nothing.
            if (!tile.key) {
                return `<span class="${cls} health-view-tile--static"${title} role="listitem"
                    aria-label="${this.escape(ariaLabel)}">${body}</span>`;
            }
            return `<button type="button" class="${cls}" data-health-tile="${tile.key}" tabindex="-1"${title} aria-label="${this.escape(ariaLabel)}">${body}</button>`;
        }).join('') + trendTile;

        wrap.querySelector('[data-health-trend-open]')?.addEventListener('click', () => {
            this.showTrendChart();
        });

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
    /**
     * "Export history" — every monitor's recorded samples, not the row list.
     *
     * Only on the Monitored filter. The toolbar's own Export already means "the
     * filtered list as CSV", and two Export buttons side by side on a filter
     * holding unmonitored rows would be a coin toss. On Monitored the list and
     * the history describe the same bookmarks, so the pair reads as two views of
     * one set: the rows, or their measurements.
     */
    renderHistoryExportButton() {
        if (this.filter !== 'monitored') return '';
        return `<button type="button" class="health-view-history-export-btn" title="${this.escape(
            this.t('dashboard.healthHistoryExportAllHint', 'Download recorded uptime samples for every monitored bookmark')
        )}">${this.escape(this.t('dashboard.healthHistoryExportAll', 'Export history'))}</button>`;
    }

    /**
     * Turn checking on for everything the current filter shows.
     *
     * The labels say "shown" rather than "these" on purpose. These buttons act
     * on the filtered list, while the bulk bar directly below them acts on the
     * ticked rows — and with a selection open both are on screen at once, so
     * "Monitor these 3" sat a few pixels above "2 selected" with nothing to say
     * which set was which. The confirmation has always named the right scope
     * ("in the current list"); only the buttons were ambiguous.
     */
    renderBulkEnableButtons() {
        if (this.filter === 'all') return '';
        const monitorCount = this.bulkEnableTargets('monitor').length;
        const periodicCount = this.bulkEnableTargets('periodic').length;
        let html = '';
        if (monitorCount) {
            html += `<button type="button" class="health-view-bulk-monitor-btn" title="${this.escape(
                this.t('dashboard.healthBulkEnableHint', 'Set the {count} bookmark(s) this filter shows to Monitor — not the ticked rows', { count: monitorCount })
            )}">${this.escape(this.t('dashboard.healthBulkEnable', 'Monitor all {count} shown', { count: monitorCount }))}</button>`;
        }
        if (periodicCount) {
            html += `<button type="button" class="health-view-bulk-periodic-btn" title="${this.escape(
                this.t('dashboard.healthBulkEnablePeriodicHint', 'Set the {count} bookmark(s) this filter shows to Periodic — not the ticked rows', { count: periodicCount })
            )}">${this.escape(this.t('dashboard.healthBulkEnablePeriodic', 'Periodic all {count} shown', { count: periodicCount }))}</button>`;
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

    /**
     * Fetch previews, on the filter that is about their absence.
     *
     * Missing preview is the one filter whose rows the toolbar could not act
     * on: Re-check and Retest all run the availability check, which never asks
     * a page for its title, description or image -- so eighty-seven rows sat
     * under two buttons that could not, by design, change the number above
     * them, and nothing said so. The route that does it lives in Config → Data
     * & backups → Icons & previews; this is the same call, offered where the
     * question is asked.
     */
    renderFetchPreviewsButton() {
        if (this.filter !== 'missing-preview' || this.filterCount('missing-preview') <= 0) {
            return '';
        }
        return `<button type="button" class="health-view-fetch-previews-btn" title="${this.escape(
            this.t('dashboard.healthFetchPreviewsHint', 'Ask every bookmark\u2019s page for its title, description and image')
        )}">${this.escape(this.t('dashboard.healthFetchPreviews', 'Fetch previews'))}</button>`;
    }

    /**
     * Ask every bookmark's page for its preview again, then redraw.
     *
     * Every bookmark rather than only the filtered rows: the endpoint is the
     * one Config offers and it walks the whole collection. It is a slow call --
     * one request per bookmark -- so the button says what it is doing and the
     * report is reloaded rather than guessed at afterwards.
     */
    async fetchMissingPreviews(button) {
        if (this._fetchPreviewsRunning) return;
        const missing = this.filterCount('missing-preview');
        if (!missing) return;

        const ok = await this.confirm(
            this.t('dashboard.healthFetchPreviews', 'Fetch previews'),
            this.t('dashboard.healthFetchPreviewsConfirm',
                'Ask every bookmark\u2019s page for its title, description and image? {count} row(s) have none. This is one request per bookmark, so it takes a while.',
                { count: missing }),
            { confirmText: this.t('dashboard.healthFetchPreviews', 'Fetch previews') }
        );
        if (!ok) return;

        this._fetchPreviewsRunning = true;
        const label = button?.textContent;
        if (button) {
            button.disabled = true;
            button.textContent = this.t('dashboard.healthFetchPreviewsRunning', 'Fetching\u2026');
        }
        window.nextdashTrack?.('health:fetch-previews');
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/previews/refresh', { method: 'POST' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // The flag is read from what is stored on the bookmark, not from the
            // preview cache, so both have to be re-read before the count means
            // anything.
            await this.dash.loadAllBookmarks?.();
            await this.loadAndRender({ refresh: true });
            this.dash.showNotification?.(
                this.t('dashboard.healthFetchPreviewsDone', 'Previews fetched.'), 'success');
        } catch {
            this.dash.showNotification?.(
                this.t('dashboard.healthFetchPreviewsError', 'Could not fetch the previews.'), 'error');
        } finally {
            this._fetchPreviewsRunning = false;
            if (button && button.isConnected) {
                button.disabled = false;
                if (label) button.textContent = label;
            }
        }
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
            /*
             * One exit, taken exactly once.
             *
             * This menu is built by hand rather than through the view's menu
             * machinery, so nothing else cleans it up -- and it lives inside
             * the container that render() empties. Cleaning up only on the two
             * happy paths meant a re-render (pressing R, the monitored
             * refresh, a filter click) took the menu away and left the
             * capturing listener bound for the life of the page, with the
             * promise never settling: the merge flow awaiting it was wedged,
             * and each repeat stacked another listener that fired on every
             * click from then on.
             */
            let done = false;
            const settle = (value) => {
                if (done) return;
                done = true;
                document.removeEventListener('click', onDocClick, true);
                observer.disconnect();
                menu.remove();
                resolve(value);
            };
            const onDocClick = (e) => {
                if (menu.contains(e.target) || wrap.contains(e.target)) {
                    return;
                }
                settle(null);
            };
            // The menu leaving the document is a cancel like any other, and it
            // is the only one that arrives without a click to hang it on.
            const observer = new MutationObserver(() => {
                if (!menu.isConnected) settle(null);
            });
            observer.observe(document.getElementById('dashboard-layout') || document.body,
                { childList: true, subtree: true });
            setTimeout(() => {
                if (!done) document.addEventListener('click', onDocClick, true);
            }, 0);
            menu.querySelectorAll('[data-merge-group]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const index = Number(btn.getAttribute('data-merge-group'));
                    settle(groups[index] || null);
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
        const pinnedSuffix = keeper.pinned
            ? this.t('dashboard.mergePinnedSuffix', ', pinned')
            : '';
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
            // Re-read the page rather than rendering from memory: a merge deletes
            // rows, and nothing has patched d.bookmarks. Rendering without this
            // left the merged-away duplicates on the dashboard until a page
            // switch. loadPageBookmarks re-renders, so no separate render call.
            await d.loadPageBookmarks(d.currentPageId, { skipInlineEditConfirm: true });
            await this.loadAndRender({ refresh: true });
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
    /**
     * The less-common filters, shown in the overflow menu rather than as their
     * own pills — with up to ten pills otherwise competing for one row, most
     * wrapped onto a second line no matter the screen width. Same
     * count-gating as before: a filter with nothing in it, and not the one
     * currently active, does not appear at all.
     */
    secondaryFilterEntries() {
        const secondary = [
            ['stale', this.t('dashboard.healthFilterStale', 'Stale')],
            ['unused', this.t('dashboard.healthFilterUnused', 'Unused')],
            ['drift', this.t('dashboard.healthFilterDrift', 'Drift')],
            ['shortcut-conflict', this.t('dashboard.healthFilterShortcutConflict', 'Shortcut conflicts')],
            ['orphaned-category', this.t('dashboard.healthFilterOrphanedCategory', 'Missing category')],
            ['missing-preview', this.t('dashboard.healthFilterMissingPreview', 'Missing preview')],
            ['certificates', this.t('dashboard.healthFilterCertificates', 'Certificates')],
            ['healthy', this.t('dashboard.healthFilterHealthy', 'Healthy')],
            // Last, and only once there is something in it: a list of what you
            // have chosen not to see is worth having, and worth being able to
            // audit, but it is not where anyone starts.
            ['ignored', this.t('dashboard.healthFilterIgnored', 'Ignored')],
        ];
        return secondary.filter(([key]) => this.filterCount(key) > 0 || this.filter === key);
    }

    renderToolbar() {
        const checkedCount = this.checkedCount();
        const filters = [
            ['broken', this.t('dashboard.healthFilterBroken', 'Broken')],
            ['content', this.t('dashboard.healthFilterContent', 'Content')],
            ['duplicate', this.t('dashboard.healthFilterDuplicates', 'Duplicates')],
            ['unchecked', this.t('dashboard.healthFilterUnchecked', 'Unchecked')],
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
        filters.push(['all', this.t('dashboard.healthFilterAll', 'All')]);

        // Every filter is a pill, in one row that scrolls sideways when it runs
        // out of width. They used to live behind a "More" menu because the row
        // wrapped onto a second line — which made the strip a block, and hid
        // half the filters behind a click on every window size, including the
        // wide ones where they would all have fitted.
        filters.push(...this.secondaryFilterEntries());

        const renderPill = ([key, label]) => {
            const count = this.filterCount(key);
            const active = this.filter === key;
            // A zero count is width spent saying nothing: "Content 0" is three
            // characters wider than "Content" and tells you the same thing the
            // absence of a number does.
            const badge = count > 0
                ? `<span class="health-view-filter-count">${count}</span>`
                : '';
            return `<button type="button" class="health-view-filter-btn${active ? ' is-active' : ''}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}" data-health-filter="${key}">
                ${this.escape(label)}${badge}
            </button>`;
        };

        const toolbar = document.createElement('div');
        toolbar.className = 'health-view-toolbar';
        const pills = filters.map(renderPill).join('');

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
            <div class="health-view-filter-strip">
                <div class="health-view-filter-group" role="tablist" aria-label="${this.escape(this.t('dashboard.healthFilterLabel', 'Filter health issues'))}">${pills}</div>
            </div>
            <div class="health-view-toolbar-search-row">
                <input type="search" class="health-view-search-input" value="${this.escape(this.searchQuery)}" placeholder="${this.escape(this.t('dashboard.healthSearchPlaceholder', 'Search bookmarks…'))}" autocomplete="off" spellcheck="false" aria-label="${this.escape(this.t('dashboard.healthSearchPlaceholder', 'Search bookmarks…'))}">
                <select class="health-view-sort-select" aria-label="${this.escape(this.t('dashboard.healthSortLabel', 'Sort bookmarks'))}">${sortOptions}</select>
                <button type="button" class="health-view-groupby-btn${this.groupByHost ? ' is-active' : ''}"
                        aria-pressed="${this.groupByHost ? 'true' : 'false'}"
                        title="${this.escape(this.t('dashboard.healthGroupByHostHint', 'One host down takes every bookmark on it with it. Grouped by site, that reads as one problem.'))}">${this.escape(this.t('dashboard.healthGroupByHost', 'Group by site'))}</button>
            </div>
            <div class="health-view-toolbar-actions">
                <button type="button" class="health-view-focus-btn health-view-focus-btn--primary" title="${this.escape(this.t('dashboard.healthFocusHint', 'Work through this list one bookmark at a time'))}">${this.escape(this.t('dashboard.healthFocus', 'Work through'))}<kbd>f</kbd></button>
                <button type="button" class="health-view-rot-btn" title="${this.escape(this.t('dashboard.healthRotHint', 'What has gone, moved or been failing for a long time'))}">${this.escape(this.t('dashboard.healthRot', 'Rot report'))}</button>
                <span class="health-view-menu-wrap">
                <button type="button" class="health-view-toolbar-more" data-health-toolbar-more
                        data-menu-toggle="toolbar" data-menu-kind="toolbar"
                        aria-haspopup="menu" aria-expanded="false"
                        title="${this.escape(this.t('dashboard.healthToolbarMore', 'More actions'))}"
                        aria-label="${this.escape(this.t('dashboard.healthToolbarMore', 'More actions'))}">⋯</button>
                <div class="health-view-menu health-view-menu--toolbar" role="menu" hidden
                     data-menu-for="toolbar" data-menu-owner="toolbar"
                     aria-label="${this.escape(this.t('dashboard.healthToolbarMore', 'More actions'))}">
                <button type="button" class="health-view-export-btn" title="${this.escape(this.t('dashboard.healthExportHint', 'Download the filtered list as CSV'))}">${this.escape(this.t('dashboard.healthExport', 'Export rows'))}</button>
                ${this.renderHistoryExportButton()}
                ${this.renderOpenBrokenButton()}
                ${this.renderMergeDuplicateButton()}
                ${this.renderFetchPreviewsButton()}
                <button type="button" class="health-view-retest-btn">${this.escape(this.t('dashboard.healthRetest', 'Retest all'))}</button>
                <button type="button" class="health-view-checkoff-btn"${checkedCount ? '' : ' disabled'} title="${this.escape(checkedCount
                    ? this.t('dashboard.healthCheckOffHint', 'Turn off periodic checks and monitoring for all {count} bookmarks', { count: checkedCount })
                    : this.t('dashboard.healthCheckOffNone', 'No bookmarks have checking enabled'))}">${this.escape(this.t('dashboard.healthCheckOff', 'Checking off'))}</button>
                ${this.renderBulkEnableButtons()}
                ${this.renderSettingsLink()}
                </div>
                </span>
                <button type="button" class="view-help-btn health-view-help-btn" data-health-help
                        aria-haspopup="dialog"
                        title="${this.escape(this.t('dashboard.healthHelpHint', 'How the health view works'))}"
                        aria-label="${this.escape(this.t('dashboard.healthHelpHint', 'How the health view works'))}">ℹ</button>
            </div>
        `;

        toolbar.querySelector('.health-view-focus-btn')?.addEventListener('click', () => {
            this.focus?.open();
        });

        toolbar.querySelector('.health-view-export-btn')?.addEventListener('click', () => {
            this.exportFilteredCsv();
        });

        toolbar.querySelector('.health-view-rot-btn')?.addEventListener('click', () => {
            this.showRotReport();
        });

        /*
         * The hamburger, and everything that moved behind it.
         *
         * Eight buttons stood on two lines between the filters and the first
         * bookmark, of which Jordi named two he uses: Work through -- which
         * keeps the first slot and its own styling -- and Rot report. The rest,
         * plus the settings link that used to sit on the header, are one click
         * away through the same menu machinery a row's ⋯ uses, so Escape,
         * arrow keys and the outside-click dismiss come with it rather than
         * being written a second time.
         */
        toolbar.querySelector('[data-health-toolbar-more]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu('toolbar', 'toolbar');
        });

        toolbar.querySelector('.health-view-settings-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeAllMenus();
            this.openStatusHealthSettings();
        });

        toolbar.querySelector('[data-health-help]')?.addEventListener('click', () => {
            this.showHealthExplainer();
        });

        toolbar.querySelector('.health-view-history-export-btn')?.addEventListener('click', () => {
            window.nextdashTrack?.('health:history-export-all');
            this.downloadUrl('/api/health/history-export');
        });

        const openBrokenBtn = toolbar.querySelector('.health-view-open-broken-btn');
        openBrokenBtn?.addEventListener('click', () => {
            void this.openBrokenLinks(openBrokenBtn);
        });

        const previewsBtn = toolbar.querySelector('.health-view-fetch-previews-btn');
        previewsBtn?.addEventListener('click', () => {
            void this.fetchMissingPreviews(previewsBtn);
        });

        const mergeBtn = toolbar.querySelector('.health-view-merge-duplicates-btn');
        mergeBtn?.addEventListener('click', () => {
            void this.startMergeDuplicateFlow(mergeBtn);
        });

        toolbar.querySelector('.health-view-groupby-btn')?.addEventListener('click', () => {
            this.groupByHost = !this.groupByHost;
            this._trackAction('group-by-host', { on: this.groupByHost });
            this._resetFeedPaging();
            this.render();
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

        const applyFilter = (key, via) => {
            this.filter = key || 'broken';
            this.focusIssueKey = null;
            this._trackAction('filter', { filter: this.filter, via });
            this._resetFeedPaging();
            this.persistViewState();
            this.syncUrlState();
            this.render();
            this.dash.pageNav?.updatePageTitle?.();
            this.dash.pageNav?.updateDocumentTitle?.();
        };

        // Scoped to the tablist's direct pills, not the overflow menu inside
        // it: those buttons also carry [data-health-filter] but are hidden
        // until "More" opens them, and the arrow-key cycle below must only
        // step through what is actually visible and part of the tablist.
        const filterBtns = [...toolbar.querySelectorAll('.health-view-filter-group > [data-health-filter]')];
        filterBtns.forEach((btn, i) => {
            btn.addEventListener('click', () => applyFilter(btn.getAttribute('data-health-filter'), 'pill'));
            // The group announces itself as a tablist, so the keys that role
            // promises have to work: arrows wrap, Home/End jump to the ends.
            btn.addEventListener('keydown', (e) => {
                const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
                if (!keys.includes(e.key)) return;
                e.preventDefault();
                const last = filterBtns.length - 1;
                const next = e.key === 'Home' ? 0
                    : e.key === 'End' ? last
                        : e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
                            : (i === 0 ? last : i - 1);
                const target = filterBtns[next];
                if (!target) return;
                const key = target.getAttribute('data-health-filter');
                target.focus();
                applyFilter(key, 'keyboard');
                // render() rebuilds the toolbar wholesale and drops the focus set
                // above, so re-focus the replacement to keep arrowing usable.
                if (!target.isConnected) {
                    document.querySelector(`[data-health-filter="${CSS.escape(key)}"]`)?.focus();
                }
            });
        });

        // The row scrolls sideways rather than wrapping, so the active filter has
        // to be brought back into view after a render — otherwise picking one
        // from the right-hand end leaves it half off screen.
        requestAnimationFrame(() => {
            toolbar.querySelector('.health-view-filter-btn.is-active')
                ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
            // Drop the page cache first: the re-read below is served from it, so
            // without this the dashboard keeps showing the pre-write flags.
            d.data?.invalidatePageDataCache?.();
            await d.loadPageBookmarks(d.currentPageId, { skipInlineEditConfirm: true });
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
            // and the re-read below is served from the page cache, so that has to
            // go first or it just returns the stale values again.
            d.data?.invalidatePageDataCache?.();
            await d.loadPageBookmarks(d.currentPageId, { skipInlineEditConfirm: true });
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
        // Same as R: a deliberate reload asks for the list as it stands now.
        this.clearHandledRows();
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
            'orphaned-category': [
                this.t('dashboard.healthEmptyOrphanedCategory', 'No missing categories'),
                this.t('dashboard.healthEmptyOrphanedCategoryHint', 'Every bookmark is filed under a category that still exists on its page.'),
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
        const keys = window.KeyboardViewLegends
            ? window.KeyboardViewLegends.toLegendPairs(
                window.KeyboardViewLegends.HEALTH_VIEW,
                (key, fallback) => this.t(`dashboard.${key}`, fallback),
            )
            : [];
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
        if (d > 0) {
            return this.t('dashboard.healthDurationDaysHours', '{days}d {hours}h', { days: d, hours: h });
        }
        if (h > 0) {
            return this.t('dashboard.healthDurationHoursMinutes', '{hours}h {minutes}m', { hours: h, minutes: m });
        }
        if (m > 0) {
            return this.t('dashboard.healthDurationMinutes', '{minutes}m', { minutes: m });
        }
        return this.t('dashboard.healthDurationSeconds', '{seconds}s', { seconds: s });
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
        'all', 'broken', 'content', 'duplicate', 'shortcut-conflict', 'orphaned-category',
        'unchecked', 'stale', 'unused', 'missing-preview', 'certificates', 'healthy', 'monitored',
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
        // Independent of the URL/filter branch above: collapsing the fleet
        // panel is a display preference, not something a shared link should
        // override.
        try {
            const stored = JSON.parse(localStorage.getItem(DashboardHealth.STATE_KEY) || '{}');
            this.fleetDetailsCollapsed = stored.fleetDetailsCollapsed === true;
        } catch { /* unreadable storage falls back to expanded */ }
        return { refresh };
    }

    /** Remember filter and sort for the next visit. Best-effort by design. */
    persistViewState() {
        try {
            localStorage.setItem(
                DashboardHealth.STATE_KEY,
                JSON.stringify({ filter: this.filter, sort: this.sort, fleetDetailsCollapsed: this.fleetDetailsCollapsed })
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
        // Reloading on purpose is how you ask for the list as it stands now.
        this.clearHandledRows();
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

        // Monitoring columns are appended only when the exported list actually
        // holds a monitored row. On an ordinary Broken export they would be five
        // empty columns on every line, and the file is meant to be opened next to
        // a spreadsheet rather than explained.
        const withMonitors = issues.some((issue) => issue.monitor);

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
        if (withMonitors) {
            header.push(
                this.t('dashboard.healthExportColInterval', 'Monitor interval (min)'),
                this.t('dashboard.healthExportColUptime24h', 'Uptime 24h'),
                this.t('dashboard.healthExportColUptime7d', 'Uptime 7d'),
                this.t('dashboard.healthExportColUptime30d', 'Uptime 30d'),
                this.t('dashboard.healthExportColPing', 'Last response (ms)'),
                this.t('dashboard.healthExportColChecks', 'Checks recorded'),
            );
        }

        // Uptime as a bare number, not the on-screen "99.9%": a spreadsheet has to
        // be able to average this column. An empty cell means no samples in that
        // window, which is not the same as 0% and must not be written as one.
        const uptimeCell = (window) => (window?.samples ? Number((window.ratio * 100).toFixed(3)) : '');

        const rows = issues.map((issue) => {
            const row = [
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
            ];
            if (withMonitors) {
                // An unmonitored row in a mixed export leaves these blank rather
                // than writing zeroes, which would read as "0% uptime".
                const stats = issue.monitor ? issue.monitorStats : null;
                row.push(
                    stats?.intervalMinutes || '',
                    uptimeCell(stats?.uptime24h),
                    uptimeCell(stats?.uptime7d),
                    uptimeCell(stats?.uptime30d),
                    Number(stats?.lastPingMs) > 0 ? stats.lastPingMs : '',
                    stats?.totalChecks || '',
                );
            }
            return row;
        });

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

        // How often a monitor runs, changeable from the row rather than only from
        // the bookmark editor: this is the screen where you see the heartbeat and
        // decide the cadence is wrong. Shown only for a row already monitoring —
        // on an off/periodic row there is no interval to change, and picking one
        // would be a second way of enabling monitoring.
        const intervalRow = active === window.CheckMode.MONITOR
            ? `<span class="health-check-interval" role="group"
                    aria-label="${this.escape(this.t('dashboard.healthIntervalLabel', 'Check interval'))}">
                <span class="health-check-interval-label">${this.escape(this.t('dashboard.healthIntervalLabel', 'Check interval'))}</span>
                <span class="health-check-interval-options">${
                    window.CheckMode.INTERVAL_CHOICES.map((mins) => {
                        const current = window.CheckMode.intervalOf(issue) === mins;
                        return `<button type="button"
                            class="health-check-interval-btn${current ? ' is-active' : ''}"
                            role="menuitemradio" aria-checked="${current ? 'true' : 'false'}"
                            data-check-interval="${mins}"
                        >${this.escape(window.CheckMode.intervalLabel(mins))}</button>`;
                    }).join('')
                }</span>
            </span>`
            : '';

        // The way to everything else this bookmark can be told about itself.
        //
        // Expectations, drift watching and muting used to sit in this menu, and
        // between them they made it a form: 531px of content in a 382px window
        // on a 192px-wide popover, with five controls — including Save — below
        // the fold. A menu picks one thing and closes; that was a settings panel
        // wearing a menu's clothes. They now open in the row's own expanding
        // panel, which is the full width of the row rather than a popover's, so
        // nothing wraps to three lines and the Save button is on screen.
        const expectEntry = active === window.CheckMode.MONITOR
            ? `<button type="button" class="health-view-menu-item health-check-expect-open"
                    role="menuitem" data-expect-open>
                <span class="health-check-option-label">${this.escape(this.t('dashboard.healthExpectLabel', 'Expected response'))}</span>
                <span class="health-check-option-body">${this.escape(this.t(
                    'dashboard.healthExpectMenuHint',
                    'Keyword, status codes, rot watching and alerts'
                ))}</span>
            </button>`
            : '';

        // A span, not a div: this popover lives inside the row's <p> meta line, and
        // a block-level child there would make the parser close the paragraph
        // early, stranding the menu outside the row it belongs to.
        return `<span class="health-view-menu health-check-menu" role="menu" hidden
            data-menu-for="${this.escape(key)}" data-menu-owner="check"
            aria-label="${this.escape(this.t('dashboard.healthCheckModeLabel', 'Availability checking'))}">${items}${intervalRow}${expectEntry}</span>`;
    }

    /**
     * The certificate for this row's host, when it is close enough to matter.
     *
     * Looked up by hostname rather than carried on the issue: a certificate
     * belongs to a host, and ten bookmarks on one domain share one. The report
     * only sends the ones already near expiry, so anything found here is worth
     * showing.
     */
    renderCertBadge(issue) {
        const cert = this.certFor(issue);
        if (!cert) return '';
        const days = this.certDaysLeft(cert);
        const label = days < 0
            ? this.t('dashboard.healthCertExpired', 'Certificate expired')
            : this.t('dashboard.healthCertExpiring', 'Certificate: {days}d', { days });
        const title = days < 0
            ? this.t('dashboard.healthCertExpiredHint', 'The TLS certificate for {host} has expired', { host: cert.host })
            : this.t('dashboard.healthCertExpiringHint', 'The TLS certificate for {host} expires in {days} days', { host: cert.host, days });
        const tone = days < 0 ? 'expired' : (days <= 3 ? 'urgent' : 'warn');
        return `<span class="health-cert-badge is-${tone}" title="${this.escape(title)}">${this.escape(label)}</span>`;
    }

    /**
     * A rot finding for this row, when watching turned one up.
     *
     * The reason is what the row shows — it already names the redirect target
     * or the new title, so the badge itself stays short and the detail is one
     * hover away.
     */
    /**
     * Says that this row's alerts are silenced.
     *
     * Worth a badge rather than living only inside the check menu: a muted
     * bookmark still shows as down, so without this the row reads exactly like
     * one that should have paged you and did not. The badge is the difference
     * between "the alerting is broken" and "you turned this one off".
     */
    renderMutedBadge(issue) {
        if (!issue?.notifyMuted) return '';
        return `<span class="health-muted-badge" title="${this.escape(this.t(
            'dashboard.healthNotifyMutedHint',
            'Alerts are off for this bookmark. It is still checked, and still shown here.'
        ))}">${this.escape(this.t('dashboard.healthNotifyMutedBadge', 'Muted'))}</span>`;
    }

    renderDriftBadge(issue) {
        if (!issue?.watchDrift || !issue?.driftNoticed) return '';
        const label = String(issue.driftNoticed).startsWith('title')
            ? this.t('dashboard.healthDriftRetitled', 'Retitled')
            : (issue.driftNoticed === 'content'
                ? this.t('dashboard.healthDriftChanged', 'Changed')
                : this.t('dashboard.healthDriftMoved', 'Moved'));
        const title = issue.driftReason
            || this.t('dashboard.healthDriftGeneric', 'This page no longer looks like what was saved.');
        return `<span class="health-drift-badge" title="${this.escape(title)}">${this.escape(label)}</span>`;
    }

    /** The stored certificate for an issue's host, or null. */
    certFor(issue) {
        const certs = this.report?.certificates;
        if (!certs || !issue) return null;
        // certHost is the host a check actually saw over TLS, which after a
        // redirect can differ from the bookmark's own URL — certificates are
        // stored per host, so this is the key that actually matches. Falls back
        // to the bookmark's own hostname only when no check has recorded one yet.
        const certHost = String(issue.certHost || '').toLowerCase();
        if (certHost) return certs[certHost] || null;
        if (!issue.url) return null;
        let host = '';
        try {
            host = new URL(String(issue.url)).hostname.toLowerCase();
        } catch {
            return null;
        }
        return certs[host] || null;
    }

    /** Whole days until a certificate expires; negative once past. */
    certDaysLeft(cert) {
        const expires = Number(cert?.expiresAt) || 0;
        if (!expires) return 0;
        return Math.floor((expires - Date.now()) / 86400000);
    }

    /** Hosts whose certificate is near expiry, for the tile. */
    certWarningCount() {
        const certs = this.report?.certificates;
        return certs ? Object.keys(certs).length : 0;
    }

    /**
     * Which live-monitor bucket a row belongs in: down beats drift beats a
     * certificate warning beats healthy, matching the priority order the row
     * badges already use (a down monitor's badge would eclipse a drift badge
     * anyway, so grouping by anything else would disagree with the row itself).
     *
     * Only meaningful for monitored rows — callers on the Monitored filter can
     * assume every issue passed in has `monitor === true`.
     */
    monitorGroupFor(issue) {
        if (Number(issue?.monitorStats?.downSince) > 0) return 'down';
        if (issue?.watchDrift && issue?.driftNoticed) return 'drift';
        if (this.certFor(issue)) return 'cert';
        return 'healthy';
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
        // How many checks the percentage rests on, shown rather than hidden in the
        // tooltip: "100%" from three samples and "100%" from three hundred look
        // identical otherwise, and the first is barely evidence. Marked
        // aria-hidden — the accessible name on the percentage already says it, so
        // a screen reader would otherwise read the number twice.
        const samples = Number(stats.uptime24h?.samples) || 0;
        const uptimeTitle = samples
            ? this.t('dashboard.healthUptime24hTitleChecks', 'Uptime over the last 24 hours, from {count} checks', { count: samples })
            : this.t('dashboard.healthUptime24hTitle', 'Uptime over the last 24 hours');
        const uptimeLabel = uptime
            ? `<span class="health-monitor-uptime" title="${this.escape(uptimeTitle)}" aria-label="${this.escape(`${uptime} — ${uptimeTitle}`)}">${this.escape(uptime)}${
                samples ? `<span class="health-monitor-uptime-samples" aria-hidden="true">${this.escape(this.t('dashboard.healthUptimeSamplesShort', '/{count}', { count: samples }))}</span>` : ''
            }</span>`
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
            [this.t('dashboard.healthStatsUptime24h', '24 hours'), stats?.uptime24h, 24 * 3600_000],
            [this.t('dashboard.healthStatsUptime7d', '7 days'), stats?.uptime7d, 7 * 24 * 3600_000],
            [this.t('dashboard.healthStatsUptime30d', '30 days'), stats?.uptime30d, 30 * 24 * 3600_000],
        ];
        const noData = this.t('dashboard.healthStatsNoData', 'no data');
        // How far the samples actually reach. History is capped per URL, so a
        // 5-minute monitor holds about a week — and its "30 days" figure used to
        // be computed over that week and labelled as a month anyway.
        const covered = Number(stats?.coveredMs) || 0;
        const tiles = windows.map(([label, win, windowMs]) => {
            const value = this.formatUptime(win);
            const samples = Number(win?.samples) || 0;
            const cls = value ? '' : ' health-monitor-stat--empty';
            const short = covered > 0 && samples > 0 && covered < windowMs * 0.9;
            const sub = short
                ? this.t('dashboard.healthStatsCoveredOnly', 'only {span} of history', {
                    span: this.formatDuration(covered),
                })
                : (samples
                    ? this.t('dashboard.healthStatsChecks', '{count} checks', { count: samples })
                    : '');
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
            <div class="health-monitor-stats-actions">
                <button type="button" class="health-monitor-export-btn" data-monitor-export
                        title="${this.escape(this.t('dashboard.healthHistoryExportHint', 'Download this monitor\'s recorded samples as CSV'))}">
                    ${this.escape(this.t('dashboard.healthHistoryExport', 'Export history (CSV)'))}
                </button>
            </div>
        </div>`;
    }

    /**
     * Download one monitor's recorded samples.
     *
     * The samples never reach the client — the report carries only derived
     * numbers (uptime windows, heartbeat buckets, incidents) — so this cannot be
     * built here the way the row-list export is. The server assembles the CSV and
     * this is a plain navigation to it, which also keeps a large history off the
     * JS heap.
     */
    exportMonitorHistory(issue) {
        const url = String(issue?.url || '').trim();
        if (!url) {
            return;
        }
        window.nextdashTrack?.('health:history-export');
        this.downloadUrl(`/api/health/history-export?url=${encodeURIComponent(url)}`);
    }

    /** Trigger a download of a server-generated file. */
    downloadUrl(href) {
        const a = document.createElement('a');
        a.href = href;
        // The filename comes from the response's Content-Disposition; an empty
        // download attribute only marks this as a download rather than a
        // navigation, so the health view is not replaced by the CSV.
        a.download = '';
        document.body.appendChild(a);
        a.click();
        a.remove();
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
        document.getElementById('modal-text')
            ?.querySelector('[data-monitor-export]')
            ?.addEventListener('click', () => this.exportMonitorHistory(issue));
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
        const item = (entry) => `
            <li class="health-view-score-item">
                <span>${this.escape(entry.label)}</span>
                ${entry.penalty > 0 ? `<span class="health-view-score-item-cost">−${this.escape(entry.penalty)}</span>` : ''}
            </li>`;
        // Reasons that cost nothing are worth reading and are not deductions:
        // listing "Never opened" under "this one loses" while the score stays at
        // 100 would read as a mistake in the arithmetic.
        const costly = entries.filter((entry) => entry.penalty > 0);
        const notes = entries.filter((entry) => entry.penalty <= 0);
        const deductions = costly.length ? `
            <p class="health-view-score-intro">${this.escape(this.t('dashboard.healthScoreIntro', 'Every bookmark starts at 100. This one loses:'))}</p>
            <ul class="health-view-score-list">${costly.map(item).join('')}</ul>` : `
            <p class="health-view-score-intro">${this.escape(this.t('dashboard.healthScorePerfect', 'No issues found — full score.'))}</p>`;
        const notesBlock = notes.length ? `
            <p class="health-view-score-intro health-view-score-intro--notes">${this.escape(this.t('dashboard.healthScoreNotes', 'Worth knowing, at no cost to the score:'))}</p>
            <ul class="health-view-score-list health-view-score-list--notes">${notes.map(item).join('')}</ul>` : '';
        return `
            ${deductions}
            ${notesBlock}
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
        /*
         * Putting an archived copy back is an act of repair.
         *
         * Offered where there is something to repair — a failure, a drifted
         * page, one nothing has checked yet. On a link that answers today it is
         * not a lesser option, it is a mistake waiting to be clicked, and it was
         * costing a row of a menu that had grown past the height of the window.
         */
        if (this.canRecoverFromArchive(issue)) {
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="archive-recover">${this.escape(this.t('dashboard.healthArchiveRecover', 'Use the last archived copy…'))}</button>`);
        }
        // A copy on this disk, for the case the Web Archive cannot help with:
        // a page nobody else archived, or one still up today that will not be.
        items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="local-copy">${this.escape(this.t('dashboard.healthLocalCopy', 'Save a copy on this disk…'))}</button>`);
        // Only when there is something to list. Without a copy this opens an
        // empty dialog, which is a menu entry that exists to disappoint.
        if (Number(issue?.localCopyAt) > 0) {
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="local-copies">${this.escape(this.t('dashboard.healthLocalCopies', 'Copies on this disk'))}</button>`);
        }
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
        /*
         * Stop reporting one condition, and take it back.
         *
         * The key does the common case; the menu is where you can see which
         * condition is being acted on before you act -- and the only place a row
         * with several problems can be told which one to hide.
         */
        const ignored = this.ignoredFlagsOf(issue);
        const target = this.ignoreTargetFlag(issue);
        if (target || ignored.length) {
            items.push(`<p class="health-view-menu-label" role="presentation">${this.escape(this.t('dashboard.healthMenuIgnore', 'Reporting'))}</p>`);
        }
        if (target && !ignored.some((entry) => entry.flag === target)) {
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="ignore">${this.escape(
                this.t('dashboard.healthIgnoreFlag', 'Ignore “{flag}”', { flag: this.flagLabel(target) })
            )}<kbd>n</kbd></button>`);
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="snooze">${this.escape(
                this.t('dashboard.healthSnoozeFlag', 'Ignore “{flag}” for {days} days',
                    { flag: this.flagLabel(target), days: DashboardHealth.SNOOZE_DAYS })
            )}<kbd>z</kbd></button>`);
        }
        ignored.forEach((entry) => {
            items.push(`<button type="button" class="health-view-menu-item" role="menuitem" data-menu-action="unignore" data-flag="${this.escape(entry.flag)}">${this.escape(
                this.t('dashboard.healthUnignoreFlag', 'Report “{flag}” again', { flag: this.flagLabel(entry.flag) })
            )}</button>`);
        });
        items.push(`<p class="health-view-menu-label health-view-menu-label--danger" role="presentation">${this.escape(this.t('dashboard.healthMenuRemove', 'Remove'))}</p>`);
        items.push(`<button type="button" class="health-view-menu-item health-view-menu-item--danger" role="menuitem" data-menu-action="delete">${this.escape(this.t('dashboard.healthDelete', 'Delete bookmark'))}</button>`);

        return `<div class="health-view-menu" role="menu" hidden data-menu-for="${this.escape(key)}" data-menu-owner="more" aria-label="${this.escape(this.t('dashboard.healthMore', 'More actions'))}">${items.join('')}</div>`;
    }

    createIssueElement(issue) {
        const key = this.issueKey(issue);
        const row = document.createElement('article');
        const broken = issue.status === 'broken';
        // feed-row* is the shared card (see feed-row.css); health-view-item stays
        // for everything specific to this view, and for the selectors tests and
        // sibling modules already reach for.
        row.className = `feed-row feed-row--with-select health-view-item ${this.bandClass(issue.score)}`;
        if (broken) {
            row.classList.add('is-broken', 'feed-row--edge-error');
        } else if (this.scoreClass(issue.score) === 'warn') {
            row.classList.add('is-warn', 'feed-row--edge-warning');
        }
        row.dataset.healthKey = key;
        row.tabIndex = -1;
        row.setAttribute('aria-selected', 'false');
        // Acted on, and no longer part of what the filter selects: kept in place
        // and dimmed rather than removed from under the cursor.
        const handled = this.isHandledRow(key);
        if (handled) {
            row.classList.add('health-view-item--handled');
        }

        const title = issue.name || issue.previewTitle || this.formatUrlDisplay(issue.url);
        const domain = this.formatUrlDisplay(issue.url);
        const reasons = this.reasonEntries(issue);
        const primaryReason = reasons[0]?.label || '';
        const extraReasons = reasons.length > 1
            ? this.t('dashboard.healthMoreReasons', '+{count} more', { count: reasons.length - 1 })
            : '';
        const expanded = this.expandedScores.has(key);
        const expectOpen = this.expandedExpect.has(key);
        const iconSrc = this.resolveIssueIconSrc(issue.icon);
        const icon = iconSrc
            ? `<img class="health-view-item-icon-img" src="${this.escape(iconSrc)}" alt="" loading="lazy">`
            : '🔗';

        row.innerHTML = `
            <label class="health-view-select" title="${this.escape(this.t('dashboard.healthSelectRow', 'Select this bookmark'))}">
                <input type="checkbox" class="health-view-select-box"
                    aria-label="${this.escape(this.t('dashboard.healthSelectRow', 'Select this bookmark'))}">
            </label>
            <div class="health-view-item-icon" aria-hidden="true">${icon}</div>
            <div class="health-view-item-body">
                <div class="health-view-item-head">
                    <h3 class="health-view-item-title">${this.escape(title)}</h3>
                    ${handled ? `<span class="health-view-item-handled" title="${this.escape(this.t('dashboard.healthHandledHint', 'You have acted on this one. It stays where it was until you change the filter or reload the report.'))}">${this.escape(this.t('dashboard.healthHandledBadge', 'handled'))}</span>` : ''}
                    <button type="button" class="health-view-item-score" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${this.escape(this.t('dashboard.healthScoreToggle', 'Score {score} — show breakdown', { score: issue.score }))}">
                        ${this.escape(issue.score)}<span class="health-view-item-score-caret" aria-hidden="true">▸</span>
                    </button>
                </div>
                <p class="health-view-item-meta">
                    <span class="health-view-item-meta-primary">
                        <span>${this.escape(domain)}</span>
                        ${this.renderCertBadge(issue)}
                        ${this.renderDriftBadge(issue)}
                        ${this.renderIgnoredBadge(issue)}
                        ${this.renderMutedBadge(issue)}
                        <span class="health-check-mode-wrap">
                            ${this.renderCheckModeBadge(issue, key)}
                            ${this.renderCheckModeMenu(issue, key)}
                        </span>
                    </span>
                    <span class="health-view-item-meta-trail">
                        ${this.renderLastOpened(issue)}
                        ${this.renderBrokenSince(issue)}
                        ${primaryReason ? `<span class="health-view-item-reason">${this.escape(primaryReason)}</span>` : ''}
                        ${extraReasons ? `<span>${this.escape(extraReasons)}</span>` : ''}
                    </span>
                </p>
                ${this.renderMonitorStrip(issue)}
                <div class="health-view-score-panel" ${expanded ? '' : 'hidden'}>${this.renderScorePanel(issue)}</div>
                <div class="health-view-expect-panel" ${expectOpen ? '' : 'hidden'}>${expectOpen ? this.renderExpectPanel(issue) : ''}</div>
                <div class="feed-row-actions health-view-item-actions">
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

        // Right-click opens the same More menu at the cursor, so a health row
        // answers the mouse the way a dashboard bookmark row does. The actions
        // are not duplicated here — this is a second way into the one menu.
        row.addEventListener('contextmenu', (e) => {
            // Shift is the escape hatch to the browser's own menu, matching the
            // dashboard's rule, and the native menu is left alone in a text field
            // so copy/paste keeps working while editing a row inline.
            if (e.shiftKey) return;
            if (this.dash.isModalOpen?.()) return;
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
            e.preventDefault();
            e.stopPropagation();
            this.selectRowByKey(key);
            this.toggleMenu(key, 'more', { at: { x: e.clientX, y: e.clientY } });
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
        row.querySelectorAll('[data-check-interval]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.setMonitorInterval(issue, Number(item.getAttribute('data-check-interval')));
            });
        });

        // Opens the expectations panel on the row and closes the menu behind it,
        // so the panel is not competing with a popover for the same screen.
        row.querySelector('[data-expect-open]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeAllMenus();
            this.toggleExpectPanel(key, true);
        });

        // The panel's own controls are bound when it is built, which happens on
        // first open rather than at render time.
        if (row.querySelector('.health-view-expect-panel')?.firstElementChild) {
            this.bindExpectPanel(row, issue, key);
        }

        const menuActions = {
            dashboard: () => this.openIssueInDashboard(issue),
            redirect: () => void this.detectRedirect(issue),
            title: () => void this.refreshTitle(issue),
            favicon: () => void this.refreshFavicon(issue),
            archive: () => this.openArchive(issue),
            'archive-recover': () => void this.recoverFromArchive(issue),
            'local-copy': () => void this.captureLocalCopy(issue),
            'local-copies': () => void this.showLocalCopies(issue),
            'copy-url': () => this.copyIssueUrl(issue),
            share: () => void this.shareIssue(issue),
            delete: () => void this.deleteIssue(issue),
            // Hand off to the popover rather than duplicating the three options
            // here, so there is one place that explains what the modes mean.
            checkmode: () => this.toggleMenu(key, 'check'),
            ignore: () => void this.toggleIgnore(issue),
            snooze: () => void this.toggleIgnore(issue, { snooze: true }),
        };
        row.querySelectorAll('[data-menu-action]').forEach((item) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.getAttribute('data-menu-action');
                // The un-ignore entries name their own condition, so they are
                // one handler rather than one entry each in the map above.
                if (action === 'unignore') {
                    const flag = item.getAttribute('data-flag');
                    void this.writeIgnores(issue, { remove: [flag] }).then((body) => {
                        if (body) {
                            this.dash.showNotification(
                                this.t('dashboard.healthIgnoreRemoved', 'Reporting “{flag}” again.',
                                    { flag: this.flagLabel(flag) }), 'success');
                        }
                    });
                    return;
                }
                menuActions[action]?.();
            });
        });

        const selectBox = row.querySelector('.health-view-select-box');
        selectBox?.addEventListener('click', (e) => {
            // The label wrapping it would otherwise re-fire this as a row click.
            e.stopPropagation();
        });
        selectBox?.addEventListener('change', () => {
            this.multiSelect?.toggle(key);
        });

        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            if (e.target.closest('.health-view-select')) return;
            // Alt+click ticks one row, Shift+click extends from the anchor —
            // the same two modifiers the dashboard grid uses. Cmd/Ctrl is left
            // to the browser and to the platform: on a Mac it is the secondary
            // click, and on a link it opens a new tab.
            if (e.altKey) {
                e.preventDefault();
                this.multiSelect?.toggle(key);
                return;
            }
            if (e.shiftKey && this.multiSelect?.isActive()) {
                e.preventDefault();
                this.multiSelect.extendTo(key);
                return;
            }
            // A plain click with a selection open clears it rather than opening
            // the row, so a stray click cannot act on rows left ticked.
            if (this.multiSelect?.isActive()) {
                e.preventDefault();
                this.multiSelect.clear();
                return;
            }
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
