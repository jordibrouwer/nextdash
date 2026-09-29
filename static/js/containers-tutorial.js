/**
 * One-time Containers view tutorial — a guided tour through the view, shown the
 * first time it opens. Built like bookmarks-tutorial.js and inbox-tutorial.js,
 * with the same guards: a session that has turned session tips off, or is on a
 * phone, never sees it.
 *
 * The view looks like a list, and says little about what it can do or what it
 * needs: the status glow, the keys that act on a container, the setting that
 * has to be on before any of them work, the side panel's live tabs, update
 * checks and their release notes, and the config behind it. This walks all of
 * it once, with a moving picture for each step that stands still -- on a
 * picture that still tells the story -- for a reader who asked for less motion.
 */
(function (global) {
    'use strict';

    // Also named in DashboardDocker (the view checks it before fetching this
    // file) and in the replay list in config and search. All must agree.
    const TIP_ID = 'containersTutorialV1';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `dashboard.${key}`;
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
        .ctv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .ctv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .ctv-row.is-accent .ctv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .ctv-row.is-bad .ctv-box { stroke: var(--accent-error, var(--border-primary)); stroke-width: 1.5; }
        .ctv-panel { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .ctv-title, .ctv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .ctv-heading { font-size: 12px; }
        .ctv-big { fill: var(--text-primary); font-size: 18px; font-weight: 700; }
        .ctv-sub, .ctv-label { fill: var(--text-secondary); font-size: 10px; }
        .ctv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .ctv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .ctv-dot.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-dot.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .ctv-dot.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .ctv-dot.is-plain { fill: var(--text-secondary); }
        .ctv-dot.is-accent { fill: var(--accent-primary); }
        .ctv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .ctv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .ctv-pill.is-active .ctv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .ctv-pill.is-active .ctv-pill-text { font-weight: 700; }
        .ctv-pill.is-warn .ctv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .ctv-pill.is-bad .ctv-pill-box { stroke: var(--accent-error, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .ctv-pill.is-dashed .ctv-pill-box { stroke-dasharray: 3 2; }
        .ctv-select { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .ctv-line { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
        .ctv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .ctv-arrowhead { fill: var(--accent-primary); }
        .ctv-ring-track { fill: none; stroke: var(--border-primary); stroke-width: 6; }
        .ctv-ring { fill: none; stroke-width: 6; stroke-linecap: round; }
        .ctv-ring.is-ok { stroke: var(--accent-success, var(--accent-primary)); }
        .ctv-ring.is-warn { stroke: var(--accent-warning, var(--accent-primary)); }
        .ctv-beat.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-beat.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .ctv-bar { fill: var(--accent-primary); }
        .ctv-bar-track { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .ctv-cell { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-cell.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .ctv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .ctv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .ctv-glow.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-glow.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .ctv-glow.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .ctv-glow.is-plain { fill: var(--text-secondary); }
        .ctv-glow.is-accent { fill: var(--accent-primary); }
        .ctv-row.is-warn .ctv-box { stroke: var(--accent-warning, var(--border-primary)); stroke-width: 1.5; }
        .ctv-icon-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .ctv-icon { fill: none; stroke: var(--text-primary); stroke-width: 1.3; stroke-linejoin: round; }
        .ctv-code { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .ctv-code.is-on { stroke: var(--accent-primary); stroke-width: 1.5; }
        .ctv-lock { fill: none; stroke: var(--text-secondary); stroke-width: 1.4; }
        .ctv-spinner { fill: none; stroke: var(--accent-primary); stroke-width: 2; stroke-linecap: round; }
        .ctv-meter.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-meter.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .ctv-meter.is-accent { fill: var(--accent-primary); }
        .ctv-log { fill: var(--text-secondary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .ctv-track { fill: var(--border-primary); }
        .ctv-knob { fill: var(--accent-primary); }
        .ctv-huge { fill: var(--text-primary); font-size: 30px; font-weight: 700; }

        .ctv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .ctv-a-draw { stroke-dasharray: 1; animation-name: ctv-draw; }
        .ctv-a-drop { animation-name: ctv-drop; }
        .ctv-a-panel { animation-name: ctv-panel; }
        .ctv-a-bump { animation-name: ctv-bump; }
        .ctv-a-tick { animation-name: ctv-tick; }
        .ctv-a-grow { animation-name: ctv-grow; transform-origin: left center; }
        .ctv-a-ring { stroke-dasharray: 1; animation-name: ctv-ring; }
        .ctv-a-blink { animation-name: ctv-blink; }
        .ctv-a-swap { animation-name: ctv-swap; }
        .ctv-a-press { animation-name: ctv-press; }
        .ctv-a-slide { animation-name: ctv-slide; }

        @keyframes ctv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes ctv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes ctv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes ctv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes ctv-tick { 0%, 6% { opacity: 0; } 14%, 100% { opacity: 1; } }
        @keyframes ctv-grow { 0%, 10% { transform: scaleX(0); } 42%, 100% { transform: none; } }
        /* The ring fills to its value: the value is carried in stroke-dashoffset on the element. */
        @keyframes ctv-ring { 0%, 8% { stroke-dashoffset: 1; } 48%, 100% { stroke-dashoffset: var(--ctv-ring-to, 0); } }
        @keyframes ctv-blink { 0%, 30% { opacity: 1; } 40%, 50% { opacity: 0.2; } 60%, 100% { opacity: 1; } }
        @keyframes ctv-swap { 0%, 44% { opacity: 1; transform: none; } 52% { opacity: 0; transform: translateX(-22px); }
            56% { opacity: 0; transform: translateX(22px); } 68%, 100% { opacity: 1; transform: none; } }
        @keyframes ctv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }
        /* The selection mark walks down the rail and settles on the first filter. */
        @keyframes ctv-slide { 0% { transform: none; } 20% { transform: translateY(42px); } 40% { transform: translateY(84px); }
            60% { transform: translateY(42px); } 80%, 100% { transform: none; } }

        .ctv-a-glow { animation-name: ctv-glow; }
        .ctv-a-shake { animation-name: ctv-shake; }
        .ctv-a-out { animation-name: ctv-out; }
        /* Hidden at rest: with the motion off, the running state is the picture. */
        .ctv-a-in { opacity: 0; animation-name: ctv-in; }
        .ctv-a-spin { animation-name: ctv-spin; animation-duration: 1.1s; animation-timing-function: linear; }
        .ctv-a-meter { animation-name: ctv-meter; transform-origin: left center; }
        .ctv-a-scroll { animation-name: ctv-scroll; animation-timing-function: linear; }
        .ctv-a-knob { animation-name: ctv-knob; }

        @keyframes ctv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes ctv-shake { 0%, 40%, 64%, 100% { transform: none; } 46% { transform: translateX(-3px); }
            52% { transform: translateX(3px); } 58% { transform: translateX(-2px); } }
        @keyframes ctv-out { 0%, 32% { opacity: 1; } 38%, 66% { opacity: 0; } 72%, 100% { opacity: 1; } }
        @keyframes ctv-in { 0%, 32% { opacity: 0; } 38%, 66% { opacity: 1; } 72%, 100% { opacity: 0; } }
        @keyframes ctv-spin { to { transform: rotate(360deg); } }
        @keyframes ctv-meter { 0%, 100% { transform: none; } 30% { transform: scaleX(0.55); } 62% { transform: scaleX(0.85); } }
        @keyframes ctv-scroll { from { transform: none; } to { transform: translateY(-48px); } }
        @keyframes ctv-knob { 0%, 100% { transform: none; } 36% { transform: translateX(-26px); } 70% { transform: translateX(24px); } }

        @media (prefers-reduced-motion: reduce) { .ctv-anim { animation: none !important; } }
        body.no-animations .ctv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="ctv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="ctv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="ctv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** Animation class and an optional start offset, for staggering a set. */
    function anim(name, delay = 0) {
        return { cls: ` ctv-anim ctv-a-${name}`, style: delay ? ` style="animation-delay:${delay}s"` : '' };
    }

    const NONE = { cls: '', style: '' };

    function label(x, y, text, cls = 'ctv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    /** A one-line bookmark row: an optional status dot, the name, the site. */
    function row(x, y, w, title, { site = '', dot = '', kind = '', motion = NONE } = {}) {
        return `<g class="ctv-row${kind ? ` is-${kind}` : ''}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="ctv-box"/>
            ${dot ? `<circle cx="${x + 10}" cy="${y + 11}" r="3" class="ctv-dot is-${dot}"/>` : ''}
            <text x="${x + 20}" y="${y + 15}" class="ctv-title">${esc(title)}</text>
            ${site ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="ctv-sub">${esc(site)}</text>` : ''}
        </g>`;
    }

    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    function pill(x, y, text, { kind = 'plain', w = null, motion = NONE } = {}) {
        const width = w || pillWidth(text);
        return `<g class="ctv-pill is-${kind}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="ctv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="ctv-pill-text">${esc(text)}</text>
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
        return `<g class="ctv-key${motion.cls}"${motion.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="ctv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="ctv-key-text">${esc(k)}</text></g>`;
    }

    /** A path that draws itself along its length. */
    function line(d, { kind = '', delay = null, arrow = false } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="${arrow ? 'ctv-arrow' : `ctv-line${kind ? ` is-${kind}` : ''}`}${drawn ? ' ctv-anim ctv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''}${arrow ? ' marker-end="url(#ctv-arrow)"' : ''}/>`;
    }

    /** A score or countdown ring, filled to `value` (0..1). */
    function ring(cx, cy, r, value, text, { kind = 'ok', sub = '' } = {}) {
        const rest = (1 - value).toFixed(3);
        return `<g>
            <circle cx="${cx}" cy="${cy}" r="${r}" class="ctv-ring-track"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" pathLength="1" transform="rotate(-90 ${cx} ${cy})"
                class="ctv-ring is-${kind} ctv-anim ctv-a-ring" style="stroke-dashoffset:${rest};--ctv-ring-to:${rest}"/>
            <text x="${cx}" y="${cy + (sub ? 3 : 6)}" text-anchor="middle" class="ctv-big">${esc(text)}</text>
            ${sub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="ctv-sub">${esc(sub)}</text>` : ''}
        </g>`;
    }

    /** A heartbeat bar: one block per check, the bad ones red, ticking in from the left. */
    function heartbeat(x, y, n, bad = []) {
        return Array.from({ length: n }, (_, i) => `<rect x="${x + i * 6}" y="${y}" width="4" height="14" rx="1"
            class="ctv-beat is-${bad.includes(i) ? 'bad' : 'ok'} ctv-anim ctv-a-tick" style="animation-delay:${(i * 0.04).toFixed(2)}s"/>`).join('');
    }

    /**
     * A container row: the status glow down its left edge, as the view draws
     * it, then the name and the image.
     */
    function crow(x, y, w, name, { image = '', state = 'ok', kind = '', glow = false, motion = NONE } = {}) {
        return `<g class="ctv-row${kind ? ` is-${kind}` : ''}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="ctv-box"/>
            <rect x="${x}" y="${y}" width="4" height="22" rx="2" class="ctv-glow is-${state}${glow ? ' ctv-anim ctv-a-glow' : ''}"/>
            <text x="${x + 12}" y="${y + 15}" class="ctv-title">${esc(name)}</text>
            ${image ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="ctv-sub">${esc(image)}</text>` : ''}
        </g>`;
    }

    /** The box icon the header carries for this view, with an optional count. */
    function boxIcon(x, y, { count = null, motion = NONE } = {}) {
        return `<g>
            <rect x="${x}" y="${y}" width="28" height="28" rx="6" class="ctv-icon-box"/>
            <path d="M${x + 5},${y + 9} L${x + 14},${y + 4} L${x + 23},${y + 9} L${x + 23},${y + 19} L${x + 14},${y + 24} L${x + 5},${y + 19} Z
                     M${x + 5},${y + 9} L${x + 14},${y + 14} L${x + 23},${y + 9} M${x + 14},${y + 14} L${x + 14},${y + 24}" class="ctv-icon"/>
            ${count !== null ? `<g class="ctv-pill is-active${motion.cls}"${motion.style}>
                <rect x="${x + 18}" y="${y - 8}" width="18" height="16" rx="8" class="ctv-pill-box"/>
                <text x="${x + 27}" y="${y + 4}" text-anchor="middle" class="ctv-pill-text">${esc(String(count))}</text>
            </g>` : ''}
        </g>`;
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        const running = f('dockerFilterRunning', 'Running');
        const stopped = f('dockerFilterStopped', 'Stopped');
        const updates = f('dockerFilterUpdates', 'Updates');
        return [
            // 1 — the view
            {
                title: f('dockerTourS1Title', 'Everything that runs, one screen'),
                visual: svg(`
                    <rect x="12" y="12" width="112" height="112" rx="6" class="ctv-panel"/>
                    ${label(20, 30, f('dockerSummaryRunning', 'Running'))}${label(20, 45, '9 / 10', 'ctv-title')}
                    ${label(20, 66, f('dockerSummaryUpdates', 'Updates'))}${label(20, 81, '2', 'ctv-title')}
                    ${label(20, 102, f('dockerSummaryUnhealthy', 'Unhealthy'))}${label(20, 117, '1', 'ctv-title')}
                    ${crow(132, 12, 186, 'grafana', { image: 'grafana:latest', motion: anim('drop', 0.1) })}
                    ${crow(132, 40, 186, 'jellyfin', { image: 'jellyfin:10.10', motion: anim('drop', 0.25) })}
                    ${crow(132, 68, 186, 'radarr', { image: 'radarr:latest', kind: 'accent', motion: anim('drop', 0.4) })}
                    ${crow(132, 96, 186, 'bazarr', { image: 'bazarr:latest', state: 'bad', glow: true, motion: anim('drop', 0.55) })}
                    <g class="ctv-anim ctv-a-panel">
                        <rect x="328" y="10" width="142" height="130" rx="8" class="ctv-panel"/>
                        ${label(340, 30, 'radarr', 'ctv-heading')}
                        ${label(340, 46, f('dockerTourS1Up', 'up 6 days · healthy'))}
                        ${pillFlow(340, 56, 122, [[f('dockerActionRestart', 'Restart'), 'plain'], [f('dockerLegendUpdate', 'update'), 'active']])}
                        ${label(340, 128, 'radarr:latest', 'ctv-mono')}
                    </g>
                `, f('dockerTourS1Alt', 'The summary, the container rows and the side panel of the Containers view')),
                body: `<p>${esc(f('dockerTourS1Body1',
                    'The Containers view (#docker, or the box icon in the header) lists what runs on the Docker host nextDash can see: a summary on the left, one row per container, and the side panel for the one you pick.'))}</p>
                    <p>${esc(f('dockerTourS1Body2',
                    'It reads Docker through its socket. Without the socket the view says so, and names what to set.'))}</p>`,
            },
            // 2 — state at a glance
            {
                title: f('dockerTourS2Title', 'Read the state at a glance'),
                visual: (() => {
                    const rows = [['nextdash', 'ok', f('dockerTourStateRunning', 'running')],
                        ['bazarr', 'bad', f('dockerTourStateUnhealthy', 'unhealthy')],
                        ['sonarr', 'warn', f('dockerTourStateUpdate', 'update')],
                        ['old-db', 'plain', f('dockerTourStateStopped', 'stopped')],
                        ['tdarr', 'accent', f('dockerTourStatePaused', 'paused')]];
                    const filters = [[f('dockerFilterAll', 'All'), '10'], [running, '9'], [stopped, '1'], [updates, '2']];
                    return svg(`
                        ${rows.map(([n, st, s], i) => crow(14, 8 + i * 27, 200, n, { image: s, state: st, glow: st === 'bad' })).join('')}
                        ${filters.map(([l, n], i) => `
                            <g class="ctv-anim ctv-a-drop" style="animation-delay:${(i * 0.1).toFixed(2)}s">
                                ${label(236, 24 + i * 24, l, i === 3 ? 'ctv-title' : 'ctv-label')}
                                ${label(330, 24 + i * 24, n, 'ctv-title', 'end')}
                            </g>`).join('')}
                        <rect x="228" y="83" width="110" height="18" rx="4" class="ctv-select ctv-anim ctv-a-slide"/>
                        ${keycap(356, 12, '/')}${label(382, 26, f('dockerTourKeySearch', 'search'))}
                        ${keycap(356, 42, ':docker')}
                        ${label(228, 134, f('dockerTourS2Group', 'group by project or status'), 'ctv-caption')}
                    `, f('dockerTourS2Alt', 'Rows glowing by state, and the filters with their counts'));
                })(),
                body: `<p>${esc(f('dockerTourS2Body1',
                    'Each row glows with its state: running, stopped, paused, unhealthy, or waiting for an update. The filters on the left — All, Running, Stopped, Updates — carry a count each.'))}</p>
                    <p>${esc(f('dockerTourS2Body2',
                    'Click Name or Status to sort — again to turn the order round — or pick uptime, CPU or memory; group by project or status, and / searches by name. CPU and RAM come from a reading every 30 seconds. :docker opens the view from the command palette, Shift+Y from anywhere.'))}</p>`,
            },
            // 3 — actions
            {
                title: f('dockerTourS3Title', 'Start, stop, restart, update'),
                visual: (() => {
                    const keys = [['s', f('dockerLegendRun', 'start / stop')], ['r', f('dockerLegendRestart', 'restart')],
                        ['p', f('dockerLegendPause', 'pause')], ['u', f('dockerLegendUpdate', 'update')], ['Del', f('dockerLegendRemove', 'remove')],
                        ['m', f('dockerLegendMute', 'mute')]];
                    return svg(`
                        ${crow(14, 12, 230, 'radarr', { image: 'radarr:latest', kind: 'accent' })}
                        ${keys.map(([k, l], i) => {
                            const x = 14 + (i % 2) * 120;
                            const y = 48 + Math.floor(i / 2) * 30;
                            return `${keycap(x, y, k, i === 1 ? anim('press') : NONE)}${label(x + keyWidth(k) + 6, y + 14, l)}`;
                        }).join('')}
                        <g class="ctv-anim ctv-a-out">
                            <circle cx="276" cy="23" r="6" class="ctv-dot is-ok"/>
                            ${label(290, 27, f('dockerTourStateRunning', 'running'), 'ctv-title')}
                        </g>
                        <g class="ctv-anim ctv-a-in">
                            <path d="M276,17 A6,6 0 1 1 270,23" class="ctv-spinner ctv-anim ctv-a-spin"/>
                            ${label(290, 27, f('dockerTourRestarting', 'restarting…'), 'ctv-title')}
                        </g>
                        <rect x="262" y="58" width="208" height="76" rx="10" class="ctv-panel"/>
                        ${label(276, 80, f('dockerTourS3Confirm', 'Update radarr?'), 'ctv-heading')}
                        ${pillFlow(276, 98, 186, [[f('dockerTourCancel', 'Cancel'), 'plain'], [f('dockerLegendUpdate', 'update'), 'active']])}
                    `, f('dockerTourS3Alt', 'The action keys, a restart in progress, and a confirmation'));
                })(),
                body: `<p>${esc(f('dockerTourS3Body1',
                    'Use the row menu, or a key on the selected row: s starts or stops, r restarts, p pauses, u updates, Delete removes, m mutes its notices. The row shows the change while it happens. Grouped by project, a project’s row starts, stops or restarts the whole stack.'))}</p>
                    <p>${esc(f('dockerTourS3Body2',
                    'Update and remove always ask first. Also confirm stop and restart, under Config → Containers, adds those two.'))}</p>`,
            },
            // 4 — control is opt-in
            {
                title: f('dockerTourS4Title', 'Actions are yours to switch on'),
                visual: svg(`
                    <rect x="14" y="14" width="250" height="28" rx="6" class="ctv-code is-on"/>
                    ${label(24, 32, 'NEXTDASH_DOCKER_CONTROL=1', 'ctv-mono')}
                    <rect x="14" y="52" width="250" height="28" rx="6" class="ctv-code"/>
                    ${label(24, 70, 'NEXTDASH_WRITE_TOKEN=…', 'ctv-mono')}
                    ${label(14, 104, f('dockerTourS4Read', 'reading is always on'), 'ctv-caption')}
                    ${crow(286, 20, 150, 'nextdash', { kind: 'warn', motion: anim('shake') })}
                    ${pill(442, 21, 'self', { kind: 'warn', w: 30 })}
                    <rect x="276" y="68" width="18" height="14" rx="3" class="ctv-lock"/>
                    <path d="M279,68 v-4 a6,6 0 0 1 12,0 v4" class="ctv-lock"/>
                    ${label(300, 80, f('dockerTourS4Refuses', 'refuses stop and update'))}
                `, f('dockerTourS4Alt', 'The two settings that turn actions on, and nextDash’s own container refusing them')),
                body: `<p>${esc(f('dockerTourS4Body1',
                    'Reading is always safe; acting needs NEXTDASH_DOCKER_CONTROL=1. Once actions are on, set a write token too — without one, anyone who can reach nextDash can manage your containers.'))}</p>
                    <p>${esc(f('dockerTourS4Body2',
                    'The container nextDash runs in refuses stop, pause, restart, remove and update, so it cannot take itself down in the middle of a request.'))}</p>`,
            },
            // 5 — the side panel
            {
                title: f('dockerTourS5Title', 'One container, four tabs'),
                visual: (() => {
                    const tabs = [[f('dockerSectionOverview', 'Overview'), 'plain'], [f('dockerSectionResources', 'Resources'), 'active'],
                        [f('dockerSectionLogs', 'Logs'), 'plain'], [f('dockerSectionChanges', 'What’s new'), 'plain']];
                    const meters = [['CPU', 0.62, 'ok'], [f('dockerTourMemory', 'Memory'), 0.78, 'accent'], [f('dockerTourNetwork', 'Network'), 0.4, 'warn']];
                    const logs = ['[info] started', '[info] listening :8080', '[warn] slow request 820ms', '[info] scan finished',
                        '[info] 42 items', '[info] idle', '[info] started', '[info] listening :8080'];
                    return svg(`
                        ${pillFlow(14, 8, 452, tabs)}
                        ${meters.map(([l, v, k], i) => `
                            ${label(14, 58 + i * 26, l)}
                            <rect x="84" y="${50 + i * 26}" width="150" height="10" rx="3" class="ctv-bar-track"/>
                            <rect x="84" y="${50 + i * 26}" width="${(150 * v).toFixed(1)}" height="10" rx="3"
                                class="ctv-meter is-${k} ctv-anim ctv-a-meter" style="animation-delay:${(i * 0.5).toFixed(2)}s"/>`).join('')}
                        <rect x="252" y="40" width="218" height="102" rx="8" class="ctv-panel"/>
                        <clipPath id="ctv-logs"><rect x="252" y="44" width="218" height="94"/></clipPath>
                        <g clip-path="url(#ctv-logs)">
                            <g class="ctv-anim ctv-a-scroll">
                                ${logs.map((l, i) => label(262, 60 + i * 16, l, l.includes('warn') ? 'ctv-mono' : 'ctv-log')).join('')}
                            </g>
                        </g>
                    `, f('dockerTourS5Alt', 'The side panel’s tabs, live resource meters and scrolling logs'));
                })(),
                body: `<p>${esc(f('dockerTourS5Body1',
                    'The side panel shows the container you pick. Overview has the image, ports and project, and three parts to open: Health with its last checks, Updates, and Timeline — what happened to it, from starts and crashes to updates. Resources shows CPU, memory and network as they move.'))}</p>
                    <p>${esc(f('dockerTourS5Body2',
                    'Logs shows the last lines, and What’s new the release notes behind an available update. A click beside the panel closes it.'))}</p>`,
            },
            // 6 — updates
            {
                title: f('dockerTourS6Title', 'Know when an image is out of date'),
                visual: svg(`
                    ${crow(14, 16, 150, 'sonarr', { state: 'warn' })}
                    ${pill(170, 17, f('dockerUpdateBadge', 'update'), { kind: 'warn', motion: anim('bump', 0) })}
                    ${line('M240,27 C266,27 270,20 292,20', { delay: 0.2 })}
                    <rect x="298" y="6" width="172" height="48" rx="8" class="ctv-panel"/>
                    ${label(308, 26, '4.0.9 → 4.1.0', 'ctv-title')}
                    ${label(308, 42, f('dockerTourS6Notes', 'release notes from GitHub'))}
                    ${boxIcon(20, 82, { count: 2, motion: anim('bump', 0.3) })}
                    ${pillFlow(78, 86, 250, [[f('dockerTourOff', 'off'), 'plain'], ['6h', 'plain'], ['12h', 'active'], ['24h', 'plain']])}
                    ${pill(470 - pillWidth(f('dockerCheckUpdates', 'Check for updates')), 118, f('dockerCheckUpdates', 'Check for updates'))}
                    ${label(14, 136, f('dockerTourS6Rollback', 'a failed update starts the old container again'), 'ctv-caption')}
                `, f('dockerTourS6Alt', 'An update badge, its release notes, and the update check interval')),
                body: `<p>${esc(f('dockerTourS6Body1',
                    'Update checks compare the image a container runs with what its registry offers — on request with Check for updates, or every 6, 12 or 24 hours. Rows that wait for one get an update badge, and so does the header icon.'))}</p>
                    <p>${esc(f('dockerTourS6Body2',
                    'Updates, in the side panel, skips a version you do not want or holds a container’s updates, lists what updates did, and rolls the last one back while its old image is still here. If an update fails, the previous container is started again.'))}</p>`,
            },
            // 7 — the logs window
            {
                title: f('dockerTourS9Title', 'Logs, live'),
                visual: (() => {
                    const lines = ['[info] started', '[info] listening :8989', '[warn] indexer slow', '[error] 503 from skyhook',
                        '[info] rss sync done', '[info] 42 releases', '[info] idle', '[info] started'];
                    return svg(`
                        <rect x="12" y="8" width="458" height="134" rx="10" class="ctv-panel"/>
                        ${label(26, 30, 'sonarr', 'ctv-heading')}
                        ${pill(380, 16, f('dockerTourFollowing', '● following'), { kind: 'active', w: 82, motion: anim('bump', 0.2) })}
                        <rect x="26" y="40" width="160" height="20" rx="4" class="ctv-select"/>
                        ${label(34, 54, 'error', 'ctv-mono')}
                        ${pillFlow(196, 40, 260, [[f('dockerLogsStreamAll', 'All'), 'active'], ['stdout', 'plain'], ['stderr', 'plain'], [f('dockerTourDownload', 'download'), 'plain']])}
                        <clipPath id="ctv-livelogs"><rect x="26" y="68" width="430" height="68"/></clipPath>
                        <g clip-path="url(#ctv-livelogs)">
                            <g class="ctv-anim ctv-a-scroll">
                                ${lines.map((l, i) => label(30, 82 + i * 16, l, l.includes('error') ? 'ctv-mono' : 'ctv-log')).join('')}
                            </g>
                        </g>
                    `, f('dockerTourS9Alt', 'The logs window: following live, a search, the stream choice and download'));
                })(),
                body: `<p>${esc(f('dockerTourS9Body1',
                    'Show logs in the row menu, l on the selected row, or Open logs window in the side panel opens a window that follows the log as it is written. Scroll up to pause it; Jump to latest catches up.'))}</p>
                    <p>${esc(f('dockerTourS9Body2',
                    'Search marks every match and Enter steps through them; Filter keeps only the matching lines. Pick stdout or stderr — stderr is red — and copy or download what is loaded.'))}</p>`,
            },
            // 8 — disk
            {
                title: f('dockerTourS10Title', 'What the disk holds'),
                visual: (() => {
                    const tiles = [[f('dockerDiskUnusedImages', 'Unused images'), '4.1 GiB'], [f('dockerDiskDangling', 'Dangling images'), '1.9 GiB'],
                        [f('dockerDiskBuildCache', 'Build cache'), '640 MiB'], [f('dockerDiskUnusedVolumes', 'Unused volumes'), '180 MiB']];
                    return svg(`
                        ${pillFlow(14, 8, 200, [[f('dockerTabContainers', 'Containers'), 'plain'], [f('dockerTabDisk', 'Disk'), 'active']])}
                        ${tiles.map(([l, v], i) => `
                            <g class="ctv-anim ctv-a-drop" style="animation-delay:${(i * 0.12).toFixed(2)}s">
                                <rect x="${14 + i * 116}" y="44" width="108" height="64" rx="8" class="ctv-panel"/>
                                ${label(24 + i * 116, 62, l)}
                                ${label(24 + i * 116, 84, v, 'ctv-title')}
                            </g>`).join('')}
                        ${label(14, 130, f('dockerTourS10Warn', '⚠ ends rollback for sonarr'), 'ctv-caption')}
                        ${pill(470 - pillWidth(f('dockerTourS10Type', 'type delete')), 118, f('dockerTourS10Type', 'type delete'), { kind: 'warn' })}
                    `, f('dockerTourS10Alt', 'The Disk tab: what images, build cache and volumes take up'));
                })(),
                body: `<p>${esc(f('dockerTourS10Body1',
                    'Disk, beside Containers (or d), shows what images, volumes and the build cache take up, and what nothing uses. Each tile clears its kind after asking; clearing dangling images says which rollbacks it ends.'))}</p>
                    <p>${esc(f('dockerTourS10Body2',
                    'Volumes hold data, so they go one at a time, from their row, and only after you type delete.'))}</p>`,
            },
            // 7 — config
            {
                title: f('dockerTourS7Title', 'Config → Containers'),
                visual: (() => {
                    const status = [[f('dockerTourSocket', 'Docker socket'), 'ok'], [f('dockerTourActions', 'Actions'), 'ok'],
                        [f('dockerTourToken', 'Write token'), 'warn'], [f('dockerTourOwn', 'Own container'), 'ok']];
                    return svg(`
                        ${status.map(([l, k], i) => `
                            <g class="ctv-anim ctv-a-drop" style="animation-delay:${(i * 0.12).toFixed(2)}s">
                                <circle cx="22" cy="${22 + i * 24}" r="4" class="ctv-dot is-${k}"/>
                                ${label(32, 26 + i * 24, l, 'ctv-title')}
                            </g>`).join('')}
                        ${label(216, 26, f('dockerTourRefresh', 'refresh'))}
                        <rect x="300" y="20" width="140" height="4" rx="2" class="ctv-track"/>
                        <circle cx="340" cy="22" r="6" class="ctv-knob ctv-anim ctv-a-knob"/>
                        ${label(470, 26, '5s', 'ctv-title', 'end')}
                        ${label(216, 58, f('dockerTourLogLines', 'log lines'))}
                        ${pillFlow(300, 44, 170, [['100', 'plain'], ['500', 'active'], ['1000', 'plain']])}
                        ${label(216, 90, f('dockerTourHidden', 'hidden'))}
                        ${pillFlow(300, 76, 170, [['watchtower', 'dashed'], ['traefik', 'dashed']])}
                        ${label(216, 124, f('dockerTourGithub', 'GitHub token: 60 → 5000 an hour'), 'ctv-caption')}
                    `, f('dockerTourS7Alt', 'The connection status and the settings of Config → Containers'));
                })(),
                body: `<p>${esc(f('dockerTourS7Body1',
                    'Config → Containers shows the connection as the server sees it — the socket, whether actions are on, the write token, and whether nextDash recognises its own container. Those are set by environment variables, not here.'))}</p>
                    <p>${esc(f('dockerTourS7Body2',
                    'Below: the view and its header icon, how often the list refreshes (2 to 30 seconds), how many log lines to show, update checks, confirmations, notices when a container stops, keeps restarting or turns unhealthy — sent to your alert webhook and browser notifications, with the containers you mute — the containers you hide, and an optional GitHub token for release notes.'))}</p>`,
            },
            // 8 — dashboard and keys
            {
                title: f('dockerTourS8Title', 'On the dashboard, and where this tour lives'),
                visual: (() => {
                    const keys = [['Shift+Y', f('dockerTourOpenView', 'open Containers')], ['l', f('dockerLegendLogs', 'logs')],
                        ['d', f('dockerLegendDisk', 'disk')], ['m', f('dockerLegendMute', 'mute')]];
                    return svg(`
                        <rect x="14" y="14" width="164" height="100" rx="10" class="ctv-panel"/>
                        ${label(26, 36, f('dockerTourTile', 'Containers'), 'ctv-heading')}
                        <text x="26" y="76" class="ctv-huge">9</text>
                        ${label(50, 76, f('dockerTourTileRunning', '/ 10 running'))}
                        ${label(26, 100, f('dockerTourTileUnhealthy', '1 unhealthy'))}
                        <circle cx="162" cy="32" r="4" class="ctv-dot is-bad ctv-anim ctv-a-glow"/>
                        ${line('M182,64 C220,64 230,44 262,44', { delay: 0.1, arrow: true })}
                        ${keys.map(([k, l], i) => `${keycap(270, 12 + i * 26, k)}${label(296, 26 + i * 26, l)}`).join('')}
                        ${pill(470 - 72, 120, t('dashboard.inboxTour', 'Tour'), { kind: 'active', w: 72, motion: anim('bump', 0.3) })}
                    `, f('dockerTourS8Alt', 'The Containers tile on the dashboard, and the keys of the view'));
                })(),
                body: `<p>${esc(f('dockerTourS8Body1',
                    'The Containers tile and widget show how many run and which fail their healthcheck, and open this view with one click.'))}</p>
                    <p class="containers-tutorial-closing">${esc(f('dockerTourS8Closing',
                    'Shift+Y opens this view from anywhere. The legend under the list has every key, and Tour, above the list, brings this back whenever you want it.'))}</p>`,
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
            <div class="containers-tutorial">
                <div class="containers-tutorial-progress">${esc(progress)}</div>
                <div class="containers-tutorial-scene is-${state.direction}">${step.visual}</div>
                <h3 class="containers-tutorial-step-title">${esc(step.title)}</h3>
                <div class="containers-tutorial-step-body">${step.body}</div>
                <div class="containers-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="containers-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('dockerTourTitle', 'How the Containers view works'),
            htmlMessage: html,
            confirmText: isLast ? t('dashboard.inboxTutorialDone', 'Got it') : t('dashboard.inboxTutorialNext', 'Next'),
            cancelText: isFirst ? t('dashboard.inboxTutorialSkip', 'Skip') : t('dashboard.inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'containers-tutorial-modal',
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
            onHide: () => finish('dismissed'),
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('containers-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** Called by the Containers view once its list has drawn; same guards as the inbox tour. */
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
        global.nextdashTrack?.('containers-tutorial:shown');
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
        global.nextdashTrack?.('containers-tutorial:opened');
        return true;
    }

    global.ContainersTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
