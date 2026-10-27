/**
 * One-time Containers view tutorial — a guided tour through the view, shown the
 * first time it opens. Built like bookmarks-tutorial.js and inbox-tutorial.js,
 * with the same guards: a session that has turned session tips off, or is on a
 * phone, never sees it.
 *
 * Six steps on what matters most: the list and its states, the actions and
 * the setting behind them, the side panel, updates, the disk, and the config
 * and alerts. Each step has a moving picture that stands still -- on a picture
 * that still tells the story -- for a reader who asked for less motion.
 */
(function (global) {
    'use strict';

    // Also named in DashboardDocker (the view checks it before fetching this
    // file) and in the replay list in config and search. All must agree.
    const TIP_ID = 'containersTutorialV3';

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
        .ctv-bar-track { fill: none; stroke: var(--border-primary); stroke-width: 1; }
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
        .ctv-spinner { fill: none; stroke: var(--accent-primary); stroke-width: 2; stroke-linecap: round; }
        .ctv-meter.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .ctv-meter.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .ctv-meter.is-accent { fill: var(--accent-primary); }
        .ctv-log { fill: var(--text-secondary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }

        .ctv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .ctv-a-draw { stroke-dasharray: 1; animation-name: ctv-draw; }
        .ctv-a-drop { animation-name: ctv-drop; }
        .ctv-a-panel { animation-name: ctv-panel; }
        .ctv-a-bump { animation-name: ctv-bump; }
        .ctv-a-press { animation-name: ctv-press; }

        @keyframes ctv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes ctv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes ctv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes ctv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes ctv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }

        .ctv-a-glow { animation-name: ctv-glow; }
        .ctv-a-out { animation-name: ctv-out; }
        /* Hidden at rest: with the motion off, the running state is the picture. */
        .ctv-a-in { opacity: 0; animation-name: ctv-in; }
        .ctv-a-spin { animation-name: ctv-spin; animation-duration: 1.1s; animation-timing-function: linear; }
        .ctv-a-meter { animation-name: ctv-meter; transform-origin: left center; }
        .ctv-a-scroll { animation-name: ctv-scroll; animation-timing-function: linear; }
        /* Gone at rest: the letter is what the icon replaces. */
        .ctv-a-tabs { animation-name: ctv-tabs; }

        @keyframes ctv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes ctv-out { 0%, 32% { opacity: 1; } 38%, 66% { opacity: 0; } 72%, 100% { opacity: 1; } }
        @keyframes ctv-in { 0%, 32% { opacity: 0; } 38%, 66% { opacity: 1; } 72%, 100% { opacity: 0; } }
        @keyframes ctv-spin { to { transform: rotate(360deg); } }
        @keyframes ctv-meter { 0%, 100% { transform: none; } 30% { transform: scaleX(0.55); } 62% { transform: scaleX(0.85); } }
        @keyframes ctv-scroll { from { transform: none; } to { transform: translateY(-48px); } }
        /* The selection walks the four tabs and settles on the first. */
        @keyframes ctv-tabs { 0%, 12%, 88%, 100% { transform: none; } 25%, 34% { transform: translateY(32px); }
            47%, 56% { transform: translateY(64px); } 69%, 78% { transform: translateY(96px); } }

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

    /**
     * A label held to `maxW`: a translation longer than the room it has is
     * drawn a little narrower rather than over its neighbour.
     */
    function fitLabel(x, y, text, maxW, cls = 'ctv-label') {
        const fit = String(text).length * 6.2 > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" class="${cls}"${fit}>${esc(text)}</text>`;
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
            // 1 — the view and its states
            {
                title: f('dockerTour4ViewTitle', 'Everything that runs, one screen'),
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
                body: `<p>${esc(f('dockerTour4ViewBody1',
                    'The Containers view (Shift+Y, or the box icon in the header) lists what runs on your Docker host. Each row glows with its state: running, stopped, unhealthy or waiting for an update.'))}</p>
                    <p>${esc(f('dockerTour4ViewBody2',
                    'The filters on the left count each state, and / searches by name. Without the Docker socket the view says what to set.'))}</p>`,
            },
            // 2 — actions, and the setting behind them
            {
                title: f('dockerTour4ActTitle', 'Start, stop, restart, update'),
                visual: (() => {
                    const keys = [['s', f('dockerLegendRun', 'start / stop')], ['r', f('dockerLegendRestart', 'restart')],
                        ['p', f('dockerLegendPause', 'pause')], ['u', f('dockerLegendUpdate', 'update')], ['⌫', f('dockerLegendRemove', 'remove')],
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
                body: `<p>${esc(f('dockerTour4ActBody1',
                    'Press a key on the selected row: s starts or stops, r restarts, p pauses, u updates. The row menu has the same actions. Update and remove always ask first.'))}</p>
                    <p>${esc(f('dockerTour4ActBody2',
                    'Actions need NEXTDASH_DOCKER_CONTROL=1, and then a write token too. Without that, the view only reads.'))}</p>`,
            },
            // 3 — the side panel
            {
                title: f('dockerTour4PanelTitle', 'One container in the side panel'),
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
                body: `<p>${esc(f('dockerTour4PanelBody1',
                    'The side panel shows the container you pick: its image, ports and health, and the bookmark of its web UI.'))}</p>
                    <p>${esc(f('dockerTour4PanelBody2',
                    'Resources charts CPU, memory, network and disk over the last hour. Logs follows the log live, with search.'))}</p>`,
            },
            // 4 — updates
            {
                title: f('dockerTour4UpdatesTitle', 'Updates, with a way back'),
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
                body: `<p>${esc(f('dockerTour4UpdatesBody1',
                    'Update checks compare each image with its registry, on request or every few hours. A waiting update gets a badge, with the release notes in the side panel.'))}</p>
                    <p>${esc(f('dockerTour4UpdatesBody2',
                    'Update automatically runs updates in a nightly window. An update that fails is rolled back to the old image.'))}</p>`,
            },
            // 5 — disk
            {
                title: f('dockerTour4DiskTitle', 'What the disk holds'),
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
                body: `<p>${esc(f('dockerTour4DiskBody1',
                    'Disk (d) shows what images, volumes and the build cache take up, and what nothing uses.'))}</p>
                    <p>${esc(f('dockerTour4DiskBody2',
                    'Each tile clears its kind after asking. A volume holds data, so it goes one at a time, and only after you type delete.'))}</p>`,
            },
            // 6 — config and alerts
            {
                title: f('dockerTour4ConfigTitle', 'Settings and alerts'),
                visual: (() => {
                    const tabs = [
                        [f('config.containersTabConnection', 'Connection'), [[f('dockerTourSocket', 'Docker socket'), 'ok'], [f('dockerTourActions', 'Actions'), 'ok'], [f('dockerTourToken', 'Write token'), 'warn']]],
                        [f('config.containersTabView', 'View'), [[f('dockerTourRefresh', 'refresh'), 'plain'], [f('dockerTourLogLines', 'log lines'), 'plain'], [f('dockerTourHidden', 'hidden'), 'plain']]],
                        [f('config.containersTabUpdates', 'Updates'), [[f('dockerTourChecks', 'update checks'), 'ok'], ['03:00–05:00', 'plain'], [f('dockerTourGithubShort', 'GitHub token'), 'plain']]],
                        [f('config.containersTabAlerts', 'Alerts'), [[f('dockerTourStops', 'stops'), 'bad'], [f('dockerTourHot', 'runs hot'), 'warn'], [f('dockerTourMuted', 'muted'), 'plain']]],
                    ];
                    // A row per tab: its name, then what it holds. Rows rather than
                    // columns, so a long French or Spanish label has room.
                    return svg(`
                        ${tabs.map(([name, lines], i) => {
                            const y = 6 + i * 32;
                            return `<g class="ctv-anim ctv-a-drop" style="animation-delay:${(i * 0.12).toFixed(2)}s">
                                <rect x="12" y="${y}" width="456" height="26" rx="6" class="ctv-panel"/>
                                ${fitLabel(22, y + 17, name, 98, 'ctv-title')}
                                ${lines.map(([l, k], j) => `
                                    <circle cx="${130 + j * 114}" cy="${y + 13}" r="3.5" class="ctv-dot is-${k}"/>
                                    ${fitLabel(138 + j * 114, y + 17, l, 100)}`).join('')}
                            </g>`;
                        }).join('')}
                        <rect x="10" y="4" width="460" height="30" rx="7" class="ctv-select ctv-anim ctv-a-tabs"/>
                        ${label(240, 145, f('dockerTourTabsCaption', 'four tabs, each for one question'), 'ctv-caption', 'middle')}
                    `, f('dockerTourS7Alt', 'The four tabs of Config → Containers: Connection, View, Updates and Alerts'));
                })(),
                body: `<p>${esc(f('dockerTour4ConfigBody1',
                    'Config → Containers shows the connection and sets the refresh rate, the update checks and the nightly window.'))}</p>
                    <p>${esc(f('dockerTour4ConfigBody2',
                    'Alerts tell you when a container stops, restarts, turns unhealthy or runs hot. Mute the ones you do not care about.'))}</p>
                    <p class="containers-tutorial-closing">${esc(f('dockerTour4Closing',
                    'The legend under the list has every key, and the Tour button above it brings this tour back.'))}</p>`,
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
        global.nextdashTrack?.('containers-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the view: once, with the same guards as the dashboard's tour. */
    function maybeShow() {
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.enableSessionTips === false || d.settings.enableSectionTours === false) return false;
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
