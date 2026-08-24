#!/usr/bin/env node
'use strict';

/**
 * Locale keys nothing can reach.
 *
 * The four locale files carry about five thousand strings between them, and a
 * naive grep says a third of them are unreferenced — which is wrong, because
 * plenty are built at runtime: `t(\`config.${field}Label\`)`, a key assembled
 * from a schema field, a help panel id, a check mode. Deleting on that answer
 * would take out strings that render every day.
 *
 * So this is deliberately conservative. A key counts as reachable when:
 *   1. its name appears literally anywhere in the source, or
 *   2. it matches a template a call site builds — every `\`config.${x}Suffix\``
 *      in the code becomes a prefix/suffix pair, and any key that fits one is
 *      left alone, or
 *   3. it is one of the families that are looked up by a value from data
 *      (theme ids, weather codes, check modes, help panels, tips).
 *
 * What is left is reported, never deleted automatically: this prints, and a
 * human decides. Exit code is always 0 — it is a report, not a gate.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOCALES = path.join(root, 'locales');
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'test-results', 'locales',
    'playwright-report']);
// Skipped by path, not by name: the runtime data directory holds a copy of
// whatever the reader saved and says nothing about the source. `static/data`
// is a different thing entirely -- the feature catalogue and the release notes
// live there, and the catalogue names 200 locale keys nothing else mentions.
// Skipping every directory called `data` took it with it, and the keys it
// alone reaches were reported as unreachable.
const SKIP_PATHS = new Set([path.join(root, 'data')]);

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (SKIP_PATHS.has(full)) continue;
        if (entry.isDirectory()) walk(full, out);
        else if (/\.(js|cjs|go|html|json|md)$/.test(entry.name)) out.push(full);
    }
    return out;
}

const sources = walk(root).map((file) => fs.readFileSync(file, 'utf8'));
const blob = sources.join('\n');

// Every key assembled from a template, as a prefix/suffix pair.
//
// A bare `config.${x}` matches every key there is, which would make this script
// report nothing at all — those call sites are the ones that look a key up by a
// value from data, and their families are listed below instead.
const templates = [];
for (const m of blob.matchAll(/[`'"]((?:config|dashboard)\.)?([A-Za-z0-9_]*)\$\{[^}]*\}([A-Za-z0-9_]*)/g)) {
    const prefix = m[2] || '';
    const suffix = m[3] || '';
    if (!prefix && !suffix) continue;
    templates.push({ prefix, suffix });
}

// Families whose keys are chosen by a value in data rather than by name.
const DATA_DRIVEN = [
    /^theme/, /^weather/, /^checkMode/, /^help[A-Z]/, /^tip[A-Z0-9]/, /^month/, /^weekday/,
    /^healthReason/, /^statusFilter/, /^finder/, /^collectionRule/, /^errorCode/,
];

function reachable(key) {
    if (blob.includes(key)) return true;
    if (DATA_DRIVEN.some((re) => re.test(key))) return true;
    // A dotted key is a family looked up by a value: `backgroundPreset.sunset`
    // is reached as `t('config.backgroundPreset.' + id)`, and the id never
    // appears beside the family name. If the family is used, the members are.
    if (key.includes('.')) {
        const family = key.slice(0, key.lastIndexOf('.') + 1);
        if (blob.includes(family)) return true;
    }
    return templates.some(({ prefix, suffix }) =>
        key.length >= prefix.length + suffix.length
        && key.startsWith(prefix)
        && key.endsWith(suffix));
}

const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en.json'), 'utf8'));
const report = {};
let total = 0;
for (const section of Object.keys(en)) {
    if (!en[section] || typeof en[section] !== 'object') continue;
    const dead = Object.keys(en[section])
        .filter((key) => typeof en[section][key] === 'string' && !reachable(key));
    if (dead.length) {
        report[section] = dead;
        total += dead.length;
    }
}

for (const [section, keys] of Object.entries(report)) {
    console.log(`  ${section}: ${keys.length} unreachable`);
    for (const key of keys) console.log(`      ${key}`);
}
console.log(total
    ? `${total} keys look unreachable. Check a few by hand before deleting: a key built from data this script does not know about will be in here.`
    : 'No unreachable locale keys.');
