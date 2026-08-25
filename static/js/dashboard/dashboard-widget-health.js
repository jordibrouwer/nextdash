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
     * Which page the figures describe.
     *
     * Per page by default, because a widget sits on a page and the reader is
     * looking at that page. "All pages" is the other honest answer and is a
     * setting rather than a guess.
     */
    function summaryFor(dash, widget) {
        /*
         * The numbers the header badge already fetched.
         *
         * `?view=facts` runs on every dashboard load for the badge, so the
         * figures are here for free -- and taking them from the same place is
         * what stops the widget and the badge disagreeing about how many links
         * are broken while sitting on the same screen.
         */
        const summary = dash?.healthSummary;
        if (!summary) return null;

        // "All pages" is the default the config tab offers, so only an explicit
        // per-page setting narrows it.
        if (widget?.config?.scope !== 'page') return summary;

        /*
         * Per page, when asked for.
         *
         * The compact report carries a row per bookmark that has something to
         * report, each with its page, so this is a filter rather than a second
         * count. Bookmarks with nothing to report are not in it -- which is why
         * healthy is derived from the page's total rather than counted.
         */
        const rows = Array.isArray(summary.rows) ? summary.rows : null;
        if (!rows) return summary;

        const pageId = Number(dash.currentPageId);
        const mine = rows.filter((row) => Number(row.pageId) === pageId);
        const total = (dash.allBookmarks || []).filter((bm) => Number(bm.pageId) === pageId).length;
        const counts = {
            totalBookmarks: total,
            brokenCount: mine.filter((r) => r.status === 'broken').length,
            monitorDownCount: mine.filter((r) => r.status === 'down').length,
            contentCount: mine.filter((r) => r.status === 'content').length,
        };
        counts.healthyCount = Math.max(0,
            total - counts.brokenCount - counts.monitorDownCount - counts.contentCount);
        return counts;
    }

    function render(body, widget, dash) {
        body.replaceChildren();

        const summary = summaryFor(dash, widget);
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
                dash.health?.openWithFilter?.(figure.filter) ?? dash.showView?.('health');
            });
            list.appendChild(row);
        });

        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.health = render;
})();
