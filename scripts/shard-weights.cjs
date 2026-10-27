#!/usr/bin/env node
'use strict';

/**
 * PWTEST_SHARD_WEIGHTS for the e2e job: one weight per shard, joined with ":".
 *
 * Playwright cuts the suite into contiguous slices by test count, and a
 * weight sets the share of the tests a slice gets. The weights are in
 * tests/shard-weights.json, made by scripts/balance-shards.cjs from the cost
 * of every spec file in a full run, so that each slice costs about the same.
 * Weights guessed from shard times alone went wrong once: the cheapest slice
 * was handed 919 tests and ran for 19 minutes.
 *
 * Prints nothing, and exits 0, when the file does not have one weight per
 * shard, so a run with another shard count is simply not weighted.
 *
 *   node scripts/shard-weights.cjs [shards]   the weights, for the workflow
 */

const fs = require('fs');
const path = require('path');

const shards = Number(process.argv[2]) || 12;
const file = path.join(__dirname, '..', 'tests', 'shard-weights.json');
const { weights } = JSON.parse(fs.readFileSync(file, 'utf8'));

if (!Array.isArray(weights) || weights.some((w) => !(w > 0))) {
    console.error(`${file}: "weights" must be a list of positive numbers`);
    process.exit(1);
}
if (weights.length === shards) console.log(weights.join(':'));
