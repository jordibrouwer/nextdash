/**
 * The health widget: what the health view would say, in a block.
 *
 * Read from the report the health view already computes rather than counting
 * again here. Two tallies of the same thing that disagree is worse than no
 * widget at all -- and this one sits on the dashboard, where it is seen far more
 * often than the view it summarises, so it would be the one believed.
 *
 * Nothing here fetches. The report is loaded for the badge in the header
 * already; if it has not arrived the widget says so and fills in when it does.
 */
(function () {
    'use strict';

    /** What each figure means, and how to reach the rows behind it. */
    const FIGURES = [
        { key: 'brokenCount', labelKey: 'dashboard.widgetHealthBroken', fallback: 'broken', filter: 'broken', tone: 'bad' },
        { key: 'monitorDownCount', labelKey: 'dashboard.widgetHealthDown', fallback: 'down now', filter: 'monitored', tone: 'bad' },
        { key: 'contentCount', labelKey: 'dashboard.widgetHealthContent', fallback: 'content', filter: 'content', tone: 'warn' },
        { key: 'healthyCount', labelKey: 'dashboard.widgetHealthHealthy', fallback: 'healthy', filter: 'all', tone: 'good' },
    ];

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /*
     * The numbers the header badge already fetched.
     *
     * `?view=facts` runs on every dashboard load for the badge, so the figures
     * are here for free -- and taking them from the same place is what stops the
     * widget and the badge disagreeing about how many links are broken while
     * sitting on the same screen.
     *
     * Whole collection, always. A per-page count was offered first and could
     * not work: the facts response carries a row per bookmark with something to
     * report, and those rows hold only a url and an error -- no page, no status.
     * The code read them off `summary.rows`, which does not exist either
     * (`rows` sits beside `summary`, not in it), so the per-page setting
     * silently returned the collection's figures under a label that said
     * otherwise. Counting them here from the full report would mean a second,
     * far heavier request per dashboard load, and a second tally that can drift
     * from the one the header shows.
     */
    function summaryFor(dash) {
        return dash?.healthSummary || null;
    }

    function render(body, widget, dash) {
        body.replaceChildren();

        const summary = summaryFor(dash);
        if (!summary) {
            // Not an error: the report arrives with the header badge, and the
            // widget fills in when it does.
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-health-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetHealthWaiting', 'Checking…');
            body.appendChild(waiting);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-health';

        const wanted = Array.isArray(widget?.config?.show) && widget.config.show.length
            ? widget.config.show
            : null;

        FIGURES.forEach((figure) => {
            if (wanted && !wanted.includes(figure.filter)) return;
            const count = Number(summary[figure.key]) || 0;
            // A figure of zero for a problem is good news and worth saying;
            // "0 broken" is the whole point of looking.
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `dashboard-widget-health-row dashboard-widget-health-row--${figure.tone}`;
            // Nought is dimmed rather than painted in the row's colour: see
            // the note on .is-quiet. The label still says which row it is.
            if (count === 0) row.classList.add('is-quiet');
            row.dataset.healthFilter = figure.filter;

            const value = document.createElement('span');
            value.className = 'dashboard-widget-health-value';
            value.textContent = String(count);

            const name = document.createElement('span');
            name.className = 'dashboard-widget-health-label';
            name.textContent = label(dash, figure.labelKey, figure.fallback);

            row.append(value, name);
            row.addEventListener('click', () => {
                // Straight to the rows behind the number: a count you cannot act
                // on is a decoration.
                window.DashboardWidgetUtils?.openHealthFiltered(dash, figure.filter);
            });
            list.appendChild(row);
        });

        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.health = render;
})();
