'use strict';

/**
 * Which bookmarks you usually open at this time of day, without a browser.
 *
 * Run with: node tests/usually-now-model.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'search-usually-now.js'), 'utf8'))();
const { pick, usuallyNow } = window.SearchUsuallyNow;

// 2026-10-14 is a Wednesday. Local times throughout.
const at = (month, day, h, m = 0) => new Date(2026, month - 1, day, h, m, 0).getTime();
const NOW = at(10, 14, 9, 0); // Wednesday 09:00

// Three weekday opens around ten past nine, one, two and three weeks back.
const nineish = (name, extra = {}) => ({
    name, openCount: 3,
    openLog: [at(10, 7, 9, 10), at(9, 30, 9, 5), at(9, 23, 8, 55)],
    ...extra,
});

assert.deepStrictEqual(pick([nineish('A')], NOW).map((b) => b.name), ['A'], 'three weekday opens near 09:00 qualify');
assert.deepStrictEqual(pick([nineish('A')], at(10, 14, 14, 0)), [], 'not at 14:00');
assert.deepStrictEqual(pick([nineish('A')], at(10, 14, 10, 25)).map((b) => b.name), ['A'], 'inside 1.5 hours (the earliest open is exactly 90 minutes away)');
assert.deepStrictEqual(pick([nineish('A')], at(10, 14, 10, 41)), [], 'outside 1.5 hours');

// Weekend opens do not count on a weekday, and the reverse.
const weekend = { name: 'W', openCount: 3, openLog: [at(10, 10, 9, 10), at(10, 3, 9, 5), at(9, 26, 8, 55)] }; // Saturdays
assert.deepStrictEqual(pick([weekend], NOW), [], 'Saturday opens are not a Wednesday habit');
assert.deepStrictEqual(pick([weekend], at(10, 17, 9, 0)).map((b) => b.name), ['W'], 'but they are a Saturday habit');

// Older than eight weeks does not count; two opens are not enough.
const old = { name: 'Old', openCount: 3, openLog: [at(8, 12, 9, 10), at(8, 5, 9, 5), at(7, 29, 8, 55)] };
assert.deepStrictEqual(pick([old], NOW), [], 'more than eight weeks back');
assert.deepStrictEqual(pick([{ name: 'Two', openLog: [at(10, 7, 9, 10), at(9, 30, 9, 5)] }], NOW), [], 'two opens');

// The window wraps midnight, and the opened day decides the day kind: a Tuesday
// 23:50 open counts at Wednesday 00:30, a Saturday one does not.
const late = { name: 'Late', openCount: 3, openLog: [at(10, 6, 23, 50), at(9, 29, 23, 45), at(9, 22, 23, 55)] }; // Tuesdays
assert.deepStrictEqual(pick([late], at(10, 14, 0, 30)).map((b) => b.name), ['Late'], 'wraps midnight');
const lateWeekend = { name: 'LW', openCount: 3, openLog: [at(10, 10, 23, 50), at(10, 3, 23, 45), at(9, 26, 23, 55)] }; // Saturdays
assert.deepStrictEqual(pick([lateWeekend], at(10, 14, 0, 30)), [], 'day kind is the opened day, not the next one');

// More than three: the three best, ties by openCount; missing logs are skipped.
const many = [
    nineish('A', { openCount: 5 }), nineish('B', { openCount: 9 }), nineish('C', { openCount: 1 }),
    { name: 'D', openCount: 2, openLog: [at(10, 7, 9, 10), at(9, 30, 9, 5), at(9, 23, 8, 55), at(9, 16, 9, 0)] },
    { name: 'NoLog' },
];
assert.deepStrictEqual(pick(many, NOW).map((b) => b.name), ['D', 'B', 'A'], 'most in-window opens first, then openCount');
assert.deepStrictEqual(pick(many, NOW, { limit: 1 }).map((b) => b.name), ['D']);

// The group wants three habits: one or two are guesses, not a group.
const habit = (name) => nineish(name);
assert.deepStrictEqual(usuallyNow([habit('A'), habit('B')], NOW), [], 'two habits make no group');
assert.deepStrictEqual(usuallyNow([habit('A'), habit('B'), habit('C')], NOW).map((b) => b.name), ['A', 'B', 'C'], 'three do');
assert.deepStrictEqual(usuallyNow([habit('A'), habit('B'), habit('C'), habit('D')], NOW).length, 3, 'never more than three');

console.log('usually-now-model: ok');
