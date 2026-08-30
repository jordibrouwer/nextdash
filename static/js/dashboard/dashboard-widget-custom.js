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

    /*
     * What the preset would have said about the figure in this position.
     *
     * By position rather than by path, because that is what the tile has: the
     * server answers with labels and values, and the paths stayed in the
     * config. The two lists are the same length and in the same order, which
     * is what makes the position a reliable way back to the field.
     */
    function fell(widget, position) {
        const presetId = widget?.config?.presetId;
        if (!presetId) return null;
        const field = (widget?.config?.fields || [])[position];
        if (!field?.path) return null;
        return window.DashboardWidgetPresets?.shapeFor?.(presetId, field.path) || null;
    }

    /*
     * The bar's fill, preferring what the server worked out.
     *
     * It has the number before formatting; this reads the formatted string only
     * when a widget saved before shapes existed asks for a meter the server was
     * never told about.
     */
    function meterShare(entry) {
        const given = Number(entry?.share);
        if (Number.isFinite(given) && given > 0) return given;
        const number = Number(entry?.raw);
        if (!Number.isFinite(number)) return 0;
        const percent = number > 0 && number <= 1 ? number * 100 : number;
        return Math.max(0, Math.min(1, percent / 100));
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

        /*
         * Drawn inside the shared panel, which is what the other tiles use.
         *
         * Not decoration: the panel is a container-query root, so the layout
         * below answers to the width the tile was actually given rather than to
         * the number of columns the dashboard was asked for. A widget set to
         * two columns is narrowed back to one when the dashboard is showing
         * one, and only the panel knows that happened.
         */
        const utils = window.DashboardWidgetUtils;
        const wrap = utils?.panel ? utils.panel(body) : (body.replaceChildren(), body);

        if (values.length) {
            const figures = document.createElement('div');
            figures.className = 'dashboard-widget-figures';
            values.forEach((entry, position) => {
                /*
                 * The reader's own choice, or the preset's, or plain.
                 *
                 * The fallback is what makes a widget saved before shapes
                 * existed look like one saved after: it still records which
                 * preset it came from, and the preset still knows what its own
                 * figures are for. Nothing stored is rewritten to do it.
                 */
                const fallback = fell(widget, position);
                const shape = String(entry?.shape || fallback?.shape || '');
                const tone = String(entry?.tone || fallback?.tone || 'neutral');
                const cell = document.createElement('div');
                cell.className = 'dashboard-widget-figure';
                // A path that stopped matching is marked rather than blank: a
                // blank reads like a zero, and zero is a fact.
                if (entry?.missing) cell.classList.add('is-missing');
                /*
                 * The shape is a class rather than a different element, so a
                 * figure that changes shape keeps everything else about itself
                 * -- and a shape nobody recognises falls back to the plain
                 * figure that every widget drew before shapes existed.
                 */
                if (shape && shape !== 'normal') {
                    cell.classList.add(`dashboard-widget-figure--${shape}`);
                }

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

                /*
                 * The bar goes under the figure, never instead of it.
                 *
                 * A bar says how full something is and cannot say of what, and
                 * the number is the part anyone repeats out loud. The tone is
                 * the field's, because the same ninety per cent is bad news on
                 * a disk and good news on a cache -- and the colour behind that
                 * tone comes from the theme, so it is whatever the reader's
                 * theme says success and trouble look like.
                 *
                 * A missing value keeps its shape and fills nothing: an empty
                 * track reads as no answer, where a full one would read as a
                 * fact nobody reported.
                 */
                if (shape === 'meter' && utils?.meter) {
                    const share = entry?.missing ? 0 : meterShare(entry);
                    cell.appendChild(utils.meter(share, 1, tone));
                }
                figures.appendChild(cell);
            });
            wrap.appendChild(figures);
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
            wrap.appendChild(list);
        }

        if (Number(result.fetchedAt) > 0) {
            const age = document.createElement('p');
            age.className = 'dashboard-widget-asof';
            // Said, because a cached figure that looks live is worse than a
            // stale one that admits it.
            age.textContent = label(dash, 'dashboard.widgetCustomAsOf', 'as of {time}')
                .replace('{time}', new Date(Number(result.fetchedAt)).toLocaleTimeString());
            wrap.appendChild(age);
        }
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.custom = render;
})();
