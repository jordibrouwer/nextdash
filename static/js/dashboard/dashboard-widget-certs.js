/**
 * The certificates widget: what expires soon, by host.
 *
 * Grouped rather than listed per bookmark, because expiry is a property of the
 * host: ten bookmarks on one domain share one certificate and would otherwise
 * fill the tile with ten copies of the same fact. ping.go says as much where it
 * records CertHost beside CertExpiry, and this follows that rather than
 * repeating the mistake it warns about.
 */
(function () {
    'use strict';

    const DAY = 24 * 60 * 60 * 1000;

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /**
     * The health report holds the certificates.
     *
     * Loaded with the header badge already, so an ordinary dashboard costs no
     * extra request; a tile on a dashboard where health is switched off says it
     * is waiting rather than fetching a report nothing else wants.
     */
    function certificatesFrom(dash) {
        // healthSummary is what the badge stored from ?view=facts, and that
        // response carries the certificates map beside it. The full report is
        // read too, for a dashboard that has one open.
        // HealthFacts keeps what the badge's own request already carried, so an
        // ordinary dashboard load costs this tile nothing.
        const certs = window.HealthFacts?.certificates
            || dash.healthReport?.certificates
            || dash.health?.report?.certificates
            || null;
        // Nothing fetched yet at all: the report arrives with the header badge.
        if (!certs && !dash.healthSummary) return null;
        // An install with no HTTPS check behind it has no certificates at all,
        // and omitempty means the key is simply absent — an empty tile, not a
        // waiting one.
        if (!certs) return [];
        return Object.entries(certs).map(([host, cert]) => ({
            host: String(cert?.host || host),
            // expiresAt, as HostCertificate declares it. 0 means the host was
            // never seen over TLS, which is not an expiry.
            expiry: Number(cert?.expiresAt) || 0,
        })).filter((entry) => entry.expiry > 0);
    }

    function render(body, widget, dash) {
        body.replaceChildren();
        const certs = certificatesFrom(dash);
        if (!certs) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetCertsWaiting', 'Checking…');
            body.appendChild(waiting);
            return;
        }

        const config = widget?.config || {};
        const withinDays = Math.min(Math.max(Number(config.withinDays) || 30, 1), 730);
        const rows = Math.min(Math.max(Number(config.rows) || 5, 1), 20);
        const cutoff = Date.now() + withinDays * DAY;

        const expiring = certs
            .filter((entry) => entry.expiry <= cutoff)
            .sort((a, b) => a.expiry - b.expiry);

        if (!expiring.length) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            // Naming the window matters: "nothing expiring" means nothing
            // within the days that were asked about, not nothing ever.
            empty.textContent = label(dash, 'dashboard.widgetCertsNone',
                'No certificate expires within {n} days.').replace('{n}', String(withinDays));
            body.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'dashboard-widget-rows';

        expiring.slice(0, rows).forEach((entry) => {
            const days = Math.floor((entry.expiry - Date.now()) / DAY);
            const row = document.createElement('button');
            row.type = 'button';
            // Already expired is a different fact from expiring on Friday.
            row.className = `dashboard-widget-row dashboard-widget-row--${days <= 7 ? 'bad' : 'warn'}`;

            const name = document.createElement('span');
            name.className = 'dashboard-widget-row-name';
            name.textContent = entry.host;

            const detail = document.createElement('span');
            detail.className = 'dashboard-widget-row-detail';
            detail.textContent = days < 0
                ? label(dash, 'dashboard.widgetCertsExpired', 'expired')
                : label(dash, 'dashboard.widgetCertsDays', '{n}d').replace('{n}', String(days));
            detail.title = new Date(entry.expiry).toLocaleDateString();

            row.append(name, detail);
            row.addEventListener('click', () => {
                dash.health?.openWithFilter?.('certificates') ?? dash.showView?.('health');
            });
            list.appendChild(row);
        });

        body.appendChild(list);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.certs = render;
})();
