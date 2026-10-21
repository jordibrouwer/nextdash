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
            /**
             * pid -> command line text ('' when the process has none or ended),
             * null while it is being asked for, or { message } after a failed read.
             */
            this.expanded = new Map();
            /** pid -> { tr, toggle, cells, detail }, reused across polls. */
            this.rowNodes = new Map();
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
            this.rowNodes = new Map();
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

        /**
         * Rows are kept per pid and updated in place: a poll every 5 s must not
         * take away keyboard focus, a screen reader's place or a click on its
         * way. Only rows that came, went or changed place are moved.
         */
        drawRows() {
            const G = window.DashboardGlances;
            const pct = (n) => (n === null ? G.DASH : `${n.toFixed(1)}%`);
            const text = (s) => (typeof s === 'string' && s ? s : G.DASH);
            const focused = document.activeElement;
            const focusedPid = this.tbody.contains(focused)
                ? focused.closest('[data-glances-pid]')?.getAttribute('data-glances-pid') : null;
            const seen = new Set();
            const wanted = [];
            this.rows.forEach((row) => {
                const pid = G.num(row?.pid);
                if (pid === null || seen.has(pid)) return;
                seen.add(pid);
                const entry = this.rowFor(pid);
                const threads = G.num(row.num_threads);
                const set = (key, value) => {
                    if (entry.cells[key].textContent !== value) entry.cells[key].textContent = value;
                };
                set('name', text(row.name));
                set('user', text(row.username));
                set('cpu', pct(G.num(row.cpu_percent)));
                set('mem', pct(G.num(row.memory_percent)));
                set('status', text(row.status));
                set('threads', threads === null ? G.DASH : String(threads));
                this.syncDetail(pid, entry);
                wanted.push(entry.tr);
                if (entry.detail) wanted.push(entry.detail);
            });
            // A process that left the list forgets its row and command line.
            [...this.rowNodes.keys()].forEach((pid) => {
                if (seen.has(pid)) return;
                this.rowNodes.delete(pid);
                this.expanded.delete(pid);
            });
            let ref = this.tbody.firstChild;
            wanted.forEach((node) => {
                if (node === ref) {
                    ref = ref.nextSibling;
                } else {
                    this.tbody.insertBefore(node, ref);
                }
            });
            while (ref) {
                const next = ref.nextSibling;
                ref.remove();
                ref = next;
            }
            // A row that had to move takes its focus with it.
            if (focusedPid && !this.tbody.contains(document.activeElement)) {
                this.rowNodes.get(Number(focusedPid))?.toggle.focus({ preventScroll: true });
            }
        }

        /** The row for one pid, built the first time it is seen. */
        rowFor(pid) {
            const held = this.rowNodes.get(pid);
            if (held) return held;
            const tr = el('tr', 'glances-proc-row');
            tr.setAttribute('data-glances-pid', String(pid));
            const nameCell = el('td', 'glances-proc-cell--name');
            const toggle = el('button', 'glances-proc-expand');
            toggle.type = 'button';
            toggle.setAttribute('data-glances-expand', '');
            toggle.addEventListener('click', () => { void this.toggle(pid); });
            const cells = {
                name: el('span', 'glances-proc-name'),
                user: el('td', 'glances-proc-cell--user'),
                cpu: el('td', 'glances-proc-cell--cpu'),
                mem: el('td', 'glances-proc-cell--mem'),
                status: el('td', 'glances-proc-cell--status'),
                threads: el('td', 'glances-proc-cell--threads'),
            };
            nameCell.append(toggle, cells.name);
            tr.append(nameCell, el('td', 'glances-proc-cell--pid', String(pid)),
                cells.user, cells.cpu, cells.mem, cells.status, cells.threads);
            const entry = { tr, toggle, cells, detail: null, shown: undefined };
            this.rowNodes.set(pid, entry);
            return entry;
        }

        /** The expand button and the command-line row under it, from this.expanded. */
        syncDetail(pid, entry) {
            const v = this.view;
            const open = this.expanded.has(pid);
            const state = open ? this.expanded.get(pid) : undefined;
            if (entry.toggle.getAttribute('aria-expanded') !== String(open)) {
                entry.toggle.setAttribute('aria-expanded', String(open));
                entry.toggle.setAttribute('aria-label', open
                    ? v.t('dashboard.glancesProcCollapse', 'Hide command line')
                    : v.t('dashboard.glancesProcExpand', 'Show command line'));
                entry.toggle.textContent = open ? '▾' : '▸';
            }
            if (!open) {
                entry.detail = null;
                entry.shown = undefined;
                return;
            }
            if (entry.detail && entry.shown === state) return;
            const more = entry.detail || el('tr', 'glances-proc-cmd');
            const cell = el('td');
            cell.colSpan = COLUMNS.length;
            if (state === null) {
                cell.appendChild(el('span', 'glances-proc-wait', v.t('dashboard.glancesLoading', 'Loading…')));
            } else if (typeof state === 'object') {
                // A read that failed says so; it is not a process without a command line.
                cell.appendChild(el('span', 'glances-proc-wait glances-proc-fail', state.message));
            } else if (state) {
                const code = el('code', 'glances-proc-cmdline', state);
                code.setAttribute('data-glances-cmdline', '');
                cell.appendChild(code);
            } else {
                cell.appendChild(el('span', 'glances-proc-wait',
                    v.t('dashboard.glancesProcCmdNone', 'No command line for this process.')));
            }
            more.replaceChildren(cell);
            entry.detail = more;
            entry.shown = state;
        }

        /**
         * Expand asks the server for this one command line; a second press
         * hides it. After a failed read the press asks again instead.
         */
        async toggle(pid) {
            const held = this.expanded.get(pid);
            if (this.expanded.has(pid) && !(held && typeof held === 'object')) {
                this.expanded.delete(pid);
                this.drawRows();
                return;
            }
            this.expanded.set(pid, null);
            this.drawRows();
            // A command line can carry a secret: the server hands it out only with the write token.
            const res = await this.view.fetchPath(`processes/${encodeURIComponent(pid)}`, { auth: true });
            if (!this.expanded.has(pid)) return;
            let value;
            if (res.kind === 'ok') {
                const cmd = res.body?.cmdline;
                value = Array.isArray(cmd) ? cmd.map(String).join(' ').trim()
                    : (typeof cmd === 'string' ? cmd.trim() : '');
            } else if (res.kind === 'unavailable') {
                // The server no longer has this pid: the process ended.
                value = '';
            } else if (res.kind === 'denied') {
                value = { message: this.view.t('dashboard.glancesProcNeedsWrite', 'Needs write access to show the command line.') };
            } else {
                value = { message: this.view.failureText(res) };
            }
            this.expanded.set(pid, value);
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
