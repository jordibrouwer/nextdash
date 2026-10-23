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
            if (unit === '°C') return `${Math.round(v)}°`;
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
                this.health(answer), this.statsBlock(answer), this.heatmap(answer), this.volume(answer),
                this.availability(answer), this.incidents(answer), this.consumers(answer),
            ].filter(Boolean);
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
                        el('span', 'glances-ins-factor-value', `${f.value}${f.key === 'temp' ? '°' : '%'} · −${f.penalty}`));
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
                    { max: t.max, avg: t.avg, warn: t.hoursWarn, bad: t.hoursBad })));
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
