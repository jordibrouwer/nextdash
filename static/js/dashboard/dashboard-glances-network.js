/**
 * Glances view, Network: rates per interface, plus connection counts and wifi
 * when the host runs those plugins and they answered.
 *
 * A rate Glances did not send (it needs two reads to compute one) is a dash,
 * never 0.
 */
(function () {
    'use strict';

    /** The connection counters worth a line, in this order. */
    const CONNECTION_KEYS = ['ESTABLISHED', 'LISTEN', 'SYN_SENT', 'SYN_RECV', 'initiated', 'terminated'];

    function el(tag, className, content) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (content !== undefined) node.textContent = content;
        return node;
    }

    function str(value) {
        return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
    }

    function headRow(labels) {
        const tr = el('tr');
        labels.forEach((label) => {
            const th = el('th', '', label);
            th.scope = 'col';
            tr.appendChild(th);
        });
        const thead = el('thead');
        thead.appendChild(tr);
        return thead;
    }

    class GlancesNetwork {
        constructor(view) {
            this.view = view;
        }

        endpoints() {
            const plugins = this.view.plugins;
            const list = ['network'];
            ['connections', 'wifi'].forEach((p) => {
                if (!plugins || plugins.has(p)) list.push(p);
            });
            return list;
        }

        redraw() {
            if (this._last) this.render(this._last.container, this._last.data);
        }

        render(container, data) {
            this._last = { container, data };
            const G = window.DashboardGlances;
            const parts = [];
            const ifaces = G.usable(data.network);
            if (Array.isArray(ifaces) && ifaces.length) parts.push(this.interfaces(ifaces));
            const conns = this.connections(G.usable(data.connections));
            if (conns) parts.push(conns);
            const wifi = this.wifi(G.usable(data.wifi));
            if (wifi) parts.push(wifi);
            if (!parts.length) {
                parts.push(el('p', 'glances-note', this.view.t('dashboard.glancesNotAvailable', 'Not available on this host.')));
            }
            window.DashboardGlancesTable.keepSortFocus(container, () => container.replaceChildren(...parts));
        }

        block(kind, title) {
            const section = el('section', 'glances-block');
            section.setAttribute('data-glances-block', kind);
            section.appendChild(el('h3', 'glances-block-title', title));
            return section;
        }

        interfaces(rows) {
            const G = window.DashboardGlances;
            const v = this.view;
            const rate = (n) => (n === null ? G.DASH : `${G.formatBytes(n)}/s`);
            const section = this.block('interfaces', v.t('dashboard.glancesNetInterfaces', 'Interfaces'));
            const list = rows.filter((r) => r && typeof r === 'object');
            const Tip = window.DashboardGlancesTip;
            const spec = window.DashboardGlancesSpecs?.iface || [];
            section.appendChild(window.DashboardGlancesTable.build({
                id: 'network-interfaces',
                t: (k, f, p) => v.t(k, f, p),
                rerender: () => this.redraw?.(),
                initial: { key: 'rx', dir: 'desc' },
                rows: list,
                columns: [
                    { key: 'name', label: ['dashboard.glancesNetName', 'Interface'], numeric: false, cellClass: 'glances-net-cell--name', value: (r) => str(r.interface_name) },
                    { key: 'rx', label: ['dashboard.glancesNetRx', 'Download'], cellClass: 'glances-net-cell glances-net-cell--rx',
                        value: (r) => G.num(r.bytes_recv_rate_per_sec), cell: (r) => rate(G.num(r.bytes_recv_rate_per_sec)) },
                    { key: 'tx', label: ['dashboard.glancesNetTx', 'Upload'], cellClass: 'glances-net-cell glances-net-cell--tx',
                        value: (r) => G.num(r.bytes_sent_rate_per_sec), cell: (r) => rate(G.num(r.bytes_sent_rate_per_sec)) },
                    // Glances reports the link speed as Mbit/s times 1,048,576; 0 means it does not know.
                    { key: 'speed', label: ['dashboard.glancesNetSpeed', 'Speed'], cellClass: 'glances-net-cell glances-net-cell--speed',
                        value: (r) => G.num(r.speed), cell: (r) => (G.num(r.speed) ? this.speedText(G.num(r.speed)) : G.DASH) },
                    { key: 'state', label: ['dashboard.glancesNetState', 'State'], numeric: false, cellClass: 'glances-net-cell glances-net-cell--state',
                        value: (r) => (r.is_up === true ? 'up' : (r.is_up === false ? 'down' : null)),
                        cell: (r) => (r.is_up === true ? v.t('dashboard.glancesNetUp', 'up')
                            : (r.is_up === false ? v.t('dashboard.glancesNetDown', 'down') : G.DASH)) },
                ],
                rowHook: (tr, r) => {
                    const name = str(r.interface_name);
                    tr.setAttribute('data-glances-iface', name);
                    if (typeof v.tip === 'function' && Tip) {
                        v.tip(tr, `net:${name}`, () => Tip.describe(v, name, r, spec));
                    }
                },
            }));
            return section;
        }

        /** The speed Glances reports is Mbit/s times 1,048,576. */
        speedText(raw) {
            const mbit = raw / 1048576;
            if (mbit >= 1000) return `${Number((mbit / 1000).toFixed(1))} Gbit/s`;
            return `${Math.round(mbit)} Mbit/s`;
        }

        /** Counts per state; null when the plugin sent no number at all. */
        connections(body) {
            const G = window.DashboardGlances;
            if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
            const found = CONNECTION_KEYS.map((k) => [k, G.num(body[k])]).filter(([, n]) => n !== null);
            if (!found.length) return null;
            const section = this.block('connections', this.view.t('dashboard.glancesNetConnections', 'Connections'));
            const list = el('dl', 'glances-pairs');
            found.forEach(([key, n]) => {
                const item = el('div', 'glances-pair');
                item.setAttribute('data-glances-conn', key);
                item.append(el('dt', '', key), el('dd', '', String(n)));
                list.appendChild(item);
            });
            section.appendChild(list);
            return section;
        }

        wifi(body) {
            const G = window.DashboardGlances;
            const v = this.view;
            if (!Array.isArray(body) || !body.length) return null;
            const section = this.block('wifi', v.t('dashboard.glancesNetWifi', 'Wi-Fi'));
            const table = el('table', 'glances-table');
            const tbody = el('tbody');
            body.forEach((r) => {
                const signal = G.num(r?.signal);
                const tr = el('tr');
                tr.append(
                    el('td', '', str(r?.interface_name) || G.DASH),
                    el('td', '', str(r?.ssid) || G.DASH),
                    el('td', '', signal === null ? G.DASH : `${signal} dBm`),
                );
                tbody.appendChild(tr);
            });
            table.append(headRow([
                v.t('dashboard.glancesNetName', 'Interface'),
                v.t('dashboard.glancesWifiSsid', 'Network'),
                v.t('dashboard.glancesWifiSignal', 'Signal'),
            ]), tbody);
            section.appendChild(table);
            return section;
        }
    }

    window.DashboardGlancesSections.register({
        id: 'network',
        label: 'Network',
        labelKey: 'dashboard.glancesSectionNetwork',
        order: 50,
        plugin: 'network',
        Section: GlancesNetwork,
    });
}());
