/**
 * One-time AI Assistant tour — shown the first time Config → Assistant is opened.
 *
 * Built like assistant-tutorial.js, and sharing its guards, so a session with
 * tips switched off, or a phone, never sees it. The pictures are drawn the same
 * way: an SVG with its stylesheet inside, so the colours travel with the
 * drawing, and every animation rests on its finished state for a reader who
 * asked for less motion.
 *
 * Why it exists: the section opens on a switch, a provider and a key, and none
 * of them says what the assistant is for, what it may look at, or that it only
 * proposes changes. Five short steps.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js, which checks it before fetching this
    // file at all, and in the replay lists in config and search. All must agree.
    const TIP_ID = 'assistantTutorialV1';

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
        .atv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .atv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .atv-box.is-accent { stroke: var(--accent-primary); stroke-width: 1.5; }
        .atv-title { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .atv-label { fill: var(--text-secondary); font-size: 10px; }
        .atv-text { fill: var(--text-primary); font-size: 10.5px; }
        .atv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .atv-dot.is-ok, .atv-bar.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .atv-dot.is-bad, .atv-bar.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .atv-dot.is-run { fill: var(--accent-primary); }
        .atv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .atv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .atv-pill.is-active .atv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .atv-pill.is-active .atv-pill-text { font-weight: 700; }
        .atv-field { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .atv-button { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .atv-button.is-primary { fill: var(--accent-primary); stroke: var(--accent-primary); stroke-opacity: 1; }
        .atv-button-text { fill: var(--text-primary); font-size: 9.5px; }
        .atv-button-text.is-primary { fill: var(--background-primary); font-weight: 700; }
        .atv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .atv-arrowhead { fill: var(--accent-primary); }
        .atv-wire { fill: none; stroke: var(--border-primary); stroke-width: 1.5; stroke-dasharray: 3 3; }
        .atv-track { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .atv-fill { fill: var(--accent-primary); fill-opacity: 0.55; }
        .atv-lock { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .atv-switch { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .atv-switch.is-on { fill: var(--accent-success, var(--accent-primary)); stroke: none; }
        .atv-knob { fill: var(--background-primary); }

        .atv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .atv-a-drop { animation-name: atv-drop; }
        .atv-a-glow { animation-name: atv-glow; }
        .atv-a-run { animation-name: atv-run; animation-timing-function: linear; transform-box: view-box; }
        .atv-a-type { animation-name: atv-type; transform-origin: left center; }
        .atv-a-draw { stroke-dasharray: 1; animation-name: atv-draw; }
        .atv-a-grow { animation-name: atv-grow; transform-origin: left center; }

        @keyframes atv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes atv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
        /* A reading travels from the server to the dashboard; at rest it has arrived. */
        @keyframes atv-run { 0% { transform: translateX(176px); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: none; opacity: 0; } }
        @keyframes atv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes atv-type { 0%, 6% { opacity: 0; transform: scaleX(0.2); } 30%, 100% { opacity: 1; transform: none; } }
        @keyframes atv-grow { 0%, 10% { transform: scaleX(0); } 50%, 100% { transform: none; } }

        @media (prefers-reduced-motion: reduce) { .atv-anim { animation: none !important; } }
        body.no-animations .atv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="atv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="atv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="atv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** A label held to `maxW`: a translation longer than its room is drawn narrower, not over its neighbour. */
    function text(x, y, value, { cls = 'atv-label', maxW = 0, anchor = 'start' } = {}) {
        const fit = maxW && String(value).length * 6.2 > maxW
            ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}"${fit}>${esc(value)}</text>`;
    }

    const pillWidth = (value) => Math.max(30, String(value).length * 6 + 16);

    /** A pill; `delay` makes it drop in, that many seconds into the loop. */
    function pill(x, y, value, { active = false, w = null, delay = null } = {}) {
        const width = w || pillWidth(value);
        const motion = delay === null ? '' : ' atv-anim atv-a-drop';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g class="atv-pill${active ? ' is-active' : ''}${motion}"${style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="atv-pill-box"/>
            ${text(x + width / 2, y + 14, value, { cls: 'atv-pill-text', anchor: 'middle', maxW: width - 10 })}
        </g>`;
    }

    /** A button the way the Connection card draws its two. */
    function button(x, y, w, value, { primary = false, delay = null } = {}) {
        const motion = delay === null ? '' : ' class="atv-anim atv-a-drop"';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g${motion}${style}>
            <rect x="${x}" y="${y}" width="${w}" height="18" rx="4" class="atv-button${primary ? ' is-primary' : ''}"/>
            ${text(x + w / 2, y + 12.5, value, { cls: `atv-button-text${primary ? ' is-primary' : ''}`, anchor: 'middle', maxW: w - 8 })}
        </g>`;
    }

    const typeName = (type, fallback) => t(`dashboard.widgetType.${type}`, fallback);

    /** A switch the way the Settings tab draws one. */
    function toggle(x, y, on, { delay = null } = {}) {
        const motion = delay === null ? '' : ' class="atv-anim atv-a-drop"';
        const style = delay === null ? '' : ` style="animation-delay:${delay.toFixed(2)}s"`;
        return `<g${motion}${style}>
            <rect x="${x}" y="${y}" width="26" height="14" rx="7" class="atv-switch${on ? ' is-on' : ''}"/>
            <circle cx="${on ? x + 19 : x + 7}" cy="${y + 7}" r="5" class="atv-knob"/>
        </g>`;
    }

    /** Step 1: a question typed after `=`, and an answer with a link into the page. */
    function sceneAsk() {
        return svg(`
            <rect x="12" y="12" width="456" height="30" rx="6" class="atv-box is-accent"/>
            ${text(24, 31, '=', { cls: 'atv-title' })}
            <g class="atv-anim atv-a-type" style="animation-delay:.1s">${text(40, 31, t('config.assistantTourQuestion', 'which bookmarks have I not opened this year?'), { cls: 'atv-mono', maxW: 410 })}</g>

            <rect x="12" y="54" width="130" height="84" rx="6" class="atv-box"/>
            ${text(24, 72, t('assistant.newConversation', 'New conversation'), { cls: 'atv-title', maxW: 106 })}
            ${text(24, 94, t('config.assistantTourPast1', 'Router notes'), { maxW: 106 })}
            ${text(24, 112, t('config.assistantTourPast2', 'Old recipes'), { maxW: 106 })}

            <rect x="152" y="54" width="316" height="84" rx="6" class="atv-box"/>
            <g class="atv-anim atv-a-drop" style="animation-delay:.9s">
                <circle cx="168" cy="73" r="4" class="atv-dot is-run"/>
                ${text(180, 76.5, t('assistant.statusBookmarks', 'Looking at your bookmarks…'), { cls: 'atv-label', maxW: 270 })}
            </g>
            <g class="atv-anim atv-a-drop" style="animation-delay:1.6s">
                ${text(164, 98, t('config.assistantTourAnswer', 'Fourteen, most of them in Reading.'), { cls: 'atv-text', maxW: 292 })}
                ${text(164, 118, t('config.assistantTourLink', 'Open Reading →'), { cls: 'atv-mono', maxW: 200 })}
            </g>
        `, t('assistantTour1Alt', 'A question typed after the equals sign in the search bar, the assistant looking at the bookmarks, and an answer with a link to the page it names'));
    }

    /** Step 2: switch on, pick a provider, a key, Test connection. */
    function sceneSetup() {
        const providers = [['Claude', 24], ['OpenAI', 84], [t('config.assistantTourLocal', 'Your own server'), 140]];
        const chips = providers.map(([name, x], i) => pill(x, 52, name, { active: i === 0, w: i === 2 ? 108 : (i === 0 ? 54 : 50), delay: 0.3 + i * 0.12 })).join('');
        return svg(`
            <rect x="12" y="12" width="256" height="126" rx="6" class="atv-box is-accent"/>
            ${toggle(24, 22, true, { delay: 0.1 })}
            ${text(58, 33, t('config.assistantEnabled', 'Turn the assistant on'), { cls: 'atv-text', maxW: 200 })}
            ${chips}
            ${text(24, 92, t('config.assistantKey', 'API key'), { cls: 'atv-label', maxW: 60 })}
            <rect x="88" y="81" width="168" height="16" rx="3" class="atv-field"/>
            <g class="atv-anim atv-a-grow" style="animation-delay:.9s">${text(94, 93, '••••••••••••••', { cls: 'atv-mono' })}</g>
            ${button(24, 108, 96, t('config.assistantKeySave', 'Save key'), { delay: 1.2 })}
            ${button(128, 108, 112, t('config.assistantTest', 'Test connection'), { primary: true, delay: 1.7 })}

            <path d="M274,75 L298,75" class="atv-arrow atv-anim atv-a-draw" pathLength="1" marker-end="url(#atv-arrow)" style="animation-delay:1.9s"/>
            <rect x="306" y="42" width="162" height="66" rx="6" class="atv-box"/>
            <g class="atv-anim atv-a-drop" style="animation-delay:2.1s">
                <circle cx="320" cy="62" r="4" class="atv-dot is-ok"/>
                ${text(330, 65.5, t('config.assistantTourWorking', 'Working'), { cls: 'atv-title', maxW: 130 })}
                ${text(318, 86, 'claude-sonnet-5-5', { cls: 'atv-mono', maxW: 140 })}
                ${text(318, 100, t('config.assistantTourOneRequest', 'one small request'), { maxW: 140 })}
            </g>
        `, t('assistantTour2Alt', 'The assistant switched on, Claude chosen as provider, an API key saved, and Test connection answering that it works'));
    }

    /** Step 3: what it looks up by itself, and the four MCP switches that open more. */
    function sceneSees() {
        const rows = [
            [t('config.mcpGroupBookmarksWrite', 'Bookmarks: edit and delete'), false],
            [t('config.mcpGroupHealthInbox', 'Health and Inbox: read'), true],
            [t('config.mcpGroupContainersRead', 'Containers: read'), true],
            [t('config.mcpGroupContainersControl', 'Containers: control'), false],
        ].map(([name, on], i) => `
            ${text(224, 53 + i * 24, name, { cls: 'atv-text', maxW: 190 })}
            ${toggle(430, 42 + i * 24, on, { delay: 0.4 + i * 0.15 })}`).join('');
        return svg(`
            <rect x="12" y="12" width="150" height="126" rx="6" class="atv-box is-accent"/>
            ${text(24, 30, t('config.assistantTourAlways', 'Always'), { cls: 'atv-title', maxW: 126 })}
            ${[
                ['assistantTourSeesBookmarks', 'Bookmarks'], ['assistantTourSeesTags', 'Tags'],
                ['assistantTourSeesPages', 'Pages'], ['assistantTourSeesManual', 'The manual'],
            ].map(([key, fallback], i) => `
                <circle cx="30" cy="${50 + i * 20}" r="3.5" class="atv-dot is-ok"/>
                ${text(40, 53.5 + i * 20, t(`config.${key}`, fallback), { cls: 'atv-text', maxW: 112 })}`).join('')}

            <path d="M168,75 L206,75" class="atv-wire"/>
            <rect x="212" y="12" width="256" height="126" rx="6" class="atv-box"/>
            ${text(224, 30, t('config.assistantAccessGroups', 'MCP access switches'), { cls: 'atv-title', maxW: 232 })}
            ${rows}
        `, t('assistantTour3Alt', 'What the assistant always looks up: bookmarks, tags, pages and the manual, and four access switches that add Health and Inbox, containers, editing and container control'));
    }

    /** Step 4: an answer with a proposed change under it, waiting for Apply. */
    function sceneApply() {
        return svg(`
            <rect x="12" y="12" width="456" height="32" rx="6" class="atv-box"/>
            ${text(24, 32, t('config.assistantTourAsk2', '› move the three router guides to Network'), { cls: 'atv-mono', maxW: 430 })}

            <rect x="12" y="54" width="456" height="84" rx="6" class="atv-box is-accent"/>
            ${text(24, 72, t('config.assistantTourPropose', 'I can move them. Check the change first:'), { cls: 'atv-text', maxW: 430 })}
            <g class="atv-anim atv-a-drop" style="animation-delay:.5s">
                <rect x="24" y="82" width="432" height="46" rx="4" class="atv-field"/>
                ${text(34, 99, t('assistant.toolMove', 'Move a bookmark'), { cls: 'atv-title', maxW: 250 })}
                ${text(34, 117, 'Router setup  →  Network', { cls: 'atv-mono', maxW: 250 })}
            </g>
            ${button(300, 94, 70, t('assistant.skip', 'Skip'), { delay: 1 })}
            ${button(378, 94, 70, t('assistant.apply', 'Apply'), { primary: true, delay: 1.3 })}
        `, t('assistantTour4Alt', 'A question asking for a move, and under the answer a proposal to move a bookmark with Skip and Apply buttons'));
    }

    /** Step 5: conversations kept on the server, the key in a file of its own, a request only when you ask. */
    function sceneKept() {
        return svg(`
            <rect x="12" y="28" width="132" height="94" rx="6" class="atv-box"/>
            ${text(24, 46, t('config.assistantPanelHistory', 'Conversations'), { cls: 'atv-title', maxW: 108 })}
            ${[0, 1, 2].map((i) => `<rect x="24" y="${56 + i * 18}" width="${108 - i * 18}" height="10" rx="3" class="atv-track"/>`).join('')}

            <path d="M150,75 L180,75" class="atv-arrow atv-anim atv-a-draw" pathLength="1" marker-end="url(#atv-arrow)" style="animation-delay:.3s"/>
            <rect x="188" y="16" width="148" height="110" rx="6" class="atv-box is-accent"/>
            ${text(262, 34, t('config.assistantTourServer', 'nextDash server'), { cls: 'atv-title', anchor: 'middle', maxW: 128 })}
            <g class="atv-anim atv-a-drop" style="animation-delay:.5s">
                <rect x="248" y="46" width="28" height="22" rx="3" class="atv-lock"/>
                <path d="M254,46 v-6 a8,8 0 0 1 16,0 v6" class="atv-lock"/>
            </g>
            ${text(262, 90, 'ai-secrets.json', { cls: 'atv-mono', anchor: 'middle', maxW: 128 })}
            ${text(262, 110, t('config.assistantTourOnServer', 'key and conversations'), { anchor: 'middle', maxW: 128 })}

            <path d="M342,75 L372,75" class="atv-arrow atv-anim atv-a-draw" pathLength="1" marker-end="url(#atv-arrow)" style="animation-delay:.9s"/>
            <rect x="380" y="38" width="88" height="74" rx="6" class="atv-box"/>
            ${text(424, 62, t('config.assistantTourProvider', 'Provider'), { cls: 'atv-title', anchor: 'middle', maxW: 72 })}
            ${pill(392, 74, t('config.assistantTourAsking', 'when you ask'), { w: 64, delay: 1.1 })}
            ${text(W / 2, 144, t('config.assistantTourNothingElse', 'nothing is sent until you ask or press Test connection'), { anchor: 'middle', maxW: 380 })}
        `, t('assistantTour5Alt', 'Conversations and the key kept on the nextDash server, and a request reaching the provider only when you ask'));
    }

    /**
     * Each step is a title, a visual and an HTML body. The bodies are trusted —
     * assembled here from esc()'d pieces, never from user input.
     */
    function steps() {
        const body = (a, fa, b, fb) => `<p>${esc(t(a, fa))}</p>\n                <p>${esc(t(b, fb))}</p>`;
        return [
            {
                title: t('assistantTour1Title', 'Ask your dashboard in plain words'),
                visual: sceneAsk(),
                body: body('assistantTour1Body1',
                    'Type = in the search bar, or :ask in the command palette, and ask about your bookmarks, Health, the Inbox or your containers. The answer links to the pages it talks about.',
                    'assistantTour1Body2',
                    'Every question is kept as a conversation in the list on the left, so you can come back to it. It is off until you turn it on in Config → Assistant.'),
            },
            {
                title: t('assistantTour2Title', 'Setting it up: a provider and a key'),
                visual: sceneSetup(),
                body: body('assistantTour2Body1',
                    'Turn the assistant on, then choose who answers: Claude or OpenAI with an API key from your own account, or a server of your own such as Ollama or LM Studio with its address and a model.',
                    'assistantTour2Body2',
                    'Save key stores the key, and Test connection sends one small request and shows the model that answered or what went wrong. The model is optional for Claude and OpenAI.'),
            },
            {
                title: t('assistantTour3Title', 'What it can look at'),
                visual: sceneSees(),
                body: body('assistantTour3Body1',
                    'It looks things up by itself: bookmarks, tags, pages and the manual are always open to it. Health and Inbox, and containers, only when their MCP access switches are on.',
                    'assistantTour3Body2',
                    'The switches are the same ones the MCP endpoint uses, under Data & backups → Webhooks → MCP access. The assistant does not need the MCP address itself to be switched on.'),
            },
            {
                title: t('assistantTour4Title', 'Changes wait for your click'),
                visual: sceneApply(),
                body: body('assistantTour4Body1',
                    'The assistant never changes anything by itself. When you ask for a change it shows a proposal under its answer, and nothing happens until you press Apply. Skip drops it.',
                    'assistantTour4Body2',
                    'Adding a bookmark is always possible. Editing, moving and deleting need Bookmarks: edit and delete, and container actions need Containers: control. The switch is checked again when you press Apply.'),
            },
            {
                title: t('assistantTour5Title', 'What leaves and what stays'),
                visual: sceneKept(),
                body: body('assistantTour5Body1',
                    'Your question and the data it looks up go to the provider you chose, and only when you ask or press Test connection. Turning the assistant on sends nothing by itself.',
                    'assistantTour5Body2',
                    'The key and your conversations stay on the nextDash server, and the key is never shown again. Conversations expire by number and by days, and Delete all clears them. The Tour button above the tabs brings this tour back.'),
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
        const progress = t('assistantTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="assistant-tutorial">
                <div class="assistant-tutorial-progress">${esc(progress)}</div>
                <h3 class="assistant-tutorial-step-title">${esc(step.title)}</h3>
                <div class="assistant-tutorial-scene is-${state.direction}">${step.visual}</div>
                <div class="assistant-tutorial-step-body">${step.body}</div>
                <div class="assistant-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="assistant-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('assistantTutorialTitle', 'How the assistant works'),
            htmlMessage: html,
            confirmText: isLast
                ? t('assistantTutorialDone', 'Got it')
                : t('assistantTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('assistantTutorialSkip', 'Skip')
                : t('assistantTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'assistant-tutorial-modal',
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
        global.nextdashTrack?.('assistant-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** The first visit to the section: once, with the same guards as the Monitoring tour. */
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
        global.nextdashTrack?.('assistant-tutorial:shown');
        return true;
    }

    /** The Tour button in the Assistant band, and Config's replay: on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('assistant-tutorial:opened');
        return true;
    }

    global.AssistantTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
