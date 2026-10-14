#!/usr/bin/env node
'use strict';

/**
 * Add the well-known sites of whole Wikidata classes to subjects.
 *
 *   node scripts/tag-catalogue/import-classes.cjs
 *   node scripts/tag-catalogue/apply.cjs
 *
 * classes.json maps a subject to the classes whose items it covers --
 * software companies and technology companies to tech-companies, programming
 * languages to programming-languages -- with the number of Wikipedia articles
 * (sitelinks) an item needs: how well known it is, since the CrUX ranking
 * the first build used is not kept. Per class one query returns every item of
 * it (instance of, P31) with an official website (P856) and enough sitelinks.
 *
 * A host is left alone when the handwork already decides it or a domain
 * above it, when it already
 * sits under two subjects, or when items of three or more subjects name it:
 * google.com is the site of a search engine, a browser, a phone and a
 * company, and is none of them in particular. Otherwise it gains the subject,
 * beside the one it has.
 *
 * Answers are cached in cache/import-classes.json. The result is
 * manual/classes.json, host -> tags, which apply.cjs writes in like the
 * splits and classify.cjs reads as handwork.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const { subjects } = JSON.parse(fs.readFileSync(path.join(__dirname, 'classes.json'), 'utf8'));
const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'import-classes.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const outFile = path.join(__dirname, 'manual', 'classes.json');

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

/** [host, item, sitelinks] for every item of the class with a website and enough sitelinks. */
async function itemsOf(q, minLinks) {
    const key = `${q}:${minLinks}`;
    if (cache[key]) return cache[key];
    const rows = await sparql(`SELECT ?item ?site ?links WHERE {
  ?item wdt:P31 wd:${q} ; wdt:P856 ?site ; wikibase:sitelinks ?links .
  FILTER(?links >= ${minLinks})
}`);
    cache[key] = rows.map((row) => [hostOf(row.site.value), row.item.value.split('/').pop(), Number(row.links.value)])
        .filter(([host]) => host && /\./.test(host) && !/^\d+\.\d+\.\d+\.\d+$/.test(host));
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    console.log(`  ${q}: ${cache[key].length}`);
    await sleep(800);
    return cache[key];
}

async function main() {
    const hand = new Set();
    const now = new Map();
    doc.tags.forEach((entry) => {
        entry.hosts.forEach((written) => hand.add(written.replace(/^[=~]/, '')));
        [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
            const host = written.replace(/^[=~]/, '');
            now.set(host, [...(now.get(host) || []), entry.tag]);
        });
    });
    const known = new Set(doc.tags.map((entry) => entry.tag));

    // host -> subject -> item ids
    const claims = new Map();
    for (const [subject, groups] of Object.entries(subjects)) {
        if (!known.has(subject)) throw new Error(`classes.json: unknown subject ${subject}`);
        for (const { minLinks = 5, classes } of groups) for (const q of classes) {
            for (const [host, item] of await itemsOf(q, minLinks)) {
                const bySubject = claims.get(host) || new Map();
                bySubject.set(subject, new Set([...(bySubject.get(subject) || []), item]));
                claims.set(host, bySubject);
            }
        }
    }

    const out = {};
    const counts = {};
    const skipped = { hand: 0, full: 0, crowded: 0, has: 0 };
    claims.forEach((bySubject, host) => {
        // The handwork decides a host and the subdomains under it:
        // open.spotify.com is music because spotify.com is.
        const labels = host.split('.');
        const underHand = labels.slice(0, -1).some((_, i) => hand.has(labels.slice(i).join('.')));
        if (underHand) { skipped.hand += 1; return; }
        // Many products on one domain: it is the domain of none of them.
        const items = new Set([...bySubject.values()].flatMap((set) => [...set]));
        if (bySubject.size >= 3 || items.size >= 5) { skipped.crowded += 1; return; }
        const subject = [...bySubject.entries()].sort((a, b) => b[1].size - a[1].size)[0][0];
        const current = now.get(host) || [];
        if (current.includes(subject)) { skipped.has += 1; return; }
        if (current.length >= 2) { skipped.full += 1; return; }
        out[host] = [...current, subject];
        counts[subject] = (counts[subject] || 0) + 1;
    });
    fs.writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2)}\n`);
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([subject, n]) => console.log(`${subject}: +${n}`));
    console.log(`${Object.keys(out).length} hosts; skipped`, skipped);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
