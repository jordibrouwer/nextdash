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

    /**
     * Still going: Glances writes an end of -1 until the alert is over. Only a
     * negative number counts, as on the server; an end that is missing or not
     * a number is unknown, not ongoing.
     */
    function ongoing(event) {
        const end = event?.end;
        return typeof end === 'number' && Number.isFinite(end) && end < 0;
    }

    /** A time from Glances' seconds, or a dash when there is none or it is not a date. */
    function when(secs) {
        const G = window.DashboardGlances;
        const n = G.num(secs);
        if (n === null || n < 0) return G.DASH;
        const date = new Date(n * 1000);
        return Number.isNaN(date.getTime()) ? G.DASH : date.toLocaleString();
    }

    class GlancesAlerts {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            return ['alert', 'all/limits'];
        }

        redraw() {
            if (this._last) this.render(this._last.container, this._last.data);
        }

        render(container, data) {
            this._last = { container, data };
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
            window.DashboardGlancesTable.keepSortFocus(container, () => container.replaceChildren(...parts));
        }

        table(events) {
            const G = window.DashboardGlances;
            const v = this.view;
            const rows = events.filter((e) => e && typeof e === 'object');
            const Tip = window.DashboardGlancesTip;
            const spec = window.DashboardGlancesSpecs?.alert || [];
            const table = window.DashboardGlancesTable.build({
                id: 'alerts',
                t: (k, f, p) => v.t(k, f, p),
                rerender: () => this.redraw?.(),
                initial: { key: 'begin', dir: 'desc' },
                className: 'glances-table glances-al-table',
                rows,
                columns: [
                    { key: 'begin', label: ['dashboard.glancesAlBegin', 'Began'], cellClass: 'glances-al-cell glances-al-cell--begin',
                        value: (e) => G.num(e.begin), cell: (e) => when(e.begin) },
                    { key: 'end', label: ['dashboard.glancesAlEnd', 'Ended'], cellClass: 'glances-al-cell glances-al-cell--end',
                        value: (e) => (ongoing(e) ? Number.MAX_SAFE_INTEGER : G.num(e.end)),
                        cell: (e) => (ongoing(e) ? v.t('dashboard.glancesAlOngoing', 'Ongoing') : when(e.end)) },
                    { key: 'state', label: ['dashboard.glancesAlState', 'State'], numeric: false, cellClass: 'glances-al-cell glances-al-cell--state',
                        value: (e) => str(e.state) },
                    { key: 'type', label: ['dashboard.glancesAlType', 'Type'], numeric: false, cellClass: 'glances-al-cell glances-al-cell--type',
                        value: (e) => str(e.type) },
                    { key: 'max', label: ['dashboard.glancesAlMax', 'Peak'], cellClass: 'glances-al-cell glances-al-cell--max',
                        value: (e) => G.num(e.max), cell: (e) => (G.num(e.max) === null ? G.DASH : G.num(e.max).toFixed(1)) },
                ],
                rowHook: (tr, e) => {
                    tr.classList.add('glances-al-row');
                    tr.setAttribute('data-glances-alert', '');
                    if (ongoing(e)) tr.setAttribute('data-ongoing', '');
                    const state = str(e.state);
                    if (state) tr.setAttribute('data-state', state.toLowerCase());
                    if (typeof v.tip === 'function' && Tip) {
                        v.tip(tr, `alert:${str(e.type)}:${str(e.begin)}`, () => Tip.describe(v, str(e.type), e, spec, str(e.global_msg)));
                    }
                },
            });
            table.setAttribute('data-glances-alerts', '');
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
