#!/usr/bin/env node
'use strict';

/**
 * Adult sites from the Tranco list, by name alone.
 *
 *   node scripts/tag-catalogue/harvest-adult.cjs path/to/top-1m.csv
 *   node scripts/tag-catalogue/apply.cjs
 *
 * Adult sites are many and mostly say what they are in their name (porn, xxx,
 * hentai, a cam brand), so the name is the evidence: no lookup, no model. The
 * words are strict, and the few that hide inside ordinary words are fenced
 * off (tamilfonts is not milf, imagetopdfapp is not fap). A host the
 * catalogue already files elsewhere is left to that subject; the reviewed
 * Tranco list (manual/tranco.json) decides the best-known ones by hand.
 *
 * Writes manual/adult.json, host -> ["adult"].
 */

const fs = require('fs');
const path = require('path');

const source = process.argv[2];
if (!source) {
    console.error('usage: harvest-adult.cjs path/to/top-1m.csv');
    process.exit(1);
}
const root = path.join(__dirname, '..', '..');
const doc = JSON.parse(fs.readFileSync(path.join(root, 'internal', 'app', 'tag_catalogue.json'), 'utf8'));
const reviewed = JSON.parse(fs.readFileSync(path.join(__dirname, 'manual', 'tranco.json'), 'utf8'));
const outFile = path.join(__dirname, 'manual', 'adult.json');

const ADULT = new RegExp([
    'porn', 'hentai', 'xxx', 'xvideo', 'xnxx', 'xhamster', 'redtube', 'youporn', 'chaturbate', 'stripchat',
    'onlyfans', 'spankbang', 'bongacams', 'eporner', 'tnaflix', 'rule34', 'camsoda', 'myfreecams', 'livejasmin',
    'brazzers', 'missav', 'javhd', 'javbus', 'javdb', 'javlibrary', 'erotik', 'erotic', 'bdsm', 'fetish', 'escort',
    'sextube', 'sexvid', 'sexcam', 'sexchat', 'xsex', 'sexx', 'hotsex', 'freesex', 'sexy', 'fappening',
    '(?<!ta)milf', '(?<!s)sexo', '(?<!po)(?<!a)nude', '(?<!u)fap(?!p)',
].join('|'));
// Ordinary names the words above still catch.
const NOT = /^(unitednude|essexonline|nudeproject|xxxpowersports)\./;
const OFFICIAL = /\.(gov|edu|mil|int)(\.[a-z]{2})?$/;

const filed = new Set();
doc.tags.forEach((entry) => {
    if (entry.tag === 'adult') return;
    [...entry.hosts, ...(entry.derived || [])].forEach((written) => filed.add(written.replace(/^[=~]/, '').split('/')[0]));
});

const out = {};
let seen = 0;
fs.readFileSync(source, 'utf8').split('\n').forEach((line) => {
    const host = (line.split(',')[1] || '').trim().toLowerCase();
    if (!host || !ADULT.test(host) || NOT.test(host) || OFFICIAL.test(host)) return;
    seen += 1;
    if (filed.has(host) || host in reviewed) return;
    out[host] = ['adult'];
});
fs.writeFileSync(outFile, `${JSON.stringify(Object.fromEntries(Object.entries(out).sort()), null, 2)}\n`);
console.log(`${seen} adult names, ${Object.keys(out).length} new under adult`);
