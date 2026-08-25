/**
 * The pieces every listing widget needs, in one place.
 *
 * Six tiles cut their list to a row count someone chose, and each of them was
 * cutting it silently: five rows shown out of twelve looked exactly like five
 * rows out of five. The number of rows is a setting about what you want to
 * *see*, so what falls outside it has to be visible too — otherwise the tile
 * quietly answers a different question than the one it appears to answer.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /**
     * A row saying what did not fit, appended only when something did not.
     *
     * Clickable when the caller says where the rest lives, because a count you
     * cannot reach is a smaller version of the same problem.
     */
    function appendOverflowRow(list, dash, hiddenCount, onOpen) {
        if (!list || !Number.isFinite(hiddenCount) || hiddenCount <= 0) return;
        const row = document.createElement(onOpen ? 'button' : 'div');
        if (onOpen) row.type = 'button';
        row.className = 'dashboard-widget-row dashboard-widget-row--more';

        const name = document.createElement('span');
        name.className = 'dashboard-widget-row-name';
        name.textContent = label(dash, 'dashboard.widgetMore', '{n} more')
            .replace('{n}', String(hiddenCount));

        row.appendChild(name);
        if (onOpen) row.addEventListener('click', onOpen);
        list.appendChild(row);
    }

    /** The row count a widget was given, within the bounds the server enforces. */
    function rowLimit(widget, fallback) {
        const raw = Number(widget?.config?.rows);
        if (!Number.isFinite(raw)) return fallback;
        return Math.min(Math.max(Math.trunc(raw), 1), 20);
    }

    window.DashboardWidgetUtils = { appendOverflowRow, rowLimit, label };
})();
