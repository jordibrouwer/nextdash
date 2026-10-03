/**
 * One-time dashboard tour — the first thing a new reader is walked through,
 * once the quick-start checklist is out of the way. Built like the Bookmarks,
 * Inbox and Containers tours and sharing their guards.
 *
 * Those three each explain one view the first time it opens. This one is the
 * map: pages and categories, typing to search, shortcuts, the cursor and its
 * Shift keys, adding, what the dots and badges mean, then a step each on the
 * Bookmarks view, the inbox and Containers, the widgets, the keys worth
 * learning first, what Config can change, and where help lives. Each scene
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
        .dtv-big { fill: var(--text-primary); font-size: 18px; font-weight: 700; }
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
        .dtv-ring-track { fill: none; stroke: var(--border-primary); stroke-width: 6; }
        .dtv-ring { fill: none; stroke-width: 6; stroke-linecap: round; }
        .dtv-ring.is-ok { stroke: var(--accent-success, var(--accent-primary)); }
        .dtv-ring.is-warn { stroke: var(--accent-warning, var(--accent-primary)); }
        .dtv-beat.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-beat.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-bar { fill: var(--accent-primary); }
        .dtv-bar-track { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .dtv-cell { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-cell.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .dtv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .dtv-search { fill: var(--background-primary); stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-caret { fill: var(--text-primary); }
        .dtv-icon-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .dtv-icon { fill: none; stroke: var(--text-primary); stroke-width: 1.3; stroke-linejoin: round; }
        .dtv-glow.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-glow.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .dtv-glow.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-ring-bad { fill: none; stroke: var(--accent-error, var(--accent-primary)); stroke-width: 1.5; }
        .dtv-bar.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .dtv-bar.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .dtv-bar.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .dtv-bar.is-accent { fill: var(--accent-primary); }
        .dtv-swatch { fill: var(--accent-primary); }
        .dtv-tile { fill: var(--text-primary); font-size: 10px; }
        .dtv-value { fill: var(--text-primary); font-size: 14px; font-weight: 700; }
        .dtv-bd { fill: var(--accent-primary); fill-opacity: 0.22; }
        .dtv-bd.is-second { fill: var(--accent-error, var(--accent-primary)); fill-opacity: 0.16; }
        .dtv-bd-line { fill: none; stroke: var(--accent-primary); stroke-opacity: 0.45; stroke-width: 1; }
        .dtv-glass { fill: var(--background-primary); fill-opacity: 0.55; stroke: var(--text-secondary); stroke-opacity: 0.4; stroke-width: 1; }
        .dtv-underline { stroke: var(--accent-primary); stroke-width: 1.5; }
        .dtv-pill.is-warn .dtv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .dtv-appicon { fill: var(--accent-primary); }
        .dtv-appicon-glyph { fill: var(--background-primary); }
        .dtv-letter-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .dtv-edge { stroke: var(--accent-primary); stroke-width: 3; stroke-linecap: round; }

        .dtv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .dtv-a-draw { stroke-dasharray: 1; animation-name: dtv-draw; }
        .dtv-a-drop { animation-name: dtv-drop; }
        .dtv-a-panel { animation-name: dtv-panel; }
        .dtv-a-bump { animation-name: dtv-bump; }
        .dtv-a-tick { animation-name: dtv-tick; }
        .dtv-a-grow { animation-name: dtv-grow; transform-origin: left center; }
        .dtv-a-ring { stroke-dasharray: 1; animation-name: dtv-ring; }
        .dtv-a-blink { animation-name: dtv-blink; }
        .dtv-a-swap { animation-name: dtv-swap; }
        .dtv-a-press { animation-name: dtv-press; }
        .dtv-a-slide { animation-name: dtv-slide; }

        @keyframes dtv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes dtv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes dtv-tick { 0%, 6% { opacity: 0; } 14%, 100% { opacity: 1; } }
        @keyframes dtv-grow { 0%, 10% { transform: scaleX(0); } 42%, 100% { transform: none; } }
        /* The ring fills to its value: the value is carried in stroke-dashoffset on the element. */
        @keyframes dtv-ring { 0%, 8% { stroke-dashoffset: 1; } 48%, 100% { stroke-dashoffset: var(--dtv-ring-to, 0); } }
        @keyframes dtv-blink { 0%, 30% { opacity: 1; } 40%, 50% { opacity: 0.2; } 60%, 100% { opacity: 1; } }
        @keyframes dtv-swap { 0%, 44% { opacity: 1; transform: none; } 52% { opacity: 0; transform: translateX(-22px); }
            56% { opacity: 0; transform: translateX(22px); } 68%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }
        /* The selection mark walks down the rail and settles on the first filter. */
        @keyframes dtv-slide { 0% { transform: none; } 20% { transform: translateY(42px); } 40% { transform: translateY(84px); }
            60% { transform: translateY(42px); } 80%, 100% { transform: none; } }

        .dtv-a-type { animation-name: dtv-type; }
        .dtv-a-caret { animation-name: dtv-caret; }
        .dtv-a-appear { animation-name: dtv-appear; }
        .dtv-a-cursor { animation-name: dtv-cursor; }
        .dtv-a-flyin { animation-name: dtv-flyin; }
        .dtv-a-zoom { animation-name: dtv-zoom; }
        .dtv-a-rail { animation-name: dtv-rail; }
        .dtv-a-glow { animation-name: dtv-glow; }
        .dtv-a-hue { animation-name: dtv-hue; }
        /* Gone at rest: the letter is what the icon replaces. */
        .dtv-a-fade { animation-name: dtv-fade; opacity: 0; }
        .dtv-a-widen { animation-name: dtv-widen; }

        /* The letters are typed in; at rest the word is simply there. */
        @keyframes dtv-type { 0%, 10% { clip-path: inset(0 100% 0 0); } 40%, 100% { clip-path: inset(0 0 0 0); } }
        @keyframes dtv-caret { 0%, 10% { transform: none; } 40%, 100% { transform: translateX(30px); } }
        @keyframes dtv-appear { 0%, 38% { opacity: 0; } 50%, 100% { opacity: 1; } }
        @keyframes dtv-cursor { 0%, 100% { transform: none; } 25% { transform: translateY(26px); } 50% { transform: translateY(52px); } 75% { transform: translateY(26px); } }
        @keyframes dtv-flyin { 0%, 12% { opacity: 0; transform: translate(-40px, 16px); } 38%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-zoom { 0%, 14% { opacity: 0; transform: scale(0.7); } 38%, 100% { opacity: 1; transform: none; } }
        @keyframes dtv-rail { 0%, 100% { transform: none; } 33% { transform: translateY(22px); } 66% { transform: translateY(44px); } }
        @keyframes dtv-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        /* The theme changes under the preview, and comes back. */
        @keyframes dtv-fade { 0%, 30% { opacity: 1; } 40%, 100% { opacity: 0; } }
        /* The panel's left edge is dragged out, and the panel follows. */
        @keyframes dtv-widen { 0%, 18% { transform: translateX(44px); } 46%, 100% { transform: none; } }
        @keyframes dtv-hue { 0%, 100% { filter: none; } 33% { filter: hue-rotate(120deg); } 66% { filter: hue-rotate(240deg); } }

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

    /** A score or countdown ring, filled to `value` (0..1). */
    function ring(cx, cy, r, value, text, { kind = 'ok', sub = '' } = {}) {
        const rest = (1 - value).toFixed(3);
        return `<g>
            <circle cx="${cx}" cy="${cy}" r="${r}" class="dtv-ring-track"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" pathLength="1" transform="rotate(-90 ${cx} ${cy})"
                class="dtv-ring is-${kind} dtv-anim dtv-a-ring" style="stroke-dashoffset:${rest};--dtv-ring-to:${rest}"/>
            <text x="${cx}" y="${cy + (sub ? 3 : 6)}" text-anchor="middle" class="dtv-big">${esc(text)}</text>
            ${sub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="dtv-sub">${esc(sub)}</text>` : ''}
        </g>`;
    }

    /** A heartbeat bar: one block per check, the bad ones red, ticking in from the left. */
    function heartbeat(x, y, n, bad = []) {
        return Array.from({ length: n }, (_, i) => `<rect x="${x + i * 6}" y="${y}" width="4" height="14" rx="1"
            class="dtv-beat is-${bad.includes(i) ? 'bad' : 'ok'} dtv-anim dtv-a-tick" style="animation-delay:${(i * 0.04).toFixed(2)}s"/>`).join('');
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

    /**
     * A bookmark row whose letter gives way to the app's icon. `glyph` is the
     * mark drawn on the icon: play, wave, ring or bars.
     */
    function appRow(x, y, w, name, glyph, delay) {
        const cx = x + 13;
        const cy = y + 11;
        const marks = {
            play: `<path d="M${cx - 3},${cy - 4} L${cx + 4},${cy} L${cx - 3},${cy + 4} Z" class="dtv-appicon-glyph"/>`,
            wave: `<path d="M${cx - 5},${cy + 1} q2.5,-5 5,0 t5,0" class="dtv-icon" style="stroke: var(--background-primary)"/>`,
            ring: `<circle cx="${cx}" cy="${cy}" r="3.5" class="dtv-icon" style="stroke: var(--background-primary)"/>`,
            bars: `<path d="M${cx - 4},${cy + 4} v-4 M${cx},${cy + 4} v-8 M${cx + 4},${cy + 4} v-6" class="dtv-icon" style="stroke: var(--background-primary)"/>`,
        };
        const d = (n) => ` style="animation-delay:${(delay + n).toFixed(2)}s"`;
        return `<g>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="dtv-box"/>
            <g class="dtv-anim dtv-a-fade"${d(0)}>
                <rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="3" class="dtv-letter-box"/>
                <text x="${cx}" y="${cy + 4}" text-anchor="middle" class="dtv-title">${esc(name.charAt(0))}</text>
            </g>
            <g class="dtv-anim dtv-a-appear"${d(0)}>
                <rect x="${cx - 7}" y="${cy - 7}" width="14" height="14" rx="3" class="dtv-appicon"/>
                ${marks[glyph]}
            </g>
            <text x="${x + 26}" y="${y + 15}" class="dtv-title">${esc(name)}</text>
        </g>`;
    }

    /** A small hexagon grid, for the hexagons backdrop. */
    function hexagons(x, y, cols, rows, r) {
        const w = r * Math.sqrt(3);
        const out = [];
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const cx = x + w / 2 + col * w + (row % 2 ? w / 2 : 0);
                const cy = y + r + row * r * 1.5;
                const pts = [0, 1, 2, 3, 4, 5].map((i) => {
                    const a = (Math.PI / 3) * i + Math.PI / 6;
                    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
                }).join(' ');
                out.push(`<polygon points="${pts}" class="dtv-bd-line"/>`);
            }
        }
        return out.join('');
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        return [
            // New in v1.17, first because the tour is shown again to every
            // reader for them: web search, app icons, the theme editor, Unraid.
            {
                title: f('dashTourWebTitle', 'New: search the web from the search panel'),
                visual: svg(`
                    <rect x="12" y="8" width="300" height="26" rx="7" class="dtv-search"/>
                    <text x="24" y="26" class="dtv-mono dtv-anim dtv-a-type">jellyfin hdr</text>
                    ${row(12, 40, 300, 'Jellyfin', { dot: 'ok', site: f('dashTourWebYours', 'your bookmark') })}
                    <g class="dtv-anim dtv-a-appear" style="animation-delay:0.2s">
                        ${label(12, 82, f('dashboard.webSearchSection', 'From the web'), 'dtv-heading')}
                        ${pillFlow(132, 68, 180, [[f('dashboard.webSearchTabWeb', 'Web'), 'active'], [f('dashboard.webSearchTabNews', 'News'), 'plain'], [f('dashboard.webSearchTabVideo', 'Video'), 'plain']], { gap: 4 })}
                        ${row(12, 94, 300, 'Jellyfin docs', { site: 'jellyfin.org', kind: 'accent' })}
                        ${row(12, 120, 300, f('dashTourWebResult', 'HDR tone mapping'), { site: 'forum.example.org' })}
                    </g>
                    ${keycap(330, 10, 'Shift+Enter', anim('press', 0))}
                    ${label(330, 46, f('dashTourWebAsk', 'asks the web'), 'dtv-label')}
                    ${keycap(330, 60, 'Shift+←/→')}
                    ${label(330, 96, f('dashTourWebTabs', 'Web, News, Video'), 'dtv-label')}
                    ${keycap(330, 106, 'Alt+Enter')}
                    ${label(330, 142, f('dashTourWebOwn', 'opens your own bookmark'), 'dtv-label')}
                `, f('dashTourWebAlt', 'A search for jellyfin: your own bookmark first, then results from the web with their categories, and the keys for them')),
                body: `<p>${esc(f('dashTourWebBody1',
                    'With an engine set under Behavior → Keyboard & search — your own SearXNG or the Brave Search API — Shift+Enter asks the web for what you typed. Your server asks the engine, so it never sees your browser, and nothing is sent while you type.'))}</p>
                    <p>${esc(f('dashTourWebBody2',
                    'The results appear below your bookmarks. Shift+←/→ switches between Web, News and Video, and on a site you already keep, Alt+Enter opens your own bookmark.'))}</p>`,
            },
            {
                title: f('dashTourIconsTitle', 'New: every app gets its own icon'),
                visual: svg(`
                    <rect x="12" y="8" width="190" height="132" rx="7" class="dtv-panel"/>
                    ${label(22, 25, f('dashTourCatMedia', 'Media'), 'dtv-title')}
                    ${appRow(18, 32, 178, 'Plex', 'play', 0)}
                    ${appRow(18, 58, 178, 'Jellyfin', 'ring', 0.15)}
                    ${appRow(18, 84, 178, 'Sonarr', 'wave', 0.3)}
                    ${appRow(18, 110, 178, 'Grafana', 'bars', 0.45)}
                    ${line('M210,74 L250,74', { delay: 0.5, arrow: true })}
                    <g class="dtv-anim dtv-a-panel">
                        <rect x="258" y="20" width="212" height="96" rx="8" class="dtv-panel"/>
                        ${label(270, 40, '✎ ' + f('dashTourIconsMenu', 'the icon'), 'dtv-heading')}
                        ${pill(270, 48, f('dashboard.iconSetChoose', 'Choose app icon…'), { kind: 'active', w: 188 })}
                        ${label(276, 88, f('dashboard.dockerIconLetter', 'Use letter'), 'dtv-label')}
                        ${label(276, 106, '✓ ' + f('dashboard.dockerIconAutomatic', 'Automatic'), 'dtv-title')}
                    </g>
                    ${label(364, 136, f('dashTourIconsCaption', 'light or dark, to suit your theme'), 'dtv-caption', 'middle')}
                `, f('dashTourIconsAlt', 'Bookmark letters turning into app icons, and the icon menu with Choose app icon, Use letter and Automatic')),
                body: `<p>${esc(f('dashTourIconsBody1',
                    'Bookmarks and containers for self-hosted apps now show the app’s own icon, from two open icon sets, in the variant that suits your theme. An icon you chose or uploaded is never replaced.'))}</p>
                    <p>${esc(f('dashTourIconsBody2',
                    'The ✎ on an icon offers Choose app icon…, Use letter and Automatic — in the bookmark form, the Bookmarks view and a container’s drawer.'))}</p>`,
            },
            {
                title: f('dashTourEditorTitle', 'New: recolour a theme, or save what is on screen'),
                visual: svg(`
                    ${category(12, 20, 150, f('dashTourCatHome', 'Home lab'), [['Grafana', 'ok', ''], ['Proxmox', 'ok', ''], ['Router', 'ok', '']])}
                    <g class="dtv-anim dtv-a-widen">
                        <rect x="190" y="6" width="284" height="138" rx="10" class="dtv-panel"/>
                        <line x1="190" y1="58" x2="190" y2="92" class="dtv-edge"/>
                        ${label(204, 26, '← ' + f('config.themeRecolour', 'Recolour') + ': Nord', 'dtv-heading')}
                        ${[0, 1, 2, 3, 4].map((i) => `<circle cx="${214 + i * 30}" cy="48" r="10" class="dtv-swatch${i === 1 ? ' dtv-anim dtv-a-hue' : ''}" style="fill-opacity:${(1 - i * 0.16).toFixed(2)}"/>`).join('')}
                        ${row(204, 66, 150, f('dashTourEditorAccent', 'Accent'), { dot: 'accent', kind: 'accent' })}
                        ${pill(204, 98, f('config.studioSaveAsTheme', 'Save as theme…'), { kind: 'active', motion: anim('bump', 0.4) })}
                        ${pill(204, 120, f('config.studioApply', 'Apply'))}
                    </g>
                    ${label(176, 112, '↔', 'dtv-heading', 'middle')}
                `, f('dashTourEditorAlt', 'The theme browser widened from its left edge, recolouring a theme, with Save as theme and Apply')),
                body: `<p>${esc(f('dashTourEditorBody1',
                    '✎ Edit on a theme of your own, or ✎ Recolour on a packaged one, opens its colours right in the theme browser. Save as theme… keeps what is on screen as a theme of your own — its look too, if you like.'))}</p>
                    <p>${esc(f('dashTourEditorBody2',
                    'Need more room? Drag the panel’s left edge; a double-click puts it back.'))}</p>`,
            },
            {
                title: f('dashTourUnraidTitle', 'New: your Unraid server on the dashboard'),
                visual: (() => {
                    const disks = [['parity', 0.82, 'ok', '31 °C'], ['disk1', 0.71, 'ok', '34 °C'], ['disk2', 0.93, 'warn', '36 °C'], ['cache', 0.38, 'ok', '41 °C']];
                    return svg(`
                        <g class="dtv-anim dtv-a-drop">
                            <rect x="10" y="8" width="200" height="134" rx="9" class="dtv-panel"/>
                            ${label(22, 28, f('dashboard.widgetType.unraidArray', 'Unraid array'), 'dtv-title')}
                            ${disks.map(([n, v, k, temp], i) => `
                                ${label(22, 52 + i * 24, n, 'dtv-label')}
                                <rect x="70" y="${44 + i * 24}" width="90" height="8" rx="3" class="dtv-bar-track"/>
                                <rect x="70" y="${44 + i * 24}" width="${Math.round(90 * v)}" height="8" rx="3" class="dtv-bar is-${k} dtv-anim dtv-a-grow" style="animation-delay:${(0.2 + i * 0.12).toFixed(2)}s"/>
                                ${label(200, 52 + i * 24, temp, 'dtv-sub', 'end')}`).join('')}
                        </g>
                        <g class="dtv-anim dtv-a-drop" style="animation-delay:0.15s">
                            <rect x="218" y="8" width="120" height="134" rx="9" class="dtv-panel"/>
                            ${label(230, 28, f('dashboard.widgetType.unraidParity', 'Parity'), 'dtv-title')}
                            ${ring(278, 82, 30, 0.62, '62%', { sub: f('dashTourUnraidRunning', 'running') })}
                        </g>
                        <g class="dtv-anim dtv-a-drop" style="animation-delay:0.3s">
                            <rect x="346" y="8" width="126" height="134" rx="9" class="dtv-panel"/>
                            ${label(358, 28, f('dashboard.widgetType.unraidShares', 'Shares'), 'dtv-title')}
                            ${label(358, 56, 'array', 'dtv-label')}
                            ${label(358, 76, '8.1 TB', 'dtv-value')}
                            ${label(358, 104, 'cache', 'dtv-label')}
                            ${label(358, 124, '410 GB', 'dtv-value')}
                        </g>
                    `, f('dashTourUnraidAlt', 'Three Unraid widgets: the array with each disk’s fill and temperature, a running parity check, and the free space of the shares'));
                })(),
                body: `<p>${esc(f('dashTourUnraidBody1',
                    'Seven widgets read an Unraid server: an overview, the array and its disks, parity, shares, VMs, the UPS and Unraid’s own notifications. They only read, and share one connection, set under Config → Unraid.'))}</p>
                    <p>${esc(f('dashTourUnraidBody2',
                    'With alerts on, a stopped array, a parity check with errors or a disk with new errors reaches you through the same channels as downtime alerts.'))}</p>`,
            },
            // From v1.16: the theme browser, the backdrops, the looks.
            {
                title: f('dashTourStudioTitle', 'The theme browser opens beside your dashboard'),
                visual: svg(`
                    ${keycap(12, 10, 'Shift+A', anim('press', 0))}
                    ${label(76, 24, f('dashTourStudioKey', 'from anywhere'), 'dtv-label')}
                    ${category(12, 44, 110, f('dashTourCatMedia', 'Media'), [['Plex', 'ok', ''], ['Sonarr', 'ok', '']])}
                    ${category(128, 44, 110, f('dashTourCatHome', 'Home lab'), [['Grafana', 'ok', ''], ['Proxmox', 'ok', '']])}
                    <g class="dtv-anim dtv-a-panel">
                        <rect x="250" y="6" width="222" height="138" rx="10" class="dtv-panel"/>
                        ${label(262, 24, f('dashTourStudioPanel', 'Themes'), 'dtv-heading')}
                        ${label(462, 24, '×', 'dtv-heading', 'end')}
                        ${pillFlow(262, 32, 200, [[f('dashTourStudioTabThemes', 'Themes'), 'active'], [f('dashTourStudioTabBackdrop', 'Backdrop'), 'plain'], [f('dashTourStudioTabLooks', 'Looks'), 'plain']], { gap: 4 })}
                        <rect x="262" y="58" width="198" height="16" rx="4" class="dtv-box"/>
                        ${label(268, 70, f('dashTourStudioInUse', 'In use: your theme'), 'dtv-sub')}
                        <g class="dtv-row is-accent">
                            <rect x="262" y="80" width="96" height="32" rx="5" class="dtv-box"/>
                        </g>
                        <rect x="270" y="88" width="80" height="6" rx="2" class="dtv-swatch dtv-anim dtv-a-hue"/>
                        <rect x="270" y="100" width="56" height="5" rx="2" class="dtv-bar-track"/>
                        <rect x="364" y="80" width="96" height="32" rx="5" class="dtv-box"/>
                        <rect x="372" y="88" width="80" height="6" rx="2" class="dtv-swatch"/>
                        <rect x="372" y="100" width="56" height="5" rx="2" class="dtv-bar-track"/>
                        ${pill(262, 118, f('dashTourStudioCancel', 'Cancel'))}
                        ${pill(334, 118, f('dashTourStudioApply', 'Apply'), { kind: 'active' })}
                    </g>
                `, f('dashTourStudioAlt', 'The dashboard on the left, and the theme browser opened beside it with its tabs, the theme in use, theme cards, Cancel and Apply')),
                body: `<p>${esc(f('dashTourStudioBody1',
                    'Shift+A opens the theme browser as a panel beside your dashboard, so every change shows on your own page. Point at a theme to see it, click to pick it; a line above the grid names the theme in use.'))}</p>
                    <p>${esc(f('dashTourStudioBody2',
                    'Its tabs change the backdrop, the cards, the category headers and the type as well. Nothing is saved until Apply — Cancel, Esc, the × or a click beside the panel puts everything back, and Compare shows what you had.'))}</p>`,
            },
            {
                title: f('dashTourBackdropTitle', 'Every theme has a backdrop of its own'),
                visual: (() => {
                    const tile = (x, inner, name, delay) => `
                        <g class="dtv-anim dtv-a-drop" style="animation-delay:${delay}s">
                            <rect x="${x}" y="8" width="146" height="104" rx="8" class="dtv-panel"/>
                            ${inner}
                            ${label(x + 73, 128, name, 'dtv-label', 'middle')}
                        </g>`;
                    return svg(`
                        ${tile(10, `<circle cx="52" cy="44" r="32" class="dtv-bd"/>
                            <circle cx="112" cy="72" r="30" class="dtv-bd is-second"/>`, f('dashTourBackdropAurora', 'aurora'), 0)}
                        ${tile(167, `<path d="M167,88 Q207,58 247,80 T313,74 L313,112 L167,112 Z" class="dtv-bd"/>
                            <path d="M167,100 Q217,78 263,96 T313,92 L313,112 L167,112 Z" class="dtv-bd is-second"/>`, f('dashTourBackdropDunes', 'dunes'), 0.15)}
                        ${tile(324, hexagons(330, 14, 6, 6, 9), f('dashTourBackdropHexagons', 'hexagons'), 0.3)}
                        ${label(240, 146, f('dashTourBackdropCaption', 'three of 26, drawn in the theme’s own colours'), 'dtv-caption', 'middle')}
                    `, f('dashTourBackdropAlt', 'Three backdrops side by side: aurora, dunes and hexagons'));
                })(),
                body: `<p>${esc(f('dashTourBackdropBody1',
                    'Behind the bookmarks every theme now draws a backdrop of its own, in its own colours — one of 26, from aurora and dunes to stars, mountains and hexagons — picked to suit that theme.'))}</p>
                    <p>${esc(f('dashTourBackdropBody2',
                    'Appearance → Background lets you choose another, roll a new variant with 🎲, or soften it with blur, brightness and a theme tint. Only the backdrop blurs, never your bookmarks.'))}</p>`,
            },
            {
                title: f('dashTourLooksTitle', 'Looks, card glass and category headers'),
                visual: svg(`
                    ${[f('config.look.glass', 'Glass'), f('config.look.frosted', 'Frosted'), f('config.look.paper', 'Paper'), f('config.look.terminal', 'Terminal'), f('config.look.plain', 'Plain')]
                        .map((name, i) => pill(10, 8 + i * 26, name, { w: 96, kind: i === 0 ? 'active' : 'plain', motion: anim('drop', i * 0.1) })).join('')}
                    <circle cx="160" cy="40" r="30" class="dtv-bd"/>
                    <circle cx="262" cy="70" r="28" class="dtv-bd is-second"/>
                    <rect x="138" y="22" width="146" height="62" rx="8" class="dtv-glass dtv-anim dtv-a-zoom"/>
                    ${row(146, 30, 130, 'Plex', { dot: 'ok' })}
                    ${row(146, 56, 130, 'Sonarr', { dot: 'ok' })}
                    ${label(211, 102, f('dashTourLooksGlass', 'card glass'), 'dtv-caption', 'middle')}
                    ${[0.25, 0.4, 0.55, 0.7, 0.85].map((o, i) => `<rect x="${150 + i * 24}" y="114" width="20" height="14" rx="3" class="dtv-swatch" style="fill: var(--text-secondary); fill-opacity:${o}"/>`).join('')}
                    ${label(211, 144, f('dashTourLooksNeutrals', 'Neutrals: five grey themes'), 'dtv-label', 'middle')}
                    ${label(312, 22, f('dashTourCatMedia', 'Media'), 'dtv-heading')}
                    ${label(470, 22, f('config.categoryHeaderClean', 'Clean'), 'dtv-sub', 'end')}
                    ${label(312, 62, f('dashTourCatMedia', 'Media'), 'dtv-heading')}
                    <line x1="312" y1="68" x2="470" y2="68" class="dtv-underline dtv-anim dtv-a-grow"/>
                    ${label(470, 62, f('config.categoryHeaderUnderlined', 'Underlined'), 'dtv-sub', 'end')}
                    <rect x="306" y="90" width="166" height="26" rx="6" class="dtv-panel"/>
                    ${label(316, 107, f('dashTourCatMedia', 'Media'), 'dtv-heading')}
                    ${label(462, 107, f('config.categoryHeaderBoxed', 'Boxed') + ' · 3', 'dtv-sub', 'end')}
                `, f('dashTourLooksAlt', 'A list of looks, a glass card over a backdrop, five grey swatches, and three styles of category header')),
                body: `<p>${esc(f('dashTourLooksBody1',
                    'The Looks tab sets backdrop, cards, headers and type in one click — twelve of them, from Glass and Frosted to Paper, Terminal and Plain — and leaves your theme’s colours alone.'))}</p>
                    <p>${esc(f('dashTourLooksBody2',
                    'Card glass on the Surface tab sets how see-through the cards are; category headers can be clean, underlined, boxed, a label or a card around the category. The Neutrals collection adds five calm grey themes.'))}</p>`,
            },
            // 1 — pages, categories, bookmarks
            {
                title: f('dashTourS1Title', 'Pages, categories, bookmarks'),
                visual: svg(`
                    ${pillFlow(300, 8, 170, [['1', 'active'], ['2', 'plain'], ['3', 'plain'], ['4', 'plain']], { gap: 6 })}
                    ${category(12, 12, 146, f('dashTourCatDev', 'Development'), [['GitHub', 'ok', 'gh'], ['GitLab', 'ok', ''], ['MDN', 'ok', 'md']], anim('drop', 0))}
                    ${category(168, 40, 146, f('dashTourCatMedia', 'Media'), [['YouTube', 'ok', 'yt'], ['Jellyfin', 'bad', '']], anim('drop', 0.2))}
                    ${category(324, 40, 146, f('dashTourCatHome', 'Home lab'), [['Grafana', 'ok', ''], ['Nextcloud', 'ok', 'nc']], anim('drop', 0.4))}
                `, f('dashTourS1Alt', 'Three categories of bookmarks on a page, and the page numbers')),
                body: `<p>${esc(f('dashTourS1Body1',
                    'The dashboard is pages of categories, and categories of bookmarks. The numbers in the header are your pages — 1 to 9 jump straight to one.'))}</p>
                    <p>${esc(f('dashTourS1Body2',
                    'Everything here can be reached from the keyboard, and most of it without leaving this screen.'))}</p>`,
            },
            // 2 — start typing
            {
                title: f('dashTourS2Title', 'Start typing'),
                visual: svg(`
                    <rect x="12" y="12" width="300" height="28" rx="7" class="dtv-search"/>
                    <text x="24" y="31" class="dtv-mono dtv-anim dtv-a-type">graf</text>
                    <rect x="24" y="19" width="2" height="15" class="dtv-caret dtv-anim dtv-a-caret"/>
                    ${row(12, 50, 300, 'Grafana', { dot: 'ok', kind: 'accent', motion: anim('appear') })}
                    ${row(12, 78, 300, f('dashTourS2Docs', 'Grafana docs'), { dot: 'ok', motion: anim('appear', 0.15) })}
                    ${label(12, 124, f('dashTourS2Enter', 'Enter opens the top result'), 'dtv-caption')}
                    ${[['>', f('dashTourKeySearch', 'search')], [':', f('dashTourKeyCommands', 'commands')], ['?', f('dashTourKeyFinders', 'finders')]]
                        .map(([k, l], i) => `${keycap(332, 14 + i * 30, k)}${label(358, 28 + i * 30, l)}`).join('')}
                `, f('dashTourS2Alt', 'Typed letters go to the search line, and its three modes')),
                body: `<p>${esc(f('dashTourS2Body1',
                    'Type anything on the dashboard and it goes to the search line; Enter opens the top result.'))}</p>
                    <p>${esc(f('dashTourS2Body2',
                    'The same panel has three modes: > searches your bookmarks, : runs a command, ? sends your text to a search engine or a site you set up as a finder.'))}</p>`,
            },
            // 3 — shortcuts
            {
                title: f('dashTourS3Title', 'Shortcuts open a bookmark in two keys'),
                visual: svg(`
                    ${keycap(40, 50, 'g', anim('press', 0))}
                    ${keycap(70, 50, 'h', anim('press', 0.35))}
                    ${line('M104,60 L196,60', { delay: 0.3, arrow: true })}
                    ${row(206, 49, 190, 'GitHub', { dot: 'ok', kind: 'accent', motion: anim('appear', 0.2) })}
                    ${keycap(362, 50, 'gh')}
                    ${label(206, 100, f('dashTourS3Caption', 'opens straight away — no search, no Enter'), 'dtv-caption')}
                `, f('dashTourS3Alt', 'Typing g h opens the bookmark with that shortcut')),
                body: `<p>${esc(f('dashTourS3Body1',
                    'Give a bookmark a shortcut of one or two letters and typing it on the dashboard opens it — no search, no Enter.'))}</p>
                    <p>${esc(f('dashTourS3Body2',
                    'It is the change that makes the keyboard worth it: give the ten you open every day one, in the bookmark form or with Shift+E.'))}</p>`,
            },
            // 4 — cursor and Shift
            {
                title: f('dashTourS4Title', 'A cursor, and Shift for everything'),
                visual: (() => {
                    const keys = [['Shift+E', f('dashTourKeyEdit', 'edit')], ['Shift+M', f('dashTourKeyMove', 'move')],
                        ['Shift+T', f('dashTourKeyTags', 'tags')], ['x', f('dashTourKeyTick', 'tick')]];
                    return svg(`
                        ${category(12, 10, 150, f('dashTourCatDev', 'Development'), [['GitHub', 'ok', 'gh'], ['GitLab', 'ok', ''], ['MDN', 'ok', 'md']])}
                        <rect x="17" y="33" width="140" height="24" rx="5" class="dtv-select dtv-anim dtv-a-cursor"/>
                        ${keys.map(([k, l], i) => `${keycap(180, 12 + i * 30, k)}${label(180 + keyWidth(k) + 6, 26 + i * 30, l)}`).join('')}
                        <g class="dtv-anim dtv-a-panel">
                            <rect x="330" y="12" width="140" height="112" rx="8" class="dtv-panel"/>
                            ${[[f('dashTourMenuEdit', 'Edit'), '⇧E'], [f('dashTourMenuMove', 'Move'), '⇧M'], [f('dashTourMenuTags', 'Tags'), '⇧T'], [f('dashTourMenuDelete', 'Delete'), '⇧D']]
                                .map(([l, k], i) => `${label(342, 36 + i * 24, l, 'dtv-title')}${label(460, 36 + i * 24, k, 'dtv-label', 'end')}`).join('')}
                        </g>
                    `, f('dashTourS4Alt', 'A cursor on a bookmark, the Shift keys and the right-click menu'));
                })(),
                body: `<p>${esc(f('dashTourS4Body1',
                    'The first arrow key starts a cursor on the grid. With a bookmark selected, every action is Shift plus a letter: Shift+E edits in place, Shift+M moves, Shift+T tags, Shift+D deletes.'))}</p>
                    <p>${esc(f('dashTourS4Body2',
                    'x ticks several at once, and the right-click menu shows every action with its key.'))}</p>`,
            },
            // 5 — adding
            {
                title: f('dashTourS5Title', 'Adding: paste, +, or one line'),
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
                body: `<p>${esc(f('dashTourS5Body1',
                    'Paste a URL anywhere on the dashboard and nextDash offers to add it as a bookmark or to put it in the inbox for later.'))}</p>
                    <p>${esc(f('dashTourS5Body2',
                    '+ opens the full form; & adds one in a single line — name | url | shortcut. The browser extension saves the tab you are on.'))}</p>`,
            },
            // 6 — status and the header icons
            {
                title: f('dashTourS6Title', 'The dashboard knows when a link breaks'),
                visual: svg(`
                    ${category(12, 10, 170, f('dashTourCatHome', 'Home lab'), [['Grafana', 'ok', ''], ['Nextcloud', 'bad', 'nc'], ['Router', 'ok', '']])}
                    <circle cx="28" cy="71" r="7" class="dtv-ring-bad dtv-anim dtv-a-glow"/>
                    ${headerIcon(236, 30, 'bookmarks', 1, 'bad', anim('bump', 0))}
                    ${headerIcon(312, 30, 'inbox', 5, 'warn', anim('bump', 0.3))}
                    ${headerIcon(388, 30, 'containers', 2, 'active', anim('bump', 0.6))}
                    ${label(250, 80, f('dashTourS6Bookmarks', 'Bookmarks'), 'dtv-label', 'middle')}
                    ${label(326, 80, f('dashTourS6Inbox', 'Inbox'), 'dtv-label', 'middle')}
                    ${label(402, 80, f('dashTourS6Containers', 'Containers'), 'dtv-label', 'middle')}
                `, f('dashTourS6Alt', 'A broken bookmark, and the header icons with their counts')),
                body: `<p>${esc(f('dashTourS6Body1',
                    'A dot beside a bookmark says whether it still answers, and monitored ones carry a quiet glow. Link checking is set per bookmark, or for many at once.'))}</p>
                    <p>${esc(f('dashTourS6Body2',
                    'The icons in the header lead to the other views — Bookmarks, Inbox and Containers — and their badges count what needs you: a broken link, unread links, updates waiting.'))}</p>`,
            },
            // 7 — the Bookmarks view
            {
                title: f('dashTourS7Title', 'All your bookmarks in one list'),
                visual: (() => {
                    const rail = [['dashboard.healthFilterBroken', 'Broken', 'bad', '2'], ['dashboard.healthFilterDuplicates', 'Duplicates', 'plain', '3'],
                        ['dashboard.healthFilterStale', 'Stale', 'warn', '5'], ['dashTourNeverOpened', 'Never opened', 'plain', '43']];
                    return svg(`
                        ${headerIcon(10, 12, 'bookmarks', 1, 'bad')}
                        ${keycap(10, 50, 'Shift+H')}
                        <g class="dtv-anim dtv-a-zoom">
                            <rect x="84" y="6" width="390" height="138" rx="10" class="dtv-panel"/>
                            ${rail.map(([key, fb, dot, n], i) => `
                                <circle cx="98" cy="${28 + i * 22}" r="3" class="dtv-dot is-${dot}"/>
                                ${label(106, 32 + i * 22, f(key, fb), i === 0 ? 'dtv-title' : 'dtv-label')}
                                ${label(200, 32 + i * 22, n, 'dtv-title', 'end')}`).join('')}
                            <rect x="92" y="19" width="112" height="18" rx="4" class="dtv-select dtv-anim dtv-a-rail"/>
                            ${row(210, 16, 140, 'Nextcloud', { dot: 'bad', kind: 'bad' })}
                            ${row(210, 42, 140, 'Old wiki', { dot: 'bad' })}
                            ${row(210, 68, 140, 'GitHub', { dot: 'ok' })}
                            ${row(210, 94, 140, 'MDN', { dot: 'ok' })}
                            <g class="dtv-anim dtv-a-panel">
                                <rect x="356" y="14" width="110" height="122" rx="8" class="dtv-panel"/>
                                ${label(366, 34, 'Nextcloud', 'dtv-title')}
                                ${pill(366, 42, f('config.bmHealth', 'Health'), { kind: 'active', w: 70 })}
                                ${label(366, 84, 'Monitor · 15m')}
                                ${label(366, 102, 'HTTP 503', 'dtv-title')}
                            </g>
                        </g>
                    `, f('dashTourS7Alt', 'The Bookmarks view: its filters, every bookmark in one list, and the side panel'));
                })(),
                body: `<p>${esc(f('dashTourS7Body1',
                    'The dashboard shows a page at a time; the Bookmarks view (Shift+H, or the bookmark icon in the header) shows every bookmark on every page in one list.'))}</p>
                    <p>${esc(f('dashTourS7Body2',
                    'The rail filters it — broken, duplicates, stale, never opened, a tag, a page — and the side panel edits the one you focus, including how and how often it is checked. It has a tour of its own the first time you open it.'))}</p>`,
            },
            // 8 — the inbox
            {
                title: f('dashTourInboxTitle', 'The inbox: links you have not placed yet'),
                visual: (() => {
                    const outs = [[f('dashboard.inboxPromote', 'Promote'), 'plain', f('dashTourInboxPromote', 'a bookmark on a page')],
                        [f('dashboard.inboxTriageKeep', 'Keep'), 'active', f('dashTourInboxKeep', 'Bookmarks › Unsorted')],
                        [f('dashboard.inboxDelete', 'Delete'), 'bad', f('dashTourInboxDelete', 'gone, with Undo')]];
                    return svg(`
                        ${headerIcon(12, 14, 'inbox', 3, 'warn', anim('bump', 0.5))}
                        ${row(56, 12, 170, 'Rust Book', { dot: 'accent', motion: anim('drop', 0) })}
                        ${row(56, 38, 170, 'Deno Manual', { dot: 'accent', motion: anim('drop', 0.2) })}
                        ${row(56, 64, 170, 'Zig Language', { motion: anim('drop', 0.4) })}
                        ${keycap(56, 100, 't')}${label(82, 114, f('dashTourInboxTriage', 'triage, one link at a time'))}
                        ${outs.map(([name, kind, where], i) => `
                            ${line(`M230,48 C240,48 238,${16 + i * 46} 244,${16 + i * 46}`, { delay: 0.3 * i, arrow: true })}
                            ${pill(250, 6 + i * 46, name, { kind })}
                            ${label(250, 38 + i * 46, where)}`).join('')}
                    `, f('dashTourInboxAlt', 'Links in the inbox, and the three ways out of it'));
                })(),
                body: `<p>${esc(f('dashTourInboxBody1',
                    'The inbox (Shift+I) holds links you want to keep before you know where they belong — pasted, saved from the extension, or shared. The header icon counts what is unread.'))}</p>
                    <p>${esc(f('dashTourInboxBody2',
                    'Every link leaves one of three ways: Promote makes it a bookmark on a page, Keep sends it to Bookmarks › Unsorted, Delete throws it away. t works through them one at a time.'))}</p>`,
            },
            // 9 — containers
            {
                title: f('dashTourDockerTitle', 'Containers: what runs on your server'),
                visual: (() => {
                    const rows = [['grafana', 'ok'], ['jellyfin', 'ok'], ['sonarr', 'warn'], ['bazarr', 'bad']];
                    const keys = [['s', f('dashboard.dockerLegendRun', 'start / stop')], ['r', f('dashboard.dockerLegendRestart', 'restart')],
                        ['u', f('dashboard.dockerLegendUpdate', 'update')]];
                    return svg(`
                        ${headerIcon(12, 14, 'containers', 2, 'active', anim('bump', 0.3))}
                        ${rows.map(([n, st], i) => `
                            <g class="dtv-anim dtv-a-drop" style="animation-delay:${(i * 0.15).toFixed(2)}s">
                                <rect x="56" y="${10 + i * 28}" width="190" height="22" rx="4" class="dtv-box"/>
                                <rect x="56" y="${10 + i * 28}" width="4" height="22" rx="2" class="dtv-glow is-${st}${st === 'bad' ? ' dtv-anim dtv-a-glow' : ''}"/>
                                ${label(68, 25 + i * 28, n, 'dtv-title')}
                            </g>`).join('')}
                        ${pill(242 - pillWidth(f('dashboard.dockerUpdateBadge', 'update')), 67, f('dashboard.dockerUpdateBadge', 'update'), { kind: 'warn' })}
                        ${keys.map(([k, l], i) => `${keycap(270, 12 + i * 30, k)}${label(296, 26 + i * 30, l)}`).join('')}
                        ${label(270, 118, 'NEXTDASH_DOCKER_CONTROL=1', 'dtv-mono')}
                    `, f('dashTourDockerAlt', 'Containers glowing by state, and the keys that act on them'));
                })(),
                body: `<p>${esc(f('dashTourDockerBody1',
                    'With the Docker socket mounted, the Containers view (the box icon, or #docker) lists what runs on the host: each row glows with its state, and the side panel shows resources, logs and what an update would change.'))}</p>
                    <p>${esc(f('dashTourDockerBody2',
                    's starts or stops, r restarts, u updates — once NEXTDASH_DOCKER_CONTROL=1 is set. Update checks tell you when an image is out of date. It has a tour of its own too.'))}</p>`,
            },
            // 10 — widgets
            {
                title: f('dashTourS8Title', 'More than links'),
                visual: (() => {
                    const tiles = [[f('dashTourTileHealth', 'Health'), f('dashTourTileHealthValue', '2 broken'), 'bad'],
                        [f('dashTourTileWeather', 'Weather'), '19°C', 'accent'],
                        [f('dashTourTileContainers', 'Containers'), '9 / 10', 'ok'],
                        [f('dashTourTileUnsorted', 'Unsorted'), f('dashTourTileUnsortedValue', '4 links'), 'warn']];
                    return svg(tiles.map(([title, value, kind], i) => `
                        <g class="dtv-anim dtv-a-drop" style="animation-delay:${(i * 0.15).toFixed(2)}s">
                            <rect x="${12 + i * 117}" y="20" width="108" height="92" rx="9" class="dtv-panel"/>
                            ${label(24 + i * 117, 42, title, 'dtv-title')}
                            ${label(24 + i * 117, 74, value, 'dtv-value')}
                            <rect x="${24 + i * 117}" y="92" width="80" height="5" rx="2" class="dtv-bar is-${kind} dtv-anim dtv-a-grow"
                                style="animation-delay:${(0.3 + i * 0.15).toFixed(2)}s"/>
                        </g>`).join(''), f('dashTourS8Alt', 'Four widgets on a page'));
                })(),
                body: `<p>${esc(f('dashTourS8Body1',
                    'Widgets sit on your pages between the categories: health, uptime, the inbox, unsorted links, containers, weather, a calendar, feeds, and a widget of your own that reads any JSON address.'))}</p>
                    <p>${esc(f('dashTourS8Body2',
                    'Add them under Config → Widgets. A category can spread across columns when it outgrows one.'))}</p>`,
            },
            // 11 — the keys worth learning
            {
                title: f('dashTourKeysTitle', 'The keys worth learning first'),
                visual: (() => {
                    const keys = [['1–9', f('dashTourKeyPages', 'pages')], ['>', f('dashTourKeySearch', 'search')], [':', f('dashTourKeyCommands', 'commands')],
                        ['+', f('dashTourKeyAdd', 'add')], ['Shift+H', f('dashTourKeyBookmarks', 'Bookmarks')], ['Shift+I', f('dashTourKeyInbox', 'Inbox')],
                        ['Shift+S', f('dashTourKeyConfig', 'config')], ['/', f('dashTourKeyTagCloud', 'tag cloud')], ['*', f('dashTourKeyRecent', 'recent')],
                        ['.', f('dashTourKeyFold', 'fold all')], ['!', f('dashTourKeyCheat', 'cheat sheet')], ['Escape', f('dashTourKeyBack', 'back')]];
                    return svg(keys.map(([k, l], i) => {
                        const col = i % 3;
                        const rowIndex = Math.floor(i / 3);
                        const x = 12 + col * 156;
                        const y = 10 + rowIndex * 34;
                        return `${keycap(x, y, k, anim('press', (i * 0.3).toFixed(2)))}${label(x + keyWidth(k) + 8, y + 14, l)}`;
                    }).join(''), f('dashTourKeysAlt', 'Twelve keys: pages, search, commands, add, the views, and the cheat sheet'));
                })(),
                body: `<p>${esc(f('dashTourKeysBody1',
                    '1–9 jump to a page, > searches, : runs a command, + adds a bookmark. Shift+H opens Bookmarks, Shift+I the inbox, Shift+S config.'))}</p>
                    <p>${esc(f('dashTourKeysBody2',
                    '/ opens the tag cloud, * your recent bookmarks, . folds every category, and Escape always takes you back. None of them fire while you type in a field.'))}</p>`,
            },
            // 12 — what config can change
            {
                title: f('dashTourConfigTitle', 'Make it yours in Config'),
                visual: (() => {
                    const tiles = [f('config.sectionAppearance', 'Appearance'), f('config.sectionBehavior', 'Behavior'), f('config.sectionStructure', 'Structure'),
                        f('config.sectionBookmarks', 'Bookmarks'), f('config.sectionWidgets', 'Widgets'), f('config.sectionDataBackups', 'Data & backups')];
                    return svg(`
                        ${tiles.map((l, i) => {
                            const x = 10 + (i % 2) * 144;
                            const y = 8 + Math.floor(i / 2) * 44;
                            return `<g class="dtv-anim dtv-a-drop" style="animation-delay:${(i * 0.1).toFixed(2)}s">
                                <rect x="${x}" y="${y}" width="140" height="36" rx="7" class="dtv-panel"/>
                                ${label(x + 9, y + 22, l, 'dtv-tile')}
                            </g>`;
                        }).join('')}
                        <rect x="298" y="8" width="174" height="134" rx="10" class="dtv-panel"/>
                        <rect x="308" y="18" width="154" height="10" rx="3" class="dtv-swatch dtv-anim dtv-a-hue"/>
                        ${[0, 1, 2].map((c) => `<rect x="${308 + c * 52}" y="38" width="48" height="46" rx="5" class="dtv-box"/>
                            <rect x="${314 + c * 52}" y="46" width="34" height="5" rx="2" class="dtv-swatch dtv-anim dtv-a-hue"/>
                            <rect x="${314 + c * 52}" y="58" width="28" height="5" rx="2" class="dtv-bar-track"/>`).join('')}
                        ${label(308, 106, f('dashTourConfigSaved', 'saved as you change it'), 'dtv-caption')}
                        ${label(308, 126, '↺ ' + f('dashTourConfigReset', 'back to the default'), 'dtv-label')}
                    `, f('dashTourConfigAlt', 'The sections of Config, and a preview that follows every change'));
                })(),
                body: `<p>${esc(f('dashTourConfigBody1',
                    'Appearance sets the theme and its backdrop, the card glass and category headers, fonts, grid, header and action bar, with a preview that follows each change. Behavior covers keys and search, link checking and alerts, and privacy and sync. Structure holds pages, categories, finders and collections.'))}</p>
                    <p>${esc(f('dashTourConfigBody2',
                    'Bookmarks, Inbox, Widgets and Containers each have their own section, and Data & backups keeps imports, backups and the trash. Every change saves at once, and ↺ puts a setting back.'))}</p>`,
            },
            // 13 — the cheat sheet and the tours
            {
                title: f('dashTourS9Title', 'The cheat sheet, and the tours'),
                visual: (() => {
                    const keys = [['!', f('dashTourKeyCheat', 'cheat sheet')], ['F1', f('dashTourKeyCheat', 'cheat sheet')],
                        ['Ctrl+Shift+K', f('dashTourKeyFind', 'find a setting')], [':config help', f('dashTourKeyHelp', 'the guide')]];
                    const tours = [f('config.tourBookmarks', 'Bookmarks view'), f('config.tourInbox', 'Inbox'), f('config.tourContainers', 'Containers')];
                    return svg(`
                        ${keys.map(([k, l], i) => `${keycap(12, 12 + i * 30, k)}${label(12 + keyWidth(k) + 8, 26 + i * 30, l)}`).join('')}
                        ${label(300, 22, f('dashTourS9Tours', 'Tours'), 'dtv-heading')}
                        ${tours.map((l, i) => pill(300, 32 + i * 28, l, { w: 150, kind: i === 0 ? 'active' : 'plain', motion: anim('drop', 0.2 * i) })).join('')}
                    `, f('dashTourS9Alt', 'The keys for config and the cheat sheet, and the tours of the other views'));
                })(),
                body: `<p>${esc(f('dashTourS9Body1',
                    '! or F1 opens the cheat sheet: every key, with a filter, on the section for the view you are in. Config → Help is the full guide, and Ctrl/Cmd+Shift+K finds any setting or help topic.'))}</p>
                    <p class="dashboard-tutorial-closing">${esc(f('dashTourS9Closing',
                    'The Bookmarks, Inbox and Containers views each have a tour the first time you open them, and Config → Onboarding plays any tour again — this one included.'))}</p>`,
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
        if (!d?.settings || d.settings.enableSessionTips === false) return false;
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
