'use strict';

/**
 * The workbench's arithmetic, without a browser.
 *
 * Run with: node tests/bookmark-workbench-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'bookmark-workbench-model.js'), 'utf8'))();
const M = window.BookmarkWorkbenchModel;

// healthState
assert.strictEqual(M.healthState({ checkStatus: false }, null), 'unchecked');
assert.strictEqual(M.healthState({ checkStatus: true }, null), 'healthy');
assert.strictEqual(M.healthState({ checkStatus: true }, { brokenSince: 5 }), 'broken');
assert.strictEqual(M.healthState({ checkStatus: true }, { monitor: true, downSince: 9 }), 'down');
// a monitor that is down outranks an older broken mark
assert.strictEqual(M.healthState({ checkStatus: true }, { monitor: true, downSince: 9, brokenSince: 5 }), 'down');

// facetCounts: each facet counts with the others applied, not itself
const list = [
    { pageId: 1, tags: ['a'] },
    { pageId: 1, tags: ['b'] },
    { pageId: 2, tags: ['a'] },
];
const pageFilter = '1';
const tagFilter = ['a'];
const counts = M.facetCounts(list, {
    page: { keys: (b) => [String(b.pageId)], test: (b) => String(b.pageId) === pageFilter },
    tag: { keys: (b) => b.tags, test: (b) => b.tags.some((t) => tagFilter.includes(t)) },
});
assert.strictEqual(counts.page.get('1'), 1, 'page 1 under tag a');
assert.strictEqual(counts.page.get('2'), 1, 'page 2 under tag a, page filter ignored');
assert.strictEqual(counts.tag.get('a'), 1, 'tag a on page 1');
assert.strictEqual(counts.tag.get('b'), 1, 'tag b on page 1, tag filter ignored');

// buildItems
const rows = [
    { name: 'x', g: 'W' }, { name: 'y', g: 'W' }, { name: 'z', g: 'H' },
];
const grouped = M.buildItems(rows, { grouped: true, groupKey: (b) => b.g, groupLabel: (b) => `L${b.g}` });
assert.deepStrictEqual(grouped.map((i) => i.type), ['head', 'row', 'row', 'head', 'row']);
assert.deepStrictEqual(grouped[0], { type: 'head', key: 'W', label: 'LW', count: 2 });
assert.strictEqual(grouped[1].groupStart, true);
assert.strictEqual(grouped[2].groupEnd, true);
assert.strictEqual(grouped[4].index, 2);
const flat = M.buildItems(rows, { grouped: false });
assert.deepStrictEqual(flat.map((i) => i.type), ['row', 'row', 'row']);
assert.strictEqual(flat[0].groupStart, true);
assert.strictEqual(flat[2].groupEnd, true);

// itemWindow
const many = M.buildItems(Array.from({ length: 300 }, (_, i) => ({ g: i < 150 ? 'A' : 'B' })),
    { grouped: true, groupKey: (b) => b.g, groupLabel: (b) => b.g });
assert.strictEqual(M.itemWindow(many.slice(0, 50), { scrollTop: 0, viewport: 800, rowHeight: 44, headHeight: 32 }), null);
const w = M.itemWindow(many, { scrollTop: 44 * 100, viewport: 440, rowHeight: 44, headHeight: 32, overscan: 5 });
assert.ok(w.start > 0 && w.end < many.length);
assert.strictEqual(w.above, M.itemOffset(many, w.start, 44, 32));
const total = M.itemOffset(many, many.length, 44, 32);
assert.strictEqual(w.above + (M.itemOffset(many, w.end, 44, 32) - w.above) + w.below, total);
assert.strictEqual(M.itemOffset(many, 2, 44, 32), 32 + 44);

// sharedValue
assert.deepStrictEqual(M.sharedValue(['a', 'a']), { mixed: false, value: 'a' });
assert.deepStrictEqual(M.sharedValue(['a', 'b']), { mixed: true, value: null });
assert.deepStrictEqual(M.sharedValue([]), { mixed: false, value: null });

// tagCounts
assert.deepStrictEqual(M.tagCounts([{ tags: ['b', 'a'] }, { tags: ['a', ' '] }]), [['a', 2], ['b', 1]]);

// bulkMutation
const base = { name: 'n', category: 'c1', tags: ['x', 'y'], pinned: false };
assert.deepStrictEqual(M.bulkMutation({ category: 'c2' })(base).category, 'c2');
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'add', list: ['Y', 'z'] } })(base).tags, ['x', 'y', 'z']);
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'remove', list: ['x'] } })(base).tags, ['y']);
assert.deepStrictEqual(M.bulkMutation({ tags: { mode: 'replace', list: ['q'] } })(base).tags, ['q']);
assert.strictEqual(M.bulkMutation({ pinned: true })(base).pinned, true);
assert.strictEqual(base.pinned, false, 'input is not mutated');
const withMode = M.bulkMutation({ checkMode: 'monitor' }, (b, mode) => { b.mode = mode; })(base);
assert.strictEqual(withMode.mode, 'monitor');
assert.deepStrictEqual(M.bulkMutation({})(base), base);

// rangeKeys
assert.deepStrictEqual(M.rangeKeys(['a', 'b', 'c', 'd'], 'b', 'd'), ['b', 'c', 'd']);
assert.deepStrictEqual(M.rangeKeys(['a', 'b', 'c', 'd'], 'd', 'b'), ['b', 'c', 'd']);
assert.deepStrictEqual(M.rangeKeys(['a', 'b'], 'zz', 'b'), ['b']);

console.log('bookmark-workbench-model: ok');
