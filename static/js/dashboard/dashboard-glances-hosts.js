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
    function meter(view, value, kind) {
        const G = window.DashboardGlances;
        const cell = el('td', 'glances-hosts-cell');
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            cell.textContent = G.DASH;
            return cell;
        }
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

    function tempCell(value) {
        const G = window.DashboardGlances;
        const cell = el('td', 'glances-hosts-cell', typeof value === 'number' ? `${Math.round(value)}°` : G.DASH);
        const tone = typeof value === 'number' ? G.tone(value, 'temp') : '';
        if (tone) cell.setAttribute('data-tone', tone);
        return cell;
    }

    class GlancesHosts {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            return ['hosts'];
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const v = this.view;
            const t = (key, fallback, params) => v.t(key, fallback, params);
            const answer = G.usable(data.hosts);
            const rows = answer && Array.isArray(answer.hosts) ? answer.hosts : [];
            const table = el('table', 'glances-table glances-hosts-table');
            table.setAttribute('data-glances-hosts', '');
            const head = el('tr');
            [
                ['dashboard.glancesHostsHost', 'Host'], ['dashboard.glancesChartCpu', 'Processor'], ['dashboard.glancesChartMem', 'Memory'],
                ['dashboard.glancesHostsDisk', 'Fullest disk'], ['dashboard.glancesHostsTemp', 'Temperature'], ['dashboard.glancesHostsRead', 'Last reading'],
            ].forEach(([key, fallback]) => {
                const th = el('th', '', t(key, fallback));
                th.scope = 'col';
                head.appendChild(th);
            });
            table.appendChild(el('thead')).appendChild(head);
            const body = el('tbody');
            const here = this.view.dash.glancesStatus?.hostId;
            rows.forEach((row) => {
                const tr = el('tr', 'glances-hosts-row');
                tr.setAttribute('data-glances-host-row', row.id);
                const name = el('td', 'glances-hosts-name');
                const level = row.configured && !row.paused ? row.level : 'unknown';
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
                open.addEventListener('click', () => { void v.switchHost(row.id, 'overview'); });
                name.append(dot, open);
                tr.appendChild(name);
                if (!row.configured) {
                    const note = el('td', 'glances-hosts-note', t('dashboard.glancesHostNoAddressShort', 'No address yet'));
                    note.colSpan = 5;
                    tr.appendChild(note);
                } else if (row.paused) {
                    const note = el('td', 'glances-hosts-note', t('dashboard.glancesHostPaused', 'Connection off'));
                    note.colSpan = 5;
                    tr.appendChild(note);
                } else if (!row.ok && row.level === 'unknown' && row.at) {
                    // Since it last answered, with the day when that was not today.
                    const last = row.lastOk ? new Date(row.lastOk) : null;
                    const sameDay = last && last.toDateString() === new Date().toDateString();
                    const note = el('td', 'glances-hosts-note glances-hosts-note--bad', last
                        ? t('dashboard.glancesHostAway', 'Not answering since {time}', {
                            time: sameDay
                                ? last.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : last.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                        })
                        : t('dashboard.glancesHostAwayNow', 'Not answering'));
                    note.colSpan = 5;
                    tr.appendChild(note);
                } else {
                    tr.append(
                        meter(v, row.cpu, 'cpu'), meter(v, row.mem, 'mem'), meter(v, row.disk, 'disk'),
                        tempCell(row.temp),
                        el('td', 'glances-hosts-cell', row.at ? new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : G.DASH),
                    );
                }
                body.appendChild(tr);
            });
            table.appendChild(body);
            const wrap = el('div', 'glances-table-wrap');
            wrap.appendChild(table);
            container.replaceChildren(wrap);
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
