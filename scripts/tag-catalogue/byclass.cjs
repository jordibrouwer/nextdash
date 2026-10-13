#!/usr/bin/env node
'use strict';

/**
 * Step 2b of the catalogue build: every site Wikidata files under a class.
 *
 *   node scripts/tag-catalogue/byclass.cjs
 *
 * Asking per host stops scaling at a few tens of thousands: Wikidata rate
 * limits long before three hundred thousand hosts are through. Asking per
 * class turns it around -- one query per class in internal/app/tag_qid_subjects.json returns
 * every item of that class (instance of or industry) with an official
 * website, worldwide, in a few seconds. The CrUX ranking then decides which
 * of them matter.
 *
 * Per site it keeps the item, its number of Wikipedia articles (a rough
 * measure of how well known it is, used where CrUX has no rank) and whether
 * it has a Chinese article. Written to cache/byclass.json, resumable per
 * class. The _adult classes are fetched too, so their sites can be dropped.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const table = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'internal', 'app', 'tag_qid_subjects.json'), 'utf8'));
const classes = [
    ...Object.entries(table).filter(([q, tag]) => /^Q\d+$/.test(q) && tag).map(([q]) => q),
    ...(table._adult || []),
];
const file = path.join(__dirname, 'cache', 'byclass.json');
const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hostOf(site) {
    try {
        const url = new URL(site);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    } catch {
        return '';
    }
}

async function ask(q, attempt = 1) {
    const query = `SELECT ?item ?site ?links ?zh WHERE {
  ?item wdt:P31|wdt:P452 wd:${q}; wdt:P856 ?site .
  OPTIONAL { ?item wikibase:sitelinks ?links }
  BIND(EXISTS { ?article schema:about ?item; schema:isPartOf <https://zh.wikipedia.org/> } AS ?zh)
}`;
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': AGENT },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(120_000),
    }).catch(() => ({ ok: false, status: 0 }));
    if (response.ok) return (await response.json()).results.bindings;
    if (attempt >= 5) throw new Error(`status ${response.status}`);
    const wait = response.status === 429 ? 60_000 : 5_000 * attempt;
    console.warn(`  ${q}: status ${response.status}, retry in ${wait / 1000}s`);
    await sleep(wait);
    return ask(q, attempt + 1);
}

async function main() {
    const todo = classes.filter((q) => !(q in cache));
    console.log(`${todo.length} classes to ask, ${Object.keys(cache).length} cached`);
    for (const q of todo) {
        let rows;
        try {
            rows = await ask(q);
        } catch (error) {
            console.warn(`  ${q}: skipped, ${error.message}`);
            continue;
        }
        const sites = {};
        rows.forEach((row) => {
            const host = hostOf(row.site.value);
            if (!host || !host.includes('.')) return;
            const item = row.item.value.split('/').pop();
            const links = Number(row.links?.value || 0);
            const known = sites[host];
            if (known && known[1] >= links) return;
            sites[host] = [item, links, row.zh?.value === 'true' ? 1 : 0];
        });
        cache[q] = sites;
        fs.writeFileSync(file, JSON.stringify(cache));
        console.log(`${q} (${table[q] || 'adult'}): ${Object.keys(sites).length} sites`);
        await sleep(1000);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
