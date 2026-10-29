/**
 * Glances page, Insights: what nextDash works out from its own record of the host.
 *
 * None of it is something Glances says. A health score, when a disk will be
 * full, whether memory is climbing, how this hour compares with the same hour
 * on other days, the busy hours of the week, what went over the network each
 * day, how often the host answered, the incidents, and which of the processes
 * and containers you record used the most. The server computes it from the
 * record (/api/glances/insights); a figure with too little behind it is left
 * out rather than guessed. Every value reaches the page through textContent.
 */
(function () {
    'use strict';

    const RANGES = [
        { id: '24h', label: ['dashboard.glancesInsRange24h', 'Last 24 hours'] },
        { id: '7d', label: ['dashboard.glancesInsRange7d', 'Last 7 days'] },
        { id: '30d', label: ['dashboard.glancesInsRange30d', 'Last 30 days'] },
    ];
    const HEATS = [
        { id: 'cpu', label: ['dashboard.glancesInsHeatCpu', 'Processor'] },
        { id: 'net', label: ['dashboard.glancesInsHeatNet', 'Network'] },
        { id: 'temp', label: ['dashboard.glancesInsHeatTemp', 'Temperature'] },
    ];
    const STORE = 'nextdash:glances-insights-v1';
    const FACTOR_LABELS = {
        cpu: ['dashboard.glancesInsFactorCpu', 'Processor'],
        mem: ['dashboard.glancesInsFactorMem', 'Memory'],
        swap: ['dashboard.glancesInsFactorSwap', 'Swap'],
        disk: ['dashboard.glancesInsFactorDisk', 'Fullest disk'],
        temp: ['dashboard.glancesInsFactorTemp', 'Hottest sensor'],
        availability: ['dashboard.glancesInsFactorAvail', 'Availability'],
    };
    const KIND_LABELS = {
        down: ['dashboard.glancesInsKindDown', 'Host not answering'],
        cpu: ['dashboard.glancesInsKindCpu', 'Processor'],
        mem: ['dashboard.glancesInsKindMem', 'Memory'],
        swap: ['dashboard.glancesInsKindSwap', 'Swap'],
        disk: ['dashboard.glancesInsKindDisk', 'Disk'],
        temp: ['dashboard.glancesInsKindTemp', 'Temperature'],
    };

    const { el } = window.DashboardGlancesDom;

    function readChoice() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORE) || '{}');
            return {
                range: RANGES.some((r) => r.id === parsed.range) ? parsed.range : '24h',
                heat: HEATS.some((h) => h.id === parsed.heat) ? parsed.heat : 'cpu',
            };
        } catch {
            return { range: '24h', heat: 'cpu' };
        }
    }

    function writeChoice(choice) {
        try { localStorage.setItem(STORE, JSON.stringify(choice)); } catch { /* the choice lasts until the page is left */ }
    }

    class GlancesInsights {
        constructor(view) {
            this.view = view;
            this.choice = readChoice();
        }

        endpoints() {
            return [`insights?range=${this.choice.range}&heat=${this.choice.heat}&tz=${encodeURIComponent(window.DashboardGlancesDom.zone())}`];
        }

        t(key, fallback, params) {
            return this.view.t(key, fallback, params);
        }

        tl(pair) {
            return this.t(pair[0], pair[1]);
        }

        pick(label, options, current, onPick, attr) {
            const wrap = el('label', 'glances-range-pick');
            wrap.append(el('span', 'glances-ins-pick-label', label));
            const select = el('select', 'config-select glances-range-select');
            select.setAttribute(attr, '');
            options.forEach((o) => {
                const option = el('option', '', this.tl(o.label));
                option.value = o.id;
                select.appendChild(option);
            });
            select.value = current;
            select.addEventListener('change', () => onPick(select.value));
            wrap.appendChild(select);
            return wrap;
        }

        block(id, titleKey, title, wide = false) {
            const block = el('section', `glances-ov-block${wide ? ' glances-ov-block--wide' : ''}`);
            block.setAttribute('data-glances-insight', id);
            const heading = el('h3', 'glances-block-title', this.t(titleKey, title));
            const info = window.DashboardGlancesInfo?.button(this.view, id);
            if (info) heading.appendChild(info);
            block.appendChild(heading);
            return block;
        }

        note(text) {
            return el('p', 'glances-note', text);
        }

        table(id, columns, rows, initial) {
            return window.DashboardGlancesTable.build({
                id, columns, rows, t: (k, f, p) => this.t(k, f, p), initial,
                rerender: () => this._redraw(),
            });
        }

        _redraw() {
            this._shownAt = null;
            if (this._host && this._data) this.render(this._host, this._data);
        }

        duration(ms) {
            const minutes = Math.max(1, Math.round(ms / 60000));
            if (minutes < 60) return this.t('dashboard.glancesInsMinutes', '{n} min', { n: minutes });
            const hours = Math.floor(minutes / 60);
            if (hours < 48) return this.t('dashboard.glancesInsHours', '{n} h {m} min', { n: hours, m: minutes % 60 });
            return this.t('dashboard.glancesInsDays', '{n} days', { n: Math.round(hours / 24) });
        }

        when(ms) {
            return new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        }

        fmtValue(unit, v) {
            const G = window.DashboardGlances;
            if (v === null || v === undefined || v < 0) return G.DASH;
            if (unit === 'B/s') return `${G.formatBytes(v)}/s`;
            if (unit === '°C') return G.formatTemp(v);
            return `${Math.round(v)}%`;
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const answer = G.usable(data[this.endpoints()[0]]);
            this._host = container;
            this._data = data;
            // The answer changes at most every half minute: an unchanged one is
            // left alone, so an open menu or a focused control is not rebuilt under the reader.
            if (answer && this._shownAt === answer.at && container.querySelector('[data-glances-insights]')) return;
            this._shownAt = answer ? answer.at : null;
            const root = el('div', 'glances-insights');
            root.setAttribute('data-glances-insights', '');
            if (!answer) {
                root.appendChild(this.note(this.t('dashboard.glancesInsEmpty', 'nextDash is still collecting history; insights appear as it grows.')));
                container.replaceChildren(root);
                return;
            }
            const bar = el('div', 'glances-ins-bar');
            bar.appendChild(this.pick(this.t('dashboard.glancesRangeLabel', 'Range'), RANGES, this.choice.range, (id) => {
                this.choice.range = id;
                writeChoice(this.choice);
                void this.view.refresh({ force: true });
            }, 'data-glances-insights-range'));
            const csv = el('a', 'config-btn glances-ins-csv', this.t('dashboard.glancesInsCsv', 'Download CSV'));
            csv.href = window.DashboardGlancesHost.url(`/api/glances/history.csv?since=${Date.now() - ({ '24h': 1, '7d': 7, '30d': 30 }[this.choice.range]) * 86400000}`);
            csv.setAttribute('download', 'glances-history.csv');
            csv.setAttribute('data-glances-insights-csv', '');
            bar.appendChild(csv);
            root.appendChild(bar);

            const blocks = [
                this.health(answer), this.statsBlock(answer), this.compare(answer), this.heatmap(answer), this.day(answer), this.spikes(answer),
                this.load(answer), this.memory(answer), this.sensors(answer), this.filesystems(answer), this.diskIo(answer),
                this.volume(answer), this.interfaces(answer),
                this.availability(answer), this.incidents(answer), this.consumers(answer),
            ].filter(Boolean);
            // The blocks fill two columns: one left alone on its row (the next is wide, or it is the last) takes the whole row.
            let open = null;
            blocks.forEach((block) => {
                const wide = block.classList.contains('glances-ov-block--wide');
                if (wide) {
                    if (open) open.classList.add('glances-ov-block--wide');
                    open = null;
                } else {
                    open = open ? null : block;
                }
            });
            if (open) open.classList.add('glances-ov-block--wide');
            const grid = el('div', 'glances-blocks');
            grid.append(...blocks);
            root.appendChild(grid);
            const active = document.activeElement;
            const keep = active && container.contains(active) && active.hasAttribute('data-glances-insights-range') ? '[data-glances-insights-range]' : '';
            container.replaceChildren(root);
            if (keep) container.querySelector(keep)?.focus({ preventScroll: true });
        }

        health(a) {
            const block = this.block('health', 'dashboard.glancesInsHealth', 'Health', true);
            const h = a.health || {};
            const head = el('div', 'glances-ins-health');
            const score = el('div', 'glances-ins-score', String(h.score ?? '–'));
            score.setAttribute('data-tone', h.level === 'good' ? '' : (h.level === 'fair' ? 'warn' : 'bad'));
            score.setAttribute('data-glances-score', '');
            const side = el('div', 'glances-ins-score-side');
            const verdict = el('strong', '', this.t(`dashboard.glancesInsLevel_${h.level || 'good'}`, { good: 'Good', fair: 'Fair', poor: 'Poor' }[h.level] || 'Good'));
            const scoreInfo = window.DashboardGlancesInfo?.button(this.view, 'score');
            if (scoreInfo) verdict.appendChild(scoreInfo);
            side.appendChild(verdict);
            side.appendChild(this.note(this.t('dashboard.glancesInsScoreNote', 'Out of 100, from how close each reading is to its red line, ongoing incidents and availability.')));
            if (typeof h.trendCpu === 'number') {
                const up = h.trendCpu > 0;
                side.appendChild(this.note(this.t(up ? 'dashboard.glancesInsTrendUp' : 'dashboard.glancesInsTrendDown',
                    up ? 'Processor use is {n} points higher than the hour before.' : 'Processor use is {n} points lower than the hour before.',
                    { n: Math.abs(h.trendCpu) })));
            }
            head.append(score, side);
            block.appendChild(head);

            const factors = (h.factors || []).filter((f) => f.penalty > 0);
            if (factors.length) {
                const list = el('ul', 'glances-ins-factors');
                factors.forEach((f) => {
                    const li = el('li', 'glances-ins-factor');
                    li.append(el('span', '', this.tl(FACTOR_LABELS[f.key] || [`dashboard.glancesInsFactor_${f.key}`, f.key])),
                        el('span', 'glances-ins-factor-value', `${f.key === 'temp' ? window.DashboardGlances.formatTemp(f.value) : `${f.value}%`} · −${f.penalty}`));
                    list.appendChild(li);
                });
                block.appendChild(list);
            }

            const forecast = a.forecast || [];
            if (forecast.length) {
                const sub = el('h4', 'glances-ins-sub', this.t('dashboard.glancesInsForecast', 'Disks: when full'));
                const forecastInfo = window.DashboardGlancesInfo?.button(this.view, 'forecast');
                if (forecastInfo) sub.appendChild(forecastInfo);
                block.appendChild(sub);
                block.appendChild(this.table('ins-forecast', [
                    { key: 'mount', label: ['dashboard.glancesDiskMount', 'Mount'], value: (r) => r.mount, cell: (r) => r.mount, numeric: false },
                    { key: 'percent', label: ['dashboard.glancesInsUsed', 'Used'], value: (r) => r.percent, cell: (r) => `${r.percent}%` },
                    { key: 'slope', label: ['dashboard.glancesInsPerDay', 'Per day'], value: (r) => r.slopePerDay, cell: (r) => `${r.slopePerDay > 0 ? '+' : ''}${r.slopePerDay}%` },
                    { key: 'days', label: ['dashboard.glancesInsFullIn', 'Full in'], value: (r) => (r.daysToFull ?? null),
                        cell: (r) => (r.daysToFull == null ? '–' : this.t('dashboard.glancesInsDays', '{n} days', { n: r.daysToFull })) },
                ], forecast, { key: 'days', dir: 'asc' }));
            }
            const m = a.memory;
            if (m) {
                const text = m.leak
                    ? this.t('dashboard.glancesInsMemLeak', 'Memory grows {n}% a day without letting go: a possible leak.', { n: m.slopePerDay })
                    : this.t('dashboard.glancesInsMemSteady', 'Memory is steady ({n}% a day).', { n: m.slopePerDay });
                const note = this.note(text);
                note.setAttribute('data-glances-memory-trend', m.leak ? 'leak' : 'steady');
                block.appendChild(note);
            }
            return block;
        }

        statsBlock(a) {
            const keys = Object.keys(a.stats || {});
            if (!keys.length) return null;
            const block = this.block('stats', 'dashboard.glancesInsStats', 'Typical and peak', true);
            const names = { cpu: 'Processor', mem: 'Memory', swap: 'Swap', load1: 'Load' };
            const rows = keys.map((k) => ({ key: k, name: names[k] || k, ...a.stats[k] }));
            const unit = (r, v) => (r.key === 'load1' ? v.toFixed(2) : `${Math.round(v)}%`);
            block.appendChild(this.table('ins-stats', [
                { key: 'name', label: ['dashboard.glancesInsMetric', 'Reading'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                { key: 'avg', label: ['dashboard.glancesStatAvg', 'Average'], value: (r) => r.avg, cell: (r) => unit(r, r.avg) },
                { key: 'p50', label: ['dashboard.glancesInsP50', 'Median'], value: (r) => r.p50, cell: (r) => unit(r, r.p50) },
                { key: 'p95', label: ['dashboard.glancesInsP95', '95th'], value: (r) => r.p95, cell: (r) => unit(r, r.p95) },
                { key: 'p99', label: ['dashboard.glancesInsP99', '99th'], value: (r) => r.p99, cell: (r) => unit(r, r.p99) },
                { key: 'max', label: ['dashboard.glancesStatMax', 'High'], value: (r) => r.max, cell: (r) => unit(r, r.max) },
            ], rows, { key: 'name', dir: 'asc' }));
            (a.baseline || []).forEach((b) => {
                const name = { cpu: 'Processor', mem: 'Memory', net: 'Network' }[b.key] || b.key;
                let text;
                if (b.ratio >= 1.5) text = this.t('dashboard.glancesInsBaselineHigh', '{name} is {ratio}× what is usual for this hour.', { name, ratio: b.ratio });
                else if (b.ratio <= 0.67) text = this.t('dashboard.glancesInsBaselineLow', '{name} is lower than usual for this hour ({ratio}×).', { name, ratio: b.ratio });
                else text = this.t('dashboard.glancesInsBaselineNormal', '{name} is about as usual for this hour.', { name });
                const note = this.note(text);
                note.setAttribute('data-glances-baseline', b.key);
                block.appendChild(note);
            });
            const t = a.temperature;
            if (t) {
                block.appendChild(this.note(this.t('dashboard.glancesInsTemp',
                    'Hottest sensor: up to {max}°, {avg}° on average; {warn} h over the yellow line, {bad} h over the red one.',
                    { max: window.DashboardGlances.tempNumber(t.max), avg: window.DashboardGlances.tempNumber(t.avg), warn: t.hoursWarn, bad: t.hoursBad })));
                if (typeof t.correlationCpu === 'number') {
                    const r = t.correlationCpu;
                    block.appendChild(this.note(this.t('dashboard.glancesInsCorrelation', 'Heat follows processor load: correlation {r} over the last day.', { r })));
                }
            }
            return block;
        }

        heatmap(a) {
            const h = a.heatmap;
            if (!h || !h.days || !h.days.length) return null;
            const block = this.block('heatmap', 'dashboard.glancesInsHeatmap', 'Busy hours', true);
            block.appendChild(this.pick(this.t('dashboard.glancesInsHeatMetric', 'Show'), HEATS, this.choice.heat, (id) => {
                this.choice.heat = id;
                writeChoice(this.choice);
                void this.view.refresh({ force: true });
            }, 'data-glances-heat-select'));
            const grid = el('div', 'glances-heat');
            grid.setAttribute('data-glances-heat', h.metric);
            const head = el('div', 'glances-heat-row glances-heat-head');
            head.appendChild(el('span', 'glances-heat-day'));
            for (let i = 0; i < 24; i += 1) head.appendChild(el('span', 'glances-heat-hour', i % 3 === 0 ? String(i) : ''));
            grid.appendChild(head);
            h.days.forEach((d) => {
                const row = el('div', 'glances-heat-row');
                row.appendChild(el('span', 'glances-heat-day', new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' })));
                d.hours.forEach((v, i) => {
                    const cell = el('span', 'glances-heat-cell');
                    if (v >= 0) {
                        const ratio = h.max > 0 ? Math.max(0.05, Math.min(1, v / h.max)) : 0.05;
                        cell.style.setProperty('--heat', ratio.toFixed(2));
                        cell.title = `${d.date} ${String(i).padStart(2, '0')}:00 · ${this.fmtValue(h.unit, v)}`;
                    } else {
                        cell.classList.add('is-empty');
                        cell.title = `${d.date} ${String(i).padStart(2, '0')}:00 · ${window.DashboardGlances.DASH}`;
                    }
                    row.appendChild(cell);
                });
                grid.appendChild(row);
            });
            block.appendChild(grid);
            block.appendChild(this.note(this.t('dashboard.glancesInsHeatNote', 'Darker is busier; the darkest hour is {max}. Hours with no record are empty.', { max: this.fmtValue(h.unit, h.max) })));
            return block;
        }

        volume(a) {
            const n = a.network;
            if (!n || !n.days || !n.days.length) return null;
            const G = window.DashboardGlances;
            const total = n.totalRx + n.totalTx;
            if (!total) return null;
            const block = this.block('volume', 'dashboard.glancesInsVolume', 'Network per day');
            const peak = Math.max(...n.days.map((d) => d.rx + d.tx), 1);
            const bars = el('div', 'glances-vol');
            bars.setAttribute('data-glances-volume', '');
            n.days.forEach((d) => {
                const col = el('div', 'glances-vol-col');
                const stack = el('div', 'glances-vol-stack');
                const rx = el('span', 'glances-vol-rx');
                rx.style.height = `${((d.rx / peak) * 100).toFixed(1)}%`;
                const tx = el('span', 'glances-vol-tx');
                tx.style.height = `${((d.tx / peak) * 100).toFixed(1)}%`;
                stack.append(tx, rx);
                col.title = `${d.date} · ↓ ${G.formatBytes(d.rx)} · ↑ ${G.formatBytes(d.tx)}`;
                col.append(stack, el('span', 'glances-vol-label', d.date.slice(8)));
                bars.appendChild(col);
            });
            block.appendChild(bars);
            block.appendChild(this.note(this.t('dashboard.glancesInsVolumeNote',
                'Down {rx}, up {tx} in total. Fastest second today: down {prx}/s, up {ptx}/s; 95% of the time under {p95}/s.',
                { rx: G.formatBytes(n.totalRx), tx: G.formatBytes(n.totalTx), prx: G.formatBytes(n.peakRx), ptx: G.formatBytes(n.peakTx), p95: G.formatBytes(n.p95) })));
            return block;
        }

        availability(a) {
            const av = a.availability;
            if (!av) return null;
            const block = this.block('availability', 'dashboard.glancesInsAvailability', 'Availability');
            const figures = el('div', 'glances-ins-figures');
            [['dashboard.glancesInsAvail24h', '24 hours', av.day], ['dashboard.glancesInsAvail7d', '7 days', av.week], ['dashboard.glancesInsAvail30d', '30 days', av.month]]
                .forEach(([key, fallback, value]) => {
                    const cell = el('div', 'glances-ins-figure');
                    cell.append(el('span', 'glances-card-label', this.t(key, fallback)),
                        el('span', 'glances-card-value', value === null || value === undefined ? window.DashboardGlances.DASH : `${value}%`));
                    figures.appendChild(cell);
                });
            block.appendChild(figures);
            const line = el('div', 'glances-avail');
            line.setAttribute('data-glances-avail', '');
            (av.timeline || []).forEach((v, i) => {
                const cell = el('span', 'glances-avail-cell');
                cell.setAttribute('data-state', v < 0 ? 'unknown' : (v >= 0.99 ? 'up' : (v > 0 ? 'partial' : 'down')));
                const at = new Date(a.at - (96 - i) * 15 * 60000);
                cell.title = `${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${v < 0 ? window.DashboardGlances.DASH : `${Math.round(v * 100)}%`}`;
                line.appendChild(cell);
            });
            block.appendChild(line);
            block.appendChild(this.note(this.t('dashboard.glancesInsAvailNote', 'Each block is a quarter of an hour, the last 24 hours, oldest on the left.')));
            const outages = ((a.incidents && a.incidents.past) || []).filter((i) => i.kind === 'down' && i.end >= a.since);
            const ongoing = ((a.incidents && a.incidents.ongoing) || []).filter((i) => i.kind === 'down');
            if (outages.length || ongoing.length) {
                // Only the part inside the range counts, and an outage still going
                // on runs until now: left out, a host down for hours read "1 min".
                const now = a.at || Date.now();
                const spans = [...outages, ...ongoing].map((i) => Math.max(0, Math.min(i.end || now, now) - Math.max(i.start, a.since || 0)));
                const longest = Math.max(0, ...spans);
                const total = spans.reduce((sum, ms) => sum + ms, 0);
                const note = this.note(this.t('dashboard.glancesInsOutages', 'In this range the host was out {n} times, {total} in all; the longest lasted {longest}.',
                    { n: outages.length + ongoing.length, total: this.duration(total), longest: this.duration(longest) }));
                note.setAttribute('data-glances-outages', '');
                block.appendChild(note);
            } else {
                block.appendChild(this.note(this.t('dashboard.glancesInsNoOutages', 'The host did not go out of reach in this range.')));
            }
            return block;
        }

        incidents(a) {
            const ongoing = (a.incidents && a.incidents.ongoing) || [];
            const past = (a.incidents && a.incidents.past) || [];
            const block = this.block('incidents', 'dashboard.glancesInsIncidents', 'Incidents', true);
            if (!ongoing.length && !past.length) {
                block.appendChild(this.note(this.t('dashboard.glancesInsNoIncidents', 'No reading has gone past its red line.')));
                return block;
            }
            const rows = [...ongoing.map((i) => ({ ...i, live: true })), ...past];
            const inRange = rows.filter((r) => r.live || r.end >= a.since);
            if (inRange.length) {
                const counts = {};
                inRange.forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
                const parts = Object.entries(counts).sort((x, y) => y[1] - x[1])
                    .map(([kind, n]) => `${n} ${this.tl(KIND_LABELS[kind] || [`dashboard.glancesInsKind_${kind}`, kind]).toLowerCase()}`);
                const summary = this.note(this.t('dashboard.glancesInsIncidentSummary', '{n} in this range: {parts}.', { n: inRange.length, parts: parts.join(', ') }));
                summary.setAttribute('data-glances-incident-summary', '');
                block.appendChild(summary);
            }
            const label = (r) => `${this.tl(KIND_LABELS[r.kind] || [`dashboard.glancesInsKind_${r.kind}`, r.kind])}${r.subject ? ` · ${r.subject}` : ''}`;
            block.appendChild(this.table('ins-incidents', [
                { key: 'what', label: ['dashboard.glancesInsWhat', 'What'], value: (r) => label(r), cell: (r) => this.incidentLink(r, label(r)), numeric: false },
                { key: 'start', label: ['dashboard.glancesInsStart', 'Started'], value: (r) => r.start, cell: (r) => this.when(r.start) },
                { key: 'length', label: ['dashboard.glancesInsLength', 'Lasted'], value: (r) => (r.live ? Date.now() - r.start : r.end - r.start),
                    cell: (r) => (r.live ? this.t('dashboard.glancesInsOngoing', 'ongoing') : this.duration(r.end - r.start)) },
                { key: 'peak', label: ['dashboard.glancesInsPeak', 'Peak'], value: (r) => (r.kind === 'down' ? null : r.peak),
                    cell: (r) => (r.kind === 'down' || r.peak === undefined ? '–' : String(Math.round(r.peak))) },
            ], rows, { key: 'start', dir: 'desc' }));
            return block;
        }

        /** The incident's name as a button that opens it in the side panel. */
        incidentLink(r, text) {
            if (typeof this.view.detail?.openIncident !== 'function') return text;
            const button = el('button', 'glances-row-link', text);
            button.type = 'button';
            button.setAttribute('data-glances-incident-open', r.kind);
            const { live, ...incident } = r;
            button.addEventListener('click', () => this.view.detail.openIncident(incident));
            return button;
        }

        /** A container's name, with a ↗ to the Containers view when the two views are one machine. */
        consumerName(r) {
            if (r.kind !== 'container') return r.name;
            const Link = window.DashboardGlancesDetail?.link;
            if (Link && Link.stale()) void Link.load().then(() => this._redraw());
            const link = Link?.find({ name: r.name });
            if (!link) return r.name;
            const wrap = el('span', 'glances-consumer-name');
            const open = el('button', 'glances-ct-link', '↗');
            open.type = 'button';
            open.setAttribute('data-glances-consumer-link', link.container.name);
            const label = this.t('dashboard.glancesActOpenDocker', 'Open in Containers');
            open.title = `${label}: ${link.container.name}`;
            open.setAttribute('aria-label', open.title);
            open.addEventListener('click', () => { window.location.hash = `#docker/${encodeURIComponent(link.container.name)}`; });
            wrap.append(document.createTextNode(r.name), open);
            return wrap;
        }

        consumers(a) {
            const rows = a.consumers || [];
            const block = this.block('consumers', 'dashboard.glancesInsConsumers', 'Who used the most', true);
            if (!rows.length) {
                block.appendChild(this.note(this.t('dashboard.glancesInsNoConsumers',
                    'No process or container history is being recorded. Switch it on per item from its side panel (History tab): reading them costs the host some processor.')));
                return block;
            }
            const G = window.DashboardGlances;
            block.appendChild(this.table('ins-consumers', [
                { key: 'name', label: ['dashboard.glancesCtName', 'Name'], value: (r) => r.name, cell: (r) => this.consumerName(r), numeric: false },
                { key: 'kind', label: ['dashboard.glancesInsKind', 'Kind'], value: (r) => r.kind,
                    cell: (r) => (r.kind === 'container' ? this.t('dashboard.glancesInsContainer', 'Container') : this.t('dashboard.glancesInsProcess', 'Process')), numeric: false },
                { key: 'avgCpu', label: ['dashboard.glancesInsAvgCpu', 'CPU average'], value: (r) => r.avgCpu, cell: (r) => `${r.avgCpu}%` },
                { key: 'maxCpu', label: ['dashboard.glancesInsMaxCpu', 'CPU peak'], value: (r) => r.maxCpu, cell: (r) => `${r.maxCpu}%` },
                { key: 'avgMem', label: ['dashboard.glancesInsAvgMem', 'Memory average'], value: (r) => r.avgMem,
                    cell: (r) => (r.kind === 'container' ? G.formatBytes(r.avgMem) : `${r.avgMem}%`) },
                { key: 'share', label: ['dashboard.glancesInsShare', 'Share'], value: (r) => r.share, cell: (r) => `${r.share}%` },
            ], rows, { key: 'avgCpu', dir: 'desc' }));
            block.appendChild(this.note(this.t('dashboard.glancesInsConsumersNote', 'Of the processes and containers whose history is recorded, over this range.')));
            return block;
        }

        hour(h) {
            return `${String(h).padStart(2, '0')}:00`;
        }

        /** The range set against the one just before it. */
        compare(a) {
            const rows = a.compare || [];
            if (!rows.length) return null;
            const block = this.block('compare', 'dashboard.glancesInsCompare', 'Compared with before');
            const names = {
                cpu: ['dashboard.glancesInsFactorCpu', 'Processor', '%'],
                mem: ['dashboard.glancesInsFactorMem', 'Memory', '%'],
                net: ['dashboard.glancesInsHeatNet', 'Network', 'B/s'],
                disk: ['dashboard.glancesInsDiskActivity', 'Disk activity', 'B/s'],
                temp: ['dashboard.glancesInsFactorTemp', 'Hottest sensor', '°C'],
            };
            const list = rows.map((r) => ({ ...r, name: this.tl(names[r.key] || [`dashboard.glancesInsKind_${r.key}`, r.key]), unit: (names[r.key] || [])[2] || '%' }));
            block.appendChild(this.table('ins-compare', [
                { key: 'name', label: ['dashboard.glancesInsMetric', 'Reading'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                { key: 'now', label: ['dashboard.glancesInsNow', 'This range'], value: (r) => r.now, cell: (r) => this.fmtValue(r.unit, r.now) },
                { key: 'before', label: ['dashboard.glancesInsBefore', 'Before'], value: (r) => r.before, cell: (r) => this.fmtValue(r.unit, r.before) },
                { key: 'change', label: ['dashboard.glancesInsChange', 'Change'], value: (r) => r.change,
                    cell: (r) => (Math.abs(r.change) < 1 ? '≈ 0%' : `${r.change > 0 ? '▲' : '▼'} ${Math.abs(Math.round(r.change))}%`) },
            ], list, { key: 'name', dir: 'asc' }));
            block.appendChild(this.note(this.t('dashboard.glancesInsCompareNote', 'Averages over this range against the same length of time right before it.')));
            return block;
        }

        /** Readings far above what is usual, and the hours of the day that are busy. */
        spikes(a) {
            const spikes = a.spikes || [];
            const rhythm = a.rhythm || [];
            const block = this.block('spikes', 'dashboard.glancesInsSpikes', 'Peaks and rhythm', true);
            const names = {
                cpu: ['dashboard.glancesInsFactorCpu', 'Processor', '%'],
                mem: ['dashboard.glancesInsFactorMem', 'Memory', '%'],
                net: ['dashboard.glancesInsHeatNet', 'Network', 'B/s'],
            };
            rhythm.forEach((r) => {
                const name = this.tl(names[r.key] || [`dashboard.glancesInsKind_${r.key}`, r.key]);
                const unit = (names[r.key] || [])[2] || '%';
                const note = this.note(this.t('dashboard.glancesInsRhythm', '{name} is busiest around {busy} (average {busyAvg}) and quietest around {quiet} (average {quietAvg}).',
                    { name, busy: this.hour(r.busyHour), busyAvg: this.fmtValue(unit, r.busyAvg), quiet: this.hour(r.quietHour), quietAvg: this.fmtValue(unit, r.quietAvg) }));
                note.setAttribute('data-glances-rhythm', r.key);
                block.appendChild(note);
            });
            if (!spikes.length) {
                block.appendChild(this.note(this.t('dashboard.glancesInsNoSpikes', 'No reading stood far out above its usual level in this range.')));
                return block;
            }
            const list = spikes.map((s) => ({ ...s, name: this.tl(names[s.key] || [`dashboard.glancesInsKind_${s.key}`, s.key]), unit: (names[s.key] || [])[2] || '%' }));
            block.appendChild(this.table('ins-spikes', [
                { key: 'at', label: ['dashboard.glancesInsWhen', 'When'], value: (r) => r.at, cell: (r) => this.when(r.at) },
                { key: 'name', label: ['dashboard.glancesInsMetric', 'Reading'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                { key: 'value', label: ['dashboard.glancesInsSpikeValue', 'Reached'], value: (r) => r.value, cell: (r) => this.fmtValue(r.unit, r.value) },
                { key: 'typical', label: ['dashboard.glancesInsUsual', 'Usually'], value: (r) => r.typical, cell: (r) => this.fmtValue(r.unit, r.typical) },
                { key: 'culprit', label: ['dashboard.glancesInsBusiestThen', 'Busiest then'], value: (r) => r.culprit || '', numeric: false,
                    cell: (r) => (r.culprit ? `${r.culprit} · ${r.culpritCpu}%` : window.DashboardGlances.DASH) },
            ], list, { key: 'at', dir: 'desc' }));
            block.appendChild(this.note(this.t('dashboard.glancesInsSpikesNote',
                'Readings well above their usual level in this range. The busiest process or container is named when its history is recorded.')));
            return block;
        }

        /** Load against the number of cores, and how evenly the cores share the work. */
        load(a) {
            const l = a.load;
            const cores = a.cores || [];
            if (!l && !cores.length) return null;
            const block = this.block('load', 'dashboard.glancesInsLoad', 'Load and cores');
            if (l) {
                const figures = el('div', 'glances-ins-figures');
                [['dashboard.glancesInsLoad1', '1 minute', l.avg1], ['dashboard.glancesInsLoad5', '5 minutes', l.avg5], ['dashboard.glancesInsLoad15', '15 minutes', l.avg15]]
                    .forEach(([key, fallback, value]) => {
                        const cell = el('div', 'glances-ins-figure');
                        cell.append(el('span', 'glances-card-label', this.t(key, fallback)), el('span', 'glances-card-value', value ? value.toFixed(2) : window.DashboardGlances.DASH));
                        figures.appendChild(cell);
                    });
                block.appendChild(figures);
                if (l.cores > 0) {
                    const over = l.overShare > 0
                        ? this.t('dashboard.glancesInsLoadOver', 'The one-minute load was above the {cores} cores {share}% of the time; its peak was {peak}.', { cores: l.cores, share: l.overShare, peak: l.peak1.toFixed(2) })
                        : this.t('dashboard.glancesInsLoadFine', 'The one-minute load stayed within the {cores} cores; its peak was {peak}.', { cores: l.cores, peak: l.peak1.toFixed(2) });
                    const note = this.note(over);
                    note.setAttribute('data-glances-load-note', '');
                    block.appendChild(note);
                }
            }
            if (cores.length) {
                const list = el('div', 'glances-ins-cores');
                list.setAttribute('data-glances-cores', '');
                cores.forEach((c) => {
                    const row = el('div', 'glances-ins-core');
                    const bar = el('span', 'glances-ins-core-bar');
                    const fill = el('span', 'glances-ins-core-fill');
                    fill.style.width = `${Math.min(100, c.avg).toFixed(1)}%`;
                    const peak = el('span', 'glances-ins-core-peak');
                    peak.style.left = `${Math.min(100, c.max).toFixed(1)}%`;
                    bar.append(fill, peak);
                    row.append(el('span', 'glances-ins-core-name', String(c.core)), bar, el('span', 'glances-ins-core-value', `${Math.round(c.avg)}%`));
                    row.title = `${this.t('dashboard.glancesInsCore', 'Core')} ${c.core} · ${this.t('dashboard.glancesStatAvg', 'Average')} ${c.avg}% · ${this.t('dashboard.glancesStatMax', 'High')} ${c.max}%`;
                    list.appendChild(row);
                });
                block.appendChild(list);
                const sorted = [...cores].sort((x, y) => x.avg - y.avg);
                const low = sorted[0];
                const high = sorted[sorted.length - 1];
                block.appendChild(this.note(high.avg - low.avg >= 25
                    ? this.t('dashboard.glancesInsCoresUneven', 'The work is uneven: core {high} averages {highAvg}%, core {low} {lowAvg}%.', { high: high.core, highAvg: Math.round(high.avg), low: low.core, lowAvg: Math.round(low.avg) })
                    : this.t('dashboard.glancesInsCoresEven', 'The cores share the work evenly. The tick on each bar is that core\'s peak.')));
            }
            return block;
        }

        /** Where the memory goes, and how much of the time the swap was in use. */
        memory(a) {
            const m = a.memBreakdown;
            if (!m) return null;
            const block = this.block('memory', 'dashboard.glancesInsMemory', 'Memory and swap');
            const parts = [
                ['used', ['dashboard.glancesInsMemUsed', 'In use'], m.used],
                ['cache', ['dashboard.glancesInsMemCache', 'Cache'], m.cache],
                ['free', ['dashboard.glancesInsMemFree', 'Free'], m.free],
            ];
            const bar = el('div', 'glances-ins-stack');
            bar.setAttribute('data-glances-mem-stack', '');
            const legend = el('div', 'glances-ins-legend');
            parts.forEach(([key, label, value]) => {
                const seg = el('span', `glances-ins-seg glances-ins-seg--${key}`);
                seg.style.width = `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
                seg.title = `${this.tl(label)} · ${value}%`;
                bar.appendChild(seg);
                const item = el('span', 'glances-ins-legend-item');
                item.append(el('span', `glances-ins-swatch glances-ins-seg--${key}`), document.createTextNode(`${this.tl(label)} ${Math.round(value)}%`));
                legend.appendChild(item);
            });
            block.append(bar, legend);
            block.appendChild(this.note(m.swapHours > 0
                ? this.t('dashboard.glancesInsSwapUsed', 'Swap was more than 5% full for {hours} h in this range (average {avg}%).', { hours: m.swapHours, avg: m.swapAvg })
                : this.t('dashboard.glancesInsSwapIdle', 'Swap was hardly touched in this range (average {avg}%).', { avg: m.swapAvg })));
            const G = window.DashboardGlances;
            const users = [...(a.consumers || [])].filter((c) => c.avgMem > 0)
                .sort((x, y) => (y.kind === 'container' ? y.avgMem : 0) - (x.kind === 'container' ? x.avgMem : 0) || y.avgMem - x.avgMem).slice(0, 5);
            if (users.length) {
                block.appendChild(el('h4', 'glances-ins-sub', this.t('dashboard.glancesInsMemUsers', 'Using the most memory')));
                block.appendChild(this.table('ins-memusers', [
                    { key: 'name', label: ['dashboard.glancesCtName', 'Name'], value: (r) => r.name, cell: (r) => this.consumerName(r), numeric: false },
                    { key: 'avgMem', label: ['dashboard.glancesInsAvgMem', 'Memory average'], value: (r) => r.avgMem,
                        cell: (r) => (r.kind === 'container' ? G.formatBytes(r.avgMem) : `${r.avgMem}%`) },
                ], users, { key: 'avgMem', dir: 'desc' }));
            }
            block.appendChild(this.note(this.t('dashboard.glancesInsMemNote', 'Averages over this range. Cache is given back when a program asks for the memory.')));
            return block;
        }

        /** A typical day: each reading's average per hour of the day. */
        day(a) {
            const rows = a.profile || [];
            if (!rows.length) return null;
            const block = this.block('day', 'dashboard.glancesInsDay', 'A typical day', true);
            const names = {
                cpu: ['dashboard.glancesInsFactorCpu', 'Processor', '%'],
                mem: ['dashboard.glancesInsFactorMem', 'Memory', '%'],
                net: ['dashboard.glancesInsHeatNet', 'Network', 'B/s'],
                disk: ['dashboard.glancesInsDiskActivity', 'Disk activity', 'B/s'],
                temp: ['dashboard.glancesInsFactorTemp', 'Hottest sensor', '°C'],
            };
            const grid = el('div', 'glances-ins-day');
            grid.setAttribute('data-glances-day', '');
            const head = el('div', 'glances-ins-day-row glances-ins-day-head');
            head.appendChild(el('span', 'glances-ins-day-name'));
            const axis = el('span', 'glances-ins-day-bars');
            for (let i = 0; i < 24; i += 1) axis.appendChild(el('span', 'glances-ins-day-tick', i % 3 === 0 ? String(i) : ''));
            head.append(axis, el('span', 'glances-ins-day-peak'));
            grid.appendChild(head);
            rows.forEach((r) => {
                const [labelKey, fallback, unit] = names[r.key] || [`dashboard.glancesInsKind_${r.key}`, r.key, '%'];
                const row = el('div', 'glances-ins-day-row');
                row.setAttribute('data-glances-day-row', r.key);
                const bars = el('span', 'glances-ins-day-bars');
                r.hours.forEach((v, h) => {
                    const bar = el('span', 'glances-ins-day-bar');
                    if (v < 0) {
                        bar.classList.add('is-empty');
                        bar.title = `${this.hour(h)} · ${window.DashboardGlances.DASH}`;
                    } else {
                        bar.style.height = `${Math.max(6, r.max > 0 ? (v / r.max) * 100 : 6).toFixed(0)}%`;
                        bar.title = `${this.hour(h)} · ${this.fmtValue(unit, v)}`;
                    }
                    bars.appendChild(bar);
                });
                row.append(el('span', 'glances-ins-day-name', this.t(labelKey, fallback)), bars, el('span', 'glances-ins-day-peak', this.fmtValue(unit, r.max)));
                grid.appendChild(row);
            });
            block.appendChild(grid);
            block.appendChild(this.note(this.t('dashboard.glancesInsDayNote', 'The average for each hour of the day over this range, hours on the bottom. The figure on the right is the highest hour; each row has its own scale.')));
            return block;
        }

        /** Every temperature sensor over the range. */
        sensors(a) {
            const rows = a.sensors || [];
            if (!rows.length) return null;
            const block = this.block('sensors', 'dashboard.glancesInsSensors', 'Temperature per sensor');
            block.appendChild(this.table('ins-sensors', [
                { key: 'name', label: ['dashboard.glancesInsSensor', 'Sensor'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                { key: 'avg', label: ['dashboard.glancesStatAvg', 'Average'], value: (r) => r.avg, cell: (r) => window.DashboardGlances.formatTemp(r.avg) },
                { key: 'max', label: ['dashboard.glancesStatMax', 'High'], value: (r) => r.max, cell: (r) => window.DashboardGlances.formatTemp(r.max) },
                { key: 'warn', label: ['dashboard.glancesInsOverYellow', 'Over yellow'], value: (r) => r.hoursWarn,
                    cell: (r) => (r.hoursWarn > 0 ? this.t('dashboard.glancesInsHoursShort', '{n} h', { n: r.hoursWarn }) : window.DashboardGlances.DASH) },
            ], rows, { key: 'max', dir: 'desc' }));
            return block;
        }

        /** How full each file system is, and whether it moved over the range. */
        filesystems(a) {
            const rows = a.filesystems || [];
            if (!rows.length) return null;
            const block = this.block('filesystems', 'dashboard.glancesInsFilesystems', 'Disk space over time');
            block.appendChild(this.table('ins-filesystems', [
                { key: 'mount', label: ['dashboard.glancesDiskMount', 'Mount'], value: (r) => r.mount, cell: (r) => r.mount, numeric: false },
                { key: 'now', label: ['dashboard.glancesInsUsed', 'Used'], value: (r) => r.now, cell: (r) => `${r.now}%` },
                { key: 'change', label: ['dashboard.glancesInsChange', 'Change'], value: (r) => r.change,
                    cell: (r) => (Math.abs(r.change) < 0.1 ? '=' : `${r.change > 0 ? '▲' : '▼'} ${Math.abs(r.change)} pt`) },
                { key: 'range', label: ['dashboard.glancesInsLowHigh', 'Low – high'], value: (r) => r.max, cell: (r) => `${r.min}–${r.max}%` },
            ], rows, { key: 'now', dir: 'desc' }));
            block.appendChild(this.note(this.t('dashboard.glancesInsFilesystemsNote', 'The fullest disks nextDash records. Change is in percentage points over this range.')));
            return block;
        }

        /** Each disk's reading and writing over the range. */
        diskIo(a) {
            const rows = a.disks || [];
            if (!rows.length) return null;
            const G = window.DashboardGlances;
            const block = this.block('insdisk','dashboard.glancesInsDiskIo', 'Disk activity');
            block.appendChild(this.table('ins-diskio', [
                { key: 'name', label: ['dashboard.glancesDiskName', 'Disk'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                { key: 'avgRead', label: ['dashboard.glancesInsAvgRead', 'Read, average'], value: (r) => r.avgRead, cell: (r) => `${G.formatBytes(r.avgRead)}/s` },
                { key: 'avgWrite', label: ['dashboard.glancesInsAvgWrite', 'Write, average'], value: (r) => r.avgWrite, cell: (r) => `${G.formatBytes(r.avgWrite)}/s` },
                { key: 'peak', label: ['dashboard.glancesInsPeak', 'Peak'], value: (r) => Math.max(r.peakRead, r.peakWrite), cell: (r) => `${G.formatBytes(Math.max(r.peakRead, r.peakWrite))}/s` },
                { key: 'busy', label: ['dashboard.glancesInsBusyHour', 'Busiest hour'], value: (r) => r.busyHour, cell: (r) => (r.busyHour < 0 ? G.DASH : this.hour(r.busyHour)) },
            ], rows, { key: 'avgWrite', dir: 'desc' }));
            return block;
        }

        /** Traffic per network interface, and the containers behind it. */
        interfaces(a) {
            const rows = a.interfaces || [];
            const traffic = a.traffic || [];
            if (!rows.length && !traffic.length) return null;
            const G = window.DashboardGlances;
            const block = this.block('interfaces', 'dashboard.glancesInsInterfaces', 'Network per interface');
            if (rows.length) {
                block.appendChild(this.table('ins-interfaces', [
                    { key: 'name', label: ['dashboard.glancesInsInterface', 'Interface'], value: (r) => r.name, cell: (r) => r.name, numeric: false },
                    { key: 'rx', label: ['dashboard.glancesInsDown', 'Down'], value: (r) => r.totalRx, cell: (r) => G.formatBytes(r.totalRx) },
                    { key: 'tx', label: ['dashboard.glancesInsUp', 'Up'], value: (r) => r.totalTx, cell: (r) => G.formatBytes(r.totalTx) },
                    { key: 'peak', label: ['dashboard.glancesInsPeak', 'Peak'], value: (r) => Math.max(r.peakRx, r.peakTx), cell: (r) => `${G.formatBytes(Math.max(r.peakRx, r.peakTx))}/s` },
                ], rows, { key: 'rx', dir: 'desc' }));
            }
            if (traffic.length) {
                block.appendChild(el('h4', 'glances-ins-sub', this.t('dashboard.glancesInsTraffic', 'Containers with the most traffic')));
                block.appendChild(this.table('ins-traffic', [
                    { key: 'name', label: ['dashboard.glancesCtName', 'Name'], value: (r) => r.name, cell: (r) => this.consumerName({ name: r.name, kind: 'container' }), numeric: false },
                    { key: 'rx', label: ['dashboard.glancesInsDown', 'Down'], value: (r) => r.rx, cell: (r) => G.formatBytes(r.rx) },
                    { key: 'tx', label: ['dashboard.glancesInsUp', 'Up'], value: (r) => r.tx, cell: (r) => G.formatBytes(r.tx) },
                ], traffic, { key: 'rx', dir: 'desc' }));
            }
            block.appendChild(this.note(this.t('dashboard.glancesInsInterfacesNote', 'Totals over this range, from the recorded rates.')));
            return block;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'insights',
        label: 'Insights',
        labelKey: 'dashboard.glancesSectionInsights',
        order: 55,
        plugin: 'quicklook',
        Section: GlancesInsights,
    });
}());
