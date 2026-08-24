'use strict';

/**
 * The privacy setting promises every number is rounded into a band.
 *
 * The two snapshots kept that promise; the action events did not. A bulk
 * recheck reported `count: 37` and a health export `rows: 1274` — the first is
 * more than the question needs, the second is a fingerprint on a small install.
 * The rounding lives in nextdashTrack now, so a new event cannot reintroduce an
 * exact figure by forgetting to bucket it.
 *
 * Run with: node tests/analytics-count-buckets.test.cjs
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function loadTracker() {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'static', 'js', 'umami-analytics.js'), 'utf8');
    const sent = [];
    const listeners = {};
    global.window = { umami: { track: (name, props) => sent.push([name, props]) } };
    global.document = {
        currentScript: {
            getAttribute: (attr) => ({
                'data-nextdash-analytics': 'on',
                'data-website-id': 'test',
                'data-analytics-src': 'https://stats.example/script.js',
                'data-release': 'v1.3.2',
            })[attr] || '',
        },
        querySelector: () => null,
        createElement: () => ({
            addEventListener(type, fn) { listeners[type] = fn; },
            setAttribute() {},
        }),
        head: { appendChild() {} },
    };
    new Function(src)();
    // Events fired before the real tracker loads are queued and flushed on its
    // load event, which is where a browser would deliver them.
    const flush = () => listeners.load?.();
    return { window: global.window, sent, flush };
}

const { window: w } = loadTracker();
const bucket = w.nextdashBucketCount;

// Small numbers keep their own band: "one row" and "five rows" are different
// answers about how people work, and neither describes a collection.
assert.strictEqual(bucket(0), '0');
assert.strictEqual(bucket(1), '1');
assert.strictEqual(bucket(2), '2');
assert.strictEqual(bucket(4), '5');
assert.strictEqual(bucket(11), '25');
assert.strictEqual(bucket(37), '50');
assert.strictEqual(bucket(1274), '100+');

// The rounding happens on the way out, whatever the call site passed.
const { window: w2, sent, flush } = loadTracker();
w2.nextdashTrack('health:bulk-recheck', { count: 37 });
w2.nextdashTrack('health:export', { rows: '1274' });
// An index and a walkthrough step are small fixed ranges that say nothing about
// size, so they go out as they are — bucketing them would lose the answer.
w2.nextdashTrack('page-switch', { index: 3 });
w2.nextdashTrack('inbox-tutorial:finished', { outcome: 'finished', step: 4 });
// A value that is already a band survives untouched.
w2.nextdashTrack('bookmark:move', { size: '6-20' });

flush();

assert.deepStrictEqual(sent.map(([name, props]) => [name, props]), [
    ['health:bulk-recheck', { count: '50' }],
    ['health:export', { rows: '100+' }],
    ['page-switch', { index: 3 }],
    ['inbox-tutorial:finished', { outcome: 'finished', step: 4 }],
    ['bookmark:move', { size: '6-20' }],
]);

console.log('ok  analytics counts are bucketed on the way out');
