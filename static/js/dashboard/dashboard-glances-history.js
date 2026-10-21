/**
 * Page 0, History: the graphs, from nextDash's own record of the machine.
 *
 * nextDash reads the host every few seconds while Glances is on and keeps a
 * day of it, so a graph is full the moment this opens. One graph per kind of
 * reading -- processor, memory, load, network, disk activity, disk usage,
 * temperatures -- each with its own range (the last minute, hour, six, twelve
 * or twenty-four hours) and four figures from the points it draws. A gap in the
 * record is a gap in the line; the span under each graph comes from its points.
 */
(function () {
    'use strict';

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    class GlancesHistory {
        constructor(view) {
            this.view = view;
            this._paths = {};
            this._ghosts = {};
        }

        /** One question per graph, each at the range that graph is showing. */
        endpoints() {
            const Chart = window.DashboardGlancesChart;
            this._paths = {};
            this._ghosts = {};
            const list = [];
            Chart.GROUPS.forEach((def) => {
                const path = Chart.pathFor(def, this.view.seriesNames);
                if (path) {
                    this._paths[def.id] = path;
                    list.push(path);
                    const ghost = Chart.ghostPathFor(def, this.view.seriesNames);
                    if (ghost) {
                        this._ghosts[def.id] = ghost;
                        list.push(ghost);
                    }
                }
            });
            // Nothing recorded yet: ask only for what exists, which is the names.
            if (!list.length) list.push('history');
            return list;
        }

        render(container, data) {
            const G = window.DashboardGlances;
            const Chart = window.DashboardGlancesChart;
            const panels = [];
            Chart.GROUPS.forEach((def) => {
                const path = this._paths[def.id];
                if (!path) return;
                const answer = G.usable(data[path]);
                if (!answer) return;
                panels.push(Chart.panel(this.view, def, answer, {
                    ghost: this._ghosts[def.id] ? G.usable(data[this._ghosts[def.id]]) : null,
                    onRange: () => { void this.view.refresh({ force: true }); },
                }));
            });
            Chart.keepFocus(container, () => {
                if (!panels.length) {
                    const empty = el('p', 'glances-note', this.view.t('dashboard.glancesHistoryEmpty', 'nextDash is still collecting history.'));
                    empty.setAttribute('data-glances-history', 'empty');
                    container.replaceChildren(empty);
                    return;
                }
                const grid = el('div', 'glances-charts');
                grid.setAttribute('data-glances-history', 'charts');
                grid.append(...panels);
                container.replaceChildren(grid);
            });
        }
    }

    window.DashboardGlancesSections.register({
        id: 'history',
        label: 'History',
        labelKey: 'dashboard.glancesSectionHistory',
        order: 60,
        plugin: 'quicklook',
        Section: GlancesHistory,
    });
}());
