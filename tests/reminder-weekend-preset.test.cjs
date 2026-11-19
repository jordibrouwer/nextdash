'use strict';

/**
 * "This weekend" is the first Saturday or Sunday 09:00 still ahead.
 *
 * It stepped a day before it looked, so on a Saturday it named the Saturday a
 * week on, and on a Sunday the Saturday six days on.
 *
 * Run with: node tests/reminder-weekend-preset.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'dashboard', 'dashboard-reminders.js'), 'utf8'));
const reminders = new window.DashboardReminders({});

function weekend(now) {
    return new Date(reminders.presets(now).find((p) => p.key === 'weekend').at);
}

// Wednesday 18 November 2026, the weekend after it.
const cases = [
    ['Wednesday', new Date(2026, 10, 18, 14, 0), new Date(2026, 10, 21, 9, 0)],
    ['Friday evening', new Date(2026, 10, 20, 22, 0), new Date(2026, 10, 21, 9, 0)],
    ['Saturday morning', new Date(2026, 10, 21, 7, 30), new Date(2026, 10, 21, 9, 0)],
    ['Saturday afternoon', new Date(2026, 10, 21, 15, 0), new Date(2026, 10, 22, 9, 0)],
    ['Sunday morning', new Date(2026, 10, 22, 8, 0), new Date(2026, 10, 22, 9, 0)],
    ['Sunday afternoon', new Date(2026, 10, 22, 15, 0), new Date(2026, 10, 28, 9, 0)],
];

for (const [name, now, want] of cases) {
    assert.strictEqual(weekend(now).getTime(), want.getTime(), `${name}: got ${weekend(now)}`);
}
console.log(`ok ${cases.length} weekend cases`);
