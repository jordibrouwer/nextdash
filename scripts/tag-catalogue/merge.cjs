#!/usr/bin/env node
'use strict';

/**
 * Step 4 of the catalogue build: write cache/derived.json into the catalogue.
 *
 *   node scripts/tag-catalogue/merge.cjs
 *
 * Each subject gets a "derived" list beside its hand-written "hosts". The
 * build owns "derived" and replaces it whole on every run; "hosts" is never
 * touched here, so handwork survives a rebuild.
 *
 * A derived host is left out when its parent domain already lends it the
 * same subject: docs.example.com under docs adds nothing when example.com
 * is there.
 */

const fs = require('fs');
const path = require('path');
const { applyParents } = require('./parents.cjs');

const file = path.join(__dirname, '..', '..', 'internal', 'app', 'tag_catalogue.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const derived = JSON.parse(fs.readFileSync(path.join(__dirname, 'cache', 'derived.json'), 'utf8'));

// What the hand-written part already resolves, host -> [{tag, exact}].
const byHost = new Map();
doc.tags.forEach((entry) => entry.hosts.forEach((written) => {
    const host = written.replace(/^=/, '');
    byHost.set(host, (byHost.get(host) || []).concat({ tag: entry.tag, exact: written.startsWith('=') }));
}));

function inherited(host) {
    const labels = host.split('.');
    for (let i = 1; i <= labels.length - 2; i++) {
        const found = (byHost.get(labels.slice(i).join('.')) || []).filter((e) => !e.exact);
        if (found.length) return found.map((e) => e.tag);
    }
    return [];
}

const lists = new Map(doc.tags.map((entry) => [entry.tag, []]));
let added = 0;
let redundant = 0;
Object.entries(derived).forEach(([host, { tags }]) => {
    if (byHost.has(host)) return;
    const fromParent = inherited(host);
    const own = tags.filter((tag) => lists.has(tag) && !fromParent.includes(tag));
    if (!own.length) {
        redundant += 1;
        return;
    }
    own.slice(0, 2).forEach((tag) => lists.get(tag).push(host));
    added += 1;
});

doc.meta = {
    ...(doc.meta || {}),
    sources: [
        'Chrome UX Report top lists by country (CC-BY 4.0), for which sites to include',
        'Wikidata (CC0), for what each site is',
    ],
};
doc.tags.forEach((entry) => {
    const list = lists.get(entry.tag).sort();
    if (list.length) entry.derived = list;
    else delete entry.derived;
});
applyParents(doc);
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${added} derived hosts written, ${redundant} left out as already covered by a parent`);
