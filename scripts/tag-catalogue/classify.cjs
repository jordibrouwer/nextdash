#!/usr/bin/env node
'use strict';

/**
 * Step 3 of the catalogue build: give each site a subject, sort the sites
 * into language blocks, and keep the best known of each block.
 *
 *   node scripts/tag-catalogue/classify.cjs            write cache/derived.json
 *   node scripts/tag-catalogue/classify.cjs --classes  list unmapped classes by weight
 *
 * Where a subject comes from, strongest first:
 *
 *   1. manual/*.json -- { "host": ["tag", ...] }. Handwork wins over
 *      everything, and an empty list keeps a host out entirely.
 *   2. Wikidata classes through internal/app/tag_qid_subjects.json, from both the per-class
 *      lists (byclass.json) and the per-host answers (wikidata.json).
 *   3. The short description in wikidata.json, matched against the subjects'
 *      own names and aliases: "Dutch weather website" says weather.
 *
 * Which block a site belongs to is read from its country-code domain, and
 * otherwise from which countries' CrUX lists it ranks in. Within a block the
 * sites are ordered by their best CrUX rank, then by how many Wikipedia
 * articles their item has; the targets below say how many each block keeps.
 * A site with no CrUX rank is only kept when its domain names the block --
 * a .com newspaper nobody here visits could be in any language.
 *
 * Adult sites are dropped whatever else they are. At most two subjects per
 * host.
 */

const fs = require('fs');
const path = require('path');

const here = __dirname;
const cacheDir = path.join(here, 'cache');
const root = path.join(here, '..', '..');
const read = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

const catalogue = read(path.join(root, 'internal', 'app', 'tag_catalogue.json'));
const qidSubjects = read(path.join(root, 'internal', 'app', 'tag_qid_subjects.json'));
const wikidata = read(path.join(cacheDir, 'wikidata.json'), {});
const byclass = read(path.join(cacheDir, 'byclass.json'), {});
const bycountry = read(path.join(cacheDir, 'bycountry.json'), {});
const candidates = read(path.join(cacheDir, 'candidates.json'), {});

// Ceilings, not goals: a block keeps every site with solid evidence up to
// here. Without a CrUX rank a site needs MIN_LINKS Wikipedia articles.
const TARGETS = { en: 40000, nl: 6000, de: 6000, fr: 6000, es: 6000, other: 6000, zh: 15000 };
const MIN_LINKS = 3;

const BLOCK_OF_COUNTRY = {
    us: 'en', gb: 'en', ca: 'en', au: 'en', ie: 'en', nz: 'en', in: 'en', za: 'en',
    nl: 'nl', be: 'nl', de: 'de', at: 'de', ch: 'de', fr: 'fr', es: 'es', mx: 'es',
    it: 'other', pt: 'other', br: 'other', pl: 'other', se: 'other',
    cn: 'zh', tw: 'zh', hk: 'zh', mo: 'zh', sg: 'en',
};
const BLOCK_OF_TLD = {
    nl: 'nl', be: 'nl', de: 'de', at: 'de', ch: 'de', fr: 'fr', es: 'es', mx: 'es',
    uk: 'en', ie: 'en', au: 'en', nz: 'en', ca: 'en', za: 'en', us: 'en', gov: 'en', edu: 'en',
    it: 'other', pt: 'other', br: 'other', pl: 'other', se: 'other',
    cn: 'zh', tw: 'zh', hk: 'zh', mo: 'zh',
};

const manual = {};
const manualDir = path.join(here, 'manual');
fs.readdirSync(manualDir).filter((name) => name.endsWith('.json')).sort().forEach((name) => {
    Object.assign(manual, read(path.join(manualDir, name)));
});

const ADULT_CLASSES = new Set(qidSubjects._adult || []);
const ADULT_WORDS = /\b(porn|porno|pornographic|xxx|sex|erotic|erotica|escort|hentai|camgirl|webcam models?)\b/i;
const ADULT_HOST = /(porn|xxx|sex|hentai|escort|camgirl|onlyfans|xvideo|xnxx|xhamster|nsfw|redtube|youjizz|brazzers)/i;

const known = new Set(catalogue.tags.map((entry) => entry.tag));
const curated = new Map();
catalogue.tags.forEach((entry) => entry.hosts.forEach((written) => {
    const host = written.replace(/^=/, '');
    curated.set(host, (curated.get(host) || []).concat(entry.tag));
}));

