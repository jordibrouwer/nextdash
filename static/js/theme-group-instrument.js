/*
 * The instrument theme group: the data is in the row.
 *
 * While an instrument-* theme is active every bookmark row that has something
 * to read gets a small gauge -- a trace of its health history and a thin ping
 * bar with the number beside it -- and every category head gets an up/total
 * count and a segmented meter.
 *
 * Nothing here is measured again. The history is the heartbeat the health
 * facts already carry (HealthFacts, filled by the one request the dashboard
 * makes for its badge), the ping is what the status monitor cached, and the
 * state is the status class the row already wears. A row with none of those
 * gets no gauge at all rather than an empty or invented one.
 *
 * It all hangs off html[data-theme], like the holiday layers: switching away
 * removes every node this file added, and nothing runs while the theme is
 * not active. The gauge is absolutely positioned and ignores the pointer, so
 * the row's grid, its click target, keyboard selection and the shortcut
 * letters stay exactly as the Rows settings made them.
 */
(function () {
    'use strict';

    const PREFIX = 'instrument-';
    const NS = 'http://www.w3.org/2000/svg';
    // A ping at or above this fills the bar; the scale is a screen's worth of
    // patience, not a statistic.
    const PING_FULL_MS = 600;
    // Slow enough to be worth an amber warning; the cockpit paints it.
    const SLOW_MS = 300;
    const REFRESH_MS = 20000;

    let active = false;
    let observer = null;
    let timer = 0;
    let frame = 0;
    let factsAsked = false;

    function isActiveTheme() {
        return String(document.documentElement.getAttribute('data-theme') || '').startsWith(PREFIX);
    }

    function factsFor(url) {
        return window.HealthFacts && typeof window.HealthFacts.get === 'function'
            ? window.HealthFacts.get(url)
            : null;
    }

    function cachedStatus(url) {
        const monitor = window.dashboardInstance && window.dashboardInstance.statusMonitor;
        if (!monitor || !monitor.statusCache) return null;
        const key = typeof statusCacheKey === 'function' ? statusCacheKey(url) : '';
        return key ? monitor.statusCache.get(key) || null : null;
    }

    /*
     * One row's readings, or null when there is nothing honest to draw.
     * `state` is up | down | unknown; it feeds the category meter as well.
     */
    function readRow(row) {
        const url = row.getAttribute('data-bookmark-url') || '';
        const facts = factsFor(url);
        const beats = facts && Array.isArray(facts.heartbeat)
            ? facts.heartbeat.filter((s) => s !== 'empty').length ? facts.heartbeat : []
            : [];
        const cached = cachedStatus(url);
        const ping = cached && cached.status === 'online' && Number(cached.ping) > 0 ? Math.round(Number(cached.ping)) : 0;

        let state = 'unknown';
        if (row.classList.contains('status-offline')) state = 'down';
        else if (row.classList.contains('status-online')) state = 'up';
        else if (beats.length) {
            const last = [...beats].reverse().find((s) => s !== 'empty');
            state = last === 'down' ? 'down' : last === 'up' || last === 'degraded' ? 'up' : 'unknown';
        }
        return { beats, ping, state, signature: `${state}|${ping}|${beats.join(',')}` };
    }

    /*
     * The history twice, from the same beats: a line (the oscilloscope and the
     * dive computer read a trace) and a row of bars (the cockpit reads a
     * histogram). Both are stretched to whatever box the family gives them, so
     * the stroke is non-scaling and no shape here assumes a size. CSS shows
     * the one a family wants.
     */
    const LEVEL = { up: 3, degraded: 10, down: 17 };

    function svgBox(cls) {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', cls);
        svg.setAttribute('viewBox', '0 0 100 20');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        return svg;
    }

    function trace(beats) {
        const step = beats.length > 1 ? 100 / (beats.length - 1) : 0;
        let d = '';
        let pen = false;
        beats.forEach((s, i) => {
            if (!(s in LEVEL)) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${(i * step).toFixed(1)} ${LEVEL[s]} `;
            pen = true;
        });
        const svg = svgBox('ig-spark');
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d.trim());
        path.setAttribute('class', 'ig-trace');
        svg.appendChild(path);
        return svg;
    }

    function histogram(beats) {
        const w = 100 / beats.length;
        const svg = svgBox('ig-hist');
        beats.forEach((s, i) => {
            if (!(s in LEVEL)) return;
            const rect = document.createElementNS(NS, 'rect');
            const h = s === 'up' ? 9 : s === 'degraded' ? 14 : 20;
            rect.setAttribute('x', (i * w).toFixed(2));
            rect.setAttribute('y', String(20 - h));
            rect.setAttribute('width', Math.max(w - 0.8, 0.6).toFixed(2));
            rect.setAttribute('height', String(h));
            rect.setAttribute('data-s', s);
            svg.appendChild(rect);
        });
        return svg;
    }

    function buildGauge(reading) {
        const gauge = document.createElement('span');
        gauge.className = 'ig-gauge';
        gauge.setAttribute('aria-hidden', 'true');
        gauge.setAttribute('data-ig-state', reading.state);
        if (reading.ping >= SLOW_MS) gauge.setAttribute('data-ig-slow', '');
        if (reading.beats.length) gauge.append(trace(reading.beats), histogram(reading.beats));
        if (reading.ping) {
            const ms = document.createElement('span');
            ms.className = 'ig-ms';
            ms.textContent = `${reading.ping}ms`;
            const bar = document.createElement('span');
            bar.className = 'ig-bar';
            const fill = document.createElement('i');
            fill.style.width = `${Math.min(100, Math.round((reading.ping / PING_FULL_MS) * 100))}%`;
            bar.appendChild(fill);
            gauge.append(ms, bar);
        }
        return gauge;
    }

    function decorateRow(row) {
        const reading = readRow(row);
        const hasGauge = reading.beats.length > 0 || reading.ping > 0;
        const existing = row.querySelector(':scope > .ig-gauge');
        if (!hasGauge) {
            if (existing) existing.remove();
            row.querySelectorAll(':scope > .ig-edge').forEach((el) => el.remove());
            row.removeAttribute('data-ig');
            row.removeAttribute('data-ig-sig');
            row.setAttribute('data-ig-state', reading.state);
            return reading.state;
        }
        row.setAttribute('data-ig-state', reading.state);
        if (existing && row.getAttribute('data-ig-sig') === reading.signature) return reading.state;
        if (existing) existing.remove();
        row.querySelectorAll(':scope > .ig-edge').forEach((el) => el.remove());
        row.setAttribute('data-ig', '');
        row.setAttribute('data-ig-sig', reading.signature);
        row.appendChild(buildGauge(reading));
        // The dive computer's depth scale reads one marker per measured row.
        const edge = document.createElement('span');
        edge.className = 'ig-edge';
        edge.setAttribute('aria-hidden', 'true');
        row.appendChild(edge);
        return reading.state;
    }

    /*
     * The dive computer's up/total gauge: a ring cut into one arc per
     * bookmark, lit by the state the row reported. Unmeasured rows are dim
     * arcs, so the ring never claims more than is known.
     */
    function ring(states) {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'ig-ring');
        svg.setAttribute('viewBox', '-20 -20 40 40');
        svg.setAttribute('aria-hidden', 'true');
        const n = states.length;
        const gap = Math.min(0.12, 0.5 / n);
        const arc = (a0, a1) => {
            const pt = (a) => `${(16 * Math.sin(a)).toFixed(2)} ${(-16 * Math.cos(a)).toFixed(2)}`;
            return `M${pt(a0)} A16 16 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${pt(a1)}`;
        };
        states.forEach((s, i) => {
            const a0 = (i / n) * 2 * Math.PI + gap / 2;
            const a1 = ((i + 1) / n) * 2 * Math.PI - gap / 2;
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', arc(a0, Math.max(a1, a0 + 0.02)));
            path.setAttribute('data-s', s);
            svg.appendChild(path);
        });
        return svg;
    }

    function decorateCategory(category, states) {
        const title = category.querySelector(':scope > .category-title');
        if (!title) return;
        const trailing = title.querySelector('.category-title-trailing') || title;
        const known = states.filter((s) => s !== 'unknown').length;
        const up = states.filter((s) => s === 'up').length;
        const signature = states.join(',');
        if (title.getAttribute('data-ig-sig') === signature && title.querySelector('.ig-meter, .ig-count')) return;
        title.querySelectorAll('.ig-meter, .ig-count, .ig-ring').forEach((el) => el.remove());
        title.setAttribute('data-ig-sig', signature);
        if (!known) return;

        const count = document.createElement('span');
        count.className = 'ig-count';
        count.setAttribute('aria-hidden', 'true');
        count.textContent = `${up}/${known}`;
        count.title = `${up} of ${known} checked bookmarks up`;
        trailing.insertBefore(count, trailing.firstChild);

        const meter = document.createElement('span');
        meter.className = 'ig-meter';
        meter.setAttribute('aria-hidden', 'true');
        states.forEach((s) => {
            const seg = document.createElement('i');
            seg.setAttribute('data-s', s);
            meter.appendChild(seg);
        });
        title.appendChild(meter);
        trailing.insertBefore(ring(states), trailing.firstChild);
    }

    function refresh() {
        frame = 0;
        if (!active) return;
        // The observer would otherwise see this pass's own insertions and
        // schedule another; one pass is idempotent, so it settles on its own,
        // but there is no reason to listen to ourselves.
        if (observer) observer.disconnect();
        document.querySelectorAll('.category').forEach((category) => {
            if (category.getAttribute('data-smart-collection') === 'true') return;
            const rows = category.querySelectorAll('.bookmarks-list .bookmark-link[data-bookmark-url]');
            const states = [...rows].map(decorateRow);
            decorateCategory(category, states);
        });
        // Smart collections get gauges on their rows but no meter: their head
        // is a question, not a group.
        document.querySelectorAll('.category[data-smart-collection="true"] .bookmark-link[data-bookmark-url]')
            .forEach(decorateRow);
        observe();
    }

    function schedule() {
        if (!active || frame) return;
        frame = window.requestAnimationFrame(refresh);
    }

    function observe() {
        const root = document.querySelector('main') || document.body;
        if (!root) return;
        if (!observer) {
            observer = new MutationObserver(schedule);
        }
        observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    // The facts are normally in before the theme is: the dashboard asks for
    // them on load. If this theme was picked on a page that never did, ask
    // once, through the same call, and cache what comes back.
    function ensureFacts() {
        if (factsAsked) return;
        factsAsked = true;
        const utils = window.HealthBadgeUtils;
        const facts = window.HealthFacts;
        if (facts && facts.updatedAt) return;
        if (utils && typeof utils.fetchBookmarkHealthSummary === 'function') {
            Promise.resolve(utils.fetchBookmarkHealthSummary()).then(schedule).catch(() => {});
        }
    }

    function clear() {
        document.querySelectorAll('.ig-gauge, .ig-edge, .ig-meter, .ig-count, .ig-ring').forEach((el) => el.remove());
        document.querySelectorAll('[data-ig], [data-ig-sig], [data-ig-state]').forEach((el) => {
            el.removeAttribute('data-ig');
            el.removeAttribute('data-ig-sig');
            el.removeAttribute('data-ig-state');
        });
    }

    function start() {
        if (active) return;
        active = true;
        factsAsked = false;
        ensureFacts();
        refresh();
        // Cached pings and the heartbeat move without touching the DOM, so
        // nothing would tell the observer; a slow re-read does.
        timer = window.setInterval(schedule, REFRESH_MS);
    }

    function stop() {
        if (!active) return;
        active = false;
        if (observer) observer.disconnect();
        observer = null;
        window.clearInterval(timer);
        timer = 0;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0;
        clear();
    }

    function apply() {
        if (isActiveTheme()) start();
        else stop();
    }

    function boot() {
        apply();
        new MutationObserver(apply).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }

    window.NDInstrument = { apply };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
