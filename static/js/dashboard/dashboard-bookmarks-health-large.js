/**
 * One bookmark's health, in large: a modal of charts and figures opened from
 * the side panel's Health tab, the row menu or Shift+H in the Bookmarks view.
 *
 * Everything is drawn from what the checks already record. The health report
 * carries the uptime windows, the incidents and the score's reasons;
 * /api/health/history carries the checks still kept one by one (30 days) and
 * a summary per day over 90 days. Charts that need checks a bookmark does not
 * have say so, rather than drawing an empty frame.
 *
 * Loaded after the health module, by ensureBookmarkRenderers.
 */
(function (global) {
    'use strict';
    if (typeof global.DashboardConfig !== 'function') return;

    const DAY = 86400000;
    const HOUR = 3600000;

    Object.assign(global.DashboardConfig.prototype, {
        /** Open it for one bookmark, by its row key. */
        async openBmHealthLarge(key) {
            const b = this.findBookmarkByKey(key);
            const issue = b ? this.bmHealthIssue?.(b) : null;
            if (!b || !issue || typeof global.AppModal?.show !== 'function') return;
            this._bmLargeKey = key;
            const show = (hist) => {
                const html = this.renderBmHealthLarge(b, issue, hist);
                const root = document.getElementById('modal-text');
                // Already open (a refill, or ← and →): the body is replaced in place.
                if (root && document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) {
                    root.innerHTML = html;
                    return;
                }
                global.AppModal.show({
                    title: b.name || this.formatBookmarkUrlDisplay(b.url),
                    htmlMessage: html,
                    showCancel: false,
                    confirmText: this.t('dashboard.close', 'Close'),
                    modalClass: 'view-explain-modal bm-health-modal bm-health-large',
                    modalMaxWidth: 'min(82rem, calc(100vw - 2.5rem))',
                    onHide: () => this.unbindBmHealthLargeKeys(),
                });
                this.bindBmHealthLarge();
                this.bindBmHealthLargeKeys();
            };
            show(null);
            const hist = await this.fetchBmHealthHistory(b.url);
            // Moved on to another bookmark, or closed, meanwhile.
            if (this._bmLargeKey !== key || !document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) return;
            show(hist);
        },

        async fetchBmHealthHistory(url) {
            const fetcher = typeof global.nextDashFetch === 'function' ? global.nextDashFetch : fetch;
            try {
                const res = await fetcher(`/api/health/history?url=${encodeURIComponent(url)}`);
                if (!res.ok) return { samples: [], days: [], failed: true };
                return await res.json();
            } catch {
                return { samples: [], days: [], failed: true };
            }
        },

        /** ← and → step through the list as the view shows it. */
        stepBmHealthLarge(delta) {
            const keys = this.visibleBookmarks().map((b) => this.bookmarkKey(b)).filter(Boolean);
            const at = keys.indexOf(this._bmLargeKey);
            if (at < 0) return;
            const next = keys[(at + delta + keys.length) % keys.length];
            if (next && next !== this._bmLargeKey) void this.openBmHealthLarge(next);
        },

        bindBmHealthLargeKeys() {
            this.unbindBmHealthLargeKeys();
            this._bmLargeKeys = (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                if (e.target.closest?.('input, textarea, select')) return;
                if (!document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this.stepBmHealthLarge(e.key === 'ArrowRight' ? 1 : -1);
            };
            document.addEventListener('keydown', this._bmLargeKeys, true);
        },

        unbindBmHealthLargeKeys() {
            if (this._bmLargeKeys) document.removeEventListener('keydown', this._bmLargeKeys, true);
            this._bmLargeKeys = null;
        },

        /** The modal's buttons; #modal-text outlives any one opening, so wired once. */
        bindBmHealthLarge() {
            const root = document.getElementById('modal-text');
            if (!root || root.dataset.bmHealthLargeWired === '1') return;
            root.dataset.bmHealthLargeWired = '1';
            root.addEventListener('click', (e) => {
                const el = e.target.closest('[data-bm-large-action]');
                if (!el || !root.querySelector('[data-bm-health-large]')) return;
                const action = el.getAttribute('data-bm-large-action');
                const key = this._bmLargeKey;
                const b = this.findBookmarkByKey(key);
                const issue = b ? this.bmHealthIssue?.(b) : null;
                if (action === 'open') this.openBookmarkByKey(key);
                else if (action === 'recheck' && issue) {
                    el.disabled = true;
                    void Promise.resolve(this._bmHealthModule?.recheckIssue?.(issue))
                        .finally(() => { if (this._bmLargeKey === key) void this.openBmHealthLarge(key); });
                } else if (action === 'prev') this.stepBmHealthLarge(-1);
                else if (action === 'next') this.stepBmHealthLarge(1);
                else if (action === 'monitor') {
                    global.AppModal.hide();
                    this.focusWorkbenchPanel?.(key);
                    this.setWorkbenchPanelTab?.('health');
                    this.openBmHealthAcc?.('checking');
                }
            });
        },

        /* ── The body ─────────────────────────────────────────────────── */

        renderBmHealthLarge(b, issue, hist) {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const health = this._bmHealthModule;
            const now = Date.now();
            const samples = (hist?.samples || []).map((s) => ({ t: Number(s.t), up: !!s.u, ms: Number(s.p) || 0, code: Number(s.c) || 0, maint: !!s.m }))
                .filter((s) => s.t > 0).sort((x, y) => x.t - y.t);
            const days = (hist?.days || []).map((d) => ({ d: Number(d.d), n: Number(d.n) || 0, u: Number(d.u) || 0, p: Number(d.p) || 0 }))
                .filter((d) => d.d > 0).sort((x, y) => x.d - y.d);
            const loading = !hist;
            const stats = issue.monitorStats || {};
            const score = Number(issue.score) || 0;
            const tone = score >= 90 ? 'good' : score >= 70 ? 'warn' : 'bad';
            const mode = global.CheckMode?.of?.(b) || 'off';
            const modeLabel = global.CheckMode?.meta?.(mode)?.label || mode;
            const interval = mode === 'monitor' ? global.CheckMode?.intervalLabel?.(global.CheckMode?.intervalOf?.(b)) || '' : '';
            const pct = (r) => (r == null || !Number.isFinite(Number(r)) ? '—' : `${Math.round(Number(r) * 1000) / 10}%`);
            const card = (name, title, answer, body, wide = false) => `
                <section class="bm-health-modal-card bm-health-large-card${wide ? ' is-wide' : ''}" data-bm-large-card="${name}">
                    <h3 class="bm-health-modal-card-title"><span>${esc(title)}</span>${answer ? `<span class="bm-health-large-answer">${esc(answer)}</span>` : ''}</h3>
                    ${body}
                </section>`;
            const none = (text) => `<p class="config-bm-panel-muted bm-health-large-none">${esc(text)}${mode !== 'monitor'
                ? ` <button type="button" class="config-bm-rail-more" data-bm-large-action="monitor">${esc(t('bmLargeTurnOnMonitor', 'Turn on Monitor'))}</button>` : ''}</p>`;
            const noChecks = loading ? t('bmLargeLoading', 'Loading the checks…')
                : t('bmLargeNeedsMonitor', 'Not enough checks for this chart. Monitor records one every few minutes.');

            // Head: the bookmark, its state, its score.
            const circ = 2 * Math.PI * 26;
            const dash = Math.max(0, Math.min(100, score)) / 100 * circ;
            const checks30 = samples.filter((s) => s.t >= now - 30 * DAY).length;
            const head = `
                <div class="bm-health-large-head">
                    <span class="bm-health-large-icon">${global.BookmarkFeedRow?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                    <div class="bm-health-large-name">
                        <a class="config-bm-panel-url" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(this.formatBookmarkUrlDisplay(b.url))}</a>
                        <span class="config-bm-panel-muted">${esc([modeLabel, interval,
                            checks30 ? t('bmLargeChecksIn30', '{n} checks in 30 days').replace('{n}', checks30.toLocaleString()) : '',
                            Number(issue.lastChecked) > 0 ? t('bmHealthChecked', 'Checked {d} ago').replace('{d}', health?.formatDuration?.(now - Number(issue.lastChecked)) || '') : '',
                        ].filter(Boolean).join(' · '))}</span>
                    </div>
                    <svg class="config-bm-health-ring bm-health-large-ring" data-tone="${tone}" viewBox="0 0 64 64" role="img"
                         aria-label="${esc(t('bmHealthScoreAria', 'Score {n} of 100').replace('{n}', String(score)))}">
                        <circle cx="32" cy="32" r="26" class="is-track"></circle>
                        <circle cx="32" cy="32" r="26" class="is-value" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 32 32)"></circle>
                        <text x="32" y="37" text-anchor="middle">${esc(String(score))}</text>
                    </svg>
                    <div class="bm-health-large-buttons">
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="prev" title="${esc(t('bmLargePrev', 'Previous bookmark (←)'))}">←</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="next" title="${esc(t('bmLargeNext', 'Next bookmark (→)'))}">→</button>
                        <button type="button" class="config-btn config-btn--small config-btn--primary" data-bm-large-action="recheck">${esc(t('bmKeyRecheck', 're-check').replace(/^./, (c) => c.toUpperCase()))}</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="open">${esc(t('openBookmark', 'Open'))}</button>
                        <a class="config-btn config-btn--small" href="/api/health/history-export?url=${encodeURIComponent(b.url)}" download>${esc(t('bmLargeExport', 'Export CSV'))}</a>
                    </div>
                </div>`;

            // 1. Uptime.
            const daysTotal = days.reduce((a, d) => a + d.n, 0);
            const daysUp = days.reduce((a, d) => a + d.u, 0);
            const incidents = Array.isArray(stats.incidents) ? stats.incidents : [];
            const down30 = incidents.filter((i) => Number(i.start) >= now - 30 * DAY)
                .reduce((a, i) => a + (Number(i.durationMs) || (i.ongoing ? now - Number(i.start) : 0)), 0);
            const uptimeCard = card('uptime', t('bmLargeUptime', 'Uptime'), '', `
                <div class="bm-health-large-tiles">
                    <div><b>${esc(pct(stats.uptime24h?.ratio))}</b>${esc(t('bmLarge24h', '24 hours'))}</div>
                    <div><b>${esc(pct(stats.uptime7d?.ratio))}</b>${esc(t('bmLarge7d', '7 days'))}</div>
                    <div><b>${esc(pct(stats.uptime30d?.ratio))}</b>${esc(t('bmLarge30d', '30 days'))}</div>
                    <div><b>${esc(daysTotal ? pct(daysUp / daysTotal) : '—')}</b>${esc(t('bmLarge90d', '90 days'))}</div>
                </div>
                <div class="config-bm-usage-kv"><span>${esc(t('bmLargeDown30', 'Down in 30 days'))}</span><span>${esc(down30 ? health?.formatDuration?.(down30) || '' : '—')}</span></div>`);

            // 2. Response time: the daily means over 90 days, the spread from the checks kept.
            const withPing = samples.filter((s) => s.up && s.ms > 0).map((s) => s.ms).sort((x, y) => x - y);
            const avg = withPing.length ? Math.round(withPing.reduce((a, v) => a + v, 0) / withPing.length) : 0;
            const p95 = withPing.length ? withPing[Math.min(withPing.length - 1, Math.floor(withPing.length * 0.95))] : 0;
            const pingDays = days.filter((d) => d.p > 0);
            const responseCard = card('response', t('bmLargeResponse', 'Response time, 90 days'),
                withPing.length ? t('bmLargeAvgP95', 'avg {a} ms · p95 {p} ms').replace('{a}', String(avg)).replace('{p}', String(p95)) : '',
                pingDays.length >= 2 ? this.bmLargeLineChart(pingDays.map((d) => ({ x: d.d, y: d.p })), now - 90 * DAY, now, p95, esc)
                    : none(noChecks), true);

            // 3. Uptime per day, 90 days.
            const dayBars = card('days', t('bmLargePerDay', 'Uptime per day, 90 days'), daysTotal ? pct(daysUp / daysTotal) : '',
                days.length ? this.bmLargeDayBars(days, now, esc) : none(noChecks), true);

            // 4. HTTP answers, from the checks kept.
            const classes = [
                { key: '2xx', test: (c) => c >= 200 && c < 300, tone: 'good' },
                { key: '3xx', test: (c) => c >= 300 && c < 400, tone: 'info' },
                { key: '4xx', test: (c) => c >= 400 && c < 500, tone: 'warn' },
                { key: '5xx', test: (c) => c >= 500, tone: 'bad' },
                { key: t('bmLargeNoAnswer', 'no answer'), test: (c) => !c, tone: 'muted' },
            ];
            const counted = classes.map((cl) => ({ ...cl, n: samples.filter((s) => !s.maint && cl.test(s.code)).length }));
            const maxN = Math.max(1, ...counted.map((c) => c.n));
            const codesCard = card('codes', t('bmLargeCodes', 'HTTP answers, 30 days'), '', samples.length
                ? `<div class="bm-health-large-codes">${counted.map((c) => `
                    <div><span>${esc(c.key)}</span><i data-tone="${c.tone}" style="width:${Math.max(c.n ? 2 : 0, Math.round((c.n / maxN) * 100))}%"></i><span>${c.n.toLocaleString()}</span></div>`).join('')}</div>`
                : none(noChecks));

            // 5. Availability by hour, 30 days × 24 hours.
            const heatCard = card('hours', t('bmLargeHours', 'Availability by hour, 30 days'),
                t('bmLargeHoursKey', 'red down · amber slow · grey no checks'),
                samples.length ? this.bmLargeHeatmap(samples, now, p95, esc) : none(noChecks), true);

            // 6. Incidents.
            const inc30 = incidents.filter((i) => Number(i.start) >= now - 30 * DAY);
            const incCard = card('incidents', t('bmLargeIncidents', 'Incidents'),
                t('bmLargeIncidentCount', '{n} in 30 days').replace('{n}', String(inc30.length)),
                inc30.length || incidents.length
                    ? `<div class="bm-health-large-incidents">${incidents.slice(-5).reverse().map((i) => `
                        <div><span>${esc(new Date(Number(i.start)).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
                        <span>${esc(i.ongoing ? t('bmLargeOngoing', 'ongoing') : health?.formatDuration?.(Number(i.durationMs) || 0) || '')}</span>
                        <span>${esc(i.reason || '')}</span></div>`).join('')}</div>`
                    : `<p class="config-bm-panel-muted">${esc(mode === 'monitor' ? t('bmLargeNoIncidents', 'No incidents recorded.') : noChecks)}</p>`);

            // 7. The score's reasons.
            const scoreCard = card('score', t('bmHealthScoreBreakdown', 'Score breakdown'), String(score),
                `<div class="health-view-score-panel">${health?.renderScorePanel?.(issue) || ''}</div>`);

            // 8. Certificate.
            const cert = issue.certHost ? global.HealthFacts?.certificates?.[issue.certHost] : null;
            const expires = Number(cert?.expiresAt) || 0;
            const left = expires ? Math.floor((expires - now) / DAY) : null;
            const certCard = card('cert', t('bmLargeCert', 'Certificate'), '', expires
                ? `<div class="config-bm-usage-kv"><span>${esc(t('bmLargeExpires', 'Expires'))}</span><span>${esc(new Date(expires).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></div>
                   <div class="config-bm-usage-kv"><span>${esc(t('bmLargeDaysLeft', 'Days left'))}</span><span class="${left < 14 ? 'is-warn' : ''}">${esc(String(left))}</span></div>
                   <div class="config-bm-usage-kv"><span>${esc(t('bmLargeHost', 'Host'))}</span><span>${esc(issue.certHost)}</span></div>`
                : `<p class="config-bm-panel-muted">${esc(/^https:/i.test(String(b.url || '')) ? t('bmLargeCertUnseen', 'Not seen yet: it is read on a check.') : t('bmLargeCertNone', 'Plain http: no certificate.'))}</p>`);

            // 9. What is kept of the page.
            const keptCard = card('kept', t('bmLargeKept', 'Kept copies'), '', `
                <div class="config-bm-usage-kv"><span>${esc(t('bmDetailsCopies', 'Local copies'))}</span><span>${esc(Number(issue.localCopies) > 0
                    ? `${issue.localCopies}${Number(issue.localCopyAt) > 0 ? ` · ${new Date(Number(issue.localCopyAt)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}` : '—')}</span></div>
                <div class="config-bm-usage-kv"><span>${esc(t('bmLargeDrift', 'Page changed'))}</span><span>${esc(issue.driftNoticed
                    ? (issue.driftReason || t('bmLargeDriftYes', 'yes'))
                    : (issue.watchDrift ? t('bmLargeDriftNo', 'no change seen') : t('bmLargeDriftOff', 'not watched')))}</span></div>
                ${Number(issue.archiveDiedAt) > 0 ? `<div class="config-bm-usage-kv"><span>${esc(t('bmLargeArchiveLast', 'Last archived alive'))}</span><span>${esc(new Date(Number(issue.archiveDiedAt)).toLocaleDateString())}</span></div>` : ''}`);

            // 10. Every check of the last 24 hours.
            const day = samples.filter((s) => s.t >= now - DAY);
            const last = samples[samples.length - 1];
            const checksCard = card('checks', t('bmLargeLast24', 'Checks, last 24 hours'),
                day.length ? t('bmLargeChecksCount', '{n} checks').replace('{n}', String(day.length)) : '',
                day.length ? `<div class="bm-health-large-ticks">${day.map((s) => `<i data-tone="${s.maint ? 'muted' : (s.up ? 'good' : 'bad')}"
                    title="${esc(`${new Date(s.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${s.code || '—'}${s.ms ? ` · ${s.ms} ms` : ''}`)}"></i>`).join('')}</div>
                    ${last ? `<div class="config-bm-usage-kv"><span>${esc(t('bmLargeLastAnswer', 'Last answer'))}</span><span>${esc(`${last.code || t('bmLargeNoAnswer', 'no answer')}${last.ms ? ` · ${last.ms} ms` : ''}`)}</span></div>` : ''}`
                    : none(noChecks), true);

            return `<div class="bm-health-large" data-bm-health-large data-loading="${loading ? '1' : '0'}">
                ${head}
                <div class="bm-health-large-grid">
                    ${uptimeCard}${responseCard}${codesCard}
                    ${dayBars}${incCard}${scoreCard}
                    ${heatCard}${certCard}${keptCard}
                    ${checksCard}
                </div>
                <p class="bm-health-large-foot">${esc(t('bmLargeFoot', 'Checks are kept one by one for 30 days, and as a summary per day for 90. ← and → go to the previous and next bookmark.'))}</p>
            </div>`;
        },

        /** A line over time, with a dashed p95 line when there is one. */
        bmLargeLineChart(points, from, to, p95, esc) {
            const w = 320;
            const h = 70;
            const max = Math.max(p95 || 0, ...points.map((p) => p.y)) * 1.1 || 1;
            const x = (v) => 4 + ((v - from) / Math.max(1, to - from)) * (w - 8);
            const y = (v) => 6 + h - (v / max) * h;
            const path = points.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
            const date = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
            return `<svg class="bm-health-large-line" viewBox="0 0 ${w} ${h + 18}" width="100%" height="${h + 18}" role="img" preserveAspectRatio="none">
                <line x1="4" y1="${h + 6}" x2="${w - 4}" y2="${h + 6}" class="is-axis"></line>
                ${p95 ? `<line x1="4" y1="${y(p95).toFixed(1)}" x2="${w - 4}" y2="${y(p95).toFixed(1)}" class="is-p95"></line>` : ''}
                <polyline points="${path}" class="is-line"></polyline>
                <text x="4" y="${h + 16}" class="is-label">${esc(date(from))}</text>
                <text x="${w - 4}" y="${h + 16}" text-anchor="end" class="is-label">${esc(date(to))}</text>
                <text x="${w - 4}" y="12" text-anchor="end" class="is-label">${Math.round(max)} ms</text>
            </svg>`;
        },

        /** One bar a day for 90 days: its height the share of checks that answered. */
        bmLargeDayBars(days, now, esc) {
            const byDay = new Map(days.map((d) => [d.d, d]));
            const first = new Date(now - 89 * DAY);
            first.setUTCHours(0, 0, 0, 0);
            const bars = [];
            for (let i = 0; i < 90; i += 1) {
                const d = byDay.get(first.getTime() + i * DAY);
                const ratio = d && d.n ? d.u / d.n : null;
                const tone = ratio == null ? 'muted' : ratio >= 0.999 ? 'good' : ratio >= 0.95 ? 'warn' : 'bad';
                const hgt = ratio == null ? 2 : Math.max(3, Math.round(ratio * 40));
                const label = new Date(first.getTime() + i * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
                bars.push(`<rect x="${i * 3.4}" y="${42 - hgt}" width="2.6" height="${hgt}" data-tone="${tone}"><title>${esc(`${label}: ${ratio == null ? '—' : `${Math.round(ratio * 1000) / 10}%`}`)}</title></rect>`);
            }
            return `<svg class="bm-health-large-days" viewBox="0 0 306 44" width="100%" height="48" preserveAspectRatio="none" role="img">${bars.join('')}</svg>`;
        },

        /** 30 days across, 24 hours down: down, slow, fine or no checks. */
        bmLargeHeatmap(samples, now, p95, esc) {
            const start = new Date(now - 29 * DAY);
            start.setHours(0, 0, 0, 0);
            const cells = new Map();
            samples.forEach((s) => {
                if (s.t < start.getTime()) return;
                const dayIdx = Math.floor((s.t - start.getTime()) / DAY);
                const hour = new Date(s.t).getHours();
                const k = `${dayIdx}:${hour}`;
                const c = cells.get(k) || { up: 0, down: 0, slow: 0 };
                if (s.maint) return;
                if (!s.up) c.down += 1;
                else if (p95 && s.ms > p95) c.slow += 1;
                else c.up += 1;
                cells.set(k, c);
            });
            const rects = [];
            for (let d = 0; d < 30; d += 1) {
                for (let hr = 0; hr < 24; hr += 1) {
                    const c = cells.get(`${d}:${hr}`);
                    const tone = !c ? 'muted' : c.down ? 'bad' : c.slow ? 'warn' : 'good';
                    rects.push(`<rect x="${d * 10}" y="${hr * 4}" width="9" height="3.4" data-tone="${tone}"></rect>`);
                }
            }
            return `<svg class="bm-health-large-heat" viewBox="0 0 300 96" width="100%" height="92" preserveAspectRatio="none" role="img"
                aria-label="${esc(this.t('config.bmLargeHours', 'Availability by hour, 30 days'))}">${rects.join('')}</svg>`;
        },
    });

    global.DashboardBookmarksHealthLargeReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
