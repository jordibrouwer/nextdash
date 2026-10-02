/**
 * Bookmark health: the report, what each row's problems mean, and the actions
 * that fix them. It drew the Health view once; the Bookmarks view draws the
 * list now and calls on this for the rest (dashboard-config-bookmarks-health.js),
 * as do the walk (dashboard-health-focus.js) and the bulk runner
 * (dashboard-health-multi-select.js).
 */
class DashboardHealth {
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
        // The question getFilteredIssues answers, for the walk (Focus) and the
        // bulk runner; the Bookmarks view hands them its own list instead.
        this.filter = 'broken';
        this.sort = 'score';
        this.searchQuery = '';
        this.selectedKey = null;
        /** The row the walk (Focus) lands back on when it closes. */
        this.focusIssueKey = null;
        this._loadPromise = null;
        this._loadPromiseRefresh = false;
        this._busyKeys = new Set();
        this._openBrokenRunning = false;
        this._mergeRunning = false;
        // Lazily built: the classes ship in their own files.
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
    /** Show a wait once it is noticeable; returns what ends it (call in a finally). */
    beginWait(title, status) {
        return window.ProgressOverlay?.begin?.(title, status) || (() => {});
    }

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

    /** Stable identity for a row across re-renders: page + index. */
    issueKey(issue) {
        return `${issue.pageId}:${issue.index}`;
    }

