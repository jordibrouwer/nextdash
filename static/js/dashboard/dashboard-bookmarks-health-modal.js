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
            });
            this.bindBmHealthModal();
        },

        /* ── Assembling the body ─────────────────────────────────────────── */

        renderBmHealthModal(health) {
            const cards = [
                this.renderBmHealthModalScoreCard(health),
                this.renderBmHealthModalStandCard(health),
                this.renderBmHealthModalKindCard(health),
                this.renderBmHealthModalDistributionCard(health),
                this.renderBmHealthModalPagesCard(health),
                this.renderBmHealthModalCoverageCard(health),
                this.renderBmHealthModalMonitorsCard(health),
                this.renderBmHealthModalCertsCard(health),
            ].filter(Boolean).join('');
            return `${this.renderBmHealthModalSubtitle(health)}
                <div class="bm-health-modal-grid">${cards}</div>
                ${this.renderBmHealthModalFooter(health)}`;
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
            const svg = `<svg class="bm-health-modal-score-chart" viewBox="0 0 ${w} ${h}"
                preserveAspectRatio="none" role="img" aria-label="${esc(chartLabel)}">${path}${lowDot}${endDot}</svg>`;

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
            const tile = (mode, label) => `<div class="bm-health-modal-tile">
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
