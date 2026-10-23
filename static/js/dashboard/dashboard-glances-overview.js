/**
 * Glances page, Overview: everything about the machine on one screen.
 *
 * Blocks, each one a card the reader can switch off in Config → Glances (a
 * block that is off is not even asked of Glances): the machine and its uptime;
 * processor, memory, swap and load as big numbers with the last hour behind
 * them; every core; the temperatures; the network; disk activity; the disks
 * and how full; their SMART health; the busiest processes; the containers; and
 * the open alerts.
 *
 * Unknown is not zero: a reading the host did not send is a dash, a block whose
 * plugin the host does not run is left out, and a series with a gap draws a gap.
 */
(function () {
    'use strict';

    const TOP = 10;
    const SERIES = ['cpu', 'mem', 'swap', 'load1'];
    const FIGURES_WINDOW_MS = 60 * 1000;

    const Tip = () => window.DashboardGlancesTip;

    const SPEC = {
        core: [
            [['dashboard.glancesTipUser', 'User'], 'user', 'pct'],
            [['dashboard.glancesTipSystem', 'System'], 'system', 'pct'],
            [['dashboard.glancesTipIowait', 'Waiting for disks'], 'iowait', 'pct'],
            [['dashboard.glancesTipSteal', 'Stolen'], 'steal', 'pct'],
            [['dashboard.glancesTipIrq', 'Interrupts'], 'irq', 'pct'],
            [['dashboard.glancesTipIdle', 'Idle'], 'idle', 'pct'],
        ],
        mount: [
            [['dashboard.glancesTipDevice', 'Device'], 'device_name', 'text'],
            [['dashboard.glancesTipFsType', 'Type'], 'fs_type', 'text'],
            [['dashboard.glancesTipSize', 'Size'], 'size', 'bytes'],
            [['dashboard.glancesTipUsed', 'Used'], 'used', 'bytes'],
            [['dashboard.glancesTipFree', 'Free'], 'free', 'bytes'],
            [['dashboard.glancesTipFull', 'Full'], 'percent', 'pct'],
        ],
        iface: [
            [['dashboard.glancesTipDown', 'Down'], 'bytes_recv_rate_per_sec', 'rate'],
            [['dashboard.glancesTipUp', 'Up'], 'bytes_sent_rate_per_sec', 'rate'],
            [['dashboard.glancesTipReceived', 'Received since start'], 'bytes_recv_gauge', 'bytes'],
            [['dashboard.glancesTipSent', 'Sent since start'], 'bytes_sent_gauge', 'bytes'],
            [['dashboard.glancesTipAlias', 'Alias'], 'alias', 'text'],
        ],
        disk: [
            [['dashboard.glancesTipRead', 'Read'], 'read_bytes_rate_per_sec', 'rate'],
            [['dashboard.glancesTipWrite', 'Write'], 'write_bytes_rate_per_sec', 'rate'],
            [['dashboard.glancesTipReadTotal', 'Read since start'], 'read_bytes_gauge', 'bytes'],
            [['dashboard.glancesTipWriteTotal', 'Written since start'], 'write_bytes_gauge', 'bytes'],
            [['dashboard.glancesTipReadOps', 'Read operations'], 'read_count_gauge', 'num'],
            [['dashboard.glancesTipWriteOps', 'Write operations'], 'write_count_gauge', 'num'],
        ],
        process: [
            [['dashboard.glancesTipPid', 'PID'], 'pid', 'text'],
            [['dashboard.glancesTipOwner', 'User'], 'username', 'text'],
            [['dashboard.glancesTipStatus', 'Status'], 'status', 'text'],
            [['dashboard.glancesTipThreads', 'Threads'], 'num_threads', 'num'],
            [['dashboard.glancesTipNice', 'Nice'], 'nice', 'num'],
            [['dashboard.glancesTipCpu', 'CPU'], 'cpu_percent', 'pct'],
            [['dashboard.glancesTipMemory', 'Memory'], 'memory_percent', 'pct'],
            [['dashboard.glancesTipResident', 'Resident'], 'memory_info.rss', 'bytes'],
            [['dashboard.glancesTipVirtual', 'Virtual'], 'memory_info.vms', 'bytes'],
            [['dashboard.glancesTipCpuTime', 'CPU time'], 'cpu_times.user', 'seconds'],
        ],
        container: [
            [['dashboard.glancesTipImage', 'Image'], 'image', 'list'],
            [['dashboard.glancesTipStatus', 'Status'], 'status', 'text'],
            [['dashboard.glancesTipUptime', 'Up'], 'uptime', 'text'],
            [['dashboard.glancesTipCreated', 'Created'], 'created', 'iso'],
            [['dashboard.glancesTipCpu', 'CPU'], 'cpu_percent', 'pct'],
            [['dashboard.glancesTipMemory', 'Memory'], 'memory_usage', 'bytes'],
            [['dashboard.glancesTipMemoryLimit', 'Memory limit'], 'memory_limit', 'bytes'],
            [['dashboard.glancesTipNetIn', 'Network in'], 'network.rx', 'rate'],
            [['dashboard.glancesTipNetOut', 'Network out'], 'network.tx', 'rate'],
            [['dashboard.glancesTipDiskRead', 'Disk read'], 'io.ior', 'rate'],
            [['dashboard.glancesTipDiskWrite', 'Disk write'], 'io.iow', 'rate'],
            [['dashboard.glancesTipEngine', 'Engine'], 'engine', 'text'],
        ],
        alert: [
            [['dashboard.glancesTipState', 'State'], 'state', 'text'],
            [['dashboard.glancesTipSince', 'Since'], 'begin', 'epoch'],
            [['dashboard.glancesTipMin', 'Lowest'], 'min', 'num'],
            [['dashboard.glancesTipAvg', 'Average'], 'avg', 'num'],
            [['dashboard.glancesTipMax', 'Highest'], 'max', 'num'],
            [['dashboard.glancesTipCount', 'Readings'], 'count', 'num'],
        ],
    };

    window.DashboardGlancesSpecs = SPEC;

    const { el } = window.DashboardGlancesDom;

    /** A sensor group: "Core 11" and "Core 0" are one "Core", the hottest of them. */
    function sensorGroup(label) {
        return String(label || '').replace(/\s*\d+$/, '').trim() || String(label || '');
    }

    class GlancesOverview {
        constructor(view) {
            this.view = view;
            this._history = null;
            this._groups = {};
            this._ghostPaths = {};
            this._coresPath = '';
            this._forecastPath = '';
        }

        /** Whether the host runs a plugin; unknown (no probe) counts as yes. */
        has(plugin) {
            const plugins = this.view.plugins;
            return !plugins || plugins.has(plugin);
        }

        shown(id) {
            return this.view.blockShown(id);
        }

        endpoints() {
            const list = new Set();
            // With several hosts, a strip of them above the blocks: from the record, so it costs the hosts nothing.
            if ((this.view.dash.glancesStatus?.hosts || []).length > 1) list.add('hosts');
            const need = (path, plugin) => { if (this.has(plugin || path)) list.add(path); };
            if (this.shown('system')) {
                need('system');
                need('uptime');
                need('quicklook');
            }
            if (this.shown('figures')) {
                need('quicklook');
                need('load');
                need('mem');
                need('memswap');
                // The last minute behind the four big numbers, at the refresh Config sets: no range to pick.
                this._history = `history?series=${SERIES.join(',')}&since=${Date.now() - FIGURES_WINDOW_MS}`;
                list.add(this._history);
            }
            // A graph under the network, the disks and the temperatures, each at its own range.
            const Chart = window.DashboardGlancesChart;
            this._groups = {};
            this._ghostPaths = {};
            ['network', 'diskio', 'disks', 'temps'].forEach((id) => {
                if (!this.shown(id)) return;
                const path = Chart.pathFor(Chart.group(id), this.view.seriesNames);
                if (path) {
                    this._groups[id] = path;
                    list.add(path);
                    const ghost = Chart.ghostPathFor(Chart.group(id), this.view.seriesNames);
                    if (ghost) {
                        this._ghostPaths[id] = ghost;
                        list.add(ghost);
                    }
                }
            });
            if (this.shown('cores')) {
                need('quicklook');
                // The last minute of every core, for the trace in its tile.
                const cores = (this.view.seriesNames || []).filter((n) => /^core:\d+$/.test(n))
                    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
                this._coresPath = cores.length ? `history?series=${cores.map(encodeURIComponent).join(',')}&since=${Date.now() - 60000}&cores=1` : '';
                if (this._coresPath) list.add(this._coresPath);
            }
            if (this.shown('temps')) need('sensors');
            if (this.shown('network')) need('network');
            if (this.shown('diskio')) need('diskio');
            if (this.shown('disks')) {
                need('fs');
                need('diskio');
                // When a disk will be full: what nextDash worked out from its record (cached half a minute).
                this._forecastPath = `insights?range=24h&heat=cpu&tz=${encodeURIComponent(window.DashboardGlancesDom.zone())}`;
                list.add(this._forecastPath);
            }
            if (this.shown('smart')) need('smart');
            if (this.shown('processes')) need('processlist?sort=cpu', 'processlist');
            if (this.shown('containers')) need('containers');
            if (this.shown('alerts')) need('alert');
            return [...list];
        }

        render(container, data) {
            this._lastDraw = { container, data };
            const grid = el('div', 'glances-blocks');
            const parts = [
                this.system(data), this.figures(data), this.cores(data), this.temps(data),
                this.network(data), this.diskio(data), this.disks(data), this.smart(data),
                this.processes(data), this.containers(data), this.alerts(data),
            ].filter(Boolean);
            if (!parts.length) {
                grid.appendChild(el('p', 'glances-note', this.view.t('dashboard.glancesOverviewEmpty', 'Nothing to show. Switch parts of the Overview on in Config → Glances.')));
            } else {
                grid.append(...parts);
            }
            const strip = this.hostStrip(data);
            window.DashboardGlancesTable.keepSortFocus(container, () => {
                window.DashboardGlancesChart.keepFocus(container, () => container.replaceChildren(...(strip ? [strip] : []), grid));
            });
        }

        /** The other hosts as chips: how each is and two figures; a click looks at that host. */
        hostStrip(data) {
            const G = window.DashboardGlances;
            const answer = G.usable(data.hosts);
            const rows = answer && Array.isArray(answer.hosts) ? answer.hosts : [];
            if (rows.length < 2) return null;
            const v = this.view;
            const here = v.dash.glancesStatus?.hostId;
            const strip = el('div', 'glances-host-strip');
            strip.setAttribute('data-glances-host-strip', '');
            strip.setAttribute('role', 'group');
            strip.setAttribute('aria-label', v.t('dashboard.glancesSectionHosts', 'Hosts'));
            rows.forEach((row) => {
                const chip = el('button', 'glances-host-chip');
                chip.type = 'button';
                chip.setAttribute('data-glances-host-chip', row.id);
                if (row.id === here) chip.setAttribute('aria-pressed', 'true');
                else chip.setAttribute('aria-pressed', 'false');
                const level = row.configured && !row.paused ? row.level : 'unknown';
                const dot = el('i', 'glances-hosts-dot');
                dot.setAttribute('data-level', level);
                dot.setAttribute('aria-hidden', 'true');
                chip.append(dot, el('span', 'glances-host-chip-name', row.name));
                const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? `${Math.round(x)}%` : null);
                let detail = '';
                if (!row.configured) detail = v.t('dashboard.glancesHostNoAddressShort', 'No address yet');
                else if (row.paused) detail = v.t('dashboard.glancesHostPaused', 'Connection off');
                else if (!row.ok && row.level === 'unknown' && row.at) detail = v.t('dashboard.glancesHostAwayNow', 'Not answering');
                else detail = [num(row.cpu), num(row.mem)].filter(Boolean).join(' · ');
                if (detail) chip.appendChild(el('span', 'glances-host-chip-detail', detail));
                chip.addEventListener('click', () => { if (row.id !== here) void v.switchHost(row.id, v.section); });
                strip.appendChild(chip);
            });
            return strip;
        }

        /** The card of one of the four big figures: its parts, from what the host sent. */
        cardTip(key, data) {
            const G = window.DashboardGlances;
            const v = this.view;
            const T = Tip();
            const quick = G.usable(data.quicklook) || {};
            const cores = Array.isArray(quick.percpu) ? quick.percpu : [];
            const mean = (field) => {
                const values = cores.map((c) => G.num(c?.[field])).filter((n) => n !== null);
                return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            };
            const pctText = (n) => (n === null ? '' : `${Math.round(n * 10) / 10}%`);
            const bytes = (n) => (G.num(n) === null ? '' : G.formatBytes(n));
            if (key === 'cpu') {
                return T.rows(v.t('dashboard.glancesCardCpu', 'CPU'), [
                    [v.t('dashboard.glancesTipModel', 'Model'), typeof quick.cpu_name === 'string' ? quick.cpu_name : ''],
                    [v.t('dashboard.glancesTipCores', 'Cores'), cores.length ? String(cores.length) : ''],
                    [v.t('dashboard.glancesTipSpeed', 'Speed'), G.num(quick.cpu_hz_current) === null ? '' : `${(quick.cpu_hz_current / 1e9).toFixed(2)} GHz`],
                    [v.t('dashboard.glancesTipUser', 'User'), pctText(mean('user'))],
                    [v.t('dashboard.glancesTipSystem', 'System'), pctText(mean('system'))],
                    [v.t('dashboard.glancesTipIowait', 'Waiting for disks'), pctText(mean('iowait'))],
                    [v.t('dashboard.glancesTipIdle', 'Idle'), pctText(mean('idle'))],
                ], v.t('dashboard.glancesTipAverage', 'Average over all cores.'));
            }
            if (key === 'ram' || key === 'swap') {
                const o = G.usable(data[key === 'ram' ? 'mem' : 'memswap']) || {};
                return T.rows(v.t(key === 'ram' ? 'dashboard.glancesCardRam' : 'dashboard.glancesCardSwap', key === 'ram' ? 'RAM' : 'Swap'), [
                    [v.t('dashboard.glancesTipTotal', 'Total'), bytes(o.total)],
                    [v.t('dashboard.glancesTipUsed', 'Used'), bytes(o.used)],
                    [v.t('dashboard.glancesTipFree', 'Free'), bytes(o.free)],
                    [v.t('dashboard.glancesTipAvailable', 'Available'), bytes(o.available)],
                    [v.t('dashboard.glancesTipCached', 'Cached'), bytes(o.cached)],
                    [v.t('dashboard.glancesTipBuffers', 'Buffers'), bytes(o.buffers)],
                ]);
            }
            const load = G.usable(data.load) || {};
            const num = (n) => (G.num(n) === null ? '' : G.num(n).toFixed(2));
            const cpus = G.num(load.cpucore) || cores.length || null;
            return T.rows(v.t('dashboard.glancesCardLoad', 'Load'), [
                [v.t('dashboard.glancesTipLoad1', '1 minute'), num(load.min1)],
                [v.t('dashboard.glancesTipLoad5', '5 minutes'), num(load.min5)],
                [v.t('dashboard.glancesTipLoad15', '15 minutes'), num(load.min15)],
                [v.t('dashboard.glancesTipLoadPerCore', 'Per core'), cpus && G.num(load.min1) !== null ? (load.min1 / cpus).toFixed(2) : ''],
            ], v.t('dashboard.glancesTipLoadNote', 'A load of 1 per core means every core is busy.'));
        }

        /** The graph under a block: that group's recorded series at its own range. */
        groupPanel(id, data) {
            const path = this._groups[id];
            if (!path) return null;
            const answer = window.DashboardGlances.usable(data[path]);
            if (!answer) return null;
            const Chart = window.DashboardGlancesChart;
            const ghost = this._ghostPaths[id] ? window.DashboardGlances.usable(data[this._ghostPaths[id]]) : null;
            return Chart.panel(this.view, Chart.group(id), answer, {
                height: 50,
                ghost,
                onRange: () => { void this.view.refresh({ force: true }); },
            });
        }

        /* ── small pieces ───────────────────────────────────────────────── */

        card(className, id, titleKey, titleFallback) {
            const section = el('section', `glances-ov-block ${className}`);
            section.setAttribute('data-glances-block', id);
            const title = el('h3', 'glances-block-title', this.view.t(titleKey, titleFallback));
            const info = window.DashboardGlancesInfo?.button(this.view, id);
            if (info) title.appendChild(info);
            section.appendChild(title);
            return section;
        }

        bar(pct, tone) {
            const track = el('div', 'glances-disk-bar');
            if (tone) track.setAttribute('data-tone', tone);
            const fill = el('div', 'glances-disk-fill');
            fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
            track.appendChild(fill);
            return track;
        }

        pct(value) {
            return value === null ? window.DashboardGlances.DASH : `${Math.round(value)}%`;
        }

        rate(value) {
            const G = window.DashboardGlances;
            const n = G.num(value);
            return n === null ? G.DASH : `${G.formatBytes(n)}/s`;
        }

        /** 10485760000 is a 10 Gbit link: Glances counts Mbit/s times 1,048,576. */
        linkSpeed(speed) {
            const G = window.DashboardGlances;
            const n = G.num(speed);
            if (n === null || n <= 0) return G.DASH;
            const mbit = n / 1048576;
            if (mbit >= 1000) return `${Number((mbit / 1000).toFixed(1))} Gbit/s`;
            return `${Math.round(mbit)} Mbit/s`;
        }

        /* ── the blocks ─────────────────────────────────────────────────── */

        system(data) {
            if (!this.shown('system')) return null;
            const G = window.DashboardGlances;
            const sys = G.usable(data.system) || {};
            const quick = G.usable(data.quicklook) || {};
            const up = typeof data.uptime === 'string' ? data.uptime : '';
            const block = this.card('glances-ov-block--wide', 'system', 'dashboard.glancesBlockSystem', 'Machine');
            const host = el('p', 'glances-ov-host', String(sys.hostname || G.DASH));
            const os = el('p', 'glances-note', String(sys.hr_name || sys.os_name || ''));
            const pairs = el('dl', 'glances-pairs');
            const pair = (label, value) => {
                const wrap = el('div', 'glances-pair');
                wrap.append(el('dt', '', label), el('dd', '', value));
                pairs.appendChild(wrap);
            };
            pair(this.view.t('dashboard.glancesUptime', 'Up'), up || G.DASH);
            const cores = Array.isArray(quick.percpu) ? quick.percpu.length : null;
            if (typeof quick.cpu_name === 'string' && quick.cpu_name) {
                pair(this.view.t('dashboard.glancesProcessor', 'Processor'),
                    cores ? `${quick.cpu_name} · ${cores}` : quick.cpu_name);
            }
            block.append(host, os, pairs);
            return block;
        }

        figures(data) {
            if (!this.shown('figures')) return null;
            const G = window.DashboardGlances;
            const v = this.view;
            const quick = G.usable(data.quicklook) || {};
            const load = G.usable(data.load) || {};
            const mem = G.usable(data.mem) || {};
            const swap = G.usable(data.memswap) || {};
            const hist = G.usable(data[this._history]) || {};
            const series = hist.series || {};
            const cpu = G.num(quick.cpu);
            const ram = G.num(quick.mem);
            const sw = G.num(quick.swap);
            const min1 = G.num(load.min1);
            const cores = G.num(load.cpucore) || (Array.isArray(quick.percpu) ? quick.percpu.length : null);
            const used = (o) => (G.num(o.used) !== null && G.num(o.total) !== null
                ? `${G.formatBytes(o.used)} / ${G.formatBytes(o.total)}` : '');
            const cards = [
                { key: 'cpu', label: v.t('dashboard.glancesCardCpu', 'CPU'), value: this.pct(cpu), tone: G.tone(cpu, 'cpu'),
                    sub: typeof quick.cpu_name === 'string' ? '' : '', points: series.cpu, max: 100 },
                { key: 'ram', label: v.t('dashboard.glancesCardRam', 'RAM'), value: this.pct(ram), tone: G.tone(ram, 'mem'),
                    sub: used(mem), points: series.mem, max: 100 },
                { key: 'swap', label: v.t('dashboard.glancesCardSwap', 'Swap'), value: this.pct(sw), tone: G.tone(sw, 'swap'),
                    sub: used(swap), points: series.swap, max: 100 },
                { key: 'load', label: v.t('dashboard.glancesCardLoad', 'Load'), value: min1 === null ? G.DASH : min1.toFixed(2),
                    tone: min1 !== null && cores ? G.tone((min1 / cores) * 100, 'cpu') : '',
                    sub: [load.min1, load.min5, load.min15].map((n) => (G.num(n) === null ? G.DASH : G.num(n).toFixed(2))).join(' · '),
                    points: series.load1, max: null },
            ];
            const block = this.card('glances-ov-block--wide', 'figures', 'dashboard.glancesBlockFigures', 'Right now');
            const row = el('div', 'glances-cards');
            const Chart = window.DashboardGlancesChart;
            let spanText = '';
            cards.forEach((c) => {
                const card = el('div', 'glances-card');
                card.setAttribute('data-glances-card', c.key);
                v.tip(card, `card:${c.key}`, () => this.cardTip(c.key, data));
                if (c.tone) card.setAttribute('data-tone', c.tone);
                card.append(el('span', 'glances-card-label', c.label), el('span', 'glances-card-value', c.value));
                if (c.sub) card.appendChild(el('span', 'glances-card-sub', c.sub));
                const chart = Chart?.draw({ series: [{ name: c.key, points: c.points }], max: c.max, height: 40 });
                if (chart) {
                    const wrap = el('div', 'glances-spark');
                    wrap.appendChild(chart.svg);
                    card.appendChild(wrap);
                    spanText = Chart.spanLabel(chart.from, chart.to, (k, f, p) => v.t(k, f, p));
                }
                row.appendChild(card);
            });
            block.appendChild(row);
            if (spanText) block.appendChild(el('p', 'glances-note glances-ov-span', spanText));
            return block;
        }

        cores(data) {
            if (!this.shown('cores')) return null;
            const G = window.DashboardGlances;
            const cpus = G.usable(data.quicklook)?.percpu;
            if (!Array.isArray(cpus) || !cpus.length) return null;
            const Chart = window.DashboardGlancesChart;
            const history = this._coresPath ? G.usable(data[this._coresPath]) : null;
            const block = this.card('glances-ov-block--wide', 'cores', 'dashboard.glancesBlockCores', 'Processor per core');
            const grid = el('div', 'glances-cores');
            cpus.forEach((c, i) => {
                const number = G.num(c?.cpu_number) ?? i;
                const value = G.num(c?.total);
                const cell = el('div', 'glances-core');
                cell.setAttribute('data-glances-core', String(i));
                const tone = G.tone(value, 'cpu');
                if (tone) cell.setAttribute('data-tone', tone);
                this.view.tip(cell, `core:${i}`, () => Tip().describe(this.view, `${this.view.t('dashboard.glancesTipCore', 'Core')} ${number}`, c, SPEC.core));
                const head = el('div', 'glances-core-head');
                head.append(
                    el('span', 'glances-core-name', `${this.view.t('dashboard.glancesCoreWord', 'core')} ${number}`),
                    el('span', 'glances-core-value', this.pct(value)),
                );
                cell.appendChild(head);
                // The last minute as a line; a core with no record yet has the bar of its load now.
                const trace = history && history.series ? Chart.draw({ series: [{ name: `core:${number}`, points: history.series[`core:${number}`] }], max: 100, height: 28, area: false }) : null;
                if (trace) {
                    const wrap = el('div', 'glances-core-trace');
                    wrap.appendChild(trace.svg);
                    cell.appendChild(wrap);
                } else {
                    cell.appendChild(this.bar(value ?? 0, tone));
                }
                grid.appendChild(cell);
            });
            block.appendChild(grid);
            block.appendChild(el('p', 'glances-note glances-core-note', this.view.t('dashboard.glancesCoresNote', 'Each tile: the load now and the last minute.')));
            return block;
        }

        temps(data) {
            if (!this.shown('temps')) return null;
            const G = window.DashboardGlances;
            const sensors = G.usable(data.sensors);
            if (!Array.isArray(sensors)) return null;
            const groups = new Map();
            sensors.forEach((s) => {
                if (!String(s?.type || '').startsWith('temperature')) return;
                const value = G.num(s.value);
                if (value === null) return;
                const name = sensorGroup(s.label);
                const warn = G.num(s.warning);
                const crit = G.num(s.critical);
                // 65261 is Glances' "no limit"; only a plausible limit counts.
                const own = (limit) => (limit !== null && limit > 0 && limit <= 150 ? limit : null);
                let tone;
                if (own(crit) !== null && value >= own(crit)) tone = 'bad';
                else if (own(warn) !== null && value >= own(warn)) tone = 'warn';
                else if (own(warn) !== null || own(crit) !== null) tone = '';
                else tone = G.tone(value, 'temp');
                const group = groups.get(name) || { name, value, count: 0, tone: '', sensors: [] };
                group.sensors.push({ label: String(s.label || ''), value, warn: own(warn), crit: own(crit) });
                group.count += 1;
                if (value > group.value) group.value = value;
                const rank = { '': 0, warn: 1, bad: 2 };
                if (rank[tone] > rank[group.tone]) group.tone = tone;
                groups.set(name, group);
            });
            if (!groups.size) return null;
            const block = this.card('', 'temps', 'dashboard.glancesBlockTemps', 'Temperatures');
            const list = el('ul', 'glances-temps');
            [...groups.values()].sort((a, b) => b.value - a.value).slice(0, 14).forEach((g) => {
                const li = el('li', 'glances-temp');
                if (g.tone) li.setAttribute('data-tone', g.tone);
                this.view.tip(li, `temp:${g.name}`, () => Tip().rows(g.name, g.sensors.slice().sort((a, b) => b.value - a.value).map((sn) => [
                    sn.label,
                    `${Math.round(sn.value)}°${sn.warn !== null || sn.crit !== null ? ` (${sn.warn !== null ? Math.round(sn.warn) : '–'} / ${sn.crit !== null ? Math.round(sn.crit) : '–'})` : ''}`,
                ]), this.view.t('dashboard.glancesTipTempNote', 'The limits the sensor reports, warning / critical, are in brackets.')));
                li.append(
                    el('span', 'glances-temp-name', g.count > 1 ? `${g.name} ×${g.count}` : g.name),
                    el('span', 'glances-temp-value', `${Math.round(g.value)}°`),
                );
                list.appendChild(li);
            });
            block.appendChild(list);
            const graph = this.groupPanel('temps', data);
            if (graph) block.appendChild(graph);
            return block;
        }

        /** A sortable table whose redraw uses the data of the last beat. */
        table(id, columns, rows, { rowHook, initial } = {}) {
            return window.DashboardGlancesTable.build({
                id, columns, rows, t: (k, f, p) => this.view.t(k, f, p), initial, rowHook,
                rerender: () => {
                    const last = this._lastDraw;
                    if (last) this.render(last.container, last.data);
                },
            });
        }

        network(data) {
            if (!this.shown('network')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.network);
            if (!Array.isArray(rows)) return null;
            const virtual = (name) => name === 'lo' || name === 'tunl0' || /^(docker|veth|br-|virbr|vnet)/.test(name);
            const real = rows.filter((n) => n && !virtual(String(n.interface_name || '')) && n.is_up !== false);
            if (!real.length) return null;
            const block = this.card('', 'network', 'dashboard.glancesBlockNetwork', 'Network');
            block.appendChild(this.table('overview-network', [
                { key: 'name', label: ['dashboard.glancesNetInterface', 'Interface'], numeric: false, value: (n) => String(n.interface_name) },
                { key: 'down', label: ['dashboard.glancesNetDown', 'Down'], value: (n) => G.num(n.bytes_recv_rate_per_sec), cell: (n) => this.rate(n.bytes_recv_rate_per_sec) },
                { key: 'up', label: ['dashboard.glancesNetUp', 'Up'], value: (n) => G.num(n.bytes_sent_rate_per_sec), cell: (n) => this.rate(n.bytes_sent_rate_per_sec) },
                { key: 'speed', label: ['dashboard.glancesNetSpeed', 'Link'], value: (n) => G.num(n.speed), cell: (n) => this.linkSpeed(n.speed) },
            ], real, {
                initial: { key: 'down', dir: 'desc' },
                rowHook: (tr, n) => {
                    tr.setAttribute('data-glances-iface', String(n.interface_name));
                    this.view.tip(tr, `iface:${n.interface_name}`, () => Tip().describe(this.view, String(n.interface_name), n, SPEC.iface,
                        this.linkSpeed(n.speed) === G.DASH ? '' : `${this.view.t('dashboard.glancesNetSpeed', 'Link')}: ${this.linkSpeed(n.speed)}`));
                },
            }));
            const graph = this.groupPanel('network', data);
            if (graph) block.appendChild(graph);
            return block;
        }

        diskio(data) {
            if (!this.shown('diskio')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.diskio);
            if (!Array.isArray(rows) || !rows.length) return null;
            const disks = rows
                .map((d) => ({ name: String(d?.disk_name || ''), read: G.num(d?.read_bytes_rate_per_sec), write: G.num(d?.write_bytes_rate_per_sec), raw: d }))
                .filter((d) => d.name)
                .sort((a, b) => ((b.read || 0) + (b.write || 0)) - ((a.read || 0) + (a.write || 0)))
                .slice(0, 10);
            if (!disks.length) return null;
            const block = this.card('', 'diskio', 'dashboard.glancesBlockDiskio', 'Disk activity');
            block.appendChild(this.table('overview-diskio', [
                { key: 'name', label: ['dashboard.glancesDiskDevice', 'Disk'], numeric: false, value: (d) => d.name },
                { key: 'read', label: ['dashboard.glancesDiskRead', 'Read'], value: (d) => d.read, cell: (d) => this.rate(d.read) },
                { key: 'write', label: ['dashboard.glancesDiskWrite', 'Write'], value: (d) => d.write, cell: (d) => this.rate(d.write) },
            ], disks, {
                rowHook: (tr, d) => this.view.tip(tr, `disk:${d.name}`, () => Tip().describe(this.view, d.name, d.raw, SPEC.disk)),
            }));
            const graph = this.groupPanel('diskio', data);
            if (graph) block.appendChild(graph);
            return block;
        }

        /** Which part of the machine a mount belongs to: the array, a pool or the cache, or the system. */
        diskRole(mount) {
            if (/^\/mnt\/disks?\d+$/.test(mount)) return 'array';
            if (/^\/mnt\//.test(mount)) return 'pool';
            return 'system';
        }

        disks(data) {
            if (!this.shown('disks')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.fs);
            if (!Array.isArray(rows) || !rows.length) return null;
            const io = new Map();
            (Array.isArray(G.usable(data.diskio)) ? G.usable(data.diskio) : []).forEach((d) => {
                io.set(String(d?.disk_name || ''), d);
            });
            const answer = this._forecastPath ? G.usable(data[this._forecastPath]) : null;
            const outlook = new Map((answer && Array.isArray(answer.forecast) ? answer.forecast : []).map((f) => [f.mount, f]));
            const list = rows
                .map((r) => ({ name: String(r?.mnt_point || ''), pct: G.num(r?.percent), used: r?.used, size: r?.size, free: r?.free, raw: r }))
                .filter((r) => r.name && r.pct !== null)
                .slice(0, 24);
            if (!list.length) return null;
            const block = this.card('', 'disks', 'dashboard.glancesBlockDisks', 'Disks');
            const ROLES = [
                ['array', 'dashboard.glancesDiskArray', 'Array'],
                ['pool', 'dashboard.glancesDiskPools', 'Cache and pools'],
                ['system', 'dashboard.glancesDiskSystem', 'System'],
            ];
            ROLES.forEach(([role, key, fallback]) => {
                const members = list.filter((r) => this.diskRole(r.name) === role)
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                if (!members.length) return;
                const group = el('div', 'glances-disk-group');
                group.setAttribute('data-glances-disk-group', role);
                group.appendChild(el('p', 'glances-disk-group-title', this.view.t(key, fallback)));
                members.forEach((r) => group.appendChild(this.diskRow(r, io, outlook)));
                block.appendChild(group);
            });
            const graph = this.groupPanel('disks', data);
            if (graph) block.appendChild(graph);
            return block;
        }

        diskRow(r, io, outlook) {
            const G = window.DashboardGlances;
            const row = el('div', 'glances-disk');
            row.setAttribute('data-glances-mount', r.name);
            this.view.tip(row, `mount:${r.name}`, () => Tip().describe(this.view, r.name, r.raw, SPEC.mount));
            const head = el('div', 'glances-disk-head');
            const sizes = G.num(r.used) !== null && G.num(r.size) !== null
                ? `${G.formatBytes(r.used)} / ${G.formatBytes(r.size)}` : '';
            const value = el('span', 'glances-disk-value');
            value.append(el('span', 'glances-disk-sizes-inline', sizes), document.createTextNode(` ${this.pct(r.pct)}`));
            head.append(el('span', 'glances-disk-mount', r.name), value);
            row.append(head, this.bar(r.pct, G.tone(r.pct, 'disk')));
            const foot = el('div', 'glances-disk-foot');
            const free = G.num(r.free) ?? (G.num(r.size) !== null && G.num(r.used) !== null ? G.num(r.size) - G.num(r.used) : null);
            foot.appendChild(el('span', 'glances-disk-free', free === null ? '' : this.view.t('dashboard.glancesDiskFree', '{size} free', { size: G.formatBytes(free) })));
            const pills = el('span', 'glances-disk-pills');
            // When it is full, from what nextDash recorded: a date worth knowing, or "steady".
            const f = outlook.get(r.name);
            if (f) {
                const near = f.daysToFull != null && f.daysToFull <= 90;
                const pill = el('span', 'glances-pill', near
                    ? this.view.t('dashboard.glancesDiskFullIn', 'full in {n} days', { n: f.daysToFull })
                    : (f.slopePerDay > 0.05
                        ? this.view.t('dashboard.glancesDiskGrowing', '+{n}% a day', { n: f.slopePerDay })
                        : this.view.t('dashboard.glancesDiskSteady', 'steady')));
                pill.setAttribute('data-glances-forecast', near ? (f.daysToFull <= 14 ? 'bad' : 'warn') : 'ok');
                if (near) pill.setAttribute('data-tone', f.daysToFull <= 14 ? 'bad' : 'warn');
                pills.appendChild(pill);
            }
            // What the device under it is doing now.
            const device = String(r.raw?.device_name || '').split('/').pop();
            const d = io.get(device);
            if (d) {
                const read = G.num(d.read_bytes_rate_per_sec) || 0;
                const write = G.num(d.write_bytes_rate_per_sec) || 0;
                const busy = read + write >= 1024;
                const pill = el('span', 'glances-pill', busy
                    ? [read >= 1024 ? `${this.view.t('dashboard.glancesTipRead', 'Read')} ${this.rate(read)}` : '', write >= 1024 ? `${this.view.t('dashboard.glancesTipWrite', 'Write')} ${this.rate(write)}` : ''].filter(Boolean).join(' · ')
                    : this.view.t('dashboard.glancesDiskIdle', 'idle'));
                pill.setAttribute('data-glances-activity', busy ? 'busy' : 'idle');
                pills.appendChild(pill);
            }
            foot.appendChild(pills);
            row.appendChild(foot);
            return row;
        }

        /** A row that opens the side panel: a click, or Enter on the row. */
        clickable(tr, kind, row) {
            tr.classList.add('glances-row-link');
            tr.tabIndex = 0;
            tr.setAttribute('role', 'button');
            const open = () => this.view.detail?.open?.(kind, row);
            tr.addEventListener('click', open);
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
            });
        }

        smart(data) {
            if (!this.shown('smart')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.smart);
            if (!Array.isArray(rows) || !rows.length) return null;
            const block = this.card('', 'smart', 'dashboard.glancesBlockSmart', 'Disk health');
            const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');
            const drives = rows.slice(0, 12).map((d) => ({
                name: text(d?.DeviceName) || text(d?.name) || text(d?.device_name) || text(d?.device) || G.DASH,
                model: text(d?.ModelNumber) || text(d?.model) || text(d?.model_name),
                state: text(d?.smart_status) || text(d?.status) || text(d?.health),
            }));
            block.appendChild(this.table('overview-smart', [
                { key: 'name', label: ['dashboard.glancesSmartDrive', 'Drive'], numeric: false, value: (d) => d.name },
                { key: 'model', label: ['dashboard.glancesSmartModel', 'Model'], numeric: false, value: (d) => d.model },
                { key: 'state', label: ['dashboard.glancesSmartState', 'Health'], numeric: false, value: (d) => d.state },
            ], drives));
            return block;
        }

        processes(data) {
            if (!this.shown('processes')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data['processlist?sort=cpu']);
            if (!Array.isArray(rows) || !rows.length) return null;
            this.view.detail?.update('process', rows);
            const block = this.card('', 'processes', 'dashboard.glancesBlockProcesses', 'Busiest processes');
            block.appendChild(this.table('overview-processes', [
                { key: 'name', label: ['dashboard.glancesProcName', 'Process'], numeric: false, value: (p) => String(p?.name ?? '') },
                { key: 'cpu', label: ['dashboard.glancesProcCpu', 'CPU'], value: (p) => G.num(p?.cpu_percent),
                    cell: (p) => (G.num(p?.cpu_percent) === null ? G.DASH : `${G.num(p.cpu_percent).toFixed(1)}%`) },
                { key: 'mem', label: ['dashboard.glancesProcMem', 'Memory'], value: (p) => G.num(p?.memory_percent),
                    cell: (p) => (G.num(p?.memory_percent) === null ? G.DASH : `${G.num(p.memory_percent).toFixed(1)}%`) },
            ], rows.slice(0, TOP), {
                initial: { key: 'cpu', dir: 'desc' },
                rowHook: (tr, p) => {
                    tr.setAttribute('data-glances-process', String(p?.pid));
                    this.view.tip(tr, `proc:${p?.pid}`, () => Tip().describe(this.view, String(p?.name ?? ''), p, SPEC.process));
                    this.clickable(tr, 'process', p);
                },
            }));
            return block;
        }

        containers(data) {
            if (!this.shown('containers')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.containers);
            if (!Array.isArray(rows) || !rows.length) return null;
            this.view.detail?.update('container', rows);
            const running = rows.filter((c) => /^(running|healthy|unhealthy|starting)$/i.test(String(c?.status || ''))).length;
            const block = this.card('', 'containers', 'dashboard.glancesBlockContainers', 'Containers');
            block.appendChild(el('p', 'glances-note', this.view.t('dashboard.glancesContainersRunning', '{running} of {total} running', { running, total: rows.length })));
            const top = rows.slice().sort((a, b) => (G.num(b?.cpu_percent) || 0) - (G.num(a?.cpu_percent) || 0)).slice(0, TOP);
            block.appendChild(this.table('overview-containers', [
                { key: 'name', label: ['dashboard.glancesCtName', 'Container'], numeric: false, value: (c) => String(c?.name ?? '') },
                { key: 'cpu', label: ['dashboard.glancesProcCpu', 'CPU'], value: (c) => G.num(c?.cpu_percent),
                    cell: (c) => (G.num(c?.cpu_percent) === null ? G.DASH : `${G.num(c.cpu_percent).toFixed(1)}%`) },
                { key: 'mem', label: ['dashboard.glancesProcMem', 'Memory'], value: (c) => G.num(c?.memory_usage),
                    cell: (c) => G.formatBytes(c?.memory_usage) },
            ], top, {
                initial: { key: 'cpu', dir: 'desc' },
                rowHook: (tr, c) => {
                    tr.setAttribute('data-glances-container', String(c?.name ?? ''));
                    tr.setAttribute('data-state', /^(running|healthy|unhealthy|starting)$/i.test(String(c?.status || '')) ? 'running' : 'stopped');
                    this.view.tip(tr, `ct:${c?.name}`, () => Tip().describe(this.view, String(c?.name ?? ''), c, SPEC.container));
                    this.clickable(tr, 'container', c);
                },
            }));
            return block;
        }

        alerts(data) {
            if (!this.shown('alerts')) return null;
            const G = window.DashboardGlances;
            const rows = G.usable(data.alert);
            if (!Array.isArray(rows)) return null;
            const ongoing = rows.filter((a) => G.num(a?.end) !== null && G.num(a.end) < 0);
            const block = this.card('', 'alerts', 'dashboard.glancesBlockAlerts', 'Alerts');
            if (!ongoing.length) {
                block.appendChild(el('p', 'glances-note', this.view.t('dashboard.glancesAlertsNone', 'No alerts.')));
                return block;
            }
            const list = el('ul', 'glances-alerts');
            ongoing.slice(0, 8).forEach((a) => {
                const li = el('li', 'glances-alert');
                this.view.tip(li, `alert:${a.type}:${a.begin}`, () => Tip().describe(this.view, String(a.type || ''), a, SPEC.alert, String(a.global_msg || '')));
                li.setAttribute('data-tone', String(a.state || '').toUpperCase() === 'CRITICAL' ? 'bad' : 'warn');
                li.append(el('strong', '', String(a.type || '')), el('span', '', ` ${String(a.global_msg || a.state || '')}`));
                list.appendChild(li);
            });
            block.appendChild(list);
            return block;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'overview',
        label: 'Overview',
        labelKey: 'dashboard.glancesSectionOverview',
        order: 10,
        plugin: 'quicklook',
        Section: GlancesOverview,
        /** The dot: cpu or ram at a line, or a temperature past its own. */
        badge(feed) {
            const G = window.DashboardGlances;
            const quick = G.usable(feed.quicklook) || {};
            const cpu = G.tone(G.num(quick.cpu), 'cpu');
            const mem = G.tone(G.num(quick.mem), 'mem');
            const tone = [cpu, mem].includes('bad') ? 'bad' : ([cpu, mem].includes('warn') ? 'warn' : '');
            return { warn: Boolean(tone), tone };
        },
    });
}());
