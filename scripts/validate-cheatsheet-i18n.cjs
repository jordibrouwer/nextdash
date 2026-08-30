#!/usr/bin/env node
/**
 * Locale parity for every keyboard string the cheat sheet and the inline view
 * legends read.
 *
 * A missing translation is silent at runtime: the lookup falls back to the
 * English fallback baked into the calling code, so a Dutch user sees an English
 * row and nothing anywhere reports it. This turns that into a build failure.
 *
 * Usage: node scripts/validate-cheatsheet-i18n.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const LOCALES = ['nl', 'de', 'fr', 'zh'];

/** Inline legend keys live flat under `dashboard.`, not under `cheatsheet.`. */
const LEGEND_KEY_RE = /^(healthKey|inboxKey|triageKey)/;

/** Cheat sheet chrome that sits outside the `cheatsheet.` object. */
const CHROME_KEYS = [
    'cheatsheetFilterPlaceholder',
    'cheatsheetNoResults',
    'cheatsheetTitle',
];

function load(locale) {
    const file = path.join(root, 'locales', `${locale}.json`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The three key families the cheat sheet actually reads, as flat
 * `dashboard.`-relative paths so one comparison covers all of them.
 */
function collectKeys(dashboard) {
    const cheatsheet = dashboard.cheatsheet || {};
    return [
        ...Object.keys(cheatsheet).map((k) => `cheatsheet.${k}`),
        ...Object.keys(dashboard).filter((k) => LEGEND_KEY_RE.test(k)),
        ...CHROME_KEYS.filter((k) => k in dashboard),
    ];
}

function lookup(dashboard, key) {
    if (key.startsWith('cheatsheet.')) {
        return dashboard.cheatsheet?.[key.slice('cheatsheet.'.length)];
    }
    return dashboard[key];
}

const en = load('en').dashboard;
const enKeys = collectKeys(en);
const failures = [];

console.log(`Validating cheat sheet locale parity (${enKeys.length} keys from en)…`);

for (const locale of LOCALES) {
    const dashboard = load(locale).dashboard || {};
    const missing = [];
    const echoed = [];
    const empty = [];

    for (const key of enKeys) {
        const value = lookup(dashboard, key);
        if (value === undefined) {
            missing.push(key);
            continue;
        }
        if (typeof value !== 'string' || value.trim() === '') {
            empty.push(key);
            continue;
        }
        // A raw key that leaked into the value renders literally in the UI, which
        // looks more broken than an untranslated English string.
        if (value === `dashboard.${key}` || value === key) {
            echoed.push(key);
        }
    }

    if (missing.length || echoed.length || empty.length) {
        failures.push({ locale, missing, echoed, empty });
        console.log(`  FAIL ${locale}: ${missing.length} missing, ${echoed.length} key-echo, ${empty.length} empty`);
    } else {
        console.log(`  ok ${locale} (${enKeys.length} keys)`);
    }
}

if (failures.length) {
    console.error('\nCheat sheet locale parity failed:\n');
    for (const { locale, missing, echoed, empty } of failures) {
        if (missing.length) {
            console.error(`  ${locale} missing ${missing.length}:`);
            for (const key of missing) console.error(`    dashboard.${key}`);
        }
        if (echoed.length) {
            console.error(`  ${locale} echoes the raw key ${echoed.length}:`);
            for (const key of echoed) console.error(`    dashboard.${key}`);
        }
        if (empty.length) {
            console.error(`  ${locale} empty ${empty.length}:`);
            for (const key of empty) console.error(`    dashboard.${key}`);
        }
    }
    console.error('\nAdd the missing strings to locales/<lang>.json before shipping.');
    process.exit(1);
}

console.log('All cheat sheet keys present in every locale.');
