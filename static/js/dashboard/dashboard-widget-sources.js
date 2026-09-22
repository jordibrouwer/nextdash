/**
 * The sources widget: what each import last did.
 *
 * An import that failed is visible today only if you open Config → Sources —
 * which means it is found by wondering why nothing new has arrived for a week.
 * The register already records the answer per source; this puts it where it is
 * seen.
 *
 * One request, cached with the dashboard's own data. Sources run on a schedule
 * measured in hours, so a tile that refreshed on a timer would ask far more
 * often than the numbers can change.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /** "2 hours ago", in the reader's own language, or nothing at all. */
    function when(dash, at) {
        const millis = Number(at) || 0;
        if (!millis) return '';
        return window.formatRelativeTime?.(millis)
            || new Date(millis).toLocaleDateString();
    }

    async function load(dash) {
        if (dash._widgetSources) return dash._widgetSources;
        try {
            const res = await fetch('/api/sources');
            if (!res.ok) return null;
            const data = await res.json();
            // Measured against the running app: the route answers a bare array.
            // The object form is read too, so a later shape change degrades to
            // an empty tile rather than a broken one.
            dash._widgetSources = Array.isArray(data) ? data
                : Array.isArray(data?.sources) ? data.sources
                : Object.entries(data?.sources || {}).map(([id, source]) => ({ id, ...source }));
            return dash._widgetSources;
        } catch (_error) {
            return null;
        }
    }

    async function render(body, widget, dash) {
        const utils = window.DashboardWidgetUtils;
        // The container-query root: the rows pair and the run times appear
        // according to the width this tile was actually given.
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);
        const sources = await load(dash);
        if (!sources) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetSourcesWaiting', 'Loading…');
            wrap.appendChild(waiting);
            return;
        }

        const errorsOnly = widget?.config?.errorsOnly === true;
        // LastResult and LastError are mutually exclusive by design, so a
        // failure is "has an error" rather than "has no result".
        const shown = sources.filter((source) => !errorsOnly || String(source?.lastError || '').trim());

        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            // Two different silences: nothing configured, versus nothing wrong.
            empty.textContent = errorsOnly
                ? label(dash, 'dashboard.widgetSourcesAllWell', 'Every source is fine.')
                : label(dash, 'dashboard.widgetSourcesNone', 'No import sources yet.');
            wrap.appendChild(empty);
            return;
        }

        const rows = utils?.rowLimit(widget, 6) ?? 6;

        // Two files of rows once the tile is wide: a source is a name with a
        // verdict beside it, which is the shape that pairs.
        const list = utils?.rowList?.() || document.createElement('div');
        if (!list.className) list.className = 'dashboard-widget-rows dashboard-widget-rows--pairs';

        shown.slice(0, rows).forEach((source) => {
            const error = String(source?.lastError || '').trim();
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `dashboard-widget-row${error ? ' dashboard-widget-row--bad' : ''}`;

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = String(source?.label || source?.id || source?.kind || '—');

            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            const ran = when(dash, source?.lastRun);
            detail.textContent = error || String(source?.lastResult || '').trim()
                || label(dash, 'dashboard.widgetSourcesNeverRun', 'Never run');
            if (ran) detail.title = ran;

            row.append(name, detail);
            /*
             * When it last ran, on the tile rather than in a tooltip.
             *
             * "Imported 42" says nothing about whether the source has stopped:
             * a week-old success and this morning's read the same. The hover
             * had the answer, and a hover is not an answer -- a wide tile has
             * the room to simply print it.
             */
            if (ran) {
                const at = document.createElement('span');
                at.className = 'dashboard-widget-row-detail dashboard-widget-wide-only';
                at.textContent = ran;
                row.appendChild(at);
            }
            window.DashboardWidgetUtils?.bindRowAction(row, dash, {
                labelKey: 'widgetActionOpenSources',
                labelFallback: 'Open Sources',
                run: () => {
                    dash.config?.openConfigView?.('sources') ?? dash.showView?.('config');
                },
            });
            list.appendChild(row);
        });

        utils?.appendOverflowRow(list, dash, shown.length - rows,
            () => { dash.config?.openConfigView?.('sources') ?? dash.showView?.('config'); });

        wrap.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.sources = render;
})();
