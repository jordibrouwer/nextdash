#!/usr/bin/env node
'use strict';

/**
 * What Wikidata says the sites under a broad subject are, to split it.
 *
 *   node scripts/tag-catalogue/split-facts.cjs [--sample 300] soccer news government …
 *   node scripts/tag-catalogue/split-facts.cjs --report soccer
 *
 * For every derived host of the named subjects, asks which items name it as
 * their official website (P856) and keeps, per host, the classes of the main
 * item (instance of, P31) and, for clubs, its league (P118). Written to
 * cache/split-facts.json, resumable. --report prints the commonest classes
 * and leagues per subject with their English labels, which is what
 * splits.json is written from.
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const AGENT = 'nextDash-catalogue-build/1.0 (https://github.com/jordibrouwer/nextDash)';
const BATCH = 80;

const catalogueFile = path.join(__dirname, '..', '..', 'internal', 'app', 'tag_catalogue.json');
const doc = JSON.parse(fs.readFileSync(catalogueFile, 'utf8'));
const cacheDir = path.join(__dirname, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'split-facts.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};

const args = process.argv.slice(2);
const report = args.includes('--report');
// A sample per subject is enough to see which classes it is made of; the
// split itself asks per class (split.cjs), which is far quicker than per host.
const sampleAt = args.indexOf('--sample');
const sample = sampleAt >= 0 ? Number(args[sampleAt + 1]) : Infinity;
const subjects = args.filter((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--sample');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function sparql(query, attempt = 1) {
    const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/sparql-results+json',
            'User-Agent': AGENT,
        },
        body: new URLSearchParams({ query }),
        signal: AbortSignal.timeout(90_000),
    }).catch((error) => ({ ok: false, status: 0, error }));
    if (response.ok) return (await response.json()).results.bindings;
    if (attempt >= 5) throw new Error(`wikidata: status ${response.status}`);
    await sleep(response.status === 429 ? 60_000 : 5_000 * attempt);
    return sparql(query, attempt + 1);
}

/*
 * The main item per site is the one with the most Wikipedia articles: a
 * newspaper's site is also named by its crossword and its owner, whose classes
 * are not the site's.
 */
function factsQuery(hosts) {
    const values = hosts.flatMap(spellings).map((url) => `<${url}>`).join(' ');
    return `SELECT ?site ?item ?links
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?class), "entity/"); separator=" ") AS ?classes)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?league), "entity/"); separator=" ") AS ?leagues)
WHERE {
  VALUES ?site { ${values} }
  ?item wdt:P856 ?site .
  OPTIONAL { ?item wikibase:sitelinks ?links }
  OPTIONAL { ?item wdt:P31 ?class }
  OPTIONAL { ?item wdt:P118 ?league }
}
GROUP BY ?site ?item ?links`;
}

async function fetchFacts(hosts) {
    const todo = hosts.filter((host) => !(host in cache));
    console.log(`${todo.length} hosts to ask, ${hosts.length - todo.length} cached`);
    const queue = [];
    for (let i = 0; i < todo.length; i += BATCH) queue.push(todo.slice(i, i + BATCH));
    let done = 0;
    while (queue.length) {
        const batch = queue.shift();
        let rows;
        try {
            rows = await sparql(factsQuery(batch));
        } catch (error) {
            if (batch.length > 10) {
                const half = Math.ceil(batch.length / 2);
                queue.unshift(batch.slice(0, half), batch.slice(half));
            } else {
                console.warn(`  skipped ${batch.length}: ${error.message}`);
            }
            continue;
        }
        const best = new Map();
        rows.forEach((row) => {
            const host = hostOf(row.site.value);
            const links = Number(row.links?.value || 0);
            const known = best.get(host);
            if (known && known.links >= links) return;
            best.set(host, {
                links,
                classes: (row.classes?.value || '').split(' ').filter(Boolean),
                leagues: (row.leagues?.value || '').split(' ').filter(Boolean),
            });
        });
        batch.forEach((host) => {
            const found = best.get(host);
            cache[host] = found ? { classes: found.classes, leagues: found.leagues } : null;
        });
        done += batch.length;
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
        console.log(`${done}/${todo.length}`);
        await sleep(1000);
    }
}

async function labels(qids) {
    const out = {};
    for (let i = 0; i < qids.length; i += 200) {
        const slice = qids.slice(i, i + 200);
        const rows = await sparql(`SELECT ?q ?label WHERE {
  VALUES ?q { ${slice.map((q) => `wd:${q}`).join(' ')} }
  ?q rdfs:label ?label FILTER(LANG(?label) = "en") }`);
        rows.forEach((row) => { out[row.q.value.split('/').pop()] = row.label.value; });
    }
    return out;
}

function derivedOf(tag) {
    const entry = doc.tags.find((known) => known.tag === tag);
    if (!entry) throw new Error(`unknown subject ${tag}`);
    return (entry.derived || []).map((written) => written.replace(/^=/, ''));
}

async function main() {
    if (!subjects.length) throw new Error('name one or more subjects');
    if (!report) {
        // Every nth host rather than the first n: the list is sorted, and its
        // head is the sites whose names start with a digit.
        const pick = (hosts) => {
            if (hosts.length <= sample) return hosts;
            const step = hosts.length / sample;
            return Array.from({ length: sample }, (_, i) => hosts[Math.floor(i * step)]);
        };
        await fetchFacts([...new Set(subjects.flatMap((tag) => pick(derivedOf(tag))))]);
        return;
    }
    for (const tag of subjects) {
        const hosts = derivedOf(tag).filter((host) => host in cache);
        const classes = new Map();
        const leagues = new Map();
        let found = 0;
        hosts.forEach((host) => {
            const fact = cache[host];
            if (!fact) return;
            found += 1;
            fact.classes.forEach((q) => classes.set(q, (classes.get(q) || 0) + 1));
            fact.leagues.forEach((q) => leagues.set(q, (leagues.get(q) || 0) + 1));
        });
        const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
        const topClasses = top(classes, 40);
        const topLeagues = top(leagues, 30);
        const names = await labels([...topClasses, ...topLeagues].map(([q]) => q));
        console.log(`\n## ${tag}: ${hosts.length} asked, ${found} on Wikidata`);
        console.log('classes:', topClasses.map(([q, n]) => `${q} ${names[q] || '?'} (${n})`).join('; '));
        if (topLeagues.length) console.log('leagues:', topLeagues.map(([q, n]) => `${q} ${names[q] || '?'} (${n})`).join('; '));
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