    /**
     * Move the ticks and the cursor onto a new report by what they point at.
     *
     * A key is page and index, and a report read after a delete or an edit
     * numbers the rows afresh: a tick on row 5 then sat on whatever became row
     * 5, and a bulk delete took a bookmark nobody ticked. Each old key is
     * followed to the same page and URL in the new report; one whose bookmark
     * is gone is dropped rather than left on a neighbour.
     */
    carryKeysAcross(oldIssues, newIssues) {
        const ms = this._multiSelect;
        const hasTicks = ms?.selected?.size > 0;
        // The Bookmarks view walks with a Focus of its own (libraryFocus); its
        // queue holds the same page:index keys and went stale after a delete,
        // so it is carried across with Health's.
        const walks = [this._focus, this._extraFocus].filter((f) => f?.active && f.queue?.length);
        if (!hasTicks && !this.selectedKey && !walks.length) return;
        const ident = (issue) => `${Number(issue?.pageId)}\u0000${this.canonicalUrl(issue?.url)}`;
        const byIdent = new Map();
        newIssues.forEach((issue) => {
            const id = ident(issue);
            if (!byIdent.has(id)) byIdent.set(id, this.issueKey(issue));
        });
        const oldByKey = new Map(oldIssues.map((issue) => [this.issueKey(issue), issue]));
        const follow = (key) => {
            const was = oldByKey.get(key);
            // Not on the old report either (a key set from a deep link, say):
            // left for prune() to judge against the new one as before.
            if (!was) return key;
            return byIdent.get(ident(was)) || null;
        };
        if (hasTicks) {
            const next = new Set();
            ms.selected.forEach((key) => {
                const moved = follow(key);
                if (moved) next.add(moved);
            });
            ms.selected = next;
            if (ms.anchorKey) ms.anchorKey = follow(ms.anchorKey);
        }
        // A run through the rows holds keys as well. A card whose bookmark is
        // gone gets a key nothing resolves, which the run already skips; its
        // place in the queue stays, so the position still counts right.
        walks.forEach((walk) => {
            walk.queue = walk.queue.map((key) => follow(key) || `gone:${key}`);
        });
        // The cursor follows too, but where its bookmark is gone it keeps the
        // old key: sitting on the row that took the deleted one's place is what
        // the view has always done after a delete.
        if (this.selectedKey) {
            this.selectedKey = follow(this.selectedKey) || this.selectedKey;
        }
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
    /** Call fn with every report fetched from now on. */
    onReportLoaded(fn) {
        if (typeof fn !== 'function') return;
        this._reportListeners = this._reportListeners || [];
        if (!this._reportListeners.includes(fn)) this._reportListeners.push(fn);
    }

    fetchReport({ refresh = false } = {}) {
        if (this._loadPromise) {
            if (refresh && !this._loadPromiseRefresh) {
                // then(), not finally(): finally resolves with the *original*
                // promise's value, so the caller was handed the stale report the
                // plain fetch returned -- and the refresh's own rejection had no
                // handler, surfacing as an unhandled rejection while the caller's
                // try/catch saw a success and showed no error. Both settlements
                // chain on, so a failed refresh reaches the caller.
                return this._loadPromise
                    .catch(() => undefined)
                    .then(() => this.fetchReport({ refresh: true }));
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
                this.carryKeysAcross(this.report?.issues || [], data?.issues || []);
                this.report = data || null;
                // The dashboard's preview cards read health facts from the
                // badge's index; a report fetched here is fresher, so it
                // replaces what the badge left — otherwise a refresh in this
                // view would leave the cards quoting the older figures.
                window.HealthFacts?.remember?.(this.report);
                // Anyone drawing from this report outside the view (Config →
                // Bookmarks) hears about every new one, whichever action or
                // refresh fetched it.
                (this._reportListeners || []).forEach((fn) => {
                    try { fn(this.report); } catch { /* one listener's bug is its own */ }
                });
                return this.report;
            })
            .finally(() => {
                this._loadPromise = null;
                this._loadPromiseRefresh = false;
            });
        return this._loadPromise;
    }

    /**
     * The report again, with the credential names that ride along with it.
     * Named for when it also drew the Health view; every action still calls it
     * after it writes, and the Bookmarks view hears of the new report through
     * onReportLoaded.
     */
    async loadAndRender({ refresh = false } = {}) {
        this.loading = !this.report;
        try {
            /*
             * The credential names ride along with the report rather than being
             * fetched when a panel opens: the expectations form is built
             * synchronously, and the names are two dozen bytes of
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

    duplicateGroups() {
        return Array.isArray(this.report?.duplicateGroups) ? this.report.duplicateGroups : [];
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
        return this.sortIssues(issues
            .filter((issue) => this.matchesFilter(issue, this.filter))
            .filter((issue) => this.matchesQuery(issue, query)));
    }

    filterCount(filter) {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        return issues.filter((issue) => this.matchesFilter(issue, filter)).length;
    }

    /* ── Side panel ────────────────────────────────────────────────────── */

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
            row.closest?.('[data-lvs-section]')?.querySelector('summary')?.focus({ preventScroll: true });
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
            // With the token: a plain fetch got 401 when one is set, the list
            // stayed empty, and saving Expectations then removed the sign-in.
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const res = await api('/api/health/credentials');
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
        const list = { ...(this.dash.healthCredentials || {}) };
        // A credential the list does not name (not loaded, or refused) is
        // still the bookmark's: without its own option the select fell back to
        // "Nothing", and the next Save removed the sign-in.
        if (selected && !(selected in list)) list[selected] = selected;
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

        issue.lastOpened = Date.now();
        issue.openCount = (Number(issue.openCount) || 0) + 1;
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
                        url: issue.url,
                        status,
                        error: status === 'online' ? '' : errorDetail,
                    }),
                });
            }
        };

        try {
            // The row too, so the check uses this copy's rules: the verdict
            // is recorded on it below.
            const row = Number.isFinite(Number(issue.pageId)) && Number.isFinite(Number(issue.index))
                ? `&page=${encodeURIComponent(issue.pageId)}&index=${encodeURIComponent(issue.index)}` : '';
            const res = await fetcher(`/api/ping?url=${encodeURIComponent(url)}${row}`);
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
        } catch (_error) {
            // Nothing is recorded: the check never ran. A 429 from the
            // dashboard's own ping limit, a proxy's 502 or a network blip was
            // saved as the bookmark's outage ("ping HTTP 429"), with a Down
            // sample on monitored ones that fed the alert count.
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

    /**
     * Say, where the reader is looking, that a bookmark is being worked on.
     *
     * This used to find the row in Health's own list, which went when Health
     * moved into the Bookmarks view -- so a re-check, a redirect lookup or an
     * archive search ran with nothing on screen saying so, and the button
     * could be pressed again. Now it marks the Bookmarks view's own row and,
     * when that bookmark is the one open, its panel: a sweeping bar and the
     * panel's health buttons held until the work is done.
     */
    syncRowBusy(key, busy) {
        const cfg = this.dash?.config;
        const issue = (this.report?.issues || []).find((i) => this.issueKey(i) === key);
        if (!cfg || !issue) return;
        const urlKey = window.HealthFacts?.keyFor?.(issue.url);

        const panel = document.getElementById('config-bm-panel');
        const open = panel && cfg.findBookmarkByKey?.(panel.dataset.bmPanelKey || '');
        const openIssue = open && cfg.bmHealthIssue?.(open);
        if (panel && openIssue && this.issueKey(openIssue) === key) {
            panel.classList.toggle('is-health-busy', busy);
            if (busy) panel.setAttribute('aria-busy', 'true');
            else panel.removeAttribute('aria-busy');
            panel.querySelectorAll('[data-bm-health-action], [data-check-mode], [data-check-interval]')
                .forEach((btn) => { btn.disabled = busy; });
        }

        const bookmark = (this.dash.allBookmarks || []).find((b) => Number(b.pageId) === Number(issue.pageId)
            && window.HealthFacts?.keyFor?.(b.url) === urlKey);
        if (bookmark && typeof cfg.bookmarkKey === 'function') {
            const row = document.querySelector(`#config-bm-list .config-bm-row[data-bm-key="${CSS.escape(cfg.bookmarkKey(bookmark))}"]`);
            if (row) {
                row.classList.toggle('is-health-busy', busy);
                if (busy) row.setAttribute('aria-busy', 'true');
                else row.removeAttribute('aria-busy');
            }
        }
    }

    /* ── More actions ──────────────────────────────────────────────────── */

    openArchive(issue) {
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
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        const url = String(issue?.url || '').trim();
        if (!url) return;

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

    async recoverFromArchive(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:archive-recover');
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
                // Cancel means no. It used to open the copy in a new tab as
                // well, which the dialog never said; looking is offered here
                // instead, for whoever wanted to see it before deciding.
                d.showNotification(
                    this.t('dashboard.healthArchiveKeptOriginal', 'Bookmark left as it was'),
                    'info',
                    {
                        duration: 6000,
                        actionLabel: this.t('dashboard.healthArchiveOpenCopy', 'Open the copy'),
                        onAction: () => window.open(snapshotUrl, '_blank', 'noopener,noreferrer'),
                    }
                );
                return;
            }

            const applied = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: issue.pageId,
                    index: issue.index,
                    url: issue.url,
                    newUrl: snapshotUrl,
                    refreshTitle: false,
                    keepOriginalInNote: true,
                }),
            });
            if (!applied.ok) throw new Error(`apply HTTP ${applied.status}`);
            const appliedBody = await applied.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            d.showNotification(
                this.t('dashboard.healthArchiveApplied', 'Now pointing at the copy {source} took on {date}',
                    { date: when, source }),
                'success',
                this.fixUndoOptions(issue, appliedBody)
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

    async shareIssue(issue) {
        const shareUrl = this.buildIssueShareUrl(issue);
        if (!shareUrl) return;
        const menu = this.dash.contextMenu;
        if (!menu?.shareBookmark) return;
        // Straight from the click: navigator.share() must be reached while
        // that click is still the browser's active user gesture.
        await menu.shareBookmark({ name: issue?.name || '', url: shareUrl }, null);
    }

    async detectRedirect(issue) {
        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return;
        window.nextdashTrack?.('health:detect-redirect');
        const d = this.dash;
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            // fetcher, with the token: the route needs it, and a bare fetch
            // made "Detect redirect" fail on every install that sets one.
            const res = await fetcher(
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
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index, url: issue.url, newUrl: redirectUrl, refreshTitle: false }),
            });
            if (!applied.ok) throw new Error(`apply HTTP ${applied.status}`);
            const body = await applied.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            d.updateHealthBadge?.();
            // The server pings the replacement before storing it, so a fix that
            // still fails must not be reported as a success.
            // verifyError is the field the server sends; lastError, read here
            // before, is never in the answer -- so a fix that still failed was
            // announced as reachable.
            const stillBroken = String(body?.verifyError || '').trim();
            d.showNotification(
                stillBroken
                    ? this.t('dashboard.healthRedirectStillBroken', 'URL updated, but it still fails: {error}', { error: stillBroken })
                    : this.t('dashboard.healthRedirectDone', 'URL updated and reachable'),
                stillBroken ? 'info' : 'success',
                this.fixUndoOptions(issue, body)
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
        const d = this.dash;
        this._busyKeys.add(key);
        this.syncRowBusy(key, true);
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        try {
            const res = await fetcher('/api/health/auto-heal-apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index, url: issue.url, refreshTitle: true }),
            });
            if (!res.ok) throw new Error(`title HTTP ${res.status}`);
            const titleBody = await res.json().catch(() => ({}));
            await this.loadAndRender({ refresh: true });
            d.showNotification(this.t('dashboard.healthTitleDone', 'Title refreshed'), 'success',
                this.fixUndoOptions(issue, titleBody, 3000));
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
                body: JSON.stringify({ pageId: issue.pageId, index: issue.index, url: issue.url }),
            });
            if (res.status === 409) {
                // The row no longer names that bookmark: the report was read
                // before something else changed the page. Nothing was deleted.
                await this.loadAndRender({ refresh: true });
                d.showNotification(this.t('dashboard.healthChangedReloaded',
                    'That bookmark changed since the report was read — the report is reloaded'), 'warning');
                return;
            }
            if (!res.ok) throw new Error(`delete HTTP ${res.status}`);
            const deletedBody = await res.json().catch(() => ({}));
            const trashIds = Array.isArray(deletedBody?.trashIds) ? deletedBody.trashIds : [];
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
            // In the trash since the server started putting single deletes
            // there, so the toast can take it straight back.
            d.showNotification(this.t('dashboard.healthDeleted', 'Bookmark deleted'), 'success', {
                duration: trashIds.length ? 8000 : 3000,
                undoCallback: trashIds.length ? () => this.restoreFromTrash(trashIds) : null,
            });
        } catch {
            d.showNotification(this.t('dashboard.healthDeleteFailed', 'Could not delete the bookmark'), 'error');
        } finally {
            this._busyKeys.delete(key);
            this.syncRowBusy(key, false);
        }
    }

    /**
     * Put fixed bookmarks back the way they were.
     *
     * A fix hands back what it replaced (`previous` from auto-heal-apply); the
     * undo writes those fields onto the row now at the new address, by URL,
     * and then checks the old address again -- the result the report had was
     * for the address the fix just left.
     */
    async undoFixes(fixes) {
        const d = this.dash;
        const fetcher = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const byPage = new Map();
        fixes.forEach((fix) => {
            if (!fix?.previous?.url || !fix.url) return;
            if (!byPage.has(fix.pageId)) byPage.set(fix.pageId, []);
            byPage.get(fix.pageId).push({
                url: fix.url,
                setUrl: fix.previous.url,
                name: fix.previous.name ?? '',
                note: fix.previous.note ?? '',
                previewTitle: fix.previous.previewTitle ?? '',
            });
        });
        let back = 0;
        for (const [pageId, updates] of byPage) {
            try {
                const res = await fetcher('/api/bookmarks', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ page: Number(pageId), updates }),
                });
                if (res.ok) back += Number((await res.json().catch(() => ({}))).updated) || 0;
            } catch {
                // Counted below.
            }
        }
        await d.loadAllBookmarks?.();
        d.renderDashboard?.({ incremental: false });
        await this.loadAndRender({ refresh: true });
        // The old addresses have no check result any more; ask again rather
        // than leave the rows unknown until the next scheduled round.
        const restored = new Set(fixes.map((fix) => `${Number(fix.pageId)}\u0000${this.canonicalUrl(fix.previous?.url)}`));
        const again = (this.report?.issues || []).filter((issue) =>
            restored.has(`${Number(issue.pageId)}\u0000${this.canonicalUrl(issue.url)}`));
        for (const issue of again) {
            await this.recheckIssue(issue, { silent: true });
        }
        d.updateHealthBadge?.();
        d.showNotification(
            back
                ? this.t('dashboard.healthFixUndone', 'Put {count} bookmark(s) back the way they were', { count: back })
                : this.t('dashboard.healthFixUndoFailed', 'Could not undo the change'),
            back ? 'success' : 'error', { duration: 3000 });
    }

    /** The toast options that carry a fix's undo, when the server said what it replaced. */
    fixUndoOptions(issue, body, duration = 4000) {
        const previous = body?.previous;
        const now = String(body?.url || '').trim();
        if (!previous?.url || !now) return { duration };
        return {
            duration: 8000,
            undoCallback: () => this.undoFixes([{ pageId: issue.pageId, url: now, previous }]),
        };
    }

    /**
     * Put deleted bookmarks back from the trash, by the ids the delete handed
     * back, and bring the grid and the report in step with it.
     */
    async restoreFromTrash(trashIds) {
        const d = this.dash;
        let back = 0;
        for (const id of trashIds) {
            try {
                await window.DashboardTrash?.restore?.(id);
                back += 1;
            } catch {
                // Counted below; the entry stays in the trash to restore by hand.
            }
        }
        await d.loadAllBookmarks?.();
        d.renderDashboard?.({ incremental: false });
        void d.data?.fetchAndStoreDataRevision?.();
        await this.loadAndRender({ refresh: true });
        d.updateHealthBadge?.();
        d.showNotification(
            back
                ? this.t('dashboard.healthRestored', 'Put {count} bookmark(s) back', { count: back })
                : this.t('dashboard.healthRestoreFailed', 'Could not put the bookmark back — it is still in the trash'),
            back ? 'success' : 'error', { duration: 3000 });
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
            return 'unchanged';
        }
        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return undefined;

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
            return 'unchanged';
        }

        const key = this.issueKey(issue);
        if (this._busyKeys.has(key)) return undefined;
        const url = String(issue?.url || '').trim();
        const pageId = Number(issue?.pageId);
        if (!url || !Number.isFinite(pageId)) return undefined;

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

        // A field the form did not draw (the monitor fields, on a bookmark that
        // is not monitored) keeps what is stored: the save replaces every
        // field, so sending blanks erased the keyword, status codes and mute
        // that came back when the bookmark was monitored again.
        const field = (selector, read, stored) => {
            const el = wrap.querySelector(selector);
            return el ? read(el) : stored;
        };
        const text = field('[data-expect-text]', (el) => String(el.value || '').trim(), String(issue.expectText || ''));
        const absent = field('[data-expect-absent]', (el) => Boolean(el.checked), Boolean(issue.expectTextAbsent));
        const status = field('[data-expect-status]', (el) => String(el.value || '').trim(), String(issue.expectStatus || ''));
        const watchDrift = field('[data-watch-drift]', (el) => Boolean(el.checked), Boolean(issue.watchDrift));
        const notifyMuted = field('[data-notify-muted]', (el) => Boolean(el.checked), Boolean(issue.notifyMuted));
        // Reachability: present whether or not the bookmark is monitored, so
        // these are read unconditionally rather than from the monitored block.
        const checkUrl = String(wrap.querySelector('[data-check-url]')?.value || '').trim();
        const credentialId = String(wrap.querySelector('[data-credential-id]')?.value || '').trim();
        const allowInsecureTls = Boolean(wrap.querySelector('[data-allow-insecure]')?.checked);

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
            // Out of the field before the re-render, which rebuilds the side
            // panel with what was stored -- it leaves a panel alone while a
            // field in it has focus. A failed save keeps the focus, and with it
            // what was typed.
            if (wrap.contains(document.activeElement)) document.activeElement.blur();
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

    /**
     * A dashboard URL that finds this bookmark again: the Bookmarks view,
     * searched for its address.
     */
    buildIssueShareUrl(issue) {
        const target = String(issue?.url || '').trim();
        if (!target) return '';
        const url = new URL(`${window.location.origin}${window.location.pathname}`);
        url.hash = `bookmarks?${new URLSearchParams({ q: target }).toString()}`;
        return url.toString();
    }

    /* ── The collection's summary ────────────────────────────────────────── */

    /** Share of bookmarks with no active issue, as a whole number. */
    scorePercent() {
        return this.healthyPercent();
    }

    /**
     * The trend as an arrow and a size — the readable half of what the old
     * header badge drew. '' with fewer than two recorded days, so the row drops
     * out rather than printing a delta against nothing.
     */
    trendDeltaText() {
        const points = this.trendPoints();
        if (points.length < 2) return '';
        const first = this.trendPercent(points[0]);
        const last = this.trendPercent(points[points.length - 1]);
        if (first === null || last === null) return '';
        const delta = last - first;
        // Zero is worth saying: "flat" is a real answer, and hiding it would
        // make the row appear only when something moved.
        if (delta === 0) return '–';
        return `${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`;
    }

    /**
     * How old the report is, short enough for a 200px rail.
     *
     * Under a minute reads as "just now" rather than "0m", which looks like a
     * stuck clock; a clock that disagrees with the server would otherwise print
     * a negative age, so the future counts as fresh. '' when the report carries
     * no timestamp at all.
     */
    reportAgeText() {
        const generated = Number(this.report?.generatedAt) || 0;
        if (!generated) return '';
        const age = Date.now() - generated;
        return age < 60_000
            ? this.t('dashboard.healthSummaryJustNow', 'just now')
            : this.formatDuration(age);
    }

    /**
     * The rail's uptime row, or null while there is no fleet yet.
     *
     * `fleet.uptime24h` is a `{ratio, samples}` window, not a number — the
     * same shape formatUptime() already turns into the fleet panel's 24h
     * tile (:3928, :3993). Reusing it here instead of coercing the object
     * with Number() is what keeps this row from reading "0%" no matter what
     * the fleet is actually doing.
     */
    fleetUptimeSummaryRow() {
        const fleet = this.report?.fleet;
        if (!fleet || !Number(fleet.monitors)) return null;
        const uptime = this.formatUptime(fleet.uptime24h);
        return {
            key: 'uptime',
            label: this.t('dashboard.healthUptime24h', 'Uptime 24h'),
            // No samples pooled yet reads as "no data", the same empty state
            // the fleet panel's own tiles use — not a misleading percentage.
            value: uptime || this.t('dashboard.healthStatsNoData', 'no data'),
            tone: uptime ? (Number(fleet.downNow) > 0 ? 'bad' : 'good') : '',
        };
    }

    /**
     * The figures that are not filters: the score, its trend, the broken count
     * while there is one, and the report's age. This is what is left of the
     * header's meta row.
     */
    shellSummary() {
        const pct = this.scorePercent();
        const broken = this.brokenCount();
        const uptimeRow = this.fleetUptimeSummaryRow();
        return [
            {
                key: 'score',
                label: this.t('dashboard.healthScoreTotal', 'Score'),
                value: `${pct}%`,
                tone: pct >= 90 ? 'good' : (pct >= 70 ? 'warn' : 'bad'),
            },
            {
                key: 'trend',
                label: this.t('dashboard.healthTileTrend', 'Trend'),
                value: this.trendDeltaText(),
                // The sparkline the tile row used to draw, rehoused under the
                // trend value now that the tiles live in the rail. null when
                // there isn't enough history — the row still shows the arrow.
                extraNode: this.renderTrendSparklineNode(),
            },
            // Only while there is something to say. A zero here would be a
            // second copy of the Broken filter's own empty count, one row below.
            ...(broken > 0
                ? [{
                    key: 'broken',
                    label: this.t('dashboard.healthFilterBroken', 'Broken'),
                    value: String(broken),
                    tone: 'bad',
                }]
                : []),
            ...(uptimeRow ? [uptimeRow] : []),
            { key: 'age', label: this.t('dashboard.healthSummaryUpdated', 'Updated'), value: this.reportAgeText() },
        ].filter((row) => row.value !== '');
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

    /* ── Explaining the view ───────────────────────────────────────────── */

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
     * The compact trend line for the rail summary.
     *
     * The rail is 200px wide, minus the summary block's own padding — no
     * room for renderTrendChart's series picker, per-day hover zones, axis
     * labels or help button, all sized for the note row (240px) or the
     * modal. This redraws just the line and the current-reading dot from
     * the same trendPoints()/trendPercent() data so the rail always agrees
     * with the full chart and the trend value beside it, active series
     * included. Kept separate from renderTrendChart rather than threading a
     * "compact" flag through it: the two draw to different sizes with a
     * different amount of chrome, and sharing only the few lines of
     * polyline math isn't worth the coupling.
     */
    renderTrendSparkline() {
        const points = this.trendPoints();
        if (points.length < 3) return '';

        const series = this.activeTrendSeries();
        const values = points.map((p) => this.trendPercent(p, series));
        if (values.filter((v) => v !== null).length < 3) return '';

        const maxValue = series.mode === 'count'
            ? Math.max(1, ...values.filter((v) => v !== null)) * 1.1
            : 100;

        const w = 160;
        const h = 32;
        const padY = 2;
        const plotH = h - padY * 2;
        const step = w / Math.max(1, values.length - 1);
        const yFor = (v) => (h - padY - (v / maxValue) * plotH).toFixed(1);

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

        const lastIndex = values.reduce((acc, v, i) => (v === null ? acc : i), -1);
        const endDot = lastIndex >= 0
            ? `<circle cx="${(lastIndex * step).toFixed(1)}" cy="${yFor(values[lastIndex])}" r="2" fill="currentColor"/>`
            : '';

        const first = values.find((v) => v !== null);
        const last = [...values].reverse().find((v) => v !== null);
        const label = this.t('dashboard.healthTrendChartLabel',
            'Healthy bookmarks over the last {days} days, from {first}% to {last}%',
            { days: points.length, first, last });

        return `<svg class="health-view-trend-sparkline" viewBox="0 0 ${w} ${h}"
                     preserveAspectRatio="none" role="img"
                     aria-label="${this.escape(label)}">${paths}${endDot}</svg>`;
    }

    /**
     * renderTrendSparkline() as a Node, for the shell's summary `extraNode` slot.
     *
     * The shell no longer accepts a markup string there (that was an innerHTML
     * sink with no allowlist — fine only as long as every caller remembered to
     * escape, which stops being true the moment a second view adopts it). This
     * parses renderTrendSparkline()'s string once, right here, instead of
     * rebuilding the sparkline with createElementNS: that string is entirely
     * this function's own numeric coordinates plus one field, the aria-label,
     * already run through this.escape(). Nothing in it is a bookmark title, a
     * URL, or any other value a user can edit, so parsing it is not
     * reintroducing the sink — it's the same trust boundary the old comment
     * described, just enforced at this one call site instead of assumed by
     * the shared shell.
     */
    renderTrendSparklineNode() {
        const markup = this.renderTrendSparkline();
        if (!markup) return null;
        const holder = document.createElement('div');
        holder.innerHTML = markup;
        return holder.firstElementChild;
    }

    /** Bookmarks with any form of availability checking on (periodic or monitor). */
    checkedCount() {
        const issues = Array.isArray(this.report?.issues) ? this.report.issues : [];
        return issues.filter((i) => i?.monitor || i?.checkStatus).length;
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
                'Ask every bookmark\u2019s page for its title, description and image? This walks the whole collection, not only the {count} row(s) in this filter, at one request per bookmark, so it takes a while.',
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
        /*
         * In batches, behind the blocking bar, the way Config runs the same
         * endpoint (dashboard-config.js refreshAllPreviews).
         *
         * One page fetch per bookmark means a real collection takes minutes. As
         * a single request it had no feedback beyond a button reading
         * "Fetching…", a proxy was free to time the whole thing out halfway
         * with nothing saved, and there was no way to call it off.
         */
        const BATCH = 5;
        let stopped = false;
        window.ProgressOverlay?.show(
            this.t('dashboard.healthFetchPreviews', 'Fetch previews'),
            this.t('dashboard.healthFetchPreviewsCounting', 'Reading the collection'),
            {
                onCancel: () => { stopped = true; },
                cancelLabel: this.t('dashboard.healthFetchPreviewsStop', 'Stop'),
                cancellingLabel: this.t('dashboard.healthFetchPreviewsStopping', 'Stopping…'),
            });
        let offset = 0;
        let total = 0;
        let refreshed = 0;
        try {
            // Walks until the server says it is done rather than counting
            // rounds here: the collection can change under a long run, and the
            // server's own position is the only one that stays true.
            for (let round = 0; round < 2000; round += 1) {
                if (stopped) break;
                /*
                 * A refusal is not a failure.
                 *
                 * The endpoint is behind the sixty-a-minute limiter the preview
                 * and icon fetches share, so a sweep of any size reaches it.
                 * Throwing there ended the whole run and reported the rows it
                 * had already fetched as a run that stopped, for no reason
                 * other than its own haste. The server says how long to wait.
                 */
                let res = await fetcher(`/api/previews/refresh?offset=${offset}&limit=${BATCH}`,
                    { method: 'POST' });
                if (res.status === 429) {
                    const retryAfter = Number(res.headers.get('Retry-After')) || 60;
                    window.ProgressOverlay?.update(Math.min(offset, total), total,
                        this.t('dashboard.healthFetchPreviewsWaiting',
                            'Rate limit reached — waiting {seconds}s', { seconds: retryAfter }));
                    await new Promise((resolve) => setTimeout(resolve, (retryAfter + 1) * 1000));
                    if (stopped) break;
                    res = await fetcher(`/api/previews/refresh?offset=${offset}&limit=${BATCH}`,
                        { method: 'POST' });
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const body = await res.json().catch(() => ({}));

                total = Number(body.total) || total;
                refreshed += Number(body.refreshed) || 0;
                offset = Number(body.next) || offset + BATCH;

                const done = Math.min(offset, total);
                window.ProgressOverlay?.update(done, total,
                    this.t('dashboard.healthFetchPreviewsProgress', '{done} of {total}',
                        { done, total }));

                if (body.done || offset >= total) break;
            }
            // The flag is read from what is stored on the bookmark, not from the
            // preview cache, so both have to be re-read before the count means
            // anything.
            await this.dash.loadAllBookmarks?.();
            await this.loadAndRender({ refresh: true });
            if (stopped) {
                // Stopped halfway is not finished: a full bar would say the
                // sweep completed. What it did get is saved all the same.
                window.ProgressOverlay?.hide();
                this.dash.showNotification?.(
                    this.t('dashboard.healthFetchPreviewsStopped',
                        'Stopped after {done} of {total}', { done: refreshed, total: total || refreshed }),
                    'info');
            } else {
                window.ProgressOverlay?.finish(
                    this.t('dashboard.healthFetchPreviewsDone', 'Previews fetched.'));
                this.dash.showNotification?.(
                    this.t('dashboard.healthFetchPreviewsDone', 'Previews fetched.'), 'success');
            }
        } catch {
            window.ProgressOverlay?.hide();
            // Says how far it got: a run that stopped halfway left those
            // previews genuinely fetched, and starting over is not required.
            this.dash.showNotification?.(
                total
                    ? this.t('dashboard.healthFetchPreviewsPartial',
                        'Stopped after {done} of {total}', { done: refreshed, total })
                    : this.t('dashboard.healthFetchPreviewsError', 'Could not fetch the previews.'),
                'error');
        } finally {
            this._fetchPreviewsRunning = false;
            if (button && button.isConnected) {
                button.disabled = false;
                if (label) button.textContent = label;
            }
        }
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
        const endWait = this.beginWait(this.t('dashboard.waitOpenBrokenTitle', 'Finding broken links…'), this.t('dashboard.waitOpenBrokenStatus', 'Asking the report which ones fail'));
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
                    '({remaining} more in the Bookmarks view.)',
                    { remaining }
                )}`
                : this.t('dashboard.openBrokenLinks', 'Open broken links');
            d.showNotification(message, 'success', { duration: 5000 });
        } catch {
            d.showNotification(this.t('dashboard.openBrokenFailed', 'Failed to open broken links'), 'error');
        } finally {
            endWait();
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
        const endWait = this.beginWait(this.t('dashboard.waitMergeTitle', 'Merging duplicates…'), this.t('dashboard.waitMergeStatus', 'Keeping the best one of each'));
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
            endWait();
            this._mergeRunning = false;
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
        const endWait = this.beginWait(this.t('dashboard.waitCheckOffTitle', 'Turning off checking…'), this.t('dashboard.waitCheckOffStatus', 'Updating every bookmark'));
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
            endWait();
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
        const endWait = this.beginWait(this.t('dashboard.waitRetestTitle', 'Retesting every link…'), this.t('dashboard.waitRetestStatus', 'Each site is asked again'));
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
            endWait();
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

    /* ── Checking ──────────────────────────────────────────────────────── */

    /** The mode a row is in, as the three-state name the server also speaks. */
    checkModeOf(issue) {
        return window.CheckMode.of(issue);
    }

    /**
     * The three modes, each with its one-line explanation, and for a monitor
     * its interval: the side panel's Check mode section. Named options rather
     * than a control that cycles -- periodic is cheap and answers "is this
     * link alive", monitor is the expensive tier that records uptime.
     */
    renderCheckModeChoices(issue) {
        const active = this.checkModeOf(issue);
        // Same three options, same order and same sentences as the dashboard
        // right-click menu; only the markup around them differs.
        const options = window.CheckMode.options().map((o) => [o.mode, o.label, o.body]);
        const items = options.map(([mode, label, body]) => {
            const isActive = mode === active;
            return `<button type="button"
                class="health-view-menu-item health-check-option${isActive ? ' is-active' : ''}"
                role="radio"
                aria-checked="${isActive ? 'true' : 'false'}"
                title="${this.escape(body)}"
                data-check-mode="${mode}"
            >
                <span class="health-check-option-label">${this.escape(label)}</span>
                <span class="health-check-option-body">${this.escape(body)}</span>
            </button>`;
        }).join('');

        // How often a monitor runs, changeable here rather than only from
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
                            role="radio" aria-checked="${current ? 'true' : 'false'}"
                            data-check-interval="${mins}"
                        >${this.escape(window.CheckMode.intervalLabel(mins))}</button>`;
                    }).join('')
                }</span>
            </span>`
            : '';

        return `${items}${intervalRow}`;
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

    renderMonitorStrip(issue) {
        const stats = issue?.monitorStats;
        if (!issue?.monitor) return '';
        if (!stats) {
            // Monitored but never checked — say so, rather than showing 0%.
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

        return `<div class="health-monitor-strip">
            ${this.renderHeartbeat(stats)}
            ${uptimeLabel}
            ${this.renderSparkline(stats)}
            ${ping}
            ${down}
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
            ? `<div class="health-monitor-chart" data-health-monitor-plot>${chart}</div>
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
     * Make the enlarged chart readable: clicking, hovering or tabbing to a point
     * writes its response time and measurement time into the readout under the
     * chart, and ←/→ walk the series from a selected point.
     *
     * Bound per open. The side panel rebuilds its sections on the next open, so
     * the listeners go with them and there is nothing to tear down.
     */
    bindMonitorChart(issue, root = document.getElementById('modal-text')) {
        const modalText = root;
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
        void this.mountMonitorChart(issue, modalText);
    }

    /*
     * The same chart with uPlot (shared/nd-chart.js), over the plain one bound
     * above: response time per bucket with its average as a dashed line, a
     * tooltip, a drag to zoom, and the arrow keys with the bucket read out under
     * the chart -- the readout the plain chart had, now in the chart's own line.
     * When the library cannot be loaded the plain chart stays, as it was.
     */
    async mountMonitorChart(issue, root) {
        const host = root?.querySelector('[data-health-monitor-plot]');
        const buckets = Array.isArray(issue?.monitorStats?.heartbeat) ? issue.monitorStats.heartbeat : [];
        if (!host || buckets.length < 2) return;
        try {
            if (!window.NdChart) {
                await window.LazyScript.loadScriptOnce('js/shared/nd-chart.js', 'ndChart',
                    () => typeof window.NdChart !== 'undefined');
            }
            await window.NdChart.load();
        } catch {
            return;
        }
        if (!host.isConnected) return;
        const values = buckets.map((b) => (Number(b.avgMs) > 0 ? Number(b.avgMs) : null));
        const known = values.filter((v) => v !== null);
        if (known.length < 2) return;
        const avg = Math.round(known.reduce((sum, v) => sum + v, 0) / known.length);
        const min = Math.min(...known);
        const max = Math.max(...known);
        const span = Number(buckets[buckets.length - 1].from) - Number(buckets[0].from);
        const ms = (v) => `${Math.round(v)}ms`;
        const text = (i) => {
            const b = buckets[i];
            const when = new Date(b.from).toLocaleString();
            if (values[i] === null) return `${when} · ${this.heartbeatStateLabel(b.state)}`;
            const checks = (Number(b.up) || 0) + (Number(b.down) || 0);
            return [when, ms(values[i]),
                checks ? this.t('dashboard.healthStatsChecks', '{count} checks', { count: checks }) : '',
                this.heartbeatStateLabel(b.state)].filter(Boolean).join(' · ');
        };
        this._monitorChart?.destroy();
        this._monitorChart = window.NdChart.chart(host, {
            x: buckets.map((b) => Number(b.from) / 1000),
            series: [
                { label: this.t('dashboard.healthStatsResponse', 'Response time'), values, color: '--accent-primary', format: ms },
                { label: 'avg', values: values.map(() => avg), color: '--text-muted', dash: [4, 4], width: 1, fill: false, format: ms },
            ],
            text,
            format: { x: span > 2 * 86400000 ? 'datetime' : 'time', tick: ms },
            scales: { y: { range: () => [0, max * 1.15] } },
            summary: this.t('dashboard.healthSparklineLabelAvg', 'Response time {min}–{max}ms, average {avg}ms', { min, max, avg }),
            height: 132,
            axisWidth: 50,
        });
        // The chart reads its own points out; the plain chart's readout goes.
        root.querySelector('[data-health-readout]')?.remove();
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
     * What a row's glow says, in the shared list vocabulary: broken is bad,
     * anything that wants a second look is warn, a monitor is info, a row the
     * reader has quietened is muted, and the rest is good. Broken wins over
     * everything, because a muted outage is still an outage.
     */
    healthRowStatus(issue) {
        if (issue?.status === 'broken') return 'bad';
        if ((issue?.watchDrift && issue?.driftNoticed) || this.certFor(issue)
            || this.scoreClass(issue?.score) === 'warn') {
            return 'warn';
        }
        if (issue?.monitor) return 'info';
        if (issue?.notifyMuted || this.ignoredFlagsOf(issue).length || issue?.status === 'unchecked') {
            return 'muted';
        }
        return 'good';
    }

}

window.DashboardHealth = DashboardHealth;
