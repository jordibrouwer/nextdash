/*
 * Holiday themes: the decoration drawn over and under the page.
 *
 * The three Holidays pairs (holiday-christmas, holiday-northern-lights,
 * holiday-gingerbread) are ordinary themes as far as colours and materials
 * go. What makes them seasonal is drawn here: a back layer between the
 * backdrop and the cards (the tree, the forest, the village, the lights) and
 * a front layer for what falls (snow, sprinkles). Both ignore the pointer.
 *
 * The layers follow html[data-theme], so switching theme in the studio or with
 * :theme adds or removes them without a reload. Motion stops under
 * prefers-reduced-motion and with Effects off; that is CSS, in
 * theme-holidays.css.
 */
(function () {
    'use strict';

    const PREFIX = 'holiday-';
    const KINDS = ['christmas', 'northern-lights', 'gingerbread'];
    let current = '';

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

    function remove() {
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