// Every word a subject is called by -> the subject. Hyphenated aliases match
// as a phrase: "search-engine" is found in "Dutch search engine".
const names = new Map();
catalogue.tags.forEach((entry) => {
    [entry.tag, ...(entry.aliases || [])].forEach((name) => {
        if (!names.has(name)) names.set(name, entry.tag);
    });
});
// Words too general to say what a site is about on their own.
const VAGUE = new Set(['website', 'online', 'platform', 'service', 'company', 'web', 'site', 'portal', 'app',
    'media', 'business', 'community', 'network', 'information', 'blog', 'magazine', 'free', 'internet',
    'provider', 'stage', 'learning', 'listen', 'watch', 'stream']);

function phrases(text) {
    const words = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/).filter(Boolean);
    const out = [];
    for (let n = 3; n >= 1; n--) {
        for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join('-'));
    }
    return out;
}

function fromDescription(desc) {
    const found = [];
    Object.values(desc || {}).forEach((text) => {
        phrases(text).forEach((phrase) => {
            if (VAGUE.has(phrase)) return;
            const tag = names.get(phrase);
            if (tag && !found.includes(tag)) found.push(tag);
        });
    });
    return found;
}

/*
 * host -> { classes: Set, links, zh } from the per-class lists.
 *
 * Several items can name the same website: nytimes.com is the newspaper and
 * also its crossword, rijksoverheid.nl the government and a railway project
 * it runs. Their classes are not the site's, so only the main item counts --
 * the one with the most Wikipedia articles.
 */
const itemsOf = new Map();
Object.entries(byclass).forEach(([q, sites]) => {
    Object.entries(sites).forEach(([host, [item, links, zh]]) => {
        const items = itemsOf.get(host) || new Map();
        const known = items.get(item) || { classes: new Set(), links, zh };
        known.classes.add(q);
        items.set(item, known);
        itemsOf.set(host, items);
    });
});
const facts = new Map();
itemsOf.forEach((items, host) => {
    const sorted = [...items.values()].sort((a, b) => b.links - a.links);
    const main = sorted[0];
    // The other items, as a fallback when the main one only says how the
    // site is made: Der Spiegel's main item is a magazine, its other items
    // say news.
    facts.set(host, { classes: main.classes, others: sorted.slice(1).map((item) => item.classes), links: main.links, zh: main.zh });
});
// The adult classes are checked across every item: one is enough to drop a site.
const adultHosts = new Set();
itemsOf.forEach((items, host) => {
    items.forEach((item) => item.classes.forEach((q) => {
        if ((qidSubjects._adult || []).includes(q)) adultHosts.add(host);
    }));
});
Object.entries(bycountry).forEach(([host, countries]) => {
    const fact = facts.get(host);
    if (fact && countries.length) fact.countries = countries;
});
Object.entries(wikidata).forEach(([host, entry]) => {
    if (!entry) return;
    const known = facts.get(host);
    const fact = known || { classes: new Set(), links: 0, zh: 0 };
    if (!known) entry.items.forEach((item) => item.classes.forEach((q) => fact.classes.add(q)));
    fact.desc = entry.items.map((item) => item.desc);
    facts.set(host, fact);
});

// A subdomain of a hand-written host: the handwork already decided what
// that site is, and fr.wikipedia.org is not news because Wikinews is.
function underCurated(host) {
    const labels = host.split('.');
    for (let i = 1; i <= labels.length - 2; i++) {
        if (curated.has(labels.slice(i).join('.'))) return true;
    }
    return false;
}

function isAdult(host, fact) {
    if (ADULT_HOST.test(host) || adultHosts.has(host)) return true;
    if ([...fact.classes].some((q) => ADULT_CLASSES.has(q))) return true;
    return (fact.desc || []).some((desc) => Object.values(desc || {}).some((text) => ADULT_WORDS.test(text)));
}

/*
 * Subjects that describe how a site is made rather than what it is for. A
 * university is also a publisher on Wikidata, a broadcaster also a media
 * company; these only count when nothing more specific was said.
 */
const WEAK = new Set(['publishing', 'journals', 'open-access', 'magazine', 'media', 'reference', 'broadcasting']);
// Channels a site is published through rather than what it is about: Real
// Madrid runs a TV channel, and is still football first.
const CHANNEL = new Set(['television', 'radio', 'podcasts', 'film']);
const weight = (tag) => (WEAK.has(tag) ? 2 : CHANNEL.has(tag) ? 1 : 0);

