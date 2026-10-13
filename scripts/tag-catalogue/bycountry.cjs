#!/usr/bin/env node
'use strict';

/**
 * Step 2c of the catalogue build: where the sites CrUX does not rank are from.
 *
 *   node scripts/tag-catalogue/bycountry.cjs
 *
 * byclass.json already holds every classifiable site Wikidata knows; what it
 * lacks for a site without a CrUX rank is which language block it belongs
 * to. This asks for the country (P17) of those items, 400 per query --
 * light lookups by item id, where asking "every site in the United States"
 * runs past the endpoint's time limit.
 *
 * Written to cache/bycountry.json as { host: ["nl", ...] }, resumable: a host
 * with no country is stored as [].
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const COUNTRY_CODE = {
    Q30: 'us', Q145: 'gb', Q16: 'ca', Q408: 'au', Q27: 'ie', Q664: 'nz', Q668: 'in', Q258: 'za',
    Q55: 'nl', Q31: 'be', Q183: 'de', Q40: 'at', Q39: 'ch', Q142: 'fr', Q29: 'es', Q96: 'mx',
    Q38: 'it', Q45: 'pt', Q155: 'br', Q36: 'pl', Q34: 'se',
    Q148: 'cn', Q865: 'tw', Q8646: 'hk', Q14773: 'mo', Q334: 'sg',
};
const here = __dirname;
const read = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const byclass = read(path.join(here, 'cache', 'byclass.json'), {});
const candidates = read(path.join(here, 'cache', 'candidates.json'), {});
const file = path.join(here, 'cache', 'bycountry.json');
const cache = read(file, {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(items, attempt = 1) {
    const query = `SELECT ?item ?country WHERE {
  VALUES ?item { ${items.map((q) => `wd:${q}`).join(' ')} }
  ?item wdt:P17 ?country .
}`;
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': AGENT },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(60_000),
    }).catch(() => ({ ok: false, status: 0 }));
    if (response.ok) return (await response.json()).results.bindings;
    if (attempt >= 4) throw new Error(`status ${response.status}`);
    await sleep(response.status === 429 ? 60_000 : 5_000 * attempt);
    return ask(items, attempt + 1);
}

async function main() {
    // host -> item, for the sites CrUX does not rank.
    const itemOf = new Map();
    // Skipped: hosts whose country domain already names the block, and items
    // too little known to make the cut without a CrUX rank anyway.
    const CC_TLD = /\.(nl|be|de|at|ch|fr|es|mx|uk|ie|au|nz|ca|za|us|it|pt|br|pl|se|cn|tw|hk|mo)$/;
    Object.values(byclass).forEach((sites) => Object.entries(sites).forEach(([host, [item, links]]) => {
        if (host in candidates || host in cache || CC_TLD.test(host) || links < 3) return;
        itemOf.set(host, item);
    }));
    const hostsOf = new Map();
    itemOf.forEach((item, host) => hostsOf.set(item, (hostsOf.get(item) || []).concat(host)));
    const items = [...hostsOf.keys()];
    console.log(`${items.length} items to place`);
    for (let i = 0; i < items.length; i += 400) {
        const batch = items.slice(i, i + 400);
        let rows;
        try {
            rows = await ask(batch);
        } catch (error) {
            console.warn(`  batch ${i}: skipped, ${error.message}`);
            continue;
        }
        const found = new Map();
        rows.forEach((row) => {
            const cc = COUNTRY_CODE[row.country.value.split('/').pop()];
            if (!cc) return;
            const item = row.item.value.split('/').pop();
            found.set(item, (found.get(item) || []).concat(cc));
        });
        batch.forEach((item) => hostsOf.get(item).forEach((host) => {
            cache[host] = [...new Set(found.get(item) || [])];
        }));
        fs.writeFileSync(file, JSON.stringify(cache));
        console.log(`${Math.min(i + 400, items.length)}/${items.length}`);
        await sleep(500);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
