/**
 * The trend widget: broken links over time.
 *
 * One number cannot say whether a collection is rotting or recovering — "twelve
 * broken" reads the same on the way up as on the way down. The line can, and
 * that is the whole reason this tile is a line and not a figure.
 *
 * Not filterable by page or tag. The trend is the collection's, and a filtered
 * line would answer a question nobody asked while looking exactly like the one
 * that answers the real one.
 */
(function () {
    'use strict';

    function label(dash, key, fallback) {
        const value = dash?.language?.t?.(key);
        return value && value !== key ? value : fallback;
    }

    /*
     * Every recorded day, once.
     *
     * The route takes no window — checked, rather than assumed: it answers with
     * whatever it has recorded, so sending ?days= would look like a filter and
     * be ignored. The window is applied here instead, and one fetch serves every
     * trend tile on the page whatever each is set to.
     */
    async function load(dash) {
        if (dash._widgetTrend) return dash._widgetTrend;
        try {
            const res = await fetch('/api/health/trend');
            if (!res.ok) return null;
            const data = await res.json();
            dash._widgetTrend = Array.isArray(data?.points) ? data.points : [];
            return dash._widgetTrend;
        } catch (_error) {
            return null;
        }
    }

    /*
     * The line, drawn on a canvas sized to its box.
     *
     * Canvas rather than an SVG path built by hand: the shape is the point, and
     * long path data is where a rendering bug hides in plain sight.
     */
    function draw(canvas, values, tone) {
        const width = canvas.width;
        const height = canvas.height;
        const ctx = canvas.getContext('2d');
        if (!ctx || !values.length) return;
        ctx.clearRect(0, 0, width, height);

        // A flat line at zero should sit on the floor, not fill the box, so the
        // scale starts at zero rather than at the lowest value.
        const peak = Math.max(1, ...values);
        const step = values.length > 1 ? width / (values.length - 1) : width;
        const y = (value) => height - 2 - (value / peak) * (height - 4);

        ctx.beginPath();
        values.forEach((value, index) => {
            const x = index * step;
            if (index === 0) ctx.moveTo(x, y(value));
            else ctx.lineTo(x, y(value));
        });
        ctx.strokeStyle = tone;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // A faint fill under the line, so the shape reads at a glance rather
        // than only where the eye follows the stroke.
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    async function render(body, widget, dash) {
        body.replaceChildren();
        const days = Math.min(Math.max(Number(widget?.config?.days) || 30, 7), 90);
        const all = await load(dash);
        // Newest last, so the window is the tail.
        const points = Array.isArray(all) ? all.slice(-days) : all;

        if (!points) {
            const waiting = document.createElement('p');
            waiting.className = 'dashboard-widget-waiting';
            waiting.textContent = label(dash, 'dashboard.widgetTrendWaiting', 'Loading…');
            body.appendChild(waiting);
            return;
        }
        if (points.length < 2) {
            const empty = document.createElement('p');
            empty.className = 'dashboard-widget-empty';
            // One day is not a trend, and saying so beats drawing a dot.
            empty.textContent = label(dash, 'dashboard.widgetTrendTooEarly',
                'Not enough history yet — a trend needs a few days.');
            body.appendChild(empty);
            return;
        }

        // b and d are omitempty, so a day with nothing broken has no key at all.
        const values = points.map((point) => (Number(point?.b) || 0) + (Number(point?.d) || 0));
        const latest = values[values.length - 1];
        const earliest = values[0];

        const figure = document.createElement('div');
        figure.className = 'dashboard-widget-trend';

        const value = document.createElement('span');
        value.className = 'dashboard-widget-trend-value';
        value.textContent = String(latest);

        const change = document.createElement('span');
        change.className = 'dashboard-widget-trend-change';
        const delta = latest - earliest;
        // The direction is the message. Fewer broken links is good news even
        // when the number itself is still high.
        change.classList.add(delta > 0 ? 'is-worse' : delta < 0 ? 'is-better' : 'is-level');
        change.textContent = delta === 0
            ? label(dash, 'dashboard.widgetTrendLevel', 'no change')
            : `${delta > 0 ? '+' : ''}${delta}`;
        change.title = label(dash, 'dashboard.widgetTrendOver', 'over {n} days')
            .replace('{n}', String(days));

        const canvas = document.createElement('canvas');
        canvas.className = 'dashboard-widget-trend-line';
        canvas.width = 220;
        canvas.height = 40;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', label(dash, 'dashboard.widgetTrendAria',
            'Broken links over {n} days').replace('{n}', String(days)));

        figure.append(value, change, canvas);
        body.appendChild(figure);

        // Read after appending: a colour token resolves against the theme in
        // force, and before the node is in the document there is none.
        const tone = getComputedStyle(figure)
            .getPropertyValue(delta > 0 ? '--status-error' : '--status-success').trim()
            || getComputedStyle(figure).color;
        draw(canvas, values, tone);
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.trend = render;
})();