function subjectsOf(host, fact) {
    const tags = [];
    fact.classes.forEach((q) => {
        const tag = qidSubjects[q];
        if (tag && known.has(tag) && !tags.includes(tag)) tags.push(tag);
    });
    tags.sort((a, b) => weight(a) - weight(b));
    let strong = tags.filter((tag) => !WEAK.has(tag));
    if (!strong.length && fact.others?.length) {
        const count = new Map();
        fact.others.forEach((classes) => {
            const seen = new Set([...classes].map((q) => qidSubjects[q]).filter((tag) => tag && known.has(tag) && !WEAK.has(tag)));
            seen.forEach((tag) => count.set(tag, (count.get(tag) || 0) + 1));
        });
        strong = [...count].sort((a, b) => b[1] - a[1] || weight(a[0]) - weight(b[0])).map(([tag]) => tag);
    }
    if (strong.length) return { tags: strong.concat(tags.filter((tag) => WEAK.has(tag) && tag !== 'publishing')), via: 'class' };
    if (tags.length) return { tags, via: 'class' };
    (fact.desc || []).forEach((desc) => fromDescription(desc).forEach((tag) => {
        if (!tags.includes(tag)) tags.push(tag);
    }));
    return tags.length ? { tags, via: 'description' } : null;
}

function blockOf(host, ranks, fact) {
    const tld = host.split('.').pop();
    if (BLOCK_OF_TLD[tld]) return BLOCK_OF_TLD[tld];
    const blocks = new Set(Object.keys(ranks || {}).map((cc) => BLOCK_OF_COUNTRY[cc]).filter(Boolean));
    if (!blocks.size) {
        // No CrUX rank: where Wikidata says the site is from decides, and a
        // site from several places says nothing.
        const homes = new Set((fact?.countries || []).map((cc) => BLOCK_OF_COUNTRY[cc]));
        return homes.size === 1 ? [...homes][0] : null;
    }
    // A site in one language's lists only belongs to that language; one that
    // ranks across languages is international, and international is English.
    if (blocks.size === 1) {
        const only = [...blocks][0];
        // Chinese lists carry plenty of sites in other languages; a site
        // counts as Chinese when Chinese Wikipedia writes about it.
        if (only === 'zh' && !fact?.zh) return 'en';
        return only;
    }
    return 'en';
}

function bestRank(ranks) {
    const values = Object.values(ranks || {});
    return values.length ? Math.min(...values) : Infinity;
}

if (process.argv.includes('--classes')) {
    const weight = new Map();
    facts.forEach((fact, host) => {
        if (!(host in candidates)) return;
        fact.classes.forEach((q) => {
            if (!(q in qidSubjects)) weight.set(q, (weight.get(q) || 0) + 1);
        });
    });
    const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3]) || 300);
    console.log(JSON.stringify(top));
    process.exit(0);
}

const pool = { en: [], nl: [], de: [], fr: [], es: [], other: [], zh: [] };
const dropped = { adult: 0, noSubject: 0, noBlock: 0, curated: 0 };
facts.forEach((fact, host) => {
    if (host in manual || curated.has(host) || underCurated(host)) {
        dropped.curated += 1;
        return;
    }
    if (isAdult(host, fact)) {
        dropped.adult += 1;
        return;
    }
    const subject = subjectsOf(host, fact);
    if (!subject) {
        dropped.noSubject += 1;
        return;
    }
    const ranks = candidates[host];
    const block = blockOf(host, ranks, fact);
    // No CrUX rank, no country domain and no country on Wikidata: nothing
    // says who reads it.
    if (!block || (!ranks && !BLOCK_OF_TLD[host.split('.').pop()] && !fact.countries)
        || (!ranks && fact.links < MIN_LINKS)) {
        dropped.noBlock += 1;
        return;
    }
    pool[block].push({ host, tags: subject.tags.slice(0, 2), via: subject.via, rank: bestRank(ranks), links: fact.links });
});

const derived = {};
const summary = {};
Object.entries(pool).forEach(([block, sites]) => {
    sites.sort((a, b) => a.rank - b.rank || b.links - a.links);
    const kept = sites.slice(0, TARGETS[block]);
    kept.forEach((site) => {
        derived[site.host] = { tags: site.tags, via: site.via, block };
    });
    summary[block] = `${kept.length}/${sites.length}`;
});
Object.entries(manual).forEach(([host, tags]) => {
    if (tags.length) derived[host] = { tags, via: 'manual', block: 'manual' };
});

fs.writeFileSync(path.join(cacheDir, 'derived.json'), JSON.stringify(derived));
console.log('kept/available per block', summary);
console.log('dropped', dropped);
console.log(`${Object.keys(derived).length} derived hosts -> cache/derived.json`);
