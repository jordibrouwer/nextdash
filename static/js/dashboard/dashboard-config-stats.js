/**
 * Config → Stats, loaded when that section is opened.
 *
 * Five tabs, each answering one question: Overview (how is it going, and what
 * needs doing), Usage (what do I use, and when), Collection (what do I have),
 * Inbox (am I keeping up) and Health (does everything still work). Every tab
 * opens with six figures and lays its panels out two to a row, so the page
 * fits on a screen or two instead of four.
 *
 * The figures come from dashboard-config-stats-figures.js and from
 * computeStats() in the config module; this file only draws them. The entry
 * points the rest of the module calls — renderStats, repaintStatsBody, the
 * loaders — stay in dashboard-config.js, and what they call into is guarded in
 * one place: renderStatsBodySafe.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    const DAY = 86400000;

    Object.assign(global.DashboardConfig.prototype, {

        /* ------------------------------------------------------------------
         * Shared pieces
         * ------------------------------------------------------------------ */

        /**
         * When these numbers were worked out, with Refresh and CSV beside it.
         *
         * They are recomputed from whatever is in memory at render time, so the
         * page says when. It sits in the tab row: the stamp dates every tab,
         * and the two controls act on all of them.
         */
        renderStatsTimestamp() {
            const esc = (v) => this.dash.escapeHtml(v);
            const time = window.NextDashClock.formatTime(new Date(), this.dash.settings);
            return `
                <div class="config-stats-foot">
                    <p class="config-stats-updated">${esc(this.t('config.statsUpdatedAt', 'Worked out at {time}')
                        .replace('{time}', time))}</p>
                    <div class="config-stats-foot-actions">
                        <button type="button" class="config-btn config-btn--small" data-stats-action="refresh">${esc(this.t('config.statsRefresh', 'Refresh'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-stats-action="export">${esc(this.t('config.statsExportCsv', 'Export as CSV'))}</button>
                    </div>
                </div>`;
        },

        /** One explanation instead of a page of zeroes. */
        renderStatsEmpty() {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-panel config-panel--empty-state">
                    <h3 class="config-panel-title">${esc(this.t('config.statsEmptyTitle', 'Nothing to measure yet'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsEmptyBody', 'Statistics fill in as you add bookmarks and start opening them. Add a few and this page will have something to say.'))}</p>
                    <div class="config-actions">
                        <button type="button" class="config-btn config-btn--primary" data-stats-action="add-bookmark">${esc(this.t('config.addBookmarkBtn', 'Add bookmark'))}</button>
                    </div>
                </div>`;
        },

        /** A copyable link to the open tab. */
        statsPanelLink(id) {
            const esc = (v) => this.dash.escapeHtml(v);
            const label = this.t('config.statsCopyLink', 'Copy a link to this tab');
            return `<button type="button" class="config-help-panel-link" data-stats-panel-link="${esc(id)}"
                    title="${esc(label)}" aria-label="${esc(label)}">🔗</button>`;
        },

        /**
         * One panel in the grid.
         *
         * `span` is its width in twelfths on a wide window (6 is half); below
         * 900px every panel takes the full row. A standing explanation goes in
         * `info`, behind the (i) beside the title, so it no longer costs every
         * panel two lines; `note` is for a line the reader needs to read the
         * figures at all.
         */
        statsPanel({ title, body, span = 6, info = '', note = '', right = '', id = '', cls = '' }) {
            const esc = (v) => this.dash.escapeHtml(v);
            const infoHtml = info
                ? `<span class="config-stats-info" tabindex="0" role="note" title="${esc(info)}" aria-label="${esc(info)}">i</span>`
                : '';
            return `
                <section class="config-panel config-stats-panel${cls ? ` ${cls}` : ''}" data-span="${span}"${id ? ` id="${esc(id)}"` : ''}>
                    <div class="config-stats-panel-head">
                        <h3 class="config-panel-title">${esc(title)}</h3>
                        ${infoHtml}
                        ${right ? `<div class="config-stats-panel-tools">${right}</div>` : ''}
                    </div>
                    ${note ? `<p class="config-panel-note">${esc(note)}</p>` : ''}
                    ${body}
                </section>`;
        },

        statsGrid(panels) {
            return `<div class="config-stats-grid">${panels.filter(Boolean).join('')}</div>`;
        },

        /**
         * The six figures a tab opens with.
         *
         * Each item: label, value, and optionally detail, a tone for a figure
         * that carries a verdict, a weekly delta, and a sparkline where the
         * install has history for it.
         */
        statsKpis(items, extraClass = '') {
            const tiles = items.map((it) => {
                const spoken = [
                    `${it.label}: ${it.value}`,
                    it.delta ? `${it.delta} ${it.deltaNote || ''}`.trim() : '',
                    it.detail || '',
                ].filter(Boolean).join('. ');
                return window.StatTile.html({
                    label: it.label,
                    value: it.value,
                    detail: it.detail || '',
                    delta: it.delta || null,
                    deltaTone: it.delta ? (it.deltaTone || 'neutral') : null,
                    deltaNote: it.delta ? (it.deltaNote || '') : null,
                    tone: it.tone || undefined,
                    size: 'md',
                    quiet: false,
                    role: 'listitem',
                    ariaLabel: spoken,
                    extraHtml: it.spark ? this.statsSpark(it.spark, it.sparkRange) : '',
                    extraClasses: ['config-tile'],
                    partClass: {
                        label: 'config-tile-label',
                        value: 'config-tile-value',
                        detail: 'config-tile-detail',
                        delta: 'config-tile-delta',
                    },
                });
            }).join('');
            return `<div class="config-tiles config-stats-kpis${extraClass ? ` ${extraClass}` : ''}" role="list">${tiles}</div>`;
        },

        /** A small line for a tile. Decorative: the tile's value says it. */
        statsSpark(values, range) {
            const vals = (values || [])
                .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)))
                .map(Number);
            if (vals.length < 2) return '';
            const W = 120;
            const H = 22;
            const lo = range ? range[0] : Math.min(...vals);
            const hi = range ? range[1] : Math.max(...vals);
            const span = (hi - lo) || 1;
            const pts = vals.map((v, i) => [
                (i / (vals.length - 1)) * W,
                H - 2 - ((Math.max(lo, Math.min(hi, v)) - lo) / span) * (H - 4),
            ]);
            const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
            const [lx, ly] = pts[pts.length - 1];
            return `<svg class="config-stats-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                <path d="${d} L${W} ${H} L0 ${H}Z" class="config-stats-spark-area"></path>
                <path d="${d}" class="config-stats-spark-line"></path>
                <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2" class="config-stats-spark-dot"></circle>
            </svg>`;
        },

        /**
         * A ranked or banded list of bars.
         *
         * rows: [label, count, { tone, display, goto }]. Bars scale to the
         * largest row unless `max` says otherwise (coverage scales to the whole
         * collection). A row with `goto` becomes the way into the bookmarks it
         * counts.
         */
        statsBars(rows, { max = null, axis = null, tone = '' } = {}) {
            const esc = (v) => this.dash.escapeHtml(v);
            if (!rows.length) return '';
            const top = max ?? Math.max(...rows.map(([, n]) => Number(n) || 0), 1);
            const items = rows.map(([label, value, opts = {}]) => {
                const n = Number(value) || 0;
                const pct = top ? Math.min(100, Math.round((n / top) * 100)) : 0;
                const shown = opts.display ?? this.statsNumber(n);
                const cell = opts.goto
                    ? `<button type="button" class="config-dist-label config-dist-label--link" data-stats-goto="${esc(opts.goto)}"
                            title="${esc(this.t('config.statsRowShow', 'Show these in Bookmarks'))}">${esc(label)}</button>`
                    : `<span class="config-dist-label" title="${esc(label)}">${esc(label)}</span>`;
                const t = opts.tone || tone;
                return `
                    <li class="config-dist-row">
                        ${cell}
                        <div class="config-bar config-bar--slim${n ? '' : ' config-bar--empty'}" role="img" aria-label="${esc(label)}: ${esc(String(shown))}">
                            <span class="config-bar-fill${t ? ` config-bar-fill--${t}` : ''}" style="width:${pct}%"></span>
                        </div>
                        <span class="config-dist-count">${esc(String(shown))}</span>
                    </li>`;
            }).join('');
            return `${axis ? this.statsListAxisHeader(axis[0], axis[1]) : ''}<ul class="config-dist-list">${items}</ul>`;
        },

        /**
         * Parts of one whole as a single bar with a legend.
         *
         * parts: [label, count, tone]. A zero part stays in the legend, since
         * "0 discarded" is an answer, but draws no segment.
         */
        statsStack(parts, ariaLabel) {
            const esc = (v) => this.dash.escapeHtml(v);
            const total = parts.reduce((sum, [, n]) => sum + (Number(n) || 0), 0);
            if (!total) return '';
            const segs = parts.filter(([, n]) => Number(n) > 0).map(([label, n, tone]) =>
                `<span class="config-stats-stack-seg config-stats-stack-seg--${esc(tone || 'a')}" style="flex:${Number(n)}" title="${esc(label)}: ${esc(this.statsNumber(n))}"></span>`).join('');
            const legend = parts.map(([label, n, tone]) => `
                <li><span class="config-stats-swatch config-stats-stack-seg--${esc(tone || 'a')}"></span>${esc(label)} <strong>${esc(this.statsNumber(n))}</strong></li>`).join('');
            const spoken = ariaLabel || parts.map(([label, n]) => `${label} ${n}`).join(', ');
            return `
                <div class="config-stats-stack" role="img" aria-label="${esc(spoken)}">${segs}</div>
                <ul class="config-stats-legend">${legend}</ul>`;
        },

        /**
         * A bar chart over time, one or two series, with a readout per bar.
         *
         * The <g> is the hit target and spans the full height, so a short or
         * empty bar can still be pointed at; it is focusable, so the values are
         * on the keyboard too. A screen-reader table carries the same numbers.
         * An optional line (a running total) is drawn on its own scale, whose
         * range the legend names.
         */
        statsColumns({ series, dates, labels = null, axisY, axisX, aria, line = null, lineLabel = '', height = 108 }) {
            const esc = (v) => this.dash.escapeHtml(v);
            const W = 500;
            const H = height;
            const n = dates.length;
            const slot = W / Math.max(1, n);
            const gap = n > 60 ? 1 : 3;
            const barW = Math.max(1, (slot - gap) / series.length - (series.length > 1 ? 1 : 0));
            const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
            const bars = dates.map((date, i) => {
                const x = i * slot;
                const values = series.map((s) => Number(s.values[i]) || 0);
                const rects = values.map((v, k) => {
                    const h = Math.round((v / max) * H);
                    return `<rect class="config-chart-bar-fill config-chart-bar-fill--${k ? 'b' : 'a'}" x="${(x + gap / 2 + k * (barW + 1)).toFixed(2)}" y="${H - h}" width="${barW.toFixed(2)}" height="${Math.max(h, v > 0 ? 2 : 0)}" rx="1"></rect>`;
                }).join('');
                const spoken = series.map((s, k) => `${values[k]} ${s.label}`).join(', ');
                const extra = series.length > 1
                    ? ` data-bar-value2="${esc(String(values[1]))}" data-bar-label2="${esc(series[1].label)}"`
                    : '';
                return `<g class="config-chart-bar" tabindex="0" role="listitem"
                           data-bar-date="${esc(date)}" data-bar-value="${esc(String(values[0]))}" data-bar-label="${esc(series[0].label)}"${extra}
                           aria-label="${esc(date)}: ${esc(spoken)}">
                    <rect class="config-chart-bar-hit" x="${x.toFixed(2)}" y="0" width="${slot.toFixed(2)}" height="${H}"></rect>
                    ${rects}
                </g>`;
            }).join('');

            let lineSvg = '';
            let lineMax = 0;
            let lineMin = 0;
            if (Array.isArray(line) && line.length === n) {
                const nums = line.map((v) => Number(v) || 0);
                lineMax = Math.max(1, ...nums);
                lineMin = Math.min(0, ...nums);
                const span = (lineMax - lineMin) || 1;
                const pts = nums.map((v, i) => `${(i * slot + slot / 2).toFixed(1)},${(H - ((v - lineMin) / span) * H).toFixed(1)}`);
                lineSvg = `<polyline class="config-stats-line config-stats-line--overlay" points="${pts.join(' ')}" fill="none"></polyline>`;
            }

            const srHead = `<th scope="col">${esc(axisX)}</th>${series.map((s) => `<th scope="col">${esc(s.label)}</th>`).join('')}${lineSvg ? `<th scope="col">${esc(lineLabel)}</th>` : ''}`;
            const srRows = dates.map((d, i) => `<tr><th scope="row">${esc(d)}</th>${series.map((s) => `<td>${esc(String(Number(s.values[i]) || 0))}</td>`).join('')}${lineSvg ? `<td>${esc(String(line[i]))}</td>` : ''}</tr>`).join('');
            const legend = series.length > 1 || lineSvg
                ? `<div class="config-chart-legend">${series.map((s, k) => `<span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--${k ? 'b' : 'a'}"></span>${esc(s.label)}</span>`).join('')}${lineSvg
                    ? `<span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--line"></span>${esc(lineLabel)} (${esc(this.statsNumber(lineMin))} – ${esc(this.statsNumber(lineMax))})</span>`
                    : ''}</div>`
                : '';

            return `
                ${legend}
                <div class="config-chart">
                    <div class="config-chart-plot">
                        <span class="config-chart-axis-y" aria-hidden="true">
                            <span class="config-chart-axis-title">${esc(axisY)}</span>
                            <span class="config-chart-axis-ticks"><span>${esc(String(max))}</span><span>0</span></span>
                        </span>
                        <span class="config-chart-plot-area">
                            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="list" aria-label="${esc(aria)}">${bars}${lineSvg}</svg>
                            <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks({ dateLabels: labels || dates })}</span>
                        </span>
                    </div>
                    <p class="config-chart-axis-x" aria-hidden="true">${esc(axisX)}</p>
                    <div class="config-chart-tip" role="status" aria-live="polite" hidden></div>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(aria)}</caption>
                    <thead><tr>${srHead}</tr></thead>
                    <tbody>${srRows}</tbody>
                </table>`;
        },

        statsRangeLabel(days) {
            if (days === 365) return this.t('config.statsRangeYear', '1 year');
            return this.t('config.statsRangeDays', '{n} days').replace('{n}', String(days));
        },

        statsRangeChips(attr, current, ranges = DashboardConfig.STATS_RANGES) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `<div class="config-choices config-choices--compact" role="group" aria-label="${esc(this.t('config.statsRangeGroup', 'Period'))}">${ranges.map((d) => {
                const on = d === current;
                return `<button type="button" class="config-choice${on ? ' is-active' : ''}" ${attr}="${d}" aria-pressed="${on}">${esc(this.statsRangeLabel(d))}</button>`;
            }).join('')}</div>`;
        },

        /** The noun for one bucket of the last-used and opens charts. */
        statsActivityBucketUnit() {
            const days = this.statsRange || 30;
            if (days <= 30) return this.t('config.statsAxisUnitDay', 'day');
            if (days <= 90) return this.t('config.statsAxisUnitWeek', 'week');
            return this.t('config.statsAxisUnitMonth', 'month');
        },

        /**
         * Dated ticks along the x-axis, as many as fit at the widest label, and
         * always the last one. The end labels anchor to their own edge so
         * neither hangs outside the panel.
         */
        statsActivityTicks(a) {
            const esc = (v) => this.dash.escapeHtml(v);
            const dates = a.dateLabels || [];
            const n = dates.length;
            if (!n) return '';
            const widest = dates.reduce((w, d) => Math.max(w, String(d).length), 0);
            const fits = Math.floor(440 / (widest * 6 + 16));
            const maxTicks = Math.max(2, Math.min(6, fits, n));
            const step = Math.max(1, Math.round((n - 1) / Math.max(1, maxTicks - 1)));
            const picked = [];
            for (let i = 0; i < n; i += step) picked.push(i);
            if (picked[picked.length - 1] !== n - 1) {
                // Drop the one before the last when it would crowd it.
                if (picked.length > 1 && n - 1 - picked[picked.length - 1] < step / 2) picked.pop();
                picked.push(n - 1);
            }
            const last = picked.length - 1;
            return picked.map((i, k) => {
                const pct = n === 1 ? 50 : ((i + 0.5) / n) * 100;
                const edge = k === 0 ? ' config-chart-tick--first'
                    : k === last ? ' config-chart-tick--last' : '';
                return `<span class="config-chart-tick${edge}" style="left:${pct.toFixed(2)}%">${esc(dates[i])}</span>`;
            }).join('');
        },

        /** What one bar covers, which the selected range decides. */
        statsActivityAxisXLabel(days = this.statsRange || 30) {
            if (days <= 30) return this.t('config.statsAxisPerDay', 'Day (oldest → newest)');
            if (days <= 90) return this.t('config.statsAxisPerWeek', 'Week (oldest → newest)');
            return this.t('config.statsAxisPerMonth', 'Month (oldest → newest)');
        },

        /** The chart in a sentence: the window, its total and its busiest point. */
        statsActivityShape(a) {
            const buckets = Array.isArray(a?.buckets) ? a.buckets : [];
            if (!buckets.length) return '';
            let peak = 0;
            buckets.forEach((v, i) => { if (Number(v) > Number(buckets[peak])) peak = i; });
            const label = a.dateLabels?.[peak] || a.labels?.[peak] || '';
            const total = buckets.reduce((sum, v) => sum + (Number(v) || 0), 0);
            return this.t('config.statsActivityShape',
                '{range}: {total} bookmarks used, busiest on {peak} with {n}.')
                .replace('{range}', this.statsRangeLabel(this.statsRange || 30))
                .replace('{total}', this.statsNumber(total))
                .replace('{peak}', label)
                .replace('{n}', this.statsNumber(Number(buckets[peak]) || 0));
        },

        /** One-line caption naming the scale a set of full-width bars shares. */
        statsScaleCaption(text) {
            return `<p class="config-chart-scale" aria-hidden="true">${this.dash.escapeHtml(text)}</p>`;
        },

        statsPairAxisHeader(labelText, valueText) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-dist-axis config-dist-axis--pair" aria-hidden="true">
                    <span>${esc(labelText)}</span>
                    <span>${esc(valueText)}</span>
                </div>`;
        },

        statsListAxisHeader(labelText, valueText) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-dist-axis" aria-hidden="true">
                    <span class="config-dist-axis-label">${esc(labelText)}</span>
                    <span class="config-dist-axis-value">${esc(valueText)}</span>
                </div>`;
        },

        /**
         * "8 of 105 shown" under a list that had to cut off, with the button
         * that shows the rest where the bookmarks list can reproduce it.
         */
        statsListTruncationNote(shown, total, cleanupKey) {
            const count = Number(total) || 0;
            if (!shown || count <= shown) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const text = this.t('config.statsListTruncated', '{shown} of {total} shown')
                .replace('{shown}', String(shown)).replace('{total}', String(count));
            const button = cleanupKey && DashboardConfig.CLEANUP_FILTERS[cleanupKey]
                ? `<button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(cleanupKey)}">${esc(this.t('config.statsListShowAll', 'Show all in bookmarks'))}</button>`
                : '';
            return `
                <div class="config-list-truncated">
                    <span>${esc(text)}</span>
                    ${button}
                </div>`;
        },

        /** Label and value pairs: [label, value, tone, note]. */
        statsFacts(rows) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `<ul class="config-stat-details">${rows.map(([label, value, tone, sub]) => `
                <li class="config-stat-detail${tone ? ` config-stat-detail--${tone}` : ''}">
                    <span>${esc(label)}${sub ? ` <span class="config-stat-detail-note">${esc(sub)}</span>` : ''}</span>
                    <span class="config-stat-penalty">${esc(String(value))}</span>
                </li>`).join('')}</ul>`;
        },

        /** The line that says a panel ignores the page filter. */
        statsScopeNote() {
            const page = this.statsScopePage();
            if (!page) return '';
            if ((this.dash.pages || []).length < 2) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            return `<p class="config-panel-note config-stats-scope-note">${esc(
                this.t('config.statsScopeWholeLibrary', 'These figures cover the whole library, not just {page}.')
                    .replace('{page}', page.name || `#${page.id}`))}</p>`;
        },

        /** Share of `total`, rounded. */
        statsPct(n, total) {
            return Number(total) ? Math.round((Number(n) / Number(total)) * 100) : 0;
        },

        /* ------------------------------------------------------------------
         * The body
         * ------------------------------------------------------------------ */

        renderStatsBody() {
            const s = this.computeStats();
            // Inbox is server-side and still meaningful on an empty dashboard.
            if (!s.total && this.statsTab !== 'inbox') {
                return this.renderStatsEmpty();
            }
            switch (this.statsTab) {
                case 'usage': return this.renderStatsUsage(s);
                case 'collection': return this.renderStatsCollection(s);
                case 'inbox': return this.renderStatsInbox();
                case 'health': return this.renderStatsHealthTab(s);
                default: return this.renderStatsOverview(s);
            }
        },

        /* ------------------------------------------------------------------
         * Overview
         * ------------------------------------------------------------------ */

        renderStatsOverview(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            const ago = this.statsScopePage() ? null : this.statsTrendPointDaysAgo(7);
            const delta = ago && Number.isFinite(Number(ago.n)) ? Number(s.total) - Number(ago.n) : 0;
            const healthySeries = this.statsHealthySeries(this._statsTrend || []).map((p) => p.pct);
            const all = this.statsScopedBookmarks();
            const used30 = all.filter((b) => Number(b.lastOpened || 0) >= Date.now() - 30 * DAY).length;
            const inbox = this.statsInboxFigures();
            const fleet = h?.fleet;
            const uptime = this.statsUptimePct(fleet?.uptime30d);

            const kpis = this.statsKpis([
                {
                    label: this.t('config.statsBookmarks', 'Bookmarks'),
                    value: this.statsNumber(s.total),
                    delta: delta ? `${delta > 0 ? '+' : '−'}${this.statsNumber(Math.abs(delta))}` : null,
                    deltaNote: this.t('config.statsDeltaWeek', 'this week'),
                    spark: this.statsScopePage() ? null : (this._statsTrend || []).slice(-30).map((p) => p.n),
                },
                this.statsHealthyKpi(h, healthySeries),
                {
                    label: this.t('config.statsUsed30', 'Used last 30 days'),
                    value: this.statsNumber(used30),
                    detail: this.t('config.statsOfTotal', 'of {n}').replace('{n}', this.statsNumber(s.total)),
                },
                {
                    label: this.t('config.statsInboxUnreadKpi', 'Inbox unread'),
                    value: inbox ? this.statsNumber(inbox.unread) : '…',
                    detail: inbox && inbox.backlog
                        ? this.t('config.statsInboxOlder30', '{n} older than 30 days').replace('{n}', this.statsNumber(inbox.backlog))
                        : '',
                    tone: inbox && inbox.backlog ? 'warn' : undefined,
                },
                {
                    label: this.t('config.statsUptime30', 'Uptime 30 days'),
                    value: uptime === null ? '—' : `${this.statsNumber(uptime)}%`,
                    detail: fleet && Number(fleet.monitors)
                        ? this.t('config.statsMonitorsCount', '{n} monitors').replace('{n}', this.statsNumber(fleet.monitors))
                        : this.t('config.statsNoMonitors', 'no monitors'),
                    tone: uptime === null ? undefined : (uptime >= 99 ? 'good' : (uptime >= 95 ? 'warn' : 'bad')),
                },
                {
                    label: this.t('config.statsScoreTitle', 'Cleanup score'),
                    value: String(s.cleanup.score),
                    detail: this.t('config.statsOutOf100', 'out of 100'),
                    tone: s.cleanup.score >= 80 ? 'good' : (s.cleanup.score >= 50 ? 'warn' : 'bad'),
                },
            ], 'config-tiles--overview');

            const activity30 = this.computeActivity(all, 30);
            const goto = (tab) => `<button type="button" class="config-btn config-btn--small" data-stats-tab-goto="${tab}">${esc(this.statsTabLabel(tab))} →</button>`;
            return kpis + this.statsGrid([
                this.renderStatsAttention(s),
                this.renderStatsScore(s),
                this.statsPanel({
                    title: this.t('config.statsLastUsed30Title', 'Bookmarks last used, 30 days'),
                    right: goto('usage'),
                    body: this.statsColumns({
                        series: [{ values: activity30.buckets, label: this.t('config.statsActivityUsedLabel', 'bookmarks last used') }],
                        dates: activity30.dateLabels,
                        axisY: this.t('config.statsAxisBookmarksUsed', 'Bookmarks'),
                        axisX: this.statsActivityAxisXLabel(30),
                        aria: this.t('config.statsSparklineAriaView', 'Bookmarks last used per period'),
                        height: 80,
                    }),
                }),
                this.statsPanel({
                    title: this.t('config.statsHealthyShareTitle', 'Healthy share'),
                    right: goto('health'),
                    body: this.renderStatsHealthLine(this._statsTrend || [], { compact: true }),
                }),
            ]);
        },

        statsHealthyKpi(h, series) {
            const label = this.t('config.statsHealthy', 'Healthy');
            if (!h) return { label, value: h === null ? '—' : '…' };
            const total = Math.max(1, h.healthy + h.broken + h.monitorDown + h.content + h.unchecked);
            const pct = Math.round((h.healthy / total) * 100);
            const bad = h.broken + h.monitorDown + h.content;
            const known = series.filter((v) => v !== null);
            return {
                label,
                value: `${pct}%`,
                detail: bad
                    ? this.t('config.statsNotAnswering', '{n} not answering').replace('{n}', this.statsNumber(bad))
                    : this.t('config.statsAllAnswering', 'everything answers'),
                // Red is for a collection in trouble; a few links out of many
                // is something to look at, not an alarm.
                tone: !bad ? 'good' : (pct >= 95 ? 'warn' : 'bad'),
                spark: known.slice(-30),
                sparkRange: [Math.min(90, ...known), 100],
            };
        },

        /** Share of successful checks in a fleet window, or null without samples. */
        statsUptimePct(window) {
            const samples = Number(window?.samples) || 0;
            if (!samples) return null;
            return Math.round((Number(window.ratio) || 0) * 1000) / 10;
        },

        /**
         * What needs doing, each with the button that does it.
         *
         * Replaces three panels that said the same things three ways. A line
         * appears only when its number is above zero: an install with nothing
         * broken is not told so in a list of things to do.
         */
        renderStatsAttention(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            const lines = [];

            const broken = Number(h?.broken || 0) + Number(h?.monitorDown || 0) + Number(h?.content || 0);
            if (broken > 0) {
                lines.push({
                    key: 'broken',
                    tone: 'bad',
                    text: (s.oldestBrokenAt
                        ? this.t('config.statsAttnBrokenOldest', '{n} links are not answering. Longest: {name}, {when}.')
                            .replace('{name}', s.oldestBrokenName || '—')
                            .replace('{when}', this.statsRelativeTime(s.oldestBrokenAt))
                        : this.t('config.statsSummaryBroken', '{n} links are not answering.'))
                        .replace('{n}', this.statsNumber(broken)),
                    button: `<button type="button" class="config-btn config-btn--small" data-stats-action="open-health-view">${esc(this.t('config.statsOpenHealthView', 'Open Health'))}</button>`,
                });
            }

            const certs = this.statsCertificateRows();
            if (certs.length) {
                const first = certs[0];
                lines.push({
                    key: 'certs',
                    tone: first.days < 0 ? 'bad' : 'warn',
                    text: (first.days < 0
                        ? this.t('config.statsAttnCertExpired', 'The certificate for {host} expired {days} days ago.')
                        : this.t('config.statsAttnCertSoon', 'The certificate for {host} expires in {days} days.'))
                        .replace('{host}', first.host)
                        .replace('{days}', String(Math.abs(first.days)))
                        + (certs.length > 1
                            ? ` ${this.t('config.statsAttnCertMore', '{n} more within your warning window.').replace('{n}', String(certs.length - 1))}`
                            : ''),
                    button: `<button type="button" class="config-btn config-btn--small" data-stats-tab-goto="health">${esc(this.t('config.statsCleanupShow', 'Show'))}</button>`,
                });
            }

            const inbox = this.statsInboxFigures();
            if (inbox && inbox.backlog > 0) {
                lines.push({
                    key: 'inbox',
                    tone: 'warn',
                    text: this.t('config.statsAttnInbox', '{n} unread inbox items are older than 30 days.')
                        .replace('{n}', this.statsNumber(inbox.backlog)),
                    button: `<button type="button" class="config-btn config-btn--small" data-stats-tab-goto="inbox">${esc(this.statsTabLabel('inbox'))}</button>`,
                });
            }

            const never = Number(s.neverOpened) || 0;
            const once = Number(s.openedOnce) || 0;
            if (never + once > 0) {
                lines.push({
                    key: 'unused',
                    tone: 'muted',
                    text: this.t('config.statsAttnUnused', '{never} bookmarks never opened, {once} opened only once.')
                        .replace('{never}', this.statsNumber(never))
                        .replace('{once}', this.statsNumber(once)),
                    button: `<button type="button" class="config-btn config-btn--small" data-cleanup-goto="${never ? 'never' : 'once'}">${esc(this.t('config.statsSummaryTidy', 'Work through them'))}</button>`,
                });
            }

            const body = lines.length
                ? `<ul class="config-stats-attention">${lines.map((l) => `
                    <li class="config-stats-attention-row config-stats-attention-row--${l.tone}" data-attention="${l.key}">
                        <span class="config-stats-attention-dot" aria-hidden="true"></span>
                        <span class="config-stats-attention-text">${esc(l.text)}</span>
                        ${l.button}
                    </li>`).join('')}</ul>`
                : `<p class="config-panel-empty">${esc(this.t('config.statsAttnNone', 'Nothing needs attention.'))}</p>`;

            const habit = this.statsHabitSentence(s);
            return this.statsPanel({
                title: this.t('config.statsAttnTitle', 'Needs attention'),
                span: 8,
                body: `${habit ? `<p class="config-panel-note config-stats-headline">${esc(habit)}</p>` : ''}${body}`,
                cls: 'config-stats-summary',
            });
        },

        /**
         * Which way of reaching for a bookmark is yours, in one sentence.
         * Scoped like every figure it is worked out from.
         */
        statsHabitSentence(s) {
            const total = Number(s.total) || 0;
            if (!total) return '';
            const shortcutPct = this.statsPct(s.withShortcut, total);
            const taggedPct = this.statsPct(s.tagged, total);
            const c = s.concentration || {};
            if (!Number(c.usedCount)) {
                return this.t('config.statsHeadlineUnused', 'Nothing has been opened yet, so there is no habit to read from this collection.');
            }
            if (shortcutPct >= 60 && shortcutPct > taggedPct) {
                return this.t('config.statsHeadlineShortcuts',
                    'You reach for bookmarks by keystroke: {pct}% carry a shortcut, against {tagPct}% carrying tags.')
                    .replace('{pct}', String(shortcutPct)).replace('{tagPct}', String(taggedPct));
            }
            if (taggedPct >= 60) {
                return this.t('config.statsHeadlineTags',
                    'You organise by tag: {pct}% of bookmarks carry one, against {shortcutPct}% carrying a shortcut.')
                    .replace('{pct}', String(taggedPct)).replace('{shortcutPct}', String(shortcutPct));
            }
            if (Number(c.share) >= 50) {
                return this.t('config.statsHeadlineNarrow',
                    'A narrow habit on a broad collection: your busiest {top} bookmarks account for {share}% of all opens.')
                    .replace('{top}', String(c.topCount)).replace('{share}', String(c.share));
            }
            return this.t('config.statsHeadlineBroad',
                'Your usage is spread out: {used} of {total} bookmarks have been opened, with no small group dominating.')
                .replace('{used}', String(c.usedCount)).replace('{total}', String(total));
        },

        renderStatsScore(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const { score, details } = s.cleanup;
            const tone = score >= 80 ? 'good' : (score >= 50 ? 'warn' : 'crit');
            const rows = details.map((d) => `
                <li class="config-stat-detail config-stat-detail--${esc(d.type)}">
                    <span>${esc(d.text)}</span>
                    ${d.penalty ? `<span class="config-stat-penalty">−${esc(String(d.penalty))}</span>` : ''}
                </li>`).join('');
            return this.statsPanel({
                title: this.t('config.statsScoreTitle', 'Cleanup score'),
                span: 4,
                info: this.t('config.statsScoreHint', 'Starts at 100 and loses points for bookmarks you never open, links gone stale, duplicate URLs and clashing shortcuts.'),
                body: `
                    <div class="config-score">
                        <span class="config-score-value config-score-value--${tone}">${esc(String(score))}</span>
                        <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}: ${score}/100">
                            <span class="config-bar-fill config-bar-fill--${tone}" style="width:${score}%"></span>
                        </div>
                    </div>
                    <ul class="config-stat-details">${rows}</ul>`,
            });
        },

        /* ------------------------------------------------------------------
         * Usage
         * ------------------------------------------------------------------ */

        renderStatsUsage(s) {
            const all = this.statsScopedBookmarks();
            const c = s.concentration || {};
            const recent = all.filter((b) => Number(b.lastOpened || 0) >= Date.now() - 48 * 3600000).length;
            const kpis = this.statsKpis([
                {
                    label: this.t('config.statsOpensAllTime', 'Opens, all time'),
                    value: this.statsNumber(c.totalOpens || 0),
                    detail: this.t('config.statsBookmarksUsedN', '{n} bookmarks used').replace('{n}', this.statsNumber(c.usedCount || 0)),
                },
                {
                    label: this.t('config.statsUsedInRange', 'Used in {range}').replace('{range}', this.statsRangeLabel(this.statsRange || 30)),
                    value: this.statsNumber(s.activity.activeCount),
                    detail: this.t('config.statsPctOfCollection', '{pct}% of the collection')
                        .replace('{pct}', String(this.statsPct(s.activity.activeCount, s.total))),
                },
                {
                    label: this.t('config.statsLast48h', 'Last 48 hours'),
                    value: this.statsNumber(recent),
                    detail: this.t('config.statsBookmarksOpened', 'bookmarks opened'),
                },
                {
                    label: this.t('config.statsTop10Share', 'Top 10 share'),
                    value: `${c.share || 0}%`,
                    detail: this.t('config.statsOfAllOpens', 'of all opens'),
                },
                {
                    label: this.t('config.statsNeverOpened', 'Never opened'),
                    value: this.statsNumber(s.neverOpened),
                    detail: `${this.statsPct(s.neverOpened, s.total)}%`,
                    tone: s.neverOpened ? 'warn' : undefined,
                },
                {
                    label: this.t('config.statsOpenedOnce', 'Opened once'),
                    value: this.statsNumber(s.openedOnce),
                    detail: `${this.statsPct(s.openedOnce, s.total)}%`,
                    tone: s.openedOnce ? 'warn' : undefined,
                },
            ]);
            return kpis + this.statsGrid([
                this.renderStatsOpens(s, all),
                this.renderStatsHeatmap(all),
                this.renderStatsCurve(all),
                this.renderStatsRecency(all),
                this.renderStatsOpenBands(all),
                ...this.renderStatsTopLists(s),
                this.renderStatsShortcuts(s),
                this.renderStatsOpensByPage(all),
            ]);
        },

        /**
         * Which chart the opens panel shows.
         *
         * The reader's own pick when they made one. Otherwise the real opens
         * from openLog once it reaches back two weeks, and the last-used chart
         * until then: two days of log drawn across a month would read as a
         * collapse in use.
         */
        statsOpensModeFor(span) {
            if (this.statsOpensMode === 'opens' || this.statsOpensMode === 'lastUsed') return this.statsOpensMode;
            return span >= 14 ? 'opens' : 'lastUsed';
        },

        renderStatsOpens(s, all) {
            const esc = (v) => this.dash.escapeHtml(v);
            const range = this.statsRange || 30;
            const log = this.statsOpenLogSeries(all, range);
            const mode = this.statsOpensModeFor(log.span);
            const modes = [
                ['opens', this.t('config.statsModeOpens', 'Opens')],
                ['lastUsed', this.t('config.statsModeLastUsed', 'Last used')],
            ].map(([key, label]) => `<button type="button" class="config-choice${mode === key ? ' is-active' : ''}" data-stats-opens-mode="${key}" aria-pressed="${mode === key}">${esc(label)}</button>`).join('');
            const right = `${this.statsRangeChips('data-stats-range', range)}<div class="config-choices config-choices--compact" role="group" aria-label="${esc(this.t('config.statsModeGroup', 'Measure'))}">${modes}</div>`;

            const dateFmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined, { day: 'numeric', month: 'short' });
            let body;
            let title;
            let info;
            if (mode === 'opens') {
                title = this.t('config.statsOpensTitle', 'Opens over time');
                info = this.t('config.statsOpensInfo', 'Every time a bookmark was opened. nextDash keeps the last 180 days of opens per bookmark.');
                if (!log.total) {
                    body = `<p class="config-panel-empty">${esc(this.t('config.statsOpensEmpty', 'No opens recorded in this period. Opens are kept from the moment this chart arrived, so it fills in as you use your bookmarks.'))}</p>`;
                } else {
                    const labels = log.dates.map((t) => {
                        if (log.bucketDays === 1) return dateFmt.format(new Date(t));
                        const end = new Date(t + (log.bucketDays - 1) * DAY);
                        return `${dateFmt.format(new Date(t))} – ${dateFmt.format(end)}`;
                    });
                    const figures = [`<span><strong>${esc(this.statsNumber(log.total))}</strong> ${esc(this.t('config.statsOpensInPeriod', 'opens in this period'))}</span>`];
                    if (log.prevTotal !== null) {
                        const diff = log.total - log.prevTotal;
                        const pct = log.prevTotal ? Math.round((diff / log.prevTotal) * 100) : null;
                        figures.push(`<span class="config-stat-trend config-stat-trend--${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '▲' : '▼'} ${esc(pct === null
                            ? this.statsNumber(Math.abs(diff))
                            : `${Math.abs(pct)}%`)} ${esc(this.t('config.statsVsPrevious', 'against the {range} before').replace('{range}', this.statsRangeLabel(range)))}</span>`);
                    }
                    if (range > log.span + 1 && log.span < 180) {
                        figures.push(`<span class="config-stat-sub">${esc(this.t('config.statsOpensSince', 'Recorded for {n} days so far.').replace('{n}', String(Math.max(1, log.span))))}</span>`);
                    }
                    body = `<div class="config-stat-figures">${figures.join('')}</div>` + this.statsColumns({
                        series: [{ values: log.buckets, label: this.t('config.statsOpensLabel', 'opens') }],
                        dates: labels,
                        axisY: this.t('config.statsAxisOpens', 'Opens'),
                        axisX: this.statsActivityAxisXLabel(range),
                        aria: this.t('config.statsOpensTitle', 'Opens over time'),
                    });
                }
            } else {
                const a = s.activity;
                title = this.t('config.statsActivityTitle', 'Bookmarks used over time');
                info = this.t('config.statsActivityNote', 'Each bar counts the bookmarks whose last use falls in that period. A bookmark appears once, on the day you last opened it.');
                const noneInPeriod = !a.buckets.length || a.buckets.every((v) => !v);
                body = noneInPeriod
                    ? `<p class="config-panel-empty">${esc(Number(a.totalOpens) > 0
                        ? this.t('config.statsNoActivity', 'No bookmarks were used in this period.')
                        : this.t('config.statsNoActivityEver', 'Nothing has been opened yet, so there is nothing to plot. This fills in as you use your bookmarks.'))}</p>`
                    : `<div class="config-stat-figures">
                            <span><strong>${esc(this.statsNumber(a.activeCount))}</strong> ${esc(this.t('config.statsBookmarksUsedWord', 'bookmarks used'))}</span>
                        </div>
                        <p class="config-chart-summary">${esc(this.statsActivityShape(a))}</p>
                        ${this.statsColumns({
                            series: [{ values: a.buckets, label: this.t('config.statsActivityUsedLabel', 'bookmarks last used') }],
                            dates: a.dateLabels,
                            axisY: this.t('config.statsAxisBookmarksUsed', 'Bookmarks'),
                            axisX: this.statsActivityAxisXLabel(range),
                            aria: this.t('config.statsSparklineAriaView', 'Bookmarks last used per period'),
                        })}`;
            }
            return this.statsPanel({ title, info, right, body, span: 12, id: 'config-stats-opens', cls: `config-stats-opens--${mode}` });
        },

        /** Weekday by hour, from openLog, in the reader's own time. */
        renderStatsHeatmap(all) {
            const esc = (v) => this.dash.escapeHtml(v);
            const { grid, total } = this.statsOpenHeatmap(all);
            const title = this.t('config.statsHeatTitle', 'When you open bookmarks');
            const info = this.t('config.statsHeatInfo', 'Opens by weekday and hour, in your own time zone.');
            const MIN = 20;
            if (total < MIN) {
                return this.statsPanel({
                    title,
                    info,
                    cls: 'config-stats-heat-panel',
                    body: `<p class="config-panel-empty config-stats-heat-empty">${esc(this.t('config.statsHeatEmpty',
                        'Fills in as you open bookmarks. {n} opens recorded so far; the pattern shows from {min}.')
                        .replace('{n}', this.statsNumber(total)).replace('{min}', String(MIN)))}</p>`,
                });
            }
            const weekday = new Intl.DateTimeFormat(this.dash.settings?.language || undefined, { weekday: 'short' });
            // 28 September 2026 is a Monday; the grid is Monday first.
            const days = [0, 1, 2, 3, 4, 5, 6].map((i) => weekday.format(new Date(2026, 8, 28 + i)));
            const max = Math.max(1, ...grid.flat());
            let busiest = [0, 0];
            grid.forEach((row, d) => row.forEach((v, hr) => { if (v > grid[busiest[0]][busiest[1]]) busiest = [d, hr]; }));
            const head = `<span></span>${Array.from({ length: 24 }, (_, hr) => `<span class="config-stats-heat-hour">${hr % 6 === 0 ? hr : ''}</span>`).join('')}`;
            const rows = grid.map((row, d) => `<span class="config-stats-heat-day">${esc(days[d])}</span>${row.map((v, hr) =>
                `<span class="config-stats-heat-cell${v ? '' : ' is-empty'}" style="--heat:${(v / max).toFixed(2)}" title="${esc(days[d])} ${hr}:00 · ${v}"></span>`).join('')}`).join('');
            const summary = this.t('config.statsHeatBusiest', 'Busiest: {day} around {hour}:00, from {n} opens.')
                .replace('{day}', days[busiest[0]]).replace('{hour}', String(busiest[1])).replace('{n}', this.statsNumber(total));
            return this.statsPanel({
                title,
                info,
                cls: 'config-stats-heat-panel',
                body: `<div class="config-stats-heat" role="img" aria-label="${esc(summary)}">${head}${rows}</div>
                    <p class="config-panel-note">${esc(summary)}</p>`,
            });
        },

        /** The running share of opens, from the busiest bookmark down. */
        renderStatsCurve(all) {
            const esc = (v) => this.dash.escapeHtml(v);
            const c = this.statsConcentrationCurve(all);
            const title = this.t('config.statsCurveTitle', 'How concentrated your use is');
            if (!c.total) {
                return this.statsPanel({
                    title,
                    body: `<p class="config-panel-empty">${esc(this.t('config.statsConcentrationEmpty', 'Nothing has been opened yet, so there is no usage to weigh up.'))}</p>`,
                });
            }
            const W = 460;
            const H = 110;
            const L = 34;
            const n = Math.max(1, c.used);
            const x = (rank) => L + (rank / n) * (W - L - 8);
            const y = (pct) => 6 + H - (pct / 100) * H;
            const d = c.points.map(([r, p], i) => `${i ? 'L' : 'M'}${x(r).toFixed(1)} ${y(p).toFixed(1)}`).join('');
            const grid = [0, 50, 100].map((t) => `<line class="config-stats-grid-line" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line><text x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${t}%</text>`).join('');
            const marks = Object.entries(c.marks).map(([rank, pct]) => `<circle class="config-stats-curve-dot" cx="${x(Number(rank)).toFixed(1)}" cy="${y(pct).toFixed(1)}" r="3"></circle>`).join('');
            const ticks = [0, Math.round(n / 2), n].map((t, i) => `<text x="${x(t).toFixed(1)}" y="${H + 22}" text-anchor="${i === 0 ? 'start' : (i === 2 ? 'end' : 'middle')}">${t}</text>`).join('');
            const markRows = Object.entries(c.marks).map(([rank, pct]) => [
                this.t('config.statsConcentrationTop', 'Top {n}').replace('{n}', rank), pct, { display: `${pct}%` },
            ]);
            const top = Math.min(10, c.used);
            const sentence = this.t('config.statsConcentrationBody', 'Your top {top} bookmarks account for {share}% of all {total} opens.')
                .replace('{top}', String(top))
                .replace('{share}', String(c.points[top][1]))
                .replace('{total}', this.statsNumber(c.total));
            return this.statsPanel({
                title,
                info: this.t('config.statsCurveInfo', 'Bookmarks ranked by opens (across) against their running share of all opens (up). The dashed line is perfectly even use.'),
                body: `
                    <div class="config-stats-curve">
                        <svg viewBox="0 0 ${W} ${H + 28}" role="img" aria-label="${esc(sentence)}">
                            ${grid}
                            <path class="config-stats-curve-even" d="M${x(0)} ${y(0)} L${x(n)} ${y(100)}"></path>
                            <path class="config-stats-curve-area" d="${d} L${x(n)} ${y(0)} Z"></path>
                            <path class="config-stats-curve-line" d="${d}"></path>
                            ${marks}
                            ${ticks}
                        </svg>
                    </div>
                    <p class="config-panel-note">${esc(sentence)}</p>
                    ${this.statsBars(markRows, { max: 100 })}`,
            });
        },

        renderStatsRecency(all) {
            const labels = {
                lt7: this.t('config.statsRecLt7', 'Less than 7 days ago'),
                d7_30: this.t('config.statsRec7to30', '7 to 30 days ago'),
                d30_90: this.t('config.statsRec30to90', '30 to 90 days ago'),
                gt90: this.t('config.statsRecGt90', 'Over 90 days ago'),
                never: this.t('config.statsRecNever', 'Never'),
            };
            const tones = { d30_90: 'warn', gt90: 'warn', never: 'crit' };
            return this.statsPanel({
                title: this.t('config.statsRecencyTitle', 'Last opened'),
                info: this.t('config.statsRecencyInfo', 'Every bookmark by when it was last opened.'),
                body: this.statsBars(this.statsRecency(all).map(([k, n]) => [labels[k], n, { tone: tones[k] }]),
                    { axis: [this.t('config.statsAxisLastOpened', 'Last opened'), this.t('config.statsAxisBookmarks', 'Bookmarks')] }),
            });
        },

        renderStatsOpenBands(all) {
            const labels = {
                0: this.t('config.statsBandNever', 'Never'),
                1: this.t('config.statsBandOnce', 'Once'),
                '2-4': this.t('config.statsBand2to4', '2 to 4 times'),
                '5-9': this.t('config.statsBand5to9', '5 to 9 times'),
                '10+': this.t('config.statsBand10', '10 times or more'),
            };
            return this.statsPanel({
                title: this.t('config.statsBandsTitle', 'Times opened'),
                body: this.statsBars(this.statsOpenCountBands(all).map(([k, n]) => [labels[k], n, {
                    tone: k === '0' ? 'crit' : (k === '1' ? 'warn' : ''),
                }]), { axis: [this.t('config.statsAxisOpened', 'Opened'), this.t('config.statsAxisBookmarks', 'Bookmarks')] }),
            });
        },

        /** Most opened and most used tags, eight rows each. */
        renderStatsTopLists(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const totals = s.listTotals || {};
            const opened = s.topOpened.length
                ? this.statsBars(s.topOpened.map(([label, n]) => [label, n, { goto: `bookmark:${label}` }]),
                    { axis: [this.t('config.statsAxisBookmark', 'Bookmark'), this.t('config.statsAxisOpens', 'Opens')] })
                    + this.statsListTruncationNote(s.topOpened.length, totals.topOpened)
                : `<p class="config-panel-empty">${esc(this.t('config.statsNoOpens', 'Nothing has been opened yet.'))}</p>`;
            const tags = s.topTags.length
                ? this.statsBars(s.topTags.map(([label, n]) => [label, n, { goto: `tag:${label}` }]),
                    { axis: [this.t('config.statsAxisTag', 'Tag'), this.t('config.statsAxisBookmarks', 'Bookmarks')] })
                    + this.statsListTruncationNote(s.topTags.length, totals.topTags)
                : `<p class="config-panel-empty">${esc(this.t('config.noTagsYet', 'No tags yet.'))}</p>`;
            return [
                this.statsPanel({ title: this.t('config.statsTopOpened', 'Most opened'), body: opened }),
                this.statsPanel({ title: this.t('config.statsTopTags', 'Most used tags'), body: tags }),
            ];
        },

        /** The shortcuts that earn their keystroke, and the ones that never did. */
        renderStatsShortcuts(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const all = this.statsScopedBookmarks();
            const withShortcut = all.filter((b) => String(b.shortcut || '').trim());
            const unused = withShortcut.filter((b) => !Number(b.openCount)).length;
            const rows = [...withShortcut]
                .sort((a, b) => (Number(b.openCount) || 0) - (Number(a.openCount) || 0))
                .slice(0, DashboardConfig.STATS_LIST_LIMIT)
                .map((b) => [`${String(b.shortcut).toUpperCase()} · ${b.name || b.url}`, Number(b.openCount) || 0]);
            const body = `
                <p class="config-panel-note">${esc(this.t('config.statsShortcutCoverage', '{count} of {total} bookmarks have a shortcut ({pct}%)')
                    .replace('{count}', String(s.withShortcut))
                    .replace('{total}', String(s.total))
                    .replace('{pct}', String(this.statsPct(s.withShortcut, s.total))))}</p>
                ${rows.length
                    ? this.statsBars(rows, { axis: [this.t('config.statsColShortcut', 'Shortcut'), this.t('config.statsAxisOpens', 'Opens')] })
                    : `<p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>`}
                ${unused ? `<p class="config-panel-note">${esc(this.t('config.statsShortcutsUnused', 'Shortcuts on bookmarks never opened: {n}.')
                    .replace('{n}', this.statsNumber(unused)))}</p>` : ''}`;
            return this.statsPanel({ title: this.t('config.statsShortcutsTitle', 'Shortcuts'), body, id: 'config-stats-shortcuts' });
        },

        /** Opens by page, with the finders underneath. */
        renderStatsOpensByPage(all) {
            const pages = this.statsScopedPages();
            const tones = ['a', 'b', 'c', 'muted'];
            const parts = pages.map((p) => [
                p.name || `#${p.id}`,
                all.filter((b) => String(b.pageId) === String(p.id)).reduce((n, b) => n + (Number(b.openCount) || 0), 0),
            ]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
            const top = parts.slice(0, 3);
            const rest = parts.slice(3).reduce((n, [, v]) => n + v, 0);
            if (rest) top.push([this.t('config.statsOtherPages', 'Other pages'), rest]);
            return this.statsPanel({
                title: this.t('config.statsOpensByPage', 'Opens by page'),
                body: `${top.length ? this.statsStack(top.map(([label, n], i) => [label, n, tones[i]])) : ''}
                    <div id="config-stats-finders">${this.renderStatsFinders()}</div>`,
            });
        },

        /** Finders, with their use counts. Loaded on their own. */
        renderStatsFinders() {
            const esc = (v) => this.dash.escapeHtml(v);
            const heading = `<h4 class="config-theme-group-title">${esc(this.t('config.statsFindersTitle', 'Finders'))}</h4>`;
            if (this._statsFinders === undefined) {
                return `${heading}<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            const finders = this._statsFinders || [];
            if (!finders.length) {
                return `${heading}<p class="config-panel-empty">${esc(this.t('config.findersEmpty', 'No finders yet.'))}</p>`;
            }
            const totalUses = finders.reduce((n, f) => n + (Number(f.useCount) || 0), 0);
            const rows = [...finders]
                .sort((a, b) => (Number(b.useCount) || 0) - (Number(a.useCount) || 0))
                .slice(0, 5)
                .map((f) => [f.name || '—', this.statsNumber(Number(f.useCount) || 0), '', f.shortcut ? String(f.shortcut) : '']);
            return `${heading}<p class="config-panel-note">${esc(this.t('config.statsFindersLine', '{n} finders, used {uses} times.')
                .replace('{n}', this.statsNumber(finders.length)).replace('{uses}', this.statsNumber(totalUses)))}</p>${this.statsFacts(rows)}`;
        },

        /* ------------------------------------------------------------------
         * Collection
         * ------------------------------------------------------------------ */

        renderStatsCollection(s) {
            const all = this.statsScopedBookmarks();
            const domains = this.statsDomains(all);
            const noPreview = all.filter((b) => !String(b.previewTitle || '').trim()
                && !String(b.previewDesc || '').trim() && !String(b.previewImage || '').trim()).length;
            const uncategorised = all.filter((b) => !b.category).length;
            const kpis = this.statsKpis([
                {
                    label: this.t('config.statsBookmarks', 'Bookmarks'),
                    value: this.statsNumber(s.total),
                },
                {
                    label: this.t('config.statsPages', 'Pages'),
                    value: this.statsNumber(s.perPage.length),
                    detail: s.emptyPages ? this.t('config.statsPlusEmpty', '+ {n} empty').replace('{n}', String(s.emptyPages)) : '',
                },
                {
                    label: this.t('config.statsCategoryCount', 'Categories'),
                    value: this.statsNumber(s.categories),
                    detail: uncategorised ? this.t('config.statsUncategorisedN', '{n} uncategorised').replace('{n}', String(uncategorised)) : '',
                },
                {
                    label: this.t('config.statsTagCount', 'Distinct tags'),
                    value: this.statsNumber(s.tagCount),
                    detail: this.t('config.statsTaggedN', '{n} bookmarks tagged').replace('{n}', this.statsNumber(s.tagged)),
                },
                {
                    label: this.t('config.statsUniqueHosts', 'Unique hosts'),
                    value: this.statsNumber(domains.unique),
                    detail: this.t('config.statsSelfHostedN', '{n} self-hosted').replace('{n}', this.statsNumber(domains.selfHosted)),
                },
                {
                    label: this.t('config.statsNoPreview', 'Without preview'),
                    value: this.statsNumber(noPreview),
                    detail: `${this.statsPct(noPreview, s.total)}%`,
                    tone: noPreview ? 'warn' : undefined,
                },
            ]);
            return kpis + this.statsGrid([
                this.renderStatsRatios(s),
                this.renderStatsCategories(s),
                this.renderStatsGrowth(),
                this.renderStatsAge(all),
                this.renderStatsDomains(domains),
                this.renderStatsTagBands(all, domains),
                this.renderStatsPerPage(s),
                this.renderStatsLibrary(),
                this.renderStatsCleanup(s),
            ]);
        },

        /** Coverage bars: how much of the collection carries each thing. */
        renderStatsRatios(s) {
            const row = (label, n) => [label, n, { display: `${this.statsNumber(n)} · ${this.statsPct(n, s.total)}%` }];
            return this.statsPanel({
                title: this.t('config.statsCoverageTitle', 'Coverage'),
                body: this.statsScaleCaption(this.t('config.statsAxisShareOfCollection',
                    'Share of all {total} bookmarks — 0% to 100%').replace('{total}', String(s.total)))
                    + this.statsBars([
                        row(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut),
                        row(this.t('config.statsWithIcon', 'With an icon'), s.withIcon),
                        row(this.t('config.statsCheckedOrMonitored', 'Checked or monitored'), s.checked),
                        row(this.t('config.statsTaggedBookmarks', 'Tagged'), s.tagged),
                        row(this.t('config.statsWithNote', 'With a note'), s.withNote),
                    ], { max: s.total }),
            });
        },

        /**
         * Size and use per category, side by side.
         *
         * Size alone hides the interesting case, a large category nobody opens,
         * and use alone hides how much is in it. Both bars scale to their own
         * largest row, so neither looks empty beside the other.
         */
        renderStatsCategories(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const title = this.t('config.statsCategoriesTitle', 'Categories: size and use');
            const eff = new Map((s.categoryEffectiveness || []).map((c) => [c.label, c]));
            const all = s.perCategory || [];
            const rows = all.slice(0, DashboardConfig.STATS_LIST_LIMIT);
            if (!rows.length) {
                return this.statsPanel({ title, body: `<p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>` });
            }
            const maxSize = Math.max(1, ...rows.map(([, n]) => n));
            const maxUse = Math.max(0.1, ...[...eff.values()].map((c) => c.perBookmark));
            const body = `
                <div class="config-stats-pair" role="table" aria-label="${esc(title)}">
                    <div class="config-stats-pair-row config-stats-pair-head" role="row">
                        <span role="columnheader">${esc(this.t('config.statsAxisCategory', 'Category'))}</span>
                        <span role="columnheader">${esc(this.t('config.statsAxisBookmarks', 'Bookmarks'))}</span>
                        <span role="columnheader">${esc(this.t('config.statsAxisOpensPerBookmark', 'Opens per bookmark'))}</span>
                    </div>
                    ${rows.map(([label, n]) => {
                        const c = eff.get(label);
                        const per = c ? c.perBookmark : null;
                        const detail = c ? this.t('config.statsCategoryEffDetail', '{opens} opens over {count} bookmarks')
                            .replace('{opens}', String(c.opens)).replace('{count}', String(c.count)) : '';
                        const name = c
                            ? `<button type="button" class="config-dist-label config-dist-label--link" data-stats-goto="category:${esc(label)}" title="${esc(detail)}">${esc(label)}</button>`
                            : `<span class="config-dist-label">${esc(label)}</span>`;
                        const use = per === null
                            ? '<span class="config-dist-count">—</span>'
                            : `<span class="config-bar config-bar--slim"><span class="config-bar-fill config-bar-fill--${per < 1.5 ? 'warn' : 'b'}" style="width:${Math.round((per / maxUse) * 100)}%"></span></span><span class="config-dist-count">${esc(per.toFixed(1))}</span>`;
                        return `
                        <div class="config-stats-pair-row" role="row">
                            <span role="cell">${name}</span>
                            <span role="cell" class="config-stats-pair-cell"><span class="config-bar config-bar--slim"><span class="config-bar-fill" style="width:${Math.round((n / maxSize) * 100)}%"></span></span><span class="config-dist-count">${esc(this.statsNumber(n))}</span></span>
                            <span role="cell" class="config-stats-pair-cell">${use}</span>
                        </div>`;
                    }).join('')}
                </div>
                ${this.statsListTruncationNote(rows.length, all.length)}`;
            return this.statsPanel({
                title,
                info: this.t('config.statsCategoryEffNote', 'How often a bookmark in this category gets opened. A low figure on a large category is one you built but do not use.'),
                body,
            });
        },

        /** Added per month over twelve fixed months, with the running total. */
        renderStatsGrowth() {
            const esc = (v) => this.dash.escapeHtml(v);
            const all = this.statsScopedBookmarks();
            const g = this.statsGrowthMonths(all);
            const dated = all.length - g.undated;
            const title = this.t('config.statsGrowthTitle', 'How the collection grew');
            if (!dated) {
                return this.statsPanel({
                    title,
                    body: `<p class="config-panel-empty">${esc(this.t('config.statsGrowthNone', 'None of these bookmarks carry the date they were saved, so there is no growth to draw.'))}</p>`,
                });
            }
            const monthLabel = (key) => {
                const [year, month] = String(key).split('-');
                try {
                    return new Date(Number(year), Number(month) - 1, 1)
                        .toLocaleDateString(this.dash.settings?.language || undefined, { month: 'short' });
                } catch {
                    return key;
                }
            };
            return this.statsPanel({
                title,
                note: g.undated
                    ? this.t('config.statsGrowthPartial',
                        'Counted from the {dated} of {total} bookmarks that carry a date. Older ones were saved before nextDash recorded it.')
                        .replace('{dated}', this.statsNumber(dated)).replace('{total}', this.statsNumber(all.length))
                    : '',
                body: this.statsColumns({
                    series: [{ values: g.months.map(([, n]) => n), label: this.t('config.statsAxisAdded', 'Added') }],
                    dates: g.months.map(([key]) => monthLabel(key)),
                    axisY: this.t('config.statsAxisAdded', 'Added'),
                    axisX: this.t('config.statsAxisMonth', 'Month'),
                    aria: title,
                    line: g.running,
                    lineLabel: this.t('config.statsRunningTotal', 'Running total'),
                    height: 90,
                }),
            });
        },

        renderStatsAge(all) {
            const labels = {
                lt30: this.t('config.statsAgeLt30', 'Under 30 days'),
                d30_90: this.t('config.statsAge30to90', '30 to 90 days'),
                d90_180: this.t('config.statsAge90to180', '90 to 180 days'),
                gt180: this.t('config.statsAgeGt180', 'Over 180 days'),
                undated: this.t('config.statsAgeUndated', 'No date'),
            };
            return this.statsPanel({
                title: this.t('config.statsAgeTitle', 'Age of the collection'),
                info: this.t('config.statsAgeInfo', 'How long ago each bookmark was saved. Bookmarks saved before nextDash recorded the date have none.'),
                body: this.statsBars(this.statsAge(all).map(([k, n]) => [labels[k], n, { tone: k === 'undated' ? 'muted' : '' }]),
                    { axis: [this.t('config.statsAxisSaved', 'Saved'), this.t('config.statsAxisBookmarks', 'Bookmarks')] }),
            });
        },

        renderStatsDomains(d) {
            const esc = (v) => this.dash.escapeHtml(v);
            const rows = d.hosts.slice(0, 6).map(([host, n]) => [host, n]);
            return this.statsPanel({
                title: this.t('config.statsDomainsTitle', 'Top domains'),
                info: this.t('config.statsDomainsInfo', 'Self-hosted counts addresses on your own network: IP addresses, localhost, and names ending in .local, .lan, .home, .internal or .ts.net.'),
                body: (rows.length
                    ? this.statsBars(rows, { axis: [this.t('config.statsAxisHost', 'Host'), this.t('config.statsAxisBookmarks', 'Bookmarks')] })
                    : `<p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>`)
                    + this.statsStack([
                        [this.t('config.statsInternet', 'Internet'), d.internet, 'b'],
                        [this.t('config.statsSelfHosted', 'Self-hosted'), d.selfHosted, 'a'],
                    ]),
            });
        },

        renderStatsTagBands(all, domains) {
            const esc = (v) => this.dash.escapeHtml(v);
            const labels = {
                0: this.t('config.statsTagsNone', 'No tags'),
                1: this.t('config.statsTagsOne', 'One tag'),
                2: this.t('config.statsTagsTwo', 'Two tags'),
                '3+': this.t('config.statsTagsThree', 'Three or more'),
            };
            const tlds = domains.tlds.slice(0, 4).map(([tld, n]) => `.${tld} ${this.statsNumber(n)}`).join(' · ');
            return this.statsPanel({
                title: this.t('config.statsTagBandsTitle', 'Tags per bookmark'),
                body: this.statsBars(this.statsTagsPerBookmark(all).map(([k, n]) => [labels[k], n, { tone: k === '0' ? 'warn' : '' }]),
                    { axis: [this.t('config.statsAxisTags', 'Tags'), this.t('config.statsAxisBookmarks', 'Bookmarks')] })
                    + (tlds ? `<p class="config-panel-note">${esc(this.t('config.statsTlds', 'Top-level domains: {list}').replace('{list}', tlds))}</p>` : ''),
            });
        },

        renderStatsPerPage(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            return this.statsPanel({
                title: this.t('config.statsPerPage', 'Bookmarks per page'),
                body: this.statsBars(s.perPage, { axis: [this.t('config.statsAxisPage', 'Page'), this.t('config.statsAxisBookmarks', 'Bookmarks')] })
                    + (s.emptyPages ? `<p class="config-panel-note config-stats-empty-pages">${esc(this.t('config.statsEmptyPages', '{n} pages without bookmarks')
                        .replace('{n}', String(s.emptyPages)))}</p>` : ''),
            });
        },

        /** What is in the dashboard besides bookmarks. Filled by its loader. */
        renderStatsLibrary() {
            return this.statsPanel({
                title: this.t('config.statsLibraryTitle', 'Beyond bookmarks'),
                info: this.t('config.statsLibraryHint', 'The rest of what this install holds — blocks on your pages, what feeds them, and what it keeps.'),
                body: `<div id="config-stats-library">${this.renderStatsLibraryBody()}</div>`,
            });
        },

        renderStatsLibraryBody() {
            const esc = (v) => this.dash.escapeHtml(v);
            const lib = this._statsLibrary;
            if (lib === undefined) {
                return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            if (!lib) {
                return `<p class="config-panel-empty">${esc(this.t('config.statsLibraryUnavailable', 'These figures could not be read.'))}</p>`;
            }
            // A figure that could not be fetched is left out, not shown as zero.
            // Checked before formatting: statsNumber(null) is '', which is not
            // null, so formatting first let every missing figure through.
            const rows = [];
            const add = (label, value, detail, format = true) => {
                if (value === null || value === undefined) return;
                rows.push([label, format ? this.statsNumber(value) : value, '', detail || '']);
            };
            const types = lib.widgetTypes || [];
            add(this.t('config.statsLibraryWidgets', 'Widgets on your pages'),
                lib.widgets,
                types.length
                    ? types.slice(0, 4).map(([type, n]) => `${this.widgetTypeName(type)} ${this.statsNumber(n)}`).join(' · ')
                    : '');
            add(this.t('config.statsLibraryFeeds', 'Feeds'), lib.feeds,
                lib.feedsEnabled === false ? this.t('config.statsLibraryOff', 'switched off') : '');
            add(this.t('config.statsLibrarySources', 'Import sources'), lib.sources);
            add(this.t('config.statsLibraryTrash', 'Waiting in the trash'), lib.trash);
            add(this.t('config.statsLibraryBackups', 'Automatic backups kept'), lib.backups,
                lib.backupsEnabled === false ? this.t('config.statsLibraryOff', 'switched off') : '');
            // The newest whole-page copy kept on this disk, from the health
            // report. archiveCheckedAt, which this used to read, is when the
            // archive.org index was last asked, not when anything was kept.
            const h = this._statsHealth;
            if (h && Number(h.newestCopyAt)) {
                add(this.t('config.statsLibraryNewestCopy', 'Newest local copy'),
                    this.statsRelativeTime(h.newestCopyAt), h.newestCopyName, false);
            }
            if (!rows.length) {
                return `<p class="config-panel-empty">${esc(this.t('config.statsLibraryUnavailable', 'These figures could not be read.'))}</p>`;
            }
            return this.statsFacts(rows);
        },

        /** Cleanup candidates, each with a button that opens the list behind it. */
        renderStatsCleanup(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const rows = [
                ['untagged', s.untagged, this.t('config.statsCleanupUntaggedHint', 'Harder to find by search')],
                ['once', s.openedOnce, this.t('config.statsCleanupOnceHint', 'Tried once, then dropped')],
                ['noicon', s.missingIcon, this.t('config.statsCleanupNoIconHint', 'Falls back to a letter tile')],
                ['never', s.neverOpened, this.t('config.statsCleanupNeverHint', 'Added but never used')],
                ['insecure', s.insecure, this.t('config.statsCleanupInsecureHint', 'Plain http, no encryption')],
            ].filter(([, n]) => Number(n) > 0);
            const body = rows.length
                ? `<ul class="config-stat-details config-stats-cleanup">${rows.map(([key, n, hint]) => `
                    <li class="config-stat-detail">
                        <span>${esc(this.cleanupFilterLabel(key))} <span class="config-stat-sub">${esc(hint)}</span></span>
                        <span class="config-cleanup-actions">
                            <span class="config-stat-penalty">${esc(this.statsNumber(n))}</span>
                            <button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(key)}">${esc(this.t('config.statsCleanupShow', 'Show'))}</button>
                        </span>
                    </li>`).join('')}</ul>`
                : `<p class="config-panel-empty">${esc(this.t('config.statsCleanupNone', 'Nothing to tidy up.'))}</p>`;
            return this.statsPanel({
                title: this.t('config.statsCleanupTitle', 'Cleanup candidates'),
                info: this.t('config.statsCleanupNote', 'Each opens the matching bookmarks, where they can be tagged or removed in bulk.'),
                body,
                span: 12,
            });
        },

        /* ------------------------------------------------------------------
         * Inbox
         * ------------------------------------------------------------------ */

        /**
         * The inbox figures the tiles and the attention list share, or null
         * while the inbox has not been fetched.
         */
        statsInboxFigures() {
            if (this._statsInboxItems === undefined) return null;
            const items = this._statsInboxItems || [];
            const now = Date.now();
            const unread = items.filter((it) => !Number(it?.readAt));
            const cutoff = now - 30 * DAY;
            const oldest = unread.reduce((min, it) => {
                const added = Number(it?.addedAt || 0);
                return added > 0 && added < min ? added : min;
            }, Number.POSITIVE_INFINITY);
            return {
                items,
                unread: unread.length,
                read: items.length - unread.length,
                backlog: unread.filter((it) => Number(it?.addedAt || 0) > 0 && Number(it.addedAt) < cutoff).length,
                oldestUnreadAt: Number.isFinite(oldest) ? oldest : 0,
                unreadList: unread,
            };
        },

        renderStatsInbox() {
            const esc = (v) => this.dash.escapeHtml(v);
            // The line under the tabs already says what this tab is for.
            return `
                ${this.statsScopeNote()}
                <div id="config-stats-inbox">${this.renderStatsInboxBody()}</div>`;
        },

        /** A source key as words: `keep-undo` is not something a reader said. */
        statsInboxSourceLabel(key) {
            const map = {
                extension: ['config.statsInboxSourceExtension', 'Browser extension'],
                paste: ['config.statsInboxSourcePaste', 'Pasted'],
                share: ['config.statsInboxSourceShare', 'Share sheet'],
                'keep-undo': ['config.statsInboxSourceKeepUndo', 'Back from Unsorted'],
                unsorted: ['config.statsInboxSourceUnsorted', 'Unsorted'],
                unknown: ['config.statsInboxSourceUnknown', 'Not recorded'],
            };
            const [k, fallback] = map[key] || [`config.statsInboxSource${key.charAt(0).toUpperCase()}${key.slice(1)}`, key];
            return this.t(k, fallback);
        },

        renderStatsInboxBody() {
            const esc = (v) => this.dash.escapeHtml(v);
            const f = this.statsInboxFigures();
            if (!f) {
                return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            const agg = this._statsInboxAgg || {};
            const items = f.items;
            const now = Date.now();
            const promoted = Number(agg.totalPromoted || 0);
            const deleted = Number(agg.totalDeleted || 0);
            // Promoted and deleted are the two ways a link leaves the inbox.
            // Kept is recorded on every mark-read, so it is not triage.
            const triaged = promoted + deleted;
            const conversion = triaged > 0 ? Math.round((promoted / triaged) * 100) : null;
            const avgRetention = Number(agg.retentionCount || 0) > 0
                ? Number(agg.sumRetentionMs || 0) / Number(agg.retentionCount)
                : 0;
            const flow = this.statsInboxFlow(agg);
            const range = this.statsInboxRange || 30;

            const kpis = this.statsKpis([
                {
                    label: this.t('config.statsInboxTotal', 'Inbox items'),
                    value: this.statsNumber(items.length),
                    detail: this.t('config.statsInboxUnreadRead', '{unread} unread · {read} read')
                        .replace('{unread}', this.statsNumber(f.unread)).replace('{read}', this.statsNumber(f.read)),
                },
                {
                    label: this.t('config.statsInboxBacklog', 'Unread > 30d'),
                    value: this.statsNumber(f.backlog),
                    detail: this.t('config.statsInboxOfUnread', 'of {n} unread').replace('{n}', this.statsNumber(f.unread)),
                    tone: f.backlog ? 'warn' : undefined,
                },
                {
                    label: this.t('config.statsInboxOldestUnread', 'Oldest unread'),
                    value: f.oldestUnreadAt ? this.formatDurationShort(now - f.oldestUnreadAt) : '—',
                    tone: f.oldestUnreadAt && now - f.oldestUnreadAt > 30 * DAY ? 'warn' : undefined,
                },
                {
                    label: this.t('config.statsInboxBacklogChange', 'Backlog, {range}').replace('{range}', this.statsRangeLabel(range)),
                    value: flow ? `${flow.net > 0 ? '+' : (flow.net < 0 ? '−' : '')}${this.statsNumber(Math.abs(flow.net))}` : '—',
                    detail: flow ? this.t('config.statsInboxInOut', '{in} in · {out} out')
                        .replace('{in}', this.statsNumber(flow.added)).replace('{out}', this.statsNumber(flow.triaged)) : '',
                    tone: flow && flow.net > 0 ? 'warn' : (flow && flow.net < 0 ? 'good' : undefined),
                    spark: flow ? flow.running : null,
                },
                {
                    label: this.t('config.statsInboxConvertedKpi', 'Converted'),
                    value: conversion === null ? '—' : `${conversion}%`,
                    detail: this.t('config.statsInboxOfTriaged', '{promoted} of {triaged} triaged')
                        .replace('{promoted}', this.statsNumber(promoted)).replace('{triaged}', this.statsNumber(triaged)),
                },
                {
                    label: this.t('config.statsInboxTriageKpi', 'Time to triage'),
                    detail: this.t('config.statsInboxTriageDetail', 'on average'),
                    value: this.formatDurationShort(avgRetention),
                },
            ]);

            return kpis + this.statsGrid([
                this.renderStatsInboxTrend(flow),
                this.renderStatsInboxOutcome(agg, items),
                this.renderStatsInboxAge(f),
                this.renderStatsInboxSources(agg, items),
                this.renderStatsInboxComplete(items),
            ]);
        },

        /**
         * Inbox flow per day over the inbox's own range.
         *
         * Days with no events are absent from the map, not zero, so they are
         * filled. The keys are UTC days, which is how the server buckets them,
         * and the labels are the same UTC dates.
         */
        statsInboxFlow(agg) {
            const daily = agg?.dailyBuckets && typeof agg.dailyBuckets === 'object' ? agg.dailyBuckets : null;
            if (!daily || !Object.keys(daily).length) return null;
            const days = this.statsInboxRange || 30;
            const today = Date.now();
            const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            const series = [];
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today - i * DAY);
                const b = daily[iso(date)] || {};
                series.push({
                    date,
                    added: Number(b.added || 0),
                    triaged: Number(b.promoted || 0) + Number(b.deleted || 0),
                });
            }
            let run = 0;
            const running = series.map((d) => (run += d.added - d.triaged));
            const added = series.reduce((n, d) => n + d.added, 0);
            const triaged = series.reduce((n, d) => n + d.triaged, 0);
            return { series, running, added, triaged, net: added - triaged };
        },

        renderStatsInboxTrend(flow) {
            const esc = (v) => this.dash.escapeHtml(v);
            const title = this.t('config.statsInboxTrendTitle', 'Inbox flow per day');
            const right = this.statsRangeChips('data-stats-inbox-range', this.statsInboxRange || 30, [7, 30, 90]);
            const info = this.t('config.statsInboxTrendInfo', 'What arrived against what you dealt with, recorded per day as it happened. Days are counted in UTC.');
            const panel = (body) => this.statsPanel({ title, right, info, span: 12, body, id: 'config-stats-inbox-flow' });
            // No history at all: the panel is left out, as before. An empty
            // window inside existing history is a different answer, below.
            if (!flow) return '';
            if (!flow.added && !flow.triaged) {
                return panel(`<p class="config-panel-empty">${esc(this.t('config.statsInboxTrendEmpty', 'No inbox activity in this period.'))}</p>`);
            }
            const fmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
            const addedLabel = this.t('config.statsInboxTrendAdded', 'Added');
            const triagedLabel = this.t('config.statsInboxTrendTriaged', 'Dealt with');
            return panel(`
                <div class="config-stat-figures">
                    <span><strong>${esc(this.statsNumber(flow.added))}</strong> ${esc(addedLabel.toLowerCase())}</span>
                    <span><strong>${esc(this.statsNumber(flow.triaged))}</strong> ${esc(triagedLabel.toLowerCase())}</span>
                    <span class="config-stat-trend config-stat-trend--${flow.net > 0 ? 'down' : 'up'}">${esc(flow.net > 0
                        ? this.t('config.statsInboxTrendGrowing', 'backlog grew by {n}').replace('{n}', String(flow.net))
                        : this.t('config.statsInboxTrendShrinking', 'backlog shrank by {n}').replace('{n}', String(Math.abs(flow.net))))}</span>
                </div>
                ${this.statsColumns({
                    series: [
                        { values: flow.series.map((d) => d.added), label: addedLabel },
                        { values: flow.series.map((d) => d.triaged), label: triagedLabel },
                    ],
                    dates: flow.series.map((d) => fmt.format(d.date)),
                    axisY: this.t('config.statsInboxTrendAxisY', 'Items'),
                    axisX: this.t('config.statsAxisPerDayUtc', 'Day in UTC (oldest → newest)'),
                    aria: title,
                    line: flow.running,
                    lineLabel: this.t('config.statsInboxBacklogLine', 'Backlog change, running'),
                })}`);
        },

        renderStatsInboxOutcome(agg, items) {
            const esc = (v) => this.dash.escapeHtml(v);
            const since = Number(agg.firstEventAt || 0) > 0
                ? new Intl.DateTimeFormat(this.dash.settings?.language || undefined, { day: 'numeric', month: 'long', year: 'numeric' })
                    .format(new Date(Number(agg.firstEventAt)))
                : '';
            return this.statsPanel({
                title: this.t('config.statsInboxOutcomeTitle', 'Where everything went'),
                body: this.statsStack([
                    [this.t('config.statsInboxPromotedLong', 'Converted to a bookmark'), Number(agg.totalPromoted || 0), 'a'],
                    [this.t('config.statsInboxDeleted', 'Discarded'), Number(agg.totalDeleted || 0), 'crit'],
                    [this.t('config.statsInboxStill', 'Still in the inbox'), items.length, 'b'],
                ]) + (since ? `<p class="config-panel-note">${esc(this.t('config.statsInboxSince', 'Lifetime counters since {date}.').replace('{date}', since))}</p>` : ''),
            });
        },

        renderStatsInboxAge(f) {
            const now = Date.now();
            const bands = { lt1: 0, d1_7: 0, d7_30: 0, gt30: 0 };
            f.unreadList.forEach((it) => {
                const added = Number(it?.addedAt || 0);
                if (!added) return;
                const age = (now - added) / DAY;
                if (age < 1) bands.lt1 += 1;
                else if (age < 7) bands.d1_7 += 1;
                else if (age < 30) bands.d7_30 += 1;
                else bands.gt30 += 1;
            });
            return this.statsPanel({
                title: this.t('config.statsInboxAgeTitle', 'How long unread items have waited'),
                body: this.statsBars([
                    [this.t('config.statsInboxAgeLt1', 'Under a day'), bands.lt1],
                    [this.t('config.statsInboxAge1to7', '1 to 7 days'), bands.d1_7],
                    [this.t('config.statsInboxAge7to30', '7 to 30 days'), bands.d7_30, { tone: 'warn' }],
                    [this.t('config.statsInboxAgeGt30', 'Over 30 days'), bands.gt30, { tone: 'crit' }],
                ], { axis: [this.t('config.statsAxisWaiting', 'Waiting'), this.t('config.statsAxisItems', 'Items')] }),
            });
        },

        renderStatsInboxSources(agg, items) {
            const esc = (v) => this.dash.escapeHtml(v);
            const current = new Map();
            items.forEach((it) => {
                const key = String(it?.source || '').trim() || 'unknown';
                current.set(key, (current.get(key) || 0) + 1);
            });
            const lifetime = agg.bySource && typeof agg.bySource === 'object' ? agg.bySource : {};
            const keys = [...new Set([...current.keys(), ...Object.keys(lifetime)])]
                .sort((a, b) => (Number(lifetime[b]) || 0) - (Number(lifetime[a]) || 0));
            if (!keys.length) return '';
            const max = Math.max(1, ...keys.map((k) => Math.max(current.get(k) || 0, Number(lifetime[k]) || 0)));
            const rows = keys.map((k) => {
                const now = current.get(k) || 0;
                const ever = Number(lifetime[k]) || 0;
                return `
                    <div class="config-stats-pair-row" role="row">
                        <span role="cell" class="config-dist-label">${esc(this.statsInboxSourceLabel(k))}</span>
                        <span role="cell" class="config-stats-pair-cell"><span class="config-bar config-bar--slim"><span class="config-bar-fill config-bar-fill--b" style="width:${Math.round((now / max) * 100)}%"></span></span><span class="config-dist-count">${esc(this.statsNumber(now))}</span></span>
                        <span role="cell" class="config-stats-pair-cell"><span class="config-bar config-bar--slim"><span class="config-bar-fill" style="width:${Math.round((ever / max) * 100)}%"></span></span><span class="config-dist-count">${esc(this.statsNumber(ever))}</span></span>
                    </div>`;
            }).join('');
            const title = this.t('config.statsInboxSubSources', 'Inbox by source');
            return this.statsPanel({
                title,
                body: `<div class="config-stats-pair" role="table" aria-label="${esc(title)}">
                    <div class="config-stats-pair-row config-stats-pair-head" role="row">
                        <span role="columnheader">${esc(this.t('config.statsInboxColSource', 'Source'))}</span>
                        <span role="columnheader">${esc(this.t('config.statsInboxColCurrent', 'In inbox now'))}</span>
                        <span role="columnheader">${esc(this.t('config.statsInboxColLifetime', 'Added (lifetime)'))}</span>
                    </div>${rows}</div>`,
            });
        },

        renderStatsInboxComplete(items) {
            const total = items.length;
            const withTags = items.filter((it) => Array.isArray(it?.tags) && it.tags.some((t) => String(t || '').trim())).length;
            const withNote = items.filter((it) => String(it?.note || '').trim()).length;
            const withPreview = items.filter((it) => String(it?.previewImage || '').trim()).length;
            const row = (label, n) => [label, n, { display: `${this.statsNumber(n)} · ${this.statsPct(n, total)}%` }];
            return this.statsPanel({
                title: this.t('config.statsInboxCompleteTitle', 'How complete the items are'),
                note: this.t('config.statsInboxCompleteNote', 'Share of the {n} items in the inbox.').replace('{n}', this.statsNumber(total)),
                body: this.statsBars([
                    row(this.t('config.statsInboxWithTags', 'With tags'), withTags),
                    row(this.t('config.statsInboxWithPreview', 'With preview'), withPreview),
                    row(this.t('config.statsInboxWithNote', 'With note'), withNote),
                ], { max: Math.max(1, total) }),
            });
        },

        /* ------------------------------------------------------------------
         * Health
         * ------------------------------------------------------------------ */

        renderStatsHealthTab(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            if (h === undefined) {
                return `<div id="config-stats-health"><p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p></div>`;
            }
            if (h === null) {
                return `<div id="config-stats-health"><p class="config-panel-empty">${esc(this.t('config.statsHealthUnavailable', 'Health data is not available.'))}</p></div>`;
            }
            const points = (h.trend && h.trend.length ? h.trend : this._statsTrend) || [];
            const series = this.statsHealthySeries(points).map((p) => p.pct);
            const fleet = h.fleet;
            const uptime = this.statsUptimePct(fleet?.uptime30d);
            const certs = this.statsCertificateRows();
            const broken = h.broken + h.monitorDown + h.content;
            const kpis = this.statsKpis([
                this.statsHealthyKpi(h, series),
                {
                    label: this.t('config.statsBroken', 'Broken'),
                    value: this.statsNumber(broken),
                    detail: broken && s.oldestBrokenAt
                        ? this.t('config.statsOldestSince', 'oldest {when}').replace('{when}', this.statsRelativeTime(s.oldestBrokenAt))
                        : '',
                    tone: broken ? 'bad' : 'good',
                },
                {
                    label: this.t('config.statsUptime30', 'Uptime 30 days'),
                    value: uptime === null ? '—' : `${this.statsNumber(uptime)}%`,
                    detail: fleet?.uptime30d?.samples
                        ? this.t('config.statsUptimeSamples', '{n} checks').replace('{n}', this.statsNumber(fleet.uptime30d.samples))
                        : this.t('config.statsNoMonitors', 'no monitors'),
                    tone: uptime === null ? undefined : (uptime >= 99 ? 'good' : (uptime >= 95 ? 'warn' : 'bad')),
                },
                {
                    label: this.t('config.statsAvgResponse', 'Average response'),
                    value: Number(fleet?.avgResponseMs) ? `${this.statsNumber(fleet.avgResponseMs)} ms` : '—',
                    detail: Number(fleet?.monitors)
                        ? this.t('config.statsMonitorsCount', '{n} monitors').replace('{n}', this.statsNumber(fleet.monitors))
                        : '',
                },
                {
                    label: this.t('config.statsCertsTitle', 'Certificates'),
                    value: this.statsNumber(certs.length),
                    detail: this.t('config.statsCertsWithin', 'expire within {days} days').replace('{days}', String(this.certWarnDays())),
                    tone: certs.some((c) => c.days < 0) ? 'bad' : (certs.length ? 'warn' : undefined),
                },
                {
                    label: this.t('config.statsHealthScore', 'Health score'),
                    value: h.avgScore === null || h.avgScore === undefined ? '—' : this.statsNumber(h.avgScore),
                    detail: this.t('config.statsHealthScoreDetail', 'average per bookmark'),
                },
            ]);
            return this.statsScopeNote() + kpis + this.statsGrid([
                this.renderStatsStatus(h, points),
                this.renderStatsUptime(),
                this.renderStatsWorst(),
                this.renderStatsOutages(),
                this.renderStatsCertificates(certs),
                this.renderStatsIssues(h, s),
                this.renderStatsArchive(),
            ]);
        },

        /**
         * The healthy share as a line, by date, with gaps where a day has no
         * point. On a fixed 0–100 axis: a self-scaling one turns a two-point
         * wobble into a cliff.
         */
        renderStatsHealthLine(points, { compact = false } = {}) {
            const esc = (v) => this.dash.escapeHtml(v);
            const series = this.statsHealthySeries(points);
            const known = series.filter((p) => p.pct !== null);
            if (known.length < 2) {
                return `<p class="config-panel-note">${esc(this.t('config.statsHealthTrendWaiting',
                    'A day is recorded each time the health report runs. Once there are a few, the change over time appears here.'))}</p>`;
            }
            const first = known[0].pct;
            const last = known[known.length - 1].pct;
            const lowest = Math.min(...known.map((p) => p.pct));
            const delta = last - first;
            const days = series.length;
            const word = delta === 0
                ? this.t('config.statsHealthTrendFlat', 'unchanged over {days} recorded days')
                : (delta > 0
                    ? this.t('config.statsHealthTrendUp', 'up {points} points over {days} recorded days')
                    : this.t('config.statsHealthTrendDown', 'down {points} points over {days} recorded days'));
            const summary = word.replace('{points}', String(Math.abs(delta))).replace('{days}', String(days));

            // The plot stretches to its panel; the axis text is HTML beside
            // it, so it stays readable at any width.
            const W = 500;
            const H = compact ? 70 : 100;
            const x = (i) => (days === 1 ? W / 2 : (i / (days - 1)) * W);
            const y = (v) => H - (v / 100) * H;
            const segments = [];
            let current = [];
            series.forEach((p, i) => {
                if (p.pct === null) {
                    if (current.length) segments.push(current);
                    current = [];
                } else {
                    current.push([x(i), y(p.pct)]);
                }
            });
            if (current.length) segments.push(current);
            // A lone day between two gaps is drawn as a stub, since a polyline
            // of one point draws nothing and a circle would stretch.
            const lines = segments.map((pts) => {
                const list = pts.length > 1 ? pts : [[pts[0][0] - 1, pts[0][1]], [pts[0][0] + 1, pts[0][1]]];
                return `<polyline class="config-stats-line" points="${list.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')}" fill="none"></polyline>`;
            }).join('');
            const fmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined, { day: 'numeric', month: 'short' });
            const grid = [0, 50, 100].map((t) => `<line class="config-stats-grid-line" x1="0" x2="${W}" y1="${y(t)}" y2="${y(t)}"></line>`).join('');
            const gaps = series.filter((p) => p.pct === null).length;
            const rows = series.map((p) => `<tr><th scope="row">${esc(fmt.format(new Date(p.t)))}</th><td>${p.pct === null ? '—' : esc(String(p.pct))}</td></tr>`).join('');
            const tone = delta > 0 ? 'good' : (delta < 0 ? 'bad' : '');
            const extras = [
                lowest < last ? this.t('config.statsHealthLowest', 'lowest {pct}%').replace('{pct}', String(lowest)) : '',
                gaps ? this.t('config.statsHealthGaps', '{n} days without a report').replace('{n}', String(gaps)) : '',
            ].filter(Boolean);
            const dateLabels = series.map((p) => fmt.format(new Date(p.t)));
            return `
                <p class="config-stats-trend-summary${tone ? ` config-stats-trend-summary--${tone}` : ''}">
                    <strong>${esc(String(last))}%</strong> ${esc(this.t('config.statsHealthy', 'Healthy'))} · ${esc(summary)}${extras.length ? ` · ${esc(extras.join(' · '))}` : ''}
                </p>
                <div class="config-chart config-stats-healthline">
                    <div class="config-chart-plot">
                        <span class="config-chart-axis-y" aria-hidden="true">
                            <span class="config-chart-axis-title">%</span>
                            <span class="config-chart-axis-ticks"><span>100</span><span>0</span></span>
                        </span>
                        <span class="config-chart-plot-area">
                            <svg class="config-stats-trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px" role="img"
                                 aria-label="${esc(this.t('config.statsHealthTrendAria', 'Healthy share over time'))}: ${esc(summary)}">
                                ${grid}${lines}
                            </svg>
                            <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks({ dateLabels })}</span>
                        </span>
                    </div>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(this.t('config.statsHealthTrendAria', 'Healthy share over time'))}</caption>
                    <thead><tr><th scope="col">${esc(this.t('config.statsAxisDay', 'Day'))}</th><th scope="col">%</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
        },

        /** Every state a bookmark can be in, as one bar, and the line under it. */
        renderStatsStatus(h, points) {
            const esc = (v) => this.dash.escapeHtml(v);
            return this.statsPanel({
                title: this.t('config.statsStatusTitle', 'Status now and over time'),
                span: 12,
                info: this.t('config.statsStatusInfo', 'The line is worked out from broken, monitors down and unchecked on each recorded day, so every day is counted the same way.'),
                right: `<button type="button" class="config-btn config-btn--small" data-stats-action="open-health-view">${esc(this.t('config.statsOpenHealthView', 'Open Health'))}</button>`,
                body: `<div id="config-stats-health">
                    ${this.statsStack([
                        [this.t('config.statsHealthy', 'Healthy'), h.healthy, 'good'],
                        [this.t('config.statsBroken', 'Broken'), h.broken, 'crit'],
                        [this.t('config.statsMonitorDown', 'Monitors down'), h.monitorDown, 'crit'],
                        [this.t('config.statsContentFailing', 'Answering, but not as expected'), h.content, 'warn'],
                        [this.t('config.statsUnchecked', 'Unchecked'), h.unchecked, 'muted'],
                    ])}
                    ${this.renderStatsHealthLine(points)}
                </div>`,
            });
        },

        /** Pooled uptime over three windows. Absent with no monitors. */
        renderStatsUptime() {
            const fleet = this._statsHealth?.fleet;
            if (!fleet || !Number(fleet.monitors)) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const windows = [
                [this.t('config.statsUptime24h', 'Last 24 hours'), fleet.uptime24h],
                [this.t('config.statsUptime7d', 'Last 7 days'), fleet.uptime7d],
                [this.t('config.statsUptime30d', 'Last 30 days'), fleet.uptime30d],
            ];
            const rows = windows.map(([label, w]) => {
                const pct = this.statsUptimePct(w);
                if (pct === null) return [label, 0, { display: this.t('config.statsUptimeNoSamples', 'nothing recorded') }];
                return [label, pct, { display: `${this.statsNumber(pct)}%`, tone: pct >= 99 ? 'good' : (pct >= 95 ? 'warn' : 'crit') }];
            });
            const checks = windows.map(([, w]) => this.statsNumber(Number(w?.samples) || 0)).join(' · ');
            return this.statsPanel({
                title: this.t('config.statsUptimeTitle', 'Uptime'),
                info: this.t('config.statsUptimeHint', 'Pooled across every monitor by check, so a service checked often does not outweigh one checked rarely.'),
                body: this.statsScaleCaption(this.t('config.statsAxisUptime', 'Share of checks that succeeded — 0% to 100%'))
                    + this.statsBars(rows, { max: 100 })
                    + `<p class="config-panel-note">${esc(this.t('config.statsUptimeChecks', '{list} checks, across {n} monitors.')
                        .replace('{list}', checks).replace('{n}', this.statsNumber(fleet.monitors)))}</p>`,
            });
        },

        /** The monitors that were down the most, from the report's own ranking. */
        renderStatsWorst() {
            const worst = this._statsHealth?.worst || [];
            if (!worst.length) return '';
            const incidents = this._statsHealth?.incidents || [];
            const rows = worst.slice(0, 5).map((w) => {
                const pct = Math.round((Number(w.ratio) || 0) * 1000) / 10;
                const outages = incidents.filter((i) => i.url === w.url).length;
                const sub = [
                    outages ? this.t('config.statsOutagesN', '{n} outages').replace('{n}', this.statsNumber(outages)) : '',
                    Number(w.avgMs) ? this.t('config.statsAvgMs', 'avg {n} ms').replace('{n}', this.statsNumber(w.avgMs)) : '',
                ].filter(Boolean).join(' · ');
                return [w.name || w.url, `${this.statsNumber(pct)}%`, pct >= 99 ? 'good' : (pct >= 95 ? 'warn' : 'bad'), sub];
            });
            return this.statsPanel({
                title: this.t('config.statsWorstTitle', 'Monitors with the most downtime'),
                body: this.statsPairAxisHeader(this.t('config.statsAxisMonitor', 'Monitor'), this.t('config.statsAxisUptime30', 'Uptime'))
                    + this.statsFacts(rows),
            });
        },

        /** Every recorded outage: how many, how long in all, and why. */
        renderStatsOutages() {
            const esc = (v) => this.dash.escapeHtml(v);
            const fleet = this._statsHealth?.fleet;
            if (!fleet || !Number(fleet.monitors)) return '';
            const incidents = this._statsHealth?.incidents || [];
            const total = Math.max(Number(fleet.totalIncidents) || 0, incidents.length);
            const title = this.t('config.statsOutagesTitle', 'Outages');
            if (!total) {
                return this.statsPanel({ title, body: `<p class="config-panel-empty">${esc(this.t('config.statsOutagesNone', 'No outages on record.'))}</p>` });
            }
            const downMs = incidents.reduce((n, i) => n + (Number(i.durationMs) || 0), 0);
            const hours = Math.round((downMs / 3600000) * 10) / 10;
            const reasons = new Map();
            incidents.forEach((i) => {
                const r = String(i.reason || '').trim() || this.t('config.statsReasonUnknown', 'Not recorded');
                reasons.set(r, (reasons.get(r) || 0) + 1);
            });
            const rows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => [r, n, { tone: 'crit' }]);
            return this.statsPanel({
                title,
                info: this.t('config.statsOutagesInfo', 'Every outage the monitors recorded, with how long it lasted and the reason the check gave.'),
                body: `
                    <div class="config-stat-figures">
                        <span><strong>${esc(this.statsNumber(total))}</strong> ${esc(this.t('config.statsOutagesOnRecord', 'on record'))}</span>
                        <span><strong>${esc(this.statsNumber(hours))}</strong> ${esc(this.t('config.statsHoursDown', 'hours down'))}</span>
                    </div>
                    ${this.statsBars(rows, { axis: [this.t('config.statsAxisReason', 'Reason'), this.t('config.statsAxisOutages', 'Outages')] })}
                    ${incidents.length < total ? `<p class="config-panel-note">${esc(this.t('config.statsOutagesRecent', 'Hours and reasons cover the {n} most recent.').replace('{n}', String(incidents.length)))}</p>` : ''}`,
            });
        },

        /**
         * Certificates near expiry, one row per host, soonest first.
         *
         * Counted by host because ten bookmarks on one domain share one
         * certificate. Days left round down, and days since expiry round down
         * on their own elapsed value.
         */
        statsCertificateRows() {
            const certs = Object.values(this._statsHealth?.certificates || {});
            const now = Date.now();
            return certs
                .map((c) => {
                    const at = Number(c?.expiresAt) || 0;
                    if (!at) return null;
                    const days = at < now ? -Math.floor((now - at) / DAY) : Math.floor((at - now) / DAY);
                    return { host: String(c.host || ''), days, at };
                })
                .filter(Boolean)
                .sort((a, b) => a.at - b.at);
        },

        renderStatsCertificates(rows) {
            const esc = (v) => this.dash.escapeHtml(v);
            const title = this.t('config.statsCertsTitle', 'Certificates');
            const info = this.t('config.statsCertsHint', 'Only certificates near expiry are reported, one per host, and only for hosts reached over HTTPS. An empty panel means none are close.');
            if (!rows.length) {
                return this.statsPanel({
                    title,
                    info,
                    body: `<p class="config-panel-empty">${esc(this.t('config.statsCertsNone', 'No certificate expires within {days} days.').replace('{days}', String(this.certWarnDays())))}</p>`,
                });
            }
            return this.statsPanel({
                title,
                info,
                body: this.statsPairAxisHeader(this.t('config.statsAxisHost', 'Host'), this.t('config.statsAxisExpires', 'Expires'))
                    + this.statsFacts(rows.slice(0, 8).map((c) => [
                        c.host,
                        c.days < 0
                            ? this.t('config.statsCertAgo', '{n} days ago').replace('{n}', String(Math.abs(c.days)))
                            : this.t('config.statsCertIn', 'in {n} days').replace('{n}', String(c.days)),
                        c.days < 0 || c.days <= 7 ? 'bad' : 'warn',
                    ])),
            });
        },

        /** Every flag the report puts on a bookmark, counted by type. */
        renderStatsIssues(h, s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const flags = h.flags || {};
            const staleDays = this.bookmarkStaleDays();
            const rows = [
                [this.t('config.statsIssueStale', 'Not opened in {days} days').replace('{days}', String(staleDays)), flags.stale || 0, { tone: 'warn' }],
                [this.t('config.statsIssueNoPreview', 'Without preview'), flags['missing-preview'] || 0, { tone: 'b' }],
                [this.t('config.statsIssueUnused', 'Never opened'), flags.unused || 0, { tone: 'warn' }],
                [this.t('config.statsOrphanedCategories', 'In a category that no longer exists'), flags['orphaned-category'] || 0, { tone: 'warn' }],
                [this.t('config.statsBroken', 'Broken'), h.broken + h.monitorDown + h.content, { tone: 'crit' }],
                [this.t('config.statsDrift', 'Changed since you looked'), h.drift || 0, { tone: 'warn' }],
                [this.t('config.statsDuplicateUrls', 'Duplicate URLs'), s.duplicateUrls, { tone: 'crit' }],
                [this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), s.shortcutConflicts, { tone: 'crit' }],
            ];
            const clashes = [
                ...(s.duplicateUrlList || []).slice(0, 4).map(([url, c]) => `${url.length > 40 ? `${url.slice(0, 37)}…` : url} (×${c})`),
                ...(s.shortcutConflictList || []).slice(0, 4).map(([sc, c]) => `${sc} (×${c})`),
            ];
            return this.statsPanel({
                title: this.t('config.statsIssuesTitle', 'Issues by type'),
                info: this.t('config.statsIssuesInfo', 'One bookmark can carry several of these at once, so they do not add up to the total.'),
                body: this.statsBars(rows, { axis: [this.t('config.statsAxisIssue', 'Issue'), this.t('config.statsAxisBookmarks', 'Bookmarks')] })
                    + (clashes.length ? `<p class="config-field-hint">${esc(clashes.join(', '))}</p>
                        <div class="config-actions"><button type="button" class="config-btn config-btn--small" data-stats-action="open-health">${esc(this.t('config.statsOpenInHealth', 'Open in Health'))}</button></div>` : ''),
            });
        },

        /** Local copies, and the broken links that have none. */
        renderStatsArchive() {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            if (!h || !h.tracked) return '';
            const pct = this.statsPct(h.archived, h.tracked);
            return this.statsPanel({
                title: this.t('config.statsArchiveTitle', 'Archive coverage'),
                info: this.t('config.statsArchiveHint', 'A dead link with a copy kept here is still readable. One without it is gone.'),
                body: this.statsBars([
                    [this.t('config.statsArchived', 'With a copy kept'), h.archived, { display: `${this.statsNumber(h.archived)} / ${this.statsNumber(h.tracked)} · ${pct}%`, tone: pct >= 50 ? 'good' : 'warn' }],
                ], { max: h.tracked })
                    + (h.brokenWithoutCopy ? `<p class="config-panel-note">${esc(this.t('config.statsArchiveBrokenNoCopy',
                        '{n} broken links have no copy. If their sites do not come back, they are gone.').replace('{n}', this.statsNumber(h.brokenWithoutCopy)))}</p>` : '')
                    + (h.newestCopyAt ? `<p class="config-panel-note">${esc(this.t('config.statsArchiveNewest', 'Newest copy: {name}, {when}.')
                        .replace('{name}', h.newestCopyName || '—').replace('{when}', this.statsRelativeTime(h.newestCopyAt)))}</p>` : ''),
            });
        },
    });

    global.DashboardConfigStatsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
