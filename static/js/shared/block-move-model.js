/**
 * The arithmetic of moving a block on the dashboard: where the pointer means,
 * what order that makes, how wide, and how to say it.
 *
 * Pure, so it is tested in node (tests/block-move-model.test.cjs) and the
 * mover in dashboard-block-mover.js only deals with the DOM.
 */
(function (global) {
    'use strict';

    /** The order without `id`, then `id` at `index`, clamped. */
    function insertAt(order, id, index) {
        const rest = order.filter((x) => x !== id);
        const at = Math.max(0, Math.min(rest.length, Math.trunc(Number(index) || 0)));
        rest.splice(at, 0, id);
        return rest;
    }

    /*
     * The index in the order without the moving block.
     *
     * Against the rectangles captured when the block was picked up, so the
     * page under the pointer is the page the reader sees. The block under the
     * pointer -- or the nearest one -- and before or after it by its centre: the
     * answer only changes when the pointer crosses a centre, which is what
     * keeps the landing box from flickering at the edges.
     */
    function targetFromPoint(rects, point, movingId) {
        const others = rects.filter((r) => r.id !== movingId);
        if (!others.length) return 0;
        // Over its own place the block stays there: a press on the handle, or
        // a jiggle, has not crossed a centre yet.
        const own = rects.findIndex((r) => r.id === movingId);
        const self = rects[own];
        if (self && point.x >= self.x && point.x <= self.x + self.w
            && point.y >= self.y && point.y <= self.y + self.h) return own;
        let best = 0;
        let bestDistance = Infinity;
        others.forEach((r, i) => {
            const dx = Math.max(r.x - point.x, 0, point.x - (r.x + r.w));
            const dy = Math.max(r.y - point.y, 0, point.y - (r.y + r.h));
            const d = Math.hypot(dx, dy);
            if (d < bestDistance) {
                bestDistance = d;
                best = i;
            }
        });
        const r = others[best];
        const inRowBand = point.y >= r.y && point.y <= r.y + r.h;
        const after = inRowBand ? point.x > r.x + r.w / 2 : point.y > r.y + r.h / 2;
        return best + (after ? 1 : 0);
    }

    /** The x of each gutter centre between columns. */
    function seamCentres(gridLeft, columnWidth, gap, columns) {
        const out = [];
        for (let c = 1; c < columns; c += 1) {
            out.push(gridLeft + c * columnWidth + (c - 0.5) * gap);
        }
        return out;
    }

    /** On a seam is wide, anywhere else one column. */
    function widthFromSeam(x, seams, slack = 26) {
        return seams.some((s) => Math.abs(x - s) <= slack) ? 2 : 1;
    }

    /** Where a block sits, as words: first, or after a named neighbour. */
    function describePlace(order, id, nameOf) {
        const i = order.indexOf(id);
        if (i <= 0) return { key: 'first' };
        return { key: 'after', name: nameOf(order[i - 1]) };
    }

    /** One place left/right, one row up/down, inside 0..max. */
    function stepTarget(index, key, columns, max) {
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[key] || 0;
        return Math.max(0, Math.min(max, index + step));
    }

    global.BlockMoveModel = { insertAt, targetFromPoint, seamCentres, widthFromSeam, describePlace, stepTarget };
})(window);
