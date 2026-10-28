/**
 * One-time Glances page tutorial — a guided tour through the page, shown the
 * first time it opens. Built like containers-tutorial.js, with the same
 * guards: a session that has turned session tips off, or is on a phone, never
 * sees it.
 *
 * Six steps: the machine at a glance, the sections and their keys, the side
 * panel, the record nextDash keeps, incidents, and several hosts with the link
 * to the Containers view. Each step has a moving picture that stands still --
 * on a picture that still tells the story -- for a reader who asked for less
 * motion. The pictures are drawn, with example figures: the tour works before
 * a host has been set up.
 */
(function (global) {
    'use strict';

    // Also named in DashboardGlances (the page checks it before fetching this
    // file) and in the replay lists in config and search. All must agree.
    const TIP_ID = 'glancesTutorialV1';

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
     * The scene's own stylesheet, inside the SVG, so the colours travel with
     * the drawing. Letters are only ever the theme's text colours on its
     * primary background; the status colours are for lines, bars and dots.
     * Every animation rests on its finished state: a drawn line, a panel in
     * place, a selection on the first row.
     */
    const SCENE_STYLE = `
        .gtv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .gtv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .gtv-box.is-accent { stroke: var(--accent-primary); stroke-width: 1.5; }
        .gtv-title, .gtv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .gtv-big { fill: var(--text-primary); font-size: 17px; font-weight: 700; }
        .gtv-sub, .gtv-label { fill: var(--text-secondary); font-size: 10px; }
        .gtv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .gtv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .gtv-dot.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .gtv-dot.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .gtv-dot.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .gtv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .gtv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .gtv-pill.is-active .gtv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .gtv-pill.is-active .gtv-pill-text { font-weight: 700; }
        .gtv-pill.is-dashed .gtv-pill-box { stroke-dasharray: 3 2; }
        .gtv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .gtv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700; font-family: var(--font-mono, ui-monospace, monospace); }
        .gtv-line { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
        .gtv-ghost { fill: none; stroke: var(--text-secondary); stroke-width: 1.5; stroke-dasharray: 4 3; stroke-opacity: 0.7; }
        .gtv-limit { fill: none; stroke: var(--accent-error, var(--border-primary)); stroke-width: 1; stroke-dasharray: 2 3; }
        .gtv-band { fill: var(--accent-error, var(--accent-primary)); fill-opacity: 0.22; stroke: var(--accent-error, var(--accent-primary)); stroke-width: 1; }
        .gtv-axis { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .gtv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .gtv-arrowhead { fill: var(--accent-primary); }
        .gtv-select { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .gtv-meter { fill: var(--accent-primary); }
        .gtv-meter.is-warn { fill: var(--accent-warning, var(--accent-primary)); }

        .gtv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .gtv-a-draw { stroke-dasharray: 1; animation-name: gtv-draw; }
        .gtv-a-drop { animation-name: gtv-drop; }
        .gtv-a-panel { animation-name: gtv-panel; }
        .gtv-a-press { animation-name: gtv-press; }
        .gtv-a-glow { animation-name: gtv-glow; }
        .gtv-a-band { animation-name: gtv-band; }
        .gtv-a-walk { animation-name: gtv-walk; }
        .gtv-a-walk3 { animation-name: gtv-walk3; }
        .gtv-a-meter { animation-name: gtv-meter; transform-origin: left center; }

        @keyframes gtv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes gtv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes gtv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes gtv-press { 0%, 52% { transform: none; } 58% { transform: translateY(2px); } 66%, 100% { transform: none; } }
        @keyframes gtv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes gtv-band { 0%, 36% { opacity: 0; } 50%, 100% { opacity: 1; } }
        @keyframes gtv-meter { 0%, 100% { transform: none; } 30% { transform: scaleX(0.55); } 62% { transform: scaleX(0.85); } }
        /* The selection walks down the rows and settles on the first. */
        /* The same, over three rows 28 apart. */
        @keyframes gtv-walk3 { 0%, 12%, 88%, 100% { transform: none; } 30%, 45% { transform: translateY(28px); } 62%, 76% { transform: translateY(56px); } }
        @keyframes gtv-walk { 0%, 12%, 88%, 100% { transform: none; } 25%, 34% { transform: translateY(26px); }
            47%, 56% { transform: translateY(52px); } 69%, 78% { transform: translateY(78px); } }

        @media (prefers-reduced-motion: reduce) { .gtv-anim { animation: none !important; } }
        body.no-animations .gtv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="gtv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="gtv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="gtv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    const NONE = { cls: '', style: '' };

    /** Animation class and an optional start offset, for staggering a set. */
    function anim(name, delay = 0) {
        return { cls: ` gtv-anim gtv-a-${name}`, style: delay ? ` style="animation-delay:${delay}s"` : '' };
    }

    function label(x, y, text, cls = 'gtv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    /** A label held to `maxW`: a translation longer than its room is drawn narrower, not over its neighbour. */
    function fitLabel(x, y, text, maxW, cls = 'gtv-label') {
        const fit = String(text).length * 6.2 > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" class="${cls}"${fit}>${esc(text)}</text>`;
    }

    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    function pill(x, y, text, { kind = 'plain', w = null, motion = NONE } = {}) {
        const width = w || pillWidth(text);
        return `<g class="gtv-pill is-${kind}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="gtv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="gtv-pill-text">${esc(text)}</text>
        </g>`;
    }

    function keyWidth(k) {
        return Math.max(20, k.length * 7 + 10);
    }

    function keycap(x, y, k, motion = NONE) {
        const w = keyWidth(k);
        return `<g class="gtv-key${motion.cls}"${motion.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="gtv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="gtv-key-text">${esc(k)}</text></g>`;
    }

    /** A path that draws itself along its length. */
    function line(d, { delay = null, cls = 'gtv-line' } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="${cls}${drawn ? ' gtv-anim gtv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''}/>`;
    }

    /** A tile: what it measures, the figure, and its last minute drawn. */
    function tile(x, name, value, d, motion) {
        return `<g class="gtv-anim gtv-a-drop"${motion}>
            <rect x="${x}" y="10" width="146" height="84" rx="6" class="gtv-box"/>
            ${fitLabel(x + 10, 28, name, 124)}
            <text x="${x + 10}" y="52" class="gtv-big">${esc(value)}</text>
            ${line(d, { delay: 0.3 })}
        </g>`;
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        const sections = [
            ['o', f('glancesSectionOverview', 'Overview')], ['p', f('glancesSectionProcesses', 'Processes')],
            ['c', f('glancesSectionContainers', 'Containers')], ['d', f('glancesSectionDisks', 'Disks')],
            ['h', f('glancesSectionHistory', 'History')],
        ];
        return [
            // 1 — the machine at a glance
            {
                title: f('glancesTour1Title', 'One machine, at a glance'),
                visual: svg(`
                    ${tile(12, f('glancesChartCpu', 'Processor'), '22%', 'M22,86 L48,78 L74,82 L100,70 L126,74 L152,64', ' style="animation-delay:.05s"')}
                    ${tile(167, f('glancesChartMem', 'Memory'), '61%', 'M177,70 L203,68 L229,72 L255,66 L281,68 L307,62', ' style="animation-delay:.2s"')}
                    ${tile(322, f('glancesChartLoad', 'Load'), '0.8', 'M332,84 L358,76 L384,80 L410,72 L436,78 L462,70', ' style="animation-delay:.35s"')}
                    <rect x="12" y="108" width="30" height="30" rx="7" class="gtv-box is-accent"/>
                    <path d="M18,128 L23,118 L28,124 L33,114 L37,120" class="gtv-line"/>
                    <circle cx="40" cy="111" r="5" class="gtv-dot is-ok gtv-anim gtv-a-glow"/>
                    ${keycap(56, 113, 'Shift')}${keycap(56 + keyWidth('Shift') + 4, 113, 'G')}
                    ${label(150, 127, f('glancesTour1Caption', 'the dot is the verdict: green, yellow or red'), 'gtv-caption')}
                `, f('glancesTour1Alt', 'Three tiles with processor, memory and load, and the Glances icon with a green dot')),
                body: `<p>${esc(f('glancesTour1Body1',
                    'Glances shows how a machine is right now: processor, memory, load, disks, network and temperatures, read from a Glances 4 host.'))}</p>
                    <p>${esc(f('glancesTour1Body2',
                    'The dot on the Glances icon (Shift+G opens it) is the verdict in one colour: green, yellow or red.'))}</p>`,
            },
            // 2 — sections, one key each
            {
                title: f('glancesTour2Title', 'Every section, one key'),
                visual: svg(`
                    ${sections.map(([k, name], i) => `
                        <g class="gtv-anim gtv-a-drop" style="animation-delay:${(i * 0.1).toFixed(2)}s">
                            <rect x="12" y="${10 + i * 26}" width="230" height="22" rx="4" class="gtv-box"/>
                            ${keycap(20, 11 + i * 26, k)}
                            ${fitLabel(52, 25 + i * 26, name, 180, 'gtv-title')}
                        </g>`).join('')}
                    <rect x="9" y="7" width="236" height="28" rx="6" class="gtv-select gtv-anim gtv-a-walk"/>
                    ${keycap(272, 14, '[')}${keycap(298, 14, ']')}
                    ${label(326, 28, f('glancesTour2Step', 'step through'))}
                    ${keycap(272, 48, 'r')}${label(300, 62, f('glancesTour2Read', 'read now'))}
                    ${keycap(272, 82, '/')}${label(300, 96, f('glancesTour2Search', 'search processes'))}
                    ${label(262, 130, f('glancesTour2Caption', 'one key per section'), 'gtv-caption')}
                `, f('glancesTour2Alt', 'A list of sections, each with its key, and the keys that step, read and search')),
                body: `<p>${esc(f('glancesTour2Body1',
                    'Overview, Processes, Containers, Disks, Network, Insights, History and Alerts each have a key: o, p, c, d, n, i, h, a. [ and ] step through them, r reads now.'))}</p>
                    <p>${esc(f('glancesTour2Body2', 'The menu lists only what the host can answer.'))}</p>`,
            },
            // 3 — a row opens a side panel
            {
                title: f('glancesTour3Title', 'A row opens a side panel'),
                visual: svg(`
                    ${[['node', 12, 34], ['plex', 8, 24], ['backup', 3, 12]].map(([name, pct, w], i) => `
                        <g class="gtv-anim gtv-a-drop" style="animation-delay:${(0.1 + i * 0.12).toFixed(2)}s">
                            <rect x="12" y="${14 + i * 30}" width="230" height="24" rx="4" class="gtv-box${i === 1 ? ' is-accent' : ''}"/>
                            ${fitLabel(22, 30 + i * 30, name, 90, 'gtv-title')}
                            <rect x="118" y="${22 + i * 30}" width="${w * 2.4}" height="6" rx="3" class="gtv-meter"/>
                            ${label(224, 30 + i * 30, `${pct}%`, 'gtv-sub', 'end')}
                        </g>`).join('')}
                    <g class="gtv-anim gtv-a-panel">
                        <rect x="256" y="8" width="214" height="134" rx="8" class="gtv-box"/>
                        ${label(268, 28, 'plex', 'gtv-heading')}
                        ${pill(268, 38, f('glancesTabOverview', 'Overview'))}${pill(268 + pillWidth(f('glancesTabOverview', 'Overview')) + 6, 38, f('glancesTabHistory', 'History'), { kind: 'active' })}
                        ${line('M268,100 L296,92 L324,96 L352,84 L380,90 L408,80 L446,86', { delay: 0.2 })}
                        ${pill(268, 112, f('glancesTrackStart', 'Record history'), { kind: 'active', motion: anim('press') })}
                    </g>
                `, f('glancesTour3Alt', 'A list of processes and a side panel with the history of one of them')),
                body: `<p>${esc(f('glancesTour3Body1',
                    'Click a process or a container: its details, its command line and its history open beside the list.'))}</p>
                    <p>${esc(f('glancesTour3Body2',
                    'The history of one is recorded only when you ask, in its History tab: Record history. Fifteen at most, because each is read every beat.'))}</p>`,
            },
            // 4 — a record of its own
            {
                title: f('glancesTour4Title', 'A record of its own'),
                visual: svg(`
                    <rect x="12" y="10" width="320" height="120" rx="6" class="gtv-box"/>
                    <path d="M28,114 L316,114 M28,26 L28,114" class="gtv-axis"/>
                    ${line('M28,100 L68,92 L108,98 L148,74 L188,82 L228,58 L268,66 L316,50', { delay: 0.1 })}
                    ${line('M28,106 L68,100 L108,96 L148,90 L188,84 L228,78 L268,72 L316,70', { delay: 0.5, cls: 'gtv-ghost' })}
                    ${label(28, 142, f('glancesCompareYesterday', 'Yesterday'), 'gtv-sub')}
                    <g class="gtv-anim gtv-a-drop" style="animation-delay:.3s">
                        ${label(348, 24, f('glancesRecordEvery', 'Record every'))}${pill(348, 30, f('glancesRecord30s', '30 seconds'), { kind: 'active' })}
                    </g>
                    <g class="gtv-anim gtv-a-drop" style="animation-delay:.45s">
                        ${label(348, 70, f('glancesKeepFor', 'Keep'))}${pill(348, 76, f('glancesKeep30', '30 days'), { kind: 'active' })}
                    </g>
                    <g class="gtv-anim gtv-a-drop" style="animation-delay:.6s">${pill(348, 112, f('glancesCompareYesterday', 'Yesterday'), { kind: 'dashed' })}</g>
                `, f('glancesTour4Alt', 'A graph with today and yesterday, and the choices for how often it is recorded and how long it is kept')),
                body: `<p>${esc(f('glancesTour4Body1',
                    'nextDash keeps its own record of the machine, so a graph is full the moment you open it. Record every picks the pace, Keep picks 7, 30 or 90 days.'))}</p>
                    <p>${esc(f('glancesTour4Body2', 'Yesterday behind today shows whether what you see is normal.'))}</p>`,
            },
            // 5 — incidents
            {
                title: f('glancesTour5Title', 'Red bands are incidents'),
                visual: svg(`
                    <rect x="12" y="10" width="330" height="120" rx="6" class="gtv-box"/>
                    <path d="M28,40 L326,40" class="gtv-limit"/>
                    <rect x="176" y="14" width="54" height="108" class="gtv-band gtv-anim gtv-a-band"/>
                    ${line('M28,100 L70,96 L110,102 L150,92 L180,50 L204,26 L228,48 L254,94 L296,98 L326,96', { delay: 0.1 })}
                    ${label(28, 142, f('glancesTour5Limit', 'red line'), 'gtv-sub')}
                    <g class="gtv-anim gtv-a-panel">
                        <rect x="352" y="10" width="118" height="92" rx="8" class="gtv-box"/>
                        ${fitLabel(362, 30, f('glancesAroundIncident', 'Around the incident'), 98, 'gtv-heading')}
                        ${line('M362,76 L386,68 L410,72 L434,56 L458,64', { delay: 0.3 })}
                    </g>
                    ${pill(352, 112, f('glancesTour5Notices', 'notices: off'), { kind: 'dashed' })}
                `, f('glancesTour5Alt', 'A graph with a reading above its red line, a red band, and a panel for that moment')),
                body: `<p>${esc(f('glancesTour5Body1',
                    'A reading that stays past its red line for a few beats opens an incident, drawn as a red band. Click it for the graphs around that moment.'))}</p>
                    <p>${esc(f('glancesTour5Body2',
                    'Notices are off until you switch them on, one kind at a time, in Config → Glances.'))}</p>`,
            },
            // 6 — several hosts, and the Containers view
            {
                title: f('glancesTour6Title', 'More machines, and the Containers view'),
                visual: svg(`
                    ${pill(12, 12, `${f('glancesHost', 'Host')}: Home ▾`, { kind: 'active', w: 110 })}
                    ${['Home', 'NAS', 'Pi'].map((name, i) => `
                        <g class="gtv-anim gtv-a-drop" style="animation-delay:${(0.15 + i * 0.1).toFixed(2)}s">
                            <rect x="12" y="${40 + i * 28}" width="110" height="24" rx="4" class="gtv-box"/>
                            <circle cx="26" cy="${52 + i * 28}" r="4" class="gtv-dot ${i === 2 ? 'is-bad' : i === 1 ? 'is-warn' : 'is-ok'}"/>
                            ${label(38, 56 + i * 28, name, 'gtv-title')}
                        </g>`).join('')}
                    <rect x="9" y="37" width="116" height="30" rx="6" class="gtv-select gtv-anim gtv-a-walk3" style="animation-duration:6s"/>
                    ${label(148, 34, f('glancesTour6Up', 'up to five hosts'), 'gtv-caption')}
                    <g class="gtv-anim gtv-a-panel">
                        <rect x="262" y="14" width="208" height="42" rx="6" class="gtv-box"/>
                        ${label(274, 31, 'Glances', 'gtv-sub')}${label(274, 47, 'app-1', 'gtv-title')}
                        <rect x="262" y="94" width="208" height="42" rx="6" class="gtv-box is-accent"/>
                        ${label(274, 111, f('glancesSectionContainers', 'Containers'), 'gtv-sub')}${label(274, 127, 'app-1', 'gtv-title')}
                        <path d="M366,58 L366,90" class="gtv-arrow" marker-end="url(#gtv-arrow)" marker-start="url(#gtv-arrow)"/>
                        ${label(378, 79, '↗', 'gtv-title')}
                    </g>
                `, f('glancesTour6Alt', 'A host menu with three machines, and a container linked between Glances and the Containers view')),
                body: `<p>${esc(f('glancesTour6Body1',
                    'Add up to five hosts in Config → Glances. The Host menu switches between them, and the Hosts section (m) puts them side by side.'))}</p>
                    <p>${esc(f('glancesTour6Body2',
                    'When Glances runs on your Docker host, each container links to its twin in the Containers view, and back.'))}</p>
                    <p class="glances-tutorial-closing">${esc(f('glancesTourClosing',
                    'The ℹ buttons explain each block, and the Tour button above brings this tour back.'))}</p>`,
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
            <div class="glances-tutorial">
                <div class="glances-tutorial-progress">${esc(progress)}</div>
                <div class="glances-tutorial-scene is-${state.direction}">${step.visual}</div>
                <h3 class="glances-tutorial-step-title">${esc(step.title)}</h3>
                <div class="glances-tutorial-step-body">${step.body}</div>
                <div class="glances-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="glances-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('glancesTourTitle', 'How Glances works'),
            htmlMessage: html,
            confirmText: isLast ? t('dashboard.inboxTutorialDone', 'Got it') : t('dashboard.inboxTutorialNext', 'Next'),
            cancelText: isFirst ? t('dashboard.inboxTutorialSkip', 'Skip') : t('dashboard.inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'glances-tutorial-modal',
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
            // Tour button covers the same ground on demand. Only a real
            // dismissal: Next and Back close the window too, and reach here
            // with their own reason after they have run.
            onHide: ({ reason } = {}) => { if (reason === 'dismiss') finish('dismissed'); },
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('glances-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the page: once, with the same guards as the other tours. */
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
        global.nextdashTrack?.('glances-tutorial:shown');
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
        global.nextdashTrack?.('glances-tutorial:opened');
        return true;
    }

    global.GlancesTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
