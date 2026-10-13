#!/usr/bin/env node
'use strict';

/**
 * Step 1 of the catalogue build: which sites to consider.
 *
 *   node scripts/tag-catalogue/candidates.cjs <crux-dir> [--max-rank 10000] [cc ...]
 *
 * <crux-dir> holds one <cc>.csv.gz per country from the Chrome UX Report top
 * lists (origin,rank; rank is a bucket: 1000, 5000, 10000, ...). Reads the
 * countries named, keeps origins up to --max-rank, reduces each to a bare host
 * the way patternsFor() does, and writes cache/candidates.json:
 *
 *   { "nu.nl": { "nl": 1000, "be": 10000 }, ... }
 *
 * Source: Chrome UX Report, CC-BY 4.0. Only the ranking is used, to choose
 * which sites to look up; the list itself is not shipped.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const dir = args.shift();
if (!dir) {
    console.error('usage: candidates.cjs <crux-dir> [--max-rank N] [cc ...]');
    process.exit(2);
}
let maxRank = 10000;
const at = args.indexOf('--max-rank');
if (at >= 0) {
    maxRank = Number(args[at + 1]);
    args.splice(at, 2);
}
const countries = args.length ? args : ['us', 'gb', 'nl', 'be'];

const out = {};
countries.forEach((cc) => {
    const file = path.join(dir, `${cc}.csv.gz`);
    const lines = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n');
    let kept = 0;
    lines.slice(1).forEach((line) => {
        const [origin, rankText] = line.split(',');
        const rank = Number(rankText);
        if (!origin || !rank || rank > maxRank) return;
        let host;
        try {
            host = new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
        } catch {
            return;
        }
        if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host)) return;
        out[host] = out[host] || {};
        if (!out[host][cc] || rank < out[host][cc]) out[host][cc] = rank;
        kept += 1;
    });
    console.log(`${cc}: ${kept} origins up to rank ${maxRank}`);
});

const cache = path.join(__dirname, 'cache');
fs.mkdirSync(cache, { recursive: true });
fs.writeFileSync(path.join(cache, 'candidates.json'), JSON.stringify(out));
console.log(`${Object.keys(out).length} distinct hosts -> cache/candidates.json`);
