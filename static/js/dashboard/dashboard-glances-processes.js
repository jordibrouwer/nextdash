/**
 * Glances view, Processes: the top list, read only.
 *
 * Sort and search run on the server over the full list, which answers the
 * top 200 without command lines: an argument can carry a token, so a command
 * line is asked for one process at a time, only when its row is expanded.
 */
(function () {
    'use strict';

    const LIMIT = 200;
    const SEARCH_DELAY_MS = 300;

    /** The headings, and which of them the server can sort on (with its direction). */
    const COLUMNS = [
        { key: 'name', label: ['dashboard.glancesProcName', 'Name'], sort: 'ascending' },
        { key: 'pid', label: ['dashboard.glancesProcPid', 'PID'], sort: 'ascending' },
        { key: 'user', label: ['dashboard.glancesProcUser', 'User'] },
        { key: 'cpu', label: ['dashboard.glancesProcCpu', 'CPU'], sort: 'descending' },
        { key: 'mem', label: ['dashboard.glancesProcMem', 'RAM'], sort: 'descending' },
        { key: 'status', label: ['dashboard.glancesProcStatus', 'Status'] },
        { key: 'threads', label: ['dashboard.glancesProcThreads', 'Threads'] },
    ];

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    class GlancesProcesses {
        constructor(view) {
            this.view = view;
            this.sort = 'cpu';
            this.query = '';
            /** pid -> command line text, or null while it is being asked for. */
            this.expanded = new Map();
            this.rows = [];
            this.container = null;
            this._searchTimer = null;
        }

        path() {
            const q = this.query ? `&q=${encodeURIComponent(this.query)}` : '';
            return `processlist?sort=${this.sort}${q}`;
        }

        endpoints() {
            return [this.path()];
        }

        destroy() {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }

        build(container) {
            const v = this.view;
            this.container = container;
            const bar = el('div', 'glances-proc-bar');
            const search = el('input', 'glances-proc-search');
            search.type = 'search';
            search.setAttribute('data-glances-search', '');
            const label = v.t('dashboard.glancesProcSearch', 'Search processes');
            search.placeholder = label;
            search.setAttribute('aria-label', label);
            search.autocomplete = 'off';
            search.spellcheck = false;
            search.addEventListener('input', () => {
                clearTimeout(this._searchTimer);
                this._searchTimer = setTimeout(() => {
                    this._searchTimer = null;
                    const next = search.value.trim();
                    if (next === this.query) return;
                    this.query = next;
                    void v.refresh({ force: true });
                }, SEARCH_DELAY_MS);
            });
            const note = el('span', 'glances-proc-note',
                v.t('dashboard.glancesProcTopNote', 'The top {count} by the chosen sort', { count: LIMIT }));
            note.setAttribute('data-glances-top-note', '');
            bar.append(search, note);

            this.message = el('p', 'glances-proc-message');
            this.message.hidden = true;

            this.table = el('table', 'glances-proc-table');
            this.table.setAttribute('data-glances-procs', '');
            const head = el('thead');
            const tr = el('tr');
            this.heads = new Map();
            COLUMNS.forEach((col) => {
                const th = el('th', `glances-proc-head glances-proc-head--${col.key}`);
                th.scope = 'col';
                const text = v.t(col.label[0], col.label[1]);
                if (col.sort) {
                    th.setAttribute('data-glances-sort', col.key);
                    const btn = el('button', 'glances-proc-sort', text);
                    btn.type = 'button';
                    th.appendChild(btn);
                    th.addEventListener('click', () => this.sortBy(col.key));
                    this.heads.set(col.key, th);
                } else {
                    th.textContent = text;
                }
                tr.appendChild(th);
            });
            head.appendChild(tr);
            this.tbody = el('tbody');
            this.table.append(head, this.tbody);
            this.syncHeads();
            container.replaceChildren(bar, this.message, this.table);
        }

        sortBy(key) {
            if (key === this.sort) return;
            this.sort = key;
            this.syncHeads();
            void this.view.refresh({ force: true });
        }

        syncHeads() {
            COLUMNS.forEach((col) => {
                const th = this.heads?.get(col.key);
                if (!th) return;
                if (col.key === this.sort) th.setAttribute('aria-sort', col.sort);
                else th.removeAttribute('aria-sort');
            });
        }

        render(container, data) {
            const G = window.DashboardGlances;
            if (this.container !== container || !this.table?.isConnected) this.build(container);
            const answer = Object.prototype.hasOwnProperty.call(data, this.path()) ? data[this.path()] : Object.values(data)[0];
            if (G.isUnavailable(answer) || !Array.isArray(answer)) {
                this.rows = [];
                this.message.textContent = G.isUnavailable(answer)
                    ? this.view.t('dashboard.glancesNotAvailable', 'Not available on this host.')
                    : this.view.t('dashboard.glancesErrUnreachable', 'Glances does not answer at that address.');
                this.message.hidden = false;
                this.table.hidden = true;
                return;
            }
            this.rows = answer;
            this.table.hidden = false;
            if (!answer.length) {
                this.message.textContent = this.view.t('dashboard.glancesProcNone', 'No process matches.');
                this.message.hidden = false;
            } else {
                this.message.hidden = true;
            }
            this.drawRows();
        }

        drawRows() {
            const G = window.DashboardGlances;
            const v = this.view;
            const pct = (n) => (n === null ? G.DASH : `${n.toFixed(1)}%`);
            const text = (s) => (typeof s === 'string' && s ? s : G.DASH);
            const seen = new Set();
            const out = [];
            this.rows.forEach((row) => {
                const pid = G.num(row?.pid);
                if (pid === null) return;
                seen.add(pid);
                const open = this.expanded.has(pid);
                const tr = el('tr', 'glances-proc-row');
                tr.setAttribute('data-glances-pid', String(pid));

                const nameCell = el('td', 'glances-proc-cell--name');
                const toggle = el('button', 'glances-proc-expand');
                toggle.type = 'button';
                toggle.setAttribute('data-glances-expand', '');
                toggle.setAttribute('aria-expanded', String(open));
                toggle.setAttribute('aria-label', open
                    ? v.t('dashboard.glancesProcCollapse', 'Hide command line')
                    : v.t('dashboard.glancesProcExpand', 'Show command line'));
                toggle.textContent = open ? '▾' : '▸';
                toggle.addEventListener('click', () => this.toggle(pid));
                nameCell.append(toggle, el('span', 'glances-proc-name', text(row.name)));

                const threads = G.num(row.num_threads);
                tr.append(
                    nameCell,
                    el('td', 'glances-proc-cell--pid', String(pid)),
                    el('td', 'glances-proc-cell--user', text(row.username)),
                    el('td', 'glances-proc-cell--cpu', pct(G.num(row.cpu_percent))),
                    el('td', 'glances-proc-cell--mem', pct(G.num(row.memory_percent))),
                    el('td', 'glances-proc-cell--status', text(row.status)),
                    el('td', 'glances-proc-cell--threads', threads === null ? G.DASH : String(threads)),
                );
                out.push(tr);

                if (open) {
                    const more = el('tr', 'glances-proc-cmd');
                    const cell = el('td');
                    cell.colSpan = COLUMNS.length;
                    const cmd = this.expanded.get(pid);
                    if (cmd === null) {
                        cell.appendChild(el('span', 'glances-proc-wait', v.t('dashboard.glancesLoading', 'Loading…')));
                    } else if (cmd) {
                        const code = el('code', 'glances-proc-cmdline', cmd);
                        code.setAttribute('data-glances-cmdline', '');
                        cell.appendChild(code);
                    } else {
                        cell.appendChild(el('span', 'glances-proc-wait',
                            v.t('dashboard.glancesProcCmdNone', 'No command line for this process.')));
                    }
                    more.appendChild(cell);
                    out.push(more);
                }
            });
            // A process that left the list forgets its command line.
            [...this.expanded.keys()].forEach((pid) => { if (!seen.has(pid)) this.expanded.delete(pid); });
            this.tbody.replaceChildren(...out);
        }

        async toggle(pid) {
            if (this.expanded.has(pid)) {
                this.expanded.delete(pid);
                this.drawRows();
                return;
            }
            this.expanded.set(pid, null);
            this.drawRows();
            const res = await this.view.fetchPath(`processes/${pid}`);
            if (!this.expanded.has(pid)) return;
            const cmd = res.kind === 'ok' ? res.body?.cmdline : null;
            const textValue = Array.isArray(cmd) ? cmd.map(String).join(' ').trim()
                : (typeof cmd === 'string' ? cmd.trim() : '');
            this.expanded.set(pid, textValue);
            if (this.tbody?.isConnected) this.drawRows();
        }
    }

    window.DashboardGlancesSections.register({
        id: 'processes',
        label: 'Processes',
        labelKey: 'dashboard.glancesSectionProcesses',
        order: 20,
        plugin: 'processlist',
        Section: GlancesProcesses,
    });
}());
