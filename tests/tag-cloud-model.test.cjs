'use strict';

/**
 * The tag cloud's arithmetic, without a browser.
 *
 * Which tags are big, in what order they stand, and how many bookmarks a tag
 * would add to a filter that is already on.
 *
 * Run with: node tests/tag-cloud-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'shared', 'tag-cloud-model.js'), 'utf8'))();
const model = window.TagCloudModel;

const bm = (...tags) => ({ tags });
const tagsFrom = (spec) => Object.entries(spec).flatMap(([tag, n]) => Array.from({ length: n }, () => bm(tag)));

// countTags: count desc, name asc; tags normalised.
{
    const ranked = model.countTags([bm('Dev', ' docs '), bm('dev'), bm('apps'), bm('docs'), bm('')]);
    assert.deepStrictEqual(ranked, [
        { tag: 'dev', count: 2 },
        { tag: 'docs', count: 2 },
        { tag: 'apps', count: 1 },
    ]);
}

// rankClasses: there is always a large tag, however few tags there are.
for (const n of [1, 2, 21]) {
    const spec = Object.fromEntries(Array.from({ length: n }, (_, i) => [`t${String(i).padStart(2, '0')}`, n - i]));
    const classes = model.rankClasses(model.countTags(tagsFrom(spec)));
    const values = [...classes.values()];
    assert.ok(values.includes('L'), `${n} tags: no large tag`);
    assert.strictEqual(values.length, n);
    if (n === 21) {
        assert.strictEqual(values.filter((c) => c === 'L').length, 3);
        assert.strictEqual(values.filter((c) => c === 'M').length, 6);
        assert.strictEqual(values.filter((c) => c === 'S').length, 12);
    }
}

// rankClasses: tags with the same count share a size -- the lower one, so a
// tie does not split across the line -- and the most used are always large.
{
    const ranked = model.countTags(tagsFrom({ homelab: 8, dev: 7, docs: 2, tutorial: 2, a: 1, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1, j: 1, k: 1, l: 1, m: 1, n: 1, o: 1, p: 1, q: 1 }));
    const classes = model.rankClasses(ranked);
    assert.strictEqual(classes.get('docs'), classes.get('tutorial'), 'a tie split across sizes');
    const ones = new Set(['a', 'b', 'q'].map((t) => classes.get(t)));
    assert.strictEqual(ones.size, 1, 'the ones split across sizes');
    assert.strictEqual(classes.get('homelab'), 'L');

    const flat = model.rankClasses(model.countTags(tagsFrom({ x: 3, y: 3, z: 3, w: 3, v: 3, u: 3, t: 3, s: 3, r: 3 })));
    assert.ok([...flat.values()].every((c) => c === 'L'), 'all tied: all large, never none');
}

// orderForDisplay: class first, alphabetical within a class.
{
    const ranked = model.countTags(tagsFrom({ zeta: 9, alpha: 8, mid: 3, beta: 2, gamma: 2, aaa: 1, delta: 1, eps: 1, omega: 1 }));
    const classes = model.rankClasses(ranked);
    const order = model.orderForDisplay(ranked, classes);
    const byClass = (c) => order.filter((t) => classes.get(t) === c);
    for (const c of ['L', 'M', 'S']) {
        const group = byClass(c);
        assert.deepStrictEqual(group, [...group].sort((a, b) => a.localeCompare(b)), `class ${c} not alphabetical`);
    }
    const firstS = order.findIndex((t) => classes.get(t) === 'S');
    const lastM = order.map((t) => classes.get(t)).lastIndexOf('M');
    assert.ok(lastM < firstS, 'a small tag stands before a medium one');
}

// plusCounts: only bookmarks that are not already in the result count.
{
    const pool = [bm('homelab', 'docker'), bm('homelab', 'docker'), bm('docker'), bm('dev', 'docker'), bm('network', 'homelab'), bm('dev')];
    const plus = model.plusCounts(pool, ['homelab', 'dev']);
    assert.strictEqual(plus.get('docker') || 0, 1, 'docker adds only the bookmark tagged docker alone');
    assert.strictEqual(plus.get('network') || 0, 0);
    assert.strictEqual(plus.get('homelab') || 0, 0);
    assert.strictEqual(model.plusCounts(pool, []).size, 0);
}

// matchQuery: case-insensitive substring position.
assert.strictEqual(model.matchQuery('Docker', 'ock'), 1);
assert.strictEqual(model.matchQuery('docker', 'x'), -1);
assert.strictEqual(model.matchQuery('docker', ''), -1);

console.log('tag-cloud-model: ok');
