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

    function escape(value) {
        return String(value).replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    const BUILDERS = { grid, spacing, margins, density, dots, fontSize, layoutVersion, barPosition, flow };

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
