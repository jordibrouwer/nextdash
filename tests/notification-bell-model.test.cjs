'use strict';

/**
 * The notifications bell's rules, without a browser: what counts as worse,
 * which rows show, which are unread, and what the badge adds up to.
 *
 * Run with: node tests/notification-bell-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'notification-bell-model.js'), 'utf8'))();
const M = window.NotificationBellModel;

// isWorse
assert.strictEqual(M.isWorse(null, { count: 3 }), true);
assert.strictEqual(M.isWorse({ count: 52 }, { count: 51 }), false);
assert.strictEqual(M.isWorse({ count: 52 }, { count: 53 }), true);
assert.strictEqual(M.isWorse({ count: 1, ids: ['a'] }, { count: 1, ids: ['b'] }), true);
assert.strictEqual(M.isWorse({ count: 1, ids: ['a'] }, { count: 1, ids: ['a'] }), false);
assert.strictEqual(M.isWorse({ count: 1 }, { count: 1, ids: ['a'] }), true, 'missing prev ids count as empty');
assert.strictEqual(M.isWorse({ count: 48 }, { count: 67 }, 20), false);
assert.strictEqual(M.isWorse({ count: 48 }, { count: 68 }, 20), true);

// rowStatus: quiet row
const quiet = { id: 'q', kind: 'quiet', count: 5, no: 'state' };
assert.deepStrictEqual(M.rowStatus(quiet, {}), { visible: true, unread: true });
assert.deepStrictEqual(M.rowStatus(quiet, { read: { count: 5 } }), { visible: true, unread: false });
assert.deepStrictEqual(M.rowStatus(quiet, { read: { count: 4 } }), { visible: true, unread: true }, 'worse than read is unread again');

// "No, forever" hides the row whatever the count
assert.strictEqual(M.rowStatus({ ...quiet, count: 99 }, { no: { count: 1, forever: true } }).visible, false);
assert.strictEqual(M.rowStatus({ ...quiet, no: 'forever', count: 99 }, { no: { count: 1, forever: true } }).visible, false);
assert.strictEqual(M.rowStatus({ ...quiet, no: 'forever' }, {}).visible, true, 'nothing stored yet');

// "No" for a state: back only when worse
const st = { id: 's', kind: 'quiet', no: 'state' };
assert.strictEqual(M.rowStatus({ ...st, count: 12 }, { no: { count: 12 } }).visible, false);
assert.strictEqual(M.rowStatus({ ...st, count: 13 }, { no: { count: 12 } }).visible, true);

// "No" with a threshold
const th = { id: 't', kind: 'quiet', no: { threshold: 20 } };
assert.strictEqual(M.rowStatus({ ...th, count: 67 }, { no: { count: 48 } }).visible, false);
assert.strictEqual(M.rowStatus({ ...th, count: 68 }, { no: { count: 48 } }).visible, true);

// A tip that was read is gone
const tip = { id: 'p', kind: 'tip', count: 1, no: 'state' };
assert.strictEqual(M.rowStatus(tip, { read: { count: 1 } }).visible, false);
assert.deepStrictEqual(M.rowStatus(tip, {}), { visible: true, unread: true });

// badge
const rows = [
    { kind: 'urgent', unread: true, visible: true },
    { kind: 'quiet', unread: true, visible: true },
    { kind: 'tip', unread: true, visible: true },
    { kind: 'health', unread: true, visible: true },
    { kind: 'quiet', unread: false, visible: true },
    { kind: 'urgent', unread: true, visible: false },
];
assert.deepStrictEqual(M.badge(rows), { red: 1, grey: 2 });
assert.deepStrictEqual(M.badge([]), { red: 0, grey: 0 });

assert.deepStrictEqual(M.GROUP_ORDER, ['health', 'cleanup', 'system', 'privacy', 'tips']);

console.log('notification-bell-model: ok');
