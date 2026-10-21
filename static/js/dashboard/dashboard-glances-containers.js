/**
 * Glances view, Containers: one row per container, read only.
 *
 * No start, stop or restart anywhere: Glances only reads, and so does this.
 * Sorting runs in the browser over the rows already on screen. A reading the
 * host did not send is a dash, never 0.
 */
(function () {
    'use strict';

    /** First usable number among the names a Glances version may use. */
    function pick(row, names) {
        const G = window.DashboardGlances;
        for (const name of names) {
            const n = G.num(row?.[name]);
            if (n !== null) return n;
        }
        return null;
    }

    function text(value) {
        if (Array.isArray(value)) return value.map(String).join(', ');
        return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    }

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    /** The columns: what a row sorts on (null sorts last), numbers lead with the biggest. */
    const COLUMNS = [
        { key: 'name', label: ['dashboard.glancesCtName', 'Name'], sort: (r) => r.name.toLowerCase() },
        { key: 'status', label: ['dashboard.glancesCtStatus', 'Status'], sort: (r) => r.status.toLowerCase() },
        { key: 'uptime', label: ['dashboard.glancesCtUptime', 'Uptime'], sort: (r) => r.uptime.toLowerCase() },
        { key: 'cpu', label: ['dashboard.glancesCtCpu', 'CPU'], sort: (r) => r.cpu, numeric: true },
        { key: 'mem', label: ['dashboard.glancesCtMem', 'RAM'], sort: (r) => r.mem, numeric: true },
        { key: 'io', label: ['dashboard.glancesCtIo', 'Disk read / write'], sort: (r) => r.ioRead, numeric: true },
        { key: 'net', label: ['dashboard.glancesCtNet', 'Network in / out'], sort: (r) => r.netRx, numeric: true },
        { key: 'image', label: ['dashboard.glancesCtImage', 'Image'], sort: (r) => r.image.toLowerCase() },
        { key: 'command', label: ['dashboard.glancesCtCommand', 'Command'], sort: (r) => r.command.toLowerCase() },
    ];

    class GlancesContainers {
        constructor(view) {
            this.view = view;
            this.sortKey = 'name';
            this.sortDir = 'ascending';
            this.rows = [];
            this.heads = new Map();
            this.table = null;
            this.message = null;
            this.tbody = null;
        }

        endpoints() {
            return ['containers'];
        }

        /** One answer row as plain readings. */
        static read(raw) {
            const G = window.DashboardGlances;
            return {
                name: text(raw?.name),
                status: text(raw?.status),
                uptime: text(raw?.uptime),
                cpu: pick(raw, ['cpu_percent']),
                mem: pick(raw, ['memory_usage']) ?? G.num(raw?.memory?.usage),
                ioRead: pick(raw, ['io_rx', 'io_r', 'io_read']),
                ioWrite: pick(raw, ['io_wx', 'io_w', 'io_write']),
                netRx: pick(raw, ['network_rx', 'net_rx']),
                netTx: pick(raw, ['network_tx', 'net_tx']),
                image: text(raw?.image),
                command: text(raw?.command),
            };
        }

        build(container) {
            const v = this.view;
            this.message = el('p', 'glances-ct-message');
            this.message.setAttribute('data-glances-ct-message', '');
            this.message.hidden = true;
            this.table = el('table', 'glances-ct-table');
            this.table.setAttribute('data-glances-containers', '');
            const tr = el('tr');
            this.heads = new Map();
            COLUMNS.forEach((col) => {
                const th = el('th', `glances-ct-head glances-ct-head--${col.key}`);
                th.scope = 'col';
                const btn = el('button', 'glances-proc-sort', v.t(col.label[0], col.label[1]));
                btn.type = 'button';
                btn.setAttribute('data-glances-ct-sort', col.key);
                btn.addEventListener('click', () => this.sortBy(col.key));
                th.appendChild(btn);
                this.heads.set(col.key, { th, btn });
                tr.appendChild(th);
            });
            const head = el('thead');
            head.appendChild(tr);
            this.tbody = el('tbody');
            this.table.append(head, this.tbody);
            this.syncHeads();
            this.wrap = el('div', 'glances-ct-wrap');
            this.wrap.appendChild(this.table);
            container.replaceChildren(this.message, this.wrap);
        }

        sortBy(key) {
            const col = COLUMNS.find((c) => c.key === key);
            if (!col) return;
            if (this.sortKey === key) {
                this.sortDir = this.sortDir === 'ascending' ? 'descending' : 'ascending';
            } else {
                this.sortKey = key;
                this.sortDir = col.numeric ? 'descending' : 'ascending';
            }
            this.syncHeads();
            this.drawRows();
        }

        syncHeads() {
            this.heads.forEach(({ th, btn }, key) => {
                if (key === this.sortKey) {
                    th.setAttribute('aria-sort', this.sortDir);
                    btn.setAttribute('aria-sort', this.sortDir);
                } else {
                    th.removeAttribute('aria-sort');
                    btn.removeAttribute('aria-sort');
                }
            });
        }

        render(container, data) {
            const G = window.DashboardGlances;
            if (!this.table || !container.contains(this.table)) this.build(container);
            const body = G.usable(data.containers);
            if (!Array.isArray(body)) {
                this.rows = [];
                this.show(G.isUnavailable(data.containers)
                    ? this.view.t('dashboard.glancesCtNone', 'Glances has no container plugin on this host.')
                    : this.view.t('dashboard.glancesNotAvailable', 'Not available on this host.'));
                return;
            }
            this.rows = body.map(GlancesContainers.read);
            if (!this.rows.length) {
                this.show(this.view.t('dashboard.glancesCtEmpty', 'No containers.'));
                return;
            }
            this.message.hidden = true;
            this.wrap.hidden = false;
            this.drawRows();
        }

        show(message) {
            this.message.textContent = message;
            this.message.hidden = false;
            this.wrap.hidden = true;
            this.tbody.replaceChildren();
        }

        drawRows() {
            const G = window.DashboardGlances;
            const col = COLUMNS.find((c) => c.key === this.sortKey) || COLUMNS[0];
            const dir = this.sortDir === 'ascending' ? 1 : -1;
            const rows = this.rows.slice().sort((a, b) => {
                const x = col.sort(a);
                const y = col.sort(b);
                // A reading that is missing sorts last whichever way it runs.
                if (x === null && y === null) return a.name.localeCompare(b.name);
                if (x === null) return 1;
                if (y === null) return -1;
                if (x < y) return -dir;
                if (x > y) return dir;
                return a.name.localeCompare(b.name);
            });
            const dash = G.DASH;
            const bytes = (n) => (n === null ? dash : G.formatBytes(n));
            const pair = (a, b) => (a === null && b === null ? dash : `${bytes(a)} / ${bytes(b)}`);
            const trs = rows.map((r) => {
                const tr = el('tr', 'glances-ct-row');
                tr.setAttribute('data-glances-container', r.name);
                const cells = {
                    name: r.name || dash,
                    status: r.status || dash,
                    uptime: r.uptime || dash,
                    cpu: r.cpu === null ? dash : `${r.cpu.toFixed(1)}%`,
                    mem: bytes(r.mem),
                    io: pair(r.ioRead, r.ioWrite),
                    net: pair(r.netRx, r.netTx),
                    image: r.image || dash,
                    command: r.command || dash,
                };
                COLUMNS.forEach((c) => {
                    const td = el('td', `glances-ct-cell glances-ct-cell--${c.key}`, cells[c.key]);
                    // The whole value stays reachable where the cell cuts it short.
                    if (c.key === 'name' || c.key === 'image' || c.key === 'command') td.title = cells[c.key];
                    tr.appendChild(td);
                });
                if (r.status && r.status !== 'running') tr.setAttribute('data-state', 'stopped');
                return tr;
            });
            this.tbody.replaceChildren(...trs);
        }
    }

    window.DashboardGlancesSections.register({
        id: 'containers',
        label: 'Containers',
        labelKey: 'dashboard.glancesSectionContainers',
        order: 30,
        plugin: 'containers',
        Section: GlancesContainers,
    });
}());
