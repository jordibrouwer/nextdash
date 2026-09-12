'use strict';

/**
 * One figure with a caption under it, built once.
 *
 * Config's statistics and a dashboard widget's readout are the same object at
 * two sizes, and were two implementations: config assembled template strings
 * in three helpers, the widgets built DOM in `statGrid`. They drifted twice
 * before this existed -- the label case and tracking, then the delta tones --
 * and both times the drift was spotted by eye and fixed in two files.
 *
 * Both shapes are offered because both callers are right about what they need.
 * A widget builds DOM because it binds a row action and a keyboard shortcut to
 * the cell; config builds strings because a statistics tab is one innerHTML of
 * a panel it repaints wholesale. Feeding one builder from both keeps the
 * markup identical either way, which is the part that matters.
 *
 * The tile carries its own class as well as `stat-tile`, because each setting
 * has rules that genuinely belong to it: config's severity stripe, a widget
 * cell's ground. See static/css/stat-tile.css.
 */

/** The size names, mapped to what they mean rather than to pixels. */
const SIZES = { sm: 'stat-tile--sm', md: 'stat-tile--md' };

/** Tones a figure can carry. Anything else is left untoned rather than guessed. */
const TONES = ['good', 'warn', 'bad'];

/** Tones a delta can carry; neutral is the count that moved without a verdict. */
const DELTA_TONES = ['good', 'warn', 'bad', 'neutral'];

function esc(value) {
    return window.escapeHtml
        ? window.escapeHtml(String(value ?? ''))
        : String(value ?? '').replace(/[&<>"']/g, (ch) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ));
}

/**
 * The classes a tile carries, in one place so the DOM and string builders
 * cannot disagree about them.
 */
function tileClasses(spec) {
    const classes = ['stat-tile'];
    if (spec.size && SIZES[spec.size]) classes.push(SIZES[spec.size]);
    if (spec.variant) classes.push(spec.variant);
    if (spec.tone && TONES.includes(spec.tone)) classes.push(`stat-tile--${spec.tone}`);
    /*
     * Nought is marked here rather than in CSS because CSS cannot read a
     * value. What it buys is the tile's legibility: a readout of "0 kept, 4
     * lost, 0 died" was three figures in alarm colours, and the reader had to
     * check each one to find the single number that wanted them.
     */
    if (spec.quiet === true || (spec.quiet !== false && Number(spec.value) === 0)) {
        classes.push('is-quiet');
    }
    if (Array.isArray(spec.extraClasses)) classes.push(...spec.extraClasses.filter(Boolean));
    return classes;
}

function deltaClasses(spec) {
    const classes = ['stat-tile-delta'];
    if (spec.deltaTone && DELTA_TONES.includes(spec.deltaTone)) {
        classes.push(`stat-tile-delta--${spec.deltaTone}`);
    }
    return classes;
}

/** True when there is a change worth printing. An empty delta claims "unchanged". */
function hasDelta(spec) {
    return spec.delta !== undefined && spec.delta !== null && String(spec.delta) !== '';
}

const StatTile = {
    SIZES,
    TONES,
    DELTA_TONES,

    /**
     * The tile as an element.
     *
     * A button when it opens something, a plain div otherwise -- a figure that
     * leads nowhere should not be reachable by tab or announced as pressable.
     */
    build(spec = {}) {
        const el = document.createElement(spec.onOpen ? 'button' : 'div');
        if (spec.onOpen) el.type = 'button';
        el.className = tileClasses(spec).join(' ');

        const figure = document.createElement('span');
        figure.className = 'stat-tile-figure';

        const value = document.createElement('span');
        value.className = 'stat-tile-value';
        value.textContent = String(spec.value ?? '—');
        figure.appendChild(value);

        if (hasDelta(spec)) {
            const delta = document.createElement('span');
            delta.className = deltaClasses(spec).join(' ');
            delta.textContent = String(spec.delta);
            figure.appendChild(delta);
        }
        el.appendChild(figure);

        const label = document.createElement('span');
        label.className = 'stat-tile-label';
        label.textContent = String(spec.label || '');
        el.appendChild(label);

        if (spec.detail) {
            const detail = document.createElement('p');
            detail.className = 'stat-tile-detail';
            detail.textContent = String(spec.detail);
            el.appendChild(detail);
        }

        if (spec.title) el.title = String(spec.title);

        /*
         * Only where there is both a destination and a key -- a key printed on
         * a figure that leads nowhere is a promise the tile cannot keep.
         */
        if (spec.onOpen && spec.key) {
            const chip = document.createElement('kbd');
            chip.className = 'stat-tile-key';
            chip.textContent = String(spec.key);
            chip.setAttribute('aria-hidden', 'true');
            el.appendChild(chip);
            el.setAttribute('aria-keyshortcuts', String(spec.key));
        }

        if (spec.ariaLabel) el.setAttribute('aria-label', String(spec.ariaLabel));
        if (spec.role) el.setAttribute('role', String(spec.role));
        return el;
    },

    /**
     * The tile as markup.
     *
     * `hideParts` marks the pieces aria-hidden so the tile can carry the whole
     * reading as its own label -- "1,284" and "bookmarks" announced as two
     * separate things is not what the figure says. It only applies where the
     * caller also supplies that label: hiding the parts without one leaves a
     * tile a screen reader cannot read at all.
     */
    html(spec = {}) {
        const hidden = spec.hideParts !== false && spec.ariaLabel ? ' aria-hidden="true"' : '';
        const deltaClass = [...deltaClasses(spec), (spec.partClass || {}).delta].filter(Boolean).join(' ');
        const delta = hasDelta(spec)
            ? `<span class="${deltaClass}">${esc(spec.delta)}${
                spec.deltaNote ? ` <span class="stat-tile-delta-period">${esc(spec.deltaNote)}</span>` : ''
            }</span>`
            : '';
        const parts = spec.partClass || {};
        const detail = spec.detail
            ? `<p class="stat-tile-detail${(spec.partClass || {}).detail ? ` ${esc(spec.partClass.detail)}` : ''}"${hidden}>${esc(spec.detail)}</p>`
            : '';
        const label = spec.ariaLabel ? ` aria-label="${esc(spec.ariaLabel)}"` : '';
        const role = spec.role ? ` role="${esc(spec.role)}"` : '';
        // A tile that opens something is a button, and carries whatever the
        // caller needs to find it again on click. Passed through verbatim: the
        // caller has already escaped what it built.
        const tag = spec.tag === 'button' ? 'button' : 'div';
        const attrs = spec.attrs ? String(spec.attrs) : '';
        return `
                <${tag} class="${tileClasses(spec).join(' ')}"${role}${label}${attrs}>
                    <span class="stat-tile-label${parts.label ? ` ${esc(parts.label)}` : ''}"${hidden}>${esc(spec.label || '')}</span>
                    <span class="stat-tile-figure"${hidden}><span class="stat-tile-value${parts.value ? ` ${esc(parts.value)}` : ''}">${esc(spec.value ?? '—')}</span>${delta}</span>
                    ${detail}
                </${tag}>`;
    },
};

window.StatTile = StatTile;
