#!/usr/bin/env node
'use strict';

/**
 * Weights for Playwright's shards, from how long each shard took last time.
 *
 * Playwright cuts the suite into contiguous slices by test count, so a slice
 * that happens to hold slow specs finishes last and sets the length of the
 * whole run: in run 40355951298 the shards took 194 to 690 seconds. This
 * prints PWTEST_SHARD_WEIGHTS, one weight per shard joined with ":", that
 * gives a shard that ran fast a bigger slice and one that ran slow a smaller
 * one: a shard's weight is the mean time over its own time, as a percentage.
 *
 * The times are in tests/shard-times.json. They describe the slices of the
 * run they came from, so after the weights are used once the next run is the
 * better data: scripts/slow-specs.cjs reads the playwright-json artifacts of
 * a full run and prints the times to paste in. Weight a shard that is slow
 * because its tests wait on something only after looking at why (ci.yml says
 * what that cost once).
 *
 *   node scripts/shard-weights.cjs            the weights, for the workflow
 *   node scripts/shard-weights.cjs --explain  the table behind them
 */

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'tests', 'shard-times.json');
const { seconds } = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!Array.isArray(seconds) || seconds.length === 0 || seconds.some((s) => !(s > 0))) {
    console.error(`${file}: "seconds" must be a list of positive numbers`);
    process.exit(1);
}

const mean = seconds.reduce((a, b) => a + b, 0) / seconds.length;
const weights = seconds.map((s) => Math.max(1, Math.round((100 * mean) / s)));

if (process.argv.includes('--explain')) {
    console.log('shard  seconds  weight');
    seconds.forEach((s, i) => console.log(`${String(i + 1).padStart(5)}  ${String(s).padStart(7)}  ${String(weights[i]).padStart(6)}`));
    const total = weights.reduce((a, b) => a + b, 0);
    console.log(`\nslice of the suite, per shard: ${weights.map((w) => `${Math.round((100 * w) / total)}%`).join(' ')}`);
} else {
    console.log(weights.join(':'));
}
