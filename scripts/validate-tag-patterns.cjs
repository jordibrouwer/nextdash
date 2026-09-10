#!/usr/bin/env node
'use strict';

/**
 * The shipped tag catalogue, checked.
 *
 * Three things go wrong in a hand-written data file of this size, and none of
 * them shows up in the browser. A host named under two subjects makes the
 * catalogue propose whichever entry happened to be read first, which is
 * arbitrary and silently wrong. A host written the way it is typed rather
 * than the way it is matched — with a scheme, a `www.`, a path — can never
 * fire, because patternsFor() in static/js/shared/tag-suggestions.js reduces
 * a URL to a bare host before comparing. And a tag repeated in its own
 * aliases, or spelled with a capital or a space, is a tag the reader is
 * offered but would never have typed.
 *
 * Exit 1 on any of those. This runs in CI, so a bad row cannot ship.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const file = path.join(root, 'static', 'data', 'tag-patterns.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

const WORD = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A registrable domain or a subdomain of one: labels split by dots, ending in
// letters. Deliberately narrow — an address with a scheme, a slash, a port or
// a capital is the mistake this is here to catch, not a shape to accept.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

let failed = false;
const problems = [];
const seenTags = new Map();
const seenHosts = new Map();
const seenKeywords = new Map();

if (doc.version !== 1) {
    problems.push(`version is ${JSON.stringify(doc.version)}, want 1`);
}
const entries = Array.isArray(doc.tags) ? doc.tags : null;
if (!entries) {
    problems.push('tags is not an array');
}

(entries || []).forEach((entry, i) => {
    const where = entry && entry.tag ? `${entry.tag}` : `#${i}`;

    if (!WORD.test(String(entry?.tag || ''))) {
        problems.push(`${where}: tag must be lowercase letters, digits and hyphens`);
        return;
    }
    if (seenTags.has(entry.tag)) {
        problems.push(`${entry.tag}: tag also used at #${seenTags.get(entry.tag)}`);
    }
    seenTags.set(entry.tag, i);

    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const aliasSeen = new Set();
    aliases.forEach((alias) => {
        if (!WORD.test(String(alias))) {
            problems.push(`${where}: alias ${JSON.stringify(alias)} must be lowercase letters, digits and hyphens`);
            return;
        }
        if (alias === entry.tag) {
            problems.push(`${where}: alias repeats the tag itself`);
        }
        if (aliasSeen.has(alias)) {
            problems.push(`${where}: alias ${alias} listed twice`);
        }
        aliasSeen.add(alias);
    });

    /*
     * Keywords are matched against words pulled out of a page, so the same
     * three failures apply as to a tag -- with one extra that only they have.
     * A word claimed by two subjects cannot decide between them: it would
     * propose whichever entry the loop happened to weigh first, which is
     * arbitrary, so the merge drops such words and this refuses to ship one
     * that slipped through.
     */
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    keywords.forEach((word) => {
        if (!WORD.test(String(word))) {
            problems.push(`${where}: keyword ${JSON.stringify(word)} must be lowercase letters, digits and hyphens`);
            return;
        }
        if (word === entry.tag || aliases.includes(word)) {
            problems.push(`${where}: keyword ${word} repeats the tag or one of its aliases`);
            return;
        }
        const owner = seenKeywords.get(word);
        if (owner && owner !== entry.tag) {
            problems.push(`${word}: keyword claimed by both ${owner} and ${entry.tag}`);
            return;
        }
        seenKeywords.set(word, entry.tag);
    });

    const hosts = Array.isArray(entry.hosts) ? entry.hosts : [];
    if (!hosts.length) {
        problems.push(`${where}: no hosts, so it can never match`);
    }
    hosts.forEach((host) => {
        if (!HOST.test(String(host))) {
            problems.push(`${where}: host ${JSON.stringify(host)} must be a bare lowercase domain `
                + '(no scheme, no www., no path, no port)');
            return;
        }
        if (host.startsWith('www.')) {
            problems.push(`${where}: host ${host} carries www., which patternsFor() strips`);
            return;
        }
        const owner = seenHosts.get(host);
        if (owner) {
            problems.push(`${host}: claimed by both ${owner} and ${entry.tag}`);
            return;
        }
        seenHosts.set(host, entry.tag);
    });
});

if (problems.length) {
    failed = true;
    problems.forEach((problem) => console.error(`  ✗ ${problem}`));
}

if (failed) {
    console.error(`\n${problems.length} problem(s) in static/data/tag-patterns.json`);
    process.exit(1);
}

console.log(`  ok tag-patterns.json: ${seenTags.size} tags, ${seenHosts.size} hosts, `
    + `${seenKeywords.size} keywords, no collisions`);
