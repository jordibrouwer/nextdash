'use strict';

/**
 * The response-time trend of a network check, without a browser: when a
 * sparkline is worth drawing, where its line breaks, and what the chart is
 * given for a range.
 *
 * Run with: node tests/net-trend.test.cjs
 */

const path = require('path');
const assert = require('assert');

global.window = global;
require(path.join(__dirname, '..', 'static', 'js', 'shared', 'net-trend.js'));
const T = global.NetTrend;

// Two readings are the least that makes a line.
assert.strictEqual(T.hasSpark(null), false);
assert.strictEqual(T.hasSpark([0, 0, 40, 0]), false);
assert.strictEqual(T.hasSpark([0, 30, 40]), true);
assert.strictEqual(T.sparkSvg([0, 0, 0], {}), '');

// A slice with no check (0) breaks the line; one that failed (-1) breaks it and is marked.
const svg = T.sparkSvg([10, 20, 0, 30, 40, -1, 50, 60], { width: 80, height: 20 });
assert.strictEqual((svg.match(/M[\d.]+,/g) || []).length, 3, 'three runs of readings: ' + svg);
assert.strictEqual((svg.match(/net-spark-fail/g) || []).length, 1);
assert.ok(!svg.includes('net-spark-thr'));

// The limit is drawn only when it is near the line, and the end dot says "slow" past it.
assert.ok(T.sparkSvg([100, 120, 140], { maxMs: 150 }).includes('net-spark-thr'));
assert.ok(!T.sparkSvg([10, 12, 14], { maxMs: 5000 }).includes('net-spark-thr'), 'a limit far above the line is left out');
assert.ok(T.sparkSvg([100, 120, 200], { maxMs: 150 }).includes('is-slow'));

// The accessible name ends in the newest value.
assert.ok(T.sparkSvg([100, 200, 412], { label: 'Response time' }).includes('Response time 412 ms'));

assert.strictEqual(T.formatMs(412), '412 ms');
assert.strictEqual(T.formatMs(2400), '2.4 s');
assert.strictEqual(T.lastValue([10, 20, 0, -1]), 20);

// Only a change worth a word has a percentage.
assert.strictEqual(T.deltaPercent([30, 31, 29, 30, 31]), 0);
assert.strictEqual(T.deltaPercent([100, 100, 100, 100, 230]), 130);
assert.strictEqual(T.deltaPercent([100, 100]), 0);

// The chart: the mean always, the peak when it differs, the limit when it is near, failures as marks.
const data = {
  range: '24h', avg: 120, maxMs: 300,
  points: [
    { t: 0, w: 900000, a: 100, x: 140, n: 3 },
    { t: 900000, w: 900000, n: 2, f: 2 },
    { t: 1800000, w: 900000, a: 150, x: 150, n: 3 },
  ],
};
const spec = T.chartSpec(data);
assert.deepStrictEqual(spec.series.map((s) => s.label), ['Average', 'Slowest', 'Limit', 'Failed']);
assert.deepStrictEqual(spec.series[0].values, [100, null, 150], 'a stretch with no success is a gap');
assert.deepStrictEqual(spec.series[3].values, [null, 0, null]);
assert.strictEqual(spec.x[0], 450);
assert.ok(spec.text(1).includes('2 failed'));

// A check that never failed and has no limit draws one line.
const plain = T.chartSpec({ range: '7d', avg: 50, points: [{ t: 0, w: 7200000, a: 50, x: 50, n: 4 }, { t: 7200000, w: 7200000, a: 60, x: 60, n: 4 }] });
assert.deepStrictEqual(plain.series.map((s) => s.label), ['Average']);

console.log('net-trend: ok');
