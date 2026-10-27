/**
 * One-time Monitoring tour — shown the first time Config → Monitoring is opened.
 *
 * Built like widgets-tutorial.js, and sharing its guards, so a session with
 * tips switched off, or a phone, never sees it. The pictures are drawn the way
 * glances-tutorial.js draws its own: an SVG with its stylesheet inside, so the
 * colours travel with the drawing, and every animation rests on its finished
 * state for a reader who asked for less motion.
 *
 * Why it exists: the section opens on a tab of check settings, and none of it
 * means anything until you know that checking is chosen per bookmark — Off,
 * Periodic or Monitor — and that alerts and schedules only ever concern the
 * monitored ones. Five short steps.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js, which checks it before fetching this
    // file at all, and in the replay lists in config and search. All must agree.
    const TIP_ID = 'monitoringTutorialV1';

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
        .mtv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .mtv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .mtv-box.is-accent { stroke: var(--accent-primary); stroke-width: 1.5; }
        .mtv-title { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .mtv-label { fill: var(--text-secondary); font-size: 10px; }
        .mtv-text { fill: var(--text-primary); font-size: 10.5px; }
        .mtv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .mtv-dot.is-ok, .mtv-bar.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .mtv-dot.is-bad, .mtv-bar.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .mtv-row-bad { stroke: var(--accent-error, var(--accent-primary)); stroke-width: 1.5; fill: none; }
        .mtv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .mtv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .mtv-pill.is-active .mtv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .mtv-pill.is-active .mtv-pill-text { font-weight: 700; }
        .mtv-tab-mark { fill: var(--accent-primary); opacity: 0; }
        .mtv-tab-mark.is-first { opacity: 1; }
        .mtv-select { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .mtv-key { fill: var(--text-secondary); font-size: 9.5px; font-family: var(--font-mono, ui-monospace, monospace); }
        .mtv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .mtv-arrowhead { fill: var(--accent-primary); }
        .mtv-track { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .mtv-band { fill: var(--accent-primary); fill-opacity: 0.28; stroke: var(--accent-primary); stroke-width: 1; }
        .mtv-band.is-quiet { fill: var(--text-secondary); fill-opacity: 0.22; stroke: var(--text-secondary); }
        .mtv-axis { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .mtv-now { stroke: var(--accent-error, var(--accent-primary)); stroke-width: 1.5; }
        .mtv-badge { fill: var(--accent-error, var(--accent-primary)); }
        .mtv-badge-text { fill: var(--background-primary); font-size: 9px; font-weight: 700; }

        .mtv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .mtv-a-tab { animation-name: mtv-tab; animation-timing-function: steps(1, end); }
        .mtv-a-drop { animation-name: mtv-drop; }
        .mtv-a-glow { animation-name: mtv-glow; }
        .mtv-a-pick { animation-name: mtv-pick; }
        .mtv-a-sweep { animation-name: mtv-sweep; animation-timing-function: linear; transform-box: view-box; }
        .mtv-a-draw { stroke-dasharray: 1; animation-name: mtv-draw; }

        /* Each tab lights for a third of the loop, in reading order. */
        @keyframes mtv-tab { 0% { opacity: 1; } 33.3%, 100% { opacity: 0; } }
        @keyframes mtv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes mtv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        /* The selection walks Off, Periodic, and settles on Monitor. */
        @keyframes mtv-pick { 0%, 14% { transform: translateY(-48px); } 30%, 44% { transform: translateY(-24px); } 60%, 100% { transform: none; } }
        /* The hour hand crosses the day; at rest it stands in the window. */
        @keyframes mtv-sweep { 0% { transform: translateX(-40px); } 100% { transform: translateX(278px); } }
        @keyframes mtv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }

        @media (prefers-reduced-motion: reduce) { .mtv-anim { animation: none !important; } }
        body.no-animations .mtv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="mtv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="mtv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="mtv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** A label held to `maxW`: a translation longer than its room is drawn narrower, not over its neighbour. */
    function text(x, y, value, { cls = 'mtv-label', maxW = 0, anchor = 'start' } = {}) {
        const fit = maxW && String(value).length * 6.2 > maxW
            ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}"${fit}>${esc(value)}</text>`;
    }

    const pillWidth = (value) => Math.max(30, String(value).length * 6 + 16);

    /** A pill; `delay` makes it drop in, that many seconds into the loop. */
    function pill(x, y, value, { active = false, w = null, delay = null } = {}) {
        const width = w || pillWidth(value);
        const motion = delay === null ? '' : ' mtv-anim mtv-a-drop';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g class="mtv-pill${active ? ' is-active' : ''}${motion}"${style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="mtv-pill-box"/>
            ${text(x + width / 2, y + 14, value, { cls: 'mtv-pill-text', anchor: 'middle', maxW: width - 10 })}
        </g>`;
    }

    /** A heartbeat strip: one bar per stretch of time, the way the Bookmarks view draws it. */
    function heartbeat(x, y, states, { gap = 3, w = 7, h = 14 } = {}) {
        return states.map((state, i) => `<rect x="${x + i * (w + gap)}" y="${y}" width="${w}" height="${h}" rx="1.5"
            class="mtv-bar is-${state} mtv-anim mtv-a-drop" style="animation-delay:${(i * 0.08).toFixed(2)}s"/>`).join('');
    }

    function intervalLabel(minutes) {
        return minutes < 60
            ? t('healthIntervalMinutes', '{count}m', { count: minutes })
            : t('healthIntervalHours', '{count}h', { count: minutes / 60 });
    }

    /** Step 1: the three tabs, each lighting over what it is about. */
    function sceneTabs() {
        const tabs = [
            t('config.monitoringTabChecks', 'Checks'),
            t('config.monitoringTabNotifications', 'Notifications'),
            t('config.monitoringTabSchedules', 'Schedules'),
        ];
        const cols = [12, 168, 324];
        const colW = 144;
        const tabRow = tabs.map((name, i) => `
            ${pill(cols[i] + (colW - pillWidth(name)) / 2, 8, name)}
            <rect x="${cols[i] + 20}" y="32" width="${colW - 40}" height="2.5" rx="1"
                class="mtv-tab-mark${i === 0 ? ' is-first' : ''} mtv-anim mtv-a-tab" style="animation-delay:${(i * 1.6).toFixed(1)}s"/>`).join('');
        return svg(`
            ${tabRow}
            <rect x="${cols[0]}" y="44" width="${colW}" height="96" rx="6" class="mtv-box"/>
            <circle cx="${cols[0] + 14}" cy="64" r="4.5" class="mtv-dot is-ok"/>
            ${text(cols[0] + 24, 68, 'nas.local', { cls: 'mtv-mono', maxW: 100 })}
            ${heartbeat(cols[0] + 12, 84, ['ok', 'ok', 'ok', 'ok', 'ok', 'bad', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'], { w: 7, gap: 3.8 })}
            ${text(cols[0] + 12, 124, t('monitoringTutorialSceneEvery', 'every {interval}', { interval: intervalLabel(15) }), { maxW: 120 })}

            <rect x="${cols[1]}" y="44" width="${colW}" height="96" rx="6" class="mtv-box is-accent mtv-anim mtv-a-drop" style="animation-delay:.3s"/>
            <path d="M${cols[1] + 16},78 q0,-14 10,-14 q10,0 10,14 l3,5 h-26 z M${cols[1] + 22},86 q4,5 8,0" class="mtv-arrow"/>
            ${text(cols[1] + 48, 70, 'nas.local', { cls: 'mtv-mono', maxW: 88 })}
            ${text(cols[1] + 48, 84, t('monitoringTutorialSceneDown', 'is down'), { cls: 'mtv-text', maxW: 88 })}
            ${text(cols[1] + 12, 124, 'ntfy · Discord · Gotify', { maxW: 120 })}

            <rect x="${cols[2]}" y="44" width="${colW}" height="96" rx="6" class="mtv-box"/>
            <rect x="${cols[2] + 12}" y="70" width="${colW - 24}" height="14" rx="3" class="mtv-track"/>
            <rect x="${cols[2] + 12 + 10}" y="70" width="12" height="14" class="mtv-band"/>
            ${text(cols[2] + 12, 100, '00', { cls: 'mtv-key' })}
            ${text(cols[2] + colW / 2, 100, '12', { cls: 'mtv-key', anchor: 'middle' })}
            ${text(cols[2] + colW - 12, 100, '24', { cls: 'mtv-key', anchor: 'end' })}
            ${text(cols[2] + 12, 124, '02:00–04:00', { maxW: 120 })}
        `, t('monitoringTour1Alt', 'The three tabs: a bookmark and its heartbeat, an alert that it is down, and a window of time'));
    }

    /** Step 2: the menu a bookmark's right-click opens, settling on Monitor, and the intervals. */
    function sceneModes() {
        const modes = [
            [t('config.checkModeOff', 'Off'), 'o'],
            [t('healthBadgePeriodic', 'Periodic'), 'p'],
            [t('healthBadgeMonitor', 'Monitor'), 'm'],
        ];
        const rows = modes.map(([name, k], i) => `
            ${text(32, 54 + i * 24, name, { cls: 'mtv-text', maxW: 120 })}
            ${text(178, 54 + i * 24, k, { cls: 'mtv-key', anchor: 'end' })}`).join('');
        const choices = [5, 15, 30, 60, 360, 1440];
        const chips = choices.map((m, i) => pill(232 + (i % 3) * 78, 56 + Math.floor(i / 3) * 28, intervalLabel(m),
            { active: m === 15, w: 68 })).join('');
        return svg(`
            <rect x="12" y="12" width="180" height="120" rx="6" class="mtv-box"/>
            ${text(24, 30, t('healthCheckModeLabel', 'Availability checking'), { cls: 'mtv-title', maxW: 156 })}
            <rect x="20" y="90" width="164" height="22" rx="4" class="mtv-select mtv-anim mtv-a-pick"/>
            ${rows}
            <path d="M198,100 L222,100" class="mtv-arrow mtv-anim mtv-a-draw" pathLength="1" marker-end="url(#mtv-arrow)" style="animation-delay:.6s"/>
            ${text(232, 36, t('healthIntervalLabel', 'Check interval'), { cls: 'mtv-title', maxW: 228 })}
            ${chips}
        `, t('monitoringTour2Alt', 'The availability menu moving from Off to Periodic to Monitor, and the intervals from 5 minutes to 24 hours'));
    }

    /** Step 3: a page of bookmarks with one down, the badge on the header icon, and the heartbeat. */
    function sceneDown() {
        return svg(`
            <rect x="12" y="12" width="210" height="126" rx="6" class="mtv-box"/>
            ${text(24, 30, t('monitoringTutorialSceneCategory', '// services'), { cls: 'mtv-label', maxW: 180 })}
            <circle cx="30" cy="54" r="4" class="mtv-dot is-ok"/>${text(42, 58, 'router', { cls: 'mtv-text' })}
            <rect x="20" y="70" width="194" height="22" rx="4" class="mtv-row-bad"/>
            <circle cx="30" cy="81" r="4" class="mtv-dot is-bad mtv-anim mtv-a-glow"/>${text(42, 85, 'nas.local', { cls: 'mtv-text' })}
            <circle cx="30" cy="108" r="4" class="mtv-dot is-ok"/>${text(42, 112, 'photos', { cls: 'mtv-text' })}

            <rect x="250" y="12" width="218" height="40" rx="6" class="mtv-box"/>
            <path d="M268,22 h14 v20 l-7,-5 l-7,5 z" class="mtv-arrow"/>
            ${text(294, 36, t('monitoringTutorialSceneBookmarks', 'Bookmarks'), { cls: 'mtv-text', maxW: 120 })}
            <g class="mtv-anim mtv-a-drop" style="animation-delay:.4s">
                <circle cx="284" cy="20" r="7" class="mtv-badge"/>
                <text x="284" y="23.5" text-anchor="middle" class="mtv-badge-text">1</text>
            </g>

            <rect x="250" y="64" width="218" height="74" rx="6" class="mtv-box is-accent"/>
            ${text(262, 82, 'nas.local', { cls: 'mtv-mono', maxW: 100 })}
            ${text(456, 82, t('monitoringTutorialSceneUptime', '98.6% up'), { cls: 'mtv-label', anchor: 'end', maxW: 90 })}
            ${heartbeat(262, 96, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'bad', 'bad', 'bad', 'bad'], { w: 8, gap: 4, h: 18 })}
            ${text(262, 130, t('monitoringTutorialSceneHeartbeat', 'heartbeat'), { cls: 'mtv-label', maxW: 120 })}
        `, t('monitoringTour3Alt', 'A bookmark marked as down among others, a count on the Bookmarks icon, and its heartbeat turning red'));
    }

    /** Step 4: one outage fanning out to every channel the alert can use. */
    function sceneChannels() {
        const services = ['Slack', 'Discord', 'Telegram', 'Gotify', 'ntfy', 'Pushover', 'Apprise'];
        const chips = services.map((name, i) => pill(196 + (i % 4) * 68, 20 + Math.floor(i / 4) * 30, name,
            { w: 62, delay: 0.5 + i * 0.08 })).join('');
        const raw = t('config.monitorNotifyPresetRaw', 'Raw JSON (custom receiver)');
        const push = t('config.pushNotifyTitle', 'Browser notifications');
        return svg(`
            <rect x="12" y="44" width="140" height="56" rx="6" class="mtv-box is-accent"/>
            <circle cx="28" cy="64" r="4.5" class="mtv-dot is-bad mtv-anim mtv-a-glow"/>
            ${text(40, 68, 'nas.local', { cls: 'mtv-mono', maxW: 100 })}
            ${text(24, 88, t('monitoringTutorialSceneDown', 'is down'), { cls: 'mtv-text', maxW: 116 })}
            <path d="M156,72 L188,40" class="mtv-arrow mtv-anim mtv-a-draw" pathLength="1" marker-end="url(#mtv-arrow)" style="animation-delay:.2s"/>
            <path d="M156,72 L188,72" class="mtv-arrow mtv-anim mtv-a-draw" pathLength="1" marker-end="url(#mtv-arrow)" style="animation-delay:.3s"/>
            <path d="M156,72 L188,112" class="mtv-arrow mtv-anim mtv-a-draw" pathLength="1" marker-end="url(#mtv-arrow)" style="animation-delay:.4s"/>
            ${chips}
            ${pill(196, 80, raw, { w: 270, delay: 1.1 })}
            ${pill(196, 112, push, { w: 270, active: true, delay: 1.2 })}
        `, t('monitoringTour4Alt', 'One outage sent on to Slack, Discord, Telegram, Gotify, ntfy, Pushover, Apprise, your own receiver and this browser'));
    }

    /** Step 5: a day, with a maintenance window and quiet hours on it, and the hour crossing them. */
    function sceneSchedules() {
        const x0 = 150;
        const span = 318;
        const hour = span / 24;
        const at = (h) => x0 + h * hour;
        const ticks = [0, 6, 12, 18, 24].map((h) => `
            <path d="M${at(h)},104 v5" class="mtv-axis"/>
            ${text(at(h), 122, `${String(h).padStart(2, '0')}:00`, { cls: 'mtv-key', anchor: h === 0 ? 'start' : (h === 24 ? 'end' : 'middle') })}`).join('');
        return svg(`
            ${text(12, 34, t('config.maintenanceTitle', 'Maintenance windows'), { cls: 'mtv-title', maxW: 130 })}
            ${text(12, 48, t('monitoringTutorialSceneNoAlert', 'no alert, not counted'), { maxW: 130 })}
            <rect x="${x0}" y="22" width="${span}" height="22" rx="4" class="mtv-track"/>
            <rect x="${at(2)}" y="22" width="${hour * 2}" height="22" class="mtv-band"/>

            ${text(12, 76, t('config.quietTitle', 'Quiet hours'), { cls: 'mtv-title', maxW: 130 })}
            ${text(12, 90, t('monitoringTutorialSceneHeld', 'held, then one summary'), { maxW: 130 })}
            <rect x="${x0}" y="64" width="${span}" height="22" rx="4" class="mtv-track"/>
            <rect x="${x0}" y="64" width="${hour * 7}" height="22" class="mtv-band is-quiet"/>
            <rect x="${at(22)}" y="64" width="${hour * 2}" height="22" class="mtv-band is-quiet"/>

            <path d="M${x0},104 H${x0 + span}" class="mtv-axis"/>
            ${ticks}
            <path d="M${at(3)},16 V98" class="mtv-now mtv-anim mtv-a-sweep"/>
        `, t('monitoringTour5Alt', 'A day with a maintenance window from 02:00 to 04:00 and quiet hours from 22:00 to 07:00'));
    }

    /**
     * Each step is a title, a visual and an HTML body. The bodies are trusted —
     * assembled here from esc()'d pieces, never from user input.
     */
    function steps() {
        return [
            {
                title: t('monitoringTour1Title', 'Watching your services, not only your links'),
                visual: sceneTabs(),
                body: `<p>${esc(t('monitoringTour1Body1',
                    'Monitoring decides how bookmarks are checked and how you hear when one goes down.'))}</p>
                <p>${esc(t('monitoringTour1Body2',
                    'Checks sets how they are tested, such as the timeout and the warning before a certificate expires. Notifications says where an outage is sent, and Schedules marks the hours when downtime is expected or notices should wait.'))}</p>`,
            },
            {
                title: t('monitoringTour2Title', 'Off, Periodic or Monitor, per bookmark'),
                visual: sceneModes(),
                body: `<p>${esc(t('monitoringTour2Body1',
                    'Each bookmark has its own availability check. Right-click it on the dashboard and choose Checking: Off never tests it, Periodic checks about once a day and flags it when it breaks.'))}</p>
                <p>${esc(t('monitoringTour2Body2',
                    'Monitor checks on its own interval, from every 5 minutes to once a day, and keeps uptime history, a heartbeat and outage alerts. A new monitor starts at 15 minutes; change it in the Bookmarks view.'))}</p>`,
            },
            {
                title: t('monitoringTour3Title', 'When something goes down'),
                visual: sceneDown(),
                body: `<p>${esc(t('monitoringTour3Body1',
                    'A monitor that is down is marked on the dashboard, and the Bookmarks icon in the header carries a count.'))}</p>
                <p>${esc(t('monitoringTour3Body2',
                    'The Bookmarks view lists it with its uptime and a heartbeat, one bar per stretch of time. On the Checks tab, Monitored bookmarks on the dashboard sets how much a healthy monitor stands out.'))}</p>`,
            },
            {
                title: t('monitoringTour4Title', 'How an outage reaches you'),
                visual: sceneChannels(),
                body: `<p>${esc(t('monitoringTour4Body1',
                    'Downtime alerts post to Slack, Discord, Telegram, Gotify, ntfy, Pushover, Apprise or your own JSON receiver when a monitor goes down, and again when it recovers. Periodic bookmarks never notify.'))}</p>
                <p>${esc(t('monitoringTour4Body2',
                    'Browser notifications reach this browser even with nextDash closed. Reminders repeat an outage that is still going, and the weekly digest sums up the week.'))}</p>`,
            },
            {
                title: t('monitoringTour5Title', 'Schedules: time set aside'),
                visual: sceneSchedules(),
                body: `<p>${esc(t('monitoringTour5Body1',
                    'A maintenance window covers downtime you expect, such as a nightly backup. Checks still run, but failures inside it raise no alert and do not count against uptime.'))}</p>
                <p>${esc(t('monitoringTour5Body2',
                    'Quiet hours hold notices instead, and one summary at the end says what is still down; the downtime still counts. The Tour button above the tabs brings this tour back.'))}</p>`,
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
        const progress = t('monitoringTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="monitoring-tutorial">
                <div class="monitoring-tutorial-progress">${esc(progress)}</div>
                <h3 class="monitoring-tutorial-step-title">${esc(step.title)}</h3>
                <div class="monitoring-tutorial-scene is-${state.direction}">${step.visual}</div>
                <div class="monitoring-tutorial-step-body">${step.body}</div>
                <div class="monitoring-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="monitoring-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('monitoringTutorialTitle', 'How monitoring works'),
            htmlMessage: html,
            confirmText: isLast
                ? t('monitoringTutorialDone', 'Got it')
                : t('monitoringTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('monitoringTutorialSkip', 'Skip')
                : t('monitoringTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'monitoring-tutorial-modal',
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
            // the Widgets tour: the Tour button brings it back on demand.
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
        global.nextdashTrack?.('monitoring-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the section: once, with the same guards as the Widgets tour. */
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
        global.nextdashTrack?.('monitoring-tutorial:shown');
        return true;
    }

    /** The Tour button in the Monitoring band, and Config's replay: on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('monitoring-tutorial:opened');
        return true;
    }

    global.MonitoringTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
