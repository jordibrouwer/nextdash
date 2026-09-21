/**
 * One-time Inbox tutorial — a guided tour through the inbox, shown the first
 * time the Inbox view opens. Built the same way as health-tutorial.js and
 * sharing its guards, so a session that has turned session tips off, or is on
 * a phone, never sees either.
 *
 * The ℹ in the inbox toolbar explains the same model on demand, but that is
 * opt-in reading: the inbox looks like a list of links, so nothing about it
 * suggests there is a keyboard, a snooze clock or a promote step to find. This
 * exists to say so once, at the only moment the reader is looking at it.
 *
 * Where the ℹ explainer is five short definitions, this walks the actual loop —
 * how a link gets in, what read means, what to do with the ones that are not
 * for today, and how to clear a backlog without a mouse — in the order someone
 * meets those problems.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-inbox.js, which checks it before fetching this
    // file at all. Both must agree.
    const TIP_ID = 'inboxTutorialV2';

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

    /*
     * The pictures.
     *
     * Drawn, not screenshotted: a screenshot goes stale the first time a
     * button moves and is unreadable at the size a modal gives it. These are
     * small SVG scenes in the app's own colours -- a tab strip, a row, an
     * arrow -- built from a handful of shapes below, so each step can show the
     * one movement it is about and nothing else.
     */
    const W = 480;
    const H = 150;

    /*
     * The scene's own stylesheet, inside the SVG.
     *
     * An SVG shape with no fill or stroke of its own draws black on nothing,
     * so a scene whose styles arrive late -- a stylesheet cached from before
     * they existed, a bundle built before the server restarted -- is a row of
     * black bars on a dark theme. Carried inside the drawing, the colours come
     * with it, and every one is a theme variable read at the moment it draws.
     *
     * Text uses the theme's primary and secondary text colours only, on the
     * theme's primary background: tertiary is meant for things that may fade,
     * the accent is a colour for lines rather than letters, and the secondary
     * background sits close enough to the text in some light themes that a
     * caption on it drops below what can comfortably be read. Checked against
     * every built-in theme, light and dark.
     */
    const SCENE_STYLE = `
        .itv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .itv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .itv-box.is-pop { stroke: var(--accent-primary); stroke-width: 1.5; }
        .itv-row.is-accent .itv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .itv-tick { fill: var(--accent-primary); }
        .itv-title, .itv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .itv-heading { font-size: 12px; }
        .itv-sub, .itv-label { fill: var(--text-secondary); font-size: 10px; }
        .itv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .itv-group { fill: var(--text-primary); font-size: 10px; font-weight: 700; }
        .itv-bump { fill: var(--text-primary); font-size: 13px; font-weight: 700; }
        .itv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .itv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .itv-pill.is-active .itv-pill-box { fill: var(--background-primary); stroke: var(--accent-primary); stroke-width: 2; }
        .itv-pill.is-active .itv-pill-text { font-weight: 700; }
        .itv-pill.is-dashed .itv-pill-box { stroke-dasharray: 3 2; fill: none; }
        .itv-pill.is-bare .itv-pill-box { stroke: none; fill: none; }
        .itv-pill.is-danger .itv-pill-box { stroke: var(--accent-error, var(--border-primary)); }
        .itv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; }
        .itv-arrow.is-dashed { stroke-dasharray: 4 3; }
        .itv-arrowhead { fill: var(--accent-primary); }
        .itv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .itv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }
    `;

    function svg(inner, label) {
        return `<svg class="itv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="itv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="itv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** A row, the shape every list in the inbox is made of. */
    function row(x, y, w, title, { sub = '', accent = false, ticked = false } = {}) {
        return `<g class="itv-row${accent ? ' is-accent' : ''}">
            <rect x="${x}" y="${y}" width="${w}" height="30" rx="5" class="itv-box"/>
            ${ticked ? `<rect x="${x + 7}" y="${y + 10}" width="10" height="10" rx="2" class="itv-tick"/>` : ''}
            <text x="${x + (ticked ? 24 : 10)}" y="${y + 13}" class="itv-title">${esc(title)}</text>
            ${sub ? `<text x="${x + (ticked ? 24 : 10)}" y="${y + 24}" class="itv-sub">${esc(sub)}</text>` : ''}
        </g>`;
    }

    /** How wide a pill has to be for its text, in the interface's monospace. */
    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    /** Pills side by side, each starting where the last one ended. */
    function pillRow(x, y, items, gap = 6) {
        let at = x;
        return items.map(([text, kind]) => {
            const out = pill(at, y, text, { kind });
            at += pillWidth(text) + gap;
            return out;
        }).join('');
    }

    /** A pill: a tab, a chip, a button. */
    function pill(x, y, text, { kind = 'plain', w = null } = {}) {
        const width = w || pillWidth(text);
        return `<g class="itv-pill is-${kind}">
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="itv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="itv-pill-text">${esc(text)}</text>
        </g>`;
    }

    function arrow(d, { dashed = false } = {}) {
        return `<path d="${d}" class="itv-arrow${dashed ? ' is-dashed' : ''}" marker-end="url(#itv-arrow)"/>`;
    }

    function label(x, y, text, cls = 'itv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    function keycap(x, y, k) {
        const w = Math.max(20, k.length * 7 + 10);
        return `<g class="itv-key"><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="itv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="itv-key-text">${esc(k)}</text></g>`;
    }

    function tabs(x, y, triage, kept, active) {
        return `${pill(x, y, `${t('inboxTabTriage', 'To triage')} ${triage}`, { kind: active === 'triage' ? 'active' : 'plain' })}
            ${pill(x + 104, y, `${t('inboxTabKept', 'Kept')} ${kept}`, { kind: active === 'kept' ? 'active' : 'plain' })}`;
    }

    /**
     * Each step: a scene, a title, and two or three sentences. The copy is new
     * with this version of the tour, so its keys are too -- reusing the old
     * ones would have shown the old paragraphs in every translated locale.
     */
    function steps() {
        return [
            {
                title: t('inboxTourS1Title', 'A waiting room for links'),
                visual: svg(`
                    ${pill(18, 30, t('inboxTutorialSourcePaste', 'Paste'), { kind: 'soft' })}
                    ${pill(18, 64, t('inboxTutorialSourceExtension', 'Extension'), { kind: 'soft' })}
                    ${pill(18, 98, 'Share', { kind: 'soft' })}
                    ${arrow('M104,40 C150,40 150,62 196,66')}
                    ${arrow('M104,74 L196,74')}
                    ${arrow('M104,108 C150,108 150,86 196,82')}
                    ${pill(206, 16, `${t('inboxTabTriage', 'To triage')} 3`, { kind: 'active' })}
                    ${row(206, 42, 250, 'Rust Book', { sub: 'doc.rust-lang.org' })}
                    ${row(206, 76, 250, 'Deno Manual', { sub: 'deno.com' })}
                    ${row(206, 110, 250, 'A long read', { sub: 'example.com' })}
                `, 'Links arrive in the To triage list'),
                body: `<p>${esc(t('inboxTourS1Body1',
                    'The inbox is where a link waits until you decide what it is for. Paste one, send it from the extension or a share sheet, and it lands on To triage — nothing has to be filed at the moment you find it.'))}</p>
                    <p>${esc(t('inboxTourS1Body2',
                    'Nothing here expires and nothing is a bookmark yet. The number on the tab is what is still waiting.'))}</p>`,
            },
            {
                title: t('inboxTourS2Title', 'Every link leaves one of three ways'),
                visual: svg(`
                    ${row(20, 60, 150, 'A link', { sub: 'waiting', accent: true })}
                    ${arrow('M172,68 C210,30 225,26 250,26')}
                    ${arrow('M172,75 L250,75')}
                    ${arrow('M172,82 C210,120 225,124 250,124')}
                    ${pill(256, 16, t('inboxPromote', 'Promote'), { kind: 'soft' })}
                    ${label(334, 30, t('inboxTourS2Promote', 'a bookmark on a page'))}
                    ${pill(256, 65, t('inboxTriageKeep', 'Keep'), { kind: 'active' })}
                    ${label(334, 79, t('inboxTourS2Keep', 'onto the Kept tab'))}
                    ${pill(256, 114, t('inboxDelete', 'Delete'), { kind: 'danger' })}
                    ${label(334, 128, t('inboxTourS2Delete', 'gone'))}
                `, 'Promote, Keep or Delete'),
                body: `<p>${esc(t('inboxTourS2Body1',
                    'Promote makes it a bookmark: the form opens with the address, title, note and tags filled in, and you choose the page and category. Delete throws it away.'))}</p>
                    <p>${esc(t('inboxTourS2Body2',
                    'Keep is the third answer, and the one this tour is mostly about: worth holding on to, but not ready for a page yet.'))}</p>`,
            },
            {
                title: t('inboxTourS3Title', 'Kept: worth keeping, no page yet'),
                visual: svg(`
                    ${tabs(150, 14, 7, 219, 'kept')}
                    ${label(150 + 104 + pillWidth(`${t('inboxTabKept', 'Kept')} 219`) + 6, 28, '+1', 'itv-bump')}
                    ${row(40, 96, 180, 'Rust Book', { sub: 'doc.rust-lang.org', accent: true })}
                    ${arrow('M130,94 C150,60 220,40 280,36', { dashed: true })}
                    ${label(250, 110, t('inboxTourS3Caption', 'it flies to the tab, and stays there'), 'itv-caption')}
                `, 'A kept link moves to the Kept tab'),
                body: `<p>${esc(t('inboxTourS3Body1',
                    'Kept is the inbox’s second tab. A kept link leaves the queue for good — it stops asking to be triaged — but it is not on the dashboard either. It waits here until you give it a page and a category.'))}</p>
                    <p>${esc(t('inboxTourS3Body2',
                    'Use it for the things you know you want and cannot place yet: a tool to try, a reference for later, a site that belongs somewhere you have not made.'))}</p>`,
            },
            {
                title: t('inboxTourS4Title', 'How to keep a link'),
                visual: svg(`
                    ${row(20, 18, 300, 'Deno Manual', { sub: 'deno.com  ·  #runtime' })}
                    ${pill(330, 23, t('inboxPromote', 'Promote'), { kind: 'soft' })}
                    ${pill(400, 23, `${t('inboxTriageKeep', 'Keep')}  K`, { kind: 'active' })}
                    ${keycap(20, 70, 'K')} ${label(56, 84, t('inboxTourS4KeyList', 'in the list'))}
                    ${keycap(150, 70, 'r')} ${label(180, 84, t('inboxTourS4KeyTriage', 'on the triage card'))}
                    ${label(310, 84, t('inboxTourS4Menu', 'or the row menu'))}
                    ${label(20, 124, t('inboxTourS4Travels', 'The note and the tags travel with it.'), 'itv-caption')}
                `, 'Keep from the row, with K, or with r in triage'),
                body: `<p>${esc(t('inboxTourS4Body1',
                    'Every row has a Keep button; Shift+K keeps the row under the cursor, r keeps the card in front of you during triage, and the right-click menu has it too.'))}</p>
                    <p>${esc(t('inboxTourS4Body2',
                    'A toast says where it went, with Undo on it — a keep made with one key is sometimes a keep made by accident.'))}</p>`,
            },
            {
                title: t('inboxTourS5Title', 'Each kept row tells you what it knows'),
                visual: svg(`
                    ${tabs(20, 10, 7, 219, 'kept')}
                    ${row(20, 42, 300, 'Rust by Example', { sub: 'doc.rust-lang.org' })}
                    ${pill(20, 80, '#rust', { kind: 'solid' })}
                    ${pill(78, 80, '2w', { kind: 'bare' })}
                    ${pill(118, 80, t('unsortedRowDestination', 'file on {place}').replace('{place}', 'Dev / Docs'), { kind: 'dashed' })}
                    ${pill(20, 110, '#docs ×', { kind: 'dashed' })}
                    ${label(90, 124, t('inboxTourS5Suggested', 'suggested tag'), 'itv-caption')}
                    ${label(340, 60, t('inboxTourS5Own', 'its tags'), 'itv-caption')}
                    ${label(340, 80, t('inboxTourS5Age', 'how long it waited'), 'itv-caption')}
                    ${label(340, 100, t('inboxTourS5Where', 'where its site lives'), 'itv-caption')}
                `, 'Tags, age, and a suggested place on each kept row'),
                body: `<p>${esc(t('inboxTourS5Body1',
                    'Under each kept link: the tags it already has, how long it has been waiting, and — when the rest of that site is already filed in one place — a button that files it there in one click.'))}</p>
                    <p>${esc(t('inboxTourS5Body2',
                    'Dashed chips are suggestions: a tag your own rules or your collection would give it. Click to take it, × to stop suggesting it.'))}</p>`,
            },
            {
                title: t('inboxTourS6Title', 'File a whole pile at once'),
                visual: svg(`
                    ${label(20, 22, 'group by site', 'itv-caption')}
                    ${label(20, 44, '// doc.rust-lang.org  3', 'itv-group')}
                    ${row(20, 52, 190, 'Rust Book', { ticked: true })}
                    ${row(20, 86, 190, 'Rust by Example', { ticked: true })}
                    ${row(20, 120, 190, 'Cargo Guide', { ticked: true })}
                    ${arrow('M214,98 L262,98')}
                    <g class="itv-popover"><rect x="268" y="40" width="190" height="100" rx="7" class="itv-box is-pop"/>
                        ${label(282, 60, 'Move 3 to…', 'itv-title')}
                        ${label(282, 84, '← Dev', 'itv-sub')}
                        ${pill(282, 94, 'Docs', { kind: 'active' })}
                        ${pill(340, 94, 'Tools', { kind: 'soft' })}</g>
                `, 'Group, tick, and move a set of kept links'),
                body: `<p>${esc(t('inboxTourS6Body1',
                    'Group the list by site, by age or by suggested tag, tick a group, and Move to… files every ticked row on one page and category. Suggest tags does the same for tags, and shows what it will write before it writes it.'))}</p>
                    <p>${esc(t('inboxTourS6Body2',
                    'x ticks the row under the cursor; Select all takes everything the list is showing.'))}</p>`,
            },
            {
                title: t('inboxTourS7Title', 'Or work through it, one link at a time'),
                visual: svg(`
                    <g class="itv-popover"><rect x="60" y="10" width="400" height="130" rx="8" class="itv-box is-pop"/></g>
                    ${label(76, 30, 'KEPT LINKS', 'itv-caption')}
                    ${label(444, 30, '3 / 20', 'itv-caption', 'end')}
                    ${label(76, 56, 'Deno Manual', 'itv-heading')}
                    ${label(76, 74, 'deno.com   2w', 'itv-sub')}
                    ${pillRow(76, 90, [['File on Dev / Tools', 'active'], ['Snooze', 'soft'], ['Back', 'soft'], ['Delete', 'danger']])}
                    ${keycap(22, 60, 'f')}
                `, 'The Work through card'),
                body: `<p>${esc(t('inboxTourS7Body1',
                    'Work through, or f, puts one kept link in front of you with every answer under it: file it where its neighbours are, move it, tag it, snooze it, send it back, or delete it. j and k step, s skips.'))}</p>
                    <p>${esc(t('inboxTourS7Body2',
                    'The run ends with a count of what you dealt with, so a pile of a hundred becomes ten minutes rather than a list you scroll past.'))}</p>`,
            },
            {
                title: t('inboxTourS8Title', 'Nothing on Kept is stuck'),
                visual: svg(`
                    ${tabs(20, 12, 7, 219, 'kept')}
                    ${row(260, 60, 190, 'A long read', { sub: 'example.com   1mo' })}
                    ${arrow('M258,68 C180,70 90,60 60,36')}
                    ${label(120, 76, t('inboxTourS8Back', 'b  back to the inbox'), 'itv-caption')}
                    ${arrow('M320,92 C320,116 300,122 280,124', { dashed: true })}
                    ${label(276, 128, t('inboxTourS8Snooze', 'Snooze: back in the queue on a date you pick'), 'itv-caption', 'end')}
                `, 'Back to the inbox, or snoozed'),
                body: `<p>${esc(t('inboxTourS8Body1',
                    'Kept by mistake, or no longer sure? Back to the inbox (b) returns it to the queue with its note and tags. Snooze sends it back asleep, to wake on a date you choose. Delete asks nothing and offers Undo.'))}</p>
                    <p>${esc(t('inboxTourS8Body2',
                    'If kept links start piling up — more than ten waiting over a month — a card in the corner says so, once.'))}</p>`,
            },
            {
                title: t('inboxTourS9Title', 'The keys, and where this tour lives'),
                visual: svg(`
                    ${label(20, 22, t('inboxTabTriage', 'To triage'), 'itv-heading')}
                    ${keycap(20, 32, 't')} ${label(44, 46, 'triage')}
                    ${keycap(110, 32, 'K')} ${label(134, 46, 'keep')}
                    ${keycap(190, 32, 'p')} ${label(214, 46, 'promote')}
                    ${keycap(290, 32, 'z')} ${label(314, 46, 'snooze')}
                    ${keycap(380, 32, 'd')} ${label(404, 46, 'delete')}
                    ${label(20, 86, t('inboxTabKept', 'Kept'), 'itv-heading')}
                    ${keycap(20, 96, 'f')} ${label(44, 110, 'work through')}
                    ${keycap(140, 96, 'x')} ${label(164, 110, 'select')}
                    ${keycap(220, 96, 'b')} ${label(244, 110, 'back to the inbox')}
                    ${pill(380, 96, 'Tour', { kind: 'active' })}
                `, 'Keyboard shortcuts for both tabs'),
                body: `<p>${esc(t('inboxTourS9Body1',
                    't opens triage on the queue: j and k move, r keeps, p promotes, z snoozes, d deletes. The legend under each list has the rest.'))}</p>
                    <p class="inbox-tutorial-closing">${esc(t('inboxTourS9Closing',
                    'Tour, in the band above either list, brings this back whenever you want it.'))}</p>`,
            },
        ];
    }

    let state = { index: 0 };

    function render() {
        const all = steps();
        const step = all[state.index];
        const total = all.length;
        const isFirst = state.index === 0;
        const isLast = state.index === total - 1;

        const progress = t('inboxTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        const html = `
            <div class="inbox-tutorial">
                <div class="inbox-tutorial-progress">${esc(progress)}</div>
                <div class="inbox-tutorial-scene">${step.visual || ''}</div>
                <h3 class="inbox-tutorial-step-title">${esc(step.title)}</h3>
                <div class="inbox-tutorial-step-body">${step.body}</div>
                <div class="inbox-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="inbox-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('inboxTutorialTitle', 'How the inbox works'),
            htmlMessage: html,
            confirmText: isLast
                ? t('inboxTutorialDone', 'Got it')
                : t('inboxTutorialNext', 'Next'),
            cancelText: isFirst
                ? t('inboxTutorialSkip', 'Skip')
                : t('inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'inbox-tutorial-modal',
            modalMaxWidth: 'min(38rem, calc(100vw - 2.5rem))',
            onConfirm: () => {
                if (isLast) {
                    finish('completed');
                    return;
                }
                state.index += 1;
                render();
            },
            onCancel: () => {
                if (isFirst) {
                    finish('skipped');
                    return;
                }
                state.index -= 1;
                render();
            },
            // Escape, the backdrop and navigating away all count as seen. The ℹ
            // in the toolbar covers the same ground on demand, so reopening the
            // tour on every visit would only be nagging.
            onHide: () => finish('dismissed'),
        });
    }

    let finished = false;
    function finish(outcome) {
        if (finished) return;
        finished = true;
        global.DiscoverabilityState?.markTipSeen?.(TIP_ID);
        global.nextdashTrack?.('inbox-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Called from DashboardInbox.openInboxView() once the list has rendered.
     * Same guard order as the health tutorial: seen-check first (cheapest),
     * then settings, then anything that would make popping a modal actively
     * wrong at this moment.
     */
    function maybeShow() {
        if (global.DiscoverabilityState?.hasSeenTip?.(TIP_ID)) return false;
        const d = global.dashboardInstance;
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
        if (global.MobileExperience?.shouldShowDiscoverabilityUi?.() === false) return false;
        if (typeof d.isModalOpen === 'function' && d.isModalOpen()) return false;
        if (d.searchComponent?.isActive?.()) return false;
        if (!global.AppModal?.show) return false;

        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('inbox-tutorial:shown');
        return true;
    }

    /**
     * Open it on request, seen or not.
     *
     * The Tour button in the band: the first-visit showing is a one-off, and
     * the reader who skipped it -- or wants the Kept part again -- needs a way
     * back that does not mean resetting tips in config.
     */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0 };
        finished = false;
        render();
        global.nextdashTrack?.('inbox-tutorial:opened');
        return true;
    }

    global.InboxTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
