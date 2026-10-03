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
    /** The periods on offer: today, then days. 30 is where it opens. */
    const BM_LARGE_RANGES = ['today', '7', '14', '30', '90'];

    Object.assign(global.DashboardConfig.prototype, {
        /**
         * Open it for one bookmark, by its row key. It opens on the last 30
         * days; ← and → and a refill keep the period that was chosen.
         */
        async openBmHealthLarge(key, { keepRange = false } = {}) {
            const b = this.findBookmarkByKey(key);
            const issue = b ? this.bmHealthIssue?.(b) : null;
            if (!b || !issue || typeof global.AppModal?.show !== 'function') return;
            const open = Boolean(document.querySelector('#app-modal.show #modal-text [data-bm-health-large]'));
            // Opens on the period View sets (30 days unless changed).
            if (!keepRange || !open || !BM_LARGE_RANGES.includes(this._bmLargeRange)) {
                const start = String(this.dash.settings?.bmViewHealthRange || '30');
                this._bmLargeRange = BM_LARGE_RANGES.includes(start) ? start : '30';
            }
            this._bmLargeKey = key;
            this._bmLargeArgs = { b, issue };
            const show = (hist) => {
                this._bmLargeHist = hist;
                const html = this.renderBmHealthLarge(b, issue, hist, this._bmLargeRange);
                const root = document.getElementById('modal-text');
                // Already open (a refill, a new period, or ← and →): the body is replaced in place.
                if (root && document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) {
                    root.innerHTML = html;
                    const title = document.getElementById('modal-title');
                    if (title) title.textContent = b.name || this.formatBookmarkUrlDisplay(b.url);
                    this.fitBmLargeCharts();
                    return;
                }
                global.AppModal.show({
                    title: b.name || this.formatBookmarkUrlDisplay(b.url),
                    htmlMessage: html,
                    showCancel: false,
                    confirmText: this.t('dashboard.close', 'Close'),
                    modalClass: 'view-explain-modal bm-health-modal bm-health-large',
                    modalMaxWidth: 'min(82rem, calc(100vw - 2.5rem))',
                    onHide: () => {
                        this.unbindBmHealthLargeKeys();
                        this.destroyBmLargeCharts();
                    },
                });
                this.bindBmHealthLarge();
                this.bindBmHealthLargeKeys();
                this.fitBmLargeCharts();
            };
            show(null);
            const hist = await this.fetchBmHealthHistory(b.url);
            // Moved on to another bookmark, or closed, meanwhile.
            if (this._bmLargeKey !== key || !document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) return;
            show(hist);
        },

        /**
         * The charts drawn at the width they are shown at.
         *
         * They were drawn 320 wide and stretched to their card, which pulled
         * the dates and the dots out of shape on a wide screen. The card is
         * measured once it is on screen and the body drawn again at that width
         * when it differs -- and again whenever the body changes size.
         */
        fitBmLargeCharts() {
            const root = document.getElementById('modal-text');
            if (!root?.querySelector('[data-bm-health-large]') || !this._bmLargeArgs) return;
            // Each kind in its own card, and the cards are not all one width.
            const widths = { ...(this._bmLargeW || {}) };
            let changed = false;
            ['line', 'days', 'heat'].forEach((kind) => {
                const svg = root.querySelector(`[data-bm-health-large] svg.bm-health-large-${kind}`);
                const width = Math.floor(svg?.getBoundingClientRect().width || 0);
                if (width > 80 && Math.abs(width - (widths[kind] || 0)) > 2) {
                    widths[kind] = width;
                    changed = true;
                }
            });
            if (changed) {
                this._bmLargeW = widths;
                const { b, issue } = this._bmLargeArgs;
                root.innerHTML = this.renderBmHealthLarge(b, issue, this._bmLargeHist, this._bmLargeRange);
            }
            // The body's own size, not the window's: a scrollbar coming or
            // going narrows the cards without any resize event.
            if (!this._bmLargeResize && typeof global.ResizeObserver === 'function') {
                let frame = 0;
                this._bmLargeResize = new global.ResizeObserver(() => {
                    if (!document.querySelector('#app-modal.show #modal-text [data-bm-health-large]')) return;
                    cancelAnimationFrame(frame);
                    frame = requestAnimationFrame(() => this.fitBmLargeCharts());
                });
                this._bmLargeResize.observe(root);
            }
            void this.mountBmLargeCharts();
        },

        /*
         * Response time and uptime over time with uPlot (shared/nd-chart.js):
         * a cursor and a tooltip, a drag to zoom, the arrow keys with the point
         * read out under the chart, and a table for a screen reader. Mounted
         * over the plain charts the body is drawn with, after every redraw of
         * it; when the library cannot be loaded, the plain charts stay.
         */
        async mountBmLargeCharts() {
            const root = document.getElementById('modal-text');
            const plots = this._bmLargePlots;
            if (!root?.querySelector('[data-bm-large-plot]') || !plots) return;
            try {
                if (!global.NdChart) {
                    await global.LazyScript.loadScriptOnce('js/shared/nd-chart.js', 'ndChart',
                        () => typeof global.NdChart !== 'undefined');
                }
                await global.NdChart.load();
            } catch {
                return;
            }
            // Charts of a body since replaced are let go.
            this._bmLargeCharts = (this._bmLargeCharts || []).filter((c) => {
                if (c.plot && document.contains(c.plot.root)) return true;
                c.destroy();
                return false;
            });
            root.querySelectorAll('[data-bm-large-plot]').forEach((host) => {
                if (host.querySelector('.nd-chart')) return;
                const spec = this._bmLargePlots?.[host.getAttribute('data-bm-large-plot')];
                if (spec) this._bmLargeCharts.push(global.NdChart.chart(host, spec));
            });
        },

        destroyBmLargeCharts() {
            (this._bmLargeCharts || []).forEach((c) => c.destroy());
            this._bmLargeCharts = [];
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
            if (next && next !== this._bmLargeKey) void this.openBmHealthLarge(next, { keepRange: true });
        },

        bindBmHealthLargeKeys() {
            this.unbindBmHealthLargeKeys();
            this._bmLargeKeys = (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                if (e.target.closest?.('input, textarea, select')) return;
                // In a chart ← and → walk its points, not the bookmarks.
                if (e.target.closest?.('.nd-chart')) return;
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
            // Every value on a chart reads out under the pointer (or a tap):
            // one tip for the modal, filled from the data-tip of what is hovered.
            const tip = () => {
                let el = root.querySelector('.bm-large-tip');
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'bm-large-tip';
                    el.setAttribute('role', 'tooltip');
                    el.hidden = true;
                    root.appendChild(el);
                }
                return el;
            };
            const showTip = (e) => {
                const target = e.target.closest?.('[data-bm-health-large] [data-tip]');
                const el = tip();
                root.querySelectorAll('.is-tipped').forEach((n) => n.classList.remove('is-tipped'));
                if (!target) {
                    el.hidden = true;
                    return;
                }
                target.classList.add('is-tipped');
                el.textContent = target.getAttribute('data-tip');
                el.hidden = false;
                const box = root.getBoundingClientRect();
                const x = e.clientX - box.left + root.scrollLeft;
                const y = e.clientY - box.top + root.scrollTop;
                const left = Math.min(x + 12, root.scrollWidth - el.offsetWidth - 4);
                el.style.left = `${Math.max(4, left)}px`;
                el.style.top = `${Math.max(4, y - el.offsetHeight - 10)}px`;
            };
            root.addEventListener('pointermove', showTip);
            root.addEventListener('pointerdown', showTip);
            root.addEventListener('pointerleave', () => {
                const el = root.querySelector('.bm-large-tip');
                if (el) el.hidden = true;
            });
            // A new period redraws from the checks already fetched.
            root.addEventListener('change', (e) => {
                const select = e.target.closest?.('[data-bm-large-range]');
                if (!select || !root.querySelector('[data-bm-health-large]')) return;
                this._bmLargeRange = BM_LARGE_RANGES.includes(select.value) ? select.value : '30';
                const b = this.findBookmarkByKey(this._bmLargeKey);
                const issue = b ? this.bmHealthIssue?.(b) : null;
                if (!b || !issue) return;
                root.innerHTML = this.renderBmHealthLarge(b, issue, this._bmLargeHist, this._bmLargeRange);
                root.querySelector('[data-bm-large-range]')?.focus();
                void this.mountBmLargeCharts();
            });
            // The check list's search and its "only failures": the rows are
            // drawn again from the period's checks, the rest stays put.
            root.addEventListener('input', (e) => {
                if (!e.target.closest?.('[data-bm-large-log-q]')) return;
                this._bmLargeLogQuery = e.target.value;
                this.repaintBmLargeLog();
            });
            root.addEventListener('click', (e) => {
                const tabEl = e.target.closest('[data-bm-large-tab]');
                if (tabEl && root.querySelector('[data-bm-health-large]')) {
                    this.setBmLargeTab(tabEl.getAttribute('data-bm-large-tab'));
                    return;
                }
                const errorsEl = e.target.closest('[data-bm-large-log-errors]');
                if (errorsEl) {
                    this._bmLargeLogErrors = !this._bmLargeLogErrors;
                    errorsEl.setAttribute('aria-pressed', String(this._bmLargeLogErrors));
                    this.repaintBmLargeLog();
                    return;
                }
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
                        .finally(() => { if (this._bmLargeKey === key) void this.openBmHealthLarge(key, { keepRange: true }); });
                } else if (action === 'prev') this.stepBmHealthLarge(-1);
                else if (action === 'next') this.stepBmHealthLarge(1);
                else if (action === 'export' && issue) this._bmHealthModule?.exportMonitorHistory?.(issue);
                else if (action === 'monitor') {
                    global.AppModal.hide();
                    this.focusWorkbenchPanel?.(key);
                    this.setWorkbenchPanelTab?.('health');
                    this.openBmHealthAcc?.('checking');
                }
            });
        },

        /** The tab it opens on: the reader's last, Overview at first. */
        bmLargeTab() {
            try {
                return global.localStorage?.getItem('nextdash.bm.healthLargeTab') === 'checks' ? 'checks' : 'overview';
            } catch {
                return 'overview';
            }
        },

        setBmLargeTab(tab) {
            const root = document.getElementById('modal-text');
            if (!root) return;
            root.querySelectorAll('[data-bm-large-tab]').forEach((btn) => {
                const on = btn.getAttribute('data-bm-large-tab') === tab;
                btn.classList.toggle('is-active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
                btn.tabIndex = on ? 0 : -1;
            });
            root.querySelectorAll('[data-bm-large-pane]').forEach((pane) => {
                pane.hidden = pane.getAttribute('data-bm-large-pane') !== tab;
            });
            try { global.localStorage?.setItem('nextdash.bm.healthLargeTab', tab); } catch { /* private mode */ }
            // The charts on the tab just shown are measured now they have a width.
            this.fitBmLargeCharts();
        },

        /** The check list's rows: the period's checks, newest first, filtered. */
        renderBmLargeLogRows() {
            const esc = (v) => this.dash.escapeHtml(v);
            const t = (key, fallback) => this.t(`config.${key}`, fallback);
            const all = this._bmLargeLog || [];
            const q = String(this._bmLargeLogQuery || '').trim().toLowerCase();
            const cause = (s) => (s.up ? '' : (s.code ? `HTTP ${s.code}` : t('bmLargeNoAnswer', 'no answer')));
            const rows = all.filter((s) => (!this._bmLargeLogErrors || !s.up)).filter((s) => {
                if (!q) return true;
                const when = new Date(s.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                return [when, s.code ? String(s.code) : '', cause(s), s.up ? 'up' : 'down', s.maint ? 'maintenance' : '']
                    .some((v) => v.toLowerCase().includes(q));
            });
            const LIMIT = 300;
            const shown = rows.slice(0, LIMIT);
            const body = shown.map((s) => `<tr${s.up ? '' : ' class="is-down"'}>
                <td>${esc(new Date(s.t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</td>
                <td><span class="bm-health-large-log-dot" data-tone="${s.maint ? 'muted' : (s.up ? 'good' : 'bad')}"></span>${esc(s.maint ? t('bmLargeLogMaint', 'maintenance') : (s.up ? t('bmLargeLogUp', 'up') : t('bmLargeLogDown', 'down')))}</td>
                <td>${esc(s.code ? String(s.code) : '—')}</td>
                <td>${esc(s.ms ? `${s.ms} ms` : '—')}</td>
                <td>${esc(cause(s) || '—')}</td>
            </tr>`).join('');
            const note = rows.length > LIMIT
                ? t('bmLargeLogMore', 'The newest {shown} of {n}; the export has them all.').replace('{shown}', String(LIMIT)).replace('{n}', rows.length.toLocaleString())
                : t('bmLargeLogCount', '{n} checks').replace('{n}', rows.length.toLocaleString());
            return { body: body || `<tr><td colspan="5" class="config-bm-panel-muted">${esc(t('bmLargeLogNone', 'No checks match.'))}</td></tr>`, note };
        },

        repaintBmLargeLog() {
            const root = document.getElementById('modal-text');
            const tbody = root?.querySelector('[data-bm-large-log-body]');
            if (!tbody) return;
            const { body, note } = this.renderBmLargeLogRows();
            tbody.innerHTML = body;
            const noteEl = root.querySelector('[data-bm-large-log-note]');
            if (noteEl) noteEl.textContent = note;
        },

        /* ── The body ─────────────────────────────────────────────────── */

        renderBmHealthLarge(b, issue, hist, range = '30') {
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
            const dur = (ms) => (ms > 0 ? health?.formatDuration?.(ms) || '' : '—');
            // What mountBmLargeCharts draws with uPlot over the plain charts.
            this._bmLargePlots = {};

            // The period: from midnight for today, else the last N days. The
            // checks kept one by one cover 30 days; past that, the day summaries.
            const midnight = new Date(now);
            midnight.setHours(0, 0, 0, 0);
            const isToday = range === 'today';
            const nDays = isToday ? 1 : Number(range) || 30;
            const from = isToday ? midnight.getTime() : now - nDays * DAY;
            const sampleDays = Number(hist?.sampleDays) || 30;
            // From the data, not the retention: the checks kept one by one reach
            // back a week at a 5-minute interval, and "30 days" read that week.
            const rawCovers = nDays <= sampleDays;
            // Whether the checks kept one by one actually reach back to the
            // start of the period: at a 5-minute interval they hold a week,
            // and "30 days" read that week. Only the uptime figure needs it;
            // the charts draw what there is.
            const rawStart = samples.length ? Number(samples[0].t) : now;
            const rawReaches = rawCovers && from >= rawStart;
            const rangeLabel = isToday ? t('bmLargeToday', 'today')
                : t('bmLargeLastDays', 'last {n} days').replace('{n}', String(nDays));
            const rawLabel = rawCovers ? rangeLabel : t('bmLargeLastDays', 'last {n} days').replace('{n}', String(sampleDays));
            const inRange = samples.filter((s) => s.t >= from && !s.maint);
            const rawFrom = rawCovers ? from : now - sampleDays * DAY;
            const rawRange = samples.filter((s) => s.t >= rawFrom && !s.maint);

            const card = (name, title, answer, body, wide = false) => `
                <section class="bm-health-modal-card bm-health-large-card${wide ? ' is-wide' : ''}" data-bm-large-card="${name}">
                    <h3 class="bm-health-modal-card-title"><span>${esc(title)}</span>${answer ? `<span class="bm-health-large-answer">${esc(answer)}</span>` : ''}</h3>
                    ${body}
                </section>`;
            const none = (text) => `<p class="config-bm-panel-muted bm-health-large-none">${esc(text)}${mode !== 'monitor'
                ? ` <button type="button" class="config-bm-rail-more" data-bm-large-action="monitor">${esc(t('bmLargeTurnOnMonitor', 'Turn on Monitor'))}</button>` : ''}</p>`;
            const noChecks = loading ? t('bmLargeLoading', 'Loading the checks…')
                : t('bmLargeNeedsMonitor', 'Not enough checks for this chart. Monitor records one every few minutes.');

            // Head: the bookmark, the period, its score.
            const circ = 2 * Math.PI * 26;
            const dash = Math.max(0, Math.min(100, score)) / 100 * circ;
            const rangeName = (r) => (r === 'today' ? t('bmLargeRangeToday', 'Today')
                : t('bmLargeRangeDays', '{n} days').replace('{n}', r));
            const head = `
                <div class="bm-health-large-head">
                    <span class="bm-health-large-icon">${global.BookmarkFeedRow?.renderIcon?.(this.resolveIconSrc(b.icon), esc) || this.renderBookmarkIcon(b)}</span>
                    <div class="bm-health-large-name">
                        <a class="config-bm-panel-url" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(this.formatBookmarkUrlDisplay(b.url))}</a>
                        <span class="config-bm-panel-muted">${esc([modeLabel, interval,
                            inRange.length ? t('bmLargeChecksInRange', '{n} checks, {range}').replace('{n}', inRange.length.toLocaleString()).replace('{range}', rangeLabel) : '',
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
                        <label class="bm-health-large-range">
                            <select class="config-select" data-bm-large-range aria-label="${esc(t('bmLargeRange', 'Period'))}">
                                ${BM_LARGE_RANGES.map((r) => `<option value="${r}"${r === range ? ' selected' : ''}>${esc(rangeName(r))}</option>`).join('')}
                            </select>
                        </label>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="prev" title="${esc(t('bmLargePrev', 'Previous bookmark (←)'))}">←</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="next" title="${esc(t('bmLargeNext', 'Next bookmark (→)'))}">→</button>
                        <button type="button" class="config-btn config-btn--small config-btn--primary" data-bm-large-action="recheck">${esc(t('bmKeyRecheck', 're-check').replace(/^./, (c) => c.toUpperCase()))}</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="open">${esc(t('openBookmark', 'Open'))}</button>
                        <a class="config-btn config-btn--small" href="/api/health/history-export?url=${encodeURIComponent(b.url)}" download>${esc(t('bmLargeExport', 'Export CSV'))}</a>
                    </div>
                </div>`;

            // 1. Uptime: the period's, then the fixed windows beside it.
            const dayFrom = (() => { const d = new Date(from); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
            const rangeDays = days.filter((d) => d.d >= dayFrom);
            // Past the checks kept, the day summaries before them plus the checks
            // themselves, as the server's own 30-day figure counts them.
            const rawDay = (() => { const d = new Date(rawStart); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
            const olderDays = rangeDays.filter((d) => d.d < rawDay);
            const [upN, allN] = rawReaches
                ? [inRange.filter((s) => s.up).length, inRange.length]
                : [olderDays.reduce((a, d) => a + d.u, 0) + inRange.filter((s) => s.up).length,
                    olderDays.reduce((a, d) => a + d.n, 0) + inRange.length];
            const daysTotal = days.reduce((a, d) => a + d.n, 0);
            const daysUp = days.reduce((a, d) => a + d.u, 0);
            const incidents = Array.isArray(stats.incidents) ? stats.incidents : [];
            const incRange = incidents.filter((i) => Number(i.start) + (Number(i.durationMs) || 0) >= from);
            // Counted and summed over every incident, not the five listed: twelve
            // outages read "5", with five outages' downtime.
            const spans = Array.isArray(stats.incidentSpans) && stats.incidentSpans.length
                ? stats.incidentSpans.map(([start, ms]) => ({ start: Number(start), ms: Number(ms) || 0 }))
                : incidents.map((i) => ({ start: Number(i.start), ms: Number(i.durationMs) || 0 }));
            const spansInRange = spans.filter((i) => i.start + i.ms >= from);
            const downRange = spansInRange.reduce((a, i) => a + Math.max(0, i.start + i.ms - Math.max(from, i.start)), 0);
            const uptimeCard = card('uptime', t('bmLargeUptime', 'Uptime'), rangeLabel, `
                <div class="bm-health-large-big"><b>${esc(allN ? pct(upN / allN) : '—')}</b>
                    <span>${esc(t('bmLargeDownFor', 'down {d}').replace('{d}', dur(downRange)))}</span></div>
                <div class="bm-health-large-tiles">
                    <div><b>${esc(pct(stats.uptime24h?.ratio))}</b>${esc(t('bmLarge24h', '24 hours'))}</div>
                    <div><b>${esc(pct(stats.uptime7d?.ratio))}</b>${esc(t('bmLarge7d', '7 days'))}</div>
                    <div><b>${esc(pct(stats.uptime30d?.ratio))}</b>${esc(t('bmLarge30d', '30 days'))}</div>
                    <div><b>${esc(daysTotal ? pct(daysUp / daysTotal) : '—')}</b>${esc(t('bmLarge90d', '90 days'))}</div>
                </div>`);

            // 2. Response time over the period: the checks in buckets while
            // they reach back far enough, else each day's mean.
            const pinged = inRange.filter((s) => s.up && s.ms > 0);
            const sorted = pinged.map((s) => s.ms).sort((x, y) => x - y);
            const avg = sorted.length ? Math.round(sorted.reduce((a, v) => a + v, 0) / sorted.length) : 0;
            const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
            let points = [];
            if (rawCovers) {
                const buckets = 96;
                const span = Math.max(1, (now - from) / buckets);
                const sums = new Array(buckets).fill(0);
                const counts = new Array(buckets).fill(0);
                pinged.forEach((s) => {
                    const i = Math.min(buckets - 1, Math.floor((s.t - from) / span));
                    sums[i] += s.ms;
                    counts[i] += 1;
                });
                points = sums.map((sum, i) => (counts[i] ? { x: from + (i + 0.5) * span, y: sum / counts[i] } : null)).filter(Boolean);
            } else {
                points = rangeDays.filter((d) => d.p > 0).map((d) => ({ x: d.d + DAY / 2, y: d.p }));
            }
            const dayMean = rangeDays.filter((d) => d.p > 0);
            const answer = sorted.length
                ? t('bmLargeAvgP95', 'avg {a} ms · p95 {p} ms').replace('{a}', String(avg)).replace('{p}', String(p95))
                : (dayMean.length ? t('bmLargeAvg', 'avg {a} ms').replace('{a}', String(Math.round(dayMean.reduce((a, d) => a + d.p, 0) / dayMean.length))) : '');
            const responseTitle = `${t('bmLargeResponseTitle', 'Response time')}, ${rangeLabel}`;
            const responseP95 = rawCovers ? p95 : 0;
            if (points.length >= 2) {
                const ms = (v) => `${Math.round(v)} ms`;
                const top = Math.max(responseP95, ...points.map((p) => p.y)) * 1.1 || 1;
                this._bmLargePlots.line = {
                    x: points.map((p) => p.x / 1000),
                    series: [
                        { label: t('bmLargeResponseTitle', 'Response time'), values: points.map((p) => Math.round(p.y)), color: '--accent-primary', format: ms },
                        ...(responseP95 ? [{ label: 'p95', values: points.map(() => responseP95), color: '--text-muted', dash: [4, 4], width: 1, fill: false, format: ms }] : []),
                    ],
                    format: { x: isToday ? 'time' : (rawCovers ? 'datetime' : 'date'), y: ms },
                    scales: { y: { range: () => [0, top] } },
                    summary: answer ? `${responseTitle}: ${answer}` : responseTitle,
                    height: 112,
                    axisWidth: 54,
                };
            }
            const responseCard = card('response', responseTitle, answer,
                points.length >= 2 ? `<div class="bm-health-large-plot" data-bm-large-plot="line">${this.bmLargeLineChart(points, from, now, responseP95, esc, isToday)}</div>` : none(noChecks), true);

            // 3. Uptime over time: per hour today, per day otherwise.
            let bars = [];
            if (isToday) {
                for (let h = 0; h < 24; h += 1) {
                    // Each bar the hour the clock shows, so a DST day still
                    // reads 00:00 to 23:00 without a shifted hour.
                    const at = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), h).getTime();
                    const inHour = inRange.filter((s) => s.t >= at && s.t < at + HOUR);
                    bars.push({ ratio: inHour.length ? inHour.filter((s) => s.up).length / inHour.length : null,
                        n: inHour.length, label: `${String(h).padStart(2, '0')}:00`, at: at + HOUR / 2 });
                }
            } else {
                const byDay = new Map(days.map((d) => [d.d, d]));
                const first = new Date(now - (nDays - 1) * DAY);
                first.setUTCHours(0, 0, 0, 0);
                for (let i = 0; i < nDays; i += 1) {
                    const d = byDay.get(first.getTime() + i * DAY);
                    bars.push({ ratio: d && d.n ? d.u / d.n : null, n: d?.n || 0,
                        // The days are UTC days (setUTCHours above); labelled in
                        // local time, west of UTC each bar named the day before.
                        label: new Date(first.getTime() + i * DAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
                        // Midday of the UTC day, so the axis names the same day as the label.
                        at: first.getTime() + i * DAY + DAY / 2 });
                }
            }
            const hasBars = bars.some((x) => x.ratio != null);
            const barsTitle = isToday ? t('bmLargePerHourToday', 'Uptime per hour, today')
                : `${t('bmLargePerDayTitle', 'Uptime per day')}, ${rangeLabel}`;
            if (hasBars) {
                // One series per tone, so each bar keeps the colour it had; a
                // bar of 0% still shows as a stub, the tooltip says the real share.
                const toneOf = (bar) => (bar.ratio == null ? null : bar.ratio >= 0.999 ? 'good' : bar.ratio >= 0.95 ? 'warn' : 'bad');
                const tones = [['good', '--accent-success'], ['warn', '--accent-warning'], ['bad', '--accent-error']];
                const half = (isToday ? HOUR : DAY) / 2000;
                this._bmLargePlots.days = {
                    x: bars.map((bar) => bar.at / 1000),
                    series: tones.map(([name, color]) => ({ label: name, bars: true, color,
                        values: bars.map((bar) => (toneOf(bar) === name ? Math.max(3, bar.ratio * 100) : null)) })),
                    text: (i) => this.bmLargeBarTip(bars[i]),
                    format: { x: isToday ? 'time' : 'date', tick: (v) => `${Math.round(v)}%` },
                    scales: { x: { range: (u, min, max) => [min - half, max + half] }, y: { range: () => [0, 100] } },
                    summary: `${barsTitle}${allN ? `: ${pct(upN / allN)}` : ''}`,
                    height: 92,
                    axisWidth: 54,
                };
            }
            const barsCard = card('days', barsTitle, allN ? pct(upN / allN) : '',
                hasBars ? `<div class="bm-health-large-plot" data-bm-large-plot="days">${this.bmLargeBars(bars, esc)}</div>` : none(noChecks), true);

            // 4. HTTP answers in the period (as far as the checks kept reach).
            const classes = [
                { key: '2xx', test: (c) => c >= 200 && c < 300, tone: 'good' },
                { key: '3xx', test: (c) => c >= 300 && c < 400, tone: 'info' },
                { key: '4xx', test: (c) => c >= 400 && c < 500, tone: 'warn' },
                { key: '5xx', test: (c) => c >= 500, tone: 'bad' },
                { key: t('bmLargeNoAnswer', 'no answer'), test: (c) => !c, tone: 'muted' },
            ];
            const counted = classes.map((cl) => ({ ...cl, n: rawRange.filter((s) => cl.test(s.code)).length }));
            const maxN = Math.max(1, ...counted.map((c) => c.n));
            const codesCard = card('codes', t('bmLargeCodesTitle', 'HTTP answers'), rawLabel, rawRange.length
                ? `<div class="bm-health-large-codes">${counted.map((c) => `
                    <div data-tip="${esc(`${c.key}: ${c.n.toLocaleString()} (${rawRange.length ? Math.round((c.n / rawRange.length) * 1000) / 10 : 0}%)`)}"><span>${esc(c.key)}</span><i data-tone="${c.tone}" style="width:${Math.max(c.n ? 2 : 0, Math.round((c.n / maxN) * 100))}%"></i><span>${c.n.toLocaleString()}</span></div>`).join('')}</div>`
                : none(noChecks));

            // 5. Availability by hour over the period (at most the 30 days of checks kept).
            const heatDays = Math.min(nDays, sampleDays);
            const heatCard = card('hours', `${t('bmLargeHoursTitle', 'Availability by hour')}, ${rawLabel}`,
                t('bmLargeHoursKey', 'red down · amber slow · grey no checks'),
                rawRange.length ? this.bmLargeHeatmap(samples, now, p95, esc, heatDays) : none(noChecks), true);

            // 6. Incidents in the period.
            const incCard = card('incidents', t('bmLargeIncidents', 'Incidents'),
                t('bmLargeIncidentCountIn', '{n}, {range}').replace('{n}', String(spansInRange.length)).replace('{range}', rangeLabel),
                incRange.length
                    ? `<div class="bm-health-large-incidents">${incRange.slice(0, 5).map((i) => `
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
                    data-tip="${esc(`${new Date(s.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · ${s.code || '—'}${s.ms ? ` · ${s.ms} ms` : ''}`)}"></i>`).join('')}</div>
                    ${last ? `<div class="config-bm-usage-kv"><span>${esc(t('bmLargeLastAnswer', 'Last answer'))}</span><span>${esc(`${last.code || t('bmLargeNoAnswer', 'no answer')}${last.ms ? ` · ${last.ms} ms` : ''}`)}</span></div>` : ''}`
                    : none(noChecks), true);

            // 11. Every check of the period, newest first: searchable, the
            // failures alone at a click, and the whole history as CSV.
            this._bmLargeLog = [...rawRange].sort((a, c) => c.t - a.t);
            const log = this.renderBmLargeLogRows();
            const logCard = card('log', t('bmLargeLogTitle', 'Every check'), rawLabel,
                rawRange.length ? `<div class="bm-health-large-log-tools">
                        <input type="search" class="config-text" data-bm-large-log-q value="${esc(this._bmLargeLogQuery || '')}"
                               placeholder="${esc(t('bmLargeLogSearch', 'Search: 502, timeout, a date…'))}" aria-label="${esc(t('bmLargeLogSearchLabel', 'Search the checks'))}">
                        <button type="button" class="config-btn config-btn--small" data-bm-large-log-errors aria-pressed="${this._bmLargeLogErrors ? 'true' : 'false'}">${esc(t('bmLargeLogErrors', 'Only failures'))}</button>
                        <button type="button" class="config-btn config-btn--small" data-bm-large-action="export">${esc(t('bmLargeLogExport', 'Export CSV'))}</button>
                    </div>
                    <div class="bm-health-large-log-scroll">
                        <table class="bm-health-large-log">
                            <thead><tr><th>${esc(t('bmLargeLogWhen', 'Time'))}</th><th>${esc(t('bmLargeLogState', 'State'))}</th><th>${esc(t('bmLargeLogCode', 'Code'))}</th><th>${esc(t('bmLargeLogMs', 'Response'))}</th><th>${esc(t('bmLargeLogCause', 'Cause'))}</th></tr></thead>
                            <tbody data-bm-large-log-body>${log.body}</tbody>
                        </table>
                    </div>
                    <p class="config-bm-panel-muted bm-health-large-log-note" data-bm-large-log-note>${esc(log.note)}</p>`
                    : none(noChecks), true);

            const tab = this.bmLargeTab();
            const tabButton = (name, label) => `<button type="button" class="config-bm-tab${tab === name ? ' is-active' : ''}" role="tab"
                aria-selected="${tab === name ? 'true' : 'false'}" tabindex="${tab === name ? 0 : -1}" data-bm-large-tab="${name}">${esc(label)}</button>`;
            return `<div class="bm-health-large" data-bm-health-large data-loading="${loading ? '1' : '0'}" data-range="${esc(range)}">
                ${head}
                <div class="config-bm-tabs bm-health-modal-tabs" role="tablist">
                    ${tabButton('overview', t('bmLargeTabOverview', 'Overview'))}
                    ${tabButton('checks', t('bmLargeTabChecks', 'Checks'))}
                </div>
                <div class="bm-health-large-grid" role="tabpanel" data-bm-large-pane="overview"${tab === 'overview' ? '' : ' hidden'}>
                    ${uptimeCard}${responseCard}${codesCard}
                    ${barsCard}${incCard}${scoreCard}
                </div>
                <div class="bm-health-large-grid" role="tabpanel" data-bm-large-pane="checks"${tab === 'checks' ? '' : ' hidden'}>
                    ${heatCard}${certCard}${keptCard}
                    ${checksCard}${logCard}
                </div>
                <p class="bm-health-large-foot">${esc(t('bmLargeFoot', 'Checks are kept one by one for 30 days, and as a summary per day for 90. ← and → go to the previous and next bookmark.'))}</p>
            </div>`;
        },

        /** A line over time, with a dashed p95 line when there is one. */
        bmLargeLineChart(points, from, to, p95, esc, hours = false) {
            // Drawn at the card's own width (fitBmLargeCharts), so nothing stretches.
            const w = this._bmLargeW?.line || 320;
            const h = 70;
            const max = Math.max(p95 || 0, ...points.map((p) => p.y)) * 1.1 || 1;
            const x = (v) => 4 + ((v - from) / Math.max(1, to - from)) * (w - 8);
            const y = (v) => 6 + h - (v / max) * h;
            const path = points.map((p) => `${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
            const label = (ms) => (hours
                ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
            return `<svg class="bm-health-large-line" viewBox="0 0 ${w} ${h + 18}" width="100%" height="${h + 18}" role="img">
                <line x1="4" y1="${h + 6}" x2="${w - 4}" y2="${h + 6}" class="is-axis"></line>
                ${p95 ? `<line x1="4" y1="${y(p95).toFixed(1)}" x2="${w - 4}" y2="${y(p95).toFixed(1)}" class="is-p95"></line>` : ''}
                <polyline points="${path}" class="is-line"></polyline>
                ${points.map((p) => `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3" class="is-point"
                    data-tip="${esc(`${hours ? new Date(p.x).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : new Date(p.x).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${Math.round(p.y)} ms`)}"></circle>`).join('')}
                <text x="4" y="${h + 16}" class="is-label">${esc(label(from))}</text>
                <text x="${w - 4}" y="${h + 16}" text-anchor="end" class="is-label">${esc(label(to))}</text>
                <text x="${w - 4}" y="12" text-anchor="end" class="is-label">${Math.round(max)} ms</text>
            </svg>`;
        },

        bmLargeBarTip(bar) {
            return `${bar.label}: ${bar.ratio == null ? this.t('config.bmLargeTipNoChecks', 'no checks') : `${Math.round(bar.ratio * 1000) / 10}%`}${bar.n ? ` · ${bar.n} ${this.t('config.bmLargeTipChecks', 'checks')}` : ''}`;
        },

        /** One bar per hour or per day: its height the share of checks that answered. */
        bmLargeBars(bars, esc) {
            const w = this._bmLargeW?.days || 306;
            const step = w / bars.length;
            const bw = Math.max(1, step * 0.76);
            const rects = bars.map((bar, i) => {
                const tone = bar.ratio == null ? 'muted' : bar.ratio >= 0.999 ? 'good' : bar.ratio >= 0.95 ? 'warn' : 'bad';
                const hgt = bar.ratio == null ? 2 : Math.max(3, Math.round(bar.ratio * 40));
                const tip = this.bmLargeBarTip(bar);
                // The whole column answers the pointer, not just the bar's height.
                return `<rect x="${(i * step).toFixed(2)}" y="0" width="${step.toFixed(2)}" height="44" class="is-hit" data-tip="${esc(tip)}"></rect>
                    <rect x="${(i * step).toFixed(2)}" y="${42 - hgt}" width="${bw.toFixed(2)}" height="${hgt}" data-tone="${tone}" pointer-events="none"></rect>`;
            });
            return `<svg class="bm-health-large-days" viewBox="0 0 ${w} 44" width="100%" height="44" role="img">${rects.join('')}</svg>`;
        },

        /** The period's days across (today: one), 24 hours down: down, slow, fine or no checks. */
        bmLargeHeatmap(samples, now, p95, esc, nDays = 30) {
            const start = new Date(now - (nDays - 1) * DAY);
            start.setHours(0, 0, 0, 0);
            const cells = new Map();
            samples.forEach((s) => {
                if (s.t < start.getTime() || s.maint) return;
                // By calendar day, not 24-hour steps: across a DST switch the
                // 23:00 hour landed in the next day's column.
                const at = new Date(s.t);
                const dayIdx = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) - start) / DAY);
                const hour = new Date(s.t).getHours();
                const k = `${dayIdx}:${hour}`;
                const c = cells.get(k) || { up: 0, down: 0, slow: 0 };
                if (!s.up) c.down += 1;
                else if (p95 && s.ms > p95) c.slow += 1;
                else c.up += 1;
                cells.set(k, c);
            });
            const W = this._bmLargeW?.heat || 300;
            const cw = W / nDays;
            const rects = [];
            for (let d = 0; d < nDays; d += 1) {
                for (let hr = 0; hr < 24; hr += 1) {
                    const c = cells.get(`${d}:${hr}`);
                    const tone = !c ? 'muted' : c.down ? 'bad' : c.slow ? 'warn' : 'good';
                    const when = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d, hr);
                    const tip = `${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${String(hr).padStart(2, '0')}:00 · ${c
                        ? [c.up ? `${c.up} ${this.t('config.bmLargeTipUp', 'up')}` : '', c.slow ? `${c.slow} ${this.t('config.bmLargeTipSlow', 'slow')}` : '',
                            c.down ? `${c.down} ${this.t('config.bmLargeTipDown', 'down')}` : ''].filter(Boolean).join(', ')
                        : this.t('config.bmLargeTipNoChecks', 'no checks')}`;
                    rects.push(`<rect x="${(d * cw).toFixed(2)}" y="${hr * 4}" width="${Math.max(0.5, cw - 1).toFixed(2)}" height="3.4" data-tone="${tone}" data-tip="${esc(tip)}"></rect>`);
                }
            }
            return `<svg class="bm-health-large-heat" viewBox="0 0 ${W} 96" width="100%" height="96" role="img"
                aria-label="${esc(this.t('config.bmLargeHoursTitle', 'Availability by hour'))}">${rects.join('')}</svg>`;
        },
    });

    global.DashboardBookmarksHealthLargeReady = true;
}(typeof window !== 'undefined' ? window : globalThis));
