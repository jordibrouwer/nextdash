/**
 * One-time Unraid tour — shown the first time Config → Unraid is opened.
 *
 * Built like monitoring-tutorial.js, and sharing its guards, so a session with
 * tips switched off, or a phone, never sees it. The pictures are drawn the same
 * way: an SVG with its stylesheet inside, so the colours travel with the
 * drawing, and every animation rests on its finished state for a reader who
 * asked for less motion.
 *
 * Why it exists: the section opens on an address field and a key field, and
 * neither says what connecting buys you, where the key comes from, or that
 * nextDash only ever reads. Five short steps.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js, which checks it before fetching this
    // file at all, and in the replay lists in config and search. All must agree.
    const TIP_ID = 'unraidTutorialV1';

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
     * The scene's own stylesheet. Letters are only ever the theme's text
     * colours on its primary background; the status colours are for bars,
     * dots and bands.
     */
    const SCENE_STYLE = `
        .utv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .utv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .utv-box.is-accent { stroke: var(--accent-primary); stroke-width: 1.5; }
        .utv-title { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .utv-label { fill: var(--text-secondary); font-size: 10px; }
        .utv-text { fill: var(--text-primary); font-size: 10.5px; }
        .utv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .utv-dot.is-ok, .utv-bar.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .utv-dot.is-bad, .utv-bar.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .utv-dot.is-run { fill: var(--accent-primary); }
        .utv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .utv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .utv-pill.is-active .utv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .utv-pill.is-active .utv-pill-text { font-weight: 700; }
        .utv-field { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .utv-button { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .utv-button.is-primary { fill: var(--accent-primary); stroke: var(--accent-primary); stroke-opacity: 1; }
        .utv-button-text { fill: var(--text-primary); font-size: 9.5px; }
        .utv-button-text.is-primary { fill: var(--background-primary); font-weight: 700; }
        .utv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .utv-arrowhead { fill: var(--accent-primary); }
        .utv-wire { fill: none; stroke: var(--border-primary); stroke-width: 1.5; stroke-dasharray: 3 3; }
        .utv-track { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .utv-fill { fill: var(--accent-primary); fill-opacity: 0.55; }
        .utv-lock { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }

        .utv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .utv-a-drop { animation-name: utv-drop; }
        .utv-a-glow { animation-name: utv-glow; }
        .utv-a-run { animation-name: utv-run; animation-timing-function: linear; transform-box: view-box; }
        .utv-a-draw { stroke-dasharray: 1; animation-name: utv-draw; }
        .utv-a-grow { animation-name: utv-grow; transform-origin: left center; }

        @keyframes utv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes utv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        /* A reading travels from the server to the dashboard; at rest it has arrived. */
        @keyframes utv-run { 0% { transform: translateX(176px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: none; opacity: 0; } }
        @keyframes utv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes utv-grow { 0%, 10% { transform: scaleX(0); } 50%, 100% { transform: none; } }

        @media (prefers-reduced-motion: reduce) { .utv-anim { animation: none !important; } }
        body.no-animations .utv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="utv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="utv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="utv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** A label held to `maxW`: a translation longer than its room is drawn narrower, not over its neighbour. */
    function text(x, y, value, { cls = 'utv-label', maxW = 0, anchor = 'start' } = {}) {
        const fit = maxW && String(value).length * 6.2 > maxW
            ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}"${fit}>${esc(value)}</text>`;
    }

    const pillWidth = (value) => Math.max(30, String(value).length * 6 + 16);

    /** A pill; `delay` makes it drop in, that many seconds into the loop. */
    function pill(x, y, value, { active = false, w = null, delay = null } = {}) {
        const width = w || pillWidth(value);
        const motion = delay === null ? '' : ' utv-anim utv-a-drop';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g class="utv-pill${active ? ' is-active' : ''}${motion}"${style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="utv-pill-box"/>
            ${text(x + width / 2, y + 14, value, { cls: 'utv-pill-text', anchor: 'middle', maxW: width - 10 })}
        </g>`;
    }

    /** A button the way the Connection card draws its two. */
    function button(x, y, w, value, { primary = false, delay = null } = {}) {
        const motion = delay === null ? '' : ' class="utv-anim utv-a-drop"';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g${motion}${style}>
            <rect x="${x}" y="${y}" width="${w}" height="18" rx="4" class="utv-button${primary ? ' is-primary' : ''}"/>
            ${text(x + w / 2, y + 12.5, value, { cls: `utv-button-text${primary ? ' is-primary' : ''}`, anchor: 'middle', maxW: w - 8 })}
        </g>`;
    }

    const typeName = (type, fallback) => t(`dashboard.widgetType.${type}`, fallback);

    /** Step 1: nextDash and the server, a reading running between them, and what it carries. */
    function sceneFlow() {
        const runs = [0, 1.6, 3.2].map((delay) => `
            <circle cx="152" cy="82" r="4" class="utv-dot is-run utv-anim utv-a-run" style="animation-delay:${delay.toFixed(1)}s"/>`).join('');
        return svg(`
            ${text(W / 2, 30, t('config.unraidHowCarries', 'array · parity · shares · VMs · UPS · alerts'), { cls: 'utv-label', anchor: 'middle', maxW: 300 })}
            <rect x="12" y="52" width="128" height="60" rx="6" class="utv-box is-accent"/>
            ${text(76, 80, 'nextDash', { cls: 'utv-title', anchor: 'middle', maxW: 110 })}
            ${text(76, 98, t('config.unraidHowDashboard', 'dashboard'), { anchor: 'middle', maxW: 110 })}

            <path d="M148,82 H332" class="utv-wire"/>
            ${runs}

            <rect x="340" y="52" width="128" height="60" rx="6" class="utv-box"/>
            ${text(404, 80, 'Unraid', { cls: 'utv-title', anchor: 'middle', maxW: 110 })}
            ${text(404, 98, t('config.unraidHowServer', 'your server'), { anchor: 'middle', maxW: 110 })}

            ${text(W / 2, 136, t('unraidTutorialSceneMinute', 'about once a minute, read only'), { anchor: 'middle', maxW: 300 })}
        `, t('unraidTour1Alt', 'nextDash and an Unraid server, with readings about the array, parity, shares, VMs, the UPS and alerts running from the server to the dashboard'));
    }

    /** Step 2: the key made in Unraid, then the address and key filled in, tested and saved. */
    function sceneConnect() {
        const areas = [
            ['Array', 0.9], ['Parity', 1.05], ['Shares', 1.2],
        ];
        const yes = t('config.unraidAreaOk', 'yes');
        const result = areas.map(([name, delay], i) => `
            <g class="utv-anim utv-a-drop" style="animation-delay:${delay.toFixed(2)}s">
                <circle cx="${258 + i * 70}" cy="138" r="3.5" class="utv-dot is-ok"/>
                ${text(265 + i * 70, 141.5, `${name}: ${yes}`, { maxW: 58 })}
            </g>`).join('');
        return svg(`
            <rect x="12" y="12" width="196" height="126" rx="6" class="utv-box"/>
            ${text(24, 30, 'Unraid', { cls: 'utv-title' })}
            ${text(24, 50, 'Settings →', { cls: 'utv-mono' })}
            ${text(24, 66, 'Management Access →', { cls: 'utv-mono', maxW: 170 })}
            ${text(24, 82, 'API Keys', { cls: 'utv-mono' })}
            ${pill(24, 100, 'Viewer', { active: true, delay: 0.2 })}
            <path d="M214,75 L238,75" class="utv-arrow utv-anim utv-a-draw" pathLength="1" marker-end="url(#utv-arrow)" style="animation-delay:.4s"/>

            <rect x="246" y="12" width="222" height="112" rx="6" class="utv-box is-accent"/>
            ${text(258, 30, t('config.unraidAddress', 'Address'), { cls: 'utv-label', maxW: 70 })}
            <rect x="330" y="19" width="128" height="16" rx="3" class="utv-field"/>
            ${text(336, 31, 'http://192.168.1.10', { cls: 'utv-mono', maxW: 116 })}
            ${text(258, 56, t('config.unraidKey', 'API key'), { cls: 'utv-label', maxW: 70 })}
            <rect x="330" y="45" width="128" height="16" rx="3" class="utv-field"/>
            <g class="utv-anim utv-a-grow" style="animation-delay:.5s">${text(336, 57, '••••••••••••', { cls: 'utv-mono' })}</g>
            ${button(258, 76, 104, t('config.unraidTest', 'Test connection'), { delay: 0.7 })}
            ${button(370, 76, 88, t('config.unraidSave', 'Save'), { primary: true, delay: 1.4 })}
            ${text(258, 114, 'Tower · Unraid 7', { cls: 'utv-mono', maxW: 200 })}
            ${result}
        `, t('unraidTour2Alt', 'An API key with the role Viewer made in Unraid, then the address and key filled in, the connection tested and saved'));
    }

    /** Step 3: the overview tile, and the seven kinds dropping in beside it. */
    function sceneWidgets() {
        const kinds = [
            ['unraid', 'Unraid'], ['unraidArray', 'Unraid array'], ['unraidParity', 'Parity'], ['unraidShares', 'Shares'],
            ['unraidVms', 'VMs'], ['unraidUps', 'UPS'], ['unraidNotifications', 'Unraid notifications'],
        ];
        const chips = kinds.map(([type, fallback], i) => {
            const wide = i === 6;
            const col = i % 2;
            const row = Math.floor(i / 2);
            return pill(wide ? 196 : 196 + col * 138, 12 + row * 32, typeName(type, fallback),
                { w: wide ? 272 : 130, active: i === 0, delay: 0.2 + i * 0.12 });
        }).join('');
        const rows = [
            [t('dashboard.widgetType.unraidArray', 'Unraid array'), 0.62],
            [typeName('unraidParity', 'Parity'), 1],
            [typeName('unraidUps', 'UPS'), 0.88],
        ].map(([name, share], i) => `
            ${text(24, 56 + i * 26, name, { cls: 'utv-text', maxW: 66 })}
            <rect x="96" y="${47 + i * 26}" width="68" height="10" rx="3" class="utv-track"/>
            <rect x="96" y="${47 + i * 26}" width="${(68 * share).toFixed(1)}" height="10" rx="3" class="utv-fill utv-anim utv-a-grow" style="animation-delay:${(0.3 + i * 0.2).toFixed(1)}s"/>`).join('');
        return svg(`
            <rect x="12" y="12" width="166" height="126" rx="6" class="utv-box is-accent"/>
            ${text(24, 30, `// ${typeName('unraid', 'Unraid').toLowerCase()}`, { cls: 'utv-label', maxW: 140 })}
            ${rows}
            <circle cx="28" cy="126" r="4" class="utv-dot is-ok"/>
            ${text(38, 129.5, 'Tower', { cls: 'utv-mono' })}
            ${chips}
        `, t('unraidTour3Alt', 'The Unraid overview tile, and the seven widget kinds: Unraid, Unraid array, Parity, Shares, VMs, UPS and Unraid notifications'));
    }

    /** Step 4: what Unraid says, sent on to the alert channels, and the Server tab of Statistics. */
    function sceneAlerts() {
        const events = [
            t('unraidTutorialSceneStopped', 'array stopped'),
            t('unraidTutorialSceneDiskErrors', 'disk errors'),
            t('unraidTutorialSceneParityErrors', 'parity errors'),
        ];
        const list = events.map((name, i) => `
            <circle cx="26" cy="${52 + i * 22}" r="4" class="utv-dot is-bad${i === 0 ? ' utv-anim utv-a-glow' : ''}"/>
            ${text(36, 55.5 + i * 22, name, { cls: 'utv-text', maxW: 92 })}`).join('');
        return svg(`
            <rect x="12" y="12" width="128" height="116" rx="6" class="utv-box is-accent"/>
            ${text(24, 30, 'Unraid', { cls: 'utv-title' })}
            ${list}
            <path d="M146,50 L176,36" class="utv-arrow utv-anim utv-a-draw" pathLength="1" marker-end="url(#utv-arrow)" style="animation-delay:.2s"/>
            <path d="M146,70 L176,72" class="utv-arrow utv-anim utv-a-draw" pathLength="1" marker-end="url(#utv-arrow)" style="animation-delay:.3s"/>
            ${pill(184, 26, t('config.monitoringTabNotifications', 'Notifications'), { w: 130, delay: 0.5 })}
            ${pill(184, 62, t('config.pushNotifyTitle', 'Browser notifications'), { w: 130, active: true, delay: 0.6 })}

            <rect x="326" y="12" width="142" height="116" rx="6" class="utv-box"/>
            ${text(338, 30, t('config.statsTabServer', 'Server'), { cls: 'utv-title', maxW: 118 })}
            ${text(338, 52, t('config.statsArrayUsed', 'Array used'), { cls: 'utv-label', maxW: 118 })}
            ${text(338, 74, '62%', { cls: 'utv-title' })}
            <rect x="338" y="86" width="118" height="10" rx="3" class="utv-track"/>
            <rect x="338" y="86" width="73" height="10" rx="3" class="utv-fill utv-anim utv-a-grow" style="animation-delay:.8s"/>
            ${text(338, 116, t('config.statsUnraidNotices', 'Unraid notices'), { cls: 'utv-label', maxW: 118 })}
        `, t('unraidTour4Alt', 'A stopped array, disk errors and parity errors sent on to the alert channels and this browser, and the array use on the Server tab of Statistics'));
    }

    /** Step 5: the key field that only says it is set, the key kept on the server, the server only read. */
    function sceneSafe() {
        return svg(`
            <rect x="12" y="40" width="140" height="66" rx="6" class="utv-box"/>
            ${text(24, 58, t('config.unraidKey', 'API key'), { cls: 'utv-label', maxW: 116 })}
            <rect x="24" y="68" width="116" height="18" rx="3" class="utv-field"/>
            ${text(30, 80.5, t('config.unraidKeySet', 'Set. Type to replace.'), { cls: 'utv-label', maxW: 104 })}

            <rect x="170" y="28" width="140" height="90" rx="6" class="utv-box is-accent"/>
            ${text(240, 46, t('unraidTutorialSceneServer', 'nextDash server'), { cls: 'utv-title', anchor: 'middle', maxW: 124 })}
            <g class="utv-anim utv-a-drop" style="animation-delay:.3s">
                <rect x="226" y="58" width="28" height="22" rx="3" class="utv-lock"/>
                <path d="M232,58 v-6 a8,8 0 0 1 16,0 v6" class="utv-lock"/>
            </g>
            ${text(240, 104, 'unraid-secrets.json', { cls: 'utv-mono', anchor: 'middle', maxW: 124 })}

            <path d="M316,73 L346,73" class="utv-arrow utv-anim utv-a-draw" pathLength="1" marker-end="url(#utv-arrow)" style="animation-delay:.6s"/>
            <rect x="354" y="40" width="114" height="66" rx="6" class="utv-box"/>
            ${text(411, 60, 'Unraid', { cls: 'utv-title', anchor: 'middle' })}
            ${pill(373, 74, 'Viewer', { active: true, w: 76, delay: 0.8 })}
            ${text(W / 2, 140, t('unraidTutorialSceneReadOnly', 'reads only: never starts, stops or changes'), { anchor: 'middle', maxW: 320 })}
        `, t('unraidTour5Alt', 'The key field saying the key is set, the key locked away on the nextDash server, and a Viewer key that only reads Unraid'));
    }

    /**
     * Each step is a title, a visual and an HTML body. The bodies are trusted —
     * assembled here from esc()'d pieces, never from user input.
     */
    function steps() {
        return [
            {
                title: t('unraidTour1Title', 'Your Unraid server, on your pages'),
                visual: sceneFlow(),
                body: `<p>${esc(t('unraidTour1Body1',
                    'Connect your Unraid server once and every Unraid widget reads it: the array, parity, shares, VMs, the UPS and Unraid\'s alerts.'))}</p>
                <p>${esc(t('unraidTour1Body2',
                    'nextDash asks the server about once a minute and only reads: it never starts, stops or changes anything there. Connection holds the settings, and How it works ticks off the three steps as you do them.'))}</p>`,
            },
            {
                title: t('unraidTour2Title', 'Connecting: an address and a key'),
                visual: sceneConnect(),
                body: `<p>${esc(t('unraidTour2Body1',
                    'In Unraid, make an API key with the role Viewer under Settings → Management Access → API Keys. Then fill in the server\'s address and the key on the Connection tab.'))}</p>
                <p>${esc(t('unraidTour2Body2',
                    'Test connection asks the server and lists what the key may read, such as Array: yes. Save stores it, and the Unraid widgets read this server from then on. A new address needs the key again.'))}</p>`,
            },
            {
                title: t('unraidTour3Title', 'Seven widgets to choose from'),
                visual: sceneWidgets(),
                body: `<p>${esc(t('unraidTour3Body1',
                    'The Unraid widget is one overview tile with a line each for the array, parity, disks, alerts, VMs and the UPS. Unraid array, Parity, Shares, VMs, UPS and Unraid notifications give one area a tile of its own.'))}</p>
                <p>${esc(t('unraidTour3Body2',
                    'Each widget sets how often it refreshes, how many rows it shows and whether a click opens that page in Unraid. The Add buttons on the Connection tab open the widget catalogue on that kind.'))}</p>`,
            },
            {
                title: t('unraidTour4Title', 'Alerts and statistics'),
                visual: sceneAlerts(),
                body: `<p>${esc(t('unraidTour4Body1',
                    'With Send Unraid alerts through the alert channels switched on, a stopped array, new disk errors, a parity check that finished with errors and Unraid\'s own alerts reach you through the channels set in Config → Monitoring, and in this browser when browser notifications are on.'))}</p>
                <p>${esc(t('unraidTour4Body2',
                    'Statistics → Server shows how full the array is, each disk with its temperature, the last parity check, the VMs, the UPS and Unraid\'s notices.'))}</p>`,
            },
            {
                title: t('unraidTour5Title', 'Staying safe'),
                visual: sceneSafe(),
                body: `<p>${esc(t('unraidTour5Body1',
                    'A Viewer key is enough, and the test says so when a key can do more than read. nextDash only reads: nothing on the server is started, stopped or changed.'))}</p>
                <p>${esc(t('unraidTour5Body2',
                    'The key stays on the nextDash server, in a file of its own apart from the other settings, and is never sent back to the browser: the field only says it is set. The Tour button above the tabs brings this tour back.'))}</p>`,
            },
        ];
    }

    let state = { index: 0, direction: 'forward' };

    function render() {
        const all = steps();
        const total = all.length;
        const step = all[state.index];
        const isLast = state.index === total - 1;
        const isFirst = state.index === 0;
        const progress = t('unraidTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="unraid-tutorial">
                <div class="unraid-tutorial-progress">${esc(progress)}</div>
                <h3 class="unraid-tutorial-step-title">${esc(step.title)}</h3>
                <div class="unraid-tutorial-scene is-${state.direction}">${step.visual}</div>
                <div class="unraid-tutorial-step-body">${step.body}</div>
                <div class="unraid-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="unraid-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('unraidTutorialTitle', 'How Unraid works here'),
            htmlMessage: html,
            confirmText: isLast
                ? t('unraidTutorialDone', 'Got it')
                : t('unraidTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('unraidTutorialSkip', 'Skip')
                : t('unraidTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'unraid-tutorial-modal',
            modalMaxWidth: 'min(36rem, calc(100vw - 2.5rem))',
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
            // Escape, the backdrop and walking away all count as seen, as in
            // the Monitoring tour: the Tour button brings it back on demand.
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
        global.nextdashTrack?.('unraid-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the section: once, with the same guards as the Monitoring tour. */
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
        global.nextdashTrack?.('unraid-tutorial:shown');
        return true;
    }

    /** The Tour button in the Unraid band, and Config's replay: on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('unraid-tutorial:opened');
        return true;
    }

    global.UnraidTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
