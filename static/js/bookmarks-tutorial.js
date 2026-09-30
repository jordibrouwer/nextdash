/**
 * One-time Bookmarks view tutorial — a guided tour through the view, shown the
 * first time it opens. Built like inbox-tutorial.js and sharing its guards, so
 * a session that has turned session tips off, or is on a phone, never sees it.
 *
 * The view looks like a list of bookmarks, and most of what it can do is not
 * on the surface: the health filters in the rail, three ways of checking a
 * link, what a failure records, drift and certificates, the charts, Collection
 * health, alerts, and working through what is broken. This walks all of it
 * once, checking and health first, because that is the part nobody would find
 * by clicking around.
 *
 * Longer than the inbox tour and with more moving parts, by request: each
 * scene shows the one movement its step is about, and stands still -- on a
 * picture that still tells the story -- for a reader who asked for less
 * motion.
 */
(function (global) {
    'use strict';

    // Also named in DashboardConfig (the view checks it before fetching this
    // file) and in the replay list in config and search. All must agree.
    const TIP_ID = 'bookmarksTutorialV1';

    function t(key, fallback, params) {
        const lang = global.dashboardInstance?.language;
        let text = fallback;
        if (lang?.t) {
            const full = key.includes('.') ? key : `config.${key}`;
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
        .btv { font-family: var(--font-family-main, ui-monospace, monospace); }
        .btv-box { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .btv-row.is-accent .btv-box { stroke: var(--accent-primary); stroke-width: 1.5; }
        .btv-row.is-bad .btv-box { stroke: var(--accent-error, var(--border-primary)); stroke-width: 1.5; }
        .btv-panel { fill: var(--background-primary); stroke: var(--border-primary); stroke-width: 1; }
        .btv-title, .btv-heading { fill: var(--text-primary); font-size: 11px; font-weight: 700; }
        .btv-heading { font-size: 12px; }
        .btv-big { fill: var(--text-primary); font-size: 18px; font-weight: 700; }
        .btv-sub, .btv-label { fill: var(--text-secondary); font-size: 10px; }
        .btv-mono { fill: var(--text-primary); font-size: 10px; font-family: var(--font-mono, ui-monospace, monospace); }
        .btv-caption { fill: var(--text-secondary); font-size: 10px; font-style: italic; }
        .btv-dot.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .btv-dot.is-warn { fill: var(--accent-warning, var(--accent-primary)); }
        .btv-dot.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .btv-dot.is-plain { fill: var(--text-secondary); }
        .btv-dot.is-accent { fill: var(--accent-primary); }
        .btv-pill-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-opacity: 0.55; stroke-width: 1; }
        .btv-pill-text { fill: var(--text-primary); font-size: 10px; }
        .btv-pill.is-active .btv-pill-box { stroke: var(--accent-primary); stroke-opacity: 1; stroke-width: 2; }
        .btv-pill.is-active .btv-pill-text { font-weight: 700; }
        .btv-pill.is-warn .btv-pill-box { stroke: var(--accent-warning, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .btv-pill.is-bad .btv-pill-box { stroke: var(--accent-error, var(--accent-primary)); stroke-opacity: 1; stroke-width: 1.5; }
        .btv-pill.is-dashed .btv-pill-box { stroke-dasharray: 3 2; }
        .btv-select { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .btv-line { fill: none; stroke: var(--accent-primary); stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
        .btv-arrow { fill: none; stroke: var(--accent-primary); stroke-width: 1.5; }
        .btv-arrowhead { fill: var(--accent-primary); }
        .btv-ring-track { fill: none; stroke: var(--border-primary); stroke-width: 6; }
        .btv-ring { fill: none; stroke-width: 6; stroke-linecap: round; }
        .btv-ring.is-ok { stroke: var(--accent-success, var(--accent-primary)); }
        .btv-ring.is-warn { stroke: var(--accent-warning, var(--accent-primary)); }
        .btv-beat.is-ok { fill: var(--accent-success, var(--accent-primary)); }
        .btv-beat.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .btv-bar { fill: var(--accent-primary); }
        .btv-bar-track { fill: none; stroke: var(--border-primary); stroke-width: 1; }
        .btv-cell { fill: var(--accent-success, var(--accent-primary)); }
        .btv-cell.is-bad { fill: var(--accent-error, var(--accent-primary)); }
        .btv-key-box { fill: var(--background-primary); stroke: var(--text-secondary); stroke-width: 1; }
        .btv-key-text { fill: var(--text-primary); font-size: 10.5px; font-weight: 700;
            font-family: var(--font-mono, ui-monospace, monospace); }

        .btv-anim { transform-box: fill-box; transform-origin: center;
            animation-duration: 4.8s; animation-iteration-count: infinite;
            animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
        .btv-a-draw { stroke-dasharray: 1; animation-name: btv-draw; }
        .btv-a-drop { animation-name: btv-drop; }
        .btv-a-panel { animation-name: btv-panel; }
        .btv-a-bump { animation-name: btv-bump; }
        .btv-a-tick { animation-name: btv-tick; }
        .btv-a-grow { animation-name: btv-grow; transform-origin: left center; }
        .btv-a-ring { stroke-dasharray: 1; animation-name: btv-ring; }
        .btv-a-blink { animation-name: btv-blink; }
        .btv-a-swap { animation-name: btv-swap; }
        .btv-a-press { animation-name: btv-press; }
        .btv-a-slide { animation-name: btv-slide; }

        @keyframes btv-draw { 0%, 8% { stroke-dashoffset: 1; } 42%, 100% { stroke-dashoffset: 0; } }
        @keyframes btv-drop { 0%, 12% { opacity: 0; transform: translateY(-8px); } 28%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-panel { 0%, 10% { opacity: 0; transform: translateX(46px); } 32%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-bump { 0%, 56% { transform: none; } 64% { transform: scale(1.25); } 74%, 100% { transform: none; } }
        @keyframes btv-tick { 0%, 6% { opacity: 0; } 14%, 100% { opacity: 1; } }
        @keyframes btv-grow { 0%, 10% { transform: scaleX(0); } 42%, 100% { transform: none; } }
        /* The ring fills to its value: the value is carried in stroke-dashoffset on the element. */
        @keyframes btv-ring { 0%, 8% { stroke-dashoffset: 1; } 48%, 100% { stroke-dashoffset: var(--btv-ring-to, 0); } }
        @keyframes btv-blink { 0%, 30% { opacity: 1; } 40%, 50% { opacity: 0.2; } 60%, 100% { opacity: 1; } }
        @keyframes btv-swap { 0%, 44% { opacity: 1; transform: none; } 52% { opacity: 0; transform: translateX(-22px); }
            56% { opacity: 0; transform: translateX(22px); } 68%, 100% { opacity: 1; transform: none; } }
        @keyframes btv-press { 0%, 40% { transform: none; } 46% { transform: translateY(2px); } 54%, 100% { transform: none; } }
        /* The selection mark walks down the rail and settles on the first filter. */
        @keyframes btv-slide { 0% { transform: none; } 20% { transform: translateY(42px); } 40% { transform: translateY(84px); }
            60% { transform: translateY(42px); } 80%, 100% { transform: none; } }

        @media (prefers-reduced-motion: reduce) { .btv-anim { animation: none !important; } }
        body.no-animations .btv-anim { animation: none !important; }
    `;

    function svg(inner, label) {
        return `<svg class="btv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}"
                     preserveAspectRatio="xMidYMid meet">
            <style>${SCENE_STYLE}</style>
            <defs>
                <marker id="btv-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7"
                        orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="btv-arrowhead"/></marker>
            </defs>
            ${inner}
        </svg>`;
    }

    /** Animation class and an optional start offset, for staggering a set. */
    function anim(name, delay = 0) {
        return { cls: ` btv-anim btv-a-${name}`, style: delay ? ` style="animation-delay:${delay}s"` : '' };
    }

    const NONE = { cls: '', style: '' };

    function label(x, y, text, cls = 'btv-label', anchor = 'start') {
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(text)}</text>`;
    }

    /** A one-line bookmark row: an optional status dot, the name, the site. */
    function row(x, y, w, title, { site = '', dot = '', kind = '', motion = NONE } = {}) {
        return `<g class="btv-row${kind ? ` is-${kind}` : ''}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${w}" height="22" rx="4" class="btv-box"/>
            ${dot ? `<circle cx="${x + 10}" cy="${y + 11}" r="3" class="btv-dot is-${dot}"/>` : ''}
            <text x="${x + 20}" y="${y + 15}" class="btv-title">${esc(title)}</text>
            ${site ? `<text x="${x + w - 8}" y="${y + 15}" text-anchor="end" class="btv-sub">${esc(site)}</text>` : ''}
        </g>`;
    }

    function pillWidth(text) {
        return Math.max(34, String(text).length * 6.2 + 18);
    }

    function pill(x, y, text, { kind = 'plain', w = null, motion = NONE } = {}) {
        const width = w || pillWidth(text);
        return `<g class="btv-pill is-${kind}${motion.cls}"${motion.style}>
            <rect x="${x}" y="${y}" width="${width}" height="20" rx="10" class="btv-pill-box"/>
            <text x="${x + width / 2}" y="${y + 14}" text-anchor="middle" class="btv-pill-text">${esc(text)}</text>
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
        return `<g class="btv-key${motion.cls}"${motion.style}><rect x="${x}" y="${y}" width="${w}" height="20" rx="4" class="btv-key-box"/>
            <text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" class="btv-key-text">${esc(k)}</text></g>`;
    }

    /** A path that draws itself along its length. */
    function line(d, { kind = '', delay = null, arrow = false } = {}) {
        const drawn = delay !== null;
        return `<path d="${d}" class="${arrow ? 'btv-arrow' : `btv-line${kind ? ` is-${kind}` : ''}`}${drawn ? ' btv-anim btv-a-draw' : ''}"
            ${drawn ? `pathLength="1"${delay ? ` style="animation-delay:${delay}s"` : ''}` : ''}${arrow ? ' marker-end="url(#btv-arrow)"' : ''}/>`;
    }

    /** A score or countdown ring, filled to `value` (0..1). */
    function ring(cx, cy, r, value, text, { kind = 'ok', sub = '' } = {}) {
        const rest = (1 - value).toFixed(3);
        return `<g>
            <circle cx="${cx}" cy="${cy}" r="${r}" class="btv-ring-track"/>
            <circle cx="${cx}" cy="${cy}" r="${r}" pathLength="1" transform="rotate(-90 ${cx} ${cy})"
                class="btv-ring is-${kind} btv-anim btv-a-ring" style="stroke-dashoffset:${rest};--btv-ring-to:${rest}"/>
            <text x="${cx}" y="${cy + (sub ? 3 : 6)}" text-anchor="middle" class="btv-big">${esc(text)}</text>
            ${sub ? `<text x="${cx}" y="${cy + 16}" text-anchor="middle" class="btv-sub">${esc(sub)}</text>` : ''}
        </g>`;
    }

    /** A heartbeat bar: one block per check, the bad ones red, ticking in from the left. */
    function heartbeat(x, y, n, bad = []) {
        return Array.from({ length: n }, (_, i) => `<rect x="${x + i * 6}" y="${y}" width="4" height="14" rx="1"
            class="btv-beat is-${bad.includes(i) ? 'bad' : 'ok'} btv-anim btv-a-tick" style="animation-delay:${(i * 0.04).toFixed(2)}s"/>`).join('');
    }

    function steps() {
        const f = (key, fallback) => t(key, fallback);
        const health = f('dashboard.healthFilterBroken', 'Broken');
        return [
            // 1 — the view
            {
                title: f('bmTourS1Title', 'Your whole collection, one screen'),
                visual: svg(`
                    <rect x="12" y="12" width="100" height="126" rx="6" class="btv-panel"/>
                    ${label(22, 32, f('dashboard.healthScoreTotal', 'Score'), 'btv-title')}
                    ${label(102, 32, '77%', 'btv-title', 'end')}
                    ${line('M22,50 L40,48 L58,49 L76,43 L102,40', { delay: 0 })}
                    ${label(22, 76, health)}${label(102, 76, '2', 'btv-title', 'end')}
                    ${label(22, 96, f('config.bmLargeUptime', 'Uptime'))}${label(102, 96, '98%', 'btv-title', 'end')}
                    ${label(22, 116, f('dashboard.healthFilterMonitored', 'Monitored'))}${label(102, 116, '4', 'btv-title', 'end')}
                    ${row(124, 14, 184, 'nextDash', { site: 'nextdash.cc', motion: anim('drop', 0.1) })}
                    ${row(124, 42, 184, 'GitHub', { site: 'github.com', kind: 'accent', motion: anim('drop', 0.25) })}
                    ${row(124, 70, 184, 'Nextcloud', { site: 'cloud.home', dot: 'bad', motion: anim('drop', 0.4) })}
                    ${row(124, 98, 184, 'Grafana', { site: 'grafana.org', motion: anim('drop', 0.55) })}
                    <g class="btv-anim btv-a-panel">
                        <rect x="320" y="10" width="150" height="130" rx="8" class="btv-panel"/>
                        ${label(332, 30, 'GitHub', 'btv-heading')}
                        ${label(332, 44, 'github.com')}
                        ${pill(332, 54, f('bmTabDetails', 'Details'), { w: 60 })}
                        ${pill(396, 54, f('bmHealth', 'Health'), { kind: 'active', w: 60 })}
                        ${ring(350, 108, 18, 0.97, '97')}
                        ${label(376, 106, f('bmTourS1Checked', 'checked 3m ago'))}
                    </g>
                `, f('bmTourS1Alt', 'The rail, the list and the side panel of the Bookmarks view')),
                body: `<p>${esc(f('bmTourS1Body1',
                    'The Bookmarks view (Shift+H on the dashboard, or the icon in the header) puts every bookmark in one list: the rail on the left narrows it, the side panel on the right shows the one you focus.'))}</p>
                    <p>${esc(f('bmTourS1Body2',
                    'Most of what it can do is about whether your links still work. That is what this tour is mostly about.'))}</p>`,
            },
            // 2 — the rail
            {
                title: f('bmTourS2Title', 'The rail: filters that count'),
                visual: (() => {
                    const items = [
                        ['dashboard.healthFilterBroken', 'Broken', 'bad', '2'],
                        ['dashboard.healthFilterContent', 'Content', 'warn', '1'],
                        ['dashboard.healthFilterDuplicates', 'Duplicates', 'plain', '3'],
                        ['dashboard.healthFilterStale', 'Stale', 'warn', '5'],
                        ['dashboard.healthFilterUnchecked', 'Unchecked', 'plain', '36'],
                        ['dashboard.healthFilterMonitored', 'Monitored', 'accent', '4'],
                        ['dashboard.healthFilterCertificates', 'Certificates', 'warn', '1'],
                    ];
                    const rail = items.map(([key, fb, dot, n], i) => `
                        <g class="btv-anim btv-a-drop" style="animation-delay:${(i * 0.08).toFixed(2)}s">
                            <circle cx="24" cy="${20 + i * 18}" r="3" class="btv-dot is-${dot}"/>
                            ${label(34, 24 + i * 18, f(key, fb), i === 0 ? 'btv-title' : 'btv-label')}
                            ${label(160, 24 + i * 18, n, 'btv-title', 'end')}
                        </g>`).join('');
                    return svg(`
                        ${rail}
                        <rect x="16" y="11" width="150" height="18" rx="4" class="btv-select btv-anim btv-a-slide"/>
                        ${row(184, 14, 220, 'Nextcloud', { site: 'HTTP 503', dot: 'bad', kind: 'bad' })}
                        ${row(184, 42, 220, 'Old wiki', { site: 'DNS', dot: 'bad', kind: 'bad' })}
                        ${label(184, 90, '#bookmarks?health=broken', 'btv-mono')}
                        ${label(184, 108, f('bmTourS2Link', 'a filtered list is a link'), 'btv-caption')}
                    `, f('bmTourS2Alt', 'The health filters in the rail, each with a count'));
                })(),
                body: `<p>${esc(f('bmTourS2Body1',
                    'Views such as Never opened or Without tags, then the health filters — Broken, Content, Duplicates, Stale, Unused, Unchecked, Monitored, Certificates, Healthy — each with its count. A filter hides until something is in it.'))}</p>
                    <p>${esc(f('bmTourS2Body2',
                    'What you narrowed the list to is kept in the address, so a filtered list is a link you can bookmark or send.'))}</p>`,
            },
            // 3 — the three modes
            {
                title: f('bmTourS3Title', 'Three ways to check a link'),
                visual: (() => {
                    const intervals = ['5m', '15m', '30m', '1h', '6h', '24h'];
                    const modes = [f('bmTourModeOff', 'Off'), f('bmCheckingPeriodic', 'Periodic'), f('bmCheckingMonitor', 'Monitor')];
                    const mw = Math.max(...modes.map(pillWidth));
                    const x = 16 + mw + 10;
                    return svg(`
                        ${pill(16, 14, modes[0], { w: mw })}
                        ${label(x, 28, f('bmTourS3Off', 'never checked'))}
                        ${pill(16, 44, modes[1], { w: mw })}
                        ${label(x, 58, f('bmTourS3Periodic', 'about once a day, flagged when broken'))}
                        ${pill(16, 74, modes[2], { kind: 'active', w: mw })}
                        ${intervals.map((iv, i) => pill(x + i * 42, 74, iv, { w: 36, kind: i === 1 ? 'active' : 'plain' })).join('')}
                        ${heartbeat(x, 108, 44, [29, 30])}
                        ${label(x + 44 * 6 + 8, 120, '99.8%', 'btv-title')}
                        ${label(x, 142, f('bmTourS3Beat', 'one block per check'), 'btv-caption')}
                    `, f('bmTourS3Alt', 'Off, Periodic and Monitor, with Monitor’s intervals and heartbeat'));
                })(),
                body: `<p>${esc(f('bmTourS3Body1',
                    'Every bookmark has an availability mode. Off is never checked. Periodic is checked about once a day and flagged when broken. Monitor is checked by the server on its own interval, from 5 minutes to 24 hours, with uptime history and alerts.'))}</p>
                    <p>${esc(f('bmTourS3Body2',
                    'Set it in the side panel, the bookmark form or the row menu; Turn on checking in the Collection menu does many at once.'))}</p>`,
            },
            // 4 — why a check fails, and expectations
            {
                title: f('bmTourS4Title', 'A failure says why'),
                visual: (() => {
                    const causes = ['DNS', 'timeout', 'refused', 'TLS', 'HTTP 503', f('dashboard.healthFilterContent', 'Content')];
                    return svg(`
                        ${row(16, 14, 186, 'Nextcloud', { site: 'cloud.home', dot: 'bad', kind: 'bad' })}
                        ${pillFlow(16, 48, 190, causes.map((c, i) => [c, i === 4 ? 'bad' : 'plain', i === 4 ? anim('blink') : null]))}
                        ${label(16, 124, f('bmTourS4Retry', 'retried after 5 s before it counts'), 'btv-caption')}
                        <rect x="222" y="10" width="248" height="130" rx="8" class="btv-panel"/>
                        ${label(234, 30, f('dashboard.healthDrawerExpect', 'Expectations'), 'btv-heading')}
                        ${label(234, 50, f('bmTourS4Text', 'Text the page must contain'))}
                        <rect x="234" y="56" width="224" height="20" rx="4" class="btv-box"/>
                        ${label(242, 70, 'All systems operational', 'btv-title')}
                        ${label(234, 96, f('bmTourS4Codes', 'Status codes that count as healthy'))}
                        ${pill(234, 104, '200,401', { kind: 'active', w: 76, motion: anim('bump', 0.2) })}
                    `, f('bmTourS4Alt', 'The causes a failed check records, and the Expectations panel'));
                })(),
                body: `<p>${esc(f('bmTourS4Body1',
                    'A failed check records its cause — DNS, timeout, refused, TLS, content or an HTTP status — and is tried again five seconds later before it counts. A site asking whether you are a robot reads as unknown, not broken.'))}</p>
                    <p>${esc(f('bmTourS4Body2',
                    'Under Expectations, in the side panel’s Health tab, name text the page must contain or the status codes that count as healthy. Those failures get their own Content filter.'))}</p>`,
            },
            // 5 — drift and certificates
            {
                title: f('bmTourS5Title', 'Pages that change behind your back'),
                visual: svg(`
                    ${row(16, 16, 200, 'Product page', { site: 'shop.example' })}
                    ${pill(226, 17, f('dashboard.healthDriftMoved', 'Moved'), { kind: 'warn', w: 76, motion: anim('bump', 0) })}
                    ${row(16, 50, 200, 'Blog post', { site: 'blog.example' })}
                    ${pill(226, 51, f('dashboard.healthDriftRetitled', 'Retitled'), { kind: 'warn', w: 76, motion: anim('bump', 0.3) })}
                    ${row(16, 84, 200, 'Docs', { site: 'docs.example' })}
                    ${pill(226, 85, f('dashboard.healthDriftChanged', 'Changed'), { kind: 'warn', w: 76, motion: anim('bump', 0.6) })}
                    ${ring(410, 66, 34, 0.23, '7', { kind: 'warn', sub: f('bmTourS5Days', 'days left') })}
                    ${label(410, 128, f('bmTourS5Cert', 'certificate · per host'), 'btv-label', 'middle')}
                `, f('bmTourS5Alt', 'Moved, Retitled and Changed badges, and a certificate countdown')),
                body: `<p>${esc(f('bmTourS5Body1',
                    'Drift compares a monitored page with the day you started watching it: Moved when it now lands elsewhere, Retitled when its title changes, Changed when the text becomes a different page. Tick Watch for redirects, retitling and rewrites under Expectations.'))}</p>
                    <p>${esc(f('bmTourS5Body2',
                    'Certificates are read from every HTTPS check, with nothing to switch on. Warnings go out at 30, 7 and 3 days, and the Certificates filter lists them.'))}</p>`,
            },
            // 6 — one bookmark's charts
            {
                title: f('bmTourS6Title', 'Every chart for one bookmark'),
                visual: svg(`
                    ${ring(50, 70, 34, 0.99, '99', { sub: f('dashboard.healthScoreTotal', 'Score') })}
                    ${Array.from({ length: 24 }, (_, i) => `<rect x="${108 + i * 15}" y="12" width="12" height="12" rx="2"
                        class="btv-cell${i === 15 ? ' is-bad' : ''} btv-anim btv-a-tick" style="opacity:${(0.45 + ((i * 7) % 10) / 18).toFixed(2)};animation-delay:${(i * 0.05).toFixed(2)}s"/>`).join('')}
                    ${label(470, 42, f('bmTourS6Hour', 'by hour'), 'btv-label', 'end')}
                    ${line('M108,118 L148,112 L188,114 L228,86 L268,96 L308,66 L348,78 L388,72 L428,76 L468,70', { delay: 0.2 })}
                    ${label(108, 140, f('bmTourS6Response', 'response time · 7 days'))}
                    ${pill(470 - pillWidth(f('bmLargeOpen', 'Open charts')), 124, f('bmLargeOpen', 'Open charts'), { kind: 'active' })}
                `, f('bmTourS6Alt', 'A score ring, an hourly heatmap and a response time line')),
                body: `<p>${esc(f('bmTourS6Body1',
                    'Open charts in the Health tab — or Shift+H on a row — shows one bookmark large: uptime, response time, status codes, outages and the score.'))}</p>
                    <p>${esc(f('bmTourS6Body2',
                    'The Checks tab adds a heatmap by hour, the certificate, and every single check — searchable, with Only failures, and its own Export CSV.'))}</p>`,
            },
            // 7 — Collection health
            {
                title: f('bmTourS7Title', 'Collection health'),
                visual: (() => {
                    const bars = [[f('bmTourS7Day', '24 hours'), 0.98], [f('bmTourS7Week', '7 days'), 0.99], [f('bmTourS7Month', '30 days'), 0.995]];
                    return svg(`
                        ${pillFlow(16, 10, 400, [[f('dashboard.healthTrendSeriesHealthy', 'Healthy %'), 'active'],
                            [f('dashboard.healthTrendSeriesScore', 'Score'), 'plain'],
                            [f('dashboard.healthTrendSeriesBroken', 'Broken'), 'plain'],
                            [f('dashboard.healthTrendSeriesDown', 'Monitors down'), 'plain']])}
                        ${line('M16,74 L80,72 L144,73 L208,62 L272,56 L336,52 L400,48 L466,46', { delay: 0 })}
                        ${bars.map(([l, v], i) => `
                            ${label(16, 104 + i * 16, l)}
                            <rect x="92" y="${96 + i * 16}" width="130" height="8" rx="2" class="btv-bar-track"/>
                            <rect x="92" y="${96 + i * 16}" width="${(130 * v).toFixed(1)}" height="8" rx="2"
                                class="btv-bar btv-anim btv-a-grow" style="animation-delay:${(i * 0.15).toFixed(2)}s"/>`).join('')}
                        ${label(250, 108, 'Nextcloud  180 → 420 ms', 'btv-title')}
                        ${label(250, 126, f('bmTourS7Outages', '4 outages in 30 days'))}
                        ${keycap(440, 118, 'h', anim('press'))}
                    `, f('bmTourS7Alt', 'The collection trend, uptime bars and the slowest bookmark'));
                })(),
                body: `<p>${esc(f('bmTourS7Body1',
                    'h opens the whole-collection picture: the score over time, what is wrong by kind, health per page, how much is checked at all, and certificates close to expiry.'))}</p>
                    <p>${esc(f('bmTourS7Body2',
                    'Monitors & trend adds a 90-day trend and fleet cards: uptime across every monitor, the least available, what got slower than last week, and outages. Every number is a filter.'))}</p>`,
            },
            // 8 — alerts
            {
                title: f('bmTourS8Title', 'Hear about it when it breaks'),
                visual: (() => {
                    const targets = ['Slack', 'ntfy', 'Pushover', f('bmTourS8Browser', 'Browser')];
                    return svg(`
                        ${row(16, 60, 150, 'Nextcloud', { dot: 'bad', kind: 'bad' })}
                        ${targets.map((name, i) => `
                            ${line(`M168,71 C200,71 200,${24 + i * 32} 228,${24 + i * 32}`, { delay: i * 0.2, arrow: true })}
                            ${pill(234, 14 + i * 32, name, { w: 76 })}`).join('')}
                        <g class="btv-anim btv-a-drop" style="animation-delay:1.1s">
                            <rect x="318" y="14" width="156" height="48" rx="8" class="btv-panel"/>
                            ${label(328, 34, f('bmTourS8Down', 'Nextcloud is down'), 'btv-title')}
                            ${label(328, 50, 'HTTP 503 · 3×')}
                        </g>
                        ${label(318, 88, f('bmTourS8Window', 'maintenance 03:00–03:10'))}
                        ${pill(318, 98, f('dashboard.healthNotifyMutedBadge', 'Muted'), { kind: 'dashed', w: 70 })}
                    `, f('bmTourS8Alt', 'A down bookmark sends alerts to Slack, ntfy, Pushover and the browser'));
                })(),
                body: `<p>${esc(f('bmTourS8Body1',
                    'Downtime alerts go to Slack, Discord, Telegram, Gotify, ntfy, Pushover or your own JSON receiver — and again when it comes back. Browser notifications reach your desktop or phone. Set them up under Behavior → Status & alerts.'))}</p>
                    <p>${esc(f('bmTourS8Body2',
                    'Maintenance windows keep a planned restart quiet, and a muted bookmark is still checked, only never announced.'))}</p>`,
            },
            // 9 — work through
            {
                title: f('bmTourS9Title', 'Clear the backlog'),
                visual: (() => {
                    const keys = [['p', f('bmTourKeyRecheck', 're-check')], ['d', f('bmTourKeyDelete', 'delete')],
                        ['z', f('bmTourKeySnooze', 'snooze')], ['j', f('bmTourKeySkip', 'skip')]];
                    return svg(`
                        <g class="btv-anim btv-a-swap">
                            <rect x="16" y="8" width="226" height="112" rx="10" class="btv-panel"/>
                            ${label(30, 36, 'Old wiki', 'btv-heading')}
                            ${label(30, 54, f('bmTourS9Failing', 'DNS · failing for 34 days'))}
                            <circle cx="220" cy="32" r="4" class="btv-dot is-bad"/>
                            ${pillFlow(30, 66, 200, [[f('bmTourKeyRecheck', 're-check'), 'plain'],
                                [f('bmTourKeyDelete', 'delete'), 'bad'], [f('bmTourKeySnooze', 'snooze'), 'plain']])}
                        </g>
                        ${keys.map(([k, l], i) => `${keycap(258, 12 + i * 28, k, i === 0 ? anim('press', 0.2) : NONE)}${label(286, 26 + i * 28, l)}`).join('')}
                        <rect x="366" y="18" width="104" height="92" rx="10" class="btv-panel"/>
                        ${label(378, 40, f('bmTourS9Ten', 'Ten links,'), 'btv-title')}
                        ${label(378, 56, f('bmTourS9Two', 'two minutes'), 'btv-title')}
                        ${pill(378, 76, f('dashboard.healthReviewNoticeStart', 'Start'), { kind: 'active', w: 62, motion: anim('bump', 0.4) })}
                        ${keycap(16, 124, 'f')}${label(42, 138, f('dashboard.healthFocus', 'Work through'))}
                    `, f('bmTourS9Alt', 'Work through shows one bookmark at a time with its actions'));
                })(),
                body: `<p>${esc(f('bmTourS9Body1',
                    'Work through (f) puts one bookmark in front of you, in the order the list is filtered, with the actions for it: re-check, open, delete, snooze, skip. When enough need attention, a card offers ten links in two minutes.'))}</p>
                    <p>${esc(f('bmTourS9Body2',
                    'The Rot report, in the Collection menu, says what happened to the collection: what vanished, moved or changed, what has failed for a month, and what broke this week.'))}</p>`,
            },
            // 10 — keys
            {
                title: f('bmTourS10Title', 'The keys, and where this tour lives'),
                visual: (() => {
                    const keys = [['/', f('bmTourKeySearch', 'search')], ['h', f('bmHealthModalTitle', 'Collection health')],
                        ['Shift+H', f('bmTourKeyCharts', 'charts for a row')], ['f', f('dashboard.healthFocus', 'Work through')],
                        ['x', f('bmTourKeySelect', 'tick rows')], ['Shift+R', f('bmTourKeyRefresh', 'refresh the report')]];
                    return svg(`
                        ${keys.map(([k, l], i) => {
                            const x = 16 + (i % 2) * 232;
                            const y = 14 + Math.floor(i / 2) * 34;
                            return `${keycap(x, y, k)}${label(x + keyWidth(k) + 8, y + 14, l)}`;
                        }).join('')}
                        ${pill(382, 118, t('dashboard.inboxTour', 'Tour'), { kind: 'active', w: 88, motion: anim('bump', 0.3) })}
                    `, f('bmTourS10Alt', 'The keys of the Bookmarks view'));
                })(),
                body: `<p>${esc(f('bmTourS10Body1',
                    'x ticks rows, and the side panel then acts on all of them: re-check, mute or unmute alerts, follow redirects, accept drift, save copies, delete. The legend under the list has the rest.'))}</p>
                    <p class="bookmarks-tutorial-closing">${esc(f('bmTourS10Closing',
                    'Tour, next to the ℹ above the list, brings this back whenever you want it.'))}</p>`,
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
            <div class="bookmarks-tutorial">
                <div class="bookmarks-tutorial-progress">${esc(progress)}</div>
                <div class="bookmarks-tutorial-scene is-${state.direction}">${step.visual}</div>
                <h3 class="bookmarks-tutorial-step-title">${esc(step.title)}</h3>
                <div class="bookmarks-tutorial-step-body">${step.body}</div>
                <div class="bookmarks-tutorial-dots" aria-hidden="true">
                    ${all.map((_, i) => `<span class="bookmarks-tutorial-dot${i === state.index ? ' is-active' : ''}"></span>`).join('')}
                </div>
            </div>`;

        if (!global.AppModal?.show) return;
        global.AppModal.show({
            title: t('bmTourTitle', 'How the Bookmarks view works'),
            htmlMessage: html,
            confirmText: isLast ? t('dashboard.inboxTutorialDone', 'Got it') : t('dashboard.inboxTutorialNext', 'Next'),
            cancelText: isFirst ? t('dashboard.inboxTutorialSkip', 'Skip') : t('dashboard.inboxTutorialBack', 'Back'),
            showCancel: true,
            modalClass: 'bookmarks-tutorial-modal',
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
        global.nextdashTrack?.('bookmarks-tutorial:finished', { outcome, step: state.index + 1 });
    }

    /** Called by the Bookmarks view once its list has drawn; same guards as the inbox tour. */
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
        global.nextdashTrack?.('bookmarks-tutorial:shown');
        return true;
    }

    /** The Tour button: open it on request, seen or not. */
    function open() {
        const d = global.dashboardInstance;
        if (!global.AppModal?.show) return false;
        if (typeof d?.isModalOpen === 'function' && d.isModalOpen()) return false;
        state = { index: 0, direction: 'forward' };
        finished = false;
        render();
        global.nextdashTrack?.('bookmarks-tutorial:opened');
        return true;
    }

    global.BookmarksTutorial = { TIP_ID, maybeShow, open };
}(typeof window !== 'undefined' ? window : globalThis));
