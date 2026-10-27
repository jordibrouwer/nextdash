#!/usr/bin/env node
'use strict';

/**
 * Shard weights from what each spec file really cost, not from how long a
 * shard took.
 *
 * Playwright cuts the suite, in file order, into as many slices as there are
 * shards, and a weight sets the share of the tests a slice gets. Weights taken
 * from shard times alone are a guess about tests nobody has timed: the first
 * set handed the cheapest slice 919 tests, where the others had 268 to 454,
 * and it ran for 19 minutes. A full CI run uploads a JSON report per shard
 * (playwright-json-N); this reads them, takes the cost of every spec file, lays
 * the files out in the order Playwright does, and cuts that line where the
 * running cost passes 1/12, 2/12 ... of the total. The weight of a shard is
 * then the number of tests in its slice.
 *
 *   gh run download <run id> --pattern 'playwright-json-*' --dir /tmp/pw
 *   node scripts/balance-shards.cjs /tmp/pw            prints the table
 *   node scripts/balance-shards.cjs /tmp/pw --write    writes tests/shard-weights.json
 *
 * Run it on the reports of an unweighted or a weighted run alike: the cost of
 * a file does not depend on which shard ran it. A file added since is not in
 * the report and counts as nothing, so rerun this after a big batch of specs.
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const write = process.argv.includes('--write');
const shards = Number((process.argv.find((a) => a.startsWith('--shards=')) || '--shards=12').split('=')[1]);
if (!dir) {
    console.error('usage: node scripts/balance-shards.cjs <folder with the JSON reports> [--write] [--shards=12]');
    process.exit(1);
}

function reports(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) return reports(full);
        return /shard-\d+\.json$/.test(entry.name) ? [full] : [];
    });
}

// file -> { tests, ms }. A test that was retried costs what its tries cost,
// which is what the shard paid for it.
const files = new Map();
function walk(suite, file) {
    const here = suite.file || file;
    for (const spec of suite.specs || []) {
        const entry = files.get(spec.file || here) || { tests: 0, ms: 0 };
        for (const t of spec.tests || []) {
            entry.tests += 1;
            for (const r of t.results || []) entry.ms += Number(r.duration) || 0;
        }
        files.set(spec.file || here, entry);
    }
    for (const child of suite.suites || []) walk(child, here);
}
for (const file of reports(dir)) {
    for (const suite of JSON.parse(fs.readFileSync(file, 'utf8')).suites || []) walk(suite, suite.file);
}
if (!files.size) {
    console.error(`no shard-N.json under ${dir}`);
    process.exit(1);
}

const ordered = [...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
const total = ordered.reduce((sum, [, v]) => sum + v.ms, 0);
const slices = Array.from({ length: shards }, () => ({ tests: 0, ms: 0, files: 0 }));

let running = 0;
let slice = 0;
for (const [, v] of ordered) {
    // The slice a file belongs to is the one its midpoint falls in.
    const mid = running + v.ms / 2;
    slice = Math.min(shards - 1, Math.floor((mid / total) * shards));
    slices[slice].tests += v.tests;
    slices[slice].ms += v.ms;
    slices[slice].files += 1;
    running += v.ms;
}

const weights = slices.map((s) => Math.max(1, s.tests));
const ideal = total / shards;
console.log('shard  files  tests  cost(s)  vs ideal  weight');
slices.forEach((s, i) => console.log(
    `${String(i + 1).padStart(5)}  ${String(s.files).padStart(5)}  ${String(s.tests).padStart(5)}  ${String(Math.round(s.ms / 1000)).padStart(7)}  ${(`${Math.round((100 * s.ms) / ideal)}%`).padStart(8)}  ${String(weights[i]).padStart(6)}`,
));
console.log(`\ntotal ${Math.round(total / 1000)} s over ${ordered.length} files; the slowest slice would be ${Math.round((100 * Math.max(...slices.map((s) => s.ms))) / ideal)}% of the ideal`);

if (write) {
    const out = path.join(__dirname, '..', 'tests', 'shard-weights.json');
    fs.writeFileSync(out, `${JSON.stringify({
        source: `scripts/balance-shards.cjs over the JSON reports of one full CI run; ${ordered.length} spec files`,
        weights,
    }, null, 2)}\n`);
    console.log(`wrote ${out}`);
}
