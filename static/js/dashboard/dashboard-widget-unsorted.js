/**
 * The Unsorted widget: bookmarks kept from the inbox without a dashboard
 * category, most recent first. Reads the same /api/unsorted endpoint the
 * full view and the Move to... popover use, so there is exactly one source
 * of truth for "what is in Unsorted" on the client.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    async function load(dash) {
        if (dash._widgetUnsorted) return dash._widgetUnsorted;
        try {
            const res = await fetch('/api/unsorted');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetUnsorted = Array.isArray(data?.bookmarks) ? data.bookmarks : [];
            dash._unsortedPageId = data?.page?.id;
            return dash._widgetUnsorted;
        } catch (_error) {
            return null;
        }
    }

    function render(body, widget, dash, bookmarks) {
        body.replaceChildren();
        const config = widget?.config || {};
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);

        if (!bookmarks.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = label(dash, 'dashboard.widgetUnsortedEmpty', 'Nothing kept yet.');
            body.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';
        bookmarks.slice(0, maxRows).forEach((bm) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'dashboard-widget-row';

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = String(bm?.name || bm?.url || '');
            row.appendChild(name);

            window.DashboardWidgetUtils?.bindRowAction(row, dash, {
                labelKey: 'widgetActionOpenUnsorted',
                labelFallback: 'Open Unsorted',
                run: () => { void dash.unsorted?.openUnsortedView?.(); },
            });
            list.appendChild(row);
        });
        window.DashboardWidgetUtils?.appendOverflowRow(
            list, dash, bookmarks.length - maxRows, () => { void dash.unsorted?.openUnsortedView?.(); });
        body.appendChild(list);
    }

    async function renderUnsorted(body, widget, dash) {
        const bookmarks = await load(dash);
        if (!bookmarks) {
            body.replaceChildren();
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetUnsortedWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }
        render(body, widget, dash, bookmarks);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.unsorted = renderUnsorted;
})();
