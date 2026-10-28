'use strict';

/**
 * What the dashboard knows about how its widgets are doing, without a browser.
 *
 * Run with: node tests/widget-state.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'dashboard-widget-state.js'), 'utf8'))();
const W = window.WidgetState;

W.set('w_a', 'error', 'unreachable', { title: 'Weather', pageId: 2 });
assert.deepStrictEqual(W.snapshot(), [{ widgetId: 'w_a', state: 'error', reason: 'unreachable', title: 'Weather', pageId: 2 }]);

// A second report for the same widget replaces the first.
W.set('w_a', 'empty');
assert.deepStrictEqual(W.snapshot(), [{ widgetId: 'w_a', state: 'empty', reason: '', title: '', pageId: null }]);

// A widget that is fine is not listed.
W.set('w_a', 'ok');
assert.deepStrictEqual(W.snapshot(), []);

W.set('w_b', 'error', 'auth');
W.clear('w_b');
assert.deepStrictEqual(W.snapshot(), []);

// From a server answer.
W.fromResult('w_c', null, []);
assert.deepStrictEqual(W.snapshot().map((e) => [e.widgetId, e.state]), [['w_c', 'error']], 'no answer is an error');
W.fromResult('w_c', { error: 'auth' }, []);
assert.strictEqual(W.snapshot()[0].reason, 'auth');
W.fromResult('w_c', { error: 'unreachable', items: [{ title: 'old' }] }, [{ title: 'old' }]);
assert.strictEqual(W.snapshot()[0].state, 'error', 'stale items under an error are still an error');
W.fromResult('w_c', { items: [] }, [], { emptyIsError: true });
assert.deepStrictEqual(W.snapshot().map((e) => [e.widgetId, e.state]), [['w_c', 'empty']], 'where nothing in it means misconfigured, it is empty');
W.fromResult('w_c', { items: [] }, []);
assert.deepStrictEqual(W.snapshot(), [], 'where nothing in it is a fine answer (nothing queued, nothing playing), it is not listed');
W.fromResult('w_c', { items: [] }, [], { title: 'Feed', pageId: 3, emptyIsError: true });
assert.deepStrictEqual(W.snapshot().map((e) => [e.title, e.pageId]), [['Feed', 3]], 'the title and page travel with the report');
W.fromResult('w_c', { items: [{ title: 'x' }] }, [{ title: 'x' }]);
assert.deepStrictEqual(W.snapshot(), [], 'an answer with something is fine');

// Several, in a stable order (by id).
W.set('w_z', 'error', 'x');
W.set('w_m', 'empty');
assert.deepStrictEqual(W.snapshot().map((e) => e.widgetId), ['w_m', 'w_z']);

// A widget missing an id is ignored.
W.set('', 'error');
W.set(undefined, 'error');
assert.strictEqual(W.snapshot().length, 2);

console.log('widget-state: ok');
