/**
 * One-time dashboard tour — the first thing a new reader is walked through,
 * once the start guide bar is out of the way. Built like the Bookmarks,
 * Inbox and Containers tours and sharing their guards.
 *
 * Those three each explain one view the first time it opens. This one is the
 * map, in seven steps: pages and moving blocks, typing to search, shortcuts
 * and the Shift keys, adding, tags, the other views, and widgets, themes and
 * help. Each scene
 * moves, and stands still -- on a picture that still tells the story -- for a
 * reader who asked for less motion.
 */
(function (global) {
    'use strict';

    // Also named in DashboardPromos (which checks it before fetching this file)
    // and in the replay list in config and search. All must agree.
    const TIP_ID = 'dashboardTutorialV3';

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

    /**
     * A bookmark on the page the reader is looking at, with a shortcut, for
     * the steps that otherwise only have a made-up example. After a bundled
     * template that is one of their own services ("type j for Jellyfin").
     * The project's own link does not count. Null leaves the steps as they are.
     */
    function exampleBookmark() {
        const rows = global.dashboardInstance?.bookmarks;
        if (!Array.isArray(rows)) return null;
        return rows.find((b) => b?.shortcut && b?.name
            && !/^https:\/\/nextdash\.cc\/?$/.test(String(b.url || ''))) || null;
    }

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
        .dtv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .dtv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .dtv-row.is-accent .dtv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-row.is-bad .dtv-box { stroke: var(--accent-error, var(--border-primary)); stroke-width: 1.5; }
        .dtv-panel { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .dtv-title, .dtv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .dtv-heading { font-size: 12px; }
        .dtv-sub, .dtv-label { fill: var(--text-secondary); font-size: 10px; }
        .dtv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .dtv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .dtv-dot.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-dot.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .dtv-dot.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-dot.is-plain { fill: var(--text-secondary); }
        .dtv-dot.is-accent { fill: var(--accent-primary); }
        .dtv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .dtv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .dtv-pill.is-active .dtv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .dtv-pill.is-active .dtv-pill-text { font-weight: 700; }
        .dtv-pill.is-warn .dtv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .dtv-pill.is-bad .dtv-pill-box { stroke: var(--accent-error, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .dtv-pill.is-dashed .dtv-pill-box { stroke-dasharray: 3 2; }
        .dtv-select { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-line { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
        .dtv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-arrowhead { fill: var(--accent-primary); }
        .dtv-bar { fill: var(--accent-primary); }
        .dtv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .dtv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .dtv-search { fill: var(--background-primary); stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-caret { fill: var(--text-primary); }
        .dtv-icon-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .dtv-icon { fill: none; stroke: var(--text-primary); stroke-width: 1.3; stroke-linejoin: round; }
        .dtv-ring-bad { fill: none; stroke: var(--accent-error, var(--accent-primary)); stroke-width: 1.5; }
        .dtv-bar.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-bar.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .dtv-bar.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-bar.is-accent { fill: var(--accent-primary); }
        .dtv-value { fill: var(--text-primary); font-size: 14px; font-weight: 700; }
        .dtv-pill.is-warn .dtv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }

        .dtv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .dtv-a-draw { stroke-dasharray: 1; animation-name: dtv-draw; }
        .dtv-a-drop { animation-name: dtv-drop; }
        .dtv-a-panel { animation-name: dtv-panel; }
        .dtv-a-bump { animation-name: dtv-bump; }
        .dtv-a-grow { animation-name: dtv-grow; transform-origin: left center; }
        .dtv-a-press { animation-name: dtv-press; }

        @keyframes dtv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes dtv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes dtv-grow { 0%, 10% { transform: scaleX(0); } 42%, 100% { transform: none; } }
        @keyframes dtv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }

        .dtv-a-type { animation-name: dtv-type; }
        .dtv-a-caret { animation-name: dtv-caret; }
        .dtv-a-appear { animation-name: dtv-appear; }
        .dtv-a-cursor { animation-name: dtv-cursor; }
        .dtv-a-flyin { animation-name: dtv-flyin; }
        .dtv-a-zoom { animation-name: dtv-zoom; }
        .dtv-a-glow { animation-name: dtv-glow; }
        /* The letters are typed in; at rest the word is simply there. */
        @keyframes dtv-type { 0%, 10% { clip-path: inset(0 100% 0 0); } 40%, 100% { clip-path: inset(0 0 0 0); } }
        @keyframes dtv-caret { 0%, 10% { transform: none; } 40%, 100% { transform: translateX(30px); } }
        @keyframes dtv-appear { 0%, 38% { opacity: 0; } 50%, 100% { opacity: 1; } }
        @keyframes dtv-cursor { 0%, 100% { transform: none; } 25% { transform: translateY(26px); } 50% { transform: translateY(52px); } 75% { transform: translateY(26px); } }
        @keyframes dtv-flyin { 0%, 12% { opacity: 0; transform: translate(-40px, 16px); } 38%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-zoom { 0%, 14% { opacity: 0; transform: scale(0.7); } 38%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        /* A block carried from the left column to the right one, lifted on the
           way; the dashed box is where it will land, there before it is. */
        .dtv-a-carry { animation-name: dtv-carry; }
        .dtv-a-landing { animation-name: dtv-landing; opacity: 0; }
        @keyframes dtv-carry { 0%, 14% { transform: translateX(-142px); } 22% { transform: translate(-142px, -3px) scale(1.04); }
            58% { transform: translateY(-3px) scale(1.04); } 66%, 100% { transform: none; } }
        @keyframes dtv-landing { 0%, 18% { opacity: 0; } 26%, 60% { opacity: 1; } 66%, 100% { opacity: 0; } }
        .dtv-landing-box { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; stroke-dasharray: 5 3; }

        @media (prefers-reduced-motion: reduce) { .dtv-anim { animation: none !important; } }
        body.no-animations .dtv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="dtv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="dtv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dtv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** Animation class and an optional start offset, for staggering a set. */
    function anim(name, delay = 0) {
        return { cls: ` dtv-anim dtv-a-${name}`, style: delay ? ` style="animation-delay:${delay}s"` : '' };
    }

    const NONE = { cls: '', style: '' };

    function label(x, y, text, cls = 'dtv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    /** A one-line bookmark row: an optional status dot, the name, the site. */
    function row(x, y, w, title, { site = '', dot = '', kind = '', motion = NONE } = {}) {
        return `<g class="dtv-row${kind ? ` is-${kind}` : ''}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="dtv-box"/>
            ${dot ? `<circle cx="${x + 10}" cy="${y + 11}" r="3" class="dtv-dot is-${dot}"/>` : ''}
            <text x="${x + 20}" y="${y + 15}" class="dtv-title">${esc(title)}</text>
            ${site ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="dtv-sub">${esc(site)}</text>` : ''}
        </g>`;
    }

    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    function pill(x, y, text, { kind = 'plain', w = null, motion = NONE } = {}) {
        const width = w || pillWidth(text);
        return `<g class="dtv-pill is-${kind}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="dtv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="dtv-pill-text">${esc(text)}</text>
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
        return `<g class="dtv-key${motion.cls}"${motion.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="dtv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="dtv-key-text">${esc(k)}</text></g>`;
    }

    /** A path that draws itself along its length. */
    function line(d, { kind = '', delay = null, arrow = false } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="${arrow ? 'dtv-arrow' : `dtv-line${kind ? ` is-${kind}` : ''}`}${drawn ? ' dtv-anim dtv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''}${arrow ? ' marker-end="url(#dtv-arrow)"' : ''}/>`;
    }

    /** A category box with its bookmark rows, each with an optional status dot and shortcut. */
    function category(x, y, w, title, rows, motion = NONE) {
        const h = 26 + rows.length * 26;
        return `<g class="dtv-cat${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" class="dtv-panel"/>
            ${label(x + 10, y + 17, title, 'dtv-title')}
            ${rows.map(([name, dot, key], i) => `
                ${row(x + 6, y + 24 + i * 26, w - 12, name, { dot })}
                ${key ? keycap(x + w - 34, y + 25 + i * 26, key) : ''}`).join('')}
        </g>`;
    }

    /** A header icon with its badge: bookmarks, inbox or containers. */
    function headerIcon(x, y, kind, count, badge, motion = NONE) {
        const glyphs = {
            bookmarks: `<path d="M${x + 9},${y + 7} h10 v15 l-5,-4 l-5,4 z" class="dtv-icon"/>`,
            inbox: `<path d="M${x + 6},${y + 15} l2,-7 h12 l2,7 v6 h-16 z M${x + 6},${y + 15} h5 l1,2 h4 l1,-2 h5" class="dtv-icon"/>`,
            containers: `<path d="M${x + 6},${y + 10} L${x + 14},${y + 6} L${x + 22},${y + 10} L${x + 22},${y + 19} L${x + 14},${y + 23} L${x + 6},${y + 19} Z M${x + 6},${y + 10} L${x + 14},${y + 14} L${x + 22},${y + 10} M${x + 14},${y + 14} L${x + 14},${y + 23}" class="dtv-icon"/>`,
        };
        return `<g>
            <rect x="${x}" y="${y}" width="28" height="28" rx="6" class="dtv-icon-box"/>
            ${glyphs[kind]}
            <g class="dtv-pill is-${badge}${motion.cls}"${motion.style}>
                <rect x="${x + 18}" y="${y - 8}" width="18" height="16" rx="8" class="dtv-pill-box"/>
                <text x="${x + 27}" y="${y + 4}" text-anchor="middle" class="dtv-pill-text">${esc(String(count))}</text>
            </g>
        </g>`;
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        const example = exampleBookmark();
        return [
            // 0 — the action bar: the buttons at the edge, and the keys that do the same
            {
                title: f('dashTourBarTitle', 'The action bar'),
                visual: (() => {
                    const keys = [['+', f('dashTourBarAdd', 'add')], ['>', f('dashTourKeySearch', 'search')],
                        [':', f('dashTourKeyCommands', 'commands')], ['?', f('dashTourKeyFinders', 'finders')],
                        ['/', f('dashTourKeyTagCloud', 'tag cloud')], ['*', f('dashTourBarRecent', 'recent')],
                        [',', f('dashTourBarPages', 'pages')], ['.', f('dashTourBarFold', 'fold all')],
                        ['!', f('dashTourKeyCheat', 'cheat sheet')]];
                    return svg(`
                        ${keys.map(([k, l], i) => {
        const x = 12 + (i % 3) * 112;
        const y = 12 + Math.floor(i / 3) * 32;
        return `${keycap(x, y, k)}${label(x + keyWidth(k) + 6, y + 14, l)}`;
    }).join('')}
                        ${keycap(12, 114, "'")}${label(12 + keyWidth("'") + 6, 128, f('dashTourBarHide', 'slides it away and back'))}
                        <rect x="360" y="8" width="110" height="134" rx="8" class="dtv-panel"/>
                        ${row(368, 18, 62, '//')}${row(368, 46, 62, '//')}${row(368, 74, 62, '//')}
                        <g class="dtv-dock dtv-anim dtv-a-panel">
                            ${keys.map((_, i) => `<rect x="440" y="${14 + i * 13}" width="22" height="10" rx="3" class="dtv-icon-box"/>`).join('')}
                        </g>
                    `, f('dashTourBarAlt', 'The nine action buttons with their keys, and the bar docked at the edge of the page'));
                })(),
                body: `<p>${esc(f('dashTourBarBody1',
                    'The action bar is the row of buttons at the edge of your dashboard: add, search, commands, finders, the tag cloud, recent bookmarks, pages, fold all and the cheat sheet. Every button has a key, so you can reach all of it without the mouse.'))}</p>
                    <p>${esc(f('dashTourBarBody2',
                    'By default it stands in a column on the right and slides into the edge after two seconds; the \' key, or Shift+O, brings it back. Choose the buttons and where the bar stands in Config → Appearance → Action bar. A hidden button keeps its key.'))}</p>`,
            },
            // 1 — pages, categories, bookmarks, and moving them
            {
                title: f('dashTour4PagesTitle', 'Pages, categories, bookmarks'),
                visual: svg(`
                    <rect x="12" y="8" width="130" height="56" rx="7" class="dtv-panel"/>
                    ${label(22, 25, '// ' + f('dashTourCatMedia', 'Media'), 'dtv-title')}
                    ${row(18, 32, 118, 'Jellyfin')}
                    <rect x="154" y="8" width="130" height="56" rx="7" class="dtv-panel"/>
                    ${label(164, 25, '// ' + f('dashTourCatDev', 'Development'), 'dtv-title')}
                    ${row(160, 32, 118, 'Gitea')}
                    <rect x="154" y="74" width="130" height="56" rx="7" class="dtv-landing-box dtv-anim dtv-a-landing"/>
                    <g class="dtv-anim dtv-a-carry">
                        <rect x="154" y="74" width="130" height="56" rx="7" class="dtv-panel"/>
                        ${label(164, 91, '// ' + f('dashTourCatHome', 'Home lab'), 'dtv-title')}
                        ${row(160, 98, 118, 'Proxmox', { kind: 'accent' })}
                    </g>
                    ${pillFlow(304, 10, 170, [['1', 'active'], ['2', 'plain'], ['3', 'plain'], ['4', 'plain']], { gap: 6 })}
                    ${keycap(304, 46, '1–9')}
                    ${label(340, 60, f('dashTourKeyPages', 'pages'))}
                    ${label(304, 100, f('dashTour4PagesDrag', 'drag the // to move'), 'dtv-caption')}
                `, f('dashTour4PagesAlt', 'Categories on a page, one carried to another column, and the page numbers')),
                body: `<p>${esc(f('dashTour4PagesBody1',
                    'Your dashboard is pages of categories, and categories of bookmarks. The numbers in the header are your pages; 1 to 9 jump straight to one.'))}</p>
                    <p>${esc(f('dashTour4PagesBody2',
                    'Drag the // before a title to move a category or widget. Drop it on the line between two columns to make it wide.'))}</p>`,
            },
            // 2 — the mouse: the menus under the right button
            {
                title: f('dashTourMouseTitle', 'With the mouse'),
                visual: svg(`
                    ${category(12, 10, 150, f('dashTourCatDev', 'Development'), [['GitHub', 'ok', ''], ['GitLab', 'ok', ''], ['MDN', 'ok', '']])}
                    <rect x="17" y="33" width="140" height="24" rx="5" class="dtv-select dtv-anim dtv-a-cursor"/>
                    <g class="dtv-anim dtv-a-panel">
                        <rect x="176" y="12" width="140" height="104" rx="8" class="dtv-panel"/>
                        ${[f('dashTourMenuEdit', 'Edit'), f('dashTourMenuMove', 'Move'), f('dashTourMenuTags', 'Tags'), f('dashTourMenuDelete', 'Delete')]
                            .map((l, i) => label(188, 36 + i * 24, l, 'dtv-title')).join('')}
                        ${label(246, 138, f('dashTourMouseBookmark', 'right-click a bookmark'), 'dtv-caption', 'middle')}
                    </g>
                    <g class="dtv-anim dtv-a-panel" style="animation-delay:0.8s">
                        <rect x="330" y="12" width="140" height="104" rx="8" class="dtv-panel"/>
                        ${[f('dashTourMenuAddBookmark', 'Add bookmark'), f('dashTourMenuRename', 'Rename'), f('dashTourMenuFindTags', 'Find tags'), f('dashTourMenuRowsTiles', 'Rows or tiles')]
                            .map((l, i) => label(342, 36 + i * 24, l, 'dtv-title')).join('')}
                        ${label(400, 138, f('dashTourMouseTitleCap', 'right-click a title'), 'dtv-caption', 'middle')}
                    </g>
                `, f('dashTourMouseAlt', 'A bookmark with the menu of the right mouse button, and the menu of a category title')),
                body: `<p>${esc(f('dashTourMouseBody1',
                    'Right-click a bookmark for everything you can do with it: open it in a new tab, copy the address, edit it, tag it, move it, set how it is checked, or delete it.'))}</p>
                    <p>${esc(f('dashTourMouseBody2',
                    'Right-click a category title to add a bookmark, rename it, find tags or switch between rows and tiles. Choose Select in a bookmark\'s menu to act on several at once.'))}</p>`,
            },
            // 3 — start typing
            {
                title: f('dashTour4SearchTitle', 'Start typing'),
                visual: svg(`
                    <rect x="12" y="12" width="300" height="28" rx="7" class="dtv-search"/>
                    <text x="24" y="31" class="dtv-mono dtv-anim dtv-a-type">graf</text>
                    <rect x="24" y="19" width="2" height="15" class="dtv-caret dtv-anim dtv-a-caret"/>
                    ${row(12, 50, 300, 'Grafana', { dot: 'ok', kind: 'accent', motion: anim('appear') })}
                    ${row(12, 78, 300, f('dashTourS2Docs', 'Grafana docs'), { dot: 'ok', motion: anim('appear', 0.15) })}
                    ${label(12, 124, f('dashTourS2Enter', 'Enter opens the top result'), 'dtv-caption')}
                    ${[['>', f('dashTourKeySearch', 'search')], [':', f('dashTourKeyCommands', 'commands')], ['?', f('dashTourKeyFinders', 'finders')]]
                        .map(([k, l], i) => `${keycap(332, 14 + i * 30, k)}${label(358, 28 + i * 30, l)}`).join('')}
                    ${keycap(332, 104, 'Shift+Enter')}${label(332, 140, f('dashTour4SearchWeb', 'the web'))}
                `, f('dashTourS2Alt', 'Typed letters go to the search line, and its three modes')),
                body: `<p>${esc(f('dashTour4SearchBody1',
                    'Type anything on the dashboard and it goes to the search line; Enter opens the top result. > searches your bookmarks, : runs a command, ? sends the text to a search engine or finder.'))}</p>
                    <p>${esc(f('dashTour4SearchBody2',
                    'With a web search engine set up in Config, Shift+Enter searches the web as well.'))}</p>
                    ${example ? `<p class="dtv-try">${esc(f('dashTourS2Try', 'Try it: type {name} and press Enter.').replace('{name}', example.name.toLowerCase()))}</p>` : ''}`,
            },
            // 3 — shortcuts, the cursor and the Shift keys
            {
                title: f('dashTour4KeysTitle', 'Two keys to open, Shift to act'),
                visual: (() => {
                    const keys = [['gh', f('dashTour4KeyOpen', 'opens GitHub')], ['Shift+E', f('dashTourKeyEdit', 'edit')],
                        ['Shift+M', f('dashTourKeyMove', 'move')], ['Shift+T', f('dashTourKeyTags', 'tags')]];
                    return svg(`
                        ${category(12, 10, 150, f('dashTourCatDev', 'Development'), [['GitHub', 'ok', 'gh'], ['GitLab', 'ok', ''], ['MDN', 'ok', 'md']])}
                        <rect x="17" y="33" width="140" height="24" rx="5" class="dtv-select dtv-anim dtv-a-cursor"/>
                        ${keys.map(([k, l], i) => `${keycap(180, 12 + i * 30, k, i === 0 ? anim('press', 0) : NONE)}${label(180 + keyWidth(k) + 6, 26 + i * 30, l)}`).join('')}
                        <g class="dtv-anim dtv-a-panel">
                            <rect x="330" y="12" width="140" height="112" rx="8" class="dtv-panel"/>
                            ${[[f('dashTourMenuEdit', 'Edit'), '⇧E'], [f('dashTourMenuMove', 'Move'), '⇧M'], [f('dashTourMenuTags', 'Tags'), '⇧T'], [f('dashTourMenuDelete', 'Delete'), '⇧D']]
                                .map(([l, k], i) => `${label(342, 36 + i * 24, l, 'dtv-title')}${label(460, 36 + i * 24, k, 'dtv-label', 'end')}`).join('')}
                        </g>
                    `, f('dashTour4KeysAlt', 'A bookmark with a shortcut, a cursor on the grid, the Shift keys and the right-click menu'));
                })(),
                body: `<p>${esc(f('dashTour4KeysBody1',
                    'Give a bookmark a shortcut of one or two letters, and typing it on the dashboard opens it: no search, no Enter.'))}</p>
                    <p>${esc(f('dashTour4KeysBody2',
                    'The arrow keys start a cursor on the grid. On a bookmark, every action is Shift plus a letter: Shift+E edits, Shift+M moves, Shift+T tags. The right-click menu shows them all.'))}</p>
                    ${example ? `<p class="dtv-try">${esc(f('dashTourS3Try', 'On this page: type {key} for {name}.')
                        .replace('{key}', String(example.shortcut).toLowerCase()).replace('{name}', example.name))}</p>` : ''}`,
            },
            // 3b — edit mode
            {
                title: f('dashTour4EditTitle', 'Edit mode: change it right here'),
                visual: svg(`
                    <rect x="12" y="8" width="458" height="22" rx="6" class="dtv-box"/>
                    ${label(24, 23, f('dashTour4EditBar', 'Editing'), 'dtv-title')}
                    ${keycap(300, 10, 'Shift+M')}${label(372, 24, f('dashTour4EditLeave', 'on / off'))}
                    ${category(12, 40, 190, f('dashTourCatDev', 'Development'), [['GitHub', 'ok', ''], ['GitLab', 'ok', '']], anim('bump', 0.2))}
                    <g class="dtv-anim dtv-a-panel">
                        <rect x="250" y="40" width="220" height="104" rx="8" class="dtv-panel"/>
                        ${label(262, 60, f('dashTour4EditName', 'Name'), 'dtv-label')}
                        <rect x="262" y="66" width="196" height="20" rx="5" class="dtv-box"/>
                        ${label(262, 104, f('dashTour4EditWidth', 'Width'), 'dtv-label')}
                        ${label(262, 130, f('dashTour4EditView', 'View'), 'dtv-label')}
                    </g>
                `, f('dashTour4EditAlt', 'The dashboard in edit mode: a category chosen, and its panel on the right')),
                body: `<p>${esc(f('dashTour4EditBody1',
                    'Press Shift+M with no bookmark selected, or click the pencil in the header, to edit the dashboard itself. Click a category, widget or page tab and a panel opens on the right.'))}</p>
                    <p>${esc(f('dashTour4EditBody2',
                    'Rename it, change its width, view and sorting, or open a widget\'s settings: all of it right here, saved as you go. Right-click a category or widget and choose Edit in panel to start there. Esc or Shift+M leaves.'))}</p>`,
            },
            // 4 — adding
            {
                title: f('dashTour4AddTitle', 'Adding: paste, + or the extension'),
                visual: svg(`
                    <g class="dtv-anim dtv-a-flyin">
                        <rect x="14" y="14" width="210" height="24" rx="5" class="dtv-search"/>
                        ${label(24, 30, 'https://ziglang.org/learn', 'dtv-mono')}
                    </g>
                    ${pillFlow(14, 50, 220, [[f('dashTourS5AsBookmark', 'Add as bookmark'), 'active'], [f('dashTourS5ToInbox', 'Put in inbox'), 'plain']])}
                    ${keycap(254, 14, '+')}${label(282, 28, f('dashTourS5Form', 'the full form'))}
                    ${keycap(254, 44, '&')}${label(282, 58, f('dashTourS5Line', 'one line'))}
                    <rect x="254" y="80" width="216" height="24" rx="5" class="dtv-box"/>
                    ${label(262, 96, 'Zig docs | ziglang.org | zg', 'dtv-mono')}
                `, f('dashTourS5Alt', 'A pasted address offered as a bookmark or for the inbox, and the add keys')),
                body: `<p>${esc(f('dashTour4AddBody1',
                    'Paste a URL anywhere on the dashboard and nextDash offers to add it as a bookmark, or to put it in the inbox for later.'))}</p>
                    <p>${esc(f('dashTour4AddBody2',
                    '+ opens the full form, which suggests tags for the address. & adds a bookmark in one line: name | url | shortcut. The browser extension saves the tab you are on.'))}</p>`,
            },
            // 5 — tags
            {
                title: f('dashTour4TagsTitle', 'Tags: the cloud and a view per tag'),
                visual: (() => {
                    const tags = [['selfhosted', 15], ['homelab', 12], ['linux', 13]];
                    return svg(`
                        ${keycap(12, 10, '/', anim('press', 0))}
                        ${label(40, 24, f('dashTourKeyTagCloud', 'tag cloud'))}
                        <g class="dtv-anim dtv-a-zoom">
                            <rect x="12" y="40" width="168" height="104" rx="9" class="dtv-panel"/>
                            ${tags.map(([name, size], i) => `<text x="${24 + (i % 2) * 70}" y="${66 + i * 22}" class="dtv-title${i === 0 ? ' dtv-anim dtv-a-bump' : ''}" style="font-size:${size}px">${esc(name)}</text>`).join('')}
                            ${label(110, 132, 'rust · music', 'dtv-label')}
                        </g>
                        ${line('M186,66 L222,66', { delay: 0.4, arrow: true })}
                        <g class="dtv-anim dtv-a-panel">
                            <rect x="230" y="8" width="244" height="136" rx="10" class="dtv-panel"/>
                            ${label(242, 28, '# selfhosted · 15', 'dtv-heading')}
                            ${row(242, 38, 220, 'Nextcloud', { dot: 'ok', site: f('dashTourCatHome', 'Home lab') })}
                            ${row(242, 64, 220, 'Jellyfin', { dot: 'ok', site: f('dashTourCatMedia', 'Media') })}
                            ${row(242, 90, 220, 'Gitea', { dot: 'ok', site: f('dashTourCatDev', 'Development') })}
                            ${label(242, 132, f('dashTour4TagsEvery', 'from every page'), 'dtv-caption')}
                        </g>
                    `, f('dashTour4TagsAlt', 'The tag cloud, and the view for one tag with its bookmarks from every page'));
                })(),
                body: `<p>${esc(f('dashTour4TagsBody1',
                    '/ opens the tag cloud: the tags you use most are the largest, and typing finds one.'))}</p>
                    <p>${esc(f('dashTour4TagsBody2',
                    'Click a tag and it opens a view of its own: every bookmark with that tag, from every page, with the same keys and menu as the dashboard.'))}</p>`,
            },
            // 6 — status and the other views
            {
                title: f('dashTour4ViewsTitle', 'Bookmarks, Inbox and Containers'),
                visual: svg(`
                    ${category(12, 10, 170, f('dashTourCatHome', 'Home lab'), [['Grafana', 'ok', ''], ['Nextcloud', 'bad', 'nc'], ['Router', 'ok', '']])}
                    <circle cx="28" cy="71" r="7" class="dtv-ring-bad dtv-anim dtv-a-glow"/>
                    ${headerIcon(236, 30, 'bookmarks', 1, 'bad', anim('bump', 0))}
                    ${headerIcon(312, 30, 'inbox', 5, 'warn', anim('bump', 0.3))}
                    ${headerIcon(388, 30, 'containers', 2, 'active', anim('bump', 0.6))}
                    ${label(250, 80, f('dashTourS6Bookmarks', 'Bookmarks'), 'dtv-label', 'middle')}
                    ${label(326, 80, f('dashTourS6Inbox', 'Inbox'), 'dtv-label', 'middle')}
                    ${label(402, 80, f('dashTourS6Containers', 'Containers'), 'dtv-label', 'middle')}
                    ${keycap(236, 98, 'Shift+H')}
                    ${keycap(312, 98, 'Shift+I')}
                `, f('dashTourS6Alt', 'A broken bookmark, and the header icons with their counts')),
                body: `<p>${esc(f('dashTour4ViewsBody1',
                    'A dot beside a bookmark says whether it still answers. The icons in the header open the other views, and their badges count what needs you.'))}</p>
                    <p>${esc(f('dashTour4ViewsBody2',
                    'Bookmarks (Shift+H) lists every bookmark with filters for broken and stale links. The Inbox (Shift+I) holds links you have not placed yet. Containers shows what runs on your server. Each has a Tour button of its own.'))}</p>`,
            },
            // 7 — widgets, themes and help
            {
                title: f('dashTour4YoursTitle', 'Make it yours, and find help'),
                visual: (() => {
                    const tiles = [[f('dashTourTileHealth', 'Health'), f('dashTourTileHealthValue', '2 broken'), 'bad'],
                        [f('dashTourTileWeather', 'Weather'), '19°C', 'accent'],
                        [f('dashTourTileContainers', 'Containers'), '9 / 10', 'ok']];
                    const keys = [['Shift+A', f('dashTour4KeyThemes', 'themes')], ['Shift+S', f('dashTourKeyConfig', 'config')], ['!', f('dashTourKeyCheat', 'cheat sheet')]];
                    return svg(`
                        ${tiles.map(([title, value, kind], i) => `
                            <g class="dtv-anim dtv-a-drop" style="animation-delay:${(i * 0.15).toFixed(2)}s">
                                <rect x="${12 + i * 100}" y="20" width="92" height="92" rx="9" class="dtv-panel"/>
                                ${label(22 + i * 100, 42, title, 'dtv-title')}
                                ${label(22 + i * 100, 74, value, 'dtv-value')}
                                <rect x="${22 + i * 100}" y="92" width="70" height="5" rx="2" class="dtv-bar is-${kind} dtv-anim dtv-a-grow"
                                    style="animation-delay:${(0.3 + i * 0.15).toFixed(2)}s"/>
                            </g>`).join('')}
                        ${keys.map(([k, l], i) => `${keycap(330, 22 + i * 32, k)}${label(330 + keyWidth(k) + 8, 36 + i * 32, l)}`).join('')}
                    `, f('dashTour4YoursAlt', 'Three widgets on a page, and the keys for themes, config and the cheat sheet'));
                })(),
                body: `<p>${esc(f('dashTour4YoursBody1',
                    'Widgets sit between your categories: health, weather, your media server, Home Assistant, or any address that answers JSON. Add them in Config → Widgets. Shift+A opens the theme browser beside your page.'))}</p>
                    <p>${esc(f('dashTour4YoursBody2',
                    '! opens the cheat sheet with every key. Config → Help is the full guide, and Config → Behavior plays any tour again.'))}</p>`,
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
            <div class="dashboard-tutorial">
                <div class="dashboard-tutorial-progress">${esc(progress)}</div>
                <div class="dashboard-tutorial-scene is-${state.direction}">${step.visual}</div>
                <h3 class="dashboard-tutorial-step-title">${esc(step.title)}</h3>
                <div class="dashboard-tutorial-step-body">${step.body}</div>
                <div class="dashboard-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="dashboard-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('dashTourTitle', 'Welcome to your dashboard'),
            htmlMessage: html,
            confirmText: isLast ? t('dashboard.inboxTutorialDone', 'Got it') : t('dashboard.inboxTutorialNext', 'Next'),
            cancelText: isFirst ? t('dashboard.inboxTutorialSkip', 'Skip') : t('dashboard.inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'dashboard-tutorial-modal',
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
        global.nextdashTrack?.('dashboard-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** Called by DashboardPromos once the dashboard is quiet; same guards as the other tours. */
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
        global.nextdashTrack?.('dashboard-tutorial:shown');
        return true;
    }

    /** Config → Onboarding and the command palette: open it on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('dashboard-tutorial:opened');
        return true;
    }

    global.DashboardTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
