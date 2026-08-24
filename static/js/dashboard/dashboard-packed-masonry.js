/**
 * Packed columns, packed for real.
 *
 * The old packed layout was a row of flex columns filled round-robin: category
 * 1 in column 1, category 2 in column 2, and so on. It looked packed because
 * columns grow independently, but nothing ever looked at how tall anything was,
 * and a category could not be wider than the column it was sitting in. Making
 * one wider therefore had to break the row in two, which left a hole the height
 * of the tallest column beside it.
 *
 * So packed is a grid now, the same grid the plain layout uses, with two
 * additions:
 *
 *   - every category spans as many short rows as it is tall, so blocks end
 *     where their content ends instead of at the bottom of a shared row;
 *   - `grid-auto-flow: dense` fills what is left. A category two columns wide
 *     takes two adjacent tracks wherever it fits, and the ones after it carry
 *     on beside and beneath it rather than waiting for a new band.
 *
 * The row unit is deliberately small: the finer it is, the closer a block ends
 * to its true height, at the cost of a longer implicit grid. Four pixels is
 * below what anyone can see and keeps the row count in the low hundreds.
 *
 * Heights are measured, so this has to run again whenever one changes —
 * collapsing a category, "+ N more", a favicon arriving, a narrower window. A
 * ResizeObserver covers all of them at once, which is why there is no list of
 * events here.
 */
(function (global) {
    'use strict';

    const ROW_PX = 4;

    let observer = null;
    let frame = 0;
    let observedGrid = null;

    function gridEl() {
        const el = document.getElementById('dashboard-layout');
        return el?.classList.contains('packed-columns') ? el : null;
    }

    /** The vertical gap between two categories, in pixels. */
    function gapPx(grid) {
        const raw = getComputedStyle(grid).getPropertyValue('--category-row-gap').trim();
        if (raw.endsWith('px')) {
            return parseFloat(raw) || 0;
        }
        if (raw.endsWith('rem')) {
            const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
            return (parseFloat(raw) || 0) * root;
        }
        return 32;
    }

    /**
     * Give every category the number of rows its height needs.
     *
     * The gap is part of the span rather than a margin: a margin would sit
     * outside the grid area and the next block would start that much too low,
     * which is visible as soon as two neighbours differ in height.
     */
    function sync(grid = gridEl()) {
        if (!grid) {
            return false;
        }
        const gap = gapPx(grid);
        const categories = Array.from(grid.querySelectorAll(':scope > .category'));
        if (!categories.length) {
            return false;
        }
        // Read every height first, then write every span. Interleaving the two
        // forced a full grid re-layout per category, on every render and on
        // every ResizeObserver fire -- i.e. continuously while dragging the
        // window. The comment below still holds: all reads happen before any
        // write, so no span is in place while a height is being measured.
        const spans = categories.map((el) => {
            // Measured without the span in place, or the previous value would
            // be measured back: the element is only as tall as its content, so
            // the row track it currently occupies must not constrain it.
            const height = el.getBoundingClientRect().height;
            return Math.max(1, Math.ceil((height + gap) / ROW_PX));
        });
        categories.forEach((el, i) => {
            el.style.setProperty('--masonry-span', String(spans[i]));
        });
        return true;
    }

    function schedule() {
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            sync();
        });
    }

    /**
     * Watch the categories on screen. Re-attached on every render, since the
     * elements are new ones by then.
     */
    function observe(grid = gridEl()) {
        if (!grid) {
            disconnect();
            return;
        }
        if (typeof ResizeObserver !== 'function') {
            sync(grid);
            return;
        }
        if (!observer) {
            observer = new ResizeObserver(() => schedule());
        }
        observer.disconnect();
        observedGrid = grid;
        grid.querySelectorAll(':scope > .category').forEach((el) => observer.observe(el));
        sync(grid);
    }

    function disconnect() {
        observer?.disconnect();
        observedGrid = null;
    }

    global.DashboardPackedMasonry = { sync, observe, disconnect, schedule, ROW_PX, get grid() { return observedGrid; } };
})(window);
