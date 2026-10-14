#!/usr/bin/env node
'use strict';

/**
 * Fix the catalogue in place, without a rebuild.
 *
 *   node scripts/tag-catalogue/apply.cjs
 *
 * A full build (classify → merge) needs the Wikidata and CrUX cache, which is
 * not kept. This writes the hand-kept files straight into
 * internal/app/tag_catalogue.json instead:
 *
 * - subjects.json: new hand-written subjects and their sites, added when
 *   missing; never removed.
 * - parents.json: each subject's broader subject, written as `parent`.
 * - manual/splits.json and manual/classes.json: where split.cjs and
 *   import-classes.cjs put each host, written in the same way as cleanup.
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
const readJSON = (...parts) => JSON.parse(fs.readFileSync(path.join(__dirname, ...parts), 'utf8'));
const cleanup = readJSON('manual', 'cleanup.json');
// The finer subjects splits.json carves out of broad ones, and where split.cjs
// put each host.
const splitsFile = path.join(__dirname, 'splits.json');
const splitDefs = fs.existsSync(splitsFile) ? readJSON('splits.json').splits : {};
const splitHosts = fs.existsSync(path.join(__dirname, 'manual', 'splits.json')) ? readJSON('manual', 'splits.json') : {};
// Well-known sites of whole Wikidata classes (import-classes.cjs).
const classHosts = fs.existsSync(path.join(__dirname, 'manual', 'classes.json')) ? readJSON('manual', 'classes.json') : {};
// Sites from Lobsters' tags and from curated lists (harvest-lobsters.cjs, harvest-awesome.cjs).
const harvested = ['lobsters.json', 'awesome.json', 'directories.json']
    .filter((name) => fs.existsSync(path.join(__dirname, 'manual', name)))
    .reduce((all, name) => ({ ...all, ...readJSON('manual', name) }), {});

const { subjects } = readJSON('subjects.json');
const splitSubjects = Object.values(splitDefs).flat().filter(({ existing }) => !existing)
    .map(({ tag, aliases = [], keywords = [] }) => ({ tag, aliases, keywords, hosts: [] }));

// subjects.json, first half: the new subjects, so cleanup.json may name them.
let created = 0;
[...subjects, ...splitSubjects].forEach(({ tag, aliases = [], keywords = [] }) => {
    if (doc.tags.some((known) => known.tag === tag)) return;
    doc.tags.push({ tag, aliases, hosts: [], keywords });
    created += 1;
});
doc.tags.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

// cleanup.json: before the new sites, so a misfiled host makes room for them.
const bySubject = new Map(doc.tags.map((entry) => [entry.tag, entry]));
let moved = 0;
let dropped = 0;
Object.entries({ ...splitHosts, ...classHosts, ...harvested, ...cleanup }).forEach(([host, tags]) => {
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

// subjects.json, second half: the sites each subject lacks, while a host
// stays under at most two subjects.
const hostCount = new Map();
doc.tags.forEach((entry) => [...entry.hosts, ...(entry.derived || [])].forEach((written) => {
    const host = written.replace(/^=/, '');
    hostCount.set(host, (hostCount.get(host) || 0) + 1);
}));
let hostsAdded = 0;
const full = [];
subjects.forEach(({ tag, hosts = [] }) => {
    const entry = bySubject.get(tag);
    hosts.forEach((written) => {
        const host = written.replace(/^=/, '');
        if ([...entry.hosts, ...(entry.derived || [])].some((h) => h.replace(/^=/, '') === host)) return;
        if ((hostCount.get(host) || 0) >= 2) {
            full.push(`${host} (${tag})`);
            return;
        }
        entry.hosts = [...entry.hosts, written].sort();
        hostCount.set(host, (hostCount.get(host) || 0) + 1);
        hostsAdded += 1;
    });
});
if (full.length) console.log(`already under two subjects, left out: ${full.join(', ')}`);

const parented = applyParents(doc);
fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`${created} subjects added, ${hostsAdded} hosts added; ${moved} hosts refiled, ${dropped} dropped; ${parented} subjects with a parent; ${doc.tags.length} subjects`);
