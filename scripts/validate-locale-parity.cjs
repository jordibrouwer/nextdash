#!/usr/bin/env node
'use strict';

/**
 * The four locale files describe the same app, so they carry the same keys.
 *
 * A key present in English and missing elsewhere renders the English fallback
 * from the call site — which looks like a finished translation to anyone
 * reading the code and like an oversight to anyone reading the app in Dutch.
 * A key present only in a translation is dead weight travelling in every
 * payload. Both are invisible without a check.
 *
 * This became worth automating when about a thousand unreachable keys were
 * removed from all four files at once: the only cheap proof that the removal
 * was even-handed is that the four still agree.
 */

const fs = require('fs');
const path = require('path');

const LOCALES = path.join(__dirname, '..', 'locales');
const BASE = 'en';
const OTHERS = ['nl', 'de', 'fr'];

const read = (lang) => JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
const base = read(BASE);

let failed = false;
for (const lang of OTHERS) {
    const other = read(lang);
    const problems = [];
    for (const [section, block] of Object.entries(base)) {
        if (!block || typeof block !== 'object') continue;
        const mine = other[section] || {};
        const missing = Object.keys(block).filter((key) => !(key in mine));
        const extra = Object.keys(mine).filter((key) => !(key in block));
        if (missing.length) problems.push(`${section}: ${missing.length} missing (${missing.slice(0, 5).join(', ')})`);
        if (extra.length) problems.push(`${section}: ${extra.length} not in English (${extra.slice(0, 5).join(', ')})`);
    }
    if (problems.length) {
        failed = true;
        console.error(`  ✗ ${lang}: ${problems.join('; ')}`);
    } else {
        console.log(`  ok ${lang}: same keys as ${BASE}`);
    }
}

if (failed) {
    console.error('The locale files have drifted apart.');
    process.exit(1);
}
console.log('All locale files carry the same keys.');
