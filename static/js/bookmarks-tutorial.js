/**
 * One-time Bookmarks view tutorial — a guided tour through the view, shown the
 * first time it opens. Built like inbox-tutorial.js and sharing its guards, so
 * a session that has turned session tips off, or is on a phone, never sees it.
 *
 * Five steps on what matters most: the one list and its rail, checking a
 * link, the charts and collection health, alerts, and working through what is
 * broken. Each scene shows the one movement its step is about, and stands
 * still -- on a picture that still tells the story -- for a reader who asked
 * for less motion.
 */
(function (global) {
    'use strict';

    // Also named in DashboardConfig (the view checks it before fetching this
    // file) and in the replay list in config and search. All must agree.
    const TIP_ID = 'bookmarksTutorialV1';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `config.${key}`;
            const value = lang.t(full);
            if (value && value !== full) text = value;
        }
        return params
            ? Object.entries(params).reduce(
                (acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)),
                String(text)
            )
            : text;
    }

    const esc = window.NextDashHtml.escapeHtml;

    const W = 480;
    const H = 150;

    /*
     * The scene's own stylesheet, inside the SVG -- see inbox-tutorial.js for
     * why the colours travel with the drawing.
     *
     * Letters are only ever the theme's primary or secondary text colour on
     * its primary background. The status colours (success, warning, error)
     * are for lines, bars, rings and dots, never for text: several themes take
     * them close to the background, where a line still reads and a word does
     * not.
     *
     * Every animation rests, at 0% and 100% or with the motion switched off,
     * on its finished state: a drawn line, a full ring, a grown bar, a panel
     * in place. The still picture is the whole explanation; the motion only
     * points at it.
     */
    const SCENE_STYLE = `
        .btv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .btv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .btv-row.is-accent .btv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .btv-row.is-bad .btv-box { stroke: var(--accent-error, var(--border-primary)); stroke-width: 1.5; }
        .btv-panel { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .btv-title, .btv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .btv-heading { font-size: 12px; }
        .btv-big { fill: var(--text-primary); font-size: 18px; font-weight: 700; }
        .btv-sub, .btv-label { fill: var(--text-secondary); font-size: 10px; }
        .btv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .btv-dot.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .btv-dot.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .btv-dot.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .btv-dot.is-plain { fill: var(--text-secondary); }
        .btv-dot.is-accent { fill: var(--accent-primary); }
        .btv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .btv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .btv-pill.is-active .btv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .btv-pill.is-active .btv-pill-text { font-weight: 700; }
        .btv-pill.is-warn .btv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .btv-pill.is-bad .btv-pill-box { stroke: var(--accent-error, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .btv-pill.is-dashed .btv-pill-box { stroke-dasharray: 3 2; }
        .btv-line { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
        .btv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .btv-arrowhead { fill: var(--accent-primary); }
        .btv-ring-track { fill: none; stroke: var(--border-primary); stroke-width: 6; }
        .btv-ring { fill: none; stroke-width: 6; stroke-linecap: round; }
        .btv-ring.is-ok { stroke: var(--accent-success, var(--accent-primary)); }
        .btv-ring.is-warn { stroke: var(--accent-warning, var(--accent-primary)); }
        .btv-beat.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .btv-beat.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .btv-bar { fill: var(--accent-primary); }
        .btv-bar-track { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .btv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .btv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .btv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .btv-a-draw { stroke-dasharray: 1; animation-name: btv-draw; }
        .btv-a-drop { animation-name: btv-drop; }
        .btv-a-panel { animation-name: btv-panel; }
        .btv-a-bump { animation-name: btv-bump; }
        .btv-a-tick { animation-name: btv-tick; }
        .btv-a-grow { animation-name: btv-grow; transform-origin: left center; }
        .btv-a-ring { stroke-dasharray: 1; animation-name: btv-ring; }
        .btv-a-swap { animation-name: btv-swap; }
        .btv-a-press { animation-name: btv-press; }

        @keyframes btv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes btv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes btv-tick { 0%, 6% { opacity: 0; } 14%, 100% { opacity: 1; } }
        @keyframes btv-grow { 0%, 10% { transform: scaleX(0); } 42%, 100% { transform: none; } }
        /* The ring fills to its value: the value is carried in stroke-dashoffset on the element. */
        @keyframes btv-ring { 0%, 8% { stroke-dashoffset: 1; } 48%, 100% { stroke-dashoffset: var(--btv-ring-to, 0); } }
        @keyframes btv-swap { 0%, 44% { opacity: 1; transform: none; } 52% { opacity: 0; transform: translateX(-22px); }
            56% { opacity: 0; transform: translateX(22px); } 68%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }

        @media (prefers-reduced-motion: reduce) { .btv-anim { animation: none !important; } }
        body.no-animations .btv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="btv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="btv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="btv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** Animation class and an optional start offset, for staggering a set. */
    function anim(name, delay = 0) {
        return { cls: ` btv-anim btv-a-${name}`, style: delay ? ` style="animation-delay:${delay}s"` : '' };
    }

    const NONE = { cls: '', style: '' };

    function label(x, y, text, cls = 'btv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    /** A one-line bookmark row: an optional status dot, the name, the site. */
    function row(x, y, w, title, { site = '', dot = '', kind = '', motion = NONE } = {}) {
        return `<g class="btv-row${kind ? ` is-${kind}` : ''}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="btv-box"/>
            ${dot ? `<circle cx="${x + 10}" cy="${y + 11}" r="3" class="btv-dot is-${dot}"/>` : ''}
            <text x="${x + 20}" y="${y + 15}" class="btv-title">${esc(title)}</text>
            ${site ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="btv-sub">${esc(site)}</text>` : ''}
        </g>`;
    }

    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    function pill(x, y, text, { kind = 'plain', w = null, motion = NONE } = {}) {
        const width = w || pillWidth(text);
        return `<g class="btv-pill is-${kind}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="btv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="btv-pill-text">${esc(text)}</text>
        </g>`;
    }

    /**
     * Pills side by side, each as wide as its text, wrapping to a new line
     * when the next one would pass `maxW` -- translations run long, and a
     * fixed width that fits English cuts off German.
     */
    function pillFlow(x, y, maxW, items, { gap = 6, line = 26 } = {}) {
        let at = x;
        let row = y;
        return items.map(([text, kind, motion]) => {
            const w = pillWidth(text);
            if (at > x && at + w > x + maxW) { at = x; row += line; }
            const out = pill(at, row, text, { kind, motion: motion || NONE });
            at += w + gap;
            return out;
        }).join('');
    }

    function keyWidth(k) {
        return Math.max(20, k.length * 7 + 10);
    }

    function keycap(x, y, k, motion = NONE) {
        const w = keyWidth(k);
        return `<g class="btv-key${motion.cls}"${motion.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="btv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="btv-key-text">${esc(k)}</text></g>`;
    }

    /** A path that draws itself along its length. */
    function line(d, { kind = '', delay = null, arrow = false } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="${arrow ? 'btv-arrow' : `btv-line${kind ? ` is-${kind}` : ''}`}${drawn ? ' btv-anim btv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''}${arrow ? ' marker-end="url(#btv-arrow)"' : ''}/>`;
    }

    /** A score or countdown ring, filled to `value` (0..1). */
    function ring(cx, cy, r, value, text, { kind = 'ok', sub = '' } = {}) {
        const rest = (1 - value).toFixed(3);
        return `<g>
            <circle cx="${cx}" cy="${cy}" r="${r}" class="btv-ring-track"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" pathLength="1" transform="rotate(-90 ${cx} ${cy})"
                class="btv-ring is-${kind} btv-anim btv-a-ring" style="stroke-dashoffset:${rest};--btv-ring-to:${rest}"/>
            <text x="${cx}" y="${cy + (sub ? 3 : 6)}" text-anchor="middle" class="btv-big">${esc(text)}</text>
            ${sub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="btv-sub">${esc(sub)}</text>` : ''}
        </g>`;
    }

    /** A heartbeat bar: one block per check, the bad ones red, ticking in from the left. */
    function heartbeat(x, y, n, bad = []) {
        return Array.from({ length: n }, (_, i) => `<rect x="${x + i * 6}" y="${y}" width="4" height="14" rx="1"
            class="btv-beat is-${bad.includes(i) ? 'bad' : 'ok'} btv-anim btv-a-tick" style="animation-delay:${(i * 0.04).toFixed(2)}s"/>`).join('');
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        const health = f('dashboard.healthFilterBroken', 'Broken');
        return [
            // 1 — the view
            {
                title: f('bmTour2ListTitle', 'Every bookmark in one list'),
                visual: svg(`
                    <rect x="12" y="12" width="100" height="126" rx="6" class="btv-panel"/>
                    ${label(22, 32, f('dashboard.healthScoreTotal', 'Score'), 'btv-title')}
                    ${label(102, 32, '77%', 'btv-title', 'end')}
                    ${line('M22,50 L40,48 L58,49 L76,43 L102,40', { delay: 0 })}
                    ${label(22, 76, health)}${label(102, 76, '2', 'btv-title', 'end')}
                    ${label(22, 96, f('config.bmLargeUptime', 'Uptime'))}${label(102, 96, '98%', 'btv-title', 'end')}
                    ${label(22, 116, f('dashboard.healthFilterMonitored', 'Monitored'))}${label(102, 116, '4', 'btv-title', 'end')}
                    ${row(124, 14, 184, 'nextDash', { site: 'nextdash.cc', motion: anim('drop', 0.1) })}
                    ${row(124, 42, 184, 'GitHub', { site: 'github.com', kind: 'accent', motion: anim('drop', 0.25) })}
                    ${row(124, 70, 184, 'Nextcloud', { site: 'cloud.home', dot: 'bad', motion: anim('drop', 0.4) })}
                    ${row(124, 98, 184, 'Grafana', { site: 'grafana.org', motion: anim('drop', 0.55) })}
                    <g class="btv-anim btv-a-panel">
                        <rect x="320" y="10" width="150" height="130" rx="8" class="btv-panel"/>
                        ${label(332, 30, 'GitHub', 'btv-heading')}
                        ${label(332, 44, 'github.com')}
                        ${pill(332, 54, f('bmTabDetails', 'Details'), { w: 60 })}
                        ${pill(396, 54, f('bmHealth', 'Health'), { kind: 'active', w: 60 })}
                        ${ring(350, 108, 18, 0.97, '97')}
                        ${label(376, 106, f('bmTourS1Checked', 'checked 3m ago'))}
                    </g>
                `, f('bmTourS1Alt', 'The rail, the list and the side panel of the Bookmarks view')),
                body: `<p>${esc(f('bmTour2ListBody1',
                    'Shift+H on the dashboard opens every bookmark from every page in one list. The rail on the left narrows it: broken, stale, duplicates, never opened, a tag or a page.'))}</p>
                    <p>${esc(f('bmTour2ListBody2',
                    'The side panel edits the bookmark you focus, tags included, with suggestions. A filtered list keeps its filter in the address, so you can bookmark it.'))}</p>`,
            },
            // 2 — checking
            {
                title: f('bmTour2CheckTitle', 'Three ways to check a link'),
                visual: (() => {
                    const intervals = ['5m', '15m', '30m', '1h', '6h', '24h'];
                    const modes = [f('bmTourModeOff', 'Off'), f('bmCheckingPeriodic', 'Periodic'), f('bmCheckingMonitor', 'Monitor')];
                    const mw = Math.max(...modes.map(pillWidth));
                    const x = 16 + mw + 10;
                    return svg(`
                        ${pill(16, 14, modes[0], { w: mw })}
                        ${label(x, 28, f('bmTourS3Off', 'never checked'))}
                        ${pill(16, 44, modes[1], { w: mw })}
                        ${label(x, 58, f('bmTourS3Periodic', 'about once a day, flagged when broken'))}
                        ${pill(16, 74, modes[2], { kind: 'active', w: mw })}
                        ${intervals.map((iv, i) => pill(x + i * 42, 74, iv, { w: 36, kind: i === 1 ? 'active' : 'plain' })).join('')}
                        ${heartbeat(x, 108, 44, [29, 30])}
                        ${label(x + 44 * 6 + 8, 120, '99.8%', 'btv-title')}
                        ${label(x, 142, f('bmTourS3Beat', 'one block per check'), 'btv-caption')}
                    `, f('bmTourS3Alt', 'Off, Periodic and Monitor, with Monitor’s intervals and heartbeat'));
                })(),
                body: `<p>${esc(f('bmTour2CheckBody1',
                    'Off is never checked. Periodic is checked about once a day. Monitor is checked by the server every 5 minutes to 24 hours, with uptime history and alerts.'))}</p>
                    <p>${esc(f('bmTour2CheckBody2',
                    'A failed check says why: DNS, a timeout, TLS or an HTTP status. Set the mode in the side panel, or for many bookmarks at once from the Collection menu.'))}</p>`,
            },
            // 3 — charts and collection health
            {
                title: f('bmTour2HealthTitle', 'Charts and collection health'),
                visual: (() => {
                    const bars = [[f('bmTourS7Day', '24 hours'), 0.98], [f('bmTourS7Week', '7 days'), 0.99], [f('bmTourS7Month', '30 days'), 0.995]];
                    return svg(`
                        ${pillFlow(16, 10, 400, [[f('dashboard.healthTrendSeriesHealthy', 'Healthy %'), 'active'],
                            [f('dashboard.healthTrendSeriesScore', 'Score'), 'plain'],
                            [f('dashboard.healthTrendSeriesBroken', 'Broken'), 'plain'],
                            [f('dashboard.healthTrendSeriesDown', 'Monitors down'), 'plain']])}
                        ${line('M16,74 L80,72 L144,73 L208,62 L272,56 L336,52 L400,48 L466,46', { delay: 0 })}
                        ${bars.map(([l, v], i) => `
                            ${label(16, 104 + i * 16, l)}
                            <rect x="92" y="${96 + i * 16}" width="130" height="8" rx="2" class="btv-bar-track"/>
                            <rect x="92" y="${96 + i * 16}" width="${(130 * v).toFixed(1)}" height="8" rx="2"
                                class="btv-bar btv-anim btv-a-grow" style="animation-delay:${(i * 0.15).toFixed(2)}s"/>`).join('')}
                        ${label(250, 108, 'Nextcloud  180 → 420 ms', 'btv-title')}
                        ${label(250, 126, f('bmTourS7Outages', '4 outages in 30 days'))}
                        ${keycap(440, 118, 'h', anim('press'))}
                    `, f('bmTourS7Alt', 'The collection trend, uptime bars and the slowest bookmark'));
                })(),
                body: `<p>${esc(f('bmTour2HealthBody1',
                    'Shift+H on a row opens the charts for one bookmark: uptime, response time, status codes and outages.'))}</p>
                    <p>${esc(f('bmTour2HealthBody2',
                    'h opens the whole collection: the score over time, what is wrong by kind, your monitors and certificates close to expiry. Every number is a filter.'))}</p>`,
            },
            // 4 — alerts
            {
                title: f('bmTour2AlertsTitle', 'Hear about it when it breaks'),
                visual: (() => {
                    const targets = ['Slack', 'ntfy', 'Pushover', f('bmTourS8Browser', 'Browser')];
                    return svg(`
                        ${row(16, 60, 150, 'Nextcloud', { dot: 'bad', kind: 'bad' })}
                        ${targets.map((name, i) => `
                            ${line(`M168,71 C200,71 200,${24 + i * 32} 228,${24 + i * 32}`, { delay: i * 0.2, arrow: true })}
                            ${pill(234, 14 + i * 32, name, { w: 76 })}`).join('')}
                        <g class="btv-anim btv-a-drop" style="animation-delay:1.1s">
                            <rect x="318" y="14" width="156" height="48" rx="8" class="btv-panel"/>
                            ${label(328, 34, f('bmTourS8Down', 'Nextcloud is down'), 'btv-title')}
                            ${label(328, 50, 'HTTP 503 · 3×')}
                        </g>
                        ${label(318, 88, f('bmTourS8Window', 'maintenance 03:00–03:10'))}
                        ${pill(318, 98, f('dashboard.healthNotifyMutedBadge', 'Muted'), { kind: 'dashed', w: 70 })}
                    `, f('bmTourS8Alt', 'A down bookmark sends alerts to Slack, ntfy, Pushover and the browser'));
                })(),
                body: `<p>${esc(f('bmTour2AlertsBody1',
                    'Downtime alerts go to Slack, Discord, Telegram, ntfy, Pushover or your own webhook, and again when the link is back. Browser notifications work too. Set them up in Config → Monitoring.'))}</p>
                    <p>${esc(f('bmTour2AlertsBody2',
                    'A maintenance window keeps a planned restart quiet. A muted bookmark is still checked, only never announced.'))}</p>`,
            },
            // 5 — the backlog and the keys
            {
                title: f('bmTour2BacklogTitle', 'Clear the backlog'),
                visual: (() => {
                    const keys = [['p', f('bmTourKeyRecheck', 're-check')], ['d', f('bmTourKeyDelete', 'delete')],
                        ['z', f('bmTourKeySnooze', 'snooze')], ['j', f('bmTourKeySkip', 'skip')]];
                    return svg(`
                        <g class="btv-anim btv-a-swap">
                            <rect x="16" y="8" width="226" height="112" rx="10" class="btv-panel"/>
                            ${label(30, 36, 'Old wiki', 'btv-heading')}
                            ${label(30, 54, f('bmTourS9Failing', 'DNS · failing for 34 days'))}
                            <circle cx="220" cy="32" r="4" class="btv-dot is-bad"/>
                            ${pillFlow(30, 66, 200, [[f('bmTourKeyRecheck', 're-check'), 'plain'],
                                [f('bmTourKeyDelete', 'delete'), 'bad'], [f('bmTourKeySnooze', 'snooze'), 'plain']])}
                        </g>
                        ${keys.map(([k, l], i) => `${keycap(258, 12 + i * 28, k, i === 0 ? anim('press', 0.2) : NONE)}${label(286, 26 + i * 28, l)}`).join('')}
                        <rect x="366" y="18" width="104" height="92" rx="10" class="btv-panel"/>
                        ${label(378, 40, f('bmTourS9Ten', 'Ten links,'), 'btv-title')}
                        ${label(378, 56, f('bmTourS9Two', 'two minutes'), 'btv-title')}
                        ${pill(378, 76, f('dashboard.healthReviewNoticeStart', 'Start'), { kind: 'active', w: 62, motion: anim('bump', 0.4) })}
                        ${keycap(16, 124, 'f')}${label(42, 138, f('dashboard.healthFocus', 'Work through'))}
                    `, f('bmTourS9Alt', 'Work through shows one bookmark at a time with its actions'));
                })(),
                body: `<p>${esc(f('bmTour2BacklogBody1',
                    'Work through (f) shows one bookmark at a time with its actions: re-check, open, delete, snooze or skip.'))}</p>
                    <p>${esc(f('bmTour2BacklogBody2',
                    'x ticks rows, and the side panel then acts on all of them at once.'))}</p>
                    <p class="bookmarks-tutorial-closing">${esc(f('bmTour2Closing',
                    'The Tour button above the list brings this tour back whenever you want it.'))}</p>`,
            },
        ];
    }

    let state = { index: 0, direction: 'forward' };

    function render() {
        const all = steps();
        const step = all[state.index];
        const total = all.length;
        const isFirst = state.index === 0;
        const isLast = state.index === total - 1;
        const progress = t('dashboard.inboxTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="bookmarks-tutorial">
                <div class="bookmarks-tutorial-progress">${esc(progress)}</div>
                <div class="bookmarks-tutorial-scene is-${state.direction}">${step.visual}</div>
                <h3 class="bookmarks-tutorial-step-title">${esc(step.title)}</h3>
                <div class="bookmarks-tutorial-step-body">${step.body}</div>
                <div class="bookmarks-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="bookmarks-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('bmTourTitle', 'How the Bookmarks view works'),
            htmlMessage: html,
            confirmText: isLast ? t('dashboard.inboxTutorialDone', 'Got it') : t('dashboard.inboxTutorialNext', 'Next'),
            cancelText: isFirst ? t('dashboard.inboxTutorialSkip', 'Skip') : t('dashboard.inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'bookmarks-tutorial-modal',
            modalMaxWidth: 'min(40rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    finish('completed');
                    return;
                }
                state.index += 1;
                state.direction = 'forward';
                render();
            },
            onCancel: () => {
                if (isFirst) {
                    finish('skipped');
                    return;
                }
                state.index -= 1;
                state.direction = 'back';
                render();
            },
            // Escape, the backdrop and navigating away all count as seen: the
            // Tour button and the ℹ cover the same ground on demand.
            // Only a real dismissal: Next and Back close the window too, and
            // reach here with their own reason after they have run.
            onHide: ({ reason } = {}) => { if (reason === 'dismiss') finish('dismissed'); },
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('bookmarks-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the view: once, with the same guards as the dashboard's tour. */
    function maybeShow() {
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (!global.AppModal?.show) return false;

        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('bookmarks-tutorial:shown');
        return true;
    }

    /** The Tour button: open it on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('bookmarks-tutorial:opened');
        return true;
    }

    global.BookmarksTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
