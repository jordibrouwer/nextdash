/**
 * Small stand-in drawings for settings whose difference is spatial.
 *
 * A grid, a margin and a density are shapes. Written out as "Snug — rows sit
 * close together" they are a sentence to be decoded and then tried; drawn at
 * the size of a postage stamp they are answered before the sentence is read.
 * This is the same trick the spread-across-columns tour uses, lifted out of it
 * so config panels and help pages can draw the same things.
 *
 * Everything here is markup and CSS — no images, no canvas — so the drawings
 * inherit the theme like any other element and cost nothing to load. They are
 * decorative by construction: each one sits beside the label and the sentence
 * that already say it in words, so the wrapper is aria-hidden and a screen
 * reader hears the setting once rather than twice.
 */
(function () {
    'use strict';

    /** One column of stand-in bookmark rows. */
    function col(rows, modifier = '') {
        const lines = Array.from({ length: rows }, () => '<span class="setting-art-row"></span>').join('');
        return `<span class="setting-art-col${modifier ? ` ${modifier}` : ''}">${lines}</span>`;
    }

    function frame(inner, modifier = '') {
        return `<span class="setting-art-frame${modifier ? ` ${modifier}` : ''}">${inner}</span>`;
    }

    /**
     * A grid of `cols` columns. Above six the drawing stops being a picture of
     * anything — the columns are thinner than their own rows — so it caps and
     * says so with a trailing ellipsis column rather than drawing twelve hairs.
     */
    function grid(cols, rows = 3) {
        const n = Math.max(1, Math.min(6, Number(cols) || 1));
        const more = Number(cols) > 6;
        return frame(
            Array.from({ length: n }, () => col(rows)).join('')
            + (more ? '<span class="setting-art-more">…</span>' : ''),
            'setting-art-frame--grid'
        );
    }

    /** Three category blocks with the gap the chosen spacing gives them. */
    function spacing(level) {
        const rows = ['', '', ''].map(() => `<span class="setting-art-band"></span>`).join('');
        return frame(`<span class="setting-art-stack is-${level}">${rows}</span>`, 'setting-art-frame--stack');
    }

    /** The page, with the edges the chosen margin leaves empty. */
    function margins(level) {
        return frame(
            `<span class="setting-art-page is-${level}">`
            + `<span class="setting-art-gutter"></span>`
            + `<span class="setting-art-content">${col(3)}${col(3)}${col(3)}</span>`
            + `<span class="setting-art-gutter"></span>`
            + `</span>`,
            'setting-art-frame--page'
        );
    }

    /** Row height and spacing, which is all density changes. */
    function density(mode) {
        const rows = Array.from({ length: 5 }, () => '<span class="setting-art-row"></span>').join('');
        return frame(`<span class="setting-art-col is-${mode}">${rows}</span>`, 'setting-art-frame--density');
    }

    /** The dotted backdrop, on or off. */
    function dots(on) {
        return frame(`<span class="setting-art-dots${on ? ' is-on' : ''}"></span>`, 'setting-art-frame--dots');
    }

    /** Text at three sizes, which is the one thing a size name cannot show. */
    function fontSize(size) {
        return frame(`<span class="setting-art-type is-${size}">Aa</span>`, 'setting-art-frame--type');
    }

    /**
     * The two layout versions, told apart by the one thing that differs at a
     * glance: Classic sets its rows flat on the page, Modern puts each category
     * on a raised card.
     */
    function layoutVersion(version) {
        const block = `<span class="setting-art-card">${col(3)}</span>`;
        return frame(
            `<span class="setting-art-layout is-${version}">${block}${block}</span>`,
            'setting-art-frame--layout'
        );
    }

    /**
     * Where the button bar sits on the page. The dot is the bar; the frame is
     * the dashboard around it — which is the whole question this setting asks
     * and the one thing five position names cannot answer.
     */
    function barPosition(position) {
        return frame(
            `<span class="setting-art-screen is-${String(position).replace(/[^a-z-]/g, '')}">`
            + `<span class="setting-art-screen-body">${col(2)}${col(2)}${col(2)}</span>`
            + `<span class="setting-art-bar"></span>`
            + `</span>`,
            'setting-art-frame--screen'
        );
    }

    /**
     * A short flow: chips joined by arrows. For the settings that are not a
     * shape but a route — where a pasted URL goes, what promoting leaves behind.
     */
    function flow(labels) {
        const list = Array.isArray(labels) ? labels : [labels];
        // A branch rather than a line: "ask" ends in two places, and drawing it
        // as one arrow after another would say the opposite of what it does.
        const parts = list.map((label) => (Array.isArray(label)
            ? `<span class="setting-art-branch">${label
                .map((leaf) => `<span class="setting-art-chip">${escape(leaf)}</span>`).join('')}</span>`
            : `<span class="setting-art-chip">${escape(label)}</span>`));
        return `<span class="setting-art-flow">${parts.join('<span class="setting-art-arrow">→</span>')}</span>`;
    }

    /**
     * Numbered steps. A flow says what follows what; this says what to do
     * first, which is a different claim and the one a walkthrough makes.
     */
    function steps(labels) {
        const list = (Array.isArray(labels) ? labels : [labels]).filter((l) => l != null);
        if (!list.length) return '';
        // An unlabelled step is still a step: a seven-step tour is drawn as
        // seven pips, because seven labels would be a paragraph.
        const parts = list.map((label, i) => `<span class="setting-art-step">`
            + `<span class="setting-art-step-n">${i + 1}</span>`
            + (label === '' ? '' : `<span class="setting-art-step-label">${escape(label)}</span>`)
            + `</span>`);
        return `<span class="setting-art-steps">${parts.join('')}</span>`;
    }

    /**
     * Keycaps. A key printed as a cap is recognised before it is read, which is
     * the whole reason the cheat sheet draws them that way too.
     */
    function keys(list) {
        const items = (Array.isArray(list) ? list : [list]).filter((k) => k !== '' && k != null);
        if (!items.length) return '';
        return `<span class="setting-art-keys">${items
            .map((k) => `<span class="setting-art-key">${escape(k)}</span>`).join('')}</span>`;
    }

    /**
     * A legend: each state in the colour it wears on the real row, beside what
     * it means. Health and the server log both hang meaning on a colour, and a
     * colour named in a sentence has to be matched up by hand.
     */
    function states(list) {
        const rows = (Array.isArray(list) ? list : []).filter((e) => Array.isArray(e) && e.length === 2);
        if (!rows.length) return '';
        const parts = rows.map(([tone, label]) => `<span class="setting-art-state">`
            + `<span class="setting-art-dot is-${String(tone).replace(/[^a-z]/g, '')}"></span>`
            + `<span class="setting-art-state-label">${escape(label)}</span></span>`);
        return `<span class="setting-art-states">${parts.join('')}</span>`;
    }

    /**
     * The search overlay with something already typed in it.
     *
     * Three modes behind one field is the hardest thing in nextDash to describe
     * in a sentence and the easiest to show: the prefix sits where it is typed,
     * in the box it is typed into.
     */
    function query(segments) {
        const list = (Array.isArray(segments) ? segments : []).filter((s) => Array.isArray(s) && s.length === 2);
        if (!list.length) return '';
        const parts = list.map(([kind, text]) =>
            `<span class="setting-art-q is-${String(kind).replace(/[^a-z]/g, '')}">${escape(text)}</span>`);
        return frame(
            `<span class="setting-art-field">${parts.join('')}<span class="setting-art-caret"></span></span>`,
            'setting-art-frame--field'
        );
    }

    /**
     * Counts, with one of them the point. `{ values: [0…1], mark, tone }`.
     *
     * The marked bar takes a tone because the bar worth pointing at is not
     * always the good one: on a heartbeat it is the check that failed, and
     * drawing that in the accent would read as the opposite.
     */
    function bars(spec) {
        const values = Array.isArray(spec) ? spec : (spec && spec.values) || [];
        const mark = Array.isArray(spec) ? -1 : Number(spec && spec.mark != null ? spec.mark : -1);
        const tone = String((!Array.isArray(spec) && spec && spec.tone) || '').replace(/[^a-z]/g, '');
        if (!values.length) return '';
        const cols = values.map((v, i) => {
            const height = Math.round(Math.max(0.08, Math.min(1, Number(v) || 0)) * 100);
            const marked = i === mark ? ` is-mark${tone ? ` is-${tone}` : ''}` : '';
            return `<span class="setting-art-bar-col${marked}" style="height:${height}%"></span>`;
        });
        return frame(`<span class="setting-art-bars">${cols.join('')}</span>`, 'setting-art-frame--bars');
    }

    /**
     * A trend line. Drift and response time are both "the number moved", and
     * the direction is the only part worth drawing — so the line is SVG rather
     * than bars, because a line is what the real sparkline on the row is.
     */
    function spark(values) {
        const list = (Array.isArray(values) ? values : []).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
        if (list.length < 2) return '';
        const step = 100 / (list.length - 1);
        const points = list.map((v, i) => `${(i * step).toFixed(1)},${(28 - v * 24).toFixed(1)}`).join(' ');
        const last = list[list.length - 1];
        return frame(
            `<svg class="setting-art-spark" viewBox="0 0 100 32" preserveAspectRatio="none" focusable="false">`
            + `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2"`
            + ` stroke-linejoin="round" stroke-linecap="round"/>`
            + `<circle cx="100" cy="${(28 - last * 24).toFixed(1)}" r="3" fill="currentColor"/></svg>`,
            'setting-art-frame--spark'
        );
    }

    /**
     * A bar with a line drawn across it: how far along something is, and the
     * point at which it starts mattering. `{ fill, mark, tone }`.
     */
    function meter(spec) {
        const fill = Math.max(0, Math.min(1, Number(spec && spec.fill) || 0));
        const mark = spec && spec.mark != null ? Math.max(0, Math.min(1, Number(spec.mark))) : null;
        const tone = String((spec && spec.tone) || 'ok').replace(/[^a-z]/g, '');
        return frame(
            `<span class="setting-art-meter">`
            + `<span class="setting-art-meter-fill is-${tone}" style="width:${Math.round(fill * 100)}%"></span>`
            + (mark == null ? '' : `<span class="setting-art-meter-mark" style="left:${Math.round(mark * 100)}%"></span>`)
            + `</span>`,
            'setting-art-frame--meter'
        );
    }

    /**
     * A day, with the hours something is expected to be down shaded in. The
     * question a maintenance window answers is "when", and a start and an end
     * time written out are two numbers to picture against a day that is not
     * drawn.
     */
    function dayWindow(spec) {
        const from = Math.max(0, Math.min(23, Number(spec && spec.from) || 0));
        const to = Math.max(from + 1, Math.min(24, Number(spec && spec.to) || from + 1));
        const cells = Array.from({ length: 24 }, (_, h) =>
            `<span class="setting-art-hour${h >= from && h < to ? ' is-window' : ''}"></span>`).join('');
        return frame(`<span class="setting-art-day">${cells}</span>`, 'setting-art-frame--day');
    }

    /** Switches, some on and some off: a panel of them is what a settings tab is. */
    function toggles(list) {
        const items = (Array.isArray(list) ? list : [list]).map(Boolean);
        if (!items.length) return '';
        const rows = items.map((on) => `<span class="setting-art-toggle${on ? ' is-on' : ''}">`
            + `<span class="setting-art-knob"></span></span>`);
        return frame(`<span class="setting-art-toggles">${rows.join('')}</span>`, 'setting-art-frame--toggles');
    }

    /** Colour plates: the one setting whose subject really is the colour. */
    function swatches(list) {
        const items = (Array.isArray(list) ? list : [list])
            .map((v) => String(v).replace(/[^a-z]/g, '')).filter(Boolean);
        if (!items.length) return '';
        return `<span class="setting-art-swatches">${items
            .map((name) => `<span class="setting-art-swatch is-${name}"></span>`).join('')}</span>`;
    }

    /**
     * A boundary with things inside it, and the arrow that does or does not
     * cross it. "None of it is sent anywhere" is a promise about a line, and
     * the line is drawable.
     */
    function boundary(spec) {
        const inside = (spec && Array.isArray(spec.inside) ? spec.inside : []).filter(Boolean);
        if (!inside.length) return '';
        const label = spec && spec.label ? `<span class="setting-art-boundary-label">${escape(spec.label)}</span>` : '';
        const chips = inside.map((c) => `<span class="setting-art-chip">${escape(c)}</span>`).join('');
        // No `out` is not "nothing drawn": it is the barred arrow, which is the
        // claim the panel is making.
        const out = spec && spec.out
            ? `<span class="setting-art-arrow">→</span><span class="setting-art-chip">${escape(spec.out)}</span>`
            : `<span class="setting-art-blocked">⊘</span>`;
        return `<span class="setting-art-boundary-wrap">`
            + `<span class="setting-art-boundary">${label}<span class="setting-art-boundary-body">${chips}</span></span>`
            + out + `</span>`;
    }

    /**
     * One bookmark row, with the parts it can carry marked. The editor lists
     * nine fields; the row shows five of them, and which five is the thing a
     * reader is actually trying to work out.
     */
    function bookmarkRow(parts) {
        const has = (name) => (Array.isArray(parts) ? parts : []).includes(name);
        return frame(
            `<span class="setting-art-bmrow">`
            + (has('icon') ? '<span class="setting-art-bm-icon"></span>' : '')
            + '<span class="setting-art-bm-name"></span>'
            + (has('tag') ? '<span class="setting-art-bm-tag"></span>' : '')
            + (has('key') ? '<span class="setting-art-key">S</span>' : '')
            + (has('dot') ? '<span class="setting-art-dot is-ok"></span>' : '')
            + `</span>`,
            'setting-art-frame--bmrow'
        );
    }

    /**
     * Config itself: the rail down the left, the sub-tabs across the top, the
     * panel under them. Which of the three a sentence is talking about is the
     * part that goes missing when it is only written.
     */
    function panelMap(active) {
        const part = String(active || '').replace(/[^a-z]/g, '');
        return frame(
            `<span class="setting-art-config">`
            + `<span class="setting-art-rail${part === 'rail' ? ' is-active' : ''}"></span>`
            + `<span class="setting-art-config-main">`
            + `<span class="setting-art-tabs${part === 'tabs' ? ' is-active' : ''}"></span>`
            + `<span class="setting-art-config-body${part === 'body' ? ' is-active' : ''}">${col(3)}${col(3)}</span>`
            + `</span></span>`,
            'setting-art-frame--config'
        );
    }

    function escape(value) {
        return String(value).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const BUILDERS = {
        grid, spacing, margins, density, dots, fontSize, layoutVersion, barPosition, flow,
        steps, keys, states, query, bars, spark, meter, dayWindow, toggles, swatches,
        boundary, bookmarkRow, panelMap,
    };

    /**
     * Draw `kind` with `value`, wrapped and hidden from assistive tech.
     *
     * Returns '' for a kind that does not exist, so a caller naming a drawing
     * that was never written renders a control without art rather than a
     * broken panel.
     */
    function render(kind, value, extraClass = '') {
        const build = BUILDERS[kind];
        if (typeof build !== 'function') return '';
        const inner = build(value);
        if (!inner) return '';
        return `<span class="setting-art${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true">${inner}</span>`;
    }

    window.SettingArt = { render, has: (kind) => typeof BUILDERS[kind] === 'function' };
})();
