#!/usr/bin/env node
'use strict';

/**
 * How much of a real collection the tag catalogue recognises.
 *
 *   node scripts/tag-catalogue-coverage.cjs <data-dir> [--misses N]
 *
 * Reads every bookmarks-*.json in the data directory, keeps the public
 * addresses (no private IPs, no .lan/.local/.home.arpa, no single-label
 * names), and resolves each host the way lookupHost() in
 * static/js/shared/tag-suggestions.js does, "=" exact hosts included. Prints
 * the share that gets a subject and the most common hosts that do not.
 *
 * Run it against a copy of a real NEXTDASH_DATA_DIR before and after a
 * catalogue change: the number is what the change was for.
 */

const fs = require('fs');
const path = require('path');

const dataDir = process.argv[2];
if (!dataDir) {
    console.error('usage: node scripts/tag-catalogue-coverage.cjs <data-dir> [--misses N]');
    process.exit(2);
}
const missesAt = process.argv.indexOf('--misses');
const missCount = missesAt > 0 ? Number(process.argv[missesAt + 1]) || 40 : 40;

const catalogue = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'internal', 'app', 'tag_catalogue.json'), 'utf8')).tags;

const byHost = new Map();
catalogue.forEach((entry) => {
    entry.hosts.concat(entry.derived || []).forEach((written) => {
        const host = written.replace(/^=/, '');
        const list = byHost.get(host) || [];
        list.push({ tag: entry.tag, exact: written.startsWith('=') });
        byHost.set(host, list);
    });
});

function resolve(host) {
    const labels = host.split('.');
    for (let i = 0; i <= labels.length - 2; i++) {
        const found = (byHost.get(labels.slice(i).join('.')) || []).filter((e) => i === 0 || !e.exact);
        if (found.length) return found.map((e) => e.tag);
    }
    return [];
}

function isPublic(host) {
    if (!host || !host.includes('.')) return false;
    if (/\.(lan|local|home\.arpa|internal|localdomain|test|example|invalid)$/.test(host)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return false;
    return true;
}

const hosts = [];
fs.readdirSync(dataDir).filter((name) => /^bookmarks-\d+\.json$/.test(name)).forEach((name) => {
    let doc;
    try {
        doc = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
    } catch {
        return;
    }
    const items = Array.isArray(doc) ? doc : (doc.bookmarks || []);
    items.forEach((bookmark) => {
        try {
            const host = new URL(bookmark.url).hostname.toLowerCase().replace(/^www\./, '');
            if (isPublic(host)) hosts.push(host);
        } catch {
            // not an address
        }
    });
});

const counts = new Map();
hosts.forEach((host) => counts.set(host, (counts.get(host) || 0) + 1));
const hit = hosts.filter((host) => resolve(host).length).length;
const share = hosts.length ? Math.round((100 * hit) / hosts.length) : 0;

console.log(`${hosts.length} public bookmarks on ${counts.size} hosts`);
console.log(`${hit} get a subject from the catalogue (${share}%)`);
const misses = [...counts].filter(([host]) => !resolve(host).length)
    .sort((a, b) => b[1] - a[1]).slice(0, missCount);
if (misses.length) {
    console.log(`\nmost common misses:`);
    misses.forEach(([host, n]) => console.log(`  ${String(n).padStart(4)}  ${host}`));
}
