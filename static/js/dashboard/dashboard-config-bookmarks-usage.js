/**
 * The bookmark panel's Usage tab.
 *
 * Two kinds of fact. What every bookmark has always carried -- when it was
 * added and last edited, when it was last opened and how often -- set beside
 * the rest of the collection, so "24 opens" says whether that is a lot. And
 * the recent opens themselves (Bookmark.openLog, kept by the server since the
 * tab arrived), which give the chart of opens per week, the busiest weekday
 * and the hour it is usually opened. The second kind fills from the day it
 * started being kept; before that there is nothing to draw, and the tab says
 * so rather than drawing an empty chart as if nobody had opened it.
 *
 * Loaded after the workbench, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const DAY = 24 * 3600 * 1000;
    const WEEK = 7 * DAY;
    // Health's own line (handlers.go): opened before, not in the last 30 days.
    const STALE_DAYS = 30;
    const CHART_WEEKS = 12;
    const RANK_BARS = 24;

    Object.assign(global.DashboardConfig.prototype, {
        renderBmUsage(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const now = Date.now();
            const opens = Number(b.openCount) || 0;
            const created = Number(b.createdAt) || 0;
            const updated = Number(b.updatedAt) || 0;
            const last = Number(b.lastOpened) || 0;
            const days = (ms) => Math.max(0, Math.floor(ms / DAY));
            const dateLabel = (ts, withTime = false) => new Date(ts).toLocaleDateString(undefined, {
                day: 'numeric', month: 'short', year: new Date(ts).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
            }) + (withTime ? `, ${new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '');
            // How long ago, always as a span: formatLastOpened turns into a
            // date past a week, and beside the date that said it twice.
            const ago = (ts) => {
                const d = days(now - ts);
                const [key, fallback, n] = d < 1 ? ['bmUsageToday', 'today', 0]
                    : d < 14 ? ['bmUsageDaysAgo', '{n} days ago', d]
                        : d < 61 ? ['bmUsageWeeksAgoN', '{n} weeks ago', Math.round(d / 7)]
                            : d < 730 ? ['bmUsageMonthsAgo', '{n} months ago', Math.round(d / 30.4)]
                                : ['bmUsageYearsAgo', '{n} years ago', Math.round(d / 365)];
                return t(key, fallback).replace('{n}', String(n));
            };

            const weeksOld = created ? Math.max(1, (now - created) / WEEK) : null;
            const perWeek = weeksOld ? opens / weeksOld : null;
            const tiles = [
                [String(opens), t('bmUsageOpens', 'opens')],
                last
                    ? [`${days(now - last)} d`, t('bmUsageSinceOpen', 'since last open')]
                    : ['—', t('bmUsageNeverOpened', 'never opened')],
                last || !created
                    ? [perWeek == null ? '—' : (perWeek >= 10 ? String(Math.round(perWeek)) : perWeek.toFixed(1)), t('bmUsagePerWeek', 'opens / week')]
                    : [`${days(now - created)} d`, t('bmUsageSinceAdded', 'since added')],
            ].map(([value, label]) => `<div><b>${esc(value)}</b>${esc(label)}</div>`).join('');

            const kv = (label, value) => `<div class="config-bm-usage-kv"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
            const life = [
                // Bookmarks from before the date was kept have none: said, not skipped.
                kv(t('bmUsageAdded', 'added').replace(/^./, (c) => c.toUpperCase()),
                    created ? `${dateLabel(created)} · ${ago(created)}` : t('bmUsageNotRecorded', 'not recorded')),
                kv(t('bmUsageEdited', 'Last edited'), updated ? dateLabel(updated) : t('bmUsageNever', 'never')),
                kv(t('bmUsageLastOpened', 'Last opened'), last ? dateLabel(last, true) : t('bmUsageNever', 'never')),
            ].join('');

            return `
                <div class="config-bm-usage-tiles">${tiles}</div>
                <h4 class="config-bm-pane-sub">${esc(t('bmUsageLife', 'Its life so far'))}</h4>
                ${this.renderBmUsageTimeline({ created, updated, last, now })}
                ${life}
                <h4 class="config-bm-pane-sub">${esc(t('bmUsageCompared', 'Compared with the rest'))}</h4>
                ${this.renderBmUsageRank(b)}
                ${this.renderBmUsageHistory(b, now)}`;
        },

        /** Added, edited and last opened as marks on one line from "added" to now. */
        renderBmUsageTimeline({ created, updated, last, now }) {
            if (!created || now - created < DAY) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const at = (ts) => Math.min(100, Math.max(0, ((ts - created) / (now - created)) * 100));
            const mark = (ts, kind, label) => (ts ? `<i class="is-${kind}" style="left:${at(ts).toFixed(1)}%" title="${esc(label)}"></i>` : '');
            return `<div class="config-bm-usage-life" role="img" aria-label="${esc(this.t('config.bmUsageLifeAria', 'When it was added, last edited and last opened'))}">
                <span></span>
                ${mark(created, 'added', this.t('config.bmUsageAdded', 'added'))}
                ${updated > created ? mark(updated, 'edited', this.t('config.bmUsageEdited', 'Last edited')) : ''}
                ${mark(last, 'opened', this.t('config.bmUsageLastOpened', 'Last opened'))}
            </div>`;
        },

        /** Its rank by opens, the collection's opens as bars with this one marked, and its category. */
        renderBmUsageRank(b) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const all = this.dash.allBookmarks || [];
            const opens = Number(b.openCount) || 0;
            const counts = all.map((x) => Number(x.openCount) || 0).sort((x, y) => y - x);
            if (!counts.length || !counts[0]) {
                return `<p class="config-bm-panel-muted" data-bm-usage-rank="empty">${esc(t('bmUsageNoOpensAnywhere',
                    'Nothing in the collection has been opened yet, so there is nothing to compare with.'))}</p>`;
            }
            if (!opens) {
                const never = counts.filter((n) => !n).length;
                return `<div class="config-bm-usage-kv"><span>${esc(t('bmUsageRank', 'Rank'))}</span><span>${esc(
                    t('bmUsageOneOfNever', 'one of {n} never opened').replace('{n}', String(never)))}</span></div>
                    <p class="config-bm-panel-muted">${esc(t('bmUsageUnusedHint', 'Health counts it as unused until it is opened.'))}
                        <button type="button" class="config-bm-rail-more" data-bm-usage-show="never">${esc(t('bmUsageShowNever', 'Show the ones never opened'))}</button></p>`;
            }
            const rank = counts.findIndex((n) => n <= opens) + 1;
            const top = Math.max(1, Math.ceil((rank / counts.length) * 100));
            // One bar per slice of the collection, most opened first; the
            // slice this bookmark falls in is the marked one.
            const step = counts.length / Math.min(RANK_BARS, counts.length);
            const max = counts[0] || 1;
            const bars = [];
            for (let i = 0; i < Math.min(RANK_BARS, counts.length); i += 1) {
                const from = Math.floor(i * step);
                const to = Math.max(from + 1, Math.floor((i + 1) * step));
                const n = counts[from];
                const mine = rank - 1 >= from && rank - 1 < to;
                bars.push(`<b style="height:${Math.max(3, Math.round((n / max) * 100))}%"${mine ? ' class="is-me"' : ''}></b>`);
            }
            const peers = all.filter((x) => String(x.pageId) === String(b.pageId) && (x.category || '') === (b.category || ''));
            const peerCounts = peers.map((x) => Number(x.openCount) || 0).sort((x, y) => y - x);
            const peerRank = peerCounts.findIndex((n) => n <= opens) + 1;
            const peerAvg = peerCounts.reduce((sum, n) => sum + n, 0) / (peerCounts.length || 1);
            const where = b.category
                ? `${this.pageLabel(b.pageId)} › ${this.railCategoryLabel(b.pageId, b.category)}`
                : this.pageLabel(b.pageId);
            const ordinal = (n) => t('bmUsageOrdinal', '#{n}').replace('{n}', String(n));
            return `<div class="config-bm-usage-rank" role="img" aria-label="${esc(t('bmUsageRankAria', 'Opens across the collection, most opened first, with this bookmark marked'))}">${bars.join('')}</div>
                <div class="config-bm-usage-kv"><span>${esc(t('bmUsageRank', 'Rank'))}</span><span>${esc(
                    t('bmUsageRankOf', '{rank} of {total} · top {pct}%')
                        .replace('{rank}', ordinal(rank)).replace('{total}', String(counts.length)).replace('{pct}', String(top)))}</span></div>
                ${peers.length > 1 ? `<div class="config-bm-usage-kv"><span>${esc(where)}</span><span>${esc(
                    t('bmUsagePeers', '{rank} of {total} · average {avg}')
                        .replace('{rank}', ordinal(peerRank)).replace('{total}', String(peers.length))
                        .replace('{avg}', peerAvg >= 10 ? String(Math.round(peerAvg)) : peerAvg.toFixed(1)))}</span></div>` : ''}
                ${this.renderBmUsageStaleHint(b)}`;
        },

        /** How far it is from Health's Stale line, while it still has some way to go. */
        renderBmUsageStaleHint(b) {
            const last = Number(b.lastOpened) || 0;
            if (!last) return '';
            const esc = (v) => this.dash.escapeHtml(v);
            const idle = Math.floor((Date.now() - last) / DAY);
            const text = idle >= STALE_DAYS
                ? this.t('config.bmUsageStale', 'Stale: not opened for {n} days.').replace('{n}', String(idle))
                : this.t('config.bmUsageStaleIn', 'Counts as stale in {n} days without an open.').replace('{n}', String(STALE_DAYS - idle));
            return `<p class="config-bm-panel-muted">${esc(text)}</p>`;
        },

        /** Opens per week over the last twelve, the busiest weekday and the usual hour. */
        renderBmUsageHistory(b, now) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const log = (Array.isArray(b.openLog) ? b.openLog : []).map(Number).filter((ts) => ts > 0 && ts <= now);
            const head = `<h4 class="config-bm-pane-sub">${esc(t('bmUsageWeeks', 'Opens, last 12 weeks'))}</h4>`;
            if (!log.length) {
                return `${head}<p class="config-bm-panel-muted" data-bm-usage-history="empty">${esc(t('bmUsageNoHistory',
                    'No opens recorded yet. Opens are counted from now on, and the chart fills as it is used.'))}</p>`;
            }
            const weeks = new Array(CHART_WEEKS).fill(0);
            log.forEach((ts) => {
                const back = Math.floor((now - ts) / WEEK);
                if (back < CHART_WEEKS) weeks[CHART_WEEKS - 1 - back] += 1;
            });
            const max = Math.max(1, ...weeks);
            const w = 330;
            const h = 56;
            const slot = w / CHART_WEEKS;
            const bars = weeks.map((n, i) => {
                const bh = n ? Math.max(3, Math.round((n / max) * (h - 8))) : 0;
                return `<rect x="${(i * slot + 3).toFixed(1)}" y="${h - bh}" width="${(slot - 6).toFixed(1)}" height="${bh}" rx="2"><title>${esc(String(n))}</title></rect>`;
            }).join('');
            const chart = `<svg class="config-bm-usage-weeks" viewBox="0 0 ${w} ${h + 14}" width="100%" height="${h + 14}" role="img"
                    aria-label="${esc(t('bmUsageWeeksAria', 'Opens per week, {list}').replace('{list}', weeks.join(', ')))}">
                    <line x1="0" y1="${h}" x2="${w}" y2="${h}"></line>${bars}
                    <text x="2" y="${h + 12}">${esc(t('bmUsageWeeksAgo', '12 weeks ago'))}</text>
                    <text x="${w - 2}" y="${h + 12}" text-anchor="end">${esc(t('bmUsageThisWeek', 'this week'))}</text>
                </svg>`;
            const byDay = new Array(7).fill(0);
            const byHour = new Array(24).fill(0);
            log.forEach((ts) => {
                const d = new Date(ts);
                byDay[d.getDay()] += 1;
                byHour[d.getHours()] += 1;
            });
            const top = (list) => list.indexOf(Math.max(...list));
            const weekday = new Date(2024, 0, 7 + top(byDay)).toLocaleDateString(undefined, { weekday: 'long' });
            const hour = top(byHour);
            const hours = `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
            // A weekday and an hour out of two opens is a coincidence, not a habit.
            const habits = log.length >= 5 ? `
                <div class="config-bm-usage-kv"><span>${esc(t('bmUsageBusiestDay', 'Busiest day'))}</span><span>${esc(weekday)}</span></div>
                <div class="config-bm-usage-kv"><span>${esc(t('bmUsageUsualHour', 'Usually opened'))}</span><span>${esc(hours)}</span></div>` : '';
            return `${head}${chart}${habits}`;
        },
    });

    global.DashboardConfigBookmarksUsageReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
