/**
 * The collection health modal: "how is it going", where the view itself is
 * the work queue and only answers "what to fix now".
 *
 * Everything here comes from the report the workbench already holds
 * (dashboard-config-bookmarks-health.js): summary, issues, fleet, the
 * certificate map, and the trend history behind the rail's sparkline. There
 * is no second fetch and nothing is invented -- a figure the report does not
 * carry is left off rather than guessed at.
 *
 * Opened from the rail's summary block (renderBmHealthSummary) and from the
 * bookmark list's `h` key (dashboard-config.js, handleBookmarkKeyboardNavigation).
 * Loaded after the Health mixin, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    /*
     * "What is wrong, by kind": every condition health.matchesFilter() knows,
     * not only the nine chips the rail draws. bookmarkFilterTests().health
     * calls matchesFilter with whatever key bmHealthFilter holds, so a filter
     * outside the rail's own set still narrows the list correctly when the
     * modal sets it -- the rail's HEALTH_FILTERS constant only gates which
     * chips it draws and what a reloaded hash accepts, not what the list can
     * be filtered by.
     */
    const KIND_FILTERS = ['broken', 'drift', 'duplicate', 'stale', 'unused',
        'missing-preview', 'shortcut-conflict', 'orphaned-category', 'certificates'];

    const PAGES_SHOWN = 5;

    Object.assign(global.DashboardConfig.prototype, {
        openBmHealthModal() {
            const health = this._bmHealthModule;
            if (!health?.report || typeof global.AppModal?.show !== 'function') return;
            global.nextdashTrack?.('bookmarks:health-modal-open');
            global.AppModal.show({
                title: this.t('config.bmHealthModalTitle', 'Collection health'),
                htmlMessage: this.renderBmHealthModal(health),
                showCancel: false,
                confirmText: this.t('dashboard.close', 'Close'),
                modalClass: 'view-explain-modal bm-health-modal',
                // Wide enough for four columns: the collection read at one glance.
                modalMaxWidth: 'min(82rem, calc(100vw - 2.5rem))',
                // Gone with the modal: the charts, their ResizeObservers and
                // canvases stayed alive until the next open.
                onHide: () => {
                    ['_bmScoreChart', '_bmTrendChart', '_bmFleetDaysChart'].forEach((k) => {
                        try { this[k]?.destroy?.(); } catch { /* already gone */ }
                        this[k] = null;
                    });
                },
            });
            this.bindBmHealthModal();
            this.fitBmHealthModal();
            void this.mountBmTrendChart();
            void this.mountBmFleetDaysChart();
            void this.mountBmScoreChart();
        },

        /*
         * The overview's score over time with uPlot: a date axis and a 0-100
         * axis, the lowest day marked, and each day read out by the pointer or
         * the keys. Kept compact, so the overview still fits on one screen.
         */
        async mountBmScoreChart() {
            const host = document.querySelector('#app-modal.show [data-bm-score-plot]');
            const data = this._bmScoreChartData;
            if (!host || !data) return;
            try {
                if (!global.NdChart) {
                    await global.LazyScript.loadScriptOnce('js/shared/nd-chart.js', 'ndChart',
                        () => typeof global.NdChart !== 'undefined');
                }
                await global.NdChart.load();
            } catch {
                return;
            }
            if (!host.isConnected) return;
            const pct = (v) => `${Math.round(v)}%`;
            const lowLabel = this.t('config.bmHealthModalLowest', 'lowest');
            this._bmScoreChart?.destroy();
            this._bmScoreChart = global.NdChart.chart(host, {
                x: data.points.map((p) => p.t / 1000),
                series: [
                    { label: this.t('config.bmHealthModalScoreTitle', 'Score over time'), values: data.values, color: '--accent-primary', format: pct },
                    { label: lowLabel, values: data.values.map((v, i) => (i === data.lowest ? v : null)),
                        color: '--accent-error', fill: false, points: true, format: pct },
                ],
                text: (i) => {
                    const when = global.NdChart.timeText(data.points[i].t / 1000, 'date');
                    const v = data.values[i];
                    if (v == null) return `${when} · —`;
                    return `${when} · ${pct(v)}${i === data.lowest ? ` · ${lowLabel}` : ''}`;
                },
                format: { x: 'date', tick: pct },
                scales: { y: { range: () => [0, 100] } },
                summary: data.label,
                height: 96,
                axisWidth: 38,
            });
            // Measured again with the chart in: the overview's fit depends on it.
            this.fitBmHealthModal();
        },

        /*
         * The course over time with uPlot (shared/nd-chart.js): a cursor and a
         * tooltip on every day, a drag to zoom into a week, the arrow keys with
         * the day read out under the chart, and a table for a screen reader.
         * Mounted over the plain chart once the library is there; if it never
         * is, the plain chart stays.
         */
        async mountBmTrendChart() {
            const health = this._bmHealthModule;
            const host = document.querySelector('#app-modal.show [data-bm-trend-plot]');
            if (!health || !host) return;
            try {
                if (!global.NdChart) {
                    await global.LazyScript.loadScriptOnce('js/shared/nd-chart.js', 'ndChart',
                        () => typeof global.NdChart !== 'undefined');
                }
                await global.NdChart.load();
            } catch {
                return;
            }
            // Gone, or replaced by another series, while the library arrived.
            if (!host.isConnected) return;
            const allSeries = global.DashboardHealth?.TREND_SERIES || [];
            const active = allSeries.find((s) => s.id === (this._bmTrendSeries || 'healthy')) || allSeries[0];
            if (!active) return;
            const points = health.trendPoints();
            const values = points.map((p) => health.trendPercent(p, active));
            const known = values.filter((v) => v !== null);
            if (known.length < 2) return;
            const unit = active.mode === 'percent' ? '%' : '';
            const label = health.t(`dashboard.${active.labelKey}`, active.fallback);
            const format = (v) => `${Math.round(v * 10) / 10}${unit}`;
            this._bmTrendChart?.destroy();
            this._bmTrendChart = global.NdChart.chart(host, {
                x: points.map((p) => p.t / 1000),
                series: [{ label, values, color: '--accent-primary', format }],
                format: { x: 'date', y: format, tick: (v) => `${Math.round(v)}${unit}` },
                scales: { y: { range: (u, min, max) => (active.mode === 'percent'
                    ? [0, 100] : [0, Math.max(1, max) * 1.1]) } },
                summary: `${label}: ${known[0]}${unit} → ${known[known.length - 1]}${unit}`,
                // Low enough that the per-day chart below fits beside it on one screen.
                height: 116,
            });
        },

        /**
         * One screen, no scrollbar: on a window too small for the cards as
         * drawn, step down through tighter spacing, more and narrower columns
         * and smaller type until they fit -- measured, because what fits
         * depends on the collection as much as on the window. Kept fitted
         * while the window is resized.
         */
        fitBmHealthModal() {
            const body = document.querySelector('#app-modal.show .modal-body');
            const grid = body?.querySelector('.bm-health-modal-grid');
            if (!body || !grid) return;
            // The last two steps leave out what only adds to the picture (the
            // figures strip and the extra cards), then the Monitors card: the
            // Monitors tab has all of it, so the overview can do without.
            const TIERS = ['is-snug', 'is-snugger', 'is-smallest', 'is-lean', 'is-without-monitors'];
            const fits = () => body.scrollHeight <= body.clientHeight + 1;
            grid.classList.remove(...TIERS);
            for (const tier of TIERS) {
                if (fits()) break;
                grid.classList.add(tier);
            }
            if (!this._bmHealthModalResize) {
                let frame = 0;
                this._bmHealthModalResize = () => {
                    if (!document.querySelector('#app-modal.show .bm-health-modal-grid')) return;
                    cancelAnimationFrame(frame);
                    frame = requestAnimationFrame(() => this.fitBmHealthModal());
                };
                global.addEventListener('resize', this._bmHealthModalResize);
            }
        },

        /* ── Assembling the body ─────────────────────────────────────────── */

        /** The tab the modal opens on: the reader's last, Overview at first. */
        bmHealthModalTab() {
            try {
                const tab = global.localStorage?.getItem('nextdash.bm.healthModalTab');
                return tab === 'monitors' || tab === 'trend' ? tab : 'overview';
            } catch {
                return 'overview';
            }
        },

        /** Three tabs: the collection at a glance, its monitors, and its course over time. */
        renderBmHealthModalTabs(tab) {
            const esc = (v) => this.dash.escapeHtml(v);
            const button = (name, label) => `<button type="button" class="config-bm-tab${tab === name ? ' is-active' : ''}" role="tab"
                aria-selected="${tab === name ? 'true' : 'false'}" tabindex="${tab === name ? 0 : -1}" data-bm-health-modal-tab="${name}">${esc(label)}</button>`;
            return `<div class="config-bm-tabs bm-health-modal-tabs" role="tablist" aria-label="${esc(this.t('config.bmHealthModalTitle', 'Collection health'))}">
                ${button('overview', this.t('config.bmHealthModalTabOverview', 'Overview'))}
                ${button('monitors', this.t('config.bmHealthModalTabMonitors', 'Monitors'))}
                ${button('trend', this.t('config.bmHealthModalTabTrend', 'Trend'))}
            </div>`;
        },

        renderBmHealthModal(health) {
            const tab = this.bmHealthModalTab();
            const cards = [
                this.renderBmHealthModalKeyFigures(health),
                this.renderBmHealthModalScoreCard(health),
                this.renderBmHealthModalStandCard(health),
                this.renderBmHealthModalKindCard(health),
                this.renderBmHealthModalDistributionCard(health),
                this.renderBmHealthModalPagesCard(health),
                this.renderBmHealthModalCoverageCard(health),
                this.renderBmHealthModalMonitorsCard(health),
                this.renderBmHealthModalCertsCard(health),
                this.renderBmHealthModalFixFirstCard(health),
                this.renderBmHealthModalFreshnessCard(health),
                this.renderBmHealthModalUsageCard(health),
                this.renderBmHealthModalFailuresCard(health),
            ].filter(Boolean).join('');
            // The tabs share the subtitle's line: a row of their own would
            // cost the overview the room that keeps it on one screen.
            return `<div class="bm-health-modal-head">
                    ${this.renderBmHealthModalSubtitle(health)}
                    ${this.renderBmHealthModalTabs(tab)}
                </div>
                <div class="bm-health-modal-pane" role="tabpanel" data-bm-health-modal-pane="overview"${tab === 'overview' ? '' : ' hidden'}>
                    <div class="bm-health-modal-grid">${cards}</div>
                </div>
                <div class="bm-health-modal-pane" role="tabpanel" data-bm-health-modal-pane="monitors"${tab === 'monitors' ? '' : ' hidden'}>
                    ${this.renderBmHealthModalMonitorsPane(health)}
                </div>
                <div class="bm-health-modal-pane" role="tabpanel" data-bm-health-modal-pane="trend"${tab === 'trend' ? '' : ' hidden'}>
                    ${this.renderBmHealthModalTrendPane(health)}
                </div>
                ${this.renderBmHealthModalFooter(health)}`;
        },

        /* ── Overview: figures and extra cards ───────────────────────────── */

        /** The whole collection in one line of figures, across the top of the overview. */
        renderBmHealthModalKeyFigures(health) {
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const summary = health.report?.summary || {};
            const total = Number(summary.totalBookmarks) || issues.length;
            if (!total) return '';
            const attention = Math.max(0, total - (Number(summary.healthyCount) || 0) - (Number(summary.ignoredCount) || 0));
            const scores = issues.map((i) => Number(i.score)).filter((n) => Number.isFinite(n));
            const avg = scores.length ? Math.round(scores.reduce((a, n) => a + n, 0) / scores.length) : null;
            const never = issues.filter((i) => !Number(i.openCount)).length;
            const copies = issues.filter((i) => Number(i.localCopies) > 0).length;
            const shortcuts = issues.filter((i) => i.shortcut).length;
            const stats = [
                [this.t('config.bmHealthModalKeyTotal', 'Bookmarks'), String(total)],
                [this.t('config.bmHealthModalKeyHealthy', 'Healthy'), `${health.scorePercent()}%`],
                [this.t('config.bmHealthModalKeyAttention', 'Need attention'), String(attention), attention ? 'warn' : 'good'],
                [this.t('config.bmHealthModalKeyAvgScore', 'Average score'), avg === null ? '—' : String(avg)],
                [this.t('config.bmHealthModalKeyNeverOpened', 'Never opened'), String(never)],
                [this.t('config.bmHealthModalKeyPinned', 'Pinned'), String(Number(summary.pinnedCount) || 0)],
                [this.t('config.bmHealthModalKeyShortcuts', 'With a shortcut'), String(shortcuts)],
                [this.t('config.bmHealthModalKeyCopies', 'With a local copy'), String(copies)],
            ];
            return `<div class="bm-health-modal-span-all" data-bm-health-modal-extra>${this.bmHealthModalStatRow(stats, 'overview')}</div>`;
        },

        /** The lowest-scoring bookmarks and what is wrong with each: where to start. */
        renderBmHealthModalFixFirstCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const worst = issues.filter((i) => Number(i.score) < 90)
                .sort((a, b) => (Number(a.score) || 0) - (Number(b.score) || 0)).slice(0, 5);
            if (!worst.length) return '';
            const rows = worst.map((i) => {
                const why = health.reasonEntries?.(i)?.[0]?.label || '';
                const score = Number(i.score) || 0;
                return `<li><span title="${esc(i.url || '')}">${esc(i.name || health.formatUrlDisplay(i.url))}${why
                    ? `<small class="bm-health-modal-fix-why">${esc(why)}</small>` : ''}</span>
                    <b data-tone="${score < 50 ? 'bad' : 'warn'}">${score}</b></li>`;
            }).join('');
            return this.bmHealthModalCard('fix-first', this.t('config.bmHealthModalFixFirstTitle', 'Fix first'),
                `<ul class="bm-health-modal-fix-list">${rows}</ul>`).replace('<section ', '<section data-bm-health-modal-extra ');
        },

        /** Bars from a list of [label, count, tone]: one shape for the extra cards. */
        bmHealthModalCountBars(rows) {
            const esc = (v) => this.dash.escapeHtml(v);
            const max = Math.max(1, ...rows.map((r) => r[1]));
            return `<div class="bm-health-modal-bars">${rows.map(([label, count, tone]) => `<div class="bm-health-modal-bar-row is-static">
                <span class="bm-health-modal-bar-label" title="${esc(label)}">${esc(label)}</span>
                <span class="bm-health-modal-bar-track"><i${tone ? ` data-tone="${tone}"` : ''} style="width:${Math.round((count / max) * 100)}%"></i></span>
                <span class="bm-health-modal-bar-count">${count}</span></div>`).join('')}</div>`;
        },

        /** How long ago each bookmark was last checked. */
        renderBmHealthModalFreshnessCard(health) {
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            if (!issues.length) return '';
            const DAY = 86400000;
            const now = Date.now();
            const age = (i) => (Number(i.lastChecked) > 0 ? now - Number(i.lastChecked) : Infinity);
            const bands = [
                [this.t('config.bmHealthModalFreshToday', 'Last 24 hours'), (a) => a < DAY, 'good'],
                [this.t('config.bmHealthModalFreshWeek', 'Last 7 days'), (a) => a >= DAY && a < 7 * DAY, 'good'],
                [this.t('config.bmHealthModalFreshMonth', 'Last 30 days'), (a) => a >= 7 * DAY && a < 30 * DAY, 'warn'],
                [this.t('config.bmHealthModalFreshOlder', 'Older'), (a) => a >= 30 * DAY && a !== Infinity, 'bad'],
                [this.t('config.bmHealthModalFreshNever', 'Never checked'), (a) => a === Infinity, ''],
            ];
            const rows = bands.map(([label, test, tone]) => [label, issues.filter((i) => test(age(i))).length, tone]);
            return this.bmHealthModalCard('freshness', this.t('config.bmHealthModalFreshnessTitle', 'When last checked'),
                this.bmHealthModalCountBars(rows)).replace('<section ', '<section data-bm-health-modal-extra ');
        },

        /** How recently the bookmarks were opened at all. */
        renderBmHealthModalUsageCard(health) {
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            if (!issues.length) return '';
            const DAY = 86400000;
            const now = Date.now();
            const age = (i) => (Number(i.lastOpened) > 0 ? now - Number(i.lastOpened) : Infinity);
            const bands = [
                [this.t('config.bmHealthModalUsageWeek', 'Opened this week'), (a) => a < 7 * DAY, 'good'],
                [this.t('config.bmHealthModalUsageMonth', 'This month'), (a) => a >= 7 * DAY && a < 30 * DAY, 'good'],
                [this.t('config.bmHealthModalUsageQuarter', 'Last 90 days'), (a) => a >= 30 * DAY && a < 90 * DAY, 'warn'],
                [this.t('config.bmHealthModalUsageOlder', 'Longer ago'), (a) => a >= 90 * DAY && a !== Infinity, 'bad'],
                [this.t('config.bmHealthModalUsageNever', 'Never opened'), (a) => a === Infinity, ''],
            ];
            const rows = bands.map(([label, test, tone]) => [label, issues.filter((i) => test(age(i))).length, tone]);
            return this.bmHealthModalCard('usage', this.t('config.bmHealthModalUsageTitle', 'How often opened'),
                this.bmHealthModalCountBars(rows)).replace('<section ', '<section data-bm-health-modal-extra ');
        },

        /** Why the broken ones fail, grouped by the error they report. */
        renderBmHealthModalFailuresCard(health) {
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const counts = new Map();
            issues.filter((i) => i.lastError && health.matchesFilter(i, 'broken')).forEach((i) => {
                const key = String(i.lastError).split('\n')[0].trim().slice(0, 40);
                counts.set(key, (counts.get(key) || 0) + 1);
            });
            if (!counts.size) return '';
            const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, n]) => [label, n, 'bad']);
            return this.bmHealthModalCard('failures', this.t('config.bmHealthModalFailuresTitle', 'Why they fail'),
                this.bmHealthModalCountBars(rows)).replace('<section ', '<section data-bm-health-modal-extra ');
        },

        /* ── Monitors & trend ─────────────────────────────────────────────── */

        renderBmHealthModalMonitorsPane(health) {
            return `${this.renderBmHealthModalFleetStats(health)}<div class="bm-health-modal-wide-grid">
                ${this.renderBmHealthModalFleetCards(health)}
            </div>`;
        },

        /** The course: the collection over time, and every monitor per day under it. */
        renderBmHealthModalTrendPane(health) {
            const fleet = health.report?.fleet;
            const days = fleet && Number(fleet.monitors) ? this.renderBmHealthModalFleetDaysCard(health, fleet) : '';
            return `<div class="bm-health-modal-wide-grid is-trend">
                ${this.renderBmHealthModalTrendCard(health)}
                ${days}${days ? this.renderBmHealthModalWeekdayCard(health, fleet) : ''}
            </div>`;
        },

        /** A row of small figures: label under value, as many as fit a line. */
        bmHealthModalStatRow(stats, key) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `<div class="bm-health-modal-stats" data-bm-health-modal-stats="${esc(key)}">${stats.map(([label, value, tone]) => `<div class="bm-health-modal-tile">
                <b${tone ? ` data-tone="${tone}"` : ''}>${esc(value)}</b><span title="${esc(label)}">${esc(label)}</span></div>`).join('')}</div>`;
        },

        /** A short list, label and value a line: for the side of a chart. */
        bmHealthModalStatList(stats, key) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `<dl class="bm-health-modal-stat-list" data-bm-health-modal-stats="${esc(key)}">${stats.map(([label, value, tone]) => `<div>
                <dt>${esc(label)}</dt><dd${tone ? ` data-tone="${tone}"` : ''}>${esc(value)}</dd></div>`).join('')}</dl>`;
        },

        /** Monitors at a glance: now, and what the month's outages add up to. */
        renderBmHealthModalFleetStats(health) {
            const fleet = health.report?.fleet;
            if (!fleet || !Number(fleet.monitors)) return '';
            const now = Date.now();
            const incidents = Array.isArray(fleet.incidents) ? fleet.incidents : [];
            const lasted = (i) => (i.ongoing ? Math.max(0, now - (Number(i.start) || now)) : Number(i.durationMs) || 0);
            const totals = Array.isArray(fleet.incidentTotals) ? fleet.incidentTotals : [];
            const outages = Number(fleet.totalIncidents) || incidents.length;
            const downMs = totals.length ? totals.reduce((a, t) => a + (Number(t.downMs) || 0), 0)
                : incidents.reduce((a, i) => a + lasted(i), 0);
            const longest = incidents.reduce((a, i) => Math.max(a, lasted(i)), 0);
            const topCount = totals.length ? totals.reduce((a, t) => (!a || (Number(t.count) || 0) > (Number(a.count) || 0) ? t : a), null) : null;
            const noData = health.t('dashboard.healthStatsNoData', 'no data');
            const down = Number(fleet.downNow) || 0;
            const avg = Number(fleet.avgResponseMs) || 0;
            const stats = [
                [this.t('config.bmHealthModalStatDownNow', 'Down now'), `${down} / ${fleet.monitors}`, down ? 'bad' : 'good'],
                [this.t('config.bmHealthModalStatAvgResponse', 'Average response, 24 hours'), avg ? `${avg} ms` : noData],
                [this.t('config.bmHealthModalStatOutages', 'Outages, 30 days'), String(outages), outages ? 'warn' : 'good'],
                [this.t('config.bmHealthModalStatDowntime', 'Total downtime'), outages ? health.formatDuration(downMs) : '0'],
                [this.t('config.bmHealthModalStatLongest', 'Longest outage'), longest ? health.formatDuration(longest) : '—'],
            ];
            if (topCount && Number(topCount.count) > 1) {
                stats.push([this.t('config.bmHealthModalStatMostOutages', 'Most outages'), topCount.name || health.formatUrlDisplay(topCount.url)]);
            }
            return this.bmHealthModalStatRow(stats, 'fleet');
        },

        /**
         * The collection over 90 days, one point a day, in any of the series
         * the report keeps: the chart the Health view drew, full width here.
         */
        renderBmHealthModalTrendCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const allSeries = global.DashboardHealth?.TREND_SERIES || [];
            const active = allSeries.find((s) => s.id === (this._bmTrendSeries || 'healthy')) || allSeries[0];
            const points = health.trendPoints();
            const pills = allSeries.map((s) => `<button type="button" class="bm-health-modal-series${s.id === active?.id ? ' is-on' : ''}"
                aria-pressed="${s.id === active?.id ? 'true' : 'false'}" data-bm-health-trend-series="${esc(s.id)}">${esc(health.t(`dashboard.${s.labelKey}`, s.fallback))}</button>`).join('');
            const values = active ? points.map((p) => health.trendPercent(p, active)) : [];
            const known = values.filter((v) => v !== null);
            let chart;
            if (known.length < 2) {
                chart = `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalTrendEmpty', 'A course takes two days of reports; there is one so far.'))}</p>`;
            } else {
                const w = 640;
                const h = 150;
                const pad = 12;
                const max = active.mode === 'percent' ? 100 : Math.max(1, ...known) * 1.1;
                const step = (w - pad * 2) / Math.max(1, values.length - 1);
                const x = (i) => pad + i * step;
                const y = (v) => h - pad - (v / max) * (h - pad * 2);
                const segments = [];
                let current = [];
                values.forEach((v, i) => {
                    if (v === null) {
                        if (current.length > 1) segments.push(current);
                        current = [];
                        return;
                    }
                    current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
                });
                if (current.length > 1) segments.push(current);
                const unit = active.mode === 'percent' ? '%' : '';
                const dots = values.map((v, i) => (v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="6" class="bm-health-modal-trend-hit"
                    data-tip="${esc(`${new Date(points[i].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${v}${unit}`)}"><title>${esc(`${new Date(points[i].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${v}${unit}`)}</title></circle>`)).join('');
                const first = points[0]?.t ? new Date(points[0].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
                const last = points[points.length - 1]?.t ? new Date(points[points.length - 1].t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
                // The plain chart, until uPlot has arrived and is mounted over it
                // (mountBmTrendChart) -- and for good when it cannot be.
                chart = `<div class="bm-health-modal-trend-plot" data-bm-trend-plot><svg class="bm-health-modal-trend-chart" viewBox="0 0 ${w} ${h + 16}" role="img"
                        aria-label="${esc(`${health.t(`dashboard.${active.labelKey}`, active.fallback)}: ${known[0]}${unit} → ${known[known.length - 1]}${unit}`)}">
                    <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" class="is-axis"></line>
                    ${segments.map((pts) => `<polyline points="${pts.join(' ')}" class="is-line"></polyline>`).join('')}
                    ${dots}
                    <text x="${pad}" y="${h + 12}" class="is-label">${esc(first)}</text>
                    <text x="${w - pad}" y="${h + 12}" text-anchor="end" class="is-label">${esc(last)}</text>
                    <text x="${w - pad}" y="${pad + 2}" text-anchor="end" class="is-label">${esc(`${Math.round(max)}${unit}`)}</text>
                </svg></div>`;
            }
            let trendStats = '';
            if (known.length >= 2) {
                const unit = active.mode === 'percent' ? '%' : '';
                const round = (v) => Math.round(v * 10) / 10;
                const signed = (v) => `${v > 0 ? '+' : ''}${round(v)}${unit}`;
                const steps = known.slice(1).map((v, i) => v - known[i]);
                const gain = Math.max(0, ...steps);
                const drop = Math.min(0, ...steps);
                const up = steps.filter((d) => d > 0).length;
                const down = steps.filter((d) => d < 0).length;
                const mean = known.reduce((a, v) => a + v, 0) / known.length;
                const spread = Math.sqrt(known.reduce((a, v) => a + (v - mean) ** 2, 0) / known.length);
                // Better is up for a share of healthy, down for a count of faults.
                const better = (d) => (active.mode === 'percent' ? d > 0 : d < 0);
                const delta = known[known.length - 1] - known[0];
                const tone = (d) => (d === 0 ? '' : better(d) ? 'good' : 'bad');
                trendStats = this.bmHealthModalStatList([
                    [this.t('config.bmHealthModalStatNow', 'Now'), `${known[known.length - 1]}${unit}`],
                    [this.t('config.bmHealthModalStatChange', 'Change over the period'), signed(delta), tone(delta)],
                    [this.t('config.bmHealthModalStatLowest', 'Lowest'), `${Math.min(...known)}${unit}`],
                    [this.t('config.bmHealthModalStatHighest', 'Highest'), `${Math.max(...known)}${unit}`],
                    [this.t('config.bmHealthModalStatAverage', 'Average'), `${round(mean)}${unit}`],
                    [this.t('config.bmHealthModalStatSpread', 'Spread (std. dev.)'), `${round(spread)}${unit}`],
                    [this.t('config.bmHealthModalStatDaysUpDown', 'Days up / down'), `${up} / ${down}`],
                    [this.t('config.bmHealthModalStatBiggestGain', 'Biggest rise in a day'), gain ? signed(gain) : '—'],
                    [this.t('config.bmHealthModalStatBiggestDrop', 'Biggest fall in a day'), drop ? signed(drop) : '—'],
                ], 'trend');
            }
            const title = this.t('config.bmHealthModalTrendTitle', 'Over time ({days} days)').replace('{days}', String(points.length || 0));
            return `<section class="bm-health-modal-card is-wide" data-bm-health-modal-card="trend">
                <h3 class="bm-health-modal-card-title">${esc(title)}</h3>
                <div class="bm-health-modal-series-row">${pills}</div>
                <div class="bm-health-modal-trend-body${trendStats ? ' has-side' : ''}">
                    <div class="bm-health-modal-trend-main">${chart}</div>
                    ${trendStats}
                </div>
            </section>`;
        },

        /** Every monitor together: uptime, the least available, the slowing and the outages. */
        renderBmHealthModalFleetCards(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const fleet = health.report?.fleet;
            if (!fleet || !Number(fleet.monitors)) {
                return this.bmHealthModalCard('fleet', this.t('config.bmHealthModalFleetTitle', 'Monitors'),
                    `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalFleetNone',
                        'Nothing is monitored yet. Set a bookmark to Monitor to see its uptime here.'))}</p>`);
            }
            const noData = health.t('dashboard.healthStatsNoData', 'no data');
            const bar = (ratio) => `<span class="bm-health-modal-bar-track"><i
                data-tone="${ratio >= 0.999 ? 'good' : ratio >= 0.95 ? 'warn' : 'bad'}" style="width:${Math.max(2, Math.round((ratio || 0) * 100))}%"></i></span>`;
            const windows = [
                [health.t('dashboard.healthStatsUptime24h', '24 hours'), fleet.uptime24h],
                [health.t('dashboard.healthStatsUptime7d', '7 days'), fleet.uptime7d],
                [health.t('dashboard.healthStatsUptime30d', '30 days'), fleet.uptime30d],
            ].map(([label, win]) => `<div class="bm-health-modal-bar-row is-static">
                <span class="bm-health-modal-bar-label">${esc(label)}</span>${bar(Number(win?.ratio))}
                <span>${esc(health.formatUptime(win) || noData)}</span></div>`).join('');
            const uptime = this.bmHealthModalCard('fleet-uptime',
                this.t('config.bmHealthModalFleetUptime', 'Uptime, all {count} monitors').replace('{count}', String(fleet.monitors)),
                `<div class="bm-health-modal-bars">${windows}</div>`);

            const worst = (Array.isArray(fleet.worst) ? fleet.worst : []).slice(0, 6);
            const worstRows = worst.map((m) => `<div class="bm-health-modal-bar-row is-static">
                <span class="bm-health-modal-bar-label" title="${esc(m.url || '')}">${esc(m.name || health.formatUrlDisplay(m.url))}</span>${bar(Number(m.ratio))}
                <span>${esc(health.formatUptime({ ratio: m.ratio, samples: m.samples }) || '—')}</span></div>`).join('');
            const least = this.bmHealthModalCard('fleet-worst', this.t('config.bmHealthModalFleetWorst', 'Least available (7 days)'),
                worstRows ? `<div class="bm-health-modal-bars">${worstRows}</div>`
                    : `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalFleetAllUp', 'Every monitor answered every time.'))}</p>`);

            const slower = (Array.isArray(fleet.slower) ? fleet.slower : []).slice(0, 6);
            const slowerRows = slower.map((m) => `<li><span title="${esc(m.url || '')}">${esc(m.name || health.formatUrlDisplay(m.url))}</span>
                <span>${esc(`${Math.round(Number(m.baselineMs) || 0)} → ${Math.round(Number(m.recentMs) || 0)} ms`)}</span>
                <b class="is-down">+${esc(String(Math.round(Number(m.changePct) || 0)))}%</b></li>`).join('');
            const slowing = this.bmHealthModalCard('fleet-slower', this.t('config.bmHealthModalFleetSlower', 'Slower than last week'),
                slowerRows ? `<ul class="bm-health-modal-monitor-list is-three">${slowerRows}</ul>`
                    : `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalFleetNoneSlower', 'Nothing has slowed down.'))}</p>`);

            const outages = this.renderBmHealthModalOutagesCard(health, fleet);
            return `${uptime}${least}${slowing}${outages}`;
        },

        /*
         * Every monitor, per day: the course behind the 24h/7d/30d figures above.
         * The day's uptime as a bar in the colour of its share, the day's mean
         * response as a line on its own axis. Drawn plain here and with uPlot by
         * mountBmFleetDaysChart; the series is kept for that in _bmFleetDays.
         */
        renderBmHealthModalFleetDaysCard(health, fleet) {
            const esc = (v) => this.dash.escapeHtml(v);
            const DAY = 86400000;
            const byDay = new Map((Array.isArray(fleet.days) ? fleet.days : [])
                .map((d) => [Number(d.d), { n: Number(d.n) || 0, u: Number(d.u) || 0, p: Number(d.p) || 0 }]));
            const first = new Date(Date.now() - 29 * DAY);
            first.setUTCHours(0, 0, 0, 0);
            const days = Array.from({ length: 30 }, (_, i) => {
                const at = first.getTime() + i * DAY;
                const d = byDay.get(at);
                return { at, n: d?.n || 0, ratio: d?.n ? d.u / d.n : null, ms: d?.p || null,
                    label: new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
            });
            this._bmFleetDays = days;
            const title = this.t('config.bmHealthModalFleetDays', 'Every monitor, per day (30 days)');
            const known = days.filter((d) => d.ratio != null);
            if (known.length < 2) {
                return `<section class="bm-health-modal-card is-wide" data-bm-health-modal-card="fleet-days">
                    <h3 class="bm-health-modal-card-title">${esc(title)}</h3>
                    <p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalFleetDaysNone', 'Not enough days of checks yet.'))}</p>
                </section>`;
            }
            const w = 600;
            const h = 60;
            const step = w / days.length;
            const bars = days.map((d, i) => {
                if (d.ratio == null) return '';
                const tone = d.ratio >= 0.999 ? 'good' : d.ratio >= 0.95 ? 'warn' : 'bad';
                const height = Math.max(2, Math.round(d.ratio * h));
                return `<rect x="${(i * step + step * 0.15).toFixed(1)}" y="${h - height}" width="${(step * 0.7).toFixed(1)}" height="${height}"
                    data-tone="${tone}" data-tip="${esc(this.bmFleetDayText(d))}"></rect>`;
            }).join('');
            const summary = this.bmFleetDaysSummary(days);
            const checks = known.reduce((a, d) => a + d.n, 0);
            const upTotal = known.reduce((a, d) => a + d.ratio * d.n, 0);
            const timed = known.filter((d) => d.ms);
            const worstDay = known.reduce((a, d) => (!a || d.ratio < a.ratio ? d : a), null);
            const slowDay = timed.reduce((a, d) => (!a || d.ms > a.ms ? d : a), null);
            const quiet = known.filter((d) => d.ratio < 0.999).length;
            const dayStats = this.bmHealthModalStatRow([
                [this.t('config.bmHealthModalStatChecks', 'Checks'), checks.toLocaleString()],
                [this.t('config.bmHealthModalStatDaysUp', 'Days without a miss'), `${known.length - quiet} / ${known.length}`, quiet ? 'warn' : 'good'],
                [this.t('config.bmHealthModalStatWorstDay', 'Lowest day'), `${Math.round(worstDay.ratio * 1000) / 10}% · ${worstDay.label}`],
                [this.t('config.bmHealthModalStatSlowestDay', 'Slowest day'), slowDay ? `${slowDay.ms} ms · ${slowDay.label}` : '—'],
                [this.t('config.bmHealthModalStatDayUptime', 'Uptime, 30 days'), `${Math.round((upTotal / (checks || 1)) * 1000) / 10}%`],
            ], 'fleet-days');
            return `<section class="bm-health-modal-card is-wide" data-bm-health-modal-card="fleet-days">
                <h3 class="bm-health-modal-card-title">${esc(title)}</h3>
                ${dayStats}
                <div class="bm-health-modal-fleet-days-plot" data-bm-fleet-days-plot>
                    <svg class="bm-health-modal-fleet-days" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(summary)}">${bars}</svg>
                </div>
            </section>`;
        },

        /** Uptime by day of the week, over the days the chart beside it shows. */
        renderBmHealthModalWeekdayCard(health, fleet) {
            const esc = (v) => this.dash.escapeHtml(v);
            const sums = Array.from({ length: 7 }, () => ({ n: 0, u: 0, p: 0, pn: 0 }));
            (Array.isArray(fleet.days) ? fleet.days : []).forEach((d) => {
                const slot = sums[new Date(Number(d.d)).getUTCDay()];
                slot.n += Number(d.n) || 0;
                slot.u += Number(d.u) || 0;
                if (Number(d.p)) { slot.p += Number(d.p); slot.pn += 1; }
            });
            if (!sums.some((x) => x.n)) return '';
            // Monday first, labelled by the locale: 5 Oct 2026 is a Monday.
            const rows = [1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const x = sums[dow];
                const ratio = x.n ? x.u / x.n : null;
                const label = new Date(Date.UTC(2026, 9, 4 + dow)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' });
                const tone = ratio === null ? '' : ratio >= 0.999 ? 'good' : ratio >= 0.95 ? 'warn' : 'bad';
                const text = ratio === null ? '—' : `${Math.round(ratio * 1000) / 10}%${x.pn ? ` · ${Math.round(x.p / x.pn)} ms` : ''}`;
                return `<div class="bm-health-modal-bar-row is-static"><span class="bm-health-modal-bar-label">${esc(label)}</span>
                    <span class="bm-health-modal-bar-track"><i${tone ? ` data-tone="${tone}"` : ''} style="width:${ratio === null ? 0 : Math.max(2, Math.round(ratio * 100))}%"></i></span>
                    <span class="bm-health-modal-bar-count">${esc(text)}</span></div>`;
            }).join('');
            return this.bmHealthModalCard('weekday', this.t('config.bmHealthModalWeekdayTitle', 'Uptime by weekday'),
                `<div class="bm-health-modal-bars">${rows}</div>`);
        },

        /** A day as the tooltip, the readout and the table say it. */
        bmFleetDayText(d) {
            if (d.ratio == null) return `${d.label}: ${this.t('config.bmLargeTipNoChecks', 'no checks')}`;
            return [`${d.label}: ${Math.round(d.ratio * 1000) / 10}%`, d.ms ? `${d.ms} ms` : '',
                `${d.n.toLocaleString()} ${this.t('config.bmLargeTipChecks', 'checks')}`].filter(Boolean).join(' · ');
        },

        bmFleetDaysSummary(days) {
            const checked = days.filter((d) => d.ratio != null);
            const n = checked.reduce((a, d) => a + d.n, 0);
            const up = checked.reduce((a, d) => a + d.ratio * d.n, 0);
            const timed = checked.filter((d) => d.ms);
            const ms = timed.length ? Math.round(timed.reduce((a, d) => a + d.ms, 0) / timed.length) : 0;
            const worst = checked.reduce((a, d) => (!a || d.ratio < a.ratio ? d : a), null);
            return this.t('config.bmHealthModalFleetDaysSummary', 'Every monitor per day: {up} uptime, {ms} ms on average; lowest {worst} on {day}')
                .replace('{up}', `${n ? Math.round((up / n) * 1000) / 10 : 0}%`)
                .replace('{ms}', String(ms))
                .replace('{worst}', `${Math.round((worst?.ratio || 0) * 1000) / 10}%`)
                .replace('{day}', worst?.label || '');
        },

        /** The per-day chart with uPlot, over the plain bars; they stay if it cannot load. */
        async mountBmFleetDaysChart() {
            const host = document.querySelector('#app-modal.show [data-bm-fleet-days-plot]');
            const days = this._bmFleetDays;
            if (!host || !days) return;
            try {
                if (!global.NdChart) {
                    await global.LazyScript.loadScriptOnce('js/shared/nd-chart.js', 'ndChart',
                        () => typeof global.NdChart !== 'undefined');
                }
                await global.NdChart.load();
            } catch {
                return;
            }
            if (!host.isConnected) return;
            const low = Math.min(...days.filter((d) => d.ratio != null).map((d) => d.ratio * 100));
            // 90-100% unless a day fell below it: the differences that matter are
            // a few tenths, which a 0-100 axis flattens into one height.
            const floor = low >= 90 ? 90 : Math.max(0, Math.floor(low / 10) * 10);
            const toneOf = (d) => (d.ratio == null ? null : d.ratio >= 0.999 ? 'good' : d.ratio >= 0.95 ? 'warn' : 'bad');
            const tones = [['good', '--accent-success'], ['warn', '--accent-warning'], ['bad', '--accent-error']];
            const maxMs = Math.max(1, ...days.map((d) => d.ms || 0));
            const half = 43200;
            this._bmFleetDaysChart?.destroy();
            this._bmFleetDaysChart = global.NdChart.chart(host, {
                x: days.map((d) => (d.at + 43200000) / 1000),
                series: [
                    ...tones.map(([name, color]) => ({ label: name, bars: true, color,
                        values: days.map((d) => (toneOf(d) === name ? Math.max(floor + 0.4, d.ratio * 100) : null)) })),
                    { label: this.t('config.bmHealthModalFleetDaysResponse', 'response'), values: days.map((d) => d.ms),
                        color: '--accent-primary', fill: false, scale: 'ms' },
                ],
                text: (i) => this.bmFleetDayText(days[i]),
                format: { x: 'date', tick: (v) => `${Math.round(v * 10) / 10}%` },
                scales: {
                    x: { range: (u, min, max) => [min - half, max + half] },
                    y: { range: () => [floor, 100] },
                    ms: { range: () => [0, maxMs * 1.15] },
                },
                axes: { ms: { format: (v) => `${Math.round(v)} ms`, width: 58 } },
                summary: this.bmFleetDaysSummary(days),
                height: 100,
                axisWidth: 50,
            });
        },

        /*
         * Outages of the last 30 days, read per monitor.
         *
         * A list of twenty-six lines, each a name and a run of date, duration
         * and reason, said one thing badly: which monitors keep going down,
         * and whether they go down together. So the card says that first --
         * per monitor how often and for how long in all -- and then shows it:
         * one lane per monitor across the thirty days, an outage as a bar as
         * long as it lasted, so two that fall at once line up. The list is
         * still there, by day, behind "Show list".
         */
        renderBmHealthModalOutagesCard(health, fleet) {
            const esc = (v) => this.dash.escapeHtml(v);
            const incidents = Array.isArray(fleet.incidents) ? fleet.incidents : [];
            const total = Number(fleet.totalIncidents) || incidents.length;
            const title = this.t('config.bmHealthModalFleetOutages', 'Outages ({count})').replace('{count}', String(total));
            if (!incidents.length) {
                return this.bmHealthModalCard('fleet-outages', title,
                    `<p class="bm-health-modal-empty">${esc(health.t('dashboard.healthStatsNoIncidents', 'No outages recorded.'))}</p>`);
            }
            const now = Date.now();
            const span = 30 * 86400000;
            const start = now - span;
            const lasted = (i) => (i.ongoing ? Math.max(0, now - (Number(i.start) || now)) : Number(i.durationMs) || 0);
            const tone = (ms) => (ms >= 2 * 3600000 ? 'bad' : 'warn');
            const nameOf = (i) => i.name || health.formatUrlDisplay(i.url);

            const byMonitor = new Map();
            incidents.forEach((i) => {
                const key = i.url || nameOf(i);
                const entry = byMonitor.get(key) || { name: nameOf(i), url: i.url || '', count: 0, down: 0, list: [] };
                entry.count += 1;
                entry.down += lasted(i);
                entry.list.push(i);
                byMonitor.set(key, entry);
            });
            // Counts and downtime over every outage, from the server; the list
            // above is the 25 newest and came up short once there were more.
            (Array.isArray(fleet.incidentTotals) ? fleet.incidentTotals : []).forEach((tot) => {
                const entry = byMonitor.get(tot.url || tot.name);
                if (entry) {
                    entry.count = Number(tot.count) || entry.count;
                    entry.down = Math.max(entry.down, Number(tot.downMs) || 0);
                }
            });
            const monitors = [...byMonitor.values()].sort((a, b) => b.down - a.down || b.count - a.count);
            const LANES = 6;

            const summary = monitors.map((m) => `<span class="bm-health-outage-name" title="${esc(m.url)}">${esc(m.name)}</span>
                <span class="bm-health-outage-count">${esc(`${m.count}×`)}</span>
                <span class="bm-health-outage-dur" data-tone="${tone(m.down)}">${esc(health.formatDuration(m.down))}</span>`).join('');

            const pct = (t) => Math.max(0, Math.min(100, ((t - start) / span) * 100));
            const lanes = monitors.slice(0, LANES).map((m) => `<div class="bm-health-outage-lane">
                <span class="bm-health-outage-lane-name" title="${esc(m.url)}">${esc(m.name)}</span>
                <span class="bm-health-outage-track">${m.list.map((i) => {
                    const from = Number(i.start) || now;
                    const left = pct(from);
                    const width = Math.max(0.6, pct(from + lasted(i)) - left);
                    const when = new Date(from).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                    const what = [when, i.ongoing ? health.t('dashboard.healthFleetOngoing', 'ongoing') : health.formatDuration(lasted(i)), i.reason || '']
                        .filter(Boolean).join(' · ');
                    return `<i style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" data-tone="${tone(lasted(i))}" title="${esc(what)}"></i>`;
                }).join('')}</span>
            </div>`).join('');
            const day = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            const timeline = `<div class="bm-health-outage-timeline" role="img"
                    aria-label="${esc(this.t('config.bmHealthModalOutageTimeline', 'Outages per monitor over the last 30 days'))}">
                    ${lanes}
                    <div class="bm-health-outage-axis"><span>${esc(day(start))}</span><span>${esc(day(now))}</span></div>
                </div>`;
            const otherLanes = monitors.length > LANES
                ? `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalOutageMoreMonitors', '{n} more monitors in the list').replace('{n}', String(monitors.length - LANES)))}</p>` : '';

            // The list, newest first and by day: when, which, how long, why.
            let lastDay = '';
            const rows = incidents.map((i) => {
                const from = Number(i.start) || now;
                const label = new Date(from).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
                const head = label !== lastDay ? `<li class="bm-health-outage-day">${esc(label)}</li>` : '';
                lastDay = label;
                return `${head}<li class="bm-health-outage-row">
                    <span class="bm-health-outage-time">${esc(new Date(from).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</span>
                    <span class="bm-health-outage-name" title="${esc(i.url || '')}">${esc(nameOf(i))}<span class="bm-health-outage-reason">${esc(i.reason || '')}</span></span>
                    <span class="bm-health-outage-dur" data-tone="${tone(lasted(i))}">${esc(i.ongoing
                        ? health.t('dashboard.healthFleetOngoing', 'ongoing') : health.formatDuration(lasted(i)))}</span>
                </li>`;
            }).join('');
            const more = total > incidents.length
                ? `<p class="bm-health-modal-empty">${esc(this.t('config.bmHealthModalFleetMoreOutages', '{n} more in the last 30 days').replace('{n}', String(total - incidents.length)))}</p>` : '';
            const list = `<details class="bm-health-outage-details" data-bm-health-outage-list>
                <summary>${esc(this.t('config.bmHealthModalOutageShowList', 'Show list ({count})').replace('{count}', String(incidents.length)))}</summary>
                <ul class="bm-health-outage-list">${rows}</ul>${more}
            </details>`;

            return this.bmHealthModalCard('fleet-outages', title,
                `<div class="bm-health-outage-summary">${summary}</div>${timeline}${otherLanes}${list}`);
        },

        /** Show one tab, in place, and remember it for the next opening. */        /** Show one tab, in place, and remember it for the next opening. */
        setBmHealthModalTab(tab) {
            const root = document.getElementById('modal-text');
            if (!root) return;
            root.querySelectorAll('[data-bm-health-modal-tab]').forEach((btn) => {
                const on = btn.getAttribute('data-bm-health-modal-tab') === tab;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
                btn.tabIndex = on ? 0 : -1;
            });
            root.querySelectorAll('[data-bm-health-modal-pane]').forEach((pane) => {
                pane.hidden = pane.getAttribute('data-bm-health-modal-pane') !== tab;
            });
            try { global.localStorage?.setItem('nextdash.bm.healthModalTab', tab); } catch { /* private mode */ }
            this.fitBmHealthModal();
        },

        bmHealthModalCard(key, title, body) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `<section class="bm-health-modal-card" data-bm-health-modal-card="${esc(key)}">
                <h3 class="bm-health-modal-card-title">${esc(title)}</h3>
                ${body}
            </section>`;
        },

        renderBmHealthModalSubtitle(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const total = Number(health.report?.summary?.totalBookmarks) || 0;
            const pages = new Set((health.report?.issues || []).map((i) => i.pageId)).size;
            const age = health.reportAgeText();
            const parts = [
                this.t('config.bmHealthModalTotal', '{n} bookmarks').replace('{n}', String(total)),
                pages ? this.t('config.bmHealthModalPagesCount', 'on {n} pages').replace('{n}', String(pages)) : '',
                age ? this.t('config.bmHealthModalUpdated', 'updated {age}').replace('{age}', age) : '',
            ].filter(Boolean);
            return `<p class="bm-health-modal-subtitle">${esc(parts.join(' · '))}</p>`;
        },

        /*
         * 1. Score over time -- the same healthy-share history the rail's
         * sparkline draws (renderBmHealthSummary → health.shellSummary()),
         * just full size with the two deltas and the low point the rail has
         * no room for.
         */
        renderBmHealthModalScoreCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const title = this.t('config.bmHealthModalScoreTitle', 'Score over time');
            const today = health.scorePercent();
            const bigNumber = `<span class="bm-health-modal-score-big" data-bm-health-modal-count="score">${today}%</span>`;

            const points = health.trendPoints();
            const series = (global.DashboardHealth?.TREND_SERIES || []).find((s) => s.id === 'healthy');
            const known = series
                ? points.map((p, i) => ({ i, v: health.trendPercent(p, series) })).filter((e) => e.v !== null)
                : [];
            if (known.length < 2) {
                return this.bmHealthModalCard('score', title,
                    `<div class="bm-health-modal-score-head">${bigNumber}</div>`);
            }

            const last = known[known.length - 1];
            const dayMs = 86400000;
            const findAgo = (days) => [...known].reverse()
                .find((e) => points[last.i].t - points[e.i].t >= days * dayMs) || known[0];
            const delta7 = last.v - findAgo(7).v;
            const delta30 = last.v - findAgo(30).v;
            const lowest = known.reduce((min, e) => (e.v < min.v ? e : min), known[0]);

            const w = 420;
            const h = 130;
            const padY = 10;
            const values = points.map((p) => health.trendPercent(p, series));
            const step = w / Math.max(1, values.length - 1);
            const yFor = (v) => (h - padY - (v / 100) * (h - padY * 2)).toFixed(1);
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
            const path = segments.map((pts) => `<polyline points="${pts.join(' ')}" fill="none"
                stroke="var(--accent-primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
            const lowDot = `<circle cx="${(lowest.i * step).toFixed(1)}" cy="${yFor(lowest.v)}" r="3.5" fill="var(--accent-error)"/>`;
            const endDot = `<circle cx="${(last.i * step).toFixed(1)}" cy="${yFor(last.v)}" r="3.5" fill="var(--accent-primary)"/>`;
            const chartLabel = this.t('config.bmHealthModalScoreChartLabel',
                'Collection score over the last {days} days, from {first}% to {last}%')
                .replace('{days}', String(points.length))
                .replace('{first}', String(known[0].v))
                .replace('{last}', String(last.v));
            // The plain chart, until mountBmScoreChart draws it with uPlot.
            const svg = `<div class="bm-health-modal-score-plot" data-bm-score-plot><svg class="bm-health-modal-score-chart" viewBox="0 0 ${w} ${h}"
                preserveAspectRatio="none" role="img" aria-label="${esc(chartLabel)}">${path}${lowDot}${endDot}</svg></div>`;
            this._bmScoreChartData = { points, values, lowest: lowest.i, label: chartLabel };

            const deltaText = (d) => (d > 0 ? `▲ ${d}` : (d < 0 ? `▼ ${Math.abs(d)}` : '–'));
            const deltaClass = (d) => (d < 0 ? 'is-down' : (d > 0 ? 'is-up' : ''));
            const lowestDate = points[lowest.i]?.t ? new Date(points[lowest.i].t).toLocaleDateString() : '';
            const body = `
                <div class="bm-health-modal-score-head">
                    ${bigNumber}
                    <div class="bm-health-modal-score-deltas">
                        <span>${esc(this.t('config.bmHealthModalChange7d', '7 days'))}
                            <b class="${deltaClass(delta7)}">${esc(deltaText(delta7))}</b></span>
                        <span>${esc(this.t('config.bmHealthModalChange30d', '30 days'))}
                            <b class="${deltaClass(delta30)}">${esc(deltaText(delta30))}</b></span>
                        <span>${esc(this.t('config.bmHealthModalLowest', 'lowest'))}
                            <b class="is-down">${lowest.v}%</b>
                            ${lowestDate ? esc(this.t('config.bmHealthModalLowestOn', 'on {date}').replace('{date}', lowestDate)) : ''}</span>
                    </div>
                </div>
                ${svg}`;
            return this.bmHealthModalCard('score', title, body);
        },

        /*
         * 2. Where the bookmarks stand -- one stacked bar across the whole
         * collection. "Down" has no bmHealthFilter of its own: a monitor
         * being unreachable right now is a live-fleet fact (monitorGroupFor),
         * not one of the report's filter flags, so its count is shown, not
         * linked.
         */
        renderBmHealthModalStandCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const summary = health.report?.summary || {};
            const total = Number(summary.totalBookmarks) || 0;
            const segs = [
                { key: 'healthy', label: this.bmHealthFilterLabel('healthy'), count: Number(summary.healthyCount) || 0, tone: 'good', filterable: true },
                { key: 'broken', label: this.bmHealthFilterLabel('broken'), count: Number(summary.brokenCount) || 0, tone: 'bad', filterable: true },
                { key: 'down', label: health.t('dashboard.healthGroupDown', 'Down'), count: Number(summary.monitorDownCount) || 0, tone: 'warn', filterable: false },
                { key: 'unchecked', label: this.bmHealthFilterLabel('unchecked'), count: Number(summary.uncheckedCount) || 0, tone: '', filterable: true },
                { key: 'ignored', label: health.t('dashboard.healthFilterIgnored', 'Ignored'), count: Number(summary.ignoredCount) || 0, tone: '', filterable: true },
            ];
            const bar = segs.map((seg) => {
                const flex = seg.count > 0 ? seg.count : 0.0001;
                const title = esc(`${seg.label} (${seg.count})`);
                return seg.filterable
                    ? `<button type="button" class="bm-health-modal-stack-seg" data-tone="${esc(seg.tone)}"
                        style="flex:${flex} 0 0" data-bm-health-modal-filter="${esc(seg.key)}" title="${title}"></button>`
                    : `<span class="bm-health-modal-stack-seg is-static" data-tone="${esc(seg.tone)}"
                        style="flex:${flex} 0 0" title="${title}"></span>`;
            }).join('');
            const legend = segs.map((seg) => {
                const inner = `<i class="bm-health-modal-legend-dot" data-tone="${esc(seg.tone)}" aria-hidden="true"></i>
                    <span class="bm-health-modal-legend-label">${esc(seg.label)}</span>
                    <b class="bm-health-modal-legend-count" data-bm-health-modal-count="${esc(seg.key)}">${seg.count}</b>`;
                return `<li class="bm-health-modal-legend-item">${seg.filterable
                    ? `<button type="button" class="bm-health-modal-legend-btn" data-bm-health-modal-filter="${esc(seg.key)}">${inner}</button>`
                    : `<span class="bm-health-modal-legend-btn is-static">${inner}</span>`}</li>`;
            }).join('');
            const barLabel = this.t('config.bmHealthModalStandLabel', 'Where the {total} bookmarks stand')
                .replace('{total}', String(total));
            return this.bmHealthModalCard('stand', this.t('config.bmHealthModalStandTitle', 'Where the bookmarks stand'), `
                <div class="bm-health-modal-stack" role="img" aria-label="${esc(barLabel)}">${bar}</div>
                <ul class="bm-health-modal-legend">${legend}</ul>`);
        },

        /** 3. What is wrong, by kind -- one bar per condition, worst first. */
        renderBmHealthModalKindCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const total = Number(health.report?.summary?.totalBookmarks) || 0;
            const rows = KIND_FILTERS
                .map((key) => ({ key, label: this.bmHealthFilterLabel(key), count: health.filterCount(key) }))
                .sort((a, b) => b.count - a.count);
            const body = rows.map((row) => {
                const pct = total ? Math.round((row.count / total) * 100) : 0;
                return `<button type="button" class="bm-health-modal-bar-row" data-bm-health-modal-filter="${esc(row.key)}">
                    <span class="bm-health-modal-bar-label">${esc(row.label)}</span>
                    <span class="bm-health-modal-bar-track"><i style="width:${pct}%"></i></span>
                    <span class="bm-health-modal-bar-count" data-bm-health-modal-count="${esc(row.key)}">${row.count}</span>
                </button>`;
            }).join('');
            return this.bmHealthModalCard('kind', this.t('config.bmHealthModalKindTitle', 'What is wrong, by kind'),
                `<div class="bm-health-modal-bars">${body}</div>`);
        },

        /** 4. Score distribution -- a histogram of every issue's own score. */
        renderBmHealthModalDistributionCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const bands = [
                { key: 'b90', label: '90–100', test: (n) => n >= 90 },
                { key: 'b70', label: '70–89', test: (n) => n >= 70 && n < 90 },
                { key: 'b50', label: '50–69', test: (n) => n >= 50 && n < 70 },
                { key: 'b0', label: this.t('config.bmHealthModalBandLow', 'Below 50'), test: (n) => n < 50 },
            ];
            const counts = bands.map((band) => issues.filter((i) => band.test(Number(i.score) || 0)).length);
            const max = Math.max(1, ...counts);
            const body = bands.map((band, i) => `
                <div class="bm-health-modal-hist-col">
                    <b class="bm-health-modal-hist-bar" style="height:${Math.round((counts[i] / max) * 100)}%"></b>
                    <span class="bm-health-modal-hist-label">${esc(band.label)}</span>
                    <span data-bm-health-modal-count="${esc(band.key)}">${counts[i]}</span>
                </div>`).join('');
            return this.bmHealthModalCard('distribution', this.t('config.bmHealthModalDistributionTitle', 'Score distribution'),
                `<div class="bm-health-modal-hist">${body}</div>`);
        },

        /** 5. By page -- each page's healthy share and broken count, worst first. */
        renderBmHealthModalPagesCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const byPage = new Map();
            issues.forEach((issue) => {
                const pid = String(issue.pageId);
                if (!byPage.has(pid)) byPage.set(pid, []);
                byPage.get(pid).push(issue);
            });
            const rows = [...byPage.entries()].map(([pageId, list]) => {
                const healthy = list.filter((i) => health.matchesFilter(i, 'healthy')).length;
                const broken = list.filter((i) => health.matchesFilter(i, 'broken')).length;
                return {
                    pageId,
                    name: this.pageLabel(pageId),
                    total: list.length,
                    healthyPct: list.length ? Math.round((healthy / list.length) * 100) : 100,
                    broken,
                };
            }).sort((a, b) => a.healthyPct - b.healthyPct || a.name.localeCompare(b.name));

            const shown = rows.slice(0, PAGES_SHOWN);
            const rest = rows.slice(PAGES_SHOWN);
            const row = (name, pct, broken, attrs, cls = '') => `
                <${attrs ? 'button type="button"' : 'div'} class="bm-health-modal-page-row${cls}" ${attrs || ''}>
                    <span class="bm-health-modal-page-name">${esc(name)}</span>
                    <span class="bm-health-modal-page-track"><i style="width:${pct}%"></i></span>
                    <span class="bm-health-modal-page-pct">${pct}%</span>
                    <span class="bm-health-modal-page-broken${broken ? ' is-bad' : ''}">${broken
                        ? esc(`${broken} ✕`) : '—'}</span>
                </${attrs ? 'button' : 'div'}>`;
            const shownHtml = shown.map((r) => row(r.name, r.healthyPct, r.broken,
                `data-bm-health-modal-page="${esc(r.pageId)}"`)).join('');
            let restHtml = '';
            if (rest.length) {
                // The rest are drawn too, folded away: "+N pages" opens them
                // in the card, which then scrolls on its own so the modal
                // stays one screen.
                const extra = rest.map((r) => row(r.name, r.healthyPct, r.broken,
                    `data-bm-health-modal-page="${esc(r.pageId)}" hidden`, ' is-extra')).join('');
                const restTotal = rest.reduce((sum, r) => sum + r.total, 0);
                const restHealthy = rest.reduce((sum, r) => sum + Math.round((r.healthyPct / 100) * r.total), 0);
                const restBroken = rest.reduce((sum, r) => sum + r.broken, 0);
                const restPct = restTotal ? Math.round((restHealthy / restTotal) * 100) : 100;
                const moreLabel = this.t('config.bmHealthModalMorePages', '+{n} pages').replace('{n}', String(rest.length));
                restHtml = extra + row(moreLabel, restPct, restBroken,
                    `data-bm-health-modal-pages-toggle aria-expanded="false" data-more-label="${esc(moreLabel)}"`, ' is-toggle');
            }
            return this.bmHealthModalCard('pages', this.t('config.bmHealthModalPagesTitle', 'By page'),
                `<div class="bm-health-modal-pages">${shownHtml}${restHtml}</div>`);
        },

        /**
         * 6. Checking coverage -- off/periodic/monitor tallied across every
         * issue, when the sweep last ran, and the longest-standing check.
         */
        renderBmHealthModalCoverageCard(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const issues = Array.isArray(health.report?.issues) ? health.report.issues : [];
            const CM = global.CheckMode;
            const counts = { off: 0, periodic: 0, monitor: 0 };
            issues.forEach((issue) => {
                const mode = CM?.of ? CM.of(issue) : (issue.monitor ? 'monitor' : (issue.checkStatus ? 'periodic' : 'off'));
                counts[mode] = (counts[mode] || 0) + 1;
            });
            const tile = (mode, label) => `<div class="bm-health-modal-tile" title="${esc(label)}">
                <b data-bm-health-modal-count="check-${esc(mode)}">${counts[mode] || 0}</b><span>${esc(label)}</span></div>`;
            const tiles = [
                tile('off', CM ? CM.meta(CM.OFF).label : this.t('config.checkModeOff', 'Off')),
                tile('periodic', CM ? CM.meta(CM.PERIODIC).label : this.t('config.bmFieldChecking', 'Periodic')),
                tile('monitor', CM ? CM.meta(CM.MONITOR).label : this.t('config.bmSectionMonitor', 'Monitor')),
            ].join('');

            const generated = Number(health.report?.generatedAt) || 0;
            const sweepLine = generated ? `<div class="bm-health-modal-kv">
                <span>${esc(this.t('config.bmHealthModalLastSweep', 'Last sweep'))}</span>
                <span data-bm-health-modal-count="last-sweep">${esc(new Date(generated).toLocaleString())}</span></div>` : '';

            const oldest = issues.filter((i) => Number(i.lastChecked) > 0)
                .sort((a, b) => a.lastChecked - b.lastChecked)[0];
            const oldestLine = oldest ? `<div class="bm-health-modal-kv">
                <span>${esc(this.t('config.bmHealthModalOldestCheck', 'Oldest check still standing'))}</span>
                <span data-bm-health-modal-count="oldest-check">${esc(this.t('config.bmHealthModalOldestCheckValue', '{name} · {duration}')
                    .replace('{name}', oldest.name || health.formatUrlDisplay(oldest.url))
                    .replace('{duration}', health.formatDuration(Date.now() - Number(oldest.lastChecked))))}</span></div>` : '';

            return this.bmHealthModalCard('coverage', this.t('config.bmHealthModalCoverageTitle', 'Checking coverage'),
                `<div class="bm-health-modal-tiles">${tiles}</div>${sweepLine}${oldestLine}`);
        },

        /**
         * 7. Monitors -- only while something is monitored. Pooled uptime,
         * average response, the worst three, and the latest outage: the same
         * fields the fleet panel (renderFleetPanel) already draws, laid out
         * for a card instead of a full section.
         */
        renderBmHealthModalMonitorsCard(health) {
            const fleet = health.report?.fleet;
            if (!fleet || !Number(fleet.monitors)) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const noData = health.t('dashboard.healthStatsNoData', 'no data');
            const windows = [
                ['24h', health.t('dashboard.healthStatsUptime24h', '24 hours'), fleet.uptime24h],
                ['7d', health.t('dashboard.healthStatsUptime7d', '7 days'), fleet.uptime7d],
                ['30d', health.t('dashboard.healthStatsUptime30d', '30 days'), fleet.uptime30d],
            ];
            const tiles = windows.map(([key, label, win]) => `<div class="bm-health-modal-tile">
                <b data-bm-health-modal-count="uptime-${key}">${esc(health.formatUptime(win) || noData)}</b>
                <span>${esc(label)}</span></div>`).join('');

            const avg = Number(fleet.avgResponseMs) || 0;
            const avgLine = avg ? `<div class="bm-health-modal-kv">
                <span>${esc(this.t('config.bmHealthModalAvgResponse', 'Average response'))}</span>
                <span data-bm-health-modal-count="avg-response">${avg}ms</span></div>` : '';

            const worst = (Array.isArray(fleet.worst) ? fleet.worst : []).slice(0, 3);
            const worstRows = worst.map((m) => `<li>
                <span>${esc(m.name || health.formatUrlDisplay(m.url))}</span>
                <span>${esc(health.formatUptime({ ratio: m.ratio, samples: m.samples }) || '—')}${m.down
                    ? ` · ${esc(health.t('dashboard.healthFleetDownNow', 'down'))}` : ''}</span></li>`).join('');
            const worstBlock = worstRows ? `
                <p class="bm-health-modal-subhead">${esc(this.t('config.bmHealthModalLeastReliable', 'Least reliable'))}</p>
                <ul class="bm-health-modal-monitor-list">${worstRows}</ul>` : '';

            const incidents = Array.isArray(fleet.incidents) ? fleet.incidents : [];
            const latest = incidents[0];
            const outageLine = latest
                ? `<p class="bm-health-modal-outage" data-bm-health-modal-count="latest-outage">${esc(
                    this.t('config.bmHealthModalLatestOutage', 'Latest outage: {name}, {when}, {duration}')
                        .replace('{name}', latest.name || health.formatUrlDisplay(latest.url))
                        .replace('{when}', latest.start ? new Date(latest.start).toLocaleDateString() : '')
                        .replace('{duration}', latest.ongoing
                            ? health.t('dashboard.healthFleetOngoing', 'ongoing')
                            : health.formatDuration(latest.durationMs)))}</p>`
                : `<p class="bm-health-modal-outage">${esc(health.t('dashboard.healthStatsNoIncidents', 'No outages recorded.'))}</p>`;

            const title = this.t('config.bmHealthModalMonitorsTitle', 'Monitors ({count})')
                .replace('{count}', String(fleet.monitors));
            return this.bmHealthModalCard('monitors', title,
                `<div class="bm-health-modal-tiles">${tiles}</div>${avgLine}${worstBlock}${outageLine}`);
        },

        /** 8. Certificates -- only while one expires within 30 days. */
        renderBmHealthModalCertsCard(health) {
            const certs = health.report?.certificates;
            if (!certs) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const rows = Object.values(certs)
                .map((cert) => ({ cert, days: health.certDaysLeft(cert) }))
                .filter((row) => row.days <= 30)
                .sort((a, b) => a.days - b.days);
            if (!rows.length) return '';
            const body = rows.map((row) => `<div class="bm-health-modal-kv">
                <span>${esc(row.cert.host)}</span>
                <span class="${row.days < 0 ? 'is-bad' : 'is-warn'}" data-bm-health-modal-count="cert-${esc(row.cert.host)}">${esc(
                    row.days < 0
                        ? health.t('dashboard.healthCertExpired', 'Certificate expired')
                        : this.t('config.bmHealthModalDaysLeft', '{days} days').replace('{days}', String(row.days))
                )}</span></div>`).join('');
            return this.bmHealthModalCard('certificates',
                this.t('config.bmHealthModalCertsTitle', 'Certificates expiring within 30 days'), body);
        },

        /** 9. Footer -- the rot report, Health settings, and a refresh. */
        renderBmHealthModalFooter(health) {
            const esc = (v) => this.dash.escapeHtml(v);
            const age = health.reportAgeText();
            return `<div class="bm-health-modal-footer">
                <span class="bm-health-modal-footer-hint">${esc(this.t('config.bmHealthModalFooterHint',
                    'Every number is a filter: click one to see those bookmarks.'))}</span>
                <span class="bm-health-modal-footer-actions">
                    ${age ? `<span class="bm-health-modal-footer-age">${esc(health.t('dashboard.healthSummaryUpdated', 'Updated'))} ${esc(age)}</span>` : ''}
                    <button type="button" class="config-btn config-btn--small" data-bm-health-modal-action="rot">${esc(health.t('dashboard.healthRotTitle', 'What has rotted'))}</button>
                    <button type="button" class="config-btn config-btn--small" data-bm-health-modal-action="settings">${esc(health.t('dashboard.healthSettingsLink', 'Settings'))}</button>
                    <button type="button" class="config-btn config-btn--small config-btn--primary" data-bm-health-modal-action="refresh">${esc(this.t('config.bmHealthModalRefresh', 'Refresh'))}</button>
                </span>
            </div>`;
        },

        /* ── Wiring ───────────────────────────────────────────────────────── */

        /**
         * Set a Health filter and repaint, exactly as toggleRailFilter's
         * 'health' branch does -- except this always sets rather than toggling
         * off an already-active filter, since a click here means "show me
         * these", not "clear this if it happens to already be on".
         */
        applyBmHealthModalFilter(key) {
            this.bmHealthFilter = key;
            this.resetBookmarkVisibleLimit();
            this._bmDuplicateUrls = null;
            this.repaintBookmarksList();
            this.restoreConfigHash();
            this.updateConfigShellHead();
        },

        /** "+N pages": the rest of the pages in the card, or folded away again. */
        toggleBmHealthModalPages(toggle) {
            const list = toggle.closest('.bm-health-modal-pages');
            if (!list) return;
            const open = toggle.getAttribute('aria-expanded') !== 'true';
            list.querySelectorAll('.is-extra').forEach((el) => { el.hidden = !open; });
            list.classList.toggle('is-expanded', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            const name = toggle.querySelector('.bm-health-modal-page-name');
            if (name) {
                name.textContent = open
                    ? this.t('config.bmHealthModalFewerPages', 'Show fewer')
                    : toggle.getAttribute('data-more-label');
            }
            // The figures summed up the rest; with the rest on show they
            // would count those pages twice.
            toggle.querySelectorAll('.bm-health-modal-page-track, .bm-health-modal-page-pct, .bm-health-modal-page-broken')
                .forEach((el) => { el.style.visibility = open ? 'hidden' : ''; });
        },

        /** Same idea as toggleRailFilter's 'page' branch, forced rather than toggled. */
        applyBmHealthModalPage(pageId) {
            this.bmPageFilter = pageId;
            this.resetBookmarkVisibleLimit();
            void this.onBookmarksPageFilterChange();
        },

        /**
         * The modal's content lives in the app-wide #modal-text, reused by
         * every caller of AppModal.show — wired once, since the element
         * itself outlives any one call to openBmHealthModal (a refresh
         * reopens it in place).
         */
        bindBmHealthModal() {
            const root = document.getElementById('modal-text');
            if (!root || root.dataset.bmHealthModalWired === '1') return;
            root.dataset.bmHealthModalWired = '1';
            root.addEventListener('click', (e) => {
                const tabEl = e.target.closest('[data-bm-health-modal-tab]');
                if (tabEl) {
                    this.setBmHealthModalTab(tabEl.getAttribute('data-bm-health-modal-tab'));
                    return;
                }
                const seriesEl = e.target.closest('[data-bm-health-trend-series]');
                if (seriesEl) {
                    this._bmTrendSeries = seriesEl.getAttribute('data-bm-health-trend-series');
                    const card = root.querySelector('[data-bm-health-modal-card="trend"]');
                    const health = this._bmHealthModule;
                    if (card && health) {
                        card.outerHTML = this.renderBmHealthModalTrendCard(health);
                        void this.mountBmTrendChart();
                    }
                    return;
                }
                const filterEl = e.target.closest('[data-bm-health-modal-filter]');
                if (filterEl) {
                    const key = filterEl.getAttribute('data-bm-health-modal-filter');
                    global.AppModal.hide();
                    this.applyBmHealthModalFilter(key);
                    return;
                }
                const toggle = e.target.closest('[data-bm-health-modal-pages-toggle]');
                if (toggle) {
                    this.toggleBmHealthModalPages(toggle);
                    return;
                }
                const pageEl = e.target.closest('[data-bm-health-modal-page]');
                if (pageEl) {
                    const pageId = pageEl.getAttribute('data-bm-health-modal-page');
                    global.AppModal.hide();
                    this.applyBmHealthModalPage(pageId);
                    return;
                }
                const actionEl = e.target.closest('[data-bm-health-modal-action]');
                if (!actionEl) return;
                const action = actionEl.getAttribute('data-bm-health-modal-action');
                const health = this._bmHealthModule;
                if (action === 'rot') {
                    global.AppModal.hide();
                    health?.showRotReport?.();
                } else if (action === 'settings') {
                    global.AppModal.hide();
                    void health?.openStatusHealthSettings?.();
                } else if (action === 'refresh') {
                    void this.refreshBmHealth({ refresh: true }).then(() => this.openBmHealthModal());
                }
            });
        },
    });

    global.DashboardBookmarksHealthModalReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
