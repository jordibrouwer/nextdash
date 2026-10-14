#!/usr/bin/env node
'use strict';

/**
 * Fix the catalogue in place, without a rebuild.
 *
 *   node scripts/tag-catalogue/apply.cjs
 *
 * A full build (classify → merge) needs the Wikidata and CrUX cache, which is
 * not kept. This writes the two hand-kept files straight into
 * internal/app/tag_catalogue.json instead:
 *
 * - parents.json: each subject's broader subject, written as `parent`.
 * - manual/cleanup.json: derived hosts that were filed wrongly. Each is taken
 *   out of every subject's `derived` and put under the subjects listed, or
 *   under none for []. classify.cjs reads the same file as handwork, so a
 *   later rebuild keeps the fix.
 *
 * Safe to run twice.
 */

const fs = require('fs');
const path = require('path');
const { applyParents } = require('./parents.cjs');

const file = path.join(__dirname, '..', '..', 'internal', 'app', 'tag_catalogue.json');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const cleanup = JSON.parse(fs.readFileSync(path.join(__dirname, 'manual', 'cleanup.json'), 'utf8'));

const bySubject = new Map(doc.tags.map((entry) => [entry.tag, entry]));
let moved = 0;
let dropped = 0;
Object.entries(cleanup).forEach(([host, tags]) => {
    doc.tags.forEach((entry) => {
        if (entry.derived) entry.derived = entry.derived.filter((written) => written.replace(/^=/, '') !== host);
    });
    tags.slice(0, 2).forEach((tag) => {
        const entry = bySubject.get(tag);
        if (!entry) throw new Error(`cleanup.json: ${host} names unknown subject ${tag}`);
        if (entry.hosts.includes(host)) return;
        entry.derived = [...(entry.derived || []), host].sort();
    });
    if (tags.length) moved += 1;
    else dropped += 1;
});
doc.tags.forEach((entry) => {
    if (entry.derived && !entry.derived.length) delete entry.derived;
});

const parented = applyParents(doc);
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${moved} hosts refiled, ${dropped} dropped, ${parented} subjects with a parent`);
