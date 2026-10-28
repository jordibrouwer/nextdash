/**
 * The keyboard tour: four short steps on what the search panel does with the
 * keys you type into it.
 *
 * Offered, never forced: it does not open by itself. The search panel's empty
 * state offers it until it has been seen, and :tour and Config's tour list
 * bring it back on request. It is built like the section tours (see
 * unraid-tutorial.js) and shares their look: an SVG with its stylesheet inside,
 * motion that rests on its finished state for a reader who asked for less.
 *
 * Why it exists: nearly everything the panel does starts from a single key --
 * typing, `:`, `?`, `/`, `*`, `!` -- and none of them says so. Commands and
 * finders are the part most easily missed.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-config.js (replay list), search-commands.js
    // (:tour) and search.js (the panel's offer), and marked seen by the test
    // fixtures. All must agree.
    const TIP_ID = 'keyboardTutorialV1';

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

    const SCENE_STYLE = `
        .ktv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .ktv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .ktv-box.is-accent { stroke: var(--accent-primary); stroke-width: 1.5; }
        .ktv-label { fill: var(--text-secondary); font-size: 10px; }
        .ktv-text { fill: var(--text-primary); font-size: 10.5px; }
        .ktv-typed { fill: var(--text-primary); font-size: 12px; font-family: var(--font-mono, ui-monospace, monospace); font-weight: 700; }
        .ktv-row { fill: var(--background-secondary, var(--background-primary)); stroke: var(--border-primary); stroke-width: 1; }
        .ktv-row.is-active { stroke: var(--accent-primary); stroke-width: 1.5; }
        .ktv-key { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.6; stroke-width: 1; }
        .ktv-key-text { fill: var(--text-primary); font-size: 12px; font-weight: 700; font-family: var(--font-mono, ui-monospace, monospace); }
        .ktv-caret { fill: var(--accent-primary); }

        .ktv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .ktv-a-drop { animation-name: ktv-drop; }
        .ktv-a-blink { animation-name: ktv-blink; animation-duration: 1.1s; animation-timing-function: steps(1); }

        @keyframes ktv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes ktv-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

        @media (prefers-reduced-motion: reduce) { .ktv-anim { animation: none !important; } }
        body.no-animations .ktv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="ktv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            ${inner}
        </svg>`;
    }

    /** A label held to `maxW`: a translation longer than its room is drawn narrower, not over its neighbour. */
    function text(x, y, value, { cls = 'ktv-label', maxW = 0, anchor = 'start' } = {}) {
        const fit = maxW && String(value).length * 6.2 > maxW
            ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}"${fit}>${esc(value)}</text>`;
    }

    /** A keycap. The key itself is never translated: it is what is printed on the keyboard. */
    function key(x, y, value, { w = 26 } = {}) {
        return `<g>
            <rect x="${x}" y="${y}" width="${w}" height="26" rx="5" class="ktv-key"/>
            <text x="${x + w / 2}" y="${y + 17.5}" text-anchor="middle" class="ktv-key-text">${esc(value)}</text>
        </g>`;
    }

    /** The search panel: what has been typed, a caret, and the rows it answers with. */
    function panel(typed, rows) {
        const lines = rows.map((row, i) => {
            const y = 54 + i * 28;
            const motion = ` class="ktv-anim ktv-a-drop" style="animation-delay:${(0.4 + i * 0.5).toFixed(2)}s"`;
            return `<g${motion}>
                <rect x="40" y="${y}" width="400" height="24" rx="5" class="ktv-row${i === 0 ? ' is-active' : ''}"/>
                ${text(52, y + 16, row.left, { cls: 'ktv-typed', maxW: 90 })}
                ${text(150, y + 16, row.right, { cls: 'ktv-text', maxW: 280 })}
            </g>`;
        }).join('');
        return `
            <rect x="30" y="8" width="420" height="${46 + rows.length * 28 + 8}" rx="8" class="ktv-box is-accent"/>
            <text x="46" y="38" class="ktv-typed">${esc(typed)}</text>
            <rect x="${46 + typed.length * 7.4 + 2}" y="26" width="2" height="15" class="ktv-caret ktv-anim ktv-a-blink"/>
            ${lines}`;
    }

    /** Step 1: type anywhere and the panel opens on what you typed. */
    function sceneType() {
        return svg(panel('mail', [
            { left: 'Fastmail', right: t('keyboardTourSceneBookmark', 'bookmark · Mail') },
            { left: 'Gmail', right: t('keyboardTourSceneBookmark', 'bookmark · Mail') },
        ]), t('keyboardTour1Alt', 'The search panel with the word mail typed and two bookmarks listed'));
    }

    /** Step 2: `:` turns the panel into a command line. */
    function sceneCommands() {
        return svg(panel(':new', [
            { left: ':new', right: t('keyboardTourSceneNew', 'Add a bookmark') },
            { left: ':tag', right: t('keyboardTourSceneTag', 'Browse by tag') },
        ]), t('keyboardTour2Alt', 'The search panel with :new typed and the commands it offers'));
    }

    /** Step 3: `?` sends the rest of the line to a site you chose. */
    function sceneFinders() {
        return svg(panel('?yt lofi', [
            { left: '?yt', right: t('keyboardTourSceneFinder', 'Search on YouTube') },
            { left: '?w', right: t('keyboardTourSceneFinder2', 'Search on Wikipedia') },
        ]), t('keyboardTour3Alt', 'The search panel with ?yt lofi typed and the finders it offers'));
    }

    /** Step 4: the single keys that open the other doors. */
    function sceneKeys() {
        const card = (x, k, label, delay) => `
            <g class="ktv-anim ktv-a-drop" style="animation-delay:${delay.toFixed(2)}s">
                <rect x="${x}" y="28" width="134" height="84" rx="8" class="ktv-box"/>
                ${key(x + 54, 40, k)}
                ${text(x + 67, 90, label, { cls: 'ktv-text', anchor: 'middle', maxW: 118 })}
            </g>`;
        return svg(
            card(24, '/', t('keyboardTourSceneCloud', 'Tag cloud'), 0.2)
            + card(173, '*', t('keyboardTourSceneRecent', 'Recent bookmarks'), 0.7)
            + card(322, '!', t('keyboardTourSceneSheet', 'All the keys'), 1.2),
            t('keyboardTour4Alt', 'Three keys: slash for the tag cloud, star for recent bookmarks, exclamation mark for the cheat sheet'),
        );
    }

    /**
     * Each step is a title, a visual and an HTML body. The bodies are trusted --
     * assembled here from esc()'d pieces, never from user input. The keys stay
     * out of the translated sentences, so they print the same in every language.
     */
    function steps() {
        const kbd = (k) => `<kbd>${esc(k)}</kbd>`;
        const sentence = (key, fallback, keys) => esc(t(key, fallback)).replace(
            /\{(\w+)\}/g,
            (_, name) => (keys[name] ? kbd(keys[name]) : `{${name}}`),
        );
        return [
            {
                title: t('keyboardTour1Title', 'Just start typing'),
                visual: sceneType(),
                body: `<p>${esc(t('keyboardTour1Body1',
                    'On the dashboard, any letter opens the search panel on what you typed. No click first, and no shortcut to remember.'))}</p>
                <p>${esc(t('keyboardTour1Body2',
                    'Arrow keys pick a result, Enter opens it and Escape puts the panel away. Everything after this tour starts the same way: with one key.'))}</p>`,
            },
            {
                title: t('keyboardTour2Title', 'Commands start with a colon'),
                visual: sceneCommands(),
                body: `<p>${sentence('keyboardTour2Body1',
                    'Type {colon} and the panel becomes a command line: add a bookmark, switch the theme, open a view, start a tour. Keep typing to narrow the list.',
                    { colon: ':' })}</p>
                <p>${esc(t('keyboardTour2Body2',
                    'Most things in Config have a command of their own, which is often quicker than going there.'))}</p>`,
            },
            {
                title: t('keyboardTour3Title', 'Finders search the web for you'),
                visual: sceneFinders(),
                body: `<p>${sentence('keyboardTour3Body1',
                    'Type {question} and the short name of a finder, then your question. The rest of the line goes to that site, and the results open in a new tab.',
                    { question: '?' })}</p>
                <p>${esc(t('keyboardTour3Body2',
                    'You choose the sites yourself in Config → Pages & tags → Finders.'))}</p>`,
            },
            {
                title: t('keyboardTour4Title', 'Three more single keys'),
                visual: sceneKeys(),
                body: `<p>${sentence('keyboardTour4Body1',
                    '{slash} opens the tag cloud, {star} lists the bookmarks you opened recently, and {bang} shows every key in a cheat sheet.',
                    { slash: '/', star: '*', bang: '!' })}</p>
                <p>${esc(t('keyboardTour4Body2',
                    'The tour is always one command away: type :tour keyboard.'))}</p>`,
            },
        ];
    }

    let state = { index: 0, direction: 'forward' };
    let finished = false;

    function render() {
        const all = steps();
        const total = all.length;
        const step = all[state.index];
        const isLast = state.index === total - 1;
        const isFirst = state.index === 0;
        const progress = t('keyboardTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="keyboard-tutorial">
                <div class="keyboard-tutorial-progress">${esc(progress)}</div>
                <h3 class="keyboard-tutorial-step-title">${esc(step.title)}</h3>
                <div class="keyboard-tutorial-scene is-${state.direction}">${step.visual}</div>
                <div class="keyboard-tutorial-step-body">${step.body}</div>
                <div class="keyboard-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="keyboard-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('keyboardTutorialTitle', 'Working from the keyboard'),
            htmlMessage: html,
            confirmText: isLast
                ? t('keyboardTutorialDone', 'Got it')
                : t('keyboardTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('keyboardTutorialSkip', 'Skip')
                : t('keyboardTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'keyboard-tutorial-modal',
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
            // Escape, the backdrop and walking away count as seen, as in the
            // section tours. Next and Back close the window too and reach here
            // with their own reason after they have run.
            onHide: ({ reason } = {}) => { if (reason === 'dismiss') finish('dismissed'); },
        });
    }

    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('keyboard-tour:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Play the tour, seen or not. `via` says what asked for it, in fixed words:
     * the search panel's offer, the :tour command, Config's list.
     */
    function open({ via = 'command' } = {}) {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('keyboard-tour:opened', { via });
        return true;
    }

    global.KeyboardTutorial = { TIP_ID, open };
}(typeof window !== 'undefined' ? window : globalThis));
