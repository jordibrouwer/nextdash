/**
 * The inbox widget: what is waiting, and how long it has waited.
 *
 * The age is the part worth showing. A count says how much there is; the oldest
 * item says whether the inbox is a queue you work or a drawer you fill.
 *
 * Reads /api/inbox rather than /api/inbox-stats — measured: the stats route
 * carries lifetime counters (added, promoted, deleted) and not what is waiting
 * now, which is the only figure this tile is about.
 */
(function () {
    'use strict';

    const DAY = 24 * 60 * 60 * 1000;

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    async function load(dash) {
        if (dash._widgetInbox) return dash._widgetInbox;
        try {
            const res = await fetch('/api/inbox');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetInbox = Array.isArray(data?.items) ? data.items
                : Array.isArray(data) ? data : [];
            return dash._widgetInbox;
        } catch (_error) {
            return null;
        }
    }

    function render(body, widget, dash, items) {
        body.replaceChildren();
        const config = widget?.config || {};
        const maxRows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const showSource = config.showSource !== false;

        if (!items.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            empty.textContent = label(dash, 'dashboard.widgetInboxEmpty', 'Nothing waiting.');
            body.appendChild(empty);
            return;
        }

        // Oldest first: a backlog clears from the bottom, and the item that has
        // waited longest is the one the tile exists to surface.
        const sorted = [...items].sort((a, b) => (Number(a?.addedAt) || 0) - (Number(b?.addedAt) || 0));
        const oldest = Number(sorted[0]?.addedAt) || 0;

        const head = document.createElement('div');
        head.className = 'dashboard-widget-headline';
        const count = document.createElement('span');
        count.className = 'dashboard-widget-headline-value';
        count.textContent = String(items.length);
        head.appendChild(count);
        if (oldest) {
            const age = document.createElement('span');
            age.className = 'dashboard-widget-headline-note';
            const days = Math.floor((Date.now() - oldest) / DAY);
            age.textContent = days > 0
                ? label(dash, 'dashboard.widgetInboxOldest', 'oldest {n}d').replace('{n}', String(days))
                : label(dash, 'dashboard.widgetInboxToday', 'all from today');
            head.appendChild(age);
        }
        body.appendChild(head);

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';
        sorted.slice(0, maxRows).forEach((item) => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'dashboard-widget-row';

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            // The fetched title beats the pasted one, and the address beats
            // neither being there.
            name.textContent = String(item?.previewTitle || item?.title || item?.url || '');

            row.appendChild(name);
            if (showSource && String(item?.source || '').trim()) {
                const source = document.createElement('span');
                source.className = 'dashboard-widget-row-detail';
                source.textContent = String(item.source).trim();
                row.appendChild(source);
            }
            window.DashboardWidgetUtils?.bindRowAction(row, dash, {
                labelKey: 'widgetActionOpenInbox',
                labelFallback: 'Open Inbox',
                run: () => { dash.showView?.('inbox'); },
            });
            list.appendChild(row);
        });
        // What did not fit is stated rather than dropped: five rows out of
        // twelve otherwise looks exactly like five out of five.
        window.DashboardWidgetUtils?.appendOverflowRow(
            list, dash, sorted.length - maxRows, () => { dash.showView?.('inbox'); });
        body.appendChild(list);
    }

    async function renderInbox(body, widget, dash) {
        const items = await load(dash);
        if (!items) {
            body.replaceChildren();
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetInboxWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }
        render(body, widget, dash, items);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.inbox = renderInbox;
})();
