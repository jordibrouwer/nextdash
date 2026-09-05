/**
 * Processor: how busy it is, and whether it is keeping up.
 *
 * Two figures, because either alone answers half the question. A load of 4 on
 * four cores is a busy machine coping; 30% with a load of 12 is a machine that
 * is not. The percentage says how hard it is working, the load average says
 * whether work is queueing up behind it.
 *
 * The percentage is absent on the first beat: /proc/stat is cumulative, so a
 * percentage is the delta between two reads and the first read has nothing to
 * compare against. The tile says it is measuring rather than printing a zero
 * nobody measured.
 *
 * Given two columns the tile fills the width with more figures rather than
 * stretching the same ones: the load windows sit abreast, and ticking "core
 * count" adds a fourth. That is the stat grid's own behaviour -- it answers to
 * a container query on the width the tile was actually drawn at, not to
 * config.columns, because the grid narrows a two-column widget back to one
 * whenever the dashboard is showing one.
 */
(function () {
    'use strict';

    const S = () => window.DashboardWidgetSystem;
    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /** "0.07" — two decimals, the way every load average is written. */
    function load(value) {
        return (Number(value) || 0).toFixed(2);
    }

    function draw(body, widget, dash, data) {
        const u = U();
        const panel = u.panel(body);
        const cpu = data?.cpu;

        if (!cpu || !cpu.available) {
            u.say(panel, 'dashboard-widget-empty',
                S().unavailableText(dash, cpu?.reason || 'read-failed'));
            return;
        }

        /*
         * Both default off, and both mean exactly what the checkbox says.
         *
         * The settings panel renders a checkbox from the stored value alone, so
         * a "default on" boolean would draw unticked over a tile that was
         * showing the thing -- the control and the tile disagreeing about the
         * same setting. A reader who wants the load average ticks it.
         */
        const config = widget?.config || {};
        const showLoad = config.showLoad === true;
        const showCores = config.showCores === true;

        const known = typeof cpu.percent === 'number';
        panel.appendChild(u.headline(
            known ? `${Math.round(cpu.percent)}%` : '—',
            known
                ? label(dash, 'dashboard.widgetCpuBusy', 'in use')
                : label(dash, 'dashboard.widgetCpuSampling', 'measuring…'),
        ));

        if (known) {
            // Tone by meaning: a processor above 90% is the one worth noticing.
            panel.appendChild(u.meter(cpu.percent, 100, cpu.percent >= 90 ? 'bad' : 'good'));
        }

        if (showLoad) {
            const stats = [
                { value: load(cpu.load1), label: label(dash, 'dashboard.widgetCpuLoad1', '1 min') },
                { value: load(cpu.load5), label: label(dash, 'dashboard.widgetCpuLoad5', '5 min') },
                { value: load(cpu.load15), label: label(dash, 'dashboard.widgetCpuLoad15', '15 min') },
            ];
            // The fourth cell is what makes the row fill two columns evenly;
            // statGrid only goes four abreast when it has four.
            if (showCores && cpu.cores > 0) {
                stats.push({
                    value: String(cpu.cores),
                    label: label(dash, 'dashboard.widgetCpuCoresLabel', 'cores'),
                });
            }
            // Two columns is the stat grid's own doing: at 24rem it goes four
            // abreast, answering to the width the tile was actually drawn at
            // rather than to config.columns, which only records the request.
            panel.appendChild(u.statGrid(stats));
        }

        if (showCores && cpu.cores > 0 && !showLoad) {
            panel.appendChild(u.footnote(
                label(dash, 'dashboard.widgetCpuCores', '{n} cores').replace('{n}', String(cpu.cores)),
            ));
        }
    }

    async function render(body, widget, dash) {
        const data = await S().fetchMetrics(dash, 'cpu', { cacheKey: `cpu:${widget?.id || 'x'}` });
        draw(body, widget, dash, data);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.cpu = render;
}());
