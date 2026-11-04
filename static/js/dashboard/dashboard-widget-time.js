/**
 * Clock and Countdown: two widgets that need nothing but a clock.
 *
 * Both are drawn from their own settings and the browser's time, so there is
 * no service to ask, no cache and no error state to design: a zone the browser
 * does not know is said to be unknown, and a date that does not parse is said
 * to be missing. Each keeps one timer on its own body and drops it as soon as
 * the body leaves the page, so a widget closed or a grid drawn again leaves
 * nothing running.
 */
(function () {
    'use strict';

    const U = () => window.DashboardWidgetUtils;

    function label(dash, key, fallback) {
        return U().label(dash, key, fallback);
    }

    /** One timer per body: drawn again, the old one goes first; gone from the page, it stops itself. */
    function keepTicking(body, everyMs, redraw) {
        if (body._ndTimeTimer) clearInterval(body._ndTimeTimer);
        body._ndTimeTimer = setInterval(() => {
            if (!body.isConnected) {
                clearInterval(body._ndTimeTimer);
                body._ndTimeTimer = null;
                return;
            }
            redraw();
        }, everyMs);
    }

    /* ---------- Clock ---------- */

    /** "London=Europe/London" → { name: 'London', zone: 'Europe/London' }; a bare zone names itself by its city. */
    function parseZone(entry) {
        const text = String(entry || '').trim();
        const at = text.indexOf('=');
        const zone = (at >= 0 ? text.slice(at + 1) : text).trim();
        const named = at >= 0 ? text.slice(0, at).trim() : '';
        const city = zone.split('/').pop().replace(/_/g, ' ');
        return { name: named || city || zone, zone };
    }

    function formatIn(zone, date, config) {
        const base = { hour: '2-digit', minute: '2-digit', hour12: config.hour12 === true };
        return new Intl.DateTimeFormat(undefined, zone ? { ...base, timeZone: zone } : base).format(date);
    }

    /** The calendar day in a zone as a comparable number, to say "tomorrow" or "yesterday". */
    function dayNumber(zone, date) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(date);
        const get = (type) => Number(parts.find((p) => p.type === type)?.value);
        return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86400000);
    }

    /* ---------- Clock face, moon and sun ---------- */

    const SVG_NS = 'http://www.w3.org/2000/svg';

    function svgEl(name, attrs, parent) {
        const node = document.createElementNS(SVG_NS, name);
        Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, attrs[key]));
        if (parent) parent.appendChild(node);
        return node;
    }

    /** The reader's own clock, drawn once; the hands are moved by runHands. */
    function buildFace(dash) {
        const svg = svgEl('svg', {
            viewBox: '0 0 200 200', class: 'dashboard-clock-svg', role: 'img',
            'aria-label': label(dash, 'dashboard.widgetClockFaceLabel', 'Clock'),
        });
        svgEl('circle', { cx: 100, cy: 100, r: 96, class: 'dashboard-clock-ring' }, svg);
        for (let i = 0; i < 60; i += 1) {
            const major = i % 5 === 0;
            svgEl('line', {
                x1: 100, y1: major ? 22 : 15, x2: 100, y2: 8,
                transform: `rotate(${i * 6} 100 100)`,
                class: major ? 'dashboard-clock-tick dashboard-clock-tick-major' : 'dashboard-clock-tick',
            }, svg);
        }
        [[12, 0], [3, 90], [6, 180], [9, 270]].forEach(([n, deg]) => {
            const rad = (deg - 90) * Math.PI / 180;
            const text = svgEl('text', {
                x: 100 + Math.cos(rad) * 68, y: 100 + Math.sin(rad) * 68 + 7,
                'text-anchor': 'middle', class: 'dashboard-clock-num',
            }, svg);
            text.textContent = String(n);
        });
        const hour = svgEl('line', { x1: 100, y1: 110, x2: 100, y2: 52, class: 'dashboard-clock-hand dashboard-clock-hand-hour' }, svg);
        const minute = svgEl('line', { x1: 100, y1: 112, x2: 100, y2: 24, class: 'dashboard-clock-hand dashboard-clock-hand-minute' }, svg);
        const second = svgEl('line', { x1: 100, y1: 122, x2: 100, y2: 20, class: 'dashboard-clock-hand dashboard-clock-hand-second' }, svg);
        svgEl('circle', { cx: 100, cy: 100, r: 6, class: 'dashboard-clock-hub' }, svg);
        return { svg, hour, minute, second };
    }

    /**
     * Move the hands now and keep moving them until the body leaves the page.
     * The seconds hand sweeps unless the reader asked for less motion, when it
     * steps once a second; without a seconds hand the minute hand is enough.
     */
    function runHands(body, face, config) {
        if (body._ndClockStop) body._ndClockStop();
        const sweep = config.showSeconds !== false
            && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        const showSeconds = config.showSeconds !== false;
        face.second.style.display = showSeconds ? '' : 'none';
        const paint = () => {
            const now = new Date();
            const seconds = now.getSeconds() + (sweep ? now.getMilliseconds() / 1000 : 0);
            const minutes = now.getMinutes() + seconds / 60;
            face.hour.setAttribute('transform', `rotate(${((now.getHours() % 12) + minutes / 60) * 30} 100 100)`);
            face.minute.setAttribute('transform', `rotate(${minutes * 6} 100 100)`);
            face.second.setAttribute('transform', `rotate(${seconds * 6} 100 100)`);
        };
        let handle = 0;
        const stop = () => {
            if (sweep) cancelAnimationFrame(handle);
            else clearInterval(handle);
            body._ndClockStop = null;
        };
        body._ndClockStop = stop;
        paint();
        if (sweep) {
            const loop = () => {
                if (!body.isConnected) { stop(); return; }
                paint();
                handle = requestAnimationFrame(loop);
            };
            handle = requestAnimationFrame(loop);
        } else {
            handle = setInterval(() => {
                if (!body.isConnected) { stop(); return; }
                paint();
            }, 1000);
        }
    }

    const SYNODIC_DAYS = 29.530588853;
    // A new moon: 6 January 2000, 18:14 UTC.
    const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

    /** The moon's age in days since the last new moon, and the share of it that is lit. */
    function moonOf(date) {
        const days = (date.getTime() - NEW_MOON_MS) / 86400000;
        const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
        const fraction = age / SYNODIC_DAYS;
        return { age, fraction, lit: (1 - Math.cos(2 * Math.PI * fraction)) / 2 };
    }

    const MOON_PHASES = [
        ['dashboard.widgetClockMoonNew', 'New moon'],
        ['dashboard.widgetClockMoonWaxingCrescent', 'Waxing crescent'],
        ['dashboard.widgetClockMoonFirstQuarter', 'First quarter'],
        ['dashboard.widgetClockMoonWaxingGibbous', 'Waxing gibbous'],
        ['dashboard.widgetClockMoonFull', 'Full moon'],
        ['dashboard.widgetClockMoonWaningGibbous', 'Waning gibbous'],
        ['dashboard.widgetClockMoonLastQuarter', 'Last quarter'],
        ['dashboard.widgetClockMoonWaningCrescent', 'Waning crescent'],
    ];

    function moonPhaseName(dash, fraction) {
        const entry = MOON_PHASES[Math.floor(((fraction * 8) + 0.5)) % 8];
        return label(dash, entry[0], entry[1]);
    }

    /** The lit part of the moon as a drawing: a half circle and the line between light and dark. */
    function buildMoon(fraction) {
        const svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'dashboard-clock-moon-svg', 'aria-hidden': 'true' });
        svgEl('circle', { cx: 50, cy: 50, r: 46, class: 'dashboard-clock-moon-dark' }, svg);
        const waxing = fraction < 0.5;
        const q = waxing ? fraction : 1 - fraction;
        const rx = 46 * Math.abs(Math.cos(2 * Math.PI * q));
        const crescent = q < 0.25;
        const path = `M 50 4 A 46 46 0 0 1 50 96 A ${rx.toFixed(2)} 46 0 0 ${crescent ? 0 : 1} 50 4 Z`;
        const lit = svgEl('path', { d: path, class: 'dashboard-clock-moon-lit' }, svg);
        if (!waxing) lit.setAttribute('transform', 'translate(100 0) scale(-1 1)');
        return svg;
    }

    /** The next full or new moon, whichever comes first, as whole days from now. */
    function nextMoonEvent(age) {
        const toFull = ((SYNODIC_DAYS / 2 - age) + SYNODIC_DAYS) % SYNODIC_DAYS;
        const toNew = (SYNODIC_DAYS - age) % SYNODIC_DAYS;
        return toFull < toNew
            ? { days: toFull, key: 'dashboard.widgetClockMoonFull', fallback: 'Full moon' }
            : { days: toNew, key: 'dashboard.widgetClockMoonNew', fallback: 'New moon' };
    }

    function moonBlock(dash) {
        const now = new Date();
        const moon = moonOf(now);
        const block = document.createElement('div');
        block.className = 'dashboard-clock-moon';
        block.appendChild(buildMoon(moon.fraction));
        const text = document.createElement('div');
        text.className = 'dashboard-clock-sky-text';
        const name = document.createElement('b');
        name.textContent = moonPhaseName(dash, moon.fraction);
        const lit = document.createElement('span');
        lit.textContent = label(dash, 'dashboard.widgetClockMoonLit', '{n}% lit').replace('{n}', String(Math.round(moon.lit * 100)));
        const next = nextMoonEvent(moon.age);
        const days = Math.max(1, Math.ceil(next.days));
        const phase = label(dash, next.key, next.fallback);
        const when = document.createElement('span');
        when.textContent = days === 1
            ? label(dash, 'dashboard.widgetClockMoonTomorrow', '{phase} tomorrow').replace('{phase}', phase)
            : label(dash, 'dashboard.widgetClockMoonInDays', '{phase} in {n} days').replace('{phase}', phase).replace('{n}', String(days));
        text.append(name, lit, when);
        block.appendChild(text);
        return block;
    }

    /* Sunrise and sunset for a place and a day: the usual solar-position series, good to a minute or two. */
    function sunTimes(date, latitude, longitude) {
        const rad = Math.PI / 180;
        const J1970 = 2440588;
        const J2000 = 2451545;
        const J0 = 0.0009;
        const lw = rad * -longitude;
        const phi = rad * latitude;
        const toDays = (d) => d.getTime() / 86400000 - 0.5 + J1970 - J2000;
        const d = toDays(date);
        const n = Math.round(d - J0 - lw / (2 * Math.PI));
        const ds = J0 + lw / (2 * Math.PI) + n;
        const M = rad * (357.5291 + 0.98560028 * ds);
        const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
        const L = M + C + rad * 102.9372 + Math.PI;
        const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
        const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
        const cosW = (Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
        const fromJulian = (j) => new Date((j + 0.5 - J1970) * 86400000);
        if (cosW > 1) return { never: true };
        if (cosW < -1) return { always: true };
        const w = Math.acos(cosW);
        const set = J2000 + (J0 + (w + lw) / (2 * Math.PI) + n) + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
        return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
    }

    // Where the weather location is, asked once in a while rather than at every beat.
    const placeCache = { key: '', at: 0, value: null };

    async function weatherPlace(dash) {
        const settings = dash?.settings || {};
        const service = dash?.weatherService;
        if (!service) return null;
        const browser = settings.weatherSource === 'browser';
        const text = String(settings.weatherLocation || '').trim();
        if (!browser && !text) return { missing: true };
        const key = browser ? 'browser' : `manual|${text.toLowerCase()}`;
        if (placeCache.key === key && placeCache.value && Date.now() - placeCache.at < 6 * 3600000) return placeCache.value;
        let place = null;
        try {
            place = browser ? await service.resolveFromBrowser() : await service.resolveFromManualLocation(text);
        } catch (_error) {
            place = null;
        }
        if (place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) {
            placeCache.key = key;
            placeCache.at = Date.now();
            placeCache.value = place;
        }
        return place;
    }

    function timeText(date, config) {
        return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: config.hour12 === true }).format(date);
    }

    function sunBlock(dash, config) {
        const block = document.createElement('div');
        block.className = 'dashboard-clock-sun';
        const note = document.createElement('p');
        note.className = 'dashboard-clock-sun-note';
        block.appendChild(note);
        weatherPlace(dash).then((place) => {
            if (!block.isConnected) return;
            if (place?.missing) {
                note.textContent = label(dash, 'dashboard.widgetClockSunNeedsLocation', 'Set a weather location in Config to see sunrise and sunset.');
                return;
            }
            if (!place) {
                note.textContent = label(dash, 'dashboard.widgetClockSunUnavailable', 'Sunrise and sunset could not be worked out.');
                return;
            }
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
            const times = sunTimes(today, place.latitude, place.longitude);
            block.parentElement?.classList.toggle('is-south', place.latitude < 0);
            if (times.always || times.never) {
                note.textContent = times.always
                    ? label(dash, 'dashboard.widgetClockSunAlwaysUp', 'The sun does not set today')
                    : label(dash, 'dashboard.widgetClockSunNeverUp', 'The sun does not rise today');
                return;
            }
            note.remove();
            const rows = document.createElement('div');
            rows.className = 'dashboard-clock-sun-times';
            [['dashboard.widgetClockSunrise', 'Sunrise', times.rise], ['dashboard.widgetClockSunset', 'Sunset', times.set]].forEach(([key, fallback, at]) => {
                const cell = document.createElement('div');
                const name = document.createElement('span');
                name.textContent = label(dash, key, fallback);
                const value = document.createElement('b');
                value.textContent = timeText(at, config);
                cell.append(name, value);
                rows.appendChild(cell);
            });
            const span = times.set.getTime() - times.rise.getTime();
            const progress = Math.min(1, Math.max(0, (now.getTime() - times.rise.getTime()) / span));
            const bar = document.createElement('div');
            bar.className = 'dashboard-clock-sun-bar';
            bar.setAttribute('aria-hidden', 'true');
            const fill = document.createElement('span');
            fill.style.width = `${Math.round(progress * 100)}%`;
            bar.appendChild(fill);
            const minutes = Math.round(span / 60000);
            const length = document.createElement('p');
            length.className = 'dashboard-clock-sun-note';
            length.textContent = label(dash, 'dashboard.widgetClockDaylight', '{h} h {m} min of daylight')
                .replace('{h}', String(Math.floor(minutes / 60))).replace('{m}', String(minutes % 60));
            block.append(rows, bar, length);
        });
        return block;
    }

    /** Sunrise and sunset as one short line, for the tile drawn one column wide; two columns have the full block. */
    function sunLine(dash, config) {
        const line = document.createElement('p');
        line.className = 'dashboard-clock-sunline dashboard-clock-narrow-only';
        line.hidden = true;
        weatherPlace(dash).then((place) => {
            if (!line.isConnected || !place || place.missing) return;
            const now = new Date();
            const times = sunTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), place.latitude, place.longitude);
            if (!times.rise || !times.set) return;
            [['dashboard.widgetClockSunrise', 'Sunrise', times.rise, 'up'], ['dashboard.widgetClockSunset', 'Sunset', times.set, 'down']].forEach(([key, fallback, at, way]) => {
                const item = document.createElement('span');
                item.title = label(dash, key, fallback);
                const icon = svgEl('svg', { viewBox: '0 0 16 16', class: 'dashboard-clock-sunline-icon', 'aria-hidden': 'true' });
                svgEl('path', { d: 'M2 12 H14 M4.5 12 a3.5 3.5 0 0 1 7 0', class: 'dashboard-clock-sunline-sun' }, icon);
                svgEl('path', { d: way === 'up' ? 'M8 5 V1 M6 3 L8 1 L10 3' : 'M8 1 V5 M6 3 L8 5 L10 3', class: 'dashboard-clock-sunline-arrow' }, icon);
                item.append(icon, document.createTextNode(`${label(dash, key, fallback)} ${timeText(at, config)}`));
                line.appendChild(item);
            });
            line.hidden = false;
        });
        return line;
    }

    /** The places under the face, as plain rows, the way the list look draws them. */
    function placeRows(dash, config, zones, now) {
        const u = U();
        const list = u.rowList(false);
        zones.forEach((row) => {
            let text;
            let detail = '';
            let tone;
            try {
                text = formatIn(row.zone, now, config);
                const delta = dayNumber(row.zone, now) - dayNumber('', now);
                if (delta === 1) detail = label(dash, 'dashboard.widgetClockTomorrow', 'tomorrow');
                else if (delta === -1) detail = label(dash, 'dashboard.widgetClockYesterday', 'yesterday');
            } catch (_error) {
                text = label(dash, 'dashboard.widgetClockUnknownZone', 'unknown zone');
                tone = 'warn';
            }
            list.appendChild(u.row(row.name, detail ? `${text} · ${detail}` : text, tone));
        });
        return list;
    }

    function drawClockFace(body, widget, dash, zones) {
        const config = widget?.config || {};
        const panel = U().panel(body);
        const now = new Date();
        const wrap = document.createElement('div');
        wrap.className = 'dashboard-clock';

        const main = document.createElement('div');
        main.className = 'dashboard-clock-main';
        const face = buildFace(dash);
        const faceBox = document.createElement('div');
        faceBox.className = 'dashboard-clock-face';
        faceBox.appendChild(face.svg);
        main.appendChild(faceBox);
        if (config.showDate === true) {
            const date = document.createElement('p');
            date.className = 'dashboard-clock-date';
            date.textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
            main.appendChild(date);
        }
        if (config.showSun !== false) main.appendChild(sunLine(dash, config));
        if (zones.length) main.appendChild(placeRows(dash, config, zones.slice(0, 3), now));
        wrap.appendChild(main);

        const showMoon = config.showMoon !== false;
        const showSun = config.showSun !== false;
        if (showMoon || showSun) {
            // Always built, hidden by width: two columns wide is when the tile shows more.
            const sky = document.createElement('div');
            sky.className = 'dashboard-clock-sky dashboard-widget-wide-only';
            if (showMoon) sky.appendChild(moonBlock(dash));
            if (showSun) sky.appendChild(sunBlock(dash, config));
            wrap.appendChild(sky);
        }
        panel.appendChild(wrap);
        runHands(body, face, config);
        keepTicking(body, 60000, () => drawClock(body, widget, dash));
    }

    function drawClock(body, widget, dash) {
        const u = U();
        const config = widget?.config || {};
        if (body._ndClockStop) body._ndClockStop();
        const zones = (Array.isArray(config.zones) ? config.zones : []).map(parseZone).filter((z) => z.zone);
        // The large face is the clock; the plain lines are a choice made in its settings.
        if (config.look !== 'list') {
            drawClockFace(body, widget, dash, zones);
            return;
        }
        const panel = u.panel(body);
        const now = new Date();

        // Always the reader's own time first: a second place is read against it.
        const rows = [{ name: label(dash, 'dashboard.widgetClockHere', 'Here'), zone: '' }, ...zones];
        const list = u.rowList(false);
        rows.forEach((row) => {
            let text;
            let detail = '';
            let tone;
            try {
                text = formatIn(row.zone, now, config);
                const delta = dayNumber(row.zone, now) - dayNumber('', now);
                if (delta === 1) detail = label(dash, 'dashboard.widgetClockTomorrow', 'tomorrow');
                else if (delta === -1) detail = label(dash, 'dashboard.widgetClockYesterday', 'yesterday');
            } catch (_error) {
                text = label(dash, 'dashboard.widgetClockUnknownZone', 'unknown zone');
                tone = 'warn';
            }
            const el = u.row(row.name, detail ? `${text} · ${detail}` : text, tone);
            list.appendChild(el);
        });
        panel.appendChild(list);
        if (config.showDate === true) {
            panel.appendChild(u.footnote(new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)));
        }
        // On the minute, give or take: a tile that shows hours and minutes has
        // no use for a faster beat.
        keepTicking(body, 20000, () => drawClock(body, widget, dash));
    }

    /* ---------- Countdown ---------- */

    function targetOf(config) {
        const date = String(config.date || '');
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!m) return null;
        const time = /^(\d{2}):(\d{2})$/.exec(String(config.time || ''));
        // Local time: "my birthday" is midnight where the reader is.
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), time ? Number(time[1]) : 0, time ? Number(time[2]) : 0);
    }

    function drawCountdown(body, widget, dash) {
        const u = U();
        const config = widget?.config || {};
        const panel = u.panel(body);
        const target = targetOf(config);
        if (!target) {
            // A date that was cleared: the timer of the countdown it used to be goes too.
            if (body._ndTimeTimer) { clearInterval(body._ndTimeTimer); body._ndTimeTimer = null; }
            u.say(panel, 'dashboard-widget-empty', label(dash, 'dashboard.widgetCountdownNoDate',
                'Pick a date in this widget’s settings.'));
            return;
        }
        const now = new Date();
        const ms = target.getTime() - now.getTime();
        const past = ms < 0;
        const abs = Math.abs(ms);
        const days = Math.floor(abs / 86400000);
        const hours = Math.floor((abs % 86400000) / 3600000);
        const minutes = Math.floor((abs % 3600000) / 60000);
        const useTime = config.showTime === true || (config.time && days < 2);

        let figure;
        let unit;
        if (days >= 1 || !useTime) {
            // Calendar days, not 24-hour spans: the date is what was asked for, so the
            // day it falls on and today decide the figure (a clock change cannot move it).
            const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            const calendarDays = Math.round(Math.abs(startOf(target) - startOf(now)) / 86400000);
            figure = String(calendarDays);
            unit = calendarDays === 1
                ? label(dash, 'dashboard.widgetCountdownDay', 'day')
                : label(dash, 'dashboard.widgetCountdownDays', 'days');
        } else {
            figure = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes);
            unit = hours > 0 ? label(dash, 'dashboard.widgetCountdownHours', 'hours')
                : label(dash, 'dashboard.widgetCountdownMinutes', 'minutes');
        }
        const name = String(widget?.title || '').trim();
        const note = past
            ? label(dash, 'dashboard.widgetCountdownAgo', '{unit} ago').replace('{unit}', unit)
            : label(dash, 'dashboard.widgetCountdownLeft', '{unit} left').replace('{unit}', unit);
        panel.appendChild(u.headline(figure, note));
        const when = new Intl.DateTimeFormat(undefined, config.time
            ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(target);
        panel.appendChild(u.footnote(name ? `${name} · ${when}` : when));
        keepTicking(body, 60000, () => drawCountdown(body, widget, dash));
    }

    window.DashboardWidgets = window.DashboardWidgets || {};
    window.DashboardWidgets.clock = drawClock;
    window.DashboardWidgets.countdown = drawCountdown;
    // For the tests: the arithmetic apart from the drawing.
    window.DashboardWidgetTime = { parseZone, targetOf, dayNumber, moonOf, sunTimes };
}());
