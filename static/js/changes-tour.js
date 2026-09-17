/**
 * "What has changed" — the tour of a release that moved things.
 *
 * A release that moves the page tabs, the action buttons and the shape of
 * config leaves a reader looking for things that have not gone anywhere, only
 * somewhere else. Release notes answer that badly: they are a list, read once,
 * by whoever opens them.
 *
 * So it is offered the way every other one-time invitation is -- a card in the
 * corner, with Show me, Later and No thanks -- and the tour itself is a window
 * in the middle with one picture per step. Two things make it more than a
 * slideshow: where a default changed, the step carries the choice itself, so a
 * reader who preferred the old arrangement can have it back without going to
 * look for the setting; and "Show me" dims the window and lights up the real
 * element on the dashboard behind it.
 *
 * It shows rather than goes: the steps name where a thing lives and light it
 * up on the real screen, and none of them takes the reader somewhere -- a tour
 * that walks off mid-sentence is worse than one that points.
 *
 * It does not replace the What's new modal. The last step points at it.
 *
 * A fresh install gets the same steps with the "what moved" taken out of them
 * (settings.firstRunInstall, set by the server when it writes a new settings
 * file): nothing has moved for someone who has just arrived, but where things
 * are is worth a minute either way.
 */
(function initChangesTour(global) {
    'use strict';

    const TIP_ID = 'changesTourV1';
    // Behind the announcements that are one sentence long, and behind the
    // clock-and-weather card, which asks for one thing rather than six.
    const SHOW_DELAY_MS = 9000;
    /** How long the reader has the real element to themselves. */
    const SPOTLIGHT_MS = 1800;
    /** "Later" is one more ask, tomorrow. */
    const LATER_MS = 24 * 60 * 60 * 1000;

    function dash() {
        return global.dashboardInstance || null;
    }

    function t(key, fallback, params) {
        const lang = dash()?.language;
        let value = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `dashboard.${key}`;
            const found = lang.t(full);
            if (found && found !== full) value = found;
        }
        return params
            ? Object.entries(params).reduce((acc, [name, v]) => acc.replaceAll(`{${name}}`, String(v)), String(value))
            : value;
    }

    const esc = window.NextDashHtml.escapeHtml;

    /**
     * The keys a step names, drawn as keys.
     *
     * Applied after escaping, so the body stays text from the locale files and
     * only these fixed strings become markup. They read as prose otherwise --
     * "Shift + A opens the browser" is a sentence about a key that does not
     * look like one.
     */
    const KEYS = ['Shift + A', 'Shift + O', ':changes'];

    function withKeys(text) {
        return KEYS.reduce(
            (acc, key) => acc.replaceAll(esc(key), `<kbd>${esc(key)}</kbd>`),
            esc(text),
        );
    }

    /** An install the server wrote fresh has nothing to be told it lost. */
    const isNewcomer = () => dash()?.settings?.firstRunInstall === true;

    const seen = () => global.DiscoverabilityState?.hasSeenTip?.(TIP_ID) === true;
    const markSeen = () => global.DiscoverabilityState?.markTipSeen?.(TIP_ID);

    /** "Later": nothing is recorded as answered, only postponed. */
    function askAgainTomorrow() {
        try {
            global.localStorage?.setItem('nextdash.changesTour.later', String(Date.now() + LATER_MS));
        } catch {
            // A browser that refuses storage simply gets asked again next load.
        }
    }

    function postponed() {
        try {
            const until = Number(global.localStorage?.getItem('nextdash.changesTour.later') || 0);
            return Number.isFinite(until) && until > Date.now();
        } catch {
            return false;
        }
    }

    // ---- the steps --------------------------------------------------------

    /** A choice that writes a setting the moment it is picked. */
    function choice(field, label, options) {
        const current = dash()?.settings?.[field];
        const buttons = options.map(([value, text]) => `
            <button type="button" class="changes-tour-choice" data-tour-field="${esc(field)}"
                    data-tour-value="${esc(value)}" aria-pressed="${value === current ? 'true' : 'false'}">${esc(text)}</button>`).join('');
        return `<div class="changes-tour-choice-row">
            <span class="changes-tour-choice-label">${esc(label)}</span>
            <div class="changes-tour-choices">${buttons}</div>
        </div>`;
    }

    function art(name) {
        return `<div class="changes-tour-art changes-tour-art--${name}" aria-hidden="true">${ART()[name]}</div>`;
    }

    /*
     * Built per render, not once at load: the badge on the gloss card is the
     * theme browser's own word for it, and the language is not loaded yet when
     * this file runs. A literal there showed the Dutch word on an English
     * dashboard.
     */
    const ART = () => ({
        pages: `<span class="changes-tour-bar"><span class="changes-tour-dim">19:42</span>
            <span class="changes-tour-tabs"><b>1</b><i>2</i><i>3</i><i>+5</i></span>
            <span class="changes-tour-dim">⌂ ✉ ♥ ⚙</span></span>`,
        actions: `<span class="changes-tour-page"><span class="changes-tour-lines"><i></i><i></i><i></i></span>
            <span class="changes-tour-rail"><i>+</i><i>&gt;</i><i>:</i><i>*</i></span>
            <span class="changes-tour-handle"></span></span>`,
        // Named tiles, not six grey boxes: the step is about config opening on
        // groups with names, and an unlabelled grid says nothing at all.
        config: `<span class="changes-tour-tiles">
            <i><b>Theme</b><em>Retro CRT</em></i>
            <i><b>Grid</b><em>4 columns</em></i>
            <i><b>Action bar</b><em>right</em></i>
            <i><b>Date &amp; weather</b><em>Leiden</em></i>
            <i><b>Header</b><em>plain</em></i>
            <i><b>Custom themes</b><em>2</em></i>
        </span>`,
        // The three columns with what stands in them: filters that are ticked,
        // rows that are picked, and the panel that edits what is picked. Empty
        // boxes drew the layout and said nothing about the work.
        workbench: `<span class="changes-tour-bench">
            <i class="changes-tour-bench-filters"><b>filters</b><s></s><s></s><s></s></i>
            <i class="changes-tour-bench-list"><b>list</b><u class="is-picked"></u><u class="is-picked"></u><u></u><u></u></i>
            <i class="changes-tour-bench-edit"><b>2 picked</b><s></s><s></s></i>
        </span>`,
        widgets: `<span class="changes-tour-widget"><b>12</b><span class="changes-tour-dim">queue</span>
            <b>340</b><span class="changes-tour-dim">done</span></span>`,
        tags: `<span class="changes-tour-tags"><i>selfhosted</i><i>tools</i><i>docs</i><i class="is-own">+</i></span>`,
        /*
         * Three theme cards rather than three grey squares: a lacquered one
         * with its badge and its lit band, and a light and a dark half of the
         * same family. The colours come from the theme's own accents, so the
         * drawing is in whatever theme the reader is actually looking at.
         */
        looks: `<span class="changes-tour-swatches">
            <i class="is-gloss"><b>${esc(t('config.themeBadgeGloss', 'Gloss'))}</b><span class="changes-tour-chips"><u></u><u></u><u></u></span></i>
            <i class="is-light"><span class="changes-tour-chips"><u></u><u></u><u></u></span></i>
            <i class="is-dark"><span class="changes-tour-chips"><u></u><u></u><u></u></span></i>
        </span>`,
        done: `<span class="changes-tour-done">✳</span>`,
    });

    function steps() {
        const fresh = isNewcomer();
        return [
            {
                key: 'pages',
                title: fresh
                    ? t('changesTourPagesTitleNew', 'Your pages live in the header')
                    : t('changesTourPagesTitle', 'Pages: four styles'),
                body: fresh
                    ? t('changesTourPagesBodyNew', 'Every page has a number key, and the tabs stand beside Inbox, Health and Config. Three other styles put them in the middle of the header instead.')
                    : t('changesTourPagesBody', 'The tabs still stand beside Inbox, Health and Config. New is that three other styles put them in the middle of the header. The page you were last on stays marked, also while you are in Config.'),
                art: 'pages',
                lit: '.header-track, .header-actions .page-navigation',
                choice: () => choice('pageSwitcherStyle', t('changesTourPagesChoice', 'Which style?'), [
                    ['classic', t('changesTourPagesClassic', 'Numbers beside the destinations')],
                    ['segmented', t('changesTourPagesSegmented', 'One segmented control')],
                    ['text', t('changesTourPagesText', 'Plain text, underlined')],
                    ['compact', t('changesTourPagesCompact', 'One button with a list')],
                ]),
            },
            {
                key: 'actions',
                title: fresh
                    ? t('changesTourActionsTitleNew', 'The action buttons stand at an edge')
                    : t('changesTourActionsTitle', 'The action buttons have a place of their own'),
                body: t('changesTourActionsBody', "They stand in a column on the right, which slides into the edge after a couple of seconds. Touching that edge, clicking the handle it leaves behind, or pressing ' or Shift + O brings them back. Their key chips can go; the keys keep working."),
                art: 'actions',
                // No "Show me": the bar this step is about slides into its
                // edge, so more often than not there is nothing there to light
                // up -- and lighting up an empty edge explains nothing.
                choice: () => choice('actionBarPosition', t('changesTourActionsChoice', 'Where do you want them?'), [
                    ['right', t('changesTourActionsRight', 'Right')],
                    ['left', t('changesTourActionsLeft', 'Left')],
                    ['bottom', t('changesTourActionsBottom', 'Bottom')],
                    ['header', t('changesTourActionsHeader', 'In the header')],
                ]),
            },
            {
                key: 'config',
                title: t('changesTourConfigTitle', 'Config opens on tiles'),
                body: t('changesTourConfigBody', 'Appearance and Behavior show groups first; a click opens one and Escape goes back. Date & weather now sits under Appearance, and there is a Logs section.'),
                art: 'config',
            },
            {
                key: 'workbench',
                title: t('changesTourWorkbenchTitle', 'Bookmarks → List is a workbench'),
                body: t('changesTourWorkbenchBody', 'Filters on the left, the list in the middle, an edit panel on the right — for several bookmarks at once as well as one.'),
                art: 'workbench',
            },
            {
                key: 'widgets',
                title: t('changesTourWidgetsTitle', 'Widgets of your own'),
                body: t('changesTourWidgetsBody', 'A Custom widget reads your own JSON address and puts the numbers on the dashboard as figures, rows or a bar. You say which field goes where and how often it refreshes.'),
                art: 'widgets',
            },
            {
                key: 'tags',
                title: t('changesTourTagsTitle', 'Tags, suggested'),
                body: t('changesTourTagsBody', 'Saving a bookmark offers tags from the page itself and from the tags you already use. Clicking one takes it; you only type what is not there.'),
                art: 'tags',
            },
            {
                key: 'looks',
                title: t('changesTourLooksTitle', 'New looks'),
                body: t('changesTourLooksBody', 'Gloss themes catch the light and carry a badge in the theme browser, and a theme of your own can set its shape and its sheen, in a light and a dark half. Shift + A opens the browser from anywhere.'),
                art: 'looks',
                // The config view's own opener, not ThemeBrowser.open: the
                // browser needs the palettes, the favourites and the preview
                // and revert pair handed to it, and called bare it returns
                // without drawing anything. Same route Shift+A takes.
            },
            {
                key: 'done',
                title: t('changesTourDoneTitle', 'That is all of it'),
                body: t('changesTourDoneBody', 'You can open this again from Config → Help → Guided tours, or with the :changes command. The full release notes are in What\'s new.'),
                art: 'done',
            },
        ];
    }

    // ---- the window -------------------------------------------------------

    let index = 0;
    let finished = false;
    /*
     * Whether the window is being taken away on purpose.
     *
     * The modal calls onHide on every hide, its own Next and Back included, so
     * without this the tour counted itself finished the moment the reader
     * pressed Next -- and every "Open" button after that found a tour that had
     * already ended and never came back.
     */
    let stepping = false;

    /** A hide we are doing ourselves: onHide must not read it as an answer. */
    function ourOwnHide(fn) {
        stepping = true;
        try {
            fn();
        } finally {
            setTimeout(() => { stepping = false; }, 0);
        }
    }

    /** The step as it stands on screen: in the overlay, and the overlay shown. */
    const onScreen = () => Boolean(document.querySelector('#app-modal.show .changes-tour'));

    /** Apply a choice: write it, save it, and let the dashboard redraw. */
    async function applyChoice(field, value) {
        const d = dash();
        if (!d?.settings || d.settings[field] === value) return;
        d.settings[field] = value;
        try {
            await d.saveSettings?.();
        } catch {
            d.showNotification?.(t('changesTourSaveFailed', 'Could not save that choice.'), 'error');
            return;
        }
        d.setupDOM?.();
        global.ActionBarAutoHide?.sync?.();
    }

    /**
     * Dim the window, light up the real thing, and come back to the step.
     *
     * A sheet over the page while it is lit, because the window is out of the
     * way and the dashboard underneath is not: a reader who pressed "Show me"
     * to be shown the config button then pressed the config button, which
     * opened config and closed the tour. Anything pressed during the look ends
     * the look instead, and hands the step straight back.
     */
    function spotlight(selector) {
        const target = selector && document.querySelector(selector);
        if (!target) return;
        const guard = document.createElement('div');
        guard.className = 'changes-tour-peek-guard';
        let done = null;
        const timer = setTimeout(() => done(), SPOTLIGHT_MS);
        done = () => {
            clearTimeout(timer);
            guard.remove();
            target.classList.remove('changes-tour-lit');
            document.body.classList.remove('changes-tour-peeking');
        };
        guard.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            done();
        });
        document.body.appendChild(guard);
        document.body.classList.add('changes-tour-peeking');
        target.classList.add('changes-tour-lit');
    }

    function render() {
        const all = steps();
        const step = all[index];
        const total = all.length;
        const isFirst = index === 0;
        const isLast = index === total - 1;

        const html = `
            <div class="changes-tour">
                <div class="changes-tour-progress">${esc(t('changesTourProgress', 'Step {n} of {total}',
                    { n: index + 1, total }))}</div>
                <h3 class="changes-tour-step-title">${esc(step.title)}</h3>
                ${art(step.art)}
                <p class="changes-tour-step-body">${withKeys(step.body)}</p>
                ${step.choice ? step.choice() : ''}
                ${step.lit ? `<div class="changes-tour-extra">
                    <button type="button" class="changes-tour-extra-btn" data-tour-lit="${esc(step.lit)}">${esc(t('changesTourShowMe', 'Show me'))}</button>
                </div>` : ''}
                <div class="changes-tour-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="changes-tour-dot${i === index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: isNewcomer()
                ? t('changesTourTitleNew', 'Where things are')
                : t('changesTourTitle', 'What has changed'),
            htmlMessage: html,
            confirmText: isLast ? t('changesTourDone', 'Done') : t('changesTourNext', 'Next'),
            cancelText: isFirst ? t('changesTourSkip', 'Skip') : t('changesTourBack', 'Back'),
            showCancel: true,
            modalClass: 'changes-tour-modal',
            modalMaxWidth: 'min(34rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    finish('completed');
                    return;
                }
                index += 1;
                ourOwnHide(render);
            },
            onCancel: () => {
                if (isFirst) {
                    finish('skipped');
                    return;
                }
                index -= 1;
                ourOwnHide(render);
            },
            /*
             * Escape, the × and a click on the backdrop mean "enough".
             *
             * Next and Back land here too, because the modal hides itself
             * before it calls onConfirm -- so the answer is not "was this a
             * hide" but "is the tour gone a moment later". `stepping` covers
             * the hides we do ourselves, where the step comes back only after
             * a view has rendered.
             */
            // Escape, the × and a click on the backdrop mean "enough". Next and
            // Back hide the window too -- the modal hides before it calls
            // onConfirm -- so those are marked as ours as the click arrives.
            onHide: () => {
                if (stepping) return;
                finish('dismissed');
            },
        });
        wire(all[index]);
    }

    /** The buttons the modal does not know about: the choices and Show me. */
    function wire(current) {
        const root = document.querySelector('.changes-tour');
        if (!root) return;
        /*
         * Next and Back are the modal's own buttons, and it hides itself before
         * it tells us which was pressed. Marked here, as the click arrives and
         * before the modal acts on it, so the hide that follows is not read as
         * the reader closing the tour.
         */
        const actions = document.getElementById('modal-actions');
        if (actions && actions.dataset.changesTourBound !== '1') {
            actions.dataset.changesTourBound = '1';
            actions.addEventListener('click', () => {
                if (!onScreen()) return;
                stepping = true;
                setTimeout(() => { stepping = false; }, 0);
            }, true);
        }
        root.querySelectorAll('[data-tour-field]').forEach((btn) => {
            btn.addEventListener('click', () => {
                root.querySelectorAll(`[data-tour-field="${btn.dataset.tourField}"]`)
                    .forEach((other) => other.setAttribute('aria-pressed', String(other === btn)));
                void applyChoice(btn.dataset.tourField, btn.dataset.tourValue);
            });
        });
        root.querySelector('[data-tour-lit]')?.addEventListener('click', (event) => {
            spotlight(event.currentTarget.dataset.tourLit);
        });
    }

    function finish(outcome) {
        if (finished) return;
        finished = true;
        markSeen();
        document.body.classList.remove('changes-tour-peeking');
        global.nextdashTrack?.('changes-tour:finished', { outcome, step: index + 1 });
    }

    /** Opened by the card, by Config → Help, and by `:changes`. Never by itself. */
    function open() {
        if (!global.AppModal?.show) return false;
        index = 0;
        finished = false;
        render();
        global.nextdashTrack?.('changes-tour:shown');
        return true;
    }

    // ---- the invitation ---------------------------------------------------

    const card = global.NoticeCard.define({
        id: 'changes-tour-notice',
        showDelayMs: SHOW_DELAY_MS,
        title: () => (isNewcomer()
            ? t('changesTourCardTitleNew', 'A minute on where things are')
            : t('changesTourCardTitle', 'nextDash has changed')),
        body: () => (isNewcomer()
            ? t('changesTourCardBodyNew', 'A short tour of the header, the buttons and config — about a minute.')
            : t('changesTourCardBody', 'A short tour of what stands somewhere else now — about a minute, and you can put the old arrangement back as you go.')),
        dismissLabel: () => t('changesTourCardDismiss', 'Dismiss'),
        dismissName: 'no',
        canShow: () => !seen() && !postponed(),
        onDismiss: markSeen,
        actionAttr: 'data-changes-tour-action',
        actions: [
            {
                name: 'show',
                label: () => t('changesTourCardShow', 'Show me'),
                primary: true,
                onClick: (c) => { c.close(); open(); },
            },
            {
                name: 'later',
                label: () => t('changesTourCardLater', 'Later'),
                quiet: true,
                onClick: (c) => { askAgainTomorrow(); c.close(); },
            },
            {
                name: 'no',
                label: () => t('changesTourCardNo', 'No thanks'),
                onClick: (c) => { markSeen(); c.close(); },
            },
        ],
    });

    global.ChangesTour = { TIP_ID, open, card, isNewcomer };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', card.autoStart, { once: true });
    } else {
        card.autoStart();
    }
}(typeof window !== 'undefined' ? window : globalThis));
