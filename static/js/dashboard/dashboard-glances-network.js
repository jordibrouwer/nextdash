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

        render(container, data) {
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
            container.replaceChildren(...parts);
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
            const table = el('table', 'glances-table');
            const tbody = el('tbody');
            rows.forEach((r) => {
                const name = str(r?.interface_name);
                const speed = G.num(r?.speed);
                const up = r?.is_up;
                const tr = el('tr');
                tr.setAttribute('data-glances-iface', name);
                tr.append(
                    el('td', 'glances-net-cell--name', name || G.DASH),
                    el('td', 'glances-net-cell glances-net-cell--rx', rate(G.num(r?.bytes_recv_rate_per_sec))),
                    el('td', 'glances-net-cell glances-net-cell--tx', rate(G.num(r?.bytes_sent_rate_per_sec))),
                    // Glances reports the link speed in bits per second; 0 means it does not know.
                    el('td', 'glances-net-cell glances-net-cell--speed', speed ? this.speedText(speed) : G.DASH),
                    el('td', 'glances-net-cell glances-net-cell--state', up === true
                        ? v.t('dashboard.glancesNetUp', 'up')
                        : (up === false ? v.t('dashboard.glancesNetDown', 'down') : G.DASH)),
                );
                tbody.appendChild(tr);
            });
            table.append(headRow([
                v.t('dashboard.glancesNetName', 'Interface'),
                v.t('dashboard.glancesNetRx', 'Download'),
                v.t('dashboard.glancesNetTx', 'Upload'),
                v.t('dashboard.glancesNetSpeed', 'Speed'),
                v.t('dashboard.glancesNetState', 'State'),
            ]), tbody);
            section.appendChild(table);
            return section;
        }

        speedText(bps) {
            const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s', 'Tbit/s'];
            let n = bps;
            let i = 0;
            while (n >= 1000 && i < units.length - 1) {
                n /= 1000;
                i += 1;
            }
            return `${Number.isInteger(n) ? n : n.toFixed(1)} ${units[i]}`;
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
