#!/usr/bin/env node
'use strict';

/**
 * How often each domain made it onto Hacker News, as evidence for the
 * Lobsters harvest.
 *
 *   node scripts/tag-catalogue/harvest-hn.cjs [--years 5] [--points 100]
 *
 * Asks the public HN search API (hn.algolia.com) week by week for stories
 * with at least --points points and counts their domains. HN has no topic
 * tags, so this decides nothing by itself: harvest-lobsters.cjs reads
 * cache/hn-domains.json and accepts a domain on two agreeing Lobsters stories
 * instead of three when HN has seen it popular five times or more.
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const YEARS = opt('--years', 5);
const POINTS = opt('--points', 100);
const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const weeksFile = path.join(cacheDir, 'hn-weeks.json');
const weeks = fs.existsSync(weeksFile) ? JSON.parse(fs.readFileSync(weeksFile, 'utf8')) : {};
const outFile = path.join(cacheDir, 'hn-domains.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

async function week(from, to) {
    const key = `${from}:${POINTS}`;
    if (weeks[key]) return weeks[key];
    const query = new URLSearchParams({
        tags: 'story',
        numericFilters: `points>=${POINTS},created_at_i>=${from},created_at_i<${to}`,
        hitsPerPage: '1000',
        attributesToRetrieve: 'url',
    });
    const response = await fetch(`https://hn.algolia.com/api/v1/search_by_date?${query}`, {
        headers: { 'User-Agent': 'nextDash-catalogue-build/1.0' },
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`hn: ${response.status}`);
    const hosts = (await response.json()).hits.map((hit) => hostOf(hit.url)).filter(Boolean);
    weeks[key] = hosts;
    fs.writeFileSync(weeksFile, JSON.stringify(weeks));
    await sleep(400);
    return hosts;
}

async function main() {
    const now = Math.floor(Date.now() / 1000);
    const span = 7 * 24 * 3600;
    const counts = {};
    let n = 0;
    for (let to = now; to > now - YEARS * 365 * 24 * 3600; to -= span) {
        (await week(to - span, to)).forEach((host) => { counts[host] = (counts[host] || 0) + 1; });
        n += 1;
        if (n % 26 === 0) console.log(`  ${n} weeks`);
    }
    fs.writeFileSync(outFile, JSON.stringify(counts));
    const often = Object.values(counts).filter((c) => c >= 5).length;
    console.log(`${Object.keys(counts).length} domains, ${often} seen five times or more`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
