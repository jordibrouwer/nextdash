/**
 * Config → Stats, loaded when that section is opened.
 *
 * Thirty-two methods and 77 KB of the config module drew one section — the
 * tables, the distributions, the trends, the inbox and health panels — and every
 * visit to any other section downloaded them. They are the same methods on the
 * same prototype, in the same order, moved verbatim; only the moment they arrive
 * has changed.
 *
 * The eleven entry points the rest of the module calls — renderStats,
 * repaintStatsBody, the three loaders and their small helpers — stay behind, so
 * nothing has to test whether this file is here before calling them. What they
 * call *into* is guarded instead, in one place: renderStatsBody.
 */
(function (global) {
    'use strict';

    if (typeof global.DashboardConfig !== 'function') return;

    Object.assign(global.DashboardConfig.prototype, {

        /**
         * When these numbers were worked out.
         *
         * They are recomputed from whatever is in memory at render time, not
         * fetched, so nothing on the page said whether you were looking at a
         * snapshot from ten seconds or ten minutes ago. It sits below the body
         * rather than in the intro: it dates everything above it, including the
         * panels that repaint on a tab switch.
         */
        renderStatsTimestamp() {
            const esc = (v) => this.dash.escapeHtml(v);
            const time = window.NextDashClock.formatTime(new Date(), this.dash.settings);
            // The two controls sit with the stamp rather than in a tab of their
            // own. Refresh belongs next to the time it replaces, and the export
            // covers every tab's figures — offering it only on Overview, which is
            // where it used to live, hid it from four fifths of the section.
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

        /**
         * One explanation instead of a page of zeroes.
         *
         * With nothing to measure, every panel still rendered: five coverage bars
         * reading "0 / 0 · 0%", a category list with no rows, a cleanup score of 0
         * out of 100. That reads as something broken rather than as a dashboard
         * nobody has filled yet, so the whole body is replaced by a single line
         * saying what to do — except on Inbox, whose numbers come from the server
         * and mean something even with no bookmarks.
         */
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

        /**
         * A copyable link to one panel, as Help offers on its articles.
         *
         * Statistics is deep-linkable — #config/stats/activity has worked all
         * along — but nothing on the page said so, so sharing "look at the
         * concentration figure" meant describing where to click.
         */
        statsPanelLink(id) {
            const esc = (v) => this.dash.escapeHtml(v);
            const label = this.t('config.statsCopyLink', 'Copy a link to this tab');
            return `<button type="button" class="config-help-panel-link" data-stats-panel-link="${esc(id)}"
                    title="${esc(label)}" aria-label="${esc(label)}">🔗</button>`;
        },

        renderStatsBody() {
            const esc = (v) => this.dash.escapeHtml(v);
            const s = this.computeStats();

            // Inbox is server-side and still meaningful on an empty dashboard.
            if (!s.total && this.statsTab !== 'inbox') {
                return this.renderStatsEmpty();
            }

            // The label and the value are separate spans, so a screen reader read
            // them as two loose strings that only made sense because they happened
            // to be adjacent. aria-label names the tile as one thing — "Bookmarks:
            // 102" — and the spans are hidden so it is not then read twice.
            // `was` is the same figure a week ago, when history reaches back
            // that far: a count says what you have, a direction says what you
            // are doing. Only shown when it actually moved — "+0 this week" is
            // noise dressed as information.
            const tile = (label, value, hint, was = null) => {
                const delta = (was === null || was === undefined) ? null : Number(value) - Number(was);
                const trend = delta ? `
                    <span class="config-tile-delta config-tile-delta--${delta > 0 ? 'up' : 'down'}">
                        ${delta > 0 ? '+' : '−'}${esc(this.statsNumber(Math.abs(delta)))}
                        <span class="config-tile-delta-period">${esc(this.t('config.statsDeltaWeek', 'this week'))}</span>
                    </span>` : '';
                const spoken = delta
                    ? `${esc(label)}: ${esc(this.statsNumber(value))}, ${delta > 0 ? '+' : '−'}${esc(this.statsNumber(Math.abs(delta)))} ${esc(this.t('config.statsDeltaWeek', 'this week'))}`
                    : `${esc(label)}: ${esc(this.statsNumber(value))}`;
                return `
                <div class="config-tile" role="listitem" aria-label="${spoken}${hint ? `. ${esc(hint)}` : ''}">
                    <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                    <span class="config-tile-value" aria-hidden="true">${esc(this.statsNumber(value))}${trend}</span>
                    ${hint ? `<p class="config-tile-detail" aria-hidden="true">${esc(hint)}</p>` : ''}
                </div>`;
            };
            // A week back, from the daily points the health report records.
            // Narrowed to one page, the figures no longer describe what history
            // recorded, so the comparison is dropped rather than made up.
            const ago = this.statsScopePage() ? null : this.statsTrendPointDaysAgo(7);

            switch (this.statsTab) {
                case 'activity':
                    return this.renderStatsActivity(s)
                        + this.renderStatsTopLists(s)
                        + this.renderStatsShortcuts(s)
                        + `<div id="config-stats-finders">${this.renderStatsFinders()}</div>`;
                case 'content':
                    return this.renderStatsRatios(s)
                        + this.renderStatsConcentration(s)
                        + this.renderStatsCategoryEffectiveness(s)
                        + this.renderStatsDistributions(s)
                        + this.renderStatsLibrary()
                        + this.renderStatsCleanup(s);
                case 'inbox':
                    return this.renderStatsInbox();
                case 'health':
                    return this.renderStatsRot(s)
                        + this.renderStatsConflicts(s)
                        + this.renderStatsSearch(s)
                        + this.renderStatsUptime()
                        + this.renderStatsCertificates()
                        + this.renderStatsArchive()
                        + `
                        <div class="config-panel">
                            <h3 class="config-panel-title">${esc(this.t('config.statsHealthTitle', 'Link health'))}</h3>
                            <div id="config-stats-health">${this.renderStatsHealth()}</div>
                            <div class="config-actions">
                                <button type="button" class="config-btn config-btn--small" data-stats-action="open-health-view">${esc(this.t('config.statsOpenHealthView', 'Open Health'))}</button>
                            </div>
                        </div>`;
                default:
                    return `
                        <div class="config-tiles config-tiles--overview" role="list">
                            ${tile(this.t('config.statsBookmarks', 'Bookmarks'), s.total, '', ago?.n)}
                            ${tile(this.t('config.statsPages', 'Pages'), s.pages)}
                            ${tile(this.t('config.statsCategoryCount', 'Categories'), s.categories)}
                            ${tile(this.t('config.statsTagCount', 'Distinct tags'), s.tagCount)}
                            ${tile(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut)}
                            ${tile(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
                        </div>
                        ${this.renderStatsSummary(s, ago)}
                        ${this.renderStatsHeadline(s)}
                        ${this.renderStatsInsights(s)}
                        ${this.renderStatsScore(s)}`;
            }
        },

        /**
         * What these numbers mean, in three sentences.
         *
         * Statistics is five tabs of counting and the reader is left to work
         * out what follows from it. These are the three things that do follow —
         * how concentrated your opening is, how much is going unread, and what
         * is broken — each with the button that acts on it, because a figure
         * you cannot act on is trivia.
         *
         * Every line states a fact this section already knows. None is shown
         * when its number is zero: an install with nothing neglected should not
         * be told so in a panel about what needs doing.
         */
        renderStatsSummary(s, ago = null) {
            const esc = (v) => this.dash.escapeHtml(v);
            const lines = [];

            const share = Number(s.concentration?.share) || 0;
            const used = Number(s.concentration?.usedCount) || 0;
            if (share >= 40 && used > 0) {
                lines.push({
                    text: this.t('config.statsSummaryConcentration',
                        '{share}% of your opening lands on ten bookmarks. Those are the ones worth a shortcut.')
                        .replace('{share}', String(share)),
                    action: 'shortcuts',
                    label: this.t('config.statsSummarySeeShortcuts', 'See shortcuts'),
                });
            }

            const neglected = Number(s.stale90) || 0;
            if (neglected > 0) {
                lines.push({
                    text: this.t('config.statsSummaryStale',
                        '{n} bookmarks have not been opened in {days} days.')
                        .replace('{n}', this.statsNumber(neglected))
                        .replace('{days}', String(this.bookmarkStaleDays())),
                    goto: 'never',
                    label: this.t('config.statsSummaryTidy', 'Work through them'),
                });
            }

            const broken = Number(this._statsHealth?.broken || 0) + Number(this._statsHealth?.monitorDown || 0);
            if (broken > 0) {
                lines.push({
                    text: this.t('config.statsSummaryBroken', '{n} links are not answering.')
                        .replace('{n}', this.statsNumber(broken)),
                    action: 'open-health-view',
                    label: this.t('config.statsOpenHealthView', 'Open Health'),
                });
            }

            // Growth is a fact rather than a call to action, so it closes the
            // list and carries no button.
            const grew = ago && Number.isFinite(Number(ago.n)) ? Number(s.total) - Number(ago.n) : 0;
            if (grew > 0) {
                lines.push({
                    text: this.t('config.statsSummaryGrew', 'You saved {n} new bookmarks this week.')
                        .replace('{n}', this.statsNumber(grew)),
                });
            }

            if (!lines.length) return '';
            const rows = lines.map((line) => `
                <li class="config-stats-summary-row">
                    <span class="config-stats-summary-text">${esc(line.text)}</span>
                    ${line.action ? `<button type="button" class="config-btn config-btn--small" data-stats-action="${esc(line.action)}">${esc(line.label)}</button>` : ''}
                    ${line.goto ? `<button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(line.goto)}">${esc(line.label)}</button>` : ''}
                </li>`).join('');
            return `
                <div class="config-panel config-stats-summary">
                    <h3 class="config-panel-title">${esc(this.t('config.statsSummaryTitle', 'What this says'))}</h3>
                    <ul class="config-stats-summary-list">${rows}</ul>
                </div>`;
        },

        renderStatsScore(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            if (!s.total) {
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}</h3>
                        <p class="config-panel-empty">${esc(this.t('config.noBookmarksYet', 'No bookmarks yet.'))}</p>
                    </div>`;
            }
            const { score, details } = s.cleanup;
            const tone = score >= 80 ? 'good' : (score >= 50 ? 'warn' : 'crit');
            const rows = details.map((d) => `
                <li class="config-stat-detail config-stat-detail--${esc(d.type)}">
                    <span>${esc(d.text)}</span>
                    ${d.penalty ? `<span class="config-stat-penalty">−${esc(String(d.penalty))}</span>` : ''}
                </li>`).join('');

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsScoreHint', 'Starts at 100 and loses points for bookmarks you never open, links gone stale, duplicate URLs and clashing shortcuts.'))}</p>
                    <div class="config-score">
                        <span class="config-score-value config-score-value--${tone}">${esc(String(score))}</span>
                        <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsScoreTitle', 'Cleanup score'))}: ${score}/100">
                            <span class="config-bar-fill config-bar-fill--${tone}" style="width:${score}%"></span>
                        </div>
                    </div>
                    <ul class="config-stat-details">${rows}</ul>
                </div>`;
        },

        /**
         * Opens per bucket as an SVG bar chart. A screen-reader table carries the
         * same numbers, because a chart that only exists as shapes is unreadable to
         * anyone not looking at it.
         */
        renderStatsActivity(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const a = s.activity;
            const ranges = DashboardConfig.STATS_RANGES.map((d) => {
                const on = d === this.statsRange;
                return `<button type="button" class="config-choice${on ? ' is-active' : ''}" data-stats-range="${d}" aria-pressed="${on}">${esc(this.statsRangeLabel(d))}</button>`;
            }).join('');

            // A chart of nothing is not a chart. The empty branch used to need the
            // buckets to be missing entirely, so a library where nothing has been
            // opened yet — every bucket zero — drew thirty flat bars and an axis
            // instead of saying so. The range buttons stay: "nothing in this
            // period" is answered by widening it.
            const noneInPeriod = !a.buckets.length || a.buckets.every((v) => !v);
            if (noneInPeriod) {
                const everOpened = Number(a.totalOpens) > 0;
                const line = everOpened
                    ? this.t('config.statsNoActivity', 'No bookmarks were used in this period.')
                    : this.t('config.statsNoActivityEver',
                        'Nothing has been opened yet, so there is nothing to plot. This fills in as you use your bookmarks.');
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsActivityTitle', 'Bookmarks used over time'))}</h3>
                        <div class="config-choices" role="group">${ranges}</div>
                        <p class="config-panel-empty">${esc(line)}</p>
                        ${everOpened ? `<div class="config-stat-figures">
                            <span><strong>${esc(this.statsNumber(a.totalOpens))}</strong> ${esc(this.t('config.statsActivityLifetimeOpens', 'opens all-time'))}</span>
                        </div>` : ''}
                    </div>`;
            }

            const W = 500;
            // 108 = the old 72 plus half again, as the bars were too short to compare
            // neighbouring days by eye.
            const H = 108;
            const gap = 3;
            const n = a.buckets.length;
            const max = Math.max(...a.buckets, 1);
            const barW = Math.max(1, Math.floor((W - gap * (n - 1)) / n));
            const unit = this.statsActivityBucketUnit();
            const bars = a.buckets.map((val, i) => {
                const h = Math.round((val / max) * H);
                const x = i * (barW + gap);
                const opacity = val === 0 ? 0.15 : (0.75 + (val / max) * 0.25).toFixed(2);
                const date = a.dateLabels?.[i] || a.labels[i] || '';
                // The <g> is the hit target, not the painted bar: it spans the full
                // height and half the gap either side, so a short bar — or an empty
                // one — is still reachable. Focusable so the values are on keyboard
                // too, per the same rule that puts them on hover.
                return `<g class="config-chart-bar" tabindex="0" role="listitem"
                           data-bar-date="${esc(date)}" data-bar-value="${esc(String(val))}" data-bar-unit="${esc(unit)}"
                           aria-label="${esc(date)}: ${esc(String(val))} ${esc(this.t('config.statsActivityUsedLabel', 'bookmarks last used'))}">
                    <rect class="config-chart-bar-hit" x="${Math.max(0, x - gap / 2)}" y="0" width="${barW + gap}" height="${H}"></rect>
                    <rect class="config-chart-bar-fill" x="${x}" y="${H - h}" width="${barW}" height="${Math.max(h, val > 0 ? 2 : 0)}" rx="1" fill="var(--accent-color, #4a90d9)" opacity="${opacity}"></rect>
                </g>`;
            }).join('');
            const summary = a.labels.map((l, i) => `${l}: ${a.buckets[i]}`).join(', ');
            const srRows = a.labels.map((l, i) =>
                `<tr><th scope="row">${esc(l)}</th><td>${esc(String(a.buckets[i]))}</td></tr>`).join('');

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsActivityTitle', 'Bookmarks used over time'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsActivityNote', 'Each bar counts the bookmarks whose last use falls in that period. A bookmark appears once, on the day you last opened it.'))}</p>
                    <div class="config-choices" role="group">${ranges}</div>
                    <div class="config-stat-figures">
                        <span><strong>${esc(this.statsNumber(a.activeCount))}</strong> ${esc(this.t('config.statsActivityActive', 'bookmarks used'))}</span>
                        <span title="${esc(this.t('config.statsActivityLifetimeHint', 'Counted over the whole life of these bookmarks, not only this period — nextDash stores a total per bookmark, not a date for every open.'))}"><strong>${esc(this.statsNumber(a.totalOpens))}</strong> ${esc(this.t('config.statsActivityLifetimeOpens', 'opens all-time'))}</span>
                        ${a.wow !== null ? `<span class="config-stat-trend config-stat-trend--${a.wow >= 0 ? 'up' : 'down'}">${a.wow >= 0 ? '▲' : '▼'} ${esc(String(Math.abs(a.wow)))}% ${esc(this.t('config.statsActivityVsPrev', 'vs previous period'))}</span>` : ''}
                    </div>
                    <p class="config-chart-summary">${esc(this.statsActivityShape(a))}</p>
                    <div class="config-chart">
                        <div class="config-chart-plot">
                            <span class="config-chart-axis-y" aria-hidden="true">
                                <span class="config-chart-axis-title">${esc(this.t('config.statsAxisBookmarksUsed', 'Bookmarks'))}</span>
                                <span class="config-chart-axis-ticks">
                                    <span>${esc(String(max))}</span>
                                    <span>0</span>
                                </span>
                            </span>
                            <span class="config-chart-plot-area">
                                <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="list"
                                     aria-label="${esc(this.t('config.statsSparklineAriaView', 'Bookmarks last used per period'))}: ${esc(summary)}">${bars}</svg>
                                <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks(a)}</span>
                            </span>
                        </div>
                        <p class="config-chart-axis-x" aria-hidden="true">${esc(this.statsActivityAxisXLabel())}</p>
                        <div class="config-chart-tip" role="status" aria-live="polite" hidden></div>
                    </div>
                    <table class="config-sr-only">
                        <caption>${esc(this.t('config.statsSparklineTableCaptionView', 'Bookmarks last used per period'))}</caption>
                        <tbody>${srRows}</tbody>
                    </table>
                </div>`;
        },

        /**
         * The chart in a sentence.
         *
         * A screen reader had thirty numbers in a table and no shape; a sighted
         * reader had the shape and had to hover for the peak. One line carries
         * both: how long the window is, where the busiest point sits, and how
         * many bookmarks it accounts for.
         */
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

        statsRangeLabel(days) {
            if (days === 365) return this.t('config.statsRangeYear', '1 year');
            return this.t('config.statsRangeDays', '{n} days').replace('{n}', String(days));
        },

        /** The noun for one bucket, used in the tooltip's date line. */
        statsActivityBucketUnit() {
            const days = this.statsRange || 30;
            if (days <= 30) return this.t('config.statsAxisUnitDay', 'day');
            if (days <= 90) return this.t('config.statsAxisUnitWeek', 'week');
            return this.t('config.statsAxisUnitMonth', 'month');
        },

        /**
         * Dated ticks along the x-axis.
         *
         * The axis used to carry only its two end-caps, so a bar in the middle sat
         * above no date at all. A handful of evenly spaced dates is enough to place
         * any bar by eye, and the tooltip gives the exact one.
         *
         * How many fit depends on how wide they are, not on the bar count: a daily
         * label is "Jul 6" but a weekly one is "Jul 29 – Aug 4", three times the
         * width. Six of those ran into each other and off the panel, so the cap is
         * derived from the longest label rather than fixed.
         */
        statsActivityTicks(a) {
            const esc = (v) => this.dash.escapeHtml(v);
            const dates = a.dateLabels || [];
            const n = dates.length;
            if (!n) return '';
            // ~500px of plot at roughly 6px per character, plus a gap, is how many
            // labels of this width can sit side by side without touching.
            const widest = dates.reduce((w, d) => Math.max(w, String(d).length), 0);
            const fits = Math.floor(500 / (widest * 6 + 16));
            const maxTicks = Math.max(2, Math.min(6, fits, n));
            const step = Math.max(1, Math.round((n - 1) / Math.max(1, maxTicks - 1)));
            const picked = [];
            for (let i = 0; i < n; i += step) picked.push(i);
            // The last bar is the one people look for ("where does it end?"), so it
            // is always labelled even when the stride would have skipped it.
            if (picked[picked.length - 1] !== n - 1) picked.push(n - 1);
            const last = picked.length - 1;
            return picked.map((i, k) => {
                const pct = n === 1 ? 50 : (i / (n - 1)) * 100;
                // Centring every label would push the first one off the left edge
                // and the last one past the right — visible as a date hanging
                // outside the panel. The end labels anchor to their own edge
                // instead; only the middle ones centre on their bar.
                const edge = k === 0 ? ' config-chart-tick--first'
                    : k === last ? ' config-chart-tick--last' : '';
                return `<span class="config-chart-tick${edge}" style="left:${pct.toFixed(2)}%">${esc(dates[i])}</span>`;
            }).join('');
        },

        /**
         * What one bar covers, which the selected range decides.
         *
         * computeActivity() buckets by day, week or month depending on the range, so
         * a fixed "Date" would be wrong two times out of three — the whole reason to
         * name the axis is to say what a bar actually is.
         */
        statsActivityAxisXLabel() {
            const days = this.statsRange || 30;
            if (days <= 30) return this.t('config.statsAxisPerDay', 'Day (oldest → newest)');
            if (days <= 90) return this.t('config.statsAxisPerWeek', 'Week (oldest → newest)');
            return this.t('config.statsAxisPerMonth', 'Month (oldest → newest)');
        },

        /** Coverage bars: how much of the collection carries tags, shortcuts, notes. */
        renderStatsRatios(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const bar = (label, count, total, hint) => {
                const pct = total ? Math.round((count / total) * 100) : 0;
                return `
                    <div class="config-ratio">
                        <div class="config-ratio-head">
                            <span class="config-ratio-label">${esc(label)}</span>
                            <span class="config-ratio-value">${esc(String(count))} / ${esc(String(total))} · ${pct}%</span>
                        </div>
                        <div class="config-bar" role="img" aria-label="${esc(label)}: ${pct}%">
                            <span class="config-bar-fill" style="width:${pct}%"></span>
                        </div>
                        ${hint ? `<p class="config-field-hint">${esc(hint)}</p>` : ''}
                    </div>`;
            };
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsCoverageTitle', 'Coverage'))}</h3>
                    ${this.statsScaleCaption(this.t('config.statsAxisShareOfCollection',
                        'Share of all {total} bookmarks — 0% to 100%').replace('{total}', String(s.total)))}
                    ${bar(this.t('config.statsTaggedBookmarks', 'Tagged'), s.tagged, s.total)}
                    ${bar(this.t('config.statsWithShortcut', 'With a shortcut'), s.withShortcut, s.total)}
                    ${bar(this.t('config.statsWithNote', 'With a note'), s.withNote, s.total)}
                    ${bar(this.t('config.statsWithIcon', 'With an icon'), s.withIcon, s.total)}
                    ${bar(this.t('config.statsChecked', 'Availability checked'), s.checked, s.total)}
                </div>`;
        },

        /**
         * Top lists: most opened, most tagged, and what has never been touched.
         * The ranked lists get the same bar as the distributions — a count is easier
         * to compare against its neighbours as a length than as a number.
         */
        renderStatsTopLists(s) {
            const esc = (v) => this.dash.escapeHtml(v);

            // axis: [what the rows are, what the bar measures]. The two callers count
            // different things, so neither the label nor the measure can be hardcoded.
            const rankedList = (title, rows, emptyText, hint, axis, total, goto) => {
                if (!rows.length) {
                    return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(title)}</h3>
                        ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                        <p class="config-panel-empty">${esc(emptyText)}</p>
                    </div>`;
                }
                const max = Math.max(...rows.map(([, v]) => Number(v) || 0), 1);
                const items = rows.map(([label, value]) => {
                    const n = Number(value) || 0;
                    const pct = Math.round((n / max) * 100);
                    // A row that names something the bookmark list can filter by
                    // becomes the way in: reading "dev — 42" and then finding those
                    // 42 by hand was the gap between knowing and doing. `goto` says
                    // which filter reproduces this row; lists without one stay plain
                    // text rather than looking clickable and doing nothing.
                    const target = goto ? `${goto}:${label}` : '';
                    const cell = target
                        ? `<button type="button" class="config-dist-label config-dist-label--link" data-stats-goto="${esc(target)}"
                                title="${esc(this.t('config.statsRowShow', 'Show these in Bookmarks'))}">${esc(label)}</button>`
                        : `<span class="config-dist-label">${esc(label)}</span>`;
                    return `
                        <li class="config-dist-row">
                            ${cell}
                            <div class="config-bar config-bar--slim" role="img" aria-label="${esc(label)}: ${esc(String(n))}">
                                <span class="config-bar-fill" style="width:${pct}%"></span>
                            </div>
                            <span class="config-dist-count">${esc(String(n))}</span>
                        </li>`;
                }).join('');
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(title)}</h3>
                        ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                        ${axis ? this.statsListAxisHeader(axis[0], axis[1]) : ''}
                        <ul class="config-dist-list">${items}</ul>
                        ${this.statsListTruncationNote(rows.length, total)}
                    </div>`;
            };

            // Never-opened is a plain list: its second column is a URL, not a count,
            // so there is nothing to scale a bar against.
            const plainList = (title, rows, emptyText, hint, total, cleanupKey) => {
                const items = rows.length
                    ? rows.map(([label, sub]) => `
                        <li class="config-crud-row">
                            <div class="config-bm-main">
                                <span class="config-bm-name">${esc(label)}</span>
                                <span class="config-bm-url">${esc(sub)}</span>
                            </div>
                        </li>`).join('')
                    : '';
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(title)}</h3>
                        ${hint ? `<p class="config-panel-note">${esc(hint)}</p>` : ''}
                        ${items
                            ? `<ul class="config-crud-list">${items}</ul>`
                            : `<p class="config-panel-empty">${esc(emptyText)}</p>`}
                        ${this.statsListTruncationNote(rows.length, total, cleanupKey)}
                    </div>`;
            };

            const totals = s.listTotals || {};
            return rankedList(this.t('config.statsTopOpened', 'Most opened'), s.topOpened,
                    this.t('config.statsNoOpens', 'Nothing has been opened yet.'), '',
                    [this.t('config.statsAxisBookmark', 'Bookmark'), this.t('config.statsAxisOpens', 'Opens')],
                    // Every row here names a bookmark, and the list is where you
                    // can act on one: reading "this is your most-opened link" and
                    // then finding it by hand was the gap between knowing and doing.
                    totals.topOpened, 'bookmark')
                + rankedList(this.t('config.statsTopTags', 'Most used tags'), s.topTags,
                    this.t('config.noTagsYet', 'No tags yet.'), '',
                    [this.t('config.statsAxisTag', 'Tag'), this.t('config.statsAxisBookmarks', 'Bookmarks')],
                    totals.topTags, 'tag')
                // 'never' is the cleanup filter that reproduces this list in full,
                // so the panel can hand off the rows it could not show.
                + plainList(this.t('config.statsNeverOpenedTitle', 'Never opened'), s.neverOpenedList,
                    this.t('config.statsAllOpened', 'Everything has been opened at least once.'),
                    this.t('config.statsNeverOpenedHint', 'Candidates to tidy up — they have never been used.'),
                    totals.neverOpened, 'never');
        },

        /**
         * Column header for the bar lists, naming what the label column and the
         * measure column hold.
         *
         * These lists are not x/y plots, so they have no axes to title — but they
         * have the same problem an unlabelled axis has: a name, a bar and a number,
         * with nothing saying what the number counts. This is the equivalent
         * header, and it doubles as the list's own axis legend.
         */
        /**
         * One-line caption naming the scale a set of full-width bars is drawn on.
         *
         * For the panels where every bar shares one axis (coverage is 0–100% of the
         * collection), so the scale is stated once above them rather than repeated
         * on each row.
         */
        statsScaleCaption(text) {
            return `<p class="config-chart-scale" aria-hidden="true">${this.dash.escapeHtml(text)}</p>`;
        },

        /**
         * The same caption pair for the label/value lists that have no bar column.
         *
         * .config-stat-detail is a two-column flex row, not the three-column grid
         * .config-dist-row uses, so its header has to match that shape or the
         * measure name lands over the wrong column.
         */
        statsPairAxisHeader(labelText, valueText) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-dist-axis config-dist-axis--pair" aria-hidden="true">
                    <span>${esc(labelText)}</span>
                    <span>${esc(valueText)}</span>
                </div>`;
        },

        /**
         * "20 of 214 shown" under a list that had to cut off.
         *
         * These panels are leaderboards, so cutting off is right — but saying
         * nothing was not. "Never opened" is the clearest case: it heads itself
         * "candidates to tidy up", showed twenty rows, and let you believe that was
         * all, while the cleanup panel beside it counted two hundred.
         *
         * Where a cleanup filter can reproduce the list in full, the note carries
         * the button that does it rather than leaving the rest unreachable.
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

        statsListAxisHeader(labelText, valueText) {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-dist-axis" aria-hidden="true">
                    <span class="config-dist-axis-label">${esc(labelText)}</span>
                    <span class="config-dist-axis-value">${esc(valueText)}</span>
                </div>`;
        },

        /** Where the bookmarks sit: per page, per category. */
        renderStatsDistributions(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const rows = (pairs) => pairs.map(([label, count]) => {
                const pct = s.total ? Math.round((count / s.total) * 100) : 0;
                return `
                    <li class="config-dist-row">
                        <span class="config-dist-label">${esc(label)}</span>
                        <div class="config-bar config-bar--slim" role="img" aria-label="${esc(label)}: ${esc(String(count))}">
                            <span class="config-bar-fill" style="width:${pct}%"></span>
                        </div>
                        <span class="config-dist-count">${esc(String(count))}</span>
                    </li>`;
            }).join('');
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsPerPage', 'Bookmarks per page'))}</h3>
                    ${this.statsListAxisHeader(
                        this.t('config.statsAxisPage', 'Page'),
                        this.t('config.statsAxisBookmarks', 'Bookmarks'))}
                    <ul class="config-dist-list">${rows(s.perPage)}</ul>
                </div>
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsPerCategory', 'Bookmarks per category'))}</h3>
                    ${this.statsListAxisHeader(
                        this.t('config.statsAxisCategory', 'Category'),
                        this.t('config.statsAxisBookmarks', 'Bookmarks'))}
                    <ul class="config-dist-list">${rows(s.perCategory)}</ul>
                </div>`;
        },

        /**
         * Opens per bookmark, per category — which shelves you actually reach for.
         *
         * The neighbouring "bookmarks per category" panel measures size, and size
         * alone hides the interesting case: a category holding twenty links that
         * nobody opens looks healthy there and empty here. Sorted by the ratio
         * rather than the total for the same reason.
         */
        renderStatsCategoryEffectiveness(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const list = s.categoryEffectiveness || [];
            if (!list.length) {
                return '';
            }
            const max = Math.max(...list.map((c) => c.perBookmark), 0);
            const rows = list.map((c) => {
                const pct = max > 0 ? Math.round((c.perBookmark / max) * 100) : 0;
                const ratio = c.perBookmark.toFixed(1);
                const detail = this.t('config.statsCategoryEffDetail', '{opens} opens over {count} bookmarks')
                    .replace('{opens}', String(c.opens))
                    .replace('{count}', String(c.count));
                return `
                    <li class="config-dist-row">
                        <button type="button" class="config-dist-label config-dist-label--link"
                                data-stats-goto="category:${esc(c.label)}" title="${esc(detail)}">${esc(c.label)}</button>
                        <div class="config-bar config-bar--slim" role="img" aria-label="${esc(c.label)}: ${esc(ratio)}">
                            <span class="config-bar-fill" style="width:${pct}%"></span>
                        </div>
                        <span class="config-dist-count" title="${esc(detail)}">${esc(ratio)}</span>
                    </li>`;
            }).join('');
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsCategoryEffTitle', 'Opens per bookmark, by category'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsCategoryEffNote', 'How often a bookmark in this category gets opened. A low figure on a large category is one you built but do not use.'))}</p>
                    ${this.statsListAxisHeader(
                        this.t('config.statsAxisCategory', 'Category'),
                        this.t('config.statsAxisOpensPerBookmark', 'Opens per bookmark'))}
                    <ul class="config-dist-list">${rows}</ul>
                </div>`;
        },

        /**
         * What share of all opens the busiest bookmarks account for.
         *
         * Answers a question none of the per-bookmark figures can: whether the
         * collection is used broadly or is really a handful of links surrounded by
         * everything else.
         */
        renderStatsConcentration(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const c = s.concentration || {};
            if (!c.totalOpens) {
                // Returning '' left a gap between two panels, which reads as a
                // rendering fault rather than as "you have not opened anything yet".
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsConcentrationTitle', 'Where your usage sits'))}</h3>
                        <p class="config-panel-empty">${esc(this.t('config.statsConcentrationEmpty', 'Nothing has been opened yet, so there is no usage to weigh up.'))}</p>
                    </div>`;
            }
            const sentence = this.t(
                'config.statsConcentrationBody',
                'Your top {top} bookmarks account for {share}% of all {total} opens.'
            ).replace('{top}', String(c.topCount)).replace('{share}', String(c.share)).replace('{total}', String(c.totalOpens));
            const rest = Math.max(0, c.usedCount - c.topCount);
            const restText = this.t('config.statsConcentrationRest', 'The other {n} used bookmarks share the remaining {pct}%.')
                .replace('{n}', String(rest)).replace('{pct}', String(100 - c.share));
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsConcentrationTitle', 'Where your usage sits'))}</h3>
                    ${this.statsScaleCaption(this.t('config.statsAxisShareOfOpens',
                        'Share of all {total} opens — 0% to 100%').replace('{total}', String(c.totalOpens)))}
                    <div class="config-ratio">
                        <div class="config-ratio-head">
                            <span class="config-ratio-label">${esc(this.t('config.statsConcentrationTop', 'Top {n}').replace('{n}', String(c.topCount)))}</span>
                            <span class="config-ratio-value">${esc(String(c.topOpens))} / ${esc(String(c.totalOpens))} · ${esc(String(c.share))}%</span>
                        </div>
                        <div class="config-bar" role="img" aria-label="${esc(sentence)}">
                            <span class="config-bar-fill" style="width:${esc(String(c.share))}%"></span>
                        </div>
                    </div>
                    <p class="config-panel-note">${esc(sentence)}${rest > 0 ? ` ${esc(restText)}` : ''}</p>
                </div>`;
        },

        /**
         * Cleanup candidates, each with a button that opens the list behind it.
         *
         * A count on its own is a dead end — the work is always "show me those and
         * let me fix them", and the bookmarks section already has bulk tagging and
         * deletion. Rows with nothing to fix are dropped rather than shown as a
         * zero, so the panel is a to-do list and not a scoreboard.
         */
        renderStatsCleanup(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const rows = [
                ['never', s.neverOpened, this.t('config.statsCleanupNeverHint', 'Added but never used')],
                ['once', s.openedOnce, this.t('config.statsCleanupOnceHint', 'Tried once, then dropped')],
                ['untagged', s.untagged, this.t('config.statsCleanupUntaggedHint', 'Harder to find by search')],
                ['insecure', s.insecure, this.t('config.statsCleanupInsecureHint', 'Plain http, no encryption')],
                ['noicon', s.missingIcon, this.t('config.statsCleanupNoIconHint', 'Falls back to a letter tile')],
            ].filter(([, n]) => Number(n) > 0);

            if (!rows.length) {
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsCleanupTitle', 'Cleanup candidates'))}</h3>
                        <p class="config-panel-empty">${esc(this.t('config.statsCleanupNone', 'Nothing to tidy up.'))}</p>
                    </div>`;
            }

            const items = rows.map(([key, n, hint]) => `
                <li class="config-stat-detail">
                    <span>${esc(this.cleanupFilterLabel(key))} — <span class="config-stat-sub">${esc(hint)}</span></span>
                    <span class="config-cleanup-actions">
                        <span class="config-stat-penalty">${esc(String(n))}</span>
                        <button type="button" class="config-btn config-btn--small" data-cleanup-goto="${esc(key)}">${esc(this.t('config.statsCleanupShow', 'Show'))}</button>
                    </span>
                </li>`).join('');

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsCleanupTitle', 'Cleanup candidates'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsCleanupNote', 'Each opens the matching bookmarks, where they can be tagged or removed in bulk.'))}</p>
                    <ul class="config-stat-details">${items}</ul>
                </div>`;
        },

        /** Link rot and clashes: stale, duplicates, shortcut conflicts. */
        renderStatsRot(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const line = (label, n, hint) => `
                <li class="config-stat-detail${n > 0 ? ' config-stat-detail--warn' : ''}">
                    <span>${esc(label)}${hint ? ` — <span class="config-stat-sub">${esc(hint)}</span>` : ''}</span>
                    <span class="config-stat-penalty">${esc(String(n))}</span>
                </li>`;
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsRotTitle', 'Link rot & clashes'))}</h3>
                    <ul class="config-stat-details">
                        ${line(this.t('config.statsNeverOpened', 'Never opened'), s.neverOpened)}
                        ${line(this.t('config.statsStaleDays', 'Not opened in {days} days')
                            .replace('{days}', String(this.bookmarkStaleDays())), s.stale90)}
                        ${line(this.t('config.statsUntagged', 'Untagged'), s.total - s.tagged)}
                    </ul>
                </div>`;
        },

        /**
         * How this collection is actually used, in one line.
         *
         * Everything below already states facts — 94% has a shortcut, 12% is
         * tagged, the top ten account for 43% of opens — but each sits on a
         * different tab, so the conclusion they add up to was never drawn anywhere.
         * This says which way of reaching for a bookmark is yours, which is the one
         * thing a stats page ought to be able to answer at a glance.
         *
         * Deliberately one claim, not a second list: the insights panel underneath
         * already enumerates, and repeating it louder would not be a summary.
         */
        renderStatsHeadline(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            // Scoped, because every figure it is divided into is scoped. Reading
            // allBookmarks here put a page's count over the whole library's
            // total: with 18 of a page's 20 bookmarks carrying a shortcut, the
            // headline announced 9%.
            const all = this.statsScopedBookmarks();
            const total = all.length;
            if (!total) return '';

            const shortcutPct = Math.round((s.withShortcut / total) * 100);
            const taggedPct = Math.round((s.tagged / total) * 100);
            const concentration = s.concentration || {};
            const share = Number(concentration.share) || 0;
            const everOpened = Number(concentration.usedCount) || 0;

            // Ordered by how much each says about a habit, so the strongest signal
            // wins rather than whichever happens to be first.
            let text;
            if (everOpened === 0) {
                text = this.t('config.statsHeadlineUnused',
                    'Nothing has been opened yet, so there is no habit to read from this collection.');
            } else if (shortcutPct >= 60 && shortcutPct > taggedPct) {
                text = this.t('config.statsHeadlineShortcuts',
                    'You reach for bookmarks by keystroke: {pct}% carry a shortcut, against {tagPct}% carrying tags.')
                    .replace('{pct}', String(shortcutPct)).replace('{tagPct}', String(taggedPct));
            } else if (taggedPct >= 60) {
                text = this.t('config.statsHeadlineTags',
                    'You organise by tag: {pct}% of bookmarks carry one, against {shortcutPct}% carrying a shortcut.')
                    .replace('{pct}', String(taggedPct)).replace('{shortcutPct}', String(shortcutPct));
            } else if (share >= 50) {
                text = this.t('config.statsHeadlineNarrow',
                    'A narrow habit on a broad collection: your busiest {top} bookmarks account for {share}% of all opens.')
                    .replace('{top}', String(concentration.topCount)).replace('{share}', String(share));
            } else {
                text = this.t('config.statsHeadlineBroad',
                    'Your usage is spread out: {used} of {total} bookmarks have been opened, with no small group dominating.')
                    .replace('{used}', String(everOpened)).replace('{total}', String(total));
            }

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsHeadlineTitle', 'How you use this collection'))}</h3>
                    <p class="config-stats-headline">${esc(text)}</p>
                </div>`;
        },

        /**
         * Personal usage insights: the numbers already on the page, read back as
         * sentences with somewhere to go next.
         *
         * Carried over from the old config, including its thresholds — most-active
         * page, top bookmark, never-opened share, status coverage, and whether
         * anything was opened in the last 48 hours.
         */
        renderStatsInsights(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            // Scoped like the figures it is read alongside: this panel sits under
            // the scope selector and mixed a scoped numerator into an unscoped
            // total, so its percentages described neither view.
            const all = this.statsScopedBookmarks();
            const total = all.length;
            if (!total) {
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsInsightsSection', 'Personal usage insights'))}</h3>
                        <p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>
                    </div>`;
            }

            const pageName = (id) => (this.dash.pages || [])
                .find((p) => String(p.id) === String(id))?.name || String(id);
            const pageOpens = new Map();
            all.forEach((b) => {
                const pid = String(b.pageId);
                pageOpens.set(pid, (pageOpens.get(pid) || 0) + (Number(b.openCount) || 0));
            });
            const topPage = [...pageOpens.entries()].sort((a, b) => b[1] - a[1])[0];
            const topBm = [...all].sort((a, b) => (Number(b.openCount) || 0) - (Number(a.openCount) || 0))[0];
            const neverOpened = all.filter((b) => !Number(b.openCount) && !Number(b.lastOpened)).length;
            const statusCount = all.filter((b) => b.checkStatus === true).length;
            const recent = all.filter((b) => Number(b.lastOpened || 0) >= Date.now() - 48 * 3600000).length;
            const pct = (n) => String(Math.round((n / total) * 100));

            const items = [];
            if (topPage && topPage[1] > 0) {
                items.push({
                    text: this.t('config.statsInsightTopPage', 'Most activity happens on {page} with {opens} opens.')
                        .replace('{page}', pageName(topPage[0])).replace('{opens}', String(topPage[1])),
                    tab: 'content',
                });
            }
            if (topBm && Number(topBm.openCount) > 0) {
                items.push({
                    text: this.t('config.statsInsightTopBookmark', 'Top bookmark is "{name}" with {count} opens.')
                        .replace('{name}', String(topBm.name || '—')).replace('{count}', String(Number(topBm.openCount))),
                    tab: 'activity',
                });
            }
            if (neverOpened > 0) {
                items.push({
                    text: this.t('config.statsInsightNeverOpened', '{percent}% ({count}/{total}) of bookmarks are never opened yet.')
                        .replace('{percent}', pct(neverOpened)).replace('{count}', String(neverOpened)).replace('{total}', String(total)),
                    tab: 'health',
                });
            }
            items.push({
                text: this.t('config.statsInsightStatusCoverage', 'Status checks are enabled for {percent}% ({count}/{total}) of bookmarks.')
                    .replace('{percent}', pct(statusCount)).replace('{count}', String(statusCount)).replace('{total}', String(total)),
            });
            items.push(recent > 0
                ? {
                    text: this.t('config.statsInsightRecentActivity', '{count} bookmarks were opened in the last 48 hours.')
                        .replace('{count}', String(recent)),
                    tab: 'activity',
                }
                : { text: this.t('config.statsInsightNoRecent', 'No bookmark opens recorded in the last 48 hours.') });

            const rows = items.map((it) => `
                <li class="config-stat-detail">
                    <span>${esc(it.text)}</span>
                    ${it.tab ? `<button type="button" class="config-btn config-btn--small" data-stats-goto="${esc(it.tab)}">${esc(this.statsTabLabel(it.tab))}</button>` : ''}
                </li>`).join('');

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInsightsSection', 'Personal usage insights'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsInsightsIntro', 'Quick interpretation of your usage patterns.'))}</p>
                    <ul class="config-stat-details">${rows}</ul>
                </div>`;
        },

        /** Shortcut coverage, and which shortcuts actually earn their keystroke. */
        renderStatsShortcuts(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            // Scoped, so the table lists the same bookmarks the note above it
            // counts: it used to say "18 of 20 have a shortcut" and then list
            // twenty rows from pages the scope excluded.
            const all = this.statsScopedBookmarks();
            const pageName = (id) => (this.dash.pages || [])
                .find((p) => String(p.id) === String(id))?.name || String(id);
            const rows = all
                .filter((b) => String(b.shortcut || '').trim())
                .sort((a, b) => (Number(b.openCount) || 0) - (Number(a.openCount) || 0))
                .slice(0, 20)
                .map((b) => `
                    <tr>
                        <th scope="row">${esc(String(b.shortcut).toUpperCase())}</th>
                        <td>${esc(b.name || '—')}</td>
                        <td>${esc(String(Number(b.openCount) || 0))}</td>
                        <td>${esc(pageName(b.pageId))}</td>
                    </tr>`).join('');

            return `
                <div class="config-panel" id="config-stats-shortcuts">
                    <h3 class="config-panel-title">${esc(this.t('config.statsShortcutsTitle', 'Shortcuts'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsShortcutCoverage', '{count} of {total} bookmarks have a shortcut ({pct}%)')
                        .replace('{count}', String(s.withShortcut))
                        .replace('{total}', String(s.total))
                        .replace('{pct}', String(s.total ? Math.round((s.withShortcut / s.total) * 100) : 0)))}</p>
                    ${rows ? `
                    <h4 class="config-theme-group-title">${esc(this.t('config.statsSubTopShortcuts', 'Top shortcuts by opens'))}</h4>
                    <table class="config-stats-table">
                        <thead><tr>
                            <th scope="col">${esc(this.t('config.statsColShortcut', 'Shortcut'))}</th>
                            <th scope="col">${esc(this.t('config.statsColBookmark', 'Bookmark'))}</th>
                            <th scope="col">${esc(this.t('config.statsColOpens', 'Opens'))}</th>
                            <th scope="col">${esc(this.t('config.statsColPage', 'Page'))}</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>` : `<p class="config-panel-empty">${esc(this.t('config.statsNoData', 'No data yet'))}</p>`}
                </div>`;
        },

        /**
         * Finders, with their use counts. Loaded separately because finders are not
         * part of the bookmark set the rest of the stats derive from.
         */
        renderStatsFinders() {
            const esc = (v) => this.dash.escapeHtml(v);
            if (this._statsFinders === undefined) {
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsFindersTitle', 'Finders'))}</h3>
                        <p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>
                    </div>`;
            }
            const finders = this._statsFinders || [];
            const totalUses = finders.reduce((n, f) => n + (Number(f.useCount) || 0), 0);
            const withShortcut = finders.filter((f) => String(f.shortcut || '').trim()).length;
            const rows = [...finders]
                .sort((a, b) => (Number(b.useCount) || 0) - (Number(a.useCount) || 0))
                .slice(0, 20)
                .map((f) => `
                    <tr>
                        <th scope="row">${esc(f.name || '—')}</th>
                        <td>${esc(String(f.shortcut || '—'))}</td>
                        <td>${esc(String(Number(f.useCount) || 0))}</td>
                    </tr>`).join('');

            // One accessible name per tile; see the overview tile for why.
            const tile = (label, value) => `
                <div class="config-tile" role="listitem" aria-label="${esc(label)}: ${esc(String(value))}">
                    <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                    <span class="config-tile-value" aria-hidden="true">${esc(String(value))}</span>
                </div>`;

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsFindersTitle', 'Finders'))}</h3>
                    <div class="config-tiles" role="list">
                        ${tile(this.t('config.statsFindersTotal', 'Finders total'), finders.length)}
                        ${tile(this.t('config.statsFindersUsesTotal', 'Total finder uses'), totalUses)}
                        ${tile(this.t('config.statsFindersWithShortcut', 'With shortcut'), withShortcut)}
                    </div>
                    ${rows ? `
                    <h4 class="config-theme-group-title">${esc(this.t('config.statsSubTopFinders', 'Top finders by use count'))}</h4>
                    <table class="config-stats-table">
                        <thead><tr>
                            <th scope="col">${esc(this.t('config.statsColName', 'Name'))}</th>
                            <th scope="col">${esc(this.t('config.statsColShortcut', 'Shortcut'))}</th>
                            <th scope="col">${esc(this.t('config.statsColUses', 'Uses'))}</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>` : `<p class="config-panel-empty">${esc(this.t('config.findersEmpty', 'No finders yet.'))}</p>`}
                </div>`;
        },

        /** Finders are their own resource, so the stats view fetches them itself. */
        renderStatsConflicts(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const CAP = 8;
            const more = (n) => (n > CAP
                ? this.t('config.statsConflictMore', ' +{count} more').replace('{count}', String(n - CAP))
                : '');

            const dupes = s.duplicateUrlList || [];
            const clashes = s.shortcutConflictList || [];

            let detail;
            if (!dupes.length && !clashes.length) {
                detail = `<p class="config-panel-empty">${esc(this.t('config.statsNoConflictsFound', 'No conflicts found.'))}</p>`;
            } else {
                const parts = [];
                if (dupes.length) {
                    const labels = dupes.slice(0, CAP).map(([url, c]) => {
                        const display = url.length > 50 ? `${url.slice(0, 47)}…` : url;
                        return `${display} (×${c})`;
                    }).join(', ');
                    parts.push(`<p class="config-field-hint">${esc(this.t('config.statsDuplicateUrlsDetail', 'Duplicate URLs: {labels}{more}')
                        .replace('{labels}', labels).replace('{more}', more(dupes.length)))}</p>`);
                }
                if (clashes.length) {
                    const labels = clashes.slice(0, CAP).map(([sc, c]) => `${sc} (×${c})`).join(', ');
                    parts.push(`<p class="config-field-hint">${esc(this.t('config.statsConflictingShortcuts', 'Conflicting shortcuts: {labels}{more}')
                        .replace('{labels}', labels).replace('{more}', more(clashes.length)))}</p>`);
                }
                detail = parts.join('');
            }

            const line = (label, n) => `
                <li class="config-stat-detail${n > 0 ? ' config-stat-detail--warn' : ''}">
                    <span>${esc(label)}</span>
                    <span class="config-stat-penalty">${esc(String(n))}</span>
                </li>`;

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsConflictsTitle', 'Conflicts & duplicates'))}</h3>
                    <ul class="config-stat-details">
                        ${line(this.t('config.statsDuplicateUrls', 'Duplicate URLs'), s.duplicateUrls)}
                        ${line(this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), s.shortcutConflicts)}
                    </ul>
                    ${detail}
                    ${(dupes.length || clashes.length) ? `
                    <div class="config-actions">
                        <button type="button" class="config-btn config-btn--small" data-stats-action="open-health">${esc(this.t('config.statsOpenInHealth', 'Open in Health'))}</button>
                    </div>` : ''}
                </div>`;
        },

        /**
         * Search & status: which search behaviours are on, and how much of the
         * collection opts into availability checking. These are settings rather
         * than derived counts, so they read from settings directly.
         */
        renderStatsSearch(s) {
            const esc = (v) => this.dash.escapeHtml(v);
            const set = this.dash.settings || {};
            const yes = this.t('config.statsYes', 'Yes');
            const no = this.t('config.statsNo', 'No');
            const onOff = (v) => (v ? yes : no);

            const row = (label, value) => `
                <li class="config-stat-detail">
                    <span>${esc(label)}</span>
                    <span class="config-stat-penalty">${esc(String(value))}</span>
                </li>`;

            // Whether the search component actually loaded — the honest signal, and
            // the only one there is now that the unused index endpoint is gone.
            const searchReady = Boolean(this.dash.searchComponent);

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsSearchTitle', 'Search & status'))}</h3>
                    <ul class="config-stat-details">
                        ${row(this.t('config.statsSearchReady', 'Search ready'), onOff(searchReady))}
                        ${row(this.t('config.statsInterleave', 'Interleave search mode'), onOff(set.interleaveMode))}
                        ${row(this.t('config.statsFuzzy', 'Fuzzy suggestions'), onOff(set.enableFuzzySuggestions !== false))}
                        ${row(this.t('config.statsShowStatus', 'Status monitor enabled'), onOff(set.showStatus !== false))}
                        ${row(this.t('config.statsStatusCheckBookmarks', 'Bookmarks with status check'), s.checked)}
                        ${row(this.t('config.statsMonitored', 'Monitored'), s.monitored)}
                    </ul>
                </div>`;
        },

        /**
         * Everything derivable from the shell's own bookmark/page copies, including
         * the cleanup score and the activity buckets.
         */
        /**
         * Labels a `pageId::category` key for the statistics panels.
         *
         * knownCategories() is page-scoped — it reads bmPageFilter — so calling it
         * here would label against whatever filter the Bookmarks section was left
         * on. This walks every page instead, and only prefixes the page name when
         * the same category name exists on more than one page: without that, every
         * row on a single-page install would read "main · Development".
         */
        statsScopeNote() {
            const page = this.statsScopePage();
            if (!page) return '';
            // On a single-page install there is no narrowing to explain: the
            // note would answer a question the reader has no way to ask.
            if ((this.dash.pages || []).length < 2) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            return `<p class="config-panel-note config-stats-scope-note">${esc(
                this.t('config.statsScopeWholeLibrary', 'These figures cover the whole library, not just {page}.')
                    .replace('{page}', page.name || `#${page.id}`))}</p>`;
        },

        /** The page the figures describe, or null for the whole library. */
        renderStatsHealthTrend() {
            const esc = (v) => this.dash.escapeHtml(v);
            const points = Array.isArray(this._statsHealth?.trend) ? this._statsHealth.trend : [];
            const percent = (p) => {
                const total = Number(p?.n) || 0;
                return total ? Math.round(((Number(p?.h) || 0) / total) * 100) : null;
            };
            const values = points.map(percent);
            const known = values.filter((v) => v !== null);
            // Two days is a before and an after, not a trend; below that the panel
            // says what it is waiting for rather than drawing a dot.
            if (known.length < 2) {
                return `<p class="config-panel-note">${esc(this.t('config.statsHealthTrendWaiting',
                    'A day is recorded each time the health report runs. Once there are a few, the change over time appears here.'))}</p>`;
            }

            const first = known[0];
            const last = known[known.length - 1];
            const delta = last - first;
            const days = points.length;
            const word = delta === 0
                ? this.t('config.statsHealthTrendFlat', 'unchanged over {days} recorded days')
                : (delta > 0
                    ? this.t('config.statsHealthTrendUp', 'up {points} points over {days} recorded days')
                    : this.t('config.statsHealthTrendDown', 'down {points} points over {days} recorded days'));
            const summary = word.replace('{points}', String(Math.abs(delta))).replace('{days}', String(days));

            const W = 240;
            const H = 44;
            const step = values.length > 1 ? W / (values.length - 1) : W;
            // Fixed 0–100 axis: a self-scaling one would turn a two-point wobble
            // into a cliff, which is the opposite of what a trend is for.
            const coords = values.map((v, i) => (v === null
                ? null
                : `${(i * step).toFixed(1)},${(H - (v / 100) * H).toFixed(1)}`));
            // Gaps break the line rather than joining across them: a day the app
            // was never opened is missing data, not a straight run.
            const segments = [];
            let current = [];
            coords.forEach((c) => {
                if (c === null) {
                    if (current.length > 1) segments.push(current.join(' '));
                    current = [];
                } else {
                    current.push(c);
                }
            });
            if (current.length > 1) segments.push(current.join(' '));

            const tone = delta > 0 ? 'good' : (delta < 0 ? 'bad' : '');
            const lines = segments.map((pts) =>
                `<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>`).join('');
            const rows = points.map((p, i) => {
                const v = values[i];
                const date = new Date(Number(p?.t) || 0).toISOString().slice(0, 10);
                return `<tr><th scope="row">${esc(date)}</th><td>${v === null ? '—' : esc(String(v))}</td></tr>`;
            }).join('');

            return `
                <div class="config-stats-trend${tone ? ` config-stats-trend--${tone}` : ''}">
                    <svg class="config-stats-trend-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
                         role="img" aria-label="${esc(this.t('config.statsHealthTrendAria', 'Healthy share over time'))}: ${esc(summary)}">
                        ${lines}
                    </svg>
                    <p class="config-stats-trend-summary">
                        <strong>${esc(String(last))}%</strong> ${esc(this.t('config.statsHealthy', 'Healthy'))} · ${esc(summary)}
                    </p>
                </div>
                <table class="config-sr-only">
                    <caption>${esc(this.t('config.statsHealthTrendAria', 'Healthy share over time'))}</caption>
                    <thead><tr><th scope="col">${esc(this.t('config.statsAxisDay', 'Day'))}</th><th scope="col">%</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
        },

        renderStatsHealth() {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            if (h === undefined) {
                return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            if (h === null) {
                return `<p class="config-panel-empty">${esc(this.t('config.statsHealthUnavailable', 'Health data is not available.'))}</p>`;
            }
            /*
             * Every state a bookmark can be in, not three of them.
             *
             * The denominator was healthy + broken + unchecked, which left out
             * monitorDown and content -- and those two are exactly the states
             * the server splits out so the totals add up (see HealthSummary in
             * models.go: "a bookmark is in exactly one of the three"). With 67
             * healthy, nothing broken and two monitors down, this panel read
             * "Healthy 100%" directly above a row saying "Monitors down 2".
             *
             * Drift is deliberately not in here. It sits on top of whatever
             * status a bookmark already has, so adding it would count the same
             * bookmark twice.
             */
            const total = Math.max(1, h.healthy + h.broken + h.monitorDown + h.content + h.unchecked);
            const pct = Math.round((h.healthy / total) * 100);
            const line = (label, n, tone) => `
                <li class="config-stat-detail${tone ? ' config-stat-detail--' + tone : ''}">
                    <span>${esc(label)}</span>
                    <span class="config-stat-penalty">${esc(String(n))}</span>
                </li>`;
            return `
                ${this.statsScopeNote()}
                ${this.renderStatsHealthTrend()}
                ${this.statsScaleCaption(this.t('config.statsAxisShareHealthy',
                    'Healthy share of {total} tracked bookmarks — 0% to 100%').replace('{total}', String(total)))}
                <div class="config-ratio">
                    <div class="config-ratio-head">
                        <span class="config-ratio-label">${esc(this.t('config.statsHealthy', 'Healthy'))}</span>
                        <span class="config-ratio-value">${pct}%</span>
                    </div>
                    <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsHealthy', 'Healthy'))}: ${pct}%">
                        <span class="config-bar-fill config-bar-fill--good" style="width:${pct}%"></span>
                    </div>
                </div>
                ${this.statsPairAxisHeader(
                    this.t('config.statsAxisState', 'State'),
                    this.t('config.statsAxisBookmarks', 'Bookmarks'))}
                <ul class="config-stat-details">
                    ${line(this.t('config.statsHealthy', 'Healthy'), h.healthy, 'good')}
                    ${line(this.t('config.statsBroken', 'Broken'), h.broken, h.broken ? 'bad' : '')}
                    ${line(this.t('config.statsMonitorDown', 'Monitors down'), h.monitorDown, h.monitorDown ? 'bad' : '')}
                    ${line(this.t('config.statsContentFailing', 'Answering, but not as expected'), h.content, h.content ? 'bad' : '')}
                    ${line(this.t('config.statsUnchecked', 'Unchecked'), h.unchecked)}
                    ${line(this.t('config.statsStale', 'Stale'), h.stale, h.stale ? 'warn' : '')}
                    ${line(this.t('config.statsDrift', 'Changed since you looked'), h.drift, h.drift ? 'warn' : '')}
                    ${line(this.t('config.statsDuplicates', 'Duplicates'), h.duplicates, h.duplicates ? 'warn' : '')}
                    ${line(this.t('config.statsShortcutConflicts', 'Shortcut conflicts'), h.shortcutConflicts, h.shortcutConflicts ? 'warn' : '')}
                    ${line(this.t('config.statsOrphanedCategories', 'In a category that no longer exists'), h.orphanedCategories, h.orphanedCategories ? 'warn' : '')}
                </ul>`;
        },

        /*
         * Monitoring, as one reading rather than a count of monitors.
         *
         * The Health tab said how many bookmarks are monitored and never how
         * well they did, while the server had already pooled it: uptime over
         * three windows, mean response, outages, and how many are failing right
         * now. Pooled by sample rather than averaged per monitor, so a service
         * checked every five minutes does not weigh the same as one checked
         * hourly.
         *
         * Nothing is drawn for an install with no monitors -- there is no
         * reading to report, and an empty panel reads as a broken one.
         */
        renderStatsUptime() {
            const esc = (v) => this.dash.escapeHtml(v);
            const fleet = this._statsHealth?.fleet;
            if (!fleet || !Number(fleet.monitors)) return '';

            const pct = (window) => {
                const samples = Number(window?.samples) || 0;
                if (!samples) return null;
                return Math.round((Number(window.ratio) || 0) * 1000) / 10;
            };
            const windows = [
                [this.t('config.statsUptime24h', 'Last 24 hours'), pct(fleet.uptime24h), fleet.uptime24h],
                [this.t('config.statsUptime7d', 'Last 7 days'), pct(fleet.uptime7d), fleet.uptime7d],
                [this.t('config.statsUptime30d', 'Last 30 days'), pct(fleet.uptime30d), fleet.uptime30d],
            ];
            // A window with no samples is a window nothing was recorded in,
            // which is not the same as one that was down.
            const bars = windows.map(([label, value, raw]) => {
                if (value === null) {
                    return `
                    <div class="config-ratio">
                        <div class="config-ratio-head">
                            <span class="config-ratio-label">${esc(label)}</span>
                            <span class="config-ratio-value config-ratio-value--muted">${esc(this.t('config.statsUptimeNoSamples', 'nothing recorded'))}</span>
                        </div>
                    </div>`;
                }
                const tone = value >= 99 ? 'good' : (value >= 95 ? 'warn' : 'crit');
                return `
                <div class="config-ratio">
                    <div class="config-ratio-head">
                        <span class="config-ratio-label">${esc(label)}</span>
                        <span class="config-ratio-value">${esc(this.statsNumber(value))}% <span class="config-ratio-sub">${
                            esc(this.t('config.statsUptimeSamples', '{n} checks')
                                .replace('{n}', this.statsNumber(Number(raw?.samples) || 0)))}</span></span>
                    </div>
                    <div class="config-bar" role="img" aria-label="${esc(label)}: ${value}%">
                        <span class="config-bar-fill config-bar-fill--${tone}" style="width:${value}%"></span>
                    </div>
                </div>`;
            }).join('');

            const facts = [
                [this.t('config.statsMonitors', 'Monitors'), this.statsNumber(fleet.monitors), ''],
                [this.t('config.statsMonitorDownNow', 'Failing right now'),
                    this.statsNumber(Number(fleet.downNow) || 0), Number(fleet.downNow) ? 'bad' : ''],
                ...(Number(fleet.avgResponseMs) ? [[this.t('config.statsAvgResponse', 'Average response'),
                    `${this.statsNumber(fleet.avgResponseMs)} ms`, '']] : []),
                ...(Number(fleet.totalIncidents) ? [[this.t('config.statsIncidents', 'Outages on record'),
                    this.statsNumber(fleet.totalIncidents), 'warn']] : []),
            ];

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsUptimeTitle', 'Uptime'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsUptimeHint',
                        'Pooled across every monitor by check, so a service checked often does not outweigh one checked rarely.'))}</p>
                    ${this.statsPairAxisHeader(
                        this.t('config.statsAxisMeasure', 'Measure'),
                        this.t('config.statsAxisValue', 'Value'))}
                    <ul class="config-stat-details">
                        ${facts.map(([label, value, tone]) => `
                        <li class="config-stat-detail${tone ? ' config-stat-detail--' + tone : ''}">
                            <span>${esc(label)}</span>
                            <span class="config-stat-penalty">${esc(String(value))}</span>
                        </li>`).join('')}
                    </ul>
                    ${this.statsScaleCaption(this.t('config.statsAxisUptime',
                        'Share of checks that succeeded — 0% to 100%'))}
                    ${bars}
                </div>`;
        },

        /*
         * Certificates worth knowing about, counted by host.
         *
         * Ten bookmarks on one domain share one certificate, and the server
         * stores the expiry that way for exactly that reason -- counting per
         * bookmark would report one renewal ten times.
         *
         * Only the ones close to expiry are here, because that is all the report
         * carries: expiringCertificatesWith drops anything still "ok", so a
         * total of certificates seen is not a figure this data can give. Nothing
         * is drawn when the list is empty, which is the ordinary case and reads
         * correctly as "nothing to do".
         *
         * The window is the reader's own certWarnDays, so this panel and the
         * notification that fires agree on what "soon" means.
         */
        renderStatsCertificates() {
            const esc = (v) => this.dash.escapeHtml(v);
            const certs = Object.values(this._statsHealth?.certificates || {});
            if (!certs.length) return '';

            const warnDays = this.certWarnDays();
            const now = Date.now();
            const day = 86400000;
            let expired = 0;
            let soon = 0;
            let nearest = null;
            certs.forEach((c) => {
                const at = Number(c?.expiresAt) || 0;
                if (!at) return;
                if (at < now) expired += 1;
                else soon += 1;
                if (!nearest || at < Number(nearest.expiresAt)) nearest = c;
            });

            // Days left rounds down -- two and a half days left is "2 days".
            // Days since expiry has to round down on its own elapsed value, not
            // on a negative: flooring -3.0001 gave "4 days ago" for a
            // certificate that went three days ago.
            const nearestAt = nearest ? Number(nearest.expiresAt) : 0;
            const nearestDays = nearest
                ? (nearestAt < now ? -Math.floor((now - nearestAt) / day) : Math.floor((nearestAt - now) / day))
                : null;
            const rows = [
                [this.t('config.statsCertsExpired', 'Already expired'), this.statsNumber(expired),
                    expired ? 'bad' : ''],
                [this.t('config.statsCertsSoon', 'Expiring within {days} days').replace('{days}', String(warnDays)),
                    this.statsNumber(soon), soon ? 'warn' : ''],
            ];

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsCertsTitle', 'Certificates'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsCertsHint',
                        'Only certificates near expiry are reported, one per host, and only for hosts reached over HTTPS. An empty panel means none are close.'))}</p>
                    ${this.statsPairAxisHeader(
                        this.t('config.statsAxisState', 'State'),
                        this.t('config.statsAxisHosts', 'Hosts'))}
                    <ul class="config-stat-details">
                        ${rows.map(([label, value, tone]) => `
                        <li class="config-stat-detail${tone ? ' config-stat-detail--' + tone : ''}">
                            <span>${esc(label)}</span>
                            <span class="config-stat-penalty">${esc(String(value))}</span>
                        </li>`).join('')}
                    </ul>
                    ${nearest && nearestDays !== null ? `<p class="config-panel-note">${esc(
                        nearestDays < 0
                            ? this.t('config.statsCertsExpiredHost', 'Expired: {host}, {days} days ago.')
                                .replace('{host}', String(nearest.host || ''))
                                .replace('{days}', String(Math.abs(nearestDays)))
                            : this.t('config.statsCertsNearest', 'Next to expire: {host}, in {days} days.')
                                .replace('{host}', String(nearest.host || ''))
                                .replace('{days}', String(nearestDays)))}</p>` : ''}
                </div>`;
        },

        /*
         * How much of the collection has a copy kept here.
         *
         * A broken link with a stored copy is an inconvenience; a broken link
         * without one is gone. That difference is the whole point of the
         * archive, and nothing in this section reported it -- the figure was
         * only ever on a widget the reader has to have added.
         *
         * Counted off the report's own rows rather than with a second request:
         * it carries one entry per bookmark and each says how many copies it
         * has.
         */
        renderStatsArchive() {
            const esc = (v) => this.dash.escapeHtml(v);
            const h = this._statsHealth;
            if (!h || !h.tracked) return '';
            const pct = Math.round((h.archived / h.tracked) * 100);
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsArchiveTitle', 'Archive coverage'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsArchiveHint',
                        'A dead link with a copy kept here is still readable. One without it is gone.'))}</p>
                    ${this.statsScaleCaption(this.t('config.statsAxisShareArchived',
                        'Share of {total} bookmarks with a copy kept — 0% to 100%')
                        .replace('{total}', this.statsNumber(h.tracked)))}
                    <div class="config-ratio">
                        <div class="config-ratio-head">
                            <span class="config-ratio-label">${esc(this.t('config.statsArchived', 'With a copy kept'))}</span>
                            <span class="config-ratio-value">${esc(this.statsNumber(h.archived))} / ${
                                esc(this.statsNumber(h.tracked))} · ${pct}%</span>
                        </div>
                        <div class="config-bar" role="img" aria-label="${esc(this.t('config.statsArchived', 'With a copy kept'))}: ${pct}%">
                            <span class="config-bar-fill config-bar-fill--${pct >= 50 ? 'good' : 'warn'}" style="width:${pct}%"></span>
                        </div>
                    </div>
                </div>`;
        },

        /*
         * What is in the dashboard besides bookmarks.
         *
         * Widgets, feeds, sources, the trash and the automatic backups are each
         * a feature a reader turns on and then stops thinking about, and no
         * screen ever said how many of them there are. A widget on a page you
         * rarely open, a feed that has stopped, thirty things in the trash: all
         * knowable, none reported.
         *
         * The figures arrive on their own, so the panel is a shell the loader
         * fills -- the same shape the health and inbox panels use.
         */
        renderStatsLibrary() {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsLibraryTitle', 'Beyond bookmarks'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsLibraryHint',
                        'The rest of what this install holds — blocks on your pages, what feeds them, and what it keeps.'))}</p>
                    <div id="config-stats-library">${this.renderStatsLibraryBody()}</div>
                </div>`;
        },

        renderStatsLibraryBody() {
            const esc = (v) => this.dash.escapeHtml(v);
            const lib = this._statsLibrary;
            if (lib === undefined) {
                return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            if (!lib) {
                return `<p class="config-panel-empty">${esc(this.t('config.statsLibraryUnavailable',
                    'These figures could not be read.'))}</p>`;
            }

            // A figure that could not be fetched is left out, not shown as zero:
            // "0 feeds" and "we could not ask" are different answers.
            const rows = [];
            const add = (label, value, detail) => {
                if (value === null || value === undefined) return;
                rows.push([label, value, detail || '']);
            };

            const types = lib.widgetTypes || [];
            add(this.t('config.statsLibraryWidgets', 'Widgets on your pages'),
                this.statsNumber(lib.widgets),
                types.length
                    ? types.slice(0, 4).map(([type, n]) =>
                        `${this.widgetTypeName(type)} ${this.statsNumber(n)}`).join(' · ')
                    : '');
            add(this.t('config.statsLibraryFeeds', 'Feeds'), this.statsNumber(lib.feeds),
                lib.feedsEnabled === false ? this.t('config.statsLibraryOff', 'switched off') : '');
            add(this.t('config.statsLibrarySources', 'Import sources'), this.statsNumber(lib.sources));
            add(this.t('config.statsLibraryTrash', 'Waiting in the trash'), this.statsNumber(lib.trash));
            add(this.t('config.statsLibraryBackups', 'Automatic backups kept'), this.statsNumber(lib.backups),
                lib.backupsEnabled === false ? this.t('config.statsLibraryOff', 'switched off') : '');

            if (!rows.length) {
                return `<p class="config-panel-empty">${esc(this.t('config.statsLibraryUnavailable',
                    'These figures could not be read.'))}</p>`;
            }

            return `
                ${this.statsPairAxisHeader(
                    this.t('config.statsAxisThing', 'Thing'),
                    this.t('config.statsAxisCount', 'How many'))}
                <ul class="config-stat-details">
                    ${rows.map(([label, value, detail]) => `
                    <li class="config-stat-detail">
                        <span>${esc(label)}${detail ? ` <span class="config-stat-detail-note">${esc(detail)}</span>` : ''}</span>
                        <span class="config-stat-penalty">${esc(String(value))}</span>
                    </li>`).join('')}
                </ul>`;
        },

        /**
         * Inbox figures come from two places: /api/inbox is the current snapshot,
         * /api/inbox-stats the durable lifetime aggregate that survives items being
         * triaged away. Neither can be derived from the other, so both are fetched.
         */
        renderStatsInbox() {
            const esc = (v) => this.dash.escapeHtml(v);
            return `
                <p class="config-view-intro">${esc(this.t('config.statsInboxIntro', 'What is waiting in the inbox, and how much of it you turn into bookmarks.'))}</p>
                ${this.statsScopeNote()}
                <div id="config-stats-inbox">${this.renderStatsInboxBody()}</div>`;
        },

        /**
         * The snapshot and lifetime blocks, using the old config's own figures:
         * backlog is unread older than 30 days, and conversion is promoted against
         * everything triaged (promoted + discarded) rather than against everything
         * ever added, which would never reach 100%.
         */
        renderStatsInboxBody() {
            const esc = (v) => this.dash.escapeHtml(v);
            if (this._statsInboxItems === undefined) {
                return `<p class="config-view-loading">${esc(this.t('config.backupLoading', 'Loading…'))}</p>`;
            }
            const items = this._statsInboxItems || [];
            const agg = this._statsInboxAgg || {};
            const now = Date.now();

            const unread = items.filter((it) => !Number(it?.readAt));
            const read = items.length - unread.length;
            const oldestUnreadAt = unread.reduce((min, it) => {
                const added = Number(it?.addedAt || 0);
                return added > 0 && added < min ? added : min;
            }, Number.POSITIVE_INFINITY);
            const backlogCutoff = now - 30 * 86400000;
            const backlog = unread.filter((it) =>
                Number(it?.addedAt || 0) > 0 && Number(it.addedAt) < backlogCutoff).length;
            const withTags = items.filter((it) =>
                Array.isArray(it?.tags) && it.tags.some((t) => String(t || '').trim())).length;
            const withNote = items.filter((it) => String(it?.note || '').trim()).length;
            const withPreview = items.filter((it) => String(it?.previewImage || '').trim()).length;

            const added = Number(agg.totalAdded || 0);
            const promoted = Number(agg.totalPromoted || 0);
            const deleted = Number(agg.totalDeleted || 0);
            // Promoted and deleted are the two ways a link leaves the inbox, and
            // they are the whole denominator. Kept is not triage: it is recorded
            // on every mark-read, and a read link is still waiting to be decided
            // on. The "Read (kept)" tile above counts the read items currently in
            // the inbox, which is a different figure from the lifetime kept
            // counter -- so including it here reconciled nothing and double-
            // counted every link read before it was promoted.
            const triaged = promoted + deleted;
            const pct = triaged > 0 ? Math.round((promoted / triaged) * 100) : 0;
            const avgRetention = Number(agg.retentionCount || 0) > 0
                ? Number(agg.sumRetentionMs || 0) / Number(agg.retentionCount)
                : 0;

            // One accessible name per tile; see the overview tile for why.
            const tile = (label, value) => `
                <div class="config-tile" role="listitem" aria-label="${esc(label)}: ${esc(String(value))}">
                    <span class="config-tile-label" aria-hidden="true">${esc(label)}</span>
                    <span class="config-tile-value" aria-hidden="true">${esc(String(value))}</span>
                </div>`;

            // Inflow per source, current inbox against lifetime, so a source that
            // has been fully triaged still shows up.
            const currentBySource = new Map();
            items.forEach((it) => {
                const key = String(it?.source || '').trim() || 'unknown';
                currentBySource.set(key, (currentBySource.get(key) || 0) + 1);
            });
            const lifetimeBySource = agg.bySource && typeof agg.bySource === 'object' ? agg.bySource : {};
            const sourceKeys = [...new Set([...currentBySource.keys(), ...Object.keys(lifetimeBySource)])].sort();
            const sourceLabel = (key) => this.t(
                `config.statsInboxSource${key.charAt(0).toUpperCase()}${key.slice(1)}`, key);
            const sourceRows = sourceKeys.map((key) => `
                <tr>
                    <th scope="row">${esc(sourceLabel(key))}</th>
                    <td>${esc(String(currentBySource.get(key) || 0))}</td>
                    <td>${esc(String(Number(lifetimeBySource[key]) || 0))}</td>
                </tr>`).join('');

            const since = Number(agg.firstEventAt || 0) > 0
                ? `<p class="config-panel-note">${esc(this.t('config.statsInboxSince', 'Lifetime counters since {date}.')
                    .replace('{date}', new Date(Number(agg.firstEventAt)).toLocaleDateString()))}</p>`
                : '';

            return `
                ${this.renderStatsInboxTrend(agg)}
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubCurrent', 'Current inbox'))}</h3>
                    <div class="config-tiles" role="list">
                        ${tile(this.t('config.statsInboxTotal', 'Inbox items'), items.length)}
                        ${tile(this.t('config.statsInboxUnread', 'Unread'), unread.length)}
                        ${tile(this.t('config.statsInboxRead', 'Read (kept)'), read)}
                        ${tile(this.t('config.statsInboxBacklog', 'Unread > 30d'), backlog)}
                        ${tile(this.t('config.statsInboxOldestUnread', 'Oldest unread'),
                            Number.isFinite(oldestUnreadAt) ? this.formatDurationShort(now - oldestUnreadAt) : '—')}
                        ${tile(this.t('config.statsInboxWithTags', 'With tags'), withTags)}
                        ${tile(this.t('config.statsInboxWithNote', 'With note'), withNote)}
                        ${tile(this.t('config.statsInboxWithPreview', 'With preview'), withPreview)}
                    </div>
                </div>

                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubThroughput', 'Triage throughput'))}</h3>
                    ${since}
                    <div class="config-tiles" role="list">
                        ${tile(this.t('config.statsInboxAdded', 'Added'), added)}
                        ${tile(this.t('config.statsInboxPromoted', 'Converted'), promoted)}
                        ${tile(this.t('config.statsInboxDeleted', 'Discarded'), deleted)}
                        ${tile(this.t('config.statsInboxAvgRetention', 'Avg. time to triage'), this.formatDurationShort(avgRetention))}
                    </div>
                    <div class="config-ratio" style="margin-top:12px">
                        <div class="config-bar" role="img" aria-label="${esc(String(pct))}%">
                            <span class="config-bar-fill" style="width:${pct}%"></span>
                        </div>
                        <p class="config-field-hint">${esc(this.t('config.statsInboxConversion',
                            '{promoted} of {triaged} triaged items converted to bookmarks ({pct}%)')
                            .replace('{promoted}', String(promoted))
                            .replace('{triaged}', String(triaged))
                            .replace('{pct}', String(pct)))}</p>
                    </div>
                </div>

                ${sourceKeys.length ? `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInboxSubSources', 'Inbox by source'))}</h3>
                    <table class="config-stats-table">
                        <thead><tr>
                            <th scope="col">${esc(this.t('config.statsInboxColSource', 'Source'))}</th>
                            <th scope="col">${esc(this.t('config.statsInboxColCurrent', 'In inbox now'))}</th>
                            <th scope="col">${esc(this.t('config.statsInboxColLifetime', 'Added (lifetime)'))}</th>
                        </tr></thead>
                        <tbody>${sourceRows}</tbody>
                    </table>
                </div>` : ''}`;
        },

        /**
         * Inbox throughput per day: what came in against what was dealt with.
         *
         * The server has kept this all along — inbox-stats.json carries dailyBuckets
         * keyed YYYY-MM-DD, and its own comment says "for the trend chart" — but
         * nothing ever drew it, so the Inbox tab showed lifetime totals and no sense
         * of whether the backlog was growing or shrinking.
         *
         * It is also the only honest time series in Statistics. The activity chart
         * can only bucket bookmarks by their single lastOpened; here each day was
         * genuinely recorded as it happened.
         *
         * Two series, so a legend is required rather than optional; triaged stacks
         * promoted and discarded, since together they are "dealt with" and the split
         * between them is secondary.
         */
        renderStatsInboxTrend(agg) {
            const esc = (v) => this.dash.escapeHtml(v);
            const daily = agg?.dailyBuckets && typeof agg.dailyBuckets === 'object' ? agg.dailyBuckets : null;
            const keys = daily ? Object.keys(daily).sort() : [];
            if (!keys.length) return '';

            // Days with no events are absent from the map, not zero — without
            // filling them a quiet week would compress into a misleadingly busy
            // chart. Bounded by the range the user already picked for activity.
            const DAY = 86400000;
            const days = Math.min(this.statsRange || 30, 90);
            const today = new Date();
            const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            const series = [];
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today.getTime() - i * DAY);
                const key = iso(date);
                const b = daily[key] || {};
                series.push({
                    key,
                    date,
                    added: Number(b.added || 0),
                    triaged: Number(b.promoted || 0) + Number(b.deleted || 0),
                });
            }
            // Nothing inside the window, even though history exists further back.
            if (!series.some((d) => d.added || d.triaged)) {
                return `
                    <div class="config-panel">
                        <h3 class="config-panel-title">${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</h3>
                        <p class="config-panel-empty">${esc(this.t('config.statsInboxTrendEmpty', 'No inbox activity in this period.'))}</p>
                    </div>`;
            }

            const W = 500;
            const H = 108;
            const n = series.length;
            const slot = W / n;
            const barW = Math.max(1, (slot - 3) / 2);
            const max = Math.max(...series.map((d) => Math.max(d.added, d.triaged)), 1);
            const fmt = new Intl.DateTimeFormat(this.dash.settings?.language || undefined,
                { day: 'numeric', month: 'short' });

            const addedLabel = this.t('config.statsInboxTrendAdded', 'Added');
            const triagedLabel = this.t('config.statsInboxTrendTriaged', 'Dealt with');
            const bars = series.map((d, i) => {
                const x = i * slot;
                const hA = Math.round((d.added / max) * H);
                const hT = Math.round((d.triaged / max) * H);
                const label = `${fmt.format(d.date)}: ${d.added} ${addedLabel}, ${d.triaged} ${triagedLabel}`;
                return `<g class="config-chart-bar" tabindex="0" role="listitem"
                           data-bar-date="${esc(fmt.format(d.date))}"
                           data-bar-value="${esc(String(d.added))}"
                           data-bar-value2="${esc(String(d.triaged))}"
                           aria-label="${esc(label)}">
                    <rect class="config-chart-bar-hit" x="${x.toFixed(2)}" y="0" width="${slot.toFixed(2)}" height="${H}"></rect>
                    <rect class="config-chart-bar-fill config-chart-bar-fill--a" x="${x.toFixed(2)}" y="${H - hA}" width="${barW.toFixed(2)}" height="${Math.max(hA, d.added > 0 ? 2 : 0)}" rx="1"></rect>
                    <rect class="config-chart-bar-fill config-chart-bar-fill--b" x="${(x + barW + 2).toFixed(2)}" y="${H - hT}" width="${barW.toFixed(2)}" height="${Math.max(hT, d.triaged > 0 ? 2 : 0)}" rx="1"></rect>
                </g>`;
            }).join('');

            const srRows = series.map((d) =>
                `<tr><th scope="row">${esc(fmt.format(d.date))}</th><td>${esc(String(d.added))}</td><td>${esc(String(d.triaged))}</td></tr>`).join('');
            const totalAdded = series.reduce((s2, d) => s2 + d.added, 0);
            const totalTriaged = series.reduce((s2, d) => s2 + d.triaged, 0);
            const net = totalAdded - totalTriaged;

            return `
                <div class="config-panel">
                    <h3 class="config-panel-title">${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</h3>
                    <p class="config-panel-note">${esc(this.t('config.statsInboxTrendNote',
                        'What arrived against what you dealt with. Recorded per day as it happened, so this is real history rather than a snapshot.'))}</p>
                    <div class="config-chart-legend">
                        <span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--a"></span>${esc(addedLabel)}</span>
                        <span class="config-chart-legend-item"><span class="config-chart-swatch config-chart-swatch--b"></span>${esc(triagedLabel)}</span>
                    </div>
                    <div class="config-stat-figures">
                        <span><strong>${esc(String(totalAdded))}</strong> ${esc(addedLabel.toLowerCase())}</span>
                        <span><strong>${esc(String(totalTriaged))}</strong> ${esc(triagedLabel.toLowerCase())}</span>
                        <span class="config-stat-trend config-stat-trend--${net > 0 ? 'down' : 'up'}">${esc(net > 0
                            ? this.t('config.statsInboxTrendGrowing', 'backlog grew by {n}').replace('{n}', String(net))
                            : this.t('config.statsInboxTrendShrinking', 'backlog shrank by {n}').replace('{n}', String(Math.abs(net))))}</span>
                    </div>
                    <div class="config-chart">
                        <div class="config-chart-plot">
                            <span class="config-chart-axis-y" aria-hidden="true">
                                <span class="config-chart-axis-title">${esc(this.t('config.statsInboxTrendAxisY', 'Items'))}</span>
                                <span class="config-chart-axis-ticks"><span>${esc(String(max))}</span><span>0</span></span>
                            </span>
                            <span class="config-chart-plot-area">
                                <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="list"
                                     aria-label="${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}">${bars}</svg>
                                <span class="config-chart-ticks" aria-hidden="true">${this.statsActivityTicks({
                                    dateLabels: series.map((d) => fmt.format(d.date)),
                                })}</span>
                            </span>
                        </div>
                        <p class="config-chart-axis-x" aria-hidden="true">${esc(this.t('config.statsAxisPerDay', 'Day (oldest → newest)'))}</p>
                        <div class="config-chart-tip" role="status" aria-live="polite" hidden></div>
                    </div>
                    <table class="config-sr-only">
                        <caption>${esc(this.t('config.statsInboxTrendTitle', 'Inbox flow per day'))}</caption>
                        <thead><tr><th scope="col">${esc(this.t('config.statsAxisPerDay', 'Day'))}</th><th scope="col">${esc(addedLabel)}</th><th scope="col">${esc(triagedLabel)}</th></tr></thead>
                        <tbody>${srRows}</tbody>
                    </table>
                </div>`;
        }

    });

    global.DashboardConfigStatsReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
