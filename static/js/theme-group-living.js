/*
 * Living themes: a page that follows something real.
 *
 * Tidewatch follows the health of your services, Daydrift the clock, Skywatch
 * the weather the dashboard already fetched. None of them asks the network for
 * anything: health is read from the status classes and the header badge the
 * dashboard already draws, the weather from the reading its widget caches in
 * localStorage, the hour from the device.
 *
 * Everything follows html[data-theme], so switching theme in the studio or
 * with :theme starts and stops a family without a reload, and leaving a family
 * removes its layer, its attributes, its inline variables and its timers.
 * Motion stops with prefers-reduced-motion and with Effects off; that is CSS,
 * in theme-group-living.css. The state still follows the data, as a still
 * picture.
 */
(function () {
    'use strict';

    const PREFIX = 'living-';
    const KINDS = ['tidewatch', 'daydrift', 'skywatch'];
    const WEATHER_KEY = 'nextdash-weather-cache:';

    let currentId = '';
    let stopRuntime = null;

    function parseTheme(themeId) {
        const id = String(themeId || '');
        if (!id.startsWith(PREFIX)) return null;
        const m = /^living-(.+?)-(dark|light)$/.exec(id);
        if (!m || !KINDS.includes(m[1])) return null;
        return { id, kind: m[1], half: m[2] };
    }

    /* ── Tidewatch ─────────────────────────────────────────────────── */

    /*
     * ok / warn / down, from what the page already shows. A monitored bookmark
     * that stopped answering carries .status-offline and puts a down badge on
     * the header's health icon; a dead link is the plain badge. Housekeeping
     * warnings (.health-badge-warn) say nothing about a service, so they leave
     * the page calm. Down beats warn beats ok.
     */
    function healthNow() {
        const down = document.querySelectorAll('.health-badge-down, .bookmark-link.status-offline').length;
        if (down > 0) return { state: 'down', count: down };
        const warn = document.querySelectorAll('.health-badge:not(.health-badge-warn):not(.health-badge-down)').length;
        if (warn > 0) return { state: 'warn', count: warn };
        return { state: 'ok', count: 0 };
    }

    function startTidewatch() {
        let timer = 0;
        function sync() {
            timer = 0;
            const { state, count } = healthNow();
            document.body.setAttribute('data-living-health', state);
            document.body.setAttribute('data-living-count', String(count));
        }
        // Checks land one bookmark at a time, so a burst of class changes is
        // one repaint of the page, not forty.
        function queue() {
            if (!timer) timer = window.setTimeout(sync, 250);
        }
        sync();
        const observer = new MutationObserver((records) => {
            if (records.every((r) => r.target.closest && r.target.closest('.living-layer'))) return;
            queue();
        });
        observer.observe(document.body, {
            subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
        });
        return () => {
            observer.disconnect();
            if (timer) window.clearTimeout(timer);
            document.body.removeAttribute('data-living-health');
            document.body.removeAttribute('data-living-count');
        };
    }

    /* ── Daydrift ──────────────────────────────────────────────────── */

    /*
     * One palette per half, four times of day: [hour, page, card, border,
     * accent]. The dark half stays dark all day (a deep dawn, a deep noon) and
     * the light half stays light (peach, sky, apricot, periwinkle), so a half
     * is still a half. Text and the semantic colours do not move: they are
     * the theme's own, picked to pass AA on every stop and on every mix of two
     * neighbours, which the spec walks quarter hour by quarter hour.
     */
    const DRIFT = {
        dark: [
            [0, '#0E122B', '#161C3D', '#2A3566', '#9FB0FF'],
            [6, '#3A2530', '#4A3039', '#6B4856', '#FFB38A'],
            [12, '#0E2438', '#16334D', '#2C5578', '#8CC8F2'],
            [18, '#3A2114', '#4B2C1C', '#6E442C', '#FFA05E'],
            [24, '#0E122B', '#161C3D', '#2A3566', '#9FB0FF'],
        ],
        light: [
            [0, '#DDE1F6', '#EEF0FB', '#B9C0E6', '#3B47B8'],
            [6, '#FBDDC8', '#FEF0E6', '#EBBE9F', '#9A3E14'],
            [12, '#D6ECFB', '#EEF7FD', '#A9CFEA', '#135B93'],
            [18, '#F8CBA8', '#FDE6D4', '#E5A87F', '#8C3407'],
            [24, '#DDE1F6', '#EEF0FB', '#B9C0E6', '#3B47B8'],
        ],
    };

    const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
    function mix(a, b, t) {
        const x = rgb(a);
        const y = rgb(b);
        return '#' + x.map((v, i) => hex2(v + (y[i] - v) * t)).join('');
    }

    function paletteAt(half, hour) {
        const stops = DRIFT[half === 'light' ? 'light' : 'dark'];
        const h = ((Number(hour) % 24) + 24) % 24;
        let i = 0;
        while (stops[i + 1][0] < h) i++;
        const a = stops[i];
        const b = stops[i + 1];
        const t = (h - a[0]) / (b[0] - a[0]);
        const page = mix(a[1], b[1], t);
        const card = mix(a[2], b[2], t);
        const line = mix(a[3], b[3], t);
        return {
            page,
            card,
            line,
            accent: mix(a[4], b[4], t),
            dots: mix(page, line, 0.4),
            modal: `rgba(${rgb(page).join(', ')}, 0.93)`,
        };
    }

    function phaseOf(hour) {
        if (hour >= 5 && hour < 9) return 'dawn';
        if (hour >= 9 && hour < 16) return 'day';
        if (hour >= 16 && hour < 20) return 'dusk';
        return 'night';
    }

    /*
     * Where the sun (06 to 18) or the moon (18 to 06) stands on its arc over
     * the horizon band: x across the page, rise 0 at the horizon to 1 at the
     * top of the arc. Whichever stands in the east or the west lights the
     * cards from that side.
     */
    function orbAt(hour) {
        const h = ((Number(hour) % 24) + 24) % 24;
        const day = h >= 6 && h < 18;
        const t = day ? (h - 6) / 12 : (((h - 18) + 24) % 24) / 12;
        return {
            body: day ? 'sun' : 'moon',
            x: Math.round((8 + 84 * t) * 10) / 10,
            rise: Math.round(Math.sin(Math.PI * t) * 1000) / 1000,
            lit: t < 0.5 ? 'left' : 'right',
        };
    }

    const DRIFT_VARS = [
        '--dd-x', '--dd-rise',
        '--background-primary', '--background-secondary', '--background-dots', '--background-modal',
        '--border-primary', '--border-secondary', '--accent-primary',
    ];

    function startDaydrift(half) {
        const root = document.documentElement;
        function tick() {
            const now = new Date();
            const hour = now.getHours() + now.getMinutes() / 60;
            const p = paletteAt(half, hour);
            root.style.setProperty('--background-primary', p.page);
            root.style.setProperty('--background-secondary', p.card);
            root.style.setProperty('--background-dots', p.dots);
            root.style.setProperty('--background-modal', p.modal);
            root.style.setProperty('--border-primary', p.line);
            root.style.setProperty('--border-secondary', p.dots);
            root.style.setProperty('--accent-primary', p.accent);
            document.body.setAttribute('data-living-phase', phaseOf(now.getHours()));
            const o = orbAt(hour);
            root.style.setProperty('--dd-x', `${o.x}%`);
            root.style.setProperty('--dd-rise', String(o.rise));
            document.body.setAttribute('data-living-body', o.body);
            document.body.setAttribute('data-living-lit', o.lit);
        }
        tick();
        // Three minutes is far finer than the eye follows a sky, and a
        // sleeping tab catches up on the next visibilitychange.
        const timer = window.setInterval(tick, 180000);
        const onVisible = () => { if (!document.hidden) tick(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            DRIFT_VARS.forEach((v) => root.style.removeProperty(v));
            ['data-living-phase', 'data-living-body', 'data-living-lit'].forEach((a) => document.body.removeAttribute(a));
        };
    }

    /* ── Skywatch ──────────────────────────────────────────────────── */

    // The same grouping weather.js uses for its icons, by WMO code.
    function skyFromCode(code) {
        const c = Number(code);
        if (!Number.isFinite(c)) return '';
        if (c <= 1) return 'clear';
        if (c <= 3) return 'cloud';
        if (c === 45 || c === 48) return 'fog';
        if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return 'rain';
        if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
        if (c >= 95) return 'storm';
        return '';
    }

    /*
     * The freshest reading the weather widget has cached. The widget owns the
     * fetching and its refresh interval; this only reads what it left behind.
     * The forecast caches share the prefix and are not a current reading.
     */
    function cachedWeatherCode() {
        let best = null;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(WEATHER_KEY) || key.includes(':forecast:')) continue;
                const parsed = JSON.parse(localStorage.getItem(key));
                const code = parsed?.data?.weatherCode;
                if (!Number.isFinite(Number(code))) continue;
                if (!best || Number(parsed.timestamp) > best.ts) best = { ts: Number(parsed.timestamp) || 0, code: Number(code) };
            }
        } catch {
            // Storage blocked or a damaged entry: fall back to the clock.
        }
        return best ? best.code : null;
    }

    function skyNow(date) {
        const hour = (date || new Date()).getHours();
        const night = hour < 6 || hour >= 21;
        const code = cachedWeatherCode();
        const sky = code == null ? '' : skyFromCode(code);
        let scene = sky;
        // Stars only behind a sky the weather leaves open.
        if (!sky || sky === 'clear' || sky === 'cloud') scene = night ? 'night' : (sky === 'cloud' ? 'cloud' : 'sun');
        return { scene, night, source: sky ? 'weather' : 'clock' };
    }

    function startSkywatch() {
        function sync() {
            const s = skyNow();
            document.body.setAttribute('data-living-sky', s.scene);
            document.body.setAttribute('data-living-night', s.night ? '1' : '0');
            document.body.setAttribute('data-living-source', s.source);
        }
        sync();
        // The widget writes to localStorage from this very tab, which fires no
        // storage event here, so a light poll is what notices its refresh.
        const timer = window.setInterval(sync, 60000);
        const onVisible = () => { if (!document.hidden) sync(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('storage', sync);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('storage', sync);
            ['data-living-sky', 'data-living-night', 'data-living-source'].forEach((a) => document.body.removeAttribute(a));
        };
    }

    /* ── Layers and switching ──────────────────────────────────────── */

    const GLYPHS = {
        sun: '<circle cx="40" cy="40" r="15"/><g stroke-width="4" stroke-linecap="round">'
            + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<line x1="40" y1="14" x2="40" y2="6" transform="rotate(${a} 40 40)"/>`).join('') + '</g>',
        cloud: '<path d="M22 56h38a14 14 0 0 0 2-27.8A19 19 0 0 0 26 33a12 12 0 0 0-4 23z"/>',
        rain: '<path d="M22 44h38a14 14 0 0 0 2-27.8A19 19 0 0 0 26 21a12 12 0 0 0-4 23z"/>'
            + '<g stroke-width="4" stroke-linecap="round"><line x1="28" y1="52" x2="24" y2="64"/><line x1="42" y1="52" x2="38" y2="68"/><line x1="56" y1="52" x2="52" y2="64"/></g>',
        storm: '<path d="M22 42h38a14 14 0 0 0 2-27.8A19 19 0 0 0 26 19a12 12 0 0 0-4 23z"/><path d="M44 44l-10 14h8l-4 14 14-18h-9l5-10z" class="lv-bolt"/>',
        snow: '<path d="M22 42h38a14 14 0 0 0 2-27.8A19 19 0 0 0 26 19a12 12 0 0 0-4 23z"/>'
            + '<g class="lv-flakes"><circle cx="28" cy="54" r="3"/><circle cx="42" cy="62" r="3"/><circle cx="56" cy="54" r="3"/></g>',
        fog: '<g stroke-width="5" stroke-linecap="round"><line x1="14" y1="26" x2="58" y2="26"/><line x1="24" y1="40" x2="68" y2="40"/><line x1="12" y1="54" x2="54" y2="54"/><line x1="26" y1="68" x2="66" y2="68"/></g>',
        night: '<path d="M52 14a28 28 0 1 0 14 40A22 22 0 0 1 52 14z"/><g class="lv-flakes"><circle cx="14" cy="18" r="2"/><circle cx="30" cy="8" r="1.6"/><circle cx="66" cy="30" r="1.8"/></g>',
    };

    function skyGlyphs() {
        return Object.keys(GLYPHS).map((k) => `<svg class="lv-glyph lv-glyph--${k}" viewBox="0 0 80 80" aria-hidden="true">${GLYPHS[k]}</svg>`).join('');
    }

    function layerFor(kind) {
        if (kind === 'tidewatch') {
            let ticks = '';
            for (let i = 0; i < 12; i++) ticks += `<i style="top:${i * 8.33}%"></i>`;
            return '<div class="lv-tint"></div>'
                + '<div class="lv-water"><div class="lv-crest"></div><div class="lv-crest lv-crest--2"></div></div>'
                + `<div class="lv-gauge">${ticks}<b class="lv-mark"></b></div>`
                + '<div class="lv-edge"></div><div class="lv-pulse"></div>';
        }
        if (kind === 'daydrift') {
            return '<div class="lv-horizon"><div class="lv-orb"></div><div class="lv-ground"></div></div>';
        }
        if (kind === 'skywatch') {
            return '<div class="lv-sky"><div class="lv-strip"><div class="lv-strip-sky"></div>'
                + `<div class="lv-glyphs">${skyGlyphs()}</div></div>`
                + '<div class="lv-sun"></div><div class="lv-clouds"></div>'
                + '<div class="lv-stars"></div><div class="lv-fog"></div>'
                + '<div class="lv-rain lv-rain--far"></div><div class="lv-rain"></div><div class="lv-snow"></div></div>';
        }
        return '';
    }

    function remove() {
        if (stopRuntime) stopRuntime();
        stopRuntime = null;
        document.querySelectorAll('.living-layer').forEach((el) => el.remove());
        document.body?.removeAttribute('data-living');
        currentId = '';
    }

    function apply() {
        if (!document.body) return;
        const theme = parseTheme(document.documentElement.getAttribute('data-theme'));
        const id = theme ? theme.id : '';
        if (id === currentId) return;
        remove();
        if (!theme) return;
        currentId = id;
        document.body.setAttribute('data-living', theme.kind);
        const markup = layerFor(theme.kind);
        if (markup) {
            const layer = document.createElement('div');
            layer.className = 'living-layer';
            layer.setAttribute('aria-hidden', 'true');
            layer.innerHTML = markup;
            const anchor = document.querySelector('.theme-backdrop-layer');
            if (anchor) anchor.after(layer);
            else document.body.prepend(layer);
        }
        if (theme.kind === 'tidewatch') stopRuntime = startTidewatch();
        else if (theme.kind === 'daydrift') stopRuntime = startDaydrift(theme.half);
        else stopRuntime = startSkywatch();
    }

    function start() {
        apply();
        new MutationObserver(apply).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }

    window.NDLiving = { parseTheme, healthNow, paletteAt, orbAt, skyNow, skyFromCode, apply };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
