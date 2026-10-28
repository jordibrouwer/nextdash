'use strict';

/**
 * The digest card's rules, without a browser: snooze, "Got it" and the two
 * reminders after it.
 *
 * Run with: node tests/digest-card-state.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'static', 'js', 'digest-card-state.js'), 'utf8'))();
const S = window.DigestCardState;

const at = (d, h = 9) => new Date(2026, 9, d, h, 0, 0).getTime(); // October 2026, local time
const G = at(12, 8);

// A fresh digest shows.
assert.strictEqual(S.shouldShow(S.initial(G), at(12)), true);

// Snooze hides it for the rest of today and brings it back tomorrow, still unseen.
let s = S.snooze(S.initial(G), at(12));
assert.strictEqual(S.shouldShow(s, at(12, 23)), false);
assert.strictEqual(S.shouldShow(s, at(13, 0)), true);
assert.strictEqual(s.seenAt, 0, 'snoozing is not seeing');

// "Got it" is not shown again the same day.
s = S.gotIt(S.initial(G), at(12));
assert.strictEqual(S.shouldShow(s, at(12, 18)), false);

// Reminder one: the next day, once.
assert.strictEqual(S.shouldShow(s, at(13)), true);
s = S.shown(s, at(13));
assert.strictEqual(S.shouldShow(s, at(13, 20)), false, 'once a day');

// Reminder two: the day after, once.
assert.strictEqual(S.shouldShow(s, at(14)), true);
s = S.shown(s, at(14));
assert.strictEqual(S.shouldShow(s, at(14, 20)), false);

// Then nothing until the next digest.
assert.strictEqual(S.shouldShow(s, at(15)), false);
assert.strictEqual(S.shouldShow(s, at(19)), false);

// Skipping day one still gives reminder two, and only that one.
s = S.gotIt(S.initial(G), at(12));
assert.strictEqual(S.shouldShow(s, at(14)), true);
s = S.shown(s, at(14));
assert.strictEqual(S.shouldShow(s, at(14, 20)), false);
assert.strictEqual(S.shouldShow(s, at(15)), false);

// A reader who closed the window gets no reminders.
s = S.closeWindow(S.gotIt(S.initial(G), at(12)));
assert.strictEqual(S.shouldShow(s, at(13)), false);
assert.strictEqual(S.shouldShow(s, at(14)), false);

// Closing the window before "Got it" changes nothing until then.
s = S.closeWindow(S.initial(G));
assert.strictEqual(S.shouldShow(s, at(12)), true);

// A new digest starts over.
const old = S.closeWindow(S.gotIt(S.initial(G), at(12)));
const fresh = S.forSnapshot(old, at(19, 8));
assert.strictEqual(fresh.generatedAt, at(19, 8));
assert.strictEqual(S.shouldShow(fresh, at(19)), true);
assert.strictEqual(S.forSnapshot(old, G), old, 'the same digest keeps its state');
assert.strictEqual(S.forSnapshot(null, G).generatedAt, G);

// "Got it" on a reminder does not start the reminders over: two, then quiet.
s = S.gotIt(S.initial(G), at(12));
s = S.shown(s, at(13));
s = S.gotIt(s, at(13));
assert.strictEqual(S.shouldShow(s, at(14)), true, 'the second reminder still comes');
s = S.shown(s, at(14));
s = S.gotIt(s, at(14));
assert.strictEqual(S.shouldShow(s, at(15)), false, 'no third reminder, however often Got it was pressed');
assert.strictEqual(S.shouldShow(s, at(17)), false);

console.log('digest-card-state: ok');
