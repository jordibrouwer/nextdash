/**
 * Health, inside Config → Bookmarks.
 *
 * The Health module does the work it always did -- the report, what a filter
 * means, how a score is broken down, every action on a bookmark's health --
 * loaded without its view (dash.health.load()) and asked from here. This file
 * only joins its answers to the bookmarks, by the same URL key the preview
 * cards read health facts with, and hands them to the workbench to draw.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {
        /**
         * The Health module with its report loaded, or null when Health is
         * switched off. Loaded once; later calls wait on the same fetch.
         */
        async bmHealth() {
            if (this.dash.settings?.healthViewEnabled === false) return null;
            let health;
            try {
                health = await this.dash.health?.load?.();
            } catch {
                return null;
            }
            if (!health) return null;
            if (!this._bmHealthListening) {
                // Every later report -- a re-check, a check-mode change, saved
                // expectations, the refresh key -- redraws what reads it.
                this._bmHealthListening = true;
                health.onReportLoaded?.(() => {
                    this.rebuildBmHealthJoin(health);
                    this.repaintBmHealthDependents();
                });
            }
            if (!this._bmHealthLoading) {
                this._bmHealthLoading = health.fetchReport()
                    .then(() => this.rebuildBmHealthJoin(health))
                    .catch(() => {
                        // A failed report leaves the list as it was; the next
                        // open tries again.
                        this._bmHealthLoading = null;
                    });
            }
            await this._bmHealthLoading;
            return health;
        },

        rebuildBmHealthJoin(health) {
            this._bmHealthModule = health;
            this._bmHealthReport = health.report || null;
            // Under a Health filter the rows themselves come from the report.
            this.invalidateVisibleBookmarks?.();
            // The rail's counts are cached against this: a new report is a new count.
            this._bmHealthGen = (this._bmHealthGen || 0) + 1;
            const byUrl = new Map();
            (health.report?.issues || []).forEach((issue) => {
                const key = global.HealthFacts?.keyFor?.(issue.url);
                if (key) byUrl.set(key, issue);
            });
            this._bmHealthByUrl = byUrl;
        },

        /** The report's issue for one bookmark, or null before the report lands. */
        bmHealthIssue(b) {
            const key = global.HealthFacts?.keyFor?.(b?.url);
            return key ? (this._bmHealthByUrl?.get(key) || null) : null;
        },

        /**
         * Whether a bookmark falls under one of Health's filters, with the
         * Health module's own meaning. A bookmark the report does not know
         * (the report not loaded yet, or a bookmark added since) falls under
         * none, rather than being guessed into one.
         */
        bmHealthMatches(b, key) {
            const issue = this.bmHealthIssue(b);
            const health = this._bmHealthModule;
            if (!issue || !health) return false;
            try {
                return Boolean(health.matchesFilter(issue, key));
            } catch {
                return false;
            }
        },

        /** Every Health filter one bookmark falls under, for the rail's counts. */
        bmHealthKeys(b) {
            if (!this._bmHealthModule) return [];
            return global.DashboardConfig.HEALTH_FILTERS.filter((key) => this.bmHealthMatches(b, key));
        },

        /** The filter's name as the Health view gives it. */
        bmHealthFilterLabel(key) {
            const label = this._bmHealthModule?.filterLabel?.(key);
            return label || key;
        },

        /**
         * The collection's health at the top of the rail: the rows Health's
         * own summary shows (score, trend with its sparkline, broken, uptime),
         * drawn from its shellSummary() rather than recomputed here.
         */
        renderBmHealthSummary() {
            const health = this._bmHealthModule;
            if (!health?.report) return '';
            let rows = [];
            try {
                rows = health.shellSummary() || [];
            } catch {
                return '';
            }
            const esc = (v) => this.dash.escapeHtml(v);
            // Beside Health's rows, the one it has no row for: how many
            // bookmarks nothing checks at all.
            const off = (this.configBookmarkPool?.() || this.dash.allBookmarks || [])
                .filter((b) => (global.CheckMode?.of?.(b) || 'off') === 'off').length;
            if (off) rows.push({ label: this.t('config.cleanupFilterNoCheck', 'Not checked'), value: String(off), tone: 'muted' });
            const body = rows.filter((row) => row && (row.value !== '' || row.extraNode)).map((row) => `
                <div class="config-bm-health-summary-row"${row.tone ? ` data-tone="${esc(row.tone)}"` : ''}>
                    <span class="config-bm-health-summary-label">${esc(row.label)}</span>
                    <span class="config-bm-health-summary-value">${esc(row.value ?? '')}</span>
                    ${row.extraNode?.outerHTML || ''}
                </div>`).join('');
            // No aria-label: the rows already read as text (score, trend,
            // updated), which says more than a fixed label would, and
            // role="button" is enough to announce that Enter/Space act on it.
            // .lvs-summary: Health's own tile, so a theme's edges, glow and
            // (under glass) blur reach this one the same way.
            return body ? `<div class="config-bm-health-summary lvs-summary" data-bm-health-summary
                role="button" tabindex="0">${body}</div>` : '';
        },

        /* ── The panel's Health, Monitor and Actions parts ──────────────── */

        /**
         * The Health section's body for one bookmark: every reason with its
         * "since", the score breakdown, the check mode and the expectations
         * form -- each drawn by the Health module, exactly as its own panel
         * draws them. '' when the report does not know the bookmark, and the
         * workbench keeps its plain facts.
         */
        renderBmHealthSection(b) {
            const health = this._bmHealthModule;
            const issue = this.bmHealthIssue(b);
            if (!health || !issue) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const reasons = health.reasonEntries(issue)
                .map((entry) => `<li class="health-drawer-reason">${esc(entry.label)}</li>`).join('');
            const since = health.renderBrokenSince(issue);
            return `
                <div class="config-bm-health-why">
                    ${reasons ? `<ul class="health-drawer-reasons">${reasons}</ul>` : ''}
                    ${since ? `<p class="health-drawer-since">${since}</p>` : ''}
                </div>
                <div class="health-view-score-panel">${health.renderScorePanel(issue)}</div>
                <div class="config-bm-health-check" role="radiogroup"
                     aria-label="${esc(health.t('dashboard.healthCheckModeLabel', 'Availability checking'))}">${health.renderCheckModeChoices(issue)}</div>
                <div class="health-view-expect-panel">${health.renderExpectPanel(issue)}</div>`;
        },

        /**
         * The Health tab: a summary to take in at a glance -- the score as a
         * ring, the state in words, the reasons as chips, and for a monitored
         * bookmark its heartbeat -- and the details under it as an accordion
         * whose every head already says its answer, so a closed section still
         * informs. The parts are the Health module's own, as renderBmHealthSection
         * draws them; only the arrangement is this tab's.
         */
        renderBmHealthPane(b) {
            const health = this._bmHealthModule;
            const issue = this.bmHealthIssue(b);
            if (!health || !issue) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const now = Date.now();
            const mode = global.CheckMode?.of?.(b) || 'off';
            const score = Number(issue.score);
            const tone = score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad';
            const entries = health.reasonEntries(issue) || [];
            const problems = entries.filter((e) => Number(e.penalty) > 0);
            const down = Number(issue.monitorStats?.downSince) > 0;
            const broken = issue.status === 'broken';
            const since = Number(issue.brokenSince) > 0 ? ` · ${health.formatDuration(now - Number(issue.brokenSince))}` : '';
            const state = broken ? { cls: 'bad', label: `${t('bmHealthStateBroken', 'Broken')}${since}` }
                : down ? { cls: 'bad', label: t('bmHealthStateDown', 'Monitor down') }
                    : mode === 'off' ? { cls: 'off', label: t('cleanupFilterNoCheck', 'Not checked') }
                        : problems.length ? { cls: 'warn', label: t('bmHealthStateLook', 'Needs a look') }
                            : { cls: 'good', label: t('bmHealthStateHealthy', 'Healthy') };
            const circ = 2 * Math.PI * 26;
            const dash = Math.max(0, Math.min(100, score || 0)) / 100 * circ;
            const ring = `<svg class="config-bm-health-ring" data-tone="${tone}" viewBox="0 0 64 64" role="img"
                    aria-label="${esc(t('bmHealthScoreAria', 'Score {n} of 100').replace('{n}', String(score)))}">
                    <circle cx="32" cy="32" r="26" class="is-track"></circle>
                    <circle cx="32" cy="32" r="26" class="is-value" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 32 32)"></circle>
                    <text x="32" y="37" text-anchor="middle">${esc(String(score))}</text>
                </svg>`;
            const chips = entries.map((e) => {
                const pen = Number(e.penalty) > 0;
                return `<span class="config-bm-health-chip${pen ? ' is-bad' : ''}">${esc(e.label)}${pen ? ` −${esc(String(e.penalty))}` : ''}</span>`;
            }).join('');
            const modeLabel = global.CheckMode?.meta?.(mode)?.label || mode;
            const interval = mode === 'monitor' ? ` · ${global.CheckMode?.intervalLabel?.(global.CheckMode?.intervalOf?.(b)) || ''}` : '';
            const checked = Number(issue.lastChecked) > 0
                ? t('bmHealthChecked', 'Checked {d} ago').replace('{d}', health.formatDuration(now - Number(issue.lastChecked)))
                : '';
            const line = mode === 'off'
                ? `${esc(t('bmHealthNothingChecks', 'Nothing checks this bookmark.'))}
                    <button type="button" class="config-bm-rail-more" data-bm-health-enable>${esc(t('bmHealthTurnOn', 'Turn on checking'))}</button>`
                : esc([checked, `${modeLabel}${interval}`].filter(Boolean).join(' · '));
            const strip = issue.monitor ? `<div class="config-bm-health-strip">${health.renderMonitorStrip(issue)}</div>` : '';

            const item = (name, label, answer, body) => `<details class="config-bm-acc" data-bm-acc="${name}"${this.bmHealthAccOpen(name, problems.length > 0 || broken || down) ? ' open' : ''}>
                    <summary><span>${esc(label)}</span><span class="config-bm-acc-answer">${esc(answer)}</span></summary>
                    <div class="lvs-drawer-section-body">${body}</div>
                </details>`;
            const reasons = entries.map((e) => `<li class="health-drawer-reason">${esc(e.label)}</li>`).join('');
            const sinceLine = health.renderBrokenSince(issue);
            const monitored = issue.monitor;
            const uptime = issue.monitorStats?.uptime24h?.ratio;
            const expectSet = String(issue.checkUrl || issue.expectText || '').trim();
            return `
                <div class="config-bm-health-viz">
                    ${ring}
                    <div class="config-bm-health-facts">
                        <span class="config-bm-health-state is-${state.cls}">${esc(state.label)}</span>
                        ${chips ? `<span class="config-bm-health-chips">${chips}</span>` : ''}
                        <span class="config-bm-health-line">${line}</span>
                        <button type="button" class="config-btn config-btn--small bm-health-large-open" data-bm-panel-action="health-large"
                            title="${esc(t('bmLargeOpenTitle', 'Every chart of this bookmark, in large (Shift+H)'))}">${esc(t('bmLargeOpen', 'Open charts'))} ⤢</button>
                    </div>
                    ${strip}
                </div>
                <div class="config-bm-acc-list">
                    ${item('why', t('bmHealthWhy', 'Why'), problems.length
                        ? t('bmHealthProblems', '{n} to look at').replace('{n}', String(problems.length))
                        : t('bmHealthNothingWrong', 'nothing wrong'), `
                        ${reasons ? `<ul class="health-drawer-reasons">${reasons}</ul>` : `<p class="config-bm-panel-muted">${esc(t('bmHealthNothingWrong', 'nothing wrong'))}</p>`}
                        ${sinceLine ? `<p class="health-drawer-since">${sinceLine}</p>` : ''}`)}
                    ${item('score', t('bmHealthScoreBreakdown', 'Score breakdown'), String(score),
                        `<div class="health-view-score-panel">${health.renderScorePanel(issue)}</div>`)}
                    ${item('checking', t('bmFieldChecking', 'Checking'), `${modeLabel}${interval}`,
                        `<div class="config-bm-health-check" role="radiogroup" aria-label="${esc(health.t('dashboard.healthCheckModeLabel', 'Availability checking'))}">${health.renderCheckModeChoices(issue)}</div>`)}
                    ${monitored ? `<div data-bm-section="monitor">${item('monitor', t('bmSectionMonitor', 'Monitor & history'),
                        uptime != null ? t('bmHealthUptime24h', '{p}% last 24 h').replace('{p}', String(Math.round(uptime * 1000) / 10)) : '',
                        health.hasMonitorStats(issue) ? health.buildMonitorStatsHtml(issue) : '')}</div>` : ''}
                    ${item('expectations', t('bmHealthExpectations', 'Expectations'), expectSet ? t('bmHealthExpectSet', 'set') : t('bmHealthExpectNone', 'none'),
                        `<div class="health-view-expect-panel">${health.renderExpectPanel(issue)}</div>`)}
                </div>`;
        },

        /** Whether an accordion section is open: the reader's last choice, else open for Why when something is wrong. */
        bmHealthAccOpen(name, troubled) {
            let stored = null;
            try {
                stored = JSON.parse(global.localStorage?.getItem('nextdash.bm.healthAcc') || 'null');
            } catch {
                stored = null;
            }
            if (Array.isArray(stored)) return stored.includes(name);
            return name === 'why' && troubled;
        },

        /** Open one accordion section of the Health tab, as `c` and "Turn on checking" do. */
        openBmHealthAcc(name) {
            const panel = this._libPanel || document.getElementById('config-bm-panel');
            const details = panel?.querySelector(`[data-bm-acc="${name}"]`);
            if (details && !details.open) details.open = true;
            details?.scrollIntoView?.({ block: 'nearest' });
            return details || null;
        },

        /** The Monitor section's body: the strip and the statistics; '' unless monitored. */
        renderBmMonitorSection(b) {
            const health = this._bmHealthModule;
            const issue = this.bmHealthIssue(b);
            if (!health || !issue?.monitor) return '';
            return health.renderMonitorStrip(issue)
                + (health.hasMonitorStats(issue) ? health.buildMonitorStatsHtml(issue) : '');
        },

        /**
         * Health's row actions. The panel's head carries Re-check itself, so
         * its ⋯ menu asks for the rest with `skip`.
         */
        renderBmHealthActions(b, { skip = [] } = {}) {
            const health = this._bmHealthModule;
            const issue = this.bmHealthIssue(b);
            if (!health || !issue) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => health.t(`dashboard.${key}`, fallback);
            const button = (action, label) => `<button type="button" class="config-btn config-btn--small" data-bm-health-action="${action}">${esc(label)}</button>`;
            return [
                skip.includes('recheck') ? '' : button('recheck', t('healthRecheck', 'Re-check')),
                button('redirect', t('healthMenuRedirect', 'Detect redirect')),
                button('title', t('healthMenuTitle', 'Refresh title')),
                button('archive', t('healthMenuArchive', 'Open archived copy')),
                button('local-copy', t('healthMenuLocalCopy', 'Save a local copy')),
                button('ignore', t('healthMenuIgnore', 'Ignore this condition')),
                button('snooze', t('healthMenuSnooze', 'Snooze 30 days')),
                button('share', t('healthMenuShare', 'Share link')),
                this.bmHealthDuplicateGroup(b) ? button('merge', t('mergeDuplicateGroup', 'Merge duplicate group')) : '',
            ].join('');
        },

        /** The report's duplicate group this bookmark belongs to, or null. */
        bmHealthDuplicateGroup(b) {
            const health = this._bmHealthModule;
            const keyFor = global.HealthFacts?.keyFor;
            const key = keyFor?.(b?.url);
            if (!health || !key) return null;
            return (health.duplicateGroups?.() || []).find((group) => Array.isArray(group?.bookmarks)
                && group.bookmarks.length > 1
                && keyFor(group.url || group.bookmarks[0]?.url) === key) || null;
        },

        /**
         * Health's own multi-select, ticked with the workbench's selection, so
         * its sweeps -- the pacing, the progress overlay, the confirmations,
         * the 412 that stops a local-copy run -- run unchanged. A separate
         * instance from the Health view's, whose ticks are the reader's there.
         */
        bmHealthBulkRunner() {
            const health = this._bmHealthModule;
            const MultiSelect = global.DashboardHealthMultiSelect;
            if (!health || typeof MultiSelect !== 'function') return null;
            if (this._bmHealthRunner?.health !== health) this._bmHealthRunner = new MultiSelect(health);
            const runner = this._bmHealthRunner;
            runner.selected = new Set(this.bookmarksFromKeys([...this.bmSelected])
                .map((b) => this.bmHealthIssue(b))
                .filter(Boolean)
                .map((issue) => health.issueKey(issue)));
            return runner;
        },

        /** Health's bulk actions for the bulk panel; '' when no ticked row is in the report. */
        renderBmHealthBulkActions() {
            const runner = this.bmHealthBulkRunner();
            if (!runner?.selected.size) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback, vars) => runner.t(`dashboard.${key}`, fallback, vars);
            const button = (action, label) => `<button type="button" class="config-btn config-btn--small" data-bm-health-bulk="${action}">${esc(label)}</button>`;
            const drifting = runner.driftingSelected().length;
            return `<div class="config-bm-health-bulk">${[
                button('recheck', t('healthBulkRecheck', 'Re-check')),
                button('favicons', t('healthBulkFavicon', 'Refresh favicons')),
                button('previews', t('healthBulkPreview', 'Rebuild previews')),
                button('local-copy', t('healthBulkLocalCopy', 'Save a copy on this disk')),
                drifting ? button('accept-drift', t('healthBulkAcceptDrift', 'Accept drift ({count})', { count: drifting })) : '',
            ].join('')}</div>`;
        },

        async runBmHealthBulk(action) {
            const runner = this.bmHealthBulkRunner();
            if (!runner) return;
            const run = {
                recheck: () => runner.bulkRecheck(),
                favicons: () => runner.bulkRefreshFavicons(),
                previews: () => runner.bulkRebuildPreviews(),
                'local-copy': () => runner.bulkCaptureLocalCopies(),
                'accept-drift': () => runner.bulkAcceptDrift(),
            }[action];
            await run?.();
        },

        /**
         * Merge through Health, then re-read the bookmarks: the merge deletes
         * rows server-side, and the list reads a pool nothing has patched.
         */
        async mergeBmDuplicateGroup(b) {
            const health = this._bmHealthModule;
            const group = this.bmHealthDuplicateGroup(b);
            if (!health || !group) return;
            await health.mergeDuplicateGroup(group);
            await this.dash.loadAllBookmarks?.();
            this.invalidateVisibleBookmarks?.();
            this.repaintBookmarksList?.();
        },

        /** Wire the parts above after the panel has been drawn. */
        bindBmHealthPanel(panel) {
            const health = this._bmHealthModule;
            const key = panel?.dataset.bmPanelKey;
            const b = key ? this.findBookmarkByKey(key) : null;
            const issue = b ? this.bmHealthIssue(b) : null;
            if (!health || !issue) return;
            const expect = panel.querySelector('[data-bm-section="health"] .health-view-expect-panel');
            const healthBody = expect?.closest('.lvs-drawer-section-body');
            if (healthBody) health.bindExpectPanel(healthBody, issue, health.issueKey(issue));
            // The accordion remembers what the reader opens, across bookmarks.
            panel.querySelectorAll('[data-bm-acc]').forEach((details) => {
                details.addEventListener('toggle', () => {
                    const open = [...panel.querySelectorAll('[data-bm-acc][open]')].map((d) => d.getAttribute('data-bm-acc'));
                    try {
                        global.localStorage?.setItem('nextdash.bm.healthAcc', JSON.stringify(open));
                    } catch {
                        // Private window: the choice lasts until the next bookmark.
                    }
                });
            });
            panel.querySelector('[data-bm-health-enable]')?.addEventListener('click', () => {
                this.openBmHealthAcc('checking')?.querySelector('[data-check-mode]')?.focus();
            });
            panel.querySelectorAll('[data-bm-section="health"] [data-check-mode]').forEach((el) => {
                el.addEventListener('click', () => void health.setCheckMode(issue, el.getAttribute('data-check-mode')));
            });
            panel.querySelectorAll('[data-bm-section="health"] [data-check-interval]').forEach((el) => {
                el.addEventListener('click', () => void health.setMonitorInterval(issue, Number(el.getAttribute('data-check-interval'))));
            });
            // The strip sits in the summary on top, the statistics in their
            // section: the chart binds across both.
            const monitorBody = panel.querySelector('[data-bm-section="monitor"] .lvs-drawer-section-body')
                && panel.querySelector('[data-bm-section="health"]');
            if (monitorBody) {
                health.bindMonitorChart(issue, monitorBody);
                monitorBody.querySelector('[data-monitor-export]')
                    ?.addEventListener('click', () => health.exportMonitorHistory(issue));
            }
            const run = {
                recheck: () => health.recheckIssue(issue),
                redirect: () => health.detectRedirect(issue),
                title: () => health.refreshTitle(issue),
                archive: () => health.openArchive(issue),
                'local-copy': () => health.captureLocalCopy(issue),
                ignore: () => health.toggleIgnore(issue),
                snooze: () => health.toggleIgnore(issue, { snooze: true }),
                share: () => health.shareIssue(issue),
                merge: () => this.mergeBmDuplicateGroup(b),
            };
            panel.querySelectorAll('[data-bm-health-action]').forEach((el) => {
                el.addEventListener('click', () => void run[el.getAttribute('data-bm-health-action')]?.());
            });
        },

        /** Re-read the report (refresh: ask the server to run the checks again). */
        async refreshBmHealth({ refresh = false } = {}) {
            let health;
            try {
                health = await this.dash.health?.load?.();
            } catch {
                return;
            }
            if (!health) return;
            await health.fetchReport({ refresh });
            this.rebuildBmHealthJoin(health);
            this.repaintBmHealthDependents();
        },

        /**
         * What draws from the join: the rail's counts and the panel always,
         * the rows only while a Health filter decides which rows there are.
         * Repainting the rows otherwise swapped them out from under a pointer
         * that had just reached one, a second after the list opened.
         */
        repaintBmHealthDependents() {
            if (this.section !== 'bookmarks' || !this.isActiveView?.()) return;
            this.repaintWorkbenchRail?.();
            if (this.bmHealthFilter) this.repaintBookmarksList?.();
            else this.syncWorkbenchRowsHealth();
            this.repaintWorkbenchPanel?.();
        },

        /**
         * A new report, into the rows already drawn: their colour and their
         * score, set on the same nodes. Redrawing the rows instead is what
         * took a row away from under a pointer that had just reached it.
         */
        syncWorkbenchRowsHealth() {
            const esc = (v) => this.dash.escapeHtml(v);
            const tone = (score) => (score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad');
            document.querySelectorAll('#config-bm-list .config-bm-row').forEach((row) => {
                const b = this.findBookmarkByKey(this.bookmarkRowKey(row));
                if (!b) return;
                const status = this.workbenchRowStatus?.(b);
                if (status) row.setAttribute('data-lvs-status', status);
                else row.removeAttribute('data-lvs-status');
                const cell = row.querySelector('.config-bm-row-score');
                const issue = this.bmHealthIssue(b);
                const score = issue && Number.isFinite(Number(issue.score)) ? Number(issue.score) : null;
                const html = score == null ? '' : `<span class="config-bm-score" data-tone="${tone(score)}">${esc(String(score))}</span>`;
                if (cell && cell.innerHTML !== html) cell.innerHTML = html;
            });
        },

        /** Kicked when the list is bound: load once, repaint when it lands. */
        startBmHealth() {
            if (this._bmHealthByUrl || this._bmHealthStarted) return;
            this._bmHealthStarted = true;
            void this.bmHealth().then((health) => {
                this._bmHealthStarted = false;
                if (health) this.repaintBmHealthDependents();
            });
        },
    });

    global.DashboardConfigBookmarksHealthReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
