#!/usr/bin/env node
'use strict';

/**
 * Split broad subjects into the finer ones splits.json names.
 *
 *   node scripts/tag-catalogue/split.cjs
 *   node scripts/tag-catalogue/apply.cjs
 *
 * splits.json gives each child the Wikidata classes (instance of, P31), the
 * leagues (P118) or the sports (P641) that make a site one of its kind. Per class
 * or league one query fetches every item of it with an official website
 * (P856), the way byclass.cjs builds the catalogue: a few dozen queries
 * instead of one per host. A derived host of the broad subject that turns up
 * under a child's class moves to the first such child; the rest stay.
 *
 * The answers are cached in cache/split-classes.json. The result is
 * manual/splits.json, host -> tags: classify.cjs reads it as handwork and
 * apply.cjs writes it into the catalogue, so the split holds without the
 * cache. A host keeps its other subject; only the broad one is swapped.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';

const catalogueFile = path.join(__dirname, '..', '..', 'internal', 'app', 'tag_catalogue.json');
const doc = JSON.parse(fs.readFileSync(catalogueFile, 'utf8'));
const { splits } = JSON.parse(fs.readFileSync(path.join(__dirname, 'splits.json'), 'utf8'));
const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'split-classes.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const outFile = path.join(__dirname, 'manual', 'splits.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sparql(query, attempt = 1) {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/sparql-results+json',
            'User-Agent': AGENT,
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(120_000),
    }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return (await response.json()).results.bindings;
    if (attempt >= 4) throw new Error(`wikidata: status ${response.status}`);
    await sleep(response.status === 429 ? 60_000 : 5_000 * attempt);
    return sparql(query, attempt + 1);
}

function hostOf(site) {
    try {
        const url = new URL(site);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch {
        return '';
    }
}

/** Every host whose item is of this class (P31), in this league (P118) or of this sport (P641). */
async function hostsFor(key) {
    if (cache[key]) return cache[key];
    const [prop, q] = key.split(':');
    const rows = await sparql(`SELECT DISTINCT ?site WHERE { ?item wdt:${prop} wd:${q} ; wdt:P856 ?site . }`);
    cache[key] = [...new Set(rows.map((row) => hostOf(row.site.value)).filter(Boolean))];
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    console.log(`  ${key}: ${cache[key].length} sites`);
    await sleep(1000);
    return cache[key];
}

async function main() {
    // host -> the subjects it sits under now, children of an earlier run left out.
    const children = new Set(Object.values(splits).flat().filter((child) => !child.existing).map((child) => child.tag));
    const subjectsOf = new Map();
    doc.tags.forEach((entry) => [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
        const host = written.replace(/^=/, '');
        subjectsOf.set(host, [...(subjectsOf.get(host) || []), entry.tag]);
    }));
    const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
    const out = {};
    for (const [parent, kids] of Object.entries(splits)) {
        const entry = doc.tags.find((known) => known.tag === parent);
        if (!entry) throw new Error(`splits.json: unknown subject ${parent}`);
        // Hosts already moved by an earlier run count as the parent's too.
        const pool = new Set([
            ...(entry.derived || []).map((written) => written.replace(/^=/, '')),
            ...Object.entries(previous).filter(([, tags]) => tags.some((tag) => kids.some((kid) => kid.tag === tag)))
                .map(([host]) => host),
        ]);
        const counts = {};
        const sets = [];
        for (const kid of kids) {
            const keys = [
                ...(kid.classes || []).map((q) => `P31:${q}`),
                ...(kid.leagues || []).map((q) => `P118:${q}`),
                ...(kid.sports || []).map((q) => `P641:${q}`),
            ];
            const hosts = new Set();
            for (const key of keys) (await hostsFor(key)).forEach((host) => hosts.add(host));
            sets.push([kid.tag, hosts]);
        }
        pool.forEach((host) => {
            const hit = sets.find(([, hosts]) => hosts.has(host));
            if (!hit) return;
            const [child] = hit;
            const now = (subjectsOf.get(host) || []).filter((tag) => !children.has(tag));
            const tags = now.includes(parent) ? now.map((tag) => (tag === parent ? child : tag)) : [child, ...now];
            out[host] = [...new Set(tags)].slice(0, 2);
            counts[child] = (counts[child] || 0) + 1;
        });
        const moved = Object.values(counts).reduce((sum, n) => sum + n, 0);
        console.log(`${parent}: ${moved}/${pool.size} moved — ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    }
    fs.writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2)}\n`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
