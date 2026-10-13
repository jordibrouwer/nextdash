#!/usr/bin/env node
'use strict';

/**
 * Step 2 of the catalogue build: what Wikidata says each candidate is.
 *
 *   node scripts/tag-catalogue/wikidata.cjs [--batch 150] [--limit N]
 *
 * For every host in cache/candidates.json not yet in cache/wikidata.json, asks
 * query.wikidata.org which items name it as their official website (P856), in
 * the eight spellings a P856 value is written in (http/https, www or not,
 * trailing slash or not). Per item it keeps the classes that say what a site
 * is -- instance of (P31), industry (P452), genre (P136), has use (P366), main
 * subject (P921) -- and the short description in the five catalogue
 * languages.
 *
 * Resumable: the cache is written after every batch, and a host that matched
 * nothing is stored as null so it is not asked again. Wikidata is CC0.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const LANGS = ['en', 'nl', 'de', 'fr', 'es'];
// Items that are about a list or a name rather than a site.
const NOT_A_SITE = ['Q4167410', 'Q13406463', 'Q80096233', 'Q4167836', 'Q17633526'];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
};
const batchSize = opt('--batch', 150);
const limit = opt('--limit', Infinity);

const cacheDir = path.join(__dirname, 'cache');
const candidates = JSON.parse(fs.readFileSync(path.join(cacheDir, 'candidates.json'), 'utf8'));
const cacheFile = path.join(cacheDir, 'wikidata.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

function spellings(host) {
    const out = [];
    ['https', 'http'].forEach((scheme) => ['', 'www.'].forEach((www) => ['/', ''].forEach((slash) => {
        out.push(`${scheme}://${www}${host}${slash}`);
    })));
    return out;
}

function hostOf(site) {
    try {
        return new URL(site).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

function queryFor(hosts) {
    const values = hosts.flatMap(spellings).map((url) => `<${url}>`).join(' ');
    const descs = LANGS.map((lang) => `OPTIONAL { ?item schema:description ?d_${lang} FILTER(LANG(?d_${lang}) = "${lang}") }`).join('\n');
    const descVars = LANGS.map((lang) => `(SAMPLE(?d_${lang}) AS ?desc_${lang})`).join(' ');
    return `SELECT ?site ?item (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator=" ") AS ?classes) ${descVars}
WHERE {
  VALUES ?site { ${values} }
  ?item wdt:P856 ?site .
  FILTER NOT EXISTS { ?item wdt:P31 ?bad . VALUES ?bad { ${NOT_A_SITE.map((q) => `wd:${q}`).join(' ')} } }
  OPTIONAL { ?item wdt:P31|wdt:P452|wdt:P136|wdt:P366|wdt:P921 ?class }
  ${descs}
}
GROUP BY ?site ?item`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ask(hosts, attempt = 1) {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/sparql-results+json',
            'User-Agent': AGENT,
        },
        body: new URLSearchParams({ query: queryFor(hosts) }),
        signal: AbortSignal.timeout(90_000),
    }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return (await response.json()).results.bindings;
    if (attempt >= 5) throw new Error(`wikidata: status ${response.status} after ${attempt} attempts`);
    const wait = response.status === 429 ? 60_000 : 5_000 * attempt;
    console.warn(`  status ${response.status}, retry in ${wait / 1000}s`);
    await sleep(wait);
    return ask(hosts, attempt + 1);
}

async function main() {
    const todo = Object.keys(candidates).filter((host) => !(host in cache)).slice(0, limit);
    console.log(`${todo.length} hosts to ask, ${Object.keys(cache).length} cached`);
    // A queue of batches rather than a stride, so a batch Wikidata refuses
    // outright (usually a timeout on a heavy one) can be split and retried.
    const queue = [];
    for (let i = 0; i < todo.length; i += batchSize) queue.push(todo.slice(i, i + batchSize));
    let done = 0;
    while (queue.length) {
        const hosts = queue.shift();
        let rows;
        try {
            rows = await ask(hosts);
        } catch (error) {
            if (hosts.length > 10) {
                console.warn(`  batch of ${hosts.length} failed, splitting`);
                const half = Math.ceil(hosts.length / 2);
                queue.unshift(hosts.slice(0, half), hosts.slice(half));
            } else {
                console.warn(`  skipped ${hosts.length}: ${error.message}`);
            }
            continue;
        }
        done += hosts.length;
        hosts.forEach((host) => { cache[host] = null; });
        rows.forEach((row) => {
            const host = hostOf(row.site.value);
            if (!(host in cache)) return;
            const item = row.item.value.split('/').pop();
            const entry = cache[host] || { items: [] };
            if (entry.items.some((known) => known.q === item)) return;
            const desc = {};
            LANGS.forEach((lang) => {
                if (row[`desc_${lang}`]) desc[lang] = row[`desc_${lang}`].value;
            });
            entry.items.push({ q: item, classes: (row.classes?.value || '').split(' ').filter(Boolean), desc });
            cache[host] = entry;
        });
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
        const found = hosts.filter((host) => cache[host]).length;
        console.log(`${done}/${todo.length}: ${found}/${hosts.length} found`);
        await sleep(1500);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
