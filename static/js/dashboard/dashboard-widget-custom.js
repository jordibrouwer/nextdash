/**
 * The custom widget: figures out of any JSON endpoint.
 *
 * The one tile that reads from outside, and the reason there is no widget per
 * service. Everything it needs the server already did — fetching, signing in,
 * pulling values out by path, formatting them — because a key sent from the
 * browser is a key handed to every script on the page, and a LAN service cannot
 * be reached across origins anyway.
 *
 * So this draws what came back and says plainly when nothing did.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /**
     * One answer per widget, kept for as long as the widget asked for.
     *
     * The server caches too, on its own TTL; this stops a repaint — a health
     * figure arriving, a drag ending — from being a round trip at all.
     */
    async function load(dash, widget, pageId) {
        dash._widgetCustom = dash._widgetCustom || {};
        const key = `${pageId}:${widget.id}`;
        const held = dash._widgetCustom[key];
        if (held && held.until > Date.now()) return held.result;
        try {
            const res = await fetch(`/api/widgets/custom?pageId=${encodeURIComponent(pageId)}`
                + `&id=${encodeURIComponent(widget.id)}`);
            if (!res.ok) return null;
            const result = await res.json();
            const ttl = Math.max(Number(widget?.config?.ttl) || 300, 30) * 1000;
            dash._widgetCustom[key] = { result, until: Date.now() + ttl };
            return result;
        } catch (_error) {
            return null;
        }
    }

    function say(body, className, text) {
        body.replaceChildren();
        const line = document.createElement('p');
        line.className = className;
        line.textContent = text;
        body.appendChild(line);
    }

    async function render(body, widget, dash) {
        const pageId = Number(dash?.currentPageId) || Number(dash?.pages?.[0]?.id) || 1;
        say(body, 'dashboard-widget-waiting', label(dash, 'dashboard.widgetCustomWaiting', 'Loading…'));

        const result = await load(dash, widget, pageId);
        if (!result) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetCustomUnreachable', 'Could not reach that service.'));
            return;
        }
        if (result.error) {
            // The server's own words: it knows whether the address was refused,
            // the service answered 500, or the answer was not JSON, and each
            // sends the reader somewhere different.
            say(body, 'dashboard-widget-empty', String(result.error));
            return;
        }

        const values = Array.isArray(result.values) ? result.values : [];
        const items = Array.isArray(result.items) ? result.items : [];
        if (!values.length && !items.length) {
            say(body, 'dashboard-widget-empty',
                label(dash, 'dashboard.widgetCustomNothing', 'Nothing to show yet — add a field.'));
            return;
        }

        body.replaceChildren();

        if (values.length) {
            const figures = document.createElement('div');
            figures.className = 'dashboard-widget-figures';
            values.forEach((entry) => {
                const cell = document.createElement('div');
                cell.className = 'dashboard-widget-figure';
                // A path that stopped matching is marked rather than blank: a
                // blank reads like a zero, and zero is a fact.
                if (entry?.missing) cell.classList.add('is-missing');

                const value = document.createElement('span');
                value.className = 'dashboard-widget-figure-value';
                value.textContent = String(entry?.value ?? '—');

                const name = document.createElement('span');
                name.className = 'dashboard-widget-figure-label';
                name.textContent = String(entry?.label || '');

                if (entry?.missing) {
                    cell.title = label(dash, 'dashboard.widgetCustomMissing',
                        'This value was not in the answer.');
                }
                cell.append(value, name);
                figures.appendChild(cell);
            });
            body.appendChild(figures);
        }

        if (items.length) {
            const list = document.createElement('div');
            list.className = 'dashboard-widget-rows';
            items.forEach((item) => {
                const row = document.createElement('div');
                row.className = 'dashboard-widget-row';
                const name = document.createElement('span');
                name.className = 'dashboard-widget-row-name';
                name.textContent = String(item);
                row.appendChild(name);
                list.appendChild(row);
            });
            body.appendChild(list);
        }

        if (Number(result.fetchedAt) > 0) {
            const age = document.createElement('p');
            age.className = 'dashboard-widget-asof';
            // Said, because a cached figure that looks live is worse than a
            // stale one that admits it.
            age.textContent = label(dash, 'dashboard.widgetCustomAsOf', 'as of {time}')
                .replace('{time}', new Date(Number(result.fetchedAt)).toLocaleTimeString());
            body.appendChild(age);
        }
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.custom = render;
})();
