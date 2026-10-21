/**
 * Page 0: tables that sort on their columns.
 *
 * A column heading is a button: the first press sorts by it (numbers the
 * biggest first, text A to Z), the next reverses it, and a heading carries
 * aria-sort so a screen reader says which way. The choice is kept per table
 * for the session, so the page's redraw every beat does not undo it.
 *
 *   DashboardGlancesTable.build({
 *       id: 'network',
 *       columns: [{ key: 'name', label: ['dashboard.x', 'Interface'], value: (r) => r.name, cell: (r) => 'eth0', numeric: false }],
 *       rows, t, rerender, rowHook(tr, row), initial: { key: 'name', dir: 'asc' },
 *   })
 *
 * `value` is what a row is compared by (a number, a string, or null for "not
 * known", which always sorts last); `cell` is what is drawn, text or a node.
 */
(function () {
    'use strict';

    const state = new Map();

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function compare(a, b, dir) {
        const missing = (x) => x === null || x === undefined || x === '' || (typeof x === 'number' && !Number.isFinite(x));
        if (missing(a) && missing(b)) return 0;
        if (missing(a)) return 1;
        if (missing(b)) return -1;
        const result = typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
        return dir === 'desc' ? -result : result;
    }

    /** The rows in the order the table is showing them. */
    function sorted(id, columns, rows, initial) {
        const choice = state.get(id) || initial || null;
        const column = choice && columns.find((c) => c.key === choice.key);
        if (!column) return rows.slice();
        return rows.slice().sort((a, b) => compare(column.value(a), column.value(b), choice.dir));
    }

    function build({ id, columns, rows, t, rerender, rowHook, initial, className = 'glances-table' }) {
        const choice = state.get(id) || initial || null;
        const table = el('table', className);
        table.setAttribute('data-glances-table', id);

        const head = el('tr');
        columns.forEach((c) => {
            const th = el('th', c.className || '');
            th.scope = 'col';
            const label = Array.isArray(c.label) ? t(c.label[0], c.label[1]) : String(c.label);
            const active = choice && choice.key === c.key;
            th.setAttribute('aria-sort', active ? (choice.dir === 'asc' ? 'ascending' : 'descending') : 'none');
            const btn = el('button', 'glances-sort-btn');
            btn.type = 'button';
            btn.setAttribute('data-glances-sort-col', c.key);
            btn.append(el('span', '', label), el('span', 'glances-sort-mark', active ? (choice.dir === 'asc' ? '▲' : '▼') : ''));
            btn.addEventListener('click', () => {
                const now = state.get(id) || initial || null;
                const first = c.numeric === false ? 'asc' : 'desc';
                const dir = now && now.key === c.key ? (now.dir === 'asc' ? 'desc' : 'asc') : first;
                state.set(id, { key: c.key, dir });
                if (typeof rerender === 'function') rerender();
            });
            th.appendChild(btn);
            head.appendChild(th);
        });
        const thead = el('thead');
        thead.appendChild(head);

        const tbody = el('tbody');
        sorted(id, columns, rows, initial).forEach((row) => {
            const tr = el('tr');
            columns.forEach((c) => {
                const td = el('td', c.cellClass || '');
                const content = c.cell ? c.cell(row) : c.value(row);
                if (content instanceof Node) td.appendChild(content);
                else td.textContent = content === null || content === undefined || content === '' ? window.DashboardGlances.DASH : String(content);
                tr.appendChild(td);
            });
            if (typeof rowHook === 'function') rowHook(tr, row);
            tbody.appendChild(tr);
        });
        table.append(thead, tbody);
        return table;
    }

    /** Keep the focus on a heading across a redraw: the buttons are rebuilt. */
    function keepSortFocus(container, redraw) {
        const active = document.activeElement;
        let selector = null;
        if (active && container.contains(active) && active.hasAttribute('data-glances-sort-col')) {
            const table = active.closest('[data-glances-table]')?.getAttribute('data-glances-table');
            if (table) {
                selector = `[data-glances-table="${CSS.escape(table)}"] [data-glances-sort-col="${CSS.escape(active.getAttribute('data-glances-sort-col'))}"]`;
            }
        }
        redraw();
        if (selector) container.querySelector(selector)?.focus({ preventScroll: true });
    }

    window.DashboardGlancesTable = { build, sorted, compare, keepSortFocus };
}());
