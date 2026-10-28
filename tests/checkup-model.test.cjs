'use strict';

/**
 * The checkup's steps, without a browser: which kinds of finding there are,
 * in which order, and which are left out because there is nothing in them.
 *
 * Run with: node tests/checkup-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'checkup-model.js'), 'utf8'))();
const { buildSteps } = window.CheckupModel;

const issue = (...flags) => ({ name: 'x', url: 'https://x', flags });

// Nothing at all: no steps (and no throw).
assert.deepStrictEqual(buildSteps({}), []);
assert.deepStrictEqual(buildSteps({ issues: [], structure: [], widgets: [] }), []);

// The order is fixed, and a step with nothing in it is left out.
const steps = buildSteps({
    issues: [issue('stale'), issue('broken'), issue('unused'), issue('duplicate'), issue('broken')],
    structure: [{ kind: 'category' }],
    widgets: [{ widgetId: 'w_1', state: 'error' }],
});
assert.deepStrictEqual(steps.map((s) => s.id), ['broken', 'duplicate', 'unused', 'stale', 'structure', 'widgets']);
assert.deepStrictEqual(steps.map((s) => s.count), [2, 1, 1, 1, 1, 1]);

// Only the bookmark steps lead to the Health view, by the filter of their own name.
assert.deepStrictEqual(steps.filter((s) => s.healthFilter).map((s) => s.healthFilter), ['broken', 'duplicate', 'unused', 'stale']);
assert.strictEqual(steps.find((s) => s.id === 'structure').healthFilter, undefined);
assert.strictEqual(steps.find((s) => s.id === 'widgets').healthFilter, undefined);

// An empty step is dropped.
assert.deepStrictEqual(buildSteps({ issues: [issue('stale')] }).map((s) => s.id), ['stale']);

// A bookmark with several flags counts once in each of its steps.
const many = buildSteps({ issues: [issue('broken', 'duplicate')] });
assert.deepStrictEqual(many.map((s) => [s.id, s.count]), [['broken', 1], ['duplicate', 1]]);

// Widgets that are fine do not count; the registry only lists the others, but a stray "ok" is ignored too.
assert.deepStrictEqual(buildSteps({ widgets: [{ widgetId: 'a', state: 'ok' }] }), []);
assert.strictEqual(buildSteps({ widgets: [{ widgetId: 'a', state: 'empty' }, { widgetId: 'b', state: 'error' }] })[0].count, 2);

// Issues without flags, or of kinds the checkup does not walk, are ignored.
assert.deepStrictEqual(buildSteps({ issues: [{ name: 'x' }, issue('content'), issue('unchecked')] }), []);

console.log('checkup-model: ok');
