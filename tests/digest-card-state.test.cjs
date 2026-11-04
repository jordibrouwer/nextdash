'use strict';

/**
 * The digest card's rules, without a browser: the card shows once per digest,
 * and "Got it" or the × ends it until the next digest.
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

// A fresh digest shows, on every load, until it is answered.
assert.strictEqual(S.shouldShow(S.initial(G), at(12)), true);
assert.strictEqual(S.shouldShow(S.initial(G), at(14)), true);

// "Got it" (and the x, which is the same call) ends the card for good.
let s = S.gotIt(S.initial(G), at(12));
assert.strictEqual(S.shouldShow(s, at(12, 18)), false);
for (const d of [13, 14, 15, 19]) assert.strictEqual(S.shouldShow(s, at(d)), false, `day ${d}`);

// Pressing it again keeps the first moment.
assert.strictEqual(S.gotIt(s, at(14)).seenAt, at(12));

// No snooze, no reminders, no window flag any more.
for (const gone of ['snooze', 'closeWindow', 'shown']) assert.strictEqual(S[gone], undefined, gone);
assert.deepStrictEqual(Object.keys(S.initial(G)).sort(), ['generatedAt', 'seenAt']);

// A new digest starts over.
const fresh = S.forSnapshot(s, at(19, 8));
assert.strictEqual(fresh.generatedAt, at(19, 8));
assert.strictEqual(S.shouldShow(fresh, at(19)), true);
assert.strictEqual(S.forSnapshot(s, G), s, 'the same digest keeps its state');
assert.strictEqual(S.forSnapshot(null, G).generatedAt, G);

// State stored by an older version, with the extra fields, still loads: a
// seenAt for the same digest is seen, an unseen one still shows.
const legacySeen = { generatedAt: G, seenAt: at(12), snoozedUntil: 0, remindersDone: 0, windowClosed: false };
assert.strictEqual(S.shouldShow(S.forSnapshot(legacySeen, G), at(13)), false);
const legacyUnseen = { generatedAt: G, seenAt: 0, snoozedUntil: at(13, 0), remindersDone: 0, windowClosed: false };
assert.strictEqual(S.shouldShow(S.forSnapshot(legacyUnseen, G), at(12, 10)), true);

console.log('digest-card-state: ok');
