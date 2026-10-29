/**
 * Glances view, Hosts: every host in one table, from what nextDash recorded.
 *
 * One row per host: how it is (the dot), the last processor, memory and
 * fullest-disk readings, the hottest temperature and when it was last read. A
 * click on a row opens that host. Nothing is asked of the hosts for this: the
 * rows come from the record, so the section works with a connection off and
 * costs the hosts nothing. It is in the menu only when there is more than one
 * host.
 */
(function () {
    'use strict';

    const { el } = window.DashboardGlancesDom;

    /** A meter: the value as a bar and as a number, yellow and red from the page's lines. */
    function meter(value, kind) {
        const G = window.DashboardGlances;
        if (typeof value !== 'number' || !Number.isFinite(value)) return G.DASH;
        const cell = document.createDocumentFragment();
        const tone = G.tone(value, kind) || 'ok';
        const bar = el('span', 'glances-hosts-bar');
        bar.setAttribute('aria-hidden', 'true');
        const fill = el('i');
        fill.setAttribute('data-tone', tone);
        fill.style.width = `${Math.max(2, Math.min(100, value))}%`;
        bar.appendChild(fill);
        cell.append(bar, el('span', 'glances-hosts-num', `${Math.round(value)}%`));
        return cell;
    }

    /** The processor's last hour as a line beside its meter: is it busy now, or always? */
    function cpuCell(row) {
        const cell = el('span', 'glances-hosts-cpu');
        const now = meter(row.cpu, 'cpu');
        if (typeof now === 'string') return now;
        cell.appendChild(now);
        const chart = window.DashboardGlancesChart?.draw?.({ series: [{ name: 'cpu', points: row.cpuHour }], max: 100, height: 20 });
        if (chart) {
            const spark = el('span', 'glances-hosts-spark');
            spark.setAttribute('data-glances-host-spark', row.id);
            spark.appendChild(chart.svg);
            cell.appendChild(spark);
        }
        return cell;
    }

    /** The fullest disk, and which one it is: 94% alone does not say whether that is / or the array. */
    function diskCell(row) {
        const now = meter(row.disk, 'disk');
        if (typeof now === 'string') return now;
        const cell = el('span', 'glances-hosts-disk');
        cell.appendChild(now);
        if (row.diskMount) {
            const mount = el('span', 'glances-hosts-mount', row.diskMount);
            mount.setAttribute('data-glances-host-mount', '');
            cell.appendChild(mount);
            cell.title = row.diskMount;
        }
        return cell;
    }

    /** Whether a row has readings to show, or one line saying why not. */
    function rowState(row) {
        if (!row.configured) return 'unset';
        if (row.paused) return 'paused';
        if (!row.ok && row.level === 'unknown' && row.at) return 'away';
        return 'read';
    }

    /*
     * Until a heading is pressed: what needs a look first. A host that stopped
     * answering, then red, then yellow, then the healthy ones, and last what
     * is switched off or has no address. Config's order within each.
     */
    const ATTENTION = { away: 0, bad: 1, warn: 2, ok: 3, unknown: 4, paused: 5, unset: 6 };
    function attentionRank(row) {
        const state = rowState(row);
        if (state !== 'read') return ATTENTION[state];
        return ATTENTION[row.level] ?? ATTENTION.unknown;
    }

    class GlancesHosts {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            return ['hosts'];
        }

        redraw() {
            if (this._last) this.render(this._last.container, this._last.data);
        }

        render(container, data) {
            this._last = { container, data };
            const G = window.DashboardGlances;
            const v = this.view;
            const t = (key, fallback, params) => v.t(key, fallback, params);
            const answer = G.usable(data.hosts);
            const listed = answer && Array.isArray(answer.hosts) ? answer.hosts : [];
            const rows = listed
                .map((row, index) => ({ row, index }))
                .sort((a, b) => (attentionRank(a.row) - attentionRank(b.row)) || (a.index - b.index))
                .map(({ row }) => row);
            const here = this.view.dash.glancesStatus?.hostId;
            const reading = (row, value) => (rowState(row) === 'read' ? value : null);
            const table = window.DashboardGlancesTable.build({
                id: 'hosts',
                className: 'glances-table glances-hosts-table',
                t,
                rerender: () => this.redraw(),
                rows,
                columns: [
                    { key: 'name', label: ['dashboard.glancesHostsHost', 'Host'], numeric: false, cellClass: 'glances-hosts-name',
                        value: (r) => r.name, cell: (r) => this.nameCell(r, here) },
                    { key: 'cpu', label: ['dashboard.glancesChartCpu', 'Processor'], cellClass: 'glances-hosts-cell',
                        value: (r) => reading(r, r.cpu), cell: (r) => cpuCell(r) },
                    { key: 'mem', label: ['dashboard.glancesChartMem', 'Memory'], cellClass: 'glances-hosts-cell',
                        value: (r) => reading(r, r.mem), cell: (r) => meter(r.mem, 'mem') },
                    { key: 'disk', label: ['dashboard.glancesHostsDisk', 'Fullest disk'], cellClass: 'glances-hosts-cell',
                        value: (r) => reading(r, r.disk), cell: (r) => diskCell(r) },
                    { key: 'temp', label: ['dashboard.glancesHostsTemp', 'Temperature'], cellClass: 'glances-hosts-cell',
                        value: (r) => reading(r, r.temp), cell: (r) => (typeof r.temp === 'number' ? G.formatTemp(r.temp) : G.DASH) },
                    { key: 'at', label: ['dashboard.glancesHostsRead', 'Last reading'], cellClass: 'glances-hosts-cell',
                        value: (r) => reading(r, r.at || null),
                        cell: (r) => (r.at ? new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : G.DASH) },
                ],
                rowHook: (tr, row) => this.finishRow(tr, row),
            });
            table.setAttribute('data-glances-hosts', '');
            const wrap = el('div', 'glances-table-wrap');
            wrap.appendChild(table);
            window.DashboardGlancesTable.keepSortFocus(container, () => container.replaceChildren(wrap));
        }

        nameCell(row, here) {
            const t = (key, fallback, params) => this.view.t(key, fallback, params);
            const level = row.configured && !row.paused ? row.level : 'unknown';
            const cell = document.createDocumentFragment();
            const dot = el('i', 'glances-hosts-dot');
            dot.setAttribute('data-level', level);
            dot.setAttribute('aria-hidden', 'true');
            const status = { ok: ['dashboard.glancesHostStatusOk', 'Healthy'], warn: ['dashboard.glancesHostStatusWarn', 'Warning'], bad: ['dashboard.glancesHostStatusBad', 'Critical'] }[level]
                || ['dashboard.glancesHostStatusUnknown', 'Unknown'];
            const open = el('button', 'glances-row-link', row.name);
            open.title = t(status[0], status[1]);
            open.setAttribute('aria-label', `${row.name}: ${t(status[0], status[1])}`);
            open.type = 'button';
            open.setAttribute('data-glances-host-open', row.id);
            if (row.id === here) open.setAttribute('aria-current', 'true');
            open.addEventListener('click', () => { void this.view.switchHost(row.id, 'overview'); });
            cell.append(dot, open);
            return cell;
        }

        /** The row's mark, and one line in place of the readings for a host without any. */
        finishRow(tr, row) {
            const t = (key, fallback, params) => this.view.t(key, fallback, params);
            tr.classList.add('glances-hosts-row');
            tr.setAttribute('data-glances-host-row', row.id);
            const state = rowState(row);
            if (state === 'read') {
                const tone = typeof row.temp === 'number' ? window.DashboardGlances.tone(row.temp, 'temp') : '';
                if (tone) tr.children[4]?.setAttribute('data-tone', tone);
                return;
            }
            let note;
            if (state === 'unset') {
                note = el('td', 'glances-hosts-note', t('dashboard.glancesHostNoAddressShort', 'No address yet'));
            } else if (state === 'paused') {
                note = el('td', 'glances-hosts-note', t('dashboard.glancesHostPaused', 'Connection off'));
            } else {
                // Since it last answered, with the day when that was not today.
                const last = row.lastOk ? new Date(row.lastOk) : null;
                const sameDay = last && last.toDateString() === new Date().toDateString();
                note = el('td', 'glances-hosts-note glances-hosts-note--bad', last
                    ? t('dashboard.glancesHostAway', 'Not answering since {time}', {
                        time: sameDay
                            ? last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : last.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                    })
                    : t('dashboard.glancesHostAwayNow', 'Not answering'));
            }
            note.colSpan = tr.children.length - 1;
            while (tr.children.length > 1) tr.lastElementChild.remove();
            tr.appendChild(note);
        }

        destroy() {}
    }

    window.DashboardGlancesSections.register({
        id: 'hosts',
        label: 'Hosts',
        labelKey: 'dashboard.glancesSectionHosts',
        order: 90,
        // Only worth a menu entry when there is more than one host to compare.
        visible: (view) => (view.dash.glancesStatus?.hosts || []).length > 1,
        Section: GlancesHosts,
    });
}());
