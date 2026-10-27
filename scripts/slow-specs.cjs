#!/usr/bin/env node
'use strict';

/**
 * Which specs take the time, from the JSON reports a full CI run uploads.
 *
 * Every e2e shard writes playwright-json/shard-N.json and uploads it as the
 * artifact playwright-json-N. Download them into one folder and point this at
 * it:
 *
 *   gh run download <run id> --pattern 'playwright-json-*' --dir /tmp/pw
 *   node scripts/slow-specs.cjs /tmp/pw        the 20 slowest spec files
 *   node scripts/slow-specs.cjs /tmp/pw 40     the 40 slowest
 *
 * It prints the slowest files by the time their tests took (summed over the
 * workers, so a file with many tests shows more than the clock it held up),
 * and the time each shard took. scripts/balance-shards.cjs reads the same
 * reports and works out the shard weights.
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const top = Number(process.argv[3]) || 20;
if (!dir) {
    console.error('usage: node scripts/slow-specs.cjs <folder with the JSON reports> [how many]');
    process.exit(1);
}

function reports(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) return reports(full);
        return /shard-\d+\.json$/.test(entry.name) ? [full] : [];
    });
}

const files = reports(dir);
if (!files.length) {
    console.error(`no shard-N.json under ${dir}`);
    process.exit(1);
}

const perSpec = new Map();
const perShard = new Map();

function walk(suite, shard) {
    for (const spec of suite.specs || []) {
        for (const t of spec.tests || []) {
            for (const r of t.results || []) {
                const ms = Number(r.duration) || 0;
                perSpec.set(suite.file || spec.file, (perSpec.get(suite.file || spec.file) || 0) + ms);
                perShard.set(shard, (perShard.get(shard) || 0) + ms);
            }
        }
    }
    for (const child of suite.suites || []) walk({ ...child, file: child.file || suite.file }, shard);
}

for (const file of files) {
    const shard = Number(/shard-(\d+)\.json$/.exec(file)[1]);
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const suite of report.suites || []) walk(suite, shard);
    // The clock, not the sum: the run's own wall time for the shard.
    if (report.stats?.duration) perShard.set(`wall-${shard}`, Number(report.stats.duration));
}

console.log(`The ${top} slowest spec files (seconds of test time, summed over workers):`);
[...perSpec.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
    .forEach(([file, ms]) => console.log(`${String(Math.round(ms / 1000)).padStart(6)}  ${file}`));

const shards = [...new Set(files.map((f) => Number(/shard-(\d+)\.json$/.exec(f)[1])))].sort((a, b) => a - b);
const wall = shards.map((s) => Math.round((perShard.get(`wall-${s}`) || 0) / 1000));
console.log('\nWall time per shard (seconds):');
shards.forEach((s, i) => console.log(`${String(s).padStart(6)}  ${wall[i]}`));
