#!/usr/bin/env node
'use strict';

/**
 * Step 3 of the catalogue build: give each candidate a subject, or none.
 *
 *   node scripts/tag-catalogue/classify.cjs            write cache/derived.json
 *   node scripts/tag-catalogue/classify.cjs --classes  list unmapped classes by weight
 *
 * Three sources, strongest first:
 *
 *   1. manual/*.json -- { "host": ["tag", ...] }. Handwork wins over
 *      everything, and an empty list keeps a host out entirely.
 *   2. Wikidata classes through qid-subjects.json -- { "Q11032": "news" }. A
 *      class mapped to "" is known and deliberately says nothing (website,
 *      company): listed so --classes stops asking about it.
 *   3. The item's short description, matched against the subjects' own names
 *      and aliases: "Dutch weather website" says weather. Only a subject's
 *      name, never its keywords: a description is one sentence, and two
 *      loose hints in a sentence are not the evidence they are in a page.
 *
 * A host whose item says it is adult content, or whose name does, is dropped
 * whatever else it says. At most two subjects per host.
 */

const fs = require('fs');
const path = require('path');

const here = __dirname;
const cacheDir = path.join(here, 'cache');
const root = path.join(here, '..', '..');

const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const qidSubjects = JSON.parse(fs.readFileSync(path.join(here, 'qid-subjects.json'), 'utf8'));
const wikidata = JSON.parse(fs.readFileSync(path.join(cacheDir, 'wikidata.json'), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(path.join(cacheDir, 'candidates.json'), 'utf8'));

const manual = {};
const manualDir = path.join(here, 'manual');
fs.readdirSync(manualDir).filter((name) => name.endsWith('.json')).sort().forEach((name) => {
    Object.assign(manual, JSON.parse(fs.readFileSync(path.join(manualDir, name), 'utf8')));
});

const ADULT_CLASSES = new Set(qidSubjects._adult || []);
const ADULT_WORDS = /\b(porn|porno|pornographic|xxx|sex|erotic|erotica|escort|adult|hentai|camgirl|webcam models?)\b/i;
const ADULT_HOST = /(porn|xxx|sex|hentai|escort|camgirl|onlyfans|xvideo|xnxx|xhamster|nsfw)/i;

const known = new Set(catalogue.tags.map((entry) => entry.tag));

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
    'media', 'business', 'community', 'network', 'information', 'blog', 'magazine', 'free', 'internet']);

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

function isAdult(host, entry) {
    if (ADULT_HOST.test(host)) return true;
    return (entry?.items || []).some((item) => item.classes.some((q) => ADULT_CLASSES.has(q))
        || Object.values(item.desc || {}).some((text) => ADULT_WORDS.test(text)));
}

function classify(host) {
    if (host in manual) return { tags: manual[host], via: 'manual' };
    const entry = wikidata[host];
    if (!entry || isAdult(host, entry)) return null;
    const tags = [];
    let via = 'class';
    entry.items.forEach((item) => item.classes.forEach((q) => {
        const tag = qidSubjects[q];
        if (tag && known.has(tag) && !tags.includes(tag)) tags.push(tag);
    }));
    if (!tags.length) {
        entry.items.forEach((item) => fromDescription(item.desc).forEach((tag) => {
            if (!tags.includes(tag)) tags.push(tag);
        }));
        via = 'description';
    }
    return tags.length ? { tags: tags.slice(0, 2), via } : null;
}

if (process.argv.includes('--classes')) {
    // Weighted by how many candidate hosts carry the class, so the table is
    // written for the classes that decide the most sites first.
    const weight = new Map();
    Object.entries(wikidata).forEach(([host, entry]) => {
        if (!entry || host in manual) return;
        const seen = new Set();
        entry.items.forEach((item) => item.classes.forEach((q) => seen.add(q)));
        seen.forEach((q) => {
            if (!(q in qidSubjects)) weight.set(q, (weight.get(q) || 0) + 1);
        });
    });
    const top = [...weight].sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3]) || 300);
    console.log(JSON.stringify(top));
    process.exit(0);
}

const derived = {};
const tally = { manual: 0, class: 0, description: 0 };
Object.keys(candidates).forEach((host) => {
    const result = classify(host);
    if (!result || !result.tags.length) return;
    derived[host] = { tags: result.tags, via: result.via, ranks: candidates[host] };
    tally[result.via] += 1;
});
// Handwork for hosts outside the CrUX lists (homelab, dev docs).
Object.entries(manual).forEach(([host, tags]) => {
    if (host in derived || !tags.length) return;
    derived[host] = { tags, via: 'manual', ranks: {} };
    tally.manual += 1;
});
fs.writeFileSync(path.join(cacheDir, 'derived.json'), JSON.stringify(derived));
console.log(`${Object.keys(derived).length} hosts with a subject`, tally);
