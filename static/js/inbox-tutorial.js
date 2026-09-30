/**
 * One-time Inbox tutorial — a guided tour through the inbox, shown the first
 * time the Inbox view opens. Built the same way as the other tutorials and
 * sharing their guards, so a session that has turned session tips off, or is
 * on a phone, never sees it.
 *
 * The ℹ in the inbox toolbar explains the same model on demand, but that is
 * opt-in reading: the inbox looks like a list of links, so nothing about it
 * suggests there is a side panel, a snooze clock or a keyboard to find. This
 * exists to say so once, at the only moment the reader is looking at it.
 *
 * It walks the loop in the order someone meets it: a link arrives, it is read
 * or put off, the side panel shows what it knows, and it leaves as a bookmark,
 * a kept link waiting in Bookmarks › Unsorted, or nothing at all.
 */
(function (global) {
    'use strict';

    // Also named in dashboard-inbox.js, which checks it before fetching this
    // file at all, and in the replay list in config and search. All must agree.
    // V3: the inbox lost its tabs and gained a rail and a side panel, and Kept
    // moved to Bookmarks › Unsorted; a reader who saw V2 was shown an inbox
    // that no longer exists, so they get this one once.
    const TIP_ID = 'inboxTutorialV3';

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
     * small SVG scenes in the app's own colours -- a rail, a row, a panel, an
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
     * and the accent is a colour for lines rather than letters. Checked against
     * every built-in theme, light and dark.
     *
     * The motion lives here too. Every animation loops over the same 4.2s and
     * rests, at 0% and 100%, on the element's own undrawn state -- so with the
     * motion switched off (reduced motion, or the app's own switch) each scene
     * is the still picture of the thing it shows, not a frame caught halfway.
     */
    const SCENE_STYLE = `
        .itv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .itv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .itv-row.is-accent .itv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .itv-dot { fill: var(--accent-primary); }
        .itv-title, .itv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .itv-heading { font-size: 12px; }
        .itv-sub, .itv-label { fill: var(--text-secondary); font-size: 10px; }
        .itv-rail { fill: var(--text-secondary); font-size: 10px; }
        .itv-rail.is-active { fill: var(--text-primary); font-weight: 700; }
        .itv-rail-mark { fill: var(--accent-primary); }
        .itv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .itv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .itv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .itv-pill.is-active .itv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .itv-pill.is-active .itv-pill-text { font-weight: 700; }
        .itv-pill.is-dashed .itv-pill-box { stroke-dasharray: 3 2; }
        .itv-pill.is-danger .itv-pill-box { stroke: var(--accent-error, var(--border-primary)); stroke-opacity: 1; }
        .itv-panel { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .itv-rule { stroke: var(--border-primary); stroke-width: 1; }
        .itv-icon-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .itv-icon { fill: none; stroke: var(--text-primary); stroke-width: 1.4; stroke-linejoin: round; stroke-linecap: round; }
        .itv-icon-group.is-active .itv-icon-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .itv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; }
        .itv-arrow.is-dashed { stroke-dasharray: 4 3; }
        .itv-arrowhead { fill: var(--accent-primary); }
        .itv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .itv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .itv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.2s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .itv-a-draw { stroke-dasharray: 1; animation-name: itv-draw; }
        .itv-a-drop { animation-name: itv-drop; }
        .itv-a-bump { animation-name: itv-bump; }
        .itv-a-read { animation-name: itv-read; }
        .itv-a-sleep { animation-name: itv-sleep; }
        .itv-a-panel { animation-name: itv-panel; }
        .itv-a-chip { animation-name: itv-chip; }
        .itv-a-fly { animation-name: itv-fly; transform-origin: left center; }
        .itv-a-card { animation-name: itv-card; }
        .itv-a-press { animation-name: itv-press; }

        /* A path draws itself along its length (pathLength="1"). */
        @keyframes itv-draw { 0%, 8% { stroke-dashoffset: 1; } 38%, 100% { stroke-dashoffset: 0; } }
        /* A row arrives from above. */
        @keyframes itv-drop { 0%, 18% { opacity: 0; transform: translateY(-8px); } 34%, 100% { opacity: 1; transform: none; } }
        /* A badge takes the count. */
        @keyframes itv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.35); } 74%, 100% { transform: none; } }
        /* A row goes quiet once read, then comes back for the next loop. */
        @keyframes itv-read { 0%, 26% { opacity: 1; } 38%, 84% { opacity: 0.45; } 96%, 100% { opacity: 1; } }
        /* A snoozed row slides off to sleep, and wakes again. */
        @keyframes itv-sleep { 0%, 44% { opacity: 1; transform: none; } 58%, 82% { opacity: 0; transform: translateX(-26px); } 96%, 100% { opacity: 1; transform: none; } }
        /* The side panel slides in from the right. */
        @keyframes itv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        /* A suggested chip is taken: it firms up, briefly. */
        @keyframes itv-chip { 0%, 52% { transform: none; } 60% { transform: scale(1.12); } 70%, 100% { transform: none; } }
        /* A kept row flies to the Bookmarks icon, and a fresh one takes its place. */
        @keyframes itv-fly { 0%, 20% { opacity: 1; transform: none; }
            52% { opacity: 1; transform: translate(252px, -84px) scale(0.18); }
            56%, 78% { opacity: 0; transform: translate(252px, -84px) scale(0.18); }
            80% { opacity: 0; transform: none; } 94%, 100% { opacity: 1; transform: none; } }
        /* The triage card: one link out, the next one in. */
        @keyframes itv-card { 0%, 40% { opacity: 1; transform: none; } 50% { opacity: 0; transform: translateX(-22px); }
            54% { opacity: 0; transform: translateX(22px); } 66%, 100% { opacity: 1; transform: none; } }
        /* A key goes down with the card change. */
        @keyframes itv-press { 0%, 38% { transform: none; } 44% { transform: translateY(2px); } 52%, 100% { transform: none; } }

        @media (prefers-reduced-motion: reduce) { .itv-anim { animation: none !important; } }
        body.no-animations .itv-anim { animation: none !important; }
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

    /** Animation classes for a shape, plus a start offset so a set can stagger. */
    function anim(name, delay = 0) {
        return {
            cls: ` itv-anim itv-a-${name}`,
            style: delay ? ` style="animation-delay:${delay}s"` : '',
        };
    }

    /**
     * A one-line row, the shape the inbox list is made of now: an unread dot,
     * a title, and the site to the right.
     */
    function row(x, y, w, title, { site = '', accent = false, unread = false, motion = null } = {}) {
        const m = motion || { cls: '', style: '' };
        return `<g class="itv-row${accent ? ' is-accent' : ''}${m.cls}"${m.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="itv-box"/>
            ${unread ? `<circle cx="${x + 9}" cy="${y + 11}" r="3" class="itv-dot"/>` : ''}
            <text x="${x + 18}" y="${y + 15}" class="itv-title">${esc(title)}</text>
            ${site ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="itv-sub">${esc(site)}</text>` : ''}
        </g>`;
    }

    /** The rail on the left of the list: the four filters, one of them on. */
    function rail(x, y, active) {
        const items = [
            t('inboxFilterAll', 'All'),
            t('inboxFilterUnread', 'Unread'),
            t('inboxFilterSnoozed', 'Snoozed'),
            t('inboxFilterNoted', 'With note'),
        ];
        return items.map((text, i) => `
            ${i === active ? `<rect x="${x - 6}" y="${y + i * 20 - 9}" width="2" height="12" class="itv-rail-mark"/>` : ''}
            <text x="${x}" y="${y + i * 20}" class="itv-rail${i === active ? ' is-active' : ''}">${esc(text)}</text>`).join('');
    }

    /** How wide a pill has to be for its text, in the interface's monospace. */
    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    /** A pill: a filter, a chip, a button. */
    function pill(x, y, text, { kind = 'plain', w = null, motion = null } = {}) {
        const width = w || pillWidth(text);
        const m = motion || { cls: '', style: '' };
        return `<g class="itv-pill is-${kind}${m.cls}"${m.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="itv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="itv-pill-text">${esc(text)}</text>
        </g>`;
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

    /** An arrow that draws itself, staggered by `delay`. */
    function arrow(d, { dashed = false, delay = null } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="itv-arrow${dashed ? ' is-dashed' : ''}${drawn ? ' itv-anim itv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''} marker-end="url(#itv-arrow)"/>`;
    }

    function label(x, y, text, cls = 'itv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    function keyWidth(k) {
        return Math.max(20, k.length * 7 + 10);
    }

    function keycap(x, y, k, motion = null) {
        const w = keyWidth(k);
        const m = motion || { cls: '', style: '' };
        return `<g class="itv-key${m.cls}"${m.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="itv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="itv-key-text">${esc(k)}</text></g>`;
    }

    /** A key and what it does, side by side; returns where the next one starts. */
    function keyPair(x, y, k, text) {
        return { svg: `${keycap(x, y, k)}${label(x + keyWidth(k) + 5, y + 14, text)}`,
            next: x + keyWidth(k) + 5 + String(text).length * 6 + 14 };
    }

    /** A header icon: the inbox tray or the Bookmarks ribbon, with an optional count. */
    function headerIcon(x, y, kind, { count = null, active = false, motion = null } = {}) {
        const glyph = kind === 'bookmarks'
            ? `<path d="M${x + 8},${y + 6} h10 v14 l-5,-4 l-5,4 z" class="itv-icon"/>`
            : `<path d="M${x + 6},${y + 14} l2,-7 h10 l2,7 v5 h-14 z M${x + 6},${y + 14} h4 l1,2 h4 l1,-2 h4" class="itv-icon"/>`;
        const m = motion || { cls: '', style: '' };
        return `<g class="itv-icon-group${active ? ' is-active' : ''}">
            <rect x="${x}" y="${y}" width="26" height="26" rx="6" class="itv-icon-box"/>
            ${glyph}
            ${count !== null ? `<g class="itv-pill is-active${m.cls}"${m.style}>
                <rect x="${x + 16}" y="${y - 8}" width="18" height="16" rx="8" class="itv-pill-box"/>
                <text x="${x + 25}" y="${y + 4}" text-anchor="middle" class="itv-pill-text">${esc(String(count))}</text>
            </g>` : ''}
        </g>`;
    }

    /**
     * Each step: a scene, a title, and two short paragraphs. The copy is new
     * with this version of the tour, so its keys are too (inboxTour3*) --
     * reusing the old ones would have shown the old paragraphs in every
     * translated locale.
     */
    function steps() {
        const promote = t('inboxPromote', 'Promote');
        const keep = t('inboxTriageKeep', 'Keep');
        const del = t('inboxDelete', 'Delete');
        return [
            {
                title: t('inboxTour3S1Title', 'A waiting room for links'),
                visual: svg(`
                    ${pill(14, 26, t('inboxTutorialSourcePaste', 'Paste'), { w: 84 })}
                    ${pill(14, 64, t('inboxTutorialSourceExtension', 'Extension'), { w: 84 })}
                    ${pill(14, 102, t('inboxTour3SourceShare', 'Share'), { w: 84 })}
                    ${arrow('M102,36 C132,36 132,60 158,66', { delay: 0 })}
                    ${arrow('M102,74 L158,74', { delay: 0.25 })}
                    ${arrow('M102,112 C132,112 132,88 158,82', { delay: 0.5 })}
                    ${rail(176, 52, 0)}
                    ${row(262, 40, 204, 'Rust Book', { site: 'rust-lang.org', unread: true, motion: anim('drop', 0.2) })}
                    ${row(262, 68, 204, 'Deno Manual', { site: 'deno.com', unread: true, motion: anim('drop', 0.45) })}
                    ${row(262, 96, 204, 'Zig Language', { site: 'ziglang.org', motion: anim('drop', 0.7) })}
                    ${headerIcon(440, 12, 'inbox', { count: 2, active: true, motion: anim('bump', 0.4) })}
                `, t('inboxTour3S1Alt', 'Links from three sources arrive as rows in the inbox')),
                body: `<p>${esc(t('inboxTour3S1Body1',
                    'Paste a URL on the dashboard, save one from the browser extension or a share sheet, and it lands here — one row per link — until you decide what it is for.'))}</p>
                    <p>${esc(t('inboxTour3S1Body2',
                    'Nothing here expires and nothing is a bookmark yet. The inbox icon in the header counts what is still unread.'))}</p>`,
            },
            {
                title: t('inboxTour3S2Title', 'Read, snoozed, noted'),
                visual: (() => {
                    const r = keyPair(360, 20, 'r', t('inboxTour3S2Read', 'read'));
                    const z = keyPair(360, 56, 'z', t('inboxTour3S2Snooze', 'snooze'));
                    const n = keyPair(360, 92, 'n', t('inboxTour3S2Note', 'note'));
                    return svg(`
                        ${rail(20, 32, 1)}
                        ${row(104, 20, 244, 'Rust Book', { site: 'rust-lang.org', unread: true, motion: anim('read') })}
                        ${row(104, 56, 244, 'Zig Language', { site: 'ziglang.org', unread: true, motion: anim('sleep') })}
                        ${row(104, 92, 244, 'Deno Manual', { site: 'deno.com' })}
                        ${r.svg}${z.svg}${n.svg}
                        ${label(104, 138, t('inboxTour3S2Caption', 'a snoozed link leaves every count until it wakes'), 'itv-caption')}
                    `, t('inboxTour3S2Alt', 'r marks a link read, z snoozes it, n adds a note'));
                })(),
                body: `<p>${esc(t('inboxTour3S2Body1',
                    'A new link stays unread until you open it or press r. z snoozes it to a time you pick — tomorrow, the weekend, a date of your own — and it leaves every count until it wakes.'))}</p>
                    <p>${esc(t('inboxTour3S2Body2',
                    'n writes a line on why you saved it. The filters on the left narrow the list to any of these.'))}</p>`,
            },
            {
                title: t('inboxTour3S3Title', 'The side panel'),
                visual: svg(`
                    ${rail(20, 32, 0)}
                    ${row(104, 20, 170, 'Rust Book', { accent: true, unread: true })}
                    ${row(104, 48, 170, 'Deno Manual')}
                    ${row(104, 76, 170, 'Zig Language')}
                    <g class="itv-anim itv-a-panel">
                        <rect x="288" y="8" width="184" height="134" rx="8" class="itv-panel"/>
                        ${label(300, 28, 'Rust Book', 'itv-heading')}
                        ${label(300, 42, 'rust-lang.org')}
                        ${pillRow(300, 50, [[t('inboxOpen', 'Open'), 'active'], [promote, 'plain'], [keep, 'plain']], 5)}
                        <line x1="300" y1="80" x2="460" y2="80" class="itv-rule"/>
                        ${label(300, 96, t('inboxDrawerNote', 'Note'), 'itv-title')}
                        ${label(300, 116, t('inboxDrawerTags', 'Tags'), 'itv-title')}
                        ${pill(344, 104, '#rust', { kind: 'active' })}
                        ${pill(396, 104, '#docs', { kind: 'dashed', motion: anim('chip', 0.3) })}
                    </g>
                `, t('inboxTour3S3Alt', 'The focused row opens in a side panel with Open, Promote and Keep')),
                body: `<p>${esc(t('inboxTour3S3Body1',
                    'Focus a row and the panel on the right shows it: Open, Promote and Keep at the top, then the note, the tags and the details.'))}</p>
                    <p>${esc(t('inboxTour3S3Body2',
                    'Under the tags, dashed chips are suggestions — click one to add it.'))}</p>`,
            },
            {
                title: t('inboxTour3S4Title', 'Every link leaves one of three ways'),
                visual: svg(`
                    ${row(16, 64, 150, 'Rust Book', { accent: true, unread: true })}
                    ${arrow('M168,70 C206,32 222,28 250,28', { delay: 0 })}
                    ${arrow('M168,75 L250,75', { delay: 0.5 })}
                    ${arrow('M168,80 C206,118 222,122 250,122', { delay: 1 })}
                    ${pill(256, 18, promote, { w: 76 })}
                    ${label(340, 32, t('inboxTour3S4Promote', 'a bookmark on a page'))}
                    ${pill(256, 65, keep, { kind: 'active', w: 76 })}
                    ${label(340, 79, t('inboxTour3S4Keep', 'Bookmarks › Unsorted'))}
                    ${pill(256, 112, del, { kind: 'danger', w: 76 })}
                    ${label(340, 126, t('inboxTour3S4Delete', 'gone, with Undo'))}
                `, t('inboxTour3S4Alt', 'Promote, Keep or Delete')),
                body: `<p>${esc(t('inboxTour3S4Body1',
                    'Promote (p) opens the bookmark form with the address, title, note and tags filled in; you choose the page and category. Delete (d) throws it away, with Undo.'))}</p>
                    <p>${esc(t('inboxTour3S4Body2',
                    'Keep (Shift+K) is the third answer: worth holding on to, but not ready for a page yet.'))}</p>`,
            },
            {
                title: t('inboxTour3S5Title', 'Kept links wait in Bookmarks › Unsorted'),
                visual: svg(`
                    ${row(24, 104, 176, 'Rust Book', { site: 'rust-lang.org', accent: true, motion: anim('fly') })}
                    ${arrow('M112,100 C160,60 236,48 280,40', { dashed: true })}
                    ${headerIcon(242, 8, 'inbox')}
                    ${headerIcon(276, 8, 'bookmarks', { count: 3, active: true, motion: anim('bump', 0.1) })}
                    ${label(318, 70, t('inboxTour3S5Bookmarks', 'Bookmarks'), 'itv-heading')}
                    ${pill(318, 80, t('inboxTour3S5Unsorted', 'Unsorted'), { kind: 'active' })}
                    ${keycap(318, 112, 'Shift+U')}
                    ${label(384, 126, t('inboxTour3S5Opens', 'opens it'))}
                `, t('inboxTour3S5Alt', 'A kept link flies to Bookmarks, where Shift+U opens Unsorted')),
                body: `<p>${esc(t('inboxTour3S5Body1',
                    'A kept link leaves the queue for good, note and tags included, and flies to the Bookmarks icon. A toast says where it went, with Undo.'))}</p>
                    <p>${esc(t('inboxTour3S5Body2',
                    'Shift+U opens Bookmarks on the Unsorted filter. Promote in a kept link’s side panel gives it a page, with the same form as here.'))}</p>`,
            },
            {
                title: t('inboxTour3S6Title', 'Triage, and the keys'),
                visual: (() => {
                    const rows = [
                        [['j / k', t('inboxKeyMove', 'move')], ['r', t('inboxTour3KeyRead', 'read')]],
                        [['Shift+K', t('inboxTour3KeyKeep', 'keep')], ['p', t('inboxKeyPromote', 'promote')]],
                        [['z', t('inboxKeySnooze', 'snooze')], ['d', t('inboxKeyDelete', 'delete')]],
                    ];
                    const keys = rows.map((pair, i) => {
                        const a = keyPair(250, 14 + i * 28, pair[0][0], pair[0][1]);
                        const b = keyPair(Math.max(a.next, 370), 14 + i * 28, pair[1][0], pair[1][1]);
                        return a.svg + b.svg;
                    }).join('');
                    return svg(`
                        <g class="itv-anim itv-a-card">
                            <rect x="16" y="14" width="214" height="96" rx="10" class="itv-panel"/>
                            ${label(30, 38, 'Deno Manual', 'itv-heading')}
                            ${label(30, 54, 'deno.com')}
                            ${pillRow(30, 74, [[keep, 'plain'], [promote, 'plain'], [del, 'danger']], 5)}
                        </g>
                        ${keycap(16, 122, 't', anim('press'))}
                        ${label(42, 136, t('inboxKeyTriage', 'triage'))}
                        ${keys}
                        ${pill(398, 118, t('inboxTour', 'Tour'), { kind: 'active', w: 66 })}
                    `, t('inboxTour3S6Alt', 'Triage shows one link at a time; the keys that work on it'));
                })(),
                body: `<p>${esc(t('inboxTour3S6Body1',
                    't shows one link at a time: j and k move, r marks read, Shift+K keeps, p promotes, z snoozes, d deletes, Escape goes back to the list.'))}</p>
                    <p class="inbox-tutorial-closing">${esc(t('inboxTour3S6Closing',
                    'The legend under the list has every key, and Tour, above the list, brings this back whenever you want it.'))}</p>`,
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

        const progress = t('inboxTutorialProgress', 'Step {n} of {total}', { n: state.index + 1, total });

        // The scene slides in from the side the reader is moving towards, so
        // Back feels like going back rather than like another Next.
        const html = `
            <div class="inbox-tutorial">
                <div class="inbox-tutorial-progress">${esc(progress)}</div>
                <div class="inbox-tutorial-scene is-${state.direction}">${step.visual || ''}</div>
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
            // Escape, the backdrop and navigating away all count as seen. The ℹ
            // in the toolbar covers the same ground on demand, so reopening the
            // tour on every visit would only be nagging.
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
        global.nextdashTrack?.('inbox-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /**
     * Called from DashboardInbox.openInboxView() once the list has rendered.
     * Same guard order as the other tutorials: seen-check first (cheapest),
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

        state = { index: 0, direction: 'forward' };
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
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('inbox-tutorial:opened');
        return true;
    }

    global.InboxTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
