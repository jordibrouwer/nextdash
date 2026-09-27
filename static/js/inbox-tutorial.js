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
                    ${label(334, 79, t('inboxTourS2KeepUnsorted', 'into Bookmarks › Unsorted'))}
                    ${pill(256, 114, t('inboxDelete', 'Delete'), { kind: 'danger' })}
                    ${label(334, 128, t('inboxTourS2Delete', 'gone'))}
                `, 'Promote, Keep or Delete'),
                body: `<p>${esc(t('inboxTourS2Body1',
                    'Promote makes it a bookmark: the form opens with the address, title, note and tags filled in, and you choose the page and category. Delete throws it away.'))}</p>
                    <p>${esc(t('inboxTourS2Body2Keep',
                    'Keep is the third answer: worth holding on to, but not ready for a page yet.'))}</p>`,
            },
            {
                title: t('inboxTourS3Title', 'Kept: worth keeping, no page yet'),
                visual: svg(`
                    ${row(40, 96, 180, 'Rust Book', { sub: 'doc.rust-lang.org', accent: true })}
                    ${arrow('M130,94 C150,60 220,40 280,36', { dashed: true })}
                    ${pill(286, 22, t('inboxTourS3Unsorted', 'Bookmarks › Unsorted'), { kind: 'active' })}
                    ${label(250, 110, t('inboxTourS3CaptionUnsorted', 'it waits there for a page'), 'itv-caption')}
                `, 'A kept link moves to Bookmarks › Unsorted'),
                body: `<p>${esc(t('inboxTourS3Body1Unsorted',
                    'A kept link leaves the queue for good, but it is not on the dashboard either. It waits in Bookmarks, under Unsorted, until you promote it onto a page — from its side panel or its row menu, with the same form as Promote here.'))}</p>
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
                    ${keycap(150, 70, 'K')} ${label(180, 84, t('inboxTourS4KeyTriage', 'on the triage card'))}
                    ${label(310, 84, t('inboxTourS4Menu', 'or the row menu'))}
                    ${label(20, 124, t('inboxTourS4Travels', 'The note and the tags travel with it.'), 'itv-caption')}
                `, 'Keep from the row, or with K in the list and in triage'),
                body: `<p>${esc(t('inboxTourS4Body1',
                    'Every row has a Keep button; Shift+K keeps the row under the cursor, in the list and on the triage card alike, and the right-click menu has it too.'))}</p>
                    <p>${esc(t('inboxTourS4Body2',
                    'A toast says where it went, with Undo on it — a keep made with one key is sometimes a keep made by accident.'))}</p>`,
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
                    ${pill(380, 96, 'Tour', { kind: 'active' })}
                `, 'Keyboard shortcuts'),
                body: `<p>${esc(t('inboxTourS9Body1One',
                    't opens triage on the queue: j and k move, r marks read, Shift+K keeps, p promotes, z snoozes, d deletes. The legend under the list has the rest.'))}</p>
                    <p class="inbox-tutorial-closing">${esc(t('inboxTourS9ClosingOne',
                    'Tour, in the band above the list, brings this back whenever you want it.'))}</p>`,
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
     * the reader who skipped it -- or wants it again -- needs a way
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
