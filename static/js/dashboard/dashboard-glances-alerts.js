/**
 * Glances view, Alerts: Glances' own event log, newest first, with the
 * warning and critical lines it measures the meters against.
 *
 * The menu counts the alerts still ongoing (Glances marks those with an end
 * of -1).
 */
(function () {
    'use strict';

    const LEVELS = ['careful', 'warning', 'critical'];

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function str(value) {
        return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    }

    /** Still going: no end time yet (-1 in Glances, or nothing at all). */
    function ongoing(event) {
        const end = window.DashboardGlances.num(event?.end);
        return end === null || end < 0;
    }

    class GlancesAlerts {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            return ['alert', 'all/limits'];
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const v = this.view;
            const parts = [];
            const events = G.usable(data.alert);
            if (!Array.isArray(events)) {
                container.replaceChildren(el('p', 'glances-note', v.t('dashboard.glancesNotAvailable', 'Not available on this host.')));
                return;
            }
            parts.push(events.length ? this.table(events) : el('p', 'glances-note', v.t('dashboard.glancesAlertsNone', 'No alerts.')));
            const limits = this.limits(G.usable(data['all/limits']));
            if (limits) parts.push(limits);
            container.replaceChildren(...parts);
        }

        table(events) {
            const G = window.DashboardGlances;
            const v = this.view;
            const when = (secs) => {
                const n = G.num(secs);
                return n === null || n < 0 ? G.DASH : new Date(n * 1000).toLocaleString();
            };
            const rows = events.filter((e) => e && typeof e === 'object')
                .slice().sort((a, b) => (G.num(b.begin) ?? 0) - (G.num(a.begin) ?? 0));
            const table = el('table', 'glances-table glances-al-table');
            table.setAttribute('data-glances-alerts', '');
            const head = el('tr');
            [['dashboard.glancesAlBegin', 'Began'], ['dashboard.glancesAlEnd', 'Ended'], ['dashboard.glancesAlState', 'State'],
                ['dashboard.glancesAlType', 'Type'], ['dashboard.glancesAlMax', 'Peak']].forEach(([key, fallback]) => {
                const th = el('th', '', v.t(key, fallback));
                th.scope = 'col';
                head.appendChild(th);
            });
            const thead = el('thead');
            thead.appendChild(head);
            const tbody = el('tbody');
            rows.forEach((e) => {
                const max = G.num(e.max);
                const state = str(e.state);
                const tr = el('tr', 'glances-al-row');
                tr.setAttribute('data-glances-alert', '');
                if (ongoing(e)) tr.setAttribute('data-ongoing', '');
                tr.append(
                    el('td', 'glances-al-cell glances-al-cell--begin', when(e.begin)),
                    el('td', 'glances-al-cell glances-al-cell--end', ongoing(e) ? v.t('dashboard.glancesAlOngoing', 'Ongoing') : when(e.end)),
                    el('td', 'glances-al-cell glances-al-cell--state', state || G.DASH),
                    el('td', 'glances-al-cell glances-al-cell--type', str(e.type) || G.DASH),
                    el('td', 'glances-al-cell glances-al-cell--max', max === null ? G.DASH : max.toFixed(1)),
                );
                if (state) tr.setAttribute('data-state', state.toLowerCase());
                tbody.appendChild(tr);
            });
            table.append(thead, tbody);
            return table;
        }

        /** The lines per meter, grouped by the name before _careful/_warning/_critical; null when none. */
        limits(body) {
            const G = window.DashboardGlances;
            const v = this.view;
            if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
            const meters = new Map();
            Object.values(body).forEach((set) => {
                if (!set || typeof set !== 'object') return;
                Object.entries(set).forEach(([key, raw]) => {
                    const level = LEVELS.find((l) => key.endsWith(`_${l}`));
                    const n = G.num(raw);
                    if (!level || n === null) return;
                    const meter = key.slice(0, -(level.length + 1)).replace(/_/g, ' ');
                    if (!meters.has(meter)) meters.set(meter, []);
                    meters.get(meter).push({ key, level, value: n });
                });
            });
            if (!meters.size) return null;
            const section = el('section', 'glances-block');
            section.setAttribute('data-glances-limits', '');
            section.appendChild(el('h3', 'glances-block-title', v.t('dashboard.glancesAlLimits', 'Limits')));
            const list = el('dl', 'glances-limits');
            meters.forEach((levels, meter) => {
                const row = el('div', 'glances-limit-row');
                const dt = el('dt', '', meter);
                const dd = el('dd', '');
                levels.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)).forEach((l) => {
                    const chip = el('span', 'glances-limit', `${v.t(`dashboard.glancesAlLevel_${l.level}`, l.level)} ${l.value}`);
                    chip.setAttribute('data-glances-limit', l.key);
                    chip.setAttribute('data-level', l.level);
                    dd.appendChild(chip);
                });
                row.append(dt, dd);
                list.appendChild(row);
            });
            section.appendChild(list);
            return section;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'alerts',
        label: 'Alerts',
        labelKey: 'dashboard.glancesSectionAlerts',
        order: 70,
        plugin: 'alert',
        Section: GlancesAlerts,
        /** The menu counts what is still going on, and dots it. */
        badge(feed) {
            const events = window.DashboardGlances.usable(feed.alert);
            const count = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object' && ongoing(e)).length : 0;
            return { count, warn: count > 0 };
        },
    });
}());
