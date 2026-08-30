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
 * A key is always addressed with its section — `t('health.title')`, never
 * `t('title')`, because the lookup walks the file from the root — so that is
 * what this asks about. Asking about the bare name instead is what let a whole
 * superseded section pass as live: `health.title`, `health.refresh` and
 * `health.open` were checked as the substrings `title`, `refresh` and `open`,
 * which occur all over the source, and the 124 dead keys behind them were
 * reported as reachable for as long as the section existed.
 *
 * So a key counts as reachable when:
 *   1. `section.key` appears literally anywhere in the source, or
 *   2. it matches a template a call site builds *in its own section* — every
 *      `\`config.${x}Suffix\`` becomes a prefix/suffix pair belonging to config,
 *      and any config key that fits one is left alone, or
 *   3. it is one of the families that are looked up by a value from data
 *      (theme ids, weather codes, check modes, help panels, tips).
 *
 * Templates only count when they carry a section, because a template without one
 * is not a locale key at all. Collecting those too meant `\`s${i}\`` — a DOM id
 * built in some renderer — became {prefix: 's'} and vouched for every key
 * starting with an s, in every section. Ninety-one of the dead health keys were
 * held up by exactly that kind of match.
 *
 * What is left is reported in two lists, never deleted automatically:
 *   - unreachable: nothing in the source names it, under its section or otherwise.
 *   - name only: the bare name occurs somewhere but never behind its section, so
 *     the match may well be a coincidence. Lower confidence than the first list,
 *     which is the whole reason it is a separate one.
 *
 * That second list is not empty by accident. Several modules wrap the lookup and
 * prepend their own section — dashboard-quickstart.js calls `this.t('title')` and
 * builds `quickstart.title` inside — so their keys are named in the source
 * without the section ever standing next to them. All 49 quickstart keys land
 * there, and most of them render every day. Read the list, do not delete it.
 *
 * This prints, and a human decides. Exit code is always 0 — it is a report, not
 * a gate. Pass --all to list every key rather than the first few per section.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOCALES = path.join(root, 'locales');
const SHOW_ALL = process.argv.includes('--all');
const SAMPLE = 15;
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

const en = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en.json'), 'utf8'));
const sections = Object.keys(en).filter((name) => en[name] && typeof en[name] === 'object');
const sectionAlternation = sections.join('|');

// Every key assembled from a template, as a section and a prefix/suffix pair.
//
// A bare `config.${x}` matches every key in config, which would vouch for the
// whole section — those call sites are the ones that look a key up by a value
// from data, and their families are listed below instead.
const templates = [];
for (const m of blob.matchAll(
    new RegExp(`[\`'"](${sectionAlternation})\\.([A-Za-z0-9_.]*)\\$\\{[^}]*\\}([A-Za-z0-9_.]*)`, 'g'))) {
    const prefix = m[2] || '';
    const suffix = m[3] || '';
    if (!prefix && !suffix) continue;
    templates.push({ section: m[1], prefix, suffix });
}

// The same thing written with `+` instead of a template literal.
//
// `t('config.backgroundPattern' + option.charAt(0).toUpperCase() + ...)` builds
// a key exactly as a template does, and the pattern above cannot see it — so
// every key in that family was reported unreachable while being used on screen.
// Only the prefix is recoverable here: what follows the `+` is an expression,
// and the suffix, if any, is beyond it.
for (const m of blob.matchAll(
    new RegExp(`['"](${sectionAlternation})\\.([A-Za-z0-9_.]+)['"]\\s*\\+`, 'g'))) {
    templates.push({ section: m[1], prefix: m[2], suffix: '' });
}

// Families whose keys are chosen by a value in data rather than by name.
const DATA_DRIVEN = [
    /^theme/, /^weather/, /^checkMode/, /^help[A-Z]/, /^tip[A-Z0-9]/, /^month/, /^weekday/,
    /^healthReason/, /^statusFilter/, /^finder/, /^collectionRule/, /^errorCode/,
];

function reachable(section, key) {
    if (blob.includes(`${section}.${key}`)) return true;
    if (DATA_DRIVEN.some((re) => re.test(key))) return true;
    // A dotted key is a family looked up by a value: `backgroundPreset.sunset`
    // is reached as `t('config.backgroundPreset.' + id)`, and the id never
    // appears beside the family name. If the family is used, the members are.
    if (key.includes('.')) {
        const family = key.slice(0, key.lastIndexOf('.') + 1);
        if (blob.includes(`${section}.${family}`)) return true;
    }
    return templates.some(({ section: from, prefix, suffix }) =>
        from === section
        && key.length >= prefix.length + suffix.length
        && key.startsWith(prefix)
        && key.endsWith(suffix));
}

const report = {};
let unreachable = 0;
let nameOnly = 0;
for (const section of sections) {
    const dead = [];
    const weak = [];
    for (const key of Object.keys(en[section])) {
        if (typeof en[section][key] !== 'string') continue;
        if (reachable(section, key)) continue;
        (blob.includes(key) ? weak : dead).push(key);
    }
    if (dead.length || weak.length) report[section] = { dead, weak };
    unreachable += dead.length;
    nameOnly += weak.length;
}

function list(label, keys) {
    if (!keys.length) return;
    const shown = SHOW_ALL ? keys : keys.slice(0, SAMPLE);
    console.log(`    ${keys.length} ${label}`);
    for (const key of shown) console.log(`      ${key}`);
    if (shown.length < keys.length) {
        console.log(`      … and ${keys.length - shown.length} more (--all to list them)`);
    }
}

for (const [section, { dead, weak }] of Object.entries(report)) {
    console.log(`  ${section}:`);
    list('unreachable', dead);
    list('matched by name only, never behind the section', weak);
}

if (!unreachable && !nameOnly) {
    console.log('No unreachable locale keys.');
} else {
    console.log(`${unreachable} keys look unreachable, and ${nameOnly} more match only by name.`);
    console.log('Check by hand before deleting: a key built from data this script does not know');
    console.log('about will be in here, and the second list is the weaker evidence of the two.');
}
