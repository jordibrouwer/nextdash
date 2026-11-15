/*
 * Holiday themes: the decoration drawn over and under the page.
 *
 * The six Holidays pairs (holiday-christmas, holiday-northern-lights,
 * holiday-gingerbread, holiday-snow-globe, holiday-paper-advent and
 * holiday-nutcracker) are ordinary themes as far as colours and materials
 * go. What makes them seasonal is drawn here: a back layer between the
 * backdrop and the cards (the tree, the forest, the village, the globe, the
 * stage) and a front layer for what falls (snow, sprinkles, glitter). Both
 * ignore the pointer; three of them read it from the window (the parallax,
 * the spotlight) through a small runtime that stops when the theme goes.
 *
 * The layers follow html[data-theme], so switching theme in the studio or with
 * :theme adds or removes them without a reload. Motion stops under
 * prefers-reduced-motion and with Effects off; that is CSS, in
 * theme-holidays.css.
 */
(function () {
    'use strict';

    const PREFIX = 'holiday-';
    const KINDS = ['christmas', 'northern-lights', 'gingerbread', 'snow-globe', 'paper-advent', 'nutcracker'];
    let current = '';
    let stopRuntime = null;

    // Motion is off under reduced motion and with Effects off; the runtimes
    // (the settling snow, the parallax, the spotlight) then do not start.
    function still() {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        return reduce || document.documentElement.getAttribute('data-effects') === 'off'
            || document.body?.getAttribute('data-effects') === 'off';
    }

    function kindOf(themeId) {
        const id = String(themeId || '');
        if (!id.startsWith(PREFIX)) return '';
        const family = id.slice(PREFIX.length).replace(/-(dark|light)$/, '');
        return KINDS.includes(family) ? family : '';
    }

    // A small seeded random, so the snow lands in the same places on every
    // load instead of jumping when the theme is re-applied.
    function seeded(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function flakes(count, cls, rand, extra) {
        let out = '';
        for (let i = 0; i < count; i++) {
            const dur = 9 + rand() * 13;
            const size = 2 + rand() * 4;
            const style = [
                `left:${(rand() * 100).toFixed(2)}%`,
                `animation-duration:${dur.toFixed(1)}s`,
                `animation-delay:-${(rand() * dur).toFixed(1)}s`,
                `--hl-drift:${Math.round(rand() * 60 - 30)}px`,
                `--hl-size:${size.toFixed(1)}px`,
                `--hl-opacity:${(0.45 + rand() * 0.55).toFixed(2)}`,
                extra ? extra(i, rand) : '',
            ].filter(Boolean).join(';');
            out += `<span class="${cls}" style="${style}"></span>`;
        }
        return out;
    }

    function stars(count, rand) {
        let out = '';
        for (let i = 0; i < count; i++) {
            out += `<i style="left:${(rand() * 100).toFixed(2)}%;top:${(rand() * 50).toFixed(2)}%;animation-delay:${(rand() * 3).toFixed(2)}s;opacity:${(0.3 + rand() * 0.7).toFixed(2)}"></i>`;
        }
        return `<div class="hl-stars">${out}</div>`;
    }

    /* ── Christmas Classic ─────────────────────────────────────────── */

    /*
     * The tree: four drooping tiers shaded from the lit side, snow on the
     * branch tips, strings of lights wound round it, baubles, a star with
     * slowly turning rays, a skirt and presents underneath.
     */
    function tier(cx, top, bottom, half, scallops) {
        const left = cx - half;
        const step = (half * 2) / scallops;
        let d = `M${cx} ${top} Q${cx - half * 0.45} ${(top + bottom) / 2} ${left} ${bottom}`;
        let snow = '';
        for (let i = 0; i < scallops; i++) {
            const x0 = left + i * step;
            const x1 = x0 + step;
            d += ` Q${(x0 + x1) / 2} ${bottom + 9} ${x1} ${bottom}`;
            if (i % 2 === 0 || i === scallops - 1) {
                snow += `<path class="hl-tree-snow" d="M${x0 + step * 0.12} ${bottom + 1.5} Q${(x0 + x1) / 2} ${bottom + 9.5} ${x1 - step * 0.12} ${bottom + 1.5} Q${(x0 + x1) / 2} ${bottom + 4.5} ${x0 + step * 0.12} ${bottom + 1.5}z"/>`;
            }
        }
        d += ` Q${cx + half * 0.45} ${(top + bottom) / 2} ${cx} ${top}Z`;
        const shade = `M${cx} ${top} Q${cx + half * 0.45} ${(top + bottom) / 2} ${cx + half} ${bottom} L${cx + half * 0.15} ${bottom + 4} Z`;
        return `<path class="hl-tier" d="${d}"/><path class="hl-tier-shade" d="${shade}"/>${snow}`;
    }

    function lightString(cx, y, half, sag, count, offset) {
        let out = `<path class="hl-tree-wire" d="M${cx - half} ${y} Q${cx} ${y + sag * 2} ${cx + half} ${y - 4}"/>`;
        const kinds = ['a', 'b', 'c', 'd', 'e'];
        for (let i = 1; i < count; i++) {
            const t = i / count;
            const x = (1 - t) * (1 - t) * (cx - half) + 2 * (1 - t) * t * cx + t * t * (cx + half);
            const yy = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * (y + sag * 2) + t * t * (y - 4);
            const k = kinds[(i + offset) % 5];
            const delay = (((i + offset) * 0.31) % 2.4).toFixed(2);
            out += `<circle class="hl-tree-halo hl-bulb--${k}" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="4.5" style="animation-delay:${delay}s"/>`;
            out += `<circle class="hl-bulb hl-bulb--${k}" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="2.2" style="animation-delay:${delay}s"/>`;
        }
        return out;
    }

    function bauble(x, y, r, kind) {
        return `<g class="hl-bauble"><line x1="${x}" y1="${y - r - 3}" x2="${x}" y2="${y - r}" class="hl-bauble-hook"/>
            <circle cx="${x}" cy="${y}" r="${r}" fill="url(#hl-bauble-${kind})"/>
            <rect x="${x - r * 0.35}" y="${y - r - 1.5}" width="${r * 0.7}" height="2.5" rx="0.8" class="hl-bauble-cap"/></g>`;
    }

    function present(x, w, h, kind) {
        const y = 330 - h;
        return `<g class="hl-present hl-present--${kind}">
            <rect class="hl-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/>
            <rect class="hl-box-shade" x="${x + w * 0.62}" y="${y}" width="${w * 0.38}" height="${h}" rx="2"/>
            <rect class="hl-box-lid" x="${x - 2}" y="${y}" width="${w + 4}" height="${Math.min(7, h * 0.28)}" rx="1.5"/>
            <rect class="hl-ribbon" x="${x + w / 2 - 2.5}" y="${y}" width="5" height="${h}"/>
            <path class="hl-bow" d="M${x + w / 2} ${y} c-8 -9 -15 -3 -9 1 c3 2 6 1 9 -1 c3 2 6 3 9 1 c6 -4 -1 -10 -9 -1z"/>
        </g>`;
    }

    function tree() {
        const cx = 120;
        const tiers = tier(cx, 150, 288, 112, 7) + tier(cx, 108, 228, 92, 6) + tier(cx, 70, 168, 72, 5) + tier(cx, 36, 110, 52, 4);
        const lights = lightString(cx, 92, 34, 7, 6, 0) + lightString(cx, 146, 52, 9, 8, 2)
            + lightString(cx, 204, 70, 10, 10, 4) + lightString(cx, 262, 88, 11, 12, 1);
        const baubles = [[100, 128, 6, 'red'], [146, 120, 5.5, 'gold'], [82, 186, 6.5, 'silver'], [132, 194, 7, 'red'],
            [168, 178, 6, 'gold'], [64, 246, 7, 'gold'], [112, 240, 7.5, 'silver'], [156, 250, 7, 'red'], [190, 268, 6, 'silver'],
            [40, 276, 6, 'red'], [120, 168, 5, 'gold']].map(([x, y, r, k]) => bauble(x, y, r, k)).join('');
        let rays = '';
        for (let i = 0; i < 12; i++) rays += `<path d="M0 0 L${i % 2 ? 2.2 : 3.2} -${i % 2 ? 26 : 38} L-${i % 2 ? 2.2 : 3.2} -${i % 2 ? 26 : 38}Z" transform="rotate(${i * 30})"/>`;
        return `<svg class="hl-tree" viewBox="0 0 240 340" aria-hidden="true">
            <defs>
                <linearGradient id="hl-tier-fill" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="hl-stop-tree-lit"/><stop offset="1" class="hl-stop-tree-dark"/></linearGradient>
                <radialGradient id="hl-bauble-red" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#ff9a9a"/><stop offset="0.45" stop-color="#d4142e"/><stop offset="1" stop-color="#6e0715"/></radialGradient>
                <radialGradient id="hl-bauble-gold" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#fff2b8"/><stop offset="0.45" stop-color="#e3b33e"/><stop offset="1" stop-color="#7d5a10"/></radialGradient>
                <radialGradient id="hl-bauble-silver" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#a9c4dc"/><stop offset="1" stop-color="#3f5b78"/></radialGradient>
                <radialGradient id="hl-star-fill" cx="0.5" cy="0.4" r="0.6"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.5" stop-color="#ffd75e"/><stop offset="1" stop-color="#d79a1a"/></radialGradient>
            </defs>
            <ellipse class="hl-tree-glow" cx="${cx}" cy="200" rx="120" ry="140"/>
            <rect class="hl-trunk" x="${cx - 13}" y="284" width="26" height="34" rx="3"/>
            <ellipse class="hl-skirt" cx="${cx}" cy="318" rx="74" ry="11"/>
            <ellipse class="hl-skirt-trim" cx="${cx}" cy="321" rx="74" ry="9"/>
            ${tiers}
            ${baubles}
            ${lights}
            <g transform="translate(${cx} 30)"><g class="hl-star-rays">${rays}</g></g>
            <polygon class="hl-topstar" fill="url(#hl-star-fill)" points="120,8 126.5,24 143,24.5 130,34.5 134.5,51 120,41.5 105.5,51 110,34.5 97,24.5 113.5,24"/>
            ${present(28, 42, 30, 'a')}${present(170, 46, 24, 'b')}${present(76, 28, 18, 'c')}${present(142, 26, 34, 'd')}
        </svg>`;
    }

    /*
     * The ground: a row of snowed-in pines far back, a picket fence buried to
     * the rails with a robin on it, a street lamp, and two drifts that catch
     * the light in glints.
     */
    function scene(rand) {
        let pines = '';
        for (let i = 0; i < 26; i++) {
            const x = 20 + i * 56 + (i % 3) * 9;
            const h = 34 + ((i * 37) % 30);
            pines += `<path class="hl-far-pine" d="M${x} ${168 - h} L${x - h * 0.32} 168 L${x + h * 0.32} 168Z"/><path class="hl-far-pine-snow" d="M${x} ${168 - h} L${x - h * 0.12} ${168 - h * 0.62} Q${x} ${168 - h * 0.7} ${x + h * 0.12} ${168 - h * 0.62}Z"/>`;
        }
        let fence = '';
        for (let i = 0; i < 9; i++) {
            const x = 150 + i * 22;
            fence += `<path class="hl-picket" d="M${x} 196 V158 l6 -7 l6 7 V196Z"/><path class="hl-picket-snow" d="M${x - 1} 158 l7 -8 l7 8 q-7 -3 -14 0z"/>`;
        }
        fence += '<rect class="hl-rail" x="146" y="166" width="202" height="6" rx="2"/><rect class="hl-rail" x="146" y="182" width="202" height="6" rx="2"/><path class="hl-picket-snow" d="M146 166 q100 -5 202 0 v2 h-202z"/>';
        const robin = `<g class="hl-robin" transform="translate(296 152)">
            <ellipse class="hl-robin-body" cx="0" cy="0" rx="8" ry="6.5"/>
            <path class="hl-robin-breast" d="M2 -3 q7 1 5 7 q-4 2 -8 -1z"/>
            <path class="hl-robin-tail" d="M-7 -1 l-7 -5 l1 6z"/>
            <g class="hl-robin-head"><circle class="hl-robin-body" cx="6" cy="-6" r="4.5"/><circle class="hl-robin-eye" cx="7.5" cy="-7" r="0.9"/><path class="hl-robin-beak" d="M10 -6.5 l4 1 l-4 1z"/></g>
            <path class="hl-robin-leg" d="M-1 6 v4 M2 6 v4"/>
        </g>`;
        const lamp = `<g class="hl-lamp" transform="translate(410 0)">
            <circle class="hl-lamp-glow" cx="0" cy="92" r="46"/>
            <rect class="hl-lamp-post" x="-3" y="100" width="6" height="104"/>
            <rect class="hl-lamp-post" x="-8" y="196" width="16" height="8" rx="2"/>
            <path class="hl-lamp-post" d="M-11 82 h22 l-4 -10 h-14z"/>
            <rect class="hl-lamp-light" x="-8" y="82" width="16" height="16" rx="1"/>
            <path class="hl-lamp-post" d="M-12 98 h24 v4 h-24z"/>
            <path class="hl-picket-snow" d="M-13 72 q13 -7 26 0 l-2 3 q-11 -4 -22 0z"/>
            <circle class="hl-lamp-wreath" cx="0" cy="136" r="7"/>
            <path class="hl-bow" d="M0 129 c-5 -5 -9 -1 -5 1 c2 1 3 0 5 -1 c2 1 3 2 5 1 c4 -2 0 -6 -5 -1z"/>
        </g>`;
        let glints = '';
        for (let i = 0; i < 22; i++) {
            const x = Math.round(rand() * 1440);
            const y = Math.round(200 + rand() * 18);
            glints += `<path class="hl-glint" style="animation-delay:-${(rand() * 4).toFixed(2)}s" d="M${x} ${y - 4} L${x + 1} ${y - 1} L${x + 4} ${y} L${x + 1} ${y + 1} L${x} ${y + 4} L${x - 1} ${y + 1} L${x - 4} ${y} L${x - 1} ${y - 1}Z"/>`;
        }
        return `<svg class="hl-scene" viewBox="0 0 1440 230" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
            <defs>
                <linearGradient id="hl-drift-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hl-stop-snow-top"/><stop offset="1" class="hl-stop-snow-low"/></linearGradient>
            </defs>
            ${pines}
            <path class="hl-drift-back" d="M0 168 Q120 150 260 166 T560 160 T880 170 T1180 156 T1440 164 V230 H0Z"/>
            ${fence}${robin}${lamp}
            <path class="hl-drift-mid" d="M0 196 Q200 176 420 194 T840 188 T1220 196 T1440 186 V230 H0Z" fill="url(#hl-drift-fill)"/>
            <path class="hl-drift-front" d="M0 214 Q260 198 520 212 T1040 208 T1440 210 V230 H0Z" fill="url(#hl-drift-fill)"/>
            ${glints}
        </svg>`;
    }

    function shootingStar() {
        return '<i class="hl-shoot"></i>';
    }

    function snowman() {
        return `<svg class="hl-snowman" viewBox="0 0 96 124" aria-hidden="true">
            <path class="hl-stick" d="M31 60 L9 46 M15 50 l-5 -8 M15 50 l-8 1"/>
            <path class="hl-stick hl-wave" d="M61 58 L84 42 M78 46 l2 -9 M78 46 l8 2"/>
            <circle class="hl-ball" cx="46" cy="98" r="24"/>
            <circle class="hl-ball" cx="46" cy="60" r="17"/>
            <circle class="hl-ball" cx="46" cy="32" r="13"/>
            <circle class="hl-coal" cx="42" cy="29" r="1.7"/><circle class="hl-coal" cx="50" cy="29" r="1.7"/>
            <path class="hl-carrot" d="M46 33 l11 2.5 l-11 2.2z"/>
            <circle class="hl-coal" cx="41" cy="38" r="0.9"/><circle class="hl-coal" cx="44" cy="40" r="0.9"/><circle class="hl-coal" cx="48" cy="40" r="0.9"/><circle class="hl-coal" cx="51" cy="38" r="0.9"/>
            <circle class="hl-coal" cx="46" cy="55" r="2"/><circle class="hl-coal" cx="46" cy="63" r="2"/><circle class="hl-coal" cx="46" cy="71" r="2"/>
            <rect class="hl-scarf" x="33" y="42" width="26" height="6" rx="3"/>
            <path class="hl-scarf" d="M51 46 l5 15 l-7 1 l-3 -15z"/>
            <path class="hl-scarf-stripe" d="M52 52 l5 -1 M54 57 l5 -1"/>
            <rect class="hl-hat" x="35" y="4" width="22" height="15" rx="2"/>
            <rect class="hl-hatband" x="35" y="13" width="22" height="3.5"/>
            <rect class="hl-hat" x="29" y="18" width="34" height="4" rx="2"/>
        </svg>`;
    }

    function crystals(count, rand) {
        const arm = [0, 60, 120].map((a) => `<path d="M0 -10 V10 M0 -6 l-3 -3 M0 -6 l3 -3 M0 6 l-3 3 M0 6 l3 3" transform="rotate(${a})"/>`).join('');
        const svg = `<svg viewBox="-12 -12 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">${arm}</g><circle r="1.6" fill="currentColor"/></svg>`;
        let out = '';
        for (let i = 0; i < count; i++) {
            const dur = 16 + rand() * 14;
            out += `<span class="hl-crystal" style="left:${(rand() * 100).toFixed(2)}%;animation-duration:${dur.toFixed(1)}s;animation-delay:-${(rand() * dur).toFixed(1)}s;--hl-drift:${Math.round(rand() * 80 - 40)}px;--hl-size:${(12 + rand() * 12).toFixed(0)}px;--hl-opacity:${(0.55 + rand() * 0.4).toFixed(2)}">${svg}</span>`;
        }
        return out;
    }

    function garland() {
        const kinds = ['a', 'b', 'c', 'd', 'e'];
        let bulbs = '';
        for (let i = 0; i < 24; i++) {
            const x = 25 + i * 50;
            bulbs += `<ellipse class="hl-bulb hl-bulb--${kinds[i % 5]}" cx="${x}" cy="15" rx="4" ry="6" style="animation-delay:${((i * 0.23) % 1.6).toFixed(2)}s"/>`;
        }
        let wire = 'M0 4';
        for (let i = 0; i < 12; i++) wire += ` Q${i * 100 + 50} 18 ${i * 100 + 100} 4`;
        return `<svg class="hl-garland" viewBox="0 0 1200 26" preserveAspectRatio="none" aria-hidden="true"><path class="hl-wire" d="${wire}"/>${bulbs}</svg>`;
    }

    /* ── Northern Lights ───────────────────────────────────────────── */

    function aurora() {
        return `<div class="hl-aurora"><i class="hl-aurora-1"></i><i class="hl-aurora-2"></i><i class="hl-aurora-3"></i></div>`;
    }

    function forest() {
        let rows = '';
        for (let row = 0; row < 3; row++) {
            const n = 16 + row * 6;
            const height = 230 - row * 35;
            let trees = '';
            for (let i = 0; i <= n; i++) {
                const x = (i / n) * 1440 + (row * 37) % 60;
                const h = height * (0.55 + ((i * 7919 + row * 31) % 100) / 220);
                trees += `<polygon points="${x.toFixed(1)},${(300 - h).toFixed(1)} ${(x - h * 0.28).toFixed(1)},300 ${(x + h * 0.28).toFixed(1)},300"/>`;
            }
            rows += `<g class="hl-forest-${row + 1}">${trees}</g>`;
        }
        return `<svg class="hl-forest" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${rows}<rect class="hl-forest-3" y="286" width="1440" height="14"/></svg>`;
    }

    /*
     * The sleigh: two pairs of reindeer in harness, the lead one with a
     * glowing nose, pulling Santa and his sack. The legs gallop, every deer
     * rises and falls on its own beat, the team floats as a whole, and a trail
     * of stardust peels off behind the runners. The flight path itself is the
     * wrapper's animation in theme-holidays.css.
     */
    function reindeer(x, y, i, opts) {
        const far = opts.far ? ' hl-deer--far' : '';
        const beat = (i * 0.13).toFixed(2);
        const leg = (hx, cls) => `<g transform="translate(${hx} 40)"><path class="hl-leg ${cls}" style="animation-delay:-${beat}s" d="M0 0 C1 7 2 12 1 16 L-1 26 L2.5 28"/></g>`;
        return `<g class="hl-deer${far}" transform="translate(${x} ${y}) scale(0.8)">
            <g class="hl-deer-bob" style="animation-delay:-${beat}s">
                ${leg(26, 'hl-leg--back hl-leg--off')}${leg(64, 'hl-leg--front hl-leg--off')}
                <path class="hl-deer-tail" d="M15 31 C10 28 8 24 10 20 C13 23 15 27 18 29 Z"/>
                <path class="hl-deer-body" d="M14 32 C15 24 26 22 38 23 L56 23 C62 23 65 25 66 27 C68 18 72 11 77 7 L83 11 C79 17 76 25 74 33 C74 40 69 44 61 45 C50 46 34 46 24 44 C16 43 13 38 14 32 Z"/>
                <path class="hl-deer-body" d="M74 5 C78 0 86 0 90 3 C94 6 97 9 95 11 C91 13 86 11 82 12 C78 13 75 10 74 5 Z"/>
                <path class="hl-deer-body" d="M77 4 L70 -1 L75 7 Z"/>
                <path class="hl-antler" d="M78 1 C74 -8 74 -16 78 -24 M75 -10 C70 -12 67 -16 66 -21 M76 -17 C72 -20 71 -24 72 -28 M78 -24 C81 -27 85 -28 88 -27 M82 1 C83 -8 87 -14 93 -18 M85 -9 C89 -10 92 -13 93 -16 M89 -15 C91 -19 95 -20 98 -18"/>
                <path class="hl-deer-mane" d="M70 30 C73 34 74 38 72 42"/>
                ${leg(20, 'hl-leg--back')}${leg(58, 'hl-leg--front')}
                <path class="hl-collar" d="M68 22 C73 29 73 37 69 44"/>
                <path class="hl-girth" d="M42 23 L42 46"/>
                <circle class="hl-bell" cx="72" cy="31" r="2"/><circle class="hl-bell" cx="72" cy="38" r="2"/>
                ${opts.nose ? '<circle class="hl-nose-glow" cx="95" cy="9" r="7"/><circle class="hl-nose" cx="95.5" cy="9" r="2.8"/>' : ''}
            </g>
        </g>`;
    }

    function sleigh() {
        // Two pairs: the far deer of each pair a little up and back, dimmer,
        // drawn first so the near one overlaps it.
        const team = [[262, 27, true, false], [166, 27, true, false], [246, 38, false, true], [150, 38, false, false]];
        const deer = team.map(([x, y, far, nose], i) => reindeer(x, y, i, { far, nose })).join('');
        // One trace from the sleigh's front through the pairs, and two reins
        // from Santa's hands, sagging a little.
        const traces = '<path class="hl-trace" d="M118 74 Q140 76 161 66 M211 66 Q232 70 257 66"/>';
        const reins = '<path class="hl-rein" d="M75 51 Q140 72 206 62 M75 51 Q190 78 301 62"/>';
        let dust = '';
        for (let i = 0; i < 14; i++) {
            dust += `<circle class="hl-dust" cx="${4 - (i % 4) * 3}" cy="${88 + (i % 3) * 4}" r="${(1 + (i % 3) * 0.6).toFixed(1)}" style="animation-delay:-${(i * 0.12).toFixed(2)}s"/>`;
        }
        return `<div class="hl-sleigh"><svg viewBox="-110 -40 470 160" aria-hidden="true">
            <g class="hl-team-bob">
                ${dust}
                ${traces}
                ${deer}
                ${reins}
                <path class="hl-sack" d="M10 52 q-8 -20 8 -28 q14 -4 18 10 q3 14 -8 20z"/>
                <path class="hl-sack-tie" d="M16 26 q4 -5 9 -2"/>
                <path class="hl-santa" d="M44 66 q-2 -24 12 -26 q14 0 13 26z"/>
                <path class="hl-santa-trim" d="M45 58 h23"/>
                <circle class="hl-santa-face" cx="58" cy="34" r="6"/>
                <path class="hl-santa-beard" d="M52 35 q6 13 12 0 q-6 3 -12 0z"/>
                <path class="hl-santa" d="M51 31 q3 -14 15 -11 l8 8 q-7 -3 -10 2z"/>
                <path class="hl-santa-trim" d="M51 31 q7 -3 13 1"/>
                <circle class="hl-pom" cx="75" cy="29" r="2.6"/>
                <path class="hl-santa" d="M62 48 l12 2 l1 4 l-13 -1z"/>
                <path class="hl-sleigh-body" d="M2 88 q-12 -34 2 -50 q7 -7 13 -1 q-6 14 0 25 h72 q13 0 20 -12 q5 -6 11 -2 q-1 26 -24 40z"/>
                <path class="hl-sleigh-trim" d="M14 80 h82 q8 0 12 -6"/>
                <path class="hl-sleigh-trim" d="M6 44 q2 -6 6 -5"/>
                <path class="hl-runner" d="M26 88 v8 M84 88 v8 M-6 96 h106 q18 0 20 -13 q1 -9 -7 -9 q-5 0 -5 5"/>
            </g>
        </svg></div>`;
    }

    /* ── Gingerbread Village ───────────────────────────────────────── */

    function house(x, w, h, i) {
        const top = 300 - h;
        const smoke = i % 2 === 0
            ? `<rect class="hl-house-body" x="${x + w * 0.7}" y="${top - w * 0.45}" width="14" height="30"/>
               <g class="hl-smoke">${[0, 1, 2].map((k) => `<circle cx="${x + w * 0.7 + 7}" cy="${top - w * 0.45 - 6}" r="7" style="animation-delay:${(k * 1.6 + i * 0.5).toFixed(1)}s"/>`).join('')}</g>`
            : '';
        return `<g>
            ${smoke}
            <rect class="hl-house-body" x="${x}" y="${top}" width="${w}" height="${h}" rx="4"/>
            <path class="hl-house-roof" d="M${x - 10} ${top + 4} L${x + w / 2} ${top - w * 0.55} L${x + w + 10} ${top + 4}z"/>
            <path class="hl-roof-tiles" d="M${x + w * 0.1} ${top - w * 0.1} L${x + w * 0.9} ${top - w * 0.1} M${x + w * 0.25} ${top - w * 0.3} L${x + w * 0.75} ${top - w * 0.3}"/>
            <path class="hl-roof-snow" d="M${x + w / 2 - w * 0.2} ${top - w * 0.42} L${x + w / 2} ${top - w * 0.55} L${x + w / 2 + w * 0.2} ${top - w * 0.42} Q${x + w / 2 + w * 0.1} ${top - w * 0.36} ${x + w / 2} ${top - w * 0.4} Q${x + w / 2 - w * 0.1} ${top - w * 0.36} ${x + w / 2 - w * 0.2} ${top - w * 0.42}Z"/>
            <path class="hl-icing" d="M${x - 10} ${top + 4} Q${x + w * 0.1} ${top + 14} ${x + w * 0.22} ${top + 2} Q${x + w * 0.35} ${top + 16} ${x + w / 2} ${top - w * 0.1} Q${x + w * 0.65} ${top + 16} ${x + w * 0.78} ${top + 2} Q${x + w * 0.9} ${top + 14} ${x + w + 10} ${top + 4}"/>
            <rect class="hl-window" x="${x + w * 0.18}" y="${300 - h * 0.75}" width="${w * 0.22}" height="${w * 0.22}" rx="3" style="animation-delay:${(i * 0.9).toFixed(1)}s"/>
            <rect class="hl-window" x="${x + w * 0.6}" y="${300 - h * 0.75}" width="${w * 0.22}" height="${w * 0.22}" rx="3" style="animation-delay:${(i * 0.9 + 0.4).toFixed(1)}s"/>
            <path class="hl-door" d="M${x + w * 0.4} 300 v-${h * 0.38} a${w * 0.1} ${w * 0.1} 0 0 1 ${w * 0.2} 0 v${h * 0.38}z"/>
            <circle class="hl-gum-a" cx="${x + w * 0.25}" cy="${300 - h * 0.2}" r="5"/>
            <circle class="hl-gum-b" cx="${x + w * 0.75}" cy="${300 - h * 0.2}" r="5"/>
        </g>`;
    }

    function walker() {
        return `<svg class="hl-walker" viewBox="-32 -40 64 80" aria-hidden="true"><g class="hl-gb-step">
            <path class="hl-gb-dough hl-gb-leg-l" d="M-9 4 L-15 30 Q-15 36 -9 35 L-1 12Z"/>
            <path class="hl-gb-dough hl-gb-leg-r" d="M9 4 L15 30 Q15 36 9 35 L1 12Z"/>
            <path class="hl-gb-dough hl-gb-arm-l" d="M-9 -10 L-26 -5 Q-31 0 -25 4 L-9 2Z"/>
            <path class="hl-gb-dough hl-gb-arm-r" d="M9 -10 L26 -5 Q31 0 25 4 L9 2Z"/>
            <path class="hl-gb-dough" d="M-11 -12 Q0 -16 11 -12 L11 14 Q0 18 -11 14Z"/>
            <circle class="hl-gb-dough" cy="-22" r="12"/>
            <circle class="hl-gb-eye" cx="-4" cy="-25" r="1.8"/><circle class="hl-gb-eye" cx="4" cy="-25" r="1.8"/>
            <path class="hl-gb-icing" d="M-5 -18 Q0 -14 5 -18 M-22 -3 l3 3 3 -3 M16 -3 l3 3 3 -3"/>
            <circle class="hl-gb-button-a" cy="-4" r="2.4"/><circle class="hl-gb-button-b" cy="4" r="2.4"/>
        </g></svg>`;
    }

    function village() {
        const houses = [[40, 130, 120], [230, 110, 150], [400, 150, 110], [620, 96, 92], [800, 110, 104], [1000, 120, 140], [1170, 140, 115], [1330, 100, 100]];
        const canes = [190, 365, 580, 760, 955, 1135, 1300].map((x, i) => {
            const d = `M${x} 296 V${250 - (i % 2) * 14} a9 9 0 0 1 18 0`;
            return `<path class="hl-cane-white" d="${d}"/><path class="hl-cane-red" d="${d}"/>`;
        }).join('');
        const gumColours = ['#ff4f7b', '#2fb36c', '#ffcf33', '#7ad3ff', '#b57bff'];
        let gums = '';
        for (let i = 0; i < 30; i++) {
            const x = 20 + i * 48 + (i % 3) * 7;
            gums += `<path class="hl-gumdrop" fill="${gumColours[i % 5]}" d="M${x - 7} 294 Q${x - 7} 282 ${x} 282 Q${x + 7} 282 ${x + 7} 294Z"/>`;
        }
        return `<svg class="hl-village" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
            ${houses.map(([x, w, h], i) => house(x, w, h, i)).join('')}
            ${canes}${gums}
            <path class="hl-ground" d="M0 290 Q200 270 420 288 T860 284 T1440 286 V300 H0z"/>
        </svg>`;
    }

    function stringLights() {
        const kinds = ['a', 'b', 'c', 'd', 'e'];
        let wire = 'M0 6';
        for (let i = 0; i < 12; i++) wire += ` Q${i * 120 + 60} 46 ${i * 120 + 120} 6`;
        let bulbs = '';
        for (let i = 0; i < 24; i++) {
            const x = i * 60 + 30;
            const t = (x % 120) / 120;
            const y = 6 + 40 * 2 * t * (1 - t) + 10;
            bulbs += `<circle class="hl-bulb hl-bulb--${kinds[i % 5]}" cx="${x}" cy="${y.toFixed(1)}" r="6" style="animation-delay:${((i * 0.17) % 1.4).toFixed(2)}s"/>`;
        }
        return `<svg class="hl-lights" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true"><path class="hl-wire" d="${wire}"/>${bulbs}</svg>`;
    }

    /* ── Snow Globe ────────────────────────────────────────────────── */

    /*
     * The page sits inside a glass globe: the glass darkens and curves at the
     * edges with a highlight across the top, a small town stands on the
     * bottom, and a wooden base with a brass plate closes it off. The snow is
     * a canvas in the front layer (globeSnow) rather than CSS, because it
     * lands: a flake that reaches the top edge of a category stops and adds
     * to the cap on that category. Switching page shakes the globe, which
     * throws the caps back into the air.
     */
    /*
     * The town inside the globe: timber houses with snow on the roofs and
     * candle-lit windows, a church with a glowing star, smoke curling from
     * the chimneys, a string of lights between the houses, a lamp post, firs,
     * and a frozen pond with two skaters going round.
     */
    function globeTown() {
        const kinds = ['a', 'b', 'c', 'd', 'e'];
        let smokeN = 0;
        const smoke = (x, y) => `<g class="hl-gt-smoke">${[0, 1, 2].map((k) => `<circle cx="${x}" cy="${y}" r="${3 + k}" style="animation-delay:${(k * 1.4 + (smokeN++) * 0.7).toFixed(1)}s"/>`).join('')}</g>`;
        const house = (x, w, h, roof, chimney) => {
            const top = 120 - h;
            const cx = x + w * 0.72;
            const ch = chimney ? `<rect class="hl-gt-wall" x="${cx}" y="${top - roof * 0.62}" width="7" height="${roof * 0.5}"/>
                <rect class="hl-gt-snow" x="${cx - 1}" y="${top - roof * 0.62 - 2}" width="9" height="3" rx="1.5"/>${smoke(cx + 3.5, top - roof * 0.62 - 4)}` : '';
            return `${ch}<path class="hl-gt-wall" d="M${x} 120 V${top} H${x + w} V120Z"/>
                <path class="hl-gt-beam" d="M${x} ${top + h * 0.5} H${x + w} M${x + w * 0.5} ${top} V120"/>
                <path class="hl-gt-roof" d="M${x - 4} ${top + 2} L${x + w / 2} ${top - roof} L${x + w + 4} ${top + 2}Z"/>
                <path class="hl-gt-snow" d="M${x - 5} ${top + 2} L${x + w / 2} ${top - roof - 1.5} L${x + w + 5} ${top + 2} Q${x + w * 0.85} ${top + 5} ${x + w * 0.75} ${top - roof * 0.2} Q${x + w * 0.6} ${top - roof * 0.5} ${x + w / 2} ${top - roof + 7} Q${x + w * 0.35} ${top - roof * 0.45} ${x + w * 0.22} ${top + 1} Q${x + w * 0.1} ${top + 6} ${x - 5} ${top + 2}Z"/>
                <rect class="hl-gt-win" x="${x + w * 0.14}" y="${top + h * 0.18}" width="${w * 0.22}" height="${w * 0.24}" rx="1.2" style="animation-delay:-${(x % 7).toFixed(1)}s"/>
                <rect class="hl-gt-win" x="${x + w * 0.64}" y="${top + h * 0.18}" width="${w * 0.22}" height="${w * 0.24}" rx="1.2" style="animation-delay:-${(x % 5).toFixed(1)}s"/>
                <path class="hl-gt-door" d="M${x + w * 0.4} 120 v-${h * 0.34} q${w * 0.1} -${w * 0.12} ${w * 0.2} 0 v${h * 0.34}Z"/>
                <circle class="hl-gt-wreath" cx="${x + w / 2}" cy="${120 - h * 0.44}" r="2.6"/>`;
        };
        const fir = (x, h) => `<g class="hl-gt-firg"><path class="hl-gt-fir" d="M${x} ${120 - h} L${x - h * 0.22} ${120 - h * 0.62} L${x - h * 0.1} ${120 - h * 0.62} L${x - h * 0.32} ${120 - h * 0.3} L${x - h * 0.16} ${120 - h * 0.3} L${x - h * 0.4} 118 L${x + h * 0.4} 118 L${x + h * 0.16} ${120 - h * 0.3} L${x + h * 0.32} ${120 - h * 0.3} L${x + h * 0.1} ${120 - h * 0.62} L${x + h * 0.22} ${120 - h * 0.62}Z"/>
            <path class="hl-gt-snow" d="M${x} ${120 - h} L${x - h * 0.12} ${120 - h * 0.8} Q${x} ${120 - h * 0.86} ${x + h * 0.12} ${120 - h * 0.8}Z M${x - h * 0.22} ${120 - h * 0.62} q${h * 0.22} -${h * 0.06} ${h * 0.44} 0 l-${h * 0.06} ${h * 0.03} q-${h * 0.16} -${h * 0.03} -${h * 0.32} 0Z"/></g>`;
        let garland = '<path class="hl-gt-wire" d="M168 88 Q202 100 226 82 M226 82 Q262 96 300 76 M336 76 Q370 92 404 84"/>';
        const pts = [[176, 92], [188, 95], [200, 95], [212, 91], [236, 88], [250, 90], [264, 89], [278, 85], [290, 80], [346, 81], [358, 85], [370, 87], [382, 87], [394, 86]];
        pts.forEach(([x, y], i) => { garland += `<circle class="hl-bulb hl-bulb--${kinds[i % 5]}" cx="${x}" cy="${y}" r="1.7" style="animation-delay:-${((i * 0.37) % 1.8).toFixed(2)}s"/>`; });
        const skater = (cls, colour) => `<g class="hl-gt-skater ${cls}"><g class="hl-gt-skater-y"><g class="hl-gt-skater-body">
            <path d="M0 -10 q3 4 1 10 l-3 0 q-2 -6 2 -10z" fill="${colour}"/><circle cx="0.5" cy="-12.5" r="2.6" class="hl-gt-skin"/>
            <path d="M-2 -14.5 q2.5 -3.5 5 0z" fill="${colour}"/><path class="hl-gt-scarf" d="M-1 -10 l-6 2"/>
            <path class="hl-gt-leg" d="M-1 0 l-2 5 M1.5 0 l3 4.5"/></g></g></g>`;
        return `<svg class="hl-gt" viewBox="0 0 700 132" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
            <defs><linearGradient id="hl-gt-ice" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f1ff"/><stop offset=".5" stop-color="#9fd3f2"/><stop offset="1" stop-color="#cde9fb"/></linearGradient>
            <radialGradient id="hl-gt-lampglow"><stop offset="0" stop-color="#ffd98a" stop-opacity=".75"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient></defs>
            <ellipse class="hl-gt-ground" cx="350" cy="124" rx="350" ry="14"/>
            ${fir(28, 50)}${fir(70, 68)}${fir(104, 44)}
            ${house(124, 50, 42, 24, true)}${house(178, 46, 56, 20, false)}
            <path class="hl-gt-wall" d="M298 120 V60 L318 28 L338 60 V120Z"/><rect class="hl-gt-wall" x="313" y="6" width="10" height="26"/>
            <path class="hl-gt-roof" d="M311 8 L318 -4 L325 8Z"/><path class="hl-gt-snow" d="M296 61 L318 26 L340 61 L334 62 L318 38 L302 62Z"/>
            <circle class="hl-gt-halo" cx="318" cy="-6" r="9"/><path class="hl-gt-star" d="M318 -12 l1.6 4.2 4.4 .2 -3.5 2.8 1.2 4.3 -3.7 -2.5 -3.7 2.5 1.2 -4.3 -3.5 -2.8 4.4 -.2z"/>
            <rect class="hl-gt-win hl-gt-win--rose" x="311" y="68" width="14" height="20" rx="7"/><path class="hl-gt-door" d="M311 120 v-16 q7 -8 14 0 v16z"/>
            ${house(352, 64, 40, 28, true)}${house(426, 48, 50, 22, true)}
            ${garland}
            <ellipse cx="560" cy="122" rx="62" ry="8" fill="url(#hl-gt-ice)" class="hl-gt-pond"/>
            <path class="hl-gt-glint" d="M530 120 q16 -3 32 0 M570 124 q12 -2 22 0"/>
            ${skater('hl-gt-skater--1', '#c8102e')}${skater('hl-gt-skater--2', '#2b5f97')}
            <circle cx="490" cy="76" r="22" fill="url(#hl-gt-lampglow)" class="hl-gt-lampglow"/>
            <path class="hl-gt-post" d="M489 120 V82 M484 82 h10 l-2 -7 h-6z M487 120 h4"/><rect class="hl-gt-lamp" x="486" y="75" width="6" height="7" rx="1"/>
            ${fir(640, 74)}${fir(680, 52)}
        </svg>`;
    }

    // A wind-up key turning on the side of the base, as on a music box.
    function globeKey() {
        return `<svg class="hl-globe-key" viewBox="-20 -20 40 40" aria-hidden="true"><g class="hl-globe-key-turn">
            <path class="hl-brass" d="M-3 -2 h6 v18 h-6z"/>
            <path class="hl-brass" d="M0 -4 C-14 -18 -18 -2 -6 -4 C-14 4 -6 12 0 -4 C6 12 14 4 6 -4 C18 -2 14 -18 0 -4Z"/>
            <circle class="hl-brass-dark" cx="0" cy="-4" r="2.2"/></g></svg>`;
    }

    function globeLayers(rand) {
        const year = new Date().getFullYear();
        return {
            back: `<div class="hl-globe-sky"></div>${stars(36, rand)}
                <div class="hl-globe-aurora"></div>${globeTown()}
                <div class="hl-globe-glass"><i class="hl-globe-rim"></i><i class="hl-globe-sheen"></i><i class="hl-globe-sweep"></i><i class="hl-globe-caustic"></i></div>
                <div class="hl-globe-base"><i class="hl-globe-band"></i>${globeKey()}
                    <span class="hl-globe-plate"><i class="hl-screw"></i>nextDash ${year}<i class="hl-screw"></i></span></div>`,
            front: '<canvas class="hl-globe-snow"></canvas>',
        };
    }

    function globeSnow(front, back) {
        const canvas = front.querySelector('.hl-globe-snow');
        const ctx = canvas && canvas.getContext('2d');
        if (!ctx) return null;
        const small = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
        const light = () => /-light$/.test(document.documentElement.getAttribute('data-theme') || '');
        const MAX_CAP = 14;
        let W = 0, H = 0, dpr = 1, raf = 0, cards = [], lastMeasure = 0;
        const flakes = [];

        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = window.innerWidth;
            H = window.innerHeight;
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        function measure() {
            cards = [];
            document.querySelectorAll('.category').forEach((el) => {
                const r = el.getBoundingClientRect();
                if (r.width < 40 || r.bottom < 0 || r.top > H) return;
                cards.push({ el, left: r.left, right: r.right, top: r.top, cap: Number(el.dataset.hlCap) || 0 });
            });
        }
        function setCap(card, value) {
            card.cap = Math.max(0, Math.min(MAX_CAP, value));
            card.el.dataset.hlCap = card.cap.toFixed(2);
            card.el.style.setProperty('--hl-cap', `${card.cap.toFixed(1)}px`);
        }
        // Three depths: far flakes are small, slow and faint; one in nine is a
        // six-armed crystal that turns as it falls.
        function newFlake(y) {
            const depth = Math.random();
            const crystal = Math.random() < 0.11;
            return {
                x: Math.random() * W, y: y == null ? -10 : y,
                r: crystal ? 3.5 + Math.random() * 3 : 0.7 + depth * 2.6,
                vy: 0.25 + depth * 0.8, vx: 0, ph: Math.random() * 6.3,
                a: 0.35 + depth * 0.6, crystal, rot: Math.random() * 6.3, spin: (Math.random() - 0.5) * 0.03,
            };
        }
        function drawCrystal(f, isLight) {
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.rot);
            ctx.strokeStyle = isLight ? 'rgba(90, 130, 175, 0.9)' : '#ffffff';
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
                ctx.rotate(Math.PI / 3);
                ctx.moveTo(0, 0);
                ctx.lineTo(0, -f.r);
                ctx.moveTo(0, -f.r * 0.55);
                ctx.lineTo(-f.r * 0.3, -f.r * 0.8);
                ctx.moveTo(0, -f.r * 0.55);
                ctx.lineTo(f.r * 0.3, -f.r * 0.8);
            }
            ctx.stroke();
            ctx.restore();
        }

        let swirlUntil = 0;
        function frame(now) {
            raf = requestAnimationFrame(frame);
            if (now - lastMeasure > 700) {
                lastMeasure = now;
                measure();
            }
            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = '#ffffff';
            const isLight = light();
            if (isLight) {
                ctx.strokeStyle = 'rgba(70, 100, 140, 0.35)';
                ctx.lineWidth = 0.6;
            }
            // Right after a shake the water in the globe turns: every flake
            // gets a push round the centre that fades over two seconds.
            const swirl = Math.max(0, (swirlUntil - now) / 2000);
            const cxm = W / 2, cym = H * 0.55;
            for (let i = flakes.length - 1; i >= 0; i--) {
                const f = flakes[i];
                f.ph += 0.02;
                f.rot += f.spin;
                f.vx *= 0.97;
                if (f.vy < 0.35) f.vy += 0.035;
                if (swirl > 0) {
                    const dx = f.x - cxm, dy = f.y - cym;
                    const d = Math.hypot(dx, dy) || 1;
                    f.vx += (-dy / d) * swirl * 0.35;
                    f.vy += (dx / d) * swirl * 0.12;
                }
                f.x += Math.sin(f.ph) * 0.35 + f.vx;
                f.y += f.vy;
                let landed = false;
                if (f.vy > 0) {
                    for (const c of cards) {
                        const edge = c.top - c.cap;
                        if (f.x > c.left + 8 && f.x < c.right - 8 && f.y > edge - 1 && f.y < edge + f.vy + 2) {
                            setCap(c, c.cap + 0.22 * f.r);
                            landed = true;
                            break;
                        }
                    }
                }
                if (landed || f.y > H + 10 || f.x < -30 || f.x > W + 30) {
                    if (flakes.length > target) flakes.splice(i, 1);
                    else Object.assign(f, newFlake());
                    continue;
                }
                ctx.globalAlpha = f.a;
                if (f.crystal) {
                    drawCrystal(f, isLight);
                    if (isLight) {
                        ctx.strokeStyle = 'rgba(70, 100, 140, 0.35)';
                        ctx.lineWidth = 0.6;
                    }
                    continue;
                }
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.r, 0, 6.283);
                ctx.fill();
                if (isLight) ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }

        // A page switch shakes the globe: the caps come off as a burst and
        // every flake is thrown upward before it settles again.
        function shake() {
            back.classList.remove('hl-shaking');
            void back.offsetWidth;
            back.classList.add('hl-shaking');
            for (const c of cards) {
                const n = Math.round(c.cap * 2.5);
                for (let i = 0; i < n && flakes.length < target * 2; i++) {
                    flakes.push({ x: c.left + Math.random() * (c.right - c.left), y: c.top - c.cap, r: 1 + Math.random() * 2.2, vy: -(2 + Math.random() * 4), vx: (Math.random() - 0.5) * 6, ph: Math.random() * 6, a: 0.9 });
                }
                setCap(c, 0);
            }
            document.querySelectorAll('.category[data-hl-cap]').forEach((el) => {
                el.style.removeProperty('--hl-cap');
                delete el.dataset.hlCap;
            });
            for (const f of flakes) {
                f.vy = -(1 + Math.random() * 5);
                f.vx = (Math.random() - 0.5) * 8;
                f.spin = (Math.random() - 0.5) * 0.2;
            }
            swirlUntil = performance.now() + 2000;
        }

        const target = small ? 90 : 160;
        resize();
        for (let i = 0; i < target; i++) flakes.push(newFlake(Math.random() * H));
        const onVisible = () => {
            cancelAnimationFrame(raf);
            if (!document.hidden) raf = requestAnimationFrame(frame);
        };
        const onScroll = () => { lastMeasure = 0; };
        window.addEventListener('resize', resize);
        window.addEventListener('scroll', onScroll, { passive: true, capture: true });
        document.addEventListener('visibilitychange', onVisible);
        document.addEventListener('nextdash:page-switched', shake);
        raf = requestAnimationFrame(frame);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
            window.removeEventListener('scroll', onScroll, { capture: true });
            document.removeEventListener('visibilitychange', onVisible);
            document.removeEventListener('nextdash:page-switched', shake);
            document.querySelectorAll('.category[data-hl-cap]').forEach((el) => {
                el.style.removeProperty('--hl-cap');
                delete el.dataset.hlCap;
            });
        };
    }

    /* ── Paper Advent ──────────────────────────────────────────────── */

    /*
     * A Scherenschnitt village in four cut-paper layers, lit from behind. The
     * layers shift against each other with the pointer, so the village gains
     * depth. Its windows are an advent calendar: from 1 to 24 December one
     * more is lit each day and today's glows brightest with its number; on
     * other days of the year every window is lit. A Moravian star turns
     * slowly in the top corner.
     */
    function adventDay() {
        const now = new Date();
        return now.getMonth() === 11 && now.getDate() <= 24 ? now.getDate() : 0;
    }

    function paperPine(x, base, h) {
        let d = '';
        for (let k = 0; k < 4; k++) {
            const w = h * (0.42 - k * 0.08);
            const t = base - h * (0.25 + k * 0.22);
            d += `M${x} ${t - h * 0.25} L${x - w} ${t + h * 0.1} L${x - w * 0.4} ${t + h * 0.05} L${x - w * 0.8} ${t + h * 0.28} L${x + w * 0.8} ${t + h * 0.28} L${x + w * 0.4} ${t + h * 0.05} L${x + w} ${t + h * 0.1}Z`;
        }
        return `<path d="${d}M${x - 4} ${base} h8 v-${h * 0.2} h-8Z"/>`;
    }

    function paperHills(y, amp, seed) {
        let d = `M0 470 L0 ${y}`;
        for (let x = 0; x <= 1400; x += 70) {
            d += ` Q${x + 35} ${(y - amp * Math.sin((x + seed) / 130) - amp).toFixed(1)} ${x + 70} ${(y - amp * Math.sin((x + 70 + seed) / 170)).toFixed(1)}`;
        }
        return `<path d="${d} L1400 470Z"/>`;
    }

    function adventLayers() {
        const windows = [];
        function house(x, base, w, h, roof) {
            let s = `<path d="M${x} ${base} V${base - h} L${x + w / 2} ${base - h - roof} L${x + w} ${base - h} V${base}Z"/>`;
            const chx = x + w * 0.68, chy = base - h - roof * 0.55;
            s += `<path d="M${chx} ${chy} v-${roof * 0.55} h${w * 0.12} v${roof * 0.3}Z"/>`;
            // Paper smoke: three cut curls that rise and unroll from the chimney.
            s += `<g class="hl-pa-smoke">${[0, 1, 2].map((k) => `<path style="animation-delay:${(k * 2.2 + x % 3).toFixed(1)}s" d="M${(chx + w * 0.06).toFixed(1)} ${(chy - roof * 0.55).toFixed(1)} c-8 -6 4 -12 -2 -18 c-5 -5 6 -9 2 -14 l3 0 c3 6 -7 9 -2 14 c6 6 -6 12 2 18z"/>`).join('')}</g>`;
            // Icicle fringe cut along the eaves.
            let fringe = `M${x - 2} ${base - h}`;
            for (let fx = x; fx < x + w; fx += 8) fringe += ` L${fx + 4} ${base - h + 5 + ((fx * 13) % 4)} L${fx + 8} ${base - h}`;
            s += `<path class="hl-pa-eave" d="${fringe}Z"/>`;
            const cols = w > 90 ? 3 : 2;
            const rows = h > 90 ? 2 : 1;
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const ww = w * 0.16;
                    const wx = x + (w * (c + 0.5)) / cols - ww / 2;
                    const wy = base - h + 18 + r * (h * 0.42);
                    windows.push({ wx, wy, ww, wh: ww * 1.25 });
                    s += `<rect class="hl-pa-win" data-w="${windows.length - 1}" x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${ww.toFixed(1)}" height="${(ww * 1.25).toFixed(1)}" rx="${(ww / 2).toFixed(1)}"/>`;
                    s += `<path class="hl-pa-mullion" d="M${(wx + ww / 2 - 1).toFixed(1)} ${wy.toFixed(1)} h2 v${(ww * 1.25).toFixed(1)} h-2Z M${wx.toFixed(1)} ${(wy + ww * 0.62).toFixed(1)} h${ww.toFixed(1)} v2 h-${ww.toFixed(1)}Z"/>`;
                }
            }
            return s;
        }
        const l1 = paperHills(250, 40, 0) + [120, 380, 700, 980, 1260].map((x, i) => paperPine(x, 260 - (i % 2) * 20, 140)).join('');
        const l2 = paperHills(330, 26, 90) + house(160, 340, 120, 110, 60) + house(520, 330, 90, 80, 50)
            + house(900, 340, 140, 120, 70) + paperPine(420, 340, 120) + paperPine(1180, 345, 150);
        const l3 = paperHills(395, 20, 40) + house(40, 400, 110, 100, 56) + house(650, 405, 160, 130, 80)
            + house(1120, 400, 100, 90, 52)
            + '<path d="M360 405 V250 L385 205 L410 250 V405Z"/>'
            + '<path d="M1000 400 l2 -26 q-12 -2 -16 -14 q8 -6 18 -2 l30 2 q6 -12 4 -20 l-6 -8 l8 4 l2 -10 l4 12 l6 -6 l-4 12 q4 8 -2 18 l2 32 h-4 l-4 -26 l-24 0 l-6 26Z"/>';
        const l4 = '<path d="M0 470 L0 440 Q350 418 700 436 T1400 430 L1400 470Z"/>'
            + [200, 560, 820, 1300].map((x, i) => paperPine(x, 450, 90 + i * 12)).join('');

        // Light the windows in a fixed shuffled order, so a window that was
        // lit yesterday stays lit today.
        let svgs = [[l1, 6], [l2, 14], [l3, 26], [l4, 42]].map(([body, depth], i) =>
            `<svg class="hl-pa-layer hl-pa-l${i + 1}" data-depth="${depth}" viewBox="0 0 1400 470" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${body}</svg>`).join('');
        const n = windows.length;
        const order = windows.map((_, i) => i).sort((a, b) => ((a * 7919) % n) - ((b * 7919) % n));
        const day = adventDay();
        const lit = new Set(day ? order.slice(0, Math.min(day, n)) : order);
        const today = day ? order[Math.min(day, n) - 1] : -1;
        svgs = svgs.replace(/<rect class="hl-pa-win" data-w="(\d+)"([^>]*)\/>/g, (m, idx, rest) => {
            const i = Number(idx);
            const cls = i === today ? 'hl-pa-win is-today' : lit.has(i) ? 'hl-pa-win is-lit' : 'hl-pa-win';
            const w = windows[i];
            let out = `<rect class="${cls}" style="animation-delay:-${((i * 0.73) % 3).toFixed(2)}s"${rest}/>`;
            if (i === today) {
                out += `<text class="hl-pa-num" x="${(w.wx + w.ww / 2).toFixed(1)}" y="${(w.wy + w.wh * 0.72).toFixed(1)}">${day}</text>`;
            } else if (lit.has(i) && i % 4 === 1) {
                // A candle on the sill.
                const cx = w.wx + w.ww / 2, sy = w.wy + w.wh;
                out += `<path class="hl-pa-sil" d="M${(cx - 1.6).toFixed(1)} ${sy.toFixed(1)} v-${(w.wh * 0.38).toFixed(1)} h3.2 v${(w.wh * 0.38).toFixed(1)}Z M${cx.toFixed(1)} ${(sy - w.wh * 0.38 - 1).toFixed(1)} q-1.6 -2.4 0 -4.6 q1.6 2.2 0 4.6Z"/>`;
            } else if (lit.has(i) && i % 6 === 3) {
                // A cat looking out.
                const cx = w.wx + w.ww / 2, sy = w.wy + w.wh;
                out += `<path class="hl-pa-sil" d="M${(cx - 3.5).toFixed(1)} ${sy.toFixed(1)} q-0.5 -5 1.5 -6.5 l-0.6 -3 2 2 h1.2 l2 -2 -0.6 3 q2 1.5 1.5 6.5Z"/>`;
            }
            return out;
        });

        // The Moravian star: points in a lit and a shaded half, rays turning
        // the other way behind it, on a string that sways.
        let star = '';
        for (let i = 0; i < 14; i++) {
            const long = i % 2 ? 42 : 54;
            star += `<g transform="rotate(${(i * 360) / 14})"><path class="hl-pa-star-lit" d="M0 -${long} L-9 -12 L0 -6Z"/><path class="hl-pa-star-shade" d="M0 -${long} L9 -12 L0 -6Z"/><path class="hl-pa-star-edge" d="M0 -${long} L0 -6"/></g>`;
        }
        let rays = '';
        for (let i = 0; i < 18; i++) rays += `<path d="M0 0 L${i % 2 ? 3 : 5} -${i % 2 ? 80 : 110} L-${i % 2 ? 3 : 5} -${i % 2 ? 80 : 110}Z" transform="rotate(${i * 20})"/>`;

        // Holes punched in the sky, a cut moon with craters, and a sleigh
        // that crosses it now and then.
        let holes = '';
        for (let i = 0; i < 34; i++) {
            const x = (i * 211) % 1400, y = 20 + ((i * 97) % 220), r = 1.2 + (i % 4) * 0.6;
            holes += i % 5 === 0
                ? `<path class="hl-pa-hole hl-pa-hole--star" style="animation-delay:-${(i * 0.41) % 4}s" d="M${x} ${y - r * 3} L${x + r} ${y - r} L${x + r * 3} ${y} L${x + r} ${y + r} L${x} ${y + r * 3} L${x - r} ${y + r} L${x - r * 3} ${y} L${x - r} ${y - r}Z"/>`
                : `<circle class="hl-pa-hole" style="animation-delay:-${(i * 0.41) % 4}s" cx="${x}" cy="${y}" r="${r}"/>`;
        }
        const sky = `<svg class="hl-pa-skycut" viewBox="0 0 1400 470" preserveAspectRatio="xMidYMin slice" aria-hidden="true">
            ${holes}
            <g class="hl-pa-moon"><circle cx="1010" cy="120" r="52"/><circle class="hl-pa-crater" cx="992" cy="104" r="9"/><circle class="hl-pa-crater" cx="1030" cy="138" r="6"/><circle class="hl-pa-crater" cx="1018" cy="96" r="4"/></g>
            <g class="hl-pa-sleigh"><path d="M0 18 q-6 -14 4 -18 l2 6 h22 q6 0 9 -6 l3 1 q-2 14 -14 17z M-2 22 h44 q6 0 6 -5"/>
                <path d="M8 6 q2 -9 8 -9 q5 0 5 6z M60 12 l4 -10 2 4 3 -6 1 7 q4 3 2 8 l-1 9 h-2 l-1 -7 h-10 l-2 7 h-2 l0 -9z M84 10 l4 -10 2 4 3 -6 1 7 q4 3 2 8 l-1 9 h-2 l-1 -7 h-10 l-2 7 h-2 l0 -9z"/>
                <path class="hl-pa-rein" d="M40 8 L62 10 M40 8 L86 8"/></g>
        </svg>`;

        return `<div class="hl-pa-sky"></div>${sky}<div class="hl-pa-grain"></div>
            <div class="hl-pa-star"><i class="hl-pa-string"></i><svg viewBox="-120 -120 240 240" aria-hidden="true"><g class="hl-pa-rays">${rays}</g><g class="hl-pa-spin">${star}<circle class="hl-pa-star-core" r="9"/></g></svg></div>
            <div class="hl-pa-scene">${svgs}</div>`;
    }

    // Snowflakes cut from paper: a six-fold cut-out, turning as it falls.
    function paperSnow(count, rand) {
        let arm = '';
        for (let k = 0; k < 6; k++) arm += `<path transform="rotate(${k * 60})" d="M-1.4 0 V-9 L-3.6 -11.5 L-1.4 -11 V-12.5 L0 -14 L1.4 -12.5 V-11 L3.6 -11.5 L1.4 -9 V0Z M-1.4 -5 L-4.5 -7.5 L-4 -5.2Z M1.4 -5 L4.5 -7.5 L4 -5.2Z"/>`;
        const svg = `<svg viewBox="-15 -15 30 30"><g>${arm}<circle r="2.6"/></g><circle r="1.1" class="hl-pa-flake-hole"/></svg>`;
        let out = '';
        for (let i = 0; i < count; i++) {
            const dur = 18 + rand() * 16;
            out += `<span class="hl-crystal hl-pa-snow" style="left:${(rand() * 100).toFixed(2)}%;animation-duration:${dur.toFixed(1)}s;animation-delay:-${(rand() * dur).toFixed(1)}s;--hl-drift:${Math.round(rand() * 90 - 45)}px;--hl-size:${(12 + rand() * 16).toFixed(0)}px;--hl-opacity:${(0.75 + rand() * 0.25).toFixed(2)}">${svg}</span>`;
        }
        return out;
    }

    function adventParallax(back) {
        const layers = [...back.querySelectorAll('.hl-pa-layer')];
        let raf = 0, px = 0, py = 0;
        const paint = () => {
            raf = 0;
            layers.forEach((l) => {
                const d = Number(l.dataset.depth) || 0;
                l.style.transform = `translate3d(${(-px * d).toFixed(1)}px, ${(-py * d * 0.4).toFixed(1)}px, 0)`;
            });
        };
        const onMove = (e) => {
            px = e.clientX / window.innerWidth - 0.5;
            py = e.clientY / window.innerHeight - 0.5;
            if (!raf) raf = requestAnimationFrame(paint);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            cancelAnimationFrame(raf);
        };
    }

    /* ── Nutcracker Theatre ────────────────────────────────────────── */

    /*
     * A stage: a gold arch with a velvet valance along the top, gold pillars
     * and tied-back drapes at the sides, footlights along the bottom and two
     * nutcracker soldiers who salute now and then. A soft spotlight follows
     * the pointer. When the page loads the red curtain opens once (front
     * layer, removed when it is done); sugar-plum glitter drifts down.
     */
    function soldier(side) {
        return `<svg class="hl-nc-soldier hl-nc-soldier--${side}" viewBox="0 0 72 170" aria-hidden="true">
            <rect class="hl-nc-boot" x="22" y="150" width="11" height="18"/><rect class="hl-nc-boot" x="39" y="150" width="11" height="18"/>
            <rect class="hl-nc-trousers" x="22" y="104" width="11" height="48"/><rect class="hl-nc-trousers" x="39" y="104" width="11" height="48"/>
            <rect class="hl-nc-coat" x="18" y="58" width="36" height="50" rx="4"/><path class="hl-nc-braid" d="M36 60 v46"/>
            <circle class="hl-nc-gold" cx="36" cy="70" r="2"/><circle class="hl-nc-gold" cx="36" cy="82" r="2"/><circle class="hl-nc-gold" cx="36" cy="94" r="2"/>
            <rect class="hl-nc-boot" x="16" y="102" width="40" height="6"/><rect class="hl-nc-gold" x="33" y="102" width="6" height="6"/>
            <rect class="hl-nc-coat" x="56" y="62" width="9" height="40" rx="4"/>
            <g class="hl-nc-salute"><rect class="hl-nc-coat" x="7" y="62" width="9" height="40" rx="4"/><circle class="hl-nc-glove" cx="11" cy="104" r="5"/></g>
            <rect class="hl-nc-face" x="24" y="30" width="24" height="30" rx="5"/><rect class="hl-nc-beard" x="26" y="48" width="20" height="10"/><path class="hl-nc-mouth" d="M27 50 h18"/>
            <circle class="hl-nc-eye" cx="31" cy="40" r="2"/><circle class="hl-nc-eye" cx="41" cy="40" r="2"/><circle class="hl-nc-cheek" cx="29" cy="46" r="2.5"/><circle class="hl-nc-cheek" cx="43" cy="46" r="2.5"/>
            <rect class="hl-nc-boot" x="22" y="2" width="28" height="30" rx="3"/><rect class="hl-nc-gold" x="22" y="26" width="28" height="5"/><path class="hl-nc-gold" d="M30 2 q6 -8 12 0"/>
        </svg>`;
    }

    function nutcrackerLayers(rand) {
        let bulbs = '';
        for (let i = 0; i < 18; i++) bulbs += `<i style="animation-delay:-${(rand() * 3).toFixed(2)}s"></i>`;
        let plums = '';
        for (let i = 0; i < 26; i++) {
            const dur = 10 + rand() * 12;
            plums += `<span class="hl-nc-plum${i % 3 ? '' : ' hl-nc-plum--violet'}" style="left:${(4 + rand() * 92).toFixed(2)}%;animation-duration:${dur.toFixed(1)}s;animation-delay:-${(rand() * dur).toFixed(1)}s;opacity:${(0.4 + rand() * 0.5).toFixed(2)}"></span>`;
        }
        const curtain = document.body && document.body.dataset.hlCurtainShown === '1' ? ''
            : '<div class="hl-nc-curtain hl-nc-curtain--l"><i class="hl-nc-fringe"></i></div><div class="hl-nc-curtain hl-nc-curtain--r"><i class="hl-nc-fringe"></i></div>';
        return {
            back: `<div class="hl-nc-stage"></div>
                <div class="hl-nc-beam hl-nc-beam--l"></div><div class="hl-nc-beam hl-nc-beam--r"></div>
                <div class="hl-nc-spot"></div>
                <div class="hl-nc-floor"></div>
                <div class="hl-nc-drape hl-nc-drape--l"><i class="hl-nc-rope"></i></div><div class="hl-nc-drape hl-nc-drape--r"><i class="hl-nc-rope"></i></div>
                <div class="hl-nc-pillar hl-nc-pillar--l"></div><div class="hl-nc-pillar hl-nc-pillar--r"></div>
                ${ncArch()}
                ${soldier('l')}${soldier('r')}${ballerina()}
                <div class="hl-nc-footlights">${bulbs}</div>`,
            front: plums + curtain,
        };
    }

    // The arch: a gilded moulding with a running scroll, a velvet valance
    // hanging in swags with gold fringe and tassels, and a crest in the
    // middle with a laurel round the N.
    function ncArch() {
        let swags = '', tassels = '';
        const n = 9, w = 1440 / n;
        for (let i = 0; i < n; i++) {
            const x = i * w;
            swags += `<path class="hl-nc-swag" d="M${x} 30 Q${x + w / 2} 74 ${x + w} 30 L${x + w} 22 L${x} 22Z"/>
                <path class="hl-nc-swag-fold" d="M${x + 10} 34 Q${x + w / 2} 64 ${x + w - 10} 34"/>
                <path class="hl-nc-swag-fringe" d="M${x} 30 Q${x + w / 2} 74 ${x + w} 30"/>`;
            tassels += `<g class="hl-nc-tassel" style="animation-delay:-${(i * 0.6).toFixed(1)}s" transform="translate(${x + w} 30)"><path d="M0 0 v10"/><circle cy="12" r="3.2"/><path d="M-3.2 13 L-4.5 26 H4.5 L3.2 13Z"/></g>`;
        }
        let scroll = '';
        for (let x = 0; x < 1440; x += 36) scroll += `<path d="M${x} 13 q9 -9 18 0 t18 0"/><circle cx="${x + 9}" cy="9" r="1.4"/>`;
        let laurel = '';
        for (let k = 0; k < 7; k++) {
            const a = -70 + k * 22;
            laurel += `<ellipse rx="3" ry="7" transform="rotate(${a}) translate(0 -27) rotate(-30)"/><ellipse rx="3" ry="7" transform="scale(-1 1) rotate(${a}) translate(0 -27) rotate(-30)"/>`;
        }
        return `<svg class="hl-nc-arch" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true">
            <rect class="hl-nc-gilt" width="1440" height="24"/><g class="hl-nc-scroll">${scroll}</g>
            <rect class="hl-nc-gilt-edge" y="22" width="1440" height="3"/>
            ${swags}${tassels}
        </svg>
        <svg class="hl-nc-crest" viewBox="-40 -40 80 80" aria-hidden="true">
            <circle class="hl-nc-crest-ring" r="24"/><circle class="hl-nc-crest-field" r="20"/>
            <g class="hl-nc-laurel">${laurel}</g>
            <text class="hl-nc-crest-n" y="7">N</text>
            <path class="hl-nc-crown" d="M-12 -24 l4 -9 4 6 4 -9 4 9 4 -6 4 9z"/>
        </svg>`;
    }

    // The Sugar Plum Fairy on a music-box pedestal, turning on her toes.
    function ballerina() {
        return `<svg class="hl-nc-dancer" viewBox="-30 -70 60 100" aria-hidden="true">
            <ellipse class="hl-nc-pedestal-top" cx="0" cy="22" rx="20" ry="5"/>
            <path class="hl-nc-pedestal" d="M-20 22 v6 q20 8 40 0 v-6 q-20 8 -40 0z"/>
            <g class="hl-nc-turn">
                <path class="hl-nc-leg" d="M-1 0 L-2 21 M1 0 L4 12 L1 14"/>
                <path class="hl-nc-tutu" d="M-17 -2 Q0 -12 17 -2 Q12 3 6 1 Q0 5 -6 1 Q-12 3 -17 -2Z"/>
                <path class="hl-nc-tutu-tulle" d="M-15 -3 Q0 -10 15 -3"/>
                <path class="hl-nc-bodice" d="M-4 -4 L-3 -20 Q0 -23 3 -20 L4 -4Z"/>
                <path class="hl-nc-arm" d="M-3 -19 Q-12 -30 -4 -40 M3 -19 Q12 -30 4 -40"/>
                <circle class="hl-nc-skin" cx="0" cy="-26" r="4"/><circle class="hl-nc-bun" cx="0" cy="-31" r="2.4"/>
                <path class="hl-nc-tiara" d="M-3 -29.5 l1 -2.5 1 1.5 1 -2.5 1 2.5 1 -1.5 1 2.5"/>
            </g>
        </svg>`;
    }

    function nutcrackerStage(front, back) {
        let raf = 0, mx = 50, my = 35;
        const paint = () => {
            raf = 0;
            back.style.setProperty('--hl-mx', `${mx.toFixed(1)}%`);
            back.style.setProperty('--hl-my', `${my.toFixed(1)}%`);
        };
        const onMove = (e) => {
            mx = (e.clientX / window.innerWidth) * 100;
            my = (e.clientY / window.innerHeight) * 100;
            if (!raf) raf = requestAnimationFrame(paint);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        // The curtain opens once per page load: switching between the halves
        // or away and back does not play it again.
        document.body.dataset.hlCurtainShown = '1';
        const timer = setTimeout(() => front.querySelectorAll('.hl-nc-curtain').forEach((c) => c.remove()), 3600);
        return () => {
            window.removeEventListener('pointermove', onMove);
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }

    /* ── Building ──────────────────────────────────────────────────── */

    function layersFor(kind) {
        const small = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
        const rand = seeded(kind.length * 977);
        const scale = small ? 0.5 : 1;
        if (kind === 'christmas') {
            return {
                back: '<div class="hl-glow"></div>' + stars(Math.round(40 * scale), rand) + shootingStar() + garland() + scene(rand) + snowman() + tree(),
                front: flakes(Math.round(60 * scale), 'hl-flake', rand) + crystals(Math.round(12 * scale), rand),
            };
        }
        if (kind === 'snow-globe') return globeLayers(rand);
        if (kind === 'paper-advent') {
            return {
                back: adventLayers(),
                front: paperSnow(Math.round(18 * scale), rand),
            };
        }
        if (kind === 'nutcracker') return nutcrackerLayers(rand);
        if (kind === 'northern-lights') {
            return {
                back: aurora() + stars(Math.round(80 * scale), rand) + sleigh() + forest(),
                front: flakes(Math.round(70 * scale), 'hl-flake', rand),
            };
        }
        const colours = ['a', 'b', 'c', 'd', 'e'];
        return {
            back: stars(Math.round(50 * scale), rand) + stringLights() + village() + walker(),
            front: flakes(Math.round(40 * scale), 'hl-sprinkle', rand,
                (i) => `--hl-colour:var(--hl-c-${colours[i % 5]})`) + flakes(Math.round(30 * scale), 'hl-flake', rand),
        };
    }

    function startRuntime(kind, front, back) {
        if (kind === 'nutcracker') return nutcrackerStage(front, back);
        if (still()) return null;
        if (kind === 'snow-globe') return globeSnow(front, back);
        if (kind === 'paper-advent') return adventParallax(back);
        return null;
    }

    function remove() {
        if (stopRuntime) {
            stopRuntime();
            stopRuntime = null;
        }
        document.querySelectorAll('.holiday-layer').forEach((el) => el.remove());
        document.body?.removeAttribute('data-holiday');
        current = '';
    }

    function apply() {
        if (!document.body) return;
        const kind = kindOf(document.documentElement.getAttribute('data-theme'));
        if (kind === current) return;
        remove();
        if (!kind) return;
        current = kind;
        document.body.setAttribute('data-holiday', kind);
        const layers = layersFor(kind);
        const back = document.createElement('div');
        back.className = 'holiday-layer holiday-layer--back';
        back.setAttribute('aria-hidden', 'true');
        back.setAttribute('data-holiday-layer', 'back');
        back.innerHTML = layers.back;
        const front = document.createElement('div');
        front.className = 'holiday-layer holiday-layer--front';
        front.setAttribute('aria-hidden', 'true');
        front.setAttribute('data-holiday-layer', 'front');
        front.innerHTML = layers.front;
        const anchor = document.querySelector('.theme-backdrop-layer');
        if (anchor) anchor.after(back);
        else document.body.prepend(back);
        document.body.appendChild(front);
        stopRuntime = startRuntime(kind, front, back);
    }

    function start() {
        apply();
        new MutationObserver(apply).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }

    window.NDHolidays = { kindOf, apply };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
