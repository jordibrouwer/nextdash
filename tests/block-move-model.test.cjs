'use strict';
/**
 * Block moving, without a browser.
 *
 * Run with: node tests/block-move-model.test.cjs
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'block-move-model.js'), 'utf8'))();
const M = window.BlockMoveModel;

// insertAt
assert.deepStrictEqual(M.insertAt(['a', 'b', 'c', 'd'], 'a', 2), ['b', 'c', 'a', 'd']);
assert.deepStrictEqual(M.insertAt(['a', 'b', 'c'], 'c', 0), ['c', 'a', 'b']);
assert.deepStrictEqual(M.insertAt(['a', 'b', 'c'], 'b', 99), ['a', 'c', 'b']);
assert.deepStrictEqual(M.insertAt(['a', 'b', 'c'], 'b', -5), ['b', 'a', 'c']);

// targetFromPoint: three blocks in a row, 100 wide, 10 apart; moving 'a'.
const rects = [
    { id: 'a', x: 0, y: 0, w: 100, h: 50 },
    { id: 'b', x: 110, y: 0, w: 100, h: 50 },
    { id: 'c', x: 220, y: 0, w: 100, h: 80 },
    { id: 'd', x: 0, y: 90, w: 100, h: 40 },
];
// Left half of b: before b (index 0 in [b,c,d]).
assert.strictEqual(M.targetFromPoint(rects, { x: 130, y: 20 }, 'a'), 0);
// Right half of b: after b.
assert.strictEqual(M.targetFromPoint(rects, { x: 190, y: 20 }, 'a'), 1);
// Right half of c: after c.
assert.strictEqual(M.targetFromPoint(rects, { x: 300, y: 20 }, 'a'), 2);
// In the gap below c, nearest is c, below its centre: after c.
assert.strictEqual(M.targetFromPoint(rects, { x: 270, y: 85 }, 'a'), 2);
// Over the moving block itself counts as its neighbours: nearest other block.
assert.strictEqual(M.targetFromPoint(rects, { x: 10, y: 120 }, 'a'), 2); // left half of d: before d
assert.strictEqual(M.targetFromPoint([], { x: 0, y: 0 }, 'a'), 0);
// Over the moving block's own place it stays there: a press that has not
// crossed a centre yet moves nothing.
assert.strictEqual(M.targetFromPoint(rects, { x: 10, y: 20 }, 'a'), 0);
assert.strictEqual(M.targetFromPoint(rects, { x: 190, y: 20 }, 'b'), 1);
assert.strictEqual(M.targetFromPoint(rects, { x: 50, y: 100 }, 'd'), 3);

// seams and width
const seams = M.seamCentres(0, 100, 10, 3); // gutters at 105 and 215
assert.deepStrictEqual(seams, [105, 215]);
assert.strictEqual(M.widthFromSeam(105, seams), 2);
assert.strictEqual(M.widthFromSeam(130, seams), 2);  // 25 px away
assert.strictEqual(M.widthFromSeam(132, seams), 1);  // 27 px away
assert.strictEqual(M.widthFromSeam(50, seams), 1);
assert.strictEqual(M.widthFromSeam(50, []), 1);

// describePlace
const names = { a: 'Media', b: 'Network', c: 'Dev' };
assert.deepStrictEqual(M.describePlace(['a', 'b', 'c'], 'a', (id) => names[id]), { key: 'first' });
assert.deepStrictEqual(M.describePlace(['b', 'a', 'c'], 'a', (id) => names[id]), { key: 'after', name: 'Network' });

// stepTarget: 3 columns, 6 slots (0..5)
assert.strictEqual(M.stepTarget(2, 'ArrowLeft', 3, 5), 1);
assert.strictEqual(M.stepTarget(0, 'ArrowLeft', 3, 5), 0);
assert.strictEqual(M.stepTarget(1, 'ArrowDown', 3, 5), 4);
assert.strictEqual(M.stepTarget(4, 'ArrowDown', 3, 5), 5);
assert.strictEqual(M.stepTarget(4, 'ArrowUp', 3, 5), 1);
assert.strictEqual(M.stepTarget(1, 'ArrowUp', 3, 5), 0);

console.log('block-move-model: ok');
